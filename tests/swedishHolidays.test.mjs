// Enhetstester för svenska helgdagar och veckonummer (src/utils/swedishHolidays.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easterSunday, holidayOn, getISOWeek, swedishHolidays } from '../src/utils/swedishHolidays.ts';

const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

test('påskdagen räknas rätt', () => {
  assert.equal(ymd(easterSunday(2025)), '2025-4-20');
  assert.equal(ymd(easterSunday(2026)), '2026-4-5');
  assert.equal(ymd(easterSunday(2027)), '2027-3-28');
  assert.equal(ymd(easterSunday(2028)), '2028-4-16');
});

test('rörliga och fasta helgdagar 2026', () => {
  const name = (y, m, d) => holidayOn(new Date(y, m - 1, d))?.name;
  assert.equal(name(2026, 4, 3), 'Långfredagen');
  assert.equal(name(2026, 4, 6), 'Annandag påsk');
  assert.equal(name(2026, 5, 14), 'Kristi himmelsfärd');
  assert.equal(name(2026, 5, 24), 'Pingstdagen');
  assert.equal(name(2026, 6, 19), 'Midsommarafton');
  assert.equal(name(2026, 6, 20), 'Midsommardagen');
  assert.equal(name(2026, 10, 31), 'Alla helgons dag');
  assert.equal(name(2026, 12, 24), 'Julafton');
  assert.equal(name(2026, 12, 26), 'Annandag jul');
  assert.equal(name(2026, 6, 6), 'Nationaldagen');
  assert.equal(name(2026, 10, 19), undefined);
  assert.equal(swedishHolidays(2027).size, 17);
});

test('veckonummer enligt ISO', () => {
  assert.equal(getISOWeek(new Date(2026, 9, 19)), 43);
  assert.equal(getISOWeek(new Date(2026, 11, 31)), 53);
  assert.equal(getISOWeek(new Date(2027, 0, 1)), 53);
  assert.equal(getISOWeek(new Date(2027, 0, 4)), 1);
});
