#!/usr/bin/env node
/**
 * VITALIS: compatibility drift CLI
 *
 *   node engine/drift/check.js <path-to-repo> [--json] [--out <file>]
 *
 * Read-only. It opens dependency manifests and nothing else — no application
 * source, no .env files, no network calls.
 *
 * Exit codes:
 *   0  no violations found (which is NOT the same as "compatible" — see output)
 *   1  at least one VIOLATION
 *   2  the repository could not be read
 */

const path = require('path');
const fs = require('fs');
const { readRepo } = require('./manifest_reader');
const { checkDrift, summarise } = require('./drift_checker');

const ICON = { VIOLATION: '✗', SATISFIED: '✓', UNKNOWN: '?' };

function render(result) {
  const lines = [];
  lines.push('');
  lines.push('VITALIS — compatibility drift');
  lines.push(`repository: ${result.repoPath}`);
  lines.push('='.repeat(72));

  for (const w of result.warnings) lines.push(`  ! ${w}`);
  if (result.warnings.length) lines.push('');

  const order = { VIOLATION: 0, UNKNOWN: 1, SATISFIED: 2 };
  const sorted = [...result.findings].sort((a, b) => order[a.status] - order[b.status]);

  if (sorted.length === 0) {
    lines.push('  No rule in the rule set applies to this repository.');
    lines.push('  That is a coverage result, not a health result.');
  }

  for (const f of sorted) {
    lines.push(`  ${ICON[f.status]} [${f.status}] ${f.summary}`);
    lines.push(`      ${f.detail}`);
    lines.push(`      evidence: ${f.provenance}   rule: ${f.ruleId}   severity: ${f.severity}`);
    lines.push(`      source:   ${f.source.url}  (recorded ${f.source.recordedAt})`);
    lines.push('');
  }

  const c = result.coverage;
  lines.push('-'.repeat(72));
  lines.push('COVERAGE');
  lines.push(`  dependencies read      : ${c.packagesRead}`);
  lines.push(`  covered by a rule      : ${c.packagesCovered}`);
  lines.push(`  NOT covered (UNKNOWN)  : ${c.packagesUncovered}`);
  lines.push(`  rules loaded / applied : ${c.rulesLoaded} / ${c.rulesApplied}`);
  lines.push('');
  lines.push('SUMMARY');
  for (const s of summarise(result).split('. ').filter(Boolean)) {
    lines.push(`  ${s.replace(/\.$/, '')}.`);
  }
  lines.push('');
  return lines.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const repo = args.find(a => !a.startsWith('--'));
  if (!repo) {
    console.error('usage: node engine/drift/check.js <path-to-repo> [--json] [--out <file>]');
    return 2;
  }
  const repoPath = path.resolve(repo);
  if (!fs.existsSync(repoPath)) {
    console.error(`no such directory: ${repoPath}`);
    return 2;
  }

  const reading = readRepo(repoPath);
  // Ecosystem-agnostic: whatever is registered, did any of it find anything?
  if (reading.ecosystemsFound.length === 0) {
    const { ECOSYSTEMS } = require('./ecosystems');
    console.error(`no dependency manifests under ${repoPath} for any registered ecosystem (${ECOSYSTEMS.map(e => e.id).join(', ')}) — nothing to check`);
    return 2;
  }

  const result = checkDrift(reading);
  const asJson = args.includes('--json');
  const outIdx = args.indexOf('--out');
  const payload = asJson ? JSON.stringify(result, null, 2) : render(result);

  if (outIdx !== -1 && args[outIdx + 1]) {
    fs.writeFileSync(args[outIdx + 1], payload);
    console.log(`written: ${args[outIdx + 1]}`);
  } else {
    console.log(payload);
  }
  return result.coverage.violations > 0 ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { main, render };
