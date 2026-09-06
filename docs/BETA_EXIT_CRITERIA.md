# 🏁 VITALIS BETA Exit Criteria (Gates B1 – B10)

> **"A platform is only declared General Availability (GA) when every Beta Exit Gate is objectively passed under real heterogeneous workloads."**

---

## The 10 Beta Exit Gates

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       VITALIS BETA EXIT CRITERIA MATRIX                     │
├─────────┬──────────────────────────┬────────────────────────────────────────┤
│ Gate    │ Capability Area          │ Strict Exit Requirement                │
├─────────┼──────────────────────────┼────────────────────────────────────────┤
│ Gate B1 │ Real Telemetry Fabric    │ Converged OpenTelemetry spans + eBPF   │
│         │                          │ kernel socket & network signals.       │
├─────────┼──────────────────────────┼────────────────────────────────────────┤
│ Gate B2 │ Heterogeneous Enterprise │ Verified end-to-end across F5 ─▶ IHS   │
│         │ Stack                    │ ─▶ WebSphere ─▶ MQ ─▶ DB2/Postgres.    │
├─────────┼──────────────────────────┼────────────────────────────────────────┤
│ Gate B3 │ Unknown Failure Discovery│ RCA correctly diagnoses an injected    │
│         │                          │ failure never seen in training sets.   │
├─────────┼──────────────────────────┼────────────────────────────────────────┤
│ Gate B4 │ Evidence Truth Ledger    │ 100% of diagnostic conclusions have an │
│         │                          │ immutable, cryptographically audited   │
│         │                          │ reproducible evidence trail.           │
├─────────┼──────────────────────────┼────────────────────────────────────────┤
│ Gate B5 │ Request Truth Index (RTI)│ Measured RTI > 98.0% across 7 causal   │
│         │                          │ dimensions from real telemetry facts.  │
├─────────┼──────────────────────────┼────────────────────────────────────────┤
│ Gate B6 │ Change Intelligence      │ Automated causal timeline linking git  │
│         │                          │ commits & deploys to query deviations. │
├─────────┼──────────────────────────┼────────────────────────────────────────┤
│ Gate B7 │ Production Safety        │ Complete SIGKILL outage of VITALIS     │
│         │                          │ causes 0.00% impact on client traffic. │
├─────────┼──────────────────────────┼────────────────────────────────────────┤
│ Gate B8 │ Security & Privacy Guard │ In-flight sanitization with 0 leaks    │
│         │                          │ across PAN, CVV, passwords, and PII.   │
├─────────┼──────────────────────────┼────────────────────────────────────────┤
│ Gate B9 │ Scale & Concurrency      │ Sustained > 100,000 spans/sec with     │
│         │                          │ p99 ingestion latency < 100ms.         │
├─────────┼──────────────────────────┼────────────────────────────────────────┤
│ Gate B10│ Controlled Remediation   │ Closed-loop Approve ─▶ Execute ─▶      │
│         │                          │ Verify ─▶ Auto-Rollback capability.    │
└─────────┴──────────────────────────┴────────────────────────────────────────┘
```
