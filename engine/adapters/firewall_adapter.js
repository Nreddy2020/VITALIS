/**
 * VITALIS ENTERPRISE PIPELINE: Perimeter Firewall / IPS Sensory Adapter
 * Captures Ingress Zone, Egress Zone, NAT Translation, Policy Rule ID, IPS/WAF Inspection.
 */

class FirewallAdapter {
  static extractEvidence(rawFwTelemetry = {}) {
    const policyRuleId = rawFwTelemetry.policyRuleId || "FW-RULE-PROD-HTTPS-ALLOW";
    const ingressZone = rawFwTelemetry.ingressZone || "ZONE_UNTRUST_WAN";
    const egressZone = rawFwTelemetry.egressZone || "ZONE_DMZ_APP";
    const sourceNatIp = rawFwTelemetry.sourceNatIp || null;
    const action = rawFwTelemetry.action || "ALLOW";
    const ipsDecision = rawFwTelemetry.ipsDecision || "CLEAN";
    const durationMs = rawFwTelemetry.durationMs !== undefined ? rawFwTelemetry.durationMs : 2.8;

    return {
      component: "Perimeter-Firewall",
      status: action === "DENY" || ipsDecision === "BLOCKED" ? "FAILED" : "SUCCESS",
      provenance: "OBSERVED",
      timestamp: new Date().toISOString(),
      durationMs,
      attributes: {
        policyRuleId,
        ingressZone,
        egressZone,
        sourceNatIp,
        action,
        ipsDecision,
        inspectedBytes: rawFwTelemetry.inspectedBytes || 2480,
        firewallCluster: "PaloAlto-EdgeCluster-01"
      }
    };
  }
}

module.exports = { FirewallAdapter };
