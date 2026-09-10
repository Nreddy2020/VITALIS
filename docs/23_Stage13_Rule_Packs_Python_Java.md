# 23 — Stage 13 Completion Log: Rule Packs for Python and Java

**Date:** 2026-09-09
**Status:** Built and verified by execution. 6/6 gates pass; all 16 suites pass.
**Run it:** `npm run test:stage13`
**Artifacts:** `artifacts/stage13-rulepack-gate-report.json`

Stage 11 made the drift engine technology-agnostic and claimed a new rule pack needs no code
change. This stage is that claim exercised for real, against two ecosystems the engine was not
built for.

**No engine file changed.** Both packs are JSON. That is the property under test as much as the
rules themselves.

---

## 1. Two packs, both derived from machine-readable sources

### `pip-core.json` — 9 rules

Derived from **PyPI `requires_dist` metadata** — the package's own declaration of what it needs,
fetched per exact version. Not a human summary, not recollection: the same data pip resolves
against.

| Rule | Source |
|---|---|
| motor 3.3.x → pymongo ≥ 4.5, < 5.0 | `pypi.org/pypi/motor/3.3.2/json` |
| fastapi 0.104.x → starlette ≥ 0.27.0, < 0.28.0 | `pypi.org/pypi/fastapi/0.104.1/json` |
| fastapi 0.104.x → pydantic ≥ 1.7.4, < 3.0.0 | `pypi.org/pypi/fastapi/0.104.1/json` |
| pymongo 4.6.x → dnspython ≥ 1.16.0, < 3.0.0 | `pypi.org/pypi/pymongo/4.6.1/json` |
| pydantic 2.5.x → pydantic-core **exactly** 2.14.1 | `pypi.org/pypi/pydantic/2.5.0/json` |

A bounded range becomes **two rules**, because the constraint vocabulary in `version_ops.js` is
deliberately closed — one operator per constraint, nothing that could half-evaluate a range and
return "satisfied". Slightly more verbose as data; considerably harder to be quietly wrong.

### `spring-boot.json` — 12 rules

Sourced from the official Spring Boot **system-requirements pages**, one per supported line:

| Spring Boot | Requires Spring Framework | Source |
|---|---|---|
| 4.1.x | ≥ 7.0.9 | `docs.spring.io/spring-boot/system-requirements.html` |
| 4.0.x | ≥ 7.0.9 | `docs.spring.io/spring-boot/4.0/system-requirements.html` |
| 3.4.x | ≥ 6.2.15 | `docs.spring.io/spring-boot/3.4/system-requirements.html` |

Each is expressed against four Boot artifacts that commonly appear directly in a pom
(`spring-boot-starter-web`, `spring-boot-starter`, `spring-boot-starter-data-jpa`, `spring-boot`).

The real-world case these catch: **a pom that pins a Spring Framework version alongside a Boot
starter.** That is a genuine and recurring source of Java runtime breakage, and it is exactly the
class of problem no APM tool looks at.

---

## 2. What is deliberately absent

**Java version rules.** The Spring Boot pages state Java 17–24 (3.4) and 17–26 (4.x), and it was
tempting to encode that. But **the Java version cannot be observed from a pom by this reader** —
it lives in a property, a parent pom, a toolchain, or the build environment. A rule that cannot be
evaluated against real evidence would either sit permanently UNKNOWN or, worse, invite someone to
"fix" it later by guessing at a default. Left out.

**Maven and Gradle minimums.** Same reason: the build tool version is not in the manifest.

**Transitive resolution.** Neither reader resolves transitive trees, so a requirement on a package
that arrives indirectly is UNKNOWN. Gate C5 exists specifically to hold that line.

---

## 3. The gates

| Gate | What it proves | Result |
|---|---|---|
| C1 | A real Python incompatibility (motor 3.3 + pymongo 5.x) is caught | PASS |
| C2 | A correct real-world Python pairing is SATISFIED | PASS |
| C3 | A real Java incompatibility (Spring Boot 3.4 pinned to Spring Framework 6.1) is caught | PASS |
| C4 | A correct Spring Boot pairing is SATISFIED | PASS |
| C5 | A **transitive-only** dependency is UNKNOWN, never SATISFIED | PASS |
| C6 | **Every rule in every shipped pack** carries a resolvable source URL and date | PASS |

C5 is the one that matters most. `starlette` is a genuine requirement of FastAPI, but it arrives
transitively and is not in `requirements.txt`. The rule must report *"I could not check this"* —
because a rule that passes when it cannot find the package converts every missing dependency into
a silent green tick, which is the failure mode this entire capability exists to avoid.

C6 audits what actually shipped rather than trusting the loader: 40 rules across 3 packs, 0
unsourced.

---

## 4. Result on a real project

Re-running the real Expo + FastAPI project (read-only), coverage rose from **5 to 12** dependencies
checked, and the Python stack came back clean on everything checkable:

```
✓ motor 3.3.x requires pymongo >= 4.5.0        (has 4.6.1)
✓ motor 3.3.x requires pymongo < 5.0.0
✓ fastapi 0.104.x requires pydantic >= 1.7.4   (has 2.5.0)
✓ fastapi 0.104.x requires pydantic < 3.0.0
? fastapi 0.104.x requires starlette >= 0.27.0 — could not be checked
? pydantic 2.5.x pins pydantic-core to 2.14.1  — could not be checked
```

**61 of 70 dependencies still match no rule**, and the summary says so on every run. That number
falling is what progress looks like here; making it fall by writing unsourced rules would be the
opposite.

---

## 5. What this does and does not prove

**Does:** the rule-pack format is sufficient for at least three genuinely different ecosystems, and
extending the engine to a new technology is content work, not engineering. Stage 11's claim holds
under a second and third test.

**Does not:** make coverage good. 40 rules is a beginning. The honest position is unchanged from
`17` — **ship partial coverage rather than guessed coverage**, and let the UNKNOWN count say what
it says.

Adding the next pack needs no permission and no code: a JSON file, every rule with a source URL,
dropped into `engine/drift/rulepacks/`. `ecosystems/ECOSYSTEM_CONTRACT.md` is the reference.
