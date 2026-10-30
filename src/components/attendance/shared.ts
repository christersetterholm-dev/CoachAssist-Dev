/**
 * Gemensamt för menyn Närvaro: tider för ett pass, typ och svar på kallelse.
 */
import { RsvpStatus, SquadPlayer, TrainingSession } from '../../types';
import { saveRsvp } from '../../lib/firebase';
import { categorizeSession, SessionCategory } from '../../utils/sessionCategory';

export const sessionStart = (s: TrainingSession) => {
  const d = new Date(s.date);
  const [h, m] = (s.startTime || '00:00').split(':').map(Number);
  if (!isNaN(h)) d.setHours(h, isNaN(m) ? 0 : m, 0, 0);
  return d.getTime();
};

export const sessionEnd = (s: TrainingSession) => {
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

// "2026-10-21" för datumrutorna (lokal tid)
export const toDateInput = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const CATEGORY_LABEL: Record<SessionCategory, string> = { training: 'Träning', match: 'Match', other: 'Övrig aktivitet' };

export const sessionTitle = (s: TrainingSession) => s.title?.trim() || CATEGORY_LABEL[categorizeSession(s)];

/** Lagets spelare (inte ledarrader). */
export const teamPlayers = (squad: SquadPlayer[]) => squad.filter(p => p.role !== 'leader' && !p.id.endsWith('_leader'));

/** Lagets tränare/ledare. Den som också är spelare räknas bara som spelare. */
export const teamLeaders = (squad: SquadPlayer[]) => {
  const playerIds = new Set(teamPlayers(squad).map(p => p.id));
  return squad.filter(p => (p.role === 'leader' || p.id.endsWith('_leader')) && !playerIds.has(p.id.replace(/_leader$/, '')));
};

/** Den inloggades egen rad i truppen (spelarraden före ledarraden). */
export const myRow = (squad: SquadPlayer[]) => {
  const mine = squad.filter(p => p.isMe);
  return mine.find(p => p.role !== 'leader') || mine[0] || null;
};

// Svar och närvaro sparas på truppradens id; ledarrader (<id>_leader) kan ha svarat på grund-id:t.
const rsvpOf = (s: TrainingSession, p: SquadPlayer) => s.rsvps?.[p.id] || s.rsvps?.[p.id.replace(/_leader$/, '')];

export const isPresent = (s: TrainingSession, p: SquadPlayer) => {
  const att = s.attendance || [];
  return att.includes(p.id) || att.includes(p.id.replace(/_leader$/, ''));
};

/**
 * Är personen kallad till passet? Ledare som bara är ledare (rsvpTypes finns) kallas bara till de typer
 * av pass de valt; den som ändå har svarat eller är bockad som närvarande räknas med. Alla andra är kallade.
 */
export const isCalled = (s: TrainingSession, p: SquadPlayer) =>
  !p.rsvpTypes || p.rsvpTypes.includes(categorizeSession(s)) || !!rsvpOf(s, p) || isPresent(s, p);

/** Svaret i summeringarna: den som är bockad som närvarande men inte svarat räknas som Kommer. */
export const answerStatus = (s: TrainingSession, p: SquadPlayer): RsvpStatus | undefined =>
  rsvpOf(s, p)?.status || (isPresent(s, p) ? 'attending' : undefined);

export const responseSummary = (s: TrainingSession, people: SquadPlayer[]) => {
  let attending = 0, partial = 0, declined = 0;
  people.forEach(p => {
    const st = answerStatus(s, p);
    if (st === 'attending') attending++;
    else if (st === 'partial') partial++;
    else if (st === 'declined') declined++;
  });
  return { attending, partial, declined, unanswered: Math.max(0, people.length - attending - partial - declined) };
};

export type SplitCount = { players: number; leaders: number };

/**
 * Svaren på en kallelse uppdelade på spelare och ledare (för Översikt och passvyn).
 * Provspelare (pass.guestPlayers) läggs till just det här passet och räknas som spelare som kommer.
 */
export const rsvpCounts = (s: TrainingSession, squad: SquadPlayer[]) => {
  const players = teamPlayers(squad);
  const p = responseSummary(s, players);
  const l = responseSummary(s, teamLeaders(squad).filter(p => isCalled(s, p)));
  const guests = (s.guestPlayers || []).length;
  const split = (k: 'attending' | 'partial' | 'declined' | 'unanswered', extra = 0): SplitCount => ({ players: p[k] + extra, leaders: l[k] });
  return {
    attending: split('attending', guests),
    partial: split('partial'),
    declined: split('declined'),
    unanswered: split('unanswered'),
    guests,
    totalPlayers: players.length + guests,
  };
};

/**
 * Den inloggade svarar själv på en kallelse. Samma svar igen tar bort svaret.
 * Passet uppdateras direkt i appen och sparas sedan med /api/rsvp; går det inte återställs det.
 */
export async function answerForMe(opts: {
  session: TrainingSession;
  me: SquadPlayer;
  status: RsvpStatus;
  clubId?: string | null;
  teamId?: string | null;
  onUpdateSession: (s: TrainingSession) => void;
}) {
  const { session: s, me, status, clubId, teamId, onUpdateSession } = opts;
  const current = s.rsvps?.[me.id]?.status || null;
  const finalStatus = current === status ? null : status;
  const rsvps = { ...(s.rsvps || {}) };
  const attendance = [...(s.attendance || [])].filter(id => id !== me.id);
  if (finalStatus) {
    rsvps[me.id] = { status: finalStatus, updatedAt: Date.now(), updatedBy: me.name, comment: s.rsvps?.[me.id]?.comment };
    if (finalStatus !== 'declined') attendance.push(me.id);
  } else {
    delete rsvps[me.id];
  }
  onUpdateSession({ ...s, rsvps, attendance, updatedAt: Date.now() });
  try {
    if (clubId && teamId) {
      await saveRsvp({ clubId, teamId, sessionId: s.id, memberId: me.id, status: finalStatus, comment: rsvps[me.id]?.comment });
    }
  } catch (err) {
    onUpdateSession(s);
    throw err;
  }
}
