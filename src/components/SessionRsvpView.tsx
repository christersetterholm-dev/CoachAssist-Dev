import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  CheckCircle2,
  Clock,
  Send,
  MessageSquare,
  Lock,
  Users,
  Check,
  Search,
  HelpCircle,
  ExternalLink,
  Clipboard,
  ClipboardPaste,
  ClipboardCheck,
  UserPlus,
  CheckCheck,
  RotateCcw,
  Trash2,
  Trophy,
  ChevronRight,
  X,
  MapPin,
  CalendarDays,
  Megaphone,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TrainingSession, SquadPlayer, RsvpStatus, PlayerRsvp, SessionRsvpConfig, UserProfile } from '../types';
import { findSquadMatch } from '../lib/teamUtils';
import { saveRsvp, clearRsvps } from '../lib/firebase';
import { isMatchSession } from '../utils/sessionCategory';
import { Button, Card, SectionHeader, SegmentedTabs, Badge, EmptyState, Avatar, Sheet, MenuItem, TextArea, TextInput } from './ui';

interface SessionRsvpViewProps {
  session: TrainingSession;
  squad?: SquadPlayer[];
  onUpdateSession: (updated: TrainingSession) => void;
  user?: any;
  userRoles?: string[];
  userProfile?: UserProfile;
  adminUrl?: string;
  onOpenLineup?: (session: TrainingSession) => void;
}

type Filter = 'all' | 'present' | 'attending' | 'partial' | 'declined' | 'unanswered' | 'guests';

const inputClass =
  'w-full h-11 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3.5 text-base sm:text-sm text-zinc-900 dark:text-white placeholder-zinc-400 outline-none focus:ring-2 focus:ring-indigo-500';
const labelClass = 'block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5';

const statusMeta: Record<RsvpStatus | 'unanswered', { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; icon: React.ReactNode }> = {
  attending: { label: 'Kommer', tone: 'success', icon: <Check size={12} strokeWidth={3} /> },
  partial: { label: 'Delvis', tone: 'warning', icon: <HelpCircle size={12} /> },
  declined: { label: 'Kan inte', tone: 'danger', icon: <X size={12} strokeWidth={3} /> },
  unanswered: { label: 'Ej svarat', tone: 'neutral', icon: <Clock size={12} /> },
};

const formatDeadline = (ts: number) =>
  new Date(ts).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const toDateInput = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Sluttid: angiven sluttid, annars starttid + summan av momenten. */
const sessionEndTime = (s: TrainingSession) => {
  if (s.endTime) return s.endTime;
  const [h, m] = (s.startTime || '00:00').split(':').map(Number);
  const total = (s.moments || []).reduce((acc, mo) => acc + (Number(mo.duration) || 0), 0);
  if (!total) return '';
  const d = new Date();
  d.setHours(h || 0, (m || 0) + total, 0, 0);
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
};

