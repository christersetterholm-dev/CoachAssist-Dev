// Notiser (Web Push) till appen när den är tillagd på hemskärmen (PWA) eller öppen i en webbläsare
// som klarar det. Ingen Firebase: servern skickar själv till webbläsarens push-tjänst (Apple,
// Google, Mozilla, Microsoft) med egna VAPID-nycklar.
//
// - Varje enhet som slår på notiser blir en rad i push_subscriptions (kopplad till kontot).
//   Per enhet väljer man om chatt och/eller inlägg ska ge notis.
// - Nycklarna skapas första gången och sparas i system_docs (eller sätts med VAPID_PUBLIC_KEY /
//   VAPID_PRIVATE_KEY). Byts nycklarna måste alla slå på notiserna igen.
// - Notiser skickas efter att svaret gått iväg och får aldrig få ett anrop att misslyckas.
// - Den som just nu har chatten öppen (appen frågat efter nya meddelanden de senaste sekunderna)
//   får ingen notis för den chatten.
import webpush from 'web-push';
import type express from 'express';
import type { Db } from './database.ts';

export type PushKind = 'chat' | 'posts';

export interface PushPayload {
  title: string;
  body: string;
  /** Notiser med samma tag ersätter varandra (t.ex. en per chatt). */
  tag: string;
  /** Vad appen ska öppna när man trycker på notisen. */
  open: { view: 'chat'; clubId: string; conversationId: string } | { view: 'post'; clubId: string; teamId: string; postId: string } | { view: 'home' };
}

interface SubRow {
  endpoint: string; user_id: string; p256dh: string; auth: string; chat: number; posts: number;
  created_at: number; last_used_at: number | null; fail_count: number;
}

const MAX_PER_USER = 10;
const MAX_FAILS = 20;
const ACTIVE_MS = 15_000;
const SEND_TIMEOUT_MS = 10_000;

// Push-tjänsterna i de vanliga webbläsarna. Andra adresser tas inte emot (servern ska inte kunna
// lockas att skicka anrop till godtyckliga adresser).
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
];

let state: { db: Db; publicKey: string; privateKey: string; subject: string; allowAnyEndpoint: boolean } | null = null;

// Vem som har en chatt öppen just nu: "userId conversationId" → senast appen frågade.
const active = new Map<string, number>();

export function initPush(db: Db, opts: { subject: string; allowAnyEndpoint?: boolean }) {
  let publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  let privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!publicKey || !privateKey) {
    try {
      const row: any = db.prepare("SELECT data FROM system_docs WHERE path = 'system/vapid_keys'").get();
      const stored = row?.data ? JSON.parse(row.data) : null;
      if (stored?.publicKey && stored?.privateKey) ({ publicKey, privateKey } = stored);
    } catch { /* skapas nedan */ }
  }
  if (!publicKey || !privateKey) {
    ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
    db.prepare("INSERT OR REPLACE INTO system_docs (path, data, updatedAt) VALUES ('system/vapid_keys', ?, ?)")
      .run(JSON.stringify({ publicKey, privateKey }), Date.now());
    console.log('[Notiser] Skapade nya VAPID-nycklar.');
  }
  state = { db, publicKey, privateKey, subject: opts.subject, allowAnyEndpoint: !!opts.allowAnyEndpoint };
}

const b64len = (s: unknown) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+=*$/.test(s) || s.length > 200) return -1;
  return Buffer.from(s, 'base64url').length;
};

function validEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 1000) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (state?.allowAnyEndpoint) return u.protocol === 'https:' || u.protocol === 'http:' ? raw : null;
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  return PUSH_HOSTS.some((re) => re.test(u.hostname)) ? raw : null;
}

const getSub = (db: Db, endpoint: string): SubRow | undefined => db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(endpoint);

