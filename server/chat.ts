// Chatt: lagchattar, gruppchattar och en-till-en-chattar inom en förening.
//
// - Varje lag har en lagchatt som skapas automatiskt. Vem som är med bestäms av laget.
// - Alla i föreningen som har konto kan starta en-till-en-chattar och grupper.
// - Grupper sköts av sina gruppadmins (den som skapade gruppen och de hen utser).
// - Privata chattar är privata – inte ens root-admin läser dem. Olämpliga meddelanden kan
//   anmälas; då ser föreningsadmin och tränare i avsändarens lag just det meddelandet.
// - Bilder och filer sparas i mappen chat_files/ och lämnas bara ut till dem som är med.
// - Inga notiser finns: appen frågar efter nya meddelanden med jämna mellanrum. Varje ändring
//   (nytt, ändrat, borttaget meddelande eller reaktion) får ett nytt rev-nummer, så appen kan
//   fråga efter "allt som ändrats sedan rev X".
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import type express from 'express';
import type { Db } from './database.ts';
import * as registry from './registry.ts';
import { normalizeEmoji, REACTIONS } from './posts.ts';

export const LIMITS = {
  body: 4000,
  name: 60,
  reason: 500,
  groupSize: 100,
  messagesPerMinute: 30,
  groupsPerDay: 20,
  reactionsPerPerson: 20,
  editMinutes: 15,
  pageSize: 50,
  fileSize: 10 * 1024 * 1024,
  filesPerMessage: 5,
  clubFileQuota: 1024 * 1024 * 1024,
};

// Filtyper som får skickas. Allt annat nekas (t.ex. program, html, svg).
const FILE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
};
const isImageMime = (m: string) => m.startsWith('image/');

type Kind = 'team' | 'group' | 'direct';

interface ConvRow {
  id: string; club_id: string; kind: Kind; team_id: string | null; name: string | null; direct_key: string | null;
  created_by: string | null; created_at: number; last_message_seq: number; last_message_at: number | null;
}
interface PartRow { conversation_id: string; user_id: string; role: string; joined_at: number; left_at: number | null; last_read_seq: number }
interface MsgRow {
  seq: number; conversation_id: string; user_id: string | null; author_name: string | null; kind: string; body: string;
  attachments: string | null; created_at: number; edited_at: number | null; deleted_at: number | null; deleted_by: string | null; rev: number;
}

export interface Attachment { id: string; name: string; mime: string; size: number }
export interface Person { userId: string; name: string; photoUrl: string | null; teams: string[] }

const newId = () => crypto.randomBytes(9).toString('base64url');
const now = () => Date.now();
const parseJson = (raw: string | null) => { try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; } };
const firstName = (n: string) => (n || '').trim().split(/\s+/)[0] || n;
const cleanText = (v: unknown) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '');

class ChatError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (status: number, message: string): never => { throw new ChatError(status, message); };

// ---------------------------------------------------------------------------
// Föreningens personer och lag
// ---------------------------------------------------------------------------

// Alla med konto i föreningen. Bara namn, bild och lag – aldrig personnummer, telefon eller e-post.
export function clubPeople(db: Db, clubId: string): Map<string, Person> {
  const out = new Map<string, Person>();
  const rows = db.prepare(
    `SELECT m.id, m.user_id, m.full_name, m.photo_url, u.avatar_url FROM members m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.club_id = ? AND m.user_id IS NOT NULL AND m.user_id != '' ORDER BY m.full_name COLLATE NOCASE`
  ).all(clubId);
  const byMember = new Map<string, Person>();
  for (const r of rows) {
    let p = out.get(r.user_id);
    if (!p) {
      p = { userId: r.user_id, name: r.full_name || 'Okänd', photoUrl: r.photo_url || r.avatar_url || null, teams: [] };
      out.set(r.user_id, p);
    }
    byMember.set(r.id, p);
  }
  if (byMember.size) {
    for (const r of db.prepare(`SELECT member_id, team_id FROM team_roles WHERE club_id = ? AND team_id != ?`).all(clubId, registry.CLUB_LEVEL)) {
      const p = byMember.get(r.member_id);
      if (p && !p.teams.includes(r.team_id)) p.teams.push(r.team_id);
    }
  }
  return out;
}

export function teamNames(db: Db, clubId: string): Map<string, string> {
  const row: any = db.prepare(`SELECT data FROM clubs_data WHERE clubId = ? AND teamId = ? AND segment = 'metadata'`).get(clubId, registry.CLUB_LEVEL);
  const out = new Map<string, string>();
  try {
    const meta = row?.data ? JSON.parse(row.data) : null;
    for (const t of Array.isArray(meta?.teams) ? meta.teams : []) if (t?.id) out.set(String(t.id), String(t.name || t.id));
  } catch { /* trasig metadata: inga namn */ }
  return out;
}

// Har personen en egen roll i laget? (Föreningsadmin räknas inte automatiskt in i lagchattar.)
const inTeam = (a: registry.ClubAccess, teamId: string) => (a.teamRoles.get(teamId)?.size || 0) > 0;

// ---------------------------------------------------------------------------
// Inloggad person i en förening
// ---------------------------------------------------------------------------

export interface Ctx {
  user: any;
  clubId: string;
  access: registry.ClubAccess;
  me: { userId: string; name: string };
}

export function clubCtx(db: Db, user: any, clubId: unknown, isRoot: boolean): Ctx {
  if (typeof clubId !== 'string' || !clubId || clubId.length > 200) fail(400, 'clubId krävs.');
  const id = clubId as string;
  const access = registry.getClubAccess(db, user, id, isRoot);
  if (!registry.isClubMember(access)) fail(403, 'Du är inte med i föreningen.');
  const me: any = db.prepare(`SELECT full_name FROM members WHERE club_id = ? AND user_id = ? LIMIT 1`).get(id, String(user.id));
  if (!me) fail(403, 'Du behöver finnas i föreningens medlemsregister för att chatta.');
  return { user, clubId: id, access, me: { userId: String(user.id), name: me.full_name || 'Okänd' } };
}

// ---------------------------------------------------------------------------
// Rev-nummer
// ---------------------------------------------------------------------------

function nextRev(db: Db): number {
  const rev = Number(db.prepare('INSERT INTO chat_revs (at) VALUES (?)').run(now()).lastInsertRowid);
  db.prepare('DELETE FROM chat_revs WHERE rev < ?').run(rev);
  return rev;
}

// ---------------------------------------------------------------------------
// Chattar
// ---------------------------------------------------------------------------

