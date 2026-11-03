/**
 * Lane Music Desktop — Native Standalone Player
 * Online streaming & Offline library downloader (No VPN needed)
 */

function loadStoredFavorites() {
  const map = new Map();
  try {
    const rawV2 = localStorage.getItem('lane_favorites_v2');
    if (rawV2) {
      const entries = JSON.parse(rawV2);
      for (const [id, track] of entries) {
        if (track && id) map.set(id, track);
      }
    }
  } catch (e) {
    console.warn('Error loading favorites v2:', e);
  }
  return map;
}

function loadStoredVolume() {
  try {
    const saved = localStorage.getItem('hurt_volume');
    if (saved !== null) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        return parsed;
      }
    }
  } catch (e) {}
  return 0.8;
}

function loadStoredMute() {
  try {
    return localStorage.getItem('hurt_muted') === 'true';
  } catch (e) {}
  return false;
}

// ── App State ──
const state = {
  tracks: [],
  filteredTracks: [],
  onlineTracks: [],
  downloadedTracks: [],
  downloadedTracksMap: new Map(), // id or originalId -> track
  downloadingIds: new Set(),
  currentTrackIndex: -1,
  currentPlayingTrack: null,
  isPlaying: false,
  isSeeking: false,
  shuffle: false,
  shuffleQueue: [],
  shuffleHistory: [],
  repeat: false,
  volume: loadStoredVolume(),
  isMuted: loadStoredMute(),
  currentView: 'online-search', // Default view is Online Search
  searchQuery: '',
  selectedCategory: 'trending',
  isOnlineMode: true,
  isLoadingStream: false,
  favorites: loadStoredFavorites(),

  // My Wave (Моя волна) Infinite Stream State
  isMyWaveActive: false,
  myWaveQueue: [],
  myWaveHistory: [],
  myWaveMood: 'similar', // 'similar' | 'favorites' | 'energetic' | 'chill' | 'fresh'
  seenWaveIds: new Set(),
  isFetchingWaveTracks: false,
  waveSeedTrack: null,
  playbackRequestId: 0
};

// ── HTML5 Audio Player & HLS Streamer ──
const audio = new Audio();
audio.volume = state.isMuted ? 0 : state.volume;
let hlsInstance = null;

// ── Initialize App ──
document.addEventListener('DOMContentLoaded', async () => {
  initResolutionStabilizer();
  initTheme();
  initVolume();
  initWindowControls();
  initTrayListeners();
  initAudioEvents();
  initVisualizer();
  initOtaUpdater();
  await loadDownloadedTracks();
  await initDownloadFolderUI();
  updateMyWaveUI();

  // Load real SoundCloud trending music by default
  await selectSearchCategory('trending');
});

// ─────────────────────────────────────────────────────────────
// Dynamic Resolution & Texture Adapter (Auto-Detects 1440x1080 & 4:3 Stretched)
// Dynamically calculates proportions, prevents texture stretching, and scales assets
// ─────────────────────────────────────────────────────────────
async function changeResolutionPreset(preset) {
  const badge = document.getElementById('res-badge');
  const select = document.getElementById('res-select');
  if (select && select.value !== preset) select.value = preset;

  const presetLabels = {
    'auto': 'АВТО',
    '1440x1080': '1440×1080 (4:3)',
    '1920x1080': '1920×1080 (16:9)',
    '1280x720': '1280×720 (16:9)',
    '1024x768': '1024×768 (4:3)'
  };

  if (badge) badge.textContent = presetLabels[preset] || preset.toUpperCase();
  localStorage.setItem('hurtmusic_res_preset', preset);

  if (preset === 'auto') {
    if (window.electronAPI && window.electronAPI.getScreenMetrics) {
      const m = await window.electronAPI.getScreenMetrics();
      const w = Math.round(m.workWidth * 0.94);
      const h = Math.round(m.workHeight * 0.92);
      if (window.electronAPI.setResolution) {
        await window.electronAPI.setResolution({ width: w, height: h });
      }
    }
  } else {
    const [w, h] = preset.split('x').map(Number);
    if (w && h && window.electronAPI && window.electronAPI.setResolution) {
      await window.electronAPI.setResolution({ width: w, height: h });
    }
  }

  showToast(`Разрешение: ${presetLabels[preset] || preset}`);
  setTimeout(() => {
    if (window.applyResolutionRules) window.applyResolutionRules();
  }, 60);
}

window.changeResolutionPreset = changeResolutionPreset;

async function initResolutionStabilizer() {
  async function applyResolutionRules() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
    const dpr = window.devicePixelRatio || 1;
    const winAspect = width / height;
    const screenAspect = screenWidth / screenHeight;

    let is1440x1080 = (screenWidth === 1440 && screenHeight === 1080) ||
                      (Math.round(screenWidth * dpr) === 1440 && Math.round(screenHeight * dpr) === 1080);
    let is4x3 = is1440x1080 || screenAspect < 1.5 || winAspect < 1.48;

    // Fetch accurate OS display metrics via IPC if available
    if (window.electronAPI && window.electronAPI.getScreenMetrics) {
      try {
        const metrics = await window.electronAPI.getScreenMetrics();
        if (metrics.is1440x1080) is1440x1080 = true;
        if (metrics.is4x3) is4x3 = true;
      } catch (err) {
        // Fallback to DOM detection
      }
    }

    const root = document.documentElement;
    root.style.setProperty('--window-w', `${width}px`);
    root.style.setProperty('--window-h', `${height}px`);

    // UI Scale calculation (Baseline 1440 width)
    const uiScale = Math.min(1.22, Math.max(0.85, width / 1440));
    root.style.setProperty('--ui-scale', uiScale.toFixed(3));

    // Dynamic texture adaptations:
    // 1. Hero Vinyl Jacket: strictly 1:1 square, scales smoothly so it never overflows
    const jacketSize = Math.round(Math.min(136, Math.max(90, (is4x3 ? 116 : 128) * uiScale)));
    root.style.setProperty('--hero-jacket-size', `${jacketSize}px`);

    // 2. Wave Sphere Orb: perfectly circular 1:1 aspect, counteracting 4:3 horizontal stretch
    const sphereSize = Math.round(Math.min(124, Math.max(76, (is4x3 ? 104 : 118) * uiScale)));
    root.style.setProperty('--sphere-size', `${sphereSize}px`);

    // 3. Track List Cover Art: always 1:1 square
    const trackCoverSize = Math.round(Math.min(48, Math.max(38, 44 * uiScale)));
    root.style.setProperty('--track-cover-size', `${trackCoverSize}px`);

    // 4. Player Dock Bar height
    const barHeight = Math.round(Math.min(86, Math.max(76, 82 * uiScale)));
    root.style.setProperty('--bar-height', `${barHeight}px`);

    // 5. Sidebar width: balanced at 230px on 1440x1080
    const sidebarWidth = is4x3 ? (width < 1080 ? 200 : 230) : (width < 1080 ? 200 : 250);
    root.style.setProperty('--sidebar-w', `${sidebarWidth}px`);

    // Update targeting classes on body
    document.body.classList.toggle('res-1440-1080', is1440x1080);
    document.body.classList.toggle('aspect-4-3', is4x3);
    document.body.classList.toggle('win-compact-w', width < 1060);
    document.body.classList.toggle('win-mini-w', width < 840);
  }

  window.applyResolutionRules = applyResolutionRules;
  window.addEventListener('resize', applyResolutionRules);
  if (window.electronAPI && window.electronAPI.onScreenMetricsChanged) {
    window.electronAPI.onScreenMetricsChanged(() => applyResolutionRules());
  }

  // Restore saved resolution preset
  const savedPreset = localStorage.getItem('hurtmusic_res_preset');
  if (savedPreset) {
    const select = document.getElementById('res-select');
    if (select) select.value = savedPreset;
    const badge = document.getElementById('res-badge');
    const presetLabels = {
      'auto': 'АВТО',
      '1440x1080': '1440×1080 (4:3)',
      '1920x1080': '1920×1080 (16:9)',
      '1280x720': '1280×720 (16:9)',
      '1024x768': '1024×768 (4:3)'
    };
    if (badge) badge.textContent = presetLabels[savedPreset] || savedPreset;
  }

  applyResolutionRules();
}

