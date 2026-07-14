import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.join(__dirname, 'dist');
const destDir = path.join(__dirname, 'public');

function copyRecursiveSync(src, dest) {
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
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    // Check if the source file is not server.cjs
    if (src.endsWith('server.cjs') || src.endsWith('server.cjs.map')) {
      return;
    }
    fs.copyFileSync(src, dest);
  }
}

console.log('Copying build output from dist to public for direct Apache/Passenger static hosting...');
if (fs.existsSync(srcDir)) {
  copyRecursiveSync(srcDir, destDir);
  console.log('Successfully copied all assets to public/!');
} else {
  console.error('dist/ folder not found. Make sure vite build ran successfully.');
}
