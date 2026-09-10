'use strict';

// Equality of retained, sanitized evidence only. Discarded OTLP fields and sender
// trust are outside this contract. Keep ordered value arrays and duplicate attrs.
const canonical = value => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

function observationKey(span) {
  const { receivedAt, observedAt, ...evidence } = span;
  if (Array.isArray(evidence.attributes)) {
    evidence.attributes = [...evidence.attributes].sort((a, b) => {
      const left = canonical(a), right = canonical(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
  return canonical(evidence);
}

function selectNewObservations(traces, entries) {
  const indexes = new Map(), additions = [];
  let duplicateSpans = 0, conflictingSpans = 0;
  for (const entry of entries) {
    if (!indexes.has(entry.traceId)) {
      const index = new Map();
      for (const span of traces.get(entry.traceId) || []) {
        if (!index.has(span.spanId)) index.set(span.spanId, new Set());
        index.get(span.spanId).add(observationKey(span));
      }
      indexes.set(entry.traceId, index);
    }
    const index = indexes.get(entry.traceId), key = observationKey(entry.span);
    const variants = index.get(entry.span.spanId) || new Set();
    if (variants.has(key)) { duplicateSpans++; continue; }
    if (variants.size) conflictingSpans++;
    variants.add(key); index.set(entry.span.spanId, variants); additions.push(entry);
  }
  return { additions, duplicateSpans, conflictingSpans };
}

module.exports = { observationKey, selectNewObservations };
