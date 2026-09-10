/**
 * Ecosystem: npm / Node.js
 *
 * Conforms to ECOSYSTEM_CONTRACT.md. Knows about package.json and
 * package-lock.json and nothing else — no framework, no folder layout, no
 * application. Expo, Next.js and plain Node all read identically here; what
 * distinguishes them lives in rule packs, not in this file.
 */

const { coerceDeclaredRange } = require('../version_ops');

function resolvedFromLock(lock) {
  const out = new Map();
  if (!lock) return out;
  if (lock.packages && typeof lock.packages === 'object') {
    for (const [key, entry] of Object.entries(lock.packages)) {
      if (!key.startsWith('node_modules/')) continue;
      const name = key.slice('node_modules/'.length);
      if (name.includes('/node_modules/')) continue;  // a nested copy, not the top-level resolution
      if (entry && typeof entry.version === 'string') out.set(name, entry.version);
    }
  }
  if (out.size === 0 && lock.dependencies && typeof lock.dependencies === 'object') {
    for (const [name, entry] of Object.entries(lock.dependencies)) {
      if (entry && typeof entry.version === 'string') out.set(name, entry.version);
    }
  }
  return out;
}

module.exports = {
  id: 'npm',
  displayName: 'npm / Node.js',
  manifestFiles: ['package.json', 'package-lock.json'],
  ignoreDirs: ['node_modules'],

  read(files) {
    const warnings = [];
    const packages = [];
    let selfVersion = { value: null, provenance: 'UNKNOWN', source: 'no package.json found' };

    // Group by directory: one package.json + its sibling lockfile is one component.
    const byDir = new Map();
    for (const f of files.values()) {
      if (!byDir.has(f.dir)) byDir.set(f.dir, {});
      byDir.get(f.dir)[f.basename] = f;
    }

    for (const [dir, group] of byDir) {
      const pkgFile = group['package.json'];
      if (!pkgFile) continue;

      let pkg = null;
      try { pkg = JSON.parse(pkgFile.text); }
      catch (err) { warnings.push(`${pkgFile.path}: could not be parsed — ${err.message}`); continue; }

      let lock = null;
      if (group['package-lock.json']) {
        try { lock = JSON.parse(group['package-lock.json'].text); }
        catch (err) { warnings.push(`${group['package-lock.json'].path}: could not be parsed — ${err.message}`); }
      } else {
        warnings.push(
          `${dir}: no package-lock.json. npm versions from here are the FLOOR of a declared range, ` +
          `not the version that will install — findings are marked INFERRED.`
        );
      }
      const resolved = resolvedFromLock(lock);

      if (selfVersion.value === null && typeof pkg.version === 'string') {
        selfVersion = { value: pkg.version, provenance: 'OBSERVED', source: `${pkgFile.path} "version"` };
      }

      const add = (name, range, dev) => {
        const res = resolved.get(name);
        if (res) {
          packages.push({ ecosystem: 'npm', name, version: res, declared: range, dev, provenance: 'OBSERVED', note: 'resolved in package-lock.json' });
          return;
        }
        const c = coerceDeclaredRange(range);
        packages.push({
          ecosystem: 'npm', name,
          version: c.version ? c.version.raw : null,
          declared: range, dev,
          provenance: c.version ? 'INFERRED' : 'UNKNOWN',
          note: c.version ? c.reason : (c.reason || 'no version could be established')
        });
      };

      for (const [n, r] of Object.entries(pkg.dependencies || {})) add(n, r, false);
      for (const [n, r] of Object.entries(pkg.devDependencies || {})) add(n, r, true);
    }

    return { packages, selfVersion, warnings };
  }
};
