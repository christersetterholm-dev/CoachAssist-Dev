// This file acts as the entry point for cPanel Node.js Selector / Phusion Passenger.
// It is written in CommonJS format (app.cjs) to prevent Phusion Passenger's loader 
// from crashing with ERR_REQUIRE_ESM when loading an ES module.
// It imports the bundled production server from the dist folder if it exists.
// Otherwise, it starts an automatic build in the background and serves a dynamic build status page.

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const http = require('http');

const serverPath = path.join(__dirname, 'dist', 'server.cjs');

if (fs.existsSync(serverPath)) {
  console.log('Production server found. Starting Coach Assist...');
  process.env.NODE_ENV = 'production'; // Force production mode
  require('./dist/server.cjs');
} else {
  console.log('Production server bundle not found yet. Starting automatic background build and fallback server...');

  let buildStatus = 'idle'; // 'idle', 'building', 'success', 'failed'
  let buildLog = '';
  let buildError = '';

  const runBuild = () => {
    if (buildStatus === 'building') return;
    buildStatus = 'building';
    buildLog = 'Starting build process: npm run build...\n';

    // Execute the build command in the background with limited threads to prevent cPanel NPROC panics
    const buildProcess = exec('npm run build', { 
      cwd: __dirname,
      env: {
        ...process.env,
        RAYON_NUM_THREADS: '1',
        UV_THREADPOOL_SIZE: '1',
        ESBUILD_WORKERS: '1'
      }
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

  // Trigger the build immediately
  runBuild();

  const server = http.createServer((req, res) => {
    // Handle rebuilding from the button
    if (req.method === 'POST' && req.url === '/rebuild') {
      if (buildStatus !== 'building') {
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
                : '<p>Något gick fel under byggprocessen. Se felmeddelandet i loggen nedan. Du kan försöka bygga igen genom att klicka på knappen.</p><form method="POST" action="/rebuild"><button class="button" type="submit">Försök bygga igen</button></form>'
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