/** Tre stora svarsknappar: Kommer / Delvis / Kan inte. */
const RsvpButtons: React.FC<{ value: RsvpStatus | null; onChange: (s: RsvpStatus) => void; disabled?: boolean; compact?: boolean }> = ({ value, onChange, disabled, compact }) => {
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
          className={`${compact ? 'h-14 flex-col gap-0.5 text-xs' : 'h-12 gap-1.5 text-sm'} rounded-xl border font-semibold inline-flex items-center justify-center transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 ${
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

function isValidPlayerName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();

  // 1. Must contain at least one letter (a-z, including Swedish standard letters/accents)
  if (!/[a-zåäöéèüíóáñæø]/i.test(trimmed)) {
    return false;
  }

  // 2. Exact match check for common noise words, status labels or copy-paste artifacts
  const blockedExact = [
    'ja', 'nej', 'kanske', 'deltar', 'deltar ej', 'ej svarat', 'anmäld', 'anmälda', 'reserv',
    'kommentar', 'svara', 'obesvarad', 'obesvarade', 'status', 'tid', 'plats', 'avanmäld', 'avanmälda',
    'gäst', 'gästspelare', 'provspelare', 'ledare', 'tränare', 'spelare', 'ej svarat', 'har inte svarat',
    'nej tack', 'skjuts', 'bil', 'bilar', 'platser', 'lediga', 'ja tack', 'platser kvar',
    'platser lediga', 'förare', 'plats kvar', 'kör ej', 'kör', 'vill ha skjuts',
    'den', 'det', 'de', 'och', 'av', 'att', 'inbjudna', 'kallade', 'kallad',
    'deltagare', 'deltagit', 'datum', 'svar', 'svarat', 'svarade ej', 'inte svarat',
    'ingen', 'alla', 'samling', 'match', 'träning', 'information'
  ];
  if (blockedExact.includes(lower)) {
    return false;
  }

  // 3. Regular Expression patterns for status/driving/dates/times
  if (/\b\d+\s*(platser|plats|lediga|bilar|bil|skolkort|st|stycken)\b/i.test(lower)) {
    return false;
  }

  if (lower.startsWith('kommentar:') || lower.startsWith('svar saknas')) {
    return false;
  }
  if (lower.includes('platser') && (lower.includes('kvar') || lower.includes('lediga'))) {
    return false;
  }

  // Reject date fragments like "den 24 maj", "24 aug", "18:00"
  if (/^(den\s+)?\d{1,2}[\s./-](jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec|\d{1,2})/i.test(lower)) {
    return false;
  }

  if (trimmed.length < 2) {
    return false;
  }

  return true;
}

export const SessionRsvpView: React.FC<SessionRsvpViewProps> = ({
  session,
  squad = [],
  onUpdateSession,
  user,
  userRoles = [],
  userProfile,
  adminUrl,
  onOpenLineup
}) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const isMatch = useMemo(() => isMatchSession(session), [session]);

  const [confirmClear, setConfirmClear] = useState<'rsvps' | 'attendance' | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [pasteAlsoMarkPresent, setPasteAlsoMarkPresent] = useState<boolean>(true);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  // Egen kommentar (spelarens eget svar)
  const [myComment, setMyComment] = useState<string>('');

  // Tränarens redigering av en persons svar
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<RsvpStatus | null>(null);
  const [editComment, setEditComment] = useState('');

  // Kallelse
  const [deadlineDate, setDeadlineDate] = useState<string>('');
  const [deadlineTime, setDeadlineTime] = useState<string>('18:00');
  const [inviteNotes, setInviteNotes] = useState<string>('');

  // Klistra in lista
  const [pasteValue, setPasteValue] = useState<string>('');
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [clipboardStatus, setClipboardStatus] = useState<'idle' | 'pasted' | 'failed'>('idle');

  // Provspelare
  const [guestName, setGuestName] = useState<string>('');
  const [guestPosition, setGuestPosition] = useState<string>('');

  const showToast = (text: string, ms = 3000) => {
    setSavedToast(text);
    setTimeout(() => setSavedToast(null), ms);
  };

  useEffect(() => {
    if (showPasteModal) {
      setClipboardStatus('idle');
      const timer = setTimeout(() => {
        if (pasteTextareaRef.current) {
          pasteTextareaRef.current.focus();
          const len = pasteTextareaRef.current.value.length;
          pasteTextareaRef.current.setSelectionRange(len, len);
        }
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [showPasteModal]);

  const handlePasteFromClipboard = async () => {
    try {
      if (navigator?.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setPasteValue(text);
          setClipboardStatus('pasted');
          setTimeout(() => setClipboardStatus('idle'), 2500);
          pasteTextareaRef.current?.focus();
          return;
        }
      }
    } catch (err) {
      console.warn('Clipboard readText failed or was blocked by browser:', err);
      setClipboardStatus('failed');
      setTimeout(() => setClipboardStatus('idle'), 3000);
    }
    pasteTextareaRef.current?.focus();
  };

  const isCoachOrAdmin = useMemo(() => {
    if (!user) return true; // Offline / admin fallback
    return userRoles.includes('admin') || userRoles.includes('coach') || userRoles.includes('root_admin');
  }, [user, userRoles]);

  const safeSquad = useMemo(() => {
    return Array.isArray(squad) ? squad.filter(p => p && typeof p === 'object') : [];
  }, [squad]);

  const attendance = useMemo(() => {
    if (!Array.isArray(session?.attendance)) return [];
    return session.attendance
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return String((item as any).id || (item as any).name || '');
        return String(item || '');
      })
      .filter(Boolean);
  }, [session?.attendance]);

  const guestPlayers = useMemo<SquadPlayer[]>(() => {
    if (!Array.isArray(session?.guestPlayers)) return [];
    return session.guestPlayers
      .filter((p: any): p is SquadPlayer => Boolean(p && typeof p === 'object'))
      .map((p: SquadPlayer) => ({
        ...p,
        id: p.id || `guest_${p.name || Math.random().toString(36).substring(7)}`,
        name: p.name || 'Provspelare'
      }));
  }, [session?.guestPlayers]);

  // Truppen + provspelare
  const allMembers = useMemo<SquadPlayer[]>(() => {
    const list = [...safeSquad];
    guestPlayers.forEach(g => {
      if (!list.some(p => p.id === g.id)) list.push(g);
    });
    return list;
  }, [safeSquad, guestPlayers]);

  // Den inloggades egen rad i truppen (servern markerar den med isMe; spelarraden går före ledarraden).
  const matchedPlayer = useMemo(() => {
    if (safeSquad.length === 0) return null;
    const mine = safeSquad.filter(p => p.isMe);
    if (mine.length > 0) return mine.find(p => p.role !== 'leader') || mine[0];
    if (!user) return null;
    if (user.email) {
      const matchEmail = safeSquad.find(p => p.email?.toLowerCase().trim() === user.email?.toLowerCase().trim());
      if (matchEmail) return matchEmail;
    }
    return safeSquad.find(p => p.id === user.uid || (p as any).userId === user.uid) || null;
  }, [safeSquad, user]);

  const rsvps = session.rsvps || {};
  const myRsvp = matchedPlayer ? rsvps[matchedPlayer.id] : undefined;

  useEffect(() => {
    setMyComment(myRsvp?.comment || '');
  }, [matchedPlayer?.id, myRsvp?.comment]);

  const stats = useMemo(() => {
    let attending = 0, partial = 0, declined = 0, unanswered = 0;
    safeSquad.forEach(p => {
      const rsvp = rsvps[p.id];
      if (!rsvp) unanswered++;
      else if (rsvp.status === 'attending') attending++;
      else if (rsvp.status === 'partial') partial++;
      else if (rsvp.status === 'declined') declined++;
    });
    return { attending, partial, declined, unanswered, total: safeSquad.length, presentCount: attendance.length };
  }, [safeSquad, rsvps, attendance]);

  const handleTogglePresence = (id: string) => {
    if (!id) return;
    const isPresent = attendance.includes(id);
    onUpdateSession({
      ...session,
      attendance: isPresent ? attendance.filter(pid => pid !== id) : [...attendance, id],
      updatedAt: Date.now()
    });
  };

  const handleMarkAllPresent = () => {
    const allIds = allMembers.map(p => p.id).filter(Boolean);
    onUpdateSession({ ...session, attendance: Array.from(new Set(allIds)), updatedAt: Date.now() });
    showToast('Alla markerades som närvarande.');
  };

  const handleMarkAllRsvpdAsPresent = () => {
    const rsvpdIds = Object.entries(rsvps)
      .filter(([_, rsvp]) => {
        const r = rsvp as PlayerRsvp;
        return r && (r.status === 'attending' || r.status === 'partial');
      })
      .map(([playerId]) => playerId);

    if (rsvpdIds.length === 0) {
      showToast('Ingen har svarat Kommer eller Delvis än.');
      return;
    }
    onUpdateSession({ ...session, attendance: Array.from(new Set([...attendance, ...rsvpdIds])), updatedAt: Date.now() });
    showToast('Alla som svarat Kommer eller Delvis är markerade som närvarande.');
  };

  const handleClearAttendance = () => {
    onUpdateSession({ ...session, attendance: [], updatedAt: Date.now() });
    setConfirmClear(null);
    showToast('Närvaron har rensats.');
  };

  const handleClearRsvps = () => {
    if (user && userProfile?.activeClubId && userProfile?.activeTeamId) {
      clearRsvps({ clubId: userProfile.activeClubId, teamId: userProfile.activeTeamId, sessionId: session.id }).catch((err) => {
        showToast(err?.message || 'Svaren kunde inte rensas', 4000);
      });
    }
    onUpdateSession({ ...session, rsvps: {}, updatedAt: Date.now() });
    setMyComment('');
    setConfirmClear(null);
    showToast('Alla svar har rensats för passet.');
  };

  /**
   * Sparar eller tar bort ett svar och uppdaterar närvaron.
   * toggle = true: samma status igen tar bort svaret (används när spelaren trycker på sina knappar).
   */
  const saveRsvpForPlayer = (playerId: string, targetStatus: RsvpStatus | null, comment?: string, byWho?: string, toggle = false) => {
    const currentRsvps = session.rsvps || {};
    const currentRsvp = currentRsvps[playerId];

    const isClearing = toggle && targetStatus !== null && currentRsvp?.status === targetStatus;
    const finalStatus = isClearing ? null : targetStatus;

    const newRsvps: Record<string, PlayerRsvp> = { ...currentRsvps };
    let newAttendance = [...attendance];

    if (finalStatus === null) {
      delete newRsvps[playerId];
      newAttendance = newAttendance.filter(id => id !== playerId);
    } else {
      newRsvps[playerId] = {
        status: finalStatus,
        comment: comment?.trim() || undefined,
        updatedAt: Date.now(),
        updatedBy: byWho || (user?.displayName || user?.email || 'Spelare')
      };
      if (finalStatus === 'attending' || finalStatus === 'partial') {
        if (!newAttendance.includes(playerId)) newAttendance.push(playerId);
      } else if (finalStatus === 'declined') {
        newAttendance = newAttendance.filter(id => id !== playerId);
      }
    }

    // Svaret sparas direkt på servern (egen rad per person), sedan uppdateras vyn.
    const clubId = userProfile?.activeClubId;
    const teamId = userProfile?.activeTeamId;
    if (user && clubId && teamId) {
      saveRsvp({ clubId, teamId, sessionId: session.id, memberId: playerId, status: finalStatus, comment: comment?.trim() || undefined })
        .catch((err) => showToast(err?.message || 'Svaret kunde inte sparas', 4000));
    }

    onUpdateSession({ ...session, rsvps: newRsvps, attendance: newAttendance, updatedAt: Date.now() });
    showToast(finalStatus === null ? 'Svaret togs bort' : 'Svaret är sparat');
  };

  const coachName = () => `Tränare (${user?.displayName || user?.email || 'Tränare'})`;

  const openEdit = (player: SquadPlayer) => {
    setEditTargetId(player.id);
    setEditStatus(rsvps[player.id]?.status || null);
    setEditComment(rsvps[player.id]?.comment || '');
  };

  const editTarget = editTargetId ? allMembers.find(p => p.id === editTargetId) || null : null;
  const editTargetIsGuest = !!editTarget?.id.startsWith('guest_');

  const handleSaveEdit = () => {
    if (!editTarget) return;
    const existing = rsvps[editTarget.id];
    const unchanged = (existing?.status || null) === editStatus && (existing?.comment || '') === editComment.trim();
    if (!unchanged) saveRsvpForPlayer(editTarget.id, editStatus, editComment, coachName());
    setEditTargetId(null);
  };

  const openInvite = () => {
    const cfg = session.rsvpConfig;
    if (cfg?.deadline) {
      setDeadlineDate(toDateInput(cfg.deadline));
      setDeadlineTime(new Date(cfg.deadline).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }));
    } else {
      setDeadlineDate('');
      setDeadlineTime('18:00');
    }
    setInviteNotes(cfg?.notes || '');
    setShowInviteModal(true);
  };

  const handleSendInvitations = (e?: React.FormEvent) => {
    e?.preventDefault();
    let deadlineTimestamp: number | undefined = undefined;
    if (deadlineDate) {
      deadlineTimestamp = new Date(`${deadlineDate}T${deadlineTime || '18:00'}`).getTime();
    }
    const newConfig: SessionRsvpConfig = {
      deadline: deadlineTimestamp,
      notes: inviteNotes.trim() || undefined,
      invitedAt: session.rsvpConfig?.invitedAt || Date.now(),
      invitedCount: safeSquad.length
    };
    onUpdateSession({ ...session, rsvpConfig: newConfig, updatedAt: Date.now() });
    setShowInviteModal(false);
    showToast(session.rsvpConfig ? 'Kallelsen är uppdaterad.' : 'Kallelsen är publicerad. Spelarna ser den i appen.', 4000);
  };

  const handleAddGuest = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!guestName.trim()) return;
    const newGuest: SquadPlayer = {
      id: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      name: guestName.trim(),
      position: guestPosition.trim() || undefined,
    };
    onUpdateSession({
      ...session,
      guestPlayers: [...guestPlayers, newGuest],
      attendance: [...attendance, newGuest.id],
      updatedAt: Date.now()
    });
    setGuestName('');
    setGuestPosition('');
    setShowGuestModal(false);
    showToast(`${newGuest.name} lades till som provspelare och är markerad som närvarande.`);
  };

  const removeGuest = (id: string) => {
    onUpdateSession({
      ...session,
      guestPlayers: guestPlayers.filter(p => p && p.id !== id),
      attendance: attendance.filter(pid => pid !== id),
      updatedAt: Date.now()
    });
  };

  const updateGuestPosition = (guestId: string, position: string) => {
    onUpdateSession({
      ...session,
      guestPlayers: guestPlayers.map(p => (p && p.id === guestId) ? { ...p, position: position || undefined } : p),
      updatedAt: Date.now()
    });
  };

  // Klistra in lista: läser in svar och kommentarer; markerar närvaro bara om pasteAlsoMarkPresent är ikryssad.
  // Paste list parsing - Imports RSVPs (Anmälningar) & Comments, does NOT touch physical attendance unless pasteAlsoMarkPresent is checked
  const handlePaste = () => {
    const lines = pasteValue.split(/[\n;]/);
    
    // Matched responses from paste: targetPlayerId -> { status, comment }
    const matchedRsvps: Record<string, { status: RsvpStatus | 'unanswered'; comment?: string }> = {};
    let newGuestPlayers = [...guestPlayers];
    const coachName = user?.displayName || user?.email || 'Tränare';

    // Sticky section state (for lists organized under headers like "Deltar (18)", "Deltar ej (3)", "Ej svarat (5)")
    let currentSectionStatus: RsvpStatus | 'unanswered' = 'attending';

    lines.forEach(line => {
      let trimmed = line.trim();
      if (!trimmed) return;

      // Check if line is purely a section header (e.g. "Deltar (18)", "Deltar ej (3)", "Ej svarat (5)", "Kommer (15)")
      const cleanHeaderTest = trimmed.replace(/\([^)]*\)/g, '').replace(/\d+/g, '').replace(/[-:–—\t]/g, '').trim().toLowerCase();
      
      if (/^(deltar ej|kommer inte|kommer ej|nej|kan inte|kan ej|avanmäld|avanmälda|frånvarande|sjuk|bortrest)$/i.test(cleanHeaderTest)) {
        currentSectionStatus = 'declined';
        return;
      } else if (/^(deltar|kommer|ja|kan delta|anmäld|anmälda|kallade som deltar)$/i.test(cleanHeaderTest)) {
        currentSectionStatus = 'attending';
        return;
      } else if (/^(ej svarat|har inte svarat|obesvarad|obesvarade|svar saknas|svarade ej|inte svarat)$/i.test(cleanHeaderTest)) {
        currentSectionStatus = 'unanswered';
        return;
      } else if (/^(delvis|kanske|osäker|osäkra)$/i.test(cleanHeaderTest)) {
        currentSectionStatus = 'partial';
        return;
      }

      let extractedComment: string | undefined = undefined;

      // 1. Check for comment inside parentheses, e.g. "Haythem Noor Deltar (Kommer 10 min sent)"
      const parenMatch = trimmed.match(/\(([^)]+)\)/);
      if (parenMatch) {
        const insideParen = parenMatch[1].trim();
        // If parentheses just contains a count like (18) or (1), ignore as comment
        if (!/^\d+$/.test(insideParen)) {
          extractedComment = insideParen;
        }
        trimmed = trimmed.replace(/\([^)]+\)/, '').trim();
      }

      let detectedStatus: RsvpStatus | 'unanswered' = currentSectionStatus;
      let nameOnly = trimmed;

      const lowerLine = trimmed.toLowerCase();

      // Detect explicit inline status keywords in Swedish
      if (/\b(deltar ej|deltar inte|kan ej|kan inte|kommer ej|kommer inte|nej|ej med|avanmäld|frånvarande|sjuk|bortrest)\b/i.test(lowerLine)) {
        detectedStatus = 'declined';
        nameOnly = trimmed.replace(/\b(deltar ej|deltar inte|kan ej|kan inte|kommer ej|kommer inte|nej|ej med|avanmäld|frånvarande|sjuk|bortrest)\b/gi, '').trim();
      } else if (/\b(deltar|kommer|ja|kan delta|anmäld)\b/i.test(lowerLine)) {
        detectedStatus = 'attending';
        nameOnly = trimmed.replace(/\b(deltar|kommer|ja|kan delta|anmäld)\b/gi, '').trim();
      } else if (/\b(delvis|kanske|osäker)\b/i.test(lowerLine)) {
        detectedStatus = 'partial';
        nameOnly = trimmed.replace(/\b(delvis|kanske|osäker)\b/gi, '').trim();
      } else if (/\b(ej svarat|har inte svarat|obesvarad|svar saknas|svarade ej|inte svarat)\b/i.test(lowerLine)) {
        detectedStatus = 'unanswered';
        nameOnly = trimmed.replace(/\b(ej svarat|har inte svarat|obesvarad|svar saknas|svarade ej|inte svarat)\b/gi, '').trim();
      }

      // 2. If no parenthesized comment, check for trailing text separated by dash/colon
      if (!extractedComment) {
        const parts = nameOnly.split(/[-:\t]/).map(p => p.trim()).filter(Boolean);
        if (parts.length > 1) {
          nameOnly = parts[0];
          extractedComment = parts.slice(1).join(' - ').trim();
        }
      }

      // Clean punctuation/tabs around name
      nameOnly = nameOnly.replace(/^[-:,\t\s]+|[-:,\t\s]+$/g, '').trim();

      if (!nameOnly || !isValidPlayerName(nameOnly)) return;

      // Find player in squad using robust findSquadMatch
      const foundInSquad = findSquadMatch(nameOnly, safeSquad);
      const targetPlayerId = foundInSquad?.id;

      if (targetPlayerId) {
        const existingComment = session.rsvps?.[targetPlayerId]?.comment;
        matchedRsvps[targetPlayerId] = {
          status: detectedStatus,
          comment: extractedComment || existingComment
        };
      } else {
        // Guest player logic - only if attending/partial and not already in squad/guests
        const foundInGuests = newGuestPlayers.find(p => p && p.name && p.name.toLowerCase().trim() === nameOnly.toLowerCase().trim());
        if (!foundInGuests && (detectedStatus === 'attending' || detectedStatus === 'partial')) {
          const guest: SquadPlayer = {
            id: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            name: nameOnly
          };
          newGuestPlayers.push(guest);
        }
      }
    });

    // "Det ska bara vara spelare som jag klistrar in som ska anmälas."
    // Construct newRsvps containing ONLY the responses parsed from this paste
    const newRsvps: Record<string, PlayerRsvp> = {};
    for (const [pid, data] of Object.entries(matchedRsvps)) {
      if (data.status !== 'unanswered') {
        newRsvps[pid] = {
          status: data.status,
          comment: data.comment,
          updatedAt: Date.now(),
          updatedBy: `Importerad (${coachName})`
        };
      }
    }

    let newAttendance: string[] = [];
    if (pasteAlsoMarkPresent) {
      // ONLY mark players as attending who were in the paste as attending or partial
      const attendingIds = Object.entries(newRsvps)
        .filter(([_, r]) => r && (r.status === 'attending' || r.status === 'partial'))
        .map(([pid]) => pid);
      
      const newGuestAttendingIds = newGuestPlayers.map(g => g.id);
      newAttendance = Array.from(new Set([...attendingIds, ...newGuestAttendingIds]));
    } else {
      // Keep existing attendance, minus any players who were matched as declined
      const declinedIds = Object.entries(matchedRsvps)
        .filter(([_, r]) => r.status === 'declined')
        .map(([pid]) => pid);
      newAttendance = attendance.filter(id => !declinedIds.includes(id));
    }

    onUpdateSession({
      ...session,
      rsvps: newRsvps,
      guestPlayers: newGuestPlayers,
      attendance: newAttendance,
      updatedAt: Date.now()
    });

    setShowPasteModal(false);
    setPasteValue("");
    setSavedToast(pasteAlsoMarkPresent ? `Importerat! ${newAttendance.length} personer markerades som närvarande.` : `Importerat! Anmälningar och kommentarer har uppdaterats.`);
    setTimeout(() => setSavedToast(null), 3500);
  };

  const statusOf = (p: SquadPlayer): RsvpStatus | 'unanswered' => rsvps[p.id]?.status || 'unanswered';

  const filteredMembers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allMembers.filter(player => {
      const isGuest = player.id.startsWith('guest_');
      const status = rsvps[player.id]?.status || 'unanswered';
      if (filter === 'present' && !attendance.includes(player.id)) return false;
      if ((filter === 'attending' || filter === 'partial' || filter === 'declined') && status !== filter) return false;
      if (filter === 'unanswered' && (status !== 'unanswered' || isGuest)) return false;
      if (filter === 'guests' && !isGuest) return false;
      if (q) {
        return player.name.toLowerCase().includes(q) || !!player.position?.toLowerCase().includes(q) || !!player.number?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [allMembers, attendance, rsvps, filter, searchQuery]);

  const targetAdminUrl = adminUrl || (session as any).adminUrl;
  const deadlinePassed = !!session.rsvpConfig?.deadline && session.rsvpConfig.deadline < Date.now();

  /* ---------- Delar ---------- */

  const toast = (
    <AnimatePresence>
      {savedToast && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          role="status"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)' }}
          className="fixed z-[90] left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm px-4 py-3 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold shadow-xl flex items-center gap-2.5"
        >
          <CheckCircle2 size={18} className="shrink-0 text-emerald-400 dark:text-emerald-600" />
          <span>{savedToast}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const deadlineLine = session.rsvpConfig?.deadline ? (
    <p className={`flex items-center gap-1.5 text-sm font-medium ${deadlinePassed ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
      <Clock size={14} className="shrink-0" />
      {deadlinePassed ? 'Sista svarsdag har passerat' : `Svara senast ${formatDeadline(session.rsvpConfig.deadline)}`}
    </p>
  ) : null;

  const myRsvpCard = matchedPlayer ? (
    <Card>
      <SectionHeader title={isCoachOrAdmin ? 'Ditt eget svar' : 'Kommer du?'} />
      <div className="space-y-3">
        {!isCoachOrAdmin && deadlineLine}
        <RsvpButtons
          compact={isCoachOrAdmin}
          value={myRsvp?.status || null}
          onChange={(s) => saveRsvpForPlayer(matchedPlayer.id, s, myComment, undefined, true)}
        />
        {myRsvp && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Tryck på samma knapp igen för att ta bort ditt svar.</p>
        )}
        <div>
          <label htmlFor="rsvp-my-comment" className={labelClass}>Kommentar till tränaren (valfritt)</label>
          <div className="flex gap-2">
            <TextInput
              id="rsvp-my-comment"
              type="text"
              value={myComment}
              onChange={(e) => setMyComment(e.target.value)}
              placeholder="T.ex. kommer 18:30 eller känning i knät"
              className={inputClass}
            />
            <Button
              variant="secondary"
              className="shrink-0"
              disabled={!myRsvp || myComment.trim() === (myRsvp?.comment || '')}
              onClick={() => saveRsvpForPlayer(matchedPlayer.id, myRsvp!.status, myComment)}
            >
              Spara
            </Button>
          </div>
          {!myRsvp && myComment.trim() && (
            <p className="mt-1.5 text-xs text-zinc-500">Välj Kommer, Delvis eller Kan inte så skickas kommentaren med.</p>
          )}
        </div>
      </div>
    </Card>
  ) : null;

  const countTiles = (
    <div className={`grid grid-cols-4 gap-2 ${isCoachOrAdmin ? 'md:grid-cols-2 xl:grid-cols-4' : ''}`}>
      {([
        { id: 'attending', n: stats.attending, l: 'Kommer', c: 'text-emerald-600 dark:text-emerald-400' },
        { id: 'partial', n: stats.partial, l: 'Delvis', c: 'text-amber-600 dark:text-amber-400' },
        { id: 'declined', n: stats.declined, l: 'Kan inte', c: 'text-red-600 dark:text-red-400' },
        { id: 'unanswered', n: stats.unanswered, l: 'Ej svarat', c: 'text-zinc-500 dark:text-zinc-400' },
      ] as { id: Filter; n: number; l: string; c: string }[]).map(t => {
        const content = (
          <>
            <span className={`block text-2xl font-bold tabular-nums ${t.c}`}>{t.n}</span>
            <span className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 truncate">{t.l}</span>
          </>
        );
        return isCoachOrAdmin ? (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(filter === t.id ? 'all' : t.id)}
            aria-pressed={filter === t.id}
            className={`min-h-[64px] rounded-xl px-2 py-2 text-center transition-all cursor-pointer active:scale-[0.97] ${
              filter === t.id ? 'bg-indigo-50 dark:bg-indigo-950/60 ring-2 ring-indigo-500' : 'bg-zinc-50 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {content}
          </button>
        ) : (
          <div key={t.id} className="rounded-xl px-2 py-2 text-center bg-zinc-50 dark:bg-zinc-800/60">{content}</div>
        );
      })}
    </div>
  );

  /* ---------- Spelarens vy ---------- */

  if (!isCoachOrAdmin) {
    const comingNames = safeSquad.filter(p => rsvps[p.id]?.status === 'attending' || rsvps[p.id]?.status === 'partial');
    const endTime = sessionEndTime(session);
    const dateLabel = new Date(session.date).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
    return (
      <div className="pb-12">
        {toast}
        {!user && (
          <Card className="mb-4 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60">
            <p className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200"><Lock size={18} /> Logga in för att svara</p>
          </Card>
        )}
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
          <Card>
            <SectionHeader title="Kallelse" />
            <dl className="space-y-3.5">
              <div className="flex gap-3">
                <dt className="sr-only">Vad</dt>
                <span className="w-10 h-10 shrink-0 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
                  {isMatch ? <Trophy size={18} /> : <Users size={18} />}
                </span>
                <dd className="min-w-0">
                  <span className="block text-base font-bold text-zinc-900 dark:text-white break-words">{session.title || (isMatch ? 'Match' : 'Träning')}</span>
                  <span className="block text-sm text-zinc-500 dark:text-zinc-400">{isMatch ? 'Match' : 'Träning'}</span>
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="sr-only">När</dt>
                <span className="w-10 h-10 shrink-0 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center justify-center"><CalendarDays size={18} /></span>
                <dd className="min-w-0">
                  <span className="block text-base font-semibold text-zinc-900 dark:text-white">{dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}</span>
                  <span className="block text-sm text-zinc-500 dark:text-zinc-400 tabular-nums">{session.startTime}{endTime ? `–${endTime}` : ''}</span>
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="sr-only">Var</dt>
                <span className="w-10 h-10 shrink-0 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center justify-center"><MapPin size={18} /></span>
                <dd className="min-w-0 self-center">
                  <span className={`block text-base break-words ${session.location ? 'font-semibold text-zinc-900 dark:text-white' : 'text-zinc-400'}`}>
                    {session.location || 'Plats inte angiven'}
                  </span>
                </dd>
              </div>
              {session.rsvpConfig?.notes && (
                <div className="flex gap-3">
                  <dt className="sr-only">Meddelande</dt>
                  <span className="w-10 h-10 shrink-0 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center"><Megaphone size={18} /></span>
                  <dd className="min-w-0 self-center text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap break-words">{session.rsvpConfig.notes}</dd>
                </div>
              )}
            </dl>
          </Card>

          <div className="space-y-4">
            {myRsvpCard || (
              <Card>
                <EmptyState
                  icon={<Users size={24} />}
                  title="Du finns inte i truppen"
                  text="Be tränaren koppla ditt konto till truppen, så kan du svara på kallelser här."
                  className="py-6"
                />
              </Card>
            )}
            <Card>
              <SectionHeader title="Laget" />
              {countTiles}
              {comingNames.length > 0 && (
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  <span className="font-semibold">Kommer: </span>
                  {comingNames.map(p => p.name.split(' ')[0] + (rsvps[p.id]?.status === 'partial' ? ' (delvis)' : '')).join(', ')}
                </p>
              )}
            </Card>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- Tränarens vy ---------- */

  const filterTabs: { id: Filter; label: string; count?: number }[] = [
    { id: 'all', label: 'Alla', count: allMembers.length },
    { id: 'attending', label: 'Kommer', count: stats.attending },
    { id: 'partial', label: 'Delvis', count: stats.partial },
    { id: 'declined', label: 'Kan inte', count: stats.declined },
    { id: 'unanswered', label: 'Ej svarat', count: stats.unanswered },
    { id: 'present', label: 'Närvarande', count: stats.presentCount },
    ...(guestPlayers.length > 0 ? [{ id: 'guests' as Filter, label: 'Provspelare', count: guestPlayers.length }] : []),
  ];

  const renderRow = (player: SquadPlayer, showStatus: boolean) => {
    const isGuest = player.id.startsWith('guest_');
    const isPresent = attendance.includes(player.id);
    const rsvp = rsvps[player.id];
    const status = statusOf(player);
    const sub = rsvp?.comment
      ? `”${rsvp.comment}”`
      : [player.position, player.number ? `#${player.number}` : ''].filter(Boolean).join(' · ');
    return (
      <li key={player.id} className="flex items-center gap-2 px-2 sm:px-3 py-1.5">
        <button
          type="button"
          onClick={() => openEdit(player)}
          className="flex-1 min-w-0 min-h-[52px] flex items-center gap-3 px-1.5 rounded-xl text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer"
        >
          <Avatar name={player.name} photoUrl={player.photoUrl} size={38} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{player.name}</span>
              {player.role === 'leader' && <Badge tone="warning" className="h-5 px-1.5 text-[11px]">Ledare</Badge>}
              {isGuest && <Badge tone="brand" className="h-5 px-1.5 text-[11px]">Provspelare</Badge>}
            </span>
            {sub && (
              <span className={`flex items-center gap-1 text-xs truncate ${rsvp?.comment ? 'text-zinc-700 dark:text-zinc-300 italic' : 'text-zinc-500 dark:text-zinc-400'}`}>
                {rsvp?.comment && <MessageSquare size={12} className="shrink-0 not-italic text-indigo-500" />}
                <span className="truncate">{sub}</span>
              </span>
            )}
          </span>
          {showStatus && !isGuest && (
            <Badge tone={statusMeta[status].tone} icon={statusMeta[status].icon} className="shrink-0">{statusMeta[status].label}</Badge>
          )}
        </button>
        <button
          type="button"
          onClick={() => handleTogglePresence(player.id)}
          aria-pressed={isPresent}
          aria-label={isPresent ? `${player.name} är närvarande` : `Markera ${player.name} som närvarande`}
          title={isPresent ? 'Närvarande – tryck för att ta bort' : 'Markera som närvarande'}
          className={`w-11 h-11 shrink-0 rounded-xl border inline-flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
            isPresent
              ? 'bg-emerald-600 border-emerald-600 text-white'
              : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-300 dark:text-zinc-600 hover:text-emerald-600 hover:border-emerald-400'
          }`}
        >
          <Check size={20} strokeWidth={3} />
        </button>
      </li>
    );
  };

  const grouped = filter === 'all' && !searchQuery.trim();
  const groups: { key: string; title: string; members: SquadPlayer[] }[] = grouped
    ? [
        { key: 'attending', title: 'Kommer', members: safeSquad.filter(p => statusOf(p) === 'attending') },
        { key: 'partial', title: 'Delvis', members: safeSquad.filter(p => statusOf(p) === 'partial') },
        { key: 'declined', title: 'Kan inte', members: safeSquad.filter(p => statusOf(p) === 'declined') },
        { key: 'unanswered', title: 'Ej svarat', members: safeSquad.filter(p => statusOf(p) === 'unanswered') },
        { key: 'guests', title: 'Provspelare', members: guestPlayers },
      ].filter(g => g.members.length > 0)
    : [];

  const editTargetPresent = !!editTarget && attendance.includes(editTarget.id);

  return (
    <div className="pb-12">
      {toast}

      {!user && (
        <Card className="mb-4 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60">
          <p className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200"><Lock size={18} /> Kräver inloggning</p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">Logga in för att se och spara svar på kallelsen.</p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-[auto_1fr] md:items-start">
        {/* Svarsöversikt */}
        <Card className="md:col-start-2 md:row-start-1">
          <SectionHeader
            title="Svar"
            action={<span className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 tabular-nums">{stats.total - stats.unanswered} av {stats.total}</span>}
          />
          {countTiles}
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-zinc-700 dark:text-zinc-200">Närvarande</span>
              <span className="font-bold tabular-nums text-zinc-900 dark:text-white">{stats.presentCount}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${allMembers.length ? Math.min(100, (stats.presentCount / allMembers.length) * 100) : 0}%` }}
              />
            </div>
          </div>
        </Card>

        {/* Listan */}
        <section className="md:col-start-1 md:row-start-1 md:row-span-2 min-w-0 space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Sök spelare"
              aria-label="Sök spelare"
              className={`${inputClass} pl-10 bg-white dark:bg-zinc-900`}
            />
          </div>
          <SegmentedTabs<Filter> size="lg" tabs={filterTabs} value={filter} onChange={setFilter} />

          {grouped ? (
            groups.length === 0 ? (
              <Card><EmptyState icon={<Users size={24} />} title="Truppen är tom" text="Lägg till spelare under Truppen, eller lägg till en provspelare här." className="py-6" /></Card>
            ) : (
              groups.map(g => (
                <div key={g.key}>
                  <h3 className="flex items-center gap-2 px-1 mb-1.5 text-sm font-bold text-zinc-500 dark:text-zinc-400">
                    {g.key !== 'guests' && <Badge tone={statusMeta[g.key as RsvpStatus | 'unanswered'].tone} icon={statusMeta[g.key as RsvpStatus | 'unanswered'].icon}>{g.title}</Badge>}
                    {g.key === 'guests' && <Badge tone="brand">{g.title}</Badge>}
                    <span className="tabular-nums">{g.members.length}</span>
                  </h3>
                  <Card padded={false}>
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{g.members.map(p => renderRow(p, false))}</ul>
                  </Card>
                </div>
              ))
            )
          ) : filteredMembers.length === 0 ? (
            <Card><EmptyState title="Ingen matchar" text="Prova ett annat filter eller sökord." className="py-6" /></Card>
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{filteredMembers.map(p => renderRow(p, true))}</ul>
            </Card>
          )}
          <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">Tryck på en person för att ändra svaret. Bocken till höger markerar närvaro.</p>
        </section>

        {/* Kallelse, eget svar och verktyg */}
        <div className="md:col-start-2 md:row-start-2 space-y-4">
          <Card>
            <SectionHeader title="Kallelse" />
            {session.rsvpConfig ? (
              <div className="space-y-2">
                <Badge tone="success" icon={<Check size={12} strokeWidth={3} />}>Publicerad</Badge>
                {deadlineLine}
                {session.rsvpConfig.notes && (
                  <p className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap break-words">{session.rsvpConfig.notes}</p>
                )}
                <Button variant="secondary" block icon={<Send size={16} />} onClick={openInvite}>Ändra kallelse</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Spelarna kan svara redan nu. Med en kallelse kan du sätta sista svarsdag och skriva ett meddelande.</p>
                <Button block icon={<Send size={16} />} onClick={openInvite}>Skapa kallelse</Button>
              </div>
            )}
          </Card>

          {isMatch && onOpenLineup && (
            <Card>
              <SectionHeader title="Match" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">{stats.attending} spelare har svarat Kommer.</p>
              <Button variant="secondary" block icon={<Trophy size={16} />} onClick={() => onOpenLineup(session)}>Öppna laguppställning</Button>
            </Card>
          )}

          {myRsvpCard}

          <Card padded={false} className="p-2">
            <h2 className="px-3 pt-2 pb-1 text-sm font-bold text-zinc-500 dark:text-zinc-400">Verktyg</h2>
            <MenuItem icon={<Clipboard size={18} />} label="Klistra in lista" description="Från Svenskalag, Laget.se, WhatsApp m.fl." onClick={() => setShowPasteModal(true)} trailing={<ChevronRight size={16} className="text-zinc-400" />} />
            <MenuItem icon={<UserPlus size={18} />} label="Lägg till provspelare" onClick={() => setShowGuestModal(true)} trailing={<ChevronRight size={16} className="text-zinc-400" />} />
            <MenuItem icon={<CheckCheck size={18} />} label="Markera alla som svarat Kommer" description="Kommer och Delvis blir närvarande" onClick={handleMarkAllRsvpdAsPresent} />
            <MenuItem icon={<CheckCheck size={18} />} label="Markera alla närvarande" onClick={handleMarkAllPresent} />
            {targetAdminUrl && (
              <MenuItem icon={<ExternalLink size={18} />} label="Öppna adminsida" onClick={() => window.open(targetAdminUrl, '_blank', 'noopener,noreferrer')} />
            )}
            <MenuItem icon={<RotateCcw size={18} />} label="Rensa närvaro" tone="danger" onClick={() => setConfirmClear('attendance')} />
            <MenuItem icon={<RotateCcw size={18} />} label="Rensa alla svar" tone="danger" onClick={() => setConfirmClear('rsvps')} />
          </Card>
        </div>
      </div>

      {/* Ändra en persons svar */}
      <Sheet
        open={!!editTarget}
        onClose={() => setEditTargetId(null)}
        title={editTarget?.name}
        footer={
          editTargetIsGuest ? (
            <Button block variant="secondary" onClick={() => setEditTargetId(null)}>Klar</Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setEditTargetId(null)}>Avbryt</Button>
              <Button className="flex-1" onClick={handleSaveEdit}>Spara</Button>
            </div>
          )
        }
      >
        {editTarget && (
          <div className="px-2 pb-2 space-y-4">
            {!editTargetIsGuest && (
              <>
                <div>
                  <p className={labelClass}>Svar</p>
                  <RsvpButtons value={editStatus} onChange={(s) => setEditStatus(editStatus === s ? null : s)} />
                  {rsvps[editTarget.id]?.updatedBy && (
                    <p className="mt-1.5 text-xs text-zinc-500">
                      Senast ändrat av {rsvps[editTarget.id].updatedBy}
                      {rsvps[editTarget.id].updatedAt ? `, ${new Date(rsvps[editTarget.id].updatedAt).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="rsvp-edit-comment" className={labelClass}>Kommentar</label>
                  <TextInput id="rsvp-edit-comment" type="text" value={editComment} onChange={(e) => setEditComment(e.target.value)} placeholder="Valfri kommentar" className={inputClass} />
                </div>
              </>
            )}
            {editTargetIsGuest && (
              <div>
                <label htmlFor="rsvp-guest-pos" className={labelClass}>Position</label>
                <TextInput
                  id="rsvp-guest-pos"
                  type="text"
                  value={editTarget.position || ''}
                  onChange={(e) => updateGuestPosition(editTarget.id, e.target.value)}
                  placeholder="T.ex. mittfältare"
                  className={inputClass}
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => handleTogglePresence(editTarget.id)}
              className="w-full min-h-[52px] flex items-center justify-between gap-3 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 cursor-pointer"
            >
              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Närvarande på passet</span>
              <span className={`w-11 h-11 rounded-xl border inline-flex items-center justify-center ${editTargetPresent ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-zinc-300 dark:border-zinc-600 text-zinc-300'}`}>
                <Check size={20} strokeWidth={3} />
              </span>
            </button>
            {editTargetIsGuest && (
              <Button
                variant="ghost"
                block
                className="text-red-600 dark:text-red-400"
                icon={<Trash2 size={16} />}
                onClick={() => { removeGuest(editTarget.id); setEditTargetId(null); }}
              >
                Ta bort provspelaren
              </Button>
            )}
          </div>
        )}
      </Sheet>

      {/* Klistra in lista */}
      <Sheet
        open={showPasteModal}
        onClose={() => setShowPasteModal(false)}
        title="Klistra in svarslista"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShowPasteModal(false)}>Avbryt</Button>
            <Button className="flex-1" icon={<Check size={16} />} onClick={handlePaste} disabled={!pasteValue.trim()}>Läs in svar</Button>
          </div>
        }
      >
        <div className="px-2 pb-2 space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Klistra in namn och svar, t.ex. <em>Deltar</em> eller <em>Deltar ej</em>, från Svenskalag, Laget.se, SportAdmin eller WhatsApp. Svaren i listan ersätter passets nuvarande svar.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="h-10"
            onClick={handlePasteFromClipboard}
            icon={clipboardStatus === 'pasted' ? <ClipboardCheck size={16} className="text-emerald-600" /> : <ClipboardPaste size={16} />}
          >
            {clipboardStatus === 'pasted' ? 'Inklistrat' : 'Klistra in från urklipp'}
          </Button>
          <div className="relative">
            <TextArea
              ref={pasteTextareaRef}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              rows={7}
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData?.getData('text');
                if (pasted && !pasteValue) setPasteValue(pasted);
              }}
              placeholder={`Till exempel:\n\nHaythem Noor Deltar (kommer 10 min sent)\nCornelis Setterholm - Deltar ej - bortrest\nErik Johansson Deltar`}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3.5 text-base sm:text-sm text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 placeholder-zinc-400 font-mono"
            />
            {pasteValue && (
              <Button
                variant="secondary"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => { setPasteValue(''); pasteTextareaRef.current?.focus(); }}
              >
                Töm
              </Button>
            )}
          </div>
          {clipboardStatus === 'failed' && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Urklipp gick inte att läsa automatiskt. Tryck i rutan och välj Klistra in (eller Cmd+V).
            </p>
          )}
          <label className="flex items-start gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 cursor-pointer">
            <input
              type="checkbox"
              checked={pasteAlsoMarkPresent}
              onChange={(e) => setPasteAlsoMarkPresent(e.target.checked)}
              className="mt-0.5 w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span>
              <span className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100">Markera de som kommer som närvarande</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">Då kan de väljas direkt i laguppställning och övningar.</span>
            </span>
          </label>
        </div>
      </Sheet>

      {/* Provspelare */}
      <Sheet
        open={showGuestModal}
        onClose={() => setShowGuestModal(false)}
        title="Lägg till provspelare"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShowGuestModal(false)}>Avbryt</Button>
            <Button className="flex-1" icon={<UserPlus size={16} />} onClick={() => handleAddGuest()} disabled={!guestName.trim()}>Lägg till</Button>
          </div>
        }
      >
        <form onSubmit={handleAddGuest} className="px-2 pb-2 space-y-4">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Provspelaren finns bara på det här passet och markeras som närvarande.</p>
          <div>
            <label htmlFor="guest-name" className={labelClass}>Namn</label>
            <TextInput id="guest-name" type="text" required value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="För- och efternamn" className={inputClass} />
          </div>
          <div>
            <label htmlFor="guest-position" className={labelClass}>Position (valfritt)</label>
            <TextInput id="guest-position" type="text" value={guestPosition} onChange={(e) => setGuestPosition(e.target.value)} placeholder="T.ex. målvakt eller anfallare" className={inputClass} />
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Sheet>

      {/* Kallelse */}
      <Sheet
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title={session.rsvpConfig ? 'Ändra kallelse' : 'Skapa kallelse'}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShowInviteModal(false)}>Avbryt</Button>
            <Button className="flex-1" icon={<Send size={16} />} onClick={() => handleSendInvitations()}>{session.rsvpConfig ? 'Spara' : 'Publicera'}</Button>
          </div>
        }
      >
        <form onSubmit={handleSendInvitations} className="px-2 pb-2 space-y-4">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Spelarna ser kallelsen och svarar i appen. Inga mejl eller notiser skickas – dela gärna en påminnelse i lagets chatt.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="inv-date" className={labelClass}>Svara senast</label>
              <input id="inv-date" type="date" value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="inv-time" className={labelClass}>Klockan</label>
              <input id="inv-time" type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <label htmlFor="inv-notes" className={labelClass}>Meddelande till spelarna</label>
            <TextArea
              id="inv-notes"
              rows={3}
              value={inviteNotes}
              onChange={(e) => setInviteNotes(e.target.value)}
              placeholder="T.ex. samling 17:15 i omklädningsrum 3. Ta med löparskor."
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3.5 text-base sm:text-sm text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 placeholder-zinc-400"
            />
          </div>
        </form>
      </Sheet>

      {/* Bekräfta rensning */}
      <Sheet
        open={!!confirmClear}
        onClose={() => setConfirmClear(null)}
        title={confirmClear === 'rsvps' ? 'Rensa alla svar?' : 'Rensa närvaron?'}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmClear(null)}>Avbryt</Button>
            <Button variant="danger" className="flex-1" onClick={confirmClear === 'rsvps' ? handleClearRsvps : handleClearAttendance}>Ja, rensa</Button>
          </div>
        }
      >
        <p className="px-2 pb-2 text-sm text-zinc-600 dark:text-zinc-300">
          {confirmClear === 'rsvps'
            ? 'Alla svar och kommentarer för passet tas bort. Det går inte att ångra.'
            : 'Alla närvaromarkeringar för passet tas bort. Svaren ligger kvar.'}
        </p>
      </Sheet>
    </div>
  );
};
