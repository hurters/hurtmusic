const path = require('path');

/**
 * Черный список опасных расширений, запрещенных к открытию
 */
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.msi', '.com', '.scr', '.hta'
]);

/**
 * Валидация и нормализация системных путей.
 * Защищает от UNC-атак (утечка NetNTLM) и Path Traversal.
 */
function sanitizeOpenPath(inputPath, allowedRoots = []) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Invalid path argument: Expected non-empty string');
  }

  const trimmed = inputPath.trim();

  // 1. Блокировка UNC-путей (\\server\share или //server/share)
  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    throw new Error('Security Violation: UNC network paths are prohibited to prevent NTLM hash theft.');
  }

  // 2. Нормализация к абсолютному каноническому пути
  const normalized = path.resolve(trimmed);

  // 3. Запрет исполняемых файлов
  const ext = path.extname(normalized).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`Security Violation: Execution of executable extensions is blocked (${ext}).`);
  }

  // 4. Проверка нахождения в разрешенных корнях (если переданы)
  if (allowedRoots && allowedRoots.length > 0) {
    const isAllowed = allowedRoots.some(root => {
      const canonicalRoot = path.resolve(root);
      return normalized === canonicalRoot || normalized.startsWith(canonicalRoot + path.sep);
    });

    if (!isAllowed) {
      throw new Error(`Security Violation: Path traversal denied. Target "${normalized}" is outside allowed roots.`);
    }
  }

  return normalized;
}

/**
 * RFC 7233 Безопасный парсер HTTP заголовка Range
 */
function parseHttpRange(rangeHeader, fileSize) {
  if (!rangeHeader || typeof rangeHeader !== 'string' || !rangeHeader.startsWith('bytes=')) {
    return null;
  }

  const parts = rangeHeader.replace('bytes=', '').split('-');
  if (parts.length !== 2) return null;

  const rawStart = parts[0].trim();
  const rawEnd = parts[1].trim();

  let start;
  let end;

  if (rawStart === '' && rawEnd !== '') {
    const suffixLength = parseInt(rawEnd, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else if (rawStart !== '' && rawEnd === '') {
    start = parseInt(rawStart, 10);
    if (isNaN(start) || start < 0 || start >= fileSize) return null;
    end = fileSize - 1;
  } else if (rawStart !== '' && rawEnd !== '') {
    start = parseInt(rawStart, 10);
    end = parseInt(rawEnd, 10);
    if (isNaN(start) || isNaN(end) || start < 0 || start > end || start >= fileSize) {
      return null;
    }
    end = Math.min(end, fileSize - 1);
  } else {
    return null;
  }

  return {
    start,
    end,
    chunkLength: end - start + 1
  };
}

module.exports = {
  sanitizeOpenPath,
  parseHttpRange,
  BLOCKED_EXTENSIONS
};
