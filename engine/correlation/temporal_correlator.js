/**
 * VITALIS BETA-2.3: Temporal Normalizer & Causality Correlator
 * Sorts out-of-order telemetry, adjusts for clock skew, and validates causal ordering.
 */

class TemporalCorrelator {
  static normalizeTimestamps(envelopes = [], clockOffsets = {}) {
    return envelopes.map(env => {
      const componentName = env.component?.name || "DEFAULT";
      const offsetMs = clockOffsets[componentName] || 0;
      const rawTimestamp = new Date(env.event?.timestamp || Date.now()).getTime();
      const adjustedTimestamp = new Date(rawTimestamp - offsetMs).toISOString();

      return {
        ...env,
        event: {
          ...env.event,
          rawTimestamp: env.event?.timestamp,
          timestamp: adjustedTimestamp,
          clockOffsetMs: offsetMs
        }
      };
    });
  }

  static orderCausalSequence(envelopes = []) {
    // Expected physical pipeline ordering precedence
    const stagePrecedence = {
      "CLIENT-BROWSER": 1,
      "BROWSER": 1,
      "CLIENT": 1,
      "DNS-RESOLVER": 2,
      "DNS": 2,
      "PERIMETER-FIREWALL": 3,
      "FIREWALL": 3,
      "F5-BIG-IP": 4,
      "F5": 4,
      "LOAD_BALANCER": 4,
      "IBM-HTTP-SERVER": 5,
      "IHS": 5,
      "WEB_SERVER": 5,
      "WEBSPHERE-COREAPP": 6,
      "WEBSPHERE": 6,
      "APP_SERVER": 6,
      "IBM-MQ-SERIES": 7,
      "IBM-MQ": 7,
      "MESSAGE_BROKER": 7,
      "IBM-DB2-CLUSTER": 8,
      "DB2": 8,
      "DATABASE": 8,
      "EXTERNAL-PAYMENT-GATEWAY": 9,
      "STRIPE-GATEWAY": 9,
      "EXTERNAL_GATEWAY": 9,
      "RETURN-JOURNEY-EGRESS": 10,
      "RETURN-EGRESS": 10,
      "CLIENT_RETURN": 10
    };

    return [...envelopes].sort((a, b) => {
      const typeA = (a.component?.type || a.component?.name || "").toUpperCase();
      const typeB = (b.component?.type || b.component?.name || "").toUpperCase();
      const precA = stagePrecedence[typeA] || 50;
      const precB = stagePrecedence[typeB] || 50;

      if (precA !== precB) {
        return precA - precB;
      }

      const timeA = new Date(a.event?.timestamp).getTime();
      const timeB = new Date(b.event?.timestamp).getTime();
      return timeA - timeB;
    });
  }

  static validateCausality(orderedEnvelopes = []) {
    const causalityViolations = [];
    for (let i = 0; i < orderedEnvelopes.length - 1; i++) {
      const curr = orderedEnvelopes[i];
      const next = orderedEnvelopes[i + 1];
      const tCurr = new Date(curr.event.timestamp).getTime();
      const tNext = new Date(next.event.timestamp).getTime();

      // If next hop started significantly before current hop completed (allowing 5ms network tolerance)
      if (tNext < tCurr - 50) {
        causalityViolations.push({
          sourceHop: curr.component.name,
          targetHop: next.component.name,
          deltaMs: tNext - tCurr,
          reason: `Potential clock skew or causality reversal between ${curr.component.name} and ${next.component.name}`
        });
      }
    }

    return {
      isCausallyConsistent: causalityViolations.length === 0,
      violations: causalityViolations
    };
  }
}

module.exports = { TemporalCorrelator };
