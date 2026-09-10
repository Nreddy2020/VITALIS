/**
 * VITALIS: IBM MQ live sensory adapter (Tier B)
 *
 * ── HONESTY NOTE, PLEASE READ ───────────────────────────────────────────────
 * The MQSC commands below are real and documented, and the parsing and
 * row→span mapping are genuinely unit-tested against real MQSC output text
 * (tests/verify_stage6_ibm_adapter_gates.js).
 *
 * What has NOT been verified is the live connection: no queue manager was
 * reachable from the environment this was written in, so the `runmqsc`
 * invocation path has not been executed against a real MQ installation. Treat
 * this as reviewed-and-tested parsing plus an UNVERIFIED execution path, and
 * run `selfTest()` on a host with MQ installed before trusting it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Why MQSC text rather than the PCF binary protocol: `runmqsc` is present on
 * every MQ server install and needs no extra driver, which makes it the lowest
 * friction way to start. For a high-volume production deployment the PCF
 * interface (via `ibmmq` for Node) is the better long-term choice; it maps onto
 * the same `parseQueueStatus()` output shape, so only the transport changes.
 *
 * MQ correlation depends on the application propagating the trace id through
 * the MQMD Correlation ID (or an RFH2 usr folder). Without that propagation, MQ
 * hops can be observed but NOT tied to a specific request — this adapter
 * reports the queue-level truth either way and simply omits the trace linkage
 * when the application has not provided one.
 */

const { execFile } = require('child_process');
const http = require('http');
const { decodeTraceFromMqCorrelId } = require('../trace_context');

/** Depth, limits and handle counts for a queue. */
const QUEUE_STATUS_CMD = queue => `DISPLAY QSTATUS(${queue}) TYPE(QUEUE) CURDEPTH IPPROCS OPPROCS LGETDATE LGETTIME`;
/** Configured maximum depth — needed to turn a depth into a real saturation ratio. */
const QUEUE_ATTRS_CMD = queue => `DISPLAY QLOCAL(${queue}) MAXDEPTH`;
/** Channel health for the queue manager. */
const CHANNEL_STATUS_CMD = 'DISPLAY CHSTATUS(*) STATUS';

/**
 * Parse MQSC output into key/value pairs.
 * MQSC emits records like:
 *   AMQ8450I: Display queue status details.
 *      QUEUE(DEV.CHECKOUT.IN)                  TYPE(QUEUE)
 *      CURDEPTH(842)                           IPPROCS(1)
 * Pure and side-effect free, so it is testable without MQ installed.
 */
function parseMqscRecords(output) {
  if (!output) return [];
  const records = [];
  let current = null;

  for (const rawLine of String(output).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // A new AMQ####I header starts a new record.
    if (/^AMQ\d+I/.test(line)) {
      if (current && Object.keys(current).length) records.push(current);
      current = {};
      continue;
    }
    if (!current) current = {};

    // KEY(VALUE) pairs, several per line; values may contain spaces.
    const pairs = line.match(/([A-Z0-9_]+)\(([^)]*)\)/g) || [];
    for (const pair of pairs) {
      const m = /([A-Z0-9_]+)\(([^)]*)\)/.exec(pair);
      if (m) current[m[1]] = m[2].trim();
    }
  }
  if (current && Object.keys(current).length) records.push(current);
  return records;
}

/**
 * Build a queue observation from parsed MQSC records. Anything MQ did not
 * report stays undefined; nothing is defaulted.
 */
