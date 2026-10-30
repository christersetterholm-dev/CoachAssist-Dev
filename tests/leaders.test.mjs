// Rollen Ledare: samma rättigheter som tränare, men bara de kallelser ledaren själv valt (Träning/Match/Övrigt).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, ROOT_EMAIL, ROOT_PASSWORD } from './helpers.mjs';

let s, root, coach, leader, timon, player;
const docPath = (p) => `/api/docs?path=${encodeURIComponent(p)}`;
const post = async (p, data, token) => {
  const r = await s.api('POST', docPath(p), { token, body: { data } });
  if (r.status !== 200) throw new Error(`POST ${p}: ${r.status} ${r.text}`);
  return r;
};
const get = (p, token) => s.api('GET', docPath(p), { token });
const squad = async (token = coach) => (await get('clubs/k1/teams/lag1/data/squad', token)).json.squad;
const members = async () => (await get('clubs/k1/teams/club_global/data/members', root)).json.members;

before(async () => {
  s = await startServer();
  root = await s.login(ROOT_EMAIL, ROOT_PASSWORD);
  coach = await s.register('coach@l.se');
  leader = await s.register('ledare@l.se');
  timon = await s.register('timon@l.se');
  player = await s.register('spelare@l.se');
  await post('clubs/k1/teams/club_global/data/metadata', { id: 'k1', name: 'k1', teams: [{ id: 'lag1', name: 'Lag 1' }] }, root);
  await post('clubs/k1/teams/club_global/data/members', { members: [
    { userId: 'c', email: 'coach@l.se', fullName: 'Tränaren', roles: ['coach'], teams: ['lag1'] },
    { userId: 'l', email: 'ledare@l.se', fullName: 'Ledaren', roles: ['leader'], teams: ['lag1'] },
    { userId: 't', email: 'timon@l.se', fullName: 'Timon', roles: ['player', 'leader'], teams: ['lag1'] },
    { userId: 'p', email: 'spelare@l.se', fullName: 'Spelaren', roles: ['player'], teams: ['lag1'] },
  ] }, root);
});
after(() => s?.stop());

test('ledare har tränarens rättigheter i laget', async () => {
  const r = await s.api('POST', docPath('clubs/k1/teams/lag1/data/sessions'), { token: leader, body: { data: { sessions: [{ id: 'x', title: 'Träning', date: 1, startTime: '18:00', moments: [] }] } } });
  assert.equal(r.status, 200);
  const asPlayer = await s.api('POST', docPath('clubs/k1/teams/lag1/data/sessions'), { token: player, body: { data: { sessions: [] } } });
  assert.equal(asPlayer.status, 403);
  assert.equal((await squad(leader)).find((p) => p.id === 'p').email, 'spelare@l.se', 'ledaren ser kontaktuppgifter som en tränare');
});

test('truppen visar ledare som ledare; den som är spelare och ledare kallas som spelare', async () => {
  const list = await squad();
  const l = list.find((p) => p.id === 'l');
  assert.equal(l.role, 'leader');
  assert.equal(l.teamRole, 'leader');
  assert.deepEqual(l.rsvpTypes, [], 'inga kallelser innan ledaren valt');
  assert.equal(list.find((p) => p.id === 't').role, 'player');
  const tl = list.find((p) => p.id === 't_leader');
  assert.equal(tl.teamRole, 'leader');
  assert.equal(tl.rsvpTypes, undefined);
  assert.equal(list.find((p) => p.id === 'c').teamRole, undefined, 'tränare är inte ledare');
});

test('ledaren väljer själv kallelser per typ, och valet syns för tränaren', async () => {
  const r = await s.api('PUT', '/api/leader/rsvp-types', { token: leader, body: { clubId: 'k1', teamId: 'lag1', types: ['match', 'konstig'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.types, ['match']);
  assert.deepEqual((await squad()).find((p) => p.id === 'l').rsvpTypes, ['match']);
  assert.deepEqual((await members()).find((m) => m.userId === 'l').rsvpTypes, ['match']);
  assert.equal((await s.api('PUT', '/api/leader/rsvp-types', { token: player, body: { clubId: 'k1', teamId: 'lag1', types: ['match'] } })).status, 403);
});

test('tränaren kan ändra ledarens kallelser i medlemsformuläret', async () => {
  const list = await members();
  const l = list.find((m) => m.userId === 'l');
  await post('clubs/k1/teams/club_global/data/members', { members: list.map((m) => (m.userId === 'l' ? { ...l, rsvpTypes: ['match', 'other'] } : m)) }, root);
  assert.deepEqual((await squad()).find((p) => p.id === 'l').rsvpTypes, ['match', 'other']);
});

test('ledarrollen finns kvar när truppen sparas, även från en äldre app utan teamRole', async () => {
  const list = await squad();
  await post('clubs/k1/teams/lag1/data/squad', { squad: list }, coach);
  let roles = (await members()).find((m) => m.userId === 'l').roles;
  assert.deepEqual(roles.sort(), ['leader']);
  await post('clubs/k1/teams/lag1/data/squad', { squad: list.map(({ teamRole, ...p }) => p) }, coach);
  roles = (await members()).find((m) => m.userId === 'l').roles;
  assert.deepEqual(roles.sort(), ['leader']);
  assert.deepEqual((await members()).find((m) => m.userId === 't').roles.sort(), ['leader', 'player']);
});

test('notis om kallelse går bara till ledare som valt den typen av pass', async () => {
  const notify = (kind) => s.api('POST', '/api/sessions/notify', { token: coach, body: { clubId: 'k1', teamId: 'lag1', sessions: [{ id: 'x', title: 'Pass', date: Date.now(), startTime: '18:00', kind }] } });
  // Konton kopplas till medlemsraderna vid inloggning
  for (const e of ['ledare@l.se', 'timon@l.se', 'spelare@l.se']) await s.login(e, 'Losenord123');
  // Mottagare utom avsändaren: ledaren (bara match/övrigt), Timon (spelare), spelaren
  assert.equal((await notify('training')).json.recipients, 2);
  assert.equal((await notify('match')).json.recipients, 3);
});
