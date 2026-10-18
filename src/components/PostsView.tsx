/**
 * Inlägg – tränarnas meddelanden till laget.
 * PostsView är sidan med alla inlägg. PostDetailSheet visar ett inlägg (med reaktioner,
 * kommentarer och, för tränare, vilka spelare som läst). PostEditorSheet är skriv-/redigeraarket.
 * PostsHomeSection är kortet på Översikt.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Megaphone, Pin, Plus, MessageCircle, Eye, ExternalLink, Calendar, ImagePlus, Trash2, Edit2, X, Link2,
  ChevronRight, Send, Check, Swords, Dumbbell, SmilePlus, ImageOff, RefreshCw,
} from 'lucide-react';
import EmojiPicker from './EmojiPicker';
import type { TrainingSession } from '../types';
import { getApiUrl } from '../lib/firebase';
import { isMatchSession } from '../utils/sessionCategory';
import {
  Post, PostComment, PostDetail, PostInput, PostsState, addPostComment, createPost, deletePost, deletePostComment,
  getPost, markPostRead, togglePostReaction, updatePost, uploadPostImage,
} from '../lib/posts';
import { Badge, Button, Card, EmptyState, IconButton, SectionHeader, Sheet } from './ui';

const INPUT = 'w-full h-12 px-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-base text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/60';
const TEXTAREA = 'w-full px-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-base text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 resize-y';
const LABEL = 'text-sm font-semibold text-zinc-700 dark:text-zinc-200';

/* ---------- Hjälpfunktioner ---------- */

export const timeAgo = (ts: number) => {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'Nyss';
  if (min < 60) return `${min} min sedan`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} tim sedan`;
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
};

const sessionStart = (s: TrainingSession) => {
  const d = new Date(s.date);
  const [h, m] = (s.startTime || '00:00').split(':').map(Number);
  if (!isNaN(h)) d.setHours(h, isNaN(m) ? 0 : m, 0, 0);
  return d.getTime();
};

export const sessionLabel = (s: TrainingSession) => {
  const kind = isMatchSession(s) ? 'Match' : 'Träning';
  const day = new Date(s.date).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${s.title || kind} · ${day}${s.startTime ? ` ${s.startTime}` : ''}`;
};

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

