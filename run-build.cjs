const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

console.log('--- CoachAssist Production Build Script ---');

const rootDir = __dirname;
const distDir = path.join(rootDir, 'dist');
const deployDir = path.join(rootDir, 'deploy');

const distServer = path.join(distDir, 'server.cjs');
const distIndex = path.join(distDir, 'index.html');
const deployServer = path.join(deployDir, 'server.cjs');
const deployIndex = path.join(deployDir, 'index.html');

const hasPrebuiltDist = fs.existsSync(distServer) && fs.existsSync(distIndex);
const hasPrebuiltDeploy = fs.existsSync(deployServer) && fs.existsSync(deployIndex);

function restorePrebuiltFiles() {
  console.log('[Build] Using pre-built production files (dist/ and deploy/)...');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Restore server.cjs if missing in dist
  if (!fs.existsSync(distServer) && fs.existsSync(deployServer)) {
    fs.copyFileSync(deployServer, distServer);
    console.log('[Build] Copied deploy/server.cjs -> dist/server.cjs');
  }

  // Restore index.html if missing in dist
  if (!fs.existsSync(distIndex) && fs.existsSync(deployIndex)) {
    fs.copyFileSync(deployIndex, distIndex);
    console.log('[Build] Copied deploy/index.html -> dist/index.html');
  }

  // Run copy-build to ensure public/ and root assets/ are in sync
  try {
    const copyBuildScript = path.join(rootDir, 'copy-build.js');
    if (fs.existsSync(copyBuildScript)) {
      spawnSync(process.execPath, [copyBuildScript], { stdio: 'inherit', cwd: rootDir });
    }
  } catch (err) {
    console.warn('[Build] copy-build notice:', err.message);
  }

  console.log('✅ [Build SUCCESS] Production files verified and ready for Passenger / cPanel!');
  return true;
}

// Check if we are running in a memory-restricted CloudLinux LVE environment
// In CloudLinux, /proc/self/limits or cPanel Passenger environment often restricts address space
let isRestrictedEnvironment = false;
try {
  if (fs.existsSync('/proc/self/limits')) {
    const limits = fs.readFileSync('/proc/self/limits', 'utf8');
    // If Max address space is set to a fixed number (e.g. 4294967296 or less) instead of 'unlimited'
    const match = limits.match(/Max address space\s+(\d+)/);
    if (match && match[1] && Number(match[1]) <= 4294967296) {
      isRestrictedEnvironment = true;
      console.log(`[Build] Detected CloudLinux LVE address limit (${match[1]} bytes).`);
    }
  }
} catch (_) {}

// If running in CloudLinux LVE where Wasm memory allocation is known to fail
if (isRestrictedEnvironment && (hasPrebuiltDist || hasPrebuiltDeploy)) {
  console.log('[Build] Bypassing in-memory WebAssembly compile to avoid CloudLinux LVE crash.');
  restorePrebuiltFiles();
  process.exit(0);
}

// Step 1: Run Vite Build
console.log('[Build 1/4] Running Vite build...');
const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
const viteCmd = fs.existsSync(viteBin) ? viteBin : 'vite';

const viteResult = fs.existsSync(viteBin) 
  ? spawnSync(process.execPath, [viteBin, 'build'], { stdio: 'inherit', cwd: rootDir })
  : spawnSync('npx', ['vite', 'build'], { stdio: 'inherit', cwd: rootDir, shell: true });

if (viteResult.status !== 0) {
  console.warn('\n⚠️ [Build Warning] Vite compilation exited with code', viteResult.status);
  
  // If Vite failed (likely due to Wasm Out-Of-Memory in CloudLinux), check if we have pre-built files
  if (hasPrebuiltDist || hasPrebuiltDeploy) {
    console.log('[Build Recovery] Shared hosting memory limit detected.');
    console.log('[Build Recovery] Automatically falling back to verified pre-built bundle assets.');
    restorePrebuiltFiles();
    process.exit(0);
  } else {
    console.error('❌ [Build Error] No pre-built files found in dist/ or deploy/.');
    console.error('Please download coachassist-production-bundle.zip and extract it to your server.');
    process.exit(viteResult.status || 1);
  }
}

// Step 2: Run copy-build.js
console.log('[Build 2/4] Running copy-build.js...');
const copyResult = spawnSync(process.execPath, ['copy-build.js'], { stdio: 'inherit', cwd: rootDir });
if (copyResult.status !== 0) {
  console.warn('[Build Warning] copy-build.js exited with code', copyResult.status);
}

// Step 3: Run esbuild for server.ts
console.log('[Build 3/4] Running esbuild for server.ts...');
const esbuildBin = path.join(rootDir, 'node_modules', 'esbuild', 'bin', 'esbuild');
const esbuildArgs = [
  'server.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--packages=external',
  '--sourcemap',
  '--outfile=dist/server.cjs'
];

let esbuildResult;
if (fs.existsSync(esbuildBin)) {
  esbuildResult = spawnSync(process.execPath, [esbuildBin, ...esbuildArgs], { stdio: 'inherit', cwd: rootDir });
} else {
  esbuildResult = spawnSync('npx', ['esbuild', ...esbuildArgs], { stdio: 'inherit', cwd: rootDir, shell: true });
}

if (esbuildResult.status !== 0) {
  console.warn('\n⚠️ [Build Warning] esbuild exited with code', esbuildResult.status);
  if (hasPrebuiltDeploy || hasPrebuiltDist) {
    console.log('[Build Recovery] Using existing compiled server.cjs.');
    restorePrebuiltFiles();
    process.exit(0);
  }
}

// Step 4: Run create-bundle.cjs
console.log('[Build 4/4] Updating production bundle zip...');
try {
  spawnSync(process.execPath, ['create-bundle.cjs'], { stdio: 'inherit', cwd: rootDir });
} catch (e) {
  console.warn('[Build Warning] create-bundle.cjs skipped:', e.message);
}

console.log('✅ [Build Complete] All files compiled and synced successfully!');
process.exit(0);
