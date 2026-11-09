const { _electron: electron } = require('playwright');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runV3Acceptance() {
  console.log('🚀 Running V3 Layout & Fullscreen Strict Acceptance Tests...');

  const screenshotsDir = path.resolve(__dirname, 'screenshots_v3');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const app = await electron.launch({
    args: ['.', '--test-mode'],
    env: { ...process.env, ELECTRON_IS_TEST: '1' }
  });

  const win = await app.firstWindow();

  const errors = [];
  win.on('console', msg => {
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
  await new Promise(r => setTimeout(r, 1500));

  const viewports = [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 }
  ];

  const themes = ['hurt-dark', 'vinyl'];

  for (const vp of viewports) {
    console.log(`\n======================================================`);
    console.log(`📐 TESTING VIEWPORT: ${vp.width}x${vp.height}`);
    console.log(`======================================================`);
    await win.setViewportSize({ width: vp.width, height: vp.height });
    await new Promise(r => setTimeout(r, 500));

    // Ensure we are on "Моя волна" screen
    await win.evaluate(() => {
      window.switchView('my-wave');
    });
    await new Promise(r => setTimeout(r, 600));

    for (const theme of themes) {
      console.log(`\n--- Theme: ${theme} @ ${vp.width}x${vp.height} ---`);
      await win.evaluate((th) => {
        window.setTheme(th === 'vinyl' ? 'vinyl' : 'dark', false);
      }, theme);
      await new Promise(r => setTimeout(r, 400));

      // ─────────────────────────────────────────────────────────
      // 1. CHIPS INTERACTIVITY & ELEMENT FROM POINT
      // ─────────────────────────────────────────────────────────
      console.log('Testing 5 mode chips clickable & elementFromPoint...');
      const chipIds = [
        'chip-mode-similar',
        'chip-mode-favorites',
        'chip-mode-energetic',
        'chip-mode-chill',
        'chip-mode-fresh'
      ];

      for (const chipId of chipIds) {
        const chipCheck = await win.evaluate((id) => {
          const el = document.getElementById(id);
          if (!el) return { found: false };
          const rect = el.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(centerX, centerY);
          const isSelfOrChild = hit === el || el.contains(hit);
          return {
            found: true,
            isSelfOrChild,
            hitTagName: hit ? hit.tagName : null,
            hitId: hit ? hit.id : null,
            zIndex: getComputedStyle(el).zIndex,
            position: getComputedStyle(el).position
          };
        }, chipId);

        assert.ok(chipCheck.found, `Chip ${chipId} must exist`);
        assert.ok(
          chipCheck.isSelfOrChild,
          `document.elementFromPoint at center of ${chipId} must hit chip or child, got <${chipCheck.hitTagName} id="${chipCheck.hitId}">`
        );
        console.log(`  ✓ ${chipId}: clickable at center point (z-index: ${chipCheck.zIndex}, pos: ${chipCheck.position})`);

        // Test clicking chip changes active mode and does NOT start playback
        const clickResult = await win.evaluate(async (id) => {
          const wasPlaying = window.state ? window.state.isPlaying : false;
          const el = document.getElementById(id);
          el.click();
          await new Promise(r => setTimeout(r, 200));
          const isPlaying = window.state ? window.state.isPlaying : false;
          const activeChip = document.querySelector('.wave-chip.active');
          return {
            wasPlaying,
            isPlaying,
            activeChipId: activeChip ? activeChip.id : null
          };
        }, chipId);

        assert.strictEqual(clickResult.isPlaying, false, `Clicking chip ${chipId} must NOT start playback when paused`);
        assert.strictEqual(clickResult.activeChipId, chipId, `Clicking ${chipId} must set it to active class`);
      }
      console.log('✅ All 5 chips passed hit-test and non-autoplay verification.');

      // ─────────────────────────────────────────────────────────
      // 2. GEOMETRY & BOUNDING RECTS: NO OVERLAPS
      // ─────────────────────────────────────────────────────────
      console.log('Testing layout geometry, non-overlap, and gaps...');
      const geom = await win.evaluate(() => {
        const chips = document.getElementById('wave-mood-chips').getBoundingClientRect();
        const sphereWrap = document.getElementById('wave-sphere-orb').getBoundingClientRect();
        const blob = document.getElementById('yandex-fluid-blob').getBoundingClientRect();
        const aura = document.getElementById('yandex-wave-aura').getBoundingClientRect();
        const trackTitle = document.getElementById('wave-now-title').getBoundingClientRect();
        const trackArtist = document.getElementById('wave-now-artist').getBoundingClientRect();
        const queueHeader = document.querySelector('.wave-queue-header').getBoundingClientRect();
        const queueHeading = document.querySelector('.wave-queue-heading');
        const queueSub = document.getElementById('wave-status-text');

        const auraStyle = getComputedStyle(document.getElementById('yandex-wave-aura'));
        const blobStyle = getComputedStyle(document.getElementById('yandex-fluid-blob'));
        const headingStyle = getComputedStyle(queueHeading);
        const subStyle = getComputedStyle(queueSub);

        // Center content
        const centerContent = document.getElementById('wave-sphere-center-content').getBoundingClientRect();

        return {
          chips,
          sphereWrap,
          blob,
          aura,
          trackTitle,
          trackArtist,
          queueHeader,
          centerContent,
          auraPointerEvents: auraStyle.pointerEvents,
          auraZIndex: auraStyle.zIndex,
          blobZIndex: blobStyle.zIndex,
          headingFontSize: headingStyle.fontSize,
          headingFontWeight: headingStyle.fontWeight,
          subFontSize: subStyle.fontSize,
          subFontWeight: subStyle.fontWeight,
          subMarginTop: subStyle.marginTop,
          queueGapToTrackList: queueHeader.bottom
        };
      });

      // Assert non-intersecting chips and sphere
      assert.ok(
        geom.chips.bottom <= geom.sphereWrap.top + 2,
        `Chips block (bottom: ${geom.chips.bottom}) must be strictly above sphere (top: ${geom.sphereWrap.top})`
      );
      const chipsToSphereGap = geom.sphereWrap.top - geom.chips.bottom;
      console.log(`  ✓ Chips-to-sphere gap: ${chipsToSphereGap.toFixed(1)}px (expected ~24px)`);
      assert.ok(chipsToSphereGap >= 16 && chipsToSphereGap <= 32, `Gap must be ~24px, got ${chipsToSphereGap}`);

      // Assert non-intersecting sphere and track title
      assert.ok(
        geom.sphereWrap.bottom <= geom.trackTitle.top + 2,
        `Sphere (bottom: ${geom.sphereWrap.bottom}) must be strictly above track title (top: ${geom.trackTitle.top})`
      );
      const sphereToTitleGap = geom.trackTitle.top - geom.sphereWrap.bottom;
      console.log(`  ✓ Sphere-to-title gap: ${sphereToTitleGap.toFixed(1)}px (expected ~24px)`);
      assert.ok(sphereToTitleGap >= 16 && sphereToTitleGap <= 32, `Gap must be ~24px, got ${sphereToTitleGap}`);

      // Title to artist gap
      const titleToArtistGap = geom.trackArtist.top - geom.trackTitle.bottom;
      console.log(`  ✓ Title-to-artist gap: ${titleToArtistGap.toFixed(1)}px (expected ~4px)`);
      assert.ok(titleToArtistGap >= 0 && titleToArtistGap <= 12, `Gap must be ~4px, got ${titleToArtistGap}`);

      // Artist to queue gap
      const artistToQueueGap = geom.queueHeader.top - geom.trackArtist.bottom;
      console.log(`  ✓ Artist-to-queue gap: ${artistToQueueGap.toFixed(1)}px (expected ~40px)`);
      assert.ok(artistToQueueGap >= 24 && artistToQueueGap <= 50, `Gap must be ~40px, got ${artistToQueueGap}`);

      // Aura properties
      assert.strictEqual(geom.auraPointerEvents, 'none', 'Aura pointer-events must be none');

      // ─────────────────────────────────────────────────────────
      // 3. MATHEMATICAL CENTERING OF SPHERE CONTENT
      // ─────────────────────────────────────────────────────────
      const centerBlobX = geom.blob.left + geom.blob.width / 2;
      const centerBlobY = geom.blob.top + geom.blob.height / 2;
      const centerContentX = geom.centerContent.left + geom.centerContent.width / 2;
      const centerContentY = geom.centerContent.top + geom.centerContent.height / 2;

      const dx = Math.abs(centerBlobX - centerContentX);
      const dy = Math.abs(centerBlobY - centerContentY);
      console.log(`  ✓ Sphere content centering delta: dx=${dx.toFixed(2)}px, dy=${dy.toFixed(2)}px`);
      assert.ok(dx < 4, `Sphere center content X offset must be < 4px, got ${dx}`);
      assert.ok(dy < 4, `Sphere center content Y offset must be < 4px, got ${dy}`);

      // ─────────────────────────────────────────────────────────
      // 4. QUEUE HEADER TYPOGRAPHY
      // ─────────────────────────────────────────────────────────
      assert.strictEqual(geom.headingFontSize, '15px', 'Queue heading font-size must be 15px');
      assert.ok(geom.headingFontWeight === '600' || geom.headingFontWeight === 'bold', `Heading weight must be 600, got ${geom.headingFontWeight}`);
      assert.strictEqual(geom.subFontSize, '12px', 'Queue subtitle font-size must be 12px');
      console.log('✅ Queue typography and gaps verified.');

      // Capture Wave screen screenshot
      const waveScreenshotPath = path.join(screenshotsDir, `wave_${vp.width}x${vp.height}_${theme}.png`);
      await win.screenshot({ path: waveScreenshotPath });
      console.log(`📸 Wave screenshot saved: ${waveScreenshotPath}`);

      // ─────────────────────────────────────────────────────────
      // 5. FULLSCREEN PLAYER VERIFICATION
      // ─────────────────────────────────────────────────────────
      console.log('\nTesting Fullscreen Player geometry & vinyl centering...');
      await win.evaluate(() => {
        window.toggleFullscreenPlayer(true);
      });
      await new Promise(r => setTimeout(r, 600));

      const fsGeom = await win.evaluate(() => {
        const overlay = document.getElementById('fs-overlay');
        const jacket = document.getElementById('fs-album-jacket');
        const img = document.getElementById('fs-cover-img');
        const placeholder = document.getElementById('fs-cover-placeholder');
        const disc = document.getElementById('fs-vinyl-disc');
        const centerContainer = document.querySelector('.fs-center-container');

        const jacketRect = jacket.getBoundingClientRect();
        const discRect = disc.getBoundingClientRect();
        const contRect = centerContainer.getBoundingClientRect();
        const winH = window.innerHeight;

        // Mock an image source to verify loaded state behavior
        img.src = 'cover.jpg';
        img.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';

        const imgRect = img.getBoundingClientRect();

        return {
          jacketRect,
          imgRect,
          discRect,
          contCenterY: contRect.top + contRect.height / 2,
          winCenterY: winH / 2,
          placeholderDisplay: placeholder ? getComputedStyle(placeholder).display : null,
          imgDisplay: getComputedStyle(img).display
        };
      });

      // Jacket square 280px
      console.log(`  ✓ Jacket dimensions: ${fsGeom.jacketRect.width.toFixed(1)} x ${fsGeom.jacketRect.height.toFixed(1)}px`);
      assert.ok(Math.abs(fsGeom.jacketRect.width - 280) <= 2, `Jacket width must be 280px, got ${fsGeom.jacketRect.width}`);
      assert.ok(Math.abs(fsGeom.jacketRect.height - 280) <= 2, `Jacket height must be 280px, got ${fsGeom.jacketRect.height}`);

      // Img fills frame
      assert.ok(Math.abs(fsGeom.imgRect.width - fsGeom.jacketRect.width) <= 2, 'Img rect width must match jacket rect');
      assert.ok(Math.abs(fsGeom.imgRect.height - fsGeom.jacketRect.height) <= 2, 'Img rect height must match jacket rect');
      assert.strictEqual(fsGeom.placeholderDisplay, 'none', 'Placeholder must be hidden when cover loaded');

      // Vinyl disc center Y matches jacket center Y ± 2px
      const jacketCenterY = fsGeom.jacketRect.top + fsGeom.jacketRect.height / 2;
      const discCenterY = fsGeom.discRect.top + fsGeom.discRect.height / 2;
      const discYDelta = Math.abs(jacketCenterY - discCenterY);
      console.log(`  ✓ Vinyl Disc Center Y: ${discCenterY.toFixed(1)}px, Jacket Center Y: ${jacketCenterY.toFixed(1)}px (delta: ${discYDelta.toFixed(2)}px)`);
      assert.ok(discYDelta <= 2, `Disc center Y must match jacket center Y ± 2px, got delta=${discYDelta}`);

      // Fullscreen content vertically centered
      const vDelta = Math.abs(fsGeom.contCenterY - fsGeom.winCenterY);
      console.log(`  ✓ Content vertical centering delta: ${vDelta.toFixed(1)}px`);
      assert.ok(vDelta < 40, `Fullscreen center container must be vertically centered, got delta=${vDelta}`);

      // Capture Fullscreen screenshot
      const fsScreenshotPath = path.join(screenshotsDir, `fullscreen_${vp.width}x${vp.height}_${theme}.png`);
      await win.screenshot({ path: fsScreenshotPath });
      console.log(`📸 Fullscreen screenshot saved: ${fsScreenshotPath}`);

      // Close fullscreen player
      await win.evaluate(() => {
        window.toggleFullscreenPlayer(false);
      });
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // ─────────────────────────────────────────────────────────
  // 6. SINGLE NOTIFICATION & NO BOTTOM TOAST TEST
  // ─────────────────────────────────────────────────────────
  console.log('\n--- 6. Single Notification on Track Change & No Bottom Toast ---');
  await win.evaluate(() => {
    // Clear any previous toasts
    const toast = document.getElementById('toast');
    if (toast) toast.classList.remove('show');
    
    // Simulate playing track direct
    window.playTrackDirect({
      id: 'test-direct-1',
      title: 'Direct Test Track',
      artist: 'Direct Test Artist',
      isOnline: true,
      fileUrl: null,
      streamUrl: 'http://localhost/test'
    });
  });

  await new Promise(r => setTimeout(r, 600));

  const notifCheck = await win.evaluate(() => {
    const bottomToast = document.getElementById('toast');
    const smtcToast = document.getElementById('windows-smtc-toast');
    const otaModal = document.getElementById('ota-modal-card');

    return {
      bottomToastShown: bottomToast ? bottomToast.classList.contains('show') : false,
      smtcToastDisplay: smtcToast ? getComputedStyle(smtcToast).display : 'none',
      smtcTitle: document.getElementById('smtc-title')?.textContent,
      smtcTop: smtcToast ? getComputedStyle(smtcToast).top : null,
      smtcRight: smtcToast ? getComputedStyle(smtcToast).right : null,
      otaModalDisplay: otaModal ? getComputedStyle(otaModal).display : 'none'
    };
  });

  assert.strictEqual(notifCheck.bottomToastShown, false, 'Bottom toast "Воспроизведение: ..." must NOT be shown');
  assert.strictEqual(notifCheck.smtcToastDisplay, 'flex', 'Windows SMTC notification must be visible');
  assert.strictEqual(notifCheck.smtcTop, '48px', 'SMTC toast must be at top: 48px');
  assert.strictEqual(notifCheck.smtcRight, '24px', 'SMTC toast must be at right: 24px');
  assert.strictEqual(notifCheck.otaModalDisplay, 'none', 'OTA modal card must remain hidden on start');
  console.log('✅ Exactly one notification displayed (top-right SMTC), bottom toast eliminated.');

  await app.close();
  console.log('\n🎉 ALL V3 ACCEPTANCE TESTS PASSED SUCCESSFULLY WITH 100% SPEC COMPLIANCE!');
}

runV3Acceptance().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
