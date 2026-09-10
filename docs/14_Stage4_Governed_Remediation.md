# VITALIS Stage 4 Completion Log — Governed Remediation

**Date:** 2026-09-08
**Scope:** Rebuild the closed-loop remediation path — the only part of VITALIS that could ever call
a real control-plane API — with governance that fails closed, per Stage 4 of
[[VITALIS_Implementation_Roadmap]].

Follows [[VITALIS_Stage0_Completion_Log]], [[VITALIS_Stage1_Completion_Log]],
[[VITALIS_Stage2_Completion_Log]] and [[VITALIS_Stage3_Completion_Log]].

**Important scoping note:** the roadmap gates *enabling* live remediation behind 4–8 weeks of
observe-only running plus SRE and security sign-off. That gate is unchanged and is a matter of
elapsed operational time, not code. What was done here is build the mechanism correctly and, more
urgently, **remove a genuinely dangerous module that was sitting in the working tree today**.

## The defects — proven by exploiting them, not asserted

`engine/remediation_state_machine.js` governed the highest-risk operation in the product. Running
it exposed six defects (gate D0 exploits each against a preserved copy):

```
> execute() reachable straight from DETECTED, skipping approval: true
> "signature" is a Math.random() string ("sig-48zfdmbf"): true
> audit ledger received ZERO entries: true
> verifyPostAction() with no arguments self-reported COMPLETED: true
```

1. `signature: sig-${Math.random()...}` — presented as a cryptographic signature; nothing ever
   verified it.
2. `approve(operatorId = "sre-lead@bank.corp", ticketId = "INC-884192")` — approval **defaulted to
   the SRE lead's identity** and verified nothing, so any caller could approve any action as anyone.
3. **No transition guards at all** — `new RemediationStateMachine(...).execute()` moved
   `DETECTED → EXECUTING` directly, skipping diagnosis, risk assessment and approval entirely.
4. The tamper-evident ledger was accepted in the constructor and **never written to** — zero audit
   entries for the most dangerous operation in the system.
5. `verifyPostAction(isHealthy = true)` — defaulted to success, so an unverified action
   self-reported `COMPLETED`.
6. `assessRisk(riskLevel = "LOW")` — defaulted to low risk.

Defect 3 is the serious one: the "controlled closed-loop" had no control. Combined with 1 and 2,
anything that could construct the object could drive an unapproved action to `EXECUTING` and have
it self-report success, leaving no audit trail.

## What replaced it

**Governing principle: every gate fails closed.** A missing approver, an unknown action, an unset
flag, an unmeasured outcome — each stops the machine rather than defaulting to a permissive value.

- **`engine/approval_authority.js`** — real Ed25519 signing/verification via Node's `crypto`. The
  signed payload binds the approval to a specific incident, action, target, ticket, approver, nonce
  and expiry, so a signature cannot be re-pointed at a different target. Enforces RBAC, requires a
  well-formed change ticket, and refuses replayed nonces and expired approvals. VITALIS never holds
  a private key.
- **`engine/remediation_actions.js`** — the allowlist, as code. An action not defined here cannot be
  approved or executed regardless of approval validity. Enabled actions are deliberately narrow and
  reversible (restart one named pool, flush one named cache). `db.terminate-session` — the action
  the original demo proposed *first* — is defined as `HIGH` risk and irreversible so it can be
  reasoned about and recommended to a human, but never auto-executed.
- **Two-person rule (segregation of duties).** Each action declares `minApprovals`; `MEDIUM`-risk
  actions require two *distinct* humans to sign independently. A partially-approved action stays in
  `AWAITING_APPROVAL`, and the partial approval is still written to the audit ledger. Gate T2 is the
  one that matters: the same person signing twice, with two perfectly valid signatures and two fresh
  nonces, is rejected — one compromised key or one person's bad judgement must not be sufficient.
- **`engine/governed_remediation.js`** — legal-transition table (`EXECUTING` reachable only from
  `APPROVED`), risk read from the action rather than passed in, every transition written to the
  hash-chained ledger, verification by measurement with automatic rollback, and **execution disabled
  by default**.

