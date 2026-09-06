# 🏗️ VITALIS BETA-2 Master Implementation & Engineering Plan
## The Real Enterprise Evidence Pipeline: From Request Birth to Cryptographic Truth

> **Mission:** Transform VITALIS from a verified Beta Reference Brain (~35–45% overall maturity) into a production-grade Request Truth Platform with real sensory adapters, true SHA-256 hash chaining, 14-point technical request identity, and end-to-end heterogeneous evidence collection.

---

## 📊 1. File-by-File Codebase Mapping & Implementation Status

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          VITALIS BETA-2 FILE ARCHITECTURE                              │
├─────────────────────────────────────┬──────────────┬───────────────────────────────────┤
│ File / Module Path                  │ Layer        │ Beta-2 Target Responsibility      │
├─────────────────────────────────────┼──────────────┼───────────────────────────────────┤
│ engine/evidence_ledger.js           │ Brain/Ledger │ ✅ REAL SHA-256 + Merkle Chaining │
│ engine/dynamic_rca_engine.js        │ Brain/RCA    │ ✅ Generalized Multi-Factor Model │
│ engine/truth_model.js               │ Truth/RTI    │ 14-Point Technical Request DNA    │
│ engine/replay_engine.js             │ Replay       │ Multi-Tier Sandbox Simulator      │
│ engine/remediation_state_machine.js │ Action       │ Precondition-Guarded State Flow   │
│ engine/privacy_sanitizer.js         │ Security     │ Structured AST / SQL Tokenizer    │
│ engine/change_intelligence.js       │ Lineage      │ Git/CI/CD Webhook & CMDB Ingestion│
│ engine/cardinality_indexer.js       │ Storage      │ Multi-Tier Index Partitioning     │
│                                     │              │                                   │
│ [NEW] engine/adapters/browser.js    │ Sensory      │ W3C TraceContext & Client RUM     │
│ [NEW] engine/adapters/dns.js        │ Sensory      │ DNS Query/Response & Latency      │
│ [NEW] engine/adapters/ebpf.js       │ Sensory      │ Socket RTT, TCP Retransmits, PID  │
│ [NEW] engine/adapters/f5.js         │ Sensory      │ VIP, Pool, SNI, WAF Decision      │
│ [NEW] engine/adapters/ihs.js        │ Sensory      │ Plugin Routing & Backend Wait     │
│ [NEW] engine/adapters/websphere.js  │ Sensory      │ JVM Thread, JDBC Pool, MQ Binding │
│ [NEW] engine/adapters/mq.js         │ Sensory      │ Queue Depth, Channel, MsgID       │
│ [NEW] engine/adapters/db2.js        │ Sensory      │ SQL Fingerprint, Locks, Plan Cost │
│ [NEW] engine/adapters/external.js   │ Sensory      │ TLS Handshake, External Gateway   │
│                                     │              │                                   │
│ server.js                           │ Ingest/API   │ OTLP HTTP + gRPC Protobuf Engine  │
│ tests/beta_2_real_pipeline.js       │ Verification │ End-to-End Real Evidence Suite    │
└─────────────────────────────────────┴──────────────┴───────────────────────────────────┘
```

---

## 🎯 2. The 14-Point Technical Request Identity Model

To bridge the gap between abstract span hops and physical reality, `RequestDNA` is expanded to capture the complete 14-point technical fingerprint:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                  THE 14-POINT TECHNICAL REQUEST DNA ENVELOPE                │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Client & Browser:  User Agent, Viewport, Device, HTTP/2 Stream ID        │
│ 2. Network Origin:    Source IP, Source Port, Geo-Edge Location             │
│ 3. DNS Resolution:    Resolver IP, Query Latency (1.2ms), TTL, DNSSEC       │
│ 4. TLS Handshake:     TLS 1.3, Cipher Suite, SNI Header, Cert Fingerprint   │
│ 5. Perimeter Security:WAF Decision (PASS), IPS Rule Version, Rate Limit Tier│
│ 6. Load Balancer (F5):VIP Address, Virtual Server, Pool, Selected Member   │
│ 7. Web Server (IHS):  Mod_was_ap22 Plugin Routing, Backend Worker Node      │
│ 8. App Server (WAS):  Thread ID (#142), JVM Heap %, JDBC Connection Handle  │
│ 9. Message Bus (MQ):  Queue Manager, Queue Depth, Message ID, Correl ID     │
│ 10. Database (DB2):   SQL Fingerprint, Lock Wait PID, Buffer Pool Hit %     │
│ 11. External API:     Endpoint URI, TLS Egress, Idempotency Key, HTTP Code  │
│ 12. Return Journey:   Egress Compression, Content-Type, Header Preservation │
│ 13. Temporal Lineage: Hop-by-Hop Clock Offset & Microsecond Delta Lineage   │
│ 14. Epistemic Audit:  Cryptographic Block Hash in Evidence Truth Ledger     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛡️ 3. Five-Phase Implementation Roadmap

### Phase 1: Core Trust & Cryptographic Fixes (COMPLETED)
- [x] Replace pseudorandom hash with **real SHA-256 Merkle hash-chaining** in `engine/evidence_ledger.js`.
- [x] Implement `verifyLedgerIntegrity()` for mathematical tamper-detection.
- [x] Remove hardcoded RCA scenario assumptions in `engine/dynamic_rca_engine.js`.
- [x] Formalize all evidence outputs into `[OBSERVED]`, `[CORRELATED]`, and `[INFERRED]`.

### Phase 2: The Enterprise Sensory Adapter Layer (`engine/adapters/`)
- [ ] Build `engine/adapters/f5.js` for VIP, Pool, SNI, and WAF telemetry.
- [ ] Build `engine/adapters/db2.js` for SQL fingerprinting, lock queue inspection, and pool saturation.
- [ ] Build `engine/adapters/websphere.js` for thread pool wait times and JDBC leaks.
- [ ] Build `engine/adapters/ebpf.js` for kernel socket RTT and process hierarchy.

### Phase 3: Production Ingestion & Streaming Fabric
- [ ] Add gRPC Protobuf ingestion on port 4317 (`/opentelemetry.proto.collector.trace.v1.TraceService`).
- [ ] Implement Kafka / stream partitioning queue for 100K spans/sec durability.
- [ ] Implement ClickHouse columnar analytical schema for sub-second query across billions of spans.

### Phase 4: Failure Laboratory Real Validation (20 Scenarios)
- [ ] Test 1: Blind DNS timeout & NXDOMAIN failover.
- [ ] Test 2: F5 pool member health-check flap.
- [ ] Test 3: Unindexed batch query lock contention on DB2.
- [ ] Test 4: WebSphere thread pool starvation post-deploy.
- [ ] Test 5: TLS certificate intermediate expiry.

### Phase 5: Verified Production Pilot
- [ ] Deploy VITALIS Out-of-Band sidecar agent.
- [ ] Validate 0.00% production latency disruption under real enterprise load.
- [ ] Execute human-approved closed-loop runbooks with automated rollback.
