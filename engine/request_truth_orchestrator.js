/**
 * VITALIS Request Truth Orchestrator
 * High-Throughput Out-Of-Band Request Reconstruction, Epistemic Claim Verification,
 * and Merkle Ledger Sealing Pipeline.
 */

const { IdentityResolver } = require('./correlation/identity_resolver');
const { TemporalCorrelator } = require('./correlation/temporal_correlator');
const { AsyncBoundaryCorrelator } = require('./correlation/async_boundary_correlator');
const { DuplicateDetector } = require('./correlation/duplicate_detector');
const { ConflictResolver } = require('./correlation/conflict_resolver');
const { CorrelationQuality } = require('./correlation/correlation_quality');
const { EvidenceEnvelope } = require('./evidence/evidence_envelope');
const { EvidenceGraph } = require('./evidence/evidence_graph');
const { CausalIntelligenceEngine } = require('./evidence/causal_engine');
const { BusinessImpactEvaluator } = require('./evidence/business_impact');
const { EvidenceTruthLedger } = require('./evidence_ledger');
const { ReplayRecoveryVerifier } = require('./replay_recovery_engine');
const { EnterpriseEvidenceCorrelator } = require('./adapters/enterprise_correlator');

class RequestTruthOrchestrator {
  constructor(options = {}) {
    this.ledger = options.ledger || new EvidenceTruthLedger();
  }

  /**
   * Ingests, correlates, reconciles, diagnoses, and seals a business request.
   * Zero overhead on live synchronous transactions.
   */
  processRequestJourney({
    traceId,
    rawHops = [],
    asyncHops = [],
    goldenBaseline = null,
    financialContext = { operationType: "PAYMENT_CHECKOUT", technicalStatus: "FAILED", affectedTransactionsCount: 1000, averageCartValue: 500, currency: "USD" }
  }) {
    // 1. Deduplication
    const dedupResult = DuplicateDetector.deduplicateEnvelopes(rawHops);
    const uniqueHops = dedupResult.uniqueEnvelopes;

    // 2. Multi-Level Identity Resolution across consecutive hops
    let highestIdentityLevel = "LEVEL_1_EXACT";
    for (let i = 0; i < uniqueHops.length - 1; i++) {
      const match = IdentityResolver.matchIdentity(uniqueHops[i], uniqueHops[i + 1]);
      if (!match.matched) {
        highestIdentityLevel = "LEVEL_3_TOPOLOGY";
      }
    }

    // 3. Temporal Ordering & Network Invariants
    const orderedHops = TemporalCorrelator.orderCausalSequence(uniqueHops);
    const temporalValidation = TemporalCorrelator.validateCausality(orderedHops);
    const totalObservedDurationMs = orderedHops.reduce((sum, h) => sum + (h.measurements?.observedDurationMs || 0), 0);

    // 4. Asynchronous Boundary Stitching (e.g. MQ pub/sub or batch workers)
    const mqHop = uniqueHops.find(h => h.component?.type === "MESSAGE_BROKER" || h.component?.name?.includes("MQ"));
    const asyncStitching = AsyncBoundaryCorrelator.correlateMessageHop({
      producerEnvelope: uniqueHops.find(h => h.component?.type === "WEBSPHERE" || h.component?.name?.includes("WebSphere")),
      consumerEnvelope: asyncHops[0] || mqHop,
      queueMetrics: { queueDepth: mqHop?.measurements?.queueDepth || 0, waitDurationMs: mqHop?.event?.durationMs || 12 }
    });

    // 5. Conflict Resolution across sensor reports
    const conflictResolution = ConflictResolver.detectConflicts(uniqueHops);

    // 6. Typed Semantic Evidence Graph Construction
    const evidenceGraph = new EvidenceGraph();
    evidenceGraph.addNode(traceId, "REQUEST", { state: totalObservedDurationMs > 200 ? "DEGRADED" : "NOMINAL" });
    
    uniqueHops.forEach(env => {
      evidenceGraph.addNode(env.component.name, "COMPONENT", env.component);
      if (env.event.status === "FAILED") {
        evidenceGraph.addEdge(traceId, "BLOCKED_BY", env.component.name, { durationMs: env.event.durationMs });
      } else {
        evidenceGraph.addEdge(traceId, "OBSERVED_AT", env.component.name, { durationMs: env.event.durationMs });
      }
    });

    // 7. Causal Intelligence & Contrastive "Why Not?" Elimination
    const causalAssessment = CausalIntelligenceEngine.evaluateCausality({
      traceId,
      envelopes: uniqueHops,
      conflictCount: conflictResolution.conflictCount
    });

    // 8. Correlation Quality Scoring
    const qualityScore = CorrelationQuality.evaluateTruthStatus({
      envelopes: uniqueHops,
      expectedHopCount: 10,
      hasConflicts: conflictResolution.hasConflicts,
      isCausallyConsistent: temporalValidation.isCausallyConsistent,
      identityMatchLevel: highestIdentityLevel,
      causalConfidence: causalAssessment.confidence
    });

    // 9. Financial Lineage & Business Impact Assessment
    const isFailedJourney = uniqueHops.some(h => h.event.status === "FAILED" || h.event.status === "DEGRADED") || causalAssessment.classification === "INFERRED";
    const businessImpact = BusinessImpactEvaluator.evaluate({
      traceId,
      operationType: financialContext.operationType || "PAYMENT_CHECKOUT",
      technicalStatus: isFailedJourney ? "FAILED" : "HEALTHY",
      affectedTransactionsCount: financialContext.affectedTransactionsCount || 1000,
      averageCartValue: financialContext.averageCartValue || 500,
      currency: financialContext.currency || "USD"
    });

    // 10. Cryptographic Merkle Truth Ledger Sealing
    const ledgerBlock = this.ledger.recordConclusion({
      traceId,
      primaryHypothesis: causalAssessment.statement,
      confidence: causalAssessment.confidence,
      supportingEvidence: causalAssessment.supportingEvidence,
      contradictingEvidence: causalAssessment.contradictingEvidence || [],
      provenance: causalAssessment.classification,
      sourceTelemetry: {
        totalObservedDurationMs,
        hopCount: uniqueHops.length,
        overallTruthStatus: qualityScore.overallTruthStatus,
        financialRiskUsd: businessImpact.financialExposure.estimatedAtRisk
      }
    });

    return {
      traceId,
      status: causalAssessment.status,
      epistemicClassification: causalAssessment.classification,
      causalAssessment,
      qualityScore,
      businessImpact,
      temporalValidation,
      asyncStitching,
      conflictResolution,
      ledgerBlock,
      evidenceGraph: evidenceGraph.toJSON()
    };
  }

  /**
   * Simulates and validates post-fix remediation against the pre-fix state
   */
  verifyRemediation({ traceId, preFixEnvelopes, remediationAction, goldenBaseline }) {
    return ReplayRecoveryVerifier.simulateAndVerifyRecovery({
      traceId,
      preFixEnvelopes,
      remediationAction,
      goldenBaseline
    });
  }
}

module.exports = { RequestTruthOrchestrator };
