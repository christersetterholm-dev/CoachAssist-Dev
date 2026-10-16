// Medlemsregister, behörigheter per klubb/lag och svar på kallelser.
//
// All data om personer finns i tabellerna members (en rad per person och klubb) och
// team_roles (vilka roller personen har i vilket lag). Det gamla formatet – truppen per
// lag ("squad") och klubbens medlemslista ("members") – räknas fram ur tabellerna när
// appen läser dem, och översätts tillbaka till tabellerna när appen sparar. Därmed finns
// bara en sanning, och appens befintliga vyer fungerar som förut.
import crypto from 'crypto';
import type { Db } from './database.ts';

export const CLUB_LEVEL = 'club_global';
const MANAGER_ROLES = ['admin', 'coach'];
const VALID_ROLES = ['admin', 'coach', 'player', 'parent'];
export const RSVP_STATUSES = ['attending', 'declined', 'partial'];

const lower = (s: any) => String(s || '').trim().toLowerCase();
const now = () => Date.now();
const parse = (raw: any) => { try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; } };

export interface MemberRow {
  id: string; club_id: string; user_id: string | null; full_name: string; email: string | null;
  phone: string | null; personnummer: string | null; position: string | null; number: string | null;
  photo_url: string | null; created_at: number; updated_at: number;
}

// ---------------------------------------------------------------------------
// Behörigheter
// ---------------------------------------------------------------------------

export interface ClubAccess {
  clubId: string;
  isRoot: boolean;
  isClubAdmin: boolean;
  memberIds: string[];
  teamRoles: Map<string, Set<string>>; // teamId -> roller
}

export function getClubAccess(db: Db, user: any, clubId: string, isRoot: boolean): ClubAccess {
  const memberIds: string[] = [];
  const teamRoles = new Map<string, Set<string>>();
  if (user) {
    const rows = db.prepare(
      `SELECT m.id AS member_id, r.team_id, r.role FROM members m
       LEFT JOIN team_roles r ON r.member_id = m.id
       WHERE m.club_id = ? AND (m.user_id = ? OR (m.user_id IS NULL AND m.email IS NOT NULL AND m.email != '' AND LOWER(m.email) = ?))`
    ).all(clubId, String(user.id || ''), lower(user.email));
    for (const r of rows) {
      if (!memberIds.includes(r.member_id)) memberIds.push(r.member_id);
      if (r.team_id && r.role) {
        if (!teamRoles.has(r.team_id)) teamRoles.set(r.team_id, new Set());
        teamRoles.get(r.team_id)!.add(r.role);
      }
    }
  }
  const isClubAdmin = isRoot || Array.from(teamRoles.values()).some((s) => s.has('admin'));
  return { clubId, isRoot, isClubAdmin, memberIds, teamRoles };
}

export const isClubMember = (a: ClubAccess) => a.isClubAdmin || a.teamRoles.size > 0 || a.memberIds.length > 0;
export const isClubCoach = (a: ClubAccess) =>
  a.isClubAdmin || Array.from(a.teamRoles.values()).some((s) => s.has('coach'));
export const isTeamCoach = (a: ClubAccess, teamId: string) =>
  a.isClubAdmin || MANAGER_ROLES.some((r) => a.teamRoles.get(teamId)?.has(r));
export const isTeamMember = (a: ClubAccess, teamId: string) =>
  isTeamCoach(a, teamId) || (a.teamRoles.get(teamId)?.size || 0) > 0;

export function canReadClubDoc(a: ClubAccess, teamId: string, segment: string): boolean {
  if (teamId === CLUB_LEVEL) return segment === 'metadata' || isClubMember(a);
  return isTeamMember(a, teamId);
}

export function canWriteClubDoc(a: ClubAccess, teamId: string, segment: string): boolean {
  if (teamId === CLUB_LEVEL) {
    if (segment === 'metadata') return a.isClubAdmin;
    return isClubCoach(a);
  }
  return isTeamCoach(a, teamId);
}

export function clubExists(db: Db, clubId: string): boolean {
  return !!db.prepare('SELECT 1 FROM clubs_data WHERE clubId = ? LIMIT 1').get(clubId) ||
    !!db.prepare('SELECT 1 FROM members WHERE club_id = ? LIMIT 1').get(clubId);
}

