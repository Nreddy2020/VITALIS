/**
 * VITALIS: compatibility drift checker
 *
 * Answers one question that no APM product answers: are the versions of the
 * things this application actually depends on mutually compatible, according to
 * documentation someone can go and read?
 *
 * The single most important behaviour in this file is what it does when it does
 * NOT know. A dependency with no rule covering it is reported as UNKNOWN and
 * counted in the coverage summary. It is never counted as compatible, and the
 * summary is deliberately written so that "no violations" cannot be read as
 * "compatible" — because with partial rule coverage those are very different
 * statements, and conflating them is how a drift tool becomes a green tick that
 * means nothing.
 *
 * Findings carry the same provenance vocabulary as the rest of the engine:
 *   OBSERVED — evaluated against a version resolved from a lockfile
 *   INFERRED — evaluated against the floor of a declared range
 *   UNKNOWN  — could not be evaluated
 */

const { evaluate } = require('./version_ops');
const { loadRules } = require('./compatibility_rules');

function indexPackages(packages) {
  const byName = new Map();
  for (const p of packages) {
    // First writer wins; npm and pypi names do not collide in practice, and if
    // they ever did we would rather be deterministic than clever.
    if (!byName.has(p.name)) byName.set(p.name, p);
  }
  return byName;
}

/** Resolve what a rule side points at: a package version, or a named fact. */
function resolveTarget(target, byName, facts) {
  if (target.package) {
    const p = byName.get(target.package);
    if (!p) return { found: false, value: undefined, provenance: 'UNKNOWN', label: target.package, detail: 'not present in the manifests' };
    return { found: true, value: p.version, provenance: p.provenance, label: target.package, detail: p.note, declared: p.declared };
  }
  const f = facts[target.fact];
  if (!f) return { found: false, value: undefined, provenance: 'UNKNOWN', label: target.fact, detail: 'fact not available' };
  return { found: true, value: f.value, provenance: f.provenance, label: target.fact, detail: f.source };
}

/**
 * Run the rules against one repository reading.
 * `reading` is the object returned by manifest_reader.readRepo().
 */
function checkDrift(reading, rules) {
  const active = loadRules(rules);
  const byName = indexPackages(reading.packages);
  const findings = [];
  const coveredPackages = new Set();

  for (const rule of active) {
    const subject = resolveTarget(rule.when, byName, reading.facts);

    // Does this rule apply at all?
    if (!subject.found) continue;
    const applies = evaluate(rule.when.constraint, subject.value);
    if (applies.result === 'UNKNOWN') {
      findings.push({
        ruleId: rule.id, status: 'UNKNOWN', severity: rule.severity,
        summary: `Cannot tell whether '${rule.description}' applies`,
        detail: `subject ${subject.label} = ${JSON.stringify(subject.value)}: ${applies.reason}`,
        provenance: 'UNKNOWN', source: rule.source
      });
      if (rule.when.package) coveredPackages.add(rule.when.package);
      continue;
    }
    if (applies.result === 'VIOLATED') continue; // rule simply does not apply here

    if (rule.when.package) coveredPackages.add(rule.when.package);

    // The rule applies. Now evaluate what it requires.
    if (rule.require.absent) {
      const present = byName.has(rule.require.absent);
      coveredPackages.add(rule.require.absent);
      findings.push({
        ruleId: rule.id,
        status: present ? 'VIOLATION' : 'SATISFIED',
        severity: rule.severity,
        summary: present ? rule.description : `${rule.require.absent} is not present`,
        detail: present
          ? `${rule.require.absent} is declared as ${byName.get(rule.require.absent).declared}`
          : 'not declared in any manifest',
        provenance: present ? byName.get(rule.require.absent).provenance : 'OBSERVED',
        source: rule.source
      });
      continue;
    }

    const required = resolveTarget(rule.require, byName, reading.facts);
    if (rule.require.package) coveredPackages.add(rule.require.package);

    if (!required.found || required.value === undefined || required.value === null) {
      findings.push({
        ruleId: rule.id, status: 'UNKNOWN', severity: rule.severity,
        summary: `${rule.description} — could not be checked`,
        detail: `${required.label}: ${required.detail}`,
        provenance: 'UNKNOWN', source: rule.source
      });
      continue;
    }

    const outcome = evaluate(rule.require.constraint, required.value);
    // A result derived from a declared range is INFERRED, never OBSERVED — the
    // rule may be evaluating a version that is not the one installed.
    const provenance = outcome.result === 'UNKNOWN'
      ? 'UNKNOWN'
      : (subject.provenance === 'OBSERVED' && required.provenance === 'OBSERVED' ? 'OBSERVED' : 'INFERRED');

    findings.push({
      ruleId: rule.id,
      status: outcome.result === 'VIOLATED' ? 'VIOLATION' : outcome.result,
      severity: rule.severity,
      summary: rule.description,
      detail: `${subject.label} ${subject.value} → ${required.label} is ${required.value}: ${outcome.reason}`
        + (provenance === 'INFERRED' ? ' [from a declared range, not a resolved version]' : ''),
      provenance,
      source: rule.source
    });
  }

  const uncovered = reading.packages
    .filter(p => !coveredPackages.has(p.name))
    .map(p => ({ ecosystem: p.ecosystem, name: p.name, version: p.version, provenance: p.provenance }));

  const count = s => findings.filter(f => f.status === s).length;
  const coverage = {
    packagesRead: reading.packages.length,
    packagesCovered: coveredPackages.size,
    packagesUncovered: uncovered.length,
    rulesLoaded: active.length,
    rulesApplied: findings.length,
    violations: count('VIOLATION'),
    satisfied: count('SATISFIED'),
    unknown: count('UNKNOWN'),
    uncovered
  };

  return { findings, coverage, warnings: reading.warnings, repoPath: reading.repoPath };
}

/**
 * The summary sentence.
 *
 * Written so it cannot be quoted as a clean bill of health. There is no code
 * path in this function that emits the word "compatible" on its own, because
 * with partial rule coverage this tool is not entitled to say it.
 */
function summarise(result) {
  const c = result.coverage;
  const parts = [];
  parts.push(`${c.rulesApplied} rule(s) applied: ${c.violations} VIOLATION, ${c.satisfied} SATISFIED, ${c.unknown} UNKNOWN.`);
  parts.push(
    `${c.packagesUncovered} of ${c.packagesRead} dependencies are covered by no rule — ` +
    `their compatibility is UNKNOWN, which is not the same as compatible.`
  );
  if (c.violations === 0) {
    parts.push('No violation was found among the rules that exist. That is a statement about the rules, not about the application.');
  }
  return parts.join(' ');
}

module.exports = { checkDrift, summarise, indexPackages, resolveTarget };
