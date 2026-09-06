/**
 * VITALIS BETA: Request Truth Index (RTI) & Epistemic Trust Model
 * Encapsulates:
 * 1. 7-Dimension Request Truth Index (RTI) with Granular Dimensional Contracts
 * 2. 7-Stage Epistemic Trust Provenance (OBSERVED -> CORRELATED -> INFERRED -> RECOMMENDED -> APPROVED -> EXECUTED -> VERIFIED)
 * 3. Source Type Tagging (REAL, SYNTHETIC, REPLAY, INFERRED, LEARNED)
 */

const EPISTEMIC_STAGES = {
  OBSERVED: "OBSERVED",       // Direct telemetry facts
  CORRELATED: "CORRELATED",   // Joined via W3C TraceContext
  INFERRED: "INFERRED",       // Causal reasoning from Evidence Graph
  RECOMMENDED: "RECOMMENDED", // Action proposal based on blast radius
  APPROVED: "APPROVED",       // Cryptographically signed human authorization
  EXECUTED: "EXECUTED",       // Physical mitigation command dispatched
  VERIFIED: "VERIFIED"        // Confirmed return to Golden Baseline
};

const SOURCE_TYPES = {
  REAL: "REAL",             // Production user traffic
  SYNTHETIC: "SYNTHETIC",   // Pre-market Start-of-Day (SOD) pulses
  REPLAY: "REPLAY",         // Incident test replays
  INFERRED: "INFERRED",     // Causal engine deductions
  LEARNED: "LEARNED"        // Golden Path baseline profiles
};

class RequestTruthModel {
  static computeRTI(dimensions) {
    const {
      structural = 100,
      performance = 99.2,
      semantic = 100,
      dependency = 98.4,
      infrastructure = 99.0,
      change = 100,
      causal = 96.0
    } = dimensions;

    const rawAverage = (structural + performance + semantic + dependency + infrastructure + change + causal) / 7;
    return parseFloat(rawAverage.toFixed(1));
  }

  static getDimensionalContract(journeyName = "Payments & Checkout") {
    const dimensions = {
      structural: { score: 100, confidence: 99.0, evidence_count: 8, coverage_gap: "0%", last_updated: "21:30:00 UTC", source_types: ["REAL", "LEARNED"] },
      performance: { score: 99.2, confidence: 98.0, evidence_count: 14, coverage_gap: "0.8% async queue wait", last_updated: "21:30:00 UTC", source_types: ["REAL"] },
      semantic: { score: 100, confidence: 99.0, evidence_count: 6, coverage_gap: "0%", last_updated: "21:30:00 UTC", source_types: ["REAL"] },
      dependency: { score: 98.4, confidence: 95.0, evidence_count: 12, coverage_gap: "1.6% external gateway retry", last_updated: "21:30:00 UTC", source_types: ["REAL"] },
      infrastructure: { score: 99.0, confidence: 97.0, evidence_count: 24, coverage_gap: "1.0% kernel socket stats", last_updated: "21:30:00 UTC", source_types: ["REAL", "eBPF"] },
      change: { score: 100, confidence: 96.0, evidence_count: 4, coverage_gap: "0%", last_updated: "21:30:00 UTC", source_types: ["REAL", "GIT"] },
      causal: { score: 96.0, confidence: 91.0, evidence_count: 9, coverage_gap: "4.0% lock escalation log", last_updated: "21:30:00 UTC", source_types: ["INFERRED"] }
    };

    const overallRti = this.computeRTI({
      structural: dimensions.structural.score,
      performance: dimensions.performance.score,
      semantic: dimensions.semantic.score,
      dependency: dimensions.dependency.score,
      infrastructure: dimensions.infrastructure.score,
      change: dimensions.change.score,
      causal: dimensions.causal.score
    });

    return {
      journeyName,
      overallRti,
      dimensions
    };
  }

  static getJourneyRTI() {
    const journeys = [
      { name: "Payments & Checkout", weight: 0.40, structural: 100, performance: 99.2, semantic: 100, dependency: 98.4, infrastructure: 99.0, change: 100, causal: 96.0 },
      { name: "User Authentication", weight: 0.30, structural: 100, performance: 98.4, semantic: 100, dependency: 97.2, infrastructure: 98.0, change: 100, causal: 96.2 },
      { name: "Catalog & Orders", weight: 0.20, structural: 100, performance: 99.0, semantic: 100, dependency: 98.0, infrastructure: 98.5, change: 100, causal: 95.0 },
      { name: "Statements & Reports", weight: 0.10, structural: 94.0, performance: 91.2, semantic: 92.0, dependency: 90.0, infrastructure: 93.0, change: 95.0, causal: 87.0 }
    ];

    let weightedSum = 0;
    const computedJourneys = journeys.map(j => {
      const rti = this.computeRTI(j);
      weightedSum += rti * j.weight;
      return { ...j, rti };
    });

    return {
      overallWeightedRTI: parseFloat(weightedSum.toFixed(1)),
      journeys: computedJourneys
    };
  }

  static createEpistemicEvidence(rawObservation, traceId) {
    return {
      traceId,
      timestamp: new Date().toISOString(),
      stages: {
        observed: {
          status: EPISTEMIC_STAGES.OBSERVED,
          sourceType: SOURCE_TYPES.REAL,
          data: rawObservation
        },
        correlated: {
          status: EPISTEMIC_STAGES.CORRELATED,
          w3cTraceparent: `00-4bf92f3577b34da6a3ce929d0e0e4736-${traceId.substring(0, 8)}-01`
        },
        inferred: {
          status: EPISTEMIC_STAGES.INFERRED,
          sourceType: SOURCE_TYPES.INFERRED,
          confidence: 93.7,
          hypothesis: "DB2 Lock Contention & Connection Pool Saturation"
        },
        recommended: {
          status: EPISTEMIC_STAGES.RECOMMENDED,
          action: "Terminate lock PID #99142 & scale read replica pool",
          risk: "LOW"
        }
      }
    };
  }
}

module.exports = { RequestTruthModel, EPISTEMIC_STAGES, SOURCE_TYPES };
