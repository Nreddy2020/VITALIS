# E1 — durable case decisions and preserved evidence

## Acceptance criteria recorded before implementation

1. A generic case can be created from a retained request and its exact investigation
   revision. The case preserves a copy of sanitized spans and the investigation
   report. Later telemetry cannot rewrite the basis for an earlier decision.
   Current versus saved revision is visible; missing current evidence stays explicit.
2. Cases support OPEN, INVESTIGATING and BLOCKED, append-only decision history,
   notes and attaching a fresh evidence revision. Blockers require a declared kind,
   reason and operator label. Labels are operator-declared, not verified identity.
   No RESOLVED, approval or execution transition is accepted in E1.
3. Every update requires the expected case revision and an operation ID. Two actual
   concurrent updates to one revision yield one winner and one conflict; no lost
   update. Exact operation retries are idempotent, including after restart. Reusing
   an operation ID for a different command fails. Stale request evidence fails.
4. Case writes are bounded and durable before acknowledgment/publication under the
   existing exclusive writer. Actual forced restart preserves acknowledged decisions
   and evidence. Failed write/fsync/rename does not publish a decision or overwrite
   the previous valid file. Corrupt/unknown-version case files are preserved, visible
   in storage health and block mutations. No purge or migration of original data.
5. Authenticated paginated list/detail/write APIs validate sizes, IDs, transitions
   and case/evidence/event quotas. API errors identify stale state, storage recovery,
   exhausted capacity or malformed input. Notes are sanitized before persistence.
6. Actual browser workflow creates a case, records a decision, views saved evidence
   and detects a stale update without losing the draft. Untrusted labels/notes render
   as text. Reopening/restarting restores cases. No action implies verified recovery.
7. Existing ingestion, investigation, storage/retry and browser checks remain passing.
   Record failed assertions, corrections and limits before calling E1 complete.

Implementation boundary: pure case command/validation contract, a local snapshot
repository using D1 atomic replacement and D2 writer/health/quota admission, an
additive API and console workflow. No database migration is required by this slice.
Cases hold their own evidence copies, avoiding a transaction across two files.
The shared API key permits local case writes; it is not multi-user role enforcement.
