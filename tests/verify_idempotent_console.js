'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { boot, stop, post, get, fresh, payload } = require('./verify_storage_policy');
const { replayCapture, accepted } = require('./verify_idempotent_ingestion');

async function main() {
  fs.mkdirSync('artifacts/storage-d3', { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PILOT_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const server = await boot(fresh());
  try {
    const first = await replayCapture(server); const before = await get(server, '/api/storage');
    await page.goto(server.base); await page.locator('#apiKey').fill('storage-policy-test'); await page.locator('#connectBtn').click();
    await page.locator('#storageHealth').getByText(new RegExp(before.usage.spans + ' observations')).waitFor();
    const id = 'c4b6bfebbdf71a25e26d910fb1681aab';
    await page.locator('[data-id="' + id + '"]').first().click();
    await page.locator('#investigationFacts').getByText(/358ms/).waitFor();
    const facts = await page.locator('#investigationFacts').innerText();
    const second = await replayCapture(server); assert.deepEqual(second, accepted(0, first.ingestedSpans + first.duplicateSpans));
    await page.locator('#storageRefresh').click();
    assert.match(await page.locator('#storageHealth').innerText(), new RegExp(before.usage.spans + ' observations'));
    await page.locator('#overviewBtn').click(); await page.locator('[data-id="' + id + '"]').first().click();
    assert.equal(await page.locator('#investigationFacts').innerText(), facts);
    await page.screenshot({ path: 'artifacts/storage-d3/retry-console.png', fullPage: true });
    const p = payload('a'); assert.equal((await post(server, p)).status, 200);
    p.resourceSpans[0].scopeSpans[0].spans[0].name = 'GET /conflicting-operation';
    assert.equal((await post(server, p)).status, 200);
    await page.locator('#overviewBtn').click(); await page.locator('[data-id="' + 'a'.repeat(32) + '"]').first().click();
    await page.locator('#investigationFacts summary').click();
    await page.locator('#investigationFacts').getByText(/Conflicting observations share a span ID/).waitFor();
    assert.match(await page.locator('#investigationFacts').innerText(), /UNKNOWN/);
    assert.match(await page.locator('#deviations').innerText(), /identity is ambiguous/);
    assert.doesNotMatch(await page.locator('#deviations').innerText(), /it is a batch|holds an OpenTelemetry/);
    await page.screenshot({ path: 'artifacts/storage-d3/conflict-console.png', fullPage: true });
    assert.deepEqual(errors, []);
    fs.writeFileSync('artifacts/storage-d3/console-verification.json', JSON.stringify({ status: 'PASS', runAt: new Date().toISOString(), checks: [
      'Actual FIN replay retry preserves displayed observation count', 'Investigation facts remain identical after retry',
      'Same-ID changed evidence displays UNKNOWN and conflict reason', 'No browser errors'] }, null, 2));
    console.log('PASS: 4 D3 browser checks');
  } finally { await browser.close(); await stop(server); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
