/**
 * Mobilens "Mer": allt som inte ligger i bottenmenyn, kontoinställningarna och valet av
 * vilka knappar som ska ligga i bottenmenyn (sparas i profilen, följer kontot).
 */
import React, { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, Building2, ChevronRight, LogOut, Moon, Plus, RefreshCw, RotateCcw, SlidersHorizontal, Sun, Users,
  VibrateOff, X,
} from 'lucide-react';
import { Avatar, Button, IconButton, MenuItem, Sheet } from '../ui';
import type { NavItem, ShellView } from './AppShell';

/** Antal knappar man väljer själv (Översikt ligger alltid först och Mer sist). */
export const MOBILE_SLOTS = 3;

export const defaultMobileNav = (isCoachOrAdmin: boolean): ShellView[] =>
  isCoachOrAdmin ? ['training', 'lineup', 'chat'] : ['training', 'chat', 'leaderboard'];

// Vilka knappar som ska visas: det sparade valet (det som fortfarande är tillåtet) eller standardvalet.
// Faller något bort (t.ex. Uppställning som inte längre visas för spelare) fylls platsen från standardvalet.
export function resolveMobileNav(saved: string[] | undefined, allowed: ShellView[], isCoachOrAdmin: boolean): ShellView[] {
  const ok = (id: string): id is ShellView => (allowed as string[]).includes(id) && id !== 'home';
  const defaults = defaultMobileNav(isCoachOrAdmin).filter(ok);
  if (!Array.isArray(saved)) return defaults.slice(0, MOBILE_SLOTS);
  const out = Array.from(new Set(saved.filter(ok))).slice(0, MOBILE_SLOTS);
  const wanted = Math.min(saved.length, MOBILE_SLOTS);
  for (const id of [...defaults, ...allowed.filter(ok)]) {
    if (out.length >= wanted) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

const Tile: React.FC<{ item: NavItem; active: boolean; onClick: () => void }> = ({ item, active, onClick }) => {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-1.5 h-[84px] rounded-2xl border cursor-pointer transition-colors ${
        active
          ? 'bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950/50 dark:border-indigo-700 dark:text-indigo-200'
          : 'bg-zinc-50 border-zinc-200/80 text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-800/60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'
      }`}
    >
      <Icon size={24} />
      <span className="text-xs font-semibold text-center leading-tight px-1">{item.label}</span>
      {item.badge ? (
        <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center">{item.badge}</span>
      ) : null}
    </button>
  );
};

export const MoreSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  view: ShellView;
  items: NavItem[];
  account: { name: string; email: string; photoUrl?: string | null; roleLabel?: string } | null;
  clubName?: string;
  teamName?: string;
  isCoachOrAdmin: boolean;
  pendingRequests: number;
  theme: 'light' | 'dark';
  onNavigate: (v: ShellView) => void;
  onCustomize: () => void;
  onToggleTheme: () => void;
  onRefresh: () => void;
  onOpenShakeInfo: () => void;
  onOpenPendingRequests: () => void;
  onLogout: () => void;
}> = (p) => {
  const go = (v: ShellView) => { p.onClose(); p.onNavigate(v); };
  return (
    <Sheet open={p.open} onClose={p.onClose} title="Mer">
      {p.account && (
        <button
          type="button"
          onClick={() => go('profile')}
          className="w-full flex items-center gap-3 px-3 pt-1 pb-3 rounded-xl text-left cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <Avatar name={p.account.name} photoUrl={p.account.photoUrl} size={48} />
          <span className="flex-1 min-w-0">
            <span className="block font-bold truncate">{p.account.name}</span>
            <span className="block text-sm text-zinc-500 dark:text-zinc-400 truncate">
              {[p.account.roleLabel, p.teamName].filter(Boolean).join(' · ') || p.account.email}
            </span>
          </span>
          <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">Min profil</span>
          <ChevronRight size={18} className="text-zinc-400" />
        </button>
      )}

      {p.items.length > 0 && (
        <div className="grid grid-cols-3 gap-2 px-1 pb-2">
          {p.items.map((item) => <Tile key={item.id} item={item} active={p.view === item.id} onClick={() => go(item.id)} />)}
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        <MenuItem
          icon={<SlidersHorizontal size={18} />}
          label="Anpassa menyn"
          description="Välj vilka knappar som ligger längst ner"
          onClick={() => { p.onClose(); p.onCustomize(); }}
          trailing={<ChevronRight size={18} className="text-zinc-400" />}
        />
        {p.pendingRequests > 0 && p.isCoachOrAdmin && (
          <MenuItem
            icon={<Users size={18} />}
            label={p.pendingRequests === 1 ? '1 ansökan väntar' : `${p.pendingRequests} ansökningar väntar`}
            description="Granska nya medlemmar"
            onClick={() => { p.onClose(); p.onOpenPendingRequests(); }}
          />
        )}
        {(p.clubName || p.teamName) && (
          <MenuItem
            icon={<Building2 size={18} />}
            label={p.teamName || 'Lag'}
            description={p.isCoachOrAdmin ? `${p.clubName || ''} · Byt eller hantera lag` : p.clubName}
            onClick={() => go(p.isCoachOrAdmin ? 'clubadmin' : 'profile')}
            trailing={<ChevronRight size={18} className="text-zinc-400" />}
          />
        )}
        <div className="my-2 border-t border-zinc-100 dark:border-zinc-800" />
        <MenuItem
          icon={p.theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          label={p.theme === 'light' ? 'Mörkt läge' : 'Ljust läge'}
          onClick={p.onToggleTheme}
        />
        <MenuItem icon={<RefreshCw size={18} />} label="Hämta senaste" description="Läs in lagets data på nytt" onClick={() => { p.onClose(); p.onRefresh(); }} />
        <MenuItem icon={<VibrateOff size={18} />} label="Skakskydd (iPhone)" description="Undvik att iOS frågar om att ångra" onClick={() => { p.onClose(); p.onOpenShakeInfo(); }} />
        <div className="my-2 border-t border-zinc-100 dark:border-zinc-800" />
        <MenuItem icon={<LogOut size={18} />} label="Logga ut" tone="danger" onClick={() => { p.onClose(); p.onLogout(); }} />
      </div>
    </Sheet>
  );
};

export const CustomizeNavSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  current: ShellView[];
  /** Alla funktioner man kan välja (utom Översikt). */
  choices: NavItem[];
  defaults: ShellView[];
  onSave: (ids: ShellView[]) => void;
}> = ({ open, onClose, current, choices, defaults, onSave }) => {
  const [draft, setDraft] = useState<ShellView[]>(current);
  useEffect(() => { if (open) setDraft(current); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = new Map(choices.map((c) => [c.id, c]));
  const move = (i: number, d: number) => setDraft((x) => {
    const n = [...x];
    const j = i + d;
    if (j < 0 || j >= n.length) return x;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const full = draft.length >= MOBILE_SLOTS;
  const rest = choices.filter((c) => !draft.includes(c.id));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Anpassa menyn"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" icon={<RotateCcw size={16} />} onClick={() => setDraft(defaults)}>Återställ</Button>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Avbryt</Button>
          <Button onClick={() => { onSave(draft); onClose(); }}>Spara</Button>
        </div>
      }
    >
      <div className="px-2 pb-2">
        <p className="px-1 pb-3 text-sm text-zinc-600 dark:text-zinc-300">
          Översikt ligger alltid först och Mer sist. Välj upp till {MOBILE_SLOTS} knappar däremellan. Allt annat finns under Mer.
        </p>

        <div className="px-1 pb-1 text-xs font-semibold text-zinc-500">I menyn</div>
        <div className="flex flex-col gap-1 pb-3">
          {draft.map((id, i) => {
            const item = byId.get(id);
            if (!item) return null;
            const Icon = item.icon;
            return (
              <div key={id} className="flex items-center gap-2 pl-3 pr-1 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40">
                <span className="w-6 text-xs font-bold text-indigo-600 dark:text-indigo-300 tabular-nums">{i + 2}</span>
                <Icon size={20} className="text-indigo-700 dark:text-indigo-200" />
                <span className="flex-1 min-w-0 text-sm font-semibold truncate">{item.label}</span>
                <IconButton label="Flytta tidigare i menyn" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={18} /></IconButton>
                <IconButton label="Flytta senare i menyn" onClick={() => move(i, 1)} disabled={i === draft.length - 1}><ArrowDown size={18} /></IconButton>
                <IconButton label={`Ta bort ${item.label} ur menyn`} onClick={() => setDraft((x) => x.filter((y) => y !== id))}><X size={18} /></IconButton>
              </div>
            );
          })}
          {!draft.length && <p className="px-3 py-2 text-sm text-zinc-500">Inga valda. Bara Översikt och Mer visas.</p>}
        </div>

        <div className="px-1 pb-1 text-xs font-semibold text-zinc-500">
          Under Mer {full && <span className="font-normal">– ta bort en ovan för att lägga till</span>}
        </div>
        <div className="flex flex-col gap-1">
          {rest.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.id} className="flex items-center gap-3 pl-3 pr-1 py-1.5 rounded-xl">
                <Icon size={20} className="text-zinc-500 dark:text-zinc-400" />
                <span className="flex-1 min-w-0 text-sm font-semibold truncate">{item.label}</span>
                <Button size="sm" variant="secondary" icon={<Plus size={16} />} disabled={full} onClick={() => setDraft((x) => [...x, item.id])}>
                  Lägg till
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
};
