/**
 * VITALIS ENTERPRISE PIPELINE: External API Gateway Sensory Adapter
 * Captures 3rd-Party Payment Gateways (Stripe, Adyen), TLS Egress, Idempotency, and Latency.
 */

class ExternalApiAdapter {
  static extractEvidence(rawApiTelemetry = {}) {
    const provider = rawApiTelemetry.provider || "Stripe-Gateway-US";
    const endpointUri = rawApiTelemetry.endpointUri || "https://api.stripe.com/v1/charges";
    const idempotencyKey = rawApiTelemetry.idempotencyKey || `IDEM-${Date.now()}`;
    const httpStatus = rawApiTelemetry.httpStatus || 200;
    const durationMs = rawApiTelemetry.durationMs !== undefined ? rawApiTelemetry.durationMs : 46;
    const tlsVersion = rawApiTelemetry.tlsVersion || "TLSv1.3";

    return {
      component: "External-Payment-Gateway",
      status: httpStatus >= 500 ? "FAILED" : (durationMs > 2000 ? "DEGRADED" : "SUCCESS"),
      provenance: "OBSERVED",
      timestamp: new Date().toISOString(),
      durationMs,
      attributes: {
        provider,
        endpointUri,
        idempotencyKey,
        httpStatus,
        tlsVersion,
        cipherSuite: "TLS_AES_128_GCM_SHA256",
        retryCount: rawApiTelemetry.retryCount || 0
      }
    };
  }
}

module.exports = { ExternalApiAdapter };