function initTrayListeners() {
  if (!window.electronAPI) return;

  if (window.electronAPI.onTrayPlayPause) {
    window.electronAPI.onTrayPlayPause(() => togglePlayPause());
  }
  if (window.electronAPI.onTrayNext) {
    window.electronAPI.onTrayNext(() => playNext());
  }
  if (window.electronAPI.onTrayPrev) {
    window.electronAPI.onTrayPrev(() => playPrevious());
  }
  if (window.electronAPI.onTrayFavorite) {
    window.electronAPI.onTrayFavorite(() => toggleCurrentTrackFavorite());
  }

  // Mini-Player IPC state listener
  if (window.electronAPI.onMiniPlayerState) {
    window.electronAPI.onMiniPlayerState((isMini) => {
      document.body.classList.toggle('mini-player-mode', isMini);
      updateMiniPlayerUI();
    });
  }

  // Global Media Keys & Mini-Player Hotkeys (MediaPlayPause, MediaNext, MediaPrev)
  if (window.electronAPI.onGlobalHotkey) {
    window.electronAPI.onGlobalHotkey((action) => {
      if (action === 'play-pause') {
        togglePlayPause();
      } else if (action === 'next') {
        playNext();
      } else if (action === 'previous') {
        playPrevious();
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 0. Theme Manager (Hurt Dark & SoundCloud Vinyl Noir)
// ─────────────────────────────────────────────────────────────
function initTheme() {
  // Default to the requested Vinyl Opium design
  const savedTheme = localStorage.getItem('hurt_theme') || 'vinyl';
  setTheme(savedTheme, false);
}

function setTheme(mode, showNotification = true) {
  const html = document.documentElement;
  const isVinyl = mode === 'vinyl' || mode === 'light';

  if (isVinyl) {
    html.classList.remove('dark');
    html.classList.remove('light');
    html.classList.add('vinyl');
    localStorage.setItem('hurt_theme', 'vinyl');
  } else {
    html.classList.remove('vinyl');
    html.classList.remove('light');
    html.classList.add('dark');
    localStorage.setItem('hurt_theme', 'dark');
  }

  // Update header button
  const iconSvg = document.getElementById('theme-icon-svg');
  const text = document.getElementById('theme-text');
  if (iconSvg) {
    if (isVinyl) {
      iconSvg.innerHTML = '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle>';
    } else {
      iconSvg.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    }
  }
  if (text) text.textContent = isVinyl ? 'Винил Опиум' : 'Hurt Dark';

  // Update sidebar buttons
  const badge = document.getElementById('theme-badge');
  const btnDark = document.getElementById('btn-theme-dark');
  const btnLight = document.getElementById('btn-theme-light');

  if (badge) {
    badge.textContent = isVinyl ? 'Винил Опиум' : 'Hurt Dark';
    badge.style.color = isVinyl ? '#f59e0b' : '#3b82f6';
  }
  if (btnDark) {
    btnDark.style.border = !isVinyl ? '1px solid rgba(255,255,255,0.2)' : '1px solid var(--border-color)';
    btnDark.style.background = !isVinyl ? '#232325' : 'transparent';
    btnDark.style.color = !isVinyl ? 'var(--text-primary)' : 'var(--text-secondary)';
    btnDark.style.fontWeight = '500';
  }
  if (btnLight) {
    btnLight.style.border = isVinyl ? '1px solid rgba(255,255,255,0.2)' : '1px solid var(--border-color)';
    btnLight.style.background = isVinyl ? '#232325' : 'transparent';
    btnLight.style.color = isVinyl ? 'var(--text-primary)' : 'var(--text-secondary)';
    btnLight.style.fontWeight = '500';
  }

  if (showNotification) {
    showToast(isVinyl ? 'Стиль «Винил Опиум» включён' : 'Классическая тёмная тема');
  }
}

function toggleTheme() {
  const isVinyl = document.documentElement.classList.contains('vinyl');
  setTheme(isVinyl ? 'dark' : 'vinyl', true);
}

window.setTheme = setTheme;
window.toggleTheme = toggleTheme;

// ─────────────────────────────────────────────────────────────
// 1. Native Window Controls (Apple Minimalist)
// ─────────────────────────────────────────────────────────────
function initWindowControls() {
  const btnMin = document.getElementById('btn-minimize');
  const btnMax = document.getElementById('btn-maximize');
  const btnClose = document.getElementById('btn-close');
  const iconMax = document.getElementById('icon-max');
  const iconRestore = document.getElementById('icon-restore');

  if (window.electronAPI) {
    btnMin.addEventListener('click', () => window.electronAPI.minimize());
    btnMax.addEventListener('click', async () => {
      const isMax = await window.electronAPI.maximize();
      updateMaxIcon(isMax);
    });
    btnClose.addEventListener('click', () => window.electronAPI.close());

    window.electronAPI.onWindowStateChanged(({ isMaximized }) => {
      updateMaxIcon(isMaximized);
    });
  }

  function updateMaxIcon(isMax) {
    if (iconMax && iconRestore) {
      iconMax.style.display = isMax ? 'none' : 'block';
      iconRestore.style.display = isMax ? 'block' : 'none';
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 2. Offline Downloads & Library Management
// ─────────────────────────────────────────────────────────────
async function loadDownloadedTracks() {
  if (window.electronAPI && window.electronAPI.getDownloadedTracks) {
    try {
      const list = await window.electronAPI.getDownloadedTracks();
      state.downloadedTracks = list || [];
      state.downloadedTracksMap.clear();

      let totalBytes = 0;
      for (const t of state.downloadedTracks) {
        state.downloadedTracksMap.set(t.id, t);
        if (t.originalId) {
          state.downloadedTracksMap.set(t.originalId, t);
        }
        totalBytes += (t.sizeBytes || 0);
      }

      updateStorageBadge(state.downloadedTracks.length, totalBytes);
      updateBarDownloadButtonUI();
    } catch (err) {
      console.warn('Error loading downloaded tracks:', err);
    }
  }
}

function updateStorageBadge(count, totalBytes) {
  const countEl = document.getElementById('downloaded-count-label');
  const sizeEl = document.getElementById('storage-size-label');
  if (countEl) countEl.textContent = `${count} скачанных треков`;
  if (sizeEl) sizeEl.textContent = `${(totalBytes / 1024 / 1024).toFixed(1)} МБ на диске`;
}

async function handleTrackDownload(trackId) {
  // If track is already downloaded: ask to delete or open
  const existing = state.downloadedTracksMap.get(trackId);
  if (existing) {
    if (confirm(`Удалить "${existing.title}" из скачанных треков?`)) {
      showToast(`Удаление: ${existing.title}...`);
      await window.electronAPI.deleteDownloadedTrack(existing.id);
      await loadDownloadedTracks();
      showToast(`Трек удален с диска`);
      applyFilters();
    }
    return;
  }

  // Find track in online tracks, current list, or wave queue
  const track = state.filteredTracks.find(t => t.id === trackId) ||
                state.onlineTracks.find(t => t.id === trackId) ||
                state.myWaveQueue.find(t => t.id === trackId) ||
                (state.currentPlayingTrack && state.currentPlayingTrack.id === trackId ? state.currentPlayingTrack : null);
  if (!track) return;

  showToast(`Скачивание трека: ${track.title}...`);
  state.downloadingIds.add(track.id);
  renderTrackList();
  renderWaveQueue();

  try {
    const res = await window.electronAPI.downloadTrack(track);
    if (res && res.success) {
      showToast(`Загрузка завершена: ${track.title}`);
      await loadDownloadedTracks();
    } else {
      showToast(`Ошибка скачивания: ${res && res.error ? res.error : 'не удалось скачать'}`);
    }
  } catch (err) {
    showToast(`Ошибка скачивания: ${err.message}`);
  } finally {
    state.downloadingIds.delete(track.id);
    applyFilters();
    renderWaveQueue();
  }
}

// ─────────────────────────────────────────────────────────────
// 3. Audio Player Engine & HLS Streaming
// ─────────────────────────────────────────────────────────────
function initAudioEvents() {
  audio.addEventListener('loadedmetadata', () => {
    updateScrubberProgress();
    document.getElementById('duration-label').textContent = formatTime(audio.duration);
    document.getElementById('fs-dur-time').textContent = formatTime(audio.duration);
  });

  audio.addEventListener('timeupdate', () => {
    if (!state.isSeeking && audio.duration) {
      updateScrubberProgress();
    }
  });

  audio.addEventListener('ended', () => {
    if (state.repeat) {
      audio.currentTime = 0;
      audio.play();
    } else if (state.isMyWaveActive) {
      playNextMyWaveTrack();
    } else {
      playNext();
    }
  });

  audio.addEventListener('waiting', () => {
    const playBtn = document.getElementById('btn-play-pause');
    if (playBtn) playBtn.style.opacity = '0.65';
  });

  audio.addEventListener('playing', () => {
    const playBtn = document.getElementById('btn-play-pause');
    if (playBtn) playBtn.style.opacity = '1';
    setPlaybackState(true);
  });

  audio.addEventListener('error', (e) => {
    if (hlsInstance) return;
    console.error('Playback error:', e);
    showToast('Ошибка воспроизведения аудиофайла');
    setPlaybackState(false);
  });
}

async function playTrackDirect(track, pushToHistory = true) {
  if (!track) return;
  const currentReqId = ++state.playbackRequestId;

  if (pushToHistory && state.currentPlayingTrack && state.currentPlayingTrack.id !== track.id) {
    state.myWaveHistory.push(state.currentPlayingTrack);
    if (state.myWaveHistory.length > 50) state.myWaveHistory.shift();
  }

  // Clean up any previous HLS stream and pause previous audio
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  audio.pause();

  // If track was already downloaded offline, play directly from local file
  const localDownloaded = state.downloadedTracksMap.get(track.id) || 
                          (track.originalId ? state.downloadedTracksMap.get(track.originalId) : null);
  if (localDownloaded && localDownloaded.fileUrl) {
    track = localDownloaded;
  }
  state.currentPlayingTrack = track;

  if (track.isOnline && !track.fileUrl) {
    // Online Stream Playback
    showToast(`Воспроизведение: ${track.title}...`);
    state.isLoadingStream = true;

    let streamUrl = track.streamUrl;
    if (!streamUrl && window.electronAPI && window.electronAPI.getOnlineStreamUrl) {
      streamUrl = await window.electronAPI.getOnlineStreamUrl(track.id);
    }

    // Check if another track was clicked while this stream URL was resolving
    if (currentReqId !== state.playbackRequestId) {
      return;
    }

    if (!streamUrl) {
      showToast('Не удалось загрузить аудиопоток');
      state.isLoadingStream = false;
      return;
    }
    state.isLoadingStream = false;

    // Check if stream is HLS (.m3u8)
    const isHls = streamUrl.includes('.m3u8') || streamUrl.includes('playlist');
    if (isHls && window.Hls && Hls.isSupported()) {
      hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60
      });
      hlsInstance.loadSource(streamUrl);
      hlsInstance.attachMedia(audio);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (currentReqId !== state.playbackRequestId) return;
        audio.play().then(() => setPlaybackState(true)).catch((err) => {
          console.warn('HLS play error:', err);
          setPlaybackState(false);
        });
      });
      hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('HLS network error, recovering...');
              hlsInstance.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS media error, recovering...');
              hlsInstance.recoverMediaError();
              break;
            default:
              console.warn('HLS fatal error:', data);
              showToast('Ошибка воспроизведения потока');
              setPlaybackState(false);
              break;
          }
        }
      });
    } else {
      audio.src = streamUrl;
      audio.load();
      audio.play().then(() => {
        if (currentReqId !== state.playbackRequestId) return;
        setPlaybackState(true);
      }).catch((err) => {
        console.warn('Playback error:', err);
        setPlaybackState(false);
      });
    }
  } else {
    // Offline Local Playback (Instant, Zero Network)
    audio.src = track.fileUrl;
    audio.load();
    audio.play().then(() => {
      if (currentReqId !== state.playbackRequestId) return;
      setPlaybackState(true);
    }).catch((err) => {
      console.warn('Local playback error:', err);
      setPlaybackState(false);
    });
  }

  // If My Wave is active, dynamically re-anchor recommendations to this newly played track
  const trackCanId = (track.originalId || track.id);
  const seedCanId = state.waveSeedTrack ? (state.waveSeedTrack.originalId || state.waveSeedTrack.id) : null;
  if (state.isMyWaveActive) {
    if (!state.waveSeedTrack || seedCanId !== trackCanId) {
      state.waveSeedTrack = track;
      if (state.myWaveMood === 'similar') {
        state.myWaveQueue = []; // Clear outdated queue so upcoming songs match this song!
        fetchWaveRecommendations('similar', false);
      }
    }
  } else {
    state.waveSeedTrack = track;
  }

  updatePlayerUI(track);
  updateMyWaveUI();
  renderTrackList();
  renderWaveQueue();
}

async function playTrack(index) {
  if (index < 0 || index >= state.filteredTracks.length) return;

  state.currentTrackIndex = index;
  // If shuffle is active and user selects a track directly, remove it from pending shuffleQueue
  if (state.shuffle && Array.isArray(state.shuffleQueue)) {
    const qIdx = state.shuffleQueue.indexOf(index);
    if (qIdx !== -1) {
      state.shuffleQueue.splice(qIdx, 1);
    }
  }

  const track = state.filteredTracks[index];
  await playTrackDirect(track, true);
}

function togglePlayPause() {
  if (state.currentTrackIndex === -1 && state.filteredTracks.length > 0) {
    playTrack(0);
    return;
  }

  if (audio.paused) {
    audio.play().then(() => setPlaybackState(true)).catch(() => {});
  } else {
    audio.pause();
    setPlaybackState(false);
  }
}

