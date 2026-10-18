/**
 * Emojiväljare för reaktioner (plusknappen under ett inlägg), i stil med WhatsApp:
 * sökfält, senast använda och alla emojis i kategorier med flikar längst ned.
 * Namn och sökord är på svenska (emojibase-data). Datat laddas först när väljaren öppnas.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Car, Clock, Coffee, Flag, Hash, Lightbulb, PawPrint, Search, Smile, Volleyball, X } from 'lucide-react';
import { normalizeEmoji } from '../lib/posts';

interface EmojiItem { e: string; label: string; tags: string[] }
interface Section { id: string; title: string; icon: React.ReactNode; items: EmojiItem[] }

// Kategorier (emojibase-gruppnummer). Grupp 2 (hudtoner m.m.) visas inte.
const CATEGORIES: { id: string; title: string; icon: React.ReactNode; groups: number[] }[] = [
  { id: 'smileys', title: 'Smileys och personer', icon: <Smile size={18} />, groups: [0, 1] },
  { id: 'animals', title: 'Djur och natur', icon: <PawPrint size={18} />, groups: [3] },
  { id: 'food', title: 'Mat och dryck', icon: <Coffee size={18} />, groups: [4] },
  { id: 'activities', title: 'Aktiviteter', icon: <Volleyball size={18} />, groups: [6] },
  { id: 'travel', title: 'Resor och platser', icon: <Car size={18} />, groups: [5] },
  { id: 'objects', title: 'Objekt', icon: <Lightbulb size={18} />, groups: [7] },
  { id: 'symbols', title: 'Symboler', icon: <Hash size={18} />, groups: [8] },
  { id: 'flags', title: 'Flaggor', icon: <Flag size={18} />, groups: [9] },
];

let cache: Promise<{ group: number; item: EmojiItem }[]> | null = null;
const loadEmojis = () => {
  if (!cache) {
    cache = import('emojibase-data/sv/compact.json').then((m: any) => {
      const data: any[] = m.default || m;
      return data
        .filter(d => typeof d.group === 'number' && d.group !== 2)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(d => ({
          group: d.group as number,
          item: { e: normalizeEmoji(d.unicode) || d.unicode, label: String(d.label || ''), tags: Array.isArray(d.tags) ? d.tags : [] },
        }));
    });
    cache.catch(() => { cache = null; });
  }
  return cache;
};

// Senast använda reaktioner sparas bara i den här webbläsaren.
const RECENT_KEY = 'coachassist.senasteReaktioner';
const readRecent = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 24) : []; } catch { return []; }
};
const rememberRecent = (e: string) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...readRecent().filter(x => x !== e)].slice(0, 24))); } catch { /* privat läge m.m. */ }
};

export const EmojiPicker: React.FC<{
  selected: string[];
  onPick: (emoji: string) => void;
  onClose: () => void;
}> = ({ selected, onPick, onClose }) => {
  const [all, setAll] = useState<{ group: number; item: EmojiItem }[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('recent');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const recent = useMemo(readRecent, []);

  useEffect(() => {
    let alive = true;
    loadEmojis().then(d => alive && setAll(d)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  const byEmoji = useMemo(() => new Map((all || []).map(x => [x.item.e, x.item])), [all]);

  const sections: Section[] = useMemo(() => {
    if (!all) return [];
    const out: Section[] = [];
    if (recent.length) {
      out.push({ id: 'recent', title: 'Senaste reaktioner', icon: <Clock size={18} />, items: recent.map(e => byEmoji.get(e) || { e, label: e, tags: [] }) });
    }
    for (const c of CATEGORIES) out.push({ id: c.id, title: c.title, icon: c.icon, items: all.filter(x => c.groups.includes(x.group)).map(x => x.item) });
    return out;
  }, [all, recent, byEmoji]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !all) return null;
    const starts: EmojiItem[] = [];
    const other: EmojiItem[] = [];
    for (const { item } of all) {
      const label = item.label.toLowerCase();
      if (label.startsWith(q) || label.includes(` ${q}`)) starts.push(item);
      else if (label.includes(q) || item.tags.some(t => t.toLowerCase().startsWith(q))) other.push(item);
    }
    return [...starts, ...other].slice(0, 120);
  }, [query, all]);

  // Fliken längst ned följer med när man skrollar.
  const onScroll = () => {
    const top = scrollRef.current?.scrollTop || 0;
    let current = sections[0]?.id;
    for (const s of sections) {
      const el = sectionRefs.current[s.id];
      if (el && el.offsetTop - 8 <= top) current = s.id;
    }
    if (current && current !== activeTab) setActiveTab(current);
  };

  const jump = (id: string) => {
    setQuery('');
    setActiveTab(id);
    requestAnimationFrame(() => {
      const el = sectionRefs.current[id];
      if (el && scrollRef.current) scrollRef.current.scrollTop = el.offsetTop;
    });
  };

  const pick = (e: string) => {
    rememberRecent(e);
    onPick(e);
    onClose();
  };

  const grid = (items: EmojiItem[]) => (
    <div className="grid grid-cols-8 gap-0.5">
      {items.map(it => (
        <button
          key={it.e}
          type="button"
          onClick={() => pick(it.e)}
          title={it.label}
          aria-label={it.label}
          aria-pressed={selected.includes(it.e)}
          className={`aspect-square rounded-xl text-2xl leading-none flex items-center justify-center cursor-pointer transition-transform hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 ${
            selected.includes(it.e) ? 'bg-indigo-100 dark:bg-indigo-500/30 ring-2 ring-indigo-500 dark:ring-indigo-400' : ''
          }`}
        >
          {it.e}
        </button>
      ))}
    </div>
  );

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
      <div className="p-2 border-b border-zinc-100 dark:border-zinc-800">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input
            autoFocus
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); query ? setQuery('') : onClose(); } }}
            placeholder="Sök, t.ex. boll, glad, tumme"
            aria-label="Sök emoji"
            className="w-full h-11 pl-10 pr-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-base text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 [&::-webkit-search-cancel-button]:hidden"
          />
          <button type="button" onClick={() => (query ? setQuery('') : onClose())} aria-label={query ? 'Rensa sökningen' : 'Stäng'} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-zinc-300/70 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-200 flex items-center justify-center cursor-pointer">
            <X size={14} strokeWidth={2.6} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="relative h-64 overflow-y-auto px-2 pb-2">
        {failed ? (
          <p className="p-4 text-sm text-red-600 dark:text-red-400">Emojis kunde inte laddas. Kontrollera anslutningen och försök igen.</p>
        ) : !all ? (
          <p className="p-4 text-sm text-zinc-500">Hämtar emojis…</p>
        ) : results ? (
          results.length ? (
            <div className="pt-2">{grid(results)}</div>
          ) : (
            <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">Ingen emoji matchar "{query}".</p>
          )
        ) : (
          sections.map(s => (
            <div key={s.id} ref={el => { sectionRefs.current[s.id] = el; }}>
              <div className="sticky top-0 z-[1] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm pt-2.5 pb-1.5 px-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{s.title}</div>
              {grid(s.items)}
            </div>
          ))
        )}
      </div>

      {!results && all && (
        <div className="flex items-center justify-around border-t border-zinc-100 dark:border-zinc-800 px-1 py-1">
          {sections.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => jump(s.id)}
              title={s.title}
              aria-label={s.title}
              aria-current={activeTab === s.id ? 'true' : undefined}
              className={`w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-colors ${
                activeTab === s.id ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {s.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default EmojiPicker;
