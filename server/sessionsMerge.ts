/**
 * Lagets passlista sparas som ett dokument som appen skickar i sin helhet. En enhet med en gammal kopia
 * (t.ex. en mobil som legat i bakgrunden) skrev tidigare över nyare planering från en annan enhet (okt 2026).
 *
 * mergeSessionsDoc slår därför ihop pass för pass: finns passet redan med en senare ändringstid (updatedAt)
 * behålls serverns version, och ett pass som lagts i papperskorgen (deletedAt) efter att kopian ändrades
 * kommer inte tillbaka. Pass som saknas i det inskickade dokumentet tas bort som förut (papperskorg,
 * borttagna kalenderpass); historiken (sessions_history) gör att de går att hitta igen.
 */
import type { Db } from './database.ts';

const HISTORY_PER_TEAM = 100;

const stamp = (s: any): number => Number(s?.updatedAt || s?.createdAt || 0) || 0;

export function mergeSessionsDoc(prev: any, incoming: any): { doc: any; kept: string[] } {
  if (!prev || !Array.isArray(prev.sessions) || !incoming || !Array.isArray(incoming.sessions)) {
    return { doc: incoming, kept: [] };
  }
  const prevById = new Map<string, any>(prev.sessions.filter((s: any) => s?.id).map((s: any) => [s.id, s]));
  const prevDeleted = new Map<string, any>((Array.isArray(prev.deletedSessions) ? prev.deletedSessions : [])
    .filter((s: any) => s?.id).map((s: any) => [s.id, s]));
  const incomingDeleted: any[] = Array.isArray(incoming.deletedSessions) ? incoming.deletedSessions : [];

  const kept: string[] = [];
  const sessions: any[] = [];
  const stillDeleted: any[] = [];
  for (const s of incoming.sessions) {
    if (!s?.id) { sessions.push(s); continue; }
    const current = prevById.get(s.id);
    if (current && stamp(current) > stamp(s)) {
      sessions.push(current);
      kept.push(s.id);
      continue;
    }
    const trashed = !current ? prevDeleted.get(s.id) : null;
    if (trashed && Number(trashed.deletedAt) > stamp(s)) {
      // Lades i papperskorgen efter att den här kopian ändrades – låt det ligga kvar där.
      stillDeleted.push(trashed);
      kept.push(s.id);
      continue;
    }
    sessions.push(s);
  }

  const inSessions = new Set(sessions.map((s) => s?.id));
  const deletedSessions = [...stillDeleted, ...incomingDeleted.filter((s) => !inSessions.has(s?.id) && !stillDeleted.some((d) => d.id === s?.id))];
  return { doc: { ...incoming, sessions, deletedSessions }, kept };
}

/** Sparar den version som ska ersättas (bara om den ändras) och rensar bort de äldsta. */
export function saveSessionsHistory(db: Db, clubId: string, teamId: string, prevData: string | null, nextData: string, replacedBy: string | null, client: string | null) {
  if (!prevData || prevData === nextData) return;
  db.prepare('INSERT INTO sessions_history (club_id, team_id, saved_at, replaced_by, client, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(clubId, teamId, Date.now(), replacedBy, client ? client.slice(0, 200) : null, prevData);
  db.prepare(`DELETE FROM sessions_history WHERE club_id = ? AND team_id = ? AND id NOT IN (
    SELECT id FROM sessions_history WHERE club_id = ? AND team_id = ? ORDER BY id DESC LIMIT ?)`)
    .run(clubId, teamId, clubId, teamId, HISTORY_PER_TEAM);
}
