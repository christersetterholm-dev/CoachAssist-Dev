// Inlägg: tränarnas meddelanden till laget (t.ex. info inför match eller träning).
//
// Tränare och föreningsadmin skriver, ändrar, fäster och tar bort inlägg. Alla i laget läser,
// reagerar och kommenterar. Servern håller reda på vem som har läst ett inlägg; tränare ser
// vilka spelare som läst och inte läst. Ett inlägg kan kopplas till en aktivitet i kalendern
// (session_id), ha en bild (uppladdad via /api/upload) och en lista med länkar.
import crypto from 'crypto';
import type { Db } from './database.ts';

// Snabbvalen som alltid visas. Med plusknappen kan man välja vilken emoji som helst.
export const REACTIONS = ['👍', '❤️', '💪', '⚽', '🔥', '😂'];
const MAX_REACTIONS_PER_PERSON = 20;

// Samma emoji kan skrivas med eller utan det osynliga tecknet U+FE0F ("visa som emoji").
// Vi tar bort det där det inte behövs (efter tecken som ändå visas som emoji), så att t.ex.
// 👍 och 👍️ räknas som samma reaktion. Efter t.ex. ❤ behövs det och får vara kvar.
export function normalizeEmoji(input: unknown): string | null {
  if (typeof input !== 'string' || !input || input.length > 32) return null;
  const chars = Array.from(input);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '\uFE0F' && i > 0 && /\p{Emoji_Presentation}/u.test(chars[i - 1])) continue;
    out.push(chars[i]);
  }
  // Ett ensamt tecken som annars visas som text (t.ex. ❤) får tecknet, så att ❤ och ❤️ blir samma.
  if (out.length === 1 && !/\p{Emoji_Presentation}/u.test(out[0])) out.push('\uFE0F');
  const s = out.join('');
  if (!/^[\p{Extended_Pictographic}\p{Emoji_Component}\u200D\uFE0F\u20E3]+$/u.test(s)) return null;
  if (!/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u.test(s)) return null; // minst en riktig emoji (eller siffra i ruta)
  return s;
}
const MAX_TITLE = 150;
const MAX_BODY = 10_000;
const MAX_COMMENT = 2_000;
const MAX_LINKS = 10;
const LIST_LIMIT = 200;

export interface PostLink { url: string; label: string }

interface PostRow {
  id: string; club_id: string; team_id: string; author_user_id: string | null; author_name: string | null;
  title: string; body: string; pinned: number; session_id: string | null; image_url: string | null;
  links: string | null; created_at: number; updated_at: number;
}

export interface PostView {
  id: string;
  clubId: string;
  teamId: string;
  title: string;
  body: string;
  pinned: boolean;
  sessionId: string | null;
  imageUrl: string | null;
  links: PostLink[];
  authorName: string;
  authorUserId: string | null;
  createdAt: number;
  updatedAt: number;
  reactions: Record<string, number>;
  myReactions: string[];
  commentCount: number;
  isRead: boolean;
  // Bara för tränare: hur många av lagets spelare som har läst.
  readCount?: number;
  readerTotal?: number;
}

export interface CommentView { id: string; userId: string; authorName: string; body: string; createdAt: number; isMine: boolean }

export interface ReadersView {
  read: { memberId: string; name: string; readAt: number }[];
  unread: { memberId: string; name: string; hasAccount: boolean }[];
}

const newId = () => crypto.randomBytes(9).toString('base64url');
const parseLinks = (raw: string | null): PostLink[] => {
  try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; }
};

export function getPostRow(db: Db, id: string): PostRow | undefined {
  if (typeof id !== 'string' || id.length > 64) return undefined;
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
}

// Lagets spelare (de som "läst av" räknas mot). Tränare och ledare räknas inte.
function teamPlayers(db: Db, clubId: string, teamId: string): { id: string; full_name: string; user_id: string | null }[] {
  return db.prepare(
    `SELECT DISTINCT m.id, m.full_name, m.user_id FROM members m JOIN team_roles r ON r.member_id = m.id
     WHERE r.club_id = ? AND r.team_id = ? AND r.role = 'player' ORDER BY m.full_name COLLATE NOCASE`
  ).all(clubId, teamId);
}

// ---------------------------------------------------------------------------
// Validering av det tränaren skickar in
// ---------------------------------------------------------------------------

type Clean = { title: string; body: string; pinned: boolean; sessionId: string | null; imageUrl: string | null; links: PostLink[] };