// Inläggets bild. Går den inte att visa (borttagen fil, servern nere) visas en ruta med en ikon
// i stället för en trasig bild, så att det syns att något är fel och kan rättas.
export const PostImage: React.FC<{ url: string; variant: 'thumb' | 'thumbSmall' | 'full' }> = ({ url, variant }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const box = variant === 'full'
    ? 'w-full h-48 sm:h-56 rounded-xl'
    : `${variant === 'thumbSmall' ? 'w-14 h-14' : 'w-16 h-16'} rounded-xl shrink-0`;
  if (failed) {
    return (
      <div className={`${box} bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex flex-col items-center justify-center gap-1.5 text-center`} title="Bilden kunde inte visas">
        <ImageOff size={variant === 'full' ? 28 : 20} />
        {variant === 'full' && <span className="text-sm">Bilden kunde inte visas</span>}
      </div>
    );
  }
  return (
    <img
      src={getApiUrl(url)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={variant === 'full'
        ? 'w-full max-h-80 min-h-[6rem] object-contain rounded-xl bg-zinc-100 dark:bg-zinc-800'
        : `${box} object-cover bg-zinc-100 dark:bg-zinc-800`}
    />
  );
};

// Text med klickbara webbadresser och bevarade radbrytningar.
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
export const PostText: React.FC<{ text: string; className?: string }> = ({ text, className }) => (
  <div className={`whitespace-pre-wrap break-words ${className || ''}`}>
    {text.split(URL_RE).map((part, i) =>
      i % 2 === 1 ? (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-300 underline underline-offset-2 break-all">{part}</a>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      )
    )}
  </div>
);

const ReactionSummary: React.FC<{ post: Post }> = ({ post }) => {
  const entries = Object.entries(post.reactions).filter(([, n]) => n > 0);
  if (!entries.length) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {entries.map(([e, n]) => <span key={e} className="inline-flex items-center gap-0.5">{e}<span className="tabular-nums">{n}</span></span>)}
    </span>
  );
};

const PostMeta: React.FC<{ post: Post; showReads: boolean }> = ({ post, showReads }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
    <span>{post.authorName} · {timeAgo(post.createdAt)}</span>
    {post.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageCircle size={13} />{post.commentCount}</span>}
    <ReactionSummary post={post} />
    {showReads && post.readerTotal !== undefined && (
      <span className="inline-flex items-center gap-1"><Eye size={13} />Läst av {post.readCount}/{post.readerTotal}</span>
    )}
  </div>
);

/* ---------- En rad i listan ---------- */

const PostRow: React.FC<{ post: Post; session?: TrainingSession; showReads: boolean; onOpen: () => void; compact?: boolean }> = ({ post, session, showReads, onOpen, compact }) => (
  <button type="button" onClick={onOpen} className="w-full text-left flex gap-3 px-4 py-3.5 cursor-pointer hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors">
    <span className={`relative w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${post.pinned ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300'}`}>
      {post.pinned ? <Pin size={18} /> : <Megaphone size={18} />}
      {!post.isRead && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-600 ring-2 ring-white dark:ring-zinc-900" aria-label="Oläst" />}
    </span>
    <span className="flex-1 min-w-0">
      <span className="flex items-center gap-2">
        <span className={`text-sm truncate ${post.isRead ? 'font-semibold' : 'font-bold'}`}>{post.title}</span>
        {post.pinned && <Badge tone="warning">Fäst</Badge>}
      </span>
      {post.body && <span className={`block mt-0.5 text-sm text-zinc-600 dark:text-zinc-300 ${compact ? 'line-clamp-2' : 'line-clamp-3'} whitespace-pre-line`}>{post.body}</span>}
      {session && (
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          <Calendar size={13} />{sessionLabel(session)}
        </span>
      )}
      <span className="block mt-1"><PostMeta post={post} showReads={showReads} /></span>
    </span>
    {post.imageUrl && <PostImage url={post.imageUrl} variant={compact ? 'thumbSmall' : 'thumb'} />}
  </button>
);

/* ---------- Sidan med alla inlägg ---------- */

export default function PostsView({ postsState, sessions, onOpenPost, onNewPost }: {
  postsState: PostsState;
  sessions: TrainingSession[];
  onOpenPost: (id: string) => void;
  onNewPost: () => void;
}) {
  const { posts, canEdit, loading, error } = postsState;
  const byId = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {canEdit ? 'Skriv till laget, t.ex. info inför match eller träning.' : 'Meddelanden från tränarna.'}
          </p>
          {canEdit && <Button icon={<Plus size={18} />} onClick={onNewPost}>Nytt inlägg</Button>}
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {posts.length > 0 ? (
          <Card padded={false} className="divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
            {posts.map(p => (
              <PostRow key={p.id} post={p} session={p.sessionId ? byId.get(p.sessionId) : undefined} showReads={canEdit} onOpen={() => onOpenPost(p.id)} />
            ))}
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon={<Megaphone size={26} />}
              title={loading ? 'Hämtar inlägg…' : 'Inga inlägg ännu'}
              text={canEdit ? 'Skriv ett inlägg så syns det för alla i laget på Översikt.' : 'När tränarna skriver något till laget syns det här.'}
              action={canEdit && !loading ? <Button icon={<Plus size={18} />} onClick={onNewPost}>Nytt inlägg</Button> : undefined}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---------- Kortet på Översikt ---------- */

export const PostsHomeSection: React.FC<{
  posts: Post[];
  canEdit: boolean;
  sessions: TrainingSession[];
  onOpenPost: (id: string) => void;
  onNewPost: () => void;
  onShowAll: () => void;
}> = ({ posts, canEdit, sessions, onOpenPost, onNewPost, onShowAll }) => {
  const byId = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  // Fästa och olästa först, sedan de senaste – högst tre.
  const shown = useMemo(() => {
    const pinned = posts.filter(p => p.pinned);
    const rest = posts.filter(p => !p.pinned);
    return [...pinned, ...rest].slice(0, Math.max(3, Math.min(pinned.length, 5)));
  }, [posts]);
  const unread = posts.filter(p => !p.isRead).length;

  if (!posts.length) {
    if (!canEdit) return null;
    return (
      <Card className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0"><Megaphone size={20} /></span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold">Inga inlägg ännu</div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">Skriv till laget – det syns här för alla.</div>
        </div>
        <Button size="sm" icon={<Plus size={16} />} onClick={onNewPost}>Skriv</Button>
      </Card>
    );
  }

  return (
    <section>
      <SectionHeader
        title={unread > 0 ? `Inlägg · ${unread} ${unread === 1 ? 'oläst' : 'olästa'}` : 'Inlägg'}
        icon={<Megaphone size={16} />}
        action={
          <div className="flex items-center gap-3">
            {canEdit && (
              <button type="button" onClick={onNewPost} className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-0.5 cursor-pointer">
                <Plus size={16} /> Skriv
              </button>
            )}
            <button type="button" onClick={onShowAll} className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-0.5 cursor-pointer">
              Alla <ChevronRight size={16} />
            </button>
          </div>
        }
      />
      <Card padded={false} className="divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
        {shown.map(p => (
          <PostRow key={p.id} compact post={p} session={p.sessionId ? byId.get(p.sessionId) : undefined} showReads={canEdit} onOpen={() => onOpenPost(p.id)} />
        ))}
      </Card>
    </section>
  );
};

/* ---------- Läsa ett inlägg ---------- */

export const PostDetailSheet: React.FC<{
  postId: string | null;
  postsState: PostsState;
  sessions: TrainingSession[];
  onClose: () => void;
  onEdit: (post: Post) => void;
  onOpenSession: (id: string) => void;
}> = ({ postId, postsState, sessions, onClose, onEdit, onOpenSession }) => {
  const { canEdit, reactions, replace, remove, patch } = postsState;
  const listed = postsState.posts.find(p => p.id === postId) || null;
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [showReaders, setShowReaders] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    setDetail(null); setError(null); setComment(''); setShowReaders(false); setShowPicker(false);
    if (!postId) return;
    let cancelled = false;
    getPost(postId)
      .then(d => {
        if (cancelled) return;
        setDetail(d);
        if (!d.post.isRead) {
          markPostRead(postId).then(() => patch(postId, { isRead: true })).catch(() => {});
        }
      })
      .catch(e => !cancelled && setError(e?.message || 'Kunde inte hämta inlägget.'));
    return () => { cancelled = true; };
  }, [postId, patch]);

  const post = detail?.post || listed;
  const session = post?.sessionId ? sessions.find(s => s.id === post.sessionId) : undefined;

  // Reaktioner visas direkt; svaret från servern används bara om inget nyare tryck har gjorts
  // (annars kan ett långsamt svar på ett tidigare tryck dölja ett senare).
  const reactSeq = useRef(0);
  const react = async (emoji: string) => {
    if (!post) return;
    const on = !post.myReactions.includes(emoji);
    const optimistic: Post = {
      ...post,
      isRead: true,
      myReactions: on ? [...post.myReactions, emoji] : post.myReactions.filter(x => x !== emoji),
      reactions: { ...post.reactions, [emoji]: Math.max(0, (post.reactions[emoji] || 0) + (on ? 1 : -1)) },
    };
    setDetail(d => (d ? { ...d, post: optimistic } : d));
    replace(optimistic);
    const seq = ++reactSeq.current;
    try {
      const r = await togglePostReaction(post.id, emoji);
      if (seq !== reactSeq.current) return;
      setDetail(d => (d ? { ...d, post: { ...r.post, isRead: true } } : d));
      replace({ ...r.post, isRead: true });
    } catch (e: any) { setError(e?.message || 'Kunde inte spara reaktionen.'); }
  };

  const send = async () => {
    if (!post || !comment.trim()) return;
    setSending(true);
    try {
      const r = await addPostComment(post.id, comment);
      setDetail(d => (d ? { ...d, comments: [...d.comments, r.comment] } : d));
      patch(post.id, { commentCount: (post.commentCount || 0) + 1 });
      setComment('');
    } catch (e: any) { setError(e?.message || 'Kunde inte skicka kommentaren.'); }
    finally { setSending(false); }
  };

  const removeComment = async (c: PostComment) => {
    if (!post || !window.confirm('Ta bort kommentaren?')) return;
    try {
      await deletePostComment(post.id, c.id);
      setDetail(d => (d ? { ...d, comments: d.comments.filter(x => x.id !== c.id) } : d));
      patch(post.id, { commentCount: Math.max(0, (post.commentCount || 1) - 1) });
    } catch (e: any) { setError(e?.message || 'Kunde inte ta bort kommentaren.'); }
  };

  const removePost = async () => {
    if (!post || !window.confirm(`Ta bort inlägget "${post.title}"? Kommentarer och reaktioner försvinner också.`)) return;
    try {
      await deletePost(post.id);
      remove(post.id);
      onClose();
    } catch (e: any) { setError(e?.message || 'Kunde inte ta bort inlägget.'); }
  };

  return (
    <Sheet
      open={!!postId}
      onClose={onClose}
      title={post?.title || 'Inlägg'}
      footer={post ? (
        <div className="flex items-end gap-2">
          <textarea
            className={`${TEXTAREA} !py-2.5 min-h-[44px] max-h-32`}
            rows={1}
            placeholder="Skriv en kommentar…"
            value={comment}
            maxLength={2000}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          />
          <IconButton label="Skicka kommentar" onClick={send} disabled={sending || !comment.trim()} className="!bg-indigo-600 !text-white disabled:opacity-40 shrink-0">
            <Send size={18} />
          </IconButton>
        </div>
      ) : undefined}
    >
      {!post ? (
        <p className="px-2 py-6 text-sm text-zinc-500">{error || 'Hämtar…'}</p>
      ) : (
        <div className="px-2 pb-2 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            {post.pinned && <Badge tone="warning" icon={<Pin size={12} />}>Fäst</Badge>}
            <span>{post.authorName} · {timeAgo(post.createdAt)}{post.updatedAt - post.createdAt > 60000 ? ' · ändrad' : ''}</span>
          </div>

          {session && (
            <button type="button" onClick={() => onOpenSession(session.id)} className="w-full flex items-center gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-left cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <span className="w-9 h-9 rounded-lg bg-white dark:bg-zinc-900 flex items-center justify-center shrink-0 text-zinc-600 dark:text-zinc-300">
                {isMatchSession(session) ? <Swords size={18} /> : <Dumbbell size={18} />}
              </span>
              <span className="flex-1 min-w-0 text-sm font-semibold truncate">{sessionLabel(session)}</span>
              <ChevronRight size={18} className="text-zinc-400" />
            </button>
          )}

          {post.imageUrl && (
            <a href={getApiUrl(post.imageUrl)} target="_blank" rel="noopener noreferrer" className="block">
              <PostImage url={post.imageUrl} variant="full" />
            </a>
          )}

          {post.body && <PostText text={post.body} className="text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-100" />}

          {post.links.length > 0 && (
            <div className="flex flex-col gap-2">
              {post.links.map((l, i) => (
                <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <ExternalLink size={18} className="text-indigo-600 dark:text-indigo-300 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold truncate">{l.label || hostOf(l.url)}</span>
                    <span className="block text-xs text-zinc-500 truncate">{hostOf(l.url)}</span>
                  </span>
                </a>
              ))}
            </div>
          )}

          {/* Reaktioner */}
          <div>
          <div className="flex flex-wrap gap-1.5">
            {[
              ...reactions,
              // Andra emojis som någon har valt via plusknappen, flest först
              ...Object.entries(post.reactions)
                .filter(([e, n]) => n > 0 && !reactions.includes(e))
                .sort((a, b) => b[1] - a[1])
                .map(([e]) => e),
            ].map(e => {
              const n = post.reactions[e] || 0;
              const mine = post.myReactions.includes(e);
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => react(e)}
                  aria-pressed={mine}
                  title={mine ? 'Ta bort din reaktion' : 'Reagera'}
                  className={`h-9 px-2.5 rounded-full border-2 text-sm inline-flex items-center gap-1 cursor-pointer transition-colors active:scale-95 ${
                    mine
                      ? 'bg-indigo-100 border-indigo-500 dark:bg-indigo-500/30 dark:border-indigo-400'
                      : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span className="text-base leading-none">{e}</span>
                  {n > 0 && <span className={`font-semibold tabular-nums ${mine ? 'text-indigo-700 dark:text-indigo-200' : 'text-zinc-700 dark:text-zinc-200'}`}>{n}</span>}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowPicker(v => !v)}
              aria-expanded={showPicker}
              aria-label="Fler reaktioner"
              title="Fler reaktioner"
              className={`h-9 w-11 rounded-full border-2 inline-flex items-center justify-center cursor-pointer transition-colors ${
                showPicker ? 'bg-zinc-200 border-zinc-300 dark:bg-zinc-700 dark:border-zinc-600' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
            >
              <SmilePlus size={18} />
            </button>
          </div>
          {showPicker && (
            <div className="mt-2">
              <EmojiPicker selected={post.myReactions} onPick={react} onClose={() => setShowPicker(false)} />
            </div>
          )}
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {post.myReactions.length ? 'Markerade är dina. Tryck igen för att ta bort, eller välj fler.' : 'Tryck för att reagera – du kan välja flera, och fler finns under plusknappen.'}
          </p>
          </div>

          {/* Läst av (tränare) */}
          {canEdit && detail?.readers && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700">
              <button type="button" onClick={() => setShowReaders(v => !v)} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold cursor-pointer">
                <Eye size={16} className="text-zinc-500" />
                Läst av {detail.readers.read.length} av {detail.readers.read.length + detail.readers.unread.length} spelare
                <ChevronRight size={16} className={`ml-auto text-zinc-400 transition-transform ${showReaders ? 'rotate-90' : ''}`} />
              </button>
              {showReaders && (
                <div className="px-3 pb-3 grid gap-3 sm:grid-cols-2 text-sm">
                  <div>
                    <div className="text-xs font-semibold text-zinc-500 mb-1">Har läst</div>
                    {detail.readers.read.length ? detail.readers.read.map(r => (
                      <div key={r.memberId} className="flex items-center gap-1.5 py-0.5"><Check size={14} className="text-emerald-600" />{r.name}</div>
                    )) : <div className="text-zinc-400">Ingen ännu</div>}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-zinc-500 mb-1">Har inte läst</div>
                    {detail.readers.unread.length ? detail.readers.unread.map(r => (
                      <div key={r.memberId} className="py-0.5">{r.name}{!r.hasAccount && <span className="text-xs text-zinc-400"> (inget konto)</span>}</div>
                    )) : <div className="text-zinc-400">Alla har läst</div>}
                  </div>
                </div>
              )}
            </div>
          )}

          {canEdit && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={<Edit2 size={16} />} onClick={() => onEdit(post)}>Redigera</Button>
              <Button size="sm" variant="secondary" icon={<Trash2 size={16} />} onClick={removePost} className="!text-red-600 dark:!text-red-400">Ta bort</Button>
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {/* Kommentarer */}
          <div className="pt-1">
            <div className="text-sm font-semibold mb-2 flex items-center gap-1.5"><MessageCircle size={16} />Kommentarer{detail ? ` (${detail.comments.length})` : ''}</div>
            {detail && detail.comments.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">Inga kommentarer ännu.</p>}
            <div className="space-y-2">
              {detail?.comments.map(c => (
                <div key={c.id} className={`group rounded-2xl px-3.5 py-2.5 ${c.isMine ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
                  <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-200">{c.authorName}</span>
                    <span>{timeAgo(c.createdAt)}</span>
                    {(c.isMine || canEdit) && (
                      <button type="button" onClick={() => removeComment(c)} className="ml-auto p-1 -m-1 text-zinc-400 hover:text-red-600 cursor-pointer" aria-label="Ta bort kommentaren">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <PostText text={c.body} className="text-sm mt-0.5 text-zinc-800 dark:text-zinc-100" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
};

/* ---------- Skriva / redigera ---------- */

const emptyInput = (sessionId?: string | null): PostInput => ({ title: '', body: '', pinned: false, sessionId: sessionId || null, imageUrl: null, links: [] });

export const PostEditorSheet: React.FC<{
  // null = stängt, 'new' = nytt inlägg, annars inlägget som ändras
  editing: Post | 'new' | null;
  clubId?: string;
  teamId?: string;
  sessions: TrainingSession[];
  postsState: PostsState;
  onClose: () => void;
  onSaved?: (post: Post) => void;
}> = ({ editing, clubId, teamId, sessions, postsState, onClose, onSaved }) => {
  const [form, setForm] = useState<PostInput>(emptyInput());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setError(null);
    if (editing && editing !== 'new') {
      setForm({ title: editing.title, body: editing.body, pinned: editing.pinned, sessionId: editing.sessionId, imageUrl: editing.imageUrl, links: editing.links.map(l => ({ ...l })) });
    } else if (editing === 'new') {
      setForm(emptyInput());
    }
  }, [editing]);

  // Kommande aktiviteter först, sedan de senaste två veckornas.
  const sessionOptions = useMemo(() => {
    const now = Date.now();
    const live = sessions.filter(s => !s.isIgnored);
    const upcoming = live.filter(s => sessionStart(s) >= now - 3 * 3600 * 1000).sort((a, b) => sessionStart(a) - sessionStart(b)).slice(0, 40);
    const past = live.filter(s => sessionStart(s) < now - 3 * 3600 * 1000 && sessionStart(s) > now - 14 * 86400000).sort((a, b) => sessionStart(b) - sessionStart(a));
    const chosen = form.sessionId && !upcoming.concat(past).some(s => s.id === form.sessionId) ? live.filter(s => s.id === form.sessionId) : [];
    return { upcoming, past: [...chosen, ...past] };
  }, [sessions, form.sessionId]);

  const set = <K extends keyof PostInput>(k: K, v: PostInput[K]) => setForm(f => ({ ...f, [k]: v }));

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try { set('imageUrl', await uploadPostImage(file)); }
    catch (e: any) { setError(e?.message || 'Bilden kunde inte laddas upp.'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const save = async () => {
    if (!form.title.trim() || !editing) return;
    setSaving(true);
    setError(null);
    try {
      const input = { ...form, links: form.links.filter(l => l.url.trim()) };
      const r = editing === 'new' ? await createPost(clubId!, teamId!, input) : await updatePost(editing.id, input);
      postsState.replace(r.post);
      onSaved?.(r.post);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Inlägget kunde inte sparas.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={!!editing}
      onClose={onClose}
      title={editing === 'new' ? 'Nytt inlägg' : 'Redigera inlägg'}
      footer={
        <div className="flex items-center justify-between gap-2">
          {error ? <p className="text-sm text-red-600 dark:text-red-400 min-w-0">{error}</p> : <span />}
          <div className="flex gap-2 shrink-0">
            <Button variant="secondary" onClick={onClose}>Avbryt</Button>
            <Button onClick={save} disabled={saving || uploading || !form.title.trim()}>{saving ? 'Sparar…' : editing === 'new' ? 'Publicera' : 'Spara'}</Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-2 pb-2">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Rubrik</span>
          <input autoFocus type="text" className={`${INPUT} font-semibold`} value={form.title} maxLength={150} onChange={e => set('title', e.target.value)} placeholder="T.ex. Inför matchen på lördag" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Text</span>
          <textarea className={TEXTAREA} rows={6} value={form.body} maxLength={10000} onChange={e => set('body', e.target.value)} placeholder="Samling, utrustning, vad som gäller…" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Koppla till aktivitet (valfritt)</span>
          <select className={INPUT} value={form.sessionId || ''} onChange={e => set('sessionId', e.target.value || null)}>
            <option value="">Ingen aktivitet</option>
            {sessionOptions.upcoming.length > 0 && (
              <optgroup label="Kommande">
                {sessionOptions.upcoming.map(s => <option key={s.id} value={s.id}>{sessionLabel(s)}</option>)}
              </optgroup>
            )}
            {sessionOptions.past.length > 0 && (
              <optgroup label="Tidigare">
                {sessionOptions.past.map(s => <option key={s.id} value={s.id}>{sessionLabel(s)}</option>)}
              </optgroup>
            )}
          </select>
        </label>

        {/* Bild */}
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Bild (valfritt)</span>
          {form.imageUrl ? (
            <div className="flex flex-col gap-2">
              <PostImage url={form.imageUrl} variant="full" />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" icon={<RefreshCw size={18} />} onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Förbereder…' : 'Byt bild'}
                </Button>
                <Button variant="secondary" icon={<Trash2 size={18} />} onClick={() => set('imageUrl', null)} disabled={uploading} className="!text-red-600 dark:!text-red-400">
                  Ta bort bild
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" icon={<ImagePlus size={18} />} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Förbereder bilden…' : 'Lägg till bild'}
            </Button>
          )}
          <input ref={fileRef} type="file" accept="image/*,.heic,.heif" className="hidden" onChange={e => pickImage(e.target.files?.[0])} />
        </div>

        {/* Länkar */}
        <div className="flex flex-col gap-2">
          <span className={LABEL}>Länkar (valfritt)</span>
          {form.links.map((l, i) => (
            <div key={i} className="flex flex-col gap-2 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700">
              <div className="flex gap-2">
                <input type="url" inputMode="url" className={`${INPUT} !h-11`} value={l.url} placeholder="https://…" onChange={e => set('links', form.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <IconButton label="Ta bort länken" onClick={() => set('links', form.links.filter((_, j) => j !== i))}><Trash2 size={18} /></IconButton>
              </div>
              <input type="text" className={`${INPUT} !h-11`} value={l.label} maxLength={100} placeholder="Namn på länken, t.ex. Vägbeskrivning" onChange={e => set('links', form.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            </div>
          ))}
          {form.links.length < 10 && (
            <Button variant="secondary" icon={<Link2 size={18} />} onClick={() => set('links', [...form.links, { url: '', label: '' }])}>Lägg till länk</Button>
          )}
        </div>

        <label className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 cursor-pointer">
          <input type="checkbox" className="w-5 h-5 accent-indigo-600" checked={form.pinned} onChange={e => set('pinned', e.target.checked)} />
          <span className="flex-1">
            <span className="block text-sm font-semibold">Fäst överst</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">Ligger kvar först på Översikt tills du tar bort fästningen.</span>
          </span>
          <Pin size={18} className="text-amber-500" />
        </label>
      </div>
    </Sheet>
  );
};
