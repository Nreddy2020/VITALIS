/**
 * VITALIS Beta-3.0: Physical & Logical Topology Resolver
 * Verifies that the reconstructed request conforms to valid enterprise physical paths
 * (e.g. Browser -> DNS -> Firewall -> F5 -> IHS -> WAS -> DB2 -> Return).
 */

class TopologyResolver {
  static getExpectedPath() {
    return [
      "CLIENT",
      "DNS",
      "FIREWALL",
      "LOAD_BALANCER",
      "WEB_SERVER",
      "WEBSPHERE",
      "MESSAGE_BROKER",
      "DB2",
      "EXTERNAL_GATEWAY",
      "CLIENT_RETURN"
    ];
  }

  static validateTopology(envelopes = []) {
    const observedSequence = envelopes.map(e => ({
      name: e.component?.name,
      type: e.component?.type,
      phase: e.event?.phase || "FORWARD"
    }));

    const pathAnomalies = [];
    const db2Index = observedSequence.findIndex(s => s.type === "DB2");
    const wasIndex = observedSequence.findIndex(s => s.type === "WEBSPHERE");
    const f5Index = observedSequence.findIndex(s => s.type === "LOAD_BALANCER");

    // Invariant: DB2 cannot execute before F5 or WAS in forward path
    if (db2Index !== -1 && wasIndex !== -1 && db2Index < wasIndex) {
      pathAnomalies.push({
        type: "TOPOLOGY_INVERSION",
        description: `DB2 (${observedSequence[db2Index].name}) recorded prior to WebSphere in transaction sequence`
      });
    }

    if (wasIndex !== -1 && f5Index !== -1 && wasIndex < f5Index) {
      pathAnomalies.push({
        type: "TOPOLOGY_INVERSION",
        description: `WebSphere (${observedSequence[wasIndex].name}) recorded prior to F5 Load Balancer`
      });
    }

    return {
      isValidTopology: pathAnomalies.length === 0,
      hopCount: observedSequence.length,
      sequence: observedSequence,
      anomalies: pathAnomalies
    };
  }
}

module.exports = { TopologyResolver };
