import React, { useState } from 'react';
import { Plus, Minus, Trash2, Play, UserPlus, Trophy, X, Check, Calendar, Users, Medal, ChevronDown, ChevronUp, Save, ClipboardList, Wand2, RotateCcw, LayoutList, Clock, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SquadPlayer, PRESET_COLORS, Exercise, Team, PointsConfig, TrainingSession } from '../types';
import { sortPlayersByPosition } from '../lib/teamUtils';
import ColorPicker from './ColorPicker';

interface GameSetupProps {
  onStartGame: (
    name: string, 
    icon: string, 
    teams: Omit<Team, 'score'>[], 
    sortByScore: boolean, 
    showTimer: boolean, 
    defaultTimerMinutes: number, 
    defaultTimerSeconds: number, 
    jokerPlayerIds: string[], 
    pointsConfig: PointsConfig,
    periodId?: string | null,
    sessionId?: string | null,
    shouldStart?: boolean
  ) => void;
  initialGame?: Exercise;
  onCancel?: () => void;
  squad: SquadPlayer[];
  guestPlayers?: SquadPlayer[];
  sessionAttendance?: string[];
  activeSessionId?: string | null;
  sessions?: TrainingSession[];
  exercises?: Exercise[];
  currentPeriodId: string | null;
  onAddGuest?: (name: string, position?: string) => void;
  onAddSquadPlayerToAttendance?: (playerId: string) => void;
  onRemovePlayerFromAttendance?: (playerId: string) => void;
  key?: React.Key;
}

const VEST_COLORS = [
  '#1E3A8A', // Navy (Tröjfärg)
  '#84CC16', // Lime
  '#0EA5E9', // Sky
  '#F97316', // Orange
  '#71717A', // Zinc
];

