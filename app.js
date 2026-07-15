// This file acts as the entry point for cPanel Node.js Selector / Phusion Passenger
// It imports the bundled production server from the dist folder if it exists.
// Otherwise, it starts an automatic build in the background and serving a dynamic build status page.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.join(__dirname, 'dist', 'server.cjs');

if (fs.existsSync(serverPath)) {
  console.log('Production server found. Starting Coach Assist...');
  process.env.NODE_ENV = 'production'; // Force production mode
  await import('./dist/server.cjs');
} else {
  console.log('Production server bundle not found yet. Starting automatic background build and fallback server...');

  let buildStatus = 'idle'; // 'idle', 'building', 'success', 'failed'
  let buildLog = '';
  let buildError = '';

  const runBuild = () => {
    if (buildStatus === 'building') return;
    buildStatus = 'building';
    
    // Check if we need to run npm install first
    const hasVite = fs.existsSync(path.join(__dirname, 'node_modules', 'vite'));
    const needsInstall = !hasVite;
    
    buildLog = '';
    
    // Dynamically resolve the Node.js binary directory of the virtual environment
    // and prepend it to process.env.PATH so that child processes find the same node/npm/npx
    const nodeBinDir = path.dirname(process.execPath);
    const customEnv = {
      ...process.env,
      PATH: nodeBinDir + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || ''),
      RAYON_NUM_THREADS: '1',
      UV_THREADPOOL_SIZE: '1',
      ESBUILD_WORKERS: '1'
    };

    const startBuildStep = () => {
      buildLog += 'Starting build process: npm run build...\n';
      console.log('Running build command...');
      
      const buildProcess = exec('npm run build', { 
        cwd: __dirname,
        env: customEnv
      });

      buildProcess.stdout.on('data', (data) => {
        buildLog += data.toString();
        console.log(data.toString());
      });

      buildProcess.stderr.on('data', (data) => {
        buildLog += data.toString();
        console.error(data.toString());
      });

      buildProcess.on('close', (code) => {
        if (code === 0) {
          buildStatus = 'success';
          buildLog += '\nBuild completed successfully!\n';
          console.log('Build succeeded! Touching tmp/restart.txt to restart Phusion Passenger...');
          
          try {
            const tmpDir = path.join(__dirname, 'tmp');
            if (!fs.existsSync(tmpDir)) {
              fs.mkdirSync(tmpDir);
            }
            fs.writeFileSync(path.join(tmpDir, 'restart.txt'), String(Date.now()));
            buildLog += 'Restart triggered successfully.\n';
          } catch (err) {
            console.error('Failed to touch tmp/restart.txt:', err);
            buildLog += `Failed to trigger automatic restart: ${err.message}\n`;
          }
        } else {
          buildStatus = 'failed';
          buildError = `Build process exited with code ${code}`;
          buildLog += `\nBuild failed with code ${code}.\n`;
          console.error(`Build failed with code ${code}`);
        }
      });
    };

    if (needsInstall) {
      buildLog += 'node_modules or vite not found. Installing dependencies first with npm install...\n';
      console.log('Running npm install inside server container...');
      
      const installProcess = exec('npm install --no-audit --no-fund', {
        cwd: __dirname,
        env: customEnv
      });

      installProcess.stdout.on('data', (data) => {
        buildLog += data.toString();
        console.log(data.toString());
      });

      installProcess.stderr.on('data', (data) => {
        buildLog += data.toString();
        console.error(data.toString());
      });

      installProcess.on('close', (code) => {
        if (code === 0) {
          buildLog += '\nnpm install completed successfully! Now starting the build...\n';
          console.log('npm install succeeded, starting build...');
          startBuildStep();
        } else {
          buildStatus = 'failed';
          buildError = `npm install exited with code ${code}`;
          buildLog += `\nnpm install failed with code ${code}.\n`;
          console.error(`npm install failed with code ${code}`);
        }
      });
    } else {
      startBuildStep();
    }
  };

  // Trigger the build immediately
  runBuild();

  const http = await import('http');
  const server = http.createServer((req, res) => {
    // Handle rebuilding from the button
    if (req.method === 'POST' && req.url === '/rebuild') {
      if (buildStatus !== 'building') {
        runBuild();
      }
      res.writeHead(302, { 'Location': '/' });
      return res.end();
    }

    // Handle clean rebuilding (deletes node_modules first)
    if (req.method === 'POST' && req.url === '/clean-rebuild') {
      if (buildStatus !== 'building') {
        buildStatus = 'building';
        buildLog = 'Deletes node_modules to perform a clean installation...\n';
        try {
          const nmPath = path.join(__dirname, 'node_modules');
          if (fs.existsSync(nmPath)) {
            fs.rmSync(nmPath, { recursive: true, force: true });
            buildLog += 'Successfully deleted node_modules!\n';
          } else {
            buildLog += 'node_modules does not exist. Skipping deletion.\n';
          }
        } catch (err) {
          buildLog += `Warning: Failed to delete node_modules directory: ${err.message}\nTrying to run npm install anyway...\n`;
        }
        buildStatus = 'idle'; // Reset so runBuild doesn't bypass
        runBuild();
      }
      res.writeHead(302, { 'Location': '/' });
      return res.end();
    }

    // If the build succeeded, show a restart loading page
    if (buildStatus === 'success') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <!DOCTYPE html>
        <html lang="sv">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="refresh" content="3">
          <title>Coach Assist - Startar om...</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background-color: #f3f4f6;
              color: #1f2937;
            }
            .card {
              background: white;
              padding: 2.5rem;
              border-radius: 12px;
              box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
              max-width: 500px;
              width: 90%;
              text-align: center;
            }
            h1 {
              color: #10b981;
              font-size: 1.75rem;
              margin-top: 0;
            }
            .spinner {
              border: 4px solid #f3f4f6;
              border-top: 4px solid #10b981;
              border-radius: 50%;
              width: 45px;
              height: 45px;
              animation: spin 1s linear infinite;
              margin: 2rem auto;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="spinner"></div>
            <h1>Bygget lyckades! 🎉</h1>
            <p>Applikationen byggdes framgångsrikt. Servern startar nu om automatiskt med den riktiga koden...</p>
            <p style="font-size: 0.85rem; color: #6b7280;">Sidan laddas om automatiskt om några sekunder.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Default status page while building or failed
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="sv">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${buildStatus === 'building' ? '<meta http-equiv="refresh" content="5">' : ''}
        <title>Coach Assist - Bygger applikation</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #f3f4f6;
            color: #1f2937;
            margin: 0;
            padding: 2rem 1rem;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
          }
          .card {
            background: white;
            padding: 2.5rem;
            border-radius: 12px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            margin-bottom: 1.5rem;
          }
          h1 {
            font-size: 1.75rem;
            margin-top: 0;
            margin-bottom: 0.5rem;
            color: #2563eb;
          }
          .status-badge {
            display: inline-block;
            background-color: #fef3c7;
            color: #92400e;
            font-size: 0.875rem;
            font-weight: 600;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            margin-bottom: 1.5rem;
          }
          .status-badge.building {
            background-color: #dbeafe;
            color: #1e40af;
            animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          }
          .status-badge.failed {
            background-color: #fee2e2;
            color: #991b1b;
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: .5; }
          }
          .log-container {
            background-color: #1e293b;
            color: #f8fafc;
            padding: 1.25rem;
            border-radius: 8px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
            font-size: 0.85rem;
            overflow-x: auto;
            white-space: pre-wrap;
            max-height: 400px;
            border: 1px solid #334155;
          }
          .button {
            display: inline-block;
            background-color: #2563eb;
            color: white;
            padding: 0.625rem 1.25rem;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 500;
            font-size: 0.875rem;
            border: none;
            cursor: pointer;
            transition: background-color 0.2s;
          }
          .button:hover {
            background-color: #1d4ed8;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            ${
              buildStatus === 'building' 
                ? '<div class="status-badge building">Bygger applikationen...</div>' 
                : '<div class="status-badge failed">Bygget misslyckades</div>'
            }
            <h1>Coach Assist - Installation pågår</h1>
            <p>
              Eftersom du inte har tillgång till en terminal bygger vi applikationen automatiskt åt dig direkt på servern. Detta skapar de kompilerade produktionsfilerna och tar vanligtvis 15-45 sekunder.
            </p>
            ${
              buildStatus === 'building'
                ? '<p>Sidan laddas om automatiskt var 5:e sekund för att visa förloppet.</p>'
                : `
                <p>Något gick fel under byggprocessen. Om det står att "vite" eller andra kommandon inte finns beror det oftast på att en trasig eller felaktigt uppladdad <code>node_modules</code>-mapp blockerar processen. Klicka på "Gör en helt ren installation" nedan för att rensa gamla filer och installera allt på nytt.</p>
                <div style="display: flex; gap: 10px; margin-top: 1rem; flex-wrap: wrap;">
                  <form method="POST" action="/rebuild">
                    <button class="button" type="submit">Försök bygga igen</button>
                  </form>
                  <form method="POST" action="/clean-rebuild">
                    <button class="button" style="background-color: #dc2626;" type="submit">Gör en helt ren installation (rekommenderas)</button>
                  </form>
                </div>
                `
            }
          </div>

          <div class="card">
            <h2 style="margin-top: 0; font-size: 1.25rem; color: #0f172a;">Bygglogg</h2>
            <div class="log-container">${buildLog || 'Väntar på att loggen ska starta...'}</div>
            ${buildError ? `<p style="color: #ef4444; font-weight: bold; margin-top: 1rem;">Fel: ${buildError}</p>` : ''}
          </div>
        </div>
      </body>
      </html>
    `);
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Fallback server running on port ${port}`);
  });
}

