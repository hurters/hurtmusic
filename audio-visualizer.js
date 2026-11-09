/**
 * Real-Time Reactive Audio Spectrum Visualizer & Spectral Harmonics Engine
 * Provides 60 FPS studio-grade frequency visualization & spectral resonance curves
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AudioVisualizer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class Visualizer {
    constructor() {
      this.audioContext = null;
      this.analyser = null;
      this.sourceNode = null;
      this.connectedElement = null;
      this.dataArray = null;
      this.isRunning = false;
      this.animationFrameId = null;
      this.canvas = null;
      this.ctx = null;
      this.spectralCanvas = null;
      this.spectralCtx = null;
      this.barsCount = 28;
      this.smoothData = [];
      this.spectralTime = 0;
    }

    /**
     * Инициализация и подключение к элементу HTMLAudioElement
     */
    connect(audioElement) {
      if (this.connectedElement === audioElement && this.audioContext) {
        return;
      }

      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;

        if (!this.audioContext) {
          this.audioContext = new AudioCtx();
        }

        if (this.audioContext.state === 'suspended') {
          const resumeHandler = () => {
            this.audioContext.resume();
            window.removeEventListener('click', resumeHandler);
          };
          window.addEventListener('click', resumeHandler);
        }

        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.82;

        const bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(bufferLength);
        this.smoothData = new Array(this.barsCount).fill(2);

        this.sourceNode = this.audioContext.createMediaElementSource(audioElement);
        this.sourceNode.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);

        this.connectedElement = audioElement;
      } catch (e) {
        console.warn('[AudioVisualizer] Connection notice:', e.message);
      }
    }

    /**
     * Real-time audio frequency metrics for living canvas/WebGL animations
     */
    getAudioMetrics() {
      if (!this.analyser || !this.dataArray) {
        return { bass: 0, mid: 0, treble: 0, overall: 0 };
      }
      try {
        this.analyser.getByteFrequencyData(this.dataArray);
      } catch (e) {
        return { bass: 0, mid: 0, treble: 0, overall: 0 };
      }

      const len = this.dataArray.length;
      let bassSum = 0, bassCount = 0;
      let midSum = 0, midCount = 0;
      let trebleSum = 0, trebleCount = 0;

      for (let i = 0; i < len; i++) {
        const val = this.dataArray[i];
        if (i < 8) {
          bassSum += val;
          bassCount++;
        } else if (i < 28) {
          midSum += val;
          midCount++;
        } else {
          trebleSum += val;
          trebleCount++;
        }
      }

      return {
        bass: (bassSum / (bassCount || 1)) / 255,
        mid: (midSum / (midCount || 1)) / 255,
        treble: (trebleSum / (trebleCount || 1)) / 255,
        overall: ((bassSum + midSum + trebleSum) / (len || 1)) / 255
      };
    }

    attachCanvas(canvas) {
      this.canvas = canvas;
      if (canvas) {
        this.ctx = canvas.getContext('2d');
        this.resize();
      }
    }

    attachSpectralCanvas(canvas) {
      this.spectralCanvas = canvas;
      if (canvas) {
        this.spectralCtx = canvas.getContext('2d');
        this.resizeSpectral();
      }
    }

    resize() {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = (rect.width || 180) * dpr;
      this.canvas.height = (rect.height || 36) * dpr;
      if (this.ctx) {
        this.ctx.scale(dpr, dpr);
      }
    }

    resizeSpectral() {
      if (!this.spectralCanvas) return;
      const rect = this.spectralCanvas.getBoundingClientRect();
      const parent = this.spectralCanvas.parentElement;
      const w = (rect.width > 0 ? rect.width : (parent ? parent.clientWidth : 720)) || 720;
      const h = (rect.height > 0 ? rect.height : (parent ? parent.clientHeight : 220)) || 220;
      const dpr = window.devicePixelRatio || 1;
      this.spectralCanvas.width = w * dpr;
      this.spectralCanvas.height = h * dpr;
      if (this.spectralCtx) {
        this.spectralCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.spectralCtx.scale(dpr, dpr);
      }
    }

    start() {
      if (this.isRunning) return;
      this.isRunning = true;
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      this.loop();
    }

    stop() {
      this.isRunning = false;
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      this.renderIdle();
    }

    renderIdle() {
      if (this.canvas && this.ctx) {
        const rect = this.canvas.getBoundingClientRect();
        const width = rect.width || 180;
        const height = rect.height || 36;
        this.ctx.clearRect(0, 0, width, height);

        const barWidth = Math.max(2, (width / this.barsCount) - 2);
        this.ctx.fillStyle = 'rgba(237, 237, 237, 0.12)';

        for (let i = 0; i < this.barsCount; i++) {
          const x = i * (barWidth + 2);
          const barH = 2.5;
          const y = height - barH;
          this.ctx.beginPath();
          this.ctx.roundRect ? this.ctx.roundRect(x, y, barWidth, barH, 1.5) : this.ctx.rect(x, y, barWidth, barH);
          this.ctx.fill();
        }
      }

      this.renderSpectral(null, false);
    }

    renderSpectral(rawFrequencies, isPlaying) {
      if (!this.spectralCanvas || !this.spectralCtx) return;
      const rect = this.spectralCanvas.getBoundingClientRect();
      const parent = this.spectralCanvas.parentElement;
      const width = (rect.width > 0 ? rect.width : (parent ? parent.clientWidth : 720)) || 720;
      const height = (rect.height > 0 ? rect.height : (parent ? parent.clientHeight : 220)) || 220;

      this.spectralCtx.clearRect(0, 0, width, height);

      // Signature spectral resonance palette matching Frame 4
      const colors = [
        '#f59e0b', // Amber / Gold
        '#10b981', // Emerald Green
        '#06b6d4', // Cyan
        '#3b82f6', // Studio Electric Blue
        '#8b5cf6', // Violet
        '#ec4899'  // Pink / Magenta
      ];

      const centerY = height * 0.58;
      const cx = width / 2;
      const spread = width * 0.45;

      // Subtle hairline baseline axis
      this.spectralCtx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      this.spectralCtx.lineWidth = 1;
      this.spectralCtx.beginPath();
      this.spectralCtx.moveTo(width * 0.04, centerY);
      this.spectralCtx.lineTo(width * 0.96, centerY);
      this.spectralCtx.stroke();

      this.spectralTime += 0.016;

      for (let k = 0; k < colors.length; k++) {
        const color = colors[k];
        const binIndex = k * 3 + 2;
        const freqVal = (rawFrequencies && isPlaying) ? (rawFrequencies[binIndex] || 0) : 0;
        const dynamicBoost = isPlaying ? (freqVal / 255) * 44 : 0;
        const baseHeight = (height * 0.44) * ((colors.length - k * 0.55) / colors.length);
        const breath = Math.sin(this.spectralTime * 1.8 + k * 0.65) * (isPlaying ? 4 : 2);
        const amp = Math.max(4, baseHeight + dynamicBoost + breath);

        this.spectralCtx.strokeStyle = color;
        this.spectralCtx.lineWidth = 1.8;
        this.spectralCtx.beginPath();

        const startX = cx - spread;
        const endX = cx + spread;
        this.spectralCtx.moveTo(startX, centerY);

        const cp1x = cx - spread * 0.45;
        const cp1y = centerY - amp;
        const cp2x = cx + spread * 0.45;
        const cp2y = centerY - amp;

        this.spectralCtx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, centerY);
        this.spectralCtx.stroke();

        // Inverted harmonic reflection for violet/magenta lines (Frame 4 signature)
        if (k >= 4) {
          const invAmp = amp * 0.45;
          this.spectralCtx.save();
          this.spectralCtx.globalAlpha = 0.55;
          this.spectralCtx.beginPath();
          this.spectralCtx.moveTo(startX, centerY);
          this.spectralCtx.bezierCurveTo(cx - spread * 0.4, centerY + invAmp, cx + spread * 0.4, centerY + invAmp, endX, centerY);
          this.spectralCtx.stroke();
          this.spectralCtx.restore();
        }
      }
    }

    loop() {
      if (!this.isRunning) return;

      this.animationFrameId = requestAnimationFrame(() => this.loop());

      let rawFrequencies = [];
      if (this.analyser && this.dataArray) {
        this.analyser.getByteFrequencyData(this.dataArray);
        rawFrequencies = this.dataArray;
      }

      // 1. Render bottom bar mini visualizer
      if (this.canvas && this.ctx) {
        const rect = this.canvas.getBoundingClientRect();
        const width = rect.width || 180;
        const height = rect.height || 36;

        this.ctx.clearRect(0, 0, width, height);

        const barWidth = Math.max(2, (width / this.barsCount) - 2.5);
        this.ctx.fillStyle = 'rgba(237, 237, 237, 0.65)';

        for (let i = 0; i < this.barsCount; i++) {
          const binIndex = Math.min(rawFrequencies.length - 1, Math.floor((i / this.barsCount) * (rawFrequencies.length * 0.75)));
          const val = rawFrequencies[binIndex] || 0;
          const targetHeight = Math.max(2.5, (val / 255) * (height - 4));

          this.smoothData[i] = (this.smoothData[i] || 2.5) * 0.78 + targetHeight * 0.22;

          const x = i * (barWidth + 2.5);
          const barH = this.smoothData[i];
          const y = height - barH;

          this.ctx.beginPath();
          if (typeof this.ctx.roundRect === 'function') {
            this.ctx.roundRect(x, y, barWidth, barH, [1.5, 1.5, 0, 0]);
          } else {
            this.ctx.rect(x, y, barWidth, barH);
          }
          this.ctx.fill();
        }
      }

      // 2. Render signature spectral resonance harmonics
      this.renderSpectral(rawFrequencies, true);
    }
  }

  return {
    Visualizer
  };
});
