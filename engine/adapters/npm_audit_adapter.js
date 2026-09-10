/**
 * VITALIS STAGE 3: npm audit Adapter (REAL — queries the real npm registry)
 *
 * Runs a real `npm audit --json` against a real project directory and converts
 * the real advisories the registry returns into VITALIS advisory shape. It also
 * reads the project's real installed component list from `npm ls --json`, which
 * becomes the service's component inventory (SBOM slice).
 *
 * No advisory in this file is hardcoded. If the project has no vulnerable
 * dependencies, it returns none — which is the correct answer, not a failure.
 *
 * The same adapter pattern applies to any other scanner: Trivy, Grype, Snyk,
 * OWASP Dependency-Check, an OSV.dev query, or a vendor SBOM feed. Map the real
 * scanner output to { id, package, ecosystem, severity, title, url, cwe, cvss,
 * vulnerableRange } and POST it to /v1/vulnerabilities.
 */

const { execFile } = require('child_process');
const http = require('http');

function runNpm(args, cwd) {
  return new Promise(resolve => {
    // npm audit exits non-zero when vulnerabilities are found — that is a
    // finding, not a failure, so resolve on error and let the caller parse.
    execFile('npm', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', failed: !!err && !stdout });
    });
  });
}

/** Real advisories for a real project directory. */
async function auditProject(projectPath) {
  const { stdout, stderr, failed } = await runNpm(['audit', '--json'], projectPath);
  if (failed) throw new Error(`npm audit produced no output in ${projectPath}: ${stderr.trim().slice(0, 300)}`);

  let parsed;
  try { parsed = JSON.parse(stdout); }
  catch (err) { throw new Error(`npm audit returned unparseable JSON: ${err.message}`); }

  const advisories = new Map();
  for (const [pkgName, entry] of Object.entries(parsed.vulnerabilities || {})) {
    for (const via of entry.via || []) {
      // A string `via` is a transitive pointer to another package, not an
      // advisory record — the advisory itself is picked up under that package.
      if (typeof via === 'string' || !via || !via.url) continue;
      const id = advisoryIdFrom(via);
      if (!id || advisories.has(id)) continue;
      advisories.set(id, {
        id,
        package: via.name || pkgName,
        ecosystem: 'npm',
        severity: via.severity || entry.severity || 'unknown',
        title: via.title || '',
        url: via.url || null,
        cwe: Array.isArray(via.cwe) ? via.cwe : [],
        cvss: via.cvss && typeof via.cvss.score === 'number'
          ? { score: via.cvss.score, vectorString: via.cvss.vectorString || null } : null,
        vulnerableRange: via.range || null
      });
    }
  }
  return [...advisories.values()];
}

/** Prefer the real GHSA id from the advisory URL; fall back to npm's numeric source id. */
function advisoryIdFrom(via) {
  const match = /\/advisories\/(GHSA-[a-z0-9-]+)/i.exec(via.url || '');
  if (match) return match[1];
  return via.source ? `NPM-${via.source}` : null;
}

/** The project's real installed dependency list — its component inventory. */
async function inventoryProject(projectPath, { depth = 0 } = {}) {
  const { stdout } = await runNpm(['ls', '--json', `--depth=${depth}`], projectPath);
  let parsed;
  try { parsed = JSON.parse(stdout || '{}'); } catch (err) { return []; }

  const components = [];
  const walk = deps => {
    for (const [name, info] of Object.entries(deps || {})) {
      if (!info) continue;
      components.push({ name, version: info.version || null, ecosystem: 'npm' });
      if (info.dependencies) walk(info.dependencies);
    }
  };
  walk(parsed.dependencies);
  return components;
}

function post(vitalisConfig, path, payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: vitalisConfig.host || 'localhost',
      port: vitalisConfig.port || 4318,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-vitalis-api-key': vitalisConfig.apiKey,
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Scan a real project and report both its real inventory and real advisories
 * to VITALIS, attributed to the service that runs it.
 */
async function scanAndReport(projectPath, service, vitalisConfig, opts = {}) {
  const [components, advisories] = await Promise.all([
    inventoryProject(projectPath, opts),
    auditProject(projectPath)
  ]);
  const inventoryResult = await post(vitalisConfig, '/v1/components', { service, components });
  const advisoryResult = advisories.length
    ? await post(vitalisConfig, '/v1/vulnerabilities', { advisories })
    : null;
  return { components, advisories, inventoryResult, advisoryResult };
}

module.exports = { auditProject, inventoryProject, scanAndReport, post };

// Runnable directly:
//   VITALIS_API_KEY=... node engine/adapters/npm_audit_adapter.js /path/to/project ServiceName
if (require.main === module) {
  const projectPath = process.argv[2] || process.cwd();
  const service = process.argv[3] || process.env.VITALIS_SERVICE;
  const vitalisConfig = {
    host: process.env.VITALIS_HOST || 'localhost',
    port: process.env.PORT || 4318,
    apiKey: process.env.VITALIS_API_KEY
  };
  if (!vitalisConfig.apiKey || !service) {
    console.error('[npm_audit_adapter] Usage: VITALIS_API_KEY=... node engine/adapters/npm_audit_adapter.js <projectPath> <serviceName>');
    process.exit(1);
  }
  scanAndReport(projectPath, service, vitalisConfig)
    .then(r => {
      console.log(`[npm_audit_adapter] ${service}: ${r.components.length} real component(s), ${r.advisories.length} real advisory(ies).`);
      r.advisories.forEach(a => console.log(`  - ${a.id} ${a.severity} ${a.package} ${a.vulnerableRange || ''}`));
    })
    .catch(err => { console.error('[npm_audit_adapter]', err.message); process.exit(1); });
}
