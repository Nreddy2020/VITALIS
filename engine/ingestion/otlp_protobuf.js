/**
 * VITALIS: OTLP/protobuf trace decoder
 *
 * WHY THIS EXISTS
 *
 * The project's central architectural claim is that VITALIS ingests standard
 * OTLP and therefore needs no agent of its own — Tier A, zero adapter (`02`),
 * and the whole "additive layer, not a replacement" positioning in `03` §5.
 *
 * That claim was only ever true for senders that emit OTLP as JSON.
 *
 * `server.js` accumulated the request body as a STRING and `JSON.parse`d it.
 * The OpenTelemetry SDKs for Python, Java, Go and .NET, and the OpenTelemetry
 * Collector, all default to `http/protobuf`. Every one of them received HTTP
 * 400 and dropped its spans on the floor. Verified by running a real FastAPI
 * application under `opentelemetry-instrument`: `Failed to export span batch
 * code: 400, reason: Bad Request`.
 *
 * So the "works with any technology" claim had a JavaScript-shaped hole in it,
 * for the same reason as the drift engine did (`19`) — everything had been
 * proven with JavaScript senders.
 *
 * WHY HAND-WRITTEN
 *
 * The protobuf wire format is small and stable, and pulling in a protobuf
 * runtime plus the OTLP .proto files is a large dependency for one message
 * type. This decoder handles exactly the OTLP trace schema and is verified
 * against REAL bytes emitted by the real Python OpenTelemetry SDK — not
 * synthetic fixtures — so the thing it is tested against is the thing it will
 * meet in production.
 *
 * It fails closed. Anything malformed throws, and `server.js` reports the
 * encoding problem specifically rather than a generic parse failure, because
 * "your spans are silently vanishing" is the worst possible failure for an
 * observability tool.
 *
 * OUTPUT: the same shape the OTLP/JSON path produces, so ingestion downstream
 * is identical and neither path is privileged.
 *
 * Field numbers are from opentelemetry-proto v1 (trace/v1/trace.proto,
 * common/v1/common.proto, resource/v1/resource.proto).
 */

const WIRE = { VARINT: 0, FIXED64: 1, LEN: 2, FIXED32: 5 };

class Reader {
  constructor(buf, start = 0, end = buf.length) {
    this.buf = buf; this.pos = start; this.end = end;
  }
  get eof() { return this.pos >= this.end; }

