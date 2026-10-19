// En chatt: pratbubblor, skrivfält, reaktioner och menyn för ett meddelande.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, CheckCheck, Copy, Download, FileText, Flag, Loader2, Paperclip, Pencil,
  RotateCcw, Send, SmilePlus, Trash2, Users, X,
} from 'lucide-react';
import { Avatar, Button, EmptyState, IconButton, MenuItem, Sheet, TextArea } from '../ui';
import EmojiPicker from '../EmojiPicker';
import { normalizeEmoji } from '../../lib/posts';
import {
  CHAT_FILE_ACCEPT, CHAT_LIMITS, deleteChatMessage, downloadChatFile, editChatMessage, formatChatTime, formatDayLabel,
  formatFileSize, isImageAttachment, reportChatMessage, toggleChatReaction, uploadChatFile, useChatFileUrl, useChatThread,
  type ChatAttachment, type ChatMessage,
} from '../../lib/chat';
import { ChatSettingsSheet } from './ChatSettingsSheet';

const cx = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join(' ');

// Pekskärm: Enter ger ny rad. Mus/tangentbord: Enter skickar, Skift+Enter ny rad.
const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

export const ChatAvatar: React.FC<{ kind: string; name: string; photoUrl?: string | null; size?: number }> = ({ kind, name, photoUrl, size = 40 }) =>
  kind === 'direct' ? (
    <Avatar name={name} photoUrl={photoUrl} size={size} />
  ) : (
    <span
      className={cx('inline-flex items-center justify-center rounded-full shrink-0', kind === 'team' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300')}
      style={{ width: size, height: size }}
    >
      <Users size={size * 0.48} />
    </span>
  );

// --- Bilder och filer ---

const ChatImage: React.FC<{ a: ChatAttachment; onOpen: (a: ChatAttachment, url: string) => void; single: boolean }> = ({ a, onOpen, single }) => {
  const { url, failed } = useChatFileUrl(a.id);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (url) onOpen(a, url); }}
      className={cx('block overflow-hidden rounded-xl bg-zinc-200/60 dark:bg-zinc-800 cursor-zoom-in', single ? 'w-60 max-w-full' : 'w-[118px] h-[118px]')}
      aria-label={`Visa bilden ${a.name}`}
    >
      {url ? (
        <img src={url} alt={a.name} className={cx('w-full object-cover', single ? 'max-h-80' : 'h-full')} />
      ) : (
        <span className={cx('flex items-center justify-center text-xs text-zinc-500', single ? 'h-40' : 'h-full')}>
          {failed ? 'Bilden kunde inte visas' : <Loader2 size={18} className="animate-spin" />}
        </span>
      )}
    </button>
  );
};

const ChatFile: React.FC<{ a: ChatAttachment; mine: boolean }> = ({ a, mine }) => {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try { await downloadChatFile(a); } catch { alert('Filen kunde inte hämtas.'); } finally { setBusy(false); }
      }}
      className={cx(
        'flex items-center gap-2.5 w-60 max-w-full p-2.5 rounded-xl text-left cursor-pointer',
        mine ? 'bg-white/15 hover:bg-white/25' : 'bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-950 border border-zinc-200 dark:border-zinc-700'
      )}
    >
      <span className={cx('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', mine ? 'bg-white/20' : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300')}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold truncate">{a.name}</span>
        <span className={cx('block text-xs', mine ? 'text-white/75' : 'text-zinc-500')}>{formatFileSize(a.size)} · Tryck för att ladda ner</span>
      </span>
    </button>
  );
};

const Lightbox: React.FC<{ item: { a: ChatAttachment; url: string } | null; onClose: () => void }> = ({ item, onClose }) => {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-[90] bg-black/90 flex flex-col pt-safe pb-safe" onClick={onClose}>
      <div className="flex items-center justify-end gap-2 p-3">
        <button type="button" onClick={(e) => { e.stopPropagation(); downloadChatFile(item.a); }} className="h-10 px-3 rounded-xl bg-white/15 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer">
          <Download size={18} /> Spara
        </button>
        <button type="button" onClick={onClose} aria-label="Stäng" className="w-10 h-10 rounded-xl bg-white/15 text-white inline-flex items-center justify-center cursor-pointer">
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-3">
        <img src={item.url} alt={item.a.name} className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
};

