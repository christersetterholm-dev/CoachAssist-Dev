import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.join(__dirname, 'dist');

function copyRecursiveSync(src, dest, skipIndexHtml = false) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      // Do not copy server files, zips, or source maps
      if (childItemName === 'server.cjs' || childItemName === 'server.cjs.map' || childItemName.endsWith('.zip')) {
        return;
      }
      if (skipIndexHtml && childItemName === 'index.html') {
        return;
      }
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName), skipIndexHtml);
    });
  } else {
    if (src.endsWith('server.cjs') || src.endsWith('server.cjs.map') || src.endsWith('.zip')) {
      return;
    }
    if (skipIndexHtml && src.endsWith('index.html')) {
      return;
    }
    fs.copyFileSync(src, dest);
  }
}

console.log('Synchronizing build output...');
if (fs.existsSync(srcDir)) {
  // 1. Synchronize root assets/ folder cleanly (for Apache/Passenger direct serving if used)
  const rootAssetsDir = path.join(__dirname, 'assets');
  const distAssetsDir = path.join(srcDir, 'assets');
  if (fs.existsSync(distAssetsDir)) {
    if (fs.existsSync(rootAssetsDir)) {
      fs.rmSync(rootAssetsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(rootAssetsDir, { recursive: true });
    copyRecursiveSync(distAssetsDir, rootAssetsDir, false);
    console.log('Successfully synchronized assets/ for static servers!');
  }

  // 2. Copy server.cjs and index.html to deploy/ folder
  const deployDir = path.join(__dirname, 'deploy');
  if (!fs.existsSync(deployDir)) {
    fs.mkdirSync(deployDir, { recursive: true });
  }
  const distServer = path.join(srcDir, 'server.cjs');
  if (fs.existsSync(distServer)) {
    fs.copyFileSync(distServer, path.join(deployDir, 'server.cjs'));
  }
  const distIndex = path.join(srcDir, 'index.html');
  if (fs.existsSync(distIndex)) {
    fs.copyFileSync(distIndex, path.join(deployDir, 'index.html'));
  }
  console.log('Successfully synchronized deploy/ folder!');
} else {
  console.error('dist/ folder not found. Make sure vite build ran successfully.');
}