function setPlaybackState(isPlaying) {
  state.isPlaying = isPlaying;

  const playIcon = document.getElementById('icon-play');
  const pauseIcon = document.getElementById('icon-pause');
  const fsPlayIcon = document.getElementById('fs-icon-play');
  const fsPauseIcon = document.getElementById('fs-icon-pause');
  const btnPlayPause = document.getElementById('btn-play-pause');
  const barCoverArt = document.getElementById('bar-cover-art');

  if (playIcon) playIcon.style.display = isPlaying ? 'none' : 'block';
  if (pauseIcon) pauseIcon.style.display = isPlaying ? 'block' : 'none';
  if (fsPlayIcon) fsPlayIcon.style.display = isPlaying ? 'none' : 'block';
  if (fsPauseIcon) fsPauseIcon.style.display = isPlaying ? 'block' : 'none';

  const heroPlayIcon = document.getElementById('hero-icon-play');
  const heroPauseIcon = document.getElementById('hero-icon-pause');
  if (heroPlayIcon) heroPlayIcon.style.display = isPlaying ? 'none' : 'block';
  if (heroPauseIcon) heroPauseIcon.style.display = isPlaying ? 'block' : 'none';

  const heroVinyl = document.getElementById('hero-vinyl-stage');
  if (heroVinyl) heroVinyl.classList.toggle('playing', isPlaying);

  // Reactive Audio Visualizer control
  if (visualizer) {
    if (isPlaying) {
      if (audio && visualizer.connect) visualizer.connect(audio);
      visualizer.start();
    } else {
      visualizer.stop();
    }
  }

  const fsVinylStage = document.getElementById('fs-vinyl-stage');
  if (fsVinylStage) fsVinylStage.classList.toggle('playing', isPlaying);

  // Apple Spring Pop Animation
  if (btnPlayPause) {
    btnPlayPause.classList.remove('spring-pop');
    void btnPlayPause.offsetWidth; // Reflow for instant spring trigger
    btnPlayPause.classList.add('spring-pop');
  }

  if (barCoverArt) {
    barCoverArt.classList.toggle('playing', isPlaying);
  }

  if (vinyl) {
    vinyl.classList.toggle('playing', isPlaying);
  }

  const waveOrb = document.getElementById('wave-sphere-orb');
  const waveOrbPlay = document.getElementById('wave-orb-icon-play');
  const waveOrbPause = document.getElementById('wave-orb-icon-pause');
  if (waveOrb) {
    waveOrb.classList.toggle('playing', isPlaying && state.isMyWaveActive);
  }
  if (waveOrbPlay && waveOrbPause) {
    const isWavePlaying = isPlaying && state.isMyWaveActive;
    waveOrbPlay.style.display = isWavePlaying ? 'none' : 'block';
    waveOrbPause.style.display = isWavePlaying ? 'block' : 'none';
  }

  syncDiscordRPC();
  syncPlaybackWithMain();
  updateMiniPlayerUI();
}

function syncPlaybackWithMain() {
  if (!window.electronAPI || !window.electronAPI.sendPlaybackState) return;
  const track = state.currentPlayingTrack;
  window.electronAPI.sendPlaybackState({
    title: track ? track.title : '',
    artist: track ? track.artist : '',
    isPlaying: state.isPlaying
  });
}

function syncDiscordRPC() {
  if (!window.electronAPI || !window.electronAPI.updateDiscordRPC) return;
  const track = state.currentPlayingTrack;
  if (!track) {
    window.electronAPI.clearDiscordRPC();
    return;
  }

  const dur = (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration))
    ? audio.duration
    : (track.duration || 0);

  window.electronAPI.updateDiscordRPC({
    title: track.title,
    artist: track.artist,
    album: state.isMyWaveActive ? 'Моя волна' : (track.album || 'hurtmusic'),
    coverUrl: track.coverUrl || '',
    isPlaying: state.isPlaying,
    currentTime: audio.currentTime || 0,
    duration: dur
  });
}

// ─────────────────────────────────────────────────────────────
// Fisher-Yates Shuffled Playback Queue
// Ensures no track is repeated until all tracks in the playlist are played,
// and prevents the current track from immediately replaying.
// ─────────────────────────────────────────────────────────────
function buildShuffleQueue(currentPlayingIdx = -1) {
  const total = state.filteredTracks.length;
  if (total <= 1) {
    state.shuffleQueue = total === 1 ? [0] : [];
    return;
  }

  // Create pool of all valid track indices except currentPlayingIdx
  const pool = [];
  for (let i = 0; i < total; i++) {
    if (i !== currentPlayingIdx) {
      pool.push(i);
    }
  }

  // Modern Fisher-Yates shuffle algorithm
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  state.shuffleQueue = pool;
}

function playNext() {
  if (state.isMyWaveActive) {
    playNextMyWaveTrack();
    return;
  }

  if (state.filteredTracks.length === 0) return;

  if (state.shuffle) {
    // If shuffle queue is exhausted, rebuild pool to loop continuously without immediate repeats
    if (!state.shuffleQueue || state.shuffleQueue.length === 0) {
      buildShuffleQueue(state.currentTrackIndex);
    }

    if (!state.shuffleQueue || state.shuffleQueue.length === 0) {
      // Single track in current playlist
      if (state.filteredTracks.length > 0) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
      return;
    }

    const nextIndex = state.shuffleQueue.shift();
    if (state.currentTrackIndex !== -1) {
      state.shuffleHistory.push(state.currentTrackIndex);
      if (state.shuffleHistory.length > 100) state.shuffleHistory.shift();
    }
    playTrack(nextIndex);
    return;
  }

  const nextIndex = (state.currentTrackIndex + 1) % state.filteredTracks.length;
  playTrack(nextIndex);
}

function playPrevious() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  if (state.isMyWaveActive && state.myWaveHistory.length > 0) {
    const prevTrack = state.myWaveHistory.pop();
    if (state.currentPlayingTrack) {
      state.myWaveQueue.unshift(state.currentPlayingTrack);
    }
    playTrackDirect(prevTrack, false);
    renderWaveQueue();
    return;
  }

  if (state.filteredTracks.length === 0) return;

  if (state.shuffle && state.shuffleHistory && state.shuffleHistory.length > 0) {
    const prevIndex = state.shuffleHistory.pop();
    if (state.currentTrackIndex !== -1) {
      state.shuffleQueue.unshift(state.currentTrackIndex);
    }
    playTrack(prevIndex);
    return;
  }

  const prevIndex = (state.currentTrackIndex - 1 + state.filteredTracks.length) % state.filteredTracks.length;
  playTrack(prevIndex);
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  if (state.shuffle) {
    buildShuffleQueue(state.currentTrackIndex);
  } else {
    state.shuffleQueue = [];
    state.shuffleHistory = [];
  }
  updateShuffleUI();
  showToast(state.shuffle ? 'Случайный порядок вкл.' : 'Случайный порядок выкл.');
}

function updateShuffleUI() {
  const btn = document.getElementById('btn-shuffle');
  if (btn) {
    btn.style.color = state.shuffle ? 'var(--accent)' : 'var(--text-tertiary)';
  }
  const heroBtn = document.getElementById('hero-shuffle-btn');
  if (heroBtn) {
    heroBtn.style.color = state.shuffle ? 'var(--accent)' : 'inherit';
    heroBtn.style.borderColor = state.shuffle ? 'var(--accent)' : 'rgba(255, 255, 255, 0.12)';
    heroBtn.style.background = state.shuffle ? 'rgba(51, 144, 236, 0.2)' : 'rgba(255, 255, 255, 0.08)';
  }
}

function toggleRepeat() {
  state.repeat = !state.repeat;
  const btn = document.getElementById('btn-repeat');
  if (btn) {
    btn.style.color = state.repeat ? 'var(--accent)' : 'var(--text-tertiary)';
  }
  showToast(state.repeat ? 'Повтор трека вкл.' : 'Повтор выкл.');
}

// ─────────────────────────────────────────────────────────────
// 4. Scrubbing & Volume Controls
// ─────────────────────────────────────────────────────────────
function onScrubInput(val) {
  state.isSeeking = true;
  if (audio.duration) {
    const curTime = (val / 100) * audio.duration;
    document.getElementById('current-time-label').textContent = formatTime(curTime);
    document.getElementById('fs-cur-time').textContent = formatTime(curTime);
  }
  updateSliderStyle('progress-slider', val);
  updateSliderStyle('fs-progress', val);
}

function onScrubChange(val) {
  if (audio.duration) {
    audio.currentTime = (val / 100) * audio.duration;
  }
  state.isSeeking = false;
  syncDiscordRPC();
}

function updateScrubberProgress() {
  const dur = (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration))
    ? audio.duration
    : (state.currentPlayingTrack ? state.currentPlayingTrack.duration : 0);

  if (!dur) return;
  const pct = Math.min(100, Math.max(0, (audio.currentTime / dur) * 100));
  
  const slider = document.getElementById('progress-slider');
  const fsSlider = document.getElementById('fs-progress');

  if (slider) {
    slider.value = pct;
    updateSliderStyle('progress-slider', pct);
  }
  if (fsSlider) {
    fsSlider.value = pct;
    updateSliderStyle('fs-progress', pct);
  }

  document.getElementById('current-time-label').textContent = formatTime(audio.currentTime);
  const remaining = Math.max(0, dur - audio.currentTime);
  document.getElementById('duration-label').textContent = '-' + formatTime(remaining);
  document.getElementById('fs-cur-time').textContent = formatTime(audio.currentTime);
  document.getElementById('fs-dur-time').textContent = '-' + formatTime(remaining);
}

function initVolume() {
  const volSlider = document.getElementById('volume-slider');
  const activeVol = state.isMuted ? 0 : state.volume;
  if (volSlider) {
    volSlider.value = activeVol;
    updateSliderStyle('volume-slider', activeVol * 100);
  }
  updateMuteIcon();
}

function setVolume(val) {
  state.volume = parseFloat(val);
  state.isMuted = (state.volume === 0);
  audio.volume = state.isMuted ? 0 : state.volume;

  try {
    localStorage.setItem('hurt_volume', String(state.volume));
    localStorage.setItem('hurt_muted', String(state.isMuted));
  } catch (e) {}

  updateSliderStyle('volume-slider', state.volume * 100);
  updateMuteIcon();
}

function toggleMute() {
  state.isMuted = !state.isMuted;
  try {
    localStorage.setItem('hurt_muted', String(state.isMuted));
  } catch (e) {}

  const volSlider = document.getElementById('volume-slider');
  if (state.isMuted) {
    audio.volume = 0;
    if (volSlider) volSlider.value = 0;
    updateSliderStyle('volume-slider', 0);
  } else {
    audio.volume = state.volume > 0 ? state.volume : 0.8;
    if (volSlider) volSlider.value = audio.volume;
    updateSliderStyle('volume-slider', audio.volume * 100);
  }
  updateMuteIcon();
}

