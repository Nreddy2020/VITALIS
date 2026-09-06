/**
 * VITALIS BETA-2.2: Enterprise Evidence Graph
 * Maintains semantic typed relationships across Requests, Components, Telemetry Events, and Claims.
 */

class EvidenceGraph {
  constructor() {
    this.nodes = new Map(); // nodeId -> Node
    this.edges = [];        // Array of Edge { from, type, to, metadata, timestamp }
  }

  addNode(id, type, attributes = {}) {
    const node = { id, type, attributes, createdAt: new Date().toISOString() };
    this.nodes.set(id, node);
    return node;
  }

  addEdge(fromId, type, toId, metadata = {}) {
    const validTypes = [
      "OBSERVED_AT",
      "ROUTED_TO",
      "FORWARDED_TO",
      "CALLS",
      "WAITS_FOR",
      "BLOCKED_BY",
      "DEPENDS_ON",
      "RETRIED_BY",
      "TIMED_OUT_AT",
      "CAUSED",
      "CORRELATED_WITH",
      "CHANGED_BY",
      "RECOVERED_AFTER",
      "VERIFIED_BY"
    ];

    const edge = {
      from: fromId,
      type: validTypes.includes(type) ? type : "CORRELATED_WITH",
      to: toId,
      metadata,
      timestamp: new Date().toISOString()
    };

    this.edges.push(edge);
    return edge;
  }

  getNode(id) {
    return this.nodes.get(id);
  }

  getEdgesFrom(nodeId) {
    return this.edges.filter(e => e.from === nodeId);
  }

  getEdgesTo(nodeId) {
    return this.edges.filter(e => e.to === nodeId);
  }

  /**
   * Traverses causal dependencies to reconstruct the forward journey
   * and isolate downstream consequence cascades.
   */
  getCausalChain(requestId) {
    const directEdges = this.edges.filter(e => e.from === requestId || e.to === requestId);
    const blockedEdges = this.edges.filter(e => e.type === "BLOCKED_BY" || e.type === "CAUSED");
    return {
      requestId,
      directEdges,
      causalCascades: blockedEdges
    };
  }

  /**
   * Discovers the primary blockage node in the graph for a given trace
   */
  findRootBlockage(traceId) {
    const blockedEdge = this.edges.find(e => e.type === "BLOCKED_BY" && (e.from.includes(traceId) || e.to.includes(traceId) || e.metadata.traceId === traceId));
    if (blockedEdge) {
      return {
        found: true,
        blockageNode: blockedEdge.to,
        blockedComponent: blockedEdge.from,
        reason: blockedEdge.metadata.reason || "Resource Contention",
        lockPid: blockedEdge.metadata.lockPid || null,
        durationMs: blockedEdge.metadata.durationMs || null
      };
    }
    return { found: false };
  }

  toJSON() {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: [...this.edges]
    };
  }
}

module.exports = { EvidenceGraph };