export function cleanInput(input: any): { ok: true; value: Clean } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Inlägget saknas.' };
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) return { ok: false, error: 'Inlägget måste ha en rubrik.' };
  if (title.length > MAX_TITLE) return { ok: false, error: `Rubriken får vara högst ${MAX_TITLE} tecken.` };
  const body = typeof input.body === 'string' ? input.body.replace(/\r\n/g, '\n').trim() : '';
  if (body.length > MAX_BODY) return { ok: false, error: 'Texten är för lång.' };

  const sessionId = typeof input.sessionId === 'string' && input.sessionId.trim() ? input.sessionId.trim().slice(0, 100) : null;

  // Bara bilder som laddats upp till appen, så att inlägg inte kan hämta bilder från okända sidor.
  let imageUrl: string | null = null;
  if (typeof input.imageUrl === 'string' && input.imageUrl.trim()) {
    imageUrl = input.imageUrl.trim();
    if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(imageUrl)) return { ok: false, error: 'Ogiltig bild.' };
  }

  const links: PostLink[] = [];
  if (Array.isArray(input.links)) {
    for (const l of input.links) {
      const raw = typeof l?.url === 'string' ? l.url.trim() : '';
      if (!raw) continue;
      let url: URL;
      try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`); } catch { return { ok: false, error: `Länken "${raw}" är inte giltig.` }; }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: `Länken "${raw}" måste börja med http:// eller https://.` };
      const label = typeof l?.label === 'string' ? l.label.trim().slice(0, 100) : '';
      links.push({ url: url.toString().slice(0, 2000), label });
    }
  }
  if (links.length > MAX_LINKS) return { ok: false, error: `Högst ${MAX_LINKS} länkar per inlägg.` };

  return { ok: true, value: { title, body, pinned: input.pinned === true, sessionId, imageUrl, links } };
}

// ---------------------------------------------------------------------------
// Läsa
// ---------------------------------------------------------------------------

function toView(db: Db, row: PostRow, userId: string, isCoach: boolean, players?: { id: string }[]): PostView {
  const reactions: Record<string, number> = {};
  for (const r of db.prepare('SELECT emoji, COUNT(*) AS n FROM post_reactions WHERE post_id = ? GROUP BY emoji').all(row.id)) {
    reactions[r.emoji] = Number(r.n);
  }
  const myReactions = db.prepare('SELECT emoji FROM post_reactions WHERE post_id = ? AND user_id = ?').all(row.id, userId).map((r: any) => r.emoji);
  const commentCount = Number((db.prepare('SELECT COUNT(*) AS n FROM post_comments WHERE post_id = ?').get(row.id) as any)?.n || 0);
  const isRead = !!db.prepare('SELECT 1 FROM post_reads WHERE post_id = ? AND user_id = ?').get(row.id, userId) || row.author_user_id === userId;
  const view: PostView = {
    id: row.id, clubId: row.club_id, teamId: row.team_id, title: row.title, body: row.body,
    pinned: !!row.pinned, sessionId: row.session_id, imageUrl: row.image_url, links: parseLinks(row.links),
    authorName: row.author_name || 'Tränare', authorUserId: row.author_user_id,
    createdAt: row.created_at, updatedAt: row.updated_at, reactions, myReactions, commentCount, isRead,
  };
  if (isCoach) {
    const list = players || teamPlayers(db, row.club_id, row.team_id);
    const readIds = new Set(db.prepare('SELECT member_id FROM post_reads WHERE post_id = ?').all(row.id).map((r: any) => r.member_id));
    view.readCount = list.filter((p) => readIds.has(p.id)).length;
    view.readerTotal = list.length;
  }
  return view;
}

export function listPosts(db: Db, clubId: string, teamId: string, userId: string, isCoach: boolean): PostView[] {
  const rows: PostRow[] = db.prepare(
    `SELECT * FROM posts WHERE club_id = ? AND team_id = ? ORDER BY pinned DESC, created_at DESC LIMIT ${LIST_LIMIT}`
  ).all(clubId, teamId);
  const players = isCoach ? teamPlayers(db, clubId, teamId) : undefined;
  return rows.map((r) => toView(db, r, userId, isCoach, players));
}

