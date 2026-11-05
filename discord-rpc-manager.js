const { Client } = require('@xhayper/discord-rpc');
const fs = require('fs');
const path = require('path');

/**
 * Beautiful Discord Rich Presence Manager for HurtMusic
 * Displays currently playing tracks, artist, album, covers, and playback timeline.
 */
class DiscordRpcManager {
  constructor() {
    // HurtMusic Discord Application Client ID
    this.clientId = this.loadCustomClientId() || '1567895435748704286';
    this.client = null;
    this.isConnected = false;
    this.currentActivity = null;
    this.reconnectTimer = null;
    this.lastUpdateTime = 0;
    this.appIconUrl = 'https://cdn.discordapp.com/app-icons/1567895435748704286/931d7e8da910dd42ab5f4d57f755933c.png?size=512';
    this.fetchAppIcon();
  }

  fetchAppIcon() {
    try {
      const https = require('https');
      https.get(`https://discord.com/api/v10/applications/${this.clientId}/rpc`, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (data.icon) {
              this.appIconUrl = `https://cdn.discordapp.com/app-icons/${this.clientId}/${data.icon}.png?size=512`;
            }
          } catch (e) {}
        });
      }).on('error', () => {});
    } catch (e) {}
  }

  loadCustomClientId() {
    try {
      const cfgPath = path.join(__dirname, 'discord-config.json');
      if (fs.existsSync(cfgPath)) {
        const raw = fs.readFileSync(cfgPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.clientId && typeof parsed.clientId === 'string') {
          return parsed.clientId.trim();
        }
      }
    } catch (e) {}
    return null;
  }

  /**
   * Connect to local Discord instance via IPC
   */
  async init(overrideClientId) {
    if (overrideClientId) {
      this.clientId = overrideClientId;
    }
    if (this.client) return;

    try {
      this.client = new Client({ clientId: this.clientId });

      this.client.on('ready', () => {
        this.isConnected = true;
        console.log(`[Discord RPC] Connected successfully as ${this.client.user?.username}`);
        if (this.currentActivity) {
          this.setActivity(this.currentActivity);
        } else {
          this.setIdle();
        }
      });

      this.client.on('disconnected', () => {
        this.isConnected = false;
        console.log('[Discord RPC] Disconnected from Discord.');
        this.scheduleReconnect();
      });

      await this.client.login().catch((err) => {
        console.warn('[Discord RPC] Initial login failed (Discord might be closed):', err.message);
        this.scheduleReconnect();
      });
    } catch (err) {
      console.warn('[Discord RPC] Init failed:', err.message);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.isConnected && this.client) {
        try {
          await this.client.login();
        } catch (e) {
          this.scheduleReconnect();
        }
      }
    }, 15000);
  }

  /**
   * Helper to safely update activity on Discord
   */
  async setActivity(activity) {
    if (!this.isConnected || !this.client?.user) return;
    try {
      await this.client.user.setActivity(activity);
    } catch (err) {
      console.warn('[Discord RPC] Failed to set activity:', err.message);
    }
  }

  /**
   * Set Idle presence when no song is playing
   */
  async setIdle() {
    this.currentActivity = null;
    await this.setActivity({
      details: 'В медиатеке',
      state: 'Выбирает трек',
      largeImageKey: this.appIconUrl || 'logo',
      largeImageText: 'HurtMusic · Studio Hi-Fi',
      buttons: [
        { label: 'Канал HurtMusic', url: 'https://t.me/hurtmusics' },
        { label: 'Скачать плеер', url: 'https://t.me/hurtmusics' }
      ]
    });
  }

  /**
   * Update live playback presence
   * @param {Object} data - { title, artist, album, coverUrl, isPlaying, currentTime, duration }
   */
  async updatePlayback(data) {
    if (!data || !data.title) {
      return this.setIdle();
    }

    const now = Math.floor(Date.now() / 1000);
    const curTime = Math.max(0, Math.floor(data.currentTime || 0));
    const duration = Math.max(0, Math.floor(data.duration || 0));

    const cover = (data.coverUrl && data.coverUrl.startsWith('http'))
      ? data.coverUrl
      : (this.appIconUrl || 'logo');

    const albumTag = data.album ? `${data.album} · Hi-Fi Lossless` : 'HurtMusic · Studio Hi-Fi';

    const activity = {
      details: (data.title || 'Трек').slice(0, 128),
      state: (data.artist || 'HurtMusic').slice(0, 128),
      largeImageKey: cover,
      largeImageText: albumTag.slice(0, 128),
      buttons: [
        { label: 'Слушать в HurtMusic', url: 'https://t.me/hurtmusics' },
        { label: 'Скачать плеер', url: 'https://t.me/hurtmusics' }
      ]
    };

    if (data.isPlaying) {
      // Live progress bar in Discord
      activity.startTimestamp = now - curTime;
      if (duration > 0 && duration >= curTime) {
        activity.endTimestamp = now + (duration - curTime);
      }
    } else {
      activity.state = `${(data.artist || 'HurtMusic')} · Пауза`.slice(0, 128);
    }

    this.currentActivity = activity;

    // Rate-limit Discord RPC updates to avoid spamming the IPC pipe
    const nowMs = Date.now();
    if (nowMs - this.lastUpdateTime < 800) return;
    this.lastUpdateTime = nowMs;

    await this.setActivity(activity);
  }

  /**
   * Clear presence
   */
  async clear() {
    this.currentActivity = null;
    if (this.isConnected && this.client?.user) {
      try {
        await this.client.user.clearActivity();
      } catch (err) {}
    }
  }

  destroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.client) {
      try { this.client.destroy(); } catch (e) {}
      this.client = null;
      this.isConnected = false;
    }
  }
}

module.exports = new DiscordRpcManager();