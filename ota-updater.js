const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

/**
 * Compare two semver strings: v1 vs v2
 * Returns:
 *   1 if v1 > v2
 *  -1 if v1 < v2
 *   0 if equal
 */
function compareSemver(v1, v2) {
  const clean1 = (v1 || '').replace(/^[vV]/, '').trim();
  const clean2 = (v2 || '').replace(/^[vV]/, '').trim();

  const parts1 = clean1.split('.').map(n => parseInt(n, 10) || 0);
  const parts2 = clean2.split('.').map(n => parseInt(n, 10) || 0);

  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * Retrieve GitHub token from environment or mcp_config.json
 */
function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN.trim();
  }
  try {
    const userProfile = process.env.USERPROFILE || process.env.HOME || '';
    const mcpConfigPath = path.join(userProfile, '.gemini', 'config', 'mcp_config.json');
    if (fs.existsSync(mcpConfigPath)) {
      const data = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      if (data?.mcpServers?.github?.env?.GITHUB_PERSONAL_ACCESS_TOKEN) {
        return data.mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN.trim();
      }
    }
  } catch (err) {
    // Non-fatal, proceed unauthenticated
  }
  return null;
}

class OtaUpdater {
  constructor(options = {}) {
    this.repo = options.repo || 'hurters/hurtmusic';
    this.packageJsonPath = options.packageJsonPath || path.join(__dirname, 'package.json');
    this.currentVersion = this.readCurrentVersion();
    this.isDownloading = false;
    this.downloadAbortController = null;
    this.resourcesPath = options.resourcesPath || (process.resourcesPath || __dirname);
  }

  readCurrentVersion() {
    try {
      if (fs.existsSync(this.packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(this.packageJsonPath, 'utf8'));
        return pkg.version || '1.0.0';
      }
    } catch (e) {
      console.warn('[OTA] Failed to read package.json version:', e.message);
    }
    return '1.0.0';
  }