const getConv = (db: Db, id: unknown): ConvRow | undefined =>
  typeof id === 'string' && id.length <= 64 ? db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id) : undefined;
const getPart = (db: Db, convId: string, userId: string): PartRow | undefined =>
  db.prepare('SELECT * FROM chat_participants WHERE conversation_id = ? AND user_id = ?').get(convId, userId);

// Lagchatten för ett lag (skapas första gången någon behöver den).
function ensureTeamConv(db: Db, clubId: string, teamId: string): ConvRow {
  db.prepare(
    `INSERT OR IGNORE INTO chat_conversations (id, club_id, kind, team_id, created_at) VALUES (?, ?, 'team', ?, ?)`
  ).run(newId(), clubId, teamId, now());
  return db.prepare(`SELECT * FROM chat_conversations WHERE club_id = ? AND team_id = ? AND kind = 'team'`).get(clubId, teamId);
}

// Läsraden för en person i en lagchatt. En ny rad börjar som "allt läst", så att den som just
// kommit med i laget inte får hela historiken som olästa.
function ensureTeamPart(db: Db, conv: ConvRow, userId: string): PartRow {
  db.prepare(
    `INSERT OR IGNORE INTO chat_participants (conversation_id, user_id, role, joined_at, last_read_seq) VALUES (?, ?, 'member', ?, ?)`
  ).run(conv.id, userId, now(), conv.last_message_seq);
  return getPart(db, conv.id, userId)!;
}

export interface ConvAccess { ctx: Ctx; conv: ConvRow; part: PartRow; isAdmin: boolean }

// Chatten plus den inloggades plats i den. Den som inte är med får 404 (så att det inte
// avslöjar att chatten finns).
export function convAccess(db: Db, user: any, convId: unknown, isRoot: boolean): ConvAccess {
  const conv = getConv(db, convId);
  if (!conv) fail(404, 'Chatten finns inte.');
  let ctx: Ctx;
  try { ctx = clubCtx(db, user, conv!.club_id, isRoot); } catch { return fail(404, 'Chatten finns inte.'); }
  if (conv!.kind === 'team') {
    if (!conv!.team_id || !inTeam(ctx!.access, conv!.team_id)) fail(404, 'Chatten finns inte.');
    return { ctx: ctx!, conv: conv!, part: ensureTeamPart(db, conv!, ctx!.me.userId), isAdmin: false };
  }
  const part = getPart(db, conv!.id, ctx!.me.userId);
  if (!part || part.left_at) fail(404, 'Chatten finns inte.');
  return { ctx: ctx!, conv: conv!, part: part!, isAdmin: part!.role === 'admin' };
}

interface Participant { userId: string; name: string; photoUrl: string | null; role: string; lastReadSeq: number }

