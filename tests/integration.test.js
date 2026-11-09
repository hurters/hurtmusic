const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { sanitizeOpenPath, parseHttpRange } = require('../path-security');

describe('PathSecurity & Hardening Tests', () => {
  const allowedRoots = [
    path.resolve('C:/Users/User/Music'),
    path.resolve('C:/Users/User/Downloads')
  ];

  it('должен блокировать UNC-пути Windows для защиты от утечки NTLM', () => {
    assert.throws(
      () => sanitizeOpenPath('\\\\attacker-ip\\share\\track.mp3', allowedRoots),
      /UNC network paths are prohibited/
    );
    assert.throws(
      () => sanitizeOpenPath('//attacker-domain/payload', allowedRoots),
      /UNC network paths are prohibited/
    );
  });

  it('должен блокировать попытку выхода за пределы директории (Path Traversal)', () => {
    const traversalPath = path.resolve('C:/Users/User/Music/../../Windows/System32/cmd.exe');
    assert.throws(
      () => sanitizeOpenPath(traversalPath, allowedRoots),
      /Security Violation/
    );
  });

  it('должен блокировать исполняемые файлы', () => {
    const exePath = path.join(allowedRoots[0], 'script.bat');
    assert.throws(
      () => sanitizeOpenPath(exePath, allowedRoots),
      /Execution of executable extensions is blocked/
    );
  });

  it('должен пропускать безопасные валидные пути к аудиофайлам', () => {
    const validTrack = path.join(allowedRoots[0], 'Albums', 'song.flac');
    const result = sanitizeOpenPath(validTrack, allowedRoots);
    assert.strictEqual(result, validTrack);
  });
});

describe('HTTP Range RFC 7233 Parser Tests', () => {
  const fileSize = 1048576; // 1 MB

  it('корректно парсит диапазон "bytes=0-1023"', () => {
    const range = parseHttpRange('bytes=0-1023', fileSize);
    assert.deepStrictEqual(range, { start: 0, end: 1023, chunkLength: 1024 });
  });

  it('корректно парсит открытый диапазон "bytes=1000-"', () => {
    const range = parseHttpRange('bytes=1000-', fileSize);
    assert.deepStrictEqual(range, { start: 1000, end: fileSize - 1, chunkLength: fileSize - 1000 });
  });

  it('корректно парсит суффиксный диапазон "bytes=-500"', () => {
    const range = parseHttpRange('bytes=-500', fileSize);
    assert.deepStrictEqual(range, { start: fileSize - 500, end: fileSize - 1, chunkLength: 500 });
  });

  it('возвращает null при некорректных диапазонах', () => {
    assert.strictEqual(parseHttpRange('bytes=500-100', fileSize), null);
    assert.strictEqual(parseHttpRange('bytes=invalid', fileSize), null);
    assert.strictEqual(parseHttpRange('bytes=99999999-', fileSize), null);
  });
});

const { OtaUpdater, compareSemver, getGitHubToken } = require('../ota-updater');

describe('Over-The-Air (OTA) Updater Tests', () => {
  it('корректно сравнивает семантические версии (Semver)', () => {
    assert.strictEqual(compareSemver('1.0.1', '1.0.0'), 1);
    assert.strictEqual(compareSemver('1.0.0', '1.0.1'), -1);
    assert.strictEqual(compareSemver('1.0.0', '1.0.0'), 0);
    assert.strictEqual(compareSemver('v2.0.0', '1.9.9'), 1);
    assert.strictEqual(compareSemver('1.2.0', 'v1.2.0'), 0);
    assert.strictEqual(compareSemver('0.9.15', '0.10.0'), -1);
  });

  it('считывает текущую версию приложения из package.json', () => {
    const updater = new OtaUpdater();
    const pkgVersion = require('../package.json').version;
    assert.strictEqual(updater.currentVersion, pkgVersion);
  });

  it('корректно определяет наличие ожидающего обновления', () => {
    const updater = new OtaUpdater();
    assert.strictEqual(typeof updater.hasPendingUpdate(), 'boolean');
  });

  it('безопасно извлекает GitHub токен из окружения или mcp_config', () => {
    const token = getGitHubToken();
    assert.ok(token === null || typeof token === 'string');
  });
});
