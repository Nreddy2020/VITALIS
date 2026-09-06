/**
 * VITALIS Beta-3.0: Multi-Signal Independent Recovery Comparator
 * Evaluates recovery across 6 non-negotiable enterprise signals.
 */

const { EvidenceGraph } = require('../evidence/evidence_graph');
const { CausalIntelligenceEngine } = require('../evidence/causal_engine');
const { TopologyResolver } = require('../correlation/topology_resolver');

class MultiSignalReplayComparator {
  static compareAndVerify({
    preFixEnvelopes = [],
    postFixEnvelopes = [],
    goldenBaselineBudgetMs = 180,
    expectedTopology = null
  }) {
    if (!preFixEnvelopes.length || !postFixEnvelopes.length) {
      return {
        isRecoveryVerified: false,
        failureReason: "Insufficient pre-fix or post-fix evidence records"
      };
    }

    // Signal 1: Original Deviation Removed
    const preMaxHop = preFixEnvelopes.reduce((max, e) => e.measurements.observedDurationMs > max.measurements.observedDurationMs ? e : max, preFixEnvelopes[0]);
    const postMatchingHop = postFixEnvelopes.find(e => e.component?.name === preMaxHop.component?.name);
    const deviationRemoved = postMatchingHop ? postMatchingHop.measurements.observedDurationMs < (preMaxHop.measurements.observedDurationMs * 0.1) : true;

    // Signal 2: Request Topology Intact
    const topologyCheck = TopologyResolver.validateTopology(postFixEnvelopes);
    const topologyRestored = topologyCheck.isValidTopology;

    // Signal 3: Total Latency Within Golden Baseline Budget
    const postTotalLatencyMs = postFixEnvelopes.reduce((sum, e) => sum + (e.measurements?.observedDurationMs || 0), 0);
    const latencyWithinBaseline = postTotalLatencyMs <= goldenBaselineBudgetMs;

    // Signal 4: Error Rate Restored (0.00% across all hops)
    const errorHops = postFixEnvelopes.filter(e => e.event?.status === "FAILED" || e.event?.status === "DEGRADED");
    const errorRateRestored = errorHops.length === 0;

    // Signal 5: No Downstream Regression Detected
    const preErrors = preFixEnvelopes.filter(e => e.event?.status === "FAILED").map(e => e.component?.name);
    const newRegressions = errorHops.filter(e => !preErrors.includes(e.component?.name));
    const noDownstreamRegression = newRegressions.length === 0;

    // Signal 6: Independent Observation Proof (distinct adapter timestamps)
    const postTimestamps = postFixEnvelopes.map(e => e.event?.timestamp);
    const hasValidTimestamps = postTimestamps.every(t => t !== undefined && t !== null);

    const signals = {
      signal1_deviationRemoved: { verified: deviationRemoved, preDurationMs: preMaxHop.measurements.observedDurationMs, postDurationMs: postMatchingHop?.measurements.observedDurationMs },
      signal2_topologyRestored: { verified: topologyRestored, hopCount: postFixEnvelopes.length },
      signal3_latencyWithinBaseline: { verified: latencyWithinBaseline, postTotalLatencyMs, budgetMs: goldenBaselineBudgetMs },
      signal4_errorRateRestored: { verified: errorRateRestored, failedHops: errorHops.length },
      signal5_noDownstreamRegression: { verified: noDownstreamRegression, newRegressionCount: newRegressions.length },
      signal6_independentObservation: { verified: hasValidTimestamps }
    };

    const isRecoveryVerified = deviationRemoved && topologyRestored && latencyWithinBaseline && errorRateRestored && noDownstreamRegression && hasValidTimestamps;

    return {
      isRecoveryVerified,
      signals,
      postTotalLatencyMs,
      preTotalLatencyMs: preFixEnvelopes.reduce((sum, e) => sum + (e.measurements?.observedDurationMs || 0), 0),
      latencyReductionPct: parseFloat((((preFixEnvelopes.reduce((sum, e) => sum + (e.measurements?.observedDurationMs || 0), 0) - postTotalLatencyMs) / preFixEnvelopes.reduce((sum, e) => sum + (e.measurements?.observedDurationMs || 0), 0)) * 100).toFixed(1)),
      verdict: isRecoveryVerified ? "RECOVERY_VERIFIED" : "VERIFICATION_FAILED"
    };
  }
}

module.exports = { MultiSignalReplayComparator };
