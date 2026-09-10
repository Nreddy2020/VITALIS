# VITALIS — What Nagarjuna Needs To Do

**Verified against E:\VITALIS and github.com/Nreddy2020/VITALIS on 2026-09-09.**
Everything built across Stages 0–7 is committed to your local repo and all 10 verification
suites pass. This is the list of things only you can do.

---

## 🔴 Do this before anything else touches GitHub

**1. The repository is still PUBLIC.** Verified today — it loads for anyone, no login.
This was flagged in the Stage 0 security assessment and is still open. Make it private:
`GitHub → Settings → General → Danger Zone → Change repository visibility → Private`.

**2. Delete three files from the working tree.** No tool in my session can delete files on your
machine, so these have survived since Stage 0:

```
E:\VITALIS\powershell.exe            (495 KB — an unexplained binary in a source repo)
E:\VITALIS\push_to_github.bat
E:\VITALIS\push_to_github.ps1
```

They are correctly gitignored and were never pushed, but a stray `powershell.exe` in a repo is
exactly what a security reviewer will stop on.

**3. Only then push.** GitHub currently shows 10 commits and the pre-session file list — none of
Stages 0–7 has been pushed. Your local copy is the current one. Make the repo private first, then
push; do not push while it is public.

---

## 🟠 On your machine — about 10 minutes

**4. Install dependencies.** There is no `node_modules` on E:\ yet. The project now has real
dependencies (it had none before Stage 1):

```bash
cd E:\VITALIS
npm install
npm i -D playwright        # only if you want to run the browser-based GUI gates
```

**5. Create a real `.env`.** Only `.env.example` exists, so the server currently generates a random
API key at every boot and prints it once — fine for a solo demo, useless for anything else.

```bash
copy .env.example .env
# then set at minimum:
VITALIS_API_KEY=<a real secret>
```

**6. Place the CI secret-scanning workflow by hand.** The remote bridge refuses to write CI workflow
files (a deliberate guardrail I did not work around). Create `E:\VITALIS\.github\workflows\` and drop
in the `secret-scan.yml` I delivered. The `.github` directory does not exist yet.

**7. Run the suites on your own machine** to confirm the delivered state:

```bash
npm run test:all          # self-contained suites — no external infrastructure needed
npm run test:stage3       # needs npm registry access
npm run test:stage1-pg    # needs a reachable Postgres
npm run test:stage2-gui   # needs playwright + Postgres
```

---

## 🟡 To make it real — needs your infrastructure

These are the things I could not do because no such system was reachable from my environment.

**8. Instrument one pilot journey with OpenTelemetry.** Point the OTel Java auto-instrumentation
agent on WebSphere/IHS at your VITALIS OTLP endpoint. This needs zero adapter code — proven against
the real OTel SDK in `npm run test:stage1-otel`. Start with one journey, not the estate.

**9. Run the DB2 and MQ self-tests.** Their transformation logic is unit-tested; the live connection
is not. Each reports exactly which monitoring queries your instance and privileges actually allow:

```bash
npm install ibm_db
node engine/adapters/db2_live_adapter.js selftest "DATABASE=...;HOSTNAME=...;PORT=50000;UID=...;PWD=...;"
node engine/adapters/mq_live_adapter.js  selftest <QUEUE_MANAGER> <QUEUE_NAME>
```

**10. Trace-ID propagation — this is the real engineering task, and it is an app-team job.**
Everything else is configuration; this is code in your applications:

- **DB2:** pass the trace id through the connection's `CLIENT_APPLNAME` / `CLIENT_ACCTNG` fields so a
  lock event can be tied back to the request that caused it.
- **MQ:** propagate the trace id through the MQMD correlation id (or an RFH2 `usr` folder).

Without this, DB2 and MQ hops can be *observed* but not *attributed to a specific request* — and
request attribution is the entire premise of the product. Budget real time for this one.

**11. Feed changes and vulnerabilities.**

```bash
# Real commits from a real repo
node engine/adapters/git_change_adapter.js E:\VITALIS "7 days ago"
# Or point your CI/CD webhook at POST /v1/changes

# Your existing scanner -> POST /v1/vulnerabilities, your SBOM -> POST /v1/components
node engine/adapters/npm_audit_adapter.js <projectPath> <serviceName>
```

Any scanner (Trivy, Grype, Snyk, OWASP Dependency-Check, OSV) maps to the same advisory shape.

**12. Enrol approvers.** Each approver generates their own keypair; only the public half reaches
VITALIS. Verify the fingerprint out of band before enrolling:

```bash
# On the approver's machine
node engine/approver_enrolment.js request sre-lead@yourorg.com sre,sre-lead
# On the VITALIS host
node engine/approver_enrolment.js enrol sre-lead@yourorg.com ./key.pub sre,sre-lead you@yourorg.com
```

---

## 🔵 Decisions only you can make

- **Which business journey is the pilot.** Checkout/payments is the natural first candidate since
  it is already the reference scenario, but you know the estate.
- **Who holds which roles**, and which actions each role may approve
  (`engine/remediation_actions.js`).
- **Whether an action belongs on the allowlist at all.** Adding one is a governance decision, not a
  code tidy-up — it should get the same review as any production change.
- **When, or whether, to enable live remediation.** `VITALIS_ALLOW_REMEDIATION` stays unset until
  Stages 0–3 have run observe-only for 4–8 weeks with SRE and security sign-off. Leaving it unset is
  the correct state, not an incomplete one.

---

## What is genuinely done

All 10 suites pass. Real Ed25519 approvals with a two-person rule, a narrow action allowlist,
execution off by default, a hash-chained audit trail, durable ingest that survives SIGKILL, real
change and vulnerability correlation, a console that renders only ingested data, and Alpha Gate 5
passing for the first time.

**One caveat to carry into any pitch:** the Postgres adapter is the only one proven end-to-end
against a live database. DB2 and MQ have tested transformation logic and unverified connections.
Say that plainly to a CTO — it is a much stronger position than a claim that does not survive the
first question.
