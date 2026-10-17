// API-tester för behörigheter och datalagring. Kör: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, ROOT_EMAIL, ROOT_PASSWORD } from './helpers.mjs';

let s;
let rootToken, coachToken, playerToken, otherToken;
let coachId, playerId, otherId;

async function post(path, data, token) {
  const r = await s.api('POST', `/api/docs?path=${path}`, { token, body: { data } });
  if (r.status !== 200) throw new Error(`POST ${path}: ${r.status} ${r.text}`);
  return r;
}
const get = (path, token) => s.api('GET', `/api/docs?path=${path}`, { token });

const idOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).id;

before(async () => {
  s = await startServer();
  rootToken = await s.login(ROOT_EMAIL, ROOT_PASSWORD);
  coachToken = await s.register('coach@test.se');
  playerToken = await s.register('player@test.se');
  otherToken = await s.register('other@test.se');
  coachId = idOf(coachToken);
  playerId = idOf(playerToken);
  otherId = idOf(otherToken);

  // Root-admin skapar två föreningar: klubb1 (tränare + spelare) och klubb2 (other är tränare)
  const meta = (id, team) => ({ id, name: id, teams: [{ id: team, name: team }] });
  await post('clubs/klubb1/teams/club_global/data/metadata', meta('klubb1', 'lag1'), rootToken);
  await post('clubs/klubb1/teams/club_global/data/members', { members: [
    { userId: 'm-coach', email: 'coach@test.se', fullName: 'Tränare Ett', roles: ['coach'], teams: ['lag1'] },
    { userId: 'm-player', email: 'player@test.se', fullName: 'Spelare Ett', roles: ['player'], teams: ['lag1'] },
    { userId: 'm-ny', email: 'ny@test.se', fullName: 'Ny Spelare', roles: ['player'], teams: ['lag1'] },
  ] }, rootToken);
  await post('clubs/klubb2/teams/club_global/data/metadata', meta('klubb2', 'lagX'), rootToken);
  await post('clubs/klubb2/teams/club_global/data/members', { members: [
    { userId: 'm-other', email: 'other@test.se', fullName: 'Annan Tränare', roles: ['coach'], teams: ['lagX'] },
  ] }, rootToken);
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

test('bara root-admin kan skapa föreningar', async () => {
  const r = await s.api('POST', '/api/docs?path=clubs/klubb9/teams/club_global/data/metadata', { token: coachToken, body: { data: { id: 'klubb9', name: 'x', teams: [] } } });
  assert.equal(r.status, 403);
});

test('lagets data: tränare skriver, spelare läser, andra nekas', async () => {
  const path = 'clubs/klubb1/teams/lag1/data/exercises';
  assert.equal((await s.api('POST', `/api/docs?path=${path}`, { token: coachToken, body: { data: { exercises: [{ id: 'e1' }] } } })).status, 200);
  assert.deepEqual((await get(path, playerToken)).json, { exercises: [{ id: 'e1' }] });
  assert.equal((await s.api('POST', `/api/docs?path=${path}`, { token: playerToken, body: { data: { exercises: [] } } })).status, 403);
  assert.equal((await get(path, otherToken)).status, 403);
  assert.equal((await s.api('POST', `/api/docs?path=${path}`, { token: otherToken, body: { data: {} } })).status, 403);
  assert.equal((await get(path)).status, 401);
});

test('truppen sparas i medlemsregistret och läses tillbaka i samma format', async () => {
  const squad = [
    { id: 'm-coach', name: 'Tränare Ett', role: 'leader' },
    { id: 'm-player', name: 'Spelare Ett', role: 'player', number: '7', personnummer: '20100101-1234' },
    { id: 'm-ny', name: 'Ny Spelare', role: 'player', number: '9', personnummer: '20110101-5678' },
    { id: 'm-coach_leader', name: 'Tränare Ett', role: 'leader' },
    { id: 'p-gast', name: 'Gäst Spelare', role: 'player' },
  ];
  await post('clubs/klubb1/teams/lag1/data/squad', { squad: squad.filter((p) => p.id !== 'm-coach_leader') }, coachToken);
  const r = await get('clubs/klubb1/teams/lag1/data/squad', coachToken);
  assert.deepEqual(r.json.squad.map((p) => [p.id, p.role, p.number || '']), [
    ['m-coach', 'leader', ''], ['m-player', 'player', '7'], ['m-ny', 'player', '9'], ['p-gast', 'player', ''],
  ]);
  assert.equal(r.json.squad[1].personnummer, '20100101-1234');
  // Spelare ser sitt eget personnummer men inte lagkamraternas
  const asPlayer = await get('clubs/klubb1/teams/lag1/data/squad', playerToken);
  assert.equal(asPlayer.json.squad[1].personnummer, '20100101-1234');
  assert.equal(asPlayer.json.squad[1].isMe, true);
  assert.equal(asPlayer.json.squad[2].personnummer, undefined);
  // Den nya truppspelaren finns i föreningens medlemslista
  const members = await get('clubs/klubb1/teams/club_global/data/members', coachToken);
  const gast = members.json.members.find((m) => m.userId === 'p-gast');
  assert.deepEqual([gast.roles, gast.teams], [['player'], ['lag1']]);
  // Tas personen bort ur truppen ligger hen kvar i registret, utan lagroll
  await post('clubs/klubb1/teams/lag1/data/squad', { squad: squad.filter((p) => p.id !== 'p-gast' && p.id !== 'm-coach_leader') }, coachToken);
  const after = await get('clubs/klubb1/teams/club_global/data/members', coachToken);
  assert.deepEqual(after.json.members.find((m) => m.userId === 'p-gast').teams, []);
});

test('tränare kan inte göra sig själv till föreningsadmin', async () => {
  const r = await get('clubs/klubb1/teams/club_global/data/members', coachToken);
  const list = r.json.members.map((m) => (m.userId === 'm-coach' ? { ...m, roles: [...m.roles, 'admin'] } : m));
  await post('clubs/klubb1/teams/club_global/data/members', { members: list }, coachToken);
  const after = await get('clubs/klubb1/teams/club_global/data/members', rootToken);
  assert.ok(!after.json.members.find((m) => m.userId === 'm-coach').roles.includes('admin'));
  assert.equal((await s.api('POST', '/api/docs?path=clubs/klubb1/teams/club_global/data/metadata', { token: coachToken, body: { data: { id: 'klubb1', name: 'Kapad', teams: [] } } })).status, 403);
});

test('kontohantering: tränare ser bara egna föreningens medlemmar', async () => {
  assert.equal((await s.api('GET', '/api/admin/users')).status, 401);
  assert.equal((await s.api('GET', '/api/admin/users', { token: playerToken })).status, 403);

  const list = await s.api('GET', '/api/admin/users', { token: coachToken });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.users.map((u) => u.email).sort(), ['coach@test.se', 'player@test.se']);

  const gen = await s.api('POST', '/api/admin/users/bulk-generate', { token: coachToken, body: { members: [{ id: 'm-ny', name: 'Ny Spelare', email: 'ny@test.se' }] } });
  assert.equal(gen.status, 200);
  assert.equal(gen.json.accounts.length, 1);
  assert.ok(gen.json.accounts[0].tempPassword);

  assert.equal((await s.api('POST', '/api/admin/users/update', { token: coachToken, body: { userId: playerId, newPassword: 'Kapat12345' } })).status, 403);
  assert.equal((await s.api('POST', '/api/admin/users/update', { token: coachToken, body: { userId: otherId, newPassword: 'Kapat12345' } })).status, 403);
  await s.login('player@test.se', 'Losenord123');
});

test('svar på kallelser: egna svar, tränarens svar och inga förlorade svar', async () => {
  const sessions = { sessions: [{ id: 's1', title: 'Träning', date: 1, startTime: '18:00', moments: [] }] };
  await post('clubs/klubb1/teams/lag1/data/sessions', sessions, coachToken);
  const rsvp = (token, memberId, status) => s.api('POST', '/api/rsvp', { token, body: { clubId: 'klubb1', teamId: 'lag1', sessionId: 's1', memberId, status } });

  assert.equal((await rsvp(playerToken, 'm-player', 'attending')).status, 200);
  assert.equal((await rsvp(playerToken, 'm-ny', 'declined')).status, 403, 'spelare svarar inte för andra');
  assert.equal((await rsvp(coachToken, 'm-ny', 'declined')).status, 200, 'tränare kan svara för spelare');
  assert.equal((await rsvp(otherToken, 'm-player', 'declined')).status, 403);
  assert.equal((await rsvp(playerToken, 'm-player', 'kanske')).status, 400);

  // Tränaren sparar passen utan de nya svaren (gammal kopia) – svaren ska ligga kvar
  await post('clubs/klubb1/teams/lag1/data/sessions', sessions, coachToken);
  const r = await get('clubs/klubb1/teams/lag1/data/sessions', playerToken);
  const got = r.json.sessions[0].rsvps;
  assert.equal(got['m-player'].status, 'attending');
  assert.equal(got['m-ny'].status, 'declined');
});

test('föreningslistan räknas fram ur föreningarna', async () => {
  const r = await get('shared_leaderboards/all_clubs', playerToken);
  assert.deepEqual(r.json.clubs.map((c) => c.id), ['klubb1', 'klubb2']);
});

test('poängligor hålls isär mellan lag', async () => {
  const p = (id) => ({ periods: [{ id, name: id, startDate: 1, isActive: true, standings: [] }], currentPeriodId: id });
  await post('clubs/klubb1/teams/lag1/data/periods', p('liga-lag1'), coachToken);
  await post('clubs/klubb2/teams/lagX/data/periods', p('liga-lagX'), otherToken);
  assert.deepEqual((await get('clubs/klubb1/teams/lag1/data/periods', coachToken)).json.periods.map((x) => x.id), ['liga-lag1']);
  assert.deepEqual((await get('clubs/klubb2/teams/lagX/data/periods', otherToken)).json.periods.map((x) => x.id), ['liga-lagX']);
  assert.equal((await s.api('GET', '/api/periods/all')).status, 401);
  const all = await s.api('GET', '/api/periods/all', { token: coachToken });
  assert.ok(!all.json.periods.some((x) => x.id === 'liga-lagX'));
});

test('uppladdning och radering av filer kräver inloggning', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('test')], { type: 'image/jpeg' }), 'test.jpg');
  assert.equal((await s.api('POST', '/api/upload', { body: fd })).status, 401);
  assert.equal((await s.api('DELETE', '/api/delete-file?path=test.jpg')).status, 401);
});

