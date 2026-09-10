/**
 * VITALIS: IBM DB2 evidence normalizer (shape only — see db2_live_adapter.js
 * for the adapter that actually talks to a database).
 *
 * This file used to fabricate. Every field had a plausible default —
 * `sqlFingerprint` fell back to an invented SELECT statement, `bufferPoolHitRatioPct`
 * to 99.4, `queryPlanCost` to 142.8, `databaseName` to "PROD_BANK_DB2",
 * `connectionPoolSaturationPct` to 22 — and the result was returned with
 * `provenance: "OBSERVED"`. Called with an empty object it produced a complete,
 * confident, entirely invented picture of a database nobody had looked at.
 *
 * It now reports only what it was actually given. An absent field is omitted,
 * and provenance downgrades to PARTIAL when the input is incomplete, so a caller
 * can never mistake a gap for a measurement.
 */

/** Keep only keys whose value was really supplied. */
function present(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

class Db2Adapter {
  static extractEvidence(rawDb2Telemetry = {}) {
    const r = rawDb2Telemetry || {};

    const executionDurationMs = r.executionDurationMs;
    const lockWaitMs = r.lockWaitMs;
    const holdingLockPid = r.holdingLockPid;

    const attributes = present({
      sqlFingerprint: r.sqlFingerprint,
      executionDurationMs,
      lockWaitMs,
      holdingLockPid,
      connectionPoolSaturationPct: r.connectionPoolSaturationPct,
      bufferPoolHitRatioPct: r.bufferPoolHitRatioPct,
      queryPlanCost: r.queryPlanCost,
      databaseName: r.databaseName,
      // Derived, and only when the fact it derives from was actually observed.
      tableLockType: holdingLockPid !== undefined && holdingLockPid !== null ? 'EXCLUSIVE_ROW_LOCK' : undefined
    });

    // Status can only be judged from evidence that exists.
    let status = 'UNKNOWN';
    if (executionDurationMs !== undefined) {
      const contention = (lockWaitMs !== undefined && lockWaitMs > 500) || executionDurationMs > 1000;
      status = contention ? 'FAILED' : (executionDurationMs > 200 ? 'DEGRADED' : 'SUCCESS');
    }

    // Any absent core field means this is a partial picture, and says so.
    const coreFields = ['executionDurationMs', 'lockWaitMs', 'connectionPoolSaturationPct'];
    const missing = coreFields.filter(f => r[f] === undefined || r[f] === null);

    return {
      component: 'IBM-DB2-Cluster',
      status,
      provenance: missing.length === 0 ? 'OBSERVED' : 'PARTIAL',
      unobserved: missing,
      timestamp: new Date().toISOString(),
      durationMs: executionDurationMs,
      attributes
    };
  }
}

module.exports = { Db2Adapter };
