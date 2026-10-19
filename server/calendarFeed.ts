// Lagets kalenderprenumeration (iCal). Adressen innehåller en slumpad hemlig nyckel per lag,
// så att man inte kan läsa ett lags pass bara genom att gissa förenings- och lag-id.
// Nyckeln skapas första gången någon i laget hämtar länken, och tränare kan byta den
// (då slutar den gamla länken fungera).
import crypto from 'crypto';
import type { Db } from './database.ts';

const newToken = () => crypto.randomBytes(18).toString('base64url');

export function getOrCreateKey(db: Db, clubId: string, teamId: string, userId: string): string {
  const row: any = db.prepare('SELECT token FROM calendar_feed_keys WHERE club_id = ? AND team_id = ?').get(clubId, teamId);
  if (row) return row.token;
  const token = newToken();
  db.prepare('INSERT OR IGNORE INTO calendar_feed_keys (club_id, team_id, token, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(clubId, teamId, token, userId, Date.now());
  // Om två hämtade samtidigt vinner den som sparades först
  return (db.prepare('SELECT token FROM calendar_feed_keys WHERE club_id = ? AND team_id = ?').get(clubId, teamId) as any).token;
}

export function rotateKey(db: Db, clubId: string, teamId: string, userId: string): string {
  const token = newToken();
  db.prepare(`INSERT INTO calendar_feed_keys (club_id, team_id, token, created_by, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(club_id, team_id) DO UPDATE SET token = excluded.token, created_by = excluded.created_by, created_at = excluded.created_at`)
    .run(clubId, teamId, token, userId, Date.now());
  return token;
}

// Stämmer nyckeln för just det här laget? Jämförs i konstant tid.
export function isValidKey(db: Db, clubId: string, teamId: string, token: string): boolean {
  if (!token || typeof token !== 'string' || token.length > 100) return false;
  const row: any = db.prepare('SELECT token FROM calendar_feed_keys WHERE club_id = ? AND team_id = ?').get(clubId, teamId);
  if (!row) return false;
  const a = Buffer.from(String(row.token));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const feedPath = (clubId: string, teamId: string, token: string) =>
  `/api/calendar/${encodeURIComponent(clubId)}/${encodeURIComponent(teamId)}/${encodeURIComponent(token)}/events.ics`;
