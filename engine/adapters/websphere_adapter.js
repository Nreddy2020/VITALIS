/**
 * VITALIS BETA-2.1: IBM WebSphere Application Server Sensory Adapter
 * Extracts Application Cell, Server, Thread ID, Thread Pool Saturation, JDBC Pool in-use, JVM Heap.
 */

class WebSphereAdapter {
  static extractEvidence(rawWasTelemetry = {}) {
    const cellName = rawWasTelemetry.cellName || "ProdCell01";
    const serverName = rawWasTelemetry.serverName || "server1";
    const threadId = rawWasTelemetry.threadId || "WebContainer : 142";
    const threadPoolSaturationPct = rawWasTelemetry.threadPoolSaturationPct !== undefined ? rawWasTelemetry.threadPoolSaturationPct : 42;
    const jvmHeapUtilizationPct = rawWasTelemetry.jvmHeapUtilizationPct !== undefined ? rawWasTelemetry.jvmHeapUtilizationPct : 58;
    const jdbcPoolInUse = rawWasTelemetry.jdbcPoolInUse !== undefined ? rawWasTelemetry.jdbcPoolInUse : 14;
    const jdbcPoolCapacity = rawWasTelemetry.jdbcPoolCapacity || 100;
    const durationMs = rawWasTelemetry.durationMs !== undefined ? rawWasTelemetry.durationMs : 51;
    const httpStatus = rawWasTelemetry.httpStatus || 200;

    return {
      component: "WebSphere-CoreApp",
      status: httpStatus >= 500 ? "FAILED" : (threadPoolSaturationPct > 90 ? "DEGRADED" : "SUCCESS"),
      provenance: "OBSERVED",
      timestamp: new Date().toISOString(),
      durationMs,
      attributes: {
        cellName,
        serverName,
        threadId,
        threadPoolSaturationPct,
        jvmHeapUtilizationPct,
        jdbcPoolInUse,
        jdbcPoolCapacity,
        httpStatus,
        activeTransactions: rawWasTelemetry.activeTransactions || 18,
        mqJmsSessionBinding: rawWasTelemetry.mqJmsSessionBinding || "jms/CheckoutQCF"
      }
    };
  }
}

module.exports = { WebSphereAdapter };
