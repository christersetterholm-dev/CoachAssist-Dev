/**
 * Menyn Närvaro: anmälan till aktiviteter och uppföljning av närvaro.
 * Fliken Aktiviteter visar kommande och tidigare aktiviteter. Spelare svarar direkt på raden,
 * tränare ser hur många som svarat och kan skapa nya aktiviteter. Fliken Statistik (tränare)
 * visar närvaron per spelare.
 */
import React, { useMemo, useState } from 'react';
import { Check, X, HelpCircle, Plus, ListChecks, Dumbbell, Trophy, Shapes, Clock, MapPin, ChevronRight, BarChart3, CalendarDays } from 'lucide-react';
import { RsvpStatus, SquadPlayer, TrainingSession, TrainingSettings } from '../../types';
import { categorizeSession, SessionCategory } from '../../utils/sessionCategory';
import { Button, Card, EmptyState, SegmentedTabs } from '../ui';
import SquadAttendanceOverview from '../SquadAttendanceOverview';
import NewActivitySheet from './NewActivitySheet';
import { answerForMe, isPresent, myRow, responseSummary, sessionEnd, sessionStart, sessionTitle, teamLeaders, teamPlayers } from './shared';

interface AttendanceViewProps {
  squad: SquadPlayer[];
  sessions: TrainingSession[];
  isCoachOrAdmin: boolean;
  clubId?: string | null;
  teamId?: string | null;
  settings?: TrainingSettings;
  onUpdateSession: (session: TrainingSession) => void;
  onOpenSession: (id: string, tab?: 'schema' | 'attendance' | 'rsvp') => void;
  onOpenMultiRsvp: () => void;
  onCreateSessions: (sessions: TrainingSession[], notify: boolean) => void;
}

type Tab = 'activities' | 'stats';
type When = 'upcoming' | 'past';
type KindFilter = 'all' | SessionCategory;

const PAST_PAGE = 30;

const KIND_ICON: Record<SessionCategory, React.ReactNode> = {
  training: <Dumbbell size={18} />,
  match: <Trophy size={18} />,
  other: <Shapes size={18} />,
};
const KIND_TONE: Record<SessionCategory, string> = {
  training: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300',
  match: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300',
  other: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
};

const STATUS: { id: RsvpStatus; label: string; icon: React.ReactNode; on: string }[] = [
  { id: 'attending', label: 'Kommer', icon: <Check size={16} strokeWidth={2.6} />, on: 'bg-emerald-600 text-white border-emerald-600' },
  { id: 'partial', label: 'Delvis', icon: <HelpCircle size={16} />, on: 'bg-amber-500 text-white border-amber-500' },
  { id: 'declined', label: 'Kan inte', icon: <X size={16} strokeWidth={2.6} />, on: 'bg-red-600 text-white border-red-600' },
];

const chipClass = 'h-10 px-3.5 rounded-full border text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap';
const chipOff = 'border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800';
const chipOn = 'border-indigo-600 bg-indigo-600 text-white';

