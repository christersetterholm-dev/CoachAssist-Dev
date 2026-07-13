// This file acts as the entry point for cPanel Node.js Selector / Phusion Passenger
// It imports the bundled production server from the dist folder if it exists.
// Otherwise, it starts a fallback server to prevent 500 errors during installation checks.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.join(__dirname, 'dist', 'server.cjs');

if (fs.existsSync(serverPath)) {
  console.log('Production server found. Starting Coach Assist...');
  await import('./dist/server.cjs');
} else {
  console.log('Production server bundle not found yet. Starting fallback server for cPanel verification...');
  
  const http = await import('http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="sv">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Coach Assist - Applikationen förbereds</title>
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
            max-width: 550px;
            width: 90%;
            text-align: center;
          }
          h1 {
            font-size: 1.75rem;
            margin-top: 0;
            margin-bottom: 1rem;
            color: #2563eb;
            font-weight: 700;
          }
          p {
            font-size: 1rem;
            line-height: 1.6;
            color: #4b5563;
            margin-bottom: 1.5rem;
          }
          .step-box {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 1rem;
            text-align: left;
            margin-bottom: 1.5rem;
          }
          .step-title {
            font-weight: bold;
            color: #0f172a;
            margin-bottom: 0.5rem;
          }
          code {
            background: #e2e8f0;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 0.9em;
          }
          .status-badge {
            display: inline-block;
            background-color: #dbeafe;
            color: #1e40af;
            font-size: 0.875rem;
            font-weight: 600;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            margin-bottom: 1.5rem;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="status-badge">Beroenden installerade framgångsrikt!</div>
          <h1>Coach Assist är nästan klar</h1>
          <p>
            Dina Node.js-moduler har installerats, men appen har ännu inte byggts för produktion. Det är därför du ser denna tillfälliga sida.
          </p>
          
          <div class="step-box">
            <div class="step-title">Gör detta härnäst:</div>
            <p style="margin: 0; font-size: 0.95rem;">
              Kör kommandot <code>npm run build</code> (antingen via cPanel Terminalen, SSH, eller ett tilldelat byggsteg). Detta skapar den optimerade produktionsservern i <code>dist/server.cjs</code>.
            </p>
          </div>
          
          <p style="font-size: 0.875rem; color: #9ca3af; margin: 0;">
            Efter att bygget har slutförts, klicka på <strong>"Restart"</strong> i cPanel Node.js Selector för att starta den riktiga applikationen.
          </p>
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

