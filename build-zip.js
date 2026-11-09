const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const pkg = require('./package.json');

const version = pkg.version || '1.1.0';
const srcDir = path.join(__dirname, 'dist', 'win-unpacked');
const zipFile = path.join(__dirname, 'dist', `hurtmusic-v${version}-win-x64.zip`);
const legacyZipFile = path.join(__dirname, 'dist', 'hurtmusic-v1.0.1-win-x64.zip');
const tempZip = path.join(__dirname, 'dist', 'hurtmusic-temp.zip');

console.log(`--- Packing HurtMusic Win-x64 Zip Archive v${version} ---`);
console.log('Source:', srcDir);
console.log('Destination:', zipFile);

const output = fs.createWriteStream(tempZip);
const archive = archiver('zip', {
  zlib: { level: 6 }
});

output.on('close', () => {
  console.log('Archive successfully finalized:', (archive.pointer() / (1024 * 1024)).toFixed(2), 'MB');
  if (fs.existsSync(zipFile)) {
    try { fs.unlinkSync(zipFile); } catch (e) {}
  }
  fs.renameSync(tempZip, zipFile);
  try {
    fs.copyFileSync(zipFile, legacyZipFile);
  } catch (e) {}
  console.log(`SUCCESS: hurtmusic-v${version}-win-x64.zip ready with clean root paths!`);
});

archive.on('error', (err) => {
  console.error('Packaging error:', err);
  process.exit(1);
});

archive.pipe(output);
archive.directory(srcDir, false);
archive.finalize();
