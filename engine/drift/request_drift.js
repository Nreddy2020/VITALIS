/**
 * VITALIS: request-scoped compatibility drift
 *
 * PILOT CORRECTION: the historical framing below overstates this module.
 * Component findings are SOURCE-MANIFEST checks, not deployed-boundary proof.
 * relationshipReport now evaluates observed boundaries separately, using the
 * optional fourth argument's digest-bound inventories. Missing evidence stays
 * UNKNOWN. Market exclusivity and version-equality identity claims are unproven.
 *
 * This is the join that makes drift a VITALIS capability rather than a good
 * standalone linter.
 *
 * `drift_checker.js` answers: *are the versions this REPOSITORY declares
 * mutually compatible?* Useful, but every dependency-checking tool on the market
 * is in that neighbourhood. The charter's question is different and nobody
 * answers it:
 *
 *   "Are the versions of the components THIS REQUEST actually touched
 *    mutually compatible — and which ones can we not see at all?"
 *
 * Three distinct kinds of version live in this file and are never merged:
 *
 *   DEPLOYED  — `service.version` reported by the component that served the
 *               request. What actually ran.
 *   DECLARED  — the `version` in that component's manifest. What source control
 *               says should ship.
 *   RESOLVED  — the dependency versions in its lockfile. What it was built with.
 *
 * DEPLOYED disagreeing with DECLARED is itself a finding — it means the drift
 * analysis is being performed against source that is not what served the
 * request, and every other finding for that hop inherits that doubt. Reporting
 * dependency findings without surfacing that mismatch would be presenting an
 * analysis of the wrong build as if it described production.
 */

const { bindingFor } = require('./component_bindings');
const { analyseRelationships } = require('./relationships');

/** Collapse hops to distinct components, keeping the evidence from each sighting. */
function componentsOf(hops) {
  const byService = new Map();
  for (const h of hops || []) {
    const name = h.service || h.node;
    if (!name) continue;
    if (!byService.has(name)) {
      byService.set(name, { service: name, hopCount: 0, deployedVersion: undefined, deploymentEnvironment: undefined, versionConflict: false });
    }
    const c = byService.get(name);
    c.hopCount++;
    if (h.serviceVersion !== undefined) {
      if (c.deployedVersion === undefined) c.deployedVersion = h.serviceVersion;
      // The same service reporting two versions inside one request is a real
      // condition (a rolling deploy mid-request). It is recorded, not averaged.
      else if (c.deployedVersion !== h.serviceVersion) c.versionConflict = true;
    }
    if (h.deploymentEnvironment !== undefined && c.deploymentEnvironment === undefined) {
      c.deploymentEnvironment = h.deploymentEnvironment;
    }
  }
  return [...byService.values()];
}

/**
 * Analyse one request.
 *
 * @param trace     { traceId, hops[] }
 * @param bindings  Map from loadBindings()
 * @param analyse   (manifestPath) => { reading, result } — injected so this
 *                  module stays pure and testable without a filesystem
 */
