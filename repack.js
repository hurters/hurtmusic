const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const projectDir = __dirname;
const asarCli = path.join(projectDir, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
const resourcesDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'hurtmusic', 'resources');
const appAsarOld = path.join(resourcesDir, 'app.asar.old');
const appAsarDest = path.join(resourcesDir, 'app.asar');
const tempExtract = path.join(process.env.TEMP, 'hurtmusic_asar_build');
const tempPack = path.join(process.env.TEMP, 'app_packaged.asar');

console.log('--- HurtMusic ASAR Repacker ---');
console.log('Project dir:', projectDir);
console.log('Resources dir:', resourcesDir);

if (!fs.existsSync(appAsarOld)) {
  console.error('Error: app.asar.old does not exist in', resourcesDir);
  process.exit(1);
}

// 1. Clean previous temp dir
if (fs.existsSync(tempExtract)) {
  console.log('Cleaning temp build folder...');
  fs.rmSync(tempExtract, { recursive: true, force: true });
}

// 2. Extract app.asar.old
console.log('Extracting app.asar.old...');
execFileSync(process.execPath, [asarCli, 'extract', appAsarOld, tempExtract], { stdio: 'inherit' });

// 3. Copy our updated files
const filesToCopy = [
  'audio-visualizer.js',
  'discord-rpc-manager.js',
  'download-manager.js',
  'hls.min.js',
  'index.html',
  'lane-online-engine.js',
  'logo-cloud.png',
  'logo-full.png',
  'main.js',
  'ota-updater.js',
  'package.json',
  'path-security.js',
  'preload.js',
  'renderer.js',
  'tray-icon.png'
];

// Remove legacy lyrics-engine from tempExtract if present
const legacyLyrics = path.join(tempExtract, 'lyrics-engine.js');
if (fs.existsSync(legacyLyrics)) {
  fs.unlinkSync(legacyLyrics);
}

for (const file of filesToCopy) {
  const src = path.join(projectDir, file);
  const dest = path.join(tempExtract, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied: ${file}`);
  } else {
    console.warn(`Warning: source file not found: ${file}`);
  }
}

// 4. Pack into temp asar
if (fs.existsSync(tempPack)) {
  fs.rmSync(tempPack, { force: true });
}
console.log('Packing asar...');
execFileSync(process.execPath, [asarCli, 'pack', tempExtract, tempPack], { stdio: 'inherit' });

// 5. Replace installed app.asar
console.log('Replacing installed app.asar...');
fs.copyFileSync(tempPack, appAsarDest);

console.log('SUCCESS: hurtmusic app.asar successfully updated with all killer features!');
