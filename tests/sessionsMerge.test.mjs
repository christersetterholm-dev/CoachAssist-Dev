// Enhetstester för sammanslagning av pass: på servern (server/sessionsMerge.ts) och efter kalendersynken
// i appen (src/utils/sessionMerge.ts). Bakgrund: en mobil med gammal kopia tömde ett planerat pass (okt 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSessionsDoc } from '../server/sessionsMerge.ts';
import { mergeSessionChanges } from '../src/utils/sessionMerge.ts';

const pass = (id, extra = {}) => ({ id, title: 'Träning', date: 1, startTime: '18:00', moments: [], createdAt: 1, updatedAt: 10, ...extra });
const planerat = pass('a', { moments: [{ id: 'm1', name: 'Uppvärmning' }], updatedAt: 20 });

test('servern behåller ett nyare pass när en gammal kopia skickas', () => {
  const prev = { sessions: [planerat, pass('b')], deletedSessions: [] };
  const { doc, kept } = mergeSessionsDoc(prev, { sessions: [pass('a'), pass('b', { title: 'Ny titel', updatedAt: 11 })], deletedSessions: [] });
  assert.deepEqual(kept, ['a']);
  assert.equal(doc.sessions.find((s) => s.id === 'a').moments.length, 1, 'planeringen finns kvar');
  assert.equal(doc.sessions.find((s) => s.id === 'b').title, 'Ny titel', 'nyare ändring går igenom');
});

test('servern: lika eller senare ändringstid går igenom, borttagning och papperskorg fungerar som förut', () => {
  const prev = { sessions: [planerat, pass('b')], deletedSessions: [pass('c')] };
  const { doc, kept } = mergeSessionsDoc(prev, { sessions: [{ ...planerat, title: 'Ändrad' }], deletedSessions: [pass('b', { deletedAt: 30 })] });
  assert.deepEqual(kept, []);
  assert.deepEqual(doc.sessions.map((s) => [s.id, s.title]), [['a', 'Ändrad']]);
  assert.deepEqual(doc.deletedSessions.map((s) => s.id), ['b'], 'c togs bort ur papperskorgen, b lades dit');
});

test('servern: en gammal kopia tar inte tillbaka ett pass ur papperskorgen, men återställning gör det', () => {
  const prev = { sessions: [], deletedSessions: [pass('a', { deletedAt: 50 })] };
  const stale = mergeSessionsDoc(prev, { sessions: [pass('a')], deletedSessions: [] });
  assert.deepEqual(stale.kept, ['a']);
  assert.deepEqual(stale.doc.sessions, []);
  assert.deepEqual(stale.doc.deletedSessions.map((s) => s.id), ['a']);
  const restored = mergeSessionsDoc(prev, { sessions: [pass('a', { updatedAt: 60 })], deletedSessions: [] });
  assert.deepEqual(restored.doc.sessions.map((s) => s.id), ['a']);
  assert.deepEqual(restored.doc.deletedSessions, []);
});

test('kalendersynken lägger bara in det den ändrade, ovanpå senaste versionen', () => {
  const before = [pass('a'), pass('b'), pass('borta')];
  // Synken (räknad på before): ny tid på a, b orörd, borta försvann ur kalendern, nytt pass n
  const after = [pass('a', { startTime: '11:00', updatedAt: 15 }), pass('b'), pass('n', { updatedAt: 15 })];
  // Under tiden: a planerades på en annan enhet, och pass x skapades
  const latest = [{ ...planerat, title: 'Träning' }, pass('b', { location: 'Hallen', updatedAt: 12 }), pass('borta'), pass('x')];
  const merged = mergeSessionChanges(before, after, latest);
  assert.deepEqual(merged.map((s) => s.id), ['a', 'b', 'x', 'n']);
  const a = merged[0];
  assert.equal(a.startTime, '11:00', 'kalenderns ändring kom med');
  assert.equal(a.moments.length, 1, 'planeringen finns kvar');
  assert.equal(a.updatedAt, 20);
  assert.equal(merged[1].location, 'Hallen', 'b orört av synken');
});

test('kalendersynken skriver inte över ett fält som ändrats på annat håll under tiden', () => {
  const before = [pass('a', { location: 'IP' })];
  const after = [pass('a', { location: 'Konstgräset', updatedAt: 15 })];
  const latest = [pass('a', { location: 'Hallen', updatedAt: 14 })];
  assert.equal(mergeSessionChanges(before, after, latest)[0].location, 'Hallen');
});
