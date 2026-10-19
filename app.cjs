// Startfil för cPanel / Phusion Passenger (anges som "Application startup file").
// Startar den byggda servern i dist/server.cjs. Om starten misslyckas visas en
// enkel felsida så att felet syns i webbläsaren och i server-crash.log.
const fs = require('fs');
const path = require('path');
const http = require('http');

process.env.NODE_ENV = 'production';

try {
  require('./dist/server.cjs');
} catch (err) {
  const message = String((err && err.stack) || err);
  console.error('Truppio kunde inte starta:', message);
  try {
    fs.writeFileSync(path.join(__dirname, 'server-crash.log'), new Date().toISOString() + '\n' + message);
  } catch (_) {}

  const escape = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  http.createServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Truppio kunde inte starta</title>
<body style="font-family:system-ui;max-width:760px;margin:40px auto;padding:0 16px">
<h1>Truppio kunde inte starta</h1>
<p>Kontrollera att <code>dist/</code> är uppladdad och att "Run NPM Install" har körts i cPanel.</p>
<pre style="white-space:pre-wrap;background:#f4f4f5;padding:12px;border-radius:8px">${escape(message)}</pre>
</body>`);
  }).listen(process.env.PORT || 3000);
}
