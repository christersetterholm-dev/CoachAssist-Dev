import React, { useState, useRef, useEffect } from 'react';
import { Plus, Minus, Trash2, Play, UserPlus, Trophy, X, Check, Calendar, Users, Medal, ChevronDown, ChevronUp, Save, ClipboardList, ClipboardPaste, ClipboardCheck, Wand2, RotateCcw, LayoutList, Clock, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SquadPlayer, PRESET_COLORS, Exercise, Team, PointsConfig, TrainingSession } from '../types';
import { sortPlayersByPosition, findSquadMatch } from '../lib/teamUtils';
import ColorPicker from './ColorPicker';
import { Badge, Button, Card, IconButton, MenuItem, SectionHeader, SegmentedTabs, Sheet, TextArea, TextInput } from './ui';

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
    shouldStart?: boolean,
    includeLeaders?: boolean
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
  const [includeLeaders, setIncludeLeaders] = useState(initialGame?.includeLeaders ?? false);
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
  const attendanceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [setupClipboardStatus, setSetupClipboardStatus] = useState<'idle' | 'pasted' | 'failed'>('idle');

  useEffect(() => {
    if (showAttendanceInput) {
      setSetupClipboardStatus('idle');
      const timer = setTimeout(() => {
        attendanceTextareaRef.current?.focus();
        const len = attendanceTextareaRef.current?.value.length || 0;
        attendanceTextareaRef.current?.setSelectionRange(len, len);
      }, 70);
      return () => clearTimeout(timer);
    }
  }, [showAttendanceInput]);

  const handleSetupPasteClipboard = async () => {
    try {
      if (navigator?.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setAttendanceText(text);
          setSetupClipboardStatus('pasted');
          setTimeout(() => setSetupClipboardStatus('idle'), 2500);
          attendanceTextareaRef.current?.focus();
          return;
        }
      }
    } catch (err) {
      console.warn('Clipboard readText failed or was blocked by browser:', err);
      setSetupClipboardStatus('failed');
      setTimeout(() => setSetupClipboardStatus('idle'), 3000);
    }
    attendanceTextareaRef.current?.focus();
  };
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
  
  // Get RSVP attending IDs
  const rsvpAttendingIds = React.useMemo(() => {
    if (!linkedSession?.rsvps) return [];
    return Object.entries(linkedSession.rsvps)
      .filter(([_, rsvp]) => {
        const r = rsvp as any;
        return r && (r.status === 'attending' || r.status === 'partial');
      })
      .map(([playerId]) => playerId);
  }, [linkedSession?.rsvps]);

  const [planningSource, setPlanningSource] = useState<'attendance' | 'rsvp'>(
    linkedSession?.rsvps && Object.entries(linkedSession.rsvps).some(([_, r]) => {
      const rsvpVal = r as any;
      return rsvpVal && (rsvpVal.status === 'attending' || rsvpVal.status === 'partial');
    })
      ? 'rsvp'
      : 'attendance'
  );
  
  const combinedSquad = React.useMemo(() => {
    return [
      ...(squad || []).filter(p => includeLeaders ? true : p.role !== 'leader'), 
      ...(guestPlayers || []).filter(p => includeLeaders ? true : p.role !== 'leader')
    ];
  }, [squad, guestPlayers, includeLeaders]);

  // Derived helper to identify currently attending players (either from session or standalone)
  const currentAttendanceIds = React.useMemo(() => {
    if (linkedSession && planningSource === 'rsvp') {
      return rsvpAttendingIds;
    }
    return sessionAttendance || standaloneAttendance;
  }, [linkedSession, planningSource, rsvpAttendingIds, sessionAttendance, standaloneAttendance]);

  const isAttendanceActive = Array.isArray(sessionAttendance) || standaloneAttendance.length > 0 || (linkedSession && planningSource === 'rsvp');
  
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
    .filter(p => includeLeaders ? true : p.role !== 'leader')
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

    const lines = attendanceText.split(/[\n;]/);
    const attendingPlayers: SquadPlayer[] = [];
    let currentSectionStatus: 'attending' | 'declined' | 'unanswered' = 'attending';

    lines.forEach(rawLine => {
      let line = rawLine.trim();
      if (!line) return;

      const cleanHeaderTest = line.replace(/\([^)]*\)/g, '').replace(/\d+/g, '').replace(/[-:–—\t]/g, '').trim().toLowerCase();
      if (/^(deltar ej|kommer inte|kommer ej|nej|kan inte|kan ej|avanmäld|avanmälda|frånvarande|sjuk|bortrest)$/i.test(cleanHeaderTest)) {
        currentSectionStatus = 'declined';
        return;
      } else if (/^(deltar|kommer|ja|kan delta|anmäld|anmälda|kallade som deltar)$/i.test(cleanHeaderTest)) {
        currentSectionStatus = 'attending';
        return;
      } else if (/^(ej svarat|har inte svarat|obesvarad|obesvarade|svar saknas|svarade ej|inte svarat)$/i.test(cleanHeaderTest)) {
        currentSectionStatus = 'unanswered';
        return;
      }

      let isAttending = currentSectionStatus === 'attending';
      const lower = line.toLowerCase();
      if (/\b(deltar ej|deltar inte|kan ej|kan inte|kommer ej|kommer inte|nej|ej med|avanmäld|frånvarande|sjuk|bortrest|ej svarat|har inte svarat|obesvarad)\b/i.test(lower)) {
        isAttending = false;
        return;
      } else if (/\b(deltar|kommer|ja|kan delta|anmäld)\b/i.test(lower)) {
        isAttending = true;
      }

      if (!isAttending) return;

      let cleanName = line
        .replace(/\([^)]*\)/g, '')
        .replace(/\b(deltar|kommer|ja|kan delta|anmäld|reserv)\b/gi, '')
        .trim();

      const match = findSquadMatch(cleanName, combinedSquad);
      if (match && !attendingPlayers.some(p => p.id === match.id)) {
        attendingPlayers.push(match);
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
    const list = currentAttendanceIds;
    if (!list || list.length === 0) {
      if (isAttendanceActive) {
        if (linkedSession && planningSource === 'rsvp') {
          alert("Inga spelare är anmälda till träningen. Gå till fliken 'Anmälda' för att se anmälningar.");
        } else {
          alert("Inga spelare är markerade som närvarande i träningen. Gå till fliken 'Deltagare' för att markera vilka som är där.");
        }
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
      alert("Hittade inga spelare i truppen eller bland provspelare.");
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
      submitShouldStartRef.current,
      includeLeaders
    );
    // Reset back to default
    submitShouldStartRef.current = false;
  };

  const addAbsentToAttendance = (playerId: string) => {
    if (!playerId) return;
    if (activeSessionId && onAddSquadPlayerToAttendance) {
      onAddSquadPlayerToAttendance(playerId);
    } else {
      setStandaloneAttendance(prev => [...prev, playerId]);
    }
  };

  const submitGuest = () => {
    if (!guestName.trim()) return;
    onAddGuest && onAddGuest(guestName.trim(), guestPosition || undefined);
    setGuestName('');
    setGuestPosition('');
    setShowGuestInput(false);
  };

  const toggleExcludeGoalkeepers = () => {
    const newValue = !excludeGoalkeepers;
    setExcludeGoalkeepers(newValue);
    if (newValue) {
      // Ta bort målvakter ur alla lag och jokrar
      const keep = (pid: string) => {
        const p = combinedSquad.find(player => player.id === pid);
        return p ? !isGoalkeeper(p) : true;
      };
      setTeams(prev => prev.map(t => ({ ...t, playerIds: t.playerIds.filter(keep) })));
      setJokerPlayerIds(prev => prev.filter(keep));
    }
  };

  const isIndividualMode = teams.length > 0 && teams.every(t => t.playerIds.length === 1 && t.name === '');

  // Spelare som visas som valbara (närvarande om närvaro används)
  const selectablePlayerIds = sortPlayersByPosition(combinedSquad.map(p => p.id), combinedSquad).filter(pid => {
    if (!isAttendanceActive) return true;
    const isGuest = typeof pid === 'string' && pid.startsWith('guest_');
    return currentAttendanceIds.includes(pid) || (isGuest && (guestPlayers || []).some(gp => gp.id === pid));
  });

  const chipBase = 'min-h-[40px] px-3 rounded-xl text-sm font-semibold transition-all border inline-flex items-center gap-1.5 cursor-pointer active:scale-[0.97]';
  const positionTag = (p: SquadPlayer, light = false) =>
    p.role === 'leader'
      ? <span className={`text-[11px] font-semibold px-1.5 rounded-md ${light ? 'bg-white/25' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>Ledare</span>
      : p.position
        ? <span className="text-[11px] opacity-70">{p.position}</span>
        : null;

  const renderOverviewChip = (pid: string, idx: number, keyPrefix: string, variant: { color?: string; neutral?: boolean }, onRemove: () => void, removeLabel: string) => {
    const player = combinedSquad.find(p => p.id === pid);
    if (!player) return null;
    return (
      <motion.div
        key={`${keyPrefix}-${pid}-${idx}`}
        drag
        dragSnapToOrigin
        whileDrag={{ zIndex: 9999, scale: 1.08, pointerEvents: 'none' }}
        onDragStart={() => setDraggedPlayerId(pid)}
        onDragEnd={(e: any, info) => {
          const point = (e.nativeEvent || e).clientX !== undefined ? (e.nativeEvent || e) : info.point;
          handleDragEndInOverview(pid, point.clientX || point.x, point.clientY || point.y);
        }}
        className={`h-9 max-w-full min-w-0 pl-3 pr-1 rounded-lg text-sm font-semibold flex items-center gap-1.5 cursor-grab active:cursor-grabbing touch-none z-50 select-none ${
          variant.neutral
            ? 'text-zinc-800 dark:text-zinc-100 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700'
            : 'text-white shadow-sm'
        }`}
        style={variant.neutral ? undefined : { backgroundColor: variant.color }}
      >
        {/* Rutan får inte bli bredare än lagets kolumn: positionen kortas först, sedan namnet */}
        <span className="truncate min-w-0">{player.name}</span>
        {(player.role === 'leader' || player.position) && (
          <span className="truncate min-w-0 shrink-[100]">{positionTag(player, !variant.neutral)}</span>
        )}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 cursor-pointer ${variant.neutral ? 'text-zinc-400 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-700' : 'text-white/90 hover:bg-white/20'}`}
          aria-label={`${removeLabel}: ${player.name}`}
          title={removeLabel}
        >
          <X size={14} />
        </button>
      </motion.div>
    );
  };

  const dropHint = (tone: 'neutral' | 'brand' = 'neutral') => (
    <div className={`w-full h-9 border border-dashed rounded-lg flex items-center justify-center text-xs font-semibold pointer-events-none ${
      tone === 'brand' ? 'border-indigo-200 dark:border-indigo-800 text-indigo-400' : 'border-zinc-200 dark:border-zinc-800 text-zinc-400'
    }`}>
      Dra hit
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-3xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6"
    >
      <form id="game-setup-form" onSubmit={handleStart} className="space-y-5 pb-28">
        {/* Namn och koppling till pass */}
        <Card className="space-y-4">
          <div>
            <label htmlFor="game-name" className="block text-sm font-semibold text-zinc-600 dark:text-zinc-300 mb-1.5">Namn på tävlingsmomentet</label>
            <TextInput
              id="game-name"
              type="text"
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              placeholder="T.ex. Passningsspel 4 mot 4"
              className={inputClass + ' text-base font-semibold'}
            />
          </div>

          {(linkedSession || sessionAttendance || initialGame?.sessionId) && (
            <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <Calendar size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span className="truncate">Kopplat till <span className="font-semibold">{sessionTitle}</span></span>
            </div>
          )}

          {linkedSession && (
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">Planera lagen utifrån</p>
              <SegmentedTabs<'rsvp' | 'attendance'>
                value={planningSource}
                onChange={setPlanningSource}
                tabs={[
                  { id: 'rsvp', label: 'Anmälda', count: rsvpAttendingIds.length },
                  { id: 'attendance', label: 'Närvarande', count: (sessionAttendance || []).length },
                ]}
              />
            </div>
          )}
        </Card>

        {/* Antal lag */}
        <Card className="space-y-4">
          <SectionHeader title="Antal lag" icon={<Users size={16} />} className="mb-0" />
          <div className="flex flex-wrap items-center gap-2">
            {[1, 2, 3, 4].map(num => {
              const selected = teams.length === num && !isIndividualMode;
              return (
                <button
                  key={num}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTeamCount(num)}
                  className={`w-11 h-11 rounded-xl text-base font-bold transition-all border cursor-pointer ${
                    selected
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:border-indigo-300'
                  }`}
                >
                  {num}
                </button>
              );
            })}
            <label className="h-11 flex items-center gap-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3">
              <span className="text-sm text-zinc-500 dark:text-zinc-400">Annat</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="50"
                placeholder={teams.length > 4 && !isIndividualMode ? String(teams.length) : '#'}
                className="w-10 bg-transparent border-none focus:ring-0 outline-none text-base font-bold text-zinc-900 dark:text-white p-0 text-center"
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (val > 0) setTeamCount(val);
                }}
              />
            </label>
            <Button
              variant={isIndividualMode ? 'primary' : 'secondary'}
              onClick={() => setTeamCount(isAttendanceActive ? currentAttendanceIds.length : combinedSquad.length, true)}
              disabled={combinedSquad.length === 0}
            >
              {isAttendanceActive ? 'En per närvarande' : 'En per spelare'}
            </Button>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800 -mx-1">
            <SwitchRow label="Hoppa över målvakterna" description="Målvakter delas inte in i lagen" checked={excludeGoalkeepers} onChange={toggleExcludeGoalkeepers} />
            <SwitchRow label="Ta med tränare och ledare" description="Ledare kan delas in som spelare" checked={includeLeaders} onChange={() => setIncludeLeaders(!includeLeaders)} />
          </div>
        </Card>

        {/* Fyll lagen */}
        <Card padded={false} className="p-2">
          <div className="px-3 pt-2 pb-1">
            <SectionHeader title="Fyll lagen" icon={<Wand2 size={16} />} className="mb-0" />
          </div>
          {isAttendanceActive && (
            <MenuItem
              icon={<Wand2 size={18} />}
              active
              label="Dela in automatiskt"
              description={`${currentAttendanceIds.length} ${linkedSession && planningSource === 'rsvp' ? 'anmälda' : 'närvarande'} fördelas jämnt efter position`}
              onClick={generateTeamsFromSessionAttendance}
            />
          )}
          {!sessionAttendance && (
            <MenuItem
              icon={<Users size={18} />}
              label="Välj närvarande spelare"
              description="Markera vilka som är på plats"
              trailing={<Badge>{standaloneAttendance.length}</Badge>}
              onClick={() => setShowStandaloneAttendance(true)}
            />
          )}
          <MenuItem
            icon={<ClipboardList size={18} />}
            label="Klistra in en närvarolista"
            description="Namnen matchas mot truppen och fördelas"
            onClick={() => setShowAttendanceInput(true)}
          />
          {copyableExercisesForSetup.length > 0 && (
            <MenuItem
              icon={<Copy size={18} />}
              label="Kopiera tidigare lagindelning"
              description="Hämta lagen från ett annat moment"
              onClick={() => setShowCopyFromDropdown(true)}
            />
          )}
          {onAddGuest && (
            <MenuItem
              icon={<UserPlus size={18} />}
              label="Lägg till spelare eller gäst"
              description={absentSquadPlayers.length > 0 ? 'Gästspelare eller någon ur truppen som saknas' : 'Skapa en gästspelare'}
              onClick={() => setShowGuestInput(true)}
            />
          )}
          {teams.some(t => t.playerIds.length > 0) && (
            <MenuItem icon={<RotateCcw size={18} />} label="Töm lagen" description="Alla spelare blir oindelade" tone="danger" onClick={clearAllTeams} />
          )}
        </Card>

        {/* Lagöversikt med dra-och-släpp */}
        {combinedSquad.length > 0 && (
          <Card className="space-y-3">
            <SectionHeader title="Lagöversikt" icon={<LayoutList size={16} />} className="mb-0" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400 -mt-1">Dra en spelare för att flytta den till ett annat lag.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {teams.map((team, idx) => {
                const isThisTeamDragging = draggedPlayerId && team.playerIds.includes(draggedPlayerId);
                return (
                  <div
                    key={team.id}
                    data-overview-team-id={team.id}
                    className={`p-3 rounded-xl border transition-all duration-200 bg-zinc-50 dark:bg-zinc-950 ${draggedPlayerId ? 'border-indigo-300 dark:border-indigo-700' : 'border-zinc-200/80 dark:border-zinc-800'}`}
                    style={{ zIndex: isThisTeamDragging ? 100 : (draggedPlayerId ? 10 : 1), position: 'relative' }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
                      <span className="font-semibold text-sm truncate flex-1">{team.name || `Lag ${idx + 1}`}</span>
                      <Badge>{team.playerIds.length}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5 min-h-[36px]">
                      {sortPlayersByPosition(team.playerIds || [], combinedSquad).map((pid, i) =>
                        renderOverviewChip(pid, i, team.id, { color: team.color }, () => movePlayerInternal(pid, 'none'), 'Ta bort från laget')
                      )}
                      {team.playerIds.length === 0 && dropHint()}
                    </div>
                  </div>
                );
              })}

              <div
                data-overview-team-id="joker"
                className={`p-3 rounded-xl border transition-all duration-200 bg-indigo-50/60 dark:bg-indigo-950/20 ${draggedPlayerId ? 'border-indigo-400' : 'border-indigo-100 dark:border-indigo-900/40'}`}
                style={{ zIndex: draggedPlayerId && jokerPlayerIds.includes(draggedPlayerId) ? 100 : (draggedPlayerId ? 10 : 1), position: 'relative' }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3.5 h-3.5 rounded-full bg-indigo-600 shrink-0" />
                  <span className="font-semibold text-sm flex-1">Jokrar</span>
                  <Badge tone="brand">{jokerPlayerIds.length}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-[36px]">
                  {sortPlayersByPosition(jokerPlayerIds || [], combinedSquad).map((pid, i) =>
                    renderOverviewChip(pid, i, 'joker', { color: '#4f46e5' }, () => movePlayerInternal(pid, 'none'), 'Ta bort från jokrar')
                  )}
                  {jokerPlayerIds.length === 0 && dropHint('brand')}
                </div>
              </div>

              <div
                data-overview-team-id="none"
                className={`p-3 rounded-xl border border-dashed transition-all duration-200 ${draggedPlayerId ? 'border-zinc-400 dark:border-zinc-600' : 'border-zinc-200 dark:border-zinc-800'}`}
                style={{ zIndex: draggedPlayerId && unassignedPlayers.some(p => p.id === draggedPlayerId) ? 100 : (draggedPlayerId ? 10 : 1), position: 'relative' }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3.5 h-3.5 rounded-full border border-zinc-400 dark:border-zinc-600 shrink-0" />
                  <span className="font-semibold text-sm text-zinc-500 dark:text-zinc-400 flex-1">Ej indelade</span>
                  <Badge>{unassignedPlayers.length}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-[36px]">
                  {sortPlayersByPosition(unassignedPlayers.map(p => p.id), combinedSquad).map((pid, i) =>
                    renderOverviewChip(pid, i, 'unassigned', { neutral: true }, () => handleRemovePlayerFromAttendance(pid), 'Ta bort från närvaron')
                  )}
                  {unassignedPlayers.length === 0 && dropHint()}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Lagen var för sig: namn, färg och spelare */}
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {teams.map((team, index) => (
              <motion.div
                key={team.id}
                layout
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
              >
                <Card className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="w-4 h-10 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
                    <div className="flex-1 min-w-0">
                      <TextInput
                        type="text"
                        value={team.name}
                        onChange={(e) => updateTeam(team.id, { name: e.target.value })}
                        placeholder={`Lag ${index + 1}`}
                        aria-label={`Namn på lag ${index + 1}`}
                        className="w-full h-10 bg-transparent border-none focus:ring-0 outline-none text-lg font-bold text-zinc-900 dark:text-white p-0 placeholder:text-zinc-400"
                      />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{team.playerIds.length} spelare</span>
                    </div>
                    <IconButton label="Ta bort laget" onClick={() => removeTeam(team.id)} disabled={teams.length <= 1} className="hover:!text-red-600">
                      <Trash2 size={18} />
                    </IconButton>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">Västfärg</span>
                    <ColorPicker selectedColor={team.color} onChange={(color) => updateTeam(team.id, { color })} />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                        {guestPlayers.length > 0 ? 'Spelare (inkl. gäster)' : 'Spelare'}
                      </span>
                      {isAttendanceActive && <Badge tone="brand">Bara närvarande</Badge>}
                    </div>
                    {combinedSquad.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selectablePlayerIds.map((pid, idx) => {
                          const player = combinedSquad.find(p => p.id === pid);
                          if (!player) return null;
                          const isSelected = team.playerIds.includes(player.id);
                          const isJoker = jokerPlayerIds.includes(player.id);
                          return (
                            <button
                              key={`${player.id}-${idx}`}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => togglePlayerInTeam(team.id, player.id)}
                              disabled={isJoker}
                              className={`${chipBase} ${
                                isSelected
                                  ? 'text-white border-transparent shadow-sm'
                                  : isJoker
                                    ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-100 dark:border-zinc-800 text-zinc-400 opacity-50 cursor-not-allowed'
                                    : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:border-indigo-300'
                              }`}
                              style={isSelected ? { backgroundColor: team.color } : undefined}
                            >
                              {player.name}
                              {player.position && <span className="text-[11px] opacity-70">{player.position}</span>}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500">Inga spelare i truppen än. Lägg till spelare under Truppen.</p>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Jokrar */}
        <Card padded={false}>
          <button
            type="button"
            onClick={() => setShowJokers(!showJokers)}
            aria-expanded={showJokers}
            className="w-full flex items-center gap-3 p-4 text-left cursor-pointer"
          >
            <span className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0">
              <Medal size={20} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold">Jokrar</span>
              <span className="block text-sm text-zinc-500 dark:text-zinc-400">Spelare som är med i alla lag och alltid får poäng</span>
            </span>
            {jokerPlayerIds.length > 0 && <Badge tone="brand">{jokerPlayerIds.length}</Badge>}
            {showJokers ? <ChevronUp size={20} className="text-zinc-400" /> : <ChevronDown size={20} className="text-zinc-400" />}
          </button>
          <AnimatePresence>
            {showJokers && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="px-4 pb-4">
                  {combinedSquad.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectablePlayerIds.map(pid => {
                        const player = combinedSquad.find(p => p.id === pid);
                        if (!player) return null;
                        const isJoker = jokerPlayerIds.includes(player.id);
                        return (
                          <button
                            key={player.id}
                            type="button"
                            aria-pressed={isJoker}
                            onClick={() => toggleJoker(player.id)}
                            className={`${chipBase} ${
                              isJoker
                                ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:border-indigo-300'
                            }`}
                          >
                            {player.name}
                            {positionTag(player, isJoker)}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-500">Inga spelare i truppen än.</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Timer */}
        <Card padded={false}>
          <button
            type="button"
            onClick={() => setShowTimerSettings(!showTimerSettings)}
            aria-expanded={showTimerSettings}
            className="w-full flex items-center gap-3 p-4 text-left cursor-pointer"
          >
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${showTimer ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'}`}>
              <Clock size={20} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold">Timer</span>
              <span className="block text-sm text-zinc-500 dark:text-zinc-400">
                {showTimer ? `${defaultMinutes}:${defaultSeconds.toString().padStart(2, '0')} per omgång` : 'Av'}
              </span>
            </span>
            {showTimerSettings ? <ChevronUp size={20} className="text-zinc-400" /> : <ChevronDown size={20} className="text-zinc-400" />}
          </button>
          <AnimatePresence>
            {showTimerSettings && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="px-3 pb-4 space-y-3">
                  <SwitchRow label="Visa timer" description="Timern syns i poängräkningen" checked={showTimer} onChange={() => setShowTimer(!showTimer)} />
                  {showTimer && (
                    <div className="grid grid-cols-2 gap-3 px-1">
                      <Stepper label="Minuter" value={String(defaultMinutes)} onMinus={() => adjustDefaultTime('min', -1)} onPlus={() => adjustDefaultTime('min', 1)} />
                      <Stepper label="Sekunder" value={defaultSeconds.toString().padStart(2, '0')} onMinus={() => adjustDefaultTime('sec', -10)} onPlus={() => adjustDefaultTime('sec', 10)} />
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Poäng och sortering */}
        <Card padded={false}>
          <button
            type="button"
            onClick={() => setShowPointsSettings(!showPointsSettings)}
            aria-expanded={showPointsSettings}
            className="w-full flex items-center gap-3 p-4 text-left cursor-pointer"
          >
            <span className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300 flex items-center justify-center shrink-0">
              <Trophy size={20} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold">Poäng och sortering</span>
              <span className="block text-sm text-zinc-500 dark:text-zinc-400">
                {pointsConfig.first}–{pointsConfig.second}–{pointsConfig.third} poäng · {sortByScore ? 'sorteras efter poäng' : 'fast ordning'}
              </span>
            </span>
            {showPointsSettings ? <ChevronUp size={20} className="text-zinc-400" /> : <ChevronDown size={20} className="text-zinc-400" />}
          </button>
          <AnimatePresence>
            {showPointsSettings && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="px-3 pb-4 space-y-3">
                  <SwitchRow label="Sortera lagen efter poäng" description="Ledande lag hamnar överst" checked={sortByScore} onChange={() => setSortByScore(!sortByScore)} />
                  <p className="px-1 text-sm font-semibold text-zinc-600 dark:text-zinc-300">Poäng till poängligan</p>
                  <div className="grid grid-cols-3 gap-2 px-1">
                    <Stepper label="Etta" value={String(pointsConfig.first)} onMinus={() => setPointsConfig(prev => ({ ...prev, first: Math.max(0, prev.first - 1) }))} onPlus={() => setPointsConfig(prev => ({ ...prev, first: prev.first + 1 }))} />
                    <Stepper label="Tvåa" value={String(pointsConfig.second)} onMinus={() => setPointsConfig(prev => ({ ...prev, second: Math.max(0, prev.second - 1) }))} onPlus={() => setPointsConfig(prev => ({ ...prev, second: prev.second + 1 }))} />
                    <Stepper label="Trea" value={String(pointsConfig.third)} onMinus={() => setPointsConfig(prev => ({ ...prev, third: Math.max(0, prev.third - 1) }))} onPlus={() => setPointsConfig(prev => ({ ...prev, third: prev.third + 1 }))} />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Knappar längst ner (ligger kvar när man skrollar) */}
        <div className="sticky bottom-0 -mx-4 sm:mx-0 px-4 sm:px-0 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-zinc-50 via-zinc-50/95 to-transparent dark:from-zinc-950 dark:via-zinc-950/95 z-20">
          <div className="flex gap-2">
            {!initialGame && (
              <Button type="submit" variant="secondary" size="lg" icon={<Save size={18} />} onClick={() => { submitShouldStartRef.current = false; }}>
                Spara
              </Button>
            )}
            <Button
              type="submit"
              size="lg"
              block
              icon={initialGame ? <Check size={20} strokeWidth={3} /> : <Play size={18} fill="currentColor" />}
              onClick={() => { submitShouldStartRef.current = !initialGame; }}
            >
              {initialGame ? 'Spara ändringar' : 'Starta tävlingsmomentet'}
            </Button>
          </div>
        </div>
      </form>

      {/* Ark: välj närvarande (fristående moment) */}
      <Sheet
        open={showStandaloneAttendance}
        onClose={() => setShowStandaloneAttendance(false)}
        title="Välj närvarande spelare"
        footer={<Button block onClick={() => setShowStandaloneAttendance(false)}>Klar ({standaloneAttendance.length})</Button>}
      >
        <div className="flex flex-wrap gap-2 px-2 pb-2">
          {sortPlayersByPosition(combinedSquad.map(p => p.id), combinedSquad).map(pid => {
            const player = combinedSquad.find(p => p.id === pid);
            if (!player) return null;
            const present = standaloneAttendance.includes(player.id);
            return (
              <button
                key={player.id}
                type="button"
                aria-pressed={present}
                onClick={() => toggleStandaloneAttendance(player.id)}
                className={`${chipBase} ${
                  present
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                    : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:border-indigo-300'
                }`}
              >
                {present && <Check size={14} strokeWidth={3} />}
                {player.name}
                {player.position && <span className="text-[11px] opacity-70">{player.position}</span>}
              </button>
            );
          })}
        </div>
      </Sheet>

      {/* Ark: klistra in närvarolista */}
      <Sheet
        open={showAttendanceInput}
        onClose={() => setShowAttendanceInput(false)}
        title="Klistra in en närvarolista"
        footer={
          <Button block icon={<Wand2 size={18} />} onClick={generateTeamsFromAttendance} disabled={!attendanceText.trim()}>
            Dela in i {teams.length} lag
          </Button>
        }
      >
        <div className="px-2 pb-2 space-y-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Klistra in namnen på dem som är på plats, till exempel från kallelsen. Namnen matchas mot truppen och fördelas i lagen.
          </p>
          <Button
            variant="secondary"
            icon={setupClipboardStatus === 'pasted' ? <ClipboardCheck size={18} className="text-emerald-600" /> : <ClipboardPaste size={18} />}
            onClick={handleSetupPasteClipboard}
          >
            {setupClipboardStatus === 'pasted' ? 'Inklistrat' : 'Klistra in från urklipp'}
          </Button>
          <div className="relative">
            <TextArea
              ref={attendanceTextareaRef}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={attendanceText}
              onChange={(e) => setAttendanceText(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData?.getData('text');
                if (pasted && !attendanceText) setAttendanceText(pasted);
              }}
              placeholder="Ett namn per rad, eller separerade med kommatecken"
              className="w-full h-40 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none text-base resize-none"
            />
            {attendanceText && (
              <Button
                size="sm"
                variant="secondary"
                className="absolute top-2 right-2"
                onClick={() => { setAttendanceText(''); attendanceTextareaRef.current?.focus(); }}
              >
                Rensa
              </Button>
            )}
          </div>
          {setupClipboardStatus === 'failed' && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Kunde inte läsa urklippet. Tryck i rutan och välj Klistra in.
            </p>
          )}
        </div>
      </Sheet>

      {/* Ark: kopiera lagindelning */}
      <Sheet open={showCopyFromDropdown} onClose={() => setShowCopyFromDropdown(false)} title="Kopiera lagindelning">
        <div className="flex flex-col gap-0.5">
          {copyableExercisesForSetup.map(ex => {
            const totalPlayers = ex.teams.reduce((sum, t) => sum + (t.playerIds?.length || 0), 0);
            return (
              <MenuItem
                key={ex.id}
                icon={<Copy size={18} />}
                label={ex.name}
                description={`${new Date(ex.date).toLocaleDateString('sv-SE')} · ${ex.teams.length} lag`}
                trailing={<Badge tone="brand">{totalPlayers} spelare</Badge>}
                onClick={() => {
                  handleCopyFromExercise(ex);
                  setShowCopyFromDropdown(false);
                }}
              />
            );
          })}
        </div>
      </Sheet>

      {/* Ark: lägg till gäst eller spelare ur truppen */}
      {onAddGuest && (
        <Sheet
          open={showGuestInput}
          onClose={() => { setShowGuestInput(false); setGuestName(''); setGuestPosition(''); }}
          title="Lägg till spelare"
        >
          <div className="px-2 pb-2 space-y-5">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">Ny gästspelare</p>
              <TextInput
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Namn"
                aria-label="Gästspelarens namn"
                className={inputClass}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitGuest();
                  }
                }}
              />
              <select
                value={guestPosition}
                onChange={(e) => setGuestPosition(e.target.value)}
                aria-label="Position"
                className={inputClass + ' cursor-pointer'}
              >
                <option value="">Position (valfritt)</option>
                <option value="MV">Målvakt (MV)</option>
                <option value="MB">Mittback (MB)</option>
                <option value="YB">Ytterback (YB)</option>
                <option value="MF">Mittfältare (MF)</option>
                <option value="YMF">Yttermittfältare (YMF)</option>
                <option value="FW">Forward (FW)</option>
              </select>
              <Button block icon={<UserPlus size={18} />} onClick={submitGuest} disabled={!guestName.trim()}>
                Lägg till gäst
              </Button>
            </div>
            {absentSquadPlayers.length > 0 && (
              <div className="space-y-2 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">Från truppen (inte närvarande)</p>
                <div className="flex flex-col gap-0.5 -mx-2">
                  {absentSquadPlayers.map(p => (
                    <MenuItem
                      key={p.id}
                      icon={<Plus size={18} />}
                      label={p.name}
                      description={p.role === 'leader' ? 'Ledare' : p.position || undefined}
                      onClick={() => addAbsentToAttendance(p.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </Sheet>
      )}
    </motion.div>
  );
}

const inputClass = 'w-full h-12 px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 text-base';

const SwitchRow = ({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: () => void }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={onChange}
    className="w-full flex items-center gap-3 px-1 py-3 text-left cursor-pointer"
  >
    <span className="flex-1 min-w-0">
      <span className="block text-sm font-semibold text-zinc-900 dark:text-white">{label}</span>
      {description && <span className="block text-sm text-zinc-500 dark:text-zinc-400">{description}</span>}
    </span>
    <span className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${checked ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
      <span className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </span>
  </button>
);

const Stepper = ({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) => (
  <div className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
    <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
    <div className="flex items-center gap-1">
      <button type="button" aria-label={`Minska ${label.toLowerCase()}`} onClick={onMinus} className="w-10 h-10 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center active:scale-95 cursor-pointer">
        <Minus size={16} />
      </button>
      <span className="text-xl font-bold min-w-[2.5ch] text-center tabular-nums">{value}</span>
      <button type="button" aria-label={`Öka ${label.toLowerCase()}`} onClick={onPlus} className="w-10 h-10 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center active:scale-95 cursor-pointer">
        <Plus size={16} />
      </button>
    </div>
  </div>
);
