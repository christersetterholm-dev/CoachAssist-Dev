// Startar CoachAssist-servern mot en tom, tillfällig databas och ger hjälpfunktioner för API-anrop.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Hur TypeScript körs. Standard: tsx. Kan bytas via TEST_TS_RUNNER (mellanslagsseparerade node-flaggor).
const runnerArgs = (process.env.TEST_TS_RUNNER || '--import tsx').split(' ').filter(Boolean);

export const ROOT_EMAIL = 'root@test.se';
export const ROOT_PASSWORD = 'RootLosen123';

let ipCounter = 1;
const nextIp = () => `10.99.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

export async function startServer({ seedJson, env: extraEnv = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coachassist-test-'));
  if (seedJson) fs.writeFileSync(path.join(dataDir, 'coachassist_db.json'), JSON.stringify(seedJson));
  const port = 4100 + Math.floor(Math.random() * 800);
  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    PORT: String(port),
    NODE_ENV: 'production',
    JWT_SECRET: 'test-' + Math.random().toString(36).slice(2),
    ADMIN_EMAILS: ROOT_EMAIL,
    NODE_NO_WARNINGS: '1',
    ...extraEnv,
  };
  const proc = spawn(process.execPath, [...runnerArgs, path.join(root, 'server.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (b) => { log += b; });
  proc.stderr.on('data', (b) => { log += b; });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  for (;;) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch {}
    if (proc.exitCode !== null || Date.now() > deadline) throw new Error('Servern startade inte:\n' + log);
    await new Promise((r) => setTimeout(r, 250));
  }

  // Skapa root-admin direkt i databasen (samma väg som scripts/set-password.ts)
  const res = spawnSync(process.execPath, [...runnerArgs, path.join(root, 'scripts/set-password.ts'), ROOT_EMAIL], {
    cwd: root, env: { ...env, NEW_PASSWORD: ROOT_PASSWORD }, encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error('set-password misslyckades: ' + res.stdout + res.stderr);

  const api = async (method, url, { token, body, headers = {} } = {}) => {
    const h = { 'X-Forwarded-For': nextIp(), ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(base + url, { method, headers: h, body: payload });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  };

  const register = async (email, password = 'Losenord123', username) => {
    const r = await api('POST', '/api/auth/register', { body: { email, password, username } });
    if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${r.text}`);
    return r.json.token;
  };
  const login = async (email, password) => {
    const r = await api('POST', '/api/auth/login', { body: { email, password } });
    if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${r.text}`);
    return r.json.token;
  };

  const stop = () => { proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); };
  return { base, api, register, login, stop, log: () => log, dataDir };
}
