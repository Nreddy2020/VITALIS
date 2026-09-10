/**
 * VITALIS STAGE 3: Git Change Adapter (REAL — reads a real repository)
 *
 * Reads real commits out of a real git repository with real `git log`, and
 * converts them into VITALIS change events. There is no sample data in this
 * file: if the repo has no commits in the requested range, it returns none.
 *
 * This is the Tier B adapter pattern from ADAPTER_CONTRACT.md applied to a
 * change source instead of a telemetry source. A CI/CD webhook (GitHub Actions,
 * Jenkins, GitLab) or a change-management system (ServiceNow, Remedy) plugs in
 * the same way: read the real event, map it to this shape, POST it to
 * /v1/changes. Nothing downstream cares where a change came from.
 */

const { execFile } = require('child_process');
const http = require('http');

// Unit-separator delimited so commit subjects containing pipes/commas survive intact.
const SEP = '\x1f';
const REC = '\x1e';
// The record separator LEADS each record. It must not trail: with --name-only,
// git prints the changed-file list *after* the formatted header, so a trailing
// separator would push each commit's files into the next commit's record and
// the following header line would be parsed as a filename.
const LOG_FORMAT = REC + ['%H', '%aI', '%an', '%s'].join(SEP);

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`git ${args.join(' ')} failed: ${(stderr || err.message).trim()}`));
      resolve(stdout);
    });
  });
}

/**
 * Read real commits from a real repo.
 * @param repoPath  path to a real git working tree
 * @param opts.since  git --since expression (e.g. "24 hours ago"), optional
 * @param opts.maxCount  cap on commits returned (default 50)
 * @param opts.service  the service these commits deploy to, if known
 */
async function readCommits(repoPath, { since, maxCount = 50, service = null } = {}) {
  const args = ['log', `--pretty=format:${LOG_FORMAT}`, '--name-only', `--max-count=${maxCount}`];
  if (since) args.push(`--since=${since}`);

  const stdout = await git(args, repoPath);
  if (!stdout.trim()) return [];

  return stdout.split(REC)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const [header, ...fileLines] = block.split('\n');
      const [sha, authorDate, author, subject] = header.split(SEP);
      const filesChanged = fileLines.map(l => l.trim()).filter(Boolean);
      return {
        id: `CHG-GIT-${(sha || '').slice(0, 12)}`,
        timestamp: authorDate,            // real ISO-8601 author date from git
        type: 'CODE_COMMIT',
        service,
        version: (sha || '').slice(0, 7),
        commit: sha,
        author,
        description: subject,
        filesChanged
      };
    })
    .filter(c => c.commit);
}

/** Is this path actually a git repository? */
async function isGitRepo(repoPath) {
  try {
    const out = await git(['rev-parse', '--is-inside-work-tree'], repoPath);
    return out.trim() === 'true';
  } catch (err) {
    return false;
  }
}

function postToVitalis(vitalisConfig, changeEvents) {
  const body = JSON.stringify({ changeEvents });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: vitalisConfig.host || 'localhost',
      port: vitalisConfig.port || 4318,
      path: '/v1/changes',
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

/** Read a real repo and report its real commits to VITALIS. */
async function syncRepo(repoPath, vitalisConfig, opts = {}) {
  if (!(await isGitRepo(repoPath))) {
    throw new Error(`${repoPath} is not a git repository — nothing to read`);
  }
  const changeEvents = await readCommits(repoPath, opts);
  if (!changeEvents.length) return { changeEvents: [], postResult: null };
  const postResult = await postToVitalis(vitalisConfig, changeEvents);
  return { changeEvents, postResult };
}

module.exports = { readCommits, isGitRepo, syncRepo, postToVitalis };

// Runnable directly:
//   VITALIS_API_KEY=... node engine/adapters/git_change_adapter.js /path/to/repo "24 hours ago"
if (require.main === module) {
  const repoPath = process.argv[2] || process.cwd();
  const since = process.argv[3] || '7 days ago';
  const vitalisConfig = {
    host: process.env.VITALIS_HOST || 'localhost',
    port: process.env.PORT || 4318,
    apiKey: process.env.VITALIS_API_KEY
  };
  if (!vitalisConfig.apiKey) {
    console.error('[git_change_adapter] Set VITALIS_API_KEY to the key your VITALIS server is using.');
    process.exit(1);
  }
  syncRepo(repoPath, vitalisConfig, { since, service: process.env.VITALIS_SERVICE || null })
    .then(r => {
      console.log(`[git_change_adapter] Read ${r.changeEvents.length} real commit(s) from ${repoPath} since "${since}".`);
      if (r.postResult) console.log('[git_change_adapter] VITALIS response:', r.postResult.status, r.postResult.data);
    })
    .catch(err => { console.error('[git_change_adapter]', err.message); process.exit(1); });
}
