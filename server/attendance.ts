/**
 * Närvaro: en rad per person och aktivitet (tabellen attendance), på samma sätt som svaren på kallelser.
 * present = 1 betyder var med, 0 att en tränare har tagit bort bocken. Raden med 0 finns kvar så att ett
 * äldre sparat pass-dokument (som fortfarande har personen i listan) inte lägger tillbaka bocken.
 *
 * Appen får närvaron som pass.attendance (overlayAttendance) och ändrar den med POST /api/attendance.
 * Sparas pass-dokumentet med en attendance-lista läggs bara personer utan rad till (extractAttendance),
 * och listan tas bort ur dokumentet.
 */
import type { Db } from './database.ts';

export const MAX_IDS = 300;

// Gamla pass kan ha närvaro som namn eller objekt ({ id, name }); spara det som en sträng.
const toId = (v: any): string | null => {
  if (typeof v === 'string') return v.trim().slice(0, 200) || null;
  if (v && typeof v === 'object') return toId(v.id || v.playerId || v.name);
  return null;
};

export function getAttendanceMap(db: Db, clubId: string, teamId: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const rows = db.prepare('SELECT session_id, member_id, present FROM attendance WHERE club_id = ? AND team_id = ? ORDER BY updated_at, rowid').all(clubId, teamId);
  for (const r of rows) {
    if (!map.has(r.session_id)) map.set(r.session_id, []);
    if (r.present) map.get(r.session_id)!.push(r.member_id);
  }
  return map;
}

/** Närvaro för ett pass (bara de som var med). */
export function getSessionAttendance(db: Db, clubId: string, teamId: string, sessionId: string): string[] {
  return db.prepare('SELECT member_id FROM attendance WHERE club_id = ? AND team_id = ? AND session_id = ? AND present = 1 ORDER BY updated_at, rowid')
    .all(clubId, teamId, sessionId).map((r: any) => r.member_id);
}

// Lägger in närvaron från tabellen i passen (för appens vyer).
export function overlayAttendance(db: Db, clubId: string, teamId: string, doc: any) {
  if (!doc || !Array.isArray(doc.sessions)) return doc;
  const map = getAttendanceMap(db, clubId, teamId);
  return { ...doc, sessions: doc.sessions.map((s: any) => (s && map.has(s.id) ? { ...s, attendance: map.get(s.id) } : s)) };
}

// Personer i passens attendance-listor som saknar rad läggs till; listorna tas bort ur dokumentet.
export function extractAttendance(db: Db, clubId: string, teamId: string, doc: any, updatedBy?: string | null) {
  if (!doc || !Array.isArray(doc.sessions)) return doc;
  const insert = db.prepare(
    `INSERT INTO attendance (club_id, team_id, session_id, member_id, present, updated_at, updated_by) VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(club_id, team_id, session_id, member_id) DO NOTHING`
  );
  const ts = Date.now();
  const sessions = doc.sessions.map((s: any) => {
    if (!s || !('attendance' in s)) return s;
    if (Array.isArray(s.attendance) && s.id) {
      for (const v of s.attendance) {
        const id = toId(v);
        if (id) insert.run(clubId, teamId, String(s.id), id, ts, updatedBy ?? null);
      }
    }
    const { attendance: _drop, ...rest } = s;
    return rest;
  });
  return { ...doc, sessions };
}

/** En tränare bockar i (add) eller ur (remove) närvaro för ett pass. */
export function setAttendance(db: Db, a: { clubId: string; teamId: string; sessionId: string; add: string[]; remove: string[]; updatedBy?: string | null }) {
  const upsert = db.prepare(
    `INSERT INTO attendance (club_id, team_id, session_id, member_id, present, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(club_id, team_id, session_id, member_id) DO UPDATE SET present = excluded.present, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  );
  const ts = Date.now();
  db.transaction(() => {
    for (const id of a.remove) upsert.run(a.clubId, a.teamId, a.sessionId, id, 0, ts, a.updatedBy ?? null);
    for (const id of a.add) upsert.run(a.clubId, a.teamId, a.sessionId, id, 1, ts, a.updatedBy ?? null);
  })();
  return getSessionAttendance(db, a.clubId, a.teamId, a.sessionId);
}

// Engångsflytt vid start: närvaro som fortfarande ligger i lagens pass-dokument flyttas till tabellen.
export function migrateAttendance(db: Db, log: (msg: string) => void = console.log) {
  const rows = db.prepare(`SELECT clubId, teamId, data FROM clubs_data WHERE segment = 'sessions'`).all();
  let docs = 0, marks = 0;
  for (const row of rows) {
    let doc: any;
    try { doc = typeof row.data === 'string' ? JSON.parse(row.data) : row.data; } catch { continue; }
    if (!doc || !Array.isArray(doc.sessions) || !doc.sessions.some((s: any) => s && 'attendance' in s)) continue;
    marks += doc.sessions.reduce((n: number, s: any) => n + (Array.isArray(s?.attendance) ? s.attendance.length : 0), 0);
    db.transaction(() => {
      const stripped = extractAttendance(db, row.clubId, row.teamId, doc);
      db.prepare(`UPDATE clubs_data SET data = ? WHERE clubId = ? AND teamId = ? AND segment = 'sessions'`).run(JSON.stringify(stripped), row.clubId, row.teamId);
    })();
    docs++;
  }
  if (docs) log(`[Närvaro] Flyttade ${marks} närvarobockar från ${docs} lag till tabellen attendance.`);
}
