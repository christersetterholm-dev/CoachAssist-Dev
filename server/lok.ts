/**
 * Närvarokort för lokalt aktivitetsstöd (LOK-stöd), statligt och kommunalt.
 *
 * Statligt: RF:s föreskrifter som gäller fr.o.m. 2025-07-01 (STATE_RULES). Kommunalt: föreningen fyller i sin
 * kommuns regler i Administration (sparas i system_docs, lok_rules/<förening>). Korten räknas fram ur lagets pass,
 * närvaron (tabellen attendance) och medlemsregistret (personnummer, kön, funktionsnedsättning).
 * Ett kort kan intygas och låsas (tabellen lok_locks); låsningen sparar summorna så att ändringar syns.
 *
 * Truppio skickar inget till RF – statligt LOK-stöd söks i RF:s system. Korten är underlag.
 */
import type { Db } from './database.ts';

export type CardType = 'state' | 'municipal';
export type Cell = '1' | '(1)' | 'x';

export interface LokRules {
  enabled: boolean;
  /** Deltagare som under kalenderåret fyller lägst/högst. */
  minAge: number;
  maxAge: number;
  /** Deltagare med funktionsnedsättning har ingen övre åldersgräns. */
  disabilityNoUpperAge: boolean;
  leaderMinAge: number;
  minParticipants: number;
  minMinutes: number;
  /** Högst så många deltagare räknas per närvarande ledare (null = ingen gräns). */
  maxPerLeader: number | null;
  /** Högst så många deltagare räknas per sammankomst (null = ingen gräns). */
  maxParticipants: number | null;
  /** En deltagare räknas högst en gång per dag. */
  onePerDay: boolean;
  /** Högst så många tillfällen per kalendervecka och deltagare, efter ålder (första regeln där åldern ≤ maxAge). */
  weeklyCaps: { maxAge: number; max: number }[];
  /** Åldersgrupper i summeringen (lägsta ålder i varje grupp). */
  participantGroups: number[];
  leaderGroups: number[];
}

export const STATE_RULES: LokRules = {
  enabled: true,
  minAge: 6, maxAge: 25, disabilityNoUpperAge: true,
  leaderMinAge: 13, minParticipants: 3, minMinutes: 45,
  maxPerLeader: 20, maxParticipants: null, onePerDay: true,
  weeklyCaps: [{ maxAge: 9, max: 3 }, { maxAge: 999, max: 5 }],
  participantGroups: [0, 6, 10, 26, 51],
  leaderGroups: [13, 26, 36, 51, 66],
};

export const MUNICIPAL_DEFAULTS: LokRules = {
  enabled: false,
  minAge: 7, maxAge: 20, disabilityNoUpperAge: false,
  leaderMinAge: 13, minParticipants: 3, minMinutes: 60,
  maxPerLeader: null, maxParticipants: 30, onePerDay: true,
  weeklyCaps: [],
  participantGroups: [0, 7, 13, 17, 21],
  leaderGroups: [13, 21, 36, 51, 66],
};

const int = (v: any, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const optInt = (v: any, min: number, max: number) => (v === null || v === '' || v === undefined ? null : int(v, min, max, min));
const groups = (v: any, fallback: number[]) => {
  if (!Array.isArray(v)) return fallback;
  const list = Array.from(new Set(v.map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= 0 && x <= 120))).sort((a, b) => a - b);
  return list.length >= 1 && list.length <= 8 ? list : fallback;
};

