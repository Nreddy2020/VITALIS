# Ecosystem Contract — compatibility drift

**Read this before adding support for a language, package manager or framework.**

The drift engine must not know what kind of application it is looking at. If reading this
directory tells you VITALIS is a JavaScript tool, or a Java tool, something has gone wrong — the
same way `ADAPTER_CONTRACT.md` exists so that reading `engine/adapters/` does not tell you VITALIS
is an IBM tool.

This has already gone wrong twice in this project:

1. **DB2/MQ.** The engine drifted toward IBM middleware because that was the example in front of
   it. Recorded in `docs/01_CHARTER_read_this_first.md` §9.
2. **`backend/requirements.txt`.** The first version of `manifest_reader.js` hardcoded that exact
   path — one specific application's folder layout — plus `app.json`/`eas.json` and an
   Expo-specific fact extractor, all in the engine. It worked perfectly on the application in
   front of it and would have found nothing anywhere else.

Both look like progress while you are making them. This contract is the guard.

---

## The two extension points

Adding a new kind of application should require **at most one small module**, and often **none at
all**.

| You want to support | What you write |
|---|---|
| A new package manager (Go modules, Cargo, NuGet, Gradle, Composer…) | One ecosystem module, this contract |
| New compatibility knowledge for an existing package manager (Spring Boot ↔ Spring, Django ↔ Python, WebSphere ↔ JDK) | **A JSON rule pack. No code.** |

If you find yourself editing `drift_checker.js`, `manifest_reader.js` or `version_ops.js` to
support a specific technology, stop — the design is being violated, and the next person will not
be able to add theirs without editing it again.

---

## Ecosystem module interface

Place the module in `engine/drift/ecosystems/` and register it in `index.js`.

```js
module.exports = {
  id: 'npm',                                  // stable, lowercase
  displayName: 'npm / Node.js',

  // Filenames this ecosystem recognises, matched anywhere in the tree.
  // Basenames only — never a path. A path is one application's layout.
  manifestFiles: ['package.json', 'package-lock.json'],

  // Directory basenames never to descend into.
  ignoreDirs: ['node_modules'],

  /**
   * @param files  Map<absolutePath, {basename, dir, text}> — the discovered
   *               manifest files belonging to this ecosystem
   * @returns { packages[], selfVersion, warnings[] }
   */
  read(files) { /* ... */ }
};
```

### What `read()` must return

`packages[]`, each entry:

| Field | Meaning |
|---|---|
| `ecosystem` | your `id` |
| `name` | package identifier as that ecosystem writes it |
| `version` | an **exact** version, or `null` |
| `declared` | the raw range/constraint as written, for display |
| `provenance` | `OBSERVED` \| `INFERRED` \| `UNKNOWN` — see below |
| `note` | one line explaining where the version came from |
| `dev` | optional boolean |

`selfVersion`: `{ value, provenance, source }` — the version this component declares itself to be,
or `{ value: null, provenance: 'UNKNOWN', source }`. Stage 10 compares this against the
`service.version` a running component reports.

---

## The provenance rule — the part that matters

| Provenance | Use when |
|---|---|
| `OBSERVED` | The version is a fact: read from a lockfile, or a pinned exact constraint |
| `INFERRED` | Derived from a range — the floor of `^1.2.0`, say. **The real installed version is not known.** |
| `UNKNOWN` | Present, but no version could be established |

**Never return `OBSERVED` for a version you derived from a range.** A declared range is an
intention; a lockfile entry is a fact. Collapsing them makes the engine assert compatibility
verdicts about versions nobody ever installed, and nothing downstream can detect it.

**Never invent a version to avoid a null.** A wrong version is worse than no version: `UNKNOWN`
propagates honestly into the coverage report, a guess does not.

**Fail closed on anything you cannot resolve.** Maven's `${property}` placeholders are the worked
example — `maven.js` marks them `UNKNOWN` rather than guessing at property resolution. That is the
correct instinct for every ecosystem.

---

## Rule packs — where technology knowledge belongs

Rules live in `engine/drift/rulepacks/*.json` as data, so that supporting a new framework needs no
code. Every rule **must** carry a resolvable `source.url` and `recordedAt`; the loader throws
otherwise. A compatibility matrix written from memory is undetectable once written down, and the
source requirement is the only thing standing between a sourced matrix and a list of plausible
guesses.

A pack may also declare `facts` — values read from a config file by JSON path — so that
framework-specific configuration (Expo's `newArchEnabled`, a Spring `application.yml` key) stays
out of the engine:

```json
"facts": [
  { "name": "expo.newArchEnabled", "file": "app.json", "path": ["expo", "newArchEnabled"] }
]
```

**Ship partial coverage rather than guessed coverage.** The checker reports uncovered dependencies
as `UNKNOWN` on every run. That number being large is honest; making it smaller with unsourced
rows defeats the entire purpose of the tool.
