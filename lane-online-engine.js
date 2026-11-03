const https = require('https');
const http = require('http');

/**
 * Lane Online Streaming Engine
 * Native high-fidelity music streaming for Russian users without VPN
 * Direct access to SoundCloud full-length library & cloud rap artists
 */
class LaneOnlineEngine {
  constructor() {
    this.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/99.0.4844.47 Mobile/15E148 Safari/604.1';
    this.desktopUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.clientIds = [
      'KKzJxmw11tYpCs6T24P4uUYhqmjalG6M',
      'iZIs9mchVcX5lhVRdekQWmUAUISRaSlv',
      'b7y2n5t5Hq6nZkM0q0E8V6J2Q5k4p7m3',
      '2t9lo3qdn0J3xmJ07Mo7t6G2o8K6p3d4'
    ];
    this.clientIdIndex = 0;
    this.clientId = this.clientIds[0];
    this.clientIdTimestamp = Date.now();
    this.streamCache = new Map();
    this.trackCache = new Map();
  }

  /**
   * Acquire or rotate SoundCloud client ID from resilient pool
   */
  async getClientId(rotate = false) {
    if (rotate) {
      this.clientIdIndex = (this.clientIdIndex + 1) % this.clientIds.length;
      this.clientId = this.clientIds[this.clientIdIndex];
      this.clientIdTimestamp = Date.now();
      console.log('[LaneOnlineEngine] Rotated clientId to index', this.clientIdIndex, ':', this.clientId);
      return this.clientId;
    }
    return this.clientId || this.clientIds[0];
  }

  /**
   * Check connectivity to online audio service
   */
  async checkConnectivity() {
    try {
      const cid = await this.getClientId();
      const testUrl = `https://api-v2.soundcloud.com/search/tracks?q=test&client_id=${cid}&limit=1`;
      const res = await this.httpGet(testUrl, { 'User-Agent': this.desktopUserAgent }, 5000);
      return { isConnected: res.status === 200, bypassActive: true };
    } catch (e) {
      return { isConnected: false, bypassActive: true };
    }
  }

  /**
   * Helper to verify a track is an actual song, not a 1-hour spam compilation / DJ mix from 2012
   */
  isCleanTrack(t) {
    if (!t) return false;
    const durationSec = typeof t.duration === 'number' ? t.duration : Math.round((t.duration || 0) / 1000);
    // Exclude long mixes / compilations over 9.5 minutes (570s)
    if (durationSec > 570 || (durationSec > 0 && durationSec < 25)) return false;

    const lowerTitle = (t.title || '').toLowerCase();
    const lowerArtist = (t.artist || (t.user && t.user.username) || '').toLowerCase();

    const spamRegex = /(\.mp3(\.|\b|$)|сборник|дискотека|сборка|клубные хиты|клубный микс|мегамикс|лучшие песни 201|хиты 201\d|хиты 200\d|микс 201\d|remix\+covers 20|club mix 201|полный сборник)/i;

    if (spamRegex.test(lowerTitle) || spamRegex.test(lowerArtist)) {
      return false;
    }
    return true;
  }

  /**
   * Fetch official SoundCloud Trending Chart (Real popular hits with millions of plays)
   */
  async getTrendingTracks(limit = 45) {
    try {
      const cid = await this.getClientId();
      const url = `https://api-v2.soundcloud.com/charts?kind=trending&genre=soundcloud%3Agenres%3Aall-music&client_id=${cid}&limit=${limit}`;
      const res = await this.httpGet(url, { 'User-Agent': this.desktopUserAgent }, 8000);

      let rawJson = null;
      if (res.status === 401) {
        const freshCid = await this.getClientId(true);
        const retryUrl = `https://api-v2.soundcloud.com/charts?kind=trending&genre=soundcloud%3Agenres%3Aall-music&client_id=${freshCid}&limit=${limit}`;
        const retryRes = await this.httpGet(retryUrl, { 'User-Agent': this.desktopUserAgent }, 8000);
        if (retryRes.status === 200) rawJson = retryRes.body;
      } else if (res.status === 200) {
        rawJson = res.body;
      }

      if (rawJson) {
        const data = JSON.parse(rawJson);
        const rawCollection = (data.collection || []).map(item => item.track || item).filter(Boolean);
        const tracks = [];
        const seenIds = new Set();
        this.parseSoundCloudCollection(JSON.stringify({ collection: rawCollection }), tracks, seenIds);
        return tracks.filter(t => this.isCleanTrack(t));
      }
    } catch (err) {
      console.error('[LaneOnlineEngine] getTrendingTracks error:', err.message);
    }

    return await this.searchMultipleArtists(['Surf7', 'EAZYBAKED', 'Louca\'s Groove', 'Eric404']);
  }