/** Gör om inskickade kommunala regler till giltiga värden. */
export function cleanRules(v: any, d: LokRules = MUNICIPAL_DEFAULTS): LokRules {
  const r = v && typeof v === 'object' ? v : {};
  const minAge = int(r.minAge, 0, 100, d.minAge);
  return {
    enabled: !!r.enabled,
    minAge,
    maxAge: Math.max(minAge, int(r.maxAge, 0, 120, d.maxAge)),
    disabilityNoUpperAge: !!r.disabilityNoUpperAge,
    leaderMinAge: int(r.leaderMinAge, 0, 100, d.leaderMinAge),
    minParticipants: int(r.minParticipants, 1, 100, d.minParticipants),
    minMinutes: int(r.minMinutes, 0, 600, d.minMinutes),
    maxPerLeader: optInt(r.maxPerLeader, 1, 500),
    maxParticipants: optInt(r.maxParticipants, 1, 500),
    onePerDay: r.onePerDay === undefined ? d.onePerDay : !!r.onePerDay,
    weeklyCaps: Array.isArray(r.weeklyCaps)
      ? r.weeklyCaps.slice(0, 5).map((c: any) => ({ maxAge: int(c?.maxAge, 0, 999, 999), max: int(c?.max, 1, 14, 5) })).sort((a: any, b: any) => a.maxAge - b.maxAge)
      : d.weeklyCaps,
    participantGroups: groups(r.participantGroups, d.participantGroups),
    leaderGroups: groups(r.leaderGroups, d.leaderGroups),
  };
}

// ---------------------------------------------------------------------------
// Personnummer
// ---------------------------------------------------------------------------

/** Födelseår och kön ur ett personnummer (ÅÅÅÅMMDD-XXXX, ÅÅMMDD-XXXX eller bara födelsedatum). */
export function parsePersonnummer(pnr: string | null | undefined, refYear = new Date().getFullYear()): { birthYear: number | null; gender: 'female' | 'male' | null } {
  const raw = String(pnr || '');
  const digits = raw.replace(/\D/g, '');
  let birthYear: number | null = null;
  let month = 0;
  let serial = '';
  if (digits.length === 12 || digits.length === 8) {
    birthYear = Number(digits.slice(0, 4));
    month = Number(digits.slice(4, 6));
    serial = digits.slice(8);
  } else if (digits.length === 10 || digits.length === 6) {
    const yy = Number(digits.slice(0, 2));
    birthYear = 2000 + yy > refYear ? 1900 + yy : 2000 + yy;
    if (raw.includes('+')) birthYear -= 100;
    month = Number(digits.slice(2, 4));
    serial = digits.slice(6);
  }
  if (birthYear !== null && (birthYear < 1900 || birthYear > refYear || month < 1 || month > 12)) return { birthYear: null, gender: null };
  const gender = serial.length === 4 ? (Number(serial[2]) % 2 === 1 ? 'male' : 'female') : null;
  return { birthYear, gender };
}

// ---------------------------------------------------------------------------
// Uträkningen
// ---------------------------------------------------------------------------

export interface CardPerson {
  id: string;
  name: string;
  personnummer?: string | null;
  gender?: string | null;
  disability?: boolean;
  /** participant = spelare, leader = tränare/ledare */
  role: 'participant' | 'leader';
}

export interface CardSession {
  id: string;
  title?: string;
  type?: string;
  category?: string;
  date: number;
  startTime?: string;
  endTime?: string;
  isIgnored?: boolean;
  lok?: boolean;
  location?: string;
  lineupId?: string;
  attendance: string[];
}

export interface CardActivity {
  id: string; title: string; kind: 'training' | 'match' | 'other'; date: number; startTime: string; endTime: string;
  location: string; approved: boolean; reason: string | null; counted: number; leaders: number;
}
export interface CardRow { id: string; name: string; personnummer: string; cells: Cell[]; total: number }
export interface GroupTable { labels: string[]; female: number[]; male: number[]; unknown: number[] }
/** Antal aktiviteter per närvarokort (som pappersblanketten och laget.se). */
export const PER_CARD = 25;

export interface CardSummary {
  totals: { gatherings: number; participantOccasions: number; leaderOccasions: number };
  groups: { participants: GroupTable; leaders: GroupTable };
}
export interface CardResult extends CardSummary {
  activities: CardActivity[];
  participants: CardRow[];
  leaders: CardRow[];
  /** Summering per kort (25 aktiviteter), som laget.se visar längst ner på varje kort. */
  pages: CardSummary[];
  warnings: { noEndTime: string[]; tooShort: string[]; noBirthYear: string[]; noGender: string[]; notLok: number };
}