export default function AttendanceView(props: AttendanceViewProps) {
  const { squad, sessions, isCoachOrAdmin, clubId, teamId, settings, onUpdateSession, onOpenSession, onOpenMultiRsvp, onCreateSessions } = props;
  const [tab, setTab] = useState<Tab>('activities');
  const [when, setWhen] = useState<When>('upcoming');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [pastLimit, setPastLimit] = useState(PAST_PAGE);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const me = useMemo(() => myRow(squad), [squad]);
  const players = useMemo(() => teamPlayers(squad), [squad]);
  const leaders = useMemo(() => teamLeaders(squad), [squad]);

  const list = useMemo(() => {
    const now = Date.now();
    const visible = sessions.filter(s => !s.isIgnored && (kindFilter === 'all' || categorizeSession(s) === kindFilter));
    if (when === 'upcoming') {
      return visible.filter(s => sessionEnd(s) >= now).sort((a, b) => sessionStart(a) - sessionStart(b));
    }
    return visible.filter(s => sessionEnd(s) < now).sort((a, b) => sessionStart(b) - sessionStart(a));
  }, [sessions, when, kindFilter]);

  const shown = when === 'past' ? list.slice(0, pastLimit) : list;

  const answer = async (s: TrainingSession, status: RsvpStatus) => {
    if (!me) return;
    setError(null);
    setSavingId(s.id);
    try {
      await answerForMe({ session: s, me, status, clubId, teamId, onUpdateSession });
    } catch (err: any) {
      setError(err?.message || 'Svaret kunde inte sparas. Försök igen.');
    } finally {
      setSavingId(null);
    }
  };

  const open = (s: TrainingSession) => {
    if (!isCoachOrAdmin) onOpenSession(s.id, 'schema');
    else onOpenSession(s.id, sessionEnd(s) < Date.now() ? 'attendance' : 'rsvp');
  };

  let lastMonth = '';

  return (
    <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-5 sm:py-8 space-y-5">
      {isCoachOrAdmin && (
        <SegmentedTabs<Tab>
          size="lg"
          tabs={[
            { id: 'activities', label: 'Aktiviteter', icon: <CalendarDays size={16} /> },
            { id: 'stats', label: 'Statistik', icon: <BarChart3 size={16} /> },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}

      {tab === 'stats' && isCoachOrAdmin ? (
        <SquadAttendanceOverview squad={squad} sessions={sessions} isCoachOrAdmin={isCoachOrAdmin} />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <SegmentedTabs<When>
              tabs={[{ id: 'upcoming', label: 'Kommande' }, { id: 'past', label: 'Tidigare' }]}
              value={when}
              onChange={(v) => { setWhen(v); setPastLimit(PAST_PAGE); }}
            />
            <div className="flex items-center gap-2 sm:ml-auto">
              {(isCoachOrAdmin || me) && (
                <Button variant="secondary" icon={<ListChecks size={18} />} onClick={onOpenMultiRsvp} className="flex-1 sm:flex-none">Svara på flera</Button>
              )}
              {isCoachOrAdmin && (
                <Button icon={<Plus size={18} />} onClick={() => setIsNewOpen(true)} className="flex-1 sm:flex-none">Ny aktivitet</Button>
              )}
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1" role="group" aria-label="Typ av aktivitet">
            {([['all', 'Alla'], ['training', 'Träning'], ['match', 'Match'], ['other', 'Övrigt']] as [KindFilter, string][]).map(([id, text]) => (
              <button key={id} type="button" aria-pressed={kindFilter === id} onClick={() => setKindFilter(id)} className={`${chipClass} ${kindFilter === id ? chipOn : chipOff}`}>
                {text}
              </button>
            ))}
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
          {!isCoachOrAdmin && !me && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Ditt konto är inte kopplat till någon i truppen, så du kan inte svara på kallelser.</p>
          )}

          {shown.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CalendarDays size={28} />}
                title={when === 'upcoming' ? 'Inga kommande aktiviteter' : 'Inga tidigare aktiviteter'}
                text={isCoachOrAdmin && when === 'upcoming' ? 'Skapa en träning, match eller annan aktivitet.' : undefined}
                action={isCoachOrAdmin && when === 'upcoming' ? <Button icon={<Plus size={18} />} onClick={() => setIsNewOpen(true)}>Ny aktivitet</Button> : undefined}
              />
            </Card>
          ) : (
            <ul className="space-y-2">
              {shown.map(s => {
                const d = new Date(s.date);
                const month = d.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
                const header = month !== lastMonth ? month : null;
                lastMonth = month;
                return (
                  <React.Fragment key={s.id}>
                    {header && <li className="pt-3 pb-1 px-1 text-sm font-bold text-zinc-500 dark:text-zinc-400 first-letter:uppercase" aria-hidden="true">{header}</li>}
                    <li>
                      <ActivityRow
                        session={s}
                        past={when === 'past'}
                        isCoachOrAdmin={isCoachOrAdmin}
                        me={me}
                        players={players}
                        leaders={leaders}
                        saving={savingId === s.id}
                        onOpen={() => open(s)}
                        onAnswer={(st) => answer(s, st)}
                      />
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>
          )}

          {when === 'past' && list.length > pastLimit && (
            <Button block variant="secondary" onClick={() => setPastLimit(x => x + PAST_PAGE)}>Visa fler</Button>
          )}
        </>
      )}

      {isCoachOrAdmin && (
        <NewActivitySheet
          open={isNewOpen}
          onClose={() => setIsNewOpen(false)}
          settings={settings}
          squadCount={squad.length}
          onCreate={onCreateSessions}
        />
      )}
    </div>
  );
}

const ActivityRow: React.FC<{
  session: TrainingSession;
  past: boolean;
  isCoachOrAdmin: boolean;
  me: SquadPlayer | null;
  players: SquadPlayer[];
  leaders: SquadPlayer[];
  saving: boolean;
  onOpen: () => void;
  onAnswer: (status: RsvpStatus) => void;
}> = ({ session: s, past, isCoachOrAdmin, me, players, leaders, saving, onOpen, onAnswer }) => {
  const kind = categorizeSession(s);
  const d = new Date(s.date);
  const weekday = d.toLocaleDateString('sv-SE', { weekday: 'short' }).replace('.', '');
  const hasInvite = !!s.rsvpConfig || Object.keys(s.rsvps || {}).length > 0;
  const mine = me ? s.rsvps?.[me.id]?.status : undefined;
  const deadlinePassed = !!s.rsvpConfig?.deadline && s.rsvpConfig.deadline < Date.now();
  const time = `${s.startTime || ''}${s.endTime ? `–${s.endTime}` : ''}`;

  return (
    <Card padded={false} className="overflow-hidden">
      <button type="button" onClick={onOpen} className="w-full flex items-center gap-3 p-3 sm:p-4 text-left cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
        <span className="w-11 shrink-0 text-center leading-tight">
          <span className="block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 first-letter:uppercase">{weekday}</span>
          <span className="block text-xl font-bold">{d.getDate()}</span>
        </span>
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${KIND_TONE[kind]}`} aria-hidden="true">{KIND_ICON[kind]}</span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold truncate">
            {sessionTitle(s)}
            {s.homeAway && <span className="ml-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">{s.homeAway === 'home' ? 'Hemma' : 'Borta'}</span>}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {time && <span className="inline-flex items-center gap-1"><Clock size={12} />{time}{s.gatheringTime ? ` · samling ${s.gatheringTime}` : ''}</span>}
            {s.location && <span className="inline-flex items-center gap-1 min-w-0"><MapPin size={12} /><span className="truncate">{s.location}</span></span>}
          </span>
          {isCoachOrAdmin && (
            past || hasInvite ? (
              <span className="block mt-2 space-y-1">
                <GroupLine label="Spelare" session={s} people={players} past={past} />
                {leaders.length > 0 && <GroupLine label="Tränare" session={s} people={leaders} past={past} />}
              </span>
            ) : (
              <span className="inline-block mt-2 px-2 py-0.5 rounded-lg text-xs font-semibold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">Ingen kallelse</span>
            )
          )}
        </span>
        <ChevronRight size={18} className="text-zinc-400 shrink-0" />
      </button>

      {!isCoachOrAdmin && me && (
        past ? (
          <div className="px-3 sm:px-4 pb-3 -mt-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            {(s.attendance || []).includes(me.id) ? 'Du var med' : mine ? `Du svarade ${STATUS.find(x => x.id === mine)?.label.toLowerCase()}` : 'Inget svar'}
          </div>
        ) : (
          <div className="px-3 sm:px-4 pb-3 space-y-1.5">
            <div className="grid grid-cols-3 gap-2" role="group" aria-label={`Svar på ${sessionTitle(s)}`}>
              {STATUS.map(o => (
                <button
                  key={o.id}
                  type="button"
                  disabled={saving}
                  onClick={() => onAnswer(o.id)}
                  aria-pressed={mine === o.id}
                  className={`h-10 rounded-xl border text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] cursor-pointer disabled:opacity-60 ${
                    mine === o.id ? o.on : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-750'
                  }`}
                >
                  {o.icon}
                  {o.label}
                </button>
              ))}
            </div>
            {deadlinePassed && !mine && <p className="text-[11px] font-medium text-red-600 dark:text-red-400">Sista svarsdag har passerat</p>}
          </div>
        )
      )}
    </Card>
  );
};

const pill = 'px-2 py-0.5 rounded-lg';

// En rad per grupp (spelare/tränare): svaren på kallelsen, eller närvaron för en tidigare aktivitet.
const GroupLine: React.FC<{ label: string; session: TrainingSession; people: SquadPlayer[]; past: boolean }> = ({ label, session, people, past }) => {
  const sum = responseSummary(session, people);
  const present = people.filter(p => isPresent(session, p)).length;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
      <span className="w-14 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</span>
      {past ? (
        <span className={`${pill} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200`}>{present} av {people.length} var med</span>
      ) : (
        <>
          <span className={`${pill} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300`}>{sum.attending} kommer</span>
          {sum.partial > 0 && <span className={`${pill} bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300`}>{sum.partial} delvis</span>}
          <span className={`${pill} bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300`}>{sum.declined} kan inte</span>
          <span className={`${pill} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>{sum.unanswered} obesvarade</span>
        </>
      )}
    </span>
  );
};
