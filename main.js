const { app, BrowserWindow, ipcMain, dialog, protocol, net, Tray, Menu, nativeImage, screen, globalShortcut, shell } = require('electron');
const path = require('path');
const os = require('os');

const nodeFs = require('fs');

const isTestMode = process.env.ELECTRON_IS_TEST === '1' || process.argv.includes('--test-mode');
if (isTestMode) {
  const testUserData = path.join(os.tmpdir(), 'hm-test-data-' + process.pid + '-' + Date.now());
  try {
    nodeFs.mkdirSync(testUserData, { recursive: true });
    app.setPath('userData', testUserData);
  } catch {}
}
const fs = require('fs').promises;
const { Readable } = require('stream');
const laneOnlineEngine = require('./lane-online-engine');
const discordRpcManager = require('./discord-rpc-manager');
const downloadManager = require('./download-manager');
const { sanitizeOpenPath, parseHttpRange } = require('./path-security');
const { OtaUpdater } = require('./ota-updater');

// Register privileged custom streaming scheme for zero-copy local audio playback
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lane-local',
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      stream: true,
      supportFetchAPI: true
    }
  }
]);

// Background audio streaming optimizations on Windows
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Prevent unexpected process terminations
process.on('uncaughtException', (err) => {
  console.error('[Main UncaughtException]', err);
});

app.on('child-process-gone', (event, details) => {
  console.warn('[Child Process Gone]', details.type, details.reason);
});

let mainWindow = null;
let tray = null;
let currentPlaybackState = {
  title: '',
  artist: '',
  isPlaying: false
};

// Supported local audio extensions
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.aac', '.opus']);

function getScreenMetricsData() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.size;
  const { width: workWidth, height: workHeight } = primaryDisplay.workAreaSize;
  const scaleFactor = primaryDisplay.scaleFactor || 1;
  const aspectRatio = screenWidth / screenHeight;
  const is4x3 = aspectRatio < 1.5;
  const is1440x1080 = (screenWidth === 1440 && screenHeight === 1080);

  return {
    screenWidth,
    screenHeight,
    workWidth,
    workHeight,
    scaleFactor,
    aspectRatio,
    is4x3,
    is1440x1080
  };
}