export function saveSubscription(db: Db, userId: string, body: any, userAgent: string): { ok: true } | { ok: false; error: string } {
  const sub = body?.subscription;
  const endpoint = validEndpoint(sub?.endpoint);
  if (!endpoint) return { ok: false, error: 'Webbläsarens notisadress godkändes inte.' };
  if (b64len(sub?.keys?.p256dh) !== 65 || b64len(sub?.keys?.auth) !== 16) return { ok: false, error: 'Notisnycklarna är ogiltiga.' };
  const chat = body?.chat === false ? 0 : 1;
  const posts = body?.posts === false ? 0 : 1;
  const t = Date.now();
  db.transaction(() => {
    // Samma enhet kan ha bytt konto: då tillhör adressen det nya kontot.
    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, chat, posts, user_agent, created_at, fail_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         chat = excluded.chat, posts = excluded.posts, user_agent = excluded.user_agent, fail_count = 0`
    ).run(endpoint, userId, sub.keys.p256dh, sub.keys.auth, chat, posts, String(userAgent || '').slice(0, 300), t);
    const extra = db.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?').all(userId, MAX_PER_USER);
    for (const r of extra) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(r.endpoint);
  })();
  return { ok: true };
}

export function subscriptionStatus(db: Db, userId: string, endpoint: unknown) {
  const row = typeof endpoint === 'string' ? getSub(db, endpoint) : undefined;
  if (!row || row.user_id !== userId) return { subscribed: false, chat: true, posts: true };
  return { subscribed: true, chat: !!row.chat, posts: !!row.posts };
}

export function removeSubscription(db: Db, userId: string, endpoint: unknown) {
  if (typeof endpoint !== 'string') return;
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId);
}

/** Appen har chatten öppen (frågar efter nya meddelanden). */
export function markActive(userId: string, conversationId: string) {
  const t = Date.now();
  active.set(`${userId} ${conversationId}`, t);
  if (active.size > 5000) for (const [k, v] of active) if (t - v > ACTIVE_MS) active.delete(k);
}
const isActive = (userId: string, conversationId: string) => Date.now() - (active.get(`${userId} ${conversationId}`) || 0) < ACTIVE_MS;

async function sendOne(row: SubRow, payload: PushPayload): Promise<'ok' | 'gone' | 'failed'> {
  if (!state) return 'failed';
  const { db } = state;
  try {
    const details = webpush.generateRequestDetails(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: { subject: state.subject, publicKey: state.publicKey, privateKey: state.privateKey },
        TTL: 24 * 60 * 60,
        urgency: 'high',
        // Topic: väntande notiser med samma ämne ersätts hos push-tjänsten (högst 32 tecken a-z0-9-_).
        topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
      },
    );
    const res = await fetch(details.endpoint, {
      method: details.method,
      headers: details.headers as Record<string, string>,
      body: details.body as any,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 410) {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint);
      return 'gone';
    }
    if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    db.prepare('UPDATE push_subscriptions SET last_used_at = ?, fail_count = 0 WHERE endpoint = ?').run(Date.now(), row.endpoint);
    return 'ok';
  } catch (e: any) {
    console.warn('[Notiser] Kunde inte skicka:', new URL(row.endpoint).hostname, e?.message || e);
    const fails = row.fail_count + 1;
    if (fails >= MAX_FAILS) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint);
    else db.prepare('UPDATE push_subscriptions SET fail_count = ? WHERE endpoint = ?').run(fails, row.endpoint);
    return 'failed';
  }
}

/**
 * Skickar en notis till de här kontona (alla deras enheter som valt den sortens notiser).
 * Returnerar direkt; skickandet sker i bakgrunden.
 */
export function notifyUsers(userIds: Iterable<string>, kind: PushKind, payload: PushPayload, opts: { conversationId?: string } = {}) {
  if (!state) return;
  const ids = Array.from(new Set(userIds)).filter((id) => id && !(opts.conversationId && isActive(id, opts.conversationId)));
  if (!ids.length) return;
  const rows: SubRow[] = [];
  const col = kind === 'chat' ? 'chat' : 'posts';
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    rows.push(...state.db.prepare(`SELECT * FROM push_subscriptions WHERE ${col} = 1 AND user_id IN (${part.map(() => '?').join(',')})`).all(...part));
  }
  if (!rows.length) return;
  const clean: PushPayload = { ...payload, title: payload.title.slice(0, 80), body: payload.body.slice(0, 200) };
  setImmediate(() => { Promise.allSettled(rows.map((r) => sendOne(r, clean))).catch(() => {}); });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export function registerPushRoutes(app: express.Express, db: Db, deps: { requireAuthUser: express.RequestHandler }) {
  const { requireAuthUser } = deps;
  const uid = (req: express.Request) => String((req as any).user.id);

  app.get('/api/push/key', requireAuthUser, (_req, res) => {
    res.json({ publicKey: state?.publicKey || null });
  });

  app.post('/api/push/subscribe', requireAuthUser, (req, res) => {
    const r = saveSubscription(db, uid(req), req.body, String(req.headers['user-agent'] || ''));
    if ('error' in r) return res.status(400).json({ error: r.error });
    res.json(subscriptionStatus(db, uid(req), req.body?.subscription?.endpoint));
  });

  app.post('/api/push/status', requireAuthUser, (req, res) => {
    res.json(subscriptionStatus(db, uid(req), req.body?.endpoint));
  });

  app.post('/api/push/unsubscribe', requireAuthUser, (req, res) => {
    removeSubscription(db, uid(req), req.body?.endpoint);
    res.json({ success: true });
  });

  app.post('/api/push/test', requireAuthUser, async (req, res) => {
    const row = typeof req.body?.endpoint === 'string' ? getSub(db, req.body.endpoint) : undefined;
    if (!row || row.user_id !== uid(req)) return res.status(404).json({ error: 'Notiser är inte påslagna på den här enheten.' });
    const r = await sendOne(row, { title: 'Notiserna fungerar', body: 'Så här ser det ut när något nytt händer i chatten eller inläggen.', tag: 'test', open: { view: 'home' } });
    if (r !== 'ok') return res.status(502).json({ error: r === 'gone' ? 'Enhetens notiser har slutat gälla. Slå på dem igen.' : 'Notisen kunde inte skickas just nu. Försök igen senare.' });
    res.json({ success: true });
  });
}
