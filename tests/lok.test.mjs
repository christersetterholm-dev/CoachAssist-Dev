// Enhetstester för närvarokorten (server/lok.ts): RF:s regler för statligt LOK-stöd och kommunala regler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCard, parsePersonnummer, parsePeriod, cleanRules, STATE_RULES, MUNICIPAL_DEFAULTS } from '../server/lok.ts';

const now = new Date(2026, 11, 31, 23).getTime();
const period = parsePeriod('2026-2');
// Måndag 7 september 2026 + dagar
const day = (n) => new Date(2026, 8, 7 + n, 12).getTime();
const pass = (id, n, attendance, extra = {}) => ({ id, title: 'Träning', type: 'training', date: day(n), startTime: '18:00', endTime: '19:30', attendance, ...extra });
const ung = (id, extra = {}) => ({ id, name: id, personnummer: '20080101-1234', role: 'participant', ...extra }); // 18 år, man
const ledare = { id: 'L', name: 'Ledare', personnummer: '19800101-1220', role: 'leader' };
const card = (sessions, people, rules = STATE_RULES) => computeCard({ rules, sessions, people, from: period.from, to: period.to, now });

test('personnummer ger födelseår och kön', () => {
  assert.deepEqual(parsePersonnummer('980324-8559', 2026), { birthYear: 1998, gender: 'male' });
  assert.deepEqual(parsePersonnummer('20100101-1224', 2026), { birthYear: 2010, gender: 'female' });
  assert.deepEqual(parsePersonnummer('150101-1234', 2026), { birthYear: 2015, gender: 'male' });
  assert.deepEqual(parsePersonnummer('150101+1234', 2026), { birthYear: 1915, gender: 'male' });
  assert.deepEqual(parsePersonnummer('2010-05-05', 2026), { birthYear: 2010, gender: null });
  assert.deepEqual(parsePersonnummer('', 2026), { birthYear: null, gender: null });
  assert.deepEqual(parsePersonnummer('20101301-1234', 2026), { birthYear: null, gender: null });
});

test('sammankomst kräver ledare, tre deltagare i rätt ålder och 45 minuter', () => {
  const people = [ung('a'), ung('b'), ung('c'), ung('gammal', { personnummer: '19900101-1234' }), ledare];
  const r = card([
    pass('ok', 0, ['a', 'b', 'c', 'gammal', 'L']),
    pass('fa', 1, ['a', 'b', 'gammal', 'L']),
    pass('utanledare', 2, ['a', 'b', 'c']),
    pass('kort', 3, ['a', 'b', 'c', 'L'], { endTime: '18:30' }),
    pass('ejlok', 4, ['a', 'b', 'c', 'L'], { lok: false }),
  ], people);
  assert.deepEqual(r.activities.map((a) => [a.id, a.approved, a.reason]), [
    ['ok', true, null],
    ['fa', false, 'Färre än 3 deltagare i rätt ålder'],
    ['utanledare', false, 'Ingen ledare närvarande'],
    ['kort', false, 'Kortare än 45 min'],
  ]);
  assert.deepEqual(r.participants.find((p) => p.id === 'gammal').cells, ['(1)', '(1)', 'x', 'x']);
  assert.deepEqual(r.participants.find((p) => p.id === 'a').cells, ['1', '(1)', '(1)', '(1)']);
  assert.deepEqual(r.leaders[0].cells, ['1', '(1)', 'x', '(1)']);
  assert.deepEqual(r.totals, { gatherings: 1, participantOccasions: 3, leaderOccasions: 1 });
  assert.equal(r.warnings.notLok, 1);
  assert.deepEqual(r.warnings.tooShort, ['kort']);
  // 18-åringar (män) i gruppen 10–25
  assert.deepEqual([r.groups.participants.labels[2], r.groups.participants.male[2]], ['10–25', 3]);
  assert.deepEqual([r.groups.leaders.labels[2], r.groups.leaders.female[2]], ['36–50', 1]);
});

test('en gång per dag, högst 5 per vecka för 10–25 år och högst 20 per ledare', () => {
  const many = Array.from({ length: 21 }, (_, i) => ung(`p${i}`));
  const all = [...many.map((p) => p.id), 'L'];
  const r = card([
    pass('d0a', 0, all), pass('d0b', 0, all, { startTime: '20:00', endTime: '21:00' }),
    pass('d1', 1, all), pass('d2', 2, all), pass('d3', 3, all), pass('d4', 4, all), pass('d5', 5, all),
  ], [...many, ledare]);
  // p20 fick inte plats första passet men räknas samma dag på det andra, och har tak kvar dag 5
  assert.deepEqual(r.activities.map((a) => a.counted), [20, 1, 20, 20, 20, 20, 1]);
  // p0: räknas dag 0, inte igen samma dag, sedan dag 1–4, dag 5 = sjätte tillfället i veckan (tak 5)
  assert.deepEqual(r.participants[0].cells, ['1', '(1)', '1', '1', '1', '1', '(1)']);
  assert.equal(r.participants[20].cells[0], '(1)', 'den 21:a deltagaren räknas inte med en ledare');
});

test('funktionsnedsättning saknar övre åldersgräns, saknat personnummer varnas', () => {
  const people = [ung('a'), ung('b'), ung('vuxen', { personnummer: '19700101-1234', disability: true }), ung('okand', { personnummer: '' }), ledare];
  const r = card([pass('x', 0, ['a', 'b', 'vuxen', 'okand', 'L'])], people);
  assert.equal(r.activities[0].counted, 3);
  assert.deepEqual(r.warnings.noBirthYear, ['okand']);
});

test('kommunala regler rensas och används', () => {
  const rules = cleanRules({ enabled: true, minAge: 7, maxAge: 20, minParticipants: 3, minMinutes: 60, maxParticipants: '30', participantGroups: [21, 0, 7, 13, 17], weeklyCaps: 'fel' });
  assert.deepEqual([rules.maxParticipants, rules.participantGroups, rules.weeklyCaps, rules.onePerDay], [30, [0, 7, 13, 17, 21], [], true]);
  assert.equal(cleanRules({ minAge: 10, maxAge: 5 }).maxAge, 10);
  const r = card([pass('x', 0, ['a', 'b', 'c', 'L'])], [ung('a'), ung('b'), ung('c'), ledare], { ...MUNICIPAL_DEFAULTS, enabled: true });
  assert.equal(r.activities[0].reason, null, '18-åringar (7–20 år) och 90 minuter (minst 60) godkänns');
  const kort = card([pass('y', 0, ['a', 'b', 'c', 'L'], { endTime: '18:50' })], [ung('a'), ung('b'), ung('c'), ledare], { ...MUNICIPAL_DEFAULTS, enabled: true });
  assert.equal(kort.activities[0].reason, 'Kortare än 60 min');
});
