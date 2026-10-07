const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

async function createProductionBundle() {
  const zip = new JSZip();

  function addFolderToZip(folderPath, zipFolder) {
    if (!fs.existsSync(folderPath)) return;
    const items = fs.readdirSync(folderPath);
    for (const item of items) {
      if (item.endsWith('.zip') || item.endsWith('.tar.gz') || item.startsWith('.') || item === 'node_modules') continue;
      const fullPath = path.join(folderPath, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const subZip = zipFolder.folder(item);
        addFolderToZip(fullPath, subZip);
      } else {
        const fileData = fs.readFileSync(fullPath);
        zipFolder.file(item, fileData);
      }
    }
  }

  console.log('Adding dist/ folder to bundle...');
  addFolderToZip(path.join(__dirname, 'dist'), zip.folder('dist'));

  console.log('Adding public/ folder to bundle...');
  addFolderToZip(path.join(__dirname, 'public'), zip.folder('public'));

  console.log('Adding uploads/ folder to bundle...');
  zip.folder('uploads').file('.gitkeep', '');

  console.log('Adding src/ source code folder to bundle...');
  addFolderToZip(path.join(__dirname, 'src'), zip.folder('src'));

  console.log('Adding deploy/ folder to bundle...');
  addFolderToZip(path.join(__dirname, 'deploy'), zip.folder('deploy'));

  console.log('Adding app.cjs, run-build.cjs, copy-build.js, package.json, and .htaccess to bundle...');
  if (fs.existsSync(path.join(__dirname, 'app.cjs'))) {
    zip.file('app.cjs', fs.readFileSync(path.join(__dirname, 'app.cjs')));
  }
  if (fs.existsSync(path.join(__dirname, 'run-build.cjs'))) {
    zip.file('run-build.cjs', fs.readFileSync(path.join(__dirname, 'run-build.cjs')));
  }
  if (fs.existsSync(path.join(__dirname, 'copy-build.js'))) {
    zip.file('copy-build.js', fs.readFileSync(path.join(__dirname, 'copy-build.js')));
  }
  if (fs.existsSync(path.join(__dirname, 'package.json'))) {
    zip.file('package.json', fs.readFileSync(path.join(__dirname, 'package.json')));
  }
  if (fs.existsSync(path.join(__dirname, '.htaccess'))) {
    const htaccessContent = fs.readFileSync(path.join(__dirname, '.htaccess'));
    zip.file('.htaccess', htaccessContent);
    zip.file('htaccess.txt', htaccessContent);
    zip.file('htaccess-cpanel.txt', htaccessContent);
  }

  console.log('Generating ZIP buffer...');
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  const outRoot = path.join(__dirname, 'coachassist-production-bundle.zip');
  const outDist = path.join(__dirname, 'dist', 'coachassist-production-bundle.zip');
  const outPublic = path.join(__dirname, 'public', 'coachassist-production-bundle.zip');
  fs.writeFileSync(outRoot, buffer);
  fs.writeFileSync(outDist, buffer);
  fs.writeFileSync(outPublic, buffer);
  console.log(`Created bundle at: ${outRoot} (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`);
}

createProductionBundle().catch(err => {
  console.error('Error creating bundle:', err);
  process.exit(1);
});