test('inbjudningslänk: tränaren bjuder in, spelaren skapar konto och kan svara', async () => {
  // Ny spelare i truppen
  const cur = (await get('clubs/klubb1/teams/lag1/data/squad', coachToken)).json.squad;
  await post('clubs/klubb1/teams/lag1/data/squad', { squad: [...cur, { id: 'm-inv', name: 'Inbjuden Spelare', role: 'player' }] }, coachToken);

  const create = (token, memberId) => s.api('POST', '/api/invites', { token, body: { clubId: 'klubb1', memberId } });
  assert.equal((await create(playerToken, 'm-inv')).status, 403, 'spelare kan inte bjuda in');
  assert.equal((await create(otherToken, 'm-inv')).status, 403, 'tränare i annan förening nekas');
  const inv = await create(coachToken, 'm-inv');
  assert.equal(inv.status, 200);

  const info = await s.api('GET', `/api/invites/${inv.json.token}`);
  assert.equal(info.json.fullName, 'Inbjuden Spelare');
  assert.deepEqual(info.json.teamNames, ['lag1']);

  // Befintligt konto med samma e-post kräver inloggning först
  const taken = await s.api('POST', `/api/invites/${inv.json.token}/accept`, { body: { email: 'coach@test.se', password: 'Losenord123' } });
  assert.equal(taken.status, 409);

  const acc = await s.api('POST', `/api/invites/${inv.json.token}/accept`, { body: { email: 'inbjuden@test.se', password: 'Spelare123' } });
  assert.equal(acc.status, 200);
  const invToken = acc.json.token;

  // Länken kan inte användas igen
  assert.equal((await s.api('POST', `/api/invites/${inv.json.token}/accept`, { body: { email: 'x@test.se', password: 'Spelare123' } })).status, 404);

  // Den nya spelaren ser laget, hittar sig själv och kan svara på kallelser
  assert.equal((await get('clubs/klubb1/teams/lag1/data/sessions', invToken)).status, 200);
  const members = await get('clubs/klubb1/teams/club_global/data/members', invToken);
  const me = members.json.members.find((m) => m.isMe);
  assert.equal(me.userId, 'm-inv');
  assert.equal(me.email, 'inbjuden@test.se');
  const rsvp = await s.api('POST', '/api/rsvp', { token: invToken, body: { clubId: 'klubb1', teamId: 'lag1', sessionId: 's1', memberId: 'm-inv', status: 'partial' } });
  assert.equal(rsvp.status, 200);
  const prof = await get(`users/${idOf(invToken)}/data/profile`, invToken);
  assert.deepEqual([prof.json.activeClubId, prof.json.activeTeamId, prof.json.onboardingCompleted], ['klubb1', 'lag1', true]);

  // Redan kopplad person kan inte bjudas in igen
  assert.equal((await create(coachToken, 'm-inv')).status, 409);
});