function createWindow() {
  const metrics = getScreenMetricsData();

  // Dynamic Resolution & Stretched 4:3 (1440x1080) Auto-Detection
  let targetWidth;
  let targetHeight;

  if (metrics.is1440x1080 || metrics.is4x3) {
    // Specifically adapted for 1440x1080 (and 4:3 stretched gaming resolutions):
    // Allocates ~94% of work area width and ~92% height so UI elements never clip
    targetWidth = Math.min(1380, Math.max(960, Math.floor(metrics.workWidth * 0.94)));
    targetHeight = Math.min(1020, Math.max(680, Math.floor(metrics.workHeight * 0.92)));
  } else {
    targetWidth = Math.min(1360, Math.max(980, Math.floor(metrics.workWidth * 0.88)));
    targetHeight = Math.min(880, Math.max(650, Math.floor(metrics.workHeight * 0.88)));
  }

  mainWindow = new BrowserWindow({
    title: 'hurtmusic',
    icon: path.join(__dirname, 'logo-cloud.png'),
    width: targetWidth,
    height: targetHeight,
    minWidth: 860,
    minHeight: 560,
    useContentSize: true,
    frame: false,
    center: true,
    show: true,
    backgroundColor: '#0A0A0C',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // Enables direct local file streaming via file:// or custom protocol
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] [${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-state-changed', { isMaximized: true });
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-state-changed', { isMaximized: false });
  });

  // Watch for display resolution/scaling changes on Windows
  screen.on('display-metrics-changed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('screen:metrics-changed', getScreenMetricsData());
    }
  });

  // Minimize to tray on close if tray is active, else exit cleanly
  mainWindow.on('close', (event) => {
    if (isTestMode) return;
    if (!app.isQuitting) {
      if (tray) {
        event.preventDefault();
        mainWindow.hide();
        updateTrayMenu();
      } else {
        app.isQuitting = true;
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─────────────────────────────────────────────────────────────
// Windows System Tray Management (Область уведомлений)
// ─────────────────────────────────────────────────────────────
function createTray() {
  if (tray) return;

  try {
    const iconPath = path.join(__dirname, 'tray-icon.png');
    let icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      icon = icon.resize({ width: 16, height: 16 });
    }
    tray = new Tray(icon);
    tray.setToolTip('hurtmusic');

    tray.on('click', () => {
      toggleWindowVisibility();
    });

    tray.on('double-click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        updateTrayMenu();
      }
    });

    updateTrayMenu();
  } catch (err) {
    console.warn('[Tray] Notice:', err.message);
    tray = null;
  }
}

function updateTrayMenu() {
  if (!tray) return;

  const { title, artist, isPlaying } = currentPlaybackState;
  const isWindowVisible = mainWindow && mainWindow.isVisible();

  const tipText = title ? `hurtmusic: ${title} - ${artist}` : 'hurtmusic';
  tray.setToolTip(tipText.slice(0, 127));

  const template = [
    {
      label: title ? `🎵 ${title}` : '🎵 hurtmusic',
      sublabel: artist || 'Музыкальный плеер',
      enabled: false
    },
    { type: 'separator' },
    {
      label: isPlaying ? '⏸ Пауза' : '▶ Воспроизвести',
      click: () => {
        if (mainWindow) mainWindow.webContents.send('tray:play-pause');
      }
    },
    {
      label: '⏭ Следующий трек',
      click: () => {
        if (mainWindow) mainWindow.webContents.send('tray:next');
      }
    },
    {
      label: '⏮ Предыдущий трек',
      click: () => {
        if (mainWindow) mainWindow.webContents.send('tray:prev');
      }
    },
    {
      label: '❤️ В любимые',
      click: () => {
        if (mainWindow) mainWindow.webContents.send('tray:favorite');
      }
    },
    { type: 'separator' },
    {
      label: isWindowVisible ? 'Свернуть в трей' : 'Показать hurtmusic',
      click: () => {
        toggleWindowVisibility();
      }
    },
    { type: 'separator' },
    {
      label: 'Выход из hurtmusic',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  updateTrayMenu();
}

ipcMain.on('playback:state-changed', (event, data) => {
  currentPlaybackState = data || { title: '', artist: '', isPlaying: false };
  updateTrayMenu();
});

// ─────────────────────────────────────────────────────────────
// IPC Handlers: Native Window Controls (Apple Minimalist)
// ─────────────────────────────────────────────────────────────
ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return mainWindow.isMaximized();
});

ipcMain.handle('window-close', () => {
  if (mainWindow) {
    mainWindow.hide();
    updateTrayMenu();
  }
});

ipcMain.handle('screen:getMetrics', () => {
  return getScreenMetricsData();
});

ipcMain.handle('window-set-resolution', (event, { width, height }) => {
  if (!mainWindow) return null;
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workAreaSize;

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  }

  const finalW = Math.min(width, workArea.width);
  const finalH = Math.min(height, workArea.height);

  mainWindow.setContentSize(finalW, finalH);
  mainWindow.center();
  return { width: finalW, height: finalH };
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// ── Mini-Player HUD / Overlay for Gamers (Always-on-Top) ──
let isMiniPlayerActive = false;
let savedBoundsBeforeMini = null;

function toggleMiniPlayer(forceState) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  const nextState = (typeof forceState === 'boolean') ? forceState : !isMiniPlayerActive;
  if (nextState === isMiniPlayerActive) return isMiniPlayerActive;

  isMiniPlayerActive = nextState;

  if (isMiniPlayerActive) {
    savedBoundsBeforeMini = mainWindow.getBounds();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setMinimumSize(320, 84);

    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    // Place at bottom-right corner of screen (convenient HUD for gamers)
    const miniW = 340;
    const miniH = 84;
    const miniX = workArea.x + workArea.width - miniW - 24;
    const miniY = workArea.y + workArea.height - miniH - 24;

    mainWindow.setBounds({ x: miniX, y: miniY, width: miniW, height: miniH });
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMinimumSize(860, 560);

    if (savedBoundsBeforeMini) {
      mainWindow.setBounds(savedBoundsBeforeMini);
    } else {
      mainWindow.setSize(1200, 780);
      mainWindow.center();
    }
  }

  mainWindow.webContents.send('mini-player-state', isMiniPlayerActive);
  return isMiniPlayerActive;
}

ipcMain.handle('window-toggle-mini-player', (event, forceState) => {
  return toggleMiniPlayer(forceState);
});

ipcMain.handle('window-is-mini-player', () => {
  return isMiniPlayerActive;
});

// ─────────────────────────────────────────────────────────────
// IPC Handler: Lane Downloads / Local Folder Scanner
// ─────────────────────────────────────────────────────────────
ipcMain.handle('dialog:openLaneFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Lane Music Downloads Folder',
    properties: ['openDirectory']
  });

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true, tracks: [] };
  }

  const selectedPath = result.filePaths[0];
  const tracks = await scanDirectoryForAudio(selectedPath);
  return { canceled: false, folderPath: selectedPath, tracks };
});

