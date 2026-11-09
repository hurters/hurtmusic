const { _electron: electron } = require('playwright');
const assert = require('assert');
const path = require('path');

async function testVolumeControl() {
  console.log('🚀 Testing Spotify-Style Volume Control & Playback Volume Adjustment...');

  const app = await electron.launch({
    args: ['.', '--test-mode'],
    env: { ...process.env, ELECTRON_IS_TEST: '1' }
  });

  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForLoadState('domcontentloaded');
  await new Promise(r => setTimeout(r, 1200));

  // ─────────────────────────────────────────────────────────
  // 1. GEOMETRY: Horizontal single-row alignment
  // ─────────────────────────────────────────────────────────
  console.log('Testing horizontal flex alignment (Spotify style)...');
  const geom = await win.evaluate(() => {
    const wrap = document.querySelector('.volume-wrap');
    const muteBtn = document.getElementById('btn-mute');
    const slider = document.getElementById('volume-slider');

    const wrapRect = wrap.getBoundingClientRect();
    const muteRect = muteBtn.getBoundingClientRect();
    const sliderRect = slider.getBoundingClientRect();

    const muteCenterY = muteRect.top + muteRect.height / 2;
    const sliderCenterY = sliderRect.top + sliderRect.height / 2;

    return {
      wrapRect,
      muteRect,
      sliderRect,
      muteCenterY,
      sliderCenterY,
      yDelta: Math.abs(muteCenterY - sliderCenterY),
      wrapDisplay: getComputedStyle(wrap).display,
      wrapAlign: getComputedStyle(wrap).alignItems
    };
  });

  console.log(`  ✓ Volume wrap display: ${geom.wrapDisplay}, align: ${geom.wrapAlign}`);
  console.log(`  ✓ Mute btn rect: left=${geom.muteRect.left.toFixed(1)}, right=${geom.muteRect.right.toFixed(1)}, top=${geom.muteRect.top.toFixed(1)}, height=${geom.muteRect.height.toFixed(1)}`);
  console.log(`  ✓ Slider rect: left=${geom.sliderRect.left.toFixed(1)}, right=${geom.sliderRect.right.toFixed(1)}, top=${geom.sliderRect.top.toFixed(1)}, height=${geom.sliderRect.height.toFixed(1)}`);
  console.log(`  ✓ Vertical center alignment delta: ${geom.yDelta.toFixed(2)}px`);

  assert.strictEqual(geom.wrapDisplay, 'flex', 'volume-wrap must be display: flex');
  assert.ok(geom.muteRect.right <= geom.sliderRect.left + 2, 'Mute button must be positioned strictly to the LEFT of the slider');
  assert.ok(geom.yDelta <= 3, `Mute button and volume slider must be on the exact same horizontal center line (delta: ${geom.yDelta}px)`);
  console.log('✅ Spotify horizontal layout verified: [🔊] and slider on the same horizontal line.');

  // ─────────────────────────────────────────────────────────
  // 2. VOLUME CHANGE: Adjusting volume works
  // ─────────────────────────────────────────────────────────
  console.log('\nTesting volume adjustment and audio.volume binding...');
  
  // Set volume to 0.45
  const vol45 = await win.evaluate(() => {
    const slider = document.getElementById('volume-slider');
    slider.value = '0.45';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    const audioEl = document.querySelector('audio') || window.audio;
    return {
      stateVol: window.state.volume,
      sliderVal: slider.value,
      pctStyle: slider.style.getPropertyValue('--pct'),
      audioVol: audioEl ? audioEl.volume : null
    };
  });

  console.log('  ✓ Setting slider to 0.45: state.volume =', vol45.stateVol, ', audio.volume =', vol45.audioVol, ', --pct =', vol45.pctStyle);
  assert.strictEqual(vol45.stateVol, 0.45, 'state.volume must be 0.45');
  assert.strictEqual(vol45.audioVol, 0.45, 'audio.volume must be updated to 0.45');
  assert.strictEqual(vol45.pctStyle, '45%', 'Slider CSS variable --pct must be 45%');

  // Set volume to 0.1
  const vol10 = await win.evaluate(() => {
    window.setVolume(0.1);
    const slider = document.getElementById('volume-slider');
    const audioEl = document.querySelector('audio') || window.audio;
    return {
      stateVol: window.state.volume,
      sliderVal: slider.value,
      pctStyle: slider.style.getPropertyValue('--pct'),
      audioVol: audioEl ? audioEl.volume : null
    };
  });

  console.log('  ✓ Setting volume via setVolume(0.1): state.volume =', vol10.stateVol, ', audio.volume =', vol10.audioVol);
  assert.strictEqual(vol10.stateVol, 0.1, 'state.volume must be 0.1');
  assert.strictEqual(vol10.audioVol, 0.1, 'audio.volume must be 0.1');

  // ─────────────────────────────────────────────────────────
  // 3. MUTE TOGGLE
  // ─────────────────────────────────────────────────────────
  console.log('\nTesting mute toggle and icon change...');
  const muteResult = await win.evaluate(() => {
    const muteBtn = document.getElementById('btn-mute');
    muteBtn.click(); // Toggle mute

    const iconHigh = document.getElementById('vol-icon-high');
    const iconMute = document.getElementById('vol-icon-mute');
    const audioEl = document.querySelector('audio') || window.audio;

    return {
      isMuted: window.state.isMuted,
      audioVol: audioEl ? audioEl.volume : null,
      iconHighDisplay: iconHigh ? getComputedStyle(iconHigh).display : null,
      iconMuteDisplay: iconMute ? getComputedStyle(iconMute).display : null
    };
  });

  console.log('  ✓ After mute click: isMuted =', muteResult.isMuted, ', audio.volume =', muteResult.audioVol);
  console.log(`  ✓ Icons display: high=${muteResult.iconHighDisplay}, mute=${muteResult.iconMuteDisplay}`);
  assert.strictEqual(muteResult.isMuted, true, 'state.isMuted must be true');
  assert.strictEqual(muteResult.audioVol, 0, 'audio.volume must be 0 when muted');
  assert.strictEqual(muteResult.iconHighDisplay, 'none', 'vol-icon-high must be hidden when muted');
  assert.strictEqual(muteResult.iconMuteDisplay, 'block', 'vol-icon-mute must be visible when muted');

  // Un-mute
  const unmuteResult = await win.evaluate(() => {
    const muteBtn = document.getElementById('btn-mute');
    muteBtn.click(); // Un-mute

    const iconHigh = document.getElementById('vol-icon-high');
    const iconMute = document.getElementById('vol-icon-mute');
    const audioEl = document.querySelector('audio') || window.audio;

    return {
      isMuted: window.state.isMuted,
      stateVol: window.state.volume,
      audioVol: audioEl ? audioEl.volume : null,
      iconHighDisplay: iconHigh ? getComputedStyle(iconHigh).display : null,
      iconMuteDisplay: iconMute ? getComputedStyle(iconMute).display : null
    };
  });

  console.log('  ✓ After un-mute click: isMuted =', unmuteResult.isMuted, ', audio.volume =', unmuteResult.audioVol);
  assert.strictEqual(unmuteResult.isMuted, false, 'state.isMuted must be false');
  assert.ok(unmuteResult.audioVol > 0, 'audio.volume must be restored');
  assert.strictEqual(unmuteResult.iconHighDisplay, 'block', 'vol-icon-high must be visible when unmuted');
  assert.strictEqual(unmuteResult.iconMuteDisplay, 'none', 'vol-icon-mute must be hidden when unmuted');

  // Take screenshot of bottom player bar
  const bottomBarClip = await win.evaluate(() => {
    const bar = document.getElementById('player-bar');
    const rect = bar.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });

  const ssPath = path.resolve(__dirname, 'screenshots_v3/spotify_volume_bar.png');
  await win.screenshot({
    path: ssPath,
    clip: bottomBarClip
  });
  console.log(`📸 Saved bottom bar screenshot to: ${ssPath}`);

  await app.close();
  console.log('\n🎉 ALL SPOTIFY-STYLE VOLUME TESTS PASSED 100%!');
}

testVolumeControl().catch(err => {
  console.error('\n❌ VOLUME TEST FAILED:', err);
  process.exit(1);
});