function parseQueueStatus(statusOutput, attrsOutput, { queueManager } = {}) {
  const statusRec = parseMqscRecords(statusOutput).find(r => r.QUEUE) || null;
  const attrsRec = parseMqscRecords(attrsOutput).find(r => r.MAXDEPTH !== undefined) || null;
  if (!statusRec) return null;

  const num = v => (v === undefined || v === '' || isNaN(Number(v))) ? undefined : Number(v);
  const queueDepth = num(statusRec.CURDEPTH);
  const maxQueueDepth = attrsRec ? num(attrsRec.MAXDEPTH) : undefined;

  return {
    queueManager,
    queueName: statusRec.QUEUE,
    queueDepth,
    maxQueueDepth,
    // Real saturation only when the configured ceiling is actually known.
    depthSaturationPct: (queueDepth !== undefined && maxQueueDepth)
      ? Math.round((queueDepth / maxQueueDepth) * 100)
      : undefined,
    openInputCount: num(statusRec.IPPROCS),
    openOutputCount: num(statusRec.OPPROCS),
    lastGetDate: statusRec.LGETDATE || undefined,
    lastGetTime: statusRec.LGETTIME || undefined
  };
}

/**
 * Recover the trace id a message carried in its MQMD CorrelId. MQSC prints
 * CorrelId as hex; anything without our magic prefix belongs to another
 * application and yields undefined rather than a guess.
 */
function traceIdFromMessage(correlIdHex) {
  const decoded = decodeTraceFromMqCorrelId(correlIdHex);
  return decoded ? decoded.traceId : undefined;
}

/** Channels that are not RUNNING — the ones worth reporting. */
function parseChannelStatus(output) {
  return parseMqscRecords(output)
    .filter(r => r.CHANNEL)
    .map(r => ({ channel: r.CHANNEL, status: r.STATUS || 'UNKNOWN' }));
}

/**
 * A backed-up queue with NO consumers is a materially different incident from a
 * backed-up queue that is merely busy: the first cannot drain at all. Say which.
 */
function assessQueue(obs) {
  if (!obs || obs.queueDepth === undefined) {
    return { status: 'UNKNOWN', reason: 'Queue depth was not reported' };
  }
  if (obs.queueDepth > 0 && obs.openInputCount === 0) {
    return {
      status: 'FAILED',
      reason: `${obs.queueDepth} message(s) queued with zero open input handles — nothing is consuming this queue`
    };
  }
  if (obs.depthSaturationPct !== undefined && obs.depthSaturationPct >= 80) {
    return { status: 'DEGRADED', reason: `Queue is ${obs.depthSaturationPct}% of its configured MAXDEPTH` };
  }
  if (obs.depthSaturationPct === undefined && obs.queueDepth > 500) {
    return { status: 'DEGRADED', reason: `Queue depth ${obs.queueDepth}; MAXDEPTH unknown so saturation could not be computed` };
  }
  return { status: 'SUCCESS', reason: `Queue depth ${obs.queueDepth}` };
}

/** OTel span for an MQ hop. `traceId` must come from the app's MQMD correlation id. */
function toOtelSpan(traceId, obs, assessment, durationMs = 0) {
  const attributes = [
    { key: 'messaging.system', value: { stringValue: 'ibmmq' } }
  ];
  const push = (key, value, type = 'intValue') => {
    if (value === undefined || value === null) return;
    attributes.push({ key, value: { [type]: type === 'intValue' ? Math.round(Number(value)) : value } });
  };

  if (obs.queueName) attributes.push({ key: 'messaging.destination.name', value: { stringValue: obs.queueName } });
  if (obs.queueManager) attributes.push({ key: 'messaging.ibmmq.queue_manager', value: { stringValue: obs.queueManager } });
  push('messaging.ibmmq.queue_depth', obs.queueDepth);
  push('messaging.ibmmq.max_queue_depth', obs.maxQueueDepth);
  push('messaging.ibmmq.depth_saturation_pct', obs.depthSaturationPct);
  push('messaging.ibmmq.open_input_count', obs.openInputCount);
  push('messaging.ibmmq.open_output_count', obs.openOutputCount);
  if (assessment && assessment.reason) {
    attributes.push({ key: 'messaging.ibmmq.assessment', value: { stringValue: assessment.reason } });
  }

  return {
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'IBM-MQ' } }] },
    scopeSpans: [{ spans: [{
      traceId,
      spanId: `sp-mq-${(obs.queueName || 'queue').replace(/[^\w.-]/g, '_')}`,
      name: 'MQ-Queue',
      durationMs,
      attributes
    }] }]
  };
}

