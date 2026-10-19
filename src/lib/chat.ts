// Chatt: pratar med /api/chat (se server/chat.ts).
//
// Det finns inga notiser, så appen frågar servern med jämna mellanrum:
// - en öppen chatt var 3:e sekund (var 10:e när inget hänt på två minuter),
// - olästa-märket var 30:e sekund,
// - ingenting när appen ligger i bakgrunden; då hämtas direkt när den syns igen.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiUrl, getAuthHeader } from './firebase';
import { isHeicFile, optimizeImageForUpload } from '../utils/imageOptimizer';

export type ChatKind = 'team' | 'group' | 'direct';

export interface ChatAttachment { id: string; name: string; mime: string; size: number }

export interface ChatMessage {
  seq: number;
  rev: number;
  userId: string | null;
  authorName: string;
  kind: 'text' | 'event';
  body: string;
  attachments: ChatAttachment[];
  createdAt: number;
  editedAt: number | null;
  deleted: boolean;
  reactions: Record<string, number>;
  myReactions: string[];
  isMine: boolean;
  /** Bara i appen: meddelandet håller på att skickas eller kunde inte skickas. */
  pending?: 'sending' | 'failed';
  localId?: string;
}

export interface ChatSummaryItem {
  id: string;
  kind: ChatKind;
  teamId: string | null;
  name: string;
  photoUrl: string | null;
  lastMessage: { seq: number; authorName: string; isMine: boolean; text: string; createdAt: number; kind: string } | null;
  lastMessageAt: number;
  unread: number;
  memberCount: number;
}

export interface ChatParticipant { userId: string; name: string; photoUrl: string | null; role: string; lastReadSeq: number }

export interface ChatDetail {
  id: string;
  kind: ChatKind;
  teamId: string | null;
  name: string;
  customName: string | null;
  participants: ChatParticipant[];
  isAdmin: boolean;
  canModerate: boolean;
  canTakeOver: boolean;
  createdAt: number;
}

export interface ChatPerson { userId: string; name: string; photoUrl: string | null; teams: string[] }

export interface ChatReport {
  id: string;
  conversationName: string;
  conversationKind: ChatKind;
  reason: string | null;
  reporterName: string;
  createdAt: number;
  message: ChatMessage;
  context: ChatMessage[];
  otherReports: number;
}

export const CHAT_LIMITS = { body: 4000, name: 60, filesPerMessage: 5, fileSize: 10 * 1024 * 1024, editMinutes: 15 };
// Filtyper man kan välja (samma lista som servern; HEIC görs om till JPEG innan uppladdning).
export const CHAT_FILE_ACCEPT = 'image/*,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv';

const OFFLINE = 'Kunde inte nå servern. Kontrollera anslutningen och försök igen.';
const safeFetch = (url: string, init: RequestInit) => fetch(url, init).catch(() => { throw new Error(OFFLINE); });