function participants(db: Db, conv: ConvRow, people: Map<string, Person>): Participant[] {
  const reads = new Map<string, PartRow>();
  for (const r of db.prepare('SELECT * FROM chat_participants WHERE conversation_id = ?').all(conv.id) as PartRow[]) reads.set(r.user_id, r);
  const out: Participant[] = [];
  if (conv.kind === 'team') {
    for (const p of people.values()) {
      if (!p.teams.includes(conv.team_id!)) continue;
      out.push({ userId: p.userId, name: p.name, photoUrl: p.photoUrl, role: 'member', lastReadSeq: reads.get(p.userId)?.last_read_seq || 0 });
    }
  } else {
    for (const r of reads.values()) {
      const p = people.get(r.user_id);
      if (r.left_at || !p) continue; // lämnat chatten eller föreningen
      out.push({ userId: r.user_id, name: p.name, photoUrl: p.photoUrl, role: r.role, lastReadSeq: r.last_read_seq });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

function displayName(conv: ConvRow, myId: string, parts: { userId: string; name: string }[], teams: Map<string, string>): string {
  if (conv.kind === 'team') return teams.get(conv.team_id!) || 'Lagchatt';
  if (conv.name) return conv.name;
  const others = parts.filter((p) => p.userId !== myId);
  if (conv.kind === 'direct') return others[0]?.name || 'Tidigare medlem';
  if (!others.length) return 'Bara du';
  const names = others.slice(0, 3).map((p) => firstName(p.name));
  return names.join(', ') + (others.length > 3 ? ` och ${others.length - 3} till` : '');
}

export interface MessageView {
  seq: number; rev: number; userId: string | null; authorName: string; kind: 'text' | 'event';
  body: string; attachments: Attachment[]; createdAt: number; editedAt: number | null; deleted: boolean;
  reactions: Record<string, number>; myReactions: string[]; isMine: boolean;
}

function messageViews(db: Db, rows: MsgRow[], myId: string): MessageView[] {
  const reactions = new Map<number, { emoji: string; user_id: string }[]>();
  if (rows.length) {
    const seqs = rows.map((r) => r.seq);
    for (const r of db.prepare(`SELECT message_seq, emoji, user_id FROM chat_reactions WHERE message_seq IN (${seqs.map(() => '?').join(',')}) ORDER BY created_at`).all(...seqs)) {
      if (!reactions.has(r.message_seq)) reactions.set(r.message_seq, []);
      reactions.get(r.message_seq)!.push(r);
    }
  }
  return rows.map((r) => {
    const counts: Record<string, number> = {};
    const mine: string[] = [];
    for (const x of reactions.get(r.seq) || []) {
      counts[x.emoji] = (counts[x.emoji] || 0) + 1;
      if (x.user_id === myId) mine.push(x.emoji);
    }
    const deleted = !!r.deleted_at;
    return {
      seq: r.seq, rev: r.rev, userId: r.user_id, authorName: r.author_name || 'Okänd', kind: r.kind === 'event' ? 'event' : 'text',
      body: deleted ? '' : r.body, attachments: deleted ? [] : parseJson(r.attachments), createdAt: r.created_at,
      editedAt: r.edited_at, deleted, reactions: counts, myReactions: mine, isMine: r.user_id === myId,
    };
  });
}

const unreadCount = (db: Db, convId: string, lastRead: number, myId: string): number =>
  Number((db.prepare(
    `SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ? AND seq > ? AND kind = 'text' AND deleted_at IS NULL AND (user_id IS NULL OR user_id != ?)`
  ).get(convId, lastRead, myId) as any)?.n || 0);

function preview(m: MsgRow | undefined): string {
  if (!m) return '';
  if (m.deleted_at) return 'Meddelandet togs bort';
  if (m.body) return m.body.slice(0, 120);
  const atts: Attachment[] = parseJson(m.attachments);
  if (!atts.length) return '';
  if (atts.every((a) => isImageMime(a.mime))) return atts.length > 1 ? `📷 ${atts.length} bilder` : '📷 Bild';
  return atts.length > 1 ? `📎 ${atts.length} bilagor` : `📎 ${atts[0].name}`;
}

export interface ConversationSummary {
  id: string; kind: Kind; teamId: string | null; name: string; photoUrl: string | null;
  lastMessage: { seq: number; authorName: string; isMine: boolean; text: string; createdAt: number; kind: string } | null;
  lastMessageAt: number; unread: number; memberCount: number;
}

// Den inloggades chattar i föreningen (lagchattar för egna lag skapas här vid behov).
function myConversations(db: Db, ctx: Ctx): { conv: ConvRow; part: PartRow }[] {
  for (const teamId of ctx.access.teamRoles.keys()) {
    if (teamId === registry.CLUB_LEVEL || !inTeam(ctx.access, teamId)) continue;
    ensureTeamPart(db, ensureTeamConv(db, ctx.clubId, teamId), ctx.me.userId);
  }
  const rows = db.prepare(
    `SELECT c.*, p.role AS p_role, p.joined_at AS p_joined_at, p.left_at AS p_left_at, p.last_read_seq AS p_last_read_seq
     FROM chat_participants p JOIN chat_conversations c ON c.id = p.conversation_id
     WHERE p.user_id = ? AND c.club_id = ? AND p.left_at IS NULL`
  ).all(ctx.me.userId, ctx.clubId);
  const out: { conv: ConvRow; part: PartRow }[] = [];
  for (const r of rows) {
    const conv: ConvRow = r;
    if (conv.kind === 'team' && !inTeam(ctx.access, conv.team_id || '')) continue;
    // En en-till-en-chatt syns för mottagaren först när något har skrivits.
    if (conv.kind === 'direct' && !conv.last_message_seq && conv.created_by !== ctx.me.userId) continue;
    out.push({ conv, part: { conversation_id: conv.id, user_id: ctx.me.userId, role: r.p_role, joined_at: r.p_joined_at, left_at: null, last_read_seq: r.p_last_read_seq } });
  }
  return out;
}

export function listConversations(db: Db, ctx: Ctx): ConversationSummary[] {
  const people = clubPeople(db, ctx.clubId);
  const teams = teamNames(db, ctx.clubId);
  const out: ConversationSummary[] = [];
  for (const { conv, part } of myConversations(db, ctx)) {
    const parts = participants(db, conv, people);
    const last: MsgRow | undefined = db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT 1').get(conv.id);
    const other = conv.kind === 'direct' ? parts.find((p) => p.userId !== ctx.me.userId) : undefined;
    out.push({
      id: conv.id, kind: conv.kind, teamId: conv.team_id, name: displayName(conv, ctx.me.userId, parts, teams),
      photoUrl: other?.photoUrl || null,
      lastMessage: last ? { seq: last.seq, authorName: last.author_name || '', isMine: last.user_id === ctx.me.userId, text: preview(last), createdAt: last.created_at, kind: last.kind } : null,
      lastMessageAt: conv.last_message_at || conv.created_at,
      unread: unreadCount(db, conv.id, part.last_read_seq, ctx.me.userId),
      memberCount: parts.length,
    });
  }
  // Lagchattar först, sedan senaste aktivitet.
  return out.sort((a, b) => Number(b.kind === 'team') - Number(a.kind === 'team') || b.lastMessageAt - a.lastMessageAt);
}

export function summary(db: Db, ctx: Ctx): { unreadChats: number; unreadMessages: number; unread: Record<string, number> } {
  const unread: Record<string, number> = {};
  let unreadChats = 0, unreadMessages = 0;
  for (const { conv, part } of myConversations(db, ctx)) {
    if (conv.last_message_seq <= part.last_read_seq) continue;
    const n = unreadCount(db, conv.id, part.last_read_seq, ctx.me.userId);
    if (!n) continue;
    unread[conv.id] = n;
    unreadChats++;
    unreadMessages += n;
  }
  return { unreadChats, unreadMessages, unread };
}

export interface ConversationDetail {
  id: string; kind: Kind; teamId: string | null; name: string; customName: string | null;
  participants: Participant[]; isAdmin: boolean; canModerate: boolean; canTakeOver: boolean; createdAt: number;
}

export function conversationDetail(db: Db, a: ConvAccess): ConversationDetail {
  const people = clubPeople(db, a.ctx.clubId);
  const parts = participants(db, a.conv, people);
  return {
    id: a.conv.id, kind: a.conv.kind, teamId: a.conv.team_id,
    name: displayName(a.conv, a.ctx.me.userId, parts, teamNames(db, a.ctx.clubId)), customName: a.conv.name,
    participants: parts, isAdmin: a.isAdmin,
    // Lagets tränare kan ta bort meddelanden i lagchatten.
    canModerate: a.conv.kind === 'team' && registry.isTeamCoach(a.ctx.access, a.conv.team_id!),
    canTakeOver: a.conv.kind === 'group' && !a.isAdmin && a.ctx.access.isClubAdmin,
    createdAt: a.conv.created_at,
  };
}

// ---------------------------------------------------------------------------
// Starta chatt och sköta grupper
// ---------------------------------------------------------------------------

function addEvent(db: Db, conv: ConvRow, actor: { userId: string; name: string }, text: string) {
  const rev = nextRev(db);
  const at = now();
  const seq = Number(db.prepare(
    `INSERT INTO chat_messages (conversation_id, user_id, author_name, kind, body, created_at, rev) VALUES (?, ?, ?, 'event', ?, ?, ?)`
  ).run(conv.id, actor.userId, actor.name, text, at, rev).lastInsertRowid);
  db.prepare('UPDATE chat_conversations SET last_message_seq = ?, last_message_at = ? WHERE id = ?').run(seq, at, conv.id);
  db.prepare('UPDATE chat_participants SET last_read_seq = ? WHERE conversation_id = ? AND user_id = ?').run(seq, conv.id, actor.userId);
  conv.last_message_seq = seq;
  conv.last_message_at = at;
}

const listNames = (names: string[]) => names.length <= 1 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} och ${names[names.length - 1]}`;

function validUserIds(raw: unknown, people: Map<string, Person>, myId: string): string[] {
  if (!Array.isArray(raw)) fail(400, 'Välj minst en person.');
  const ids = Array.from(new Set((raw as unknown[]).filter((x): x is string => typeof x === 'string' && x !== myId)));
  if (ids.length > LIMITS.groupSize) fail(400, `En grupp kan ha högst ${LIMITS.groupSize} deltagare.`);
  for (const id of ids) if (!people.has(id)) fail(400, 'Någon av personerna finns inte i föreningen.');
  return ids;
}

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (name.length > LIMITS.name) fail(400, `Namnet får vara högst ${LIMITS.name} tecken.`);
  return name;
}

// En person och inget namn → en-till-en-chatt (samma chatt återanvänds). Annars en grupp.
export function startConversation(db: Db, ctx: Ctx, body: any): ConvRow {
  const people = clubPeople(db, ctx.clubId);
  const ids = validUserIds(body?.userIds, people, ctx.me.userId);
  if (!ids.length) fail(400, 'Välj minst en person.');
  const name = cleanName(body?.name);
  const me = ctx.me.userId;
  const t = now();

  if (ids.length === 1 && !name) {
    const key = [me, ids[0]].sort().join(':');
    return db.transaction(() => {
      let conv: ConvRow | undefined = db.prepare(`SELECT * FROM chat_conversations WHERE club_id = ? AND direct_key = ? AND kind = 'direct'`).get(ctx.clubId, key);
      if (!conv) {
        const id = newId();
        db.prepare(`INSERT INTO chat_conversations (id, club_id, kind, direct_key, created_by, created_at) VALUES (?, ?, 'direct', ?, ?, ?)`).run(id, ctx.clubId, key, me, t);
        conv = getConv(db, id)!;
      }
      for (const uid of [me, ids[0]]) {
        db.prepare(
          `INSERT INTO chat_participants (conversation_id, user_id, role, joined_at, last_read_seq) VALUES (?, ?, 'member', ?, 0)
           ON CONFLICT(conversation_id, user_id) DO UPDATE SET left_at = NULL`
        ).run(conv.id, uid, t);
      }
      return conv;
    })();
  }

  if (ids.length + 1 > LIMITS.groupSize) fail(400, `En grupp kan ha högst ${LIMITS.groupSize} deltagare.`);
  const recent = Number((db.prepare(`SELECT COUNT(*) AS n FROM chat_conversations WHERE created_by = ? AND kind = 'group' AND created_at > ?`).get(me, t - 24 * 3600_000) as any)?.n || 0);
  if (recent >= LIMITS.groupsPerDay) fail(429, `Du kan skapa högst ${LIMITS.groupsPerDay} grupper per dygn.`);
  return db.transaction(() => {
    const id = newId();
    db.prepare(`INSERT INTO chat_conversations (id, club_id, kind, name, created_by, created_at) VALUES (?, ?, 'group', ?, ?, ?)`).run(id, ctx.clubId, name || null, me, t);
    const ins = db.prepare(`INSERT INTO chat_participants (conversation_id, user_id, role, joined_at, last_read_seq) VALUES (?, ?, ?, ?, 0)`);
    ins.run(id, me, 'admin', t);
    for (const uid of ids) ins.run(id, uid, 'member', t);
    const conv = getConv(db, id)!;
    addEvent(db, conv, ctx.me, `${ctx.me.name} skapade gruppen${name ? ` "${name}"` : ''}`);
    return conv;
  })();
}

const requireGroupAdmin = (a: ConvAccess) => {
  if (a.conv.kind !== 'group') fail(400, 'Det går bara att ändra gruppchattar.');
  if (!a.isAdmin) fail(403, 'Bara gruppens admin kan göra det.');
};

export function renameGroup(db: Db, a: ConvAccess, raw: unknown) {
  requireGroupAdmin(a);
  const name = cleanName(raw);
  if ((a.conv.name || '') === name) return;
  db.transaction(() => {
    db.prepare('UPDATE chat_conversations SET name = ? WHERE id = ?').run(name || null, a.conv.id);
    addEvent(db, a.conv, a.ctx.me, name ? `${a.ctx.me.name} bytte namn på gruppen till "${name}"` : `${a.ctx.me.name} tog bort gruppens namn`);
  })();
}

export function addParticipants(db: Db, a: ConvAccess, raw: unknown) {
  requireGroupAdmin(a);
  const people = clubPeople(db, a.ctx.clubId);
  const current = participants(db, a.conv, people).map((p) => p.userId);
  const ids = validUserIds(raw, people, a.ctx.me.userId).filter((id) => !current.includes(id));
  if (!ids.length) return;
  if (current.length + ids.length > LIMITS.groupSize) fail(400, `En grupp kan ha högst ${LIMITS.groupSize} deltagare.`);
  db.transaction(() => {
    for (const uid of ids) {
      db.prepare(
        `INSERT INTO chat_participants (conversation_id, user_id, role, joined_at, last_read_seq) VALUES (?, ?, 'member', ?, ?)
         ON CONFLICT(conversation_id, user_id) DO UPDATE SET left_at = NULL, role = 'member', joined_at = excluded.joined_at, last_read_seq = excluded.last_read_seq`
      ).run(a.conv.id, uid, now(), a.conv.last_message_seq);
    }
    addEvent(db, a.conv, a.ctx.me, `${a.ctx.me.name} lade till ${listNames(ids.map((id) => people.get(id)!.name))}`);
  })();
}

// Ta bort någon (gruppadmin) eller lämna själv. Lämnar sista admin blir den som varit med längst admin.
export function removeParticipant(db: Db, a: ConvAccess, userId: string) {
  const leaving = userId === a.ctx.me.userId;
  if (a.conv.kind !== 'group') fail(400, leaving ? 'Det går bara att lämna gruppchattar.' : 'Det går bara att ändra gruppchattar.');
  if (!leaving && !a.isAdmin) fail(403, 'Bara gruppens admin kan ta bort deltagare.');
  const target = getPart(db, a.conv.id, userId);
  if (!target || target.left_at) fail(404, 'Personen är inte med i gruppen.');
  const people = clubPeople(db, a.ctx.clubId);
  db.transaction(() => {
    db.prepare(`UPDATE chat_participants SET left_at = ?, role = 'member' WHERE conversation_id = ? AND user_id = ?`).run(now(), a.conv.id, userId);
    const admins = Number((db.prepare(`SELECT COUNT(*) AS n FROM chat_participants WHERE conversation_id = ? AND left_at IS NULL AND role = 'admin'`).get(a.conv.id) as any)?.n || 0);
    if (!admins) {
      const next: any = db.prepare(`SELECT user_id FROM chat_participants WHERE conversation_id = ? AND left_at IS NULL ORDER BY joined_at, user_id LIMIT 1`).get(a.conv.id);
      if (next) db.prepare(`UPDATE chat_participants SET role = 'admin' WHERE conversation_id = ? AND user_id = ?`).run(a.conv.id, next.user_id);
    }
    addEvent(db, a.conv, a.ctx.me, leaving ? `${a.ctx.me.name} lämnade gruppen` : `${a.ctx.me.name} tog bort ${people.get(userId)?.name || 'en deltagare'}`);
  })();
}

// Gruppadmin gör någon till admin. En föreningsadmin som är med i gruppen kan göra sig själv
// till admin ("ta över" gruppen).
export function makeAdmin(db: Db, a: ConvAccess, userId: string) {
  if (a.conv.kind !== 'group') fail(400, 'Det går bara att ändra gruppchattar.');
  const takeover = userId === a.ctx.me.userId && a.ctx.access.isClubAdmin;
  if (!a.isAdmin && !takeover) fail(403, 'Bara gruppens admin kan göra det.');
  const target = getPart(db, a.conv.id, userId);
  if (!target || target.left_at) fail(404, 'Personen är inte med i gruppen.');
  if (target.role === 'admin') return;
  const people = clubPeople(db, a.ctx.clubId);
  db.transaction(() => {
    db.prepare(`UPDATE chat_participants SET role = 'admin' WHERE conversation_id = ? AND user_id = ?`).run(a.conv.id, userId);
    addEvent(db, a.conv, a.ctx.me, takeover && !a.isAdmin ? `${a.ctx.me.name} (föreningsadmin) tog över som gruppadmin` : `${a.ctx.me.name} gjorde ${people.get(userId)?.name || 'en deltagare'} till gruppadmin`);
  })();
}

// ---------------------------------------------------------------------------
// Meddelanden
// ---------------------------------------------------------------------------

const getMsg = (db: Db, convId: string, seq: unknown): MsgRow | undefined => {
  const n = Number(seq);
  return Number.isInteger(n) && n > 0 ? db.prepare('SELECT * FROM chat_messages WHERE seq = ? AND conversation_id = ?').get(n, convId) : undefined;
};

const maxRev = (db: Db, convId: string): number =>
  Number((db.prepare('SELECT MAX(rev) AS r FROM chat_messages WHERE conversation_id = ?').get(convId) as any)?.r || 0);

const readsOf = (db: Db, convId: string) =>
  (db.prepare('SELECT user_id, last_read_seq FROM chat_participants WHERE conversation_id = ? AND left_at IS NULL').all(convId) as any[])
    .map((r) => ({ userId: r.user_id, lastReadSeq: r.last_read_seq }));

// Senaste sidan (eller äldre med before), eller allt som ändrats efter ett rev-nummer.
export function getMessages(db: Db, a: ConvAccess, q: { before?: unknown; after?: unknown }) {
  const me = a.ctx.me.userId;
  if (q.after !== undefined && q.after !== '') {
    const after = Math.max(0, Number(q.after) || 0);
    const rows: MsgRow[] = db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? AND rev > ? ORDER BY seq LIMIT 500').all(a.conv.id, after);
    return { messages: messageViews(db, rows, me), cursor: maxRev(db, a.conv.id), reads: readsOf(db, a.conv.id), hasMore: false };
  }
  const before = Number(q.before) > 0 ? Number(q.before) : Number.MAX_SAFE_INTEGER;
  const rows: MsgRow[] = db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?').all(a.conv.id, before, LIMITS.pageSize + 1);
  const hasMore = rows.length > LIMITS.pageSize;
  const page = rows.slice(0, LIMITS.pageSize).reverse();
  return { messages: messageViews(db, page, me), cursor: maxRev(db, a.conv.id), reads: readsOf(db, a.conv.id), hasMore };
}

export function sendMessage(db: Db, a: ConvAccess, input: any): MessageView {
  const me = a.ctx.me.userId;
  const body = cleanText(input?.body);
  if (body.length > LIMITS.body) fail(400, `Meddelandet får vara högst ${LIMITS.body} tecken.`);
  const fileIds: string[] = Array.isArray(input?.attachments) ? Array.from(new Set(input.attachments.filter((x: unknown) => typeof x === 'string'))) : [];
  if (fileIds.length > LIMITS.filesPerMessage) fail(400, `Högst ${LIMITS.filesPerMessage} filer per meddelande.`);
  if (!body && !fileIds.length) fail(400, 'Meddelandet är tomt.');
  const t = now();
  const recent = Number((db.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND kind = 'text' AND created_at > ?`).get(me, t - 60_000) as any)?.n || 0);
  if (recent >= LIMITS.messagesPerMinute) fail(429, 'Du skickar för många meddelanden. Vänta en stund.');
  const files: any[] = fileIds.map((id) => db.prepare('SELECT * FROM chat_files WHERE id = ? AND conversation_id = ? AND user_id = ? AND message_seq IS NULL').get(id, a.conv.id, me));
  if (files.some((f) => !f)) fail(400, 'En bifogad fil finns inte längre. Försök igen.');
  const attachments: Attachment[] = files.map((f) => ({ id: f.id, name: f.original_name, mime: f.mime, size: f.size }));

  const seq = db.transaction(() => {
    // I lagchatten får alla i laget en läsrad innan meddelandet, så att det räknas som oläst för dem.
    if (a.conv.kind === 'team') {
      const ins = db.prepare(`INSERT OR IGNORE INTO chat_participants (conversation_id, user_id, role, joined_at, last_read_seq) VALUES (?, ?, 'member', ?, ?)`);
      for (const p of clubPeople(db, a.ctx.clubId).values()) if (p.teams.includes(a.conv.team_id!)) ins.run(a.conv.id, p.userId, t, a.conv.last_message_seq);
    }
    const rev = nextRev(db);
    const s = Number(db.prepare(
      `INSERT INTO chat_messages (conversation_id, user_id, author_name, kind, body, attachments, created_at, rev) VALUES (?, ?, ?, 'text', ?, ?, ?, ?)`
    ).run(a.conv.id, me, a.ctx.me.name, body, attachments.length ? JSON.stringify(attachments) : null, t, rev).lastInsertRowid);
    for (const f of files) db.prepare('UPDATE chat_files SET message_seq = ? WHERE id = ?').run(s, f.id);
    db.prepare('UPDATE chat_conversations SET last_message_seq = ?, last_message_at = ? WHERE id = ?').run(s, t, a.conv.id);
    db.prepare('UPDATE chat_participants SET last_read_seq = ? WHERE conversation_id = ? AND user_id = ?').run(s, a.conv.id, me);
    return s;
  })();
  return messageViews(db, [getMsg(db, a.conv.id, seq)!], me)[0];
}