The unsafe module is quarantined: its original path now throws on construction (gate D1), and the
preserved copy under `engine/_deprecated/` exists solely so the defects stay provable.

## Verification — `tests/verify_stage4_governance_gates.js`, actually run

15 gates, all passing. The adversarial ones use **real attacker keypairs**, not mocks:

| Gate | Proves |
|---|---|
| D0 | The original module's six defects are real (exploited, not asserted) |
| D1 | The original path is quarantined and throws |
| G1 | Real Ed25519 approval verifies; 6 hash-chained ledger blocks written, integrity `isValid: true` |
| G2 | Re-pointing a signed approval from `pool:checkout-db-pool` to `pool:payments-db-pool` is rejected |
| G3 | An attacker signing a well-formed approval with their own key is rejected |
| G4 | `junior@bank.corp` (roles: `viewer`) correctly signing with their own key is rejected — RBAC |
| G5 | A valid approval reused a second time is rejected (replay); an expired one is rejected |
| G6 | Unknown action refused at construction; mismatched target shape refused; `HIGH`/irreversible refused before approval was even sought |
| G7 | **Fully valid approval + registered executor + flag unset → dry run, control-plane function never called** |
| G8 | `execute()` from `DETECTED` refused; skipping to `AWAITING_APPROVAL` refused |
| G9 | `verifyPostAction()` without a health check refused; a failing check rolled back to `ROLLED_BACK` |
| T1 | One valid approval is not enough for a two-person action — stays `AWAITING_APPROVAL` |
| T2 | **The same person signing twice does not satisfy a two-person rule** — rejected even with two valid signatures and two fresh nonces |
| T3 | Two distinct, correctly-roled approvers complete the set |
| T4 | An under-privileged second approver does not complete the set |

G7 is the one that matters operationally: everything can be correct — signature, roles, ticket,
allowlist, executor registered — and the system *still* does not touch the control plane unless a
human has explicitly enabled it.

A test-side bug was found and fixed during the run: G1 initially failed because the assertion
checked `chainOk.valid` while `verifyLedgerIntegrity()` returns `isValid`. The ledger was correct;
the assertion was wrong.

## Regression check

All suites re-run: Alpha Gates 1–4 PASS, Stage 0 security PASS, Stage 1 evidence PASS, Stage 1 OTel
SDK proof PASS, Stage 1 Postgres adapter PASS, Stage 2 GUI PASS, Stage 3 correlation PASS, Stage 4
governance PASS. Alpha Gate 5's `socket hang up` remains unchanged — proven pre-existing in Stage 0.
Stage 4 is self-contained (no network, database or browser needed) so it is wired into `test:all`.

## What Stage 4 does NOT claim

- **Live remediation is not enabled, and should not be.** The roadmap's 4–8 weeks of observe-only
  running with SRE and security sign-off is unchanged. The flag exists; leaving it unset is correct.
- **No real control-plane integration exists.** The executor is a function you supply. Nothing in
  this repo talks to a real cluster, database or load balancer.
- **The allowlist is a starting point, not a finished policy.** Adding an action to it is a
  governance decision that should get the same review as any production change.
- **Approver key distribution/enrolment is out of scope.** In production the private key belongs in
  an HSM, smart card, or SSO-backed signing service.

## Files delivered to E:\VITALIS

`engine/approval_authority.js`, `engine/remediation_actions.js`, `engine/governed_remediation.js`,
`engine/remediation_state_machine.js` (quarantine stub),
`engine/_deprecated/remediation_state_machine.legacy.js` (preserved for gate D0),
`tests/verify_stage4_governance_gates.js`, `package.json` (`test:stage4`, added to `test:all`),
`README.md` (Stage 4 section), `artifacts/stage4-governance-gate-report.json`.

## Where the programme now stands

All five roadmap stages have code and passing gates. The remaining work is not more building — it
is running this against real infrastructure: OTel agents on a real pilot journey, a real CI/CD
webhook into `/v1/changes`, the organisation's existing scanner into `/v1/vulnerabilities`, and a
real DB2/MQ adapter built the way the Postgres one was. That needs environment access this
development environment does not have.
