/**
 * Ecosystem: Python / pip
 *
 * Conforms to ECOSYSTEM_CONTRACT.md. Recognises requirements files and
 * pyproject.toml BY NAME, wherever they sit in the tree.
 *
 * The first version of this reader hardcoded `backend/requirements.txt` — one
 * specific application's folder layout, in the engine. It worked on that
 * application and would have found nothing anywhere else. Basenames only; never
 * a path.
 */

const REQ_RE = /^([A-Za-z0-9._-]+)(?:\[[^\]]*\])?\s*(===|==|>=|<=|~=|!=|>|<)?\s*([0-9][^\s;,]*)?/;

function parseRequirements(text, sourcePath) {
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line || line.startsWith('-')) continue;   // -r includes, -e editable, flags
    const m = REQ_RE.exec(line);
    if (!m) continue;
    const [, name, op, version] = m;
    if ((op === '==' || op === '===') && version) {
      out.push({ ecosystem: 'pip', name, version, declared: `${op}${version}`, provenance: 'OBSERVED', note: `pinned in ${sourcePath}` });
    } else if (version) {
      // A bound is not an installed version. Marking this OBSERVED would let the
      // engine assert compatibility about a version nobody installed.
      out.push({ ecosystem: 'pip', name, version, declared: `${op || ''}${version}`, provenance: 'INFERRED', note: `unpinned constraint in ${sourcePath}; installed version not known from this file` });
    } else {
      out.push({ ecosystem: 'pip', name, version: null, declared: line, provenance: 'UNKNOWN', note: `no version constraint in ${sourcePath}` });
    }
  }
  return out;
}

/**
 * Minimal pyproject.toml reading: the [project] version and [project]
 * dependencies list. Deliberately shallow — a full TOML parser is not shipped,
 * and anything not confidently understood is skipped rather than guessed at.
 */
function parsePyproject(text, sourcePath) {
  const packages = [];
  let selfVersion = null;

  const projectBlock = /\[project\]([\s\S]*?)(?=\n\[|$)/.exec(text);
  if (projectBlock) {
    const v = /^\s*version\s*=\s*["']([^"']+)["']/m.exec(projectBlock[1]);
    if (v) selfVersion = { value: v[1], provenance: 'OBSERVED', source: `${sourcePath} [project] version` };
  }

  const deps = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(text);
  if (deps) {
    for (const q of deps[1].split(/[\n,]/)) {
      const s = q.trim().replace(/^["']|["']$/g, '').trim();
      if (!s || s.startsWith('#')) continue;
      packages.push(...parseRequirements(s, sourcePath));
    }
  }
  return { packages, selfVersion };
}

module.exports = {
  id: 'pip',
  displayName: 'Python / pip',
  manifestFiles: ['requirements.txt', 'requirements-dev.txt', 'pyproject.toml'],
  ignoreDirs: ['venv', '.venv', 'site-packages', '__pycache__', '.tox'],

  read(files) {
    const packages = [];
    const warnings = [];
    let selfVersion = { value: null, provenance: 'UNKNOWN', source: 'no pyproject.toml [project] version found' };

    for (const f of files.values()) {
      if (f.basename === 'pyproject.toml') {
        const r = parsePyproject(f.text, f.path);
        packages.push(...r.packages);
        if (r.selfVersion && selfVersion.value === null) selfVersion = r.selfVersion;
      } else {
        packages.push(...parseRequirements(f.text, f.path));
      }
    }

    const unpinned = packages.filter(p => p.provenance !== 'OBSERVED').length;
    if (unpinned > 0) {
      warnings.push(`${unpinned} Python requirement(s) are not pinned with '=='; their installed versions are not known from these files.`);
    }
    return { packages, selfVersion, warnings };
  },

  // exported for tests
  parseRequirements, parsePyproject
};
