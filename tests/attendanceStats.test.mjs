// Enhetstester för närvarostatistiken (src/utils/attendanceStats.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAttendanceStats, wasPresent } from '../src/utils/attendanceStats.ts';

const day = (d) => new Date(2026, 8, d, 12).getTime(); // september 2026
const pass = (id, d, extra = {}) => ({ id, title: '', date: day(d), startTime: '18:00', endTime: '19:30', moments: [], createdAt: 0, updatedAt: 0, ...extra });
const anna = { id: 'a', name: 'Anna' };
const bo = { id: 'b', name: 'Bo Ek' };
const tranare = { id: 'a_leader', name: 'Anna', role: 'leader' };
const now = new Date(2026, 8, 20, 12).getTime();

const sessions = [
  pass('t1', 1, { type: 'training', attendance: ['a', 'b'] }),
  pass('t2', 3, { type: 'training', attendance: ['a'], rsvps: { b: { status: 'attending', updatedAt: 1 } } }),
  pass('m1', 6, { type: 'match', attendance: ['a'] }),
  pass('o1', 8, { type: 'other', attendance: ['bo ek'] }), // gammal närvaro sparad som namn
  pass('ign', 9, { type: 'training', attendance: ['a'], isIgnored: true }),
  pass('fram', 25, { type: 'training', attendance: ['a'] }), // inte genomförd än
  pass('fore', 1, { type: 'training', date: new Date(2026, 7, 31, 12).getTime(), attendance: ['a'] }), // före perioden
];

test('räknar genomförda aktiviteter i perioden per person och typ', () => {
  const s = computeAttendanceStats({ sessions, people: [anna, bo], from: '2026-09-01', to: '2026-09-30', kinds: ['training', 'match', 'other'], now });
  assert.deepEqual(s.sessions.map((x) => x.id), ['t1', 't2', 'm1', 'o1']);
  assert.deepEqual(s.totals, { training: 2, match: 1, other: 1 });
  const [a, b] = s.people;
  assert.deepEqual([a.byKind, a.attended, a.percent], [{ training: 2, match: 1, other: 0 }, 3, 75]);
  assert.deepEqual([b.byKind, b.attended, b.percent, b.noShow], [{ training: 1, match: 0, other: 1 }, 2, 50, 1]);
  assert.equal(s.average, 63);
});

test('filtrerar på typ och tom period ger noll', () => {
  const s = computeAttendanceStats({ sessions, people: [anna], from: '2026-09-01', to: '2026-09-30', kinds: ['match'], now });
  assert.deepEqual([s.sessions.length, s.people[0].percent], [1, 100]);
  const tom = computeAttendanceStats({ sessions, people: [anna], from: '2027-01-01', to: '2027-01-31', kinds: ['training'], now });
  assert.deepEqual([tom.sessions.length, tom.people[0].percent, tom.average], [0, 0, 0]);
});

test('ledarrader räknas på grund-id:t', () => {
  assert.equal(wasPresent(pass('x', 1, { attendance: ['a'] }), tranare), true);
  assert.equal(wasPresent(pass('x', 1, { attendance: ['b'] }), tranare), false);
});
