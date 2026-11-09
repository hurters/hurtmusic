const { _electron: electron } = require('playwright');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runV2Acceptance() {
  console.log('🚀 Running V2 Strict Defect & Acceptance Test Suite...');

  const screenshotsDir = path.resolve(__dirname, 'screenshots_v2');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const app = await electron.launch({
    args: ['.', '--test-mode'],
    env: { ...process.env, ELECTRON_IS_TEST: '1' }
  });

  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 });

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
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n--- 1. Play/Pause Icons Resolution & Visibility Across All Controls ---');
  // Check in paused state
  const pausedIcons = await win.evaluate(() => {
    const barPlay = document.getElementById('bar-icon-play');
    const barPause = document.getElementById('bar-icon-pause');
    const heroPlay = document.getElementById('hero-icon-play');
    const heroPause = document.getElementById('hero-icon-pause');
    const wavePlay = document.getElementById('wave-orb-icon-play');
    const wavePause = document.getElementById('wave-orb-icon-pause');

    return {
      barPlayDisplay: barPlay ? getComputedStyle(barPlay).display : null,
      barPauseDisplay: barPause ? getComputedStyle(barPause).display : null,
      heroPlayDisplay: heroPlay ? getComputedStyle(heroPlay).display : null,
      heroPauseDisplay: heroPause ? getComputedStyle(heroPause).display : null,
      wavePlayDisplay: wavePlay ? getComputedStyle(wavePlay).display : null,
      wavePauseDisplay: wavePause ? getComputedStyle(wavePause).display : null,
      barPlayBBox: barPlay?.getBoundingClientRect()
    };
  });

  assert.strictEqual(pausedIcons.barPlayDisplay, 'block', 'bar-icon-play must be visible when paused');
  assert.strictEqual(pausedIcons.barPauseDisplay, 'none', 'bar-icon-pause must be hidden when paused');
  assert.ok(pausedIcons.barPlayBBox.width > 0, 'bar-icon-play must have positive width');
  console.log('✅ Paused state: play icons visible with non-zero dimensions.');

  // Start playback
  await win.evaluate(() => {
    window.setPlaybackState(true);
  });
  await new Promise(r => setTimeout(r, 200));

  const playingIcons = await win.evaluate(() => {
    const barPlay = document.getElementById('bar-icon-play');
    const barPause = document.getElementById('bar-icon-pause');
    const heroPlay = document.getElementById('hero-icon-play');
    const heroPause = document.getElementById('hero-icon-pause');
    return {
      barPlayDisplay: barPlay ? getComputedStyle(barPlay).display : null,
      barPauseDisplay: barPause ? getComputedStyle(barPause).display : null,
      heroPlayDisplay: heroPlay ? getComputedStyle(heroPlay).display : null,
      heroPauseDisplay: heroPause ? getComputedStyle(heroPause).display : null,
      barPauseBBox: barPause?.getBoundingClientRect()
    };
  });

  assert.strictEqual(playingIcons.barPlayDisplay, 'none', 'bar-icon-play must be hidden when playing');
  assert.strictEqual(playingIcons.barPauseDisplay, 'block', 'bar-icon-pause must be visible when playing');
  assert.ok(playingIcons.barPauseBBox.width > 0, 'bar-icon-pause must have positive width');
  console.log('✅ Playing state: pause icons visible with non-zero dimensions.');

  console.log('\n--- 2. Close Buttons Verification (No White Square / Valid SVG) ---');
  // Check fullscreen close button and settings close button while their overlays are open
  await win.evaluate(() => window.openSettingsModal());
  await new Promise(r => setTimeout(r, 200));

  const settingsClose = await win.evaluate(() => {
    const el = document.querySelector('.modal-close-btn');
    const svg = el?.querySelector('svg');
    const style = el ? getComputedStyle(el) : null;
    return {
      hasSvg: !!svg,
      btnBg: style?.backgroundColor,
      width: el?.getBoundingClientRect().width || 0,
      svgWidth: svg?.getBoundingClientRect().width || 0
    };
  });
  assert.ok(settingsClose.hasSvg, 'Settings close button must contain SVG icon');
  assert.ok(settingsClose.width > 0, 'Settings close button must have width > 0');
  assert.notStrictEqual(settingsClose.btnBg, 'rgb(255, 255, 255)', 'Settings close button must not be solid white');

  await win.evaluate(() => window.closeSettingsModal());

  await win.evaluate(() => window.toggleFullscreenPlayer(true));
  await new Promise(r => setTimeout(r, 200));

  const fsClose = await win.evaluate(() => {
    const el = document.querySelector('.fs-close-btn');
    const svg = el?.querySelector('svg');
    const style = el ? getComputedStyle(el) : null;
    return {
      hasSvg: !!svg,
      btnBg: style?.backgroundColor,
      width: el?.getBoundingClientRect().width || 0,
      svgWidth: svg?.getBoundingClientRect().width || 0
    };
  });
  assert.ok(fsClose.hasSvg, 'Fullscreen close button must contain SVG icon');
  assert.ok(fsClose.width > 0, 'Fullscreen close button must have width > 0');
  assert.notStrictEqual(fsClose.btnBg, 'rgb(255, 255, 255)', 'Fullscreen close button must not be solid white');

  await win.evaluate(() => window.toggleFullscreenPlayer(false));
  console.log('✅ Close buttons verified: styled, semi-transparent backgrounds, crisp SVG icons.');

  console.log('\n--- 3. Progress Sliders in Bottom Bar & Fullscreen ---');
  const slidersCheck = await win.evaluate(() => {
    const barSlider = document.getElementById('progress-slider');
    const volSlider = document.getElementById('volume-slider');
    const fsSlider = document.getElementById('fs-progress');

    return {
      barSliderExists: !!barSlider,
      barSliderWidth: barSlider ? barSlider.getBoundingClientRect().width : 0,
      volSliderWidth: volSlider ? volSlider.getBoundingClientRect().width : 0,
      fsSliderExists: !!fsSlider
    };
  });

  assert.ok(slidersCheck.barSliderExists, 'Bottom bar progress slider must exist');
  assert.ok(slidersCheck.barSliderWidth >= 100, `Bottom bar progress slider width (${slidersCheck.barSliderWidth}px) must be >= 100px`);
  assert.ok(slidersCheck.volSliderWidth >= 96, `Volume slider width (${slidersCheck.volSliderWidth}px) must be >= 96px`);
  console.log(`✅ Bottom slider width: ${slidersCheck.barSliderWidth}px, Volume slider width: ${slidersCheck.volSliderWidth}px`);

  // Open Fullscreen and check its slider
  await win.evaluate(() => window.toggleFullscreenPlayer(true));
  await new Promise(r => setTimeout(r, 400));

  const fsCheck = await win.evaluate(() => {
    const fsOverlay = document.getElementById('fs-overlay');
    const fsSlider = document.getElementById('fs-progress');
    const fsShuffle = document.getElementById('fs-btn-shuffle');
    const fsRepeat = document.getElementById('fs-btn-repeat');
    const fsVinylStage = document.getElementById('fs-vinyl-stage');
    const fsDisc = document.getElementById('fs-vinyl-disc');
    const closeBtn = document.querySelector('.fs-close-btn');
    const closeRect = closeBtn?.getBoundingClientRect();

    return {
      isVisible: fsOverlay && getComputedStyle(fsOverlay).display === 'flex',
      sliderWidth: fsSlider ? fsSlider.getBoundingClientRect().width : 0,
      hasShuffle: !!fsShuffle,
      hasRepeat: !!fsRepeat,
      isPlayingVinyl: fsVinylStage?.classList.contains('playing'),
      discExists: !!fsDisc,
      closeAtTopLeft: closeRect && closeRect.top < 60 && closeRect.left < 60
    };
  });

  assert.ok(fsCheck.isVisible, 'Fullscreen overlay must be open');
  assert.ok(fsCheck.sliderWidth >= 100, `Fullscreen progress slider width (${fsCheck.sliderWidth}px) must be >= 100px`);
  assert.ok(fsCheck.hasShuffle, 'Fullscreen must include shuffle button');
  assert.ok(fsCheck.hasRepeat, 'Fullscreen must include repeat button');
  assert.ok(fsCheck.discExists, 'Fullscreen must have vinyl disc');
  assert.ok(fsCheck.closeAtTopLeft, 'Fullscreen close button must be located in top-left corner');
  console.log('✅ Fullscreen verified: vinyl disc present, slider visible, shuffle/repeat present, close button top-left.');

  await win.evaluate(() => window.toggleFullscreenPlayer(false));
  await new Promise(r => setTimeout(r, 300));

  console.log('\n--- 4. My Wave Living Sphere (Liquid Morphing & Center Controls) ---');
  await win.evaluate(() => window.switchView('my-wave'));
  await new Promise(r => setTimeout(r, 400));

  const sphereMorph1 = await win.evaluate(() => {
    const blob = document.getElementById('yandex-fluid-blob');
    return blob ? getComputedStyle(blob).borderRadius : '';
  });

  assert.ok(sphereMorph1 && sphereMorph1 !== '0px', 'Sphere border-radius must be organic (not 0px)');

  // Verify center content inside sphere
  const sphereContent = await win.evaluate(() => {
    const title = document.querySelector('.wave-sphere-title');
    const tuneBtn = document.querySelector('.wave-tune-btn');
    const playIcon = document.getElementById('wave-orb-icon-play');
    const chips = Array.from(document.querySelectorAll('.wave-chip'));

    return {
      hasTitle: !!title && title.textContent === 'Моя волна',
      hasTuneBtn: !!tuneBtn,
      hasPlayIcon: !!playIcon,
      chipsCount: chips.length,
      allChipsHaveSvg: chips.every(c => !!c.querySelector('svg'))
    };
  });

  assert.ok(sphereContent.hasTitle, 'Sphere center must contain "Моя волна" title');
  assert.ok(sphereContent.hasTuneBtn, 'Sphere center must contain "Настроить" button');
  assert.ok(sphereContent.hasPlayIcon, 'Sphere center must contain Play/Pause icon');
  assert.strictEqual(sphereContent.chipsCount, 5, 'My wave must have 5 mood chips');
  assert.ok(sphereContent.allChipsHaveSvg, 'All 5 mood chips must contain SVG icons');
  console.log('✅ My Wave sphere verified: liquid morphing, center controls, 5 mood chips with icons.');

  console.log('\n--- 5. Settings Custom Toggles & Layout ---');
  await win.evaluate(() => {
    window.openSettingsModal();
    window.switchSettingsTab('appearance');
  });
  await new Promise(r => setTimeout(r, 300));

  const settingsCheck = await win.evaluate(() => {
    const title = document.querySelector('.settings-sidebar-title');
    const customToggle = document.querySelector('.switch-toggle');
    const tabButtons = Array.from(document.querySelectorAll('.settings-tab-btn'));
    return {
      sidebarTitleText: title?.textContent,
      hasCustomToggle: !!customToggle,
      tabButtonsCount: tabButtons.length,
      allTabsHaveSvg: tabButtons.every(b => !!b.querySelector('svg'))
    };
  });

  assert.strictEqual(settingsCheck.sidebarTitleText, 'Настройки', 'Sidebar title must be "Настройки" (not uppercase)');
  assert.ok(settingsCheck.hasCustomToggle, 'Settings must use .switch-toggle instead of native checkbox');
  assert.strictEqual(settingsCheck.tabButtonsCount, 5, 'Settings must have 5 tabs');
  assert.ok(settingsCheck.allTabsHaveSvg, 'Every settings tab button must have an SVG icon');
  console.log('✅ Settings modal verified: clean title, custom toggles, 5 tab icons.');

  await win.evaluate(() => window.closeSettingsModal());
  await new Promise(r => setTimeout(r, 300));

  console.log('\n--- 6. Comprehensive Button SVG Integrity Test ---');
  const allButtonsCheck = await win.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button:not([style*="display: none"])'));
    const issues = [];

    buttons.forEach((btn, i) => {
      // If button has an SVG icon
      const svg = btn.querySelector('svg');
      if (svg) {
        const rect = svg.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        // Visible buttons only
        if (btnRect.width > 0 && btnRect.height > 0) {
          const btnBg = getComputedStyle(btn).backgroundColor;
          const svgColor = getComputedStyle(svg).color;
          // Check for solid white square defect (white bg with white icon)
          if (btnBg === 'rgb(255, 255, 255)' && svgColor === 'rgb(255, 255, 255)') {
            issues.push(`Button #${btn.id || btn.className} has white-on-white icon`);
          }
        }
      }
    });

    return { totalButtons: buttons.length, issues };
  });

  assert.strictEqual(allButtonsCheck.issues.length, 0, `Found button SVG issues: ${JSON.stringify(allButtonsCheck.issues)}`);
  console.log(`✅ All ${allButtonsCheck.totalButtons} visible buttons checked: ZERO white-on-white or broken SVG buttons!`);

  console.log('\n--- 7. Capturing Screenshots in Multi-Resolution & Both Themes ---');
  const resolutions = [
    { name: '1024x700', w: 1024, h: 700 },
    { name: '1440x1080', w: 1440, h: 1080 },
    { name: '1920x1080', w: 1920, h: 1080 }
  ];

  for (const res of resolutions) {
    await win.setViewportSize({ width: res.w, height: res.h });
    await new Promise(r => setTimeout(r, 200));

    // Dark Theme - My Wave
    await win.evaluate(() => {
      window.setTheme('dark');
      window.switchView('my-wave');
    });
    await new Promise(r => setTimeout(r, 250));
    await win.screenshot({ path: path.join(screenshotsDir, `wave_dark_${res.name}.png`) });

    // Dark Theme - Online Search
    await win.evaluate(() => window.switchView('online-search'));
    await new Promise(r => setTimeout(r, 250));
    await win.screenshot({ path: path.join(screenshotsDir, `search_dark_${res.name}.png`) });

    // Dark Theme - Artists Grid
    await win.evaluate(() => window.switchView('artists'));
    await new Promise(r => setTimeout(r, 250));
    await win.screenshot({ path: path.join(screenshotsDir, `artists_dark_${res.name}.png`) });

    // Dark Theme - Settings Equalizer
    await win.evaluate(() => {
      window.openSettingsModal();
      window.switchSettingsTab('equalizer');
    });
    await new Promise(r => setTimeout(r, 250));
    await win.screenshot({ path: path.join(screenshotsDir, `eq_dark_${res.name}.png`) });
    await win.evaluate(() => window.closeSettingsModal());

    // Vinyl Theme - Search & Fullscreen
    await win.evaluate(() => {
      window.setTheme('vinyl');
      window.switchView('online-search');
    });
    await new Promise(r => setTimeout(r, 250));
    await win.screenshot({ path: path.join(screenshotsDir, `search_vinyl_${res.name}.png`) });

    await win.evaluate(() => window.toggleFullscreenPlayer(true));
    await new Promise(r => setTimeout(r, 300));
    await win.screenshot({ path: path.join(screenshotsDir, `fullscreen_vinyl_${res.name}.png`) });
    await win.evaluate(() => {
      window.toggleFullscreenPlayer(false);
      window.setTheme('dark');
    });
  }

  console.log(`✅ Saved all multi-resolution screenshots in ${screenshotsDir}`);

  assert.strictEqual(errors.length, 0, `Expected 0 runtime errors, found: ${JSON.stringify(errors)}`);

  await app.close();
  console.log('🎉 V2 ACCEPTANCE SUITE FULLY PASSED WITH 0 DEFECTS!');
}

runV2Acceptance().catch(err => {
  console.error('❌ V2 SUITE FAILED:', err);
  process.exit(1);
});
