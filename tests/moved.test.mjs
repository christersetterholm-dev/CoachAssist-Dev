// Flytten från den gamla adressen till app.truppio.se (server/moved.ts). Kör: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.mjs';

let s;
before(async () => { s = await startServer(); });
after(() => s?.stop());

// fetch låter inte Host-huvudet bytas, så vanlig http.request.
function get(path, host, method = 'GET') {
  const { port } = new URL(s.base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('gamla adressen visar flyttsidan för appens sidor', async () => {
  for (const p of ['/', '/?invite=abc', '/manifest.webmanifest', '/assets/index.js']) {
    const r = await get(p, 'coachassist.setterholm.se');
    assert.equal(r.status, 200, p);
    assert.match(r.body, /Truppio har flyttat/, p);
    assert.match(r.body, /https:\/\/app\.truppio\.se/, p);
    assert.equal(r.headers['cache-control'], 'no-store');
  }
  // Med port och versaler i Host
  assert.match((await get('/', 'CoachAssist.Setterholm.se:443')).body, /Truppio har flyttat/);
});

test('gamla adressen: /api, /uploads och servicearbetaren fungerar som förut', async () => {
  const health = await get('/api/health', 'coachassist.setterholm.se');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).status, 'ok');
  // Kalenderprenumerationer går genom /api och ska inte få flyttsidan (fel nyckel ger 404 som vanligt)
  const ics = await get('/api/calendar/x/y/z/events.ics', 'coachassist.setterholm.se');
  assert.equal(ics.status, 404);
  assert.doesNotMatch(ics.body, /Truppio har flyttat/);
  assert.doesNotMatch((await get('/sw.js', 'coachassist.setterholm.se')).body, /Truppio har flyttat/);
  assert.doesNotMatch((await get('/uploads/finns-inte.png', 'coachassist.setterholm.se')).body, /Truppio har flyttat/);
});

test('nya adressen får appen, inte flyttsidan', async () => {
  for (const host of ['app.truppio.se', '127.0.0.1']) {
    const r = await get('/', host);
    assert.doesNotMatch(r.body, /Truppio har flyttat/, host);
  }
});