ipcMain.handle('scan-folder-path', async (event, folderPath) => {
  try {
    const safePath = sanitizeOpenPath(folderPath);
    const tracks = await scanDirectoryForAudio(safePath);
    return { success: true, folderPath: safePath, tracks };
  } catch (err) {
    return { success: false, error: err.message, tracks: [] };
  }
});

// ─────────────────────────────────────────────────────────────
// IPC Handlers: Online Streaming & Search Engine (Lane / YM)
// ─────────────────────────────────────────────────────────────
ipcMain.handle('online:search', async (event, query) => {
  try {
    return await laneOnlineEngine.searchTracks(query);
  } catch (err) {
    console.error('IPC online:search error:', err);
    return [];
  }
});

ipcMain.handle('online:getCategory', async (event, category) => {
  try {
    return await laneOnlineEngine.getCategoryTracks(category);
  } catch (err) {
    console.error('IPC online:getCategory error:', err);
    return [];
  }
});

ipcMain.handle('online:getStreamUrl', async (event, trackId) => {
  try {
    return await laneOnlineEngine.getTrackStreamUrl(trackId);
  } catch (err) {
    console.error('IPC online:getStreamUrl error:', err);
    return null;
  }
});

ipcMain.handle('online:checkBypass', async () => {
  return await laneOnlineEngine.checkConnectivity();
});

ipcMain.handle('online:getSimilarTracks', async (event, trackId, artistHint) => {
  try {
    console.log(`[IPC] online:getSimilarTracks called: trackId=${trackId}, artistHint=${artistHint}`);
    const tracks = await laneOnlineEngine.getSimilarTracks(trackId, artistHint);
    console.log(`[IPC] online:getSimilarTracks returning ${tracks.length} tracks`);
    return tracks;
  } catch (err) {
    console.error('IPC online:getSimilarTracks error:', err);
    return [];
  }
});

// ─────────────────────────────────────────────────────────────
// IPC Handlers: Discord Rich Presence (RPC)
// ─────────────────────────────────────────────────────────────
ipcMain.on('discord-rpc:update', (event, data) => {
  discordRpcManager.updatePlayback(data);
});

ipcMain.on('discord-rpc:clear', () => {
  discordRpcManager.clear();
});

// ─────────────────────────────────────────────────────────────
// IPC Handlers: Offline Download Manager
// ─────────────────────────────────────────────────────────────
ipcMain.handle('downloads:getTracks', async () => {
  return downloadManager.getDownloadedTracks();
});

ipcMain.handle('downloads:isDownloaded', async (event, trackId) => {
  return downloadManager.isDownloaded(trackId);
});

