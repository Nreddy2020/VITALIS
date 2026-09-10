'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startPilot } = require('./serve_relationship_pilot');
async function main() {
  const finMode = process.argv.includes('--fin');
  const mobileMode = process.argv.includes('--mobile');
  const pilot = await startPilot(4358, mobileMode ? 'mobile' : finMode ? 'fin' : 'fixtures');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PILOT_BROWSER || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pilot.base);
    await page.locator('#apiKey').fill('local-pilot-test'); await page.locator('#connectBtn').click();
    if (mobileMode) {
      const report = JSON.parse(fs.readFileSync('artifacts/mobile-pilot/run-002/mobile-capture-tests.json'));
      const traceId = report.reports[0].traceId;
      await page.locator('[data-id="' + traceId + '"]').first().click();
      await page.locator('#compatibilityEvidence p.sub').filter({ hasText: 'REPLAY OF REAL ISOLATED FIN MOBILE CAPTURE' }).waitFor();
      const content = await page.locator('#compatibilityEvidence').innerText();
      assert.match(content, /fin-mobile-isolated → fin-backend-isolated/);
      assert.match(content, /OBSERVED_BOUNDARY/);
      assert.match(content, /UNKNOWN/);
      assert.match(content, /unchecked interactions: 1/);
      assert.equal(await page.locator('#compatibilityEvidence .ok').count(), 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.resolve('artifacts/mobile-pilot/console-mobile-capture.png'), fullPage: true });
      fs.writeFileSync('artifacts/mobile-pilot/mobile-console-tests.json', JSON.stringify({ runAt: new Date().toISOString(), status: 'PASS', traceId, checks: ['Actual capture replay label', 'Observed mobile/backend boundary', 'Database boundary unknown and no green compatibility', 'No browser errors'] }, null, 2));
      console.log('PASS: 4 mobile capture dashboard checks');
      return;
    }
    if (finMode) {
      const traces = await (await fetch(pilot.base + '/api/traces', { headers: pilot.headers })).json();
      let healthId;
      for (const t of traces.traces) {
        const d = await (await fetch(pilot.base + '/api/traces/' + t.traceId, { headers: pilot.headers })).json();
        if (d.hops.some(h => h.name === 'GET /health' && h.kind === 2)) { healthId = t.traceId; break; }
      }
      assert.ok(healthId);
      await page.locator('[data-id="' + healthId + '"]').first().click();
      await page.locator('#compatibilityEvidence p.sub').filter({ hasText: 'REPLAY OF REAL FIN HEALTH CAPTURE' }).waitFor();
      const content = await page.locator('#compatibilityEvidence').innerText();
      assert.match(content, /unchecked interactions: 1/); assert.match(content, /fin-health-pilot/);
      assert.equal(await page.locator('#compatibilityEvidence .ok').count(), 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.resolve('artifacts/pilot/console-fin-capture.png'), fullPage: true });
      fs.writeFileSync('artifacts/pilot/fin-console-tests.json', JSON.stringify({ runAt: new Date().toISOString(), status: 'PASS', checks: ['Recorded real FIN capture label is visible', 'One unobserved DB boundary and UNKNOWN are visible, no green evidence', 'No browser JavaScript errors'], traceId: healthId }, null, 2));
      console.log('PASS: 3 real FIN replay browser checks');
      return;
    }
    await page.locator('[data-id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]').first().click();
    await page.locator('#compatibilityEvidence p.bad').filter({ hasText: 'CONTROLLED FIXTURE' }).waitFor();
    let content = await page.locator('#compatibilityEvidence').innerText();
    assert.match(content, /python-api → mongo-db/); assert.match(content, /VIOLATED/); assert.match(content, /INFERRED/);
    assert.match(content, /What would change/); assert.match(content, /UNKNOWN/);
    assert.ok(await page.locator('#compatibilityEvidence a[href^="https://www.mongodb.com/"]').count());
    await page.screenshot({ path: path.resolve('artifacts/pilot/console-violation.png'), fullPage: true });
    await page.locator('[data-id="cccccccccccccccccccccccccccccccc"]').first().click();
    await page.waitForFunction(() => document.querySelector('#detailTraceId').textContent === 'cccccccccccccccccccccccccccccccc');
    content = await page.locator('#compatibilityEvidence').innerText();
    assert.match(content, /UNKNOWN/); assert.match(content, /No applicable sourced rule/);
    assert.equal(await page.locator('#compatibilityEvidence .ok').count(), 0);
    await page.screenshot({ path: path.resolve('artifacts/pilot/console-unknown.png'), fullPage: true });
    // Render hostile sender input through the real ingestion/API/UI path.
    const { fixture, otlp } = require('./fixtures/relationship_pilot');
    const f = fixture(); f.trace.traceId = 'dddddddddddddddddddddddddddddddd'; f.trace.hops[0].service = '<img src=x onerror="window.pilotXss=1">';
    await fetch(pilot.base + '/v1/traces', { method: 'POST', headers: pilot.headers, body: JSON.stringify(otlp(f)) });
    await page.locator('[data-id="dddddddddddddddddddddddddddddddd"]').first().click();
    await page.waitForFunction(() => document.querySelector('#detailTraceId').textContent === 'dddddddddddddddddddddddddddddddd');
    assert.equal(await page.evaluate(() => window.pilotXss), undefined); assert.equal(await page.locator('#compatibilityEvidence img').count(), 0);
    assert.deepEqual(errors, []);
    fs.writeFileSync('artifacts/pilot/console-tests.json', JSON.stringify({ runAt: new Date().toISOString(), status: 'PASS', checks: ['Live fixture path, verdict, provenance, sources and next evidence rendered', 'Missing identity remains UNKNOWN with zero green elements', 'Sender HTML is escaped', 'No browser JavaScript errors'], browser: await browser.version() }, null, 2));
    console.log('PASS: 4 real browser checks');
  } finally { if (browser) await browser.close(); await pilot.stopServer(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
