// API-tester för chatten (server/chat.ts). Kör: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, ROOT_EMAIL, ROOT_PASSWORD } from './helpers.mjs';

let s;
let root, coach, anna, bo, cia, other;
let annaId, boId, ciaId, coachId;

const idOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).id;
const doc = async (p, data, token) => {
  const r = await s.api('POST', `/api/docs?path=${p}`, { token, body: { data } });
  if (r.status !== 200) throw new Error(`POST ${p}: ${r.status} ${r.text}`);
};
const ok = (r) => { if (r.status !== 200) throw new Error(`${r.status} ${r.text}`); return r.json; };
const start = (token, userIds, name) => s.api('POST', '/api/chat', { token, body: { clubId: 'klubb1', userIds, name } });
const send = (token, id, body, extra = {}) => s.api('POST', `/api/chat/${id}/messages`, { token, body: { body, ...extra } });
const list = (token, clubId = 'klubb1') => s.api('GET', `/api/chat?clubId=${clubId}`, { token });

before(async () => {
  s = await startServer();
  root = await s.login(ROOT_EMAIL, ROOT_PASSWORD);
  coach = await s.register('coach@test.se');
  anna = await s.register('anna@test.se');
  bo = await s.register('bo@test.se');
  cia = await s.register('cia@test.se');
  other = await s.register('other@test.se');
  [coachId, annaId, boId, ciaId] = [coach, anna, bo, cia].map(idOf);

  const meta = (id, teams) => ({ id, name: id, teams });
  await doc('clubs/klubb1/teams/club_global/data/metadata', meta('klubb1', [{ id: 'lag1', name: 'A-laget' }, { id: 'lag2', name: 'B-laget' }]), root);
  await doc('clubs/klubb1/teams/club_global/data/members', { members: [
    { userId: 'm-coach', email: 'coach@test.se', fullName: 'Tränare Tina', roles: ['coach'], teams: ['lag1'], personnummer: '19800101-1111', phone: '0701234567' },
    { userId: 'm-anna', email: 'anna@test.se', fullName: 'Anna Andersson', roles: ['player'], teams: ['lag1'] },
    { userId: 'm-bo', email: 'bo@test.se', fullName: 'Bo Berg', roles: ['player'], teams: ['lag1'] },
    { userId: 'm-cia', email: 'cia@test.se', fullName: 'Cia Ceder', roles: ['player'], teams: ['lag2'] },
  ] }, root);
  await doc('clubs/klubb2/teams/club_global/data/metadata', meta('klubb2', [{ id: 'lagX', name: 'X' }]), root);
  await doc('clubs/klubb2/teams/club_global/data/members', { members: [
    { userId: 'm-other', email: 'other@test.se', fullName: 'Annan Person', roles: ['coach'], teams: ['lagX'] },
  ] }, root);
  // Kontona kopplas till medlemsraderna vid inloggning.
  coach = await s.login('coach@test.se', 'Losenord123');
  anna = await s.login('anna@test.se', 'Losenord123');
  bo = await s.login('bo@test.se', 'Losenord123');
  cia = await s.login('cia@test.se', 'Losenord123');
  other = await s.login('other@test.se', 'Losenord123');
});
after(() => s?.stop());

test('chatt: personlistan visar bara namn och lag, aldrig personnummer, telefon eller e-post', async () => {
  const r = ok(await s.api('GET', '/api/chat/people?clubId=klubb1', { token: anna }));
  const names = r.people.map((p) => p.name).sort();
  assert.deepEqual(names, ['Bo Berg', 'Cia Ceder', 'Tränare Tina']);
  const text = JSON.stringify(r);
  assert.ok(!text.includes('19800101') && !text.includes('0701234567') && !text.includes('@test.se'));
  assert.deepEqual(r.myTeams, ['lag1']);
  assert.equal((await s.api('GET', '/api/chat/people?clubId=klubb1', { token: other })).status, 403);
  assert.equal((await s.api('GET', '/api/chat/people?clubId=klubb1')).status, 401);
});

