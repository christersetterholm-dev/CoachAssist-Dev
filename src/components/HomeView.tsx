/**
 * Översikt – appens startsida. Visar det viktigaste just nu:
 * nästa aktivitet (med svar på kallelsen för spelare, svarsläge för tränare),
 * kommande aktiviteter, snabbval och poängligans topp.
 */
import React, { useMemo, useState } from 'react';
import {
  Calendar, Clock, MapPin, Check, X, HelpCircle, ChevronRight, Plus, Trophy, Shirt, Users,
  ClipboardList, Swords, Dumbbell, UserPlus, Medal, Presentation,
} from 'lucide-react';
import { Exercise, Period, SquadPlayer, TrainingSession, RsvpStatus, UserProfile } from '../types';
import { User, saveRsvp } from '../lib/firebase';
import { calculateLeaderboard } from '../lib/leaderboardUtils';
import { isMatchSession } from '../utils/sessionCategory';
import { Avatar, Badge, Button, Card, EmptyState, SectionHeader } from './ui';

interface HomeViewProps {
  user: User | null;
  userProfile: UserProfile;
  isCoachOrAdmin: boolean;
  canViewLineup: boolean;
  squad: SquadPlayer[];
  sessions: TrainingSession[];
  exercises: Exercise[];
  periods: Period[];
  pendingRequests: number;
  onOpenPendingRequests: () => void;
  onOpenSession: (id: string, tab?: 'schema' | 'attendance' | 'rsvp') => void;
  onOpenLineupForSession: (session: TrainingSession) => void;
  onNavigate: (view: 'training' | 'squad' | 'lineup' | 'leaderboard' | 'tacticalboards') => void;
  onNewSession: () => void;
  onNewExercise: () => void;
  onUpdateSession: (session: TrainingSession) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const sessionStart = (s: TrainingSession) => {
  const d = new Date(s.date);
  const [h, m] = (s.startTime || '00:00').split(':').map(Number);
  if (!isNaN(h)) d.setHours(h, isNaN(m) ? 0 : m, 0, 0);
  return d.getTime();
};

const sessionEnd = (s: TrainingSession) => {
  if (s.endTime) {
    const d = new Date(s.date);
    const [h, m] = s.endTime.split(':').map(Number);
    if (!isNaN(h)) {
      d.setHours(h, isNaN(m) ? 0 : m, 0, 0);
      return d.getTime();
    }
  }
  return sessionStart(s) + 2 * 60 * 60 * 1000;
};

const relativeDay = (ts: number) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / DAY_MS);
  if (diff === 0) return 'Idag';
  if (diff === 1) return 'Imorgon';
  const label = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'short' });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const kindOf = (s: TrainingSession) => (isMatchSession(s) ? 'match' : 'training');

const statusLabel: Record<RsvpStatus, string> = { attending: 'Kommer', partial: 'Delvis', declined: 'Kommer inte' };

