/**
 * VITALIS: manifest reader for compatibility drift
 *
 * Reads what a repository DECLARES and what it has actually RESOLVED, and keeps
 * those two things apart for the whole life of the analysis. A `package.json`
 * saying "expo": "~54.0.35" is an intention; a lockfile saying 54.0.35 is a
 * fact. A checker that conflates them evaluates rules against versions nobody
 * ever installed.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE KNOWS NOTHING ABOUT ANY APPLICATION OR LANGUAGE.
 *
 * It discovers manifests by basename, at any depth, and hands each group to the
 * ecosystem module that claims it. Package-manager knowledge lives in
 * `ecosystems/`; framework knowledge lives in `rulepacks/`.
 *
 * An earlier version of this file hardcoded `package.json`, `app.json`,
 * `eas.json` and — worst of all — `backend/requirements.txt`: one specific
 * application's folder layout, written into the engine. It read that
 * application perfectly and would have found nothing in any other repository.
 * The same failure had already happened once with DB2/MQ (`docs/01` §9).
 * Anything you are tempted to hardcode here belongs in an ecosystem module or a
 * rule pack instead. See `ecosystems/ECOSYSTEM_CONTRACT.md`.
 * ---------------------------------------------------------------------------
 */

const { ECOSYSTEMS, discover } = require('./ecosystems');
const { loadRulePacks } = require('./rulepack_loader');

/** Read a value out of a parsed config file by JSON path. */
function valueAtPath(obj, segments) {
  let cur = obj;
  for (const s of segments) {
    if (cur === null || typeof cur !== 'object' || !(s in cur)) return { found: false, value: undefined };
    cur = cur[s];
  }
  return { found: true, value: cur };
}

/**
 * Extract the facts declared by rule packs.
 *
 * A fact whose file is absent, unparseable, or missing the key is UNKNOWN — it
 * never becomes a framework default. Assuming a default here would make the
 * engine assert configuration it has not seen.
 */
function extractFacts(declarations, configFiles) {
  const facts = {};
  const parsed = new Map();

  for (const decl of declarations) {
    const match = [...configFiles.values()].find(f => f.basename === decl.file);
    if (!match) {
      facts[decl.name] = { value: undefined, provenance: 'UNKNOWN', source: `${decl.file} not found in this repository` };
      continue;
    }
    if (!parsed.has(match.path)) {
      try { parsed.set(match.path, { ok: true, data: JSON.parse(match.text) }); }
      catch (err) { parsed.set(match.path, { ok: false, error: err.message }); }
    }
    const p = parsed.get(match.path);
    if (!p.ok) {
      facts[decl.name] = { value: undefined, provenance: 'UNKNOWN', source: `${match.path} could not be parsed: ${p.error}` };
      continue;
    }
    const r = valueAtPath(p.data, decl.path);
    facts[decl.name] = r.found
      ? { value: r.value, provenance: 'OBSERVED', source: `${match.path} ${decl.path.join('.')}` }
      : { value: undefined, provenance: 'UNKNOWN', source: `${match.path}: key ${decl.path.join('.')} absent — a framework default may apply, which this checker does not assume` };
  }
  return facts;
}

/**
 * Read a repository's dependency manifests.
 *
 * @param repoPath  directory to analyse
 * @param options   { factDeclarations } — normally supplied by the rule packs
 */
function readRepo(repoPath, options = {}) {
  const factDeclarations = options.factDeclarations || loadRulePacks(options.rulePackOptions).facts;
  const wantedConfigFiles = [...new Set(factDeclarations.map(f => f.file))];

  const found = discover(repoPath, wantedConfigFiles);
  const warnings = [...found.warnings];
  const packages = [];
  let selfVersion = { value: null, provenance: 'UNKNOWN', source: 'no manifest declared a version for this component' };

  for (const eco of ECOSYSTEMS) {
    const files = found.byEcosystem.get(eco.id);
    if (!files || files.size === 0) continue;
    let result;
    try {
      result = eco.read(files);
    } catch (err) {
      // One broken ecosystem module must not silently remove a whole language
      // from the analysis and leave the result looking complete.
      warnings.push(`ecosystem '${eco.id}' failed to read its manifests: ${err.message}. Its dependencies are NOT in this report.`);
      continue;
    }
    packages.push(...(result.packages || []));
    warnings.push(...(result.warnings || []));
    if (selfVersion.value === null && result.selfVersion && result.selfVersion.value) {
      selfVersion = result.selfVersion;
    }
  }

  const facts = extractFacts(factDeclarations, found.configFiles);

  // The Node version of THIS process, not necessarily the build machine's.
  // Labelled precisely so a rule result can never be over-read.
  facts['runtime.node'] = {
    value: process.version.replace(/^v/, ''),
    provenance: 'OBSERVED',
    source: 'process.version of the Node running this check — NOT necessarily the CI or build machine'
  };

  if (packages.length === 0) {
    warnings.push(`no dependency manifests were found under ${repoPath} for any registered ecosystem (${ECOSYSTEMS.map(e => e.id).join(', ')}).`);
  }

  return {
    repoPath,
    ecosystemsFound: found.ecosystemsFound,
    packages,
    facts,
    warnings,
    selfVersion,
    found: Object.fromEntries(ECOSYSTEMS.map(e => [e.id, found.byEcosystem.has(e.id)]))
  };
}

module.exports = { readRepo, extractFacts, valueAtPath };
