const { _electron: electron } = require('playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  console.log('🚀 Launching Electron test for v1.1.1 features (Audio FX, Playlists, Version badge)...');
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'main.js')],
    timeout: 15000
  });

  const page = await app.firstWindow();
  await page.waitForTimeout(3000);

  // 1. Verify Version badges in About modal and Top bar
  console.log('--- 1. Testing Version 1.1.1 Displays ---');
  const otaTag = await page.locator('#ota-version-tag').textContent();
  console.log('Top bar OTA version tag:', otaTag.trim());
  assert(otaTag.includes('v1.1.1'), 'Top bar version must show v1.1.1');

  const aboutText = await page.locator('#tab-panel-about').textContent();
  console.log('About panel text excerpt:', aboutText.slice(0, 80).replace(/\s+/g, ' '));
  assert(aboutText.includes('1.1.1'), 'About panel must show Версия 1.1.1');

  // 2. Testing Audio FX Modal & Speed/Reverb controls
  console.log('--- 2. Testing Audio FX Controls ---');
  await page.click('#btn-audio-fx');
  await page.waitForTimeout(500);

  const isFxVisible = await page.locator('#modal-audio-fx').isVisible();
  console.log('Audio FX modal visible:', isFxVisible);
  assert.strictEqual(isFxVisible, true, 'Audio FX modal must be open');

  // Click Slowed preset
  await page.click('#btn-fx-preset-slowed');
  await page.waitForTimeout(300);

  const speedText = await page.locator('#label-fx-speed').textContent();
  const reverbText = await page.locator('#label-fx-reverb').textContent();
  console.log('Slowed preset speed:', speedText.trim(), 'reverb:', reverbText.trim());
  assert.strictEqual(speedText.trim(), '0.85x', 'Slowed speed must be 0.85x');
  assert.strictEqual(reverbText.trim(), '48%', 'Slowed reverb must be 48%');

  // Close FX modal
  await page.click('#modal-audio-fx .modal-close-btn');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.locator('#modal-audio-fx').isVisible(), false);

  // 3. Testing Playlists Navigation & Creation
  console.log('--- 3. Testing Playlists View ---');
  await page.click('.nav-item[data-view="playlists"]');
  await page.waitForTimeout(500);

  const isPlaylistsVisible = await page.locator('#playlists-view').isVisible();
  console.log('Playlists view visible:', isPlaylistsVisible);
  assert.strictEqual(isPlaylistsVisible, true, 'Playlists view must be visible');

  // Test Import Modal
  await page.evaluate(() => window.openImportPlaylistModal());
  await page.waitForTimeout(300);
  const isImportVisible = await page.locator('#modal-import-playlist').isVisible();
  console.log('Import playlist modal visible:', isImportVisible);
  assert.strictEqual(isImportVisible, true, 'Import modal must open');

  await page.evaluate(() => window.toggleImportPlaylistModal(false));
  await page.waitForTimeout(300);

  console.log('🎉 ALL v1.1.1 AUTOMATED TESTS PASSED SUCCESSFULLY!');
  await app.close();
  process.exit(0);
})().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
