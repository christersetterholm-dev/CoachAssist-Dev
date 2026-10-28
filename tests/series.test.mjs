// Enhetstester för serier och ändring av flera pass (src/components/sessions/seriesUtils.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChanges, changedFields, describeSeries, extendSeries, seriesSessions } from '../src/components/sessions/seriesUtils.ts';

const day = (n) => new Date(2026, 8, 1 + n, 12).getTime(); // tisdag 1 september 2026 + n dagar
const pass = (id, n, extra = {}) => ({ id, seriesId: 's1', title: 'Träning', date: day(n), startTime: '18:30', endTime: '20:00', location: 'IP', moments: [], createdAt: 0, updatedAt: 0, ...extra });

test('changedFields ser bara de fält som ändrats, och LOK räknas som ja när det saknas', () => {
  const a = pass('a', 0);
  assert.deepEqual(changedFields(a, { ...a, location: 'Hallen', lok: false }), { location: 'Hallen', lok: false });
  assert.deepEqual(changedFields(a, { ...a, lok: undefined }), {});
  assert.deepEqual(changedFields(a, { ...a, date: day(3) }), {}, 'datum följer inte med');
});

test('applyChanges: pass som ändrats för hand behåller sin ändring, om man inte skriver över', () => {
  const before = pass('a', 0);
  const others = [pass('b', 2), pass('c', 7, { location: 'Konstgräset' })];
  const kept = applyChanges(others, { location: 'Hallen', lok: false }, before);
  assert.deepEqual(kept.map((s) => [s.location, s.lok]), [['Hallen', false], ['Konstgräset', false]]);
  const all = applyChanges(others, { location: 'Hallen' });
  assert.deepEqual(all.map((s) => s.location), ['Hallen', 'Hallen']);
  assert.equal(applyChanges(others, { lok: true })[0].lok, undefined, 'LOK ja sparas som saknat fält');
  assert.deepEqual(applyChanges(others, { type: 'match' }).map((s) => [s.type, s.category]), [['match', 'match'], ['match', 'match']]);
});

test('en serie kan förlängas på samma veckodagar och beskrivas', () => {
  const list = [pass('a', 0), pass('b', 2, { startTime: '19:00' }), pass('c', 7), pass('d', 9, { startTime: '19:00' })]; // tis + tor
  const sorted = seriesSessions([...list, pass('x', 1, { seriesId: 'annan' })], 's1');
  assert.deepEqual(sorted.map((s) => s.id), ['a', 'b', 'c', 'd']);
  assert.match(describeSeries(sorted), /^Träning · tis, tor · /);
  const more = extendSeries(sorted, '2026-09-24'); // två veckor till
  assert.deepEqual(more.map((s) => [new Date(s.date).getDate(), s.startTime]), [[15, '18:30'], [17, '19:00'], [22, '18:30'], [24, '19:00']]);
  assert.ok(more.every((s) => s.seriesId === 's1' && s.moments.length === 0 && !s.rsvps && !s.attendance));
});