export default function GameSetup({ 
  onStartGame, 
  initialGame, 
  onCancel: _onCancel, 
  squad = [], 
  guestPlayers = [], 
  sessionAttendance, 
  activeSessionId, 
  sessions, 
  exercises = [], 
  currentPeriodId, 
  onAddGuest, 
  onAddSquadPlayerToAttendance,
  onRemovePlayerFromAttendance
}: GameSetupProps) {
  const submitShouldStartRef = React.useRef(false);
  const combinedSquad = [
    ...(squad || []).filter(p => p.role !== 'leader'), 
    ...(guestPlayers || []).filter(p => p.role !== 'leader')
  ];
  const [gameName, setGameName] = useState(initialGame?.name || '');
  const [selectedIcon] = useState(initialGame?.icon || 'Trophy');
  const [sortByScore, setSortByScore] = useState(initialGame?.sortByScore ?? false);
  const [showTimer, setShowTimer] = useState(initialGame?.showTimer ?? true);
  const [defaultMinutes, setDefaultMinutes] = useState(initialGame?.defaultTimerMinutes ?? 4);
  const [defaultSeconds, setDefaultSeconds] = useState(initialGame?.defaultTimerSeconds ?? 0);
  const [jokerPlayerIds, setJokerPlayerIds] = useState<string[]>(initialGame?.jokerPlayerIds || []);
  const [pointsConfig, setPointsConfig] = useState<PointsConfig>(initialGame?.pointsConfig || { first: 1, second: 0, third: 0 });
  const [showJokers, setShowJokers] = useState(false);
  const [showAttendanceInput, setShowAttendanceInput] = useState(false);
  const [attendanceText, setAttendanceText] = useState('');
  const [standaloneAttendance, setStandaloneAttendance] = useState<string[]>(
    (initialGame && initialGame.teams && !sessionAttendance) ? initialGame.teams.flatMap(t => t.playerIds) : []
  );
  const [showStandaloneAttendance, setShowStandaloneAttendance] = useState(false);
  const [showTimerSettings, setShowTimerSettings] = useState(false);
  const [showPointsSettings, setShowPointsSettings] = useState(false);
  const [showCopyFromDropdown, setShowCopyFromDropdown] = useState(false);
  const [draggedPlayerId, setDraggedPlayerId] = useState<string | null>(null);
  const [excludeGoalkeepers, setExcludeGoalkeepers] = useState(false);
  const [showGuestInput, setShowGuestInput] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestPosition, setGuestPosition] = useState("");

  const isGoalkeeper = (p: SquadPlayer) => {
    const pos = p.position?.toUpperCase() || '';
    return pos.includes('MV') || pos.includes('MÅLVAKT');
  };
  
  // Find linked session if any
  const linkedSession = sessions?.find(s => 
    (initialGame?.sessionId && s.id === initialGame.sessionId) || 
    (activeSessionId && s.id === activeSessionId)
  );
  const sessionTitle = linkedSession?.title || 'Träningspass';
  
  // Derived helper to identify currently attending players (either from session or standalone)
  const currentAttendanceIds = sessionAttendance || standaloneAttendance;
  const isAttendanceActive = Array.isArray(sessionAttendance) || standaloneAttendance.length > 0;
  
  const [teams, setTeams] = useState<Omit<Team, 'score'>[]>(
    (initialGame?.teams && initialGame.teams.length > 0) 
      ? initialGame.teams.map(({ score, ...t }) => t) 
      : [
          { id: crypto.randomUUID(), name: 'Lag 1', color: VEST_COLORS[0], playerIds: [] },
          { id: crypto.randomUUID(), name: 'Lag 2', color: VEST_COLORS[1], playerIds: [] },
        ]
  );

  const assignedPlayerIds = new Set([
    ...teams.flatMap(t => t.playerIds || []),
    ...jokerPlayerIds
  ]);

  const unassignedPlayers = combinedSquad
    .filter(p => {
      if (!isAttendanceActive) return true;
      const isGuest = p.id.startsWith('guest_');
      return currentAttendanceIds.includes(p.id) || (isGuest && (guestPlayers || []).some(gp => gp.id === p.id));
    })
    .filter(p => !assignedPlayerIds.has(p.id));

  const absentSquadPlayers = (squad || [])
    .filter(p => p.role !== 'leader')
    .filter(p => !currentAttendanceIds.includes(p.id));

  const adjustDefaultTime = (type: 'min' | 'sec', amount: number) => {
    if (type === 'min') {
      const next = Math.max(0, Math.min(99, defaultMinutes + amount));
      setDefaultMinutes(next);
    } else {
      let nextSec = defaultSeconds + amount;
      let nextMin = defaultMinutes;
      
      if (nextSec >= 60) {
        nextMin = Math.min(99, nextMin + 1);
        nextSec = 0;
      } else if (nextSec < 0) {
        if (nextMin > 0) {
          nextMin -= 1;
          nextSec = 50;
        } else {
          nextSec = 0;
        }
      }
      
      setDefaultMinutes(nextMin);
      setDefaultSeconds(nextSec);
    }
  };

  const removeTeam = (id: string) => {
    if (teams.length <= 1) return;
    setTeams(teams.filter(t => t.id !== id));
  };

  const updateTeam = (id: string, updates: Partial<Omit<Team, 'score'>>) => {
    setTeams(teams.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const setTeamCount = (count: number, isIndividual = false) => {
    if (count < 1) return;
    const newTeams: Omit<Team, 'score'>[] = [];
    const navyBlue = "#1e3a8a"; 
    
    if (isIndividual) {
      // Only include attending players if attendance is active
      let playersToDistribute = isAttendanceActive 
        ? combinedSquad.filter(p => {
            const isGuest = p.id.startsWith('guest_');
            return currentAttendanceIds.includes(p.id) || (isGuest && guestPlayers.some(gp => gp.id === p.id));
          })
        : combinedSquad;

      // Exclude goalkeepers if toggle is active
      if (excludeGoalkeepers) {
        playersToDistribute = playersToDistribute.filter(p => !isGoalkeeper(p));
      }

      // If we are in a session but NO ONE is attending, we should probably warn or just show 0 teams if isIndividual
      if (isAttendanceActive && playersToDistribute.length === 0) {
        alert("Inga spelare är markerade som närvarande. Gå till fliken 'Deltagare' i träningen för att markera vilka som är där.");
        return;
      }

      playersToDistribute.forEach((player) => {
        newTeams.push({ 
          id: crypto.randomUUID(), 
          name: '', 
          color: navyBlue, 
          playerIds: [player.id] 
        });
      });
    } else {
      const currentTeams = [...teams];
      if (currentTeams.length > 0) {
        if (count > currentTeams.length) {
          // Keep existing teams
          newTeams.push(...currentTeams);
          // Add remaining teams as empty
          for (let i = currentTeams.length; i < count; i++) {
            const nextColor = i < VEST_COLORS.length 
              ? VEST_COLORS[i] 
              : PRESET_COLORS[i % PRESET_COLORS.length];
            newTeams.push({ id: crypto.randomUUID(), name: '', color: nextColor, playerIds: [] });
          }
        } else {
          // Keep the first count teams
          newTeams.push(...currentTeams.slice(0, count));
        }
      } else {
        // Fallback if there are no teams in the state yet
        for (let i = 0; i < count; i++) {
          const nextColor = i < VEST_COLORS.length 
            ? VEST_COLORS[i] 
            : PRESET_COLORS[i % PRESET_COLORS.length];
          newTeams.push({ id: crypto.randomUUID(), name: '', color: nextColor, playerIds: [] });
        }
      }
    }
    setTeams(newTeams);
  };

  const togglePlayerInTeam = (teamId: string, playerId: string) => {
    // Remove from jokers if it was there
    setJokerPlayerIds(prev => prev.filter(id => id !== playerId));
    
    setTeams(teams.map(t => {
      if (t.id === teamId) {
        const exists = t.playerIds.includes(playerId);
        return {
          ...t,
          playerIds: exists 
            ? t.playerIds.filter(id => id !== playerId)
            : [...t.playerIds, playerId]
        };
      }
      // Remove player from other teams if they are being added here
      if (!t.playerIds.includes(playerId)) return t;
      return {
        ...t,
        playerIds: t.playerIds.filter(id => id !== playerId)
      };
    }));
  };

  const toggleJoker = (playerId: string) => {
    // Remove from any team if it was there
    setTeams(teams.map(t => ({
      ...t,
      playerIds: t.playerIds.filter(id => id !== playerId)
    })));

    setJokerPlayerIds(prev => 
      prev.includes(playerId) 
        ? prev.filter(id => id !== playerId) 
        : [...prev, playerId]
    );
  };

  const generateTeamsFromAttendance = () => {
    if (!attendanceText.trim()) return;

    // 1. Parse names from text (split by newlines, commas, etc.)
    const inputNames = attendanceText
      .split(/[\n,;]/)
      .map(name => name.trim().toLowerCase())
      .filter(name => name.length > 0);

    // 2. Match with squad
    const attendingPlayers: SquadPlayer[] = [];
    
    combinedSquad.forEach(player => {
      const playerNameLower = player.name.toLowerCase();
      // Check for exact match or if the input name is part of the player name
      const isAttending = inputNames.some(inputName => {
        if (playerNameLower === inputName) return true;
        // Handle cases like "First Last" vs "First"
        if (playerNameLower.includes(inputName) && inputName.length > 2) return true;
        return false;
      });

      if (isAttending) {
        attendingPlayers.push(player);
      }
    });

    if (attendingPlayers.length === 0) {
      alert("Hittade inga spelare som matchade namnen i listan. Kontrollera stavningen.");
      return;
    }

    if (!sessionAttendance) {
      setStandaloneAttendance(attendingPlayers.map(p => p.id));
    }

    _distributePlayers(attendingPlayers);
    setShowAttendanceInput(false);
    setAttendanceText('');
  };

  const generateTeamsFromSessionAttendance = () => {
    const list = sessionAttendance || standaloneAttendance;
    if (!list || list.length === 0) {
      if (isAttendanceActive) {
        alert("Inga spelare är markerade som närvarande i träningen. Gå till fliken 'Deltagare' för att markera vilka som är där.");
      } else {
        alert("Ingen närvarolista hittades.");
      }
      return;
    }

    const attendingPlayers: SquadPlayer[] = [];

    list.forEach(idOrName => {
      const player = combinedSquad.find(p => p.id === idOrName || p.name.toLowerCase() === idOrName.toLowerCase());
      if (player) {
        attendingPlayers.push(player);
      }
    });

    if (attendingPlayers.length === 0) {
      alert("Hittade inga spelare från närvarolistan i truppen eller bland provspelare.");
      return;
    }

    _distributePlayers(attendingPlayers);
  };

  const toggleStandaloneAttendance = (playerId: string) => {
    setStandaloneAttendance(prev => 
      prev.includes(playerId) 
        ? prev.filter(id => id !== playerId)
        : [...prev, playerId]
    );
  };

  const handleRemovePlayerFromAttendance = (playerId: string) => {
    if (activeSessionId && onRemovePlayerFromAttendance) {
      onRemovePlayerFromAttendance(playerId);
    } else {
      setStandaloneAttendance(prev => prev.filter(id => id !== playerId));
    }
  };

  const _distributePlayers = (attendingPlayers: SquadPlayer[]) => {
    // Filter out goalkeepers if toggle is active
    let playersToDistribute = [...attendingPlayers];
    if (excludeGoalkeepers) {
      playersToDistribute = playersToDistribute.filter(p => !isGoalkeeper(p));
    }

    // 3. Group players by position to distribute them evenly
    const playersByPosition: Record<string, string[]> = {};
    playersToDistribute.forEach(p => {
      const pos = p.position || 'Odefinierad';
      if (!playersByPosition[pos]) playersByPosition[pos] = [];
      playersByPosition[pos].push(p.id);
    });

    // 4. Distribute into current number of teams
    const teamCount = teams.length;
    const newTeams = teams.map(t => ({ ...t, playerIds: [] as string[] }));
    
    let globalPlayerIndex = 0;

    // Process each position group
    Object.keys(playersByPosition).sort().forEach(pos => {
      const playerIds = playersByPosition[pos];
      // Shuffle players within this position
      const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
      
      shuffled.forEach(id => {
        const teamIndex = globalPlayerIndex % teamCount;
        newTeams[teamIndex].playerIds.push(id);
        globalPlayerIndex++;
      });
    });

    setTeams(newTeams);
    // Clear jokers as they might not be attending or should be in teams now
    setJokerPlayerIds([]);
  };

  const movePlayerInternal = (playerId: string, targetTeamId: string) => {
    // Remove from all teams and joker list first
    const updatedTeams = teams.map(t => ({
      ...t,
      playerIds: t.playerIds.filter(id => id !== playerId)
    }));
    const updatedJokerIds = jokerPlayerIds.filter(id => id !== playerId);
    
    if (targetTeamId === 'joker') {
      setTeams(updatedTeams);
      setJokerPlayerIds([...updatedJokerIds, playerId]);
    } else {
      setTeams(updatedTeams.map(t => 
        t.id === targetTeamId ? { ...t, playerIds: [...t.playerIds, playerId] } : t
      ));
      setJokerPlayerIds(updatedJokerIds);
    }
  };

  const handleDragEndInOverview = (playerId: string, x: number, y: number) => {
    // Find all potential target containers
    const teamElements = document.querySelectorAll('[data-overview-team-id]');
    let targetTeamId: string | null = null;

    // Manual hit detection using getBoundingClientRect
    for (const el of Array.from(teamElements)) {
      const rect = el.getBoundingClientRect();
      if (
        x >= rect.left && 
        x <= rect.right && 
        y >= rect.top && 
        y <= rect.bottom
      ) {
        targetTeamId = el.getAttribute('data-overview-team-id');
        break;
      }
    }

    if (targetTeamId) {
      // Find source ID to ignore it during hit detection
      const sourceTeam = teams.find(t => t.playerIds.includes(playerId));
      const isJoker = jokerPlayerIds.includes(playerId);
      const sourceId = sourceTeam ? sourceTeam.id : (isJoker ? 'joker' : null);

      if (targetTeamId !== sourceId) {
        movePlayerInternal(playerId, targetTeamId);
      }
    }
    setDraggedPlayerId(null);
  };

  const copyableExercisesForSetup = (exercises || [])
    .filter(e => e.id !== initialGame?.id && e.teams.some(t => (t.playerIds?.length || 0) > 0))
    .sort((a, b) => {
      const aIsSame = a.sessionId === (activeSessionId || initialGame?.sessionId) ? 1 : 0;
      const bIsSame = b.sessionId === (activeSessionId || initialGame?.sessionId) ? 1 : 0;
      if (aIsSame !== bIsSame) return bIsSame - aIsSame;
      return b.createdAt - a.createdAt;
    });

  const handleCopyFromExercise = (sourceEx: Exercise) => {
    const sourceTeams = sourceEx.teams;
    setTeams(prevTeams => {
      const updated = prevTeams.map((t, idx) => {
        const sourceTeam = sourceTeams[idx];
        return {
          ...t,
          playerIds: sourceTeam ? [...(sourceTeam.playerIds || [])] : []
        };
      });

      if (sourceTeams.length > prevTeams.length) {
        const extraTeams = sourceTeams.slice(prevTeams.length).map((st, idx) => ({
          id: crypto.randomUUID(),
          name: `Lag ${prevTeams.length + idx + 1}`,
          color: VEST_COLORS[(prevTeams.length + idx) % VEST_COLORS.length] || '#71717A',
          playerIds: [...(st.playerIds || [])]
        }));
        return [...updated, ...extraTeams];
      }

      return updated;
    });

    if (sourceEx.jokerPlayerIds) {
      setJokerPlayerIds([...sourceEx.jokerPlayerIds]);
    }
  };

  const clearAllTeams = () => {
    setTeams(teams.map(t => ({ ...t, playerIds: [] })));
    setJokerPlayerIds([]);
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    onStartGame(
      gameName || 'Nytt tävlingsmoment', 
      selectedIcon, 
      teams, 
      sortByScore, 
      showTimer, 
      defaultMinutes, 
      defaultSeconds, 
      jokerPlayerIds, 
      pointsConfig,
      initialGame ? initialGame.periodId : currentPeriodId,
      initialGame ? initialGame.sessionId : (sessionAttendance ? 'active' : null), // Using 'active' as a placeholder if we're in session mode
      submitShouldStartRef.current
    );
    // Reset back to default
    submitShouldStartRef.current = false;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-3xl mx-auto sm:p-6"
    >
      <div className="bg-white dark:bg-zinc-900 sm:rounded-3xl sm:shadow-xl p-4 sm:p-8 sm:border border-zinc-100 dark:border-zinc-800 transition-colors duration-300 pb-32">
        <form id="game-setup-form" onSubmit={handleStart} className="space-y-6">
          <div className="space-y-4">
            {/* Header: Name and Top Save */}
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={gameName}
                  onChange={(e) => setGameName(e.target.value)}
                  placeholder="Tävlingens namn..."
                  className="w-full bg-transparent border-none focus:ring-0 text-xl sm:text-2xl font-black text-zinc-900 dark:text-white placeholder:text-zinc-200 p-0 outline-none truncate"
                />
                <div className="flex items-center gap-1 mt-0.5">
                  <Trophy size={10} className="text-zinc-400" />
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Tävlingsmoment</span>
                </div>
              </div>

              <button
                type="submit"
                form="game-setup-form"
                className="w-7 h-7 flex items-center justify-center bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 active:scale-95 transition-all shadow-sm shrink-0"
                title="Spara ändringar"
              >
                <Save size={14} />
              </button>
            </div>

            {/* Linked Session Badge - Compact */}
            {(sessionAttendance || initialGame?.sessionId) && (
              <div className="bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100/50 dark:border-indigo-900/30 rounded-xl px-3 py-2 flex items-center gap-3">
                <Calendar size={14} className="text-indigo-600 dark:text-indigo-400" />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-indigo-900 dark:text-indigo-100 uppercase tracking-tight">
                    Kopplad till: {sessionTitle}
                  </span>
                </div>
              </div>
            )}

            <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-100 dark:border-zinc-800">
              <button 
                type="button"
                onClick={() => setShowTimerSettings(!showTimerSettings)}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${showTimer ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-200 text-zinc-500'} dark:bg-zinc-800 transition-colors`}>
                    <Clock size={20} />
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="font-bold text-zinc-900 dark:text-white text-sm">Timer-inställningar</span>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase font-bold tracking-wider">
                      {showTimer ? `${defaultMinutes}:${defaultSeconds.toString().padStart(2, '0')} aktiv` : 'Inaktiverad'}
                    </span>
                  </div>
                </div>
                {showTimerSettings ? <ChevronUp size={20} className="text-zinc-400" /> : <ChevronDown size={20} className="text-zinc-400" />}
              </button>

              <AnimatePresence>
                {showTimerSettings && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800 space-y-6"
                  >
                    <div className="flex items-center justify-between p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800">
                      <div className="flex flex-col">
                        <span className="font-bold text-zinc-900 dark:text-white text-xs">Visa timer</span>
                        <span className="text-[9px] text-zinc-500 dark:text-zinc-400 uppercase font-bold tracking-wider">AKTIVERA I TÄVLINGSMOMENTET</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowTimer(!showTimer)}
                        className={`relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none ${
                          showTimer ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
                        }`}
                      >
                        <motion.div
                          animate={{ x: showTimer ? 22 : 2 }}
                          className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
                        />
                      </button>
                    </div>

                    {showTimer && (
                      <div className="space-y-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-zinc-900 dark:text-white text-xs">Standardtid</span>
                          <span className="text-[9px] text-zinc-500 dark:text-zinc-400 uppercase font-bold tracking-wider">Tid per omgång</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col items-center gap-2">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase">Minuter</span>
                            <div className="flex items-center gap-4">
                              <button type="button" onClick={() => adjustDefaultTime('min', -1)} className="p-2 bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                                <Minus size={18} />
                              </button>
                              <span className="text-2xl font-black min-w-[2ch] text-center dark:text-white">{defaultMinutes}</span>
                              <button type="button" onClick={() => adjustDefaultTime('min', 1)} className="p-2 bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                                <Plus size={18} />
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-col items-center gap-2">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase">Sekunder</span>
                            <div className="flex items-center gap-4">
                              <button type="button" onClick={() => adjustDefaultTime('sec', -10)} className="p-2 bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                                <Minus size={18} />
                              </button>
                              <span className="text-2xl font-black min-w-[2ch] text-center dark:text-white">{defaultSeconds.toString().padStart(2, '0')}</span>
                              <button type="button" onClick={() => adjustDefaultTime('sec', 10)} className="p-2 bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                                <Plus size={18} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-100 dark:border-zinc-800">
              <button 
                type="button"
                onClick={() => setShowPointsSettings(!showPointsSettings)}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-orange-100 text-orange-600 dark:bg-zinc-800">
                    <Trophy size={20} />
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="font-bold text-zinc-900 dark:text-white text-sm">Poäng & Sortering</span>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase font-bold tracking-wider">
                      {pointsConfig.first}-{pointsConfig.second}-{pointsConfig.third} poäng • {sortByScore ? 'Auto-sortering' : 'Fast ordning'}
                    </span>
                  </div>
                </div>
                {showPointsSettings ? <ChevronUp size={20} className="text-zinc-400" /> : <ChevronDown size={20} className="text-zinc-400" />}
              </button>

              <AnimatePresence>
                {showPointsSettings && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800 space-y-6"
                  >
                    <div className="flex items-center justify-between p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800">
                      <div className="flex flex-col text-left">
                        <span className="font-bold text-zinc-900 dark:text-white text-xs">Automatisk sortering</span>
                        <span className="text-[9px] text-zinc-500 dark:text-zinc-400 uppercase font-bold tracking-wider">SORTERA LAG DIREKT EFTER POÄNG</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSortByScore(!sortByScore)}
                        className={`relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none ${
                          sortByScore ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
                        }`}
                      >
                        <motion.div
                          animate={{ x: sortByScore ? 22 : 2 }}
                          className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
                        />
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div className="flex flex-col text-left">
                        <span className="font-bold text-zinc-900 dark:text-white text-xs">Poängfördelning</span>
                        <span className="text-[9px] text-zinc-500 dark:text-zinc-400 uppercase font-bold tracking-wider">POÄNG TILL 1:AN, 2:AN OCH 3:AN</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="flex flex-col items-center gap-1.5 p-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800 shadow-sm">
                          <div className="w-8 h-8 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 flex items-center justify-center">
                            <Trophy size={16} />
                          </div>
                          <span className="text-[10px] font-bold text-zinc-400 uppercase">1:a</span>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setPointsConfig(prev => ({ ...prev, first: Math.max(0, prev.first - 1) }))} className="w-7 h-7 flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                              <Minus size={12} />
                            </button>
                            <span className="text-lg font-black dark:text-white">{pointsConfig.first}</span>
                            <button type="button" onClick={() => setPointsConfig(prev => ({ ...prev, first: prev.first + 1 }))} className="w-7 h-7 flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                              <Plus size={12} />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-col items-center gap-1.5 p-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800 shadow-sm">
                          <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 flex items-center justify-center">
                            <Medal size={16} />
                          </div>
                          <span className="text-[10px] font-bold text-zinc-400 uppercase">2:a</span>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setPointsConfig(prev => ({ ...prev, second: Math.max(0, prev.second - 1) }))} className="w-7 h-7 flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                              <Minus size={12} />
                            </button>
                            <span className="text-lg font-black dark:text-white">{pointsConfig.second}</span>
                            <button type="button" onClick={() => setPointsConfig(prev => ({ ...prev, second: prev.second + 1 }))} className="w-7 h-7 flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                              <Plus size={12} />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-col items-center gap-1.5 p-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800 shadow-sm">
                          <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 flex items-center justify-center">
                            <Medal size={16} />
                          </div>
                          <span className="text-[10px] font-bold text-zinc-400 uppercase">3:e</span>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setPointsConfig(prev => ({ ...prev, third: Math.max(0, prev.third - 1) }))} className="w-7 h-7 flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                              <Minus size={12} />
                            </button>
                            <span className="text-lg font-black dark:text-white">{pointsConfig.third}</span>
                            <button type="button" onClick={() => setPointsConfig(prev => ({ ...prev, third: prev.third + 1 }))} className="w-7 h-7 flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-100 dark:border-zinc-800 active:scale-90 transition-all">
                              <Plus size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

        <div>
          <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-100 dark:border-zinc-800 mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-col shrink-0">
                <label className="block text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Antal lag / Deltagar-läge</label>
                <div className="flex items-center gap-3 mt-1">
                   <button
                    type="button"
                    onClick={() => {
                      const newValue = !excludeGoalkeepers;
                      setExcludeGoalkeepers(newValue);
                      if (newValue) {
                        // If turning ON, remove goalkeepers from all teams and jokers
                        setTeams(prev => prev.map(t => ({
                          ...t,
                          playerIds: t.playerIds.filter(pid => {
                            const p = combinedSquad.find(player => player.id === pid);
                            return p ? !isGoalkeeper(p) : true;
                          })
                        })));
                        setJokerPlayerIds(prev => prev.filter(pid => {
                          const p = combinedSquad.find(player => player.id === pid);
                          return p ? !isGoalkeeper(p) : true;
                        }));
                      }
                    }}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all ${
                      excludeGoalkeepers 
                        ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-900/10 dark:border-indigo-800' 
                        : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'
                    }`}
                  >
                    <div className={`w-8 h-4 rounded-full transition-colors relative ${excludeGoalkeepers ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${excludeGoalkeepers ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </div>
                    <span className={`text-[10px] font-black uppercase tracking-tight ${excludeGoalkeepers ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500 dark:text-zinc-400'}`}>Hoppa över målvakterna</span>
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-start sm:justify-end gap-2">
                {[1, 2, 3, 4].map(num => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setTeamCount(num)}
                    className={`w-9 h-9 rounded-xl text-xs font-bold transition-all border ${
                      teams.length === num && !teams.every(t => t.playerIds.length === 1 && t.name === '') // Simple check for individual mode
                        ? 'bg-indigo-600 border-indigo-600 text-white' 
                        : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-indigo-300'
                    }`}
                  >
                    {num}
                  </button>
                ))}
                <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 h-9">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">Eget:</span>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    placeholder="#"
                    className="w-8 bg-transparent border-none focus:ring-0 outline-none text-xs font-black text-zinc-900 dark:text-white p-0 text-center"
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (val > 0) setTeamCount(val);
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setTeamCount(isAttendanceActive ? currentAttendanceIds.length : combinedSquad.length, true)}
                  disabled={combinedSquad.length === 0}
                  className="px-4 h-9 rounded-xl text-[10px] font-black transition-all border bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-indigo-300 uppercase disabled:opacity-50 tracking-tight"
                >
                  {isAttendanceActive ? 'En per närvarande' : 'En per spelare'}
                </button>
              </div>
            </div>
          </div>

            <div className="space-y-4">
              {onAddGuest && (
                <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-100 dark:border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Spelare & Gäster</span>
                  </div>
                  
                  {!showGuestInput ? (
                    <div className={`grid grid-cols-1 ${absentSquadPlayers.length > 0 ? 'sm:grid-cols-2' : ''} gap-3`}>
                      <button
                        type="button"
                        onClick={() => setShowGuestInput(true)}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900 text-zinc-650 dark:text-zinc-350 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-zinc-100 dark:border-zinc-850 hover:border-indigo-200 dark:hover:border-indigo-900 transition-all shadow-sm cursor-pointer text-left"
                      >
                        <UserPlus size={16} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
                        <span>Skapa gästspelare</span>
                      </button>

                      {absentSquadPlayers.length > 0 && (
                        <div className="relative w-full">
                          <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center pointer-events-none">
                            <Users size={16} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
                          </div>
                          <select
                            value=""
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val) {
                                if (activeSessionId && onAddSquadPlayerToAttendance) {
                                  onAddSquadPlayerToAttendance(val);
                                } else {
                                  setStandaloneAttendance(prev => [...prev, val]);
                                }
                              }
                            }}
                            className="w-full bg-white dark:bg-zinc-900 text-zinc-650 dark:text-zinc-350 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-zinc-100 dark:border-zinc-850 hover:border-indigo-200 dark:hover:border-indigo-900 transition-all shadow-sm outline-none pl-11 pr-10 py-3 cursor-pointer appearance-none text-left"
                          >
                            <option value="">Hämta från truppen...</option>
                            {absentSquadPlayers.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} {p.position ? `(${p.position})` : ''}
                              </option>
                            ))}
                          </select>
                          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 dark:text-zinc-500">
                            <ChevronDown size={14} />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-3 w-full">
                        <input
                          autoFocus
                          type="text"
                          value={guestName}
                          onChange={(e) => setGuestName(e.target.value)}
                          placeholder="Namn..."
                          className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-2 text-base font-bold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (guestName.trim()) {
                                onAddGuest && onAddGuest(guestName.trim(), guestPosition || undefined);
                                setGuestName("");
                                setGuestPosition("");
                                setShowGuestInput(false);
                              }
                            }
                          }}
                        />
                        <div className="grid grid-cols-2 gap-2 w-full">
                          <select
                            value={guestPosition}
                            onChange={(e) => setGuestPosition(e.target.value)}
                            className="w-full bg-white dark:bg-zinc-900 border border-zinc-205 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm font-bold text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                          >
                            <option value="">Position (Valfritt)</option>
                            <option value="MV">Målvakt (MV)</option>
                            <option value="MB">Mittback (MB)</option>
                            <option value="YB">Ytterback (YB)</option>
                            <option value="MF">Mittfältare (MF)</option>
                            <option value="YMF">Yttermittfältare (YMF)</option>
                            <option value="FW">Forward (FW)</option>
                          </select>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (guestName.trim()) {
                                  onAddGuest && onAddGuest(guestName.trim(), guestPosition || undefined);
                                  setGuestName("");
                                  setGuestPosition("");
                                  setShowGuestInput(false);
                                }
                              }}
                              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-sm whitespace-nowrap cursor-pointer flex items-center justify-center py-2"
                            >
                              Lägg till
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowGuestInput(false);
                                setGuestName("");
                                setGuestPosition("");
                              }}
                              className="p-2 text-zinc-400 hover:text-red-500 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 cursor-pointer flex items-center justify-center shrink-0"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                      </div>

                      {absentSquadPlayers.length > 0 && (
                        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-850">
                          <div className="relative w-full">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center pointer-events-none">
                              <Users size={16} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
                            </div>
                            <select
                              value=""
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val) {
                                  if (activeSessionId && onAddSquadPlayerToAttendance) {
                                    onAddSquadPlayerToAttendance(val);
                                  } else {
                                    setStandaloneAttendance(prev => [...prev, val]);
                                  }
                                }
                              }}
                              className="w-full bg-white dark:bg-zinc-900 text-zinc-650 dark:text-zinc-350 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-zinc-100 dark:border-zinc-850 hover:border-indigo-200 dark:hover:border-indigo-900 transition-all shadow-sm outline-none pl-11 pr-10 py-3 cursor-pointer appearance-none text-left"
                            >
                              <option value="">Hämta från truppen...</option>
                              {absentSquadPlayers.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name} {p.position ? `(${p.position})` : ''}
                                </option>
                              ))}
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 dark:text-zinc-500">
                              <ChevronDown size={14} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!sessionAttendance && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowStandaloneAttendance(!showStandaloneAttendance)}
                    className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-100 dark:border-zinc-800 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-500">
                        <Users size={20} />
                      </div>
                      <div className="flex flex-col text-left">
                        <span className="font-bold text-zinc-900 dark:text-white text-sm">Välj närvarande spelare</span>
                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase font-bold tracking-wider">MARKERA VILKA SOM ÄR PÅ PLATS</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full text-[10px] font-black">
                        {standaloneAttendance.length}
                      </span>
                      <div className="text-zinc-400">
                        {showStandaloneAttendance ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </div>
                    </div>
                  </button>

                  <AnimatePresence>
                    {showStandaloneAttendance && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="bg-white dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                          <div className="flex flex-wrap gap-2">
                            {sortPlayersByPosition(combinedSquad.map(p => p.id), combinedSquad).map(pid => {
                              const player = combinedSquad.find(p => p.id === pid);
                              if (!player) return null;
                              return (
                                <button
                                  key={player.id}
                                  type="button"
                                  onClick={() => toggleStandaloneAttendance(player.id)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1 ${
                                    standaloneAttendance.includes(player.id)
                                      ? 'bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-zinc-100 text-white dark:text-zinc-900 shadow-sm'
                                      : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-gray-500 hover:border-indigo-300'
                                  }`}
                                >
                                  {player.name}
                                  {player.position && <span className="opacity-70 text-[8px]">({player.position})</span>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {((sessionAttendance && sessionAttendance.length > 0) || (standaloneAttendance.length > 0)) && (
                <button
                  type="button"
                  onClick={generateTeamsFromSessionAttendance}
                  className="w-full flex items-center justify-between p-4 bg-indigo-50 dark:bg-indigo-900/10 rounded-2xl border border-indigo-100 dark:border-indigo-900/30 transition-all hover:bg-indigo-100 dark:hover:bg-indigo-900/20 group"
                >
                  <div className="flex items-center gap-3 text-left">
                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-indigo-200 dark:shadow-none group-hover:scale-110 transition-transform">
                      <Users size={20} />
                    </div>
                    <div>
                      <span className="font-bold text-indigo-900 dark:text-indigo-100 text-sm block leading-none mb-1">
                        Skapa lag automatiskt
                      </span>
                      <span className="text-[10px] text-indigo-600 dark:text-indigo-400 uppercase font-black tracking-widest">
                        {(sessionAttendance?.length || standaloneAttendance.length)} DELTAGARE
                      </span>
                    </div>
                  </div>
                  <Wand2 size={20} className="text-indigo-600 dark:text-indigo-400" />
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowAttendanceInput(!showAttendanceInput)}
                className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-100 dark:border-zinc-800 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-sm">
                    <ClipboardList size={20} />
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="font-bold text-zinc-900 dark:text-white text-sm">Skapa lag från närvarolista</span>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase font-bold tracking-wider">KLISTRA IN NAMN OCH FÖRDELA AUTOMATISKT</span>
                  </div>
                </div>
                <div className="text-zinc-400">
                  {showAttendanceInput ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </div>
              </button>

              <AnimatePresence>
                {showAttendanceInput && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-white dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-4">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Klistra in namnen på de spelare som är på plats (t.ex. från kallelsen). 
                        Appen matchar namnen mot truppen och fördelar dem slumpmässigt i de {teams.length} lag du valt.
                      </p>
                      <textarea
                        value={attendanceText}
                        onChange={(e) => setAttendanceText(e.target.value)}
                        placeholder="Klistra in namn här (separera med ny rad eller kommatecken)..."
                        className="w-full h-32 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-medium resize-none"
                      />
                      <button
                        type="button"
                        onClick={generateTeamsFromAttendance}
                        disabled={!attendanceText.trim()}
                        className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Wand2 size={18} />
                        <span>Skapa lag automatiskt</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {copyableExercisesForSetup.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowCopyFromDropdown(!showCopyFromDropdown)}
                    className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-100 dark:border-zinc-800 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-sm">
                        <Copy size={20} />
                      </div>
                      <div className="flex flex-col text-left">
                        <span className="font-bold text-zinc-900 dark:text-white text-sm">Kopiera från tidigare lagindelning</span>
                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase font-bold tracking-wider">HÄMTA FRÅN ETT ANNAT MOMENT</span>
                      </div>
                    </div>
                    <div className="text-zinc-400">
                      {showCopyFromDropdown ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </button>

                  <AnimatePresence>
                    {showCopyFromDropdown && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="bg-white dark:bg-zinc-950 p-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-850 max-h-64 overflow-y-auto">
                          {copyableExercisesForSetup.map(ex => {
                            const totalPlayers = ex.teams.reduce((sum, t) => sum + (t.playerIds?.length || 0), 0);
                            return (
                              <button
                                type="button"
                                key={ex.id}
                                onClick={() => {
                                  handleCopyFromExercise(ex);
                                  setShowCopyFromDropdown(false);
                                }}
                                className="w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors flex items-center justify-between"
                              >
                                <div className="min-w-0 pr-2">
                                  <p className="font-extrabold text-xs text-zinc-900 dark:text-white truncate">{ex.name}</p>
                                  <p className="text-[10px] text-zinc-500 font-medium truncate">
                                    {new Date(ex.date).toLocaleDateString('sv-SE')} • {ex.teams.length} lag
                                  </p>
                                </div>
                                <span className="shrink-0 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-black text-[10px] px-2 py-1 rounded-lg">
                                  {totalPlayers} spelare
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}

              {teams.some(t => t.playerIds.length > 0) && (
                <button
                  type="button"
                  onClick={clearAllTeams}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 rounded-xl font-bold hover:bg-red-50 dark:hover:bg-red-900/10 hover:text-red-500 transition-all text-xs uppercase tracking-widest border border-zinc-200 dark:border-zinc-700 hover:border-red-200"
                >
                  <RotateCcw size={14} />
                  <span>Rensa alla spelare från lagen</span>
                </button>
              )}
            </div>

            {combinedSquad.length > 0 && (
              <div className="bg-zinc-50 dark:bg-zinc-950 rounded-3xl p-6 border border-zinc-100 dark:border-zinc-800 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <LayoutList size={18} className="text-zinc-400" />
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Lagöversikt</h3>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {teams.map((team, idx) => {
                    const isThisTeamDragging = draggedPlayerId && team.playerIds.includes(draggedPlayerId);
                    return (
                      <div 
                        key={team.id} 
                        data-overview-team-id={team.id}
                        className={`bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow-sm border transition-all duration-200 ${draggedPlayerId ? 'scale-[1.02] border-indigo-200 dark:border-indigo-800 bg-indigo-50/10' : 'border-zinc-100 dark:border-zinc-800'}`}
                        style={{ zIndex: isThisTeamDragging ? 100 : (draggedPlayerId ? 10 : 1), position: 'relative' }}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
                          <span className="font-black text-sm text-zinc-900 dark:text-white uppercase tracking-tight">Lag {idx + 1}</span>
                          <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded-full font-bold">
                            {team.playerIds.length}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 min-h-[30px]">
                          {sortPlayersByPosition(team.playerIds || [], combinedSquad).map(pid => {
                            const player = combinedSquad.find(p => p.id === pid);
                            return player ? (
                              <motion.div 
                                key={pid} 
                                drag
                                dragSnapToOrigin
                                whileDrag={{ 
                                  zIndex: 9999, 
                                  scale: 1.1,
                                  pointerEvents: 'none'
                                }}
                                onDragStart={() => setDraggedPlayerId(pid)}
                                onDragEnd={(e: any, info) => {
                                  const point = (e.nativeEvent || e).clientX !== undefined ? (e.nativeEvent || e) : info.point;
                                  handleDragEndInOverview(pid, point.clientX || point.x, point.clientY || point.y);
                                }}
                                className={`px-2 py-1 rounded-md text-[11px] font-bold text-white shadow-sm flex items-center gap-1 cursor-grab active:cursor-grabbing touch-none z-50`} 
                                style={{ backgroundColor: team.color }}
                              >
                                <div className="flex items-center gap-1">
                                  <span>{player.name}</span>
                                  {player.position && <span className="opacity-70 text-[8px]">({player.position})</span>}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      movePlayerInternal(pid, 'none');
                                    }}
                                    className="ml-1 p-0.5 hover:bg-white/20 rounded-full transition-colors cursor-pointer flex items-center justify-center text-white"
                                    title="Ta bort från lag"
                                  >
                                    <X size={10} />
                                  </button>
                                </div>
                              </motion.div>
                            ) : null;
                          })}
                          {team.playerIds.length === 0 && (
                            <div className="w-full py-2 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg flex items-center justify-center text-[8px] font-bold text-zinc-400 uppercase tracking-widest pointer-events-none">
                              Dra hit
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {(() => {
                    const isJokerDragging = draggedPlayerId && jokerPlayerIds.includes(draggedPlayerId);
                    return (
                      <div 
                        key="joker-overview"
                        data-overview-team-id="joker"
                        className={`bg-indigo-50 dark:bg-indigo-900/10 p-4 rounded-2xl shadow-sm border transition-all duration-200 ${draggedPlayerId ? 'scale-[1.02] border-indigo-400' : 'border-indigo-100 dark:border-indigo-900/30'}`}
                        style={{ zIndex: isJokerDragging ? 100 : (draggedPlayerId ? 10 : 1), position: 'relative' }}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-3 h-3 rounded-full bg-indigo-600" />
                          <span className="font-black text-sm text-indigo-900 dark:text-indigo-100 uppercase tracking-tight">Jokrar</span>
                          <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full font-bold">
                            {jokerPlayerIds.length}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 min-h-[30px]">
                          {sortPlayersByPosition(jokerPlayerIds || [], combinedSquad).map(pid => {
                            const player = combinedSquad.find(p => p.id === pid);
                            return player ? (
                              <motion.div 
                                key={pid} 
                                drag
                                dragSnapToOrigin
                                whileDrag={{ 
                                  zIndex: 9999, 
                                  scale: 1.1,
                                  pointerEvents: 'none'
                                }}
                                onDragStart={() => setDraggedPlayerId(pid)}
                                onDragEnd={(e: any, info) => {
                                  const point = (e.nativeEvent || e).clientX !== undefined ? (e.nativeEvent || e) : info.point;
                                  handleDragEndInOverview(pid, point.clientX || point.x, point.clientY || point.y);
                                }}
                                className={`px-2 py-1 rounded-md text-[11px] font-bold text-white bg-indigo-600 shadow-sm flex items-center gap-1 cursor-grab active:cursor-grabbing touch-none z-50`}
                              >
                                <div className="flex items-center gap-1">
                                  <span>{player.name}</span>
                                  {player.position && <span className="opacity-70 text-[8px]">({player.position})</span>}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      movePlayerInternal(pid, 'none');
                                    }}
                                    className="ml-1 p-0.5 hover:bg-white/20 rounded-full transition-colors cursor-pointer flex items-center justify-center text-white"
                                    title="Ta bort från jokrar"
                                  >
                                    <X size={10} />
                                  </button>
                                </div>
                              </motion.div>
                            ) : null;
                          })}
                          {jokerPlayerIds.length === 0 && (
                            <div className="w-full py-2 border border-dashed border-indigo-200 dark:border-indigo-800 rounded-lg flex items-center justify-center text-[8px] font-bold text-indigo-400 uppercase tracking-widest pointer-events-none">
                              Dra hit
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {(() => {
                    const isUnassignedDragging = draggedPlayerId && unassignedPlayers.some(p => p.id === draggedPlayerId);
                    return (
                      <div 
                        key="unassigned-overview"
                        data-overview-team-id="none"
                        className={`bg-zinc-50 dark:bg-zinc-950/30 p-4 rounded-2xl shadow-sm border border-dashed transition-all duration-200 flex flex-col h-full ${draggedPlayerId ? 'scale-[1.02] border-zinc-300 dark:border-zinc-700 opacity-60' : 'border-zinc-205 dark:border-zinc-800'}`}
                        style={{ zIndex: isUnassignedDragging ? 100 : (draggedPlayerId ? 10 : 1), position: 'relative' }}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-3 h-3 rounded-full border border-zinc-400 dark:border-zinc-650" />
                          <span className="font-black text-sm text-zinc-500 dark:text-zinc-400 uppercase tracking-tight flex-1">Ej indelade / Avbytare</span>
                          <span className="text-[10px] bg-zinc-200/55 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 rounded-full font-bold">
                            {unassignedPlayers.length}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 min-h-[30px]">
                          {sortPlayersByPosition(unassignedPlayers.map(p => p.id), combinedSquad).map(pid => {
                            const player = combinedSquad.find(p => p.id === pid);
                            return player ? (
                              <motion.div 
                                key={pid} 
                                drag
                                dragSnapToOrigin
                                whileDrag={{ 
                                  zIndex: 9999, 
                                  scale: 1.1,
                                  pointerEvents: 'none'
                                }}
                                onDragStart={() => setDraggedPlayerId(pid)}
                                onDragEnd={(e: any, info) => {
                                  const point = (e.nativeEvent || e).clientX !== undefined ? (e.nativeEvent || e) : info.point;
                                  handleDragEndInOverview(pid, point.clientX || point.x, point.clientY || point.y);
                                }}
                                className={`pl-2 pr-1 py-1 rounded-md text-[11px] font-bold text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-850 border border-zinc-150 dark:border-zinc-800 shadow-sm flex items-center gap-1.5 cursor-grab active:cursor-grabbing touch-none z-50 transition-colors hover:border-zinc-300 dark:hover:border-zinc-750`} 
                              >
                                <span>{player.name}</span>
                                {player.position && <span className="opacity-70 text-[8px]">({player.position})</span>}
                                <button
                                  type="button"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemovePlayerFromAttendance(pid);
                                  }}
                                  className="p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-red-500 rounded transition-colors cursor-pointer shrink-0 ml-0.5"
                                  title="Ta bort från närvaro"
                                >
                                  <X size={10} />
                                </button>
                              </motion.div>
                            ) : null;
                          })}
                          {unassignedPlayers.length === 0 && (
                            <div className="w-full py-2 border border-dashed border-zinc-200/50 dark:border-zinc-800/50 rounded-lg flex items-center justify-center text-[8px] font-bold text-zinc-400 uppercase tracking-widest pointer-events-none">
                              Dra hit
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowJokers(!showJokers)}
                className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-100 dark:border-zinc-800 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <div className="flex flex-col text-left">
                  <label className="block text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider cursor-pointer">Jokrar</label>
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">Spelare som är med i alla lag och alltid får poäng</span>
                </div>
                <div className="text-zinc-400">
                  {showJokers ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </div>
              </button>
              
              <AnimatePresence>
                {showJokers && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-indigo-50 dark:bg-indigo-950/20 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/30 mb-4">
                      <div className="flex items-center justify-between mb-3">
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Välj jokrar</label>
                        {isAttendanceActive && (
                          <span className="text-[9px] font-black text-indigo-600 uppercase">Visar närvarande spelare</span>
                        )}
                      </div>
                      {combinedSquad.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {sortPlayersByPosition(combinedSquad.map(p => p.id), combinedSquad)
                            .filter(pid => {
                              if (!isAttendanceActive) return true;
                              const isGuest = typeof pid === 'string' && pid.startsWith('guest_');
                              return currentAttendanceIds.includes(pid) || (isGuest && (guestPlayers || []).some(gp => gp.id === pid));
                            })
                            .map(pid => {
                              const player = combinedSquad.find(p => p.id === pid);
                              if (!player) return null;
                              const isJoker = jokerPlayerIds.includes(player.id);
                            
                            return (
                              <button
                                key={player.id}
                                type="button"
                                onClick={() => toggleJoker(player.id)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1 ${
                                  isJoker 
                                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-none' 
                                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-indigo-300'
                                }`}
                                style={isJoker ? { backgroundColor: '#6366f1', borderColor: '#6366f1' } : {}}
                              >
                                {player.name}
                                {player.position && <span className="opacity-70 text-[8px]">({player.position})</span>}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-zinc-500 italic">Inga spelare i truppen än.</p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-6">
              <AnimatePresence mode="popLayout">
                {teams.map((team, index) => (
                  <motion.div
                    key={team.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="bg-zinc-50 dark:bg-zinc-950 p-6 rounded-2xl border border-zinc-100 dark:border-zinc-800"
                  >
                    <div className="flex flex-col gap-4 mb-6">
                      {/* Topp-rad: Namn och knappar */}
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex flex-col min-w-0 flex-1">
                          <input
                            type="text"
                            value={team.name}
                            onChange={(e) => updateTeam(team.id, { name: e.target.value })}
                            placeholder={`Lag ${index + 1}`}
                            className="bg-transparent border-none focus:ring-0 text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight p-0 placeholder:text-zinc-300 w-full"
                          />
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Users size={12} className="text-zinc-400" />
                            <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{team.playerIds.length} spelare</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="submit"
                            className="bg-indigo-600 text-white p-2 rounded-xl transition-all active:scale-95 hover:bg-indigo-700 shadow-sm"
                            title="Spara hela tävlingen"
                          >
                            <Save size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTeam(team.id)}
                            disabled={teams.length <= 1}
                            className="bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 hover:text-red-500 p-2 rounded-xl transition-all active:scale-95 disabled:opacity-0"
                            title="Ta bort lag"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>

                      {/* Rad 2: Färgval */}
                      <div className="flex items-center gap-3 bg-white dark:bg-zinc-900 p-2.5 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm w-fit">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-1">Väst:</span>
                        <ColorPicker 
                          selectedColor={team.color} 
                          onChange={(color) => updateTeam(team.id, { color })} 
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                          {guestPlayers.length > 0 ? 'Välj spelare (inkl. provspelare)' : 'Välj spelare från truppen'}
                        </label>
                        {isAttendanceActive && (
                          <span className="text-[9px] font-black text-indigo-600 uppercase">Visar närvarande spelare</span>
                        )}
                      </div>
                      {combinedSquad.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {sortPlayersByPosition(combinedSquad.map(p => p.id), combinedSquad)
                            .filter(pid => {
                              if (!isAttendanceActive) return true;
                              const isGuest = typeof pid === 'string' && pid.startsWith('guest_');
                              return currentAttendanceIds.includes(pid) || (isGuest && (guestPlayers || []).some(gp => gp.id === pid));
                            })
                            .map(pid => {
                              const player = combinedSquad.find(p => p.id === pid);
                              if (!player) return null;
                              const isSelected = team.playerIds.includes(player.id);
                              const isJoker = jokerPlayerIds.includes(player.id);
                              
                              return (
                                <button
                                key={player.id}
                                type="button"
                                onClick={() => togglePlayerInTeam(team.id, player.id)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1 ${
                                  isSelected 
                                    ? 'text-white shadow-md' 
                                    : isJoker
                                      ? 'bg-zinc-100 border-zinc-100 text-zinc-400 opacity-50 cursor-not-allowed'
                                      : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-indigo-300'
                                }`}
                                style={isSelected ? { backgroundColor: team.color, borderColor: team.color } : {}}
                                disabled={isJoker}
                              >
                                {player.name}
                                {player.position && <span className="opacity-70 text-[8px]">({player.position})</span>}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-zinc-500 italic">Inga spelare i truppen än. Gå till "Truppen" för att lägga till spelare.</p>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <button
            type="submit"
            onClick={() => {
              submitShouldStartRef.current = !initialGame;
            }}
            className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-xl flex items-center justify-center gap-3 hover:bg-indigo-700 active:scale-[0.98] transition-all shadow-lg shadow-indigo-200 dark:shadow-none"
          >
            {initialGame ? (
              <>
                <Check size={24} strokeWidth={3} />
                Spara ändringar
              </>
            ) : (
              <>
                <Play fill="currentColor" size={24} />
                Starta tävlingsmomentet
              </>
            )}
          </button>
        </form>
      </div>

      <AnimatePresence>
      </AnimatePresence>
    </motion.div>
  );
}
