/**
 * Rule pack loader.
 *
 * Compatibility knowledge is DATA, not code. Supporting Spring Boot, Django,
 * WebSphere or anything else is a JSON file dropped into `rulepacks/` — no
 * change to the engine, no change to any ecosystem module.
 *
 * That separation is the whole point. When rules lived inside the engine, the
 * engine knew what kind of application it was looking at, and every new
 * technology meant editing the same file — which is how a general tool quietly
 * becomes a tool for whatever was in front of it first.
 *
 * THE ADMISSIBILITY RULE is unchanged and enforced here: a rule without a
 * resolvable source URL and a recorded date is refused, and the loader throws
 * rather than skipping it. A version matrix written from memory is undetectable
 * once written down — every row looks equally plausible — so the source
 * requirement is the only real defence.
 *
 * Pack format:
 * {
 *   "id": "expo",
 *   "displayName": "Expo / React Native",
 *   "sources": { "<key>": { "url": "...", "title": "...", "recordedAt": "YYYY-MM-DD" } },
 *   "facts":   [ { "name": "expo.newArchEnabled", "file": "app.json", "path": ["expo","newArchEnabled"] } ],
 *   "rules":   [ { "id", "description", "when", "require", "severity", "source": "<key>" | {…} } ]
 * }
 */

const fs = require('fs');
const path = require('path');

const PACK_DIR = path.join(__dirname, 'rulepacks');

function validateRule(rule, packId, seen) {
  const where = `rule '${rule && rule.id}' in pack '${packId}'`;
  if (!rule || typeof rule.id !== 'string' || !rule.id) throw new Error(`${where} rejected: missing id`);
  if (seen.has(rule.id)) throw new Error(`${where} rejected: duplicate rule id — two packs claiming one id is ambiguous`);
  if (!rule.source || typeof rule.source.url !== 'string' || !/^https?:\/\//.test(rule.source.url)) {
    throw new Error(`${where} rejected: every rule must carry source.url — an unsourced compatibility claim is not admissible`);
  }
  if (!rule.source.recordedAt) throw new Error(`${where} rejected: source.recordedAt is required`);
  if (!rule.when || (!rule.when.package && !rule.when.fact)) throw new Error(`${where} rejected: 'when' must target a package or a fact`);
  if (!rule.require || (!rule.require.package && !rule.require.fact && !rule.require.absent)) {
    throw new Error(`${where} rejected: 'require' must target a package, a fact, or declare 'absent'`);
  }
  seen.add(rule.id);
}

/** Resolve a rule's `source`, which may be a key into the pack's `sources` map. */
function resolveSource(rule, pack) {
  if (typeof rule.source === 'string') {
    const s = pack.sources && pack.sources[rule.source];
    if (!s) throw new Error(`rule '${rule.id}' in pack '${pack.id}' references unknown source key '${rule.source}'`);
    return s;
  }
  return rule.source;
}

function normalisePack(pack, origin) {
  if (!pack || typeof pack.id !== 'string' || !pack.id) throw new Error(`${origin}: pack rejected — missing id`);
  if (!Array.isArray(pack.rules)) throw new Error(`${origin}: pack '${pack.id}' rejected — "rules" must be an array`);
  const rules = pack.rules.map(r => ({ ...r, source: resolveSource(r, pack), packId: pack.id }));
  const facts = Array.isArray(pack.facts) ? pack.facts.map(f => ({ ...f, packId: pack.id })) : [];
  return { id: pack.id, displayName: pack.displayName || pack.id, origin, rules, facts };
}

/**
 * Load packs from a directory (default `rulepacks/`), plus any supplied inline.
 * Returns { packs, rules, facts }.
 */
function loadRulePacks(options = {}) {
  const dir = options.dir === undefined ? PACK_DIR : options.dir;
  const packs = [];

  if (dir && fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const full = path.join(dir, file);
      let raw;
      try { raw = JSON.parse(fs.readFileSync(full, 'utf8')); }
      catch (err) { throw new Error(`${full}: rule pack could not be parsed — ${err.message}`); }
      packs.push(normalisePack(raw, full));
    }
  }
  for (const p of options.packs || []) packs.push(normalisePack(p, p.origin || 'inline'));

  const seen = new Set();
  const rules = [];
  for (const pack of packs) {
    for (const r of pack.rules) { validateRule(r, pack.id, seen); rules.push(r); }
  }

  // Fact declarations, de-duplicated by name. Two packs asking for the same
  // fact is fine; two packs asking for the same NAME from different files is
  // ambiguous and refused.
  const facts = [];
  const byName = new Map();
  for (const pack of packs) {
    for (const f of pack.facts) {
      if (!f.name || !f.file || !Array.isArray(f.path)) {
        throw new Error(`pack '${pack.id}': fact declaration needs "name", "file" and "path"`);
      }
      const prev = byName.get(f.name);
      if (prev && (prev.file !== f.file || prev.path.join('.') !== f.path.join('.'))) {
        throw new Error(`fact '${f.name}' declared differently by packs '${prev.packId}' and '${f.packId}' — ambiguous`);
      }
      if (!prev) { byName.set(f.name, f); facts.push(f); }
    }
  }

  return { packs, rules, facts };
}

module.exports = { loadRulePacks, normalisePack, validateRule, PACK_DIR };
