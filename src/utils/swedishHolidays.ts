// Svenska helgdagar ("röda dagar") och några afton-dagar, plus datumhjälp för kalendern.
// Räknas fram i appen (påsken med den vanliga formeln), så ingen internetkoppling behövs.

export const SWEDISH_MONTHS = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December',
];

// ISO-veckonummer (måndag första dag, vecka 1 innehåller årets första torsdag).
export function getISOWeek(date: Date): number {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export interface Holiday {
  name: string;
  /** Röd dag (helgdag). Aftnar som midsommarafton och julafton räknas också som röda i kalendern. */
  red: boolean;
}

// Påskdagen (gregoriansk kalender, "Anonymous Gregorian algorithm").
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const key = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Första lördag/fredag från och med ett datum.
const firstWeekdayFrom = (d: Date, weekday: number) => addDays(d, (weekday - d.getDay() + 7) % 7);

const cache = new Map<number, Map<string, Holiday>>();

export function swedishHolidays(year: number): Map<string, Holiday> {
  const cached = cache.get(year);
  if (cached) return cached;
  const out = new Map<string, Holiday>();
  const add = (d: Date, name: string, red = true) => out.set(key(d), { name, red });
  const easter = easterSunday(year);
  add(new Date(year, 0, 1), 'Nyårsdagen');
  add(new Date(year, 0, 6), 'Trettondedag jul');
  add(addDays(easter, -2), 'Långfredagen');
  add(addDays(easter, -1), 'Påskafton');
  add(easter, 'Påskdagen');
  add(addDays(easter, 1), 'Annandag påsk');
  add(new Date(year, 4, 1), 'Första maj');
  add(addDays(easter, 39), 'Kristi himmelsfärd');
  add(addDays(easter, 49), 'Pingstdagen');
  add(new Date(year, 5, 6), 'Nationaldagen');
  const midsummerDay = firstWeekdayFrom(new Date(year, 5, 20), 6); // lördag 20–26 juni
  add(addDays(midsummerDay, -1), 'Midsommarafton');
  add(midsummerDay, 'Midsommardagen');
  add(firstWeekdayFrom(new Date(year, 9, 31), 6), 'Alla helgons dag'); // lördag 31 okt–6 nov
  add(new Date(year, 11, 24), 'Julafton');
  add(new Date(year, 11, 25), 'Juldagen');
  add(new Date(year, 11, 26), 'Annandag jul');
  add(new Date(year, 11, 31), 'Nyårsafton');
  cache.set(year, out);
  return out;
}

export function holidayOn(date: Date): Holiday | null {
  return swedishHolidays(date.getFullYear()).get(key(date)) || null;
}
