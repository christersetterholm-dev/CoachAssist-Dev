/**
 * Appens skal: sidomeny (iPad/dator), bottenmeny (mobil), toppfält och kontomeny.
 * Alla huvudvyer visas inuti skalet så att navigering och rubriker ser likadana ut överallt.
 */
import React from 'react';
import {
  Bell,
  House, Calendar, Users, Shirt, Trophy, Globe, ShieldCheck, User as UserIcon, Sun, Moon,
  RefreshCw, LogOut, Building2, ChevronRight, Cloud, CloudOff, Loader2, VibrateOff, Minimize2, Presentation, Megaphone, MessageCircle,
  LayoutGrid, Library,
} from 'lucide-react';
import { Avatar, MenuItem, Sheet } from '../ui';
import { CustomizeNavSheet, MoreSheet, defaultMobileNav, resolveMobileNav } from './MoreSheet';

export type ShellView = 'home' | 'training' | 'squad' | 'exercisebank' | 'lineup' | 'tacticalboards' | 'posts' | 'chat' | 'leaderboard' | 'teampage' | 'clubadmin' | 'profile';

export interface NavItem {
  id: ShellView;
  label: string;
  shortLabel?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  badge?: number;
}

export const buildNavItems = (opts: { canViewLineup: boolean; unreadPosts?: number; unreadChats?: number; canManageExercises?: boolean }): { primary: NavItem[]; secondary: NavItem[] } => {
  // Ordningen i sidomenyn (och i Mer på mobil): Översikt, Kalender, Chatt, Inlägg, Uppställning,
  // Taktiktavla, Poängliga, Truppen, Övningsbanken.
  const primary: NavItem[] = [
    { id: 'home', label: 'Översikt', icon: House },
    { id: 'training', label: 'Kalender', icon: Calendar },
    // Chatt med lag, grupper och enskilda i föreningen. Märket = antal chattar med olästa.
    { id: 'chat', label: 'Chatt', icon: MessageCircle, badge: opts.unreadChats || undefined },
    // Inlägg från tränarna. På mobil visas märket på Översikt (där inläggen också syns).
    { id: 'posts', label: 'Inlägg', icon: Megaphone, badge: opts.unreadPosts || undefined },
  ];
  if (opts.canViewLineup) primary.push({ id: 'lineup', label: 'Uppställning', shortLabel: 'Uppställn.', icon: Shirt });
  // Lagets taktiktavlor: alla i laget (spelare ser de tavlor som tränaren har delat).
  primary.push({ id: 'tacticalboards', label: 'Taktiktavla', shortLabel: 'Taktik', icon: Presentation });
  primary.push({ id: 'leaderboard', label: 'Poängliga', shortLabel: 'Poäng', icon: Trophy });
  primary.push({ id: 'squad', label: 'Truppen', icon: Users });
  // Genväg till Kalenderns flik Övningar (övningsbanken) – bara för tränare.
  if (opts.canManageExercises) primary.push({ id: 'exercisebank', label: 'Övningsbanken', shortLabel: 'Övningar', icon: Library });
  return { primary, secondary: [{ id: 'teampage', label: 'Lagsida', icon: Globe }] };
};

export type SyncState = 'idle' | 'saving' | 'pending' | 'error';

interface AccountInfo {
  name: string;
  email: string;
  photoUrl?: string | null;
  roleLabel?: string;
}

