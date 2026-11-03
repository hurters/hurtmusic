const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const laneOnlineEngine = require('./lane-online-engine');

/**
 * Lane Offline Download Manager
 * Downloads online tracks (audio + high-res cover) for 100% offline playback
 */
class DownloadManager {
  constructor() {
    let baseDir = null;
    const settingsPath = this.getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (settings && settings.customFolder && fs.existsSync(settings.customFolder)) {
          baseDir = settings.customFolder;
        }
      } catch {}
    }
    if (!baseDir) {
      baseDir = this.getDefaultDownloadsDir();
    }
    this.downloadsDir = baseDir;
    this.indexPath = path.join(this.downloadsDir, 'downloads.json');
    this.downloadedTracks = new Map();
    this.init();
  }

  getSettingsPath() {
    try {
      return (app && typeof app.getPath === 'function')
        ? path.join(app.getPath('userData'), 'download_settings.json')
        : path.join(__dirname, 'download_settings.json');
    } catch {
      return path.join(__dirname, 'download_settings.json');
    }
  }

  getDefaultDownloadsDir() {
    try {
      if (app && typeof app.getPath === 'function') {
        const musicDir = app.getPath('music');
        if (musicDir && fs.existsSync(musicDir)) {
          return path.join(musicDir, 'HurtMusic');
        }
        const dlDir = app.getPath('downloads');
        if (dlDir && fs.existsSync(dlDir)) {
          return path.join(dlDir, 'HurtMusic');
        }
      }
    } catch {}
    return path.join(__dirname, 'downloads');
  }

  getDownloadsDir() {
    return this.downloadsDir;
  }

  setDownloadsDir(newDir) {
    if (!newDir || typeof newDir !== 'string') return false;
    try {
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }
      this.downloadsDir = newDir;
      this.indexPath = path.join(this.downloadsDir, 'downloads.json');

      const settingsPath = this.getSettingsPath();
      fs.writeFileSync(settingsPath, JSON.stringify({ customFolder: newDir }, null, 2), 'utf8');

      this.downloadedTracks.clear();
      this.init();
      return true;
    } catch (err) {
      console.error('[DownloadManager] setDownloadsDir error:', err.message);
      return false;
    }
  }

  init() {
    try {
      if (!fs.existsSync(this.downloadsDir)) {
        fs.mkdirSync(this.downloadsDir, { recursive: true });
      }

      if (fs.existsSync(this.indexPath)) {
        const raw = fs.readFileSync(this.indexPath, 'utf8');
        const list = JSON.parse(raw);
        for (const t of list) {
          // Verify file still exists on disk
          if (fs.existsSync(t.filePath)) {
            this.downloadedTracks.set(t.originalId || t.id, t);
          }
        }
      }
    } catch (err) {
      console.warn('[DownloadManager] Init error:', err.message);
    }
  }

  saveIndex() {
    try {
      const list = Array.from(this.downloadedTracks.values());
      fs.writeFileSync(this.indexPath, JSON.stringify(list, null, 2), 'utf8');
    } catch (err) {
      console.error('[DownloadManager] Failed to save index:', err.message);
    }
  }

  isDownloaded(trackId) {
    if (!trackId) return false;
    return this.downloadedTracks.has(trackId);
  }

  getDownloadedTracks() {
    return Array.from(this.downloadedTracks.values());
  }

  sanitizeFileName(str) {
    return (str || 'Track').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim().slice(0, 80);
  }

  fetchBuffer(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this.fetchBuffer(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
    });
  }

  async downloadTrack(track) {
    if (!track || !track.id) throw new Error('Invalid track object');

    // If already downloaded, return existing
    if (this.downloadedTracks.has(track.id)) {
      return { success: true, track: this.downloadedTracks.get(track.id), alreadyDownloaded: true };
    }

    console.log(`[DownloadManager] Starting download for: ${track.artist} - ${track.title}`);

    // 1. Resolve stream URL
    let streamUrl = track.streamUrl;
    if (!streamUrl) {
      streamUrl = await laneOnlineEngine.getTrackStreamUrl(track.id);
    }

    if (!streamUrl) {
      throw new Error('Could not resolve stream URL for track');
    }

    const safeArtist = this.sanitizeFileName(track.artist || 'Unknown');
    const safeTitle = this.sanitizeFileName(track.title || 'Track');
    const cleanBaseName = `${safeArtist} - ${safeTitle}`;

    // 2. Fetch audio data
    let audioBuffer = null;
    let ext = '.m4a';

    if (streamUrl.includes('.m3u8') || streamUrl.includes('playlist')) {
      const m3u8Text = (await this.fetchBuffer(streamUrl)).toString('utf8');
      const mapMatch = m3u8Text.match(/#EXT-X-MAP:URI="([^"]+)"/);
      const initUrl = mapMatch ? mapMatch[1] : null;
      const segmentUrls = m3u8Text.split('\n').filter(l => l.startsWith('http'));

      if (segmentUrls.length === 0) {
        throw new Error('No audio segments found in HLS playlist');
      }

      const bufs = [];
      if (initUrl) {
        bufs.push(await this.fetchBuffer(initUrl));
      }

      // Download segments in parallel batches of 4
      const BATCH_SIZE = 4;
      for (let i = 0; i < segmentUrls.length; i += BATCH_SIZE) {
        const batch = segmentUrls.slice(i, i + BATCH_SIZE);
        const batchBuffers = await Promise.all(batch.map(u => this.fetchBuffer(u)));
        bufs.push(...batchBuffers);
      }

      audioBuffer = Buffer.concat(bufs);
      ext = initUrl ? '.m4a' : '.aac';
    } else {
      // Direct progressive MP3 / AAC
      audioBuffer = await this.fetchBuffer(streamUrl);
      ext = '.mp3';
    }

    let audioFileName = `${cleanBaseName}${ext}`;
    let audioFilePath = path.join(this.downloadsDir, audioFileName);
    if (fs.existsSync(audioFilePath) && !this.downloadedTracks.has(track.id)) {
      audioFileName = `${cleanBaseName} [${track.id}]${ext}`;
      audioFilePath = path.join(this.downloadsDir, audioFileName);
    }
    fs.writeFileSync(audioFilePath, audioBuffer);

    // 3. Download high-res cover art locally
    let localCoverPath = '';
    let localCoverUrl = '';
    if (track.coverUrl) {
      try {
        const coverBuf = await this.fetchBuffer(track.coverUrl);
        const coverFileName = `${cleanBaseName}_cover.jpg`;
        localCoverPath = path.join(this.downloadsDir, coverFileName);
        fs.writeFileSync(localCoverPath, coverBuf);
        localCoverUrl = `file:///${localCoverPath.replace(/\\/g, '/')}`;
      } catch (err) {
        console.warn('[DownloadManager] Cover download failed:', err.message);
      }
    }

    // 4. Create local offline track entry
    const localFileUrl = `lane-local:///${audioFilePath.replace(/\\/g, '/')}`;
    const downloadedTrack = {
      id: `local_dl_${track.id}`,
      originalId: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album || 'Скачано',
      filePath: audioFilePath,
      fileUrl: localFileUrl,
      coverPath: localCoverPath,
      coverUrl: localCoverUrl || track.coverUrl,
      ext: ext.replace('.', '').toUpperCase(),
      sizeBytes: audioBuffer.length,
      duration: track.duration || 180,
      durationFormatted: track.durationFormatted || '3:00',
      isOnline: false,
      isDownloaded: true,
      downloadedAt: Date.now()
    };

    this.downloadedTracks.set(track.id, downloadedTrack);
    this.saveIndex();

    console.log(`[DownloadManager] Successfully downloaded: ${downloadedTrack.title} (${Math.round(downloadedTrack.sizeBytes / 1024 / 1024 * 10) / 10} MB)`);
    return { success: true, track: downloadedTrack };
  }

  async deleteTrack(trackId) {
    const track = this.downloadedTracks.get(trackId) ||
                  Array.from(this.downloadedTracks.values()).find(t => t.id === trackId);

    if (!track) return { success: false, error: 'Track not found' };

    try {
      if (fs.existsSync(track.filePath)) {
        fs.unlinkSync(track.filePath);
      }
      if (track.coverPath && fs.existsSync(track.coverPath)) {
        fs.unlinkSync(track.coverPath);
      }
    } catch (err) {
      console.warn('[DownloadManager] Error deleting files:', err.message);
    }

    this.downloadedTracks.delete(track.originalId);
    this.downloadedTracks.delete(track.id);
    this.saveIndex();

    return { success: true };
  }
}

module.exports = new DownloadManager();