function analyseRequest(trace, bindings, analyse, relationshipEvidence = {}) {
  const traceId = trace && trace.traceId;
  const components = componentsOf(trace && trace.hops);
  const cache = new Map();
  const analysed = [];

  for (const c of components) {
    const binding = bindingFor(bindings, c.service);

    if (!binding) {
      analysed.push({
        ...c,
        bound: false,
        status: 'UNKNOWN',
        reason: 'no binding declares where this component\'s versions can be read; its compatibility is UNKNOWN',
        findings: [],
        coverage: null
      });
      continue;
    }

    let analysis = cache.get(binding.manifestPath);
    if (!analysis) {
      try {
        analysis = { ok: true, ...analyse(binding.manifestPath) };
      } catch (err) {
        analysis = { ok: false, error: err.message };
      }
      cache.set(binding.manifestPath, analysis);
    }

    if (!analysis.ok) {
      analysed.push({
        ...c, bound: true, binding,
        status: 'UNKNOWN',
        reason: `bound to ${binding.manifestPath}, but it could not be read: ${analysis.error}`,
        findings: [], coverage: null
      });
      continue;
    }

    // DEPLOYED vs DECLARED.
    const declared = analysis.reading.selfVersion;
    let versionAgreement;
    if (c.deployedVersion === undefined) {
      versionAgreement = {
        state: 'UNKNOWN',
        detail: 'the component did not report service.version, so the analysed source cannot be confirmed as the build that served this request'
      };
    } else if (!declared || !declared.value) {
      versionAgreement = {
        state: 'UNKNOWN',
        detail: `component reported ${c.deployedVersion}; the bound manifest declares no version to compare against`
      };
    } else if (declared.value === c.deployedVersion) {
      versionAgreement = { state: 'AGREES', detail: `reported version ${c.deployedVersion} matches the manifest; version equality does not prove deployed artifact identity` };
    } else {
      versionAgreement = {
        state: 'DISAGREES',
        detail: `deployed ${c.deployedVersion} but the bound manifest declares ${declared.value} — ` +
                `the findings below describe ${declared.value}, NOT the build that served this request`
      };
    }

    const findings = analysis.result.findings;
    const violations = findings.filter(f => f.status === 'VIOLATION');
    analysed.push({
      ...c,
      bound: true,
      binding,
      status: violations.length > 0 ? 'VIOLATION' : (findings.length > 0 ? 'CHECKED' : 'UNKNOWN'),
      reason: findings.length === 0 ? 'bound, but no rule in the rule set applies to this component' : null,
      versionAgreement,
      findings,
      coverage: analysis.result.coverage
    });
  }

  const bound = analysed.filter(c => c.bound);
  const unbound = analysed.filter(c => !c.bound);
  const withViolations = analysed.filter(c => c.status === 'VIOLATION');
  const stale = analysed.filter(c => c.versionAgreement && c.versionAgreement.state === 'DISAGREES');

  return {
    traceId,
    scope: 'Component findings describe source manifests; boundary assurance is evaluated separately',
    relationshipReport: analyseRelationships(trace, relationshipEvidence.inventories || [], relationshipEvidence.rules,
      relationshipEvidence.now, relationshipEvidence.expectedInteractions || []),
    components: analysed,
    summary: {
      componentsOnPath: analysed.length,
      bound: bound.length,
      unbound: unbound.length,
      componentsWithViolations: withViolations.length,
      violationsOnPath: analysed.reduce((n, c) => n + c.findings.filter(f => f.status === 'VIOLATION').length, 0),
      analysedAgainstDifferentBuild: stale.length
    }
  };
}

/**
 * The request-level sentence.
 *
 * Constructed so that a request with unbound hops can never read as clean. The
 * coverage clause is emitted first and unconditionally, because that is the
 * fact most likely to be dropped when someone quotes this in a status update.
 */
function summariseRequest(report) {
  const s = report.summary;
  const parts = [];
  parts.push(
    `Request ${report.traceId} touched ${s.componentsOnPath} component(s); ` +
    `${s.bound} bound to a version source, ${s.unbound} UNKNOWN.`
  );
  if (s.violationsOnPath > 0) {
    parts.push(`${s.violationsOnPath} source-manifest compatibility violation(s) found for ${s.componentsWithViolations} component(s) on this path; deployed applicability is not established by version equality.`);
  } else {
    parts.push('No violation was found among the components that could be checked.');
  }
  if (s.unbound > 0) {
    parts.push(`${s.unbound} component(s) on this path have no version source at all — this request has NOT been shown to be free of drift.`);
  }
  if (s.analysedAgainstDifferentBuild > 0) {
    parts.push(
      `${s.analysedAgainstDifferentBuild} component(s) reported a deployed version that does not match the source analysed; ` +
      `those findings describe a different build.`
    );
  }
  return parts.join(' ');
}

module.exports = { analyseRequest, summariseRequest, componentsOf };