test('sparning med merge behåller övriga fält', async () => {
  const path = `users/${coachId}/data/profile`;
  await post(path, { fullName: 'Tränare Ett', activeClubId: 'klubb1', onboardingCompleted: true }, coachToken);
  const r = await s.api('POST', `/api/docs?path=${path}`, { token: coachToken, body: { data: { photoUrl: '/uploads/x.png' }, merge: true } });
  assert.equal(r.status, 200);
  assert.deepEqual((await get(path, coachToken)).json, { fullName: 'Tränare Ett', activeClubId: 'klubb1', onboardingCompleted: true, photoUrl: '/uploads/x.png' });
});

test('taktiktavlor: tränare sparar en tavla i taget, spelare ser bara delade', async () => {
  const q = 'clubId=klubb1&teamId=lag1';
  const put = (token, id, board) => s.api('PUT', `/api/tacticalboards/${id}`, { token, body: { clubId: 'klubb1', teamId: 'lag1', board } });
  const list = (token) => s.api('GET', `/api/tacticalboards?${q}`, { token });

  // Bara tränare kan spara
  assert.equal((await put(playerToken, 'tb1', { name: 'Hörna', state: {} })).status, 403);
  assert.equal((await put(otherToken, 'tb1', { name: 'Hörna', state: {} })).status, 403);
  assert.equal((await put(coachToken, 'tb1', { name: '', state: {} })).status, 400, 'namn krävs');
  assert.equal((await put(coachToken, 'ogiltigt id!', { name: 'X', state: {} })).status, 400);

  const a = await put(coachToken, 'tb1', { name: 'Hörna', state: { drawings: [{ id: 'd1', type: 'line' }] } });
  assert.equal(a.status, 200);
  assert.equal(a.json.board.sharedWithPlayers, false, 'inte delad från början');
  assert.equal((await put(coachToken, 'tb2', { name: 'Frispark', sharedWithPlayers: true, state: {} })).status, 200);

  // Tränaren ser båda, spelaren bara den delade – både via egna adressen och via /api/docs
  assert.deepEqual((await list(coachToken)).json.boards.map((b) => b.id).sort(), ['tb1', 'tb2']);
  assert.equal((await list(coachToken)).json.canEdit, true);
  const forPlayer = await list(playerToken);
  assert.deepEqual(forPlayer.json.boards.map((b) => b.id), ['tb2']);
  assert.equal(forPlayer.json.canEdit, false);
  assert.deepEqual((await get('clubs/klubb1/teams/lag1/data/tacticalboards', playerToken)).json.boards.map((b) => b.id), ['tb2']);
  assert.equal((await list(otherToken)).status, 403, 'annan förening nekas');

  // En ändring av en tavla rör inte den andra, och skapad-tiden ligger kvar
  const before = (await list(coachToken)).json.boards.find((b) => b.id === 'tb1');
  await put(coachToken, 'tb1', { name: 'Hörna variant B', sharedWithPlayers: true, state: { drawings: [] } });
  const boards = (await list(coachToken)).json.boards;
  assert.equal(boards.find((b) => b.id === 'tb1').name, 'Hörna variant B');
  assert.equal(boards.find((b) => b.id === 'tb1').createdAt, before.createdAt);
  assert.equal(boards.find((b) => b.id === 'tb2').name, 'Frispark');
  assert.equal((await list(playerToken)).json.boards.length, 2, 'nu delad');

  // Ta bort
  assert.equal((await s.api('DELETE', `/api/tacticalboards/tb2?${q}`, { token: playerToken })).status, 403);
  assert.equal((await s.api('DELETE', `/api/tacticalboards/tb2?${q}`, { token: coachToken })).status, 200);
  assert.equal((await s.api('DELETE', `/api/tacticalboards/tb2?${q}`, { token: coachToken })).status, 404);
  assert.deepEqual((await list(coachToken)).json.boards.map((b) => b.id), ['tb1']);
});
