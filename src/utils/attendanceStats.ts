/**
 * Närvarostatistik: hur många genomförda aktiviteter varje person var med på under en period,
 * uppdelat på träning, match och övrigt. Används av fliken Statistik i menyn Närvaro.
 */
import type { SquadPlayer, TrainingSession } from '../types';
import { categorizeSession, type SessionCategory } from './sessionCategory.ts';

export const KINDS: SessionCategory[] = ['training', 'match', 'other'];

export interface PersonStats {
  person: SquadPlayer;
  byKind: Record<SessionCategory, number>;
  attended: number;
  /** Andel av periodens aktiviteter, 0–100 (avrundat). */
  percent: number;
  /** Svarade Kommer eller Delvis men bockades inte som närvarande. */
  noShow: number;
}

export interface AttendanceStats {
  sessions: TrainingSession[];
  totals: Record<SessionCategory, number>;
  people: PersonStats[];
  /** Medel av personernas närvaro i procent (som laget.se). */
  average: number;
}

const startOf = (s: TrainingSession) => {
  const d = new Date(s.date);
  const [h, m] = (s.startTime || '00:00').split(':').map(Number);
  if (!isNaN(h)) d.setHours(h, isNaN(m) ? 0 : m, 0, 0);
  return d.getTime();
};

const endOf = (s: TrainingSession) => {
  if (s.endTime) {
    const d = new Date(s.date);
    const [h, m] = s.endTime.split(':').map(Number);
    if (!isNaN(h)) { d.setHours(h, isNaN(m) ? 0 : m, 0, 0); return d.getTime(); }
  }
  return startOf(s) + 2 * 60 * 60 * 1000;
};

// Närvaron sparas på truppradens id. Ledarrader (<id>_leader) och mycket gamla pass (namn) räknas också.
export function wasPresent(s: TrainingSession, p: SquadPlayer): boolean {
  const base = p.id.replace(/_leader$/, '');
  const name = p.name.trim().toLowerCase();
  return (s.attendance || []).some((a: any) => {
    const v = typeof a === 'string' ? a : String(a?.id || a?.name || '');
    return v === p.id || v === base || v.trim().toLowerCase() === name;
  });
}

/**
 * from/to: datum "ÅÅÅÅ-MM-DD" (till och med). Bara aktiviteter som är slut (före now) och inte ignorerade räknas.
 */
export function computeAttendanceStats(opts: {
  sessions: TrainingSession[];
  people: SquadPlayer[];
  from: string;
  to: string;
  kinds: SessionCategory[];
  now?: number;
}): AttendanceStats {
  const now = opts.now ?? Date.now();
  const [fy, fm, fd] = opts.from.split('-').map(Number);
  const [ty, tm, td] = opts.to.split('-').map(Number);
  const fromTs = new Date(fy, fm - 1, fd, 0, 0, 0).getTime();
  const toTs = new Date(ty, tm - 1, td, 23, 59, 59).getTime();

  const sessions = opts.sessions.filter(s => {
    if (!s || s.isIgnored) return false;
    const start = startOf(s);
    return start >= fromTs && start <= toTs && endOf(s) < now && opts.kinds.includes(categorizeSession(s));
  });

  const totals = { training: 0, match: 0, other: 0 } as Record<SessionCategory, number>;
  const kindOf = new Map<string, SessionCategory>();
  for (const s of sessions) {
    const k = categorizeSession(s);
    kindOf.set(s.id, k);
    totals[k]++;
  }

  const people = opts.people.map(person => {
    const byKind = { training: 0, match: 0, other: 0 } as Record<SessionCategory, number>;
    let noShow = 0;
    for (const s of sessions) {
      const present = wasPresent(s, person);
      if (present) byKind[kindOf.get(s.id)!]++;
      const st = (s.rsvps?.[person.id] || s.rsvps?.[person.id.replace(/_leader$/, '')])?.status;
      if (!present && (st === 'attending' || st === 'partial')) noShow++;
    }
    const attended = byKind.training + byKind.match + byKind.other;
    const percent = sessions.length ? Math.round((attended / sessions.length) * 100) : 0;
    return { person, byKind, attended, percent, noShow };
  });

  const average = people.length ? Math.round(people.reduce((n, p) => n + p.percent, 0) / people.length) : 0;
  return { sessions, totals, people, average };
}