function updateMuteIcon() {
  const iconHigh = document.getElementById('icon-vol-high');
  const iconMute = document.getElementById('icon-vol-mute');
  if (iconHigh && iconMute) {
    iconHigh.style.display = state.isMuted ? 'none' : 'block';
    iconMute.style.display = state.isMuted ? 'block' : 'none';
  }
}

function updateSliderStyle(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.setProperty('--pct', pct + '%');
}

// ─────────────────────────────────────────────────────────────
// 5. UI Updates & Rendering
// ─────────────────────────────────────────────────────────────
function updatePlayerUI(track) {
  document.getElementById('bar-title').textContent = track.title;
  document.getElementById('bar-artist').textContent = track.artist + (track.album ? ` · ${track.album}` : '');

  document.getElementById('fs-title').textContent = track.title;
  document.getElementById('fs-artist').textContent = track.artist;

  // Hero section updates (Bleood style album presentation)
  const heroTitle = document.getElementById('hero-title');
  const heroArtistName = document.getElementById('hero-artist-name');
  const heroBadge = document.getElementById('hero-badge');
  const heroCoverImg = document.getElementById('hero-cover-img');
  const heroPlaceholder = document.getElementById('hero-cover-placeholder');
  const fsCoverImg = document.getElementById('fs-cover-img');
  const fsPlaceholder = document.getElementById('fs-placeholder-icon');

  if (heroTitle && track.title) heroTitle.textContent = track.title;
  if (heroArtistName && track.artist) heroArtistName.textContent = `By ${track.artist}`;
  if (heroBadge) heroBadge.textContent = `Album (2026) · ${track.durationFormatted || '3:30'}`;

  // Cover Art handling
  const barCoverArt = document.getElementById('bar-cover-art');

  if (track.coverUrl) {
    barCoverArt.innerHTML = `<img src="${track.coverUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:6px;" onerror="this.style.display='none';" />`;
    if (heroCoverImg) {
      heroCoverImg.src = track.coverUrl;
      heroCoverImg.style.display = 'block';
      if (heroPlaceholder) heroPlaceholder.style.display = 'none';
    }
    if (fsCoverImg) {
      fsCoverImg.src = track.coverUrl;
      fsCoverImg.style.display = 'block';
      if (fsPlaceholder) fsPlaceholder.style.display = 'none';
    }
  } else {
    barCoverArt.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
        <path d="M9 18V5l12-2v13"></path>
        <circle cx="6" cy="18" r="3"></circle>
        <circle cx="18" cy="16" r="3"></circle>
      </svg>
    `;
    if (heroCoverImg) heroCoverImg.style.display = 'none';
    if (heroPlaceholder) heroPlaceholder.style.display = 'flex';
    if (fsCoverImg) fsCoverImg.style.display = 'none';
    if (fsPlaceholder) fsPlaceholder.style.display = 'block';
  }

  // Dynamic Ambient Aurora Layer (Liner Desktop Style)
  const backdrop = document.getElementById('ambient-backdrop');
  if (backdrop) {
    const isVinyl = document.documentElement.classList.contains('vinyl');
    if (track.coverUrl) {
      const tintColor = isVinyl ? 'rgba(255, 85, 0, 0.28)' : 'rgba(51, 144, 236, 0.24)';
      backdrop.style.background = `radial-gradient(circle at 68% 28%, ${tintColor} 0%, rgba(10, 10, 14, 0.92) 75%), url("${track.coverUrl}") center/cover no-repeat`;
      backdrop.style.opacity = '0.65';
    } else {
      const defaultGlow = isVinyl ? 'rgba(255, 85, 0, 0.16)' : 'rgba(51, 144, 236, 0.14)';
      backdrop.style.background = `radial-gradient(circle at 60% 25%, ${defaultGlow} 0%, transparent 70%)`;
      backdrop.style.opacity = '0.5';
    }
  }

  updateFavoriteButtonUI(track.originalId || track.id);
  syncPlaybackWithMain();
  updateMiniPlayerUI();
  updateBarDownloadButtonUI();
}

function renderTrackList() {
  const container = document.getElementById('track-list');
  const emptyState = document.getElementById('empty-state');
  const statsLabel = document.getElementById('track-stats-label');

  if (statsLabel) {
    statsLabel.textContent = `${state.filteredTracks.length} треков`;
  }

  if (state.filteredTracks.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  container.innerHTML = state.filteredTracks.map((track, idx) => {
    const isPlayingThis = state.currentTrackIndex === idx;
    const canonicalId = (track.originalId || track.id).replace('local_dl_', '');
    const isFav = state.favorites.has(canonicalId) || state.favorites.has(track.id);
    const isDown = state.downloadedTracksMap.has(track.id) || (track.originalId && state.downloadedTracksMap.has(track.originalId)) || track.isDownloaded;
    const isDownloading = state.downloadingIds.has(track.id);
    const sizeMb = track.sizeBytes ? (track.sizeBytes / (1024 * 1024)).toFixed(1) : null;

    return `
      <div class="track-row ${isPlayingThis ? 'now-playing' : ''}" style="--item-idx: ${Math.min(idx, 16)};" onclick="playTrack(${idx})">
        <!-- Number / Animated Equalizer / Play Icon -->
        <div style="width:28px; text-align:center; font-size:12px; color:var(--text-tertiary); font-weight:600; display:flex; align-items:center; justify-content:center;">
          ${isPlayingThis 
            ? `<div class="ios-equalizer" title="Воспроизводится"><span class="ios-eq-bar bar-1"></span><span class="ios-eq-bar bar-2"></span><span class="ios-eq-bar bar-3"></span></div>`
            : idx + 1
          }
        </div>

        <!-- Cover Art -->
        <div class="track-cover-art">
          ${track.coverUrl 
            ? `<img src="${track.coverUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:6px;" loading="lazy" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&q=80';" />`
            : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${isPlayingThis ? '#3390EC' : 'rgba(255,255,255,0.7)'}" stroke-width="2">
                <path d="M9 18V5l12-2v13"></path>
                <circle cx="6" cy="18" r="3"></circle>
                <circle cx="18" cy="16" r="3"></circle>
              </svg>`
          }
        </div>

        <!-- Title & Artist -->
        <div style="flex:1; min-width:0;">
          <p class="track-title" style="font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(track.title)}
          </p>
          <p style="font-size:12px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(track.artist)}
          </p>
        </div>

        <!-- Album name -->
        <div class="track-row-album" style="flex:0.8; font-size:12.5px; color:var(--text-tertiary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${escapeHtml(track.album || (isDown ? 'Скачано' : 'Онлайн'))}
        </div>

        <!-- Track Duration / Status -->
        <span class="track-duration" style="font-size:12px; font-variant-numeric:tabular-nums; color:var(--text-tertiary); min-width:44px; text-align:right;">
          ${track.durationFormatted || '3:30'}
        </span>

        <!-- Download Button -->
        <button onclick="event.stopPropagation(); handleTrackDownload('${track.id}')"
                title="${isDown ? 'Скачано (нажмите для удаления)' : 'Скачать для прослушивания офлайн'}"
                style="background:transparent; border:none; color:${isDown ? '#22c55e' : 'var(--text-tertiary)'}; cursor:pointer; padding:6px; margin-left:4px;">
          ${isDownloading
            ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#3390EC" stroke-width="2.5" style="animation:spin 1s linear infinite;">
                 <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
               </svg>`
            : (isDown
              ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5">
                   <path d="M20 6L9 17l-5-5"></path>
                 </svg>`
              : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                   <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                   <polyline points="7 10 12 15 17 10"></polyline>
                   <line x1="12" y1="15" x2="12" y2="3"></line>
                 </svg>`
            )
          }
        </button>

        <!-- Favorite Heart Button with iOS Spring Pop -->
        <button id="fav-btn-${canonicalId}"
                class="fav-heart-btn ${isFav ? 'liked' : ''}"
                onclick="event.stopPropagation(); toggleFavorite('${track.originalId || track.id}')"
                title="В любимые"
                style="color:${isFav ? '#FA243C' : 'var(--text-tertiary)'};">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? '#FA243C' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
        </button>
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────────────────────────
// 6. Navigation, Filtering & Online Search
// ─────────────────────────────────────────────────────────────
let searchDebounceTimer = null;

async function switchView(viewName) {
  state.currentView = viewName;
  state.isOnlineMode = (viewName === 'online-search');

  const mainVp = document.getElementById('main-viewport');
  if (mainVp) {
    mainVp.scrollTop = 0;
  }

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewName);
  });

  const standardView = document.getElementById('standard-library-view');
  const myWaveView = document.getElementById('my-wave-view');

  if (viewName === 'my-wave') {
    if (standardView) standardView.style.display = 'none';
    if (myWaveView) {
      myWaveView.style.display = 'flex';
      myWaveView.style.animation = 'none';
      void myWaveView.offsetWidth;
      myWaveView.style.animation = 'iosContentSlideIn 0.35s var(--ios-spring)';
    }
    renderMyWaveView();
    return;
  } else {
    if (myWaveView) myWaveView.style.display = 'none';
    if (standardView) standardView.style.display = 'flex';
  }

  const heading = document.getElementById('view-heading');
  const heroBadge = document.getElementById('hero-badge');
  const heroTitle = document.getElementById('hero-title');
  const heroSubtitle = document.getElementById('hero-subtitle');
  const searchInput = document.getElementById('library-search');
  const catBar = document.getElementById('search-categories-bar');
  if (catBar) {
    catBar.style.display = (viewName === 'online-search') ? 'flex' : 'none';
  }

  if (viewName === 'online-search') {
    if (heading) heading.textContent = 'Поиск онлайн музыки';
    if (heroBadge) heroBadge.textContent = 'SoundCloud Онлайн';
    if (heroTitle) heroTitle.textContent = 'Поиск музыки';
    if (heroSubtitle) heroSubtitle.textContent = 'Стриминг треков и воспроизведение локальной медиатеки';
    if (searchInput) searchInput.placeholder = 'Поиск треков, артистов, альбомов...';
    if (!state.onlineTracks.length) {
      await selectSearchCategory(state.selectedCategory || 'trending');
    }
  } else if (viewName === 'downloaded') {
    if (heading) heading.textContent = 'Скачанные треки';
    if (heroBadge) heroBadge.textContent = 'Медиатека';
    if (heroTitle) heroTitle.textContent = 'Скачанные треки';
    if (heroSubtitle) heroSubtitle.textContent = 'Локальные аудиофайлы на этом устройстве';
    if (searchInput) searchInput.placeholder = 'Поиск в скачанных...';
    await loadDownloadedTracks();
  } else if (viewName === 'favorites') {
    if (heading) heading.textContent = 'Любимые треки';
    if (heroBadge) heroBadge.textContent = 'Избранное';
    if (heroTitle) heroTitle.textContent = 'Любимые треки';
    if (heroSubtitle) heroSubtitle.textContent = 'Личная подборка сохранённых композиций';
  } else if (viewName === 'artists') {
    if (heading) heading.textContent = 'Исполнители';
    if (heroBadge) heroBadge.textContent = 'Артисты';
    if (heroTitle) heroTitle.textContent = 'Исполнители';
    if (heroSubtitle) heroSubtitle.textContent = 'Каталог исполнителей медиатеки';
  } else if (viewName === 'albums') {
    if (heading) heading.textContent = 'Альбомы';
    if (heroBadge) heroBadge.textContent = 'Альбомы';
    if (heroTitle) heroTitle.textContent = 'Все Альбомы';
    if (heroSubtitle) heroSubtitle.textContent = 'Группировка по альбомам.';
  }

  applyFilters();

  const tracksContainer = document.querySelector('.tracks-container');
  if (tracksContainer) {
    tracksContainer.style.animation = 'none';
    void tracksContainer.offsetWidth;
    tracksContainer.style.animation = 'iosContentSlideIn 0.35s var(--ios-spring)';
  }
}

