'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { boot, stop, post, fresh, payload } = require('./verify_storage_policy');
async function main() {
  fs.mkdirSync('artifacts/storage-d2', { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PILOT_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const errors = [], page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', e => errors.push(e.message));
  let server;
  try {
    const dir = fresh(); fs.writeFileSync(path.join(dir, 'ingest-journal.ndjson'), '{broken frame}\n');
    server = await boot(dir); await page.goto(server.base);
    await page.locator('#apiKey').fill('storage-policy-test'); await page.locator('#connectBtn').click();
    await page.locator('#storageState').getByText('RECOVERY_REQUIRED', { exact: true }).waitFor();
    assert.match(await page.locator('#storageHealth').innerText(), /CORRUPT_JOURNAL_FRAME/);
    assert.match(await page.locator('#storageHealth').innerText(), /files preserved; writes and compaction blocked/);
    await page.screenshot({ path: 'artifacts/storage-d2/recovery-console.png', fullPage: true });
    await page.goto('about:blank'); await stop(server);
    server = await boot(fresh(), { VITALIS_MAX_TRACES: '1', VITALIS_RETENTION_MS: '1' });
    assert.equal((await post(server, payload('a'))).status, 200);
    assert.equal((await post(server, payload('b'))).status, 503);
    await page.goto(server.base); await page.locator('#apiKey').fill('storage-policy-test'); await page.locator('#connectBtn').click();
    await page.locator('#storageHealth').getByText(/Last rejection:/).waitFor();
    const text = await page.locator('#storageHealth').innerText();
    assert.match(text, /STORAGE_CAPACITY_EXCEEDED · traces/);
    assert.match(text, /HOLD FOR REVIEW · 1 past horizon/);
    assert.match(text, /Automatic deletion is disabled/);
    assert.equal(await page.locator('#storageHealth button').count(), 0, 'No purge/control action');
    await page.screenshot({ path: 'artifacts/storage-d2/retention-console.png', fullPage: true });
    assert.deepEqual(errors, []);
    fs.writeFileSync('artifacts/storage-d2/console-verification.json', JSON.stringify({ status: 'PASS', runAt: new Date().toISOString(), checks: [
      'Corruption shown when no trace can be loaded', 'Recovery preserves sources and blocks mutations',
      'Actual quota rejection and retention hold visible', 'No purge button or browser errors'] }, null, 2));
    console.log('PASS: 4 D2 browser checks');
  } finally { await browser.close(); if (server) await stop(server); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
