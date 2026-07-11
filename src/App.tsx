import React, { useState, useEffect, useRef } from 'react';
import { RotateCcw, Trophy, ArrowLeft, Check, Sun, Moon, Timer as TimerIcon, Edit2, Zap, Rocket, Users, LayoutDashboard, Unlock, LogIn, LogOut, User as UserIcon, Mail, ShieldCheck, Cloud, Layout, Upload, Globe, AlertTriangle, Calendar, Settings, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SquadPlayer, Exercise, Team, PointsConfig, Period, PeriodStandings, Lineup, TrainingSession, TrainingSettings, CoachData, BankExercise, SessionMoment } from './types';
import { auth, signInWithGoogle, db, handleFirestoreError, OperationType } from './lib/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { calculateLeaderboard } from './lib/leaderboardUtils';

import GameSetup from './components/GameSetup';
import PlayerCard from './components/PlayerCard';
import Timer from './components/Timer';
import SquadManager from './components/SquadManager';
import Leaderboard from './components/Leaderboard';
import LineupBuilder from './components/LineupBuilder';

import TeamPage from './components/TeamPage';
import TrainingManager from './components/TrainingManager';
import SessionEditor from './components/SessionEditor';
import TeamOverviewModal from './components/TeamOverviewModal';
import { CachedImage } from './components/CachedImage';

type View = 'training' | 'setup' | 'exercise' | 'squad' | 'leaderboard' | 'profile' | 'lineup' | 'teampage';

const INITIAL_DATA: CoachData = {
  squad: [],
  exercises: [],
  sessions: [],
  deletedSessions: [],
  lineups: [],
  activeLineupId: null,
  periods: [],
  currentPeriodId: null,
  activeExerciseId: null,
  teamUrl: '',
  adminUrl: '',
  seriesUrl: '',
  customFormations: [],
  pinnedFormationIds: ['4-2-3-1', '4-4-2', '4-3-3'],
  trainingSettings: {
    defaultStartTime: '18:00',
    defaultDuration: 90
  },
  exerciseBank: [],
  exerciseBankCategories: []
};

const getSessionCategory = (session: TrainingSession): 'match' | 'training' | 'other' => {
  const title = (session.title || '').trim().toLowerCase();
  if (!title) {
    return 'training';
  }
  if (
    title.includes('match') || 
    title.includes('vs') || 
    title.includes('mot') || 
    title.includes('seriematch') || 
    title.includes('cup') || 
    title.includes('kval') || 
    title.includes('träningsmatch')
  ) {
    return 'match';
  }
  if (
    title.includes('träning') || 
    title.includes('pass') || 
    title.includes('fys') || 
    title.includes('praktik') || 
    title.includes('istid') || 
    title.includes('poolspel')
  ) {
    return 'training';
  }
  return 'other';
};

const isQuotaError = (error: any): boolean => {
  if (!error) return false;
  const errMsg = (error.message || String(error)).toLowerCase();
  return (
    error.code === 'resource-exhausted' ||
    errMsg.includes('quota') ||
    errMsg.includes('exhausted') ||
    errMsg.includes('billing')
  );
};