async function selectSearchCategory(category) {
  state.selectedCategory = category;

  // Clear text search input if category is selected
  const searchInput = document.getElementById('library-search');
  if (searchInput && state.searchQuery) {
    searchInput.value = '';
    state.searchQuery = '';
  }

  // Update button active state
  document.querySelectorAll('.category-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });

  const categoryMeta = {
    'trending': {
      title: 'Тренды SoundCloud',
      sub: 'Популярные мировые релизы и чарты',
      badge: 'SoundCloud Charts'
    },
    'opium': {
      title: 'Опиум & Андерграунд',
      sub: 'Kai Angel, 9mice, viperr, 3g0th2002, Scally Milano, Toxis, bleood',
      badge: 'Underground Trap'
    },
    'phonk': {
      title: 'Phonk & Drift',
      sub: 'Kordhell, DVRST, Hensonn, Pharmacist и дрифт-фонк',
      badge: 'Drift Phonk'
    },
    'witchhouse': {
      title: 'Witch House',
      sub: 'Summer of Haze, IC3PEAK, Shadowraze, zxcursed, Crying City',
      badge: 'Dark Wave & Witch'
    },
    'russian-top': {
      title: 'Топ Рэп РФ',
      sub: 'Friendly Thug 52 NGG, Big Baby Tape, Macan, Heronwater, Bushido Zho',
      badge: 'Хиты СНГ'
    }
  };

  const meta = categoryMeta[category] || categoryMeta['trending'];
  showToast(`Загрузка: ${meta.title}...`);

  const heroBadge = document.getElementById('hero-badge');
  const heroTitle = document.getElementById('hero-title');
  const heroSubtitle = document.getElementById('hero-subtitle');
  if (heroBadge) heroBadge.textContent = meta.badge;
  if (heroTitle) heroTitle.textContent = meta.title;
  if (heroSubtitle) heroSubtitle.textContent = meta.sub;

  let results = [];
  if (window.electronAPI && window.electronAPI.getOnlineCategory) {
    results = await window.electronAPI.getOnlineCategory(category);
  } else if (window.electronAPI && window.electronAPI.searchOnline) {
    results = await window.electronAPI.searchOnline(category);
  }

  state.onlineTracks = results || [];
  showToast(`Загружено ${state.onlineTracks.length} треков`);

  applyFilters();

  const tracksContainer = document.querySelector('.tracks-container');
  if (tracksContainer) {
    tracksContainer.style.animation = 'none';
    void tracksContainer.offsetWidth;
    tracksContainer.style.animation = 'iosContentSlideIn 0.35s var(--ios-spring)';
  }
}

function handleSearch(query) {
  state.searchQuery = (query || '').trim();
  const clearBtn = document.getElementById('search-clear-btn');
  if (clearBtn) {
    clearBtn.style.display = (query && query.length > 0) ? 'flex' : 'none';
  }

  if (state.isOnlineMode) {
    clearTimeout(searchDebounceTimer);
    if (!state.searchQuery) {
      // Immediate reset without debounce lag
      selectSearchCategory(state.selectedCategory || 'trending');
    } else {
      searchDebounceTimer = setTimeout(() => {
        performOnlineSearch(state.searchQuery);
      }, 400);
    }
  } else {
    applyFilters();
  }
}

function clearSearchInput() {
  const input = document.getElementById('library-search');
  if (input) {
    input.value = '';
    input.focus();
  }
  const clearBtn = document.getElementById('search-clear-btn');
  if (clearBtn) {
    clearBtn.style.display = 'none';
  }
  state.searchQuery = '';
  if (state.isOnlineMode) {
    clearTimeout(searchDebounceTimer);
    selectSearchCategory(state.selectedCategory || 'trending');
  } else {
    applyFilters();
  }
}

async function performOnlineSearch(query) {
  const q = (query || '').trim();
  if (!q) {
    return selectSearchCategory(state.selectedCategory || 'trending');
  }

  // Deactivate category pills since user typed custom search
  document.querySelectorAll('.category-pill').forEach(btn => btn.classList.remove('active'));

  showToast(`Поиск: ${q}...`);

  const heroBadge = document.getElementById('hero-badge');
  const heroTitle = document.getElementById('hero-title');
  const heroSubtitle = document.getElementById('hero-subtitle');
  if (heroBadge) heroBadge.textContent = 'Поиск SoundCloud';
  if (heroTitle) heroTitle.textContent = `Результаты: ${q}`;
  if (heroSubtitle) heroSubtitle.textContent = 'Оригинальные треки без спама, старых сборников и 1-часовых миксов.';

  if (window.electronAPI && window.electronAPI.searchOnline) {
    const results = await window.electronAPI.searchOnline(q);
    state.onlineTracks = results || [];
    showToast(`Найдено ${state.onlineTracks.length} треков`);
  } else {
    showToast('Требуется запуск в приложении Electron');
  }

  applyFilters();

  const tracksContainer = document.querySelector('.tracks-container');
  if (tracksContainer) {
    tracksContainer.style.animation = 'none';
    void tracksContainer.offsetWidth;
    tracksContainer.style.animation = 'iosContentSlideIn 0.35s var(--ios-spring)';
  }
}

function applyFilters() {
  let list = [];

  if (state.currentView === 'online-search') {
    list = [...state.onlineTracks];
  } else if (state.currentView === 'downloaded') {
    list = [...state.downloadedTracks];
  } else if (state.currentView === 'favorites') {
    list = Array.from(state.favorites.values());
  } else {
    // Artists / Albums
    const all = [...state.downloadedTracks, ...state.onlineTracks];
    const unique = new Map();
    for (const t of all) unique.set(t.id, t);
    list = Array.from(unique.values());
  }

  // Local Search Filter if inside offline/downloaded/favorites views
  if (!state.isOnlineMode && state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(t => 
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      (t.album && t.album.toLowerCase().includes(q))
    );
  }

  // Sorting
  if (state.currentView === 'artists') {
    list.sort((a, b) => a.artist.localeCompare(b.artist));
  } else if (state.currentView === 'albums') {
    list.sort((a, b) => (a.album || '').localeCompare(b.album || ''));
  }

  state.filteredTracks = list;
  if (state.shuffle) {
    buildShuffleQueue(state.currentTrackIndex);
  }
  renderTrackList();
}

// ─────────────────────────────────────────────────────────────
// 7. Favorites Management (Persistent & Robust)
// ─────────────────────────────────────────────────────────────
function toggleFavorite(trackId) {
  if (!trackId) return;

  // Resolve canonical ID (e.g. remove local_dl_ prefix if present)
  let canonicalId = String(trackId);
  if (canonicalId.startsWith('local_dl_')) {
    canonicalId = canonicalId.replace('local_dl_', '');
  }

  const isFav = state.favorites.has(canonicalId) || state.favorites.has(trackId);

  if (isFav) {
    state.favorites.delete(canonicalId);
    state.favorites.delete(trackId);
    showToast('Удалено из любимых');
  } else {
    // Find track object across all collections
    const found = state.filteredTracks.find(t => t.id === trackId || t.originalId === canonicalId || t.id === canonicalId) ||
                  state.myWaveQueue.find(t => t.id === trackId || t.originalId === canonicalId || t.id === canonicalId) ||
                  state.downloadedTracksMap.get(canonicalId) ||
                  state.downloadedTracksMap.get(trackId) ||
                  state.onlineTracks.find(t => t.id === canonicalId || t.id === trackId) ||
                  (state.currentPlayingTrack && (state.currentPlayingTrack.id === trackId || state.currentPlayingTrack.originalId === canonicalId) ? state.currentPlayingTrack : null) ||
                  { id: canonicalId, title: 'Трек', artist: 'Unknown', isOnline: true };

    const trackObj = {
      id: canonicalId,
      originalId: canonicalId,
      title: found.title || 'Трек',
      artist: found.artist || 'Unknown Artist',
      album: found.album || 'Любимые треки',
      coverUrl: found.coverUrl || '',
      duration: found.duration || 180,
      durationFormatted: found.durationFormatted || '3:00',
      streamUrl: found.streamUrl || '',
      fileUrl: found.fileUrl || '',
      isOnline: found.isOnline !== false,
      isDownloaded: found.isDownloaded || false
    };

    state.favorites.set(canonicalId, trackObj);
    showToast(`В любимые: ${trackObj.title}`);
  }

  // Persist to localStorage
  try {
    localStorage.setItem('lane_favorites_v2', JSON.stringify([...state.favorites.entries()]));
    localStorage.setItem('lane_favorites', JSON.stringify([...state.favorites.keys()]));
  } catch (e) {
    console.warn('Failed to save favorites:', e);
  }

  updateFavoriteButtonUI(canonicalId);

  if (state.currentView === 'favorites') {
    applyFilters();
  } else if (state.currentView === 'my-wave') {
    renderWaveQueue();
  } else {
    renderTrackList();
  }
}

function updateFavoriteButtonUI(trackId) {
  let canonicalId = trackId;
  if (!canonicalId && state.currentPlayingTrack) {
    canonicalId = state.currentPlayingTrack.originalId || state.currentPlayingTrack.id;
  }
  if (canonicalId && canonicalId.startsWith('local_dl_')) {
    canonicalId = canonicalId.replace('local_dl_', '');
  }

  const isFav = canonicalId ? (state.favorites.has(canonicalId) || state.favorites.has(trackId)) : false;
  const barHeart = document.getElementById('bar-heart-btn');

  if (barHeart) {
    barHeart.style.color = isFav ? '#FA243C' : 'var(--text-tertiary)';
    barHeart.classList.toggle('liked', isFav);
    const svg = barHeart.querySelector('svg');
    if (svg) {
      svg.setAttribute('fill', isFav ? '#FA243C' : 'none');
    }
  }

  // Also animate row heart if present
  if (canonicalId) {
    const rowBtn = document.getElementById(`fav-btn-${canonicalId}`);
    if (rowBtn) {
      rowBtn.classList.toggle('liked', isFav);
      rowBtn.style.color = isFav ? '#FA243C' : 'var(--text-tertiary)';
      const rSvg = rowBtn.querySelector('svg');
      if (rSvg) rSvg.setAttribute('fill', isFav ? '#FA243C' : 'none');
    }
  }

  // Update Mini-Player HUD Heart
  const hudHeart = document.getElementById('hud-icon-heart');
  if (hudHeart) {
    hudHeart.style.color = isFav ? '#FA243C' : 'currentColor';
    hudHeart.setAttribute('fill', isFav ? '#FA243C' : 'none');
  }
}

function toggleCurrentTrackFavorite() {
  if (state.currentPlayingTrack) {
    toggleFavorite(state.currentPlayingTrack.originalId || state.currentPlayingTrack.id);
  } else if (state.currentTrackIndex >= 0 && state.filteredTracks[state.currentTrackIndex]) {
    toggleFavorite(state.filteredTracks[state.currentTrackIndex].id);
  }
}
window.toggleCurrentFavorite = toggleCurrentTrackFavorite;
window.toggleCurrentTrackFavorite = toggleCurrentTrackFavorite;

// ─────────────────────────────────────────────────────────────
// 8. Fullscreen Apple Music Player View (iOS Sheet)
// ─────────────────────────────────────────────────────────────
function openFullscreenModal() {
  const overlay = document.getElementById('fs-overlay');
  if (overlay) overlay.classList.add('active');
}

function closeFullscreenModal() {
  const overlay = document.getElementById('fs-overlay');
  if (overlay) overlay.classList.remove('active');
}

window.openFullscreenModal = openFullscreenModal;
window.closeFullscreenModal = closeFullscreenModal;

// ─────────────────────────────────────────────────────────────
// 9. Toast Notification & Helpers
// ─────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = msg;
  toast.classList.add('show', 'visible');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show', 'visible');
  }, 2400);
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─────────────────────────────────────────────────────────────
// 10. Smart Stream Engine: Моя волна (AI Similarity & Infinite Radio)
// ─────────────────────────────────────────────────────────────