export function getPost(db: Db, row: PostRow, userId: string, isCoach: boolean): { post: PostView; comments: CommentView[]; readers?: ReadersView } {
  const comments: CommentView[] = db.prepare('SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC').all(row.id)
    .map((c: any) => ({ id: c.id, userId: c.user_id, authorName: c.author_name || 'Okänd', body: c.body, createdAt: c.created_at, isMine: c.user_id === userId }));
  const out: { post: PostView; comments: CommentView[]; readers?: ReadersView } = { post: toView(db, row, userId, isCoach), comments };
  if (isCoach) {
    const reads = new Map<string, number>();
    for (const r of db.prepare('SELECT member_id, read_at FROM post_reads WHERE post_id = ?').all(row.id)) {
      if (r.member_id) reads.set(r.member_id, r.read_at);
    }
    const readers: ReadersView = { read: [], unread: [] };
    for (const p of teamPlayers(db, row.club_id, row.team_id)) {
      if (reads.has(p.id)) readers.read.push({ memberId: p.id, name: p.full_name, readAt: reads.get(p.id)! });
      else readers.unread.push({ memberId: p.id, name: p.full_name, hasAccount: !!p.user_id });
    }
    readers.read.sort((a, b) => a.readAt - b.readAt);
    out.readers = readers;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Skriva
// ---------------------------------------------------------------------------

export function createPost(db: Db, clubId: string, teamId: string, v: Clean, author: { userId: string; name: string }): PostRow {
  const now = Date.now();
  const id = newId();
  db.prepare(
    `INSERT INTO posts (id, club_id, team_id, author_user_id, author_name, title, body, pinned, session_id, image_url, links, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, clubId, teamId, author.userId, author.name, v.title, v.body, v.pinned ? 1 : 0, v.sessionId, v.imageUrl, JSON.stringify(v.links), now, now);
  return getPostRow(db, id)!;
}

export function updatePost(db: Db, id: string, v: Clean): PostRow {
  db.prepare(
    `UPDATE posts SET title = ?, body = ?, pinned = ?, session_id = ?, image_url = ?, links = ?, updated_at = ? WHERE id = ?`
  ).run(v.title, v.body, v.pinned ? 1 : 0, v.sessionId, v.imageUrl, JSON.stringify(v.links), Date.now(), id);
  return getPostRow(db, id)!;
}

export function deletePost(db: Db, id: string) {
  db.transaction(() => {
    for (const t of ['post_reads', 'post_reactions', 'post_comments']) db.prepare(`DELETE FROM ${t} WHERE post_id = ?`).run(id);
    db.prepare('DELETE FROM posts WHERE id = ?').run(id);
  })();
}

export function markRead(db: Db, postId: string, userId: string, memberId: string | null) {
  db.prepare(
    `INSERT INTO post_reads (post_id, user_id, member_id, read_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(post_id, user_id) DO UPDATE SET member_id = COALESCE(post_reads.member_id, excluded.member_id)`
  ).run(postId, userId, memberId, Date.now());
}

// Slår av/på en reaktion. Returnerar om den nu är på, eller ett fel.
export function toggleReaction(db: Db, postId: string, userId: string, raw: unknown): { on: boolean } | { error: string } {
  const emoji = normalizeEmoji(raw);
  if (!emoji) return { error: 'Ogiltig reaktion.' };
  const removed = db.prepare('DELETE FROM post_reactions WHERE post_id = ? AND user_id = ? AND emoji = ?').run(postId, userId, emoji);
  if (Number(removed.changes) > 0) return { on: false };
  const mine = Number((db.prepare('SELECT COUNT(*) AS n FROM post_reactions WHERE post_id = ? AND user_id = ?').get(postId, userId) as any)?.n || 0);
  if (mine >= MAX_REACTIONS_PER_PERSON) return { error: `Du kan ha högst ${MAX_REACTIONS_PER_PERSON} reaktioner på ett inlägg.` };
  db.prepare('INSERT INTO post_reactions (post_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(postId, userId, emoji, Date.now());
  return { on: true };
}

export function addComment(db: Db, postId: string, userId: string, authorName: string, body: unknown): { ok: true; comment: CommentView } | { ok: false; error: string } {
  const text = typeof body === 'string' ? body.replace(/\r\n/g, '\n').trim() : '';
  if (!text) return { ok: false, error: 'Kommentaren är tom.' };
  if (text.length > MAX_COMMENT) return { ok: false, error: `Kommentaren får vara högst ${MAX_COMMENT} tecken.` };
  const id = newId();
  const createdAt = Date.now();
  db.prepare('INSERT INTO post_comments (id, post_id, user_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, postId, userId, authorName, text, createdAt);
  return { ok: true, comment: { id, userId, authorName, body: text, createdAt, isMine: true } };
}

export function getComment(db: Db, postId: string, commentId: string): { user_id: string } | undefined {
  return db.prepare('SELECT user_id FROM post_comments WHERE id = ? AND post_id = ?').get(commentId, postId);
}

export function deleteComment(db: Db, commentId: string) {
  db.prepare('DELETE FROM post_comments WHERE id = ?').run(commentId);
}