const call = async (method: string, path: string, body?: any) => {
  const res = await safeFetch(getApiUrl(path), {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...getAuthHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `Något gick fel (${res.status})`);
  if (!json) throw new Error('Servern svarar inte på chatten. Starta om servern (npm run dev) och ladda om sidan.');
  return json;
};

const enc = encodeURIComponent;

export const listChats = (clubId: string): Promise<{ conversations: ChatSummaryItem[]; reactions: string[]; me: string; openReports: number }> =>
  call('GET', `/api/chat?clubId=${enc(clubId)}`);
export const getChatSummary = (clubId: string): Promise<{ unreadChats: number; unreadMessages: number; unread: Record<string, number>; openReports: number }> =>
  call('GET', `/api/chat/summary?clubId=${enc(clubId)}`);
export const listChatPeople = (clubId: string): Promise<{ people: ChatPerson[]; teams: { id: string; name: string }[]; myTeams: string[] }> =>
  call('GET', `/api/chat/people?clubId=${enc(clubId)}`);
export const startChat = (clubId: string, userIds: string[], name?: string): Promise<{ conversation: ChatDetail }> =>
  call('POST', '/api/chat', { clubId, userIds, name });
export const getChat = (id: string): Promise<{ conversation: ChatDetail }> => call('GET', `/api/chat/${enc(id)}`);
export const renameChat = (id: string, name: string): Promise<{ conversation: ChatDetail }> => call('PATCH', `/api/chat/${enc(id)}`, { name });
export const addChatParticipants = (id: string, userIds: string[]): Promise<{ conversation: ChatDetail }> =>
  call('POST', `/api/chat/${enc(id)}/participants`, { userIds });
export const removeChatParticipant = (id: string, userId: string): Promise<{ conversation?: ChatDetail }> =>
  call('DELETE', `/api/chat/${enc(id)}/participants/${enc(userId)}`);
export const makeChatAdmin = (id: string, userId: string): Promise<{ conversation: ChatDetail }> =>
  call('POST', `/api/chat/${enc(id)}/admins/${enc(userId)}`);
export const getChatMessages = (id: string, q: { before?: number; after?: number }): Promise<{ messages: ChatMessage[]; cursor: number; reads: { userId: string; lastReadSeq: number }[]; hasMore: boolean }> =>
  call('GET', `/api/chat/${enc(id)}/messages?${q.after !== undefined ? `after=${q.after}` : q.before ? `before=${q.before}` : ''}`);
export const sendChatMessage = (id: string, body: string, attachments: string[]): Promise<{ message: ChatMessage }> =>
  call('POST', `/api/chat/${enc(id)}/messages`, { body, attachments });
export const editChatMessage = (id: string, seq: number, body: string): Promise<{ message: ChatMessage }> =>
  call('PATCH', `/api/chat/${enc(id)}/messages/${seq}`, { body });
export const deleteChatMessage = (id: string, seq: number) => call('DELETE', `/api/chat/${enc(id)}/messages/${seq}`);
export const toggleChatReaction = (id: string, seq: number, emoji: string): Promise<{ message: ChatMessage }> =>
  call('POST', `/api/chat/${enc(id)}/messages/${seq}/reactions`, { emoji });
export const reportChatMessage = (id: string, seq: number, reason: string) =>
  call('POST', `/api/chat/${enc(id)}/messages/${seq}/report`, { reason });
export const markChatRead = (id: string, seq: number) => call('POST', `/api/chat/${enc(id)}/read`, { seq });
export const listChatReports = (clubId: string): Promise<{ reports: ChatReport[] }> => call('GET', `/api/chat/reports?clubId=${enc(clubId)}`);
export const handleChatReport = (clubId: string, reportId: string, action: 'remove' | 'keep') =>
  call('POST', `/api/chat/reports/${enc(reportId)}`, { clubId, action });

// --- Filer ---

export const isImageAttachment = (a: { mime: string }) => a.mime.startsWith('image/');

export const formatFileSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} kB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

// Bilder krymps och HEIC (iPhone) görs om till JPEG i webbläsaren innan uppladdning.
export async function uploadChatFile(chatId: string, file: File): Promise<ChatAttachment> {
  let toSend: File = file;
  if (file.type.startsWith('image/') || isHeicFile(file)) toSend = await optimizeImageForUpload(file);
  if (toSend.size > CHAT_LIMITS.fileSize) throw new Error(`"${file.name}" är för stor (högst 10 MB).`);
  const form = new FormData();
  form.append('file', toSend, toSend.name);
  const res = await safeFetch(getApiUrl(`/api/chat/${enc(chatId)}/files`), { method: 'POST', headers: getAuthHeader(), body: form });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.file) throw new Error(json?.error || `"${file.name}" kunde inte laddas upp.`);
  return json.file;
}

// Chattens filer kräver inloggning, så de hämtas med fetch och visas via en lokal adress.
const blobCache = new Map<string, Promise<string>>();
export function fetchChatFileUrl(fileId: string): Promise<string> {
  let p = blobCache.get(fileId);
  if (!p) {
    p = safeFetch(getApiUrl(`/api/chat/files/${enc(fileId)}`), { headers: getAuthHeader() }).then(async (res) => {
      if (!res.ok) throw new Error('Filen kunde inte hämtas.');
      return URL.createObjectURL(await res.blob());
    });
    p.catch(() => blobCache.delete(fileId));
    blobCache.set(fileId, p);
  }
  return p;
}

export function useChatFileUrl(fileId: string | null): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    if (!fileId) return;
    let alive = true;
    setState({ url: null, failed: false });
    fetchChatFileUrl(fileId).then((url) => alive && setState({ url, failed: false })).catch(() => alive && setState({ url: null, failed: true }));
    return () => { alive = false; };
  }, [fileId]);
  return state;
}