// --- Ett meddelande ---

const ReactionChips: React.FC<{ m: ChatMessage; onToggle: (emoji: string) => void; alignRight: boolean }> = ({ m, onToggle, alignRight }) => {
  const entries = Object.entries(m.reactions);
  if (!entries.length) return null;
  return (
    <div className={cx('flex flex-wrap gap-1 -mt-1.5 relative z-[1]', alignRight ? 'justify-end pr-2' : 'pl-2')}>
      {entries.map(([e, n]) => {
        const mine = m.myReactions.includes(e);
        return (
          <button
            key={e}
            type="button"
            onClick={() => onToggle(e)}
            aria-pressed={mine}
            title={mine ? 'Ta bort din reaktion' : 'Reagera likadant'}
            className={cx(
              'h-7 px-2 rounded-full text-xs inline-flex items-center gap-1 border shadow-sm cursor-pointer',
              mine ? 'bg-indigo-50 border-indigo-300 dark:bg-indigo-950 dark:border-indigo-600' : 'bg-white border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700'
            )}
          >
            <span className="text-sm leading-none">{e}</span>
            {n > 1 && <span className="font-semibold tabular-nums">{n}</span>}
          </button>
        );
      })}
    </div>
  );
};

const Bubble: React.FC<{
  m: ChatMessage;
  showAuthor: boolean;
  status: React.ReactNode;
  onOpen: () => void;
  onImage: (a: ChatAttachment, url: string) => void;
  onToggleReaction: (emoji: string) => void;
  onRetry: () => void;
  onDiscard: () => void;
}> = ({ m, showAuthor, status, onOpen, onImage, onToggleReaction, onRetry, onDiscard }) => {
  if (m.kind === 'event') {
    return (
      <div className="flex justify-center my-2 px-6">
        <span className="px-3 py-1 rounded-full bg-zinc-200/70 dark:bg-zinc-800 text-xs text-zinc-600 dark:text-zinc-300 text-center">{m.body}</span>
      </div>
    );
  }
  const mine = m.isMine;
  const images = m.attachments.filter(isImageAttachment);
  const files = m.attachments.filter((a) => !isImageAttachment(a));
  return (
    <div className={cx('flex flex-col mb-1', mine ? 'items-end' : 'items-start')}>
      {showAuthor && !mine && <span className="px-3 mb-0.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{m.authorName}</span>}
      <div
        role="button"
        tabIndex={0}
        onClick={m.pending ? undefined : onOpen}
        onKeyDown={(e) => { if (!m.pending && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}
        onContextMenu={(e) => { if (!m.pending) { e.preventDefault(); onOpen(); } }}
        className={cx(
          'max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-2 text-[15px] leading-snug select-text',
          m.pending ? 'cursor-default' : 'cursor-pointer',
          m.deleted
            ? 'bg-transparent border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 italic'
            : mine
              ? 'bg-indigo-600 text-white rounded-br-md dark:bg-indigo-500'
              : 'bg-white text-zinc-900 border border-zinc-200/80 rounded-bl-md dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700',
          m.pending === 'sending' && 'opacity-70'
        )}
      >
        {m.deleted ? (
          'Meddelandet togs bort'
        ) : (
          <>
            {images.length > 0 && (
              <div className={cx('flex flex-wrap gap-1', (m.body || files.length) && 'mb-1.5')}>
                {images.map((a) => <ChatImage key={a.id} a={a} onOpen={onImage} single={images.length === 1} />)}
              </div>
            )}
            {files.length > 0 && (
              <div className={cx('flex flex-col gap-1', m.body && 'mb-1.5')}>
                {files.map((a) => <ChatFile key={a.id} a={a} mine={mine} />)}
              </div>
            )}
            {m.body && <span className="whitespace-pre-wrap break-words">{m.body}</span>}
          </>
        )}
        <span className={cx('flex items-center justify-end gap-1 mt-0.5 text-[11px]', mine && !m.deleted ? 'text-white/75' : 'text-zinc-400')}>
          {m.editedAt && !m.deleted && <span>ändrat ·</span>}
          {m.pending === 'sending' ? 'Skickas…' : m.pending === 'failed' ? '' : formatChatTime(m.createdAt)}
        </span>
      </div>
      {m.pending === 'failed' && (
        <div className="flex items-center gap-2 mt-1 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle size={14} /> Kunde inte skickas.
          <button type="button" onClick={onRetry} className="font-semibold underline cursor-pointer inline-flex items-center gap-1"><RotateCcw size={12} />Försök igen</button>
          <button type="button" onClick={onDiscard} className="font-semibold underline cursor-pointer">Ta bort</button>
        </div>
      )}
      <ReactionChips m={m} onToggle={onToggleReaction} alignRight={mine} />
      {status}
    </div>
  );
};

// --- Skrivfältet ---

interface Upload { key: string; name: string; file?: ChatAttachment; error?: string }

const Composer: React.FC<{
  chatId: string;
  editing: ChatMessage | null;
  onCancelEdit: () => void;
  onSend: (body: string, attachments: ChatAttachment[]) => Promise<void>;
  onSaveEdit: (m: ChatMessage, body: string) => Promise<void>;
  onTyping: () => void;
}> = ({ chatId, editing, onCancelEdit, onSend, onSaveEdit, onTyping }) => {
  // DICTATION: ostyrd ruta – texten läses vid Skicka, så text från dikteringsverktyg försvinner inte.
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = editing ? editing.body : '';
    resize();
    if (editing) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, [editing]);

  // Byte av chatt: töm rutan och bilagorna.
  useEffect(() => {
    if (ref.current) { ref.current.value = ''; resize(); }
    setUploads([]);
    setError(null);
  }, [chatId]);

  const pickFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = Array.from(list);
    const room = CHAT_LIMITS.filesPerMessage - uploads.length;
    if (files.length > room) setError(`Högst ${CHAT_LIMITS.filesPerMessage} filer per meddelande.`);
    for (const f of files.slice(0, Math.max(0, room))) {
      const key = `${Date.now()}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: f.name }]);
      uploadChatFile(chatId, f)
        .then((file) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, file } : x))))
        .catch((e) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: e?.message || 'Kunde inte laddas upp.' } : x))));
    }
  };

  const uploading = uploads.some((u) => !u.file && !u.error);

  const submit = async () => {
    const el = ref.current;
    if (!el || busy) return;
    const body = el.value.replace(/\r\n/g, '\n').trim();
    if (body.length > CHAT_LIMITS.body) { setError(`Meddelandet får vara högst ${CHAT_LIMITS.body} tecken.`); return; }
    setError(null);
    if (editing) {
      setBusy(true);
      try { await onSaveEdit(editing, body); } catch (e: any) { setError(e?.message || 'Kunde inte ändra.'); } finally { setBusy(false); }
      return;
    }
    if (uploading) { setError('Vänta tills filerna har laddats upp.'); return; }
    const attachments = uploads.filter((u) => u.file).map((u) => u.file!);
    if (!body && !attachments.length) return;
    el.value = '';
    resize();
    setUploads([]);
    onSend(body, attachments).catch(() => { /* visas på meddelandet med Försök igen */ });
    el.focus();
  };

  return (
    <div className="shrink-0 border-t border-zinc-200/80 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md px-2 sm:px-3 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+8px)]">
      {editing && (
        <div className="flex items-center gap-2 px-2 pb-2 text-sm">
          <Pencil size={15} className="text-indigo-600 dark:text-indigo-300" />
          <span className="flex-1 font-semibold text-indigo-700 dark:text-indigo-300">Ändrar meddelande</span>
          <button type="button" onClick={onCancelEdit} className="h-8 px-3 rounded-lg text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">Avbryt</button>
        </div>
      )}
      {uploads.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-1 pb-2">
          {uploads.map((u) => (
            <span key={u.key} className={cx('shrink-0 max-w-[200px] h-9 pl-3 pr-1 rounded-full inline-flex items-center gap-2 text-xs font-semibold', u.error ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300' : 'bg-zinc-100 dark:bg-zinc-800')}>
              {!u.file && !u.error ? <Loader2 size={14} className="animate-spin shrink-0" /> : u.error ? <AlertTriangle size={14} className="shrink-0" /> : <Paperclip size={14} className="shrink-0" />}
              <span className="truncate" title={u.error || u.name}>{u.error || u.name}</span>
              <button type="button" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))} aria-label={`Ta bort ${u.name}`} className="w-7 h-7 rounded-full inline-flex items-center justify-center hover:bg-black/10 cursor-pointer shrink-0">
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <p className="px-2 pb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-end gap-1.5">
        {!editing && (
          <>
            <IconButton label="Bifoga bild eller fil" onClick={() => fileRef.current?.click()} className="w-11 h-11">
              <Paperclip size={21} />
            </IconButton>
            <input ref={fileRef} type="file" multiple accept={CHAT_FILE_ACCEPT} className="hidden" onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />
          </>
        )}
        <TextArea
          ref={ref}
          rows={1}
          defaultValue=""
          placeholder="Skriv ett meddelande"
          aria-label="Meddelande"
          maxLength={CHAT_LIMITS.body + 200}
          onInput={() => { resize(); onTyping(); }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files || []);
            if (files.length && !editing) { e.preventDefault(); const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); pickFiles(dt.files); }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !isTouch() && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            if (e.key === 'Escape' && editing) onCancelEdit();
          }}
          className="flex-1 min-h-[44px] max-h-40 resize-none rounded-2xl bg-zinc-100 dark:bg-zinc-800 px-4 py-[11px] text-base leading-snug text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          aria-label={editing ? 'Spara ändringen' : 'Skicka'}
          title={editing ? 'Spara ändringen' : 'Skicka'}
          className="w-11 h-11 shrink-0 rounded-full bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 text-white inline-flex items-center justify-center cursor-pointer active:scale-95 transition-all disabled:opacity-50"
        >
          {busy ? <Loader2 size={19} className="animate-spin" /> : editing ? <Check size={20} strokeWidth={2.6} /> : <Send size={19} />}
        </button>
      </div>
    </div>
  );
};

// --- Chatten ---

export const ChatThread: React.FC<{
  chatId: string;
  clubId: string;
  myUserId: string;
  reactions: string[];
  onBack?: () => void;
  onRead: () => void;
  onLeft: () => void;
  onChanged: () => void;
}> = ({ chatId, clubId, myUserId, reactions, onBack, onRead, onLeft, onChanged }) => {
  const t = useChatThread(chatId, onRead);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const prevCount = useRef(0);
  const restoreFrom = useRef<number | null>(null);
  const [selected, setSelected] = useState<ChatMessage | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportSent, setReportSent] = useState(false);
  const [readersFor, setReadersFor] = useState<ChatMessage | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ a: ChatAttachment; url: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => { setSelected(null); setEditing(null); setSettingsOpen(false); prevCount.current = 0; }, [chatId]);

  // Håll chatten längst ner när nya meddelanden kommer (om man inte har skrollat upp).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreFrom.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
    } else if (t.messages.length !== prevCount.current && (nearBottom.current || prevCount.current === 0 || t.messages[t.messages.length - 1]?.pending)) {
      el.scrollTop = el.scrollHeight;
    }
    prevCount.current = t.messages.length;
  }, [t.messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const loadOlder = async () => {
    const el = scrollRef.current;
    setLoadingOlder(true);
    try {
      restoreFrom.current = el ? el.scrollHeight - el.scrollTop : null;
      await t.loadOlder();
    } catch { restoreFrom.current = null; } finally { setLoadingOlder(false); }
  };

  const detail = t.detail;
  const others = useMemo(() => (detail?.participants || []).filter((p) => p.userId !== myUserId), [detail, myUserId]);

  // Läst av: vilka (utom avsändaren) som läst till och med ett meddelande.
  const readersOf = useCallback((m: ChatMessage) => {
    const readSeq = new Map(t.reads.map((r) => [r.userId, r.lastReadSeq]));
    return (detail?.participants || []).filter((p) => p.userId !== m.userId && (readSeq.get(p.userId) || 0) >= m.seq);
  }, [t.reads, detail]);

  // Läst-status visas bara under mitt senaste meddelande.
  const lastMineSeq = useMemo(() => {
    for (let i = t.messages.length - 1; i >= 0; i--) {
      const m = t.messages[i];
      if (m.kind === 'text' && !m.pending && !m.deleted) return m.isMine ? m.seq : -1;
    }
    return -1;
  }, [t.messages]);

  const toggleReaction = async (m: ChatMessage, emoji: string) => {
    setActionError(null);
    try {
      const r = await toggleChatReaction(chatId, m.seq, normalizeEmoji(emoji) || emoji);
      t.replace(r.message);
      if (selected?.seq === m.seq) setSelected(r.message);
    } catch (e: any) { setActionError(e?.message || 'Kunde inte reagera.'); }
  };

  const remove = async (m: ChatMessage) => {
    if (!window.confirm(m.isMine ? 'Ta bort meddelandet för alla?' : 'Ta bort meddelandet för alla i laget?')) return;
    try {
      await deleteChatMessage(chatId, m.seq);
      t.replace({ ...m, deleted: true, body: '', attachments: [], reactions: {}, myReactions: [] });
      setSelected(null);
      onChanged();
    } catch (e: any) { setActionError(e?.message || 'Kunde inte ta bort.'); }
  };

  const canEdit = (m: ChatMessage) => m.isMine && m.kind === 'text' && !m.deleted && Date.now() - m.createdAt < CHAT_LIMITS.editMinutes * 60_000;

  if (t.gone) {
    return (
      <div className="flex-1 flex flex-col">
        {onBack && <ThreadHeader onBack={onBack} title="Chatt" />}
        <EmptyState title="Chatten finns inte längre" text="Du är inte med i den här chatten längre." action={onBack && <Button onClick={onBack}>Tillbaka</Button>} />
      </div>
    );
  }

  const subtitle = detail
    ? detail.kind === 'team'
      ? `Lagchatt · ${detail.participants.length} personer`
      : detail.kind === 'group'
        ? `${detail.participants.length} deltagare`
        : 'Tryck för info'
    : '';
  const directOther = detail?.kind === 'direct' ? others[0] : undefined;

  let lastDay = '';
  let prevAuthor: string | null = null;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <ThreadHeader
        onBack={onBack}
        title={detail?.name || ''}
        subtitle={subtitle}
        avatar={detail && <ChatAvatar kind={detail.kind} name={detail.name} photoUrl={directOther?.photoUrl} size={38} />}
        onTitle={detail ? () => setSettingsOpen(true) : undefined}
      />

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-3">
        {t.loading && <p className="text-center text-sm text-zinc-500 py-8"><Loader2 size={18} className="inline animate-spin mr-2" />Hämtar meddelanden…</p>}
        {t.error && <p className="text-center text-sm text-red-600 dark:text-red-400 py-4">{t.error}</p>}
        {t.hasMore && (
          <div className="flex justify-center mb-3">
            <Button variant="secondary" size="sm" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'Hämtar…' : 'Visa äldre meddelanden'}</Button>
          </div>
        )}
        {!t.loading && !t.messages.length && !t.error && (
          <EmptyState title="Inga meddelanden än" text={detail?.kind === 'team' ? 'Skriv något till hela laget.' : 'Skriv det första meddelandet.'} />
        )}
        {t.messages.map((m) => {
          const day = formatDayLabel(m.createdAt);
          const newDay = day !== lastDay;
          lastDay = day;
          const showAuthor = detail?.kind !== 'direct' && m.kind === 'text' && !m.isMine && (newDay || prevAuthor !== m.userId);
          prevAuthor = m.kind === 'text' ? m.userId : null;
          let status: React.ReactNode = null;
          if (m.seq === lastMineSeq && detail) {
            const readers = readersOf(m);
            const total = (detail.participants || []).filter((p) => p.userId !== m.userId).length;
            const label = detail.kind === 'direct'
              ? (readers.length ? 'Läst' : 'Skickat')
              : readers.length === 0 ? 'Ingen har läst än' : readers.length >= total ? 'Läst av alla' : `Läst av ${readers.length}`;
            status = (
              <button type="button" onClick={() => setReadersFor(m)} className="mt-0.5 pr-1 text-[11px] text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1 cursor-pointer hover:underline">
                {readers.length ? <CheckCheck size={13} className="text-indigo-600 dark:text-indigo-300" /> : <Check size={13} />}
                {label}
              </button>
            );
          }
          return (
            <React.Fragment key={m.localId || m.seq}>
              {newDay && (
                <div className="flex justify-center my-3">
                  <span className="px-3 py-1 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{day}</span>
                </div>
              )}
              <Bubble
                m={m}
                showAuthor={showAuthor}
                status={status}
                onOpen={() => { setSelected(m); setShowPicker(false); setActionError(null); }}
                onImage={(a, url) => setLightbox({ a, url })}
                onToggleReaction={(e) => toggleReaction(m, e)}
                onRetry={() => m.localId && t.retry(m.localId)}
                onDiscard={() => m.localId && t.discard(m.localId)}
              />
            </React.Fragment>
          );
        })}
      </div>

      <Composer
        chatId={chatId}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onTyping={t.bump}
        onSend={async (body, atts) => { await t.send(body, atts); onChanged(); }}
        onSaveEdit={async (m, body) => {
          const r = await editChatMessage(chatId, m.seq, body);
          t.replace(r.message);
          setEditing(null);
        }}
      />

      {/* Menyn för ett meddelande */}
      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selected?.isMine ? 'Ditt meddelande' : selected?.authorName}>
        {selected && !selected.deleted && selected.kind === 'text' && (
          <>
            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-3">
              {reactions.map((e) => {
                const on = selected.myReactions.includes(normalizeEmoji(e) || e);
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() => toggleReaction(selected, e)}
                    aria-pressed={on}
                    className={cx('w-11 h-11 rounded-full text-xl inline-flex items-center justify-center border-2 cursor-pointer transition-colors', on ? 'bg-indigo-100 border-indigo-500 dark:bg-indigo-500/30 dark:border-indigo-400' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800')}
                  >
                    {e}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setShowPicker((v) => !v)}
                aria-expanded={showPicker}
                aria-label="Fler reaktioner"
                className={cx('w-11 h-11 rounded-full border-2 inline-flex items-center justify-center cursor-pointer', showPicker ? 'bg-zinc-200 border-zinc-300 dark:bg-zinc-700 dark:border-zinc-600' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800')}
              >
                <SmilePlus size={20} />
              </button>
            </div>
            {showPicker && (
              <div className="px-2 pb-3">
                <EmojiPicker selected={selected.myReactions} onPick={(e) => toggleReaction(selected, e)} onClose={() => setShowPicker(false)} />
              </div>
            )}
            {actionError && <p className="px-3 pb-2 text-sm text-red-600 dark:text-red-400">{actionError}</p>}
            <div className="flex flex-col gap-0.5">
              {selected.body && (
                <MenuItem icon={<Copy size={18} />} label="Kopiera text" onClick={() => { navigator.clipboard?.writeText(selected.body).catch(() => {}); setSelected(null); }} />
              )}
              {selected.isMine && (
                <MenuItem icon={<CheckCheck size={18} />} label="Läst av" onClick={() => { setReadersFor(selected); setSelected(null); }} />
              )}
              {canEdit(selected) && (
                <MenuItem icon={<Pencil size={18} />} label="Ändra" description={`Går de första ${CHAT_LIMITS.editMinutes} minuterna`} onClick={() => { setEditing(selected); setSelected(null); }} />
              )}
              {(selected.isMine || detail?.canModerate) && (
                <MenuItem icon={<Trash2 size={18} />} label="Ta bort för alla" tone="danger" onClick={() => remove(selected)} />
              )}
              {!selected.isMine && (
                <MenuItem
                  icon={<Flag size={18} />}
                  label="Anmäl meddelandet"
                  description="Föreningens tränare och admin får se just det här meddelandet"
                  tone="danger"
                  onClick={() => { setReporting(selected); setReportReason(''); setReportSent(false); setSelected(null); }}
                />
              )}
            </div>
          </>
        )}
        {selected?.deleted && <p className="px-3 py-4 text-sm text-zinc-500">Meddelandet är borttaget.</p>}
      </Sheet>

      {/* Läst av */}
      <Sheet open={!!readersFor} onClose={() => setReadersFor(null)} title="Läst av">
        {readersFor && detail && (() => {
          const readers = readersOf(readersFor);
          const notYet = (detail.participants || []).filter((p) => p.userId !== readersFor.userId && !readers.some((r) => r.userId === p.userId) && p.userId !== myUserId);
          return (
            <div className="px-2 pb-2">
              <div className="px-1 pb-1 text-xs font-semibold text-zinc-500">Har läst ({readers.length})</div>
              {readers.length ? readers.map((p) => (
                <div key={p.userId} className="flex items-center gap-3 px-1 py-1.5"><Avatar name={p.name} photoUrl={p.photoUrl} size={32} /><span className="text-sm font-semibold">{p.name}</span></div>
              )) : <p className="px-1 py-2 text-sm text-zinc-500">Ingen än.</p>}
              {notYet.length > 0 && (
                <>
                  <div className="px-1 pt-3 pb-1 text-xs font-semibold text-zinc-500">Inte läst än ({notYet.length})</div>
                  {notYet.map((p) => (
                    <div key={p.userId} className="flex items-center gap-3 px-1 py-1.5 opacity-70"><Avatar name={p.name} photoUrl={p.photoUrl} size={32} /><span className="text-sm">{p.name}</span></div>
                  ))}
                </>
              )}
            </div>
          );
        })()}
      </Sheet>

      {/* Anmäl */}
      <Sheet
        open={!!reporting}
        onClose={() => setReporting(null)}
        title="Anmäl meddelandet"
        footer={!reportSent && (
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setReporting(null)}>Avbryt</Button>
            <Button
              variant="danger"
              icon={<Flag size={16} />}
              onClick={async () => {
                if (!reporting) return;
                try { await reportChatMessage(chatId, reporting.seq, reportReason); setReportSent(true); } catch (e: any) { alert(e?.message || 'Kunde inte anmäla.'); }
              }}
            >
              Anmäl
            </Button>
          </div>
        )}
      >
        {reporting && (reportSent ? (
          <div className="px-3 py-4">
            <p className="text-sm font-semibold">Tack, anmälan är skickad.</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Tränare eller admin tittar på meddelandet och kan ta bort det.</p>
            <div className="mt-4 flex justify-end"><Button onClick={() => setReporting(null)}>Klar</Button></div>
          </div>
        ) : (
          <div className="px-3 pb-2">
            <div className="rounded-xl bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-sm whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
              <span className="font-semibold">{reporting.authorName}: </span>{reporting.body || '(bild eller fil)'}
            </div>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
              Föreningens admin och tränare i avsändarens lag får se just det här meddelandet (och de två före och efter), inte resten av chatten.
            </p>
            <label className="block mt-3 text-sm font-semibold" htmlFor="chat-report-reason">Varför? (frivilligt)</label>
            <TextArea
              id="chat-report-reason"
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1 w-full rounded-xl bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
            />
          </div>
        ))}
      </Sheet>

      {detail && (
        <ChatSettingsSheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          clubId={clubId}
          myUserId={myUserId}
          detail={detail}
          onDetail={(d) => { t.setDetail(d); t.poll(); onChanged(); }}
          onLeft={() => { setSettingsOpen(false); onLeft(); }}
        />
      )}

      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
};

const ThreadHeader: React.FC<{ onBack?: () => void; title: string; subtitle?: string; avatar?: React.ReactNode; onTitle?: () => void }> = ({ onBack, title, subtitle, avatar, onTitle }) => (
  <header className="shrink-0 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800 pt-safe z-10">
    <div className="h-14 sm:h-16 px-2 sm:px-4 flex items-center gap-2">
      {onBack && (
        <IconButton label="Tillbaka till chattarna" onClick={onBack}>
          <ArrowLeft size={22} />
        </IconButton>
      )}
      <button
        type="button"
        onClick={onTitle}
        disabled={!onTitle}
        className="min-w-0 flex-1 flex items-center gap-2.5 text-left rounded-xl p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
      >
        {avatar}
        <span className="min-w-0">
          <span className="block text-base font-bold truncate">{title}</span>
          {subtitle && <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate">{subtitle}</span>}
        </span>
      </button>
    </div>
  </header>
);
