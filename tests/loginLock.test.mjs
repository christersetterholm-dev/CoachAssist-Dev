// Spärr mot lösenordsgissning: efter 10 fel spärras kontot i 15 minuter, även om varje försök kommer från
// en ny (förfalskad) adress. Rätt lösenord före spärren nollställer räkningen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

let s;
const tryLogin = (email, password) => s.api('POST', '/api/auth/login', { body: { email, password } });

before(async () => {
  s = await startServer();
  await s.register('gissad@test.se', 'RattLosen123');
  await s.register('annan@test.se', 'RattLosen123');
});
after(() => s?.stop());

test('rätt lösenord nollställer felräkningen', async () => {
  for (let i = 0; i < 9; i++) assert.equal((await tryLogin('annan@test.se', `fel${i}`)).status, 400);
  assert.equal((await tryLogin('annan@test.se', 'RattLosen123')).status, 200);
  for (let i = 0; i < 9; i++) assert.equal((await tryLogin('annan@test.se', `fel${i}`)).status, 400);
  assert.equal((await tryLogin('annan@test.se', 'RattLosen123')).status, 200);
});

test('tio fel från olika adresser spärrar kontot, även för rätt lösenord', async () => {
  // helpers skickar en ny X-Forwarded-For för varje anrop, som en angripare som byter adress
  for (let i = 0; i < 10; i++) assert.equal((await tryLogin('gissad@test.se', `Coach${1000 + i}`)).status, 400);
  const locked = await tryLogin('gissad@test.se', 'RattLosen123');
  assert.equal(locked.status, 429);
  assert.match(locked.json.error, /för många/i);
  // Andra konton påverkas inte
  assert.equal((await tryLogin('annan@test.se', 'RattLosen123')).status, 200);
});

test('avsändaren tas från sista adressen i X-Forwarded-For', async () => {
  // Samma riktiga adress sist, olika påhittade först: räknas som samma avsändare
  let last;
  for (let i = 0; i < 11; i++) {
    last = await s.api('POST', '/api/auth/login', { body: { email: `finns-inte${i}@test.se`, password: 'x' }, headers: { 'X-Forwarded-For': `10.9.${i}.1, 203.0.113.7` } });
  }
  assert.equal(last.status, 429, 'den elfte från samma adress stoppas av adressspärren');
});
