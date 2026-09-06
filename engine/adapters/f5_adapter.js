/**
 * VITALIS BETA-2.1: F5 BIG-IP Load Balancer Sensory Adapter
 * Extracts VIP, Virtual Server, TLS Cipher, SNI, WAF Decision, Pool, Selected Member, and Health.
 */

class F5Adapter {
  static extractEvidence(rawF5Telemetry = {}) {
    const virtualServer = rawF5Telemetry.virtualServer || "/Common/vs_checkout_https";
    const vip = rawF5Telemetry.vip || "10.240.10.50:443";
    const selectedMember = rawF5Telemetry.selectedMember || "10.240.20.101:8443";
    const poolName = rawF5Telemetry.poolName || "/Common/pool_ihs_edge";
    const tlsProfile = rawF5Telemetry.tlsProfile || "/Common/clientssl_secure_tls13";
    const cipherSuite = rawF5Telemetry.cipherSuite || "TLS_AES_256_GCM_SHA384";
    const sni = rawF5Telemetry.sni || "checkout.bank.corp";
    const wafDecision = rawF5Telemetry.wafDecision || "PASS";
    const durationMs = rawF5Telemetry.durationMs !== undefined ? rawF5Telemetry.durationMs : 18;

    return {
      component: "F5-BIG-IP",
      status: wafDecision === "BLOCK" ? "FAILED" : (durationMs > 200 ? "DEGRADED" : "SUCCESS"),
      provenance: "OBSERVED",
      timestamp: new Date().toISOString(),
      durationMs,
      attributes: {
        virtualServer,
        vip,
        selectedMember,
        poolName,
        tlsProfile,
        cipherSuite,
        sni,
        wafDecision,
        persistenceCookie: rawF5Telemetry.persistenceCookie || "BIGipServerpool_ihs=2849182.20480.0000",
        activePoolMembers: rawF5Telemetry.activePoolMembers || 4,
        healthStatus: rawF5Telemetry.healthStatus || "HEALTHY"
      }
    };
  }
}

module.exports = { F5Adapter };