export function editMessage(db: Db, a: ConvAccess, seq: unknown, input: any): MessageView {
  const m = getMsg(db, a.conv.id, seq);
  if (!m || m.kind !== 'text') fail(404, 'Meddelandet finns inte.');
  if (m!.user_id !== a.ctx.me.userId) fail(403, 'Du kan bara ändra egna meddelanden.');
  if (m!.deleted_at) fail(400, 'Meddelandet är borttaget.');
  if (now() - m!.created_at > LIMITS.editMinutes * 60_000) fail(400, `Ett meddelande kan bara ändras de första ${LIMITS.editMinutes} minuterna.`);
  const body = cleanText(input?.body);
  if (body.length > LIMITS.body) fail(400, `Meddelandet får vara högst ${LIMITS.body} tecken.`);
  if (!body && !parseJson(m!.attachments).length) fail(400, 'Meddelandet är tomt. Ta bort det i stället.');
  if (body !== m!.body) {
    db.transaction(() => {
      db.prepare('UPDATE chat_messages SET body = ?, edited_at = ?, rev = ? WHERE seq = ?').run(body, now(), nextRev(db), m!.seq);
    })();
  }
  return messageViews(db, [getMsg(db, a.conv.id, m!.seq)!], a.ctx.me.userId)[0];
}

