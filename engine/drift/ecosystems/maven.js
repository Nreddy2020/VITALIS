/**
 * Ecosystem: Java / Maven
 *
 * Conforms to ECOSYSTEM_CONTRACT.md.
 *
 * This module exists as much to prove a point as to be useful: it shares no
 * code, no assumption and no vocabulary with the JavaScript readers, and the
 * engine treats it identically. A Java estate — WebSphere, JBoss, Spring — is
 * read by the same checker, through the same rules format, with the same
 * provenance discipline.
 *
 * DELIBERATE LIMITS, all failing closed:
 *
 *  - No XML library is shipped, so this reads `<dependency>` blocks directly.
 *    It is a reader for well-formed poms, not a Maven implementation.
 *  - `${property}` versions are NOT resolved. Property resolution involves
 *    parent poms, profiles, and settings this reader cannot see, and a wrong
 *    version is worse than no version — so these are reported UNKNOWN.
 *  - Versions supplied by `<dependencyManagement>` or a parent pom are absent
 *    from the dependency block, and are likewise UNKNOWN rather than guessed.
 *
 * Every one of those limits shows up in the coverage report as UNKNOWN, which
 * is the honest outcome. Silently inventing versions to reduce that count would
 * be the failure this whole contract exists to prevent.
 */

const DEP_BLOCK = /<dependency>([\s\S]*?)<\/dependency>/g;
const tag = (xml, name) => {
  const m = new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
};

function stripComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function parsePom(text, sourcePath) {
  const xml = stripComments(text);
  const packages = [];

  // The project's own version, falling back to the parent's as Maven does.
  const head = xml.slice(0, xml.search(/<(dependencies|build|profiles|modules)\b/) === -1
    ? xml.length
    : xml.search(/<(dependencies|build|profiles|modules)\b/));
  let selfVersion = null;
  const ownVersion = tag(head.replace(/<parent>[\s\S]*?<\/parent>/, ''), 'version');
  if (ownVersion && !ownVersion.includes('${')) {
    selfVersion = { value: ownVersion, provenance: 'OBSERVED', source: `${sourcePath} <project><version>` };
  } else {
    const parent = /<parent>([\s\S]*?)<\/parent>/.exec(head);
    const pv = parent ? tag(parent[1], 'version') : null;
    if (pv && !pv.includes('${')) {
      selfVersion = { value: pv, provenance: 'INFERRED', source: `${sourcePath} — inherited from <parent><version>` };
    }
  }

  let m;
  DEP_BLOCK.lastIndex = 0;
  while ((m = DEP_BLOCK.exec(xml)) !== null) {
    const block = m[1];
    const groupId = tag(block, 'groupId');
    const artifactId = tag(block, 'artifactId');
    if (!groupId || !artifactId) continue;
    const name = `${groupId}:${artifactId}`;
    const version = tag(block, 'version');
    const scope = tag(block, 'scope');
    const dev = scope === 'test' || scope === 'provided';

    if (!version) {
      packages.push({
        ecosystem: 'maven', name, version: null, declared: null, dev,
        provenance: 'UNKNOWN',
        note: `no <version> in ${sourcePath} — supplied by dependencyManagement or a parent pom, which this reader does not resolve`
      });
    } else if (version.includes('${')) {
      packages.push({
        ecosystem: 'maven', name, version: null, declared: version, dev,
        provenance: 'UNKNOWN',
        note: `version is the property ${version}; property resolution needs parent poms and profiles this reader cannot see, so it is not guessed`
      });
    } else if (/^[\[\(]/.test(version)) {
      packages.push({
        ecosystem: 'maven', name, version: null, declared: version, dev,
        provenance: 'UNKNOWN',
        note: `version range ${version} — the resolved version depends on what is in the repository at build time`
      });
    } else {
      packages.push({
        ecosystem: 'maven', name, version, declared: version, dev,
        provenance: 'OBSERVED',
        note: `literal <version> in ${sourcePath}`
      });
    }
  }
  return { packages, selfVersion };
}

module.exports = {
  id: 'maven',
  displayName: 'Java / Maven',
  manifestFiles: ['pom.xml'],
  ignoreDirs: ['target'],

  read(files) {
    const packages = [];
    const warnings = [];
    let selfVersion = { value: null, provenance: 'UNKNOWN', source: 'no resolvable <version> in any pom.xml' };

    for (const f of files.values()) {
      const r = parsePom(f.text, f.path);
      packages.push(...r.packages);
      if (r.selfVersion && selfVersion.value === null) selfVersion = r.selfVersion;
    }

    const unresolved = packages.filter(p => p.provenance === 'UNKNOWN').length;
    if (unresolved > 0) {
      warnings.push(
        `${unresolved} Maven dependency version(s) could not be resolved from the pom alone ` +
        `(properties, ranges, or dependencyManagement). They are UNKNOWN, not assumed.`
      );
    }
    return { packages, selfVersion, warnings };
  },

  parsePom
};