// Alla lag (inklusive föreningsnivån) där användaren har en roll.
export function getUserClubTeams(db: Db, user: any): { clubId: string; teamId: string }[] {
  if (!user) return [];
  const rows = db.prepare(
    `SELECT DISTINCT m.club_id, r.team_id FROM members m JOIN team_roles r ON r.member_id = m.id
     WHERE m.user_id = ? OR (m.user_id IS NULL AND m.email IS NOT NULL AND m.email != '' AND LOWER(m.email) = ?)`
  ).all(String(user.id || ''), lower(user.email));
  const out: { clubId: string; teamId: string }[] = [];
  for (const r of rows) {
    if (!out.some((o) => o.clubId === r.club_id && o.teamId === CLUB_LEVEL)) out.push({ clubId: r.club_id, teamId: CLUB_LEVEL });
    if (r.team_id !== CLUB_LEVEL) out.push({ clubId: r.club_id, teamId: r.team_id });
  }
  return out;
}

// Klubbar där användaren är admin eller tränare.
export function getManagedClubIds(db: Db, user: any): string[] {
  if (!user) return [];
  return db.prepare(
    `SELECT DISTINCT m.club_id FROM members m JOIN team_roles r ON r.member_id = m.id
     WHERE r.role IN ('admin','coach') AND (m.user_id = ? OR (m.user_id IS NULL AND m.email IS NOT NULL AND m.email != '' AND LOWER(m.email) = ?))`
  ).all(String(user.id || ''), lower(user.email)).map((r: any) => r.club_id);
}

// Kopplar medlemsposter till ett inloggningskonto (samma id eller samma e-post).
export function linkMembersToUser(db: Db, user: { id: string; email?: string | null }) {
  if (!user?.id) return;
  db.prepare('UPDATE members SET user_id = ? WHERE user_id IS NULL AND id = ?').run(user.id, user.id);
  if (user.email) {
    db.prepare(`UPDATE members SET user_id = ? WHERE user_id IS NULL AND email IS NOT NULL AND LOWER(email) = ?`).run(user.id, lower(user.email));
  }
}

// ---------------------------------------------------------------------------
// Medlemmar och roller
// ---------------------------------------------------------------------------

function getMember(db: Db, id: string): MemberRow | undefined {
  return db.prepare('SELECT * FROM members WHERE id = ?').get(id);
}

function rolesOf(db: Db, memberId: string): { team_id: string; role: string; sort: number }[] {
  return db.prepare('SELECT team_id, role, sort FROM team_roles WHERE member_id = ?').all(memberId);
}

