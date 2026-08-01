import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PendingUserRequest, ClubTeam, ClubMember, SquadPlayer } from '../types';
import { db, doc, getDoc, setDoc, deleteDoc, collection, getDocs } from '../lib/firebase';
import { deduplicateClubMembers, deduplicateSquad } from '../lib/clubUtils';
import { X, Check, Trash2, UserCheck, Loader2, CheckCircle2 } from 'lucide-react';

interface PendingRequestsModalProps {
  activeClubId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onRequestHandled?: () => void;
}

export const PendingRequestsModal: React.FC<PendingRequestsModalProps> = ({
  activeClubId,
  isOpen,
  onClose,
  onRequestHandled
}) => {
  const [requests, setRequests] = useState<PendingUserRequest[]>([]);
  const [teams, setTeams] = useState<ClubTeam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingUid, setProcessingUid] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState('');

  // Editable forms state keyed by request UID
  const [editedRequests, setEditedRequests] = useState<Record<string, {
    fullName: string;
    email: string;
    phone: string;
    personnummer: string;
    assignedRole: 'player' | 'coach' | 'admin' | 'parent';
    assignedTeamId: string;
  }>>({});

  useEffect(() => {
    if (!isOpen || !activeClubId) return;

    async function loadRequestsAndTeams() {
      setIsLoading(true);
      try {
        // 1. Fetch pending requests for this club
        const reqsSnap = await getDocs(collection(db, 'clubs', activeClubId, 'pending_requests'));
        let reqList: PendingUserRequest[] = [];
        reqsSnap.forEach(docSnap => {
          if (docSnap.exists()) {
            reqList.push(docSnap.data() as PendingUserRequest);
          }
        });

        // Fallback: check global pending requests if club list is empty
        if (reqList.length === 0) {
          const globalSnap = await getDocs(collection(db, 'pending_user_requests'));
          globalSnap.forEach(docSnap => {
            if (docSnap.exists()) {
              const data = docSnap.data() as PendingUserRequest;
              if (data.requestedClubId === activeClubId) {
                reqList.push(data);
              }
            }
          });
        }

        setRequests(reqList);

        // Populate initial editable state
        const initialEdits: Record<string, any> = {};
        reqList.forEach(r => {
          let roleMap: 'player' | 'coach' | 'admin' | 'parent' = 'player';
          if (r.requestedRole === 'leader') roleMap = 'coach';
          else if (r.requestedRole === 'parent') roleMap = 'parent';

          initialEdits[r.uid] = {
            fullName: r.fullName || '',
            email: r.email || '',
            phone: r.phone || '',
            personnummer: r.personnummer || '',
            assignedRole: roleMap,
            assignedTeamId: r.requestedTeamId || ''
          };
        });
        setEditedRequests(initialEdits);

        // 2. Fetch club teams
        const metaSnap = await getDoc(doc(db, 'clubs', activeClubId, 'teams', 'club_global', 'data', 'metadata'));
        if (metaSnap.exists()) {
          setTeams(metaSnap.data().teams || []);
        }
      } catch (err) {
        console.error('Failed to load pending user requests:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadRequestsAndTeams();
  }, [isOpen, activeClubId]);

  if (!isOpen || !activeClubId) return null;

  const handleFieldChange = (uid: string, field: string, value: any) => {
    setEditedRequests(prev => ({
      ...prev,
      [uid]: {
        ...prev[uid],
        [field]: value
      }
    }));
  };

  const handleApprove = async (req: PendingUserRequest) => {
    if (!activeClubId) return;
    setProcessingUid(req.uid);
    setActionSuccessMsg('');

    try {
      const editData = editedRequests[req.uid] || {
        fullName: req.fullName,
        email: req.email,
        phone: req.phone || '',
        personnummer: req.personnummer || '',
        assignedRole: req.requestedRole === 'leader' ? 'coach' : 'player',
        assignedTeamId: req.requestedTeamId
      };

      const cleanEmail = editData.email.trim().toLowerCase();
      const cleanName = editData.fullName.trim();
      const cleanPhone = editData.phone.trim();
      const cleanPnr = editData.personnummer.trim();
      const role = editData.assignedRole;
      const teamId = editData.assignedTeamId;

      // 1. Load existing club members registry
      const membersRef = doc(db, 'clubs', activeClubId, 'teams', 'club_global', 'data', 'members');
      const membersSnap = await getDoc(membersRef);
      let members: ClubMember[] = membersSnap.exists() ? (membersSnap.data().members || []) : [];

      // Find if member already exists (by userId or email)
      const existingIdx = members.findIndex(m => m.userId === req.uid || m.email.toLowerCase() === cleanEmail);

      const newMember: ClubMember = {
        userId: req.uid,
        email: cleanEmail,
        fullName: cleanName,
        phone: cleanPhone || undefined,
        personnummer: cleanPnr || undefined,
        roles: [role],
        teams: teamId ? [teamId] : []
      };

      if (existingIdx !== -1) {
        const existing = members[existingIdx];
        members[existingIdx] = {
          ...existing,
          userId: req.uid,
          email: cleanEmail,
          fullName: cleanName,
          phone: cleanPhone || existing.phone,
          personnummer: cleanPnr || existing.personnummer,
          roles: Array.from(new Set([...(existing.roles || []), role])),
          teams: Array.from(new Set([...(existing.teams || []), ...(teamId ? [teamId] : [])]))
        };
      } else {
        members.push(newMember);
      }

      members = deduplicateClubMembers(members);
      await setDoc(membersRef, { members });

      // 2. Sync to team squad if assigned to a team
      if (teamId) {
        const squadRef = doc(db, 'clubs', activeClubId, 'teams', teamId, 'data', 'squad');
        const squadSnap = await getDoc(squadRef);
        let squad: SquadPlayer[] = squadSnap.exists() ? (squadSnap.data().squad || []) : [];

        const isLeader = role === 'coach' || role === 'admin';
        const squadRole: 'leader' | 'player' = isLeader ? 'leader' : 'player';

        const squadIdx = squad.findIndex(sp => sp.id === req.uid || (sp.email && sp.email.toLowerCase() === cleanEmail));
        if (squadIdx !== -1) {
          squad[squadIdx] = {
            ...squad[squadIdx],
            id: req.uid,
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone || squad[squadIdx].phone,
            personnummer: cleanPnr || squad[squadIdx].personnummer,
            role: squadRole
          };
        } else {
          squad.push({
            id: req.uid,
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone || undefined,
            personnummer: cleanPnr || undefined,
            role: squadRole
          });
        }

        squad = deduplicateSquad(squad);
        await setDoc(squadRef, { squad, updatedAt: Date.now() });
      }

      // 3. Update User Profile in Firestore
      await setDoc(doc(db, 'users', req.uid, 'data', 'profile'), {
        fullName: cleanName,
        email: cleanEmail,
        phone: cleanPhone || undefined,
        personnummer: cleanPnr || undefined,
        activeClubId,
        activeTeamId: teamId || null,
        status: 'approved',
        onboardingCompleted: true,
        updatedAt: Date.now()
      }, { merge: true });

      // 4. Clean up pending request documents
      await deleteDoc(doc(db, 'clubs', activeClubId, 'pending_requests', req.uid)).catch(() => {});
      await deleteDoc(doc(db, 'pending_user_requests', req.uid)).catch(() => {});

      // 5. Update local state
      setRequests(prev => prev.filter(r => r.uid !== req.uid));
      setActionSuccessMsg(`${cleanName} har godkänts och lagts till i laget!`);
      setTimeout(() => setActionSuccessMsg(''), 3000);

      if (onRequestHandled) onRequestHandled();
    } catch (err) {
      console.error('Failed to approve request:', err);
      alert('Kunde inte godkänna ansökan. Vänligen försök igen.');
    } finally {
      setProcessingUid(null);
    }
  };

  const handleReject = async (req: PendingUserRequest) => {
    if (!window.confirm(`Är du säker på att du vill neka ansökan från ${req.fullName}?`)) return;

    setProcessingUid(req.uid);
    try {
      // 1. Update user profile to rejected
      await setDoc(doc(db, 'users', req.uid, 'data', 'profile'), {
        status: 'rejected',
        onboardingCompleted: true,
        updatedAt: Date.now()
      }, { merge: true });

      // 2. Delete pending request documents
      await deleteDoc(doc(db, 'clubs', activeClubId, 'pending_requests', req.uid)).catch(() => {});
      await deleteDoc(doc(db, 'pending_user_requests', req.uid)).catch(() => {});

      setRequests(prev => prev.filter(r => r.uid !== req.uid));
      if (onRequestHandled) onRequestHandled();
    } catch (err) {
      console.error('Failed to reject request:', err);
      alert('Kunde inte neka ansökan.');
    } finally {
      setProcessingUid(null);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9990] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="w-full max-w-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden my-8"
        >
          {/* Header */}
          <div className="p-6 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-2xl">
                <UserCheck size={22} />
              </div>
              <div>
                <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">
                  Medlemsansökningar ({requests.length})
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                  Granska, redigera och godkänn nya användare som vill gå med i föreningen.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-2xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Success Banner */}
          {actionSuccessMsg && (
            <div className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 px-6 py-3 text-xs font-bold border-b border-emerald-200 dark:border-emerald-800 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{actionSuccessMsg}</span>
            </div>
          )}

          {/* Body */}
          <div className="p-6 max-h-[70vh] overflow-y-auto space-y-4">
            {isLoading ? (
              <div className="py-12 text-center text-zinc-400 flex flex-col items-center gap-3">
                <Loader2 size={32} className="animate-spin text-indigo-600" />
                <span className="text-xs font-bold uppercase tracking-wider">Laddar medlemsansökningar...</span>
              </div>
            ) : requests.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto">
                  <Check size={24} />
                </div>
                <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-200">Inga väntande ansökningar</h3>
                <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                  Alla medlemsansökningar har hanterats. Nya användare som ansöker hamnar här för godkännande.
                </p>
              </div>
            ) : (
              requests.map(req => {
                const edit = editedRequests[req.uid] || {
                  fullName: req.fullName,
                  email: req.email,
                  phone: req.phone || '',
                  personnummer: req.personnummer || '',
                  assignedRole: req.requestedRole === 'leader' ? 'coach' : 'player',
                  assignedTeamId: req.requestedTeamId
                };

                const isProcessing = processingUid === req.uid;

                return (
                  <div
                    key={req.uid}
                    className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800/60 pb-3">
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded-full">
                          Ansökan: {req.requestedClubName || 'Förening'} — {req.requestedTeamName || 'Lag'}
                        </span>
                      </div>
                      <span className="text-[10px] font-medium text-zinc-400">
                        {new Date(req.createdAt).toLocaleDateString('sv-SE')}
                      </span>
                    </div>

                    {/* Editable Fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-1">
                          Fullständigt Namn
                        </label>
                        <input
                          type="text"
                          value={edit.fullName}
                          onChange={e => handleFieldChange(req.uid, 'fullName', e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-600"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-1">
                          E-postadress
                        </label>
                        <input
                          type="email"
                          value={edit.email}
                          onChange={e => handleFieldChange(req.uid, 'email', e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-600"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-1">
                          Mobilnummer
                        </label>
                        <input
                          type="tel"
                          value={edit.phone}
                          onChange={e => handleFieldChange(req.uid, 'phone', e.target.value)}
                          placeholder="070-123 45 67"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-600"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-1">
                          Personnummer
                        </label>
                        <input
                          type="text"
                          value={edit.personnummer}
                          onChange={e => handleFieldChange(req.uid, 'personnummer', e.target.value)}
                          placeholder="ÅÅMMDD-XXXX"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-600"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-1">
                          Tilldelad Roll
                        </label>
                        <select
                          value={edit.assignedRole}
                          onChange={e => handleFieldChange(req.uid, 'assignedRole', e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-600"
                        >
                          <option value="player">Spelare</option>
                          <option value="coach">Ledare / Tränare</option>
                          <option value="admin">Administratör</option>
                          <option value="parent">Vårdnadshavare</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-1">
                          Placera i Lag
                        </label>
                        <select
                          value={edit.assignedTeamId}
                          onChange={e => handleFieldChange(req.uid, 'assignedTeamId', e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-600"
                        >
                          <option value="">Inget specifikt lag (Endast Förening)</option>
                          {teams.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleReject(req)}
                        className="py-2.5 px-4 bg-zinc-200 hover:bg-red-100 hover:text-red-700 dark:bg-zinc-800 dark:hover:bg-red-950/50 dark:hover:text-red-400 text-zinc-600 dark:text-zinc-300 font-bold rounded-xl text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 size={14} />
                        <span>Neka</span>
                      </button>

                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleApprove(req)}
                        className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-md shadow-indigo-600/20 active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            <span>Sparar...</span>
                          </>
                        ) : (
                          <>
                            <Check size={16} />
                            <span>Godkänn Medlem</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