  /**
   * Check GitHub Releases for newer version
   */
  async checkForUpdates() {
    const token = getGitHubToken();
    const headers = {
      'User-Agent': 'HurtMusic-OTA-Client/1.0',
      'Accept': 'application/vnd.github+json'
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, { headers });
      
      if (res.status === 404) {
        // No releases yet in the repo
        return {
          hasUpdate: false,
          currentVersion: this.currentVersion,
          latestVersion: this.currentVersion,
          message: 'Релизов пока нет'
        };
      }

      if (!res.ok) {
        throw new Error(`GitHub API returned HTTP ${res.status}`);
      }

      const release = await res.json();
      const latestTag = release.tag_name || release.name || '';
      const latestVersion = latestTag.replace(/^[vV]/, '');

      const isNewer = compareSemver(latestVersion, this.currentVersion) > 0;

      // Locate app.asar in release assets
      const assets = release.assets || [];
      const asarAsset = assets.find(a => a.name.toLowerCase() === 'app.asar' || a.name.toLowerCase().endsWith('.asar'));

      return {
        hasUpdate: isNewer,
        currentVersion: this.currentVersion,
        latestVersion: latestVersion || this.currentVersion,
        releaseName: release.name || `HurtMusic v${latestVersion}`,
        releaseNotes: release.body || 'Новая версия HurtMusic с оптимизациями и исправлениями.',
        publishedAt: release.published_at,
        htmlUrl: release.html_url,
        asset: asarAsset ? {
          id: asarAsset.id,
          name: asarAsset.name,
          size: asarAsset.size,
          downloadUrl: asarAsset.browser_download_url,
          apiUrl: asarAsset.url
        } : null
      };
    } catch (err) {
      console.error('[OTA] Check failed:', err.message);
      return {
        hasUpdate: false,
        currentVersion: this.currentVersion,
        error: err.message
      };
    }
  }

  /**
   * Download update asset with progress reporting
   */
  async downloadUpdate(asset, onProgress = () => {}) {
    if (this.isDownloading) {
      throw new Error('Загрузка обновления уже выполняется');
    }

    this.isDownloading = true;
    this.downloadAbortController = new AbortController();

    const token = getGitHubToken();
    const downloadDest = path.join(this.resourcesPath, 'app.asar.download');
    const finalDest = path.join(this.resourcesPath, 'app.asar.new');

    try {
      // Use API url with application/octet-stream for private repos, or browser_download_url
      let targetUrl = asset.downloadUrl;
      const headers = {
        'User-Agent': 'HurtMusic-OTA-Client/1.0'
      };

      if (token && asset.apiUrl) {
        targetUrl = asset.apiUrl;
        headers['Authorization'] = `token ${token}`;
        headers['Accept'] = 'application/octet-stream';
      }

      const response = await fetch(targetUrl, {
        headers,
        signal: this.downloadAbortController.signal,
        redirect: 'follow'
      });

      if (!response.ok) {
        throw new Error(`Ошибка загрузки: HTTP ${response.status}`);
      }

      const totalBytes = parseInt(response.headers.get('content-length') || (asset.size ? String(asset.size) : '0'), 10);
      let receivedBytes = 0;
      let lastReportTime = Date.now();
      let lastReceivedBytes = 0;

      const fileStream = fs.createWriteStream(downloadDest);
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        fileStream.write(Buffer.from(value));
        receivedBytes += value.length;

        const now = Date.now();
        if (now - lastReportTime >= 150 || receivedBytes === totalBytes) {
          const deltaMs = now - lastReportTime;
          const deltaBytes = receivedBytes - lastReceivedBytes;
          const speedBytesPerSec = deltaMs > 0 ? (deltaBytes / deltaMs) * 1000 : 0;
          const percent = totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 0;

          onProgress({
            percent,
            receivedBytes,
            totalBytes,
            speedMBps: (speedBytesPerSec / (1024 * 1024)).toFixed(2),
            transferredMB: (receivedBytes / (1024 * 1024)).toFixed(2),
            totalMB: (totalBytes / (1024 * 1024)).toFixed(2)
          });

          lastReportTime = now;
          lastReceivedBytes = receivedBytes;
        }
      }

      await new Promise((resolve, reject) => {
        fileStream.end((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Atomically rename downloaded file to app.asar.new
      if (fs.existsSync(finalDest)) {
        fs.unlinkSync(finalDest);
      }
      fs.renameSync(downloadDest, finalDest);

      this.isDownloading = false;
      return { success: true, path: finalDest };
    } catch (err) {
      this.isDownloading = false;
      if (fs.existsSync(downloadDest)) {
        try { fs.unlinkSync(downloadDest); } catch(e) {}
      }
      throw err;
    }
  }

  /**
   * Check if a downloaded update is already waiting to be installed
   */
  hasPendingUpdate() {
    const finalDest = path.join(this.resourcesPath, 'app.asar.new');
    return fs.existsSync(finalDest);
  }

  /**
   * Create detached batch updater and restart application seamlessly on Windows
   */
  installAndRestart(appInstance) {
    const finalDest = path.join(this.resourcesPath, 'app.asar.new');
    if (!fs.existsSync(finalDest)) {
      throw new Error('Файл обновления не найден');
    }

    const currentAsar = path.join(this.resourcesPath, 'app.asar');
    const backupAsar = path.join(this.resourcesPath, 'app.asar.bak');
    const exePath = process.execPath;
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      const batScript = [
        '@echo off',
        'chcp 65001 >nul',
        'timeout /t 1 /nobreak >nul',
        ':waitloop',
        `tasklist /fi "imagename eq hurtmusic.exe" | find /i "hurtmusic.exe" >nul`,
        'if not errorlevel 1 (',
        '  timeout /t 1 /nobreak >nul',
        '  goto waitloop',
        ')',
        `if exist "${finalDest}" (`,
        `  if exist "${currentAsar}" copy /y "${currentAsar}" "${backupAsar}" >nul`,
        `  move /y "${finalDest}" "${currentAsar}" >nul`,
        ')',
        `start "" "${exePath}"`,
        'del "%~f0"'
      ].join('\r\n');

      const batPath = path.join(os.tmpdir(), `hurtmusic-update-${Date.now()}.bat`);
      fs.writeFileSync(batPath, batScript, 'utf8');

      // Launch updater detached
      const child = spawn('cmd.exe', ['/c', batPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();

      if (appInstance && typeof appInstance.quit === 'function') {
        appInstance.quit();
      } else {
        process.exit(0);
      }
    } else {
      // Non-windows fallback
      fs.copyFileSync(currentAsar, backupAsar);
      fs.renameSync(finalDest, currentAsar);
      if (appInstance && typeof appInstance.relaunch === 'function') {
        appInstance.relaunch();
        appInstance.quit();
      }
    }
  }
}

module.exports = {
  OtaUpdater,
  compareSemver,
  getGitHubToken
};