export interface AppShellProps {
  view: ShellView;
  onNavigate: (view: ShellView) => void;
  canViewLineup: boolean;
  /** Antal olästa inlägg (märke på menyvalet). */
  unreadPosts?: number;
  /** Antal chattar med olästa meddelanden. */
  unreadChats?: number;
  /** De knappar personen valt i mobilens bottenmeny (utöver Översikt och Mer). */
  mobileNav?: string[];
  /** Inställning: toppfältet visas aldrig i Uppställning på mobil. */
  hideLineupTopBar?: boolean;
  onSaveMobilePrefs?: (prefs: { mobileNav: ShellView[]; hideLineupTopBar: boolean }) => void;
  isCoachOrAdmin: boolean;
  title: string;
  /** Knappar som hör till den aktuella sidan, visas till höger i toppfältet. */
  actions?: React.ReactNode;
  clubName?: string;
  teamName?: string;
  account: AccountInfo | null;
  pendingRequests: number;
  syncState: SyncState;
  onSaveNow: () => void;
  onRefresh: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout: () => void;
  onLogin: () => void;
  onOpenShakeInfo: () => void;
  onOpenNotifications: () => void;
  onOpenPendingRequests: () => void;
  /** Dölj meny och toppfält (storskärmsläge eller vyer som tar hela skärmen). */
  chromeHidden?: boolean;
  /** Dölj bara toppfältet (vyn har en egen rubrik). */
  hideTopBar?: boolean;
  presenting?: boolean;
  onExitPresenting?: () => void;
  banner?: React.ReactNode;
  children: React.ReactNode;
}

const SyncIndicator: React.FC<{ state: SyncState; onSaveNow: () => void }> = ({ state, onSaveNow }) => {
  if (state === 'idle') return null;
  if (state === 'saving') {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold text-zinc-500 dark:text-zinc-400">
        <Loader2 size={14} className="animate-spin" /> Sparar…
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onSaveNow}
      title="Spara ändringarna nu"
      className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
        state === 'error'
          ? 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300'
          : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300'
      }`}
    >
      {state === 'error' ? <CloudOff size={14} /> : <Cloud size={14} />}
      <span>{state === 'error' ? 'Kunde inte spara' : 'Spara nu'}</span>
    </button>
  );
};

const TeamMark: React.FC<{ clubName?: string; size?: number }> = ({ clubName, size = 36 }) => {
  const letters = (clubName || 'CA')
    .split(/\s+/)
    .filter(w => w.length > 1)
    .slice(0, 3)
    .map(w => w.charAt(0).toUpperCase())
    .join('') || 'CA';
  return (
    <span
      className="inline-flex items-center justify-center rounded-xl bg-indigo-600 text-white font-extrabold shrink-0 tracking-tight"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {letters}
    </span>
  );
};

/**
 * Knappen för att lämna storskärmsläget. Ligger nere i hörnet så att den inte täcker innehållet
 * och tonas bort efter några sekunder; den visas igen vid tryck, musrörelse eller tangent.
 */
const ExitPresentingButton: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const [visible, setVisible] = React.useState(true);
  React.useEffect(() => {
    let timer = window.setTimeout(() => setVisible(false), 3000);
    const wake = () => {
      setVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), 3000);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
      else wake();
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('keydown', onKey);
    };
  }, [onExit]);
  return (
    <button
      type="button"
      onClick={onExit}
      title="Avsluta storskärm (Esc)"
      aria-label="Avsluta storskärm"
      className={`fixed z-[80] bottom-[calc(env(safe-area-inset-bottom,0px)+16px)] right-4 w-12 h-12 rounded-full bg-zinc-900/70 text-white backdrop-blur-md shadow-lg flex items-center justify-center cursor-pointer hover:bg-zinc-900 transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <Minimize2 size={20} />
    </button>
  );
};

