/**
 * Ecosystem registry and manifest discovery.
 *
 * Discovery walks the repository looking for manifest files BY BASENAME, at any
 * depth. It does not know that a Python service might live in `backend/`, or
 * that a Java module might live in `services/ledger/` — because knowing that
 * would mean knowing what application it is looking at, which is exactly the
 * drift this design prevents.
 *
 * Register a new ecosystem by adding it to ECOSYSTEMS. Nothing else in the
 * engine changes. See ECOSYSTEM_CONTRACT.md.
 */

const fs = require('fs');
const path = require('path');

const ECOSYSTEMS = [
  require('./npm'),
  require('./pip'),
  require('./maven')
];

// Never descended into, whatever the ecosystem: version control internals,
// vendored dependency trees, and build output. Each ecosystem may add more.
const GLOBAL_IGNORE = new Set(['.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', '__pycache__', 'target', 'dist', 'build', '.expo', '.next', '.gradle', '.idea', 'coverage']);

const MAX_DEPTH = 6;
const MAX_FILES = 400;

/** Every basename any registered ecosystem cares about. */
function knownBasenames() {
  const m = new Map();
  for (const eco of ECOSYSTEMS) {
    for (const f of eco.manifestFiles) {
      if (!m.has(f)) m.set(f, []);
      m.get(f).push(eco.id);
    }
  }
  return m;
}

/**
 * Walk a repository and return discovered manifests grouped by ecosystem id.
 * Also returns the config files a rule pack may want to read facts from.
 */
function discover(repoPath, extraFiles = []) {
  const wanted = knownBasenames();
  const extras = new Set(extraFiles);
  const ignore = new Set(GLOBAL_IGNORE);
  for (const eco of ECOSYSTEMS) for (const d of eco.ignoreDirs || []) ignore.add(d);

  const byEcosystem = new Map();
  const configFiles = new Map();
  const warnings = [];
  let seen = 0;
  let truncated = false;

  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || truncated) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (err) { warnings.push(`could not read ${dir}: ${err.message}`); return; }

    for (const e of entries) {
      if (truncated) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (ignore.has(e.name) || e.name.startsWith('.')) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;

      const isManifest = wanted.has(e.name);
      const isConfig = extras.has(e.name);
      if (!isManifest && !isConfig) continue;

      if (++seen > MAX_FILES) {
        truncated = true;
        warnings.push(`manifest discovery stopped at ${MAX_FILES} files — results may be incomplete for this repository.`);
        return;
      }

      let text;
      try { text = fs.readFileSync(full, 'utf8'); }
      catch (err) { warnings.push(`could not read ${full}: ${err.message}`); continue; }

      const record = { path: full, dir, basename: e.name, text };
      if (isManifest) {
        for (const ecoId of wanted.get(e.name)) {
          if (!byEcosystem.has(ecoId)) byEcosystem.set(ecoId, new Map());
          byEcosystem.get(ecoId).set(full, record);
        }
      }
      if (isConfig) configFiles.set(full, record);
    }
  };

  walk(repoPath, 0);
  return { byEcosystem, configFiles, warnings, ecosystemsFound: [...byEcosystem.keys()] };
}

module.exports = { ECOSYSTEMS, discover, knownBasenames, GLOBAL_IGNORE, MAX_DEPTH, MAX_FILES };
