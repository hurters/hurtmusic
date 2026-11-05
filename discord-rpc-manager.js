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
   * Set Idle presence when no song is playing
   */
  async setIdle() {
    if (!this.isConnected || !this.client?.user) return;
    try {
      await this.client.user.setActivity({
        details: 'В медиатеке',
        state: 'Выбирает трек',
        largeImageKey: 'logo',
        largeImageText: 'HurtMusic',
        buttons: [
          { label: 'Канал HurtMusic', url: 'https://t.me/hurtmusics' }
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

    const cover = (data.coverUrl && data.coverUrl.startsWith('http'))
      ? data.coverUrl
      : 'logo';

    const activity = {
      details: (data.title || 'Трек').slice(0, 128),
      state: (data.artist || 'HurtMusic').slice(0, 128),
      largeImageKey: cover,
      largeImageText: (data.album || 'HurtMusic').slice(0, 128),
      buttons: [
        { label: 'Слушать в HurtMusic', url: 'https://t.me/hurtmusics' }
      ]
    };

    if (data.isPlaying) {
      activity.smallImageKey = 'play';
      activity.smallImageText = 'Воспроизведение';

      // Live progress bar in Discord
      activity.startTimestamp = now - curTime;
      if (duration > 0 && duration >= curTime) {
        activity.endTimestamp = now + (duration - curTime);
      }
    } else {
      activity.smallImageKey = 'pause';
      activity.smallImageText = 'Пауза';
      activity.state = `${(data.artist || 'HurtMusic')} · Пауза`.slice(0, 128);
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