const { Client } = require('@xhayper/discord-rpc');

/**
 * Beautiful Discord Rich Presence Manager for Lane Music
 * Displays currently playing tracks, artist, high-res covers, and live timeline
 */
class DiscordRpcManager {
  constructor() {
    this.clientId = '842112189618978897'; // Apple Music Client ID (matches minimalist Apple Music theme)
    this.client = null;
    this.isConnected = false;
    this.currentActivity = null;
    this.reconnectTimer = null;
    this.lastUpdateTime = 0;
  }

  /**
   * Connect to local Discord instance via IPC
   */
  async init() {
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
   * Set Idle presence when no song is playing
   */
  async setIdle() {
    if (!this.isConnected || !this.client?.user) return;
    try {
      await this.client.user.setActivity({
        details: 'В медиатеке',
        state: 'Выбирает музыку',
        largeImageKey: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
        largeImageText: 'hurtmusic',
        buttons: [
          { label: 'hurtmusic', url: 'https://github.com' }
        ]
      });
    } catch (e) {
      console.warn('[Discord RPC] Failed to set idle:', e.message);
    }
  }

  /**
   * Update live playback presence
   * @param {Object} data - { title, artist, album, coverUrl, isPlaying, currentTime, duration }
   */
  async updatePlayback(data) {
    if (!data || !data.title) {
      this.currentActivity = null;
      return this.setIdle();
    }

    const now = Math.floor(Date.now() / 1000);
    const curTime = Math.max(0, Math.floor(data.currentTime || 0));
    const duration = Math.max(0, Math.floor(data.duration || 0));

    const activity = {
      details: (data.title || 'Unknown Title').slice(0, 128),
      state: `от ${(data.artist || 'Неизвестный исполнитель')}`.slice(0, 128),
      largeImageKey: data.coverUrl && data.coverUrl.startsWith('http')
        ? data.coverUrl
        : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80',
      largeImageText: (data.album || 'hurtmusic').slice(0, 128),
      buttons: [
        { label: 'Слушать в hurtmusic', url: 'https://github.com' }
      ]
    };

    if (data.isPlaying) {
      activity.smallImageKey = 'https://img.icons8.com/ios-glyphs/90/fa243c/play--v1.png';
      activity.smallImageText = 'Воспроизведение';

      // Timestamps for live timeline bar in Discord
      activity.startTimestamp = now - curTime;
      if (duration > 0 && duration >= curTime) {
        activity.endTimestamp = now + (duration - curTime);
      }
    } else {
      activity.smallImageKey = 'https://img.icons8.com/ios-glyphs/90/fa243c/pause--v1.png';
      activity.smallImageText = 'На паузе';
      activity.state = `${(data.artist || 'Неизвестный исполнитель')} · Пауза`.slice(0, 128);
    }

    this.currentActivity = activity;

    // Rate-limit Discord RPC updates to avoid spamming the IPC pipe
    const nowMs = Date.now();
    if (nowMs - this.lastUpdateTime < 800) return;
    this.lastUpdateTime = nowMs;

    if (this.isConnected && this.client?.user) {
      try {
        await this.client.user.setActivity(activity);
      } catch (err) {
        console.warn('[Discord RPC] Failed to update activity:', err.message);
      }
    }
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
