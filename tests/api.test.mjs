// API-tester för behörigheter och datalagring. Kör: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, ROOT_EMAIL, ROOT_PASSWORD } from './helpers.mjs';

let s;
let rootToken, coachToken, playerToken, otherToken;
let coachId, playerId;

const idOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).id;

before(async () => {
  s = await startServer();
  rootToken = await s.login(ROOT_EMAIL, ROOT_PASSWORD);
  coachToken = await s.register('coach@test.se');
  playerToken = await s.register('player@test.se');
  otherToken = await s.register('other@test.se');
  coachId = idOf(coachToken);
  playerId = idOf(playerToken);
});
after(() => s?.stop());

test('servern svarar på hälsokontroll', async () => {
  const r = await s.api('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'ok');
});

test('inloggning och /api/auth/me', async () => {
  const r = await s.api('GET', '/api/auth/me', { token: coachToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.email, 'coach@test.se');
  const bad = await s.api('POST', '/api/auth/login', { body: { email: 'coach@test.se', password: 'fel-losenord' } });
  assert.equal(bad.status, 400);
});

test('reserverade admin-adresser kan inte registreras', async () => {
  const r = await s.api('POST', '/api/auth/register', { body: { email: ROOT_EMAIL.toUpperCase(), password: 'Losenord123' } });
  assert.equal(r.status, 400);
});

test('systemfunktioner kräver root-admin', async () => {
  for (const [method, url] of [['GET', '/api/system/db-export'], ['GET', '/api/system/db-config'], ['POST', '/api/system/db-import'], ['POST', '/api/pwa-icons']]) {
    const body = method === 'GET' ? undefined : {};
    assert.equal((await s.api(method, url, { body })).status, 401, `${url} utan inloggning`);
    assert.equal((await s.api(method, url, { token: coachToken, body })).status, 403, `${url} som vanlig användare`);
  }
  const r = await s.api('GET', '/api/system/db-export', { token: rootToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.tables.users));
});

test('egna användardokument kan sparas och läsas, men inte andras', async () => {
  const path = `users/${coachId}/data/settings`;
  const w = await s.api('POST', `/api/docs?path=${path}`, { token: coachToken, body: { data: { theme: 'dark' } } });
  assert.equal(w.status, 200);
  const r = await s.api('GET', `/api/docs?path=${path}`, { token: coachToken });
  assert.deepEqual(r.json, { theme: 'dark' });
  assert.equal((await s.api('GET', `/api/docs?path=${path}`, { token: otherToken })).status, 403);
  assert.equal((await s.api('POST', `/api/docs?path=${path}`, { token: otherToken, body: { data: {} } })).status, 403);
});

test('systemdokument kan inte skrivas eller raderas av obehöriga', async () => {
  const body = { data: 'angripare' };
  assert.equal((await s.api('POST', '/api/docs?path=system/jwt_secret', { body })).status, 401);
  assert.equal((await s.api('POST', '/api/docs?path=system/jwt_secret', { token: coachToken, body })).status, 403);
  assert.equal((await s.api('DELETE', '/api/docs?path=admins/root_admins_list')).status, 401);
  assert.equal((await s.api('DELETE', '/api/docs?path=admins/root_admins_list', { token: coachToken })).status, 403);
  assert.equal((await s.api('POST', '/api/docs?path=admins/root_admins_list', { token: coachToken, body: { data: { admins: [{ email: 'coach@test.se' }] } } })).status, 403);
});

test('klubbdata kan sparas och läsas', async () => {
  const path = 'clubs/klubb1/teams/lag1/data/squad';
  const squad = { squad: [{ id: 'p1', name: 'Kalle' }] };
  assert.equal((await s.api('POST', `/api/docs?path=${path}`, { token: coachToken, body: { data: squad } })).status, 200);
  const r = await s.api('GET', `/api/docs?path=${path}`, { token: coachToken });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, squad);
  assert.equal((await s.api('GET', `/api/docs?path=${path}`)).status, 401);
});

test('kontohantering: tränare ser bara egna klubbens medlemmar', async () => {
  const members = [
    { userId: coachId, email: 'coach@test.se', fullName: 'Tränare', roles: ['coach'], teams: ['lag1'] },
    { userId: playerId, email: 'player@test.se', fullName: 'Spelare', roles: ['player'], teams: ['lag1'] },
    { userId: 'ny-spelare', email: 'ny@test.se', fullName: 'Ny Spelare', roles: ['player'], teams: ['lag1'] },
  ];
  const w = await s.api('POST', '/api/docs?path=clubs/klubb1/teams/club_global/data/members', { token: coachToken, body: { data: { members } } });
  assert.equal(w.status, 200);

  assert.equal((await s.api('GET', '/api/admin/users')).status, 401);
  assert.equal((await s.api('GET', '/api/admin/users', { token: otherToken })).status, 403);

  const list = await s.api('GET', '/api/admin/users', { token: coachToken });
  assert.equal(list.status, 200);
  const emails = list.json.users.map((u) => u.email).sort();
  assert.deepEqual(emails, ['coach@test.se', 'player@test.se']);

  // Tränaren kan skapa konto för ny medlem i klubben ...
  const gen = await s.api('POST', '/api/admin/users/bulk-generate', { token: coachToken, body: { members: [{ id: 'ny-spelare', name: 'Ny Spelare', email: 'ny@test.se' }] } });
  assert.equal(gen.status, 200);
  assert.equal(gen.json.accounts.length, 1);
  assert.ok(gen.json.accounts[0].tempPassword);

  // ... men inte byta lösenord på ett aktiverat konto ...
  const upd = await s.api('POST', '/api/admin/users/update', { token: coachToken, body: { userId: playerId, newPassword: 'Kapat12345' } });
  assert.equal(upd.status, 403);
  // ... och inte röra konton utanför klubben.
  const upd2 = await s.api('POST', '/api/admin/users/update', { token: coachToken, body: { userId: idOf(otherToken), newPassword: 'Kapat12345' } });
  assert.equal(upd2.status, 403);
  await s.login('player@test.se', 'Losenord123');

  const all = await s.api('GET', '/api/admin/users', { token: rootToken });
  assert.ok(all.json.users.length >= 5);
});

test('uppladdning och radering av filer kräver inloggning', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('test')], { type: 'image/jpeg' }), 'test.jpg');
  assert.equal((await s.api('POST', '/api/upload', { body: fd })).status, 401);
  assert.equal((await s.api('DELETE', '/api/delete-file?path=test.jpg')).status, 401);
});

test('poängligor hålls isär mellan lag', async () => {
  const p = (id) => ({ periods: [{ id, name: id, startDate: 1, isActive: true, standings: [] }], currentPeriodId: id });
  assert.equal((await s.api('POST', '/api/docs?path=clubs/klubb1/teams/lag1/data/periods', { token: coachToken, body: { data: p('liga-lag1') } })).status, 200);
  assert.equal((await s.api('POST', '/api/docs?path=clubs/klubb2/teams/lagX/data/periods', { token: otherToken, body: { data: p('liga-lagX') } })).status, 200);
  const r1 = await s.api('GET', '/api/docs?path=clubs/klubb1/teams/lag1/data/periods', { token: coachToken });
  assert.deepEqual(r1.json.periods.map((x) => x.id), ['liga-lag1']);
  const r2 = await s.api('GET', '/api/docs?path=clubs/klubb2/teams/lagX/data/periods', { token: otherToken });
  assert.deepEqual(r2.json.periods.map((x) => x.id), ['liga-lagX']);
  assert.equal((await s.api('GET', '/api/periods/all')).status, 401);
  const all = await s.api('GET', '/api/periods/all', { token: coachToken });
  assert.ok(!all.json.periods.some((x) => x.id === 'liga-lagX'));
});