const minutesOf = (t?: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const atMinutes = (date: number, m: number) => {
  const d = new Date(date);
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d.getTime();
};
const startTs = (s: CardSession) => atMinutes(s.date, minutesOf(s.startTime) ?? 0);
const endTs = (s: CardSession) => {
  const end = minutesOf(s.endTime);
  return end !== null ? atMinutes(s.date, end) : startTs(s) + 2 * 3600000;
};
const dayKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
// Kalendervecka måndag–söndag: måndagens datum
const weekKey = (ts: number) => { const d = new Date(ts); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(d.getTime()); };

const kindOf = (s: CardSession): 'training' | 'match' | 'other' => {
  const t = String(s.type || s.category || '').toLowerCase();
  if (s.lineupId || t === 'match' || t === 'cup') return 'match';
  if (t === 'other') return 'other';
  if (t === 'training') return 'training';
  return /match|cup|turnering|sammandrag|derby/i.test(s.title || '') ? 'match' : 'training';
};

export const groupLabels = (bounds: number[]) => bounds.map((b, i) => (i < bounds.length - 1 ? `${b}–${bounds[i + 1] - 1}` : `${b}–`));
const groupIndex = (bounds: number[], age: number) => {
  let idx = -1;
  bounds.forEach((b, i) => { if (age >= b) idx = i; });
  return idx;
};

/** Räknar fram ett närvarokort. from/to är tidsstämplar (till och med), now = bara genomförda aktiviteter. */
export function computeCard(opts: { rules: LokRules; sessions: CardSession[]; people: CardPerson[]; from: number; to: number; now?: number }): CardResult {
  const { rules } = opts;
  const now = opts.now ?? Date.now();
  const inPeriod = opts.sessions.filter((s) => s && !s.isIgnored && startTs(s) >= opts.from && startTs(s) <= opts.to);
  const notLok = inPeriod.filter((s) => s.lok === false).length;
  const sessions = inPeriod
    .filter((s) => s.lok !== false && endTs(s) < now)
    .sort((a, b) => startTs(a) - startTs(b));

  const info = new Map(opts.people.map((p) => {
    const parsed = parsePersonnummer(p.personnummer);
    const gender = p.gender === 'female' || p.gender === 'male' ? p.gender : parsed.gender;
    return [p.id, { birthYear: parsed.birthYear, gender }];
  }));
  const ageAt = (id: string, ts: number) => {
    const by = info.get(id)?.birthYear;
    return by ? new Date(ts).getFullYear() - by : null;
  };
  const participants = opts.people.filter((p) => p.role === 'participant');
  const leaders = opts.people.filter((p) => p.role === 'leader');
  const pIndex = new Map(participants.map((p, i) => [p.id, i]));
  const lIndex = new Map(leaders.map((p, i) => [p.id, i]));

  const pRows: CardRow[] = participants.map((p) => ({ id: p.id, name: p.name, personnummer: p.personnummer || '', cells: [], total: 0 }));
  const lRows: CardRow[] = leaders.map((p) => ({ id: p.id, name: p.name, personnummer: p.personnummer || '', cells: [], total: 0 }));
  const empty = (bounds: number[]): GroupTable => ({ labels: groupLabels(bounds), female: bounds.map(() => 0), male: bounds.map(() => 0), unknown: bounds.map(() => 0) });
  const pGroups = empty(rules.participantGroups);
  const lGroups = empty(rules.leaderGroups);
  const pages: CardSummary[] = [];
  const pageOf = (n: number) => {
    const i = Math.floor(n / PER_CARD);
    if (!pages[i]) pages[i] = { totals: { gatherings: 0, participantOccasions: 0, leaderOccasions: 0 }, groups: { participants: empty(rules.participantGroups), leaders: empty(rules.leaderGroups) } };
    return pages[i];
  };
  // Räknar ett tillfälle i rätt åldersgrupp, både för hela perioden och för kortet aktiviteten står på
  const addGroup = (kind: 'participants' | 'leaders', id: string, ts: number, page: CardSummary) => {
    const bounds = kind === 'participants' ? rules.participantGroups : rules.leaderGroups;
    const age = ageAt(id, ts);
    if (age === null) return;
    const i = groupIndex(bounds, age);
    if (i < 0) return;
    const g = info.get(id)?.gender;
    const key = g === 'female' ? 'female' : g === 'male' ? 'male' : 'unknown';
    (kind === 'participants' ? pGroups : lGroups)[key][i]++;
    page.groups[kind][key][i]++;
  };

  const countedDays = new Map<string, Set<string>>();
  const weekCounts = new Map<string, Map<string, number>>();
  const usedPeople = new Set<string>();
  const noEndTime: string[] = [];
  const tooShort: string[] = [];
  const activities: CardActivity[] = [];

  for (const s of sessions) {
    const ts = startTs(s);
    const page = pageOf(activities.length);
    const present = new Set((s.attendance || []).map((id) => String(id).replace(/_leader$/, '')));
    const start = minutesOf(s.startTime);
    const end = minutesOf(s.endTime);
    const minutes = start !== null && end !== null ? end - start : null;
    if (minutes === null) noEndTime.push(s.id);
    else if (minutes < rules.minMinutes) tooShort.push(s.id);

    const presentLeaders = leaders.filter((l) => present.has(l.id));
    const okLeaders = presentLeaders.filter((l) => { const a = ageAt(l.id, ts); return a === null || a >= rules.leaderMinAge; });
    const presentParticipants = participants.filter((p) => present.has(p.id));
    presentParticipants.forEach((p) => usedPeople.add(p.id));
    presentLeaders.forEach((l) => usedPeople.add(l.id));
    const ageOk = (p: CardPerson) => {
      const a = ageAt(p.id, ts);
      if (a === null || a < rules.minAge) return false;
      return a <= rules.maxAge || (rules.disabilityNoUpperAge && !!p.disability);
    };
    const eligible = presentParticipants.filter(ageOk);
    // Den som redan räknats på en aktivitet samma dag räknas inte igen och inte heller till de tre som krävs
    // (som laget.se: dagens första aktivitet gäller). Den som nått veckotaket räknas däremot med (RF 6 §).
    const day = dayKey(ts), week = weekKey(ts);
    const notToday = eligible.filter((p) => !(rules.onePerDay && countedDays.get(p.id)?.has(day)));

    let reason: string | null = null;
    if (minutes === null) reason = 'Sluttid saknas';
    else if (minutes < rules.minMinutes) reason = `Kortare än ${rules.minMinutes} min`;
    else if (okLeaders.length === 0) reason = 'Ingen ledare närvarande';
    else if (notToday.length < rules.minParticipants) {
      reason = eligible.length >= rules.minParticipants
        ? `Färre än ${rules.minParticipants} deltagare som inte redan räknats samma dag`
        : `Färre än ${rules.minParticipants} deltagare i rätt ålder`;
    }
    const approved = reason === null;

    // Vilka som räknas (eller skulle ha räknats om aktiviteten hade godkänts – visas inom parentes i summan)
    const counted = new Set<string>();
    let limit = Infinity;
    if (rules.maxPerLeader) limit = Math.min(limit, rules.maxPerLeader * Math.max(1, okLeaders.length));
    if (rules.maxParticipants) limit = Math.min(limit, rules.maxParticipants);
    for (const p of notToday) {
      if (counted.size >= limit) break;
      const age = ageAt(p.id, ts)!;
      const cap = rules.weeklyCaps.find((c) => age <= c.maxAge)?.max;
      const used = weekCounts.get(p.id)?.get(week) || 0;
      if (cap !== undefined && used >= cap) continue;
      counted.add(p.id);
      if (approved) {
        if (!countedDays.has(p.id)) countedDays.set(p.id, new Set());
        countedDays.get(p.id)!.add(day);
        if (!weekCounts.has(p.id)) weekCounts.set(p.id, new Map());
        weekCounts.get(p.id)!.set(week, used + 1);
        addGroup('participants', p.id, ts, page);
      }
    }
    for (const p of participants) {
      const row = pRows[pIndex.get(p.id)!];
      if (approved && counted.has(p.id)) { row.cells.push('1'); row.total++; page.totals.participantOccasions++; } else row.cells.push(present.has(p.id) ? '(1)' : 'x');
    }
    const countedLeaders = approved ? okLeaders : [];
    for (const l of leaders) {
      const row = lRows[lIndex.get(l.id)!];
      if (countedLeaders.includes(l)) { row.cells.push('1'); row.total++; page.totals.leaderOccasions++; addGroup('leaders', l.id, ts, page); } else row.cells.push(present.has(l.id) ? '(1)' : 'x');
    }
    if (approved) page.totals.gatherings++;
    activities.push({
      id: s.id, title: s.title || '', kind: kindOf(s), date: s.date, startTime: s.startTime || '', endTime: s.endTime || '',
      location: s.location || '', approved, reason, counted: counted.size, leaders: okLeaders.length,
    });
  }

  const people = opts.people.filter((p) => usedPeople.has(p.id));
  return {
    activities,
    participants: pRows,
    leaders: lRows,
    totals: {
      gatherings: activities.filter((a) => a.approved).length,
      participantOccasions: pRows.reduce((n, r) => n + r.total, 0),
      leaderOccasions: lRows.reduce((n, r) => n + r.total, 0),
    },
    groups: { participants: pGroups, leaders: lGroups },
    pages,
    warnings: {
      noEndTime, tooShort,
      noBirthYear: people.filter((p) => !info.get(p.id)?.birthYear).map((p) => p.name),
      noGender: people.filter((p) => info.get(p.id)?.birthYear && !info.get(p.id)?.gender).map((p) => p.name),
      notLok,
    },
  };
}

// ---------------------------------------------------------------------------
// Perioder (halvår) och data ur databasen
// ---------------------------------------------------------------------------

/** "2026-2" = 1 juli–31 december 2026, "2026-1" = 1 januari–30 juni. */
export function parsePeriod(p: any): { from: number; to: number; label: string } | null {
  const m = /^(\d{4})-([12])$/.exec(String(p || ''));
  if (!m) return null;
  const y = Number(m[1]);
  if (y < 2000 || y > 2100) return null;
  return m[2] === '1'
    ? { from: new Date(y, 0, 1).getTime(), to: new Date(y, 5, 30, 23, 59, 59).getTime(), label: `${y}, 1 januari – 30 juni` }
    : { from: new Date(y, 6, 1).getTime(), to: new Date(y, 11, 31, 23, 59, 59).getTime(), label: `${y}, 1 juli – 31 december` };
}

export function getRules(db: Db, clubId: string): { state: LokRules; municipal: LokRules } {
  const row: any = db.prepare('SELECT data FROM system_docs WHERE path = ?').get(`lok_rules/${clubId}`);
  let municipal = MUNICIPAL_DEFAULTS;
  try { if (row) municipal = cleanRules(JSON.parse(row.data)); } catch { /* standard */ }
  return { state: STATE_RULES, municipal };
}

export function saveMunicipalRules(db: Db, clubId: string, rules: any): LokRules {
  const clean = cleanRules(rules);
  db.prepare(
    `INSERT INTO system_docs (path, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`
  ).run(`lok_rules/${clubId}`, JSON.stringify(clean), Date.now());
  return clean;
}

/** Lagets pass (med närvaro ur tabellen) och personer (spelare = deltagare, tränare = ledare). */
export function loadTeam(db: Db, clubId: string, teamId: string): { sessions: CardSession[]; people: CardPerson[] } {
  const row: any = db.prepare(`SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = 'sessions'`).get(clubId, teamId);
  let doc: any = null;
  try { doc = row ? JSON.parse(row.data) : null; } catch { doc = null; }
  const list: any[] = Array.isArray(doc) ? doc : (doc?.sessions || []);
  const att = new Map<string, string[]>();
  for (const r of db.prepare('SELECT session_id, member_id FROM attendance WHERE club_id = ? AND team_id = ? AND present = 1').all(clubId, teamId)) {
    if (!att.has(r.session_id)) att.set(r.session_id, []);
    att.get(r.session_id)!.push(r.member_id);
  }
  const sessions: CardSession[] = list.filter((s) => s && s.id && Number.isFinite(Number(s.date))).map((s) => ({
    id: String(s.id), title: s.title, type: s.type, category: s.category, date: Number(s.date), startTime: s.startTime, endTime: s.endTime,
    isIgnored: !!s.isIgnored, lok: s.lok, location: s.location, lineupId: s.lineupId, attendance: att.get(String(s.id)) || [],
  }));
  const rows = db.prepare(
    `SELECT m.id, m.full_name, m.personnummer, m.gender, m.disability, r.role FROM team_roles r JOIN members m ON m.id = r.member_id
     WHERE r.club_id = ? AND r.team_id = ? AND r.role IN ('player','coach','leader') ORDER BY r.sort, m.full_name COLLATE NOCASE`
  ).all(clubId, teamId);
  // Den som är både spelare och tränare/ledare står bland deltagarna (som på laget.se och i appens trupp).
  const playerIds = new Set(rows.filter((r: any) => r.role === 'player').map((r: any) => r.id));
  const people: CardPerson[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    people.push({ id: r.id, name: r.full_name, personnummer: r.personnummer, gender: r.gender, disability: !!r.disability, role: playerIds.has(r.id) ? 'participant' : 'leader' });
  }
  return { sessions, people };
}

export function teamsOfClub(db: Db, clubId: string): { id: string; name: string }[] {
  const row: any = db.prepare(`SELECT data FROM clubs_data WHERE clubId = ? AND teamId = 'club_global' AND segment = 'metadata'`).get(clubId);
  try {
    const meta = row ? JSON.parse(row.data) : null;
    return (Array.isArray(meta?.teams) ? meta.teams : []).filter((t: any) => t && t.id).map((t: any) => ({ id: String(t.id), name: String(t.name || t.id) }));
  } catch { return []; }
}

// --- Låsning (intygande) ---

export interface LockInfo { lockedAt: number; lockedBy: string; totals: CardResult['totals'] }

export function getLock(db: Db, clubId: string, teamId: string, period: string, type: CardType): LockInfo | null {
  const r: any = db.prepare('SELECT locked_at, locked_by, snapshot FROM lok_locks WHERE club_id = ? AND team_id = ? AND period = ? AND type = ?').get(clubId, teamId, period, type);
  if (!r) return null;
  let totals: any = null;
  try { totals = JSON.parse(r.snapshot); } catch { /* ignoreras */ }
  return { lockedAt: r.locked_at, lockedBy: r.locked_by, totals };
}

export function setLock(db: Db, a: { clubId: string; teamId: string; period: string; type: CardType; lockedBy: string; totals: CardResult['totals'] }) {
  db.prepare(
    `INSERT INTO lok_locks (club_id, team_id, period, type, locked_at, locked_by, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(club_id, team_id, period, type) DO UPDATE SET locked_at = excluded.locked_at, locked_by = excluded.locked_by, snapshot = excluded.snapshot`
  ).run(a.clubId, a.teamId, a.period, a.type, Date.now(), a.lockedBy, JSON.stringify(a.totals));
}

export function removeLock(db: Db, clubId: string, teamId: string, period: string, type: CardType) {
  db.prepare('DELETE FROM lok_locks WHERE club_id = ? AND team_id = ? AND period = ? AND type = ?').run(clubId, teamId, period, type);
}
