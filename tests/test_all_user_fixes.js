const { _electron: electron } = require('playwright');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function testAllFourFeatures() {
  console.log('🚀 Running E2E Test: Mini Player, Popular Artists, Search & Equalizer Drag...');

  const screenshotsDir = path.resolve(__dirname, 'screenshots_user_fixes');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  const app = await electron.launch({
    args: ['.', '--test-mode'],
    env: { ...process.env, ELECTRON_IS_TEST: '1' }
  });

  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 720 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2500);

  // ─────────────────────────────────────────────────────────────
  // 1. Mini-player verification
  // ─────────────────────────────────────────────────────────────
  console.log('--- 1. Testing Mini-Player HUD ---');
  await win.evaluate(() => {
    window.toggleMiniPlayerMode(true);
  });
  await win.waitForTimeout(500);

  const hudVisible = await win.locator('#mini-player-hud').isVisible();
  console.log('Mini-player HUD visible:', hudVisible);
  assert.strictEqual(hudVisible, true);

  const hudBox = await win.locator('#mini-player-hud').boundingBox();
  console.log('HUD Dimensions:', hudBox.width, 'x', hudBox.height);
  assert.ok(hudBox.width >= 340, 'HUD width should be >= 340px');
  assert.ok(hudBox.height >= 70, 'HUD height should be >= 70px');

  await win.screenshot({ path: path.join(screenshotsDir, '1_mini_player_hud.png') });

  // Return to normal mode
  await win.evaluate(() => {
    window.toggleMiniPlayerMode(false);
  });
  await win.waitForTimeout(500);

  // ─────────────────────────────────────────────────────────────
  // 2. Artists: Popular Catalog instead of random
  // ─────────────────────────────────────────────────────────────
  console.log('--- 2. Testing Artists View & Popular Catalog ---');
  await win.evaluate(() => {
    window.switchView('artists');
  });
  await win.waitForTimeout(600);

  const artistCards = await win.locator('.artist-card').count();
  console.log('Artist cards count:', artistCards);
  assert.ok(artistCards >= 10, 'Should display at least 10 artists');

  const firstArtistName = await win.locator('.artist-card-name').first().innerText();
  console.log('First artist name:', firstArtistName);
  assert.ok(firstArtistName.length > 0);

  await win.screenshot({ path: path.join(screenshotsDir, '2_artists_popular.png') });

  // ─────────────────────────────────────────────────────────────
  // 3. Artists Search fix
  // ─────────────────────────────────────────────────────────────
  console.log('--- 3. Testing Search in Artists View ---');
  // Type 'Kai' in search input
  await win.fill('#library-search', 'Kai');
  await win.waitForTimeout(400);

  let filteredCount = await win.locator('.artist-card').count();
  console.log('Artists matching "Kai":', filteredCount);
  assert.ok(filteredCount >= 1, 'Search for Kai should return Kai Angel');

  const matchedName = await win.locator('.artist-card-name').first().innerText();
  console.log('Matched artist:', matchedName);
  assert.ok(matchedName.toLowerCase().includes('kai'));

  await win.screenshot({ path: path.join(screenshotsDir, '3_artists_search_matched.png') });

  // Clear search
  await win.click('#search-clear-btn');
  await win.waitForTimeout(300);

  // ─────────────────────────────────────────────────────────────
  // 4. Equalizer Drag Verification
  // ─────────────────────────────────────────────────────────────
  console.log('--- 4. Testing Equalizer Slider Drag ---');
  // Open Settings modal
  await win.evaluate(() => {
    window.toggleSettingsModal(true);
    window.switchSettingsTab('equalizer');
  });
  await win.waitForTimeout(500);

  const eqAreaVisible = await win.locator('#eq-visual-area').isVisible();
  console.log('Equalizer visual area visible:', eqAreaVisible);
  assert.strictEqual(eqAreaVisible, true);

  // Get first fader groove
  const firstCol = win.locator('.eq-band-column').first();
  const groove = firstCol.locator('.eq-track-groove');
  const grooveBox = await groove.boundingBox();
  console.log('Groove Box:', grooveBox);

  // Initial gain
  const initialGain = await win.evaluate(() => window.eqState.gains[0]);
  console.log('Initial Gain Band 0:', initialGain);

  // Simulate mouse drag from bottom to top (drag upwards to increase dB)
  const startX = grooveBox.x + grooveBox.width / 2;
  const startY = grooveBox.y + grooveBox.height * 0.8; // near bottom (-7dB)
  const targetY = grooveBox.y + grooveBox.height * 0.15; // near top (+8.5dB)

  await win.mouse.move(startX, startY);
  await win.mouse.down();
  // Drag upward in steps
  for (let y = startY; y >= targetY; y -= 10) {
    await win.mouse.move(startX, y);
    await win.waitForTimeout(20);
  }
  await win.mouse.up();
  await win.waitForTimeout(200);

  const finalGain = await win.evaluate(() => window.eqState.gains[0]);
  console.log('Final Gain Band 0 after dragging UP:', finalGain);
  assert.ok(finalGain > 5, 'Dragging up must set gain to high positive dB, got: ' + finalGain);

  await win.screenshot({ path: path.join(screenshotsDir, '4_equalizer_dragged.png') });

  await app.close();
  console.log('🎉 ALL 4 USER FIXES VERIFIED SUCCESSFULLY!');
}

testAllFourFeatures().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
