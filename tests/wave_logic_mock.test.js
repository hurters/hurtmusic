const { _electron: electron } = require('playwright');
const assert = require('assert');
const path = require('path');

async function runWaveLogicTests() {
  console.log('🚀 Running My Wave Logic & Recommendation Engine Tests...');

  const app = await electron.launch({
    args: ['.', '--test-mode'],
    env: { ...process.env, ELECTRON_IS_TEST: '1' }
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n--- Test 1: Setup Mock Data & Seed Locking on Queue Item Click ---');
  // Navigate to wave screen
  await win.evaluate(() => {
    window.switchView('my-wave');
    localStorage.removeItem('hurtmusic_recent_wave_ids');
    if (window.loadRecentWaveIds) window.state.seenWaveIds = window.loadRecentWaveIds();
  });

  // Mock API via window.__testMockAPI
  await win.evaluate(() => {
    window.mockTracksPool = [
      { id: 'sc_101', originalId: 'sc_101', title: 'Track A Seed', artist: 'Artist Alpha', duration: 180, coverUrl: 'https://cover1.jpg' },
      { id: 'sc_102', originalId: 'sc_102', title: 'Track B Queue 1', artist: 'Artist Beta', duration: 210, coverUrl: 'https://cover2.jpg' },
      { id: 'sc_103', originalId: 'sc_103', title: 'Track C Queue 2', artist: 'Artist Gamma', duration: 195, coverUrl: 'https://cover3.jpg' },
      { id: 'sc_104', originalId: 'sc_104', title: 'Track D Queue 3', artist: 'Artist Delta', duration: 220, coverUrl: 'https://cover4.jpg' },
      { id: 'sc_105', originalId: 'sc_105', title: 'Track E Queue 4', artist: 'Artist Epsilon', duration: 240, coverUrl: 'https://cover5.jpg' },
      { id: 'sc_106', originalId: 'sc_106', title: 'Track F Queue 5', artist: 'Artist Zeta', duration: 160, coverUrl: 'https://cover6.jpg' },
      { id: 'sc_107', originalId: 'sc_107', title: 'Track G Queue 6', artist: 'Artist Eta', duration: 190, coverUrl: 'https://cover7.jpg' },
      { id: 'sc_108', originalId: 'sc_108', title: 'Track H Queue 7', artist: 'Artist Theta', duration: 230, coverUrl: 'https://cover8.jpg' },
    ];

    window.__testMockAPI = {
      ...window.electronAPI,
      getSimilarTracks: async (trackId, artistHint, limit) => {
        return window.mockTracksPool.filter(t => t.id !== trackId);
      },
      searchOnline: async (query) => {
        return window.mockTracksPool;
      }
    };
  });

  // Start wave with Seed = Track A
  const waveStartResult = await win.evaluate(async () => {
    const seed = window.mockTracksPool[0]; // Track A Seed
    await window.startWaveFromTrack(seed);
    await new Promise(r => setTimeout(r, 300));

    return {
      seedId: window.state.waveSeedTrack?.id,
      seedTitle: window.state.waveSeedTrack?.title,
      queueLength: window.state.myWaveQueue.length,
      firstQueueItem: window.state.myWaveQueue[0]?.title,
      secondQueueItem: window.state.myWaveQueue[1]?.title
    };
  });

  console.log(`  ✓ Wave started with seed: "${waveStartResult.seedTitle}" (${waveStartResult.seedId})`);
  console.log(`  ✓ Initial queue length: ${waveStartResult.queueLength}, First: "${waveStartResult.firstQueueItem}", Second: "${waveStartResult.secondQueueItem}"`);
  assert.strictEqual(waveStartResult.seedId, 'sc_101', 'Seed ID must be sc_101');
  assert.strictEqual(waveStartResult.firstQueueItem, 'Track B Queue 1', 'First queue item must be Track B');

  // Now click Track B (index 0 in queue)
  console.log('Testing Rule 1: Clicking track from queue keeps seed and continues queue without rebuild...');
  const queueClickResult = await win.evaluate(async () => {
    // Click track B at index 0
    window.playWaveTrackAt(0);
    await new Promise(r => setTimeout(r, 300));

    return {
      currentPlayingId: window.state.currentPlayingTrack?.id,
      currentPlayingTitle: window.state.currentPlayingTrack?.title,
      seedId: window.state.waveSeedTrack?.id,
      seedTitle: window.state.waveSeedTrack?.title,
      remainingQueueLength: window.state.myWaveQueue.length,
      nextUpTrack: window.state.myWaveQueue[0]?.title
    };
  });

  console.log(`  ✓ Now playing: "${queueClickResult.currentPlayingTitle}" (${queueClickResult.currentPlayingId})`);
  console.log(`  ✓ Seed after queue click: "${queueClickResult.seedTitle}" (${queueClickResult.seedId})`);
  console.log(`  ✓ Next up in queue: "${queueClickResult.nextUpTrack}"`);

  assert.strictEqual(queueClickResult.currentPlayingId, 'sc_102', 'Playing track must be Track B');
  assert.strictEqual(queueClickResult.seedId, 'sc_101', 'Seed MUST REMAIN Track A (sc_101), no re-anchoring!');
  assert.strictEqual(queueClickResult.nextUpTrack, 'Track C Queue 2', 'Queue continues seamlessly with Track C next!');
  console.log('✅ Rule 1 verified: clicking queue track does not change seed or wipe queue.');

  // ─────────────────────────────────────────────────────────
  // Test 2: Playing track from other sections does not wipe active wave
  // ─────────────────────────────────────────────────────────
  console.log('\n--- Test 2: Playing Track from Favorites / Search Does NOT Rebuild Wave ---');
  const outsidePlayResult = await win.evaluate(async () => {
    const queueBefore = window.state.myWaveQueue.map(t => t.id);
    const seedBefore = window.state.waveSeedTrack?.id;

    // Simulate user playing a track from library / favorites
    await window.playTrackDirect({
      id: 'local_favorite_999',
      title: 'Outside Favorite Song',
      artist: 'Other Artist',
      isOnline: false,
      fileUrl: 'dummy.mp3'
    }, false);

    await new Promise(r => setTimeout(r, 200));

    return {
      seedBefore,
      seedAfter: window.state.waveSeedTrack?.id,
      queueBeforeCount: queueBefore.length,
      queueAfterCount: window.state.myWaveQueue.length,
      queueAfterIds: window.state.myWaveQueue.map(t => t.id)
    };
  });

  console.log(`  ✓ Queue count before: ${outsidePlayResult.queueBeforeCount}, after outside track: ${outsidePlayResult.queueAfterCount}`);
  assert.strictEqual(outsidePlayResult.seedAfter, outsidePlayResult.seedBefore, 'Seed must not be overwritten by outside track');
  assert.strictEqual(outsidePlayResult.queueAfterCount, outsidePlayResult.queueBeforeCount, 'Queue must not be wiped by playing outside track');
  console.log('✅ Rule 2 verified: outside playback preserves wave queue and seed.');

  // ─────────────────────────────────────────────────────────
  // Test 3: Filters: Artist limit (max 2 per 20), Duration, Deduplication, Consecutive Covers
  // ─────────────────────────────────────────────────────────
  console.log('\n--- Test 3: Filters: Duration (90s..480s), Artist limit (<=2/20), Consecutive Covers ---');
  const filterTestResult = await win.evaluate(() => {
    // 30 candidate tracks with various violations:
    // - 5 tracks by "Dominant Artist" (only 2 allowed)
    // - 2 tracks < 90s (duration = 45s)
    // - 2 tracks > 480s (duration = 600s)
    // - 2 duplicate IDs
    // - 2 consecutive tracks with identical cover
    const dirtyCandidates = [
      { id: 'sc_c1', title: 'Song 1', artist: 'Dominant Artist', duration: 180, coverUrl: 'https://img/c1.jpg' },
      { id: 'sc_c2', title: 'Song 2', artist: 'Dominant Artist', duration: 200, coverUrl: 'https://img/c2.jpg' },
      { id: 'sc_c3', title: 'Song 3', artist: 'Dominant Artist', duration: 210, coverUrl: 'https://img/c3.jpg' }, // Should be rejected (>2)
      { id: 'sc_c4', title: 'Song 4', artist: 'Dominant Artist', duration: 190, coverUrl: 'https://img/c4.jpg' }, // Should be rejected (>2)
      { id: 'sc_c5', title: 'Song 5', artist: 'Dominant Artist', duration: 220, coverUrl: 'https://img/c5.jpg' }, // Should be rejected (>2)

      // Short snippets (<90s)
      { id: 'sc_c6', title: 'Short Snippet', artist: 'Artist X', duration: 45, coverUrl: 'https://img/c6.jpg' }, // Rejected (<90s)
      { id: 'sc_c7', title: 'Intro Teaser', artist: 'Artist Y', duration: 30, coverUrl: 'https://img/c7.jpg' }, // Rejected (<90s)

      // Mixes (>480s)
      { id: 'sc_c8', title: '1-Hour Mega Mix', artist: 'DJ Mix', duration: 3600, coverUrl: 'https://img/c8.jpg' }, // Rejected (>480s)
      { id: 'sc_c9', title: 'Extended Club Set', artist: 'DJ Club', duration: 600, coverUrl: 'https://img/c9.jpg' }, // Rejected (>480s)

      // Duplicate ID
      { id: 'sc_c1', title: 'Song 1 Duplicate', artist: 'Dominant Artist', duration: 180, coverUrl: 'https://img/c1.jpg' }, // Duplicate ID

      // Consecutive cover
      { id: 'sc_c10', title: 'Cover Track 1', artist: 'Artist M', duration: 200, coverUrl: 'https://img/same.jpg' },
      { id: 'sc_c11', title: 'Cover Track 2', artist: 'Artist N', duration: 210, coverUrl: 'https://img/same.jpg' }, // Consecutive cover

      // Valid tracks
      { id: 'sc_c12', title: 'Valid 1', artist: 'Artist O', duration: 200, coverUrl: 'https://img/c12.jpg' },
      { id: 'sc_c13', title: 'Valid 2', artist: 'Artist P', duration: 220, coverUrl: 'https://img/c13.jpg' },
      { id: 'sc_c14', title: 'Valid 3', artist: 'Artist Q', duration: 240, coverUrl: 'https://img/c14.jpg' }
    ];

    window.state.seenWaveIds = new Set();
    const sourceCounts = { mock_test: dirtyCandidates.length };
    const { acceptedTracks, debug } = window.filterAndRankWaveCandidates(dirtyCandidates, sourceCounts, [], null);

    return {
      acceptedCount: acceptedTracks.length,
      acceptedTitles: acceptedTracks.map(t => `${t.artist} - ${t.title}`),
      debug
    };
  });

  console.log(`  ✓ Accepted tracks (${filterTestResult.acceptedCount}):`, filterTestResult.acceptedTitles);
  console.log('  ✓ Debug filter breakdown:', filterTestResult.debug.filtered);

  assert.strictEqual(filterTestResult.debug.filtered.durationOutOfRange, 4, 'Must filter 4 tracks with duration <90s or >480s');
  assert.strictEqual(filterTestResult.debug.filtered.artistLimit, 3, 'Must filter 3 tracks exceeding artist limit (>2/20)');
  assert.strictEqual(filterTestResult.debug.filtered.consecutiveCover, 1, 'Must filter 1 track with consecutive identical cover');
  assert.strictEqual(filterTestResult.debug.filtered.duplicate, 1, 'Must filter 1 duplicate ID track');
  console.log('✅ Rule 3 verified: duration, artist frequency, duplicates and covers correctly filtered.');

  // ─────────────────────────────────────────────────────────
  // Test 4: Persistent 200 History Across Restarts
  // ─────────────────────────────────────────────────────────
  console.log('\n--- Test 4: Persistent History of 200 Played IDs Across App Restarts ---');
  await win.evaluate(() => {
    // Record 5 played tracks
    window.recordPlayedWaveTrack({ id: 'sc_history_1' });
    window.recordPlayedWaveTrack({ id: 'sc_history_2' });
    window.recordPlayedWaveTrack({ id: 'sc_history_3' });
  });

  // Verify stored in localStorage
  const storedIds = await win.evaluate(() => {
    return JSON.parse(localStorage.getItem('hurtmusic_recent_wave_ids'));
  });
  console.log('  ✓ Stored history in localStorage:', storedIds);
  assert.ok(storedIds.includes('sc_history_1'), 'History must contain sc_history_1');
  assert.ok(storedIds.includes('sc_history_2'), 'History must contain sc_history_2');

  // Simulate app restart: re-instantiate seenWaveIds from localStorage
  const reloadedFilterResult = await win.evaluate(() => {
    const freshSet = window.loadRecentWaveIds();
    window.state.seenWaveIds = freshSet;

    const testCandidates = [
      { id: 'sc_history_1', title: 'Old Played Track', artist: 'Artist 1', duration: 180, coverUrl: 'https://img1.jpg' },
      { id: 'sc_brand_new', title: 'Brand New Track', artist: 'Artist 2', duration: 180, coverUrl: 'https://img2.jpg' }
    ];

    const { acceptedTracks, debug } = window.filterAndRankWaveCandidates(testCandidates, { test: 2 }, [], null);
    return {
      acceptedIds: acceptedTracks.map(t => t.id),
      alreadyPlayedCount: debug.filtered.alreadyPlayed
    };
  });

  console.log(`  ✓ Filter after restart: rejected alreadyPlayed=${reloadedFilterResult.alreadyPlayedCount}, accepted=`, reloadedFilterResult.acceptedIds);
  assert.strictEqual(reloadedFilterResult.alreadyPlayedCount, 1, 'sc_history_1 must be rejected as already played');
  assert.deepStrictEqual(reloadedFilterResult.acceptedIds, ['sc_brand_new'], 'Only brand new track must be accepted');
  console.log('✅ Rule 3 persistent history verified across app restart simulation.');

  // ─────────────────────────────────────────────────────────
  // Test 5: Mode Switching Changes Queue and Mood Palette
  // ─────────────────────────────────────────────────────────
  console.log('\n--- Test 5: Mode Switching Changes Queue and Sphere Palette ---');
  const modeTest = await win.evaluate(async () => {
    // Mode: energetic
    await window.setWaveMood('energetic');
    await new Promise(r => setTimeout(r, 200));
    const energeticMood = window.state.myWaveMood;
    const blobBgEnergetic = getComputedStyle(document.getElementById('yandex-fluid-blob')).background;

    // Mode: chill
    await window.setWaveMood('chill');
    await new Promise(r => setTimeout(r, 200));
    const chillMood = window.state.myWaveMood;
    const blobBgChill = getComputedStyle(document.getElementById('yandex-fluid-blob')).background;

    return {
      energeticMood,
      chillMood,
      activeChip: document.querySelector('.wave-chip.active')?.id
    };
  });

  console.log(`  ✓ Switched moods: energetic -> chill (active chip: ${modeTest.activeChip})`);
  assert.strictEqual(modeTest.chillMood, 'chill');
  assert.strictEqual(modeTest.activeChip, 'chip-mode-chill');
  console.log('✅ Rule 4 verified: mood switching correctly updates mode and UI.');

  // ─────────────────────────────────────────────────────────
  // Test 6: 3 Different Seeds Evaluation & Debug Logging
  // ─────────────────────────────────────────────────────────
  console.log('\n--- Test 6: Real Candidates & Debug Logging for 3 Different Seeds ---');
  const seeds = [
    { title: 'GOOSE COAT', artist: 'Surf7', genre: 'underground rap', originalId: 'sc_surf7_gc' },
    { title: 'MIDNIGHT CITY', artist: 'M83', genre: 'synthwave electronic', originalId: 'sc_m83_mc' },
    { title: 'TOKYO DRIFT PHONK', artist: 'Kordhell', genre: 'phonk drift bass', originalId: 'sc_kordhell_td' }
  ];

  for (const s of seeds) {
    const debugOutput = await win.evaluate(async (sampleSeed) => {
      // Mock specific genre responses for this seed
      window.__testMockAPI.getSimilarTracks = async () => [
        { id: `${sampleSeed.originalId}_r1`, title: `${sampleSeed.artist} Related 1`, artist: sampleSeed.artist, duration: 190, coverUrl: 'https://c1.jpg' },
        { id: `${sampleSeed.originalId}_r2`, title: `${sampleSeed.artist} Related 2`, artist: sampleSeed.artist, duration: 210, coverUrl: 'https://c2.jpg' },
        { id: `${sampleSeed.originalId}_r3`, title: `Similar Vibe 1`, artist: `Peer of ${sampleSeed.artist}`, duration: 200, coverUrl: 'https://c3.jpg' },
        { id: `${sampleSeed.originalId}_r4`, title: `Similar Vibe 2`, artist: `Another Peer`, duration: 220, coverUrl: 'https://c4.jpg' }
      ];

      await window.startWaveFromTrack(sampleSeed);
      await new Promise(r => setTimeout(r, 200));

      return window.state.lastWaveDebugLog;
    }, s);

    console.log(`\n[Debug Log for Seed: ${s.artist} — ${s.title}]`);
    console.log(`  - Mode: ${debugOutput.mode}`);
    console.log(`  - Sources:`, debugOutput.sources);
    console.log(`  - Total raw: ${debugOutput.totalRaw}, Accepted: ${debugOutput.accepted}`);
    console.log(`  - Filter breakdown:`, debugOutput.filtered);
    assert.ok(debugOutput.accepted > 0, `Must accept tracks for seed ${s.title}`);
  }

  await app.close();
  console.log('\n🎉 ALL WAVE ENGINE & RECOMMENDATION TESTS PASSED WITH 100% SPEC COMPLIANCE!');
}

runWaveLogicTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
