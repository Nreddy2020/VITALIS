# Test fixtures

## `otlp_python_real.bin`

**Real OTLP/protobuf bytes**, captured off the wire from a real FastAPI application
running under `opentelemetry-instrument` (opentelemetry-instrumentation 0.65b0,
opentelemetry-sdk 1.44.0, Python), exporting with
`OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf`.

Content-Type as sent: `application/x-protobuf`. 1216 bytes.

It is committed deliberately rather than generated synthetically. A decoder tested
only against bytes it produced itself proves that it is self-consistent, not that
it can read what the OpenTelemetry SDKs actually emit — which is the only property
that matters here.

Regenerate by pointing any OTLP protobuf exporter at a capture server and saving
the raw request body.
