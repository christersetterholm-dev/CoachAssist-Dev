/**
 * Typer och hjälpfunktioner för närvarokorten (LOK-stöd) i appen. Uträkningen görs på servern (server/lok.ts).
 */
export type LokType = 'state' | 'municipal';
export type LokCell = '1' | '(1)' | 'x';

export interface LokRules {
  enabled: boolean;
  minAge: number; maxAge: number; disabilityNoUpperAge: boolean;
  leaderMinAge: number; minParticipants: number; minMinutes: number;
  maxPerLeader: number | null; maxParticipants: number | null; onePerDay: boolean;
  weeklyCaps: { maxAge: number; max: number }[];
  participantGroups: number[]; leaderGroups: number[];
}
export interface LokActivity {
  id: string; title: string; kind: 'training' | 'match' | 'other'; date: number; startTime: string; endTime: string;
  location: string; approved: boolean; reason: string | null; counted: number; leaders: number;
}
export interface LokRow { id: string; name: string; personnummer: string; cells: LokCell[]; total: number }
export interface LokGroupTable { labels: string[]; female: number[]; male: number[]; unknown: number[] }
export interface LokTotals { gatherings: number; participantOccasions: number; leaderOccasions: number }
export interface LokSummary {
  totals: LokTotals;
  groups: { participants: LokGroupTable; leaders: LokGroupTable };
}
export interface LokCard extends LokSummary {
  activities: LokActivity[];
  participants: LokRow[];
  leaders: LokRow[];
  /** Summering per kort (25 aktiviteter). */
  pages: LokSummary[];
  warnings: { noEndTime: string[]; tooShort: string[]; noBirthYear: string[]; noGender: string[]; notLok: number };
}
export interface LokLock { lockedAt: number; lockedBy: string; totals: LokTotals | null }
export interface LokCardResponse {
  period: { key: string; label: string };
  type: LokType;
  rules: LokRules;
  teamName: string;
  card: LokCard;
  lock: LokLock | null;
  changedSinceLock: boolean;
  canUnlock: boolean;
}

export const LOK_TYPE_LABEL: Record<LokType, string> = { state: 'Statligt aktivitetsstöd', municipal: 'Kommunalt aktivitetsstöd' };
export const KIND_LETTER: Record<LokActivity['kind'], string> = { training: 'Träning', match: 'Match', other: 'Övrigt' };

/** Rubriken för en aktivitet på kortet: Träning, Match eller övriga aktivitetens namn (som laget.se). */
export const activityLabel = (a: LokActivity) => (a.kind === 'other' ? (a.title.trim() || 'Övrigt') : KIND_LETTER[a.kind]);

/** Personer som var med (1 eller (1)) på någon av aktiviteterna from–to; laget.se visar bara dem på kortet. */
export const presentOn = (rows: LokRow[], from: number, to: number) => rows.filter(r => r.cells.slice(from, to).some(c => c !== 'x'));

/** Halvår att välja bland: det pågående och de fem före ("2026-2" = juli–december 2026). */
export function lokPeriods(now = new Date()): { key: string; label: string }[] {
  let y = now.getFullYear();
  let h = now.getMonth() < 6 ? 1 : 2;
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < 6; i++) {
    out.push({ key: `${y}-${h}`, label: h === 1 ? `${y}, 1 januari – 30 juni` : `${y}, 1 juli – 31 december` });
    if (h === 2) h = 1; else { h = 2; y--; }
  }
  return out;
}

export const formatLockDate = (ts: number) =>
  new Date(ts).toLocaleString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