export const AppShell: React.FC<AppShellProps> = props => {
  const {
    view, onNavigate, canViewLineup, unreadPosts, unreadChats, mobileNav, hideLineupTopBar, onSaveMobilePrefs, isCoachOrAdmin, title, actions, clubName, teamName, account,
    pendingRequests, syncState, onSaveNow, onRefresh, theme, onToggleTheme, onLogout, onLogin,
    onOpenShakeInfo, onOpenNotifications, onOpenPendingRequests, chromeHidden, hideTopBar, presenting, onExitPresenting, banner, children,
  } = props;
  const [accountOpen, setAccountOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [customizeOpen, setCustomizeOpen] = React.useState(false);

  // Mobil: toppfält och bottenmeny glider undan när man skrollar neråt och kommer tillbaka när man
  // skrollar uppåt (eller är nära toppen). Gäller alla skrollbara ytor i sidan, utom ark/dialoger och
  // helskärmslägen som har egen rubrik (märkta data-keep-bars, t.ex. en öppen chatt).
  const [barsHidden, setBarsHidden] = React.useState(false);
  const barsHiddenRef = React.useRef(false);
  const scrollTops = React.useRef(new WeakMap<EventTarget, number>());
  const scrollAcc = React.useRef(0);
  const lastToggle = React.useRef(0);
  const setBars = (hidden: boolean) => {
    if (barsHiddenRef.current === hidden) return;
    barsHiddenRef.current = hidden;
    lastToggle.current = Date.now();
    scrollAcc.current = 0;
    setBarsHidden(hidden);
  };
  React.useEffect(() => { setBars(false); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const onMainScroll = (e: React.UIEvent<HTMLElement>) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || window.innerWidth >= 768 || el.closest('[role="dialog"], [data-keep-bars]')) return;
    const top = el.scrollTop;
    const prev = scrollTops.current.get(el) ?? top;
    scrollTops.current.set(el, top);
    const d = top - prev;
    // Strax efter ett byte ändras ytans höjd, och då hoppar skrollningen lite – det räknas inte.
    if (!d || Date.now() - lastToggle.current < 500) return;
    if (top < 24) { setBars(false); return; }
    // Längst ner: när menyerna glider undan blir ytan högre och skrollningen hoppar uppåt av sig själv.
    if (d < 0 && top + el.clientHeight >= el.scrollHeight - 4) return;
    scrollAcc.current = Math.sign(d) === Math.sign(scrollAcc.current) ? scrollAcc.current + d : d;
    if (scrollAcc.current > 30) setBars(true);
    else if (scrollAcc.current < -30) setBars(false);
  };
  const lineupTopBarOff = view === 'lineup' && !!hideLineupTopBar;
  const topCollapsed = barsHidden || lineupTopBarOff;
  // Fäller ihop en rad på mobil (höjden animeras); från 768 px visas den alltid.
  const collapse = (hidden: boolean) =>
    `grid transition-[grid-template-rows] duration-300 ease-out md:grid-rows-[1fr] ${hidden ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`;
  const { primary, secondary } = buildNavItems({ canViewLineup, unreadPosts, unreadChats, canManageExercises: isCoachOrAdmin && !!account });
  const adminItem: NavItem | null = isCoachOrAdmin && account
    ? { id: 'clubadmin', label: 'Administration', shortLabel: 'Admin', icon: ShieldCheck, badge: pendingRequests || undefined }
    : null;

  const go = (v: ShellView) => {
    setAccountOpen(false);
    onNavigate(v);
  };

  // Mobilens bottenmeny: Översikt + de valda + Mer. Allt annat ligger i arket Mer.
  const allItems: NavItem[] = [...primary, ...secondary, ...(adminItem ? [adminItem] : [])];
  const homeItem = allItems.find(i => i.id === 'home')!;
  const mobileIds = resolveMobileNav(mobileNav, allItems.map(i => i.id), isCoachOrAdmin);
  const bottomItems: NavItem[] = [homeItem, ...mobileIds.map(id => allItems.find(i => i.id === id)!).filter(Boolean)];
  const moreItems = allItems.filter(i => i.id !== 'home' && !mobileIds.includes(i.id));
  const choiceItems = allItems.filter(i => i.id !== 'home');
  const moreBadge = (mobileIds.includes('chat') ? 0 : unreadChats || 0) + (adminItem && !mobileIds.includes('clubadmin') ? pendingRequests : 0);
  const moreActive = !['home', 'posts', ...mobileIds].includes(view);

  const SideLink: React.FC<{ item: NavItem }> = ({ item }) => {
    const active = view === item.id;
    const Icon = item.icon;
    return (
      <button
        type="button"
        onClick={() => go(item.id)}
        title={item.label}
        aria-current={active ? 'page' : undefined}
        className={`group relative w-full flex items-center gap-3 rounded-xl transition-colors cursor-pointer md:justify-center lg:justify-start md:h-12 lg:h-11 md:px-0 lg:px-3 ${
          active
            ? 'bg-indigo-600 text-white dark:bg-indigo-500'
            : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
        }`}
      >
        <Icon size={20} strokeWidth={active ? 2.4 : 2} />
        <span className="hidden lg:inline text-sm font-semibold">{item.label}</span>
        {item.badge ? (
          <span className="absolute md:top-1.5 md:right-1.5 lg:static lg:ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[18px] text-center">
            {item.badge}
          </span>
        ) : null}
      </button>
    );
  };

  const accountButton = account ? (
    <button
      type="button"
      onClick={() => setAccountOpen(true)}
      title="Konto och inställningar"
      aria-label="Konto och inställningar"
      className="relative shrink-0 rounded-full cursor-pointer ring-2 ring-transparent hover:ring-indigo-300 dark:hover:ring-indigo-700 transition-all"
    >
      <Avatar name={account.name} photoUrl={account.photoUrl} size={36} />
      {pendingRequests > 0 && isCoachOrAdmin && (
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-600 ring-2 ring-white dark:ring-zinc-900" />
      )}
    </button>
  ) : (
    <button
      type="button"
      onClick={onLogin}
      className="h-9 px-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold cursor-pointer"
    >
      Logga in
    </button>
  );

  return (
    <div className="fixed inset-0 flex bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans overflow-hidden">
      {/* Sidomeny för iPad och dator */}
      {!chromeHidden && (
        <aside className="hidden md:flex flex-col shrink-0 md:w-[76px] lg:w-60 border-r border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 pt-safe">
          {/* Överst: den inloggades profilbild (öppnar kontomenyn); utloggad: föreningens märke. */}
          <div className="flex items-center h-16 md:justify-center lg:justify-start px-2 lg:px-3 border-b border-zinc-100 dark:border-zinc-800/80">
            {account ? (
              <button
                type="button"
                onClick={() => setAccountOpen(true)}
                title="Konto och inställningar"
                aria-label="Konto och inställningar"
                className="relative flex items-center gap-3 p-1 lg:pr-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer min-w-0 lg:w-full text-left"
              >
                <Avatar name={account.name} photoUrl={account.photoUrl} size={38} />
                <span className="hidden lg:block min-w-0">
                  <span className="block text-sm font-bold truncate">{account.name}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate">{teamName || clubName || account.roleLabel}</span>
                </span>
                {pendingRequests > 0 && isCoachOrAdmin && (
                  <span className="absolute top-0.5 left-8 w-3 h-3 rounded-full bg-red-600 ring-2 ring-white dark:ring-zinc-900" />
                )}
              </button>
            ) : (
              <span className="flex items-center gap-3 lg:px-1">
                <TeamMark clubName={clubName} />
                <span className="hidden lg:block min-w-0">
                  <span className="block text-sm font-bold truncate">{clubName || 'CoachAssist'}</span>
                  {teamName && <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate">{teamName}</span>}
                </span>
              </span>
            )}
          </div>
          <nav className="flex-1 flex flex-col gap-1 p-2 lg:p-3 overflow-y-auto" aria-label="Huvudmeny">
            {primary.map(item => <SideLink key={item.id} item={item} />)}
            <div className="my-2 mx-2 border-t border-zinc-100 dark:border-zinc-800" />
            {secondary.map(item => <SideLink key={item.id} item={item} />)}
            {adminItem && <SideLink item={adminItem} />}
          </nav>
          {!account && (
            <div className="p-2 lg:p-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-center">{accountButton}</div>
          )}
        </aside>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {!chromeHidden && !hideTopBar && (
          <header className={`shrink-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md pt-safe z-30 ${topCollapsed ? 'md:border-b' : 'border-b'} border-zinc-200/80 dark:border-zinc-800`}>
            <div className={collapse(topCollapsed)}>
            <div className="min-h-0 overflow-hidden">
            <div className="h-14 sm:h-16 px-4 sm:px-6 flex items-center gap-3">
              {/* Mobil: den inloggades profilbild (öppnar Mer); utloggad: föreningens märke. */}
              <div className="md:hidden">
                {account ? (
                  <button
                    type="button"
                    onClick={() => setMoreOpen(true)}
                    title="Konto och mer"
                    aria-label="Konto och mer"
                    className="block rounded-full cursor-pointer ring-2 ring-transparent hover:ring-indigo-300 dark:hover:ring-indigo-700 transition-all"
                  >
                    <Avatar name={account.name} photoUrl={account.photoUrl} size={36} />
                  </button>
                ) : (
                  <TeamMark clubName={clubName} size={32} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight truncate">{title}</h1>
                {teamName && (
                  <p className="md:hidden -mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 truncate">{teamName}</p>
                )}
              </div>
              <div className="flex items-center gap-1 sm:gap-1.5">
                <SyncIndicator state={syncState} onSaveNow={onSaveNow} />
                {actions}
                {!account && <div className="md:hidden ml-1">{accountButton}</div>}
              </div>
            </div>
            </div>
            </div>
          </header>
        )}
        {/* Toppfältet är avstängt i Uppställning: sidans knappar (t.ex. storskärm) ligger i hörnet. */}
        {!chromeHidden && !hideTopBar && lineupTopBarOff && actions && (
          <div className={`md:hidden fixed right-3 z-40 flex gap-1 p-1 rounded-2xl bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md shadow-lg border border-zinc-200/80 dark:border-zinc-800 transition-all duration-300 ${
            barsHidden ? 'bottom-[calc(env(safe-area-inset-bottom,0px)+12px)]' : 'bottom-[calc(env(safe-area-inset-bottom,0px)+72px)]'
          }`}>
            {actions}
          </div>
        )}

        {!chromeHidden && banner}

        <main onScrollCapture={onMainScroll} className="flex-1 min-h-0 flex flex-col overflow-hidden relative">{children}</main>

        {/* Bottenmeny för mobil */}
        {!chromeHidden && (
          <nav
            aria-label="Huvudmeny"
            className={`md:hidden shrink-0 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-zinc-200/80 dark:border-zinc-800 pb-safe z-30 ${barsHidden ? '' : 'border-t'}`}
          >
            <div className={collapse(barsHidden)}>
            <div className="min-h-0 overflow-hidden">
            <div className="flex items-stretch justify-around px-1">
              {bottomItems.map(item => {
                const active = view === item.id || (item.id === 'home' && view === 'posts');
                const Icon = item.icon;
                const badge = item.id === 'home' ? unreadPosts : item.badge;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 min-h-[56px] cursor-pointer transition-colors ${
                      active ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    <span className={`relative flex items-center justify-center w-14 h-7 rounded-full transition-colors ${active ? 'bg-indigo-50 dark:bg-indigo-950/70' : ''}`}>
                      <Icon size={21} strokeWidth={active ? 2.4 : 2} />
                      {badge ? (
                        <span className="absolute -top-1 right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[16px] text-center">{badge}</span>
                      ) : null}
                    </span>
                    <span className={`text-[11px] leading-tight ${active ? 'font-bold' : 'font-medium'}`}>{item.shortLabel || item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-current={moreActive ? 'page' : undefined}
                aria-label={moreBadge ? `Mer (${moreBadge} nya)` : 'Mer'}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 min-h-[56px] cursor-pointer transition-colors ${
                  moreActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                <span className={`relative flex items-center justify-center w-14 h-7 rounded-full transition-colors ${moreActive ? 'bg-indigo-50 dark:bg-indigo-950/70' : ''}`}>
                  <LayoutGrid size={21} strokeWidth={moreActive ? 2.4 : 2} />
                  {moreBadge ? (
                    <span className="absolute -top-1 right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[16px] text-center">{moreBadge}</span>
                  ) : null}
                </span>
                <span className={`text-[11px] leading-tight ${moreActive ? 'font-bold' : 'font-medium'}`}>Mer</span>
              </button>
            </div>
            </div>
            </div>
          </nav>
        )}
      </div>

      {presenting && onExitPresenting && <ExitPresentingButton onExit={onExitPresenting} />}

      {/* Mobilens Mer och valet av knappar i bottenmenyn */}
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        view={view}
        items={moreItems}
        account={account}
        clubName={clubName}
        teamName={teamName}
        isCoachOrAdmin={isCoachOrAdmin}
        pendingRequests={pendingRequests}
        theme={theme}
        onNavigate={go}
        onCustomize={() => setCustomizeOpen(true)}
        onToggleTheme={onToggleTheme}
        onRefresh={onRefresh}
        onOpenShakeInfo={onOpenShakeInfo}
        onOpenNotifications={onOpenNotifications}
        onOpenPendingRequests={onOpenPendingRequests}
        onLogout={onLogout}
      />
      <CustomizeNavSheet
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        current={mobileIds}
        hideLineupTopBar={!!hideLineupTopBar}
        canViewLineup={canViewLineup}
        choices={choiceItems}
        defaults={defaultMobileNav(isCoachOrAdmin).filter(id => choiceItems.some(c => c.id === id))}
        onSave={(ids, hideTop) => onSaveMobilePrefs?.({ mobileNav: ids, hideLineupTopBar: hideTop })}
      />

      {/* Kontomeny */}
      <Sheet open={accountOpen} onClose={() => setAccountOpen(false)} title="Konto">
        {account && (
          <div className="flex items-center gap-3 px-3 pt-1 pb-4">
            <Avatar name={account.name} photoUrl={account.photoUrl} size={48} />
            <div className="min-w-0">
              <div className="font-bold truncate">{account.name}</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400 truncate">{account.email}</div>
              {account.roleLabel && <div className="text-xs text-indigo-600 dark:text-indigo-300 font-semibold mt-0.5">{account.roleLabel}</div>}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {(clubName || teamName) && (
            <MenuItem
              icon={<Building2 size={18} />}
              label={teamName || 'Lag'}
              description={isCoachOrAdmin ? `${clubName || ''} · Byt eller hantera lag` : clubName}
              onClick={() => go(isCoachOrAdmin ? 'clubadmin' : 'profile')}
              trailing={<ChevronRight size={18} className="text-zinc-400" />}
            />
          )}
          <MenuItem icon={<UserIcon size={18} />} label="Min profil" description="Namn, bild, lösenord och inloggning" onClick={() => go('profile')} active={view === 'profile'} />
          <MenuItem icon={<Globe size={18} />} label="Lagsida" description="Lagets webbsida, kalender och tabell" onClick={() => go('teampage')} active={view === 'teampage'} />
          {adminItem && (
            <MenuItem
              icon={<ShieldCheck size={18} />}
              label="Administration"
              description="Förening, lag, medlemmar och kalenderkoppling"
              onClick={() => go('clubadmin')}
              active={view === 'clubadmin'}
              trailing={pendingRequests > 0 ? (
                <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-600 text-white text-xs font-bold leading-[22px] text-center">{pendingRequests}</span>
              ) : undefined}
            />
          )}
          {pendingRequests > 0 && isCoachOrAdmin && (
            <MenuItem
              icon={<Users size={18} />}
              label={pendingRequests === 1 ? '1 ansökan väntar' : `${pendingRequests} ansökningar väntar`}
              description="Granska nya medlemmar"
              onClick={() => { setAccountOpen(false); onOpenPendingRequests(); }}
            />
          )}
          <div className="my-2 border-t border-zinc-100 dark:border-zinc-800" />
          <MenuItem
            icon={theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            label={theme === 'light' ? 'Mörkt läge' : 'Ljust läge'}
            onClick={onToggleTheme}
          />
          <MenuItem icon={<RefreshCw size={18} />} label="Hämta senaste" description="Läs in lagets data på nytt" onClick={() => { setAccountOpen(false); onRefresh(); }} />
          <MenuItem icon={<Bell size={18} />} label="Notiser" description="Chatt och inlägg på den här enheten" onClick={() => { setAccountOpen(false); onOpenNotifications(); }} />
          <MenuItem icon={<VibrateOff size={18} />} label="Skakskydd (iPhone)" description="Undvik att iOS frågar om att ångra" onClick={() => { setAccountOpen(false); onOpenShakeInfo(); }} />
          <div className="my-2 border-t border-zinc-100 dark:border-zinc-800" />
          <MenuItem icon={<LogOut size={18} />} label="Logga ut" tone="danger" onClick={() => { setAccountOpen(false); onLogout(); }} />
        </div>
      </Sheet>
    </div>
  );
};