ipcMain.handle('downloads:downloadTrack', async (event, track) => {
  try {
    return await downloadManager.downloadTrack(track);
  } catch (err) {
    console.error('Download error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('downloads:deleteTrack', async (event, trackId) => {
  return await downloadManager.deleteTrack(trackId);
});

ipcMain.handle('downloads:getFolder', async () => {
  return downloadManager.getDownloadsDir();
});

ipcMain.handle('downloads:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите папку для сохранения музыки HurtMusic',
    defaultPath: downloadManager.getDownloadsDir(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths.length) {
    return { canceled: true, folder: downloadManager.getDownloadsDir() };
  }
  const chosenPath = result.filePaths[0];
  const ok = downloadManager.setDownloadsDir(chosenPath);
  return { canceled: false, folder: downloadManager.getDownloadsDir(), success: ok };
});

ipcMain.handle('downloads:openFolder', async () => {
  const folder = downloadManager.getDownloadsDir();
  if (folder && nodeFs.existsSync(folder)) {
    shell.openPath(folder);
    return { success: true };
  }
  return { success: false, error: 'Папка не найдена' };
});

// ── Over-The-Air (OTA) Instant Updates ──
const otaUpdater = new OtaUpdater({ repo: 'hurters/hurtmusic' });

ipcMain.handle('ota:check', async () => {
  return await otaUpdater.checkForUpdates();
});

ipcMain.handle('ota:start-download', async (event, asset) => {
  try {
    const result = await otaUpdater.downloadUpdate(asset, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ota:download-progress', progress);
      }
    });
    return { success: true, result };
  } catch (err) {
    console.error('[OTA] Download error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ota:has-pending-update', () => {
  return otaUpdater.hasPendingUpdate();
});

ipcMain.handle('ota:install-and-restart', () => {
  otaUpdater.installAndRestart(app);
});

/**
 * Recursively scans directory for audio files and parses track info
 */
async function scanDirectoryForAudio(dirPath) {
  const tracks = [];

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    // Check for folder cover art
    let folderCover = null;
    const coverNames = ['cover.jpg', 'cover.png', 'cover.jpeg', 'folder.jpg', 'folder.png', 'album.jpg', 'album.png'];
    for (const cn of coverNames) {
      if (entries.some(e => e.name.toLowerCase() === cn)) {
        folderCover = `file:///${path.join(currentDir, cn).replace(/\\/g, '/')}`;
        break;
      }
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          const stats = await fs.stat(fullPath).catch(() => null);
          const parsedMeta = parseFileNameMetadata(entry.name);

          tracks.push({
            id: 'local_' + Buffer.from(fullPath).toString('base64').replace(/=/g, ''),
            title: parsedMeta.title,
            artist: parsedMeta.artist,
            album: parsedMeta.album || path.basename(currentDir),
            filePath: fullPath,
            fileUrl: `lane-local:///${fullPath.replace(/\\/g, '/')}`,
            coverUrl: folderCover || '',
            fileName: entry.name,
            ext: ext.replace('.', '').toUpperCase(),
            sizeBytes: stats ? stats.size : 0,
            modifiedAt: stats ? stats.mtimeMs : Date.now(),
            duration: 0 // Will be populated by HTML5 Audio on loadedmetadata
          });
        }
      }
    }
  }

  await walk(dirPath);
  return tracks;
}

/**
 * Intelligent parser for filename formats:
 * - "Artist - Title.mp3"
 * - "01. Artist - Title.mp3"
 * - "Title.mp3"
 * - Lane specific downloaded names
 */
