const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  toggleMiniPlayer: (forceState) => ipcRenderer.invoke('window-toggle-mini-player', forceState),
  isMiniPlayer: () => ipcRenderer.invoke('window-is-mini-player'),
  onMiniPlayerState: (callback) => {
    ipcRenderer.on('mini-player-state', (event, isMini) => callback(isMini));
  },
  onGlobalHotkey: (action, callback) => {
    ipcRenderer.on(`global-hotkey:${action}`, () => callback());
  },
  onWindowStateChanged: (callback) => {
    ipcRenderer.on('window-state-changed', (event, data) => callback(data));
  },

  // Lane Folder scanning (Secured)
  selectLaneFolder: () => ipcRenderer.invoke('dialog:openLaneFolder'),
  scanFolderPath: (folderPath) => ipcRenderer.invoke('scan-folder-path', folderPath),

  // Online Streaming & Search Engine (Lane Bypass / Yandex Music)
  searchOnline: (query) => ipcRenderer.invoke('online:search', query),
  getOnlineCategory: (category) => ipcRenderer.invoke('online:getCategory', category),
  getOnlineStreamUrl: (trackId) => ipcRenderer.invoke('online:getStreamUrl', trackId),
  getSimilarTracks: (trackId, artistHint, limit) => ipcRenderer.invoke('online:getSimilarTracks', trackId, artistHint, limit),
  checkBypass: () => ipcRenderer.invoke('online:checkBypass'),

  // Discord Rich Presence
  updateDiscordRPC: (data) => ipcRenderer.send('discord-rpc:update', data),
  clearDiscordRPC: () => ipcRenderer.send('discord-rpc:clear'),

  // Offline Download Manager (Save Online to Local Offline)
  getDownloadedTracks: () => ipcRenderer.invoke('downloads:getTracks'),
  isDownloaded: (trackId) => ipcRenderer.invoke('downloads:isDownloaded', trackId),
  downloadTrack: (track) => ipcRenderer.invoke('downloads:downloadTrack', track),
  deleteDownloadedTrack: (trackId) => ipcRenderer.invoke('downloads:deleteTrack', trackId),
  getDownloadFolder: () => ipcRenderer.invoke('downloads:getFolder'),
  selectDownloadFolder: () => ipcRenderer.invoke('downloads:selectFolder'),
  openDownloadFolder: () => ipcRenderer.invoke('downloads:openFolder'),

  // System Tray & Background Playback Control
  sendPlaybackState: (data) => ipcRenderer.send('playback:state-changed', data),
  onTrayPlayPause: (callback) => ipcRenderer.on('tray:play-pause', () => callback()),
  onTrayNext: (callback) => ipcRenderer.on('tray:next', () => callback()),
  onTrayPrev: (callback) => ipcRenderer.on('tray:prev', () => callback()),
  onTrayFavorite: (callback) => ipcRenderer.on('tray:favorite', () => callback()),

  // Screen & Resolution Auto-Detection & Preset Switching
  getScreenMetrics: () => ipcRenderer.invoke('screen:getMetrics'),
  setResolution: (dims) => ipcRenderer.invoke('window-set-resolution', dims),
  onScreenMetricsChanged: (callback) => {
    ipcRenderer.on('screen:metrics-changed', (event, data) => callback(data));
  },

  // Over-The-Air (OTA) Updates
  checkForUpdates: () => ipcRenderer.invoke('ota:check'),
  startUpdateDownload: (asset) => ipcRenderer.invoke('ota:start-download', asset),
  installUpdateAndRestart: () => ipcRenderer.invoke('ota:install-and-restart'),
  hasPendingUpdate: () => ipcRenderer.invoke('ota:has-pending-update'),
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('ota:update-available', (event, data) => callback(data));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on('ota:download-progress', (event, data) => callback(data));
  },
  onUpdateReady: (callback) => {
    ipcRenderer.on('ota:update-ready', () => callback());
  },

  // Platform info
  platform: process.platform,
  isElectron: true
});
