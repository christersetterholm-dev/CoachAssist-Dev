// Menyvalet Chatt: chattlistan och den öppna chatten.
// Mobil: listan, och en öppen chatt täcker hela skärmen (utan bottenmeny).
// Från 768 px: listan till vänster och chatten till höger.
import React, { useEffect, useMemo, useState } from 'react';
import { Check, Flag, MessageCircle, Plus, Search, Trash2 } from 'lucide-react';
import { Button, EmptyState, Sheet, TextInput } from '../ui';
import { ChatAvatar, ChatThread } from './ChatThread';
import { ChatPeoplePicker } from './ChatPeoplePicker';
import {
  CHAT_LIMITS, formatChatTime, formatListTime, handleChatReport, listChatReports, startChat, useChatList,
  type ChatReport, type ChatSummaryState,
} from '../../lib/chat';

const cx = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join(' ');

function useIsWide() {
  const q = '(min-width: 768px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

export const ChatView: React.FC<{
  clubId: string;
  myUserId: string;
  summary: ChatSummaryState;
  openChatId: string | null;
  onOpenChat: (id: string | null) => void;
}> = ({ clubId, myUserId, summary, openChatId, onOpenChat }) => {
  const list = useChatList(clubId, true);
  const wide = useIsWide();
  const [query, setQuery] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);

  // Märket i menyn och listan hålls i takt.
  const refreshAll = () => { list.reload(); summary.refresh(); };

  // Olästa från märkesfrågan (var 30:e s) gör att listan hämtas om.
  const unreadKey = JSON.stringify(summary.unread);
  useEffect(() => { list.reload(); }, [unreadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // På stor skärm öppnas den första chatten direkt.
  useEffect(() => {
    if (wide && !openChatId && list.conversations.length) onOpenChat(list.conversations[0].id);
  }, [wide, openChatId, list.conversations, onOpenChat]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.conversations.filter((c) => c.name.toLowerCase().includes(q)) : list.conversations;
  }, [list.conversations, query]);

  const openReports = Math.max(list.openReports, summary.openReports);

  const listPane = (
    <div className={cx('flex flex-col min-h-0', wide ? 'w-80 lg:w-96 shrink-0 border-r border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900' : 'flex-1')}>
      <div className="shrink-0 p-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <TextInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök chatt"
            aria-label="Sök chatt"
            className="w-full h-11 pl-10 pr-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-base text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
          />
        </div>
        <Button icon={<Plus size={18} />} onClick={() => setNewOpen(true)} className="shrink-0">Ny chatt</Button>
      </div>

      {openReports > 0 && (
        <button
          type="button"
          onClick={() => setReportsOpen(true)}
          className="mx-3 mb-2 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 text-sm font-semibold text-left cursor-pointer"
        >
          <Flag size={16} />
          <span className="flex-1">{openReports === 1 ? '1 anmält meddelande' : `${openReports} anmälda meddelanden`} att titta på</span>
        </button>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
        {list.loading && !list.conversations.length && <p className="px-3 py-6 text-sm text-zinc-500">Hämtar chattar…</p>}
        {list.error && <p className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{list.error}</p>}
        {!list.loading && !list.error && !list.conversations.length && (
          <EmptyState
            icon={<MessageCircle size={26} />}
            title="Inga chattar än"
            text="Starta en chatt med en person eller skapa en grupp."
            action={<Button icon={<Plus size={18} />} onClick={() => setNewOpen(true)}>Ny chatt</Button>}
          />
        )}
        {filtered.map((c) => {
          const active = c.id === openChatId && wide;
          const last = c.lastMessage;
          const prefix = last && last.kind === 'text' ? (last.isMine ? 'Du: ' : c.kind !== 'direct' ? `${last.authorName.split(' ')[0]}: ` : '') : '';
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpenChat(c.id)}
              aria-current={active ? 'true' : undefined}
              className={cx('w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left cursor-pointer transition-colors', active ? 'bg-indigo-50 dark:bg-indigo-950/50' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800')}
            >
              <ChatAvatar kind={c.kind} name={c.name} photoUrl={c.photoUrl} size={46} />
              <span className="flex-1 min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className={cx('flex-1 truncate text-[15px]', c.unread ? 'font-bold' : 'font-semibold')}>{c.name}</span>
                  {last && <span className={cx('shrink-0 text-xs', c.unread ? 'text-indigo-600 dark:text-indigo-300 font-semibold' : 'text-zinc-400')}>{formatListTime(last.createdAt)}</span>}
                </span>
                <span className="flex items-center gap-2 mt-0.5">
                  <span className={cx('flex-1 truncate text-sm', c.unread ? 'text-zinc-800 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400')}>
                    {last ? `${prefix}${last.text}` : c.kind === 'team' ? 'Lagets chatt – skriv till alla i laget' : 'Inga meddelanden än'}
                  </span>
                  {c.unread > 0 && (
                    <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-indigo-600 text-white text-xs font-bold leading-[22px] text-center">{c.unread > 99 ? '99+' : c.unread}</span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const thread = openChatId && (
    <ChatThread
      key={openChatId}
      chatId={openChatId}
      clubId={clubId}
      myUserId={myUserId}
      reactions={list.reactions}
      onBack={wide ? undefined : () => onOpenChat(null)}
      onRead={refreshAll}
      onChanged={list.reload}
      onLeft={() => { onOpenChat(null); refreshAll(); }}
    />
  );

  return (
    <div className="flex-1 min-h-0 flex">
      {listPane}
      {wide ? (
        <div className="flex-1 min-w-0 flex flex-col">
          {thread || <EmptyState icon={<MessageCircle size={26} />} title="Välj en chatt" text="Eller starta en ny med knappen Ny chatt." className="flex-1" />}
        </div>
      ) : (
        thread && <div data-keep-bars className="fixed inset-0 z-[60] flex flex-col bg-zinc-50 dark:bg-zinc-950">{thread}</div>
      )}

      <NewChatSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        clubId={clubId}
        onStarted={(id) => { setNewOpen(false); list.reload(); onOpenChat(id); }}
      />
      <ReportsSheet open={reportsOpen} onClose={() => setReportsOpen(false)} clubId={clubId} onHandled={refreshAll} />
    </div>
  );
};

// --- Ny chatt ---

const NewChatSheet: React.FC<{ open: boolean; onClose: () => void; clubId: string; onStarted: (id: string) => void }> = ({ open, onClose, clubId, onStarted }) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setSelected([]); setName(''); setError(null); } }, [open]);

  const isGroup = selected.length > 1;
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await startChat(clubId, selected, isGroup ? name.trim() : undefined);
      onStarted(r.conversation.id);
    } catch (e: any) {
      setError(e?.message || 'Kunde inte starta chatten.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ny chatt"
      footer={
        <div>
          {isGroup && (
            <div className="mb-3">
              <label htmlFor="chat-new-name" className="block text-sm font-semibold mb-1">Gruppens namn (frivilligt)</label>
              <TextInput
                id="chat-new-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={CHAT_LIMITS.name}
                placeholder="T.ex. Målvakterna"
                className="w-full h-11 rounded-xl bg-zinc-100 dark:bg-zinc-800 px-3 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
              />
            </div>
          )}
          {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm text-zinc-500">
              {selected.length === 0 ? 'Välj en eller flera' : selected.length === 1 ? 'En person: en-till-en-chatt' : `${selected.length} personer: gruppchatt`}
            </span>
            <Button disabled={!selected.length || busy} onClick={start}>{isGroup ? 'Skapa grupp' : 'Starta chatt'}</Button>
          </div>
        </div>
      }
    >
      {open && <ChatPeoplePicker clubId={clubId} selected={selected} onChange={setSelected} />}
    </Sheet>
  );
};

// --- Anmälda meddelanden (tränare och admin) ---

const ReportsSheet: React.FC<{ open: boolean; onClose: () => void; clubId: string; onHandled: () => void }> = ({ open, onClose, clubId, onHandled }) => {
  const [reports, setReports] = useState<ChatReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => listChatReports(clubId).then((r) => setReports(r.reports)).catch((e) => setError(e?.message || 'Kunde inte hämta anmälningarna.'));
  useEffect(() => { if (open) { setReports(null); setError(null); load(); } }, [open, clubId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handle = async (r: ChatReport, action: 'remove' | 'keep') => {
    if (action === 'remove' && !window.confirm('Ta bort meddelandet för alla i chatten?')) return;
    try {
      await handleChatReport(clubId, r.id, action);
      setReports((list) => (list || []).filter((x) => x.id !== r.id));
      onHandled();
    } catch (e: any) { setError(e?.message || 'Något gick fel.'); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Anmälda meddelanden">
      <div className="px-2 pb-2">
        <p className="px-1 pb-3 text-sm text-zinc-600 dark:text-zinc-300">
          Du ser bara det anmälda meddelandet och de närmaste runt det, inte resten av chatten.
        </p>
        {error && <p className="px-1 pb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!reports && !error && <p className="px-1 py-3 text-sm text-zinc-500">Hämtar…</p>}
        {reports && !reports.length && <p className="px-1 py-3 text-sm text-zinc-500">Inga anmälningar att titta på.</p>}
        {reports?.map((r) => (
          <div key={r.id} className="mb-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-3">
            <div className="text-xs text-zinc-500">
              {r.conversationName} · anmält av {r.reporterName}{r.otherReports ? ` och ${r.otherReports} till` : ''} · {formatListTime(r.createdAt)}
            </div>
            {r.reason && <p className="mt-1 text-sm"><span className="font-semibold">Anledning:</span> {r.reason}</p>}
            <div className="mt-2 flex flex-col gap-1">
              {r.context.map((m) => (
                <div
                  key={m.seq}
                  className={cx('rounded-xl px-3 py-1.5 text-sm', m.seq === r.message.seq ? 'bg-amber-50 border border-amber-300 dark:bg-amber-950/40 dark:border-amber-700' : 'bg-zinc-100 dark:bg-zinc-800 opacity-70')}
                >
                  <span className="font-semibold">{m.authorName}</span>
                  <span className="text-xs text-zinc-500"> · {formatChatTime(m.createdAt)}</span>
                  <div className="whitespace-pre-wrap break-words">{m.deleted ? <em>Borttaget</em> : m.body || (m.attachments.length ? `(${m.attachments.length} bild/fil)` : '')}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2 justify-end">
              <Button size="sm" variant="secondary" icon={<Check size={16} />} onClick={() => handle(r, 'keep')}>Behåll</Button>
              <Button size="sm" variant="danger" icon={<Trash2 size={16} />} onClick={() => handle(r, 'remove')}>Ta bort meddelandet</Button>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
};

export default ChatView;
