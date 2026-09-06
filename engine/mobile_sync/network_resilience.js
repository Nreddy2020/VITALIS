/**
 * MOBILE BETA-1: Network Failure & Resiliency Simulator
 * Simulates transient failures, DNS errors, socket timeouts, and recovery reconnection.
 */

class NetworkResilienceManager {
  constructor() {
    this.networkState = "ONLINE"; // "ONLINE", "OFFLINE", "SLOW_NETWORK", "DNS_FAILURE", "SERVER_503"
    this.rttLatencyMs = 25;
  }

  setNetworkState(state, rttMs = 25) {
    this.networkState = state;
    this.rttLatencyMs = rttMs;
  }

  executeRequest(apiCallFn) {
    if (this.networkState === "OFFLINE") {
      throw new Error("NETWORK_UNAVAILABLE: Device has no active internet connection");
    }

    if (this.networkState === "DNS_FAILURE") {
      throw new Error("DNS_RESOLUTION_ERROR: Failed to resolve api.enterprise.corp");
    }

    if (this.networkState === "SERVER_503") {
      throw new Error("HTTP_503_SERVICE_UNAVAILABLE: Upstream gateway temporary overload");
    }

    if (this.networkState === "TIMEOUT") {
      throw new Error("SOCKET_TIMEOUT: Request exceeded 10000ms threshold");
    }

    return apiCallFn();
  }
}

module.exports = { NetworkResilienceManager };
