// API-tester för notiserna (server/push.ts). Kör: npm test
// En låtsas-push-tjänst på 127.0.0.1 tar emot notiserna, och testerna dekrypterar dem
// med samma nycklar som en webbläsare skulle ha.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import { startServer, ROOT_EMAIL, ROOT_PASSWORD } from './helpers.mjs';

const ece = createRequire(import.meta.url)('http_ece');

let s, pushServer, pushBase;
let root, coach, anna, bo, other;
const received = []; // { device, headers, payload }
let respondWith = 201;

const ok = (r) => { if (r.status !== 200) throw new Error(`${r.status} ${r.text}`); return r.json; };
const doc = async (p, data, token) => ok(await s.api('POST', `/api/docs?path=${p}`, { token, body: { data } }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// En "enhet": egna nycklar som en webbläsare och en egen adress hos låtsas-tjänsten.
const devices = new Map();
function device(name) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  const d = { name, ecdh, auth, subscription: { endpoint: `${pushBase}/${name}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth } } };
  devices.set(name, d);
  return d;
}
const subscribe = (token, d, prefs = {}) => s.api('POST', '/api/push/subscribe', { token, body: { subscription: d.subscription, ...prefs } });
const pushesFor = (name) => received.filter((r) => r.device === name);
// Väntar tills tjänsten tagit emot minst n notiser till enheten (eller ger upp efter en stund).
async function waitFor(name, n = 1, ms = 3000) {
  const end = Date.now() + ms;
  while (pushesFor(name).length < n && Date.now() < end) await wait(25);
  return pushesFor(name);
}

before(async () => {
  pushServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const name = req.url.slice(1);
      const d = devices.get(name);
      let payload = null;
      try { payload = JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth }).toString()); } catch (e) { payload = { error: String(e) }; }
      received.push({ device: name, headers: req.headers, payload });
      res.writeHead(respondWith).end();
    });
  });
  await new Promise((r) => pushServer.listen(0, '127.0.0.1', r));
  pushBase = `http://127.0.0.1:${pushServer.address().port}`;

  s = await startServer({ env: { PUSH_ALLOW_ANY_ENDPOINT: '1' } });
  root = await s.login(ROOT_EMAIL, ROOT_PASSWORD);
  for (const e of ['coach', 'anna', 'bo', 'other']) await s.register(`${e}@test.se`);
  await doc('clubs/klubb1/teams/club_global/data/metadata', { id: 'klubb1', name: 'klubb1', teams: [{ id: 'lag1', name: 'A-laget' }, { id: 'lag2', name: 'B-laget' }] }, root);
  await doc('clubs/klubb1/teams/club_global/data/members', { members: [
    { userId: 'm-coach', email: 'coach@test.se', fullName: 'Tränare Tina', roles: ['coach'], teams: ['lag1'] },
    { userId: 'm-anna', email: 'anna@test.se', fullName: 'Anna Andersson', roles: ['player'], teams: ['lag1'] },
    { userId: 'm-bo', email: 'bo@test.se', fullName: 'Bo Berg', roles: ['player'], teams: ['lag1'] },
    { userId: 'm-other', email: 'other@test.se', fullName: 'Olle i B', roles: ['player'], teams: ['lag2'] },
  ] }, root);
  coach = await s.login('coach@test.se', 'Losenord123');
  anna = await s.login('anna@test.se', 'Losenord123');
  bo = await s.login('bo@test.se', 'Losenord123');
  other = await s.login('other@test.se', 'Losenord123');
});
after(() => { s?.stop(); pushServer?.close(); });

test('notiser: nyckel, påslagning, status och ogiltiga prenumerationer', async () => {
  assert.equal((await s.api('GET', '/api/push/key')).status, 401);
  const { publicKey } = ok(await s.api('GET', '/api/push/key', { token: anna }));
  assert.equal(Buffer.from(publicKey, 'base64url').length, 65);

  const d = device('anna-status');
  assert.deepEqual(ok(await subscribe(anna, d, { posts: false })), { subscribed: true, chat: true, posts: false, sessions: true });
  assert.deepEqual(ok(await s.api('POST', '/api/push/status', { token: anna, body: { endpoint: d.subscription.endpoint } })), { subscribed: true, chat: true, posts: false, sessions: true });
  // Någon annans enhet syns inte som påslagen
  assert.equal(ok(await s.api('POST', '/api/push/status', { token: bo, body: { endpoint: d.subscription.endpoint } })).subscribed, false);

  const bad = { ...d.subscription, keys: { p256dh: 'abc', auth: d.auth } };
  assert.equal((await s.api('POST', '/api/push/subscribe', { token: anna, body: { subscription: bad } })).status, 400);
  assert.equal((await s.api('POST', '/api/push/subscribe', { token: anna, body: { subscription: { ...d.subscription, endpoint: 'ftp://x/y' } } })).status, 400);

  ok(await s.api('POST', '/api/push/unsubscribe', { token: anna, body: { endpoint: d.subscription.endpoint } }));
  assert.equal(ok(await s.api('POST', '/api/push/status', { token: anna, body: { endpoint: d.subscription.endpoint } })).subscribed, false);
});

test('notiser: testnotis går bara till den egna enheten', async () => {
  const d = device('anna-test');
  ok(await subscribe(anna, d));
  assert.equal((await s.api('POST', '/api/push/test', { token: bo, body: { endpoint: d.subscription.endpoint } })).status, 404);
  ok(await s.api('POST', '/api/push/test', { token: anna, body: { endpoint: d.subscription.endpoint } }));
  const [p] = await waitFor('anna-test');
  assert.equal(p.payload.title, 'Notiserna fungerar');
  assert.ok(p.headers.authorization?.startsWith('vapid t='), 'VAPID-inloggning skickas');
  assert.equal(p.headers['content-encoding'], 'aes128gcm');
  ok(await s.api('POST', '/api/push/unsubscribe', { token: anna, body: { endpoint: d.subscription.endpoint } }));
});

test('notiser: nytt meddelande i lagchatten går till de andra i laget', async () => {
  const dAnna = device('anna-chat'), dCoach = device('coach-chat'), dBo = device('bo-chat'), dOther = device('other-chat');
  ok(await subscribe(anna, dAnna));
  ok(await subscribe(coach, dCoach));
  ok(await subscribe(bo, dBo, { chat: false }));
  ok(await subscribe(other, dOther));
  const team = ok(await s.api('GET', '/api/chat?clubId=klubb1', { token: coach })).conversations.find((c) => c.kind === 'team' && c.teamId === 'lag1');

  ok(await s.api('POST', `/api/chat/${team.id}/messages`, { token: coach, body: { body: 'Samling 18.00 vid planen' } }));
  const [p] = await waitFor('anna-chat');
  assert.equal(p.payload.title, 'A-laget');
  assert.equal(p.payload.body, 'Tränare: Samling 18.00 vid planen');
  assert.deepEqual(p.payload.open, { view: 'chat', clubId: 'klubb1', conversationId: team.id });
  assert.equal(p.payload.tag, `chat-${team.id}`);
  await wait(300);
  assert.equal(pushesFor('coach-chat').length, 0, 'den som skrev får ingen notis');
  assert.equal(pushesFor('bo-chat').length, 0, 'Bo har stängt av chattnotiser');
  assert.equal(pushesFor('other-chat').length, 0, 'annat lag får ingen notis');

  // Anna har chatten öppen (appen frågar efter nya meddelanden): ingen notis
  ok(await s.api('GET', `/api/chat/${team.id}/messages?after=0`, { token: anna }));
  ok(await s.api('POST', `/api/chat/${team.id}/messages`, { token: coach, body: { body: 'Ta med vattenflaska' } }));
  await wait(400);
  assert.equal(pushesFor('anna-chat').length, 1);
});

test('notiser: en-till-en visar avsändaren som rubrik', async () => {
  const d = device('bo-direct');
  ok(await subscribe(bo, d));
  const people = ok(await s.api('GET', '/api/chat/people?clubId=klubb1', { token: anna })).people;
  const boId = people.find((p) => p.name === 'Bo Berg').userId;
  const c = ok(await s.api('POST', '/api/chat', { token: anna, body: { clubId: 'klubb1', userIds: [boId] } })).conversation;
  ok(await s.api('POST', `/api/chat/${c.id}/messages`, { token: anna, body: { body: 'Hej Bo!' } }));
  const [p] = await waitFor('bo-direct');
  assert.equal(p.payload.title, 'Anna Andersson');
  assert.equal(p.payload.body, 'Hej Bo!');
});

test('notiser: nytt inlägg går till laget, och borttagna enheter städas bort', async () => {
  const dAnna = device('anna-post'), dCoach = device('coach-post'), dBo = device('bo-post');
  ok(await subscribe(anna, dAnna));
  ok(await subscribe(coach, dCoach));
  ok(await subscribe(bo, dBo, { posts: false }));
  const created = ok(await s.api('POST', '/api/posts', { token: coach, body: { clubId: 'klubb1', teamId: 'lag1', post: { title: 'Matchinfo', body: 'Vi spelar på konstgräs.', pinned: false, sessionId: null, imageUrl: null, links: [] } } }));
  const [p] = await waitFor('anna-post');
  assert.equal(p.payload.title, 'Nytt inlägg · A-laget');
  assert.equal(p.payload.body, 'Matchinfo – Vi spelar på konstgräs.');
  assert.deepEqual(p.payload.open, { view: 'post', clubId: 'klubb1', teamId: 'lag1', postId: created.post.id });
  await wait(300);
  assert.equal(pushesFor('coach-post').length, 0);
  assert.equal(pushesFor('bo-post').length, 0);

  // Push-tjänsten svarar 410 (enheten finns inte längre): prenumerationen tas bort
  respondWith = 410;
  try {
    ok(await s.api('POST', '/api/posts', { token: coach, body: { clubId: 'klubb1', teamId: 'lag1', post: { title: 'Till', body: '', pinned: false, sessionId: null, imageUrl: null, links: [] } } }));
    await waitFor('anna-post', 2);
    await wait(200);
  } finally { respondWith = 201; }
  assert.equal(ok(await s.api('POST', '/api/push/status', { token: anna, body: { endpoint: dAnna.subscription.endpoint } })).subscribed, false);
});

test('notiser: samma enhet med nytt konto tillhör det nya kontot', async () => {
  const d = device('shared-device');
  ok(await subscribe(anna, d));
  ok(await subscribe(bo, d));
  assert.equal(ok(await s.api('POST', '/api/push/status', { token: anna, body: { endpoint: d.subscription.endpoint } })).subscribed, false);
  assert.equal(ok(await s.api('POST', '/api/push/status', { token: bo, body: { endpoint: d.subscription.endpoint } })).subscribed, true);
});

test('notiser: nya pass att svara på går till laget, bara tränaren får skicka', async () => {
  const dAnna = device('anna-pass'), dBo = device('bo-pass'), dOther = device('other-pass'), dCoach = device('coach-pass');
  ok(await subscribe(anna, dAnna));
  ok(await subscribe(bo, dBo, { sessions: false }));
  ok(await subscribe(other, dOther));
  ok(await subscribe(coach, dCoach));
  assert.equal(ok(await s.api('POST', '/api/push/status', { token: bo, body: { endpoint: dBo.subscription.endpoint } })).sessions, false);

  const day = (d) => new Date(2026, 9, d, 12).getTime();
  const series = [20, 22, 27].map((d, i) => ({ id: `p${i}`, title: 'Träning', date: day(d), startTime: '18:30' }));
  const body = { clubId: 'klubb1', teamId: 'lag1', sessions: series };
  assert.equal((await s.api('POST', '/api/sessions/notify', { body })).status, 401);
  assert.equal((await s.api('POST', '/api/sessions/notify', { token: anna, body })).status, 403);
  assert.equal((await s.api('POST', '/api/sessions/notify', { token: other, body })).status, 403);
  assert.equal((await s.api('POST', '/api/sessions/notify', { token: coach, body: { ...body, sessions: [] } })).status, 400);

  ok(await s.api('POST', '/api/sessions/notify', { token: coach, body }));
  const [p] = await waitFor('anna-pass');
  assert.equal(p.payload.title, 'Nya pass att svara på · A-laget');
  assert.equal(p.payload.body, '3 pass (Träning) 20 okt – 27 okt. Svara i appen.');
  assert.deepEqual(p.payload.open, { view: 'sessions', clubId: 'klubb1', teamId: 'lag1' });
  await wait(300);
  assert.equal(pushesFor('bo-pass').length, 0, 'har stängt av kallelser');
  assert.equal(pushesFor('other-pass').length, 0, 'annat lag');
  assert.equal(pushesFor('coach-pass').length, 0, 'den som skickade');

  // Ett pass: öppnar just det passet
  ok(await s.api('POST', '/api/sessions/notify', { token: coach, body: { ...body, sessions: [series[1]] } }));
  const [, one] = await waitFor('anna-pass', 2);
  assert.equal(one.payload.title, 'Ny kallelse · A-laget');
  assert.equal(one.payload.body, 'Träning tors 22 okt 18:30. Svara i appen.');
  assert.deepEqual(one.payload.open, { view: 'sessions', clubId: 'klubb1', teamId: 'lag1', sessionId: 'p1' });
});