function updateMyWaveUI() {
  const wavePill = document.getElementById('btn-player-wave');
  const waveOrb = document.getElementById('wave-sphere-orb');
  const waveOrbPlay = document.getElementById('wave-orb-icon-play');
  const waveOrbPause = document.getElementById('wave-orb-icon-pause');
  const statusEl = document.getElementById('wave-status-text');
  const navWave = document.querySelector('.nav-item[data-view="my-wave"]');

  if (wavePill) {
    wavePill.classList.toggle('active', state.isMyWaveActive);
  }

  if (navWave) {
    navWave.classList.toggle('active', state.currentView === 'my-wave');
  }

  if (waveOrb) {
    waveOrb.classList.toggle('playing', state.isPlaying && state.isMyWaveActive);
  }

  if (waveOrbPlay && waveOrbPause) {
    const isPlaying = state.isPlaying && state.isMyWaveActive;
    waveOrbPlay.style.display = isPlaying ? 'none' : 'block';
    waveOrbPause.style.display = isPlaying ? 'block' : 'none';
  }

  if (statusEl) {
    if (state.isMyWaveActive) {
      if (state.currentPlayingTrack) {
        statusEl.textContent = `Играет: ${state.currentPlayingTrack.artist} — ${state.currentPlayingTrack.title}`;
      } else {
        statusEl.textContent = 'Подбираем персональную волну...';
      }
    } else {
      statusEl.textContent = 'Готова к запуску · Нажмите на сферу или «Моя волна» внизу';
    }
  }

  // Update chips
  document.querySelectorAll('.wave-chip').forEach(chip => {
    chip.classList.toggle('active', chip.id === `chip-mode-${state.myWaveMood}`);
  });
}

async function toggleMyWaveMode(forceStart = false) {
  if (state.isMyWaveActive && !forceStart) {
    state.isMyWaveActive = false;
    updateMyWaveUI();
    showToast('Моя волна выключена');
    return;
  }

  state.isMyWaveActive = true;
  updateMyWaveUI();
  showToast('Моя волна включена');

  // Immediately anchor to current playing track and refresh the queue so recommendations are actually similar!
  if (state.currentPlayingTrack) {
    state.waveSeedTrack = state.currentPlayingTrack;
    state.myWaveQueue = [];
    showToast(`Волна подбирает треки по «${state.currentPlayingTrack.title}»`);
    await fetchWaveRecommendations(state.myWaveMood, false);
    if (audio.paused) {
      audio.play().then(() => setPlaybackState(true)).catch(() => {});
    }
  } else if (state.myWaveQueue.length === 0) {
    await fetchWaveRecommendations(state.myWaveMood, true);
  } else if (audio.paused) {
    playNextMyWaveTrack();
  }
}

function toggleMyWavePlayback() {
  if (!state.isMyWaveActive) {
    toggleMyWaveMode(true);
    return;
  }

  if (audio.paused) {
    audio.play().then(() => setPlaybackState(true)).catch(() => {});
  } else {
    audio.pause();
    setPlaybackState(false);
  }
  updateMyWaveUI();
}

async function setWaveMood(mood) {
  state.myWaveMood = mood;
  state.isMyWaveActive = true;
  updateMyWaveUI();

  const labels = {
    similar: 'По текущему звучанию',
    favorites: 'По вашим любимым трекам',
    energetic: 'Движ и бодрый ритм',
    chill: 'Спокойствие и релакс',
    fresh: 'Свежие релизы 2026'
  };
  showToast(`Волна: режим «${labels[mood] || mood}»`);

  state.myWaveQueue = [];
  await fetchWaveRecommendations(mood, false);
  await playNextMyWaveTrack();
}