export async function downloadChatFile(a: ChatAttachment) {
  const url = await fetchChatFileUrl(a.id);
  const link = document.createElement('a');
  link.href = url;
  link.download = a.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// --- Tider ---

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function formatChatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

// Kort tid i chattlistan: klockslag i dag, "I går", veckodag senaste veckan, annars datum.
export function formatListTime(ts: number, now = new Date()): string {
  const d = new Date(ts);
  if (sameDay(d, now)) return formatChatTime(ts);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return 'I går';
  if (now.getTime() - ts < 6 * 86400_000) return d.toLocaleDateString('sv-SE', { weekday: 'short' });
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

// Dagavdelare i en chatt: "Idag", "I går", "Mån 13 okt".
export function formatDayLabel(ts: number, now = new Date()): string {
  const d = new Date(ts);
  if (sameDay(d, now)) return 'Idag';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return 'I går';
  const s = d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- Synlighet ---

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

// Kör fn direkt och sedan med intervallet så länge appen syns.
function usePolling(fn: () => void, ms: number | null) {
  const visible = useDocumentVisible();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!visible || ms === null) return;
    fnRef.current();
    const t = window.setInterval(() => fnRef.current(), ms);
    return () => window.clearInterval(t);
  }, [visible, ms]);
}

// --- Olästa-märket ---

export function useChatSummary(clubId: string | null | undefined, enabled: boolean) {
  const [unreadChats, setUnreadChats] = useState(0);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [openReports, setOpenReports] = useState(0);
  const active = enabled && !!clubId;

  const refresh = useCallback(async () => {
    if (!active) { setUnreadChats(0); setUnread({}); setOpenReports(0); return; }
    try {
      const r = await getChatSummary(clubId!);
      setUnreadChats(r.unreadChats);
      setUnread(r.unread);
      setOpenReports(r.openReports || 0);
    } catch { /* märket väntar till nästa gång */ }
  }, [active, clubId]);

  useEffect(() => { if (!active) { setUnreadChats(0); setUnread({}); setOpenReports(0); } }, [active]);
  usePolling(refresh, active ? 30_000 : null);

  return { unreadChats, unread, openReports, refresh };
}

export type ChatSummaryState = ReturnType<typeof useChatSummary>;

// --- Chattlistan ---

export function useChatList(clubId: string | null | undefined, enabled: boolean) {
  const [conversations, setConversations] = useState<ChatSummaryItem[]>([]);
  const [reactions, setReactions] = useState<string[]>(['👍', '❤️', '💪', '⚽', '🔥', '😂']);
  const [openReports, setOpenReports] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = enabled && !!clubId;

  const reload = useCallback(async () => {
    if (!active) return;
    try {
      const r = await listChats(clubId!);
      setConversations(r.conversations);
      if (r.reactions?.length) setReactions(r.reactions);
      setOpenReports(r.openReports || 0);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Kunde inte hämta chattarna.');
    } finally {
      setLoading(false);
    }
  }, [active, clubId]);

  usePolling(reload, active ? 15_000 : null);
  return { conversations, reactions, openReports, loading, error, reload, setConversations };
}

// --- En öppen chatt ---

const FAST_MS = 3_000;
const SLOW_MS = 10_000;
const IDLE_AFTER_MS = 2 * 60_000;

const sortMessages = (list: ChatMessage[]) =>
  list.sort((a, b) => (a.pending && !b.pending ? 1 : !a.pending && b.pending ? -1 : a.seq - b.seq));