  /**
   * Fetch curated popular categories (Opium, Phonk, Witch House, Russian Rap)
   */
  async getCategoryTracks(category = 'trending') {
    switch (category) {
      case 'trending':
        return await this.getTrendingTracks(50);

      case 'opium':
        return await this.searchMultipleArtists(['kai angel', 'viperr', '3g0th2002', 'scally milano', 'toxis', 'bleood']);

      case 'phonk':
        return await this.searchMultipleArtists(['kordhell', 'dvrst', 'hensonn', 'pharmacist phonk', 'interworld']);

      case 'witchhouse':
        return await this.searchMultipleArtists(['summer of haze', 'ic3peak', 'shadowraze', 'zxcursed', 'crying city']);

      case 'russian-top':
        return await this.searchMultipleArtists(['friendly thug 52 ngg', 'big baby tape', 'macan', 'heronwater', 'bushido zho']);

      default:
        return await this.getTrendingTracks(50);
    }
  }

  /**
   * Query multiple artists in parallel and merge clean tracks
   */
  async searchMultipleArtists(artistList) {
    const allTracks = [];
    const seenIds = new Set();
    const cid = await this.getClientId();

    await Promise.all(artistList.map(async (artist) => {
      try {
        const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(artist)}&client_id=${cid}&limit=10`;
        const res = await this.httpGet(url, { 'User-Agent': this.desktopUserAgent }, 8000);
        if (res.status === 200) {
          this.parseSoundCloudCollection(res.body, allTracks, seenIds);
        }
      } catch (e) {
        // Skip individual errors
      }
    }));

    const clean = allTracks.filter(t => this.isCleanTrack(t));
    return clean.sort((a, b) => (b.playbackCount || 0) - (a.playbackCount || 0));
  }

  /**
   * Search for tracks across SoundCloud online catalog
   * Supports Russian rap, cloud rap (3g0t / 3g0th2002), mainstream, foreign music
   */
  async searchTracks(query) {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      return await this.getTrendingTracks(45);
    }

    const qLower = trimmed.toLowerCase();

    // Check if user is asking for general hits/trends
    if (/^(хиты|хиты 2026|хиты 2025|топ|популярное|тренд|тренды|chart|charts|trending|top)$/i.test(trimmed)) {
      return await this.getTrendingTracks(45);
    }

    if (qLower === 'опиум' || qLower === 'opium' || qLower === 'андер' || qLower === 'андерграунд') {
      return await this.getCategoryTracks('opium');
    }
    if (qLower === 'фонк' || qLower === 'phonk') {
      return await this.getCategoryTracks('phonk');
    }

    let searchQueries = [trimmed];

    // Smart aliases for underground & Russian cloud artists
    if (qLower === '3g0t' || qLower === '3got') {
      searchQueries.push('3g0th2002');
    }

    const allTracks = [];
    const seenIds = new Set();

    for (const q of searchQueries) {
      try {
        const cid = await this.getClientId();
        const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${cid}&limit=35`;
        const res = await this.httpGet(url, { 'User-Agent': this.desktopUserAgent }, 8000);

        if (res.status === 401) {
          // Client ID expired, refresh and retry once
          const freshCid = await this.getClientId(true);
          const retryUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${freshCid}&limit=35`;
          const retryRes = await this.httpGet(retryUrl, { 'User-Agent': this.desktopUserAgent }, 8000);
          if (retryRes.status === 200) {
            this.parseSoundCloudCollection(retryRes.body, allTracks, seenIds);
          }
        } else if (res.status === 200) {
          this.parseSoundCloudCollection(res.body, allTracks, seenIds);
        }
      } catch (err) {
        console.error(`[LaneOnlineEngine] Error searching for "${q}":`, err.message);
      }
    }

    const cleanTracks = allTracks.filter(t => this.isCleanTrack(t));

    // Sort to prioritize exact artist name matches if searching for artist, else popularity
    cleanTracks.sort((a, b) => {
      const aMatches = a.artist.toLowerCase().includes(qLower) || a.title.toLowerCase().includes(qLower);
      const bMatches = b.artist.toLowerCase().includes(qLower) || b.title.toLowerCase().includes(qLower);
      if (aMatches && !bMatches) return -1;
      if (!aMatches && bMatches) return 1;
      return (b.playbackCount || 0) - (a.playbackCount || 0);
    });

    return cleanTracks;
  }

  /**
   * Helper to parse and format collection
   */
  parseSoundCloudCollection(rawJson, trackList, seenIds) {
    try {
      const data = JSON.parse(rawJson);
      const collection = data.collection || [];

      for (let item of collection) {
        const t = item.track || item;
        if (!t || !t.id || seenIds.has(t.id)) continue;

        const durationSec = Math.round((t.duration || 180000) / 1000);
        // Exclude hour-long mixes / compilations and super short teasers
        if (durationSec > 570 || durationSec < 25) continue;

        const lowerTitle = (t.title || '').toLowerCase();
        if (/(\.mp3(\.|\b|$)|сборник|дискотека|сборка|клубные хиты|клубный микс|мегамикс|хиты 201\d|микс 201\d)/i.test(lowerTitle)) {
          continue;
        }

        seenIds.add(t.id);

        const minutes = Math.floor(durationSec / 60);
        const seconds = durationSec % 60;
        const durationFormatted = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

        // Get high resolution cover image and proxy to bypass Russian ISP TSPU blocks
        let cover = t.artwork_url || (t.user && t.user.avatar_url) || '';
        if (cover) {
          cover = cover.replace('-large.jpg', '-t500x500.jpg');
          if (cover.includes('sndcdn.com')) {
            // Use global WordPress Photon CDN to bypass TSPU/RKN block on i1.sndcdn.com in Russia
            cover = 'https://i0.wp.com/' + cover.replace(/^https?:\/\//, '');
          }
        } else {
          cover = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&q=80';
        }

        const trackId = `sc_${t.id}`;
        this.trackCache.set(trackId, t);

        trackList.push({
          id: trackId,
          title: t.title || 'Untitled Track',
          artist: (t.user && t.user.username) ? t.user.username : 'Unknown Artist',
          album: 'SoundCloud Online',
          coverUrl: cover,
          duration: durationSec,
          durationFormatted: durationFormatted,
          playbackCount: t.playback_count || 0,
          likesCount: t.likes_count || 0,
          isOnline: true,
          source: 'SoundCloud (Без VPN)',
          transcodings: t.media && t.media.transcodings ? t.media.transcodings : []
        });
      }
    } catch (e) {
      console.warn('[LaneOnlineEngine] Failed to parse collection:', e.message);
    }
  }

  /**
   * Resolve playable stream URL for a given track ID
   */
  async getTrackStreamUrl(trackId) {
    if (!trackId) return null;

    // Check memory cache
    if (this.streamCache.has(trackId)) {
      return this.streamCache.get(trackId);
    }

    // Direct HTTP passed
    if (trackId.startsWith('http')) {
      return trackId;
    }

    // Resolve SoundCloud track
    if (trackId.startsWith('sc_')) {
      const rawId = trackId.replace('sc_', '');
      let track = this.trackCache.get(trackId);
      let cid = await this.getClientId();

      // If not in cache or missing transcodings, fetch track object with retries across client IDs
      if (!track || !track.media || !track.media.transcodings || !track.media.transcodings.length) {
        for (let attempt = 0; attempt < this.clientIds.length; attempt++) {
          try {
            const trackUrl = `https://api-v2.soundcloud.com/tracks/${rawId}?client_id=${cid}`;
            const res = await this.httpGet(trackUrl, { 'User-Agent': this.desktopUserAgent }, 5000);
            if (res.status === 200) {
              track = JSON.parse(res.body);
              this.trackCache.set(trackId, track);
              break;
            } else if (res.status === 401 || res.status === 429) {
              cid = await this.getClientId(true);
            }
          } catch (e) {
            cid = await this.getClientId(true);
          }
        }
      }

      if (track && track.media && track.media.transcodings && track.media.transcodings.length) {
        // Priority: progressive MP3 first (direct playback, zero buffering latency), then aac_160k, aac_96k, abr_sq
        const priorityOrder = { 'progressive': 1, 'aac_160k': 2, 'aac_96k': 3, 'abr_sq': 4 };
        const sortedTranscodings = [...track.media.transcodings].sort((a, b) => {
          const pA = (a.format && a.format.protocol === 'progressive') ? 1 : (priorityOrder[a.preset] || 5);
          const pB = (b.format && b.format.protocol === 'progressive') ? 1 : (priorityOrder[b.preset] || 5);
          return pA - pB;
        });

        // Try each transcoding until a working audio stream is resolved
        for (const trans of sortedTranscodings) {
          if (!trans || !trans.url) continue;

          for (let retry = 0; retry < 2; retry++) {
            const sep = trans.url.includes('?') ? '&' : '?';
            const streamEndpoint = `${trans.url}${sep}client_id=${cid}${track.track_authorization ? '&track_authorization=' + track.track_authorization : ''}`;

            try {
              const streamRes = await this.httpGet(streamEndpoint, { 'User-Agent': this.desktopUserAgent }, 6000);
              if (streamRes.status === 200) {
                const parsed = JSON.parse(streamRes.body);
                if (parsed && parsed.url) {
                  const finalUrl = parsed.url;
                  this.streamCache.set(trackId, finalUrl);
                  return finalUrl;
                }
              } else if (streamRes.status === 401 || streamRes.status === 429) {
                cid = await this.getClientId(true);
                continue;
              } else {
                // Preset not available (e.g. 403 or 404), break to next transcoding
                break;
              }
            } catch (err) {
              break;
            }
          }
        }
      }

      // If specific ID transcodings failed, try fallback search by track title + artist
      if (track && track.title) {
        try {
          const query = `${track.user && track.user.username ? track.user.username : ''} ${track.title}`.trim();
          console.log('[LaneOnlineEngine] Primary track ID resolution failed, trying fallback search:', query);
          const alts = await this.searchTracks(query);
          for (const alt of (alts || []).slice(0, 3)) {
            if (alt.id !== trackId) {
              const altUrl = await this.getTrackStreamUrl(alt.id);
              if (altUrl) {
                this.streamCache.set(trackId, altUrl);
                return altUrl;
              }
            }
          }
        } catch (e) {}
      }
    }

    return null;
  }