test('chatt: lagchatten skapas automatiskt och följer laget', async () => {
  const annas = ok(await list(anna)).conversations;
  const team = annas.find((c) => c.kind === 'team');
  assert.equal(team.name, 'A-laget');
  // Cia är i lag2 och ser inte lag1:s chatt
  assert.equal((await s.api('GET', `/api/chat/${team.id}/messages`, { token: cia })).status, 404);
  assert.equal(ok(await list(cia)).conversations.find((c) => c.kind === 'team').name, 'B-laget');

  ok(await send(coach, team.id, 'Träning kl 18'));
  const bos = ok(await s.api('GET', '/api/chat/summary?clubId=klubb1', { token: bo }));
  assert.equal(bos.unread[team.id], 1);
  const detail = ok(await s.api('GET', `/api/chat/${team.id}`, { token: bo })).conversation;
  assert.deepEqual(detail.participants.map((p) => p.name), ['Anna Andersson', 'Bo Berg', 'Tränare Tina']);
  assert.equal(detail.canModerate, false);
  assert.equal(ok(await s.api('GET', `/api/chat/${team.id}`, { token: coach })).conversation.canModerate, true);

  // Lagets tränare kan ta bort andras meddelanden i lagchatten
  const m = ok(await send(anna, team.id, 'Olämpligt')).message;
  assert.equal((await s.api('DELETE', `/api/chat/${team.id}/messages/${m.seq}`, { token: bo })).status, 403);
  ok(await s.api('DELETE', `/api/chat/${team.id}/messages/${m.seq}`, { token: coach }));
  const msgs = ok(await s.api('GET', `/api/chat/${team.id}/messages`, { token: bo })).messages;
  const removed = msgs.find((x) => x.seq === m.seq);
  assert.equal(removed.deleted, true);
  assert.equal(removed.body, '');
});

test('chatt: en-till-en återanvänds och syns för mottagaren först när något skrivits', async () => {
  const a = ok(await start(anna, [boId])).conversation;
  assert.equal(a.kind, 'direct');
  assert.equal(a.name, 'Bo Berg');
  assert.ok(!ok(await list(bo)).conversations.some((c) => c.id === a.id), 'tom chatt syns inte för Bo');
  const again = ok(await start(bo, [annaId])).conversation;
  assert.equal(again.id, a.id, 'samma par får samma chatt');
  ok(await send(anna, a.id, 'Hej Bo!'));
  const bosList = ok(await list(bo)).conversations;
  const c = bosList.find((x) => x.id === a.id);
  assert.equal(c.name, 'Anna Andersson');
  assert.equal(c.unread, 1);
  assert.equal(c.lastMessage.text, 'Hej Bo!');
  // Andra kommer inte åt chatten – inte heller root-admin eller tränaren
  for (const t of [cia, coach, root, other]) {
    assert.equal((await s.api('GET', `/api/chat/${a.id}/messages`, { token: t })).status, 404);
  }
  // Person i annan förening går inte att chatta med
  assert.equal((await start(anna, [idOf(other)])).status, 400);
});

test('chatt: läst, ändra, ta bort och reaktioner', async () => {
  const c = ok(await start(anna, [ciaId])).conversation;
  const m = ok(await send(anna, c.id, 'Hej Cia')).message;
  let r = ok(await s.api('GET', `/api/chat/${c.id}/messages`, { token: anna }));
  assert.equal(r.reads.find((x) => x.userId === ciaId).lastReadSeq < m.seq, true);
  const cursor = r.cursor;

  ok(await s.api('POST', `/api/chat/${c.id}/read`, { token: cia, body: { seq: m.seq } }));
  r = ok(await s.api('GET', `/api/chat/${c.id}/messages?after=${cursor}`, { token: anna }));
  assert.equal(r.reads.find((x) => x.userId === ciaId).lastReadSeq, m.seq);
  assert.equal(r.messages.length, 0, 'inget nytt meddelande');
  assert.equal(ok(await s.api('GET', '/api/chat/summary?clubId=klubb1', { token: cia })).unread[c.id], undefined);

  // Reaktion: 👍 och 👍️ är samma
  ok(await s.api('POST', `/api/chat/${c.id}/messages/${m.seq}/reactions`, { token: cia, body: { emoji: '👍' } }));
  const re = ok(await s.api('POST', `/api/chat/${c.id}/messages/${m.seq}/reactions`, { token: anna, body: { emoji: '👍️' } })).message;
  assert.deepEqual(re.reactions, { '👍': 2 });
  assert.equal((await s.api('POST', `/api/chat/${c.id}/messages/${m.seq}/reactions`, { token: anna, body: { emoji: 'hej' } })).status, 400);

  // Ändringen kommer med i "after"
  r = ok(await s.api('GET', `/api/chat/${c.id}/messages?after=${cursor}`, { token: cia }));
  assert.deepEqual(r.messages.map((x) => x.seq), [m.seq]);
  const cursor2 = r.cursor;

  assert.equal((await s.api('PATCH', `/api/chat/${c.id}/messages/${m.seq}`, { token: cia, body: { body: 'Fusk' } })).status, 403);
  const edited = ok(await s.api('PATCH', `/api/chat/${c.id}/messages/${m.seq}`, { token: anna, body: { body: 'Hej Cia!' } })).message;
  assert.equal(edited.body, 'Hej Cia!');
  assert.ok(edited.editedAt);

  assert.equal((await s.api('DELETE', `/api/chat/${c.id}/messages/${m.seq}`, { token: cia })).status, 403);
  ok(await s.api('DELETE', `/api/chat/${c.id}/messages/${m.seq}`, { token: anna }));
  r = ok(await s.api('GET', `/api/chat/${c.id}/messages?after=${cursor2}`, { token: cia }));
  assert.equal(r.messages[0].deleted, true);
  assert.deepEqual(r.messages[0].reactions, {});
  assert.equal((await s.api('PATCH', `/api/chat/${c.id}/messages/${m.seq}`, { token: anna, body: { body: 'igen' } })).status, 400);
});

