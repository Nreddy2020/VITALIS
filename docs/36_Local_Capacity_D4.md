# D4 — measured local repository workload

## Acceptance criteria recorded before implementation

1. Exercise actual authenticated HTTP ingestion and investigation reads against a
   child server with a disposable dedicated local store. Record Node/OS/CPU model,
   workload shape, concurrency, configured limits and durable mode. No emulator or
   original application data participates. Synthetic workload is clearly labeled.
2. Ingest 200 trace batches of 10 observations with 10 concurrent clients; account
   for every response and retain exactly 2,000 observations in 200 traces. Record
   elapsed time, client-observed latency p50/p95/p99/max and server process memory
   samples. Do not invent production SLOs or describe sampled memory as exact peak.
3. Retry the same workload at its configured trace/span quota: every retry succeeds
   with zero new observations. A new trace is refused with a measurable quota reason.
   Read investigation pages concurrently and record latency, errors and counts.
4. Force-stop the process, reopen the same store, and compare all retained evidence
   and deterministic investigation revisions. Zero acknowledged evidence loss and
   no silent overwrite are correctness gates; latency is measured, not a fabricated
   universal pass/fail target. Preserve the report and store location for inspection.
5. Record bottlenecks/limitations and a storage decision consistent with the measured
   workload. One local run does not establish a production limit, long-run leak
   absence, physical disk-full behavior, power-loss recovery or vendor integration.
   Fix failed correctness checks before choosing the next dependent stage.

## Measured result — 2026-09-10 14:25 UTC

`node tests/measure_repository_capacity.js` passed. The full report, individual
response accounting, settings, memory samples and evidence hashes are preserved in
`artifacts/storage-d4/capacity-report.json`. Its disposable store path is recorded
there for inspection; the harness does not delete it. No correctness failure occurred.

Host: Windows 10.0.26200, Node v24.14.1, Intel Core i5-10400F (12 logical CPUs),
47.9 GiB host RAM. Storage medium/cache state and other host workload were not
controlled. Payloads are synthetic 3,018-byte OTLP JSON batches, each one root and
nine internal spans. Ten clients run concurrently, durable ingestion enabled,
trace quota 200 and observation quota 2,000. Byte quotas retain D2 defaults.

| Phase | Requests | Elapsed | Client p50 | Client p95 | Client p99 |
| --- | ---: | ---: | ---: | ---: | ---: |
| New evidence | 200 | 1.988 s | 91.8 ms | 164.3 ms | 179.1 ms |
| Exact retry at quota | 200 | 1.402 s | 64.6 ms | 85.5 ms | 127.0 ms |
| Read 100 investigations per page | 20 | 0.691 s | 324.7 ms | 344.0 ms | 363.7 ms |

The first phase completed about 100.6 batches/second (1,006 observations/second)
for this short workload. This is an observed run rate, not a supported sustained
capacity. RSS rose from 69.1 MiB before the phases to a sampled maximum of 146.4 MiB;
sampled heap maximum was 48.1 MiB over 50 samples. Measurements cover ingestion,
retry and page-read phases, not an exact allocation peak or a long-run leak test.
Serialized retained traces occupied 756,601 bytes before the forced restart.

All 2,000 acknowledged observations survived the process stop. Every trace's
complete retained evidence and investigation revision matched after reopening.
The force-stop/reopen interval was 150.4 ms on this run. All 200 repeated exports
succeeded with zero additions; a new trace was refused with the trace-limit reason.
This adds bounded workload evidence to D1's separate pre-snapshot crash test; it
does not claim a host power-loss test.

## Storage decision and remaining work

Keep the current single-writer store for the isolated pilot and next local workflow
increment. This run gives no operational reason to distribute the service. It also
does not establish capacity at the default 10,000-trace/100,000-span limits. Full
file scans, map serialization and uncached investigation rebuilds remain visible
code costs; their share of latency has not been profiled. Before a larger deployment,
profile those paths, benchmark realistic retained volume and read/write mix, and
compare an indexed transactional repository using identical preservation tests.
Do not raise limits based only on this run or silently migrate original evidence.

D4 is complete for its acceptance scope. Repository-wide production operations,
automatic case-aware purge and any migration remain open. The next local increment
can define case revisions and the case/evidence repository contract independently
of the eventual production storage choice; persistent case implementation must have
its own atomic-write, recovery, quota and stale-update gates before it is called done.
