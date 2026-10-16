// Inbjudningslänkar för spelare (och andra medlemmar).
//
// En tränare skapar en personlig länk för en person i truppen och skickar den själv
// (sms, WhatsApp, mejl). Den som öppnar länken skapar ett konto, eller loggar in med ett
// befintligt, och kopplas då till rätt medlemspost i föreningen.
import crypto from 'crypto';
import type { Db } from './database.ts';
import { CLUB_LEVEL, listClubs, type MemberRow } from './registry.ts';

export const INVITE_DAYS = 30;
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function createInvite(db: Db, memberId: string, clubId: string, createdBy: string): { token: string; expiresAt: number } {
  const token = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const expiresAt = now + INVITE_DAYS * 24 * 3600 * 1000;
  db.transaction(() => {
    // Endast den senaste länken per person gäller
    db.prepare('DELETE FROM invites WHERE member_id = ? AND used_at IS NULL').run(memberId);
    db.prepare('INSERT INTO invites (token_hash, member_id, club_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(hash(token), memberId, clubId, createdBy, now, expiresAt);
  })();
  return { token, expiresAt };
}

export interface InviteInfo {
  memberId: string;
  clubId: string;
  clubName: string;
  teamIds: string[];
  teamNames: string[];
  fullName: string;
  email: string | null;
  alreadyLinked: boolean;
}

export type InviteLookup = { ok: true; info: InviteInfo; tokenHash: string } | { ok: false; reason: 'not_found' | 'used' | 'expired' };

export function lookupInvite(db: Db, token: string): InviteLookup {
  if (!token || typeof token !== 'string' || token.length > 100) return { ok: false, reason: 'not_found' };
  const row: any = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(hash(token));
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.used_at) return { ok: false, reason: 'used' };
  if (row.expires_at < Date.now()) return { ok: false, reason: 'expired' };
  const m: MemberRow | undefined = db.prepare('SELECT * FROM members WHERE id = ?').get(row.member_id);
  if (!m) return { ok: false, reason: 'not_found' };
  const teamIds: string[] = db.prepare(`SELECT DISTINCT team_id FROM team_roles WHERE member_id = ? AND team_id != ?`).all(m.id, CLUB_LEVEL).map((r: any) => r.team_id);
  const club = listClubs(db).find((c: any) => c.id === m.club_id);
  const teamNames = teamIds.map((t) => club?.teams?.find((x: any) => x.id === t)?.name || t);
  return {
    ok: true,
    tokenHash: row.token_hash,
    info: {
      memberId: m.id, clubId: m.club_id, clubName: club?.name || 'Föreningen', teamIds, teamNames,
      fullName: m.full_name, email: m.email, alreadyLinked: !!m.user_id,
    },
  };
}

// Kopplar medlemsposten till kontot och markerar inbjudan som använd.
export function acceptInvite(db: Db, tokenHash: string, info: InviteInfo, user: { id: string; email: string }): { error?: string } {
  const m: MemberRow | undefined = db.prepare('SELECT * FROM members WHERE id = ?').get(info.memberId);
  if (!m) return { error: 'Personen finns inte längre i föreningen.' };
  if (m.user_id && m.user_id !== user.id) return { error: 'Den här personen är redan kopplad till ett annat konto.' };
  db.transaction(() => {
    db.prepare('UPDATE members SET user_id = ?, email = COALESCE(NULLIF(email, \'\'), ?), updated_at = ? WHERE id = ?')
      .run(user.id, String(user.email).toLowerCase(), Date.now(), m.id);
    db.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE token_hash = ?').run(Date.now(), user.id, tokenHash);

    // Profil: aktiv förening och lag, så att appen öppnas direkt i rätt lag
    const profRow: any = db.prepare(`SELECT data FROM users_data WHERE userId = ? AND segment = 'profile'`).get(user.id);
    let prof: any = {};
    try { prof = profRow ? JSON.parse(profRow.data) : {}; } catch { prof = {}; }
    prof = {
      ...prof,
      fullName: prof.fullName || m.full_name,
      email: prof.email || user.email,
      activeClubId: info.clubId,
      activeTeamId: info.teamIds[0] || prof.activeTeamId || CLUB_LEVEL,
      status: 'approved',
      onboardingCompleted: true,
    };
    db.prepare(`INSERT INTO users_data (userId, segment, data, updatedAt) VALUES (?, 'profile', ?, ?)
      ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`).run(user.id, JSON.stringify(prof), Date.now());
  })();
  return {};
}

// Öppna (ej använda, ej utgångna) inbjudningar i en förening, per medlem.
export function pendingInvites(db: Db, clubId: string): Record<string, { createdAt: number; expiresAt: number }> {
  const out: Record<string, { createdAt: number; expiresAt: number }> = {};
  for (const r of db.prepare('SELECT member_id, created_at, expires_at FROM invites WHERE club_id = ? AND used_at IS NULL AND expires_at > ?').all(clubId, Date.now())) {
    out[r.member_id] = { createdAt: r.created_at, expiresAt: r.expires_at };
  }
  return out;
}