export function useChatThread(chatId: string | null, onRead?: () => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [reads, setReads] = useState<{ userId: string; lastReadSeq: number }[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [interval, setIntervalMs] = useState(FAST_MS);
  const cursor = useRef(0);
  const lastActivity = useRef(Date.now());
  const lastReadSent = useRef(0);
  const busy = useRef(false);
  const idRef = useRef(chatId);
  idRef.current = chatId;
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const bump = useCallback(() => { lastActivity.current = Date.now(); setIntervalMs(FAST_MS); }, []);

  // Lägger in nya/ändrade meddelanden (samma seq ersätts).
  const merge = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const map = new Map(prev.filter((m) => !m.pending).map((m) => [m.seq, m]));
      for (const m of incoming) map.set(m.seq, m);
      return sortMessages([...map.values(), ...prev.filter((m) => m.pending)]);
    });
  }, []);

  const markReadUpTo = useCallback((list: ChatMessage[]) => {
    const id = idRef.current;
    if (!id || document.visibilityState !== 'visible') return;
    const max = list.reduce((n, m) => (m.pending ? n : Math.max(n, m.seq)), 0);
    if (max > lastReadSent.current) {
      lastReadSent.current = max;
      markChatRead(id, max).then(() => onReadRef.current?.()).catch(() => { lastReadSent.current = 0; });
    }
  }, []);

  const loadDetail = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    try {
      const r = await getChat(id);
      if (idRef.current === id) setDetail(r.conversation);
    } catch (e: any) {
      if (idRef.current === id && /finns inte/.test(e?.message || '')) setGone(true);
    }
  }, []);

  // Första laddningen.
  useEffect(() => {
    setMessages([]); setDetail(null); setReads([]); setHasMore(false); setError(null); setGone(false);
    cursor.current = 0; lastReadSent.current = 0;
    if (!chatId) return;
    let alive = true;
    setLoading(true);
    bump();
    Promise.all([getChatMessages(chatId, {}), getChat(chatId)])
      .then(([m, d]) => {
        if (!alive) return;
        cursor.current = m.cursor;
        setMessages(sortMessages(m.messages));
        setReads(m.reads);
        setHasMore(m.hasMore);
        setDetail(d.conversation);
        markReadUpTo(m.messages);
      })
      .catch((e) => {
        if (!alive) return;
        if (/finns inte/.test(e?.message || '')) setGone(true);
        else setError(e?.message || 'Kunde inte hämta chatten.');
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [chatId, bump, markReadUpTo]);

  const poll = useCallback(async () => {
    const id = idRef.current;
    if (!id || busy.current || loading) return;
    if (Date.now() - lastActivity.current > IDLE_AFTER_MS) setIntervalMs(SLOW_MS);
    busy.current = true;
    try {
      const r = await getChatMessages(id, { after: cursor.current });
      if (idRef.current !== id) return;
      cursor.current = Math.max(cursor.current, r.cursor);
      setReads(r.reads);
      setError(null);
      if (r.messages.length) {
        merge(r.messages);
        if (r.messages.some((m) => !m.isMine)) bump();
        if (r.messages.some((m) => m.kind === 'event')) loadDetail();
        markReadUpTo(r.messages);
      }
    } catch (e: any) {
      if (/finns inte/.test(e?.message || '')) setGone(true);
    } finally {
      busy.current = false;
    }
  }, [loading, merge, bump, loadDetail, markReadUpTo]);

  usePolling(poll, chatId && !gone ? interval : null);

  const loadOlder = useCallback(async () => {
    const id = idRef.current;
    const first = messages.find((m) => !m.pending);
    if (!id || !first) return;
    const r = await getChatMessages(id, { before: first.seq });
    if (idRef.current !== id) return;
    merge(r.messages);
    setHasMore(r.hasMore);
  }, [messages, merge]);

  // Skickar direkt och visar meddelandet som "skickas…" tills servern svarat.
  const send = useCallback(async (body: string, attachments: ChatAttachment[]) => {
    const id = idRef.current;
    if (!id) return;
    bump();
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const temp: ChatMessage = {
      seq: Number.MAX_SAFE_INTEGER, rev: 0, userId: null, authorName: '', kind: 'text', body, attachments,
      createdAt: Date.now(), editedAt: null, deleted: false, reactions: {}, myReactions: [], isMine: true, pending: 'sending', localId,
    };
    setMessages((prev) => [...prev, temp]);
    try {
      const r = await sendChatMessage(id, body, attachments.map((a) => a.id));
      if (idRef.current !== id) return;
      setMessages((prev) => sortMessages([...prev.filter((m) => m.localId !== localId && m.seq !== r.message.seq), r.message]));
      lastReadSent.current = Math.max(lastReadSent.current, r.message.seq);
      onReadRef.current?.();
    } catch (e: any) {
      setMessages((prev) => prev.map((m) => (m.localId === localId ? { ...m, pending: 'failed' } : m)));
      throw e;
    }
  }, [bump]);

  const retry = useCallback(async (localId: string) => {
    const m = messages.find((x) => x.localId === localId);
    if (!m) return;
    setMessages((prev) => prev.filter((x) => x.localId !== localId));
    await send(m.body, m.attachments);
  }, [messages, send]);

  const discard = useCallback((localId: string) => setMessages((prev) => prev.filter((x) => x.localId !== localId)), []);

  const replace = useCallback((m: ChatMessage) => merge([m]), [merge]);

  return {
    messages, detail, reads, hasMore, loading, error, gone,
    loadOlder, send, retry, discard, replace, setDetail, reloadDetail: loadDetail, bump, poll,
  };
}

export type ChatThreadState = ReturnType<typeof useChatThread>;
