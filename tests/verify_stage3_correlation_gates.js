/**
 * VITALIS STAGE 3 — Change & Vulnerability Correlation (REAL data, no fixtures)
 *
 * Two capabilities, proven against real sources rather than sample arrays:
 *
 *  CHANGE INTELLIGENCE
 *   C1  A REAL git repository is created and REAL commits are made by this test
 *       (real `git commit`, real author dates). engine/adapters/git_change_adapter.js
 *       reads them with real `git log` and reports them to VITALIS. A request
 *       observed after those commits correlates to them.
 *   C2  The honesty gate the old engine/change_intelligence.js failed: a request
 *       observed BEFORE any change, or outside the window, must correlate to
 *       NOTHING. The old module always returned hasChangeCorrelation:true and
 *       fell back to changeEvents[0], so it could never say "no".
 *
 *  VULNERABILITY IMPACT
 *   V1  A REAL npm project is created with a REAL vulnerable dependency, and
 *       engine/adapters/npm_audit_adapter.js runs a REAL `npm audit` against the
 *       REAL npm registry. The advisories are whatever the registry actually
 *       returns today — nothing about them is hardcoded here.
 *   V2  VITALIS answers the question a scanner cannot: which REAL ingested
 *       requests traversed a service running the affected component.
 *   V3  Absence of an SBOM is reported as UNKNOWN coverage, never as "safe".
 *
 * Requires network access to the npm registry. Outputs:
 *   artifacts/stage3-correlation-gate-report.json
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TEST_API_KEY = 'stage3-correlation-test-key';
process.env.VITALIS_API_KEY = TEST_API_KEY;
process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-stage3-'));

const { startServer, stopServer } = require('../server');
const gitAdapter = require('../engine/adapters/git_change_adapter');
const npmAdapter = require('../engine/adapters/npm_audit_adapter');

const TEST_PORT = 4327;
const VITALIS = { host: 'localhost', port: TEST_PORT, apiKey: TEST_API_KEY };

function makeRequest(options, postData = null) {
  options = { agent: false, ...options, headers: { 'x-vitalis-api-key': TEST_API_KEY, ...(options.headers || {}) } };
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body || '{}') }); }
        catch (e) { resolve({ status: res.statusCode, raw: body }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

/** Post a span with an explicit real observation time (ns since epoch). */
function postSpan(traceId, service, durationMs, observedAtMs) {
  return makeRequest({
    hostname: 'localhost', port: TEST_PORT, path: '/v1/traces', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
      scopeSpans: [{ spans: [{
        traceId, spanId: `sp-${traceId}`, name: 'Handle-Request', durationMs,
        startTimeUnixNano: observedAtMs * 1e6
      }] }]
    }]
  });
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