test('chatt: gränser för meddelanden', async () => {
  const c = ok(await start(bo, [ciaId])).conversation;
  assert.equal((await send(bo, c.id, '')).status, 400);
  assert.equal((await send(bo, c.id, 'x'.repeat(4001))).status, 400);
  assert.equal((await send(bo, c.id, 'ok', { attachments: ['finns-inte'] })).status, 400);
});

test('chatt: grupper – gruppadmin sköter gruppen, alla kan lämna', async () => {
  const g = ok(await start(anna, [boId, ciaId], 'Fika')).conversation;
  assert.equal(g.kind, 'group');
  assert.equal(g.name, 'Fika');
  assert.equal(g.isAdmin, true);
  assert.equal(g.participants.find((p) => p.userId === annaId).role, 'admin');

  // Bara admin byter namn och tar bort
  assert.equal((await s.api('PATCH', `/api/chat/${g.id}`, { token: bo, body: { name: 'Mitt' } })).status, 403);
  assert.equal(ok(await s.api('PATCH', `/api/chat/${g.id}`, { token: anna, body: { name: 'Fika fredag' } })).conversation.name, 'Fika fredag');
  assert.equal((await s.api('DELETE', `/api/chat/${g.id}/participants/${ciaId}`, { token: bo })).status, 403);
  ok(await s.api('DELETE', `/api/chat/${g.id}/participants/${ciaId}`, { token: anna }));
  assert.equal((await s.api('GET', `/api/chat/${g.id}/messages`, { token: cia })).status, 404, 'borttagen ser inte gruppen');

  // Lägga tillbaka, och händelserna syns i chatten
  ok(await s.api('POST', `/api/chat/${g.id}/participants`, { token: anna, body: { userIds: [ciaId, coachId] } }));
  const events = ok(await s.api('GET', `/api/chat/${g.id}/messages`, { token: cia })).messages.filter((m) => m.kind === 'event').map((m) => m.body);
  assert.ok(events.some((e) => e.includes('lade till Cia Ceder och Tränare Tina')));

  // Sista admin lämnar → den som varit med längst blir admin
  ok(await s.api('DELETE', `/api/chat/${g.id}/participants/${annaId}`, { token: anna }));
  assert.equal((await s.api('GET', `/api/chat/${g.id}`, { token: anna })).status, 404);
  const d = ok(await s.api('GET', `/api/chat/${g.id}`, { token: bo })).conversation;
  assert.equal(d.isAdmin, true);
  ok(await s.api('POST', `/api/chat/${g.id}/admins/${ciaId}`, { token: bo }));
  assert.equal(ok(await s.api('GET', `/api/chat/${g.id}`, { token: cia })).conversation.isAdmin, true);
  // En vanlig deltagare kan inte göra sig själv till admin
  assert.equal((await s.api('POST', `/api/chat/${g.id}/admins/${coachId}`, { token: coach })).status, 403);

  // Lagchatten och en-till-en kan inte lämnas eller döpas om
  const team = ok(await list(bo)).conversations.find((c) => c.kind === 'team');
  assert.equal((await s.api('DELETE', `/api/chat/${team.id}/participants/${boId}`, { token: bo })).status, 400);
  assert.equal((await s.api('PATCH', `/api/chat/${team.id}`, { token: coach, body: { name: 'x' } })).status, 400);
});

