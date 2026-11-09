const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.describe('HurtMusic Bugfixes: Pause, Lyrics & Tab Animations', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    
    // Inject mock electron API
    await page.addInitScript(() => {
      window.electronAPI = {
        getDownloadedTracks: () => Promise.resolve([
          { id: 'track_1', originalId: 'orig_1', title: '4 Raws x A Fresh E', artist: 'DWLF', duration: 120, fileUrl: 'mock://track1.mp3' },
          { id: 'track_2', originalId: 'orig_2', title: 'everything (you my)', artist: 'yaego', duration: 150, fileUrl: 'mock://track2.mp3' }
        ]),
        searchOnlineTracks: () => Promise.resolve([]),
        getTrendingTracks: () => Promise.resolve([]),
        getOnlineStreamUrl: (id) => Promise.resolve('mock://stream_' + id + '.mp3'),
        getSimilarTracks: () => Promise.resolve([]),
        onTrayPlayPause: () => {},
        onTrayNext: () => {},
        onTrayPrev: () => {},
        onTrayLike: () => {},
        onMiniPlayerState: () => {},
        onGlobalHotkey: () => {},
        sendPlaybackState: () => {}
      };
      // Mock Audio
      window.HTMLMediaElement.prototype.play = function() {
        this.paused = false;
        this.dispatchEvent(new Event('playing'));
        return Promise.resolve();
      };
      window.HTMLMediaElement.prototype.pause = function() {
        this.paused = true;
        this.dispatchEvent(new Event('pause'));
      };
    });

    const fileUrl = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
    await page.goto(fileUrl);
    await page.waitForLoadState('domcontentloaded');
  });

  test('1. Pause toggle must NOT reset track or switch to a different track', async () => {
    // Start track 1
    await page.evaluate(() => {
      const track1 = { id: 'track_1', originalId: 'orig_1', title: '4 Raws x A Fresh E', artist: 'DWLF', duration: 120 };
      window.playTrackById('track_1', [track1]);
    });

    // Check title in player bar
    const barTitleBefore = await page.$eval('#bar-title', el => el.textContent);
    expect(barTitleBefore).toBe('4 Raws x A Fresh E');

    const isPlayingBefore = await page.evaluate(() => window.state.isPlaying);
    expect(isPlayingBefore).toBe(true);

    // Click play/pause button
    await page.click('#btn-play-pause');

    // Verify track is now paused and title did NOT change to another track
    const isPlayingAfter = await page.evaluate(() => window.state.isPlaying);
    const isPausedAudio = await page.evaluate(() => window.audio.paused);
    const barTitleAfter = await page.$eval('#bar-title', el => el.textContent);
    const currentTrackId = await page.evaluate(() => window.state.currentPlayingTrack ? window.state.currentPlayingTrack.id : null);

    expect(isPlayingAfter).toBe(false);
    expect(isPausedAudio).toBe(true);
    expect(barTitleAfter).toBe('4 Raws x A Fresh E');
    expect(currentTrackId).toBe('track_1');

    // Click play/pause button again to resume
    await page.click('#btn-play-pause');
    const isPlayingResumed = await page.evaluate(() => window.state.isPlaying);
    const barTitleResumed = await page.$eval('#bar-title', el => el.textContent);
    expect(isPlayingResumed).toBe(true);
    expect(barTitleResumed).toBe('4 Raws x A Fresh E');
  });

  test('2. Lyrics drawer opens and displays track title, artist and lyrics container', async () => {
    // Click lyrics button on bottom bar
    await page.click('#btn-lyrics-bar');

    // Verify overlay is visible
    const overlayDisplay = await page.$eval('#lyrics-drawer-overlay', el => window.getComputedStyle(el).display);
    expect(overlayDisplay).toBe('flex');

    const lyricsTitle = await page.$eval('#lyrics-track-title', el => el.textContent);
    expect(lyricsTitle).toBe('4 Raws x A Fresh E');

    // Close lyrics drawer using the close button
    await page.click('.lyrics-close');
    const overlayDisplayClosed = await page.$eval('#lyrics-drawer-overlay', el => window.getComputedStyle(el).display);
    expect(overlayDisplayClosed).toBe('none');
  });

  test('3. Tab switching triggers smooth transition animation classes', async () => {
    // Switch to downloaded
    await page.evaluate(() => window.switchView('downloaded'));
    let hasAnimClass = await page.$eval('#tracks-container-view', el => el.classList.contains('tab-transition-in'));
    expect(hasAnimClass).toBe(true);

    // Switch to artists
    await page.evaluate(() => window.switchView('artists'));
    let artistsHasAnim = await page.$eval('#artists-grid-view', el => el.classList.contains('tab-transition-in'));
    expect(artistsHasAnim).toBe(true);

    // Switch to albums
    await page.evaluate(() => window.switchView('albums'));
    let albumsHasAnim = await page.$eval('#albums-grid-view', el => el.classList.contains('tab-transition-in'));
    expect(albumsHasAnim).toBe(true);

    // Switch to my-wave
    await page.evaluate(() => window.switchView('my-wave'));
    let myWaveDisplay = await page.$eval('#my-wave-view', el => window.getComputedStyle(el).display);
    expect(myWaveDisplay).toBe('flex');
  });
});
