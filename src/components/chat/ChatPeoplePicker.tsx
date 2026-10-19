// Välj personer i föreningen (för ny chatt och för att lägga till i en grupp).
// Personerna visas per lag, med de egna lagen först.
import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Avatar, TextInput } from '../ui';
import { listChatPeople, type ChatPerson } from '../../lib/chat';

export function useChatPeople(clubId: string, enabled = true) {
  const [data, setData] = useState<{ people: ChatPerson[]; teams: { id: string; name: string }[]; myTeams: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setError(null);
    listChatPeople(clubId).then((r) => alive && setData(r)).catch((e) => alive && setError(e?.message || 'Kunde inte hämta personerna.'));
    return () => { alive = false; };
  }, [clubId, enabled]);
  return { data, error };
}

export const ChatPeoplePicker: React.FC<{
  clubId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Personer som redan är med (visas inte). */
  exclude?: string[];
}> = ({ clubId, selected, onChange, exclude = [] }) => {
  const { data, error } = useChatPeople(clubId);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const people = data.people.filter((p) => !exclude.includes(p.userId) && (!q || p.name.toLowerCase().includes(q)));
    const teamOrder = [
      ...data.myTeams.map((id) => data.teams.find((t) => t.id === id) || { id, name: id }),
      ...data.teams.filter((t) => !data.myTeams.includes(t.id)),
    ];
    const shown = new Set<string>();
    const out: { id: string; name: string; people: ChatPerson[] }[] = [];
    for (const t of teamOrder) {
      const list = people.filter((p) => p.teams.includes(t.id) && !shown.has(p.userId));
      list.forEach((p) => shown.add(p.userId));
      if (list.length) out.push({ id: t.id, name: t.name, people: list });
    }
    const rest = people.filter((p) => !shown.has(p.userId));
    if (rest.length) out.push({ id: '_none', name: 'Övriga i föreningen', people: rest });
    return out;
  }, [data, query, exclude]);

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (error) return <p className="px-3 py-4 text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <p className="px-3 py-4 text-sm text-zinc-500">Hämtar personer…</p>;

  return (
    <div>
      <div className="relative px-2 pb-2">
        <Search size={18} className="absolute left-5 top-[22px] -translate-y-1/2 text-zinc-400 pointer-events-none" />
        <TextInput
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sök namn"
          aria-label="Sök namn"
          className="w-full h-11 pl-10 pr-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-base text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
        />
      </div>
      {!groups.length && (
        <p className="px-3 py-4 text-sm text-zinc-500 dark:text-zinc-400">
          {query ? `Ingen heter "${query}".` : 'Det finns ingen annan i föreningen som har konto ännu. Bjud in spelarna från Truppen.'}
        </p>
      )}
      {groups.map((g) => (
        <div key={g.id} className="mb-2">
          <div className="px-3 pt-2 pb-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{g.name}</div>
          {g.people.map((p) => {
            const on = selected.includes(p.userId);
            return (
              <button
                key={p.userId}
                type="button"
                onClick={() => toggle(p.userId)}
                aria-pressed={on}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left cursor-pointer transition-colors ${on ? 'bg-indigo-50 dark:bg-indigo-950/50' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
              >
                <Avatar name={p.name} photoUrl={p.photoUrl} size={36} />
                <span className="flex-1 min-w-0 text-sm font-semibold truncate">{p.name}</span>
                <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-zinc-300 dark:border-zinc-600'}`}>
                  {on && <Check size={14} strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};
