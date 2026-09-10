#!/usr/bin/env node
/**
 * VITALIS: request-scoped compatibility drift CLI
 *
 *   node engine/drift/request_check.js --trace <trace.json> --bindings <bindings.json> [--json]
 *
 * `trace.json` is either { traceId, hops[] } or the object returned by
 * GET /api/traces/:id. Read-only; no network calls.
 *
 * Exit codes:
 *   0  no violations among components that could be checked
 *      (NOT "this request is free of drift" — read the coverage line)
 *   1  at least one violation on the path
 *   2  input could not be read
 */

const fs = require('fs');
const path = require('path');
const { readRepo } = require('./manifest_reader');
const { checkDrift } = require('./drift_checker');
const { loadBindings } = require('./component_bindings');
const { analyseRequest, summariseRequest } = require('./request_drift');

const ICON = { VIOLATION: '✗', CHECKED: '✓', UNKNOWN: '?' };

function arg(args, name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

function normaliseTrace(raw) {
  if (raw && Array.isArray(raw.hops)) return { traceId: raw.traceId || 'unknown', hops: raw.hops };
  if (raw && raw.dna && Array.isArray(raw.dna.hops)) return { traceId: raw.traceId || raw.dna.traceId || 'unknown', hops: raw.dna.hops };
  return null;
}

function render(report) {
  const lines = ['', 'VITALIS — compatibility drift on a request path', `trace: ${report.traceId}`, '='.repeat(72)];
  for (const c of report.components) {
    lines.push(`  ${ICON[c.status] || '?'} [${c.status}] ${c.service}  (${c.hopCount} hop${c.hopCount === 1 ? '' : 's'})`);
    if (!c.bound) {
      lines.push(`      ${c.reason}`);
      lines.push('');
      continue;
    }
    lines.push(`      bound to  : ${c.binding.manifestPath}  (declared by ${c.binding.declaredBy})`);
    if (c.versionAgreement) {
      lines.push(`      version   : ${c.versionAgreement.state} — ${c.versionAgreement.detail}`);
    }
    if (c.versionConflict) {
      lines.push('      ! this component reported more than one version within a single request');
    }
    if (c.reason) lines.push(`      ${c.reason}`);
    for (const f of c.findings.filter(f => f.status === 'VIOLATION')) {
      lines.push(`      ✗ ${f.summary}`);
      lines.push(`          ${f.detail}`);
      lines.push(`          evidence: ${f.provenance}   source: ${f.source.url}`);
    }
    if (c.coverage) {
      lines.push(`      coverage  : ${c.coverage.packagesUncovered} of ${c.coverage.packagesRead} dependencies covered by no rule (UNKNOWN)`);
    }
    lines.push('');
  }
  lines.push('-'.repeat(72));
  lines.push('SUMMARY');
  for (const s of summariseRequest(report).split('. ').filter(Boolean)) {
    lines.push(`  ${s.replace(/\.$/, '')}.`);
  }
  lines.push('');
  return lines.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const tracePath = arg(args, '--trace');
  const bindingsPath = arg(args, '--bindings');
  if (!tracePath || !bindingsPath) {
    console.error('usage: node engine/drift/request_check.js --trace <trace.json> --bindings <bindings.json> [--json]');
    return 2;
  }

  let trace, bindings;
  try {
    trace = normaliseTrace(JSON.parse(fs.readFileSync(path.resolve(tracePath), 'utf8')));
  } catch (err) { console.error(`could not read trace: ${err.message}`); return 2; }
  if (!trace) { console.error('trace file has no hops[] — nothing to analyse'); return 2; }

  try { bindings = loadBindings(path.resolve(bindingsPath)); }
  catch (err) { console.error(`could not load bindings: ${err.message}`); return 2; }

  const report = analyseRequest(trace, bindings, (manifestPath) => {
    const reading = readRepo(manifestPath);
    return { reading, result: checkDrift(reading) };
  });

  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : render(report));
  return report.summary.violationsOnPath > 0 ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { main, render, normaliseTrace };