// Tar bort ett meddelande: texten töms, bifogade filer raderas och reaktionerna försvinner.
function deleteMessageRow(db: Db, m: MsgRow, byUserId: string, filesDir: string) {
  const files = db.prepare('SELECT stored_name FROM chat_files WHERE message_seq = ?').all(m.seq) as any[];
  db.transaction(() => {
    db.prepare('DELETE FROM chat_files WHERE message_seq = ?').run(m.seq);
    db.prepare('DELETE FROM chat_reactions WHERE message_seq = ?').run(m.seq);
    db.prepare(`UPDATE chat_messages SET body = '', attachments = NULL, deleted_at = ?, deleted_by = ?, rev = ? WHERE seq = ?`).run(now(), byUserId, nextRev(db), m.seq);
  })();
  for (const f of files) {
    try { fs.unlinkSync(path.join(filesDir, path.basename(f.stored_name))); } catch { /* redan borta */ }
  }
}

export function deleteMessage(db: Db, a: ConvAccess, seq: unknown, filesDir: string) {
  const m = getMsg(db, a.conv.id, seq);
  if (!m || m.kind !== 'text') fail(404, 'Meddelandet finns inte.');
  if (m!.deleted_at) return;
  const own = m!.user_id === a.ctx.me.userId;
  const teamCoach = a.conv.kind === 'team' && registry.isTeamCoach(a.ctx.access, a.conv.team_id!);
  if (!own && !teamCoach) fail(403, 'Du kan bara ta bort egna meddelanden.');
  deleteMessageRow(db, m!, a.ctx.me.userId, filesDir);
}

