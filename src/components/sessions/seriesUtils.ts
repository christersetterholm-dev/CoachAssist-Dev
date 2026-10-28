/**
 * Serier av pass (skapade tillsammans, samma seriesId) och ändringar av flera pass på en gång.
 */
import type { TrainingSession } from '../../types';

/** Fält som kan ändras på flera pass samtidigt (datum ändras alltid ett pass i taget). */
export const BULK_FIELDS = ['title', 'type', 'startTime', 'endTime', 'gatheringTime', 'location', 'description', 'lok'] as const;
export type BulkField = typeof BULK_FIELDS[number];
export type BulkChanges = Partial<Pick<TrainingSession, BulkField>>;

export const FIELD_LABEL: Record<BulkField, string> = {
  title: 'Rubrik', type: 'Typ', startTime: 'Start', endTime: 'Slut', gatheringTime: 'Samling',
  location: 'Plats', description: 'Information', lok: 'LOK-aktivitet',
};

// lok saknas = räknas för LOK (true); type och category hålls lika
const valueOf = (s: TrainingSession, f: BulkField) => (f === 'lok' ? s.lok !== false : (s as any)[f] ?? '');

/** Vilka fält som skiljer mellan före och efter (för frågan om ändringen ska gälla fler pass). */
export function changedFields(before: TrainingSession, after: TrainingSession): BulkChanges {
  const out: BulkChanges = {};
  for (const f of BULK_FIELDS) {
    if (valueOf(before, f) !== valueOf(after, f)) (out as any)[f] = f === 'lok' ? valueOf(after, f) : (after as any)[f];
  }
  return out;
}

/**
 * Lägger in ändringarna i passen. onlyIf: bara pass som hade samma värde som `before` för fältet ändras
 * (ett pass som ändrats för hand behåller sin ändring).
 */
export function applyChanges(sessions: TrainingSession[], changes: BulkChanges, onlyIf?: TrainingSession): TrainingSession[] {
  const now = Date.now();
  return sessions.map(s => {
    const next: any = { ...s };
    let touched = false;
    for (const f of Object.keys(changes) as BulkField[]) {
      if (onlyIf && valueOf(s, f) !== valueOf(onlyIf, f)) continue;
      const v = (changes as any)[f];
      if (f === 'lok') next.lok = v ? undefined : false;
      else if (f === 'type') { next.type = v; next.category = v; }
      else next[f] = v === '' ? undefined : v;
      touched = true;
    }
    return touched ? { ...next, updatedAt: now } : s;
  });
}

const sessionStart = (s: TrainingSession) => {
  const d = new Date(s.date);
  const [h, m] = (s.startTime || '00:00').split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
};

export const seriesSessions = (all: TrainingSession[], seriesId?: string) =>
  seriesId ? all.filter(s => s.seriesId === seriesId).sort((a, b) => sessionStart(a) - sessionStart(b)) : [];

const WEEKDAY = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
const short = (ts: number) => new Date(ts).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });

/** T.ex. "Träning · tis, tor 18:30 · 1 sep–30 nov · 26 pass". */
export function describeSeries(list: TrainingSession[]): string {
  if (list.length === 0) return '';
  const days = Array.from(new Set(list.map(s => (new Date(s.date).getDay() + 6) % 7))).sort().map(d => WEEKDAY[(d + 1) % 7]);
  const times = Array.from(new Set(list.map(s => s.startTime).filter(Boolean)));
  return `${list[0].title || 'Pass'} · ${days.join(', ')}${times.length === 1 ? ` ${times[0]}` : ''} · ${short(list[0].date)}–${short(list[list.length - 1].date)} · ${list.length} pass`;
}

/** Alla serier i laget (för listan Serier), senast först. */
export function allSeries(all: TrainingSession[]): { id: string; sessions: TrainingSession[] }[] {
  const map = new Map<string, TrainingSession[]>();
  for (const s of all) if (s.seriesId && !s.isIgnored) (map.get(s.seriesId) || map.set(s.seriesId, []).get(s.seriesId)!).push(s);
  return Array.from(map.entries())
    .map(([id, list]) => ({ id, sessions: list.sort((a, b) => sessionStart(a) - sessionStart(b)) }))
    .filter(x => x.sessions.length > 1)
    .sort((a, b) => sessionStart(b.sessions[b.sessions.length - 1]) - sessionStart(a.sessions[a.sessions.length - 1]));
}

/**
 * Förlänger en serie veckovis till och med `until` (ÅÅÅÅ-MM-DD) på samma veckodagar och tider som serien.
 * Nya pass kopierar det senaste passets uppgifter men inte upplägg, svar eller närvaro.
 */
export function extendSeries(list: TrainingSession[], until: string): TrainingSession[] {
  if (list.length === 0) return [];
  const last = list[list.length - 1];
  const byWeekday = new Map<number, TrainingSession>();
  for (const s of list) byWeekday.set(new Date(s.date).getDay(), s); // senaste passet per veckodag
  const [y, m, d] = until.split('-').map(Number);
  const end = new Date(y, m - 1, d, 23, 59).getTime();
  const cursor = new Date(last.date);
  cursor.setHours(12, 0, 0, 0);
  const out: TrainingSession[] = [];
  const now = Date.now();
  for (let i = 0; i < 400 && out.length < 200; i++) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getTime() > end) break;
    const model = byWeekday.get(cursor.getDay());
    if (!model) continue;
    out.push({
      id: crypto.randomUUID(), seriesId: last.seriesId, title: model.title, date: cursor.getTime(),
      startTime: model.startTime, endTime: model.endTime, type: model.type, category: model.category,
      gatheringTime: model.gatheringTime, location: model.location, description: model.description, lok: model.lok,
      hideContentForPlayers: model.hideContentForPlayers,
      // Sista svarsdag lika långt före passet som i förebilden
      rsvpConfig: model.rsvpConfig ? {
        deadline: model.rsvpConfig.deadline ? cursor.getTime() - (model.date - model.rsvpConfig.deadline) : undefined,
        notes: model.rsvpConfig.notes, invitedAt: now,
      } : undefined,
      moments: [], createdAt: now, updatedAt: now,
    });
  }
  return out;
}