async function run() {
  console.log('==================================================================');
  console.log('   VITALIS STAGE 3 — CHANGE & VULNERABILITY CORRELATION (REAL)    ');
  console.log('==================================================================\n');
  const report = { version: '1.0', testRun: `VITALIS-STAGE3-${Date.now()}`, timestamp: new Date().toISOString(), gates: {} };
  const artifactsDir = path.join(__dirname, '..', 'artifacts');
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

  await startServer(TEST_PORT);
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-stage3-repo-'));
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-stage3-proj-'));

  try {
    // ================= CHANGE INTELLIGENCE =================
    console.log('--- [GATE C1] Real git commits -> real change correlation ---');
    git(['init', '-q'], repoDir);
    git(['config', 'user.email', 'stage3@vitalis.test'], repoDir);
    git(['config', 'user.name', 'VITALIS Stage 3 Test'], repoDir);
    fs.writeFileSync(path.join(repoDir, 'checkout.js'), 'function checkout() { return true; }\n');
    git(['add', '.'], repoDir);
    git(['commit', '-q', '-m', 'Add checkout handler'], repoDir);
    fs.writeFileSync(path.join(repoDir, 'checkout.js'), 'function checkout() { /* batch lock query */ return true; }\n');
    git(['add', '.'], repoDir);
    git(['commit', '-q', '-m', 'Add batch inventory lock query on checkout path'], repoDir);

    const realHeadSha = git(['rev-parse', 'HEAD'], repoDir).trim();
    const synced = await gitAdapter.syncRepo(repoDir, VITALIS, { service: 'CheckoutService' });
    console.log(`> Real commits read from the real repo: ${synced.changeEvents.length}`);
    console.log(`> Real HEAD sha from git: ${realHeadSha.slice(0, 12)}`);
    console.log(`> VITALIS /v1/changes response: ${synced.postResult && synced.postResult.data}`);

    // A request observed NOW — i.e. after those real commits.
    const afterId = 'TX-STAGE3-AFTER-CHANGE';
    await postSpan(afterId, 'CheckoutService', 3200, Date.now());
    const afterResp = await makeRequest({ hostname: 'localhost', port: TEST_PORT, path: `/api/traces/${afterId}`, method: 'GET' });
    const cc = afterResp.data.changeCorrelation || {};
    const top = (cc.correlations || [])[0];

    const commitsWereRead = synced.changeEvents.length === 2;
    const correlatedToRealCommit = !!top && top.commit === realHeadSha;
    const labelledCorrelated = !!top && top.provenance === 'CORRELATED' && /not proof of causation/i.test(top.statement || '');
    const serviceMatched = !!top && top.serviceMatch === true;
    report.gates.realCommitsCorrelate = (commitsWereRead && correlatedToRealCommit && labelledCorrelated && serviceMatched) ? 'PASS' : 'FAIL';
    console.log(`> Correlated to the real HEAD commit: ${correlatedToRealCommit}`);
    console.log(`> Labelled CORRELATED with an explicit non-causation caveat: ${labelledCorrelated}`);
    console.log(`> Matched the service the request actually traversed: ${serviceMatched}`);
    console.log(`> statement: "${top && top.statement}"`);
    console.log(`RESULT GATE C1: [${report.gates.realCommitsCorrelate}]\n`);

    // -------------------------------------------------------
    console.log('--- [GATE C2] A request predating every change correlates to NOTHING ---');
    const beforeId = 'TX-STAGE3-BEFORE-CHANGE';
    const longBefore = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days before any commit
    await postSpan(beforeId, 'CheckoutService', 3200, longBefore);
    const beforeResp = await makeRequest({ hostname: 'localhost', port: TEST_PORT, path: `/api/traces/${beforeId}`, method: 'GET' });
    const bcc = beforeResp.data.changeCorrelation || {};
    const saidNo = bcc.hasChangeCorrelation === false && (bcc.correlations || []).length === 0;
    const explained = typeof bcc.reason === 'string' && bcc.reason.length > 0;
    report.gates.honestWhenNoChangeCorrelates = (saidNo && explained) ? 'PASS' : 'FAIL';
    console.log(`> hasChangeCorrelation: ${bcc.hasChangeCorrelation} (changes known to the engine: ${bcc.changesKnown})`);
    console.log(`> reason: "${bcc.reason}"`);
    console.log(`> No nearest-change fallback was invented: ${saidNo}`);
    console.log(`RESULT GATE C2: [${report.gates.honestWhenNoChangeCorrelates}]\n`);

    // ================= VULNERABILITY IMPACT =================
    console.log('--- [GATE V1] Real npm audit against the real registry ---');
    fs.writeFileSync(path.join(projDir, 'package.json'), JSON.stringify({
      name: 'vitalis-stage3-target', version: '1.0.0', private: true,
      dependencies: { lodash: '4.17.15' }   // a real, genuinely outdated version
    }, null, 2));
    console.log('> Installing a real vulnerable dependency (lodash@4.17.15) from the real registry...');
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent'], { cwd: projDir, stdio: 'ignore' });

    const scan = await npmAdapter.scanAndReport(projDir, 'CheckoutService', VITALIS);
    const advisories = scan.advisories;
    console.log(`> Real components read from the real project: ${scan.components.length}`);
    console.log(`> Real advisories returned by the registry: ${advisories.length}`);
    advisories.forEach(a => console.log(`    - ${a.id} [${a.severity}] ${a.package} ${a.vulnerableRange || ''} :: ${a.title}`));
    const gotRealAdvisories = advisories.length > 0 && advisories.every(a => /^(GHSA-|NPM-)/.test(a.id) && a.package === 'lodash');
    report.gates.realAdvisoriesFromRealRegistry = gotRealAdvisories ? 'PASS' : 'FAIL';
    report.advisories = advisories.map(a => ({ id: a.id, severity: a.severity, package: a.package, url: a.url }));
    console.log(`RESULT GATE V1: [${report.gates.realAdvisoriesFromRealRegistry}]\n`);

    // -------------------------------------------------------
    console.log('--- [GATE V2] Which REAL requests traverse the affected component ---');
    const advisoryId = advisories[0].id;
    const impactResp = await makeRequest({
      hostname: 'localhost', port: TEST_PORT,
      path: `/api/impact/${encodeURIComponent(advisoryId)}`, method: 'GET'
    });
    const impact = impactResp.data;
    const impactedIds = (impact.impactedRequests || []).map(r => r.traceId);
    const foundRealRequests = impact.found === true
      && impact.impactedRequestCount >= 2
      && impactedIds.includes(afterId) && impactedIds.includes(beforeId)
      && (impact.affectedServices || []).some(s => s.service === 'CheckoutService');
    report.gates.vulnerabilityMappedToRealRequests = foundRealRequests ? 'PASS' : 'FAIL';
    console.log(`> Advisory: ${advisoryId} (${impact.advisory && impact.advisory.severity})`);
    console.log(`> Real ingested requests traversing the affected service: ${impact.impactedRequestCount} ${JSON.stringify(impactedIds)}`);
    console.log(`> statement: "${impact.statement}"`);
    console.log(`RESULT GATE V2: [${report.gates.vulnerabilityMappedToRealRequests}]\n`);

    // -------------------------------------------------------
    console.log('--- [GATE V3] A service with no SBOM is UNKNOWN, never "safe" ---');
    const unknownSvcTrace = 'TX-STAGE3-UNKNOWN-SVC';
    await postSpan(unknownSvcTrace, 'LegacyMainframeGateway', 900, Date.now());
    const impact2 = (await makeRequest({
      hostname: 'localhost', port: TEST_PORT,
      path: `/api/impact/${encodeURIComponent(advisoryId)}`, method: 'GET'
    })).data;
    const listsUnknown = (impact2.unknownCoverage || []).includes('LegacyMainframeGateway');
    const notClaimedSafe = !/safe|not affected|clear/i.test(impact2.statement || '');
    const mentionsUnknown = /UNKNOWN/.test(impact2.statement || '');
    report.gates.unknownCoverageNotTreatedAsSafe = (listsUnknown && notClaimedSafe && mentionsUnknown) ? 'PASS' : 'FAIL';
    console.log(`> Services in telemetry with no registered inventory: ${JSON.stringify(impact2.unknownCoverage)}`);
    console.log(`> Reported as UNKNOWN rather than cleared: ${listsUnknown && mentionsUnknown}`);
    console.log(`> statement: "${impact2.statement}"`);
    console.log(`RESULT GATE V3: [${report.gates.unknownCoverageNotTreatedAsSafe}]\n`);

  } finally {
    await stopServer();
    try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(projDir, { recursive: true, force: true }); } catch (e) {}
    console.log('[CLEANUP] Test server stopped, temporary repo and project removed.\n');
  }

  const allPassed = Object.values(report.gates).every(v => v === 'PASS');
  console.log('==================================================================');
  console.log(`OVERALL: ${allPassed ? 'ALL STAGE 3 CORRELATION GATES PASSED' : 'ONE OR MORE GATES FAILED'}`);
  console.log('==================================================================');

  fs.writeFileSync(path.join(artifactsDir, 'stage3-correlation-gate-report.json'), JSON.stringify(report, null, 2));
  process.exit(allPassed ? 0 : 1);
}

run().catch(err => { console.error('[FATAL]', err); process.exit(1); });