test('chatt: bilder och filer lämnas bara ut till dem som är med', async () => {
  const c = ok(await start(anna, [boId], 'Filer')).conversation;
  const upload = (token, name, type, content = 'hej') => {
    const fd = new FormData();
    fd.append('file', new Blob([content], { type }), name);
    return s.api('POST', `/api/chat/${c.id}/files`, { token, body: fd });
  };
  assert.equal((await upload(anna, 'virus.exe', 'application/octet-stream')).status, 400);
  assert.equal((await upload(anna, 'sida.html', 'text/html')).status, 400);
  assert.equal((await upload(anna, 'falsk.jpg', 'text/html')).status, 400);
  assert.equal((await upload(cia, 'x.pdf', 'application/pdf')).status, 404, 'Cia är inte med');
  const big = await upload(anna, 'stor.pdf', 'application/pdf', 'x'.repeat(10 * 1024 * 1024 + 1));
  assert.equal(big.status, 413);

  const f = ok(await upload(anna, 'Kallelse match.pdf', 'application/pdf', '%PDF-1.4 test')).file;
  assert.equal(f.name, 'Kallelse match.pdf');
  // Inte skickad än: bara den som laddade upp kan hämta den
  assert.equal((await s.api('GET', `/api/chat/files/${f.id}`, { token: bo })).status, 404);
  // Bo kan inte skicka Annas fil
  assert.equal((await send(bo, c.id, '', { attachments: [f.id] })).status, 400);
  const m = ok(await send(anna, c.id, '', { attachments: [f.id] })).message;
  assert.deepEqual(m.attachments.map((x) => x.name), ['Kallelse match.pdf']);
  const got = await s.api('GET', `/api/chat/files/${f.id}`, { token: bo });
  assert.equal(got.status, 200);
  assert.equal(got.text, '%PDF-1.4 test');
  for (const t of [cia, root, undefined]) {
    assert.notEqual((await s.api('GET', `/api/chat/files/${f.id}`, { token: t })).status, 200);
  }
  assert.equal(ok(await list(bo)).conversations.find((x) => x.id === c.id).lastMessage.text, '📎 Kallelse match.pdf');

  // Tas meddelandet bort raderas filen
  const stored = fs.readdirSync(path.join(s.dataDir, 'chat_files'));
  assert.equal(stored.length, 1);
  ok(await s.api('DELETE', `/api/chat/${c.id}/messages/${m.seq}`, { token: anna }));
  assert.equal(fs.readdirSync(path.join(s.dataDir, 'chat_files')).length, 0);
  assert.equal((await s.api('GET', `/api/chat/files/${f.id}`, { token: bo })).status, 404);
});

test('chatt: anmälan – tränaren ser bara det anmälda meddelandet och kan ta bort det', async () => {
  const c = ok(await start(bo, [annaId])).conversation;
  ok(await send(bo, c.id, 'Hej'));
  const bad = ok(await send(bo, c.id, 'Något olämpligt')).message;
  ok(await send(bo, c.id, 'Sista'));
  assert.equal((await s.api('POST', `/api/chat/${c.id}/messages/${bad.seq}/report`, { token: bo, body: {} })).status, 400, 'inte egna');
  ok(await s.api('POST', `/api/chat/${c.id}/messages/${bad.seq}/report`, { token: anna, body: { reason: 'Elakt' } }));

  // Spelare och tränare i annat lag ser inga anmälningar; lagets tränare gör det
  assert.deepEqual(ok(await s.api('GET', '/api/chat/reports?clubId=klubb1', { token: cia })).reports, []);
  const reports = ok(await s.api('GET', '/api/chat/reports?clubId=klubb1', { token: coach })).reports;
  assert.equal(reports.length, 1);
  assert.equal(reports[0].message.body, 'Något olämpligt');
  assert.equal(reports[0].reason, 'Elakt');
  assert.ok(reports[0].context.length <= 5);
  assert.equal(ok(await s.api('GET', '/api/chat/summary?clubId=klubb1', { token: coach })).openReports, 1);
  // Tränaren kommer ändå inte åt hela chatten
  assert.equal((await s.api('GET', `/api/chat/${c.id}/messages`, { token: coach })).status, 404);

  assert.equal((await s.api('POST', `/api/chat/reports/${reports[0].id}`, { token: cia, body: { clubId: 'klubb1', action: 'remove' } })).status, 404);
  ok(await s.api('POST', `/api/chat/reports/${reports[0].id}`, { token: coach, body: { clubId: 'klubb1', action: 'remove' } }));
  const msgs = ok(await s.api('GET', `/api/chat/${c.id}/messages`, { token: anna })).messages;
  assert.equal(msgs.find((m) => m.seq === bad.seq).deleted, true);
  assert.deepEqual(ok(await s.api('GET', '/api/chat/reports?clubId=klubb1', { token: coach })).reports, []);
});

test('chatt: högst 30 meddelanden per minut', async () => {
  const c = ok(await start(cia, [boId], 'Spam')).conversation;
  let last;
  for (let i = 0; i < 31; i++) last = await send(cia, c.id, `nr ${i}`);
  assert.equal(last.status, 429);
});