const RsvpButtons: React.FC<{ value: RsvpStatus | null; onChange: (s: RsvpStatus) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => {
  const opts: { id: RsvpStatus; label: string; icon: React.ReactNode; on: string }[] = [
    { id: 'attending', label: 'Kommer', icon: <Check size={18} strokeWidth={2.6} />, on: 'bg-emerald-600 text-white border-emerald-600' },
    { id: 'partial', label: 'Delvis', icon: <HelpCircle size={18} />, on: 'bg-amber-500 text-white border-amber-500' },
    { id: 'declined', label: 'Kan inte', icon: <X size={18} strokeWidth={2.6} />, on: 'bg-red-600 text-white border-red-600' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {opts.map(o => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`h-12 rounded-xl border text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 ${
            value === o.id
              ? o.on
              : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-750'
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
};

const KindIcon: React.FC<{ session: TrainingSession; size?: number }> = ({ session, size = 20 }) =>
  kindOf(session) === 'match' ? <Swords size={size} /> : <Dumbbell size={size} />;

export default function HomeView(props: HomeViewProps) {
  const {
    user, userProfile, isCoachOrAdmin, canViewLineup, squad, sessions, exercises, periods, pendingRequests,
    onOpenPendingRequests, onOpenSession, onOpenLineupForSession, onNavigate, onNewSession, onNewExercise, onUpdateSession,
  } = props;
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const me = useMemo(() => {
    const mine = squad.filter(p => p.isMe);
    return mine.find(p => p.role !== 'leader') || mine[0] || null;
  }, [squad]);

  const players = useMemo(() => squad.filter(p => p.role !== 'leader' && !p.id.endsWith('_leader')), [squad]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return sessions
      .filter(s => !s.isIgnored && sessionEnd(s) >= now)
      .sort((a, b) => sessionStart(a) - sessionStart(b));
  }, [sessions]);

  const next = upcoming[0] || null;
  const later = upcoming.slice(1, 6);

  const recentCompleted = useMemo(() => {
    const now = Date.now();
    return sessions
      .filter(s => !s.isIgnored && sessionEnd(s) < now)
      .sort((a, b) => sessionStart(b) - sessionStart(a))[0] || null;
  }, [sessions]);

  const activePeriod = periods.find(p => p.isActive) || null;
  const topList = useMemo(() => {
    if (!activePeriod) return [];
    try {
      return calculateLeaderboard(squad, exercises, activePeriod.id, periods, sessions)
        .filter(p => p.totalPoints > 0)
        .sort((a, b) => b.totalPoints - a.totalPoints)
        .slice(0, 5);
    } catch {
      return [];
    }
  }, [squad, exercises, activePeriod, periods, sessions]);

  const responseSummary = (s: TrainingSession) => {
    const r = s.rsvps || {};
    let attending = 0, partial = 0, declined = 0;
    players.forEach(p => {
      const st = r[p.id]?.status;
      if (st === 'attending') attending++;
      else if (st === 'partial') partial++;
      else if (st === 'declined') declined++;
    });
    return { attending, partial, declined, unanswered: Math.max(0, players.length - attending - partial - declined) };
  };

  const answer = async (s: TrainingSession, status: RsvpStatus) => {
    if (!me) return;
    const current = s.rsvps?.[me.id]?.status || null;
    const finalStatus = current === status ? null : status;
    const rsvps = { ...(s.rsvps || {}) };
    let attendance = [...(s.attendance || [])].filter(id => id !== me.id);
    if (finalStatus) {
      rsvps[me.id] = { status: finalStatus, updatedAt: Date.now(), updatedBy: me.name, comment: s.rsvps?.[me.id]?.comment };
      if (finalStatus !== 'declined') attendance.push(me.id);
    } else {
      delete rsvps[me.id];
    }
    setRsvpError(null);
    setSavingId(s.id);
    onUpdateSession({ ...s, rsvps, attendance, updatedAt: Date.now() });
    try {
      if (user && userProfile.activeClubId && userProfile.activeTeamId) {
        await saveRsvp({
          clubId: userProfile.activeClubId,
          teamId: userProfile.activeTeamId,
          sessionId: s.id,
          memberId: me.id,
          status: finalStatus,
          comment: rsvps[me.id]?.comment,
        });
      }
    } catch (err: any) {
      setRsvpError(err?.message || 'Svaret kunde inte sparas. Försök igen.');
      onUpdateSession(s);
    } finally {
      setSavingId(null);
    }
  };

  const firstName = (userProfile.fullName || user?.displayName || me?.name || '').split(' ')[0];
  const todayLabel = new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-6">
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 first-letter:uppercase">{todayLabel}</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mt-0.5">{firstName ? `Hej ${firstName}!` : 'Hej!'}</h2>
        </div>

        {isCoachOrAdmin && pendingRequests > 0 && (
          <Card className="flex items-center gap-3 border-indigo-200 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/30">
            <span className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <UserPlus size={20} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{pendingRequests === 1 ? 'En ny medlem vill gå med' : `${pendingRequests} nya medlemmar vill gå med`}</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">Godkänn eller neka ansökningarna.</div>
            </div>
            <Button size="sm" onClick={onOpenPendingRequests}>Granska</Button>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-6 min-w-0">
            {/* Nästa aktivitet */}
            <section>
              <SectionHeader title="Nästa aktivitet" icon={<Calendar size={16} />} action={
                <button type="button" onClick={() => onNavigate('training')} className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-0.5 cursor-pointer">
                  Kalender <ChevronRight size={16} />
                </button>
              } />
              {next ? (
                <Card padded={false} className="overflow-hidden">
                  <button type="button" onClick={() => onOpenSession(next.id, isCoachOrAdmin ? 'schema' : 'rsvp')} className="w-full text-left p-4 sm:p-5 cursor-pointer hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors">
                    <div className="flex items-start gap-3.5">
                      <span className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${kindOf(next) === 'match' ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
                        <KindIcon session={next} size={22} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge tone={kindOf(next) === 'match' ? 'danger' : 'success'}>{kindOf(next) === 'match' ? 'Match' : 'Träning'}</Badge>
                          <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">{relativeDay(next.date)}</span>
                        </div>
                        <h3 className="mt-1.5 text-lg font-bold leading-snug">{next.title || (kindOf(next) === 'match' ? 'Match' : 'Träning')}</h3>
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                          <span className="inline-flex items-center gap-1.5"><Clock size={15} />{next.startTime}{next.endTime ? `–${next.endTime}` : ''}</span>
                          {next.location && <span className="inline-flex items-center gap-1.5 min-w-0"><MapPin size={15} className="shrink-0" /><span className="truncate">{next.location}</span></span>}
                        </div>
                      </div>
                      <ChevronRight size={20} className="text-zinc-400 shrink-0 mt-3" />
                    </div>
                  </button>

                  <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-1 space-y-3">
                    {!isCoachOrAdmin && me && (
                      <>
                        <div className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                          {next.rsvps?.[me.id] ? `Ditt svar: ${statusLabel[next.rsvps[me.id].status]}` : 'Kommer du?'}
                        </div>
                        <RsvpButtons value={next.rsvps?.[me.id]?.status || null} onChange={s => answer(next, s)} disabled={savingId === next.id} />
                      </>
                    )}
                    {isCoachOrAdmin && (() => {
                      const r = responseSummary(next);
                      const total = Math.max(1, players.length);
                      return (
                        <>
                          <div className="flex h-2.5 rounded-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                            <div className="bg-emerald-500" style={{ width: `${(r.attending / total) * 100}%` }} />
                            <div className="bg-amber-400" style={{ width: `${(r.partial / total) * 100}%` }} />
                            <div className="bg-red-500" style={{ width: `${(r.declined / total) * 100}%` }} />
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-center">
                            {[
                              { n: r.attending, l: 'Kommer', c: 'text-emerald-600 dark:text-emerald-400' },
                              { n: r.partial, l: 'Delvis', c: 'text-amber-600 dark:text-amber-400' },
                              { n: r.declined, l: 'Kan inte', c: 'text-red-600 dark:text-red-400' },
                              { n: r.unanswered, l: 'Ej svarat', c: 'text-zinc-500' },
                            ].map(x => (
                              <div key={x.l}>
                                <div className={`text-xl font-bold ${x.c}`}>{x.n}</div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">{x.l}</div>
                              </div>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Button size="sm" icon={<ClipboardList size={16} />} onClick={() => onOpenSession(next.id, 'schema')}>Planera</Button>
                            <Button size="sm" variant="secondary" icon={<Users size={16} />} onClick={() => onOpenSession(next.id, 'rsvp')}>Kallelse & svar</Button>
                            {kindOf(next) === 'match' && canViewLineup && (
                              <Button size="sm" variant="secondary" icon={<Shirt size={16} />} onClick={() => onOpenLineupForSession(next)}>Uppställning</Button>
                            )}
                          </div>
                        </>
                      );
                    })()}
                    {rsvpError && <p className="text-sm text-red-600 dark:text-red-400">{rsvpError}</p>}
                  </div>
                </Card>
              ) : (
                <Card>
                  <EmptyState
                    icon={<Calendar size={26} />}
                    title="Inga kommande aktiviteter"
                    text={isCoachOrAdmin ? 'Lägg in en träning eller match, eller koppla lagets kalender under Kalender.' : 'När tränarna lagt in träningar och matcher syns de här.'}
                    action={isCoachOrAdmin ? <Button icon={<Plus size={18} />} onClick={onNewSession}>Ny aktivitet</Button> : undefined}
                  />
                </Card>
              )}
            </section>

            {/* Kommande */}
            {later.length > 0 && (
              <section>
                <SectionHeader title="Kommande" />
                <Card padded={false} className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {later.map(s => {
                    const my = me ? s.rsvps?.[me.id]?.status : undefined;
                    const r = isCoachOrAdmin ? responseSummary(s) : null;
                    return (
                      <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                        <button type="button" onClick={() => onOpenSession(s.id, isCoachOrAdmin ? 'schema' : 'rsvp')} className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer">
                          <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${kindOf(s) === 'match' ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
                            <KindIcon session={s} size={18} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold truncate">{s.title || (kindOf(s) === 'match' ? 'Match' : 'Träning')}</span>
                            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{relativeDay(s.date)} · {s.startTime}</span>
                          </span>
                        </button>
                        {!isCoachOrAdmin && me && (
                          <div className="flex gap-1">
                            {(['attending', 'declined'] as RsvpStatus[]).map(st => (
                              <button
                                key={st}
                                type="button"
                                disabled={savingId === s.id}
                                onClick={() => answer(s, st)}
                                title={statusLabel[st]}
                                aria-label={statusLabel[st]}
                                aria-pressed={my === st}
                                className={`w-10 h-10 rounded-xl border flex items-center justify-center cursor-pointer transition-all ${
                                  my === st
                                    ? st === 'attending' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-red-600 border-red-600 text-white'
                                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                }`}
                              >
                                {st === 'attending' ? <Check size={18} strokeWidth={2.6} /> : <X size={18} strokeWidth={2.6} />}
                              </button>
                            ))}
                          </div>
                        )}
                        {r && (
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{r.attending + r.partial}</div>
                            <div className="text-[11px] text-zinc-500">kommer</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </Card>
              </section>
            )}
          </div>

          <div className="space-y-6 min-w-0">
            {isCoachOrAdmin && (
              <section>
                <SectionHeader title="Snabbval" />
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Ny aktivitet', icon: <Plus size={20} />, onClick: onNewSession },
                    { label: 'Tävlingsmoment', icon: <Trophy size={20} />, onClick: onNewExercise },
                    { label: 'Taktiktavla', icon: <Presentation size={20} />, onClick: () => onNavigate('tacticalboards') },
                    { label: 'Truppen', icon: <Users size={20} />, onClick: () => onNavigate('squad') },
                  ].map(a => (
                    <Card key={a.label} interactive onClick={a.onClick} className="flex flex-col items-start gap-3 !p-4">
                      <span className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">{a.icon}</span>
                      <span className="text-sm font-semibold">{a.label}</span>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            <section>
              <SectionHeader title={activePeriod ? `Poängliga · ${activePeriod.name}` : 'Poängliga'} icon={<Trophy size={16} />} action={
                <button type="button" onClick={() => onNavigate('leaderboard')} className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-0.5 cursor-pointer">
                  Visa allt <ChevronRight size={16} />
                </button>
              } />
              <Card padded={false}>
                {topList.length > 0 ? (
                  <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {topList.map((p, i) => (
                      <li key={p.id} className={`flex items-center gap-3 px-4 py-2.5 ${p.isMe ? 'bg-indigo-50/60 dark:bg-indigo-950/30' : ''}`}>
                        <span className={`w-7 text-center text-sm font-bold ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-zinc-400' : i === 2 ? 'text-orange-500' : 'text-zinc-400'}`}>
                          {i < 3 ? <Medal size={18} className="inline" /> : i + 1}
                        </span>
                        <Avatar name={p.name} photoUrl={p.photoUrl} size={32} />
                        <span className="flex-1 min-w-0 text-sm font-semibold truncate">{p.name}{p.isMe ? ' (du)' : ''}</span>
                        <span className="text-base font-bold tabular-nums">{p.totalPoints}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <EmptyState
                    className="!py-8"
                    icon={<Trophy size={24} />}
                    title={activePeriod ? 'Inga poäng ännu' : 'Ingen aktiv tävling'}
                    text={isCoachOrAdmin ? 'Poäng delas ut när ett tävlingsmoment avslutas.' : 'Poängen visas här när tränarna avslutat tävlingsmoment.'}
                  />
                )}
              </Card>
            </section>

            {recentCompleted && isCoachOrAdmin && (
              <section>
                <SectionHeader title="Senast genomförd" />
                <Card interactive onClick={() => onOpenSession(recentCompleted.id, 'attendance')} className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center justify-center shrink-0">
                    <KindIcon session={recentCompleted} size={18} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{recentCompleted.title || 'Aktivitet'}</div>
                    <div className="text-xs text-zinc-500">{relativeDay(recentCompleted.date)} · {(recentCompleted.attendance || []).length} närvarande</div>
                  </div>
                  <ChevronRight size={18} className="text-zinc-400" />
                </Card>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
