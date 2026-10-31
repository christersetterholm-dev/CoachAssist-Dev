/**
 * Ordningen på lagen i poängräkningen när "sortera efter poäng" är på. Korten byter plats först när
 * tränaren slutat trycka en stund (SORT_SETTLE_MS) – annars flyttade sig kortet under fingret och nästa
 * tryck hamnade på ett annat lag.
 */
export const SORT_SETTLE_MS = 1500;

/** Lagens id sorterade efter poäng (högst först); lika poäng behåller sin inbördes ordning. */
export const sortedTeamIds = (teams: { id: string; score: number }[]): string[] =>
  teams.map((t, i) => ({ id: t.id, score: t.score, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(t => t.id);

/** Har samma lag (oavsett ordning)? Annars ska ordningen uppdateras direkt (lag tillagt/borttaget, nytt moment). */
export const sameTeams = (order: string[], teams: { id: string }[]): boolean =>
  order.length === teams.length && teams.every(t => order.includes(t.id));

/** Lagen i den visade ordningen; lag som saknas i ordningen hamnar sist. */
export const applyTeamOrder = <T extends { id: string }>(teams: T[], order: string[]): T[] => {
  const pos = new Map(order.map((id, i) => [id, i] as const));
  return teams.map((t, i) => ({ t, i, p: pos.has(t.id) ? pos.get(t.id)! : order.length + i }))
    .sort((a, b) => a.p - b.p)
    .map(x => x.t);
};
