/**
 * VITALIS STAGE 2 — GUI Verification (real browser, real data, no fixtures)
 *
 * The old front end (preserved as demo_cinematic.html) made ZERO network calls —
 * every number and narrative line in it was hardcoded, including the transaction
 * id "TX-847392". This suite proves the rebuilt console is the opposite: it
 * renders only what the engine actually ingested, and it updates live when real
 * telemetry arrives.
 *
 * It drives a real Chromium browser via Playwright against a real running server:
 *
 *   G1  Empty engine  -> the UI says so honestly instead of showing demo data.
 *   G2  Real Postgres lock contention (a real transaction holding a real row
 *       lock, a second real connection genuinely blocked behind it, observed by
 *       engine/adapters/postgres_adapter.js) -> the browser updates LIVE over
 *       SSE, with no reload, and renders the real backend PID and wait time.
 *   G3  The old hardcoded demo values (TX-847392, 2,100ms, PID #99142) appear
 *       nowhere in the rendered DOM.
 *   G4  Missing evidence renders as an explicit UNKNOWN tag, not a fabricated
 *       number (db.cpu_utilization_pct, which Postgres cannot report).
 *
 * Requires: `npm i -D playwright` and a reachable Postgres (PGHOST/PGPORT/
 * PGUSER/PGPASSWORD/PGDATABASE, defaults localhost/5432/postgres/postgres/
 * vitalis_pilot). Not wired into `test:all` because it needs both.
 *
 * Outputs: artifacts/stage2-gui-gate-report.json
 *          artifacts/stage2-gui-empty.png, artifacts/stage2-gui-live.png
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  console.error('[SKIP] playwright is not installed. Run: npm i -D playwright');
  process.exit(1);
}

const TEST_API_KEY = 'stage2-gui-test-key';
process.env.VITALIS_API_KEY = TEST_API_KEY;
process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-stage2-gui-'));

const { startServer, stopServer } = require('../server');
const { makePool, pollAndReport } = require('../engine/adapters/postgres_adapter');

const TEST_PORT = 4326;
const BASE = `http://localhost:${TEST_PORT}`;

const PG_CONFIG = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'vitalis_pilot'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const artifactsDir = path.join(__dirname, '..', 'artifacts');

async function run() {
  console.log('==================================================================');
  console.log('     VITALIS STAGE 2 — GUI VERIFICATION (REAL BROWSER + DATA)     ');
  console.log('==================================================================\n');
  const report = { version: '1.0', testRun: `VITALIS-STAGE2-GUI-${Date.now()}`, timestamp: new Date().toISOString(), gates: {} };
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

  await startServer(TEST_PORT);
  // Honour an explicitly provided browser binary (CI images often ship one
  // already, and re-downloading a second copy per Playwright version is waste).
  const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Supply the API key the same way a real operator would (it is persisted to
  // sessionStorage by the Connect button) so the page authenticates on boot.
  await context.addInitScript(key => {
    try { sessionStorage.setItem('vitalis_api_key', key); } catch (e) {}
  }, TEST_API_KEY);
  const page = await context.newPage();

  let holder, blocker, pool;

  try {
    // ---------------------------------------------------------------
    console.log('--- [GATE G1] Empty engine -> honest empty state, not demo data ---');
    // NOT 'networkidle': the console holds a deliberate long-lived SSE connection,
    // so the network never goes idle while the page is healthy.
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const emptyVisible = await page.locator('#emptyState').isVisible();
    const emptyText = await page.locator('#emptyState h3').textContent();
    const detailHidden = !(await page.locator('#detail').isVisible());
    await page.screenshot({ path: path.join(artifactsDir, 'stage2-gui-empty.png') });
    report.gates.honestEmptyState = (emptyVisible && detailHidden && /No telemetry ingested yet/i.test(emptyText)) ? 'PASS' : 'FAIL';
    console.log(`> Empty state visible: ${emptyVisible} ("${(emptyText || '').trim()}")`);
    console.log(`> Detail panel correctly hidden: ${detailHidden}`);
    console.log(`RESULT GATE G1: [${report.gates.honestEmptyState}]\n`);

    // ---------------------------------------------------------------
    console.log('--- [GATE G2] Real Postgres lock contention -> live UI update, no reload ---');
    const setup = new Client(PG_CONFIG);
    await setup.connect();
    await setup.query('CREATE TABLE IF NOT EXISTS inventory_items (sku_id INT PRIMARY KEY, qty INT NOT NULL);');
    await setup.query('INSERT INTO inventory_items (sku_id, qty) VALUES (847, 100) ON CONFLICT (sku_id) DO UPDATE SET qty = 100;');
    await setup.end();

    holder = new Client(PG_CONFIG);
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT * FROM inventory_items WHERE sku_id = 847 FOR UPDATE;');
    const holderPid = holder.processID;

    blocker = new Client(PG_CONFIG);
    await blocker.connect();
    const blockerPid = blocker.processID;
    const blockedPromise = blocker.query('UPDATE inventory_items SET qty = qty - 1 WHERE sku_id = 847;');
    blockedPromise.catch(() => {});
    await sleep(1600); // let Postgres actually register the block and accrue wait time
    console.log(`> Real Postgres block in place: pid ${blockerPid} blocked by pid ${holderPid}`);

    // The browser stays on the page it already loaded — no navigation, no reload.
    pool = makePool(PG_CONFIG);
    const traceId = `TX-STAGE2-GUI-${Date.now()}`;
    const polled = await pollAndReport(pool, { host: 'localhost', port: TEST_PORT, apiKey: TEST_API_KEY }, traceId);
    const obs = polled.find(p => p.observation.blockedPid === blockerPid);
    console.log(`> Adapter reported real observation: ${JSON.stringify(obs && obs.observation)}`);

    // Wait for the SSE-driven update to land in the DOM (no page.reload() anywhere).
    await page.waitForFunction(
      id => document.querySelector('#traceList') && document.querySelector('#traceList').textContent.includes(id),
      traceId,
      { timeout: 8000 }
    );
    const liveUpdated = true;
    await page.waitForTimeout(500);

    // Confirm no navigation happened — this DOM is the one loaded while empty.
    const sameDocument = await page.evaluate(() => performance.getEntriesByType('navigation').length === 1);

    await page.locator('.trace-btn').first().click();
    await page.waitForTimeout(400);
    await page.locator('.tabs button[data-tab="evidence"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(artifactsDir, 'stage2-gui-live.png'), fullPage: true });

    const bodyText = await page.locator('body').innerText();
    const showsRealPid = bodyText.includes(String(holderPid));
    const showsRealTrace = bodyText.includes(traceId);
    report.gates.liveUpdateFromRealTelemetry = (liveUpdated && sameDocument && showsRealPid && showsRealTrace) ? 'PASS' : 'FAIL';
    report.observedPid = holderPid;
    report.traceId = traceId;
    console.log(`> UI updated live over SSE with no reload (single navigation entry): ${sameDocument}`);
    console.log(`> Renders the real trace id ingested just now: ${showsRealTrace}`);
    console.log(`> Renders the real holding-lock PID #${holderPid} observed in Postgres: ${showsRealPid}`);
    console.log(`RESULT GATE G2: [${report.gates.liveUpdateFromRealTelemetry}]\n`);

    // ---------------------------------------------------------------
    console.log('--- [GATE G3] Old hardcoded demo values appear nowhere ---');
    const noDemoTrace = !bodyText.includes('TX-847392');
    const noDemoWait = !bodyText.includes('2,100ms') && !bodyText.includes('2100ms');
    const noDemoPid = !bodyText.includes('99142');
    report.gates.noHardcodedDemoValues = (noDemoTrace && noDemoWait && noDemoPid) ? 'PASS' : 'FAIL';
    console.log(`> "TX-847392" absent: ${noDemoTrace} | "2,100ms" absent: ${noDemoWait} | "99142" absent: ${noDemoPid}`);
    console.log(`RESULT GATE G3: [${report.gates.noHardcodedDemoValues}]\n`);

    // ---------------------------------------------------------------
    console.log('--- [GATE G4] Missing evidence renders as an explicit UNKNOWN tag ---');
    const unknownTags = await page.locator('.tag.UNKNOWN').count();
    const mentionsCpuUnknown = /UNKNOWN/.test(bodyText) && /cpu/i.test(bodyText);
    report.gates.honestUnknownRendering = (unknownTags > 0 && mentionsCpuUnknown) ? 'PASS' : 'FAIL';
    console.log(`> UNKNOWN-tagged evidence lines rendered: ${unknownTags}`);
    console.log(`> CPU utilization shown as UNKNOWN (Postgres cannot report it): ${mentionsCpuUnknown}`);
    console.log(`RESULT GATE G4: [${report.gates.honestUnknownRendering}]\n`);

    // ---------------------------------------------------------------
    // GATE G5 — an UNMEASURED request must never be rendered as healthy
    // ---------------------------------------------------------------
    // The console previously rendered a request with no learned baseline as
    // class "ok" (green) with the caption "No deviation from the golden
    // baseline". "Nothing found" and "nothing checked" looked identical, which
    // is non-negotiable #4 broken by the UI itself. This trace has only one
    // observation, so it cannot have a baseline.
    console.log('--- [GATE G5] A request with no baseline is UNKNOWN on screen, not green ---');
    const kvText = await page.textContent('#detailKv');
    const devText = await page.textContent('#deviations');
    const verdictClass = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('#detailKv .k'));
      const c = cells.find(el => el.textContent.trim() === 'Verdict');
      return c && c.nextElementSibling ? c.nextElementSibling.className : null;
    });
    const saysUnknown = /UNKNOWN/.test(kvText);
    const notFalselyClean = !/No deviation from the golden baseline/.test(devText);
    const explains = /not healthy and not deviating|has NOT been checked|observations needed/i.test(devText);
    const verdictNotGreen = verdictClass !== null && !/\bok\b/.test(verdictClass);
    report.gates.unmeasuredNotRenderedHealthy =
      (saysUnknown && notFalselyClean && explains && verdictNotGreen) ? 'PASS' : 'FAIL';
    console.log(`> Verdict cell class            : ${verdictClass} (must not be "ok"/green)`);
    console.log(`> Summary row mentions UNKNOWN  : ${saysUnknown}`);
    console.log(`> Old false caption gone        : ${notFalselyClean}`);
    console.log(`> Explains why it is unmeasured : ${explains}`);
    console.log(`RESULT GATE G5: [${report.gates.unmeasuredNotRenderedHealthy}]\n`);

    await holder.query('ROLLBACK');
    await blockedPromise.catch(() => {});

  } finally {
    try { if (holder) await holder.end(); } catch (e) {}
    try { if (blocker) await blocker.end(); } catch (e) {}
    try { if (pool) await pool.end(); } catch (e) {}
    await browser.close();
    await stopServer();
    console.log('[CLEANUP] Browser closed, lock released, test server stopped.\n');
  }

  const allPassed = Object.values(report.gates).every(v => v === 'PASS');
  console.log('==================================================================');
  console.log(`OVERALL: ${allPassed ? 'ALL STAGE 2 GUI GATES PASSED' : 'ONE OR MORE GATES FAILED'}`);
  console.log(`Screenshots: artifacts/stage2-gui-empty.png, artifacts/stage2-gui-live.png`);
  console.log('==================================================================');

  fs.writeFileSync(path.join(artifactsDir, 'stage2-gui-gate-report.json'), JSON.stringify(report, null, 2));
  process.exit(allPassed ? 0 : 1);
}

run().catch(err => { console.error('[FATAL]', err); process.exit(1); });