async function fetchWaveRecommendations(mood = 'similar', autoPlay = false) {
  if (state.isFetchingWaveTracks) return;
  state.isFetchingWaveTracks = true;

  const descEl = document.getElementById('wave-current-source-desc');
  const statusEl = document.getElementById('wave-status-text');
  if (statusEl) statusEl.textContent = 'Генерация потока похожих треков...';

  try {
    let recommendations = [];

    if (mood === 'similar') {
      const seed = state.currentPlayingTrack || state.waveSeedTrack || (state.favorites.size > 0 ? Array.from(state.favorites.values())[0] : null) || (state.filteredTracks.length > 0 ? state.filteredTracks[0] : null);
      if (seed) {
        state.waveSeedTrack = seed;
        if (descEl) descEl.textContent = `Поток на основе: ${seed.artist} — ${seed.title}`;
        if (window.electronAPI && window.electronAPI.getSimilarTracks) {
          recommendations = await window.electronAPI.getSimilarTracks(seed.originalId || seed.id, seed.artist);
        }
      }
    } else if (mood === 'favorites') {
      const favList = Array.from(state.favorites.values());
      if (favList.length > 0) {
        const randomFav = favList[Math.floor(Math.random() * favList.length)];
        state.waveSeedTrack = randomFav;
        if (descEl) descEl.textContent = `Поток на основе любимой музыки (${randomFav.artist} — ${randomFav.title})`;
        if (window.electronAPI && window.electronAPI.getSimilarTracks) {
          recommendations = await window.electronAPI.getSimilarTracks(randomFav.originalId || randomFav.id, randomFav.artist);
        }
      } else {
        showToast('В любимых пока нет треков');
      }
    } else if (mood === 'energetic') {
      if (descEl) descEl.textContent = 'Энергичный поток для активности';
      const seedArtist = (state.waveSeedTrack && state.waveSeedTrack.artist) || '';
      const query = seedArtist ? `${seedArtist} remix energy` : 'phonk remix club bass 2026';
      if (window.electronAPI && window.electronAPI.searchOnline) {
        recommendations = await window.electronAPI.searchOnline(query);
      }
    } else if (mood === 'chill') {
      if (descEl) descEl.textContent = 'Спокойный атмосферный поток для отдыха';
      if (window.electronAPI && window.electronAPI.searchOnline) {
        recommendations = await window.electronAPI.searchOnline('lofi ambient chill cloud indie relax');
      }
    } else if (mood === 'fresh') {
      if (descEl) descEl.textContent = 'Свежие релизы этого года';
      const seedArtist = (state.waveSeedTrack && state.waveSeedTrack.artist) || '';
      const query = seedArtist ? `${seedArtist} 2026` : 'новинки музыки 2026 премьера';
      if (window.electronAPI && window.electronAPI.searchOnline) {
        recommendations = await window.electronAPI.searchOnline(query);
      }
    }

    // Smart fallback if still empty: search by seed artist, not generic radio pop
    if (!recommendations || recommendations.length === 0) {
      const seedArtist = (state.waveSeedTrack && state.waveSeedTrack.artist && state.waveSeedTrack.artist !== 'Unknown')
        ? state.waveSeedTrack.artist
        : ((state.currentPlayingTrack && state.currentPlayingTrack.artist) ? state.currentPlayingTrack.artist : '');
      if (seedArtist && window.electronAPI && window.electronAPI.searchOnline) {
        recommendations = await window.electronAPI.searchOnline(seedArtist);
      }
    }

    // Filter duplicates
    if (recommendations && recommendations.length > 0) {
      const curId = state.currentPlayingTrack ? (state.currentPlayingTrack.originalId || state.currentPlayingTrack.id) : null;
      for (const t of recommendations) {
        const canId = (t.originalId || t.id).replace('local_dl_', '');
        if (!state.seenWaveIds.has(canId) && canId !== curId) {
          // Check not already in queue
          if (!state.myWaveQueue.some(q => (q.originalId || q.id) === t.id)) {
            state.myWaveQueue.push(t);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error fetching wave recommendations:', err);
  } finally {
    state.isFetchingWaveTracks = false;
  }

  updateMyWaveUI();
  renderWaveQueue();

  if (autoPlay && (!state.currentPlayingTrack || audio.paused)) {
    playNextMyWaveTrack();
  }
}

async function playNextMyWaveTrack() {
  if (state.currentPlayingTrack) {
    const prevCanId = (state.currentPlayingTrack.originalId || state.currentPlayingTrack.id).replace('local_dl_', '');
    state.seenWaveIds.add(prevCanId);
    state.myWaveHistory.push(state.currentPlayingTrack);
    if (state.myWaveHistory.length > 50) state.myWaveHistory.shift();
  }

  if (state.myWaveQueue.length === 0) {
    showToast('Подбираем следующие похожие треки...');
    await fetchWaveRecommendations(state.myWaveMood, false);
  }

  if (state.myWaveQueue.length === 0) {
    const seedArtist = (state.waveSeedTrack && state.waveSeedTrack.artist) || (state.currentPlayingTrack && state.currentPlayingTrack.artist);
    if (seedArtist && window.electronAPI && window.electronAPI.searchOnline) {
      const fallback = await window.electronAPI.searchOnline(seedArtist);
      state.myWaveQueue.push(...(fallback || []));
    }
  }

  const nextTrack = state.myWaveQueue.shift();
  if (!nextTrack) return;

  // Background prefetch if queue is low
  if (state.myWaveQueue.length <= 3 && !state.isFetchingWaveTracks) {
    prefetchWaveTracks(nextTrack);
  }

  await playTrackDirect(nextTrack, false);
}

async function prefetchWaveTracks(seedTrack) {
  if (state.isFetchingWaveTracks) return;
  state.isFetchingWaveTracks = true;

  try {
    const seed = seedTrack || state.currentPlayingTrack || state.waveSeedTrack;
    if (seed && window.electronAPI && window.electronAPI.getSimilarTracks) {
      const more = await window.electronAPI.getSimilarTracks(seed.originalId || seed.id, seed.artist);
      if (more && more.length) {
        for (const t of more) {
          const canId = (t.originalId || t.id).replace('local_dl_', '');
          if (!state.seenWaveIds.has(canId) && !state.myWaveQueue.some(q => (q.originalId || q.id) === t.id)) {
            state.myWaveQueue.push(t);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Prefetch wave tracks error:', err);
  } finally {
    state.isFetchingWaveTracks = false;
    renderWaveQueue();
  }
}

function refreshWaveQueue() {
  state.myWaveQueue = [];
  showToast('Обновление очереди Волны...');
  fetchWaveRecommendations(state.myWaveMood, false);
}

function playWaveTrackAt(index) {
  if (index < 0 || index >= state.myWaveQueue.length) return;
  const track = state.myWaveQueue[index];
  state.myWaveQueue.splice(0, index + 1);
  state.isMyWaveActive = true;
  playTrackDirect(track, true);
}

function renderWaveQueue() {
  const container = document.getElementById('wave-track-list');
  const countLabel = document.getElementById('wave-queue-sublabel');
  if (!container) return;

  if (countLabel) {
    countLabel.textContent = `${state.myWaveQueue.length} похожих треков в очереди`;
  }

  if (state.myWaveQueue.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:30px 10px; color:var(--text-tertiary); font-size:13px;">
        Очередь волны формируется... Треки подбираются алгоритмом на лету.
      </div>
    `;
    return;
  }

  const tracksToDisplay = state.myWaveQueue.slice(0, 15);

  container.innerHTML = tracksToDisplay.map((track, idx) => {
    const canonicalId = (track.originalId || track.id).replace('local_dl_', '');
    const isFav = state.favorites.has(canonicalId) || state.favorites.has(track.id);
    const isDown = state.downloadedTracksMap.has(track.id) || (track.originalId && state.downloadedTracksMap.has(track.originalId)) || track.isDownloaded;
    const isDownloading = state.downloadingIds.has(track.id);

    return `
      <div class="track-row" style="--item-idx: ${idx};" onclick="playWaveTrackAt(${idx})">
        <!-- Number -->
        <div style="width:28px; text-align:center; font-size:12px; color:var(--text-tertiary); font-weight:600;">
          ${idx + 1}
        </div>

        <!-- Cover Art -->
        <div class="track-cover-art">
          ${track.coverUrl 
            ? `<img src="${track.coverUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:6px;" loading="lazy" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&q=80';" />`
            : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3390EC" stroke-width="2">
                <path d="M9 18V5l12-2v13"></path>
                <circle cx="6" cy="18" r="3"></circle>
                <circle cx="18" cy="16" r="3"></circle>
              </svg>`
          }
        </div>

        <!-- Title & Artist -->
        <div style="flex:1; min-width:0;">
          <p class="track-title" style="font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(track.title)}
          </p>
          <p style="font-size:12px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(track.artist)}
          </p>
        </div>

        <!-- Track Duration -->
        <span class="track-duration" style="font-size:12px; font-variant-numeric:tabular-nums; color:var(--text-tertiary); min-width:44px; text-align:right;">
          ${track.durationFormatted || '3:30'}
        </span>

        <!-- Download Button -->
        <button onclick="event.stopPropagation(); handleTrackDownload('${track.id}')"
                title="${isDown ? 'Скачано' : 'Скачать офлайн'}"
                style="background:transparent; border:none; color:${isDown ? '#22c55e' : 'var(--text-tertiary)'}; cursor:pointer; padding:6px; margin-left:4px;">
          ${isDownloading
            ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#3390EC" stroke-width="2.5" style="animation:spin 1s linear infinite;">
                 <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
               </svg>`
            : (isDown
              ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5">
                   <path d="M20 6L9 17l-5-5"></path>
                 </svg>`
              : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                   <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                   <polyline points="7 10 12 15 17 10"></polyline>
                   <line x1="12" y1="15" x2="12" y2="3"></line>
                 </svg>`
            )
          }
        </button>

        <!-- Favorite Heart Button -->
        <button id="fav-btn-${canonicalId}"
                class="fav-heart-btn ${isFav ? 'liked' : ''}"
                onclick="event.stopPropagation(); toggleFavorite('${track.originalId || track.id}')"
                title="В любимые"
                style="color:${isFav ? '#FA243C' : 'var(--text-tertiary)'};">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? '#FA243C' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
        </button>
      </div>
    `;
  }).join('');
}

function renderMyWaveView() {
  updateMyWaveUI();
  renderWaveQueue();
  const triggerRender = () => {
    if (visualizer && visualizer.resizeSpectral) {
      visualizer.resizeSpectral();
      visualizer.renderSpectral(null, state.isPlaying);
    }
  };
  requestAnimationFrame(triggerRender);
  setTimeout(triggerRender, 50);
  // Safe queue persistence: only fetch if queue is currently empty and not already fetching
  if (state.myWaveQueue.length === 0 && !state.isFetchingWaveTracks) {
    fetchWaveRecommendations(state.myWaveMood, false);
  }
}

// Window exports
window.toggleMyWaveMode = toggleMyWaveMode;
window.toggleMyWavePlayback = toggleMyWavePlayback;
window.setWaveMood = setWaveMood;
window.refreshWaveQueue = refreshWaveQueue;
window.playWaveTrackAt = playWaveTrackAt;
window.renderMyWaveView = renderMyWaveView;
window.initResolutionStabilizer = initResolutionStabilizer;
window.clearSearchInput = clearSearchInput;
window.toggleShuffle = toggleShuffle;

// ─────────────────────────────────────────────────────────────
// Real-Time Audio Visualizer Engine
// ─────────────────────────────────────────────────────────────
let visualizer = null;

function initVisualizer() {
  try {
    if (window.AudioVisualizer && window.AudioVisualizer.Visualizer) {
      visualizer = new window.AudioVisualizer.Visualizer();
      const canvas = document.getElementById('player-visualizer-canvas');
      if (canvas) {
        visualizer.attachCanvas(canvas);
        visualizer.renderIdle();
      }
      const spectralCanvas = document.getElementById('spectral-wave-canvas');
      if (spectralCanvas && visualizer.attachSpectralCanvas) {
        visualizer.attachSpectralCanvas(spectralCanvas);
        visualizer.renderSpectral(null, false);
      }
    }
  } catch (e) {
    console.warn('[Visualizer Init]', e);
  }
}

// ─────────────────────────────────────────────────────────────
// 10. Mini-Player HUD & Viral Killer Features
// ─────────────────────────────────────────────────────────────

async function toggleMiniPlayerMode(forceState) {
  if (window.electronAPI && window.electronAPI.toggleMiniPlayer) {
    const isMini = await window.electronAPI.toggleMiniPlayer(forceState);
    document.body.classList.toggle('mini-player-mode', isMini);
    updateMiniPlayerUI();
    return isMini;
  }
  const isMini = typeof forceState === 'boolean'
    ? document.body.classList.toggle('mini-player-mode', forceState)
    : document.body.classList.toggle('mini-player-mode');
  updateMiniPlayerUI();
  return isMini;
}

function updateMiniPlayerUI() {
  const track = state.currentPlayingTrack;
  const hudTitle = document.getElementById('hud-title');
  const hudArtist = document.getElementById('hud-artist');
  const hudCoverImg = document.getElementById('hud-cover-img');
  const hudPlaceholder = document.getElementById('hud-cover-placeholder');
  const hudDisc = document.getElementById('hud-vinyl-disc');
  const hudPlay = document.getElementById('hud-icon-play');
  const hudPause = document.getElementById('hud-icon-pause');
  const hudHeart = document.getElementById('hud-icon-heart');

  if (track) {
    if (hudTitle) hudTitle.textContent = track.title || 'Not Playing';
    if (hudArtist) hudArtist.textContent = track.artist || 'hurtmusic HUD';
    if (track.coverUrl) {
      if (hudCoverImg) {
        hudCoverImg.src = track.coverUrl;
        hudCoverImg.style.display = 'block';
      }
      if (hudPlaceholder) hudPlaceholder.style.display = 'none';
    } else {
      if (hudCoverImg) hudCoverImg.style.display = 'none';
      if (hudPlaceholder) hudPlaceholder.style.display = 'flex';
    }

    const canonicalId = (track.originalId || track.id).replace('local_dl_', '');
    const isFav = state.favorites.has(canonicalId) || state.favorites.has(track.id);
    if (hudHeart) {
      hudHeart.setAttribute('fill', isFav ? '#FA243C' : 'none');
      hudHeart.style.color = isFav ? '#FA243C' : 'currentColor';
    }
  }

  if (hudDisc) {
    hudDisc.classList.toggle('playing', !!state.isPlaying);
  }

  if (hudPlay && hudPause) {
    hudPlay.style.display = state.isPlaying ? 'none' : 'block';
    hudPause.style.display = state.isPlaying ? 'block' : 'none';
  }
}

async function downloadCurrentPlayingTrack() {
  const track = state.currentPlayingTrack;
  if (!track) {
    showToast('Сначала запустите воспроизведение трека');
    return;
  }
  await handleTrackDownload(track.id);
  updateBarDownloadButtonUI();
}

function updateBarDownloadButtonUI() {
  const btn = document.getElementById('bar-download-btn');
  const icon = document.getElementById('bar-dl-icon');
  if (!btn || !icon) return;

  const track = state.currentPlayingTrack;
  if (!track) {
    btn.style.color = 'var(--text-tertiary)';
    btn.title = 'Сохранить трек офлайн навсегда (1 клик)';
    return;
  }

  const isDown = state.downloadedTracksMap.has(track.id) ||
                 (track.originalId && state.downloadedTracksMap.has(track.originalId)) ||
                 track.isDownloaded;
  const isDownloading = state.downloadingIds.has(track.id);

  if (isDownloading) {
    btn.style.color = 'var(--accent)';
    btn.title = 'Загрузка трека в локальное хранилище...';
  } else if (isDown) {
    btn.style.color = '#22c55e';
    btn.title = 'Трек сохранён офлайн на диске (нажмите, чтобы удалить)';
    icon.innerHTML = `<polyline points="20 6 9 17 4 12"></polyline>`;
  } else {
    btn.style.color = 'var(--text-tertiary)';
    btn.title = 'Сохранить трек навсегда в 1 клик';
    icon.innerHTML = `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>`;
  }
}

async function downloadWaveQueueBatch() {
  if (!state.myWaveQueue || state.myWaveQueue.length === 0) {
    showToast('Очередь «Моей волны» пуста');
    return;
  }

  const unDownloaded = state.myWaveQueue.filter(t =>
    !state.downloadedTracksMap.has(t.id) &&
    !(t.originalId && state.downloadedTracksMap.has(t.originalId)) &&
    !t.isDownloaded
  );

  if (unDownloaded.length === 0) {
    showToast('Все треки из очереди Волны уже сохранены офлайн!');
    return;
  }

  showToast(`💾 Сохраняем ${unDownloaded.length} треков из Волны офлайн...`);
  let savedCount = 0;

  for (const track of unDownloaded) {
    state.downloadingIds.add(track.id);
    renderWaveQueue();
    try {
      if (window.electronAPI && window.electronAPI.downloadTrack) {
        const res = await window.electronAPI.downloadTrack(track);
        if (res && res.success) savedCount++;
      }
    } catch (err) {
      console.warn('Batch download item error:', err);
    } finally {
      state.downloadingIds.delete(track.id);
    }
  }

  await loadDownloadedTracks();
  showToast(`✅ Успешно сохранено ${savedCount} треков в медиатеку`);
  applyFilters();
  renderWaveQueue();
  updateBarDownloadButtonUI();
}

// Global Keyboard Shortcuts ('Space' for play/pause, 'Escape' to exit mini-player)
document.addEventListener('keydown', (e) => {
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  if (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable)) {
    return;
  }

  if (e.key === 'Escape') {
    if (document.body.classList.contains('mini-player-mode')) {
      toggleMiniPlayerMode(false);
    }
  } else if (e.code === 'Space') {
    e.preventDefault();
    togglePlayPause();
  }
});

window.toggleMiniPlayerMode = toggleMiniPlayerMode;
window.updateMiniPlayerUI = updateMiniPlayerUI;
window.downloadCurrentPlayingTrack = downloadCurrentPlayingTrack;
window.downloadWaveQueueBatch = downloadWaveQueueBatch;
window.updateBarDownloadButtonUI = updateBarDownloadButtonUI;

// ─────────────────────────────────────────────────────────────
// 11. Custom Download Folder Management
// ─────────────────────────────────────────────────────────────
async function initDownloadFolderUI() {
  if (window.electronAPI && window.electronAPI.getDownloadFolder) {
    try {
      const folder = await window.electronAPI.getDownloadFolder();
      updateDownloadFolderLabel(folder);
    } catch {}
  }
}

function updateDownloadFolderLabel(folder) {
  const label = document.getElementById('download-folder-label');
  if (label && folder) {
    label.textContent = folder;
    label.title = `Папка для сохранения музыки:\n${folder}\n(нажмите, чтобы открыть в Проводнике)`;
  }
}

async function changeDownloadFolder() {
  if (window.electronAPI && window.electronAPI.selectDownloadFolder) {
    try {
      const res = await window.electronAPI.selectDownloadFolder();
      if (!res.canceled && res.folder) {
        updateDownloadFolderLabel(res.folder);
        showToast(`Папка загрузок изменена: ${res.folder}`);
        await loadDownloadedTracks();
      }
    } catch (e) {
      showToast(`Ошибка выбора папки: ${e.message}`);
    }
  }
}

async function openDownloadFolder() {
  if (window.electronAPI && window.electronAPI.openDownloadFolder) {
    try {
      const res = await window.electronAPI.openDownloadFolder();
      if (!res.success && res.error) {
        showToast(res.error);
      }
    } catch (e) {
      showToast(`Не удалось открыть папку: ${e.message}`);
    }
  }
}

window.changeDownloadFolder = changeDownloadFolder;
window.openDownloadFolder = openDownloadFolder;
window.initDownloadFolderUI = initDownloadFolderUI;

// ─────────────────────────────────────────────────────────────
// Over-The-Air (OTA) Updates Engine & Floating Modal Controller
// ─────────────────────────────────────────────────────────────
let pendingOtaUpdate = null;

function initOtaUpdater() {
  if (!window.electronAPI) return;

  // Listen for OTA notifications from main process
  if (window.electronAPI.onUpdateAvailable) {
    window.electronAPI.onUpdateAvailable((updateInfo) => {
      showOtaCard(updateInfo);
    });
  }

  if (window.electronAPI.onUpdateProgress) {
    window.electronAPI.onUpdateProgress((progress) => {
      updateOtaProgress(progress);
    });
  }

  if (window.electronAPI.onUpdateReady) {
    window.electronAPI.onUpdateReady(() => {
      showOtaReady();
    });
  }

  // Check if an update is already downloaded and pending install
  if (window.electronAPI.hasPendingUpdate) {
    window.electronAPI.hasPendingUpdate().then(hasPending => {
      if (hasPending) {
        showOtaReady();
      }
    }).catch(() => {});
  }
}

function showOtaCard(updateInfo) {
  pendingOtaUpdate = updateInfo;
  const card = document.getElementById('ota-modal-card');
  if (!card) return;

  const versionBadge = document.getElementById('ota-card-version-badge');
  const body = document.getElementById('ota-card-body');
  const sidebarStatus = document.getElementById('ota-sidebar-status');
  const actions = document.getElementById('ota-card-actions');
  const progressBox = document.getElementById('ota-card-progress-box');

  if (versionBadge && updateInfo.latestVersion) {
    versionBadge.textContent = `v${updateInfo.latestVersion}`;
  }
  if (body) {
    body.innerHTML = `<strong>${escapeHtml(updateInfo.releaseName || 'Новая версия')}</strong><br>${escapeHtml(updateInfo.releaseNotes || 'Доступны улучшения и оптимизации.')}`;
  }
  if (sidebarStatus) {
    sidebarStatus.textContent = `Доступно: v${updateInfo.latestVersion}`;
    sidebarStatus.style.color = '#a5b4fc';
  }

  if (progressBox) progressBox.style.display = 'none';
  if (actions) {
    actions.innerHTML = `
      <button id="btn-ota-start" onclick="startOtaDownload()" style="flex:1; height:32px; border-radius:8px; border:none; background:linear-gradient(135deg, #6366f1, #8b5cf6); color:#fff; font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 4px 14px rgba(99, 102, 241, 0.4);">
        <span>⚡ Обновить сейчас</span>
      </button>
      <button id="btn-ota-later" onclick="dismissOtaCard()" style="height:32px; padding:0 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04); color:#9ca3af; font-size:11.5px; cursor:pointer;">
        Позже
      </button>
    `;
  }

  card.style.display = 'block';
}

function showOtaReady() {
  const card = document.getElementById('ota-modal-card');
  if (!card) return;

  const subtitle = document.getElementById('ota-card-subtitle');
  const body = document.getElementById('ota-card-body');
  const progressBox = document.getElementById('ota-card-progress-box');
  const actions = document.getElementById('ota-card-actions');
  const sidebarStatus = document.getElementById('ota-sidebar-status');

  if (subtitle) subtitle.textContent = 'Готово к установке';
  if (body) body.innerHTML = '✅ Обновление загружено! Нажмите перезапустить для моментального применения.';
  if (sidebarStatus) {
    sidebarStatus.textContent = 'Готово к перезапуску';
    sidebarStatus.style.color = '#34d399';
  }
  if (progressBox) progressBox.style.display = 'none';
  if (actions) {
    actions.innerHTML = `
      <button onclick="installOtaAndRestart()" style="flex:1; height:34px; border-radius:8px; border:none; background:linear-gradient(135deg, #10b981, #059669); color:#fff; font-size:12px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 4px 14px rgba(16, 185, 129, 0.4);">
        <span>🔄 Перезапустить сейчас</span>
      </button>
      <button onclick="dismissOtaCard()" style="height:34px; padding:0 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04); color:#9ca3af; font-size:11.5px; cursor:pointer;">
        Позже
      </button>
    `;
  }

  card.style.display = 'block';
}

function updateOtaProgress(progress) {
  const progressBox = document.getElementById('ota-card-progress-box');
  const progressText = document.getElementById('ota-progress-text');
  const progressSpeed = document.getElementById('ota-progress-speed');
  const progressFill = document.getElementById('ota-progress-fill');

  if (progressBox) progressBox.style.display = 'block';
  if (progressText) {
    progressText.textContent = `Загрузка: ${progress.percent}% (${progress.transferredMB} / ${progress.totalMB} МБ)`;
  }
  if (progressSpeed) {
    progressSpeed.textContent = `${progress.speedMBps} МБ/с`;
  }
  if (progressFill) {
    progressFill.style.width = `${progress.percent}%`;
  }
}

async function startOtaDownload() {
  if (!window.electronAPI || !window.electronAPI.startUpdateDownload) return;

  const actions = document.getElementById('ota-card-actions');
  const progressBox = document.getElementById('ota-card-progress-box');
  if (progressBox) progressBox.style.display = 'block';
  if (actions) {
    actions.innerHTML = `
      <div style="font-size:11.5px; color:#9ca3af; text-align:center; width:100%; padding:6px 0;">
        Скачивание обновления по воздуху...
      </div>
    `;
  }

  try {
    const asset = pendingOtaUpdate?.asset || { downloadUrl: pendingOtaUpdate?.htmlUrl };
    const res = await window.electronAPI.startUpdateDownload(asset);
    if (res && res.success) {
      showOtaReady();
      showToast('Обновление успешно скачано! Готово к перезапуску.');
    } else {
      showToast(`Ошибка загрузки: ${res?.error || 'Неизвестная ошибка'}`);
      dismissOtaCard();
    }
  } catch (err) {
    showToast(`Ошибка обновления: ${err.message}`);
    dismissOtaCard();
  }
}

function installOtaAndRestart() {
  if (window.electronAPI && window.electronAPI.installUpdateAndRestart) {
    window.electronAPI.installUpdateAndRestart();
  }
}

function dismissOtaCard() {
  const card = document.getElementById('ota-modal-card');
  if (card) card.style.display = 'none';
}

async function checkOtaUpdate(manual = false) {
  const btn = document.getElementById('btn-check-ota');
  const btnText = document.getElementById('btn-check-ota-text');
  const icon = document.getElementById('ota-check-icon');
  const sidebarStatus = document.getElementById('ota-sidebar-status');

  if (icon) icon.classList.add('ota-spin');
  if (btnText) btnText.textContent = 'Проверка...';

  try {
    if (window.electronAPI && window.electronAPI.checkForUpdates) {
      const result = await window.electronAPI.checkForUpdates();
      if (result && result.hasUpdate) {
        showOtaCard(result);
        if (manual) showToast(`Найдено обновление v${result.latestVersion}!`);
      } else {
        if (sidebarStatus) {
          sidebarStatus.textContent = 'Версия актуальна';
          sidebarStatus.style.color = 'var(--text-secondary)';
        }
        if (manual) {
          showToast('У вас установлена самая актуальная версия HurtMusic!');
        }
      }
    }
  } catch (err) {
    if (manual) showToast(`Не удалось проверить обновления: ${err.message}`);
  } finally {
    if (icon) icon.classList.remove('ota-spin');
    if (btnText) btnText.textContent = 'Проверить обновления';
  }
}

window.checkOtaUpdate = checkOtaUpdate;
window.startOtaDownload = startOtaDownload;
window.installOtaAndRestart = installOtaAndRestart;
window.dismissOtaCard = dismissOtaCard;
window.initOtaUpdater = initOtaUpdater;


