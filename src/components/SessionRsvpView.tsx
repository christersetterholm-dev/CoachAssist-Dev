import React, { useState, useMemo, useRef, useEffect } from 'react';
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
  ClipboardPaste,
  ClipboardCheck,
  UserPlus,
  CheckCheck,
  RotateCcw,
  Trash2,
  Trophy,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TrainingSession, SquadPlayer, RsvpStatus, PlayerRsvp, SessionRsvpConfig, UserProfile } from '../types';
import { CachedImage } from './CachedImage';
import { findSquadMatch } from '../lib/teamUtils';
import { isMatchSession } from '../utils/sessionCategory';

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
  adminUrl,
  onOpenLineup
}) => {
  const [filter, setFilter] = useState<'all' | 'present' | 'attending' | 'partial' | 'declined' | 'unanswered' | 'guests'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const isMatch = useMemo(() => isMatchSession(session), [session]);

  // Collapsible boxes states (persisted in localStorage for convenience)
  const [isMatchBannerCollapsed, setIsMatchBannerCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('session_rsvp_match_banner_collapsed') === 'true';
  });
  const [isMyRsvpCollapsed, setIsMyRsvpCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('session_rsvp_myrsvp_collapsed') === 'true';
  });
  const [isToolsCollapsed, setIsToolsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('session_rsvp_tools_collapsed') === 'true';
  });
  const [isInviteCollapsed, setIsInviteCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('session_rsvp_invite_collapsed') === 'true';
  });

  const areAllBoxesCollapsed = isMyRsvpCollapsed && isToolsCollapsed && (!session.rsvpConfig || isInviteCollapsed) && (!isMatch || isMatchBannerCollapsed);
  const handleToggleAllBoxes = () => {
    const next = !areAllBoxesCollapsed;
    setIsMyRsvpCollapsed(next);
    setIsToolsCollapsed(next);
    setIsInviteCollapsed(next);
    setIsMatchBannerCollapsed(next);
    localStorage.setItem('session_rsvp_myrsvp_collapsed', String(next));
    localStorage.setItem('session_rsvp_tools_collapsed', String(next));
    localStorage.setItem('session_rsvp_invite_collapsed', String(next));
    localStorage.setItem('session_rsvp_match_banner_collapsed', String(next));
  };

  const [showConfirmClearRsvps, setShowConfirmClearRsvps] = useState(false);
  const [showConfirmClearAttendance, setShowConfirmClearAttendance] = useState(false);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [pasteAlsoMarkPresent, setPasteAlsoMarkPresent] = useState<boolean>(true);

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
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [clipboardStatus, setClipboardStatus] = useState<'idle' | 'pasted' | 'failed'>('idle');

  // Smoothly and reliably focus the textarea when the modal opens on both mobile and desktop
  useEffect(() => {
    if (showPasteModal) {
      setClipboardStatus('idle');
      const timer = setTimeout(() => {
        if (pasteTextareaRef.current) {
          pasteTextareaRef.current.focus();
          const len = pasteTextareaRef.current.value.length;
          pasteTextareaRef.current.setSelectionRange(len, len);
        }
      }, 70);
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
          if (pasteTextareaRef.current) {
            pasteTextareaRef.current.focus();
          }
          return;
        }
      }
    } catch (err) {
      console.warn('Clipboard readText failed or was blocked by browser:', err);
      setClipboardStatus('failed');
      setTimeout(() => setClipboardStatus('idle'), 3000);
    }
    // Fallback: focus textarea so user can paste via Cmd+V / Ctrl+V or long-press
    pasteTextareaRef.current?.focus();
  };

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

  // Mark all registered (rsvp'd attending or partial) as present
  const handleMarkAllRsvpdAsPresent = () => {
    const rsvpdIds = Object.entries(rsvps)
      .filter(([_, rsvp]) => {
        const r = rsvp as PlayerRsvp;
        return r && (r.status === 'attending' || r.status === 'partial');
      })
      .map(([playerId]) => playerId);

    if (rsvpdIds.length === 0) {
      alert("Det finns inga anmälda spelare att markera som närvarande.");
      return;
    }

    const mergedAttendance = Array.from(new Set([...attendance, ...rsvpdIds]));
    onUpdateSession({
      ...session,
      attendance: mergedAttendance,
      updatedAt: Date.now()
    });
    setSavedToast('Alla anmälda spelare har markerats som närvarande.');
    setTimeout(() => setSavedToast(null), 3000);
  };

  // Clear all attendance
  const handleClearAttendance = () => {
    onUpdateSession({
      ...session,
      attendance: [],
      updatedAt: Date.now()
    });
    setShowConfirmClearAttendance(false);
    setSavedToast('Närvarolistan har rensats.');
    setTimeout(() => setSavedToast(null), 3000);
  };

  // Clear all RSVPs / registrations
  const handleClearRsvps = () => {
    onUpdateSession({
      ...session,
      rsvps: {},
      updatedAt: Date.now()
    });
    setMyStatus(null);
    setMyComment('');
    setShowConfirmClearRsvps(false);
    setSavedToast('Alla anmälningar har rensats för detta pass.');
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

  const targetAdminUrl = adminUrl || (session as any).adminUrl;

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

      {/* Global toggle for collapsing/expanding all boxes */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400">
          {areAllBoxesCollapsed ? 'Boxarna är hopfällda för snabb närvarovy' : 'Klicka på valfri box för att fälla ihop den'}
        </span>
        <button
          type="button"
          onClick={handleToggleAllBoxes}
          className="text-[11px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 flex items-center gap-1.5 cursor-pointer bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 rounded-xl shadow-xs transition-all active:scale-95 shrink-0"
          title={areAllBoxesCollapsed ? 'Fäll ut alla boxar' : 'Fäll ihop alla boxar'}
        >
          {areAllBoxesCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          <span>{areAllBoxesCollapsed ? 'Fäll ut alla boxar' : 'Fäll ihop alla boxar'}</span>
        </button>
      </div>

      {/* Match Lineup CTA Banner if onOpenLineup is available and activity is a match */}
      {isMatch && onOpenLineup && (
        <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-indigo-950 text-white rounded-3xl shadow-sm border border-indigo-700/60 overflow-hidden transition-all">
          <div 
            onClick={() => {
              setIsMatchBannerCollapsed(prev => {
                const next = !prev;
                localStorage.setItem('session_rsvp_match_banner_collapsed', String(next));
                return next;
              });
            }}
            className="p-4 sm:p-5 flex items-center justify-between cursor-pointer select-none hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center shrink-0 border border-white/15">
                <Trophy size={20} className="text-amber-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider bg-indigo-500/40 text-indigo-200 px-2 py-0.5 rounded-md">Matchaktivitet</span>
                  <span className="text-xs font-bold text-indigo-200">{stats.attending} anmälda spelare</span>
                </div>
                <p className="text-xs sm:text-sm font-black text-white mt-0.5 truncate">Skapa eller öppna laguppställning med anmälda spelare</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenLineup(session);
                }}
                className="px-3.5 py-2 bg-white hover:bg-indigo-50 text-indigo-950 rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md transition-all active:scale-95 cursor-pointer"
              >
                <Users size={14} className="text-indigo-600" />
                <span className="hidden sm:inline">Öppna</span>
                <ArrowRight size={14} />
              </button>
              <div className="p-1 text-indigo-300 hover:text-white">
                {isMatchBannerCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>
            </div>
          </div>
          <AnimatePresence initial={false}>
            {!isMatchBannerCollapsed && (
              <motion.div
                key="match-banner-content"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-4 pt-1 border-t border-indigo-700/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-indigo-200">
                  <p>
                    {stats.attending > 0 
                      ? `${stats.attending} spelare har anmält att de kan delta. Klicka för att gå till laguppställningen och planera startelva och avbytare.`
                      : 'Inga anmälda spelare än. Du kan ändå förbereda laguppställningen och taktiktavlan inför matchen.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenLineup(session)}
                    className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-2 shrink-0 transition-all cursor-pointer self-start sm:self-auto"
                  >
                    <span>Hantera uppställning</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Invitation Info Banner if invitation exists */}
      {session.rsvpConfig && (
        <div className="rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 overflow-hidden text-indigo-950 dark:text-indigo-200">
          <div 
            onClick={() => {
              setIsInviteCollapsed(prev => {
                const next = !prev;
                localStorage.setItem('session_rsvp_invite_collapsed', String(next));
                return next;
              });
            }}
            className="p-4 flex items-center justify-between cursor-pointer select-none hover:bg-indigo-100/50 dark:hover:bg-indigo-900/30 transition-colors"
          >
            <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              <Bell size={14} />
              <span>Inbjudan utskickad</span>
              {session.rsvpConfig.deadline && isInviteCollapsed && (
                <span className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300 ml-2 hidden sm:inline">
                  (Sista svar: {new Date(session.rsvpConfig.deadline).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {session.rsvpConfig.deadline && !isInviteCollapsed && (
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800 text-xs font-black text-indigo-700 dark:text-indigo-300 shrink-0">
                  <Clock size={13} />
                  <span>Sista svar: {new Date(session.rsvpConfig.deadline).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}
              <div className="p-1 text-indigo-400">
                {isInviteCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </div>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {!isInviteCollapsed && (
              <motion.div
                key="invite-content"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 pt-1 border-t border-indigo-200/50 dark:border-indigo-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    {session.rsvpConfig.invitedAt && (
                      <span className="text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                        Skickad {new Date(session.rsvpConfig.invitedAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    {session.rsvpConfig.notes && (
                      <p className="text-xs font-bold italic text-zinc-700 dark:text-zinc-300">
                        "{session.rsvpConfig.notes}"
                      </p>
                    )}
                  </div>
                  {session.rsvpConfig.deadline && (
                    <div className="sm:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800 text-xs font-black text-indigo-700 dark:text-indigo-300 shrink-0">
                      <Clock size={14} />
                      <span>Sista svar: {new Date(session.rsvpConfig.deadline).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Logged in Player's Own RSVP Form */}
      {safeSquad.length > 0 && (
        <div className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden transition-all">
          <div 
            onClick={() => {
              setIsMyRsvpCollapsed(prev => {
                const next = !prev;
                localStorage.setItem('session_rsvp_myrsvp_collapsed', String(next));
                return next;
              });
            }}
            className="p-4 sm:p-5 flex items-center justify-between cursor-pointer select-none hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <UserCheck size={18} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
              <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">
                Din anmälan för detta pass
              </h3>
              {isMyRsvpCollapsed && myStatus && (
                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ml-2 flex items-center gap-1 shrink-0 ${
                  myStatus === 'attending' 
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' 
                    : myStatus === 'partial' 
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800' 
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                }`}>
                  {myStatus === 'attending' && <CheckCircle2 size={12} />}
                  {myStatus === 'partial' && <AlertTriangle size={12} />}
                  {myStatus === 'declined' && <XCircle size={12} />}
                  <span>{myStatus === 'attending' ? 'Kan delta' : myStatus === 'partial' ? 'Delvis' : 'Kan inte delta'}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Quick selector if user wants to change which player profile is being used */}
              {safeSquad.length > 1 && (
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs font-bold text-zinc-400 hidden sm:inline">Profil:</span>
                  <select
                    value={matchedPlayer?.id || ''}
                    onChange={(e) => setSelectedPlayerId(e.target.value)}
                    className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-2.5 py-1 text-xs font-bold text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    {safeSquad.map(p => (
                      <option key={p.id} value={p.id}>{p.name} {p.number ? `(#${p.number})` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                {isMyRsvpCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {!isMyRsvpCollapsed && (
              <motion.div
                key="myrsvp-content"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-5 pt-1 border-t border-zinc-100 dark:border-zinc-800 space-y-4">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium pt-1">
                    Välj om du kan delta, kan delta delvis eller är förhindrad.
                  </p>
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Admin / Coach Action Toolbar */}
      {isCoachOrAdmin && (
        <div className="rounded-3xl bg-zinc-100/90 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden transition-all">
          <div 
            onClick={() => {
              setIsToolsCollapsed(prev => {
                const next = !prev;
                localStorage.setItem('session_rsvp_tools_collapsed', String(next));
                return next;
              });
            }}
            className="p-4 sm:p-5 flex items-center justify-between cursor-pointer select-none hover:bg-zinc-200/50 dark:hover:bg-zinc-800/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                Ledarverktyg för Närvaro & Anmälan
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300">
                {attendance.length} närvarande
              </span>
              <div className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                {isToolsCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {!isToolsCollapsed && (
              <motion.div
                key="tools-content"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-zinc-200/60 dark:border-zinc-800/80">
                  <div className="flex flex-wrap items-center gap-2 pt-2">
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
                      onClick={handleMarkAllRsvpdAsPresent}
                      className="px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 text-emerald-700 dark:text-emerald-400 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                    >
                      <CheckCheck size={14} />
                      <span>Markera alla anmälda som närvarande</span>
                    </button>

                    <button
                      onClick={handleMarkAllPresent}
                      className="px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 text-emerald-700 dark:text-emerald-400 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                    >
                      <CheckCheck size={14} />
                      <span>Markera alla närvarande</span>
                    </button>

                    {showConfirmClearAttendance ? (
                      <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/60 p-1 rounded-xl border border-rose-300 dark:border-rose-700">
                        <span className="text-[11px] font-bold text-rose-700 dark:text-rose-300 px-1">Rensa närvaro?</span>
                        <button
                          type="button"
                          onClick={handleClearAttendance}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-lg transition-all cursor-pointer shadow-xs"
                        >
                          Ja, rensa
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowConfirmClearAttendance(false)}
                          className="px-2 py-1 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold text-xs rounded-lg hover:bg-zinc-300 transition-all cursor-pointer"
                        >
                          Avbryt
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setShowConfirmClearAttendance(true);
                          setShowConfirmClearRsvps(false);
                        }}
                        className="px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-rose-500 text-rose-600 dark:text-rose-400 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        title="Rensa all registrerad fysisk närvaro för detta pass"
                      >
                        <RotateCcw size={14} />
                        <span>Rensa närvaro</span>
                      </button>
                    )}

                    {showConfirmClearRsvps ? (
                      <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/60 p-1 rounded-xl border border-rose-300 dark:border-rose-700">
                        <span className="text-[11px] font-bold text-rose-700 dark:text-rose-300 px-1">Rensa alla anmälningar?</span>
                        <button
                          type="button"
                          onClick={handleClearRsvps}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-lg transition-all cursor-pointer shadow-xs"
                        >
                          Ja, rensa
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowConfirmClearRsvps(false)}
                          className="px-2 py-1 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold text-xs rounded-lg hover:bg-zinc-300 transition-all cursor-pointer"
                        >
                          Avbryt
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setShowConfirmClearRsvps(true);
                          setShowConfirmClearAttendance(false);
                        }}
                        className="px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-rose-500 text-rose-600 dark:text-rose-400 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        title="Rensa alla anmälningar (svarsstatus och kommentarer) för detta pass"
                      >
                        <RotateCcw size={14} />
                        <span>Rensa anmälan</span>
                      </button>
                    )}

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
              </motion.div>
            )}
          </AnimatePresence>
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
                  {/* Top Row: Avatar, Full Name & Position on Left | Primary Presence Toggle on Right */}
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

                    {/* Right Column: Unified Presence Toggle Button */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTogglePresence(player.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all shadow-xs cursor-pointer active:scale-95 ${
                          isPresent
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200 dark:shadow-none border border-emerald-500'
                            : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700'
                        }`}
                        title={isPresent ? 'Markerad som närvarande på passet (Klicka för att avmarkera)' : 'Ej markerad som närvarande (Klicka för att markera närvarande)'}
                      >
                        {isPresent ? (
                          <>
                            <Check size={14} strokeWidth={3} />
                            <span>Närvarande</span>
                          </>
                        ) : (
                          <>
                            <X size={14} />
                            <span>Frånvarande</span>
                          </>
                        )}
                      </button>

                      {isGuest && isCoachOrAdmin && (
                        <button
                          type="button"
                          onClick={() => removeGuest(player.id)}
                          className="p-1.5 text-zinc-400 hover:text-rose-600 transition-colors rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30"
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

                  {/* Bottom Row: RSVP Status summary & Quick RSVP buttons */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 pt-2 border-t border-zinc-100 dark:border-zinc-800/60">
                    <div className="flex items-center gap-2">
                      {!isGuest ? (
                        <>
                          <span className="text-[11px] font-bold">Anmälan:</span>
                          {status === 'attending' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold text-[10px] uppercase">
                              <CheckCircle2 size={11} /> Kan delta
                            </span>
                          )}
                          {status === 'partial' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold text-[10px] uppercase">
                              <AlertTriangle size={11} /> Delvis
                            </span>
                          )}
                          {status === 'declined' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 font-bold text-[10px] uppercase">
                              <XCircle size={11} /> Kan ej
                            </span>
                          )}
                          {status === 'unanswered' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-bold text-[10px] uppercase">
                              <HelpCircle size={11} /> Ej svarat
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[11px] font-medium text-purple-600 dark:text-purple-400">Provspelare</span>
                      )}
                    </div>

                    {/* Quick coach edit buttons with 1-click status & presence sync */}
                    {isCoachOrAdmin && !isGuest && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          title={status === 'attending' ? 'Redan markerad som Kommer (Klicka för att rensa)' : 'Sätt anmälan: Kommer (markerar även närvarande)'}
                          onClick={() => saveRsvpForPlayer(player.id, 'attending', rsvp?.comment, `Tränare (${user?.displayName || 'Tränare'})`)}
                          className={`px-2.5 py-1 rounded-lg border text-xs font-black uppercase cursor-pointer transition-all active:scale-95 flex items-center gap-1 ${
                            status === 'attending'
                              ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
                              : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 hover:text-emerald-600'
                          }`}
                        >
                          <Check size={12} />
                          <span>Kommer</span>
                        </button>
                        <button
                          type="button"
                          title={status === 'partial' ? 'Redan markerad som Delvis (Klicka för att rensa)' : 'Sätt anmälan: Delvis'}
                          onClick={() => saveRsvpForPlayer(player.id, 'partial', rsvp?.comment, `Tränare (${user?.displayName || 'Tränare'})`)}
                          className={`px-2.5 py-1 rounded-lg border text-xs font-black uppercase cursor-pointer transition-all active:scale-95 flex items-center gap-1 ${
                            status === 'partial'
                              ? 'bg-amber-600 text-white border-amber-500 shadow-xs'
                              : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-amber-500 hover:text-amber-600'
                          }`}
                        >
                          <AlertTriangle size={12} />
                          <span>Delvis</span>
                        </button>
                        <button
                          type="button"
                          title={status === 'declined' ? 'Redan markerad som Kan ej (Klicka för att rensa)' : 'Sätt anmälan: Kan ej (tar bort från närvaro)'}
                          onClick={() => saveRsvpForPlayer(player.id, 'declined', rsvp?.comment, `Tränare (${user?.displayName || 'Tränare'})`)}
                          className={`px-2.5 py-1 rounded-lg border text-xs font-black uppercase cursor-pointer transition-all active:scale-95 flex items-center gap-1 ${
                            status === 'declined'
                              ? 'bg-rose-600 text-white border-rose-500 shadow-xs'
                              : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-rose-500 hover:text-rose-600'
                          }`}
                        >
                          <X size={12} />
                          <span>Kan ej</span>
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
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              transition={{ duration: 0.15 }}
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
                  className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <p className="text-xs text-zinc-600 dark:text-zinc-300 font-medium leading-relaxed">
                    Klistra in text med spelarnamn, status (t.ex. <em>Deltar</em>, <em>Deltar ej</em>) och ev. kommentarer.
                  </p>
                  <button
                    type="button"
                    onClick={handlePasteFromClipboard}
                    className="self-start sm:self-auto shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 text-xs font-bold transition-all border border-indigo-200 dark:border-indigo-800/80 cursor-pointer shadow-xs active:scale-95"
                    title="Klistra in direkt från enhetens urklipp med 1 tryck"
                  >
                    {clipboardStatus === 'pasted' ? (
                      <>
                        <ClipboardCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
                        <span className="text-emerald-700 dark:text-emerald-300 font-bold">Inklistrat!</span>
                      </>
                    ) : (
                      <>
                        <ClipboardPaste size={14} />
                        <span>Klistra in från urklipp</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="relative">
                  <textarea
                    ref={pasteTextareaRef}
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    rows={6}
                    value={pasteValue}
                    onChange={(e) => setPasteValue(e.target.value)}
                    onPaste={(e) => {
                      // Immediate capture safeguard in case virtual keyboard input lag occurs
                      const pasted = e.clipboardData?.getData('text');
                      if (pasted && !pasteValue) {
                        setPasteValue(pasted);
                      }
                    }}
                    placeholder={`Klistra in anmälningar här, t.ex:\n\nHaythem Noor Deltar (Kommer 10 min sent)\nCornelis Setterholm - Deltar ej - Bortrest\nErik Johansson Deltar`}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-4 text-xs font-bold text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 placeholder-zinc-400 font-mono"
                  />
                  {pasteValue && (
                    <button
                      type="button"
                      onClick={() => {
                        setPasteValue('');
                        pasteTextareaRef.current?.focus();
                      }}
                      className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-zinc-200/80 hover:bg-zinc-300 dark:bg-zinc-700/80 dark:hover:bg-zinc-600 text-zinc-600 dark:text-zinc-300 text-[11px] font-bold transition-all cursor-pointer"
                      title="Rensa text"
                    >
                      Rensa
                    </button>
                  )}
                </div>

                {clipboardStatus === 'failed' && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                    Kunde inte läsa urklipp automatiskt (behörighet saknas). Klicka i rutan ovan och välj Klistra in (eller Cmd+V / Ctrl+V).
                  </p>
                )}

                <label className="flex items-center gap-2.5 p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pasteAlsoMarkPresent}
                    onChange={(e) => setPasteAlsoMarkPresent(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <div>
                    <span className="block text-xs font-black text-indigo-950 dark:text-indigo-200">
                      Markera automatiskt anmälda som närvarande
                    </span>
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                      Sparar dubbelklick – spelarna blir direkt valbara i laguppställning och övningar.
                    </span>
                  </div>
                </label>
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
