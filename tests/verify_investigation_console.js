'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { startPilot } = require('./serve_relationship_pilot');
async function main() {
  const pilot = await startPilot(4358, 'mobile');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PILOT_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pilot.base); await page.locator('#apiKey').fill('local-pilot-test'); await page.locator('#connectBtn').click();
    await page.locator('#investigationWorklist .trace-btn').first().waitFor();
    assert.match(await page.locator('#investigationWorklist').innerText(), /EVIDENCE_NEEDED/);
    const traceId = 'c4b6bfebbdf71a25e26d910fb1681aab';
    await page.locator('[data-id="' + traceId + '"]').first().click();
    await page.locator('#investigationFacts').getByText('HTTP_RESPONSE_OBSERVED', { exact: false }).waitFor();
    const facts = await page.locator('#investigationFacts').innerText();
    assert.match(facts, /358ms/); assert.match(facts, /Business result: UNKNOWN/);
    assert.match(facts, /REPLAY OF REAL ISOLATED FIN MOBILE CAPTURE/);
    await page.screenshot({ path: 'artifacts/investigation/request-facts.png', fullPage: true });
    await page.locator('[data-tab="next"]').click();
    assert.match(await page.locator('#recommendation').innerText(), /Collect the missing peer evidence/);
    assert.match(await page.locator('#recommendation').innerText(), /Verify the functional result/);
    assert.match(await page.locator('#stepper').innerText(), /NOT REQUESTED/);
    assert.equal(await page.locator('#stepper .done').count(), 0);
    await page.screenshot({ path: 'artifacts/investigation/diagnostic-plan.png', fullPage: true });
    const { fixture, otlp } = require('./fixtures/relationship_pilot');
    const f = fixture(); f.trace.traceId = 'e'.repeat(32);
    f.trace.hops[0].service = '<img src=x onerror="window.investigationXss=1">';
    await fetch(pilot.base + '/v1/traces', { method: 'POST', headers: pilot.headers, body: JSON.stringify(otlp(f)) });
    await page.locator('#overviewBtn').click();
    await page.locator('[data-id="' + f.trace.traceId + '"]').first().click();
    await page.locator('[data-tab="journey"]').click();
    await page.waitForFunction(() => document.querySelector('#detailTraceId').textContent === 'e'.repeat(32));
    assert.equal(await page.evaluate(() => window.investigationXss), undefined);
    assert.equal(await page.locator('#investigationWorklist img, #investigationFacts img').count(), 0);
    assert.deepEqual(errors, []);
    fs.writeFileSync('artifacts/investigation/console-verification.json', JSON.stringify({ status: 'PASS', runAt: new Date().toISOString(), checks: [
      'Worklist exposes retained requests with evidence gaps', 'Real FIN root duration 358ms, not overlapping span sum',
      'Functional result unknown and replay context visible', 'Gap-linked diagnostics with no invented execution progress',
      'Hostile sender markup escaped and no browser JavaScript errors'] }, null, 2));
    console.log('PASS: 5 investigation browser checks');
  } finally { if (browser) await browser.close(); await pilot.stopServer(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
