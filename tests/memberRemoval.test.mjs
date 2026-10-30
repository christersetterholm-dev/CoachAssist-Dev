// Skydd mot att medlemsregistret eller truppen töms av misstag (okt 2026: när en spelare utan e-post togs bort
// följde alla andra utan e-post med, 27 personer). Servern tar bort högst en person ur registret per sparning
// och högst tre lagroller ur truppen (utom Rensa truppen, som skickar en tom lista).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, ROOT_EMAIL, ROOT_PASSWORD } from './helpers.mjs';

let s, root;
const docPath = (p) => `/api/docs?path=${encodeURIComponent(p)}`;
const post = (p, data, token = root) => s.api('POST', docPath(p), { token, body: { data } });
const get = (p, token = root) => s.api('GET', docPath(p), { token });
const MEMBERS = 'clubs/k1/teams/club_global/data/members';
const SQUAD = 'clubs/k1/teams/lag1/data/squad';
const members = async () => (await get(MEMBERS)).json.members;
const squad = async () => (await get(SQUAD)).json?.squad || []; // tom trupp = null

const people = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ userId: id, email: '', fullName: `Spelare ${id}`, roles: ['player'], teams: ['lag1'] }));

before(async () => {
  s = await startServer();
  root = await s.login(ROOT_EMAIL, ROOT_PASSWORD);
  await post('clubs/k1/teams/club_global/data/metadata', { id: 'k1', name: 'k1', teams: [{ id: 'lag1', name: 'Lag 1' }] });
  const r = await post(MEMBERS, { members: people });
  assert.equal(r.status, 200);
});
after(() => s?.stop());

test('en person åt gången kan tas bort ur medlemsregistret', async () => {
  const list = await members();
  assert.equal(list.length, 6);
  const r = await post(MEMBERS, { members: list.filter((m) => m.userId !== 'f') });
  assert.equal(r.status, 200);
  assert.equal((await members()).length, 5);
});

test('en lista som saknar flera personer stoppas och inget tas bort', async () => {
  const list = await members();
  const r = await post(MEMBERS, { members: list.slice(0, 2) });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /3 personer/);
  assert.equal((await members()).length, 5, 'registret är orört');
});

test('truppen: många borttagna på en gång stoppas, Rensa truppen går', async () => {
  const before = await squad();
  assert.equal(before.length, 5);
  const stale = await post(SQUAD, { squad: before.slice(0, 1) });
  assert.equal(stale.status, 409);
  assert.equal((await squad()).length, 5, 'truppen är orörd');

  const one = await post(SQUAD, { squad: before.slice(0, 4) });
  assert.equal(one.status, 200);
  assert.equal((await squad()).length, 4);

  const clear = await post(SQUAD, { squad: [] });
  assert.equal(clear.status, 200);
  assert.equal((await squad()).length, 0);
  assert.equal((await members()).length, 5, 'Rensa truppen tar inte bort personerna ur registret');
});
