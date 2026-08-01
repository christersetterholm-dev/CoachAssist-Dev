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
  UserCheck
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
}

export const SessionRsvpView: React.FC<SessionRsvpViewProps> = ({
  session,
  squad = [],
  onUpdateSession,
  user,
  userRoles = ['admin', 'coach']
}) => {
  const [filter, setFilter] = useState<'all' | 'attending' | 'partial' | 'declined' | 'unanswered'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);

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

  const isCoachOrAdmin = useMemo(() => {
    if (!user) return true; // Offline / admin fallback
    return userRoles.includes('admin') || userRoles.includes('coach');
  }, [user, userRoles]);

  // Identify logged in player from squad
  const matchedPlayer = useMemo(() => {
    if (!squad || squad.length === 0) return null;
    if (selectedPlayerId) {
      return squad.find(p => p.id === selectedPlayerId) || null;
    }
    if (!user) return squad[0] || null;

    if (user.email) {
      const matchEmail = squad.find(p => p.email?.toLowerCase().trim() === user.email?.toLowerCase().trim());
      if (matchEmail) return matchEmail;
    }
    const matchId = squad.find(p => p.id === user.uid || (p as any).userId === user.uid);
    if (matchId) return matchId;

    if (user.displayName) {
      const matchName = squad.find(p => p.name.toLowerCase().trim() === user.displayName?.toLowerCase().trim());
      if (matchName) return matchName;
    }

    return squad[0] || null;
  }, [squad, user, selectedPlayerId]);

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

    squad.forEach(p => {
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

    return { attending, partial, declined, unanswered, total: squad.length };
  }, [squad, rsvps]);

  // Save an RSVP entry and update session attendance automatically
  const saveRsvpForPlayer = (playerId: string, status: RsvpStatus, comment?: string, byWho?: string) => {
    const currentRsvps = session.rsvps || {};
    const newRsvps: Record<string, PlayerRsvp> = {
      ...currentRsvps,
      [playerId]: {
        status,
        comment: comment?.trim() || undefined,
        updatedAt: Date.now(),
        updatedBy: byWho || (user?.displayName || user?.email || 'Spelare')
      }
    };

    const currentAttendance = session.attendance || [];
    let newAttendance = [...currentAttendance];

    if (status === 'attending' || status === 'partial') {
      if (!newAttendance.includes(playerId)) {
        newAttendance.push(playerId);
      }
    } else if (status === 'declined') {
      newAttendance = newAttendance.filter(id => id !== playerId);
    }

    onUpdateSession({
      ...session,
      rsvps: newRsvps,
      attendance: newAttendance,
      updatedAt: Date.now()
    });

    setSavedToast('Anmälan sparades och närvarolistan har uppdaterats!');
    setTimeout(() => setSavedToast(null), 3000);
  };

  const handleSaveMyRsvp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchedPlayer || !myStatus) return;
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
      invitedCount: squad.length
    };

    onUpdateSession({
      ...session,
      rsvpConfig: newConfig,
      updatedAt: Date.now()
    });

    setShowInviteModal(false);
    setSavedToast(`📢 Kallelse utskickad via ${sendPush ? 'Notis' : ''}${sendPush && sendEmail ? ' & ' : ''}${sendEmail ? 'E-post' : ''} till ${squad.length} medlemmar!`);
    setTimeout(() => setSavedToast(null), 4000);
  };

  // Filtered members list
  const filteredSquad = useMemo(() => {
    return squad.filter(player => {
      const rsvp = rsvps[player.id];
      const status = rsvp?.status || 'unanswered';

      if (filter === 'attending' && status !== 'attending') return false;
      if (filter === 'partial' && status !== 'partial') return false;
      if (filter === 'declined' && status !== 'declined') return false;
      if (filter === 'unanswered' && status !== 'unanswered') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = player.name.toLowerCase().includes(q);
        const matchesPos = player.position?.toLowerCase().includes(q);
        const matchesNum = player.number?.toLowerCase().includes(q);
        return matchesName || matchesPos || matchesNum;
      }

      return true;
    });
  }, [squad, rsvps, filter, searchQuery]);

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
          onClick={() => setFilter(filter === 'attending' ? 'all' : 'attending')}
          className={`p-4 rounded-2xl border transition-all text-left flex flex-col justify-between ${
            filter === 'attending'
              ? 'bg-emerald-500 text-white border-emerald-600 shadow-md scale-[1.02]'
              : 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-300 hover:border-emerald-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider opacity-80">Kan delta</span>
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

        <button
          onClick={() => setFilter(filter === 'unanswered' ? 'all' : 'unanswered')}
          className={`p-4 rounded-2xl border transition-all text-left flex flex-col justify-between ${
            filter === 'unanswered'
              ? 'bg-zinc-700 text-white border-zinc-800 shadow-md scale-[1.02]'
              : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider opacity-80">Ej svarat</span>
            <HelpCircle size={18} className="shrink-0" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-black">{stats.unanswered}</span>
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
      {squad.length > 0 && (
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
            {squad.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-400">Profil:</span>
                <select
                  value={matchedPlayer?.id || ''}
                  onChange={(e) => setSelectedPlayerId(e.target.value)}
                  className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-1.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  {squad.map(p => (
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
                onClick={() => setMyStatus('attending')}
                className={`p-4 rounded-2xl border text-left transition-all flex items-center gap-3.5 ${
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
                onClick={() => setMyStatus('partial')}
                className={`p-4 rounded-2xl border text-left transition-all flex items-center gap-3.5 ${
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
                onClick={() => setMyStatus('declined')}
                className={`p-4 rounded-2xl border text-left transition-all flex items-center gap-3.5 ${
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
                disabled={!myStatus}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center gap-2 cursor-pointer ml-auto"
              >
                <Check size={16} />
                <span>Spara anmälan</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin / Coach Action Row */}
      {isCoachOrAdmin && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-zinc-100/70 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-black uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              Tränarverktyg
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setShowInviteModal(true)}
              className="px-3.5 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:border-indigo-500 text-zinc-800 dark:text-zinc-200 font-bold text-xs flex items-center gap-2 shadow-sm transition-all"
            >
              <Send size={14} className="text-indigo-600 dark:text-indigo-400" />
              <span>Skicka kallelse (Notis / E-post)</span>
            </button>

            <button
              onClick={() => setShowAdminModal(true)}
              className="px-3.5 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:border-indigo-500 text-zinc-800 dark:text-zinc-200 font-bold text-xs flex items-center gap-2 shadow-sm transition-all"
            >
              <Plus size={14} className="text-indigo-600 dark:text-indigo-400" />
              <span>Anmäl för spelare</span>
            </button>
          </div>
        </div>
      )}

      {/* Truppens Anmälningslista */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
            <Users size={16} className="text-indigo-600 dark:text-indigo-400" />
            Anmälningsstatus for truppen ({filteredSquad.length})
          </h3>

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

        {/* Players List Grid */}
        {filteredSquad.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 text-zinc-400 font-bold text-xs">
            Inga spelare matchar det valda filtret.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredSquad.map(player => {
              const rsvp = rsvps[player.id];
              const status: RsvpStatus | 'unanswered' = rsvp?.status || 'unanswered';

              return (
                <div
                  key={player.id}
                  className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between space-y-2.5 ${
                    status === 'attending'
                      ? 'bg-white dark:bg-zinc-900 border-emerald-200 dark:border-emerald-900/40 shadow-sm'
                      : status === 'partial'
                      ? 'bg-white dark:bg-zinc-900 border-amber-200 dark:border-amber-900/40 shadow-sm'
                      : status === 'declined'
                      ? 'bg-white dark:bg-zinc-900 border-rose-200 dark:border-rose-900/40 shadow-sm'
                      : 'bg-zinc-50/70 dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden border border-zinc-200 dark:border-zinc-700">
                        {player.photoUrl ? (
                          <CachedImage src={player.photoUrl} alt={player.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs font-black uppercase text-zinc-400">{player.name.substring(0, 1)}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase text-zinc-900 dark:text-white truncate">
                          {player.name}
                        </p>
                        <p className="text-[10px] font-bold text-zinc-400">
                          {player.position || 'Spelare'} {player.number ? `• #${player.number}` : ''}
                        </p>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="shrink-0">
                      {status === 'attending' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-black uppercase tracking-wider">
                          <CheckCircle2 size={12} />
                          Kan delta
                        </span>
                      )}
                      {status === 'partial' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-[10px] font-black uppercase tracking-wider">
                          <AlertTriangle size={12} />
                          Delvis
                        </span>
                      )}
                      {status === 'declined' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 text-[10px] font-black uppercase tracking-wider">
                          <XCircle size={12} />
                          Kan ej
                        </span>
                      )}
                      {status === 'unanswered' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 text-[10px] font-black uppercase tracking-wider">
                          <HelpCircle size={12} />
                          Ej svarat
                        </span>
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

                  <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 pt-1 border-t border-zinc-100 dark:border-zinc-800/60">
                    <span>
                      {rsvp ? `Svarade ${new Date(rsvp.updatedAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${rsvp.updatedBy ? ` (${rsvp.updatedBy})` : ''}` : 'Ingen anmälan registrerad ännu'}
                    </span>

                    {/* Quick coach edit buttons */}
                    {isCoachOrAdmin && (
                      <div className="flex items-center gap-1">
                        <button
                          title="Marker som kan delta"
                          onClick={() => saveRsvpForPlayer(player.id, 'attending', rsvp?.comment, `Tränare (${user?.displayName || 'Tränare'})`)}
                          className={`p-1 rounded-lg border text-[9px] font-black uppercase ${
                            status === 'attending' ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-emerald-600'
                          }`}
                        >
                          Ja
                        </button>
                        <button
                          title="Markera som delvis"
                          onClick={() => saveRsvpForPlayer(player.id, 'partial', rsvp?.comment, `Tränare (${user?.displayName || 'Tränare'})`)}
                          className={`p-1 rounded-lg border text-[9px] font-black uppercase ${
                            status === 'partial' ? 'bg-amber-600 text-white border-amber-500' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-amber-600'
                          }`}
                        >
                          Delvis
                        </button>
                        <button
                          title="Markera som kan ej"
                          onClick={() => saveRsvpForPlayer(player.id, 'declined', rsvp?.comment, `Tränare (${user?.displayName || 'Tränare'})`)}
                          className={`p-1 rounded-lg border text-[9px] font-black uppercase ${
                            status === 'declined' ? 'bg-rose-600 text-white border-rose-500' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-rose-600'
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

      {/* Modal 1: Skicka Kallelse / Notis */}
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
                      Inbjudan skickas till alla {squad.length} medlemmar
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
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center gap-2"
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

      {/* Modal 2: Anmäl för en spelare (Admin/Coach) */}
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
                    {squad.map(p => (
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
                      className={`py-2 rounded-xl font-black text-xs uppercase border transition-all ${
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
                      className={`py-2 rounded-xl font-black text-xs uppercase border transition-all ${
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
                      className={`py-2 rounded-xl font-black text-xs uppercase border transition-all ${
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
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center gap-2"
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
