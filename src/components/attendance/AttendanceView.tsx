/**
 * Menyn Närvaro: anmälan till aktiviteter och uppföljning av närvaro.
 * Fliken Aktiviteter visar kommande och tidigare aktiviteter. Spelare svarar direkt på raden,
 * tränare ser hur många som svarat och kan skapa nya aktiviteter. Fliken Statistik (tränare)
 * visar närvaron per spelare.
 */
import React, { useMemo, useState } from 'react';
import { Check, X, HelpCircle, Plus, ListChecks, Dumbbell, Trophy, Shapes, Clock, MapPin, ChevronRight, BarChart3, CalendarDays, FileCheck2, CheckSquare, Repeat, Trash2 } from 'lucide-react';
import { RsvpStatus, SquadPlayer, TrainingSession, TrainingSettings } from '../../types';
import { categorizeSession, SessionCategory } from '../../utils/sessionCategory';
import { Button, Card, EmptyState, MenuItem, SegmentedTabs, Sheet } from '../ui';
import BulkEditSheet from '../sessions/BulkEditSheet';
import SeriesSheet from '../sessions/SeriesSheet';
import { allSeries, describeSeries } from '../sessions/seriesUtils';
import AttendanceStatsView from './AttendanceStatsView';
import LokCardView from './LokCardView';
import NewActivitySheet from './NewActivitySheet';
import { answerForMe, isCalled, isPresent, myRow, responseSummary, sessionEnd, sessionStart, sessionTitle, teamLeaders, teamPlayers } from './shared';

interface AttendanceViewProps {
  squad: SquadPlayer[];
  sessions: TrainingSession[];
  isCoachOrAdmin: boolean;
  clubId?: string | null;
  teamId?: string | null;
  settings?: TrainingSettings;
  teamName?: string;
  clubName?: string;
  onUpdateSession: (session: TrainingSession) => void;
  /** Närvaro som redan sparats på servern (t.ex. tränare bockade på flera pass). */
  onAttendanceSaved: (sessionId: string, attendance: string[]) => void;
  onOpenSession: (id: string, tab?: 'schema' | 'attendance' | 'rsvp') => void;
  onOpenMultiRsvp: () => void;
  onCreateSessions: (sessions: TrainingSession[], notify: boolean) => void;
  /** Återkommande pass och Välj flera */
  onUpdateSessions: (changed: TrainingSession[]) => void;
  onAddSessions: (created: TrainingSession[]) => void;
  onDeleteSessions: (ids: string[]) => void;
}