  varint() {
    let result = 0n, shift = 0n;
    while (true) {
      if (this.pos >= this.end) throw new Error('protobuf: truncated varint');
      const b = this.buf[this.pos++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7n;
      if (shift > 70n) throw new Error('protobuf: varint too long');
    }
    return result;
  }
  fixed64() {
    if (this.pos + 8 > this.end) throw new Error('protobuf: truncated fixed64');
    const v = this.buf.readBigUInt64LE(this.pos); this.pos += 8; return v;
  }
  fixed32() {
    if (this.pos + 4 > this.end) throw new Error('protobuf: truncated fixed32');
    const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v;
  }
  double() {
    if (this.pos + 8 > this.end) throw new Error('protobuf: truncated double');
    const v = this.buf.readDoubleLE(this.pos); this.pos += 8; return v;
  }
  bytes() {
    const len = Number(this.varint());
    if (this.pos + len > this.end) throw new Error('protobuf: length-delimited field overruns buffer');
    const b = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return b;
  }
  /** Skip a field of the given wire type. Unknown fields must not break decoding. */
  skip(wireType) {
    if (wireType === WIRE.VARINT) this.varint();
    else if (wireType === WIRE.FIXED64) this.pos += 8;
    else if (wireType === WIRE.LEN) this.bytes();
    else if (wireType === WIRE.FIXED32) this.pos += 4;
    else throw new Error(`protobuf: unsupported wire type ${wireType}`);
    if (this.pos > this.end) throw new Error('protobuf: skip overran buffer');
  }
}

/** Iterate (fieldNumber, wireType, reader) over a message body. */
function* fields(reader) {
  while (!reader.eof) {
    const key = Number(reader.varint());
    yield { field: key >>> 3, wire: key & 0x7 };
  }
}

/**
 * Nanosecond timestamps exceed Number.MAX_SAFE_INTEGER, so a naive Number()
 * loses precision. Preserve decimal strings, matching the OTLP/JSON uint64
 * representation. The ingestion layer validates before subtracting with BigInt.
 */
const nanosToDecimal = (big) => big.toString();

function decodeAnyValue(buf) {
  const r = new Reader(buf);
  for (const { field, wire } of fields(r)) {
    switch (field) {
      case 1: if (wire !== WIRE.LEN) { r.skip(wire); break; } return { stringValue: r.bytes().toString('utf8') };
      case 2: if (wire !== WIRE.VARINT) { r.skip(wire); break; } return { boolValue: r.varint() !== 0n };
      // OTLP/JSON encodes int64 as a string; matched here so both paths agree.
      case 3: if (wire !== WIRE.VARINT) { r.skip(wire); break; } return { intValue: BigInt.asIntN(64, r.varint()).toString() };
      case 4: if (wire !== WIRE.FIXED64) { r.skip(wire); break; } return { doubleValue: r.double() };
      case 5: if (wire !== WIRE.LEN) { r.skip(wire); break; } return { arrayValue: decodeArrayValue(r.bytes()) };
      case 6: if (wire !== WIRE.LEN) { r.skip(wire); break; } return { kvlistValue: { values: decodeKeyValues(r.bytes()) } };
      case 7: if (wire !== WIRE.LEN) { r.skip(wire); break; } return { bytesValue: r.bytes().toString('base64') };
      default: r.skip(wire);
    }
  }
  return {};
}

function decodeArrayValue(buf) {
  const r = new Reader(buf); const values = [];
  for (const { field, wire } of fields(r)) {
    if (field === 1 && wire === WIRE.LEN) values.push(decodeAnyValue(r.bytes()));
    else r.skip(wire);
  }
  return { values };
}

function decodeKeyValue(buf) {
  const r = new Reader(buf); const out = { key: '', value: {} };
  for (const { field, wire } of fields(r)) {
    if (field === 1 && wire === WIRE.LEN) out.key = r.bytes().toString('utf8');
    else if (field === 2 && wire === WIRE.LEN) out.value = decodeAnyValue(r.bytes());
    else r.skip(wire);
  }
  return out;
}

/** repeated KeyValue inside a wrapper message. */
function decodeKeyValues(buf) {
  const r = new Reader(buf); const out = [];
  for (const { field, wire } of fields(r)) {
    if (field === 1 && wire === WIRE.LEN) out.push(decodeKeyValue(r.bytes()));
    else r.skip(wire);
  }
  return out;
}

function decodeResource(buf) {
  const r = new Reader(buf); const attributes = [];
  for (const { field, wire } of fields(r)) {
    if (field === 1 && wire === WIRE.LEN) attributes.push(decodeKeyValue(r.bytes()));
    else r.skip(wire);
  }
  return { attributes };
}

function decodeStatus(buf) {
  const r = new Reader(buf); const out = {};
  for (const { field, wire } of fields(r)) {
    if (field === 2 && wire === WIRE.LEN) out.message = r.bytes().toString('utf8');
    else if (field === 3 && wire === WIRE.VARINT) out.code = Number(r.varint());
    else r.skip(wire);
  }
  return out;
}

function decodeSpan(buf) {
  const r = new Reader(buf);
  const span = { attributes: [] };
  for (const { field, wire } of fields(r)) {
    switch (field) {
      case 1: span.traceId = r.bytes().toString('hex'); break;
      case 2: span.spanId = r.bytes().toString('hex'); break;
      case 3: span.traceState = r.bytes().toString('utf8'); break;
      case 4: span.parentSpanId = r.bytes().toString('hex'); break;
      case 5: span.name = r.bytes().toString('utf8'); break;
      case 6: span.kind = Number(r.varint()); break;
      case 7: span.startTimeUnixNano = nanosToDecimal(r.fixed64()); break;
      case 8: span.endTimeUnixNano = nanosToDecimal(r.fixed64()); break;
      case 9: span.attributes.push(decodeKeyValue(r.bytes())); break;
      case 15: span.status = decodeStatus(r.bytes()); break;
      default: r.skip(wire);
    }
  }
  return span;
}

function decodeScopeSpans(buf) {
  const r = new Reader(buf); const spans = [];
  for (const { field, wire } of fields(r)) {
    if (field === 2 && wire === WIRE.LEN) spans.push(decodeSpan(r.bytes()));
    else r.skip(wire);
  }
  return { spans };
}

function decodeResourceSpans(buf) {
  const r = new Reader(buf);
  const out = { resource: { attributes: [] }, scopeSpans: [] };
  for (const { field, wire } of fields(r)) {
    if (field === 1 && wire === WIRE.LEN) out.resource = decodeResource(r.bytes());
    else if (field === 2 && wire === WIRE.LEN) out.scopeSpans.push(decodeScopeSpans(r.bytes()));
    else if (field === 3 && wire === WIRE.LEN) out.schemaUrl = r.bytes().toString('utf8');
    else r.skip(wire);
  }
  return out;
}

/**
 * Decode an ExportTraceServiceRequest into the OTLP/JSON shape.
 * Throws on malformed input — never returns a partial result that would look
 * like a small trace instead of a broken payload.
 */
function decodeExportTraceServiceRequest(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('otlp protobuf: expected a Buffer');
  if (buf.length === 0) throw new Error('otlp protobuf: empty body');
  const r = new Reader(buf);
  const resourceSpans = [];
  for (const { field, wire } of fields(r)) {
    if (field === 1 && wire === WIRE.LEN) resourceSpans.push(decodeResourceSpans(r.bytes()));
    else r.skip(wire);
  }
  return { resourceSpans };
}

/** Does this Content-Type indicate OTLP protobuf? */
function isProtobufContentType(contentType) {
  if (!contentType) return false;
  const c = String(contentType).toLowerCase();
  return c.includes('application/x-protobuf') || c.includes('application/protobuf');
}

module.exports = {
  decodeExportTraceServiceRequest,
  isProtobufContentType,
  decodeSpan, decodeAnyValue, decodeKeyValue, Reader, WIRE
};
