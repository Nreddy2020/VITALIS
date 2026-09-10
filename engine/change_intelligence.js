/**
 * DEPRECATED — replaced in Stage 3 by engine/change_correlator.js
 *
 * The previous contents of this file were a demo module, and they were unsafe to
 * keep loadable. It held two hardcoded change events, returned
 * `hasChangeCorrelation: true` unconditionally, and ended its lookup with
 * `|| this.changeEvents[0]` — so it could never fail to "find" a cause. Pointed
 * at any incident, it would confidently name a deployment that had nothing to do
 * with it. Nothing in the codebase referenced it, so it was replaced rather than
 * repaired.
 *
 * Use engine/change_correlator.js instead. It correlates REAL change events
 * (from engine/adapters/git_change_adapter.js, a CI/CD webhook, or a
 * change-management system) against the REAL observed time of a request, returns
 * nothing when nothing qualifies, and labels every match CORRELATED rather than
 * causal. See tests/verify_stage3_correlation_gates.js gate C2, which exists
 * specifically to prove it can say "no".
 */

class ChangeIntelligenceEngine {
  constructor() {
    throw new Error(
      'ChangeIntelligenceEngine is deprecated: it produced fabricated correlations. ' +
      'Use { ChangeCorrelator } from engine/change_correlator.js instead.'
    );
  }
}

module.exports = { ChangeIntelligenceEngine };
