/**
 * Appens skal: sidomeny (iPad/dator), bottenmeny (mobil), toppfält och kontomeny.
 * Alla huvudvyer visas inuti skalet så att navigering och rubriker ser likadana ut överallt.
 */
import React from 'react';
import {
  House, Calendar, Users, Shirt, Trophy, Globe, ShieldCheck, User as UserIcon, Sun, Moon,
  RefreshCw, LogOut, Building2, ChevronRight, Cloud, CloudOff, Loader2, VibrateOff, Minimize2, Presentation,
} from 'lucide-react';
import { Avatar, MenuItem, Sheet } from '../ui';

export type ShellView = 'home' | 'training' | 'squad' | 'lineup' | 'tacticalboards' | 'leaderboard' | 'teampage' | 'clubadmin' | 'profile';

export interface NavItem {
  id: ShellView;
  label: string;
  shortLabel?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  badge?: number;
}

export const buildNavItems = (opts: { canViewLineup: boolean }): { primary: NavItem[]; secondary: NavItem[] } => {
  const primary: NavItem[] = [
    { id: 'home', label: 'Översikt', icon: House },
    { id: 'training', label: 'Kalender', icon: Calendar },
    { id: 'squad', label: 'Truppen', icon: Users },
  ];
  if (opts.canViewLineup) primary.push({ id: 'lineup', label: 'Uppställning', shortLabel: 'Uppställn.', icon: Shirt });
  // Lagets taktiktavlor: alla i laget (spelare ser de tavlor som tränaren har delat).
  primary.push({ id: 'tacticalboards', label: 'Taktiktavla', shortLabel: 'Taktik', icon: Presentation });
  primary.push({ id: 'leaderboard', label: 'Poängliga', shortLabel: 'Poäng', icon: Trophy });
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
    view, onNavigate, canViewLineup, isCoachOrAdmin, title, actions, clubName, teamName, account,
    pendingRequests, syncState, onSaveNow, onRefresh, theme, onToggleTheme, onLogout, onLogin,
    onOpenShakeInfo, onOpenPendingRequests, chromeHidden, hideTopBar, presenting, onExitPresenting, banner, children,
  } = props;
  const [accountOpen, setAccountOpen] = React.useState(false);
  const { primary, secondary } = buildNavItems({ canViewLineup });
  const adminItem: NavItem | null = isCoachOrAdmin && account
    ? { id: 'clubadmin', label: 'Administration', icon: ShieldCheck, badge: pendingRequests || undefined }
    : null;

  const go = (v: ShellView) => {
    setAccountOpen(false);
    onNavigate(v);
  };

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
          <div className="flex items-center gap-3 h-16 md:justify-center lg:justify-start lg:px-4 border-b border-zinc-100 dark:border-zinc-800/80">
            <TeamMark clubName={clubName} />
            <div className="hidden lg:block min-w-0">
              <div className="text-sm font-bold truncate">{clubName || 'CoachAssist'}</div>
              {teamName && <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{teamName}</div>}
            </div>
          </div>
          <nav className="flex-1 flex flex-col gap-1 p-2 lg:p-3 overflow-y-auto" aria-label="Huvudmeny">
            {primary.map(item => <SideLink key={item.id} item={item} />)}
            <div className="my-2 mx-2 border-t border-zinc-100 dark:border-zinc-800" />
            {secondary.map(item => <SideLink key={item.id} item={item} />)}
            {adminItem && <SideLink item={adminItem} />}
          </nav>
          <div className="p-2 lg:p-3 border-t border-zinc-100 dark:border-zinc-800 flex md:flex-col lg:flex-row items-center gap-2">
            {account ? (
              <button
                type="button"
                onClick={() => setAccountOpen(true)}
                className="flex-1 w-full flex items-center gap-3 p-1.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer md:justify-center lg:justify-start"
                title="Konto och inställningar"
              >
                <Avatar name={account.name} photoUrl={account.photoUrl} size={34} />
                <span className="hidden lg:block min-w-0 text-left">
                  <span className="block text-sm font-semibold truncate">{account.name}</span>
                  {account.roleLabel && <span className="block text-xs text-zinc-500 truncate">{account.roleLabel}</span>}
                </span>
              </button>
            ) : (
              accountButton
            )}
          </div>
        </aside>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {!chromeHidden && !hideTopBar && (
          <header className="shrink-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800 pt-safe z-30">
            <div className="h-14 sm:h-16 px-4 sm:px-6 flex items-center gap-3">
              <div className="md:hidden">
                <TeamMark clubName={clubName} size={32} />
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
                <div className="md:hidden ml-1">{accountButton}</div>
              </div>
            </div>
          </header>
        )}

        {!chromeHidden && banner}

        <main className="flex-1 min-h-0 flex flex-col overflow-hidden relative">{children}</main>

        {/* Bottenmeny för mobil */}
        {!chromeHidden && (
          <nav
            aria-label="Huvudmeny"
            className="md:hidden shrink-0 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-zinc-200/80 dark:border-zinc-800 pb-safe z-30"
          >
            <div className="flex items-stretch justify-around px-1">
              {primary.map(item => {
                const active = view === item.id;
                const Icon = item.icon;
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
                    <span className={`flex items-center justify-center w-14 h-7 rounded-full transition-colors ${active ? 'bg-indigo-50 dark:bg-indigo-950/70' : ''}`}>
                      <Icon size={21} strokeWidth={active ? 2.4 : 2} />
                    </span>
                    <span className={`text-[11px] leading-tight ${active ? 'font-bold' : 'font-medium'}`}>{item.shortLabel || item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}
      </div>

      {presenting && onExitPresenting && <ExitPresentingButton onExit={onExitPresenting} />}

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
          <MenuItem icon={<VibrateOff size={18} />} label="Skakskydd (iPhone)" description="Undvik att iOS frågar om att ångra" onClick={() => { setAccountOpen(false); onOpenShakeInfo(); }} />
          <div className="my-2 border-t border-zinc-100 dark:border-zinc-800" />
          <MenuItem icon={<LogOut size={18} />} label="Logga ut" tone="danger" onClick={() => { setAccountOpen(false); onLogout(); }} />
        </div>
      </Sheet>
    </div>
  );
};