function parseFileNameMetadata(fileName) {
  const nameWithoutExt = path.parse(fileName).name;
  
  // Remove leading track numbers (e.g., "01. ", "01 - ", "[1] ")
  const cleanedName = nameWithoutExt.replace(/^(\d+[\.\-\s_]+|\[\d+\]\s*)/, '').trim();

  if (cleanedName.includes(' - ')) {
    const parts = cleanedName.split(' - ');
    const artist = parts[0].trim();
    const title = parts.slice(1).join(' - ').trim();
    return { artist: artist || 'Unknown Artist', title: title || nameWithoutExt };
  } else if (cleanedName.includes('_')) {
    const parts = cleanedName.split('_');
    if (parts.length >= 2) {
      return { artist: parts[0].trim(), title: parts.slice(1).join(' ').trim() };
    }
  }

  return { artist: 'Lane Download', title: cleanedName || nameWithoutExt };
}

// ─────────────────────────────────────────────────────────────
// App Lifecycle
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// App Lifecycle & Single Instance Guard
// ─────────────────────────────────────────────────────────────
const gotTheLock = isTestMode ? true : app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Zero-Copy Streaming Protocol with RFC 7233 Range Partial Content support
    protocol.handle('lane-local', async (request) => {
      try {
        const url = new URL(request.url);
        let rawPath = decodeURIComponent(url.pathname);
        if (process.platform === 'win32' && rawPath.startsWith('/')) {
          rawPath = rawPath.slice(1);
        }
        const safePath = sanitizeOpenPath(rawPath);
        const stats = await fs.stat(safePath);
        const fileSize = stats.size;
        const rangeHeader = request.headers.get('range');
        const parsedRange = parseHttpRange(rangeHeader, fileSize);

        const ext = path.extname(safePath).toLowerCase();
        const mimeTypes = {
          '.mp3': 'audio/mpeg',
          '.m4a': 'audio/mp4',
          '.wav': 'audio/wav',
          '.flac': 'audio/flac',
          '.ogg': 'audio/ogg',
          '.aac': 'audio/aac',
          '.opus': 'audio/opus'
        };
        const contentType = mimeTypes[ext] || 'audio/mpeg';

        if (parsedRange) {
          const stream = nodeFs.createReadStream(safePath, {
            start: parsedRange.start,
            end: parsedRange.end
          });
          return new Response(Readable.toWeb(stream), {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(parsedRange.chunkLength),
              'Content-Range': `bytes ${parsedRange.start}-${parsedRange.end}/${fileSize}`,
              'Accept-Ranges': 'bytes'
            }
          });
        } else {
          const stream = nodeFs.createReadStream(safePath);
          return new Response(Readable.toWeb(stream), {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(fileSize),
              'Accept-Ranges': 'bytes'
            }
          });
        }
      } catch (err) {
        console.error('[lane-local protocol error]', err.message);
        return new Response('File not found or access denied', { status: 404 });
      }
    });

    createWindow();
    if (!isTestMode) {
      createTray();
      discordRpcManager.init();
    }

    // Silent background Over-The-Air (OTA) update check
    setTimeout(async () => {
      try {
        if (otaUpdater.hasPendingUpdate()) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ota:update-ready');
          }
          return;
        }
        const update = await otaUpdater.checkForUpdates();
        if (update && update.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ota:update-available', update);
        }
      } catch (err) {
        console.warn('[OTA AutoCheck]', err.message);
      }
    }, 6000);

    // Register Global Media Keys & HUD Hotkey (Overlay for Gamers)
    try {
      globalShortcut.register('MediaPlayPause', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('global-hotkey:play-pause');
        }
      });
      globalShortcut.register('MediaNextTrack', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('global-hotkey:next');
        }
      });
      globalShortcut.register('MediaPreviousTrack', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('global-hotkey:previous');
        }
      });
      globalShortcut.register('CommandOrControl+Shift+M', () => {
        toggleMiniPlayer();
      });
    } catch (err) {
      console.warn('[Global Hotkeys]', err.message);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else if (mainWindow) {
        mainWindow.show();
      }
    });
  });
}

app.on('before-quit', () => {
  app.isQuitting = true;
  try {
    globalShortcut.unregisterAll();
  } catch (e) {}
  discordRpcManager.destroy();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('window-all-closed', () => {
  // Keep app running in tray unless explicit user quit
  if (app.isQuitting) {
    app.quit();
  }
});