const clean = (v: any): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// Skapar eller uppdaterar en medlem. Fält som är undefined lämnas orörda.
function upsertMember(db: Db, clubId: string, id: string, f: {
  fullName?: string; email?: string; phone?: string; personnummer?: string;
  position?: string; number?: string; photoUrl?: string; userId?: string | null;
}): 'created' | 'updated' | 'conflict' {
  const existing = getMember(db, id);
  const t = now();
  if (!existing) {
    db.prepare(
      `INSERT INTO members (id, club_id, user_id, full_name, email, phone, personnummer, position, number, photo_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, clubId, f.userId ?? null, clean(f.fullName) || 'Namnlös', clean(f.email)?.toLowerCase() ?? null, clean(f.phone),
      clean(f.personnummer), clean(f.position), clean(f.number), clean(f.photoUrl), t, t);
    return 'created';
  }
  if (existing.club_id !== clubId) return 'conflict';
  const next = {
    full_name: f.fullName !== undefined ? (clean(f.fullName) || existing.full_name) : existing.full_name,
    email: f.email !== undefined ? (clean(f.email)?.toLowerCase() ?? null) : existing.email,
    phone: f.phone !== undefined ? clean(f.phone) : existing.phone,
    personnummer: f.personnummer !== undefined ? clean(f.personnummer) : existing.personnummer,
    position: f.position !== undefined ? clean(f.position) : existing.position,
    number: f.number !== undefined ? clean(f.number) : existing.number,
    photo_url: f.photoUrl !== undefined ? clean(f.photoUrl) : existing.photo_url,
    user_id: f.userId !== undefined && f.userId !== null ? f.userId : existing.user_id,
  };
  const changed = Object.entries(next).some(([k, v]) => (existing as any)[k] !== v);
  if (changed) {
    db.prepare(
      `UPDATE members SET full_name = ?, email = ?, phone = ?, personnummer = ?, position = ?, number = ?, photo_url = ?, user_id = ?, updated_at = ? WHERE id = ?`
    ).run(next.full_name, next.email, next.phone, next.personnummer, next.position, next.number, next.photo_url, next.user_id, t, id);
  }
  return 'updated';
}

function setRole(db: Db, memberId: string, clubId: string, teamId: string, role: string, sort = 0) {
  db.prepare(
    `INSERT INTO team_roles (member_id, club_id, team_id, role, sort) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(member_id, team_id, role) DO UPDATE SET sort = excluded.sort`
  ).run(memberId, clubId, teamId, role, sort);
}

function removeRole(db: Db, memberId: string, teamId: string, role: string) {
  db.prepare('DELETE FROM team_roles WHERE member_id = ? AND team_id = ? AND role = ?').run(memberId, teamId, role);
}

// Dölj känsliga uppgifter för den som inte är tränare/admin.
function contactFields(m: MemberRow, full: boolean) {
  return full
    ? { email: m.email || '', phone: m.phone || undefined, personnummer: m.personnummer || undefined }
    : { email: '' };
}

// ---------------------------------------------------------------------------
// Kompatibilitet: klubbens medlemslista (clubs/<id>/teams/club_global/data/members)
// ---------------------------------------------------------------------------

function memberToClubMember(db: Db, m: MemberRow, full: boolean, isMe = false) {
  const roles = rolesOf(db, m.id);
  return {
    userId: m.id,
    ...contactFields(m, full || isMe),
    ...(isMe ? { isMe: true } : {}),
    fullName: m.full_name,
    position: m.position || undefined,
    number: m.number || undefined,
    photoUrl: m.photo_url || undefined,
    roles: Array.from(new Set(roles.map((r) => r.role))),
    teams: Array.from(new Set(roles.filter((r) => r.team_id !== CLUB_LEVEL).map((r) => r.team_id))),
    accountLinked: !!m.user_id,
  };
}

export function getMembersDoc(db: Db, clubId: string, a: ClubAccess) {
  const full = isClubCoach(a);
  const rows: MemberRow[] = db.prepare('SELECT * FROM members WHERE club_id = ? ORDER BY full_name COLLATE NOCASE').all(clubId);
  const updatedAt = rows.reduce((mx, r) => Math.max(mx, r.updated_at), 0);
  return { members: rows.map((m) => memberToClubMember(db, m, full, a.memberIds.includes(m.id))), updatedAt };
}

export function saveMembersDoc(db: Db, clubId: string, incoming: any[], a: ClubAccess): { changed: number } {
  let changed = 0;
  const canAdmin = a.isClubAdmin;
  db.transaction(() => {
    const seen = new Set<string>();
    for (const e of Array.isArray(incoming) ? incoming : []) {
      if (!e || !e.userId) continue;
      const id = String(e.userId);
      seen.add(id);
      const before = getMember(db, id);
      const beforeShape = before ? memberToClubMember(db, before, true) : null;
      const newRoles = Array.from(new Set<string>((Array.isArray(e.roles) ? e.roles : []).filter((r: string) => VALID_ROLES.includes(r))));
      const newTeams = Array.from(new Set<string>((Array.isArray(e.teams) ? e.teams : []).map(String).filter((t: string) => t && t !== CLUB_LEVEL)));

      const fields = {
        fullName: e.fullName, email: e.email, phone: e.phone, personnummer: e.personnummer,
        position: e.position, number: e.number, photoUrl: e.photoUrl,
      };
      if (beforeShape) {
        const same = ['fullName', 'email', 'phone', 'personnummer', 'position', 'number', 'photoUrl']
          .every((k) => (clean((beforeShape as any)[k]) || '') === (clean((e as any)[k]) || '').toString() || (k === 'email' && lower((beforeShape as any)[k]) === lower(e.email)))
          && sameSet(beforeShape.roles, newRoles) && sameSet(beforeShape.teams, newTeams);
        if (same) continue;
      }
      if (upsertMember(db, clubId, id, fields) === 'conflict') continue;
      changed++;

      // Roller: behåll befintliga par (lag, roll) som fortfarande stämmer, lägg till nya.
      const existing = rolesOf(db, id);
      const targetTeams = newTeams.length > 0 ? newTeams : [CLUB_LEVEL];
      for (const r of existing) {
        if (r.role === 'admin') {
          if (!newRoles.includes('admin') && canAdmin) removeRole(db, id, r.team_id, 'admin');
          continue;
        }
        const teamStillListed = r.team_id === CLUB_LEVEL ? newTeams.length === 0 : newTeams.includes(r.team_id);
        if (!newRoles.includes(r.role) || !teamStillListed) removeRole(db, id, r.team_id, r.role);
      }
      const after = rolesOf(db, id);
      for (const role of newRoles) {
        if (role === 'admin') {
          if (canAdmin && !after.some((r) => r.role === 'admin')) setRole(db, id, clubId, CLUB_LEVEL, 'admin');
          continue;
        }
        const addedRole = !beforeShape || !beforeShape.roles.includes(role);
        for (const t of targetTeams) {
          const addedTeam = !beforeShape || (t === CLUB_LEVEL ? beforeShape.teams.length > 0 : !beforeShape.teams.includes(t));
          if ((addedRole || addedTeam) && !after.some((r) => r.team_id === t && r.role === role)) setRole(db, id, clubId, t, role, 9999);
        }
      }
    }

    // Medlemmar som inte längre finns i listan tas bort (inte administratörer, om man inte själv är admin).
    const all: MemberRow[] = db.prepare('SELECT * FROM members WHERE club_id = ?').all(clubId);
    for (const m of all) {
      if (seen.has(m.id)) continue;
      const isAdminMember = rolesOf(db, m.id).some((r) => r.role === 'admin');
      if (isAdminMember && !canAdmin) continue;
      db.prepare('DELETE FROM team_roles WHERE member_id = ?').run(m.id);
      db.prepare('DELETE FROM members WHERE id = ?').run(m.id);
      changed++;
    }
  })();
  return { changed };
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

// ---------------------------------------------------------------------------
// Kompatibilitet: truppen per lag (clubs/<id>/teams/<lag>/data/squad)
// ---------------------------------------------------------------------------

export function getSquadDoc(db: Db, clubId: string, teamId: string, a: ClubAccess) {
  const full = isTeamCoach(a, teamId);
  const rows = db.prepare(
    `SELECT m.*, r.role, r.sort FROM team_roles r JOIN members m ON m.id = r.member_id
     WHERE r.club_id = ? AND r.team_id = ? AND r.role IN ('player','coach') ORDER BY r.sort, m.full_name COLLATE NOCASE`
  ).all(clubId, teamId);
  const clubAdmins = new Set(db.prepare(`SELECT member_id FROM team_roles WHERE club_id = ? AND role = 'admin'`).all(clubId).map((r: any) => r.member_id));
  const byMember = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!byMember.has(r.id)) byMember.set(r.id, new Set());
    byMember.get(r.id)!.add(r.role);
  }
  const squad: any[] = [];
  let updatedAt = 0;
  for (const r of rows) {
    updatedAt = Math.max(updatedAt, r.updated_at);
    const roles = byMember.get(r.id)!;
    const isLeaderRow = r.role === 'coach';
    const allRoles = new Set<string>(roles);
    if (clubAdmins.has(r.id)) allRoles.add('admin');
    squad.push({
      id: isLeaderRow && roles.has('player') ? `${r.id}_leader` : r.id,
      name: r.full_name,
      role: isLeaderRow ? 'leader' : 'player',
      roles: Array.from(allRoles),
      position: r.position || undefined,
      number: r.number || undefined,
      photoUrl: r.photo_url || undefined,
      ...contactFields(r, full),
      accountLinked: !!r.user_id,
    });
  }
  return { squad, updatedAt };
}

export function saveSquadDoc(db: Db, clubId: string, teamId: string, squad: any[]): { changed: number } {
  let changed = 0;
  db.transaction(() => {
    const desired = new Map<string, { role: string; sort: number }>(); // `${id}|${role}`
    (Array.isArray(squad) ? squad : []).forEach((p: any, i: number) => {
      if (!p || !p.id || !String(p.name || '').trim()) return;
      const baseId = String(p.id).replace(/_leader$/, '');
      const role = p.role === 'leader' ? 'coach' : 'player';
      const res = upsertMember(db, clubId, baseId, {
        fullName: p.name, email: p.email, phone: p.phone, personnummer: p.personnummer,
        position: p.position, number: p.number, photoUrl: p.photoUrl,
      });
      if (res === 'conflict') return;
      desired.set(`${baseId}|${role}`, { role, sort: i });
    });
    const existing = db.prepare(`SELECT member_id, role, sort FROM team_roles WHERE club_id = ? AND team_id = ? AND role IN ('player','coach')`).all(clubId, teamId);
    for (const r of existing) {
      const key = `${r.member_id}|${r.role}`;
      if (!desired.has(key)) { removeRole(db, r.member_id, teamId, r.role); changed++; }
    }
    for (const [key, v] of desired) {
      const memberId = key.split('|')[0];
      const prev = existing.find((r: any) => r.member_id === memberId && r.role === v.role);
      if (!prev || prev.sort !== v.sort) { setRole(db, memberId, clubId, teamId, v.role, v.sort); changed++; }
    }
  })();
  return { changed };
}

// ---------------------------------------------------------------------------
// Svar på kallelser
// ---------------------------------------------------------------------------

export function getRsvpMap(db: Db, clubId: string, teamId: string): Map<string, Record<string, any>> {
  const map = new Map<string, Record<string, any>>();
  const rows = db.prepare('SELECT * FROM rsvps WHERE club_id = ? AND team_id = ?').all(clubId, teamId);
  for (const r of rows) {
    if (!map.has(r.session_id)) map.set(r.session_id, {});
    map.get(r.session_id)![r.member_id] = {
      status: r.status, ...(r.comment ? { comment: r.comment } : {}), updatedAt: r.updated_at, ...(r.updated_by ? { updatedBy: r.updated_by } : {}),
    };
  }
  return map;
}

export function upsertRsvp(db: Db, row: { clubId: string; teamId: string; sessionId: string; memberId: string; status: string; comment?: string | null; updatedAt?: number; updatedBy?: string | null }, onlyIfNewer = false): boolean {
  const ts = Number(row.updatedAt) || now();
  if (onlyIfNewer) {
    const ex: any = db.prepare('SELECT updated_at FROM rsvps WHERE club_id = ? AND team_id = ? AND session_id = ? AND member_id = ?')
      .get(row.clubId, row.teamId, row.sessionId, row.memberId);
    if (ex && ex.updated_at >= ts) return false;
  }
  db.prepare(
    `INSERT INTO rsvps (club_id, team_id, session_id, member_id, status, comment, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(club_id, team_id, session_id, member_id) DO UPDATE SET status = excluded.status, comment = excluded.comment, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(row.clubId, row.teamId, row.sessionId, row.memberId, row.status, row.comment ?? null, ts, row.updatedBy ?? null);
  return true;
}

// Lägger in svar från tabellen i träningspassen (för appens befintliga vyer).
export function overlayRsvps(db: Db, clubId: string, teamId: string, doc: any) {
  if (!doc || !Array.isArray(doc.sessions)) return doc;
  const map = getRsvpMap(db, clubId, teamId);
  return { ...doc, sessions: doc.sessions.map((s: any) => (s && map.has(s.id) ? { ...s, rsvps: map.get(s.id) } : s)) };
}

// Flyttar svar ur träningspassen in i tabellen och returnerar dokumentet utan svar.
export function extractRsvps(db: Db, clubId: string, teamId: string, doc: any, updatedBy?: string) {
  if (!doc || !Array.isArray(doc.sessions)) return doc;
  const sessions = doc.sessions.map((s: any) => {
    if (!s || !s.rsvps || typeof s.rsvps !== 'object') return s;
    for (const [memberId, r] of Object.entries<any>(s.rsvps)) {
      if (!r || !RSVP_STATUSES.includes(r.status)) continue;
      upsertRsvp(db, { clubId, teamId, sessionId: s.id, memberId, status: r.status, comment: r.comment, updatedAt: r.updatedAt, updatedBy: r.updatedBy || updatedBy }, true);
    }
    const { rsvps: _drop, ...rest } = s;
    return rest;
  });
  return { ...doc, sessions };
}

// ---------------------------------------------------------------------------
// Klubblistan (ersätter shared_leaderboards/all_clubs)
// ---------------------------------------------------------------------------

export function listClubs(db: Db) {
  const rows = db.prepare(`SELECT clubId, data FROM clubs_data WHERE teamId = '${CLUB_LEVEL}' AND segment = 'metadata'`).all();
  return rows.map((r: any) => {
    const meta = parse(r.data) || {};
    return { id: r.clubId, name: meta.name || meta.clubName || 'Klubb', teams: Array.isArray(meta.teams) ? meta.teams : [] };
  }).sort((x: any, y: any) => String(x.name).localeCompare(String(y.name), 'sv'));
}

// ---------------------------------------------------------------------------
// Engångsflytt av befintlig data till registret
// ---------------------------------------------------------------------------

export const REGISTRY_VERSION = 1;

export function migrateRegistry(db: Db, log: (msg: string) => void = console.log) {
  const versionRow: any = db.prepare(`SELECT data FROM system_docs WHERE path = 'system/registry_version'`).get();
  if (versionRow && Number(parse(versionRow.data)) >= REGISTRY_VERSION) return;

  const stats = { clubs: 0, members: 0, roles: 0, rsvps: 0, personalTeams: 0 };
  db.transaction(() => {
    const clubIds: string[] = db.prepare('SELECT DISTINCT clubId FROM clubs_data').all().map((r: any) => r.clubId).filter(Boolean);
    for (const clubId of clubIds) {
      stats.clubs++;
      const docs: any[] = db.prepare('SELECT teamId, segment, data FROM clubs_data WHERE clubId = ?').all(clubId);

      // 1. Trupper (källan till de id som historiken pekar på)
      for (const d of docs.filter((x) => x.segment === 'squad' && x.teamId !== CLUB_LEVEL)) {
        const parsed = parse(d.data);
        const squad: any[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.squad) ? parsed.squad : []);
        squad.forEach((p: any, i: number) => {
          if (!p?.id || !String(p.name || '').trim()) return;
          const id = String(p.id).replace(/_leader$/, '');
          if (upsertMember(db, clubId, id, {
            fullName: p.name, email: p.email || undefined, phone: p.phone || undefined, personnummer: p.personnummer || undefined,
            position: p.position || undefined, number: p.number || undefined, photoUrl: p.photoUrl || undefined,
          }) === 'created') stats.members++;
          setRole(db, id, clubId, d.teamId, p.role === 'leader' ? 'coach' : 'player', i); stats.roles++;
          if (Array.isArray(p.roles) && p.roles.includes('admin')) { setRole(db, id, clubId, CLUB_LEVEL, 'admin'); stats.roles++; }
        });
      }

      // 2. Klubbens medlemslista: kopplar konton och ger roller på föreningsnivå
      const membersDoc = docs.find((x) => x.segment === 'members' && x.teamId === CLUB_LEVEL);
      const list: any[] = (() => { const p = parse(membersDoc?.data); return Array.isArray(p) ? p : (Array.isArray(p?.members) ? p.members : []); })();
      for (const e of list) {
        if (!e?.userId) continue;
        const email = lower(e.email);
        let target: MemberRow | undefined = getMember(db, String(e.userId));
        if (target && target.club_id !== clubId) target = undefined;
        if (!target && email) target = db.prepare('SELECT * FROM members WHERE club_id = ? AND LOWER(email) = ?').get(clubId, email);
        const isRealUser = !!db.prepare('SELECT 1 FROM users WHERE id = ?').get(String(e.userId));
        let memberId: string;
        if (target) {
          memberId = target.id;
          upsertMember(db, clubId, memberId, {
            email: target.email ? undefined : (e.email || undefined), phone: target.phone ? undefined : (e.phone || undefined),
            personnummer: target.personnummer ? undefined : (e.personnummer || undefined), photoUrl: target.photo_url ? undefined : (e.photoUrl || undefined),
            userId: isRealUser ? String(e.userId) : undefined,
          });
        } else {
          memberId = String(e.userId);
          upsertMember(db, clubId, memberId, {
            fullName: e.fullName, email: e.email, phone: e.phone, personnummer: e.personnummer, position: e.position,
            number: e.number, photoUrl: e.photoUrl, userId: isRealUser ? memberId : null,
          });
          stats.members++;
          const roles: string[] = Array.isArray(e.roles) ? e.roles : [];
          for (const role of roles.filter((r) => VALID_ROLES.includes(r) && r !== 'admin')) { setRole(db, memberId, clubId, CLUB_LEVEL, role); stats.roles++; }
        }
        if (Array.isArray(e.roles) && e.roles.includes('admin')) { setRole(db, memberId, clubId, CLUB_LEVEL, 'admin'); stats.roles++; }
      }

      // 3. Svar på kallelser flyttas ur träningspassen
      for (const d of docs.filter((x) => x.segment === 'sessions')) {
        const parsed = parse(d.data);
        if (!parsed) continue;
        const doc = Array.isArray(parsed) ? { sessions: parsed } : parsed;
        const before = (doc.sessions || []).reduce((n: number, s: any) => n + Object.keys(s?.rsvps || {}).length, 0);
        const stripped = extractRsvps(db, clubId, d.teamId, doc);
        stats.rsvps += before;
        db.prepare('UPDATE clubs_data SET data = ? WHERE clubId = ? AND teamId = ? AND segment = ?')
          .run(JSON.stringify(Array.isArray(parsed) ? stripped.sessions : stripped), clubId, d.teamId, 'sessions');
      }
    }

    // 4. Koppla medlemmar till konton
    const users: any[] = db.prepare('SELECT id, email FROM users').all();
    for (const u of users) linkMembersToUser(db, u);

    // 5. Tränare som bara haft data under sitt eget konto får ett eget lag
    for (const u of users) {
      const personal: any[] = db.prepare(`SELECT segment, data, updatedAt FROM users_data WHERE userId = ? AND segment IN ('squad','sessions','exercises','lineups','periods','settings')`).all(u.id);
      const hasContent = personal.some((p) => {
        const v = parse(p.data);
        return v && (['squad', 'sessions', 'exercises', 'lineups'].some((k) => Array.isArray(v[k]) && v[k].length > 0) || (Array.isArray(v) && v.length > 0));
      });
      if (!hasContent) continue;
      if (getManagedClubIds(db, u).length > 0) continue;
      const clubId = 'club_' + crypto.randomBytes(5).toString('hex');
      const teamId = 'team_' + crypto.randomBytes(5).toString('hex');
      const t = now();
      db.prepare('INSERT INTO clubs_data (clubId, teamId, segment, data, updatedAt) VALUES (?, ?, ?, ?, ?)')
        .run(clubId, CLUB_LEVEL, 'metadata', JSON.stringify({ id: clubId, name: 'Mitt lag', teams: [{ id: teamId, name: 'Mitt lag' }] }), t);
      for (const p of personal) {
        if (p.segment === 'squad') continue;
        db.prepare('INSERT OR REPLACE INTO clubs_data (clubId, teamId, segment, data, updatedAt) VALUES (?, ?, ?, ?, ?)').run(clubId, teamId, p.segment, p.data, p.updatedAt || t);
      }
      const squadRow = personal.find((p) => p.segment === 'squad');
      const sq = parse(squadRow?.data);
      saveSquadDoc(db, clubId, teamId, Array.isArray(sq) ? sq : (sq?.squad || []));
      const me = db.prepare('SELECT id FROM members WHERE club_id = ? AND (id = ? OR LOWER(email) = ?)').get(clubId, u.id, lower(u.email));
      const meId = me?.id || u.id;
      if (!me) upsertMember(db, clubId, meId, { fullName: String(u.email).split('@')[0], email: u.email, userId: u.id });
      setRole(db, meId, clubId, CLUB_LEVEL, 'admin');
      setRole(db, meId, clubId, teamId, 'coach');
      linkMembersToUser(db, u);
      const profRow: any = db.prepare(`SELECT data FROM users_data WHERE userId = ? AND segment = 'profile'`).get(u.id);
      const prof = { ...(parse(profRow?.data) || {}), activeClubId: clubId, activeTeamId: teamId };
      db.prepare(`INSERT INTO users_data (userId, segment, data, updatedAt) VALUES (?, 'profile', ?, ?)
        ON CONFLICT(userId, segment) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`).run(u.id, JSON.stringify(prof), t);
      stats.personalTeams++;
    }

    // 6. Skräpposter från tidigare buggar (sökvägar som råkat bli JSON-text)
    db.prepare(`DELETE FROM system_docs WHERE path LIKE '{%'`).run();

    db.prepare(`INSERT INTO system_docs (path, data, updatedAt) VALUES ('system/registry_version', ?, ?)
      ON CONFLICT(path) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`).run(JSON.stringify(REGISTRY_VERSION), now());
  })();
  log(`[Register] Flytt klar: ${stats.clubs} klubbar, ${stats.members} medlemmar, ${stats.roles} roller, ${stats.rsvps} svar, ${stats.personalTeams} egna lag skapade.`);
}
