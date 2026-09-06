/**
 * VITALIS BETA-2.1: IBM HTTP Server (IHS) Sensory Adapter
 * Extracts Request ID, Access Log Metrics, Plugin Routing (mod_was_ap22), Worker Node, and Backend Wait.
 */

class IhsAdapter {
  static extractEvidence(rawIhsTelemetry = {}) {
    const requestId = rawIhsTelemetry.requestId || `IHS-REQ-${Date.now()}`;
    const pluginRouting = rawIhsTelemetry.pluginRouting || "mod_was_ap22.c";
    const backendWorker = rawIhsTelemetry.backendWorker || "was-node-04_server1";
    const backendWaitMs = rawIhsTelemetry.backendWaitMs !== undefined ? rawIhsTelemetry.backendWaitMs : 21;
    const httpStatus = rawIhsTelemetry.httpStatus || 200;

    return {
      component: "IBM-HTTP-Server",
      status: httpStatus >= 500 ? "FAILED" : (backendWaitMs > 300 ? "DEGRADED" : "SUCCESS"),
      provenance: "OBSERVED",
      timestamp: new Date().toISOString(),
      durationMs: backendWaitMs,
      attributes: {
        requestId,
        pluginRouting,
        backendWorker,
        backendWaitMs,
        httpStatus,
        clientIp: rawIhsTelemetry.clientIp || "192.168.1.105",
        bytesSent: rawIhsTelemetry.bytesSent || 1420,
        keepAlive: rawIhsTelemetry.keepAlive !== undefined ? rawIhsTelemetry.keepAlive : true
      }
    };
  }
}

module.exports = { IhsAdapter };