export function toggleReaction(db: Db, a: ConvAccess, seq: unknown, raw: unknown): MessageView {
  const m = getMsg(db, a.conv.id, seq);
  if (!m || m.kind !== 'text' || m.deleted_at) fail(404, 'Meddelandet finns inte.');
  const emoji = normalizeEmoji(raw);
  if (!emoji) fail(400, 'Ogiltig reaktion.');
  const me = a.ctx.me.userId;
  db.transaction(() => {
    const removed = db.prepare('DELETE FROM chat_reactions WHERE message_seq = ? AND user_id = ? AND emoji = ?').run(m!.seq, me, emoji);
    if (!Number(removed.changes)) {
      const mine = Number((db.prepare('SELECT COUNT(*) AS n FROM chat_reactions WHERE message_seq = ? AND user_id = ?').get(m!.seq, me) as any)?.n || 0);
      if (mine >= LIMITS.reactionsPerPerson) fail(400, `Du kan ha högst ${LIMITS.reactionsPerPerson} reaktioner på ett meddelande.`);
      db.prepare('INSERT INTO chat_reactions (message_seq, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(m!.seq, me, emoji, now());
    }
    db.prepare('UPDATE chat_messages SET rev = ? WHERE seq = ?').run(nextRev(db), m!.seq);
  })();
  return messageViews(db, [getMsg(db, a.conv.id, m!.seq)!], me)[0];
}

export function markRead(db: Db, a: ConvAccess, seq: unknown) {
  const n = Math.min(Math.max(0, Number(seq) || 0), a.conv.last_message_seq);
  db.prepare('UPDATE chat_participants SET last_read_seq = MAX(last_read_seq, ?) WHERE conversation_id = ? AND user_id = ?').run(n, a.conv.id, a.ctx.me.userId);
}

// ---------------------------------------------------------------------------
// Filer
// ---------------------------------------------------------------------------

export function fileType(originalName: string, mime: string): { ext: string; mime: string } | null {
  const ext = path.extname(originalName || '').toLowerCase();
  const known = FILE_TYPES[ext];
  if (!known) return null;
  // Bilder måste också ha en bildtyp (så att t.ex. en html-fil inte kan döpas om till .jpg och visas).
  if (isImageMime(known) && mime && !isImageMime(mime) && mime !== 'application/octet-stream') return null;
  return { ext, mime: known };
}

export function saveFile(db: Db, a: ConvAccess, file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined, filesDir: string): Attachment {
  if (!file?.buffer) fail(400, 'Ingen fil skickades med.');
  const type = fileType(file!.originalname, file!.mimetype);
  if (!type) fail(400, 'Den filtypen går inte att skicka. Bilder, PDF, Word, Excel, PowerPoint och textfiler går bra.');
  if (file!.size > LIMITS.fileSize) fail(413, 'Filen är för stor (högst 10 MB).');
  const used = Number((db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM chat_files WHERE club_id = ?').get(a.ctx.clubId) as any)?.n || 0);
  if (used + file!.size > LIMITS.clubFileQuota) fail(413, 'Föreningens utrymme för chattfiler är fullt. Ta bort gamla filer eller kontakta administratören.');

  // Filer som laddats upp men aldrig skickats städas bort efter ett dygn.
  const stale = db.prepare('SELECT id, stored_name FROM chat_files WHERE message_seq IS NULL AND created_at < ?').all(now() - 24 * 3600_000) as any[];
  for (const f of stale) {
    try { fs.unlinkSync(path.join(filesDir, path.basename(f.stored_name))); } catch { /* redan borta */ }
    db.prepare('DELETE FROM chat_files WHERE id = ?').run(f.id);
  }

  fs.mkdirSync(filesDir, { recursive: true });
  const id = newId();
  const stored = id + type!.ext;
  fs.writeFileSync(path.join(filesDir, stored), file!.buffer);
  const name = path.basename(file!.originalname || 'fil').replace(/[\u0000-\u001f]/g, '').slice(0, 150) || 'fil';
  db.prepare(
    `INSERT INTO chat_files (id, club_id, conversation_id, user_id, original_name, mime, size, stored_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, a.ctx.clubId, a.conv.id, a.ctx.me.userId, name, type!.mime, file!.size, stored, now());
  return { id, name, mime: type!.mime, size: file!.size };
}

// ---------------------------------------------------------------------------
// Anmälningar
// ---------------------------------------------------------------------------

// Får den inloggade hantera anmälningar om meddelanden från den här avsändaren?
// Föreningsadmin alltid; tränare om avsändaren är med i ett lag där hen är tränare.
function canModerateAuthor(ctx: Ctx, people: Map<string, Person>, authorId: string | null): boolean {
  if (ctx.access.isClubAdmin) return true;
  const teams = authorId ? people.get(authorId)?.teams || [] : [];
  return teams.some((t) => ['admin', 'coach'].some((r) => ctx.access.teamRoles.get(t)?.has(r)));
}

export function reportMessage(db: Db, a: ConvAccess, seq: unknown, reason: unknown) {
  const m = getMsg(db, a.conv.id, seq);
  if (!m || m.kind !== 'text' || m.deleted_at) fail(404, 'Meddelandet finns inte.');
  if (m!.user_id === a.ctx.me.userId) fail(400, 'Du kan inte anmäla ditt eget meddelande.');
  const text = cleanText(reason).slice(0, LIMITS.reason);
  const open = db.prepare('SELECT 1 FROM chat_reports WHERE message_seq = ? AND reported_by = ? AND handled_at IS NULL').get(m!.seq, a.ctx.me.userId);
  if (open) return;
  db.prepare(
    `INSERT INTO chat_reports (id, club_id, conversation_id, message_seq, reported_by, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(newId(), a.ctx.clubId, a.conv.id, m!.seq, a.ctx.me.userId, text || null, now());
}

export interface ReportView {
  id: string; conversationName: string; conversationKind: Kind; reason: string | null; reporterName: string; createdAt: number;
  message: MessageView; context: MessageView[]; otherReports: number;
}

// Öppna anmälningar den inloggade får hantera. Visar bara det anmälda meddelandet och de två
// närmaste före och efter – aldrig hela chatten.
export function listReports(db: Db, ctx: Ctx): ReportView[] {
  if (!registry.isClubCoach(ctx.access)) return [];
  const people = clubPeople(db, ctx.clubId);
  const teams = teamNames(db, ctx.clubId);
  const rows = db.prepare(`SELECT * FROM chat_reports WHERE club_id = ? AND handled_at IS NULL ORDER BY created_at`).all(ctx.clubId) as any[];
  const seen = new Map<number, ReportView>();
  for (const r of rows) {
    const m: MsgRow | undefined = db.prepare('SELECT * FROM chat_messages WHERE seq = ?').get(r.message_seq);
    if (!m || m.deleted_at || !canModerateAuthor(ctx, people, m.user_id)) continue;
    const existing = seen.get(m.seq);
    if (existing) { existing.otherReports++; continue; }
    const conv = getConv(db, r.conversation_id)!;
    const ctxRows: MsgRow[] = [
      ...(db.prepare(`SELECT * FROM chat_messages WHERE conversation_id = ? AND seq < ? AND kind = 'text' ORDER BY seq DESC LIMIT 2`).all(conv.id, m.seq) as MsgRow[]).reverse(),
      m,
      ...(db.prepare(`SELECT * FROM chat_messages WHERE conversation_id = ? AND seq > ? AND kind = 'text' ORDER BY seq LIMIT 2`).all(conv.id, m.seq) as MsgRow[]),
    ];
    const views = messageViews(db, ctxRows, ctx.me.userId).map((v) => ({ ...v, isMine: false }));
    seen.set(m.seq, {
      id: r.id,
      conversationName: displayName(conv, '', participants(db, conv, people), teams),
      conversationKind: conv.kind, reason: r.reason, reporterName: people.get(r.reported_by)?.name || 'Okänd', createdAt: r.created_at,
      message: views.find((v) => v.seq === m.seq)!, context: views, otherReports: 0,
    });
  }
  return Array.from(seen.values());
}

export function handleReport(db: Db, ctx: Ctx, reportId: unknown, action: unknown, filesDir: string) {
  const r: any = typeof reportId === 'string' ? db.prepare('SELECT * FROM chat_reports WHERE id = ? AND club_id = ?').get(reportId, ctx.clubId) : null;
  if (!r) fail(404, 'Anmälan finns inte.');
  const m: MsgRow | undefined = db.prepare('SELECT * FROM chat_messages WHERE seq = ?').get(r.message_seq);
  if (!canModerateAuthor(ctx, clubPeople(db, ctx.clubId), m?.user_id || null)) fail(404, 'Anmälan finns inte.');
  if (action !== 'remove' && action !== 'keep') fail(400, 'Välj ta bort eller behåll.');
  if (action === 'remove' && m && !m.deleted_at) deleteMessageRow(db, m, ctx.me.userId, filesDir);
  db.prepare(`UPDATE chat_reports SET handled_by = ?, handled_at = ?, action = ? WHERE message_seq = ? AND handled_at IS NULL`)
    .run(ctx.me.userId, now(), action === 'remove' ? 'removed' : 'kept', r.message_seq);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export function registerChatRoutes(app: express.Express, db: Db, deps: {
  requireAuthUser: express.RequestHandler;
  isRootAdmin: (user: any) => Promise<boolean>;
  filesDir: string;
}) {
  const { requireAuthUser, isRootAdmin, filesDir } = deps;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.fileSize, files: 1 } });

  // Kör en hanterare och gör ChatError till ett svar med rätt statuskod.
  const route = (fn: (req: express.Request, res: express.Response, user: any, isRoot: boolean) => any): express.RequestHandler =>
    async (req, res) => {
      try {
        const user = (req as any).user;
        const out = await fn(req, res, user, await isRootAdmin(user));
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e: any) {
        if (e instanceof ChatError) return res.status(e.status).json({ error: e.message });
        console.error('[Chatt]', e);
        if (!res.headersSent) res.status(500).json({ error: 'Något gick fel i chatten.' });
      }
    };
  const conv = (req: express.Request, user: any, isRoot: boolean) => convAccess(db, user, req.params.id, isRoot);

  app.get('/api/chat', requireAuthUser, route((req, _res, user, isRoot) => {
    const ctx = clubCtx(db, user, req.query.clubId, isRoot);
    return { conversations: listConversations(db, ctx), reactions: REACTIONS, me: ctx.me.userId, openReports: listReports(db, ctx).length };
  }));

  app.get('/api/chat/summary', requireAuthUser, route((req, _res, user, isRoot) => {
    const ctx = clubCtx(db, user, req.query.clubId, isRoot);
    return { ...summary(db, ctx), openReports: listReports(db, ctx).length };
  }));

  app.get('/api/chat/people', requireAuthUser, route((req, _res, user, isRoot) => {
    const ctx = clubCtx(db, user, req.query.clubId, isRoot);
    const people = Array.from(clubPeople(db, ctx.clubId).values()).filter((p) => p.userId !== ctx.me.userId);
    const teams = Array.from(teamNames(db, ctx.clubId), ([id, name]) => ({ id, name }));
    const myTeams = Array.from(ctx.access.teamRoles.keys()).filter((t) => t !== registry.CLUB_LEVEL);
    return { people, teams, myTeams };
  }));

  app.get('/api/chat/reports', requireAuthUser, route((req, _res, user, isRoot) => {
    const ctx = clubCtx(db, user, req.query.clubId, isRoot);
    return { reports: listReports(db, ctx) };
  }));

  app.post('/api/chat/reports/:reportId', requireAuthUser, route((req, _res, user, isRoot) => {
    const ctx = clubCtx(db, user, req.body?.clubId, isRoot);
    handleReport(db, ctx, req.params.reportId, req.body?.action, filesDir);
    return { success: true };
  }));

  app.get('/api/chat/files/:fileId', requireAuthUser, route((req, res, user, isRoot) => {
    const f: any = db.prepare('SELECT * FROM chat_files WHERE id = ?').get(String(req.params.fileId).slice(0, 64));
    if (!f || !f.message_seq && f.user_id !== String(user.id)) fail(404, 'Filen finns inte.');
    convAccess(db, user, f.conversation_id, isRoot);
    const full = path.join(filesDir, path.basename(f.stored_name));
    if (!fs.existsSync(full)) fail(404, 'Filen finns inte.');
    const inline = isImageMime(f.mime) && req.query.download !== '1';
    res.setHeader('Content-Type', f.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    res.sendFile(full);
  }));

  app.post('/api/chat', requireAuthUser, route((req, _res, user, isRoot) => {
    const ctx = clubCtx(db, user, req.body?.clubId, isRoot);
    const c = startConversation(db, ctx, req.body);
    return { conversation: conversationDetail(db, convAccess(db, user, c.id, isRoot)) };
  }));

  app.get('/api/chat/:id', requireAuthUser, route((req, _res, user, isRoot) => ({ conversation: conversationDetail(db, conv(req, user, isRoot)) })));

  app.patch('/api/chat/:id', requireAuthUser, route((req, _res, user, isRoot) => {
    renameGroup(db, conv(req, user, isRoot), req.body?.name);
    return { conversation: conversationDetail(db, conv(req, user, isRoot)) };
  }));

  app.post('/api/chat/:id/participants', requireAuthUser, route((req, _res, user, isRoot) => {
    addParticipants(db, conv(req, user, isRoot), req.body?.userIds);
    return { conversation: conversationDetail(db, conv(req, user, isRoot)) };
  }));

  app.delete('/api/chat/:id/participants/:userId', requireAuthUser, route((req, _res, user, isRoot) => {
    const a = conv(req, user, isRoot);
    removeParticipant(db, a, req.params.userId);
    return req.params.userId === a.ctx.me.userId ? { success: true } : { conversation: conversationDetail(db, conv(req, user, isRoot)) };
  }));

  app.post('/api/chat/:id/admins/:userId', requireAuthUser, route((req, _res, user, isRoot) => {
    makeAdmin(db, conv(req, user, isRoot), req.params.userId);
    return { conversation: conversationDetail(db, conv(req, user, isRoot)) };
  }));

  app.get('/api/chat/:id/messages', requireAuthUser, route((req, _res, user, isRoot) =>
    getMessages(db, conv(req, user, isRoot), { before: req.query.before, after: req.query.after })));

  app.post('/api/chat/:id/messages', requireAuthUser, route((req, _res, user, isRoot) =>
    ({ message: sendMessage(db, conv(req, user, isRoot), req.body) })));

  app.patch('/api/chat/:id/messages/:seq', requireAuthUser, route((req, _res, user, isRoot) =>
    ({ message: editMessage(db, conv(req, user, isRoot), req.params.seq, req.body) })));

  app.delete('/api/chat/:id/messages/:seq', requireAuthUser, route((req, _res, user, isRoot) => {
    deleteMessage(db, conv(req, user, isRoot), req.params.seq, filesDir);
    return { success: true };
  }));

  app.post('/api/chat/:id/messages/:seq/reactions', requireAuthUser, route((req, _res, user, isRoot) =>
    ({ message: toggleReaction(db, conv(req, user, isRoot), req.params.seq, req.body?.emoji) })));

  app.post('/api/chat/:id/messages/:seq/report', requireAuthUser, route((req, _res, user, isRoot) => {
    reportMessage(db, conv(req, user, isRoot), req.params.seq, req.body?.reason);
    return { success: true };
  }));

  app.post('/api/chat/:id/read', requireAuthUser, route((req, _res, user, isRoot) => {
    markRead(db, conv(req, user, isRoot), req.body?.seq);
    return { success: true };
  }));

  app.post('/api/chat/:id/files', requireAuthUser, (req, res, next) => {
    upload.single('file')(req, res, (err: any) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Filen är för stor (högst 10 MB).' });
      if (err) return res.status(400).json({ error: 'Filen kunde inte tas emot.' });
      next();
    });
  }, route((req, _res, user, isRoot) => ({ file: saveFile(db, conv(req, user, isRoot), (req as any).file, filesDir) })));
}
