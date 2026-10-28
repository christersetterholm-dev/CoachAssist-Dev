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

/** Den inloggades egen rad i truppen (spelarraden före ledarraden). */
export const myRow = (squad: SquadPlayer[]) => {
  const mine = squad.filter(p => p.isMe);
  return mine.find(p => p.role !== 'leader') || mine[0] || null;
};

export const responseSummary = (s: TrainingSession, players: SquadPlayer[]) => {
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
