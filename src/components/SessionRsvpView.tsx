import React, { useState, useMemo } from 'react';
import { 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Clock, 
  Send, 
  Bell, 
  Mail, 
  MessageSquare, 
  Lock, 
  ShieldCheck, 
  Users, 
  Check, 
  Plus, 
  Search, 
  HelpCircle,
  UserCheck,
  ExternalLink,
  Clipboard,
  UserPlus,
  CheckCheck,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TrainingSession, SquadPlayer, RsvpStatus, PlayerRsvp, SessionRsvpConfig, UserProfile } from '../types';
import { CachedImage } from './CachedImage';

interface SessionRsvpViewProps {
  session: TrainingSession;
  squad?: SquadPlayer[];
  onUpdateSession: (updated: TrainingSession) => void;
  user?: any;
  userRoles?: string[];
  userProfile?: UserProfile;
  adminUrl?: string;
}

function isValidPlayerName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();

  // 1. Must contain at least one letter (a-z, including Swedish standard letters/accents)
  if (!/[a-zåäöéèüíóáñæø]/i.test(trimmed)) {
    return false;
  }

  // 2. Exact match check for common status words or phrases
  const blockedExact = [
    'ja', 'nej', 'kanske', 'deltar', 'deltar ej', 'ej svarat', 'anmäld', 'reserv',
    'kommentar', 'svara', 'obesvarad', 'status', 'tid', 'plats', 'anmäld', 'avanmäld',
    'gäst', 'gästspelare', 'provspelare', 'ledare', 'tränare', 'spelare', 'ej svarat',
    'nej tack', 'skjuts', 'bil', 'bilar', 'platser', 'lediga', 'ja tack', 'platser kvar',
    'platser lediga', 'förare', 'plats kvar', 'kör ej', 'kör', 'vill ha skjuts'
  ];
  if (blockedExact.includes(lower)) {
    return false;
  }

  // 3. Regular Expression patterns for status/driving/tickets etc.
  if (/\b\d+\s*(platser|plats|lediga|bilar|bil|skolkort|st|stycken)\b/i.test(lower)) {
    return false;
  }

  if (lower.startsWith('kommentar:') || lower.startsWith('svar saknas')) {
    return false;
  }
  if (lower.includes('platser') && (lower.includes('kvar') || lower.includes('lediga'))) {
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
  adminUrl
}) => {
  const [filter, setFilter] = useState<'all' | 'present' | 'attending' | 'partial' | 'declined' | 'unanswered' | 'guests'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);

  // Form states for logged-in player's own RSVP
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const [myStatus, setMyStatus] = useState<RsvpStatus | null>(null);
  const [myComment, setMyComment] = useState<string>('');
  const [savedToast, setSavedToast] = useState<string | null>(null);

  // Form states for coach inviting/setting config
  const [deadlineDate, setDeadlineDate] = useState<string>('');
  const [deadlineTime, setDeadlineTime] = useState<string>('18:00');
  const [inviteNotes, setInviteNotes] = useState<string>('');
  const [sendPush, setSendPush] = useState<boolean>(true);
  const [sendEmail, setSendEmail] = useState<boolean>(true);

  // Form states for admin adding on behalf of a player
  const [adminTargetPlayerId, setAdminTargetPlayerId] = useState<string>('');
  const [adminStatus, setAdminStatus] = useState<RsvpStatus>('attending');
  const [adminComment, setAdminComment] = useState<string>('');

  // Form states for paste mode
  const [pasteValue, setPasteValue] = useState<string>('');

  // Form states for adding guest player
  const [guestName, setGuestName] = useState<string>('');
  const [guestPosition, setGuestPosition] = useState<string>('');

  const isCoachOrAdmin = useMemo(() => {
    if (!user) return true; // Offline / admin fallback
    return userRoles.includes('admin') || userRoles.includes('coach');
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

  // Combined list of all members: official squad + guest players
  const allMembers = useMemo<SquadPlayer[]>(() => {
    const list = [...safeSquad];
    guestPlayers.forEach(g => {
      if (!list.some(p => p.id === g.id)) {
        list.push(g);
      }
    });
    return list;
  }, [safeSquad, guestPlayers]);

  // Identify logged in player from squad
  const matchedPlayer = useMemo(() => {
    if (!safeSquad || safeSquad.length === 0) return null;
    if (selectedPlayerId) {
      return safeSquad.find(p => p.id === selectedPlayerId) || null;
    }
    if (!user) return safeSquad[0] || null;

    if (user.email) {
      const matchEmail = safeSquad.find(p => p.email?.toLowerCase().trim() === user.email?.toLowerCase().trim());
      if (matchEmail) return matchEmail;
    }
    const matchId = safeSquad.find(p => p.id === user.uid || (p as any).userId === user.uid);
    if (matchId) return matchId;

    if (user.displayName) {
      const matchName = safeSquad.find(p => p.name.toLowerCase().trim() === user.displayName?.toLowerCase().trim());
      if (matchName) return matchName;
    }

    return safeSquad[0] || null;
  }, [safeSquad, user, selectedPlayerId]);

  // Sync initial state for logged-in player's RSVP
  React.useEffect(() => {
    const activeId = matchedPlayer?.id;
    if (activeId && session.rsvps?.[activeId]) {
      const existing = session.rsvps[activeId];
      setMyStatus(existing.status);
      setMyComment(existing.comment || '');
    } else {
      setMyStatus(null);
      setMyComment('');
    }
  }, [matchedPlayer?.id, session.rsvps]);

  const rsvps = session.rsvps || {};

  // Compute counts
  const stats = useMemo(() => {
    let attending = 0;
    let partial = 0;
    let declined = 0;
    let unanswered = 0;

    safeSquad.forEach(p => {
      const rsvp = rsvps[p.id];
      if (!rsvp) {
        unanswered++;
      } else if (rsvp.status === 'attending') {
        attending++;
      } else if (rsvp.status === 'partial') {
        partial++;
      } else if (rsvp.status === 'declined') {
        declined++;
      }
    });

    const presentCount = attendance.length;

    return { attending, partial, declined, unanswered, total: safeSquad.length, presentCount };
  }, [safeSquad, rsvps, attendance]);

  // Toggle individual presence
  const handleTogglePresence = (id: string) => {
    if (!id) return;
    const isPresent = attendance.includes(id);
    const newAttendance = isPresent 
      ? attendance.filter(pid => pid !== id) 
      : [...attendance, id];

    onUpdateSession({
      ...session,
      attendance: newAttendance,
      updatedAt: Date.now()
    });
  };

  // Mark all as present
  const handleMarkAllPresent = () => {
    const allIds = allMembers.map(p => p.id).filter(Boolean);
    onUpdateSession({
      ...session,
      attendance: Array.from(new Set(allIds)),
      updatedAt: Date.now()
    });
    setSavedToast('Alla medlemmar och provspelare markerades som närvarande.');
    setTimeout(() => setSavedToast(null), 3000);
  };

  // Clear all attendance
  const handleClearAttendance = () => {
    onUpdateSession({
      ...session,
      attendance: [],
      updatedAt: Date.now()
    });
    setSavedToast('Närvarolistan har rensats.');
    setTimeout(() => setSavedToast(null), 3000);
  };

  // Save or clear an RSVP entry and update session attendance automatically
  const saveRsvpForPlayer = (playerId: string, targetStatus: RsvpStatus | null, comment?: string, byWho?: string) => {
    const currentRsvps = session.rsvps || {};
    const currentRsvp = currentRsvps[playerId];

    // If targetStatus is equal to current status, user clicked to toggle it off / clear RSVP!
    const isClearing = targetStatus !== null && currentRsvp?.status === targetStatus;
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
        if (!newAttendance.includes(playerId)) {
          newAttendance.push(playerId);
        }
      } else if (finalStatus === 'declined') {
        newAttendance = newAttendance.filter(id => id !== playerId);
      }
    }

    onUpdateSession({
      ...session,
      rsvps: newRsvps,
      attendance: newAttendance,
      updatedAt: Date.now()
    });

    if (isClearing) {
      setSavedToast('Anmälan rensades för personen');
    } else {
      setSavedToast('Anmälan sparades och närvarolistan har uppdaterats!');
    }
    setTimeout(() => setSavedToast(null), 3000);
  };

  const handleSaveMyRsvp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchedPlayer) return;
    saveRsvpForPlayer(matchedPlayer.id, myStatus, myComment);
  };

  const handleAdminSaveRsvp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminTargetPlayerId) return;
    const adminName = user?.displayName || user?.email || 'Tränare';
    saveRsvpForPlayer(adminTargetPlayerId, adminStatus, adminComment, `Tränare (${adminName})`);
    setShowAdminModal(false);
    setAdminComment('');
  };

  const handleSendInvitations = (e: React.FormEvent) => {
    e.preventDefault();
    let deadlineTimestamp: number | undefined = undefined;
    if (deadlineDate) {
      const timeStr = deadlineTime || '18:00';
      deadlineTimestamp = new Date(`${deadlineDate}T${timeStr}`).getTime();
    }

    const newConfig: SessionRsvpConfig = {
      deadline: deadlineTimestamp,
      notes: inviteNotes.trim() || undefined,
      invitedAt: Date.now(),
      invitedCount: safeSquad.length
    };

    onUpdateSession({
      ...session,
      rsvpConfig: newConfig,
      updatedAt: Date.now()
    });

    setShowInviteModal(false);
    setSavedToast(`📢 Kallelse utskickad via ${sendPush ? 'Notis' : ''}${sendPush && sendEmail ? ' & ' : ''}${sendEmail ? 'E-post' : ''} till ${safeSquad.length} medlemmar!`);
    setTimeout(() => setSavedToast(null), 4000);
  };

  // Add guest player
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
    setGuestName("");
    setGuestPosition("");
    setShowGuestModal(false);
    setSavedToast(`Provspelare ${newGuest.name} lades till och markerades som närvarande!`);
    setTimeout(() => setSavedToast(null), 3000);
  };

  // Remove guest player
  const removeGuest = (id: string) => {
    onUpdateSession({
      ...session,
      guestPlayers: guestPlayers.filter(p => p && p.id !== id),
      attendance: attendance.filter(pid => pid !== id),
      updatedAt: Date.now()
    });
  };

  // Update guest position
  const updateGuestPosition = (guestId: string, position: string) => {
    onUpdateSession({
      ...session,
      guestPlayers: guestPlayers.map(p => (p && p.id === guestId) ? { ...p, position: position || undefined } : p),
      updatedAt: Date.now()
    });
  };

  // Paste list parsing - Imports RSVPs (Anmälningar) & Comments, does NOT touch physical attendance (Närvaro)
  const handlePaste = () => {
    const lines = pasteValue.split(/[\n;]/);
    
    const newRsvps: Record<string, PlayerRsvp> = { ...(session.rsvps || {}) };
    let newGuestPlayers = [...guestPlayers];
    const coachName = user?.displayName || user?.email || 'Tränare';

    lines.forEach(line => {
      let trimmed = line.trim();
      if (!trimmed) return;

      let extractedComment: string | undefined = undefined;

      // 1. Check for comment inside parentheses, e.g. "Haythem Noor Deltar (Kommer 10 min sent)"
      const parenMatch = trimmed.match(/\(([^)]+)\)/);
      if (parenMatch) {
        extractedComment = parenMatch[1].trim();
        // Remove parenthesized string from the line for name & status detection
        trimmed = trimmed.replace(/\([^)]+\)/, '').trim();
      }

      let detectedStatus: RsvpStatus | 'unanswered' | null = null;
      let nameOnly = trimmed;

      const lowerLine = trimmed.toLowerCase();

      // Detect status keywords in Swedish
      if (/\b(deltar ej|deltar inte|kan ej|kan inte|kommer ej|kommer inte|nej|ej med|avanmäld|frånvarande|sjuk|bortrest)\b/i.test(lowerLine)) {
        detectedStatus = 'declined';
        nameOnly = trimmed.replace(/\b(deltar ej|deltar inte|kan ej|kan inte|kommer ej|kommer inte|nej|ej med|avanmäld|frånvarande|sjuk|bortrest)\b/gi, '').trim();
      } else if (/\b(deltar|kommer|ja|kan delta|anmäld)\b/i.test(lowerLine)) {
        detectedStatus = 'attending';
        nameOnly = trimmed.replace(/\b(deltar|kommer|ja|kan delta|anmäld)\b/gi, '').trim();
      } else if (/\b(delvis|kanske|osäker)\b/i.test(lowerLine)) {
        detectedStatus = 'partial';
        nameOnly = trimmed.replace(/\b(delvis|kanske|osäker)\b/gi, '').trim();
      } else if (/\b(ej svarat|obesvarad|svar saknas|svarade ej)\b/i.test(lowerLine)) {
        detectedStatus = 'unanswered';
        nameOnly = trimmed.replace(/\b(ej svarat|obesvarad|svar saknas|svarade ej)\b/gi, '').trim();
      } else {
        // Default if just a name in RSVP list without status keyword
        detectedStatus = 'attending';
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

      // Find player in squad
      const foundInSquad = safeSquad.find(p => 
        p && p.name && (p.name.toLowerCase().trim() === nameOnly.toLowerCase().trim() ||
        p.name.toLowerCase().includes(nameOnly.toLowerCase()) || 
        nameOnly.toLowerCase().includes(p.name.toLowerCase()))
      );

      const targetPlayerId = foundInSquad?.id;

      if (targetPlayerId) {
        if (detectedStatus === 'unanswered') {
          delete newRsvps[targetPlayerId];
        } else if (detectedStatus) {
          const existingComment = session.rsvps?.[targetPlayerId]?.comment;
          const finalComment = extractedComment || existingComment;

          newRsvps[targetPlayerId] = {
            status: detectedStatus,
            comment: finalComment,
            updatedAt: Date.now(),
            updatedBy: `Importerad (${coachName})`
          };
        }
      } else {
        // Guest player logic
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

    onUpdateSession({
      ...session,
      rsvps: newRsvps,
      guestPlayers: newGuestPlayers,
      updatedAt: Date.now()
    });

    setShowPasteModal(false);
    setPasteValue("");
    setSavedToast(`Importerat! Anmälningar och kommentarer har uppdaterats.`);
    setTimeout(() => setSavedToast(null), 3500);
  };

  // Filtered list
  const filteredMembers = useMemo(() => {
    return allMembers.filter(player => {
      const isGuest = player.id.startsWith('guest_');
      const isPresent = attendance.includes(player.id);
      const rsvp = rsvps[player.id];
      const status = rsvp?.status || 'unanswered';

      if (filter === 'present' && !isPresent) return false;
      if (filter === 'attending' && status !== 'attending') return false;
      if (filter === 'partial' && status !== 'partial') return false;
      if (filter === 'declined' && status !== 'declined') return false;
      if (filter === 'unanswered' && status !== 'unanswered') return false;
      if (filter === 'guests' && !isGuest) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = player.name.toLowerCase().includes(q);
        const matchesPos = player.position?.toLowerCase().includes(q);
        const matchesNum = player.number?.toLowerCase().includes(q);
        return matchesName || matchesPos || matchesNum;
      }

      return true;
    });
  }, [allMembers, attendance, rsvps, filter, searchQuery]);

  const targetAdminUrl = adminUrl || session.adminUrl;

  return (
    <div className="space-y-6 pb-12">
      {/* Toast notification */}
      <AnimatePresence>
        {savedToast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 rounded-2xl bg-emerald-600 text-white font-bold text-sm shadow-lg flex items-center gap-3"
          >
            <CheckCircle2 size={20} className="shrink-0" />
            <span>{savedToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Security guard if not logged in */}
      {!user && (
        <div className="p-6 rounded-3xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 space-y-3">
          <div className="flex items-center gap-3 font-black text-lg">
            <Lock className="text-amber-600 dark:text-amber-400" size={24} />
            <span>Kräver inloggning</span>
          </div>
          <p className="text-xs sm:text-sm leading-relaxed text-amber-800 dark:text-amber-300">
            För att förhindra obehöriga anmälningar och skydda truppens sekretess måste du vara inloggad för att se deltagaranmälningar samt lämna din egen anmälan.
          </p>
        </div>
      )}

      {/* Top Stats Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setFilter(filter === 'present' ? 'all' : 'present')}
          className={`p-4 rounded-2xl border transition-all text-left flex flex-col justify-between ${
            filter === 'present'
              ? 'bg-indigo-600 text-white border-indigo-700 shadow-md scale-[1.02]'
              : 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-800/40 text-indigo-950 dark:text-indigo-300 hover:border-indigo-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider opacity-80">Närvarande</span>
            <Users size={18} className="shrink-0" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-black">{stats.presentCount}</span>
            <span className="text-xs font-bold opacity-75">av {allMembers.length}</span>
          </div>
        </button>

        <button
          onClick={() => setFilter(filter === 'attending' ? 'all' : 'attending')}
          className={`p-4 rounded-2xl border transition-all text-left flex flex-col justify-between ${
            filter === 'attending'
              ? 'bg-emerald-500 text-white border-emerald-600 shadow-md scale-[1.02]'
              : 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-300 hover:border-emerald-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider opacity-80">Anmäld: Kan delta</span>
            <CheckCircle2 size={18} className="shrink-0" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-black">{stats.attending}</span>
            <span className="text-xs font-bold opacity-75">av {stats.total}</span>
          </div>
        </button>

        <button
          onClick={() => setFilter(filter === 'partial' ? 'all' : 'partial')}
          className={`p-4 rounded-2xl border transition-all text-left flex flex-col justify-between ${
            filter === 'partial'
              ? 'bg-amber-500 text-white border-amber-600 shadow-md scale-[1.02]'
              : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40 text-amber-900 dark:text-amber-300 hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider opacity-80">Kan delta delvis</span>
            <AlertTriangle size={18} className="shrink-0" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-black">{stats.partial}</span>
            <span className="text-xs font-bold opacity-75">av {stats.total}</span>
          </div>
        </button>

        <button
          onClick={() => setFilter(filter === 'declined' ? 'all' : 'declined')}
          className={`p-4 rounded-2xl border transition-all text-left flex flex-col justify-between ${
            filter === 'declined'
              ? 'bg-rose-500 text-white border-rose-600 shadow-md scale-[1.02]'
              : 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/40 text-rose-900 dark:text-rose-300 hover:border-rose-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider opacity-80">Kan inte delta</span>
            <XCircle size={18} className="shrink-0" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-black">{stats.declined}</span>
            <span className="text-xs font-bold opacity-75">av {stats.total}</span>
          </div>
        </button>
      </div>

      {/* Invitation Info Banner if invitation exists */}
      {session.rsvpConfig && (
        <div className="p-4 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-indigo-950 dark:text-indigo-200">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              <Bell size={14} />
              <span>Inbjudan utskickad</span>
              {session.rsvpConfig.invitedAt && (
                <span className="text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                  ({new Date(session.rsvpConfig.invitedAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})
                </span>
              )}
            </div>
            {session.rsvpConfig.notes && (
              <p className="text-xs font-bold italic text-zinc-700 dark:text-zinc-300">
                "{session.rsvpConfig.notes}"
              </p>
            )}
          </div>
          {session.rsvpConfig.deadline && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800 text-xs font-black text-indigo-700 dark:text-indigo-300 shrink-0">
              <Clock size={14} />
              <span>Sista svar: {new Date(session.rsvpConfig.deadline).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )}
        </div>
      )}

      {/* Logged in Player's Own RSVP Form */}
      {safeSquad.length > 0 && (
        <div className="p-5 sm:p-6 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-4">
            <div>
              <h3 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                <UserCheck size={18} className="text-indigo-600 dark:text-indigo-400" />
                Din anmälan för detta pass
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                Välj om du kan delta, kan delta delvis eller är förhindrad.
              </p>
            </div>

            {/* Quick selector if user wants to change which player profile is being used */}
            {safeSquad.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-400">Profil:</span>
                <select
                  value={matchedPlayer?.id || ''}
                  onChange={(e) => setSelectedPlayerId(e.target.value)}
                  className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-1.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  {safeSquad.map(p => (
                    <option key={p.id} value={p.id}>{p.name} {p.number ? `(#${p.number})` : ''}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <form onSubmit={handleSaveMyRsvp} className="space-y-4">
            {/* 3 Large Action Choice Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setMyStatus(myStatus === 'attending' ? null : 'attending')}
                className={`p-4 rounded-2xl border text-left transition-all flex items-center gap-3.5 cursor-pointer ${
                  myStatus === 'attending'
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-md ring-2 ring-emerald-400/50'
                    : 'bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700/80 text-zinc-700 dark:text-zinc-300 hover:border-emerald-400'
                }`}
              >
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  myStatus === 'attending' ? 'bg-white/20 text-white' : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                }`}>
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <p className="font-black text-xs uppercase tracking-wider">Kan delta</p>
                  <p className={`text-[11px] font-medium ${myStatus === 'attending' ? 'text-emerald-100' : 'text-zinc-500'}`}>Jag kommer på passet</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMyStatus(myStatus === 'partial' ? null : 'partial')}
                className={`p-4 rounded-2xl border text-left transition-all flex items-center gap-3.5 cursor-pointer ${
                  myStatus === 'partial'
                    ? 'bg-amber-600 text-white border-amber-500 shadow-md ring-2 ring-amber-400/50'
                    : 'bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700/80 text-zinc-700 dark:text-zinc-300 hover:border-amber-400'
                }`}
              >
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  myStatus === 'partial' ? 'bg-white/20 text-white' : 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                }`}>
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <p className="font-black text-xs uppercase tracking-wider">Kan delta delvis</p>
                  <p className={`text-[11px] font-medium ${myStatus === 'partial' ? 'text-amber-100' : 'text-zinc-500'}`}>T.ex. skada eller sen ankomst</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMyStatus(myStatus === 'declined' ? null : 'declined')}
                className={`p-4 rounded-2xl border text-left transition-all flex items-center gap-3.5 cursor-pointer ${
                  myStatus === 'declined'
                    ? 'bg-rose-600 text-white border-rose-500 shadow-md ring-2 ring-rose-400/50'
                    : 'bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700/80 text-zinc-700 dark:text-zinc-300 hover:border-rose-400'
                }`}
              >
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  myStatus === 'declined' ? 'bg-white/20 text-white' : 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                }`}>
                  <XCircle size={20} />
                </div>
                <div>
                  <p className="font-black text-xs uppercase tracking-wider">Kan inte delta</p>
                  <p className={`text-[11px] font-medium ${myStatus === 'declined' ? 'text-rose-100' : 'text-zinc-500'}`}>Kan tyvärr inte komma</p>
                </div>
              </button>
            </div>

            {/* Comment box */}
            <div>
              <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-1.5">
                Kommentar till tränaren (valfritt):
              </label>
              <input
                type="text"
                value={myComment}
                onChange={(e) => setMyComment(e.target.value)}
                placeholder="T.ex. 'Känning i knäet, kör 30 min' eller 'Kommer 18:30 pga jobb'..."
                className="w-full bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-xs font-bold text-zinc-900 dark:text-white placeholder-zinc-400 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              {matchedPlayer && (
                <span className="text-xs font-bold text-zinc-400">
                  Anmäler: <strong className="text-zinc-800 dark:text-zinc-200">{matchedPlayer.name}</strong>
                </span>
              )}
              <button
                type="submit"
                disabled={myStatus === null && !session.rsvps?.[matchedPlayer?.id || '']}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center gap-2 cursor-pointer ml-auto"
              >
                <Check size={16} />
                <span>{myStatus !== null ? 'Spara anmälan' : 'Rensa anmälan'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin / Coach Action Toolbar */}
      {isCoachOrAdmin && (
        <div className="p-4 sm:p-5 rounded-3xl bg-zinc-100/90 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3 shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                Ledarverktyg för Närvaro & Anmälan
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs font-bold text-zinc-600 dark:text-zinc-300">
              <span>{attendance.length} närvarande</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {targetAdminUrl && (
              <a
                href={targetAdminUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs flex items-center gap-1.5 shadow-sm transition-all"
              >
                <ExternalLink size={14} />
                <span>Öppna adminsida</span>
              </a>
            )}

            <button
              onClick={() => setShowPasteModal(true)}
              className="px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-indigo-500 dark:hover:border-indigo-400 text-zinc-800 dark:text-zinc-100 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700"
            >
              <Clipboard size={14} className="text-indigo-600 dark:text-indigo-400" />
              <span>Klistra in lista</span>
            </button>

            <button
              onClick={() => setShowGuestModal(true)}
              className="px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-indigo-500 dark:hover:border-indigo-400 text-zinc-800 dark:text-zinc-100 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700"
            >
              <UserPlus size={14} className="text-indigo-600 dark:text-indigo-400" />
              <span>+ Provspelare</span>
            </button>

            <button
              onClick={handleMarkAllPresent}
              className="px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 text-emerald-700 dark:text-emerald-400 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
            >
              <CheckCheck size={14} />
              <span>Markera alla närvarande</span>
            </button>

            <button
              onClick={handleClearAttendance}
              className="px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-rose-500 text-rose-600 dark:text-rose-400 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer hover:bg-rose-50 dark:hover:bg-rose-950/40"
            >
              <RotateCcw size={14} />
              <span>Rensa närvaro</span>
            </button>

            <button
              onClick={() => setShowInviteModal(true)}
              className="px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-indigo-500 dark:hover:border-indigo-400 text-zinc-800 dark:text-zinc-100 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700"
            >
              <Send size={14} className="text-indigo-600 dark:text-indigo-400" />
              <span>Skicka kallelse</span>
            </button>

            <button
              onClick={() => setShowAdminModal(true)}
              className="px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-indigo-500 dark:hover:border-indigo-400 text-zinc-800 dark:text-zinc-100 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700"
            >
              <Plus size={14} className="text-indigo-600 dark:text-indigo-400" />
              <span>Anmäl för spelare</span>
            </button>
          </div>
        </div>
      )}

      {/* Truppens Närvaro & Anmälningslista */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <Users size={16} className="text-indigo-600 dark:text-indigo-400" />
              Närvarolista för truppen ({filteredMembers.length})
            </h3>
            <p className="text-[11px] font-bold text-zinc-400">
              Klicka på "Närvarande" för att registrera vilka som är med på passet och beräknas i övningar/moment.
            </p>
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Sök spelare..."
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs font-bold text-zinc-900 dark:text-white placeholder-zinc-400 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider shrink-0 transition-colors cursor-pointer ${
              filter === 'all'
                ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200'
            }`}
          >
            Alla ({allMembers.length})
          </button>
          <button
            onClick={() => setFilter('present')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider shrink-0 transition-colors cursor-pointer ${
              filter === 'present'
                ? 'bg-indigo-600 text-white'
                : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100'
            }`}
          >
            Närvarande ({stats.presentCount})
          </button>
          <button
            onClick={() => setFilter('attending')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider shrink-0 transition-colors cursor-pointer ${
              filter === 'attending'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
            }`}
          >
            Kan delta ({stats.attending})
          </button>
          <button
            onClick={() => setFilter('partial')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider shrink-0 transition-colors cursor-pointer ${
              filter === 'partial'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100'
            }`}
          >
            Delvis ({stats.partial})
          </button>
          <button
            onClick={() => setFilter('declined')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider shrink-0 transition-colors cursor-pointer ${
              filter === 'declined'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100'
            }`}
          >
            Kan ej ({stats.declined})
          </button>
          <button
            onClick={() => setFilter('unanswered')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider shrink-0 transition-colors cursor-pointer ${
              filter === 'unanswered'
                ? 'bg-zinc-700 text-white'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200'
            }`}
          >
            Ej svarat ({stats.unanswered})
          </button>
          {guestPlayers.length > 0 && (
            <button
              onClick={() => setFilter('guests')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider shrink-0 transition-colors cursor-pointer ${
                filter === 'guests'
                  ? 'bg-purple-600 text-white'
                  : 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100'
              }`}
            >
              Provspelare ({guestPlayers.length})
            </button>
          )}
        </div>

        {/* Players List Grid */}
        {filteredMembers.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 text-zinc-400 font-bold text-xs">
            Inga personer matchar det valda filtret.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {filteredMembers.map(player => {
              const isGuest = player.id.startsWith('guest_');
              const isPresent = attendance.includes(player.id);
              const rsvp = rsvps[player.id];
              const status: RsvpStatus | 'unanswered' = rsvp?.status || 'unanswered';
              const isLeader = player.role === 'leader';

              return (
                <div
                  key={player.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col justify-between space-y-3 ${
                    isPresent
                      ? 'bg-white dark:bg-zinc-900 border-indigo-300 dark:border-indigo-800/80 shadow-xs ring-1 ring-indigo-200 dark:ring-indigo-900/40'
                      : status === 'attending'
                      ? 'bg-white dark:bg-zinc-900 border-emerald-200 dark:border-emerald-900/40 shadow-xs'
                      : status === 'declined'
                      ? 'bg-white dark:bg-zinc-900 border-rose-200 dark:border-rose-900/40 shadow-xs'
                      : 'bg-zinc-50/70 dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  {/* Top Row: Avatar, Full Name & Position on Left | Status Badge & Presence Toggle on Right */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden border border-zinc-200 dark:border-zinc-700 mt-0.5">
                        {player.photoUrl ? (
                          <CachedImage src={player.photoUrl} alt={player.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-sm font-black uppercase text-zinc-400 dark:text-zinc-500">{player.name.substring(0, 1)}</span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-black uppercase text-zinc-900 dark:text-white leading-snug break-words">
                            {player.name}
                          </p>

                          {isLeader && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-[10px] font-black uppercase tracking-wider shrink-0">
                              Tränare
                            </span>
                          )}

                          {isGuest && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800 text-[10px] font-black uppercase tracking-wider shrink-0">
                              Provspelare
                            </span>
                          )}
                        </div>

                        {isGuest ? (
                          <input
                            type="text"
                            value={player.position || ''}
                            onChange={(e) => updateGuestPosition(player.id, e.target.value)}
                            placeholder="Sätt position..."
                            className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 bg-transparent border-b border-dashed border-zinc-300 dark:border-zinc-700 outline-none focus:border-indigo-500 p-0 mt-0.5"
                          />
                        ) : (
                          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mt-0.5">
                            {player.position || (isLeader ? 'Tränare / Ledare' : 'Spelare')}
                            {player.number ? ` • #${player.number}` : ''}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right Column: Status Badge & Presence Button */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {!isGuest && (
                        <div className="shrink-0">
                          {status === 'attending' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-black uppercase tracking-wider">
                              <CheckCircle2 size={12} />
                              Kan delta
                            </span>
                          )}
                          {status === 'partial' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-[10px] font-black uppercase tracking-wider">
                              <AlertTriangle size={12} />
                              Delvis
                            </span>
                          )}
                          {status === 'declined' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800 text-[10px] font-black uppercase tracking-wider">
                              <XCircle size={12} />
                              Kan ej
                            </span>
                          )}
                          {status === 'unanswered' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 text-[10px] font-black uppercase tracking-wider">
                              <HelpCircle size={12} />
                              Ej svarat
                            </span>
                          )}
                        </div>
                      )}

                      {/* Presence Button directly under Status Badge */}
                      <button
                        type="button"
                        onClick={() => handleTogglePresence(player.id)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-black text-[10px] uppercase tracking-wider transition-all shadow-xs cursor-pointer active:scale-95 ${
                          isPresent
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200 dark:shadow-none border border-emerald-500'
                            : 'bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700'
                        }`}
                        title={isPresent ? 'Markerad som närvarande på passet (Klicka för att avmarkera)' : 'Ej markerad som närvarande (Klicka för att markera närvarande)'}
                      >
                        {isPresent ? (
                          <>
                            <Check size={12} strokeWidth={3} />
                            <span>Närvarande</span>
                          </>
                        ) : (
                          <>
                            <X size={12} />
                            <span>Frånvarande</span>
                          </>
                        )}
                      </button>

                      {isGuest && isCoachOrAdmin && (
                        <button
                          type="button"
                          onClick={() => removeGuest(player.id)}
                          className="p-1 text-zinc-400 hover:text-rose-600 transition-colors rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30"
                          title="Ta bort provspelare"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Comment & Timestamp */}
                  {rsvp?.comment && (
                    <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-150 dark:border-zinc-700/60 text-xs font-medium text-zinc-800 dark:text-zinc-200 flex items-start gap-2">
                      <MessageSquare size={14} className="text-indigo-500 shrink-0 mt-0.5" />
                      <span className="italic">"{rsvp.comment}"</span>
                    </div>
                  )}

                  {/* Bottom Row: Timestamp & Larger Coach Quick Buttons */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 pt-2 border-t border-zinc-100 dark:border-zinc-800/60">
                    <span className="text-[11px] leading-tight">
                      {!isGuest && rsvp
                        ? `Svarade ${new Date(rsvp.updatedAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${rsvp.updatedBy ? ` (${rsvp.updatedBy})` : ''}`
                        : isGuest
                        ? 'Provspelare tillagd på detta pass'
                        : 'Ingen anmälan registrerad ännu'}
                    </span>

                    {/* Quick coach edit buttons with LARGER touch targets */}
                    {isCoachOrAdmin && !isGuest && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          title={status === 'attending' ? 'Klicka för att rensa/klicka ur anmälan' : 'Markera anmälan: Kan delta (Ja)'}
                          onClick={() => saveRsvpForPlayer(player.id, 'attending', rsvp?.comment, `Tränare (${user?.displayName || 'Tränare'})`)}
                          className={`px-3 py-2 min-h-[38px] min-w-[42px] rounded-xl border text-xs font-black uppercase cursor-pointer transition-all active:scale-95 flex items-center justify-center ${
                            status === 'attending'
                              ? 'bg-emerald-600 text-white border-emerald-500 ring-2 ring-emerald-400/40 shadow-xs'
                              : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400'
                          }`}
                        >
                          Ja
                        </button>
                        <button
                          type="button"
                          title={status === 'partial' ? 'Klicka för att rensa/klicka ur anmälan' : 'Markera anmälan: Delvis'}
                          onClick={() => saveRsvpForPlayer(player.id, 'partial', rsvp?.comment, `Tränare (${user?.displayName || 'Tränare'})`)}
                          className={`px-3 py-2 min-h-[38px] min-w-[42px] rounded-xl border text-xs font-black uppercase cursor-pointer transition-all active:scale-95 flex items-center justify-center ${
                            status === 'partial'
                              ? 'bg-amber-600 text-white border-amber-500 ring-2 ring-amber-400/40 shadow-xs'
                              : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400'
                          }`}
                        >
                          Delvis
                        </button>
                        <button
                          type="button"
                          title={status === 'declined' ? 'Klicka för att rensa/klicka ur anmälan' : 'Markera anmälan: Kan ej (Nej)'}
                          onClick={() => saveRsvpForPlayer(player.id, 'declined', rsvp?.comment, `Tränare (${user?.displayName || 'Tränare'})`)}
                          className={`px-3 py-2 min-h-[38px] min-w-[42px] rounded-xl border text-xs font-black uppercase cursor-pointer transition-all active:scale-95 flex items-center justify-center ${
                            status === 'declined'
                              ? 'bg-rose-600 text-white border-rose-500 ring-2 ring-rose-400/40 shadow-xs'
                              : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-rose-500 hover:text-rose-600 dark:hover:text-rose-400'
                          }`}
                        >
                          Nej
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal 1: Klistra in lista */}
      <AnimatePresence>
        {showPasteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
            onClick={() => setShowPasteModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl border border-zinc-200 dark:border-zinc-800 space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <Clipboard size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                      Klistra in anmälningslista
                    </h3>
                    <p className="text-xs text-zinc-400 font-medium">
                      Från Svenskalag, Laget.se, SportAdmin, WhatsApp m.fl.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPasteModal(false)}
                  className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-zinc-600 dark:text-zinc-300 font-medium leading-relaxed">
                  Klistra in text med spelarnamn, status (t.ex. <em>Deltar</em>, <em>Deltar ej</em>) och ev. kommentarer (t.ex. i parentes eller efter bindestreck). Appen matchar automatiskt mot truppen.
                </p>

                <textarea
                  rows={6}
                  value={pasteValue}
                  onChange={(e) => setPasteValue(e.target.value)}
                  placeholder={`Klistra in anmälningar här, t.ex:\n\nHaythem Noor Deltar (Kommer 10 min sent)\nCornelis Setterholm - Deltar ej - Bortrest\nErik Johansson Deltar`}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-4 text-xs font-bold text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 placeholder-zinc-400 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPasteModal(false)}
                  className="px-4 py-2.5 rounded-xl text-zinc-500 hover:text-zinc-800 font-bold text-xs"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={handlePaste}
                  disabled={!pasteValue.trim()}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center gap-2 cursor-pointer"
                >
                  <Check size={16} />
                  <span>Verkställ anmälningar</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal 2: Lägg till provspelare */}
      <AnimatePresence>
        {showGuestModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
            onClick={() => setShowGuestModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-zinc-200 dark:border-zinc-800 space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                    <UserPlus size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                      Lägg till provspelare / gäst
                    </h3>
                    <p className="text-xs text-zinc-400 font-medium">
                      Läggs till på detta träningspass
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGuestModal(false)}
                  className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleAddGuest} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-1">
                    Spelarens namn:
                  </label>
                  <input
                    type="text"
                    required
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="Förnamn och Efternamn..."
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs font-bold text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-1">
                    Position (valfritt):
                  </label>
                  <input
                    type="text"
                    value={guestPosition}
                    onChange={(e) => setGuestPosition(e.target.value)}
                    placeholder="T.ex. Målvakt, Anfallare, Mittfältare..."
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs font-bold text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowGuestModal(false)}
                    className="px-4 py-2.5 rounded-xl text-zinc-500 hover:text-zinc-800 font-bold text-xs"
                  >
                    Avbryt
                  </button>
                  <button
                    type="submit"
                    disabled={!guestName.trim()}
                    className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Plus size={16} />
                    <span>Lägg till & markera närvarande</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal 3: Skicka Kallelse / Notis */}
      <AnimatePresence>
        {showInviteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
            onClick={() => setShowInviteModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-zinc-200 dark:border-zinc-800 space-y-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <Send size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                      Skicka kallelse till truppen
                    </h3>
                    <p className="text-xs text-zinc-400 font-medium">
                      Inbjudan skickas till alla {safeSquad.length} medlemmar
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSendInvitations} className="space-y-4">
                {/* Deadline input */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-1">
                      Svara senast datum:
                    </label>
                    <input
                      type="date"
                      value={deadlineDate}
                      onChange={(e) => setDeadlineDate(e.target.value)}
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs font-bold text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-1">
                      Klockslag:
                    </label>
                    <input
                      type="time"
                      value={deadlineTime}
                      onChange={(e) => setDeadlineTime(e.target.value)}
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs font-bold text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {/* Notes input */}
                <div>
                  <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-1">
                    Meddelande / Instruktioner:
                  </label>
                  <textarea
                    rows={3}
                    value={inviteNotes}
                    onChange={(e) => setInviteNotes(e.target.value)}
                    placeholder="T.ex. 'Samling kl 17:15 i omklädningsrum 3. Medtag löpskor och vattenflaska.'"
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs font-bold text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 placeholder-zinc-400"
                  />
                </div>

                {/* Dispatch options */}
                <div className="space-y-2 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={sendPush}
                      onChange={(e) => setSendPush(e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-zinc-300"
                    />
                    <Bell size={14} className="text-indigo-500" />
                    <span>Skicka push-notis i appen</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={sendEmail}
                      onChange={(e) => setSendEmail(e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-zinc-300"
                    />
                    <Mail size={14} className="text-indigo-500" />
                    <span>Skicka e-postkallelse</span>
                  </label>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    className="px-4 py-2 rounded-xl text-zinc-500 hover:text-zinc-800 font-bold text-xs"
                  >
                    Avbryt
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Send size={14} />
                    <span>Skicka kallelse nu</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal 4: Anmäl för en spelare (Admin/Coach) */}
      <AnimatePresence>
        {showAdminModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
            onClick={() => setShowAdminModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-zinc-200 dark:border-zinc-800 space-y-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                      Anmäl å spelarens vägnar
                    </h3>
                    <p className="text-xs text-zinc-400 font-medium">
                      Registrera eller ändra anmälan för valfri spelare
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleAdminSaveRsvp} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-1">
                    Välj spelare:
                  </label>
                  <select
                    required
                    value={adminTargetPlayerId}
                    onChange={(e) => setAdminTargetPlayerId(e.target.value)}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs font-bold text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    <option value="">-- Välj spelare från truppen --</option>
                    {safeSquad.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.number ? `(#${p.number})` : ''} - [{rsvps[p.id]?.status ? rsvps[p.id]?.status : 'Ej svarat'}]
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-1">
                    Anmälningsstatus:
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setAdminStatus('attending')}
                      className={`py-2 rounded-xl font-black text-xs uppercase border transition-all cursor-pointer ${
                        adminStatus === 'attending'
                          ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                          : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200'
                      }`}
                    >
                      Kan delta
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdminStatus('partial')}
                      className={`py-2 rounded-xl font-black text-xs uppercase border transition-all cursor-pointer ${
                        adminStatus === 'partial'
                          ? 'bg-amber-600 text-white border-amber-500 shadow-sm'
                          : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200'
                      }`}
                    >
                      Delvis
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdminStatus('declined')}
                      className={`py-2 rounded-xl font-black text-xs uppercase border transition-all cursor-pointer ${
                        adminStatus === 'declined'
                          ? 'bg-rose-600 text-white border-rose-500 shadow-sm'
                          : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200'
                      }`}
                    >
                      Kan ej
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-1">
                    Kommentar / Notering:
                  </label>
                  <input
                    type="text"
                    value={adminComment}
                    onChange={(e) => setAdminComment(e.target.value)}
                    placeholder="Valfri kommentar..."
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs font-bold text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setShowAdminModal(false)}
                    className="px-4 py-2 rounded-xl text-zinc-500 hover:text-zinc-800 font-bold text-xs"
                  >
                    Avbryt
                  </button>
                  <button
                    type="submit"
                    disabled={!adminTargetPlayerId}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Check size={14} />
                    <span>Spara anmälan</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