  /**
   * Get related / similar tracks for "Моя волна" (My Wave) recommendations
   * Uses SoundCloud Related Tracks API + smart artist/genre fallback
   * @param {string} trackId - track ID (e.g. 'sc_2378091611' or raw numeric ID)
   * @param {string} [artistHint] - artist name for fallback if needed
   * @param {number} [limit=20] - number of tracks to return
   */
  async getSimilarTracks(trackId, artistHint = '', limit = 20) {
    const similarTracks = [];
    const seenIds = new Set();

    let rawId = '';
    if (trackId) {
      const match = String(trackId).match(/\d{5,}/);
      if (match) rawId = match[0];
    }
    const cid = await this.getClientId();

    if (rawId) {
      try {
        const relatedUrl = `https://api-v2.soundcloud.com/tracks/${rawId}/related?client_id=${cid}&limit=${limit}`;
        let res = await this.httpGet(relatedUrl, { 'User-Agent': this.desktopUserAgent }, 8000);

        if (res.status === 401 || res.status === 429) {
          const freshCid = await this.getClientId(true);
          const retryUrl = `https://api-v2.soundcloud.com/tracks/${rawId}/related?client_id=${freshCid}&limit=${limit}`;
          res = await this.httpGet(retryUrl, { 'User-Agent': this.desktopUserAgent }, 8000);
        }

        if (res.status === 200) {
          this.parseSoundCloudCollection(res.body, similarTracks, seenIds);
        }
      } catch (err) {
        console.warn('[LaneOnlineEngine] Error fetching related tracks:', err.message);
      }
    }

    // If related tracks returned less than 5 or no numeric ID, fallback to artist search
    if (similarTracks.length < 5 && artistHint) {
      try {
        const fallbackResults = await this.searchTracks(artistHint);
        for (const t of fallbackResults) {
          const cleanId = t.id.replace('sc_', '');
          if (!seenIds.has(cleanId) && t.id !== trackId) {
            seenIds.add(cleanId);
            similarTracks.push(t);
            if (similarTracks.length >= limit) break;
          }
        }
      } catch (e) {}
    }

    // If still empty and artist exists, try artist search
    if (similarTracks.length === 0 && artistHint) {
      try {
        return await this.searchTracks(artistHint);
      } catch (e) {}
    }

    // Default fallback only when completely no context is available
    if (similarTracks.length === 0) {
      return await this.searchTracks('rap phonk underground 2026');
    }

    return similarTracks;
  }

  /**
   * Internal HTTP GET helper
   */
  httpGet(url, customHeaders = {}, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(
        url,
        {
          timeout: timeoutMs,
          headers: {
            'User-Agent': this.desktopUserAgent,
            'Accept': 'application/json, text/plain, */*',
            ...customHeaders
          }
        },
        (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout after ${timeoutMs}ms for ${url}`));
      });
    });
  }
}

module.exports = new LaneOnlineEngine();
