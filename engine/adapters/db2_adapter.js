/**
 * VITALIS BETA-2.1: IBM DB2 Database Cluster Sensory Adapter
 * Extracts SQL Fingerprint, Execution Duration, Lock Wait Duration, Holding Lock PID, Connection Pool Saturation, Buffer Pool Hit %.
 */

class Db2Adapter {
  static extractEvidence(rawDb2Telemetry = {}) {
    const sqlFingerprint = rawDb2Telemetry.sqlFingerprint || "SELECT * FROM inventory_items WHERE sku_id = ? FOR UPDATE WITH RR";
    const executionDurationMs = rawDb2Telemetry.executionDurationMs !== undefined ? rawDb2Telemetry.executionDurationMs : 18;
    const lockWaitMs = rawDb2Telemetry.lockWaitMs !== undefined ? rawDb2Telemetry.lockWaitMs : 0;
    const holdingLockPid = rawDb2Telemetry.holdingLockPid || null;
    const connectionPoolSaturationPct = rawDb2Telemetry.connectionPoolSaturationPct !== undefined ? rawDb2Telemetry.connectionPoolSaturationPct : 22;
    const bufferPoolHitRatioPct = rawDb2Telemetry.bufferPoolHitRatioPct !== undefined ? rawDb2Telemetry.bufferPoolHitRatioPct : 99.4;
    const isLockContention = lockWaitMs > 500 || executionDurationMs > 1000;

    return {
      component: "IBM-DB2-Cluster",
      status: isLockContention ? "FAILED" : (executionDurationMs > 200 ? "DEGRADED" : "SUCCESS"),
      provenance: "OBSERVED",
      timestamp: new Date().toISOString(),
      durationMs: executionDurationMs,
      attributes: {
        sqlFingerprint,
        executionDurationMs,
        lockWaitMs,
        holdingLockPid,
        connectionPoolSaturationPct,
        bufferPoolHitRatioPct,
        queryPlanCost: rawDb2Telemetry.queryPlanCost || 142.8,
        tableLockType: holdingLockPid ? "EXCLUSIVE_ROW_LOCK" : "INTENT_SHARE",
        databaseName: rawDb2Telemetry.databaseName || "PROD_BANK_DB2"
      }
    };
  }
}

module.exports = { Db2Adapter };