type Tab = 'activities' | 'stats' | 'cards';
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
  const { squad, sessions, isCoachOrAdmin, clubId, teamId, settings, teamName, clubName, onUpdateSession, onAttendanceSaved, onOpenSession, onOpenMultiRsvp, onCreateSessions, onUpdateSessions, onAddSessions, onDeleteSessions } = props;
  const [tab, setTab] = useState<Tab>('activities');
  const [when, setWhen] = useState<When>('upcoming');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [pastLimit, setPastLimit] = useState(PAST_PAGE);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Välj flera pass och ändra eller ta bort dem på en gång; återkommande pass (serier)
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isSeriesListOpen, setIsSeriesListOpen] = useState(false);
  const [openSeriesId, setOpenSeriesId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const series = useMemo(() => allSeries(sessions), [sessions]);
  const selectedSessions = useMemo(() => sessions.filter(s => selected.has(s.id)), [sessions, selected]);
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };

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
            { id: 'cards', label: 'Närvarokort', icon: <FileCheck2 size={16} /> },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}

      {tab === 'cards' && isCoachOrAdmin ? (
        <LokCardView clubId={clubId} teamId={teamId} clubName={clubName} onAttendanceSaved={onAttendanceSaved} />
      ) : tab === 'stats' && isCoachOrAdmin ? (
        <AttendanceStatsView squad={squad} sessions={sessions} teamName={teamName} />
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

          {isCoachOrAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={selecting ? 'primary' : 'secondary'} icon={<CheckSquare size={16} />} onClick={() => (selecting ? stopSelecting() : (setSelecting(true), setNotice(null)))}>
                {selecting ? 'Sluta välja' : 'Välj flera'}
              </Button>
              {series.length > 0 && (
                <Button size="sm" variant="secondary" icon={<Repeat size={16} />} onClick={() => setIsSeriesListOpen(true)}>Återkommande pass ({series.length})</Button>
              )}
            </div>
          )}
          {notice && <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">{notice}</p>}

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
                        onOpen={() => (selecting
                          ? setSelected(prev => { const n = new Set(prev); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })
                          : open(s))}
                        onAnswer={(st) => answer(s, st)}
                        selecting={selecting}
                        selected={selected.has(s.id)}
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

          {selecting && (
            <div className="sticky bottom-3 z-20">
              <Card className="flex flex-wrap items-center gap-2 shadow-lg">
                <span className="text-sm font-semibold flex-1 min-w-[8rem]">{selected.size} valda</span>
                <Button size="sm" variant="ghost" icon={<Trash2 size={16} />} disabled={selected.size === 0} onClick={() => setIsDeleteOpen(true)} className="text-red-600! dark:text-red-400! hover:bg-red-50! dark:hover:bg-red-950/40!">Ta bort</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(shown.map(s => s.id)))}>Välj alla i listan</Button>
                {selected.size > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Avmarkera</Button>}
                <Button size="sm" disabled={selected.size === 0} onClick={() => setIsBulkOpen(true)}>Ändra {selected.size || ''} pass</Button>
              </Card>
            </div>
          )}
        </>
      )}

      {isCoachOrAdmin && (
        <>
          <BulkEditSheet
            open={isBulkOpen}
            onClose={() => setIsBulkOpen(false)}
            sessions={selectedSessions}
            subtitle={`${selectedSessions.length} valda pass`}
            onApply={(updated) => { onUpdateSessions(updated); setNotice(`${updated.length} pass ändrades.`); stopSelecting(); }}
          />
          <Sheet
            open={isDeleteOpen}
            onClose={() => setIsDeleteOpen(false)}
            title={`Ta bort ${selectedSessions.length} pass?`}
            footer={
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => setIsDeleteOpen(false)}>Avbryt</Button>
                <Button
                  variant="danger"
                  icon={<Trash2 size={18} />}
                  disabled={selectedSessions.length === 0}
                  onClick={() => {
                    onDeleteSessions(selectedSessions.map(s => s.id));
                    setNotice(`${selectedSessions.length} pass flyttades till papperskorgen. De kan återställas från Kalendern.`);
                    setIsDeleteOpen(false);
                    stopSelecting();
                  }}
                >
                  Ta bort {selectedSessions.length} pass
                </Button>
              </div>
            }
          >
            <div className="px-5 pb-4 space-y-3">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">Passen flyttas till papperskorgen i Kalendern och kan återställas därifrån.</p>
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {[...selectedSessions].sort((a, b) => sessionStart(a) - sessionStart(b)).map(s => (
                  <li key={s.id} className="text-sm">
                    <span className="font-semibold">{new Date(s.date).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    <span className="text-zinc-500 dark:text-zinc-400"> · {sessionTitle(s)}{s.startTime ? ` ${s.startTime}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Sheet>
          <Sheet open={isSeriesListOpen} onClose={() => setIsSeriesListOpen(false)} title="Återkommande pass">
            <div className="px-2 pb-2 space-y-1">
              <p className="text-sm text-zinc-500 dark:text-zinc-400 px-1 pb-1">Pass som skapades tillsammans och upprepas. Öppna en för att ändra, lägga till fler veckor eller ta bort tillfällen.</p>
              {series.map(x => (
                <MenuItem key={x.id} icon={<Repeat size={18} />} label={x.sessions[0].title || 'Återkommande pass'} description={describeSeries(x.sessions)} onClick={() => { setIsSeriesListOpen(false); setOpenSeriesId(x.id); }} />
              ))}
            </div>
          </Sheet>
          <SeriesSheet
            open={!!openSeriesId}
            onClose={() => setOpenSeriesId(null)}
            seriesId={openSeriesId}
            allSessions={sessions}
            onUpdateSessions={onUpdateSessions}
            onAddSessions={onAddSessions}
            onDeleteSessions={onDeleteSessions}
          />
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
  selecting?: boolean;
  selected?: boolean;
}> = ({ session: s, past, isCoachOrAdmin, me, players, leaders, saving, onOpen, onAnswer, selecting, selected }) => {
  const kind = categorizeSession(s);
  const d = new Date(s.date);
  const weekday = d.toLocaleDateString('sv-SE', { weekday: 'short' }).replace('.', '');
  const hasInvite = !!s.rsvpConfig || Object.keys(s.rsvps || {}).length > 0;
  const mine = me ? s.rsvps?.[me.id]?.status : undefined;
  const deadlinePassed = !!s.rsvpConfig?.deadline && s.rsvpConfig.deadline < Date.now();
  const time = `${s.startTime || ''}${s.endTime ? `–${s.endTime}` : ''}`;

  return (
    <Card padded={false} className={`overflow-hidden ${selected ? 'ring-2 ring-indigo-500' : ''}`}>
      <button type="button" onClick={onOpen} aria-pressed={selecting ? !!selected : undefined} className="w-full flex items-center gap-3 p-3 sm:p-4 text-left cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
        {selecting && (
          <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 ${selected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-zinc-300 dark:border-zinc-600'}`} aria-hidden="true">
            {selected && <Check size={16} strokeWidth={3} />}
          </span>
        )}
        <span className="w-11 shrink-0 text-center leading-tight">
          <span className="block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 first-letter:uppercase">{weekday}</span>
          <span className="block text-xl font-bold">{d.getDate()}</span>
        </span>
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${KIND_TONE[kind]}`} aria-hidden="true">{KIND_ICON[kind]}</span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold truncate">
            {sessionTitle(s)}
            {s.homeAway && <span className="ml-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">{s.homeAway === 'home' ? 'Hemma' : 'Borta'}</span>}
            {isCoachOrAdmin && s.seriesId && <span className="ml-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-300">Återkommande</span>}
            {isCoachOrAdmin && s.lok === false && <span className="ml-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Ej LOK</span>}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {time && <span className="inline-flex items-center gap-1"><Clock size={12} />{time}{s.gatheringTime ? ` · samling ${s.gatheringTime}` : ''}</span>}
            {s.location && <span className="inline-flex items-center gap-1 min-w-0"><MapPin size={12} /><span className="truncate">{s.location}</span></span>}
          </span>
          {isCoachOrAdmin && (
            past || hasInvite ? (
              <span className="block mt-2 space-y-1">
                <GroupLine label="Spelare" session={s} people={players} past={past} />
                {/* Kommande: bara ledare som är kallade (valt den typen av pass); genomförda: alla, för närvaron */}
                {leaders.length > 0 && <GroupLine label="Tränare" session={s} people={past ? leaders : leaders.filter(p => isCalled(s, p))} past={past} />}
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
