'use strict';
/** Opt-in fetch instrumentation for JS runtimes. No app routes or technology names.
 * The caller supplies secure random bytes, routing allowlist, clock and exporter.
 * No URL, body, token or headers are exported. Existing tracing is never overwritten.
 */
function createFetchObserver({ fetch: originalFetch, randomBytes, now = Date.now, select, emit, serviceName, onGap = () => {} }) {
  if (typeof originalFetch !== 'function' || typeof randomBytes !== 'function' || typeof select !== 'function' || typeof emit !== 'function' || !serviceName) throw Error('Fetch observer requires fetch, secure RNG, selector, exporter and service name');
  const gap = reason => { try { onGap(reason); } catch (_) {} };
  const id = size => {
    const bytes = randomBytes(size);
    if (!bytes || bytes.length !== size || !Array.from(bytes).every(b => Number.isInteger(b) && b >= 0 && b <= 255)) throw Error('Invalid RNG output');
    const value = Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    if (/^0+$/.test(value)) throw Error('Zero trace identity');
    return value;
  };
  return async function observedFetch(input, options) {
    let selection, headers, traceId, spanId;
    try {
      // Request objects/streams need a separate adapter; do not consume their body.
      if (typeof input !== 'string') { gap('UNSUPPORTED_REQUEST_OBJECT'); return originalFetch(input, options); }
      selection = select(input, options || {});
      if (!selection || typeof selection.spanName !== 'string') return originalFetch(input, options);
      headers = new Headers(options?.headers || {});
      if (headers.has('traceparent') || headers.has('tracestate')) { gap('EXISTING_TRACE_CONTEXT_PRESERVED'); return originalFetch(input, options); }
      traceId = id(16); spanId = id(8);
      headers.set('traceparent', `00-${traceId}-${spanId}-01`);
    } catch (_) { gap('INSTRUMENTATION_SETUP_UNKNOWN'); return originalFetch(input, options); }
    const start = now();
    let status, failed = false;
    try {
      const response = await originalFetch(input, { ...(options || {}), headers });
      status = response.status;
      return response;
    } catch (error) { failed = true; throw error; }
    finally {
      try {
        const end = now();
        const attributes = [{ key: 'http.request.method', value: { stringValue: String(options?.method || 'GET').toUpperCase() } }];
        if (Number.isInteger(status)) attributes.push({ key: 'http.response.status_code', value: { intValue: status } });
        const payload = { resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
          scopeSpans: [{ scope: { name: 'vitalis.opt-in-fetch-observer', version: '1' }, spans: [{ traceId, spanId, kind: 3, name: selection.spanName,
            startTimeUnixNano: String(start) + '000000', endTimeUnixNano: String(end) + '000000',
            attributes, status: { code: failed || status >= 400 ? 2 : 1 } }] }] }] };
        // Export completion never delays the application response. The exporter
        // is responsible for bounded queues/retries; failures are visible gaps.
        Promise.resolve(emit(payload)).catch(() => gap('EXPORT_FAILED'));
      } catch (_) { gap('EXPORT_FAILED'); }
    }
  };
}
module.exports = { createFetchObserver };
