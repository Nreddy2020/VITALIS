# VITALIS — Stage 0 Completion Log

Stage 0 (security hardening, from VITALIS_Implementation_Roadmap.md) implemented and verified
directly against the codebase at E:\VITALIS, not just planned.

## What changed (written back to E:\VITALIS)

- `server.js`: every `/v1/*` and `/api/*` endpoint now requires an `x-vitalis-api-key` header
  (timing-safe comparison; auto-generates and logs a one-time key if none is configured, so
  there is never an unauthenticated-by-default build). `/health` stays public for load
  balancers/uptime checks.
- CORS replaced with an explicit `VITALIS_ALLOWED_ORIGINS` allow-list (was `*`).
- Ingestion request bodies capped at `VITALIS_MAX_BODY_BYTES` (default 2MB) — closes the
  unbounded-memory DoS vector; a per-IP rate limit was added on top.
- `PrivacySanitizer` is now actually called on every ingested span/metric/log before storage
  (it previously existed but was never wired into the ingestion path) — plus a new
  `sanitizeOtelAttributes` helper that masks sensitive OTel attribute *names* outright
  (password/secret/token/apikey/authorization/cvv/ssn/pan), which the generic sanitizer alone
  couldn't do given OTel's `{key, value}` attribute shape.
- Ingested traces now persist to disk (`VITALIS_DATA_DIR`, file-backed for Stage 0) and reload
  on startup — verified with a real `SIGKILL` + process respawn, not just an in-memory check.
- New test suite `tests/verify_security_gates.js` (`npm run test:security`) proves all four
  of the above as automated, repeatable gates. All pass; existing Alpha Gates 1–4 still pass
  unmodified.
- New `.env.example`, updated `README.md`, updated `.gitignore` (added `/data/`), and a new
  `.github/workflows/secret-scan.yml` (gitleaks) for CI-level secret scanning.

## Found and fixed along the way

- Confirmed Alpha Gate 5's "socket hang up" is a **pre-existing** bug in the original code
  (reproduced identically against the untouched original `server.js`), not a Stage 0
  regression — a server-restart/keep-alive-socket-reuse issue, out of scope for Stage 0.
  *(Later fixed in Stage 5–7; see that log.)*

## Still needs manual action (tooling could not do this remotely)

- `.github/workflows/secret-scan.yml` was generated and delivered as a file, but the device
  bridge refuses to write into `.github/` for safety — the user needs to place this one file
  manually. *(Done 2026-09-09.)*
- `powershell.exe` and `push_to_github.bat/.ps1` are gitignored (confirmed never pushed to
  GitHub) but still need to be manually deleted from the working tree — no available tool can
  delete files on this Windows device. *(Done 2026-09-09.)*
- Making the GitHub repo private is a manual step on github.com (repo owner action).
  *(Still open — required before the first push.)*

## Not yet done (Stage 1+)

Real OIDC/mTLS auth, a real database replacing file-backed persistence, and the actual
OTel/DB2/MQ pilot integration — per VITALIS_Implementation_Roadmap.md.
