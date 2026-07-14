import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.join(__dirname, 'dist');
const destDir = path.join(__dirname, 'public');

function copyRecursiveSync(src, dest, skipIndexHtml = false) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      // Do not copy server files or source maps if we don't want to
      if (childItemName === 'server.cjs' || childItemName === 'server.cjs.map') {
        return;
      }
      if (skipIndexHtml && childItemName === 'index.html') {
        return;
      }
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName), skipIndexHtml);
    });
  } else {
    // Check if the source file is not server.cjs
    if (src.endsWith('server.cjs') || src.endsWith('server.cjs.map')) {
      return;
    }
    if (skipIndexHtml && src.endsWith('index.html')) {
      return;
    }
    fs.copyFileSync(src, dest);
  }
}

console.log('Copying build output from dist to public and root directory for direct Apache/Passenger static hosting...');
if (fs.existsSync(srcDir)) {
  // 1. Copy to public/ (keep index.html here for static preview / hosting)
  copyRecursiveSync(srcDir, destDir, false);
  console.log('Successfully copied all assets to public/!');
  
  // 2. Copy to application root (so Apache can serve assets directly from /assets, but skip index.html to avoid breaking source)
  copyRecursiveSync(srcDir, __dirname, true);
  console.log('Successfully copied all assets to application root (skipping index.html)!');
} else {
  console.error('dist/ folder not found. Make sure vite build ran successfully.');
}
