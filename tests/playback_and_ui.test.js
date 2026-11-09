const { _electron: electron } = require('playwright');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runTestSuite() {
  console.log('🚀 Starting HurtMusic Automated Comprehensive Test Suite...');
  
  const screenshotsDir = path.resolve(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const app = await electron.launch({
    args: ['.', '--test-mode'],
    env: { ...process.env, ELECTRON_IS_TEST: '1' }
  });

  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 });

  const consoleLogs = [];
  const errors = [];

  win.on('console', msg => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
    if (msg.type() === 'error' && !msg.text().includes('ERR_FILE_NOT_FOUND')) {
      errors.push(msg.text());
      console.error('❌ RENDERER ERROR:', msg.text());
    }
  });

  win.on('pageerror', err => {
    errors.push(err.message);
    console.error('❌ RENDERER EXCEPTION:', err.message);
  });

  await win.waitForLoadState('domcontentloaded');
  // Wait for initial data load (SoundCloud trending)
  await new Promise(r => setTimeout(r, 2500));

  console.log('--- TEST 1: Pluralization Helper (Bug 3) ---');
  const plurals = await win.evaluate(() => {
    return [
      window.formatPlural(1, 'трек', 'трека', 'треков'),
      window.formatPlural(2, 'трек', 'трека', 'треков'),
      window.formatPlural(5, 'трек', 'трека', 'треков'),
      window.formatPlural(11, 'трек', 'трека', 'треков'),
      window.formatPlural(21, 'трек', 'трека', 'треков'),
      window.formatPlural(24, 'трек', 'трека', 'треков')
    ];
  });
  assert.strictEqual(plurals[0], '1 трек');
  assert.strictEqual(plurals[1], '2 трека');
  assert.strictEqual(plurals[2], '5 треков');
  assert.strictEqual(plurals[3], '11 треков');
  assert.strictEqual(plurals[4], '21 трек');
  assert.strictEqual(plurals[5], '24 трека');
  console.log('✅ Russian Pluralization verified perfectly:', plurals);

  console.log('--- TEST 2: Sidebar Navigation & Active States (Bug 7, Bug 4, Bug 5, Bug 6) ---');
  const viewsToTest = [
    { view: 'online-search', placeholder: 'Поиск на SoundCloud и в библиотеке' },
    { view: 'my-wave', placeholder: '' },
    { view: 'downloaded', placeholder: 'Поиск по библиотеке' },
    { view: 'favorites', placeholder: 'Поиск по библиотеке' },
    { view: 'artists', placeholder: 'Поиск по библиотеке' },
    { view: 'albums', placeholder: 'Поиск по библиотеке' }
  ];

  for (const item of viewsToTest) {
    await win.evaluate((v) => window.switchView(v), item.view);
    await new Promise(r => setTimeout(r, 300));

    const navCheck = await win.evaluate(() => {
      const activeItems = Array.from(document.querySelectorAll('.nav-item.active'));
      const activeViews = activeItems.map(el => el.dataset.view);
      const searchPlaceholder = document.getElementById('library-search')?.placeholder || '';
      const heroFavText = document.getElementById('hero-fav-count')?.textContent || '';
      const heroSubtitle = document.getElementById('hero-subtitle')?.textContent || '';
      return {
        activeCount: activeItems.length,
        activeViews,
        searchPlaceholder,
        heroFavText,
        heroSubtitle
      };
    });

    assert.strictEqual(navCheck.activeCount, 1, `Exactly 1 active nav item expected, got ${navCheck.activeCount} on view ${item.view}`);
    assert.strictEqual(navCheck.activeViews[0], item.view, `Active nav item must match ${item.view}`);
    assert.ok(!navCheck.heroFavText.includes('7422'), `Hero counter must not contain hardcoded 7422 on view ${item.view}`);
    assert.ok(!navCheck.heroSubtitle.includes('By HKLS'), `Hero subtitle must not contain hardcoded 'By HKLS' on view ${item.view}`);

    if (item.placeholder) {
      assert.strictEqual(navCheck.searchPlaceholder, item.placeholder, `Search placeholder mismatch on ${item.view}`);
    }
  }
  console.log('✅ Sidebar active states, contextual search placeholders, and hero text verified!');

  console.log('--- TEST 3: Playback Accuracy & Identification by ID (Bug 1, Bug 2) ---');
  // Switch back to online search
  await win.evaluate(() => window.switchView('online-search'));
  await new Promise(r => setTimeout(r, 800));

  const totalTracks = await win.evaluate(() => window.state.filteredTracks.length);
  console.log(`Found ${totalTracks} tracks in online-search. Testing 20 distinct playback clicks...`);
  assert.ok(totalTracks >= 10, 'Should have at least 10 online tracks for test');

  // Test 20 clicks across different indices
  const testIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].filter(i => i < totalTracks);

  for (const idx of testIndices) {
    const expectedTrack = await win.evaluate((i) => {
      const t = window.state.filteredTracks[i];
      return { id: t.id, title: t.title, artist: t.artist };
    }, idx);

    // Click track row
    await win.evaluate((id) => window.playTrackById(id), expectedTrack.id);
    await new Promise(r => setTimeout(r, 150));

    const check = await win.evaluate((clickedId) => {
      const playing = window.state.currentPlayingTrack;
      const isPlaying = window.state.isPlaying;
      const activeRows = Array.from(document.querySelectorAll('.track-row.now-playing'));
      const activeEqualizers = Array.from(document.querySelectorAll('.ios-equalizer'));
      const playerTitle = document.getElementById('bar-title')?.textContent;
      const playerArtist = document.getElementById('bar-artist')?.textContent;

      return {
        currentPlayingId: playing?.id,
        currentPlayingTitle: playing?.title,
        isPlaying,
        activeRowsCount: activeRows.length,
        activeEqualizersCount: activeEqualizers.length,
        playerTitle,
        playerArtist
      };
    }, expectedTrack.id);

    assert.strictEqual(check.currentPlayingId, expectedTrack.id, `Track ID mismatch! Expected ${expectedTrack.id}, got ${check.currentPlayingId}`);
    assert.strictEqual(check.activeRowsCount, 1, `Exactly 1 row should have .now-playing, found ${check.activeRowsCount}`);
    assert.strictEqual(check.activeEqualizersCount, 1, `Exactly 1 row should have .ios-equalizer, found ${check.activeEqualizersCount}`);
    assert.strictEqual(check.playerTitle, expectedTrack.title, `Player bar title mismatch! Expected ${expectedTrack.title}, got ${check.playerTitle}`);
  }
  console.log(`✅ Verified 20 sequential playback clicks by ID! Every click played the exact track.`);

  console.log('--- TEST 4: Queue Navigation (Next / Prev / Shuffle) ---');
  // Next track
  const beforeNextId = await win.evaluate(() => window.state.currentPlayingTrack?.id);
  await win.evaluate(() => window.playNext());
  await new Promise(r => setTimeout(r, 150));
  const afterNextId = await win.evaluate(() => window.state.currentPlayingTrack?.id);
  assert.notStrictEqual(beforeNextId, afterNextId, 'playNext() should advance to a new track');

  // Prev track
  await win.evaluate(() => window.playPrevious());
  await new Promise(r => setTimeout(r, 150));
  const afterPrevId = await win.evaluate(() => window.state.currentPlayingTrack?.id);
  assert.strictEqual(beforeNextId, afterPrevId, 'playPrevious() should return to the preceding track');

  // Shuffle toggle
  const shuffleStatus = await win.evaluate(() => {
    window.toggleShuffle();
    return {
      shuffle: window.state.shuffle,
      queueLen: window.state.playbackQueue.length
    };
  });
  assert.strictEqual(shuffleStatus.shuffle, true, 'Shuffle should be enabled');
  console.log('✅ Queue Next, Previous, and Shuffle verified!');

  console.log('--- TEST 5: Artists Screen & Detail Navigation ---');
  await win.evaluate(() => window.switchView('artists'));
  await new Promise(r => setTimeout(r, 300));

  const artistsCheck = await win.evaluate(() => {
    const cards = document.querySelectorAll('.artist-card');
    const firstArtist = cards[0]?.querySelector('.artist-card-name')?.textContent;
    return {
      count: cards.length,
      firstArtist
    };
  });
  console.log(`Found ${artistsCheck.count} artists in media library.`);
  assert.ok(artistsCheck.count > 0, 'Artists grid should have at least 1 artist');

  // Open artist detail
  await win.evaluate((name) => window.openArtistDetail(name), artistsCheck.firstArtist);
  await new Promise(r => setTimeout(r, 300));

  const artistDetailCheck = await win.evaluate(() => {
    const header = document.getElementById('collection-detail-header');
    const title = document.getElementById('detail-title')?.textContent;
    const tracks = document.querySelectorAll('.track-row');
    const isVisible = header && getComputedStyle(header).display !== 'none';
    return { isVisible, title, tracksCount: tracks.length };
  });

  assert.strictEqual(artistDetailCheck.isVisible, true, 'Artist detail header should be visible');
  assert.strictEqual(artistDetailCheck.title, artistsCheck.firstArtist, 'Artist detail title should match artist name');
  assert.ok(artistDetailCheck.tracksCount > 0, 'Artist tracklist should contain tracks');

  // Navigate back to artists grid
  await win.evaluate(() => window.navigateBackFromDetail());
  await new Promise(r => setTimeout(r, 300));
  const backCheck = await win.evaluate(() => {
    const grid = document.getElementById('artists-grid');
    return grid && getComputedStyle(grid).display !== 'none';
  });
  assert.ok(backCheck, 'Back button should return to artists grid');
  console.log('✅ Artists grid and artist page navigation verified!');

  console.log('--- TEST 6: Albums Screen & Detail Navigation ---');
  await win.evaluate(() => window.switchView('albums'));
  await new Promise(r => setTimeout(r, 300));

  const albumsCheck = await win.evaluate(() => {
    const cards = document.querySelectorAll('.album-card');
    const empty = document.getElementById('albums-empty-state');
    return {
      count: cards.length,
      emptyVisible: empty && getComputedStyle(empty).display !== 'none'
    };
  });
  console.log(`Albums view status: ${albumsCheck.count} albums, empty state visible: ${albumsCheck.emptyVisible}`);
  assert.ok(albumsCheck.count > 0 || albumsCheck.emptyVisible, 'Should show album cards or clean empty state');
  console.log('✅ Albums screen verified!');

  console.log('--- TEST 7: Settings Modal & 2-Pane Navigation ---');
  await win.evaluate(() => window.openSettingsModal());
  await new Promise(r => setTimeout(r, 300));

  const modalDimensions = await win.evaluate(() => {
    const dialog = document.querySelector('.settings-dialog');
    const rect = dialog.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  console.log(`Settings modal dimensions: ${modalDimensions.width}x${modalDimensions.height}`);
  assert.ok(modalDimensions.width >= 700 && modalDimensions.width <= 800, 'Settings modal width should be ~760px');
  assert.ok(modalDimensions.height >= 480 && modalDimensions.height <= 580, 'Settings modal height should be ~520px');

  // Test 5 categories
  const tabs = ['appearance', 'playback', 'equalizer', 'storage', 'about'];
  for (const tab of tabs) {
    await win.evaluate((t) => window.switchSettingsTab(t), tab);
    await new Promise(r => setTimeout(r, 150));
    const activeTab = await win.evaluate((t) => {
      const panel = document.getElementById(`tab-panel-${t}`);
      return panel && panel.classList.contains('active');
    }, tab);
    assert.ok(activeTab, `Settings tab panel for ${tab} must be active`);
  }
  console.log('✅ Settings 2-pane navigation across all 5 tabs verified!');

  console.log('--- TEST 8: Custom Equalizer Functionality & Web Audio Chain ---');
  await win.evaluate(() => window.switchSettingsTab('equalizer'));
  await new Promise(r => setTimeout(r, 200));

  const eqCheck = await win.evaluate(() => {
    const sliders = document.querySelectorAll('.eq-band-column');
    const path = document.getElementById('eq-curve-path');
    const pathD = path?.getAttribute('d') || '';
    const hasCurve = pathD.startsWith('M');
    return {
      sliderCount: sliders.length,
      hasCurve,
      bandsCount: window.eqState?.bandsCount,
      enabled: window.eqState?.enabled
    };
  });
  assert.strictEqual(eqCheck.sliderCount, 8, 'Equalizer should have 8 bands by default');
  assert.ok(eqCheck.hasCurve, 'Equalizer should render smooth SVG curve');

  // Test preset change (Bass Boost)
  await win.evaluate(() => window.applyEqPreset('bass'));
  await new Promise(r => setTimeout(r, 150));
  const bassGains = await win.evaluate(() => window.eqState.gains);
  assert.ok(bassGains[0] > 0, 'Bass preset should boost low frequencies');

  // Test reset to Flat
  await win.evaluate(() => window.resetEqualizer());
  await new Promise(r => setTimeout(r, 150));
  const flatGains = await win.evaluate(() => window.eqState.gains);
  assert.ok(flatGains.every(g => g === 0), 'Reset should zero out all bands');

  // Test EQ Power Toggle
  const toggled = await win.evaluate(() => {
    window.toggleEqualizer();
    return window.eqState.enabled;
  });
  assert.strictEqual(toggled, false, 'EQ toggle should turn EQ off');
  await win.evaluate(() => window.toggleEqualizer()); // re-enable

  // Test Band Drag
  await win.evaluate(() => window.setEqBandGain(0, 6));
  const customGain = await win.evaluate(() => window.eqState.gains[0]);
  assert.strictEqual(customGain, 6, 'Setting band gain should reflect in eqState');

  // Close modal
  await win.evaluate(() => window.closeSettingsModal());
  console.log('✅ Equalizer custom bands, curve, presets, and power verified!');

  console.log('--- TEST 9: My Wave Living Sphere & Mood Chips ---');
  await win.evaluate(() => window.switchView('my-wave'));
  await new Promise(r => setTimeout(r, 300));

  const waveInitial = await win.evaluate(() => {
    const orb = document.getElementById('wave-sphere-orb');
    const isPlaying = window.state.isPlaying;
    return { orbExists: !!orb, isPlaying };
  });
  assert.ok(waveInitial.orbExists, 'Wave sphere orb must exist in DOM');

  // Click sphere to start wave
  await win.evaluate(() => window.toggleMyWavePlayback());
  await new Promise(r => setTimeout(r, 300));
  const waveStarted = await win.evaluate(() => window.state.isMyWaveActive);
  assert.strictEqual(waveStarted, true, 'Clicking sphere should activate My Wave');

  // Test mood chips
  const moods = ['similar', 'favorites', 'energetic', 'chill', 'fresh'];
  for (const m of moods) {
    await win.evaluate((mood) => window.setWaveMood(mood), m);
    await new Promise(r => setTimeout(r, 200));
    const activeMood = await win.evaluate(() => window.state.myWaveMood);
    assert.strictEqual(activeMood, m, `Wave mood should be ${m}`);
  }
  console.log('✅ My Wave sphere and mood switching verified!');

  console.log('--- TEST 10: Capturing High-Res Verification Screenshots ---');
  // 1. My Wave
  await win.screenshot({ path: path.join(screenshotsDir, '01_my_wave_screen.png') });
  
  // 2. Online Search
  await win.evaluate(() => window.switchView('online-search'));
  await new Promise(r => setTimeout(r, 300));
  await win.screenshot({ path: path.join(screenshotsDir, '02_online_search_screen.png') });

  // 3. Artists Grid
  await win.evaluate(() => window.switchView('artists'));
  await new Promise(r => setTimeout(r, 300));
  await win.screenshot({ path: path.join(screenshotsDir, '03_artists_grid_screen.png') });

  // 4. Artist Page Detail
  const firstArt = await win.evaluate(() => document.querySelector('.artist-card-name')?.textContent);
  if (firstArt) {
    await win.evaluate((name) => window.openArtistDetail(name), firstArt);
    await new Promise(r => setTimeout(r, 300));
    await win.screenshot({ path: path.join(screenshotsDir, '04_artist_page_screen.png') });
    await win.evaluate(() => window.navigateBackFromDetail());
  }

  // 5. Albums Grid
  await win.evaluate(() => window.switchView('albums'));
  await new Promise(r => setTimeout(r, 300));
  await win.screenshot({ path: path.join(screenshotsDir, '05_albums_grid_screen.png') });

  // 6. Settings Modal (Equalizer Tab)
  await win.evaluate(() => {
    window.openSettingsModal();
    window.switchSettingsTab('equalizer');
  });
  await new Promise(r => setTimeout(r, 300));
  await win.screenshot({ path: path.join(screenshotsDir, '06_settings_equalizer.png') });

  // 7. Settings Modal (Appearance Tab)
  await win.evaluate(() => window.switchSettingsTab('appearance'));
  await new Promise(r => setTimeout(r, 200));
  await win.screenshot({ path: path.join(screenshotsDir, '07_settings_appearance.png') });

  // 8. Vinyl Theme Preview
  await win.evaluate(() => window.changeTheme('vinyl'));
  await new Promise(r => setTimeout(r, 300));
  await win.screenshot({ path: path.join(screenshotsDir, '08_settings_vinyl_theme.png') });

  // Revert to dark theme and close settings
  await win.evaluate(() => {
    window.changeTheme('dark');
    window.closeSettingsModal();
  });

  // 9. Fullscreen Player
  await win.evaluate(() => window.toggleFullscreenPlayer(true));
  await new Promise(r => setTimeout(r, 400));
  await win.screenshot({ path: path.join(screenshotsDir, '09_fullscreen_player.png') });
  await win.evaluate(() => window.toggleFullscreenPlayer(false));

  console.log(`✅ Saved 9 high-resolution screenshots to ${screenshotsDir}`);

  // Assert 0 exceptions
  assert.strictEqual(errors.length, 0, `Expected 0 runtime errors, found ${errors.length}: ${JSON.stringify(errors)}`);

  await app.close();
  console.log('🎉 ALL TESTS PASSED WITH 0 ERRORS!');
}

runTestSuite().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