// ---------------------------------------------------------------------------
// Live execution path — UNVERIFIED against a real queue manager. See header.
// ---------------------------------------------------------------------------

function runMqsc(queueManager, command, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('runmqsc', [queueManager], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // runmqsc exits non-zero when a command reports an error but still
        // writes usable output, so prefer stdout over the exit code.
        if (stdout && stdout.trim()) return resolve(stdout);
        if (err) return reject(new Error(`runmqsc ${queueManager} failed: ${(stderr || err.message).trim()}`));
        resolve(stdout || '');
      });
    child.stdin.write(command + '\n');
    child.stdin.end();
  });
}

async function observeQueue(queueManager, queueName) {
  const [statusOut, attrsOut] = await Promise.all([
    runMqsc(queueManager, QUEUE_STATUS_CMD(queueName)),
    runMqsc(queueManager, QUEUE_ATTRS_CMD(queueName)).catch(() => '')
  ]);
  const obs = parseQueueStatus(statusOut, attrsOut, { queueManager });
  return obs ? { observation: obs, assessment: assessQueue(obs) } : null;
}

function postToVitalis(vitalisConfig, resourceSpans) {
  const body = JSON.stringify({ resourceSpans });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: vitalisConfig.host || 'localhost',
      port: vitalisConfig.port || 4318,
      path: '/v1/traces',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-vitalis-api-key': vitalisConfig.apiKey,
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function pollAndReport(queueManager, queueName, vitalisConfig, traceId) {
  const result = await observeQueue(queueManager, queueName);
  if (!result) return null;
  const span = toOtelSpan(traceId, result.observation, result.assessment);
  return { ...result, postResult: await postToVitalis(vitalisConfig, [span]) };
}

/** Run on a host with MQ installed, before trusting the execution path. */
async function selfTest(queueManager, queueName) {
  const results = { runmqscAvailable: false, queueStatus: false, queueAttrs: false, channels: false, errors: {} };
  try { await runMqsc(queueManager, 'DISPLAY QMGR QMNAME'); results.runmqscAvailable = true; }
  catch (err) { results.errors.runmqsc = err.message; return results; }

  try { const o = await runMqsc(queueManager, QUEUE_STATUS_CMD(queueName)); results.queueStatus = !!parseQueueStatus(o, '', { queueManager }); }
  catch (err) { results.errors.queueStatus = err.message; }
  try { await runMqsc(queueManager, QUEUE_ATTRS_CMD(queueName)); results.queueAttrs = true; }
  catch (err) { results.errors.queueAttrs = err.message; }
  try { await runMqsc(queueManager, CHANNEL_STATUS_CMD); results.channels = true; }
  catch (err) { results.errors.channels = err.message; }
  return results;
}

module.exports = {
  traceIdFromMessage,
  QUEUE_STATUS_CMD, QUEUE_ATTRS_CMD, CHANNEL_STATUS_CMD,
  parseMqscRecords, parseQueueStatus, parseChannelStatus, assessQueue,
  toOtelSpan, observeQueue, pollAndReport, postToVitalis, selfTest
};

// CLI: node engine/adapters/mq_live_adapter.js selftest QM1 DEV.CHECKOUT.IN
if (require.main === module) {
  const [cmd, qmgr, queue] = process.argv.slice(2);
  if (cmd === 'selftest' && qmgr && queue) {
    selfTest(qmgr, queue).then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(r.runmqscAvailable ? 0 : 1); });
  } else {
    console.log('usage: node engine/adapters/mq_live_adapter.js selftest <queueManager> <queueName>');
    process.exit(1);
  }
}