const deduplicateById = <T extends { id: string }>(arr: T[] | undefined | null): T[] => {
  if (!arr || !Array.isArray(arr)) return [];
  const seen = new Set<string>();
  return arr.filter(item => {
    if (!item || !item.id) return false;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [sharedLeaderboardId, setSharedLeaderboardId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('share');
  });

  const [data, setData] = useState<CoachData>(INITIAL_DATA);
  const { 
    squad = [], 
    exercises = [], 
    sessions = [], 
    deletedSessions = [], 
    lineups = [], 
    activeLineupId, 
    periods = [], 
    currentPeriodId, 
    activeExerciseId, 
    teamUrl = '', 
    adminUrl = '',
    seriesUrl = '',
    customFormations = [], 
    pinnedFormationIds = ['4-2-3-1', '4-4-2', '4-3-3'],
    trainingSettings = INITIAL_DATA.trainingSettings,
    exerciseBank = [],
    exerciseBankCategories = []
  } = (data || INITIAL_DATA);
  const [sessionActionCount, setSessionActionCount] = useState(0);
  const [linkToMomentId, setLinkToMomentId] = useState<string | null>(null);
  const [prefilledName, setPrefilledName] = useState<string | null>(null);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('score_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch (e) {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  
  const [view, _setView] = useState<View>(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('view');
    const shareId = params.get('share');
    
    // If sharing, priority is leaderboard (already handled by useEffect but setting here for initial sync too)
    if (shareId) return 'leaderboard';
    
    if (v === 'squad' || v === 'training' || v === 'leaderboard' || v === 'profile' || v === 'lineup' || v === 'teampage') {
      return v as View;
    }
    return 'training';
  });

  const clearBrowserUndoHistory = () => {
    // 1. Aggressively blur any active elements (especially inputs / textareas) 
    // BEFORE they get unmounted to completely prevent iOS "Undo/Shake to Undo" ghost states.
    try {
      const activeEl = document.activeElement as HTMLElement;
      if (activeEl && typeof activeEl.blur === 'function') {
        activeEl.blur();
      }
    } catch (e) {
      console.error("Error blurring:", e);
    }

    try {
      // 2. Disable, make read-only, and set type to 'hidden' to force Safari WebKit's input responder chain to drop them.
      const inputs = document.querySelectorAll('input, textarea');
      inputs.forEach((el: any) => {
        try {
          el.blur();
          el.disabled = true;
          el.readOnly = true;
          if (el.tagName === 'INPUT') {
            el.setAttribute('type', 'hidden');
          }
        } catch (err) {}
      });
    } catch (e) {
      console.error("Error cleaning up inputs:", e);
    }

    // 3. Clear any active selection ranges to prevent iOS selection shake-to-undo
    try {
      window.getSelection()?.removeAllRanges();
    } catch (e) {}

    // 4. Synchronously toggle document.designMode 'on' and then immediately 'off'.
    // This is a highly effective, silent WebKit/Blink workaround that programmatically
    // forces Safari to discard its native document-level UndoManager stack completely.
    try {
      document.designMode = 'on';
      document.designMode = 'off';
    } catch (e) {
      console.error("Error toggling designMode:", e);
    }
  };

  const setView = (newView: View | ((prev: View) => View)) => {
    clearBrowserUndoHistory();
    // Delay the actual state update slightly (120ms) to allow Safari's input responder chain,
    // active event loop, and UndoManager to process the blurs, disabling, and designMode
    // toggle BEFORE the inputs are fully unmounted from the DOM.
    setTimeout(() => {
      _setView(newView);
    }, 120);
  };
  const [trainingTab, setTrainingTab] = useState<'completed' | 'exercises' | 'calendar_view'>('calendar_view');
  const [openTrainingSettings, setOpenTrainingSettings] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionEditorTab, setSessionEditorTab] = useState<'schema' | 'attendance'>('schema');
  const [sessionMode, setSessionMode] = useState<'plan' | 'live'>('plan');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [finishTargetPeriodId, setFinishTargetPeriodId] = useState<string | null>(null);
  const [isEditingActiveExercise, setIsEditingActiveExercise] = useState(false);
  const [editReturnView, setEditReturnView] = useState<View | null>(null);
  const [previousActiveExerciseId, setPreviousActiveExerciseId] = useState<string | null | undefined>(undefined);
  const [showTeamOverview, setShowTeamOverview] = useState(false);
  const lastSyncedAtRef = useRef<number>(0);
  const [isInitialSyncDone, setIsInitialSyncDone] = useState(false);
  const [hasPulledFromCloud, setHasPulledFromCloud] = useState(false);
  const sessionActionCountRef = useRef(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Sync sessionActionCount to its ref for use in onSnapshot
  useEffect(() => {
    sessionActionCountRef.current = sessionActionCount;
  }, [sessionActionCount]);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const sessionIdRef = useRef<string>(Math.random().toString(36).substring(7));
  const syncUserIdRef = useRef<string | null>(null);
  const lastCloudDataRef = useRef<CoachData | null>(null);
  const notifiedMomentsRef = useRef<Set<string>>(new Set());
  const lastSharedLeaderboardsRef = useRef<Record<string, string>>({});

  // Notification Scheduler for Training Moments & iOS Shake to Undo Protection
  useEffect(() => {
    // Prevent iOS "Shake to Undo" dialog
    const handleUndo = (e: any) => {
      // iOS triggers 'beforeinput' with inputType 'historyUndo' or 'historyRedo' when shaking
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Check if we are on iOS to bypass the native text editing UndoManager
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

      if (isIOS) {
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
          const type = target.type || 'text';
          const isTextInput = ['text', 'search', 'url', 'tel', 'email', 'password'].includes(type) || target.tagName === 'TEXTAREA';
          if (!isTextInput) return;

          // List of input types we handle manually to bypass native WebKit UndoManager insertion
          const handledInputTypes = [
            'insertText',
            'insertFromPaste',
            'deleteContentBackward',
            'deleteContentForward'
          ];

          if (handledInputTypes.includes(e.inputType)) {
            e.preventDefault();
            e.stopPropagation();

            const start = target.selectionStart ?? 0;
            const end = target.selectionEnd ?? 0;
            const value = target.value;
            let newValue = value;
            let newSelectionStart = start;
            let newSelectionEnd = start;

            if (e.inputType === 'insertText') {
              const textToInsert = e.data || '';
              newValue = value.slice(0, start) + textToInsert + value.slice(end);
              newSelectionStart = start + textToInsert.length;
              newSelectionEnd = newSelectionStart;
            } else if (e.inputType === 'insertFromPaste') {
              const textToInsert = e.dataTransfer?.getData('text') || '';
              newValue = value.slice(0, start) + textToInsert + value.slice(end);
              newSelectionStart = start + textToInsert.length;
              newSelectionEnd = newSelectionStart;
            } else if (e.inputType === 'deleteContentBackward') {
              if (start === end) {
                if (start > 0) {
                  newValue = value.slice(0, start - 1) + value.slice(end);
                  newSelectionStart = start - 1;
                  newSelectionEnd = start - 1;
                }
              } else {
                newValue = value.slice(0, start) + value.slice(end);
                newSelectionStart = start;
                newSelectionEnd = start;
              }
            } else if (e.inputType === 'deleteContentForward') {
              if (start === end) {
                if (start < value.length) {
                  newValue = value.slice(0, start) + value.slice(start + 1);
                  newSelectionStart = start;
                  newSelectionEnd = start;
                }
              } else {
                newValue = value.slice(0, start) + value.slice(end);
                newSelectionStart = start;
                newSelectionEnd = start;
              }
            }

            // Programmatically update native property value to trigger React's synthetic input/change flow
            const prototype = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
            const nativeValueSetter = descriptor?.set;
            
            if (nativeValueSetter) {
              nativeValueSetter.call(target, newValue);
              const event = new Event('input', { bubbles: true, cancelable: true });
              target.dispatchEvent(event);
            } else {
              target.value = newValue;
            }

            // Restore selection range/cursor position
            try {
              target.setSelectionRange(newSelectionStart, newSelectionEnd);
            } catch (err) {}
          }
        }
      }
    };

    const preventDefault = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Clean up inputs on state changes to prevent unmounting inputs from leaving trailing undo histories
    clearBrowserUndoHistory();

    // Focus cleanup on first interaction
    let cleanedUpInteraction = false;
    const handleFirstInteraction = () => {
      if (!cleanedUpInteraction) {
        cleanedUpInteraction = true;
        try {
          const activeEl = document.activeElement as HTMLElement;
          if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
            activeEl.blur();
          }
        } catch (e) {}
        window.removeEventListener('touchstart', handleFirstInteraction, { capture: true });
        window.removeEventListener('mousedown', handleFirstInteraction, { capture: true });
      }
    };

    // Extra selection-suppressing event listeners during live exercise views
    const clearSelection = () => {
      try {
        window.getSelection()?.removeAllRanges();
      } catch (e) {}
    };

    if (view === 'exercise') {
      try {
        const activeEl = document.activeElement as HTMLElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
          activeEl.blur();
        }
      } catch (e) {}

      window.addEventListener('touchstart', handleFirstInteraction, { capture: true, passive: true });
      window.addEventListener('mousedown', handleFirstInteraction, { capture: true, passive: true });

      // Aggressively clear selection range on any touches/taps to prevent iOS from keeping selection undo actions
      window.addEventListener('touchend', clearSelection, { passive: true });
      window.addEventListener('touchcancel', clearSelection, { passive: true });
      window.addEventListener('mouseup', clearSelection, { passive: true });
      document.addEventListener('selectionchange', clearSelection, { passive: true });
    }

    // Capture phase listeners for undo/redo
    window.addEventListener('beforeinput', handleUndo, true);
    document.addEventListener('undo', preventDefault, true);
    document.addEventListener('redo', preventDefault, true);

    return () => {
      // Clear inputs and flush native UndoManager stack again upon unmounting or state transition
      clearBrowserUndoHistory();

      window.removeEventListener('beforeinput', handleUndo, true);
      document.removeEventListener('undo', preventDefault, true);
      document.removeEventListener('redo', preventDefault, true);
      window.removeEventListener('touchstart', handleFirstInteraction, { capture: true });
      window.removeEventListener('mousedown', handleFirstInteraction, { capture: true });
      
      window.removeEventListener('touchend', clearSelection);
      window.removeEventListener('touchcancel', clearSelection);
      window.removeEventListener('mouseup', clearSelection);
      document.removeEventListener('selectionchange', clearSelection);
    };
  }, [view, showTeamOverview, openTrainingSettings, activeSessionId]);

  useEffect(() => {
    const checkNotifications = () => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;

      const now = Date.now();
      
      sessions.forEach(session => {
        if (session.isStarted && session.actualStartTime && !session.isCompleted) {
          let cumulativeMinutes = 0;
          session.moments.forEach((moment) => {
            // Combine session date with start time string (HH:mm) to get absolute planned start
            const [h, m] = (session.startTime || "00:00").split(':').map(Number);
            const momentPlannedStartBase = new Date(session.date);
            momentPlannedStartBase.setHours(h, m, 0, 0);
            
            const momentDuration = typeof moment.duration === 'string' ? parseInt(moment.duration, 10) : moment.duration;
            const scheduledStartTime = momentPlannedStartBase.getTime() + (cumulativeMinutes * 60000);
            
            // User wants notice exactly 1 minute BEFORE start
            const notificationTargetTime = scheduledStartTime - 60000;
            const notificationKey = `${session.id}-${moment.id}-${session.actualStartTime}`;
            
            // Trigger if:
            // 1. Current time is at or past notification target time
            // 2. Notification target time was NOT before we manually started the session
            // 3. We haven't notified for this specific session run yet
            if (now >= notificationTargetTime && 
                notificationTargetTime >= session.actualStartTime! && 
                !notifiedMomentsRef.current.has(notificationKey)) {
              
              // Safety window: don't notify if the moment's start time was more than 10 minutes ago
              if (now < scheduledStartTime + 10 * 60000 && document.visibilityState !== 'visible') {
                new Notification(`Om 1 minut: ${moment.name || 'Nästa moment'}`, {
                  body: `Träning: ${session.title}\nLängd: ${momentDuration} min`,
                  icon: '/favicon.ico',
                  tag: `moment-${moment.id}`,
                  silent: false
                });
              }
              notifiedMomentsRef.current.add(notificationKey);
            }
            
            cumulativeMinutes += (momentDuration || 0);
          });
        }
      });
    };

    const intervalId = window.setInterval(checkNotifications, 5000); // Check every 5 seconds
    return () => window.clearInterval(intervalId);
  }, [sessions]);

  // Initial load from localStorage for quick bootstrap
  useEffect(() => {
    if (isAuthReady && !isInitialSyncDone) {
      console.log("App: Loading cached data from localStorage for quick bootstrap");
      const savedSquad = localStorage.getItem('football_squad');
      const savedExercises = localStorage.getItem('football_exercises');
      const savedSessions = localStorage.getItem('football_sessions');
      const savedDeletedSessions = localStorage.getItem('football_deleted_sessions');
      const savedLineups = localStorage.getItem('football_lineups');
      const savedActiveLineupId = localStorage.getItem('active_lineup_id');
      const savedPeriods = localStorage.getItem('football_periods');
      const savedCurrentPeriodId = localStorage.getItem('current_period_id');
      const savedActiveExerciseId = localStorage.getItem('active_exercise_id');
      const savedTeamUrl = localStorage.getItem('team_url');
      const savedAdminUrl = localStorage.getItem('admin_url');
      const savedSeriesUrl = localStorage.getItem('series_url');
      const savedCustomFormations = localStorage.getItem('custom_formations');
      const savedSettings = localStorage.getItem('training_settings');
      const savedExerciseBank = localStorage.getItem('football_exercise_bank');
      const savedExerciseBankCategories = localStorage.getItem('football_exercise_bank_categories');

      // Robust Deduplication to prevent duplicate keys across components
      const rawSquad = savedSquad ? JSON.parse(savedSquad) : [];
      const deduplicatedSquad = Array.from(new Map(rawSquad.map((p: any) => [p.id, p])).values()) as SquadPlayer[];

      const newState: CoachData = {
        squad: deduplicatedSquad,
        exercises: savedExercises ? deduplicateById(JSON.parse(savedExercises)) : [],
        sessions: savedSessions ? deduplicateById(JSON.parse(savedSessions)) : [],
        deletedSessions: savedDeletedSessions ? deduplicateById(JSON.parse(savedDeletedSessions)) : [],
        lineups: savedLineups ? deduplicateById(JSON.parse(savedLineups)) : [],
        activeLineupId: savedActiveLineupId || null,
        periods: savedPeriods ? deduplicateById(JSON.parse(savedPeriods)) : [],
        currentPeriodId: savedCurrentPeriodId || null,
        activeExerciseId: savedActiveExerciseId || null,
        teamUrl: savedTeamUrl || '',
        adminUrl: savedAdminUrl || '',
        seriesUrl: savedSeriesUrl || '',
        customFormations: savedCustomFormations ? deduplicateById(JSON.parse(savedCustomFormations)) : [],
        pinnedFormationIds: localStorage.getItem('pinned_formations') ? JSON.parse(localStorage.getItem('pinned_formations')!) : ['4-2-3-1', '4-4-2', '4-3-3'],
        trainingSettings: savedSettings ? JSON.parse(savedSettings) : INITIAL_DATA.trainingSettings,
        exerciseBank: savedExerciseBank ? deduplicateById(JSON.parse(savedExerciseBank)) : [],
        exerciseBankCategories: savedExerciseBankCategories ? JSON.parse(savedExerciseBankCategories) : []
      };

      setData(newState);
      
      if (!user) {
        // For guests, we are fully loaded right away
        setIsInitialSyncDone(true);
      } else {
        // For logged-in users, set a fallback timeout to resolve initial sync immediately
        // if Firestore is slow/offline. When its snapshot resolves, it merges properly.
        const timer = setTimeout(() => {
          console.log("App: Firestore snapshot timeout reached, proceeding with cached data");
          setIsInitialSyncDone(true);
        }, 1200);
        return () => clearTimeout(timer);
      }
    }
  }, [isAuthReady, user, isInitialSyncDone]);

  // Sync to localStorage IMMEDIATELY for persistence
  useEffect(() => {
    if (isAuthReady && isInitialSyncDone) {
      localStorage.setItem('football_squad', JSON.stringify(squad));
      localStorage.setItem('football_exercises', JSON.stringify(exercises));
      localStorage.setItem('football_sessions', JSON.stringify(sessions));
      localStorage.setItem('football_deleted_sessions', JSON.stringify(deletedSessions));
      localStorage.setItem('football_lineups', JSON.stringify(lineups));
      localStorage.setItem('active_lineup_id', activeLineupId || '');
      localStorage.setItem('football_periods', JSON.stringify(periods));
      localStorage.setItem('current_period_id', currentPeriodId || '');
      localStorage.setItem('active_exercise_id', activeExerciseId || '');
      localStorage.setItem('team_url', teamUrl || '');
      localStorage.setItem('admin_url', adminUrl || '');
      localStorage.setItem('series_url', seriesUrl || '');
      localStorage.setItem('custom_formations', JSON.stringify(customFormations));
      localStorage.setItem('training_settings', JSON.stringify(trainingSettings));
      localStorage.setItem('pinned_formations', JSON.stringify(pinnedFormationIds));
      localStorage.setItem('football_exercise_bank', JSON.stringify(exerciseBank));
      localStorage.setItem('football_exercise_bank_categories', JSON.stringify(exerciseBankCategories));
      if (sessionActionCount > 0) {
        localStorage.setItem('last_local_sync_at', Date.now().toString());
      }
      localStorage.setItem('last_local_user_id', user ? user.uid : 'guest');
    }
  }, [squad, exercises, sessions, deletedSessions, lineups, activeLineupId, periods, currentPeriodId, activeExerciseId, teamUrl, customFormations, trainingSettings, pinnedFormationIds, exerciseBank, exerciseBankCategories, isAuthReady, isInitialSyncDone]);

  // Clear data on user change
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (newUser) => {
      if (newUser?.uid !== user?.uid) {
        console.log("App: User changed, resetting states and action count");
        setData(INITIAL_DATA);
        setSessionActionCount(0);
        setIsInitialSyncDone(false);
        setHasPulledFromCloud(false);
        lastSyncedAtRef.current = 0;
        syncUserIdRef.current = null;
        lastCloudDataRef.current = null;
      }
      setUser(newUser);
      setIsAuthReady(true);
      if (!newUser) {
        setHasPulledFromCloud(true);
      }
    });
    return () => unsubscribe();
  }, [user?.uid]);

  // Unified Cloud Data Hook
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (sessionActionCount > 0 || isSyncing) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [sessionActionCount, isSyncing]);

  // Helper to fetch all segmented cloud docs to merge into local state
  const pullLatestData = async () => {
    if (!user) return;
    try {
      console.log("App: Manually pulling segmented data from cloud...");
      setIsSyncing(true);
      const docSquadRef = doc(db, 'users', user.uid, 'data', 'squad');
      const docSessionsRef = doc(db, 'users', user.uid, 'data', 'sessions');
      const docExercisesRef = doc(db, 'users', user.uid, 'data', 'exercises');
      const docLineupsRef = doc(db, 'users', user.uid, 'data', 'lineups');
      const docPeriodsRef = doc(db, 'users', user.uid, 'data', 'periods');
      const docSettingsRef = doc(db, 'users', user.uid, 'data', 'settings');

      const [squadSnap, sessionsSnap, exercisesSnap, lineupsSnap, periodsSnap, settingsSnap] = await Promise.all([
        getDoc(docSquadRef),
        getDoc(docSessionsRef),
        getDoc(docExercisesRef),
        getDoc(docLineupsRef),
        getDoc(docPeriodsRef),
        getDoc(docSettingsRef),
      ]);

      const updatedState: CoachData = {
        squad: squadSnap.exists() ? deduplicateById(squadSnap.data().squad || []) : [],
        sessions: sessionsSnap.exists() ? deduplicateById(sessionsSnap.data().sessions || []) : [],
        deletedSessions: sessionsSnap.exists() ? deduplicateById(sessionsSnap.data().deletedSessions || []) : [],
        exercises: exercisesSnap.exists() ? deduplicateById(exercisesSnap.data().exercises || []) : [],
        exerciseBank: exercisesSnap.exists() ? deduplicateById(exercisesSnap.data().exerciseBank || []) : [],
        exerciseBankCategories: exercisesSnap.exists() ? (exercisesSnap.data().exerciseBankCategories || []) : [],
        lineups: lineupsSnap.exists() ? deduplicateById(lineupsSnap.data().lineups || []) : [],
        activeLineupId: lineupsSnap.exists() ? (lineupsSnap.data().activeLineupId || null) : null,
        periods: periodsSnap.exists() ? deduplicateById(periodsSnap.data().periods || []) : [],
        currentPeriodId: periodsSnap.exists() ? (periodsSnap.data().currentPeriodId || null) : null,
        teamUrl: settingsSnap.exists() ? (settingsSnap.data().teamUrl || '') : '',
        adminUrl: settingsSnap.exists() ? (settingsSnap.data().adminUrl || '') : '',
        seriesUrl: settingsSnap.exists() ? (settingsSnap.data().seriesUrl || '') : '',
        customFormations: settingsSnap.exists() ? (settingsSnap.data().customFormations || []) : [],
        pinnedFormationIds: settingsSnap.exists() ? (settingsSnap.data().pinnedFormationIds || ['4-2-3-1', '4-4-2', '4-3-3']) : ['4-2-3-1', '4-4-2', '4-3-3'],
        trainingSettings: settingsSnap.exists() ? (settingsSnap.data().trainingSettings || INITIAL_DATA.trainingSettings) : INITIAL_DATA.trainingSettings,
        activeExerciseId: settingsSnap.exists() ? (settingsSnap.data().activeExerciseId || null) : null,
      };

      setData(updatedState);
      lastCloudDataRef.current = updatedState;
      setSessionActionCount(0);
      setIsQuotaExceeded(false);
      setSyncError(null);
      console.log("App: Segmented manual sync successful!");
    } catch (err) {
      console.error("App: Segmented manual sync failed", err);
      if (isQuotaError(err)) {
        setIsQuotaExceeded(true);
      } else {
        setSyncError((err as Error)?.message || 'Kunde inte hämta data');
      }
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}/data/*`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Sync when tab gains focus (visibilitychange)
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && user && isInitialSyncDone && !isSyncing) {
        console.log("App: Tab focused, auto-refreshing non-realtime segments...");
        await pullLatestData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user, isInitialSyncDone, isSyncing]);

  // Segmented cloud data loader, migration and lineups real-time syncer
  useEffect(() => {
    if (!user || !isAuthReady) {
      return;
    }

    console.log("App: Initializing segmented cloud loader for", user.email);
    let isSubscribed = true;
    let unsubscribeLineups: (() => void) | null = null;

    const initializeAndLoad = async () => {
      try {
        const docSquadRef = doc(db, 'users', user.uid, 'data', 'squad');
        const docSessionsRef = doc(db, 'users', user.uid, 'data', 'sessions');
        const docExercisesRef = doc(db, 'users', user.uid, 'data', 'exercises');
        const docLineupsRef = doc(db, 'users', user.uid, 'data', 'lineups');
        const docPeriodsRef = doc(db, 'users', user.uid, 'data', 'periods');
        const docSettingsRef = doc(db, 'users', user.uid, 'data', 'settings');
        const docOldStateRef = doc(db, 'users', user.uid, 'config', 'state');

        // Step 1: Check if any segmented documents exist
        const [squadSnap, sessionsSnap, exercisesSnap, lineupsSnap, periodsSnap, settingsSnap] = await Promise.all([
          getDoc(docSquadRef),
          getDoc(docSessionsRef),
          getDoc(docExercisesRef),
          getDoc(docLineupsRef),
          getDoc(docPeriodsRef),
          getDoc(docSettingsRef),
        ]);

        const docsExist = squadSnap.exists() || sessionsSnap.exists() || exercisesSnap.exists() || lineupsSnap.exists() || periodsSnap.exists() || settingsSnap.exists();

        let loadedState: CoachData;

        if (!docsExist) {
          // Step 2: Segmented docs do not exist. Check for migration of old unified config/state doc
          console.log("App: Segmented data docs not found, checking for old state migration...");
          const oldStateSnap = await getDoc(docOldStateRef);

          if (oldStateSnap.exists()) {
            const oldData = oldStateSnap.data();
            console.log("App: Old unified state found. Migrating to segmented docs...");

            const squadData = { squad: oldData.squad || [] };
            const sessionsData = { sessions: oldData.sessions || [], deletedSessions: oldData.deletedSessions || [] };
            const exercisesData = { exercises: oldData.exercises || [], exerciseBank: oldData.exerciseBank || [], exerciseBankCategories: oldData.exerciseBankCategories || [] };
            const lineupsData = { lineups: oldData.lineups || [], activeLineupId: oldData.activeLineupId || null };
            const periodsData = { periods: oldData.periods || [], currentPeriodId: oldData.currentPeriodId || null };
            const settingsData = {
              teamUrl: oldData.teamUrl || '',
              adminUrl: oldData.adminUrl || '',
              seriesUrl: oldData.seriesUrl || '',
              customFormations: oldData.customFormations || [],
              pinnedFormationIds: oldData.pinnedFormationIds || ['4-2-3-1', '4-4-2', '4-3-3'],
              trainingSettings: oldData.trainingSettings || INITIAL_DATA.trainingSettings,
              activeExerciseId: oldData.activeExerciseId || null,
            };

            const now = Date.now();
            await Promise.all([
              setDoc(docSquadRef, { ...squadData, updatedAt: now, lastUpdatedBy: 'migration' }),
              setDoc(docSessionsRef, { ...sessionsData, updatedAt: now, lastUpdatedBy: 'migration' }),
              setDoc(docExercisesRef, { ...exercisesData, updatedAt: now, lastUpdatedBy: 'migration' }),
              setDoc(docLineupsRef, { ...lineupsData, updatedAt: now, lastUpdatedBy: 'migration' }),
              setDoc(docPeriodsRef, { ...periodsData, updatedAt: now, lastUpdatedBy: 'migration' }),
              setDoc(docSettingsRef, { ...settingsData, updatedAt: now, lastUpdatedBy: 'migration' }),
            ]);

            loadedState = {
              squad: squadData.squad,
              sessions: sessionsData.sessions,
              deletedSessions: sessionsData.deletedSessions,
              exercises: exercisesData.exercises,
              exerciseBank: exercisesData.exerciseBank,
              exerciseBankCategories: exercisesData.exerciseBankCategories,
              lineups: lineupsData.lineups,
              activeLineupId: lineupsData.activeLineupId,
              periods: periodsData.periods,
              currentPeriodId: periodsData.currentPeriodId,
              teamUrl: settingsData.teamUrl,
              adminUrl: settingsData.adminUrl,
              seriesUrl: settingsData.seriesUrl,
              customFormations: settingsData.customFormations,
              pinnedFormationIds: settingsData.pinnedFormationIds,
              trainingSettings: settingsData.trainingSettings,
              activeExerciseId: settingsData.activeExerciseId,
            };
            console.log("App: Migration completed successfully!");
          } else {
            // No old state either, check local storage recovery as a fallback
            console.log("App: No cloud state found. Attempting local storage recovery...");
            const savedSquad = localStorage.getItem('football_squad');
            const savedSessions = localStorage.getItem('football_sessions');
            const savedExercises = localStorage.getItem('football_exercises');
            const savedSettings = localStorage.getItem('training_settings');

            const hasSquad = savedSquad && JSON.parse(savedSquad).length > 0;
            const hasSessions = savedSessions && JSON.parse(savedSessions).length > 0;
            const hasExercises = savedExercises && JSON.parse(savedExercises).length > 0;
            const hasSettings = savedSettings && JSON.parse(savedSettings).icsUrl;

            if (hasSquad || hasSessions || hasExercises || hasSettings) {
              const savedLineups = localStorage.getItem('football_lineups');
              const savedActiveLineupId = localStorage.getItem('active_lineup_id');
              const savedPeriods = localStorage.getItem('football_periods');
              const savedCurrentPeriodId = localStorage.getItem('current_period_id');
              const savedActiveExerciseId = localStorage.getItem('active_exercise_id');
              const savedTeamUrl = localStorage.getItem('team_url');
              const savedAdminUrl = localStorage.getItem('admin_url');
              const savedSeriesUrl = localStorage.getItem('series_url');
              const savedDeletedSessions = localStorage.getItem('football_deleted_sessions');
              const savedExerciseBank = localStorage.getItem('football_exercise_bank');
              const savedExerciseBankCategories = localStorage.getItem('football_exercise_bank_categories');

              loadedState = {
                squad: savedSquad ? (Array.from(new Map(JSON.parse(savedSquad).map((p: any) => [p.id, p])).values()) as SquadPlayer[]) : [],
                exercises: savedExercises ? JSON.parse(savedExercises) : [],
                sessions: savedSessions ? JSON.parse(savedSessions) : [],
                deletedSessions: savedDeletedSessions ? JSON.parse(savedDeletedSessions) : [],
                lineups: savedLineups ? JSON.parse(savedLineups) : [],
                activeLineupId: savedActiveLineupId || null,
                periods: savedPeriods ? JSON.parse(savedPeriods) : [],
                currentPeriodId: savedCurrentPeriodId || null,
                activeExerciseId: savedActiveExerciseId || null,
                teamUrl: savedTeamUrl || '',
                adminUrl: savedAdminUrl || '',
                seriesUrl: savedSeriesUrl || '',
                customFormations: localStorage.getItem('custom_formations') ? JSON.parse(localStorage.getItem('custom_formations')!) : [],
                pinnedFormationIds: localStorage.getItem('pinned_formations') ? JSON.parse(localStorage.getItem('pinned_formations')!) : ['4-2-3-1', '4-4-2', '4-3-3'],
                trainingSettings: savedSettings ? JSON.parse(savedSettings) : INITIAL_DATA.trainingSettings,
                exerciseBank: savedExerciseBank ? JSON.parse(savedExerciseBank) : [],
                exerciseBankCategories: savedExerciseBankCategories ? JSON.parse(savedExerciseBankCategories) : []
              };
              setSessionActionCount(1); // Force save of local data to new cloud segments
            } else {
              loadedState = INITIAL_DATA;
            }
          }
        } else {
          // Segments exist. Check offline recovery vs segment update times.
          const localSyncAtStr = localStorage.getItem('last_local_sync_at');
          const localSyncAt = localSyncAtStr ? parseInt(localSyncAtStr, 10) : 0;
          const localUserId = localStorage.getItem('last_local_user_id');

          const cloudSyncAt = Math.max(
            squadSnap.exists() ? (squadSnap.data().updatedAt || 0) : 0,
            sessionsSnap.exists() ? (sessionsSnap.data().updatedAt || 0) : 0,
            exercisesSnap.exists() ? (exercisesSnap.data().updatedAt || 0) : 0,
            lineupsSnap.exists() ? (lineupsSnap.data().updatedAt || 0) : 0,
            periodsSnap.exists() ? (periodsSnap.data().updatedAt || 0) : 0,
            settingsSnap.exists() ? (settingsSnap.data().updatedAt || 0) : 0
          );

          const isOfflineDataNewer = localUserId === user.uid && localSyncAt > (cloudSyncAt + 2000);

          if (isOfflineDataNewer) {
            console.log("App: Offline recovery triggered. Local storage is newer.");
            const savedSquad = localStorage.getItem('football_squad');
            const savedSessions = localStorage.getItem('football_sessions');
            const savedDeletedSessions = localStorage.getItem('football_deleted_sessions');
            const savedExercises = localStorage.getItem('football_exercises');
            const savedSettings = localStorage.getItem('training_settings');

            if (savedSquad || savedSessions || savedExercises) {
              const savedLineups = localStorage.getItem('football_lineups');
              const savedActiveLineupId = localStorage.getItem('active_lineup_id');
              const savedPeriods = localStorage.getItem('football_periods');
              const savedCurrentPeriodId = localStorage.getItem('current_period_id');
              const savedActiveExerciseId = localStorage.getItem('active_exercise_id');
              const savedTeamUrl = localStorage.getItem('team_url');
              const savedAdminUrl = localStorage.getItem('admin_url');
              const savedSeriesUrl = localStorage.getItem('series_url');

              loadedState = {
                squad: savedSquad ? (Array.from(new Map(JSON.parse(savedSquad).map((p: any) => [p.id, p])).values()) as SquadPlayer[]) : [],
                exercises: savedExercises ? deduplicateById(JSON.parse(savedExercises)) : [],
                sessions: savedSessions ? deduplicateById(JSON.parse(savedSessions)) : [],
                deletedSessions: savedDeletedSessions ? deduplicateById(JSON.parse(savedDeletedSessions)) : [],
                lineups: savedLineups ? deduplicateById(JSON.parse(savedLineups)) : [],
                activeLineupId: savedActiveLineupId || null,
                periods: savedPeriods ? deduplicateById(JSON.parse(savedPeriods)) : [],
                currentPeriodId: savedCurrentPeriodId || null,
                activeExerciseId: savedActiveExerciseId || null,
                teamUrl: savedTeamUrl || '',
                adminUrl: savedAdminUrl || '',
                seriesUrl: savedSeriesUrl || '',
                customFormations: localStorage.getItem('custom_formations') ? deduplicateById(JSON.parse(localStorage.getItem('custom_formations')!)) : [],
                pinnedFormationIds: localStorage.getItem('pinned_formations') ? JSON.parse(localStorage.getItem('pinned_formations')!) : ['4-2-3-1', '4-4-2', '4-3-3'],
                trainingSettings: savedSettings ? JSON.parse(savedSettings) : INITIAL_DATA.trainingSettings,
                exerciseBank: localStorage.getItem('football_exercise_bank') ? deduplicateById(JSON.parse(localStorage.getItem('football_exercise_bank')!)) : [],
                exerciseBankCategories: localStorage.getItem('football_exercise_bank_categories') ? JSON.parse(localStorage.getItem('football_exercise_bank_categories')!) : []
              };
              setSessionActionCount(1);
            } else {
              loadedState = INITIAL_DATA;
            }
          } else {
            // Use segment data from cloud
            loadedState = {
              squad: squadSnap.exists() ? deduplicateById(squadSnap.data().squad || []) : [],
              sessions: sessionsSnap.exists() ? deduplicateById(sessionsSnap.data().sessions || []) : [],
              deletedSessions: sessionsSnap.exists() ? deduplicateById(sessionsSnap.data().deletedSessions || []) : [],
              exercises: exercisesSnap.exists() ? deduplicateById(exercisesSnap.data().exercises || []) : [],
              exerciseBank: exercisesSnap.exists() ? deduplicateById(exercisesSnap.data().exerciseBank || []) : [],
              exerciseBankCategories: exercisesSnap.exists() ? (exercisesSnap.data().exerciseBankCategories || []) : [],
              lineups: lineupsSnap.exists() ? deduplicateById(lineupsSnap.data().lineups || []) : [],
              activeLineupId: lineupsSnap.exists() ? (lineupsSnap.data().activeLineupId || null) : null,
              periods: periodsSnap.exists() ? deduplicateById(periodsSnap.data().periods || []) : [],
              currentPeriodId: periodsSnap.exists() ? (periodsSnap.data().currentPeriodId || null) : null,
              teamUrl: settingsSnap.exists() ? (settingsSnap.data().teamUrl || '') : '',
              adminUrl: settingsSnap.exists() ? (settingsSnap.data().adminUrl || '') : '',
              seriesUrl: settingsSnap.exists() ? (settingsSnap.data().seriesUrl || '') : '',
              customFormations: settingsSnap.exists() ? deduplicateById(settingsSnap.data().customFormations || []) : [],
              pinnedFormationIds: settingsSnap.exists() ? (settingsSnap.data().pinnedFormationIds || ['4-2-3-1', '4-4-2', '4-3-3']) : ['4-2-3-1', '4-4-2', '4-3-3'],
              trainingSettings: settingsSnap.exists() ? (settingsSnap.data().trainingSettings || INITIAL_DATA.trainingSettings) : INITIAL_DATA.trainingSettings,
              activeExerciseId: settingsSnap.exists() ? (settingsSnap.data().activeExerciseId || null) : null,
            };
          }
        }

        if (isSubscribed) {
          setData(loadedState);
          lastCloudDataRef.current = loadedState;
          syncUserIdRef.current = user.uid;
          const syncTime = Date.now();
          lastSyncedAtRef.current = syncTime;
          localStorage.setItem('last_local_sync_at', syncTime.toString());
          localStorage.setItem('last_local_user_id', user.uid);
          setHasPulledFromCloud(true);
          setIsInitialSyncDone(true);
        }

        // Subscribe to real-time lineups updates
        if (isSubscribed) {
          console.log("App: Listening to real-time lineups updates on users/{uid}/data/lineups...");
          unsubscribeLineups = onSnapshot(docLineupsRef, (snapshot) => {
            if (snapshot.metadata.hasPendingWrites) {
              return;
            }

            // Skip applying remote updates if local writes are pending
            if (sessionActionCountRef.current > 0 && lastCloudDataRef.current) {
              const remoteData = snapshot.data();
              if (remoteData) {
                const lineupsChanged = JSON.stringify(lastCloudDataRef.current.lineups) !== JSON.stringify(remoteData.lineups) ||
                                      lastCloudDataRef.current.activeLineupId !== remoteData.activeLineupId;
                if (lineupsChanged) {
                  console.log("App: Postponing remote lineups update to prevent overwrite of local edits.");
                  return;
                }
              }
            }

            if (snapshot.exists()) {
              const remoteLineupsData = snapshot.data();
              const newLineups = remoteLineupsData.lineups || [];
              const newActiveLineupId = remoteLineupsData.activeLineupId || null;

              setData(prev => {
                if (JSON.stringify(prev.lineups) === JSON.stringify(newLineups) && prev.activeLineupId === newActiveLineupId) {
                  return prev;
                }
                console.log("App: Real-time update of lineups applied from cloud");
                const updated = {
                  ...prev,
                  lineups: newLineups,
                  activeLineupId: newActiveLineupId
                };
                if (lastCloudDataRef.current) {
                  lastCloudDataRef.current.lineups = newLineups;
                  lastCloudDataRef.current.activeLineupId = newActiveLineupId;
                }
                return updated;
              });
            }
          }, (error) => {
            console.error("App: Lineup snapshot error:", error);
            if (isQuotaError(error)) {
              setIsQuotaExceeded(true);
            }
            handleFirestoreError(error, OperationType.GET, `users/${user.uid}/data/lineups`);
          });
        }
      } catch (error) {
        console.error("App: Segmented loader initialization failed:", error);
        if (isQuotaError(error)) {
          setIsQuotaExceeded(true);
        }
        if (isSubscribed) {
          setHasPulledFromCloud(true);
          setIsInitialSyncDone(true);
        }
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}/data/*`);
      }
    };

    initializeAndLoad();

    return () => {
      isSubscribed = false;
      if (unsubscribeLineups) {
        unsubscribeLineups();
      }
    };
  }, [user?.uid, isAuthReady]);

  // Push Local Actions to Cloud with dynamic debounce and granular dirty tracking
  useEffect(() => {
    if (activeExerciseId !== null) {
      // Skip auto-sync while in competition
      return;
    }

    if (user && isAuthReady && isInitialSyncDone && hasPulledFromCloud && sessionActionCount > 0 && !isSyncing && !isQuotaExceeded) {
      if (syncUserIdRef.current !== user.uid) return;

      const lastSynced = lastCloudDataRef.current || INITIAL_DATA;

      // Track granular dirty state
      const isSquadDirty = JSON.stringify(lastSynced.squad) !== JSON.stringify(squad);
      const isSessionsDirty = 
        JSON.stringify(lastSynced.sessions) !== JSON.stringify(sessions) ||
        JSON.stringify(lastSynced.deletedSessions) !== JSON.stringify(deletedSessions);
      const isExercisesDirty = 
        JSON.stringify(lastSynced.exercises) !== JSON.stringify(exercises) ||
        JSON.stringify(lastSynced.exerciseBank) !== JSON.stringify(exerciseBank) ||
        JSON.stringify(lastSynced.exerciseBankCategories) !== JSON.stringify(exerciseBankCategories);
      const isLineupsDirty = 
        JSON.stringify(lastSynced.lineups) !== JSON.stringify(lineups) ||
        lastSynced.activeLineupId !== activeLineupId;
      const isPeriodsDirty = 
        JSON.stringify(lastSynced.periods) !== JSON.stringify(periods) ||
        lastSynced.currentPeriodId !== currentPeriodId;
      const isSettingsDirty = 
        lastSynced.teamUrl !== teamUrl ||
        lastSynced.adminUrl !== adminUrl ||
        lastSynced.seriesUrl !== seriesUrl ||
        JSON.stringify(lastSynced.customFormations) !== JSON.stringify(customFormations) ||
        JSON.stringify(lastSynced.pinnedFormationIds) !== JSON.stringify(pinnedFormationIds) ||
        JSON.stringify(lastSynced.trainingSettings) !== JSON.stringify(trainingSettings) ||
        lastSynced.activeExerciseId !== activeExerciseId;

      let debounceDelay = 5000;
      if (isSessionsDirty || (isSettingsDirty && JSON.stringify(lastSynced.trainingSettings) !== JSON.stringify(trainingSettings))) {
        debounceDelay = 30000; // Slower 30s debounce to save writes during planning
      }
      if (isLineupsDirty || isSquadDirty || isExercisesDirty || isPeriodsDirty) {
        debounceDelay = 5000; // Fast 5s sync for higher priority elements
      }

      const syncData = async () => {
        if (syncUserIdRef.current !== user.uid || isSyncing) return;

        const capturedActionCount = sessionActionCount;

        // Re-evaluate dirty states at sync time
        const currentSynced = lastCloudDataRef.current || INITIAL_DATA;
        const nowSquadDirty = JSON.stringify(currentSynced.squad) !== JSON.stringify(squad);
        const nowSessionsDirty = JSON.stringify(currentSynced.sessions) !== JSON.stringify(sessions) || JSON.stringify(currentSynced.deletedSessions) !== JSON.stringify(deletedSessions);
        const nowExercisesDirty = JSON.stringify(currentSynced.exercises) !== JSON.stringify(exercises) || JSON.stringify(currentSynced.exerciseBank) !== JSON.stringify(exerciseBank) || JSON.stringify(currentSynced.exerciseBankCategories) !== JSON.stringify(exerciseBankCategories);
        const nowLineupsDirty = JSON.stringify(currentSynced.lineups) !== JSON.stringify(lineups) || currentSynced.activeLineupId !== activeLineupId;
        const nowPeriodsDirty = JSON.stringify(currentSynced.periods) !== JSON.stringify(periods) || currentSynced.currentPeriodId !== currentPeriodId;
        const nowSettingsDirty = currentSynced.teamUrl !== teamUrl || currentSynced.adminUrl !== adminUrl || currentSynced.seriesUrl !== seriesUrl || JSON.stringify(currentSynced.customFormations) !== JSON.stringify(customFormations) || JSON.stringify(currentSynced.pinnedFormationIds) !== JSON.stringify(pinnedFormationIds) || JSON.stringify(currentSynced.trainingSettings) !== JSON.stringify(trainingSettings) || currentSynced.activeExerciseId !== activeExerciseId;

        const writePromises = [];
        const now = Date.now();
        const lastUpdatedBy = sessionIdRef.current;

        if (nowSquadDirty) {
          writePromises.push(setDoc(doc(db, 'users', user.uid, 'data', 'squad'), { squad, updatedAt: now, lastUpdatedBy }));
        }
        if (nowSessionsDirty) {
          writePromises.push(setDoc(doc(db, 'users', user.uid, 'data', 'sessions'), { sessions, deletedSessions, updatedAt: now, lastUpdatedBy }));
        }
        if (nowExercisesDirty) {
          writePromises.push(setDoc(doc(db, 'users', user.uid, 'data', 'exercises'), { exercises, exerciseBank, exerciseBankCategories, updatedAt: now, lastUpdatedBy }));
        }
        if (nowLineupsDirty) {
          writePromises.push(setDoc(doc(db, 'users', user.uid, 'data', 'lineups'), { lineups, activeLineupId, updatedAt: now, lastUpdatedBy }));
        }
        if (nowPeriodsDirty) {
          writePromises.push(setDoc(doc(db, 'users', user.uid, 'data', 'periods'), { periods, currentPeriodId, updatedAt: now, lastUpdatedBy }));
        }
        if (nowSettingsDirty) {
          writePromises.push(setDoc(doc(db, 'users', user.uid, 'data', 'settings'), { teamUrl, adminUrl, seriesUrl, customFormations, pinnedFormationIds, trainingSettings, activeExerciseId, updatedAt: now, lastUpdatedBy }));
        }

        if (writePromises.length === 0) {
          console.log("App: No dirty segments to sync, skipping push.");
          setSessionActionCount(prev => Math.max(0, prev - capturedActionCount));
          return;
        }

        console.log(`App: Syncing ${writePromises.length} dirty segments to cloud. Debounce used: ${debounceDelay}ms`);
        setIsSyncing(true);

        try {
          await Promise.all(writePromises);
          lastSyncedAtRef.current = now;
          lastCloudDataRef.current = {
            squad,
            exercises,
            sessions,
            deletedSessions,
            lineups,
            activeLineupId,
            periods,
            currentPeriodId,
            activeExerciseId,
            teamUrl,
            adminUrl,
            seriesUrl,
            customFormations,
            pinnedFormationIds,
            trainingSettings,
            exerciseBank,
            exerciseBankCategories
          };
          setSessionActionCount(prev => Math.max(0, prev - capturedActionCount));
          setIsQuotaExceeded(false);
          setSyncError(null);
        } catch (error) {
          console.error("App: Segmented push failed", error);
          if (isQuotaError(error)) {
            setIsQuotaExceeded(true);
            setSessionActionCount(0);
          } else {
            setSyncError((error as Error)?.message || 'Okänt synkfel');
          }
          handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/data/*`);
        } finally {
          setIsSyncing(false);
        }
      };

      const timeout = setTimeout(syncData, debounceDelay);
      return () => clearTimeout(timeout);
    }
  }, [squad, exercises, sessions, deletedSessions, lineups, activeLineupId, periods, currentPeriodId, activeExerciseId, teamUrl, adminUrl, seriesUrl, customFormations, pinnedFormationIds, trainingSettings, exerciseBank, exerciseBankCategories, sessionActionCount, user?.uid, isAuthReady, isInitialSyncDone, hasPulledFromCloud, isSyncing, isQuotaExceeded]);

  // Sync shared leaderboards globally with optimized, less aggressive debouncing
  useEffect(() => {
    if (activeExerciseId !== null) {
      // Skip publishing/sharing leaderboard updates while actively in a competition/exercise view.
      return;
    }
    if (user && isAuthReady && isInitialSyncDone && !isQuotaExceeded) {
      const syncSharedLeaderboards = async () => {
        const sharedPeriods = periods.filter(p => p.shareId);
        if (sharedPeriods.length === 0) return;

        try {
          for (const period of sharedPeriods) {
            const stats = calculateLeaderboard(squad, exercises, period.id, periods);
            
            // Build comparison data WITHOUT the updated timestamp to determine if real data changed
            const comparisonData = {
              id: period.shareId,
              name: period.name,
              standings: stats.map((p: any) => ({
                playerId: p.id,
                playerName: p.name,
                imageUrl: p.photoUrl || null,
                points: p.totalPoints,
                history: p.history || []
              })),
              startDate: period.startDate || null,
              endDate: period.endDate || null,
              coachUid: user.uid,
              activeExerciseId: activeExerciseId
            };

            const comparisonString = JSON.stringify(comparisonData);
            if (lastSharedLeaderboardsRef.current[period.shareId!] === comparisonString) {
              console.log(`App: Skipping leaderboard sync for ${period.name} (has not changed)`);
              continue;
            }

            console.log(`App: Leaderboard data changed for ${period.name}, writing to shared_leaderboards`);
            const dataToUpdate = {
              ...comparisonData,
              updatedAt: Date.now()
            };
            
            await setDoc(doc(db, 'shared_leaderboards', period.shareId!), dataToUpdate, { merge: true });
            lastSharedLeaderboardsRef.current[period.shareId!] = comparisonString;
          }
        } catch (error) {
          console.error("Error syncing shared leaderboards globally:", error);
          if (isQuotaError(error)) {
            setIsQuotaExceeded(true);
          }
          handleFirestoreError(error, OperationType.WRITE, `shared_leaderboards/*`);
        }
      };

      let debounceDelay = 45000; // Default 45s low-frequency debounce during general score updates
      const lastSynced = lastCloudDataRef.current;
      if (lastSynced) {
        // If an exercise was recently finished compared to the cloud state, publish the leaderboard final results in 5 seconds
        const hasFinishedChange = exercises.some(e => {
          const cloudEx = lastSynced.exercises.find((cx: any) => cx.id === e.id);
          return e.isFinished && (!cloudEx || !cloudEx.isFinished);
        });
        if (hasFinishedChange) {
          debounceDelay = 5000;
        }
      }

      const timeoutId = setTimeout(syncSharedLeaderboards, debounceDelay);
      return () => clearTimeout(timeoutId);
    }
  }, [squad, exercises, periods, user, isAuthReady, isInitialSyncDone, isQuotaExceeded, activeExerciseId]);

  // Update localStorage for guests
  useEffect(() => {
    if (!user && isAuthReady && isInitialSyncDone) {
      localStorage.setItem('football_squad', JSON.stringify(squad));
      localStorage.setItem('football_exercises', JSON.stringify(exercises));
      localStorage.setItem('football_lineups', JSON.stringify(lineups));
      localStorage.setItem('active_lineup_id', activeLineupId || '');
      localStorage.setItem('football_periods', JSON.stringify(periods));
      localStorage.setItem('current_period_id', currentPeriodId);
    }
  }, [squad, exercises, lineups, activeLineupId, periods, currentPeriodId, user, isAuthReady, isInitialSyncDone]);

  // REMOVED: Redundant secondary listener

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const shareId = params.get('share');
      setSharedLeaderboardId(shareId);
      if (shareId) setView('leaderboard');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (sharedLeaderboardId) {
      setView('leaderboard');
    }
  }, [sharedLeaderboardId]);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
    try {
      localStorage.setItem('score_theme', theme);
    } catch (e) {}
  }, [theme]);

  useEffect(() => {
    if (activeExerciseId) {
      localStorage.setItem('active_exercise_id', activeExerciseId);
    } else {
      localStorage.removeItem('active_exercise_id');
    }
  }, [activeExerciseId]);

  const activeExercise = exercises.find(e => e.id === activeExerciseId);

  const handleStartExercise = (
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
  ) => {
    const now = Date.now();
    const resolvedSessionId = (sessionId && sessionId !== 'active') ? sessionId : (activeSessionId || undefined);
    
    const newExercise: Exercise = {
      id: crypto.randomUUID(),
      name,
      icon,
      date: now,
      teams: teams.map(t => ({ ...t, playerIds: t.playerIds || [], score: 0 })),
      sortByScore,
      showTimer,
      defaultTimerMinutes,
      defaultTimerSeconds,
      jokerPlayerIds,
      pointsConfig,
      createdAt: now,
      updatedAt: now,
      periodId: periodId || null,
      sessionId: resolvedSessionId
    };
    
    const nextActiveExerciseId = shouldStart !== false ? newExercise.id : previousActiveExerciseId;

    setData(prev => ({
      ...prev,
      exercises: [newExercise, ...prev.exercises],
      activeLineupId: activeLineupId,
      activeExerciseId: nextActiveExerciseId,
      sessions: (linkToMomentId && activeSessionId) 
        ? prev.sessions.map(s => s.id === activeSessionId 
            ? { ...s, moments: s.moments.map(m => m.id === linkToMomentId ? { ...m, exerciseId: newExercise.id } : m), updatedAt: Date.now() } 
            : s)
        : prev.sessions
    }));
    setSessionActionCount(prev => prev + 1);
    
    setLinkToMomentId(null);
    setPrefilledName(null);
    setPreviousActiveExerciseId(undefined);

    if (editReturnView) {
      setView(editReturnView);
      setEditReturnView(null);
    } else if (resolvedSessionId) {
      setActiveSessionId(resolvedSessionId);
      setView('training');
    } else {
      setActiveSessionId(null);
      setView(shouldStart !== false ? 'exercise' : 'training');
    }
  };

  const handleSaveEditedExercise = (
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
    sessionId?: string | null
  ) => {
    if (!activeExerciseId) return;
    
    setData(prev => {
      const nextActiveId = previousActiveExerciseId !== undefined ? previousActiveExerciseId : prev.activeExerciseId;
      return {
        ...prev,
        activeExerciseId: nextActiveId,
        exercises: prev.exercises.map(e => {
          if (e.id !== prev.activeExerciseId) return e;
          
          const updatedTeams = teams.map(t => {
            const existingTeam = e.teams.find(et => et.id === t.id);
            return {
              ...t,
              playerIds: t.playerIds || [],
              score: existingTeam ? existingTeam.score : 0
            };
          });

          return {
            ...e,
            name,
            icon,
            teams: updatedTeams,
            sortByScore,
            showTimer,
            defaultTimerMinutes,
            defaultTimerSeconds,
            jokerPlayerIds,
            pointsConfig,
            updatedAt: Date.now(),
            periodId: periodId || e.periodId,
            sessionId: sessionId || (activeSessionId || e.sessionId)
          };
        }),
        sessions: linkToMomentId && activeSessionId 
          ? prev.sessions.map(s => s.id === activeSessionId 
              ? { ...s, moments: s.moments.map(m => m.id === linkToMomentId ? { ...m, exerciseId: (prev.activeExerciseId || '') } : m), updatedAt: Date.now() } 
              : s)
          : prev.sessions
      };
    });
    setSessionActionCount(prev => prev + 1);
    setIsEditingActiveExercise(false);
    
    // Determine where to go back
    const isEditingViewedExercise = activeExerciseId === (exercises.find(e => e.id === activeExerciseId)?.id);

    if (editReturnView) {
      setView(editReturnView);
      setEditReturnView(null);
    } else if (isEditingViewedExercise) {
      setView('exercise');
    } else if (linkToMomentId || activeSessionId) {
      setView('training');
    } else {
      setView('exercise');
    }

    // Clean up common setup states
    setLinkToMomentId(null);
    setPrefilledName(null);
    setPreviousActiveExerciseId(undefined);
  };

  const updateTeamColor = (teamId: string, color: string) => {
    if (!activeExerciseId) return;
    setData(prev => ({
      ...prev,
      exercises: prev.exercises.map(e => {
        if (e.id !== activeExerciseId) return e;
        return {
          ...e,
          updatedAt: Date.now(),
          teams: e.teams.map(t => 
            t.id === teamId ? { ...t, color } : t
          ),
        };
      })
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const updateScore = (teamId: string, delta: number) => {
    if (!activeExerciseId || activeExercise?.isFinished) return;
    setData(prev => ({
      ...prev,
      exercises: prev.exercises.map(e => {
        if (e.id !== activeExerciseId) return e;
        return {
          ...e,
          updatedAt: Date.now(),
          teams: e.teams.map(t => 
            t.id === teamId ? { ...t, score: Math.max(0, t.score + delta) } : t
          ),
        };
      })
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const resetScores = () => {
    if (!activeExerciseId) return;
    setData(prev => ({
      ...prev,
      exercises: prev.exercises.map(e => {
        if (e.id !== activeExerciseId) return e;
        return {
          ...e,
          updatedAt: Date.now(),
          teams: e.teams.map(t => ({ ...t, score: 0 })),
        };
      })
    }));
    setSessionActionCount(prev => prev + 1);
    setShowResetConfirm(false);
  };

  const deleteExercise = (id: string) => {
    setData(prev => ({
      ...prev,
      exercises: prev.exercises.filter(e => e.id !== id),
      activeExerciseId: prev.activeExerciseId === id ? null : prev.activeExerciseId
    }));
    setSessionActionCount(prev => prev + 1);
    if (activeExerciseId === id) {
      setView('training');
    }
  };

  const updateLineup = (newLineup: Lineup) => {
    // We always set sessionActionCount to 1 to trigger a sync when this is called,
    // as it's debounced from the LineupBuilder side only when actual changes happen.
    setData(prev => ({
      ...prev,
      lineups: prev.lineups.map(l => l.id === newLineup.id ? newLineup : l)
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const handleSaveLineup = (newLineup: Lineup) => {
    setData(prev => {
      const exists = prev.lineups.find(l => l.id === newLineup.id);
      const newLineups = exists 
        ? prev.lineups.map(l => l.id === newLineup.id ? newLineup : l)
        : [newLineup, ...prev.lineups];
      
      return {
        ...prev,
        lineups: newLineups,
        activeLineupId: newLineup.id
      };
    });
    setSessionActionCount(prev => prev + 1);
  };

  const handleDeleteLineup = (id: string) => {
    setData(prev => ({
      ...prev,
      lineups: prev.lineups.filter(l => l.id !== id),
      activeLineupId: prev.activeLineupId === id ? null : prev.activeLineupId
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const handleCopyLineup = (id: string) => {
    setData(prev => {
      const source = prev.lineups.find(l => l.id === id);
      if (!source) return prev;
      const copied: Lineup = {
        ...source,
        id: crypto.randomUUID(),
        matchTitle: `${source.matchTitle} (kopia)`,
        date: Date.now()
      };
      return {
        ...prev,
        lineups: [copied, ...prev.lineups],
        activeLineupId: copied.id
      };
    });
    setSessionActionCount(prev => prev + 1);
  };

  const onNewSession = () => {
    let endTime = trainingSettings?.defaultEndTime;
    
    if (!endTime && trainingSettings?.defaultStartTime && trainingSettings?.defaultDuration) {
      const [h, m] = trainingSettings.defaultStartTime.split(':').map(Number);
      const date = new Date();
      date.setHours(h, m, 0, 0);
      date.setMinutes(date.getMinutes() + trainingSettings.defaultDuration);
      endTime = date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }

    const newSession: TrainingSession = {
      id: crypto.randomUUID(),
      title: '',
      date: Date.now(),
      startTime: trainingSettings?.defaultStartTime || '18:00',
      endTime: endTime,
      moments: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    setData(prev => ({
      ...prev,
      sessions: [newSession, ...(prev.sessions || [])]
    }));
    setActiveSessionId(newSession.id);
    setSessionActionCount(prev => prev + 1);
  };

  const onAddSessionsBatch = (newSessions: TrainingSession[]) => {
    setData(prev => ({
      ...prev,
      sessions: [...newSessions, ...(prev.sessions || [])]
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const onUpdateSession = (updatedSession: TrainingSession) => {
    setData(prev => ({
      ...prev,
      sessions: prev.sessions.map(s => s.id === updatedSession.id ? updatedSession : s)
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const addBankExercise = (exercise: Omit<BankExercise, 'id' | 'createdAt'>) => {
    const newEx: BankExercise = {
      ...exercise,
      id: 'bank_' + Math.random().toString(36).substring(7),
      createdAt: Date.now()
    };
    setData(prev => ({
      ...prev,
      exerciseBank: [newEx, ...(prev.exerciseBank || [])]
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const updateBankExercise = (id: string, updates: Partial<BankExercise>) => {
    setData(prev => ({
      ...prev,
      exerciseBank: (prev.exerciseBank || []).map(ex => ex.id === id ? { ...ex, ...updates } : ex)
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const removeBankExercise = (id: string) => {
    setData(prev => ({
      ...prev,
      exerciseBank: (prev.exerciseBank || []).filter(ex => ex.id !== id)
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const addBankCategory = (category: string) => {
    const trimmed = category.trim();
    if (!trimmed) return;
    setData(prev => {
      const existing = prev.exerciseBankCategories || [];
      if (existing.some(c => c.toLowerCase() === trimmed.toLowerCase())) return prev;
      return {
        ...prev,
        exerciseBankCategories: [...existing, trimmed]
      };
    });
    setSessionActionCount(prev => prev + 1);
  };

  const removeBankCategory = (category: string) => {
    setData(prev => ({
      ...prev,
      exerciseBankCategories: (prev.exerciseBankCategories || []).filter(c => c !== category)
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const saveMomentToBank = (moment: SessionMoment) => {
    const bankId = 'bank_' + Math.random().toString(36).substring(7);
    const newEx: BankExercise = {
      id: bankId,
      name: moment.name || 'Namnlös övning',
      duration: moment.duration || 15,
      description: moment.description,
      imageUrl: moment.imageUrl,
      imageUrls: moment.imageUrls,
      externalLink: moment.externalLink,
      category: 'Annat',
      categories: ['Annat'],
      createdAt: Date.now(),
      tacticalBoards: moment.tacticalBoards
    };
    setData(prev => ({
      ...prev,
      exerciseBank: [newEx, ...(prev.exerciseBank || [])]
    }));
    setSessionActionCount(prev => prev + 1);
    return bankId;
  };

  const onDeleteSession = (id: string) => {
    setData(prev => {
      const sessionToDelete = prev.sessions.find(s => s.id === id);
      const updatedSessions = prev.sessions.filter(s => s.id !== id);
      const updatedDeleted = sessionToDelete 
        ? [sessionToDelete, ...(prev.deletedSessions || [])]
        : (prev.deletedSessions || []);
      
      return {
        ...prev,
        sessions: updatedSessions,
        deletedSessions: updatedDeleted
      };
    });
    setSessionActionCount(prev => prev + 1);
  };

  const onRestoreSession = (id: string) => {
    setData(prev => {
      const restoredSession = (prev.deletedSessions || []).find(s => s.id === id);
      const updatedDeleted = (prev.deletedSessions || []).filter(s => s.id !== id);
      const updatedSessions = restoredSession
        ? [restoredSession, ...prev.sessions]
        : prev.sessions;
      
      return {
        ...prev,
        sessions: updatedSessions,
        deletedSessions: updatedDeleted
      };
    });
    setSessionActionCount(prev => prev + 1);
  };

  const onDeleteSessionPermanent = (ids: string | string[]) => {
    const idArray = Array.isArray(ids) ? ids : [ids];
    setData(prev => ({
      ...prev,
      deletedSessions: (prev.deletedSessions || []).filter(s => !idArray.includes(s.id))
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const handleCopySession = (id: string) => {
    setData(prev => {
      const source = prev.sessions.find(s => s.id === id);
      if (!source) return prev;

      const newExercises: Exercise[] = [];
      const newMoments = source.moments.map(m => {
        if (m.exerciseId) {
          const sourceExercise = prev.exercises.find(e => e.id === m.exerciseId);
          if (sourceExercise) {
            const newExId = crypto.randomUUID();
            const newEx: Exercise = {
              ...sourceExercise,
              id: newExId,
              name: sourceExercise.name,
              date: Date.now(),
              isFinished: false,
              sessionId: source.id, // Will be updated to newSession.id later if needed
              teams: sourceExercise.teams.map(t => ({ ...t, id: crypto.randomUUID(), score: 0, playerIds: [] })),
              jokerPlayerIds: [],
              createdAt: Date.now(),
              updatedAt: Date.now(),
              periodId: currentPeriodId // Assign to current active period
            };
            newExercises.push(newEx);
            return { ...m, id: crypto.randomUUID(), exerciseId: newExId };
          }
        }
        return { ...m, id: crypto.randomUUID() };
      });

      const newSession: TrainingSession = {
        ...source,
        id: crypto.randomUUID(),
        title: source.title ? `${source.title} (kopia)` : 'Träning (kopia)',
        date: Date.now(),
        isCompleted: false, // Always start as planned
        moments: newMoments,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Ensure copied exercises refer to the NEW session ID
      const finalizedExercises = newExercises.map(e => ({ ...e, sessionId: newSession.id }));

      return {
        ...prev,
        sessions: [newSession, ...prev.sessions],
        exercises: [...finalizedExercises, ...prev.exercises]
      };
    });
    setSessionActionCount(prev => prev + 1);
  };

  const handleReorderLineups = (reordered: Lineup[]) => {
    setData(prev => ({ ...prev, lineups: reordered }));
    setSessionActionCount(prev => prev + 1);
  };

  const handleRankClick = () => {
    if (!activeExerciseId) return;
    setData(prev => ({
      ...prev,
      exercises: prev.exercises.map(e => {
        if (e.id !== activeExerciseId) return e;
        return {
          ...e,
          updatedAt: Date.now(),
          teams: [...e.teams].sort((a, b) => b.score - a.score)
        };
      })
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const handleUpdateTeamUrl = (url: string) => {
    setData(prev => ({ ...prev, teamUrl: url }));
    setSessionActionCount(prev => prev + 1);
  };

  const handleUpdateAdminUrl = (url: string) => {
    setData(prev => ({ ...prev, adminUrl: url }));
    setSessionActionCount(prev => prev + 1);
  };

  const handleUpdateSeriesUrl = (url: string) => {
    setData(prev => ({ ...prev, seriesUrl: url }));
    setSessionActionCount(prev => prev + 1);
  };

  const updateActiveExerciseDefaultTimer = (minutes: number, seconds: number) => {
    if (!activeExerciseId) return;
    setData(prev => ({
      ...prev,
      exercises: prev.exercises.map(e => {
        if (e.id !== activeExerciseId) return e;
        return {
          ...e,
          defaultTimerMinutes: minutes,
          defaultTimerSeconds: seconds,
          updatedAt: Date.now(),
        };
      })
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const toggleTimerVisibility = () => {
    if (!activeExerciseId) return;
    setData(prev => ({
      ...prev,
      exercises: prev.exercises.map(e => {
        if (e.id !== activeExerciseId) return e;
        return {
          ...e,
          showTimer: !e.showTimer,
          updatedAt: Date.now(),
        };
      })
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const finishExercise = () => {
    if (!activeExerciseId) return;
    
    setData(prev => ({
      ...prev,
      exercises: prev.exercises.map(e => {
        if (e.id !== activeExerciseId) return e;
        return {
          ...e,
          isFinished: true,
          finishedAt: Date.now(),
          updatedAt: Date.now(),
          periodId: finishTargetPeriodId || undefined
        };
      }),
      activeExerciseId: null
    }));
    setSessionActionCount(prev => prev + 1);
    setShowFinishConfirm(false);
    setView('training');
  };

  const unlockExercise = () => {
    if (!activeExerciseId) return;
    setData(prev => ({
      ...prev,
      exercises: prev.exercises.map(e => {
        if (e.id !== activeExerciseId) return e;
        return {
          ...e,
          isFinished: false,
          finishedAt: undefined,
          updatedAt: Date.now(),
        };
      })
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const handleClosePeriod = (name: string, standings: PeriodStandings[]) => {
    const now = Date.now();
    
    setData(prev => ({
      ...prev,
      periods: prev.periods.map(p => {
        if (p.id === currentPeriodId) {
          return {
            ...p,
            name: name || p.name,
            endDate: now,
            isActive: false,
            standings
          };
        }
        return p;
      }),
      currentPeriodId: null
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const handleStartNewPeriod = () => {
    // This is now handled by a more specific function
  };

  const createNewPeriod = (name: string) => {
    const now = Date.now();
    const newId = crypto.randomUUID();
    const newPeriod: Period = {
      id: newId,
      name,
      startDate: now,
      standings: [],
      isActive: true
    };

    setData(prev => {
      const updatedPeriods = prev.periods.map(p => ({ ...p, isActive: false }));
      return {
        ...prev,
        periods: [newPeriod, ...updatedPeriods],
        currentPeriodId: newId
      };
    });
    setSessionActionCount(prev => prev + 1);
  };

  const switchActivePeriod = (id: string) => {
    setData(prev => ({
      ...prev,
      periods: prev.periods.map(p => ({
        ...p,
        isActive: p.id === id
      })),
      currentPeriodId: id
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const renamePeriod = (id: string, newName: string) => {
    setData(prev => ({
      ...prev,
      periods: prev.periods.map(p => p.id === id ? { ...p, name: newName } : p)
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const updatePeriod = (id: string, updates: Partial<Period>) => {
    setData(prev => ({
      ...prev,
      periods: prev.periods.map(p => p.id === id ? { ...p, ...updates } : p)
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const handleDeletePeriod = (id: string) => {
    setData(prev => ({
      ...prev,
      periods: prev.periods.filter(p => p.id !== id),
      exercises: prev.exercises.map(e => {
        if (e.periodId === id) {
          return { ...e, periodId: undefined };
        }
        return e;
      })
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const movePlayer = (exerciseId: string, playerId: string, targetTeamId: string) => {
    setData(prev => ({
      ...prev,
      exercises: prev.exercises.map(e => {
        if (e.id !== exerciseId) return e;
        
        // Remove player from all teams and joker list first
        const updatedTeams = e.teams.map(t => ({
          ...t,
          playerIds: (t.playerIds || []).filter(id => id !== playerId)
        }));
        const updatedJokerIds = (e.jokerPlayerIds || []).filter(id => id !== playerId);
        
        // If target is "joker", add to joker list
        if (targetTeamId === 'joker') {
          return {
            ...e,
            teams: updatedTeams,
            jokerPlayerIds: [...updatedJokerIds, playerId],
            updatedAt: Date.now()
          };
        }

        // If target is "none", just keep removed from everything (moves to unassigned pool)
        if (targetTeamId === 'none') {
          return {
            ...e,
            teams: updatedTeams,
            jokerPlayerIds: updatedJokerIds,
            updatedAt: Date.now()
          };
        }
        
        // Add to target team
        return {
          ...e,
          teams: updatedTeams.map(t => 
            t.id === targetTeamId ? { ...t, playerIds: [...t.playerIds, playerId] } : t
          ),
          jokerPlayerIds: updatedJokerIds,
          updatedAt: Date.now()
        };
      })
    }));
    setSessionActionCount(prev => prev + 1);
  };

  const copyTeams = (sourceExerciseId: string, targetExerciseId: string) => {
    const LOCAL_VEST_COLORS = [
      '#1E3A8A', // Navy (Tröjfärg)
      '#84CC16', // Lime
      '#0EA5E9', // Sky
      '#F97316', // Orange
      '#71717A', // Zinc
    ];

    setData(prev => {
      const sourceEx = prev.exercises.find(e => e.id === sourceExerciseId);
      if (!sourceEx) return prev;
      return {
        ...prev,
        exercises: prev.exercises.map(e => {
          if (e.id !== targetExerciseId) return e;

          const copiedTeams = e.teams.map((t, idx) => {
            const sourceTeam = sourceEx.teams[idx];
            return {
              ...t,
              playerIds: sourceTeam ? [...(sourceTeam.playerIds || [])] : []
            };
          });

          const finalTeams = [...copiedTeams];
          if (sourceEx.teams.length > e.teams.length) {
            const extraTeams = sourceEx.teams.slice(e.teams.length).map((st, idx) => ({
              id: crypto.randomUUID(),
              name: `Lag ${e.teams.length + idx + 1}`,
              color: LOCAL_VEST_COLORS[(e.teams.length + idx) % LOCAL_VEST_COLORS.length] || '#71717A',
              score: 0,
              playerIds: [...(st.playerIds || [])]
            }));
            finalTeams.push(...extraTeams);
          }

          return {
            ...e,
            teams: finalTeams,
            jokerPlayerIds: sourceEx.jokerPlayerIds ? [...sourceEx.jokerPlayerIds] : [],
            updatedAt: Date.now()
          };
        })
      };
    });
    setSessionActionCount(prev => prev + 1);
  };

  const [draggedPlayerId, setDraggedPlayerId] = useState<string | null>(null);

  const sortedScores = activeExercise ? Array.from(new Set(activeExercise.teams.map(t => t.score))).sort((a: number, b: number) => b - a) : [];

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleManualPush = async () => {
    if (!user || isSyncing) return;
    setIsSyncing(true);
    const now = Date.now();
    const lastUpdatedBy = sessionIdRef.current;
    
    const currentSynced = lastCloudDataRef.current || INITIAL_DATA;
    const nowSquadDirty = JSON.stringify(currentSynced.squad) !== JSON.stringify(squad);
    const nowSessionsDirty = JSON.stringify(currentSynced.sessions) !== JSON.stringify(sessions) || JSON.stringify(currentSynced.deletedSessions) !== JSON.stringify(deletedSessions);
    const nowExercisesDirty = JSON.stringify(currentSynced.exercises) !== JSON.stringify(exercises) || JSON.stringify(currentSynced.exerciseBank) !== JSON.stringify(exerciseBank) || JSON.stringify(currentSynced.exerciseBankCategories) !== JSON.stringify(exerciseBankCategories);
    const nowLineupsDirty = JSON.stringify(currentSynced.lineups) !== JSON.stringify(lineups) || currentSynced.activeLineupId !== activeLineupId;
    const nowPeriodsDirty = JSON.stringify(currentSynced.periods) !== JSON.stringify(periods) || currentSynced.currentPeriodId !== currentPeriodId;
    const nowSettingsDirty = currentSynced.teamUrl !== teamUrl || currentSynced.adminUrl !== adminUrl || currentSynced.seriesUrl !== seriesUrl || JSON.stringify(currentSynced.customFormations) !== JSON.stringify(customFormations) || JSON.stringify(currentSynced.pinnedFormationIds) !== JSON.stringify(pinnedFormationIds) || JSON.stringify(currentSynced.trainingSettings) !== JSON.stringify(trainingSettings) || currentSynced.activeExerciseId !== activeExerciseId;

    const writePromises = [];
    if (nowSquadDirty) {
      writePromises.push(setDoc(doc(db, 'users', user.uid, 'data', 'squad'), { squad, updatedAt: now, lastUpdatedBy }));
    }
    if (nowSessionsDirty) {
      writePromises.push(setDoc(doc(db, 'users', user.uid, 'data', 'sessions'), { sessions, deletedSessions, updatedAt: now, lastUpdatedBy }));
    }
    if (nowExercisesDirty) {
      writePromises.push(setDoc(doc(db, 'users', user.uid, 'data', 'exercises'), { exercises, exerciseBank, exerciseBankCategories, updatedAt: now, lastUpdatedBy }));
    }
    if (nowLineupsDirty) {
      writePromises.push(setDoc(doc(db, 'users', user.uid, 'data', 'lineups'), { lineups, activeLineupId, updatedAt: now, lastUpdatedBy }));
    }
    if (nowPeriodsDirty) {
      writePromises.push(setDoc(doc(db, 'users', user.uid, 'data', 'periods'), { periods, currentPeriodId, updatedAt: now, lastUpdatedBy }));
    }
    if (nowSettingsDirty) {
      writePromises.push(setDoc(doc(db, 'users', user.uid, 'data', 'settings'), { teamUrl, adminUrl, seriesUrl, customFormations, pinnedFormationIds, trainingSettings, activeExerciseId, updatedAt: now, lastUpdatedBy }));
    }

    if (writePromises.length === 0) {
      console.log("App: No dirty data segments to push.");
      setSessionActionCount(0);
      setIsSyncing(false);
      return;
    }

    try {
      await Promise.all(writePromises);
      lastSyncedAtRef.current = now;
      syncUserIdRef.current = user.uid;
      lastCloudDataRef.current = {
        squad,
        exercises,
        sessions,
        deletedSessions,
        lineups,
        activeLineupId,
        periods,
        currentPeriodId,
        activeExerciseId,
        teamUrl,
        adminUrl,
        seriesUrl,
        customFormations,
        pinnedFormationIds,
        trainingSettings,
        exerciseBank,
        exerciseBankCategories
      };
      setSessionActionCount(0); // Reset after manual push
      localStorage.setItem('last_local_sync_at', now.toString());
      setIsQuotaExceeded(false); // Reset status on success
      setSyncError(null); // Reset sync error on success
      console.log("App: Manual push successful");
    } catch (error: any) {
      console.error("App: Manual push failed", error);
      if (isQuotaError(error)) {
        setIsQuotaExceeded(true);
      } else {
        setSyncError(error?.message || "Synkronisering misslyckades");
        let errorMsg = "Synkronisering misslyckades.";
        if (error?.code === 'permission-denied') errorMsg += " Behörighet saknas.";
        else errorMsg += " Kontrollera din internetanslutning.";
        alert(errorMsg);
      }
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/data/*`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleManualPull = async () => {
    await pullLatestData();
  };

  const handleSwitchAccount = async () => {
    try {
      // Force account selection
      await signInWithGoogle(true);
    } catch (error) {
      console.error("Switch account failed", error);
    }
  };

  const clearSharedView = () => {
    setSharedLeaderboardId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('share');
    window.history.pushState({}, '', url);
    setView('training');
  };

  const handleUpdateSquad = (newSquad: SquadPlayer[]) => {
    setData(prev => {
      if (JSON.stringify(prev.squad) === JSON.stringify(newSquad)) {
        return prev;
      }
      return { 
        ...prev, 
        squad: newSquad
      };
    });
    setSessionActionCount(prev => prev + 1);
  };

  const onUpdateSettings = (settings: TrainingSettings) => {
    setData(prev => ({ ...prev, trainingSettings: settings }));
    setSessionActionCount(prev => prev + 1);
  };

  const activeLineup = lineups.find(l => l.id === activeLineupId) || null;

  if (isAuthReady && user && !isInitialSyncDone) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-8 text-center animate-pulse">
        <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-6">
          <Cloud size={32} />
        </div>
        <h2 className="text-xl font-black text-zinc-900 dark:text-white mb-2 tracking-tight">Synkroniserar...</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 font-medium">Hämtar din trupp från molnet</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans selection:bg-indigo-100 transition-colors duration-500 h-[100dvh] overflow-hidden ${view === 'exercise' || view === 'teampage' ? 'select-none' : ''}`}>
      {view !== 'lineup' && (
        <header className={`bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 z-30 transition-colors duration-500 shrink-0 ${view === 'exercise' ? 'sticky top-0' : ''}`}>
          <div className="max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 h-14 sm:h-16 flex items-center justify-between">
            <div 
              className={`flex items-center gap-3 cursor-pointer group min-w-0 ${view === 'lineup' ? 'hover:opacity-70' : ''}`}
              onClick={() => { 
                if (sharedLeaderboardId) {
                  clearSharedView();
                } else if (view === 'setup' && isEditingActiveExercise) {
                  // If editing an exercise, go back to where we started editing
                  if (editReturnView) {
                    setView(editReturnView);
                    setEditReturnView(null);
                  } else {
                    setView(activeExerciseId ? 'exercise' : 'training');
                  }
                  setIsEditingActiveExercise(false);
                } else if (view === 'exercise' || view === 'setup') {
                  setView('training'); 
                  setData(prev => ({ ...prev, activeExerciseId: null }));
                  setSessionActionCount(prev => prev + 1);
                  setIsEditingActiveExercise(false);
                  // If we have an active session, let it stay active
                } else if (view === 'lineup') {
                  // No action on header click for lineup view
                }
              }}
            >
              {(view === 'exercise' || view === 'setup') && (
                <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200 dark:shadow-none group-hover:scale-110 transition-transform shrink-0">
                  <ArrowLeft size={20} strokeWidth={3} />
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <span className="font-black text-xl tracking-tight dark:text-white truncate">
                  {(() => {
                    if (view === 'exercise' && activeExercise) return activeExercise.name;
                    if (view === 'setup') return isEditingActiveExercise ? 'Redigera tävlingsmoment' : 'Skapa tävlingsmoment';
                    if (view === 'training') return 'Kalender';
                    if (view === 'squad') return 'Truppen';
                    if (view === 'leaderboard') return 'Topplista';
                    if (view === 'profile') return 'Profil';
                    if (view === 'lineup') return 'Laguppställning';
                    if (view === 'teampage') return 'Lagsidan';
                    if (sharedLeaderboardId) return 'Delad Topplista';
                    return 'Kalender';
                  })()}
                </span>
                {(view === 'squad' || view === 'leaderboard' || view === 'teampage' || view === 'training') && (
                  <span className="hidden sm:block text-[10px] font-black text-zinc-400 uppercase tracking-widest mt-[-2px]">
                    {view === 'squad' ? 'Hantera spelare & ledare' : view === 'leaderboard' ? 'Statistik & poäng' : view === 'training' ? 'Översikt & Planering' : 'Webb & Kalender'}
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {(isSyncing || (user && sessionActionCount > 0)) && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${
                    isSyncing 
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-800 animate-pulse' 
                      : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-900/30'
                  }`}
                >
                  {isSyncing ? (
                    <>
                      <Cloud size={14} className="animate-bounce" />
                      <span className="text-[10px] font-black uppercase tracking-widest leading-none">Synkar</span>
                    </>
                  ) : (
                    <button 
                      onClick={handleManualPush}
                      className="flex items-center gap-2 cursor-pointer hover:opacity-80 active:scale-95 transition-all"
                      title="Spara ändringar till molnet nu"
                    >
                      <TimerIcon size={14} className="animate-spin-slow" />
                      <span className="text-[10px] font-black uppercase tracking-widest leading-none">Väntar...</span>
                      <div className="w-px h-3 bg-amber-200 dark:bg-amber-800 mx-1" />
                      <span className="text-[10px] font-black uppercase tracking-widest leading-none underline decoration-amber-400">Spara nu</span>
                    </button>
                  )}
                </motion.div>
              )}
              {!sharedLeaderboardId && (
                <>
                  {user && isInitialSyncDone && (
                    <button
                      type="button"
                      onClick={pullLatestData}
                      disabled={isSyncing}
                      className="w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all border border-indigo-100 dark:border-indigo-900/30 disabled:opacity-50"
                      title="Hämta senaste data från molnet (Uppdatera)"
                    >
                      <RefreshCw size={18} className={`${isSyncing ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                  {view === 'exercise' ? (
                    <button
                      type="button"
                      onClick={() => setShowTeamOverview(true)}
                      className="w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all border border-indigo-100 dark:border-indigo-900/30"
                      title="Visa lagöversikt"
                    >
                      <Users size={20} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={toggleTheme}
                      className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all cursor-pointer border border-zinc-200 dark:border-zinc-700"
                      title={theme === 'light' ? 'Mörkt läge' : 'Ljust läge'}
                    >
                      {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                    </button>
                  )}

                  {/* Kalenderinställningar Cogwheel in top-right Nav */}
                  {view === 'training' && (
                    <button
                      type="button"
                      onClick={() => setOpenTrainingSettings(true)}
                      className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-205 dark:hover:bg-zinc-700 hover:text-indigo-650 dark:hover:text-indigo-400 transition-all cursor-pointer border border-zinc-200 dark:border-zinc-700"
                      title="Kalenderinställningar"
                    >
                      <Settings size={20} />
                    </button>
                  )}

                  {isAuthReady && view !== 'exercise' && (
                    user ? (
                      <button
                        onClick={() => setView('profile')}
                        className={`w-10 h-10 flex items-center justify-center rounded-xl overflow-hidden border-2 transition-all ${view === 'profile' ? 'border-indigo-600 dark:border-indigo-400 scale-110' : 'border-zinc-200 dark:border-zinc-700 hover:border-indigo-400'}`}
                        title={`Profil: ${user.displayName}`}
                      >
                        {user.photoURL ? (
                          <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-full h-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                            <UserIcon size={20} />
                          </div>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={handleLogin}
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all border border-indigo-100 dark:border-indigo-900/30"
                        title="Logga in"
                      >
                        <LogIn size={20} />
                      </button>
                    )
                  )}
                </>
              )}
              {view === 'exercise' && activeExercise && (
                <>
                  <button
                    onClick={toggleTimerVisibility}
                    className={`p-2 rounded-lg transition-all ${activeExercise.showTimer ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title={activeExercise.showTimer ? "Dölj timer" : "Visa timer"}
                  >
                    <TimerIcon size={20} />
                  </button>
                  <button
                    onClick={() => {
                      setPreviousActiveExerciseId(activeExerciseId);
                      setEditReturnView('exercise');
                      setIsEditingActiveExercise(true);
                      setView('setup');
                    }}
                    className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all"
                    title="Redigera tävlingsmoment"
                  >
                    <Edit2 size={20} />
                  </button>
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all"
                    title="Nollställ poäng"
                    disabled={activeExercise.isFinished}
                  >
                    <RotateCcw size={20} />
                  </button>
                  {!activeExercise.isFinished && (
                    <button
                      onClick={() => {
                        setFinishTargetPeriodId(activeExercise.periodId || currentPeriodId);
                        setShowFinishConfirm(true);
                      }}
                      className="ml-2 bg-green-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-green-700 transition-all shadow-lg shadow-green-200 dark:shadow-none flex items-center gap-2"
                    >
                      <Check size={18} strokeWidth={3} />
                      <span className="hidden sm:inline">Avsluta</span>
                    </button>
                  )}
                  {activeExercise.isFinished && (
                    <button
                      onClick={unlockExercise}
                      className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all"
                      title="Lås upp för redigering"
                    >
                      <Unlock size={20} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </header>
      )}

      {isQuotaExceeded && (
        <div className="bg-amber-500 text-white px-4 py-2.5 text-center text-xs font-bold leading-normal flex items-center justify-center gap-2 relative z-50 animate-fade-in print:hidden border-b border-amber-600">
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            Synkning tillfälligt pausad (molndatabasens dygnsgräns är nådd). Allt sparas säkert lokalt i webbläsaren!
          </span>
          <button
            onClick={() => {
              setIsQuotaExceeded(false);
              setSessionActionCount(1); // Triggers backup push
            }}
            className="underline hover:no-underline font-black cursor-pointer ml-2 px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded transition-all"
          >
            Försök igen
          </button>
        </div>
      )}

      <main className={`flex-1 flex flex-col min-h-0 ${view === 'exercise' || view === 'teampage' ? 'overflow-hidden' : 'overflow-y-auto pb-24 sm:pb-28'}`}>
        <AnimatePresence mode="wait">
          {view === 'training' && (
            sharedLeaderboardId ? (
              <motion.div
                key="training-promo"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex-1 flex flex-col items-center justify-center p-8 text-center"
              >
                <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/30 rounded-3xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-6">
                  <Calendar size={40} />
                </div>
                <h2 className="text-2xl font-black text-zinc-900 dark:text-white mb-4 tracking-tight">Planera din kalender</h2>
                <p className="text-zinc-500 dark:text-zinc-400 max-w-xs mb-8 font-medium leading-relaxed">
                  Här kan du planera i kalendern och skapa tävlingsmoment. Starta appen som ledare genom att gå till den här sidan.
                </p>
                <button
                  onClick={() => {
                    setSharedLeaderboardId(null);
                    const url = new URL(window.location.origin);
                    url.searchParams.set('view', 'squad');
                    window.history.pushState({}, '', url);
                    setView('squad');
                  }}
                  className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 dark:shadow-none flex items-center gap-2"
                >
                  <Rocket size={20} />
                  <span>Kom igång här</span>
                </button>
              </motion.div>
            ) : (
              <>
                <TrainingManager 
                  exercises={exercises} 
                  sessions={sessions}
                  deletedSessions={deletedSessions}
                  squad={squad}
                  isCloudDataLoaded={hasPulledFromCloud}
                  activeTab={trainingTab}
                  onTabChange={setTrainingTab}
                  settings={trainingSettings}
                  onUpdateSettings={onUpdateSettings}
                  openSettings={openTrainingSettings}
                  onCloseSettings={() => setOpenTrainingSettings(false)}
                  exerciseBank={exerciseBank}
                  exerciseBankCategories={exerciseBankCategories}
                  onAddBankCategory={addBankCategory}
                  onRemoveBankCategory={removeBankCategory}
                  onAddBankExercise={addBankExercise}
                  onUpdateBankExercise={updateBankExercise}
                  onRemoveBankExercise={removeBankExercise}
                  onSelectExercise={(id) => {
                    setData(prev => ({ ...prev, activeExerciseId: id }));
                    setView('exercise');
                  }} 
                  onDeleteExercise={(id) => {
                    setData(prev => ({
                      ...prev,
                      exercises: prev.exercises.filter(e => e.id !== id)
                    }));
                    setSessionActionCount(prev => prev + 1);
                  }}
                  onCopyExercise={(id) => {
                    const ex = exercises.find(e => e.id === id);
                    if (ex) {
                      const newEx = {
                        ...ex,
                        id: Math.random().toString(36).substring(7),
                        name: `${ex.name} (kopia)`,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        isFinished: false
                      };
                      setData(prev => ({
                        ...prev,
                        exercises: [newEx, ...prev.exercises]
                      }));
                      setSessionActionCount(prev => prev + 1);
                    }
                  }}
                  onEditExercise={(id) => {
                    setPreviousActiveExerciseId(activeExerciseId);
                    setData(prev => ({ ...prev, activeExerciseId: id }));
                    setEditReturnView(activeExerciseId === id ? 'exercise' : 'training');
                    setIsEditingActiveExercise(true);
                    setView('setup');
                  }}
                  onReorderExercises={(reordered) => {
                    setData(prev => ({ ...prev, exercises: reordered }));
                    setSessionActionCount(prev => prev + 1);
                  }}
                  onNewExercise={() => {
                    setPreviousActiveExerciseId(activeExerciseId);
                    setEditReturnView('training');
                    setIsEditingActiveExercise(false);
                    setView('setup');
                  }}
                  onNewSession={onNewSession}
                  onAddSessionsBatch={onAddSessionsBatch}
                  onSelectSession={(id, initialTab) => {
                    setActiveSessionId(id);
                    setSessionEditorTab(initialTab || 'schema');
                  }}
                  onDeleteSession={onDeleteSession}
                  onRestoreSession={onRestoreSession}
                  onDeleteSessionPermanent={onDeleteSessionPermanent}
                  onCopySession={handleCopySession}
                  onUpdateSession={onUpdateSession}
                  onMovePlayer={movePlayer}
                  onCopyTeams={copyTeams}
                  onReorderSessions={(reordered) => {
                    setData(prev => ({ ...prev, sessions: reordered }));
                    setSessionActionCount(prev => prev + 1);
                  }}
                />
              </>
            )
          )}

          {view === 'setup' && (() => {
            const exerciseBeingEdited = isEditingActiveExercise ? exercises.find(e => e.id === activeExerciseId) : undefined;
            const effectiveSessionId = activeSessionId || exerciseBeingEdited?.sessionId;
            const currentSession = effectiveSessionId ? sessions.find(s => s.id === effectiveSessionId) : undefined;
            
            // Unique key ensures the component remounts and re-initializes its state
            const setupKey = isEditingActiveExercise 
              ? `edit-${activeExerciseId}` 
              : `new-${effectiveSessionId || 'general'}-${prefilledName || 'unnamed'}`;

            return (
              <GameSetup 
                key={setupKey} 
                onStartGame={isEditingActiveExercise ? handleSaveEditedExercise : handleStartExercise} 
                squad={squad} 
                guestPlayers={currentSession?.guestPlayers}
                sessionAttendance={currentSession?.attendance}
                activeSessionId={effectiveSessionId}
                sessions={sessions}
                exercises={exercises}
                currentPeriodId={currentPeriodId}
                onAddGuest={(name, position) => {
                  if (effectiveSessionId) {
                    const sessionToUpdate = sessions.find(s => s.id === effectiveSessionId);
                    if (sessionToUpdate) {
                      const newGuest = {
                        id: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                        name: name.trim(),
                        position: position || undefined,
                      };
                      onUpdateSession({
                        ...sessionToUpdate,
                        guestPlayers: [...(sessionToUpdate.guestPlayers || []), newGuest],
                        attendance: [...(sessionToUpdate.attendance || []), newGuest.id],
                        updatedAt: Date.now()
                      });
                    }
                  }
                }}
                onAddSquadPlayerToAttendance={(playerId) => {
                  if (effectiveSessionId) {
                    const sessionToUpdate = sessions.find(s => s.id === effectiveSessionId);
                    if (sessionToUpdate) {
                      const currentAttendance = sessionToUpdate.attendance || [];
                      if (!currentAttendance.includes(playerId)) {
                        onUpdateSession({
                          ...sessionToUpdate,
                          attendance: [...currentAttendance, playerId],
                          updatedAt: Date.now()
                        });
                      }
                    }
                  }
                }}
                onRemovePlayerFromAttendance={(playerId) => {
                  if (effectiveSessionId) {
                    const sessionToUpdate = sessions.find(s => s.id === effectiveSessionId);
                    if (sessionToUpdate) {
                      const currentAttendance = sessionToUpdate.attendance || [];
                      const isGuest = playerId.startsWith('guest_');
                      onUpdateSession({
                        ...sessionToUpdate,
                        attendance: currentAttendance.filter(id => id !== playerId),
                        guestPlayers: isGuest ? (sessionToUpdate.guestPlayers || []).filter(p => p.id !== playerId) : sessionToUpdate.guestPlayers,
                        updatedAt: Date.now()
                      });
                    }
                  }
                }}
                initialGame={isEditingActiveExercise 
                  ? exerciseBeingEdited 
                  : (prefilledName ? { name: prefilledName, teams: [], icon: 'Dribbble' } as any : undefined)
                }
                onCancel={() => {
                  if (editReturnView) {
                    setView(editReturnView);
                    setEditReturnView(null);
                  } else if (previousActiveExerciseId) {
                    setView('exercise');
                  } else {
                    setView('training');
                  }
                  if (previousActiveExerciseId !== undefined) {
                    setData(prev => ({ ...prev, activeExerciseId: previousActiveExerciseId }));
                    setPreviousActiveExerciseId(undefined);
                  }
                  setIsEditingActiveExercise(false);
                  setPrefilledName(null);
                  setLinkToMomentId(null);
                }} 
              />
            );
          })()}

          {view === 'squad' && (
            sharedLeaderboardId ? (
              <motion.div
                key="squad-promo"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex-1 flex flex-col items-center justify-center p-8 text-center"
              >
                <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/30 rounded-3xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-6">
                  <Users size={40} />
                </div>
                <h2 className="text-2xl font-black text-zinc-900 dark:text-white mb-4 tracking-tight">Hantera din trupp</h2>
                <p className="text-zinc-500 dark:text-zinc-400 max-w-xs mb-8 font-medium leading-relaxed">
                  Här kan du lägga in din egen trupp om du själv vill använda appen. Gå till den här sidan för att komma igång.
                </p>
                <button
                  onClick={() => {
                    setSharedLeaderboardId(null);
                    const url = new URL(window.location.origin);
                    url.searchParams.set('view', 'squad');
                    window.history.pushState({}, '', url);
                    setView('squad');
                  }}
                  className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 dark:shadow-none flex items-center gap-2"
                >
                  <Rocket size={20} />
                  <span>Lägg in din egen trupp</span>
                </button>
              </motion.div>
            ) : (
              <SquadManager key="squad" squad={squad} onUpdateSquad={handleUpdateSquad} />
            )
          )}

          {view === 'profile' && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto p-4 sm:p-8"
            >
              <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 shadow-xl overflow-hidden">
                <div className="h-32 bg-indigo-600 relative">
                  <div className="absolute -bottom-12 left-8">
                    <div className="w-24 h-24 rounded-3xl border-4 border-white dark:border-zinc-900 bg-white dark:bg-zinc-800 overflow-hidden shadow-lg">
                      {user?.photoURL ? (
                        <CachedImage src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                          <UserIcon size={40} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="pt-16 pb-8 px-8">
                  <div className="flex flex-col gap-5 mb-8 border-b border-zinc-100 dark:border-zinc-800 pb-6">
                    <div>
                      <h2 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
                        {user?.displayName || 'Gäst'}
                      </h2>
                      <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mt-1 font-bold text-sm">
                        <Mail size={14} />
                        <span>{user?.email}</span>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2.5">
                      <button
                        onClick={handleSwitchAccount}
                        className="flex items-center justify-center gap-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-850 dark:text-zinc-200 px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl text-xs sm:text-sm font-extrabold border border-zinc-200 dark:border-zinc-700/60 active:scale-95 transition-all cursor-pointer"
                      >
                        <RotateCcw size={15} />
                        <span>Byt konto</span>
                      </button>
                      <button
                        onClick={handleLogout}
                        className="flex items-center justify-center gap-1.5 bg-red-50 hover:bg-red-105/95 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl text-xs sm:text-sm font-extrabold border border-red-100 dark:border-red-900/30 active:scale-95 transition-all cursor-pointer"
                      >
                        <LogOut size={15} />
                        <span>Logga ut</span>
                      </button>
                      <button
                        onClick={handleManualPull}
                        className="flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100/90 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl text-xs sm:text-sm font-extrabold border border-indigo-100 dark:border-indigo-950/30 active:scale-95 transition-all cursor-pointer"
                      >
                        <Cloud size={15} />
                        <span>Hämta från molnet</span>
                      </button>
                      <button
                        onClick={handleManualPush}
                        className="flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl text-xs sm:text-sm font-extrabold shadow-md hover:shadow-lg active:scale-95 transition-all cursor-pointer"
                      >
                        <Upload size={15} />
                        <span>Spara till molnet</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-zinc-50 dark:bg-zinc-950 p-6 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                      <div className="flex items-center gap-3 mb-4 text-indigo-600 dark:text-indigo-400">
                        <Cloud size={20} />
                        <h3 className="font-black uppercase tracking-wider text-xs">Molnsynkronisering</h3>
                      </div>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                        Dina data sparas automatiskt i molnet och synkas mellan alla dina enheter där du är inloggad.
                      </p>
                      <div className="mt-4 space-y-3">
                        {isQuotaExceeded ? (
                          <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 text-amber-700 dark:text-amber-400">
                            <div className="flex items-center gap-2 text-xs font-bold">
                              <AlertTriangle size={14} className="shrink-0" />
                              <span>Gratis dygnsgräns nådd i molnet</span>
                            </div>
                            <p className="text-[10px] font-medium leading-normal animate-pulse">
                              Datan sparas fortfarande helt säkert lokalt i webbläsaren. Synkronisering återupptas automatiskt när molnet återställs.
                            </p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-xs font-bold">
                            <ShieldCheck size={14} />
                            <span>Aktiv och säker</span>
                          </div>
                        )}
                        {isSyncing && (
                          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-xs font-bold animate-pulse">
                            <RotateCcw size={14} className="animate-spin" />
                            <span>Synkroniserar...</span>
                          </div>
                        )}
                        <div className="pt-2 flex flex-col gap-2">
                          <button
                            onClick={handleManualPull}
                            disabled={isSyncing}
                            className="w-full text-left px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center justify-between group"
                          >
                            <span>Hämta från molnet</span>
                            <Cloud size={14} className="group-hover:translate-y-[-1px] transition-transform" />
                          </button>
                          <button
                            onClick={handleManualPush}
                            disabled={isSyncing}
                            className="w-full text-left px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center justify-between group"
                          >
                            <span>Skicka till molnet</span>
                            <Cloud size={14} className="group-hover:translate-y-[-1px] transition-transform" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="bg-zinc-50 dark:bg-zinc-950 p-6 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                      <div className="flex items-center gap-3 mb-4 text-indigo-600 dark:text-indigo-400">
                        <LayoutDashboard size={20} />
                        <h3 className="font-black uppercase tracking-wider text-xs">Statistik</h3>
                      </div>
                      <div className="space-y-2.5">
                        <div className="flex justify-between items-center border-b border-zinc-100/60 dark:border-zinc-800/50 pb-1.5">
                          <span className="text-sm text-zinc-500">Spelare i truppen</span>
                          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{squad.filter(p => p.role !== 'leader').length} st</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-zinc-100/60 dark:border-zinc-800/50 pb-1.5">
                          <span className="text-sm text-zinc-500">Ledare</span>
                          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{squad.filter(p => p.role === 'leader').length} st</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-zinc-100/60 dark:border-zinc-800/50 pb-1.5">
                          <span className="text-sm text-zinc-500">Antal träningar</span>
                          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{sessions.filter(s => getSessionCategory(s) === 'training').length} st</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-zinc-100/60 dark:border-zinc-800/50 pb-1.5">
                          <span className="text-sm text-zinc-500">Antal matcher</span>
                          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{sessions.filter(s => getSessionCategory(s) === 'match').length} st</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-zinc-100/60 dark:border-zinc-800/50 pb-1.5">
                          <span className="text-sm text-zinc-500">Tävlingsmoment</span>
                          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{exercises.length} st</span>
                        </div>
                        <div className="flex justify-between items-center pb-0.5">
                          <span className="text-sm text-zinc-500">Perioder</span>
                          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{periods.length} st</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {!user && (
                <div className="mt-8 text-center">
                  <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-4">Logga in för att spara din data</h3>
                  <button
                    onClick={handleLogin}
                    className="inline-flex items-center gap-3 bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 dark:shadow-none"
                  >
                    <LogIn size={20} />
                    <span>Logga in med Google</span>
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {view === 'leaderboard' && (
            <Leaderboard 
              key="leaderboard" 
              squad={squad} 
              exercises={exercises} 
              periods={periods}
              currentPeriodId={currentPeriodId}
              onClosePeriod={handleClosePeriod}
              onStartNewPeriod={handleStartNewPeriod}
              onDeletePeriod={handleDeletePeriod}
              onCreatePeriod={createNewPeriod}
              onSwitchPeriod={switchActivePeriod}
              onRenamePeriod={renamePeriod}
              onUpdatePeriod={updatePeriod}
              sharedId={sharedLeaderboardId}
              userUid={user?.uid}
            />
          )}

          {view === 'teampage' && (
            <motion.div
              key="teampage"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col min-h-0 w-full"
            >
              <TeamPage 
                initialUrl={teamUrl}
                onUpdateUrl={handleUpdateTeamUrl}
                initialAdminUrl={adminUrl}
                onUpdateAdminUrl={handleUpdateAdminUrl}
                initialSeriesUrl={seriesUrl}
                onUpdateSeriesUrl={handleUpdateSeriesUrl}
              />
              {/* Spacer for bottom nav when not in standalone full-height mode */}
              <div className="h-20 shrink-0" />
            </motion.div>
          )}

          {view === 'lineup' && (
            <LineupBuilder 
              squad={squad} 
              lineup={activeLineup} 
              lineups={lineups}
              onUpdateLineup={updateLineup}
              onSaveLineup={handleSaveLineup}
              onDeleteLineup={handleDeleteLineup}
              onSelectLineup={(id) => {
                setData(prev => ({ ...prev, activeLineupId: id }));
                setSessionActionCount(prev => prev + 1);
              }}
              onCopyLineup={handleCopyLineup}
              onReorderLineups={handleReorderLineups}
              onUpdateSquad={handleUpdateSquad}
              customFormations={customFormations}
              pinnedFormationIds={pinnedFormationIds}
              onTogglePinFormation={(id) => {
                setData(prev => {
                  const pinned = prev.pinnedFormationIds || ['4-2-3-1', '4-4-2', '4-3-3'];
                  const isPinned = pinned.includes(id);
                  const newPinned = isPinned 
                    ? pinned.filter(pid => pid !== id)
                    : [...pinned, id];
                  return { ...prev, pinnedFormationIds: newPinned };
                });
                setSessionActionCount(prev => prev + 1);
              }}
              onSaveCustomFormation={(formation) => {
                setData(prev => ({
                  ...prev,
                  customFormations: [...(prev.customFormations || []), formation]
                }));
                setSessionActionCount(prev => prev + 1);
              }}
              onDeleteCustomFormation={(id) => {
                setData(prev => ({
                  ...prev,
                  customFormations: (prev.customFormations || []).filter(f => f.id !== id)
                }));
                setSessionActionCount(prev => prev + 1);
              }}
              user={user}
              isSyncing={isSyncing}
              sessionActionCount={sessionActionCount}
              isQuotaExceeded={isQuotaExceeded}
              syncError={syncError}
            />
          )}

          {view === 'exercise' && (
            activeExercise ? (
              <motion.div
                key="exercise"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="max-w-7xl mx-auto w-full h-full flex flex-col p-2 sm:p-4 overflow-hidden select-none"
              >
              {(() => {
                const exerciseSession = activeExercise.sessionId ? sessions.find(s => s.id === activeExercise.sessionId) : null;
                const guestsForExercise = exerciseSession?.guestPlayers || [];
                const combinedExerciseSquad = [...squad, ...guestsForExercise];
                const jokers = Array.from(new Set(activeExercise.jokerPlayerIds || []));
                
                return (
                  <div className="mb-4 sm:mb-6 shrink-0 flex flex-col items-center gap-4">
                    {activeExercise.showTimer && (
                      <div className="w-full max-w-sm">
                        <Timer 
                          defaultMinutes={activeExercise.defaultTimerMinutes} 
                          defaultSeconds={activeExercise.defaultTimerSeconds} 
                          onSaveDefault={updateActiveExerciseDefaultTimer}
                        />
                      </div>
                    )}

                    {/* Neat and small Joker badge/drop-zone */}
                    <div 
                      data-team-id="joker"
                      className={`flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl border transition-all duration-300 ${
                        draggedPlayerId 
                          ? 'bg-indigo-100/40 dark:bg-indigo-950/40 border-dashed border-indigo-400 dark:border-indigo-500 scale-105 animate-pulse shadow-md'
                          : 'bg-indigo-50/60 dark:bg-indigo-950/20 border-indigo-100/80 dark:border-indigo-900/40'
                      }`}
                    >
                      <Zap size={13} className="text-indigo-600 dark:text-indigo-400" fill="currentColor" />
                      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                        Jokrar:
                      </span>
                      
                      <div className="flex flex-wrap gap-1 items-center min-h-[22px]">
                        {Array.from(new Set(jokers as string[])).map((id: string) => {
                          const player = combinedExerciseSquad.find(p => p.id === id);
                          if (!player) return null;
                          return (
                            <motion.span
                              key={id}
                              drag
                              dragSnapToOrigin
                              onDragStart={() => setDraggedPlayerId(id)}
                              onDragEnd={(e: any, info) => {
                                setDraggedPlayerId(null);
                                const point = (e.nativeEvent || e).clientX !== undefined ? (e.nativeEvent || e) : info.point;
                                const x = point.clientX || point.x;
                                const y = point.clientY || point.y;
                                const elements = document.elementsFromPoint(x, y);
                                const teamElement = elements
                                  .map(el => (el as HTMLElement).closest?.('[data-team-id]'))
                                  .find(te => te && te.getAttribute('data-team-id') !== 'joker');

                                if (teamElement) {
                                  const targetTeamId = teamElement.getAttribute('data-team-id');
                                  if (targetTeamId) {
                                    movePlayer(activeExercise.id, id, targetTeamId);
                                  }
                                }
                              }}
                              whileTap={{ scale: 0.95 }}
                              whileDrag={{
                                zIndex: 9999,
                                scale: 1.1,
                                pointerEvents: 'none'
                              }}
                              className="text-[10px] font-black text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 rounded-md cursor-grab active:cursor-grabbing touch-none z-50 shadow-sm select-none"
                            >
                              {player.name}
                            </motion.span>
                          );
                        })}
                        {jokers.length === 0 && (
                          <span className="text-[9px] text-indigo-400/80 dark:text-indigo-500/80 font-semibold uppercase tracking-wider pointer-events-none px-1">
                            Släpp spelare här för Joker
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className={`flex-1 flex flex-col gap-2 sm:gap-3 min-h-0 w-full max-w-2xl mx-auto ${activeExercise.teams.length > 5 ? 'overflow-y-auto' : 'overflow-hidden sm:overflow-y-auto'}`}>
                <AnimatePresence mode="popLayout">
                  {(activeExercise.sortByScore 
                    ? [...activeExercise.teams].sort((a, b) => b.score - a.score)
                    : activeExercise.teams
                  ).filter((team, index, self) => 
                    index === self.findIndex((t) => t.id === team.id)
                  ).map((team) => {
                    const exerciseSession = activeExercise.sessionId ? sessions.find(s => s.id === activeExercise.sessionId) : null;
                    const guestsForExercise = exerciseSession?.guestPlayers || [];
                    const combinedExerciseSquad = [...squad, ...guestsForExercise];

                    return (
                      <motion.div 
                        layout
                        key={team.id} 
                        className={`${activeExercise.teams.length > 5 ? 'h-24 shrink-0' : 'flex-1'} min-h-0 flex flex-col`}
                      >
                        <PlayerCard
                          team={team}
                          squad={combinedExerciseSquad}
                          rank={sortedScores.indexOf(team.score) + 1}
                          onUpdateScore={updateScore}
                          onUpdateColor={updateTeamColor}
                          onRankClick={handleRankClick}
                          disabled={activeExercise.isFinished}
                          exerciseId={activeExercise.id}
                          onMovePlayer={movePlayer}
                          draggedPlayerId={draggedPlayerId}
                          isAnyPlayerDragging={!!draggedPlayerId}
                          onDragStart={(pid) => setDraggedPlayerId(pid)}
                          onDragEnd={() => setDraggedPlayerId(null)}
                        />
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </motion.div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-zinc-950">
                <div className="w-20 h-20 bg-zinc-100 dark:bg-zinc-800 rounded-3xl flex items-center justify-center text-zinc-400 mb-6">
                  <Trophy size={40} />
                </div>
                <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">Tävlingsmomentet hittades inte</h3>
                <p className="text-zinc-500 dark:text-zinc-400 mb-8 max-w-xs font-medium">
                  Detta kan bero på att momentet har tagits bort eller att du navigerat fel.
                </p>
                <button
                  onClick={() => setView('training')}
                  className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 dark:shadow-none"
                >
                  Gå tillbaka till kalendern
                </button>
              </div>
            )
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      {view !== 'exercise' && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 px-6 py-3 z-40 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
          <div className="max-w-xl mx-auto flex items-center justify-between gap-1">
            <button
              onClick={() => setView('training')}
              className={`flex-1 flex flex-col items-center gap-1 transition-colors ${view === 'training' ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400 hover:text-zinc-600'}`}
            >
              <Calendar size={24} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Kalender</span>
            </button>
            <button
              onClick={() => setView('leaderboard')}
              className={`flex-1 flex flex-col items-center gap-1 transition-colors ${view === 'leaderboard' ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400 hover:text-zinc-600'}`}
            >
              <LayoutDashboard size={24} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-center">Poängliga</span>
            </button>
            <button
              onClick={() => setView('squad')}
              className={`flex-1 flex flex-col items-center gap-1 transition-colors ${view === 'squad' ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400 hover:text-zinc-600'}`}
            >
              <Users size={24} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-center">Truppen</span>
            </button>
            <button
              onClick={() => setView('lineup')}
              className={`flex-1 flex flex-col items-center gap-1 transition-colors ${view === 'lineup' ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400 hover:text-zinc-600'}`}
            >
              <Layout size={24} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-center">Laguppst.</span>
            </button>
            <button
              onClick={() => setView('teampage')}
              className={`flex-1 flex flex-col items-center gap-1 transition-colors ${view === 'teampage' ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400 hover:text-zinc-600'}`}
            >
              <Globe size={24} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-center">Lagsida</span>
            </button>
          </div>
        </nav>
      )}

      <AnimatePresence>
        {showTeamOverview && activeExercise && (
          <TeamOverviewModal
            exercise={activeExercise}
            squad={[...squad, ...(sessions.find(s => s.id === activeExercise.sessionId)?.guestPlayers || [])]}
            attendingIds={sessions.find(s => s.id === activeExercise.sessionId)?.attendance}
            onMovePlayer={movePlayer}
            onClose={() => setShowTeamOverview(false)}
            exercises={data.exercises}
            onCopyTeams={(sourceId) => copyTeams(sourceId, activeExercise.id)}
            onAddGuest={(name, position) => {
              const session = sessions.find(s => s.id === activeExercise.sessionId);
              if (session) {
                const newGuest = {
                  id: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                  name: name.trim(),
                  position: position || undefined,
                };
                onUpdateSession({
                  ...session,
                  guestPlayers: [...(session.guestPlayers || []), newGuest],
                  attendance: [...(session.attendance || []), newGuest.id],
                  updatedAt: Date.now()
                });
              }
            }}
            onAddSquadPlayerToAttendance={(playerId) => {
              const session = sessions.find(s => s.id === activeExercise.sessionId);
              if (session) {
                const currentAttendance = session.attendance || [];
                if (!currentAttendance.includes(playerId)) {
                  onUpdateSession({
                    ...session,
                    attendance: [...currentAttendance, playerId],
                    updatedAt: Date.now()
                  });
                }
              }
            }}
            onRemovePlayerFromAttendance={(playerId) => {
              const session = sessions.find(s => s.id === activeExercise.sessionId);
              if (session) {
                const currentAttendance = session.attendance || [];
                const isGuest = playerId.startsWith('guest_');
                onUpdateSession({
                  ...session,
                  attendance: currentAttendance.filter(id => id !== playerId),
                  guestPlayers: isGuest ? (session.guestPlayers || []).filter(p => p.id !== playerId) : session.guestPlayers,
                  updatedAt: Date.now()
                });
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Sessions & Overlays */}
      <AnimatePresence>
        {activeSessionId && sessions.find(s => s.id === activeSessionId) && view !== 'exercise' && view !== 'setup' && (
          <SessionEditor
            session={sessions.find(s => s.id === activeSessionId)!}
            exercises={exercises}
            squad={squad}
            onUpdate={(updated) => onUpdateSession({ ...updated, isLocallyEdited: true, isPlanned: true })}
            allSessions={sessions}
            onUpdateSession={(updated) => onUpdateSession({ ...updated, isLocallyEdited: true, isPlanned: true })}
            exerciseBank={exerciseBank}
            exerciseBankCategories={exerciseBankCategories}
            onSaveToBank={saveMomentToBank}
            onUpdateBankExercise={updateBankExercise}
            initialMode={sessionMode}
            onModeChange={setSessionMode}
            onMovePlayer={movePlayer}
            onCopyTeams={copyTeams}
            initialTab={sessionEditorTab}
            adminUrl={adminUrl}
            onClose={() => {
              setActiveSessionId(null);
              setLinkToMomentId(null);
            }}
            onCreateExercise={(name, momentId) => {
              setPreviousActiveExerciseId(activeExerciseId);
              setLinkToMomentId(momentId);
              setPrefilledName(name || 'Nytt tävlingsmoment');
              setEditReturnView('training');
              setIsEditingActiveExercise(false);
              setView('setup');
              setSessionActionCount(prev => prev + 1);
              return ""; 
            }}
            onSelectExercise={(id) => {
              setData(prev => ({ ...prev, activeExerciseId: id }));
              setView('exercise');
              setSessionActionCount(prev => prev + 1);
              // We DON'T call setActiveSessionId(null) here because we want to come back to it
            }}
            onEditExercise={(id) => {
              setPreviousActiveExerciseId(activeExerciseId);
              setData(prev => ({ ...prev, activeExerciseId: id }));
              setEditReturnView('training');
              setIsEditingActiveExercise(true);
              setView('setup');
              setSessionActionCount(prev => prev + 1);
            }}
            onDeleteExercise={deleteExercise}
          />
        )}
      </AnimatePresence>

      {/* Confirmation Modals */}
      <AnimatePresence>

        {showResetConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowResetConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">Nollställ poäng?</h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-8">
                Detta kommer att sätta alla lags poäng till 0. Handlingen kan inte ångras.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={resetScores}
                  className="w-full py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
                >
                  Ja, nollställ
                </button>
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="w-full py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Avbryt
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showFinishConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowFinishConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-2xl flex items-center justify-center text-green-600 dark:text-green-400 mb-6 mx-auto">
                <Trophy size={32} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2 text-center">Avsluta tävlingsmomentet?</h3>
              
              <div className="mb-6">
                <label className="block text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-2 text-center">
                  Klarmarkera mot tävling
                </label>
                <select
                  value={finishTargetPeriodId || ''}
                  onChange={(e) => setFinishTargetPeriodId(e.target.value || null)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm font-bold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                >
                  <option value="">Ingen tävling (endast arkiv)</option>
                  {Array.from(new Map<string, Period>(periods.filter(p => !p.endDate).map(p => [p.id, p])).values()).map((p: Period) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.isActive ? '(Aktiv)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-zinc-500 dark:text-zinc-400 mb-8 text-sm text-center leading-relaxed">
                Detta kommer att kora vinnare och dela ut poäng till spelarna i den valda tävlingen.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={finishExercise}
                  className="w-full py-4 bg-green-600 text-white rounded-2xl font-bold hover:bg-green-700 transition-all shadow-lg shadow-green-200 dark:shadow-none"
                >
                  Ja, avsluta och kora vinnare
                </button>
                <button
                  onClick={() => setShowFinishConfirm(false)}
                  className="w-full py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                >
                  Fortsätt tävlingsmomentet
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
