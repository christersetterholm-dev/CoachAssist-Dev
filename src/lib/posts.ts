// Inlägg: tränarnas meddelanden till laget. Pratar med /api/posts (se server/posts.ts).
import { useCallback, useEffect, useState } from 'react';
import { getApiUrl, getAuthHeader } from './firebase';
import { isHeicFile, optimizeImageForUpload } from '../utils/imageOptimizer';

export interface PostLink { url: string; label: string }

export interface Post {
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
  readCount?: number;
  readerTotal?: number;
}

export interface PostComment { id: string; userId: string; authorName: string; body: string; createdAt: number; isMine: boolean }

export interface PostReaders {
  read: { memberId: string; name: string; readAt: number }[];
  unread: { memberId: string; name: string; hasAccount: boolean }[];
}

export interface PostDetail { post: Post; comments: PostComment[]; readers?: PostReaders }

export type PostInput = Pick<Post, 'title' | 'body' | 'pinned' | 'sessionId' | 'imageUrl' | 'links'>;

export const DEFAULT_REACTIONS = ['👍', '❤️', '💪', '⚽', '🔥', '😂'];

// Samma regel som servern (server/posts.ts): 👍 och 👍️ ska vara samma reaktion.
export function normalizeEmoji(input: string): string | null {
  if (!input || input.length > 32) return null;
  const out: string[] = [];
  const chars = Array.from(input);
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '\uFE0F' && i > 0 && /\p{Emoji_Presentation}/u.test(chars[i - 1])) continue;
    out.push(chars[i]);
  }
  if (out.length === 1 && !/\p{Emoji_Presentation}/u.test(out[0])) out.push('\uFE0F');
  return out.join('');
}

const OFFLINE = 'Kunde inte nå servern. Kontrollera anslutningen (eller att appen är igång) och försök igen.';
// fetch som ger ett begripligt fel när servern inte svarar alls (i stället för "Failed to fetch").
const safeFetch = (url: string, init: RequestInit) => fetch(url, init).catch(() => { throw new Error(OFFLINE); });

const call = async (method: string, path: string, body?: any) => {
  const res = await safeFetch(getApiUrl(path), {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...getAuthHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `Något gick fel (${res.status})`);
  // En server som inte känner till inläggen (t.ex. inte omstartad) svarar med en webbsida.
  if (!json) throw new Error('Servern svarar inte på inläggen. Starta om servern (npm run dev) och ladda om sidan.');
  return json;
};

const enc = encodeURIComponent;

export const listPosts = (clubId: string, teamId: string): Promise<{ posts: Post[]; canEdit: boolean; reactions: string[] }> =>
  call('GET', `/api/posts?clubId=${enc(clubId)}&teamId=${enc(teamId)}`);
export const getPost = (id: string): Promise<PostDetail> => call('GET', `/api/posts/${enc(id)}`);
export const createPost = (clubId: string, teamId: string, post: PostInput): Promise<PostDetail> =>
  call('POST', '/api/posts', { clubId, teamId, post });
export const updatePost = (id: string, post: PostInput): Promise<PostDetail> => call('PUT', `/api/posts/${enc(id)}`, { post });
export const deletePost = (id: string) => call('DELETE', `/api/posts/${enc(id)}`);
export const markPostRead = (id: string) => call('POST', `/api/posts/${enc(id)}/read`, {});
export const togglePostReaction = (id: string, emoji: string): Promise<{ on: boolean; post: Post }> =>
  call('POST', `/api/posts/${enc(id)}/reactions`, { emoji });
export const addPostComment = (id: string, body: string): Promise<{ comment: PostComment }> =>
  call('POST', `/api/posts/${enc(id)}/comments`, { body });
export const deletePostComment = (id: string, commentId: string) => call('DELETE', `/api/posts/${enc(id)}/comments/${enc(commentId)}`);

// --- Bilder ---
// HEIC (iPhone) görs om till JPEG och bilden krymps till högst 1600 px innan uppladdning
// (samma hjälpfunktion som övningsbanken och passplaneringen använder).
export const uploadPostImage = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/') && !isHeicFile(file)) throw new Error('Välj en bildfil.');
  const optimized = await optimizeImageForUpload(file);
  const form = new FormData();
  form.append('file', optimized, optimized.name);
  const res = await safeFetch(getApiUrl('/api/upload'), { method: 'POST', headers: getAuthHeader(), body: form });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.url) throw new Error(json?.error || 'Bilden kunde inte laddas upp.');
  return json.url;
};

// Lagets inlägg, hämtas när laget byts och var femte minut medan appen är öppen.
export function usePosts(clubId: string | undefined, teamId: string | undefined, enabled: boolean) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [reactions, setReactions] = useState<string[]>(DEFAULT_REACTIONS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = enabled && !!clubId && !!teamId && teamId !== 'club_global';

  const reload = useCallback(async () => {
    if (!active) { setPosts([]); setCanEdit(false); return; }
    setLoading(true);
    try {
      const r = await listPosts(clubId!, teamId!);
      setPosts(r.posts);
      setCanEdit(r.canEdit);
      if (Array.isArray(r.reactions) && r.reactions.length) setReactions(r.reactions);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Kunde inte hämta inläggen.');
    } finally {
      setLoading(false);
    }
  }, [active, clubId, teamId]);

  useEffect(() => {
    reload();
    if (!active) return;
    const t = setInterval(reload, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [reload, active]);

  // Byter ut ett inlägg i listan (efter ändring, reaktion, läsning) utan att hämta om allt.
  const replace = useCallback((p: Post) => {
    setPosts(prev => {
      const next = prev.some(x => x.id === p.id) ? prev.map(x => (x.id === p.id ? p : x)) : [p, ...prev];
      return next.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
    });
  }, []);
  const remove = useCallback((id: string) => setPosts(prev => prev.filter(p => p.id !== id)), []);
  const patch = useCallback((id: string, changes: Partial<Post>) => setPosts(prev => prev.map(p => (p.id === id ? { ...p, ...changes } : p))), []);

  return { posts, canEdit, reactions, loading, error, reload, replace, remove, patch, unreadCount: posts.filter(p => !p.isRead).length };
}

export type PostsState = ReturnType<typeof usePosts>;
