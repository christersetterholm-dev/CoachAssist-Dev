import React, { useState, useEffect } from 'react';
import { Trophy, Share2, Crown, Star, ChevronDown, Eye, EyeOff, Plus, Lock, Trash2, Loader2, Edit2, Check, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SquadPlayer, Exercise, Period, PeriodStandings } from '../types';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { calculateLeaderboard } from '../lib/leaderboardUtils';
import { CachedImage } from './CachedImage';

interface LeaderboardProps {
  squad: SquadPlayer[];
  exercises: Exercise[];
  periods: Period[];
  currentPeriodId: string | null;
  onClosePeriod: (name: string, standings: PeriodStandings[]) => void;
  onStartNewPeriod: () => void;
  onDeletePeriod: (id: string) => void;
  onCreatePeriod: (name: string) => void;
  onSwitchPeriod: (id: string) => void;
  onRenamePeriod: (id: string, newName: string) => void;
  onUpdatePeriod: (id: string, updates: Partial<Period>) => void;
  sharedId?: string | null;
  userUid?: string | null;
  key?: React.Key;
}

export default function Leaderboard({ 
  squad, 
  exercises, 
  periods, 
  currentPeriodId, 
  onClosePeriod, 
  onStartNewPeriod: _onStartNewPeriod, 
  onDeletePeriod,
  onCreatePeriod,
  onSwitchPeriod,
  onRenamePeriod,
  onUpdatePeriod,
  sharedId,
  userUid
}: LeaderboardProps) {
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | 'current'>(currentPeriodId || 'current');
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newPeriodName, setNewPeriodName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [bonusData, setBonusData] = useState<{ playerId: string, points: number, reason: string }>({
    playerId: '',
    points: 1,
    reason: ''
  });
  const [sharedData, setSharedData] = useState<any>(null);
  const [isLoadingShared, setIsLoadingShared] = useState(!!sharedId);

  useEffect(() => {
    if (sharedId) {
      const fetchShared = async () => {
        setIsLoadingShared(true);
        const path = `shared_leaderboards/${sharedId}`;
        try {
          const docRef = doc(db, 'shared_leaderboards', sharedId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setSharedData(docSnap.data());
          }
        } catch (error) {
          console.error("Error fetching shared leaderboard:", error);
          handleFirestoreError(error, OperationType.GET, path);
        } finally {
          setIsLoadingShared(false);
        }
      };
      fetchShared();
    }
  }, [sharedId]);

  useEffect(() => {
    if (!sharedId && currentPeriodId && selectedPeriodId === 'current') {
      setSelectedPeriodId(currentPeriodId);
    }
  }, [currentPeriodId, sharedId]);

  // Effect to keep shared leaderboard in sync
  useEffect(() => {
    const period = periods.find(p => p.id === selectedPeriodId);
    if (!sharedId && period?.shareId && userUid) {
      const syncShared = async () => {
        const path = `shared_leaderboards/${period.shareId}`;
        try {
          const stats = calculateLeaderboard(squad, exercises, selectedPeriodId, periods);
          const dataToUpdate = {
            id: period.shareId,
            name: period.name,
            standings: stats.map((p: any) => ({
              playerId: p.id,
              playerName: p.name,
              photoUrl: p.photoUrl || null,
              points: p.totalPoints,
              history: p.history || []
            })),
            updatedAt: Date.now(),
            startDate: period.startDate || null,
            endDate: period.endDate || null,
            coachUid: userUid
          };
          await setDoc(doc(db, 'shared_leaderboards', period.shareId!), dataToUpdate, { merge: true });
        } catch (error) {
          console.error("Error syncing shared leaderboard:", error);
          handleFirestoreError(error, OperationType.WRITE, path);
        }
      };
      
      const timeoutId = setTimeout(syncShared, 30000); // Debounce increased to 30 seconds to prevent rapid write spam while viewing leaderboards
      return () => clearTimeout(timeoutId);
    }
  }, [squad, exercises, selectedPeriodId, periods, sharedId, userUid]);

  // Get the relevant exercises for the selected view
  const playerStats = calculateLeaderboard(squad, exercises, selectedPeriodId, periods);

  // For historical periods, we might want to use the saved standings instead of recalculating
  // but recalculating is fine if the exercises are still there.
  const selectedPeriod = periods.find(p => p.id === selectedPeriodId);
  const displayStats = (selectedPeriod && selectedPeriod.endDate) 
    ? selectedPeriod.standings.map(s => {
        const squadPlayer = squad.find(p => p.id === s.playerId);
        return {
          id: s.playerId,
          name: s.playerName,
          photoUrl: s.photoUrl || squadPlayer?.photoUrl || null,
          totalPoints: s.points,
          history: [] // History might not be available for archived periods if exercises are deleted, but here they are kept
        };
      }).sort((a, b) => b.totalPoints - a.totalPoints)
    : playerStats;

  const handleCreateConfirm = () => {
    if (!newPeriodName.trim()) return;
    onCreatePeriod(newPeriodName);
    setShowCreateModal(false);
    setNewPeriodName('');
  };

  const handleRenameConfirm = () => {
    if (!renameValue.trim() || selectedPeriodId === 'current') return;
    onRenamePeriod(selectedPeriodId, renameValue);
    setShowRenameModal(false);
  };

  const handleCloseConfirm = () => {
    if (selectedPeriodId === 'current') return;
    const standings: PeriodStandings[] = playerStats
      .filter(p => p.totalPoints > 0)
      .map(p => ({
        playerId: p.id,
        playerName: p.name,
        points: p.totalPoints,
        photoUrl: p.photoUrl || null
      }));
    
    onClosePeriod('', standings); // Name is already set for the period
    setShowCloseModal(false);
  };

  const handleDeleteConfirm = () => {
    if (selectedPeriodId === 'current') return;
    onDeletePeriod(selectedPeriodId);
    setShowDeleteModal(false);
    setSelectedPeriodId('current');
  };

  const handleBonusConfirm = () => {
    if (!bonusData.playerId || !bonusData.reason.trim()) return;
    
    const period = periods.find(p => p.id === selectedPeriodId);
    if (!period) return;

    const newBonus = {
      id: Math.random().toString(36).substring(2, 9),
      playerId: bonusData.playerId,
      points: bonusData.points,
      reason: bonusData.reason,
      date: Date.now()
    };

    const updatedBonusPoints = [...(period.bonusPoints || []), newBonus];
    onUpdatePeriod(period.id, { bonusPoints: updatedBonusPoints });
    
    setShowBonusModal(false);
    setBonusData({ playerId: '', points: 1, reason: '' });
  };

  const handleRemoveBonus = (bonusId: string) => {
    const period = periods.find(p => p.id === selectedPeriodId);
    if (!period) return;

    const updatedBonusPoints = (period.bonusPoints || []).filter(bp => bp.id !== bonusId);
    onUpdatePeriod(period.id, { bonusPoints: updatedBonusPoints });
  };

  const finalStats = (sharedData 
    ? sharedData.standings.map((s: any) => ({
        id: s.playerId,
        name: s.playerName,
        photoUrl: s.photoUrl || s.imageUrl,
        totalPoints: s.points,
        history: s.history || []
      }))
    : displayStats).filter((player: any, index: number, self: any[]) => 
      index === self.findIndex((p) => p.id === player.id)
    );

  const togglePlayer = (playerId: string) => {
    const newExpanded = new Set(expandedPlayers);
    if (newExpanded.has(playerId)) {
      newExpanded.delete(playerId);
    } else {
      newExpanded.add(playerId);
    }
    setExpandedPlayers(newExpanded);
    
    // If we manually toggle, we might need to sync allExpanded state
    if (newExpanded.size === finalStats.length) {
      setAllExpanded(true);
    } else if (newExpanded.size === 0) {
      setAllExpanded(false);
    }
  };

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedPlayers(new Set());
      setAllExpanded(false);
    } else {
      setExpandedPlayers(new Set(finalStats.map((p: any) => p.id)));
      setAllExpanded(true);
    }
  };

  const handleShare = async () => {
    if (sharedId) return; // Don't share from a shared view

    setIsSharing(true);
    try {
      const period = periods.find(p => p.id === selectedPeriodId);
      
      // Generate a shorter ID if it doesn't exist
      const generateShortId = () => {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 8; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
      };

      const id = period?.shareId || generateShortId();
      const name = period?.name || 'Poängliga';
      
      const dataToShare = {
        id,
        name,
        standings: displayStats.map((p: any) => ({
          playerId: p.id,
          playerName: p.name,
          photoUrl: p.photoUrl || null,
          points: p.totalPoints,
          history: p.history || []
        })),
        createdAt: Date.now(),
        startDate: period?.startDate || null,
        endDate: period?.endDate || null,
        coachUid: userUid
      };

      const path = `shared_leaderboards/${id}`;
      try {
        await setDoc(doc(db, 'shared_leaderboards', id), dataToShare);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
        throw error;
      }

      // Save shareId to period if it's new
      if (period && !period.shareId) {
        onUpdatePeriod(period.id, { shareId: id });
      }

      const shareUrl = `${window.location.origin}${window.location.pathname}?share=${id}`;

      if (navigator.share) {
        await navigator.share({
          title: `Poängligan: ${name}`,
          text: `Kolla in ställningen i ${name}!`,
          url: shareUrl
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        alert('Länk kopierad till urklipp!');
      }
    } catch (error) {
      console.error("Error sharing leaderboard:", error);
      alert('Kunde inte skapa delningslänk. Kontrollera att du är inloggad.');
    } finally {
      setIsSharing(false);
    }
  };

  if (isLoadingShared) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
        <p className="text-zinc-500 font-bold">Laddar poängliga...</p>
      </div>
    );
  }

  if (sharedId && !sharedData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-3xl flex items-center justify-center text-red-600 dark:text-red-400 mb-6">
          <Trash2 size={40} />
        </div>
        <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">Länken hittades inte</h3>
        <p className="text-zinc-500 dark:text-zinc-400 max-w-xs">
          Denna poängliga kan ha tagits bort eller så är länken felaktig.
        </p>
      </div>
    );
  }

  const title = sharedData ? sharedData.name : 'Poängligan';

  const getSubtitle = (player: any) => {
    if (player.history && player.history.length > 0) {
      return `${player.history.length} tävlingsmoment`;
    }
    if (sharedId) {
      return 'Inga poäng registrerade';
    }
    const period = periods.find(p => p.id === selectedPeriodId);
    return period?.endDate ? 'Slutställning' : 'Inga poäng än';
  };

  return (
    <div className="max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto p-4 sm:p-6 pb-32">
      <div className="flex flex-col mb-8 gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {!sharedId ? (
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 min-w-0">
                    <select 
                      value={selectedPeriodId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedPeriodId(id);
                      }}
                      className="w-full bg-transparent border-none text-zinc-900 dark:text-white font-black text-xl sm:text-2xl focus:ring-0 outline-none cursor-pointer hover:text-indigo-600 transition-colors p-0 appearance-none pr-8"
                    >
                      <option value="current" disabled>Välj tävling...</option>
                      {periods.filter((p, index, self) => index === self.findIndex(t => t.id === p.id)).map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.isActive ? '(Aktiv)' : p.endDate ? '(Avslutad)' : ''}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">
                      <ChevronDown size={20} />
                    </div>
                  </div>
                  {selectedPeriodId !== 'current' && !periods.find(p => p.id === selectedPeriodId)?.endDate && (
                    <button 
                      type="button"
                      onClick={() => {
                        const p = periods.find(period => period.id === selectedPeriodId);
                        if (p) {
                          setRenameValue(p.name);
                          setShowRenameModal(true);
                        }
                      }}
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-xl transition-all active:scale-90 active:bg-zinc-200 dark:active:bg-zinc-700 shadow-sm relative z-20"
                      title="Redigera namn"
                    >
                      <Edit2 size={16} />
                    </button>
                  )}
                </div>
              ) : (
                <h1 className="text-zinc-900 dark:text-white font-black text-xl sm:text-2xl">
                  {title}
                </h1>
              )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!sharedId && (
              <>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-sm text-sm"
                >
                  <Plus size={18} />
                  <span className="hidden xs:inline">Ny tävling</span>
                  <span className="xs:hidden">Ny</span>
                </button>

                {selectedPeriodId !== 'current' && 
                 !periods.find(p => p.id === selectedPeriodId)?.isActive && 
                 !periods.find(p => p.id === selectedPeriodId)?.endDate && (
                  <button
                    onClick={() => onSwitchPeriod(selectedPeriodId)}
                    className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-green-700 transition-all shadow-sm text-sm"
                  >
                    <Check size={18} />
                    <span>Aktivera</span>
                  </button>
                )}

                {selectedPeriodId !== 'current' && !periods.find(p => p.id === selectedPeriodId)?.endDate && (
                  <button
                    onClick={() => setShowCloseModal(true)}
                    className="flex items-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 rounded-xl font-bold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all shadow-sm text-sm"
                  >
                    <Lock size={18} />
                    <span>Avsluta</span>
                  </button>
                )}
                {selectedPeriodId !== 'current' && !periods.find(p => p.id === selectedPeriodId)?.endDate && (
                  <button
                    onClick={() => {
                      setBonusData({ playerId: '', points: 1, reason: '' });
                      setShowBonusModal(true);
                    }}
                    className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl font-bold transition-all shadow-sm text-sm"
                    title="Ge bonuspoäng"
                  >
                    <Star size={18} fill="currentColor" />
                    <span>Bonuspoäng</span>
                  </button>
                )}
                {selectedPeriodId !== 'current' && (
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-2 rounded-xl font-bold border border-red-100 dark:border-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/40 transition-all shadow-sm text-sm"
                  >
                    <Trash2 size={18} />
                    <span>Ta bort</span>
                  </button>
                )}

                <div className="w-[1px] h-6 bg-zinc-200 dark:bg-zinc-800 mx-1 hidden sm:block" />

                <button
                  onClick={handleShare}
                  disabled={isSharing}
                  className="flex items-center gap-2 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white px-4 py-2 rounded-xl font-bold border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all shadow-sm text-sm disabled:opacity-50"
                >
                  {isSharing ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />}
                  <span>{isSharing ? 'Skapar...' : 'Dela'}</span>
                </button>
              </>
            )}

            {finalStats.some((p: any) => p.history.length > 0) && (
              <button
                onClick={toggleAll}
                className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 px-4 py-2 rounded-xl font-bold border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all shadow-sm text-sm"
              >
                {allExpanded ? <EyeOff size={18} /> : <Eye size={18} />}
                <span className="hidden xs:inline">{allExpanded ? 'Dölj underlag' : 'Visa underlag'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {finalStats.map((player: any, index: number) => {
          const isExpanded = expandedPlayers.has(player.id);
          const hasHistory = player.history && player.history.length > 0;

          return (
            <motion.div
              key={player.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm overflow-hidden"
            >
              <div 
                className={`p-4 flex items-center justify-between ${hasHistory ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50' : ''} transition-colors`}
                onClick={() => hasHistory && togglePlayer(player.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-14 h-14 rounded-2xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 border-2 border-white dark:border-zinc-800 shadow-md flex items-center justify-center text-zinc-400">
                      {player.photoUrl ? (
                        <CachedImage 
                          src={player.photoUrl} 
                          alt={player.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <User size={24} className="text-zinc-300 dark:text-zinc-600" />
                      )}
                    </div>
                    
                    {/* Rank Badge */}
                    <div className={`absolute -top-1.5 -left-1.5 w-7 h-7 rounded-full flex items-center justify-center font-black text-xs border-2 border-white dark:border-zinc-950 shadow-md z-10 ${
                      index === 0 ? 'bg-yellow-400 text-white shadow-yellow-200' :
                      index === 1 ? 'bg-zinc-400 text-white' :
                      index === 2 ? 'bg-orange-400 text-white' :
                      'bg-zinc-800 text-white'
                    }`}>
                      {index === 0 ? <Crown size={14} /> : index + 1}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-lg text-zinc-900 dark:text-white line-clamp-1">{player.name}</span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {getSubtitle(player)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-3xl font-black text-indigo-600 dark:text-indigo-400">
                      {player.totalPoints}
                    </div>
                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Poäng</div>
                  </div>
                  {hasHistory && (
                    <div className={`text-zinc-300 dark:text-zinc-600 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                      <ChevronDown size={20} />
                    </div>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {isExpanded && hasHistory && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-zinc-50 dark:bg-zinc-950/50 px-4 py-3 border-t border-zinc-100 dark:border-zinc-800">
                      <div className="flex flex-wrap gap-x-6 gap-y-3">
                        {player.history.map((h, hIdx) => (
                            <div key={`${hIdx}-${h.date}-${h.exerciseName}`} className="flex items-center group relative overflow-hidden">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase">
                                  {new Date(h.date).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {h.isBonus ? (
                                    <Star size={10} className="text-amber-500" fill="currentColor" />
                                  ) : (
                                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                                  )}
                                  <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                                    {h.exerciseName}: <span className={h.isBonus ? 'text-amber-600 dark:text-amber-400' : 'text-indigo-600 dark:text-indigo-400'}>+{h.points}</span>
                                  </span>
                                </div>
                              </div>
                              {h.isBonus && !sharedId && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const bp = selectedPeriod?.bonusPoints?.find(bp => bp.date === h.date && bp.playerId === player.id);
                                    if (bp) handleRemoveBonus(bp.id);
                                  }}
                                  className="ml-2 p-1 text-zinc-300 hover:text-red-500 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {(displayStats.length === 0 && !sharedId) && (
        <div className="text-center py-20">
          <div className="w-20 h-20 bg-zinc-100 dark:bg-zinc-800 rounded-3xl flex items-center justify-center text-zinc-400 mx-auto mb-6">
            <Trophy size={40} />
          </div>
          <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">Ingen data än</h3>
          <p className="text-zinc-500 dark:text-zinc-400">
            {selectedPeriodId === 'current' 
              ? 'Starta en period och genomför tävlingsmoment för att se poängligan.' 
              : 'Inga poäng registrerade för denna period.'}
          </p>
        </div>
      )}

      {/* Create Period Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowCreateModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-6 mx-auto">
                <Plus size={32} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2 text-center">Ny tävling</h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-center">
                Skapa en ny tävling för att börja samla poäng i en separat lista.
              </p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Tävlingens namn</label>
                  <input
                    type="text"
                    value={newPeriodName}
                    onChange={(e) => setNewPeriodName(e.target.value)}
                    placeholder="T.ex. Vårcupen 2024"
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-bold"
                    autoFocus
                  />
                </div>
                
                <div className="flex flex-col gap-3 pt-2">
                  <button
                    onClick={handleCreateConfirm}
                    disabled={!newPeriodName.trim()}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 dark:shadow-none disabled:opacity-50"
                  >
                    Skapa och aktivera
                  </button>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="w-full py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                  >
                    Avbryt
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rename Period Modal */}
      <AnimatePresence>
        {showRenameModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowRenameModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2 text-center">Ändra namn</h3>
              
              <div className="space-y-4 mt-4">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Nytt namn</label>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-bold"
                    autoFocus
                  />
                </div>
                
                <div className="flex flex-col gap-3 pt-2">
                  <button
                    onClick={handleRenameConfirm}
                    disabled={!renameValue.trim()}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 dark:shadow-none disabled:opacity-50"
                  >
                    Spara namn
                  </button>
                  <button
                    onClick={() => setShowRenameModal(false)}
                    className="w-full py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                  >
                    Avbryt
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Close Period Modal */}
      <AnimatePresence>
        {showCloseModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowCloseModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-6 mx-auto">
                <Lock size={32} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2 text-center">Avsluta tävling?</h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-center">
                Detta arkiverar poängställningen för "{periods.find(p => p.id === selectedPeriodId)?.name}". Du kan fortfarande se resultatet senare, men inga nya tävlingsmoment kan läggas till i denna tävling.
              </p>
              
              <div className="flex flex-col gap-3 pt-2">
                <button
                  onClick={handleCloseConfirm}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 dark:shadow-none"
                >
                  Avsluta och arkivera
                </button>
                <button
                  onClick={() => setShowCloseModal(false)}
                  className="w-full py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                >
                  Avbryt
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Period Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowDeleteModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center text-red-600 dark:text-red-400 mb-6 mx-auto">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2 text-center">Ta bort period?</h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-8 text-center">
                Är du säker på att du vill ta bort denna period? Detta går inte att ångra. Tävlingsmoment som tillhörde perioden kommer att finnas kvar men inte längre vara kopplade till en period.
              </p>
              
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleDeleteConfirm}
                  className="w-full py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 dark:shadow-none"
                >
                  Ja, ta bort perioden
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="w-full py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                >
                  Avbryt
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Bonus Point Modal */}
      <AnimatePresence>
        {showBonusModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowBonusModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center text-amber-600 dark:text-amber-400 mb-6 mx-auto">
                <Star size={32} fill="currentColor" />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2 text-center">Ge bonuspoäng</h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-center text-sm">
                Välj en spelare och ge extra poäng för t.ex. bra inställning eller extra prestation.
              </p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Välj spelare</label>
                  <select
                    value={bonusData.playerId}
                    onChange={(e) => setBonusData(prev => ({ ...prev, playerId: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none transition-all font-bold text-sm cursor-pointer"
                  >
                    <option value="">Välj en spelare...</option>
                    {[...squad].filter(p => p.role !== 'leader').sort((a, b) => a.name.localeCompare(b.name)).map(player => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Anledning</label>
                  <input
                    type="text"
                    value={bonusData.reason}
                    onChange={(e) => setBonusData(prev => ({ ...prev, reason: e.target.value }))}
                    placeholder="T.ex. Bra kamratskap"
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none transition-all font-bold text-sm"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Poäng (+)</label>
                  <div className="grid grid-cols-5 gap-2">
                    {[1, 2, 3, 5, 10].map((pts) => (
                      <button
                        key={pts}
                        onClick={() => setBonusData(prev => ({ ...prev, points: pts }))}
                        className={`py-2 rounded-lg font-black text-xs transition-all ${
                          bonusData.points === pts 
                            ? 'bg-amber-500 text-white shadow-sm' 
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                        }`}
                      >
                        {pts}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="flex flex-col gap-3 pt-2">
                  <button
                    onClick={handleBonusConfirm}
                    disabled={!bonusData.playerId || !bonusData.reason.trim()}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 dark:shadow-none disabled:opacity-50"
                  >
                    Ge bonuspoäng
                  </button>
                  <button
                    onClick={() => setShowBonusModal(false)}
                    className="w-full py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                  >
                    Avbryt
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
