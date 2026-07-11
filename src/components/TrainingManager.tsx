import React, { useState } from 'react';
import { Calendar, Trophy, Clock, Trash2, Copy, History, ListTodo, FileText, X, ArrowUpDown, ChevronLeft, ChevronRight, RefreshCw, EyeOff, Eye, CalendarDays, MapPin, CheckCircle, HelpCircle, ChevronDown, ChevronUp, ArrowRight, Edit, Library } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Exercise, TrainingSession, TrainingSettings, BankExercise } from '../types';
import GameList from './GameList';
import TeamOverviewModal from './TeamOverviewModal';
import MobileCalendarView from './MobileCalendarView';
import ExerciseBankView from './ExerciseBankView';

interface TrainingManagerProps {
  exercises: Exercise[];
  sessions: TrainingSession[];
  deletedSessions?: TrainingSession[];
  squad: any[];
  onSelectExercise: (id: string) => void;
  onDeleteExercise: (id: string) => void;
  onCopyExercise: (id: string) => void;
  onEditExercise: (id: string) => void;
  onReorderExercises: (exercises: Exercise[]) => void;
  onNewExercise: () => void;
  onNewSession: () => void;
  onAddSessionsBatch?: (newSessions: TrainingSession[]) => void;
  onSelectSession: (id: string, initialTab?: 'schema' | 'attendance') => void;
  onDeleteSession: (id: string) => void;
  onRestoreSession?: (id: string) => void;
  onDeleteSessionPermanent?: (ids: string | string[]) => void;
  onCopySession: (id: string) => void;
  onReorderSessions: (sessions: TrainingSession[]) => void;
  onUpdateSession: (updated: TrainingSession) => void;
  onMovePlayer: (exerciseId: string, playerId: string, targetTeamId: string) => void;
  onCopyTeams?: (sourceId: string, targetId: string) => void;
  activeTab: 'completed' | 'exercises' | 'calendar_view' | 'bank';
  onTabChange: (tab: 'completed' | 'exercises' | 'calendar_view' | 'bank') => void;
  settings?: TrainingSettings;
  onUpdateSettings?: (settings: TrainingSettings) => void;
  openSettings?: boolean;
  onCloseSettings?: () => void;
  isCloudDataLoaded?: boolean;
  exerciseBank?: BankExercise[];
  exerciseBankCategories?: string[];
  onAddBankCategory?: (category: string) => void;
  onRemoveBankCategory?: (category: string) => void;
  onAddBankExercise?: (exercise: Omit<BankExercise, "id" | "createdAt">) => void;
  onUpdateBankExercise?: (id: string, updates: Partial<BankExercise>) => void;
  onRemoveBankExercise?: (id: string) => void;
}

const isSessionPassed = (session: TrainingSession) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sessionDate = new Date(session.date);
  sessionDate.setHours(0, 0, 0, 0);
  return sessionDate.getTime() < today.getTime();
};

const isSessionCompletedOrPassed = (session: TrainingSession) => {
  return !!session.isCompleted || isSessionPassed(session);
};

function getSessionDurationInMinutes(startTime?: string, endTime?: string): number | null {
  if (!startTime || !endTime) return null;
  const startMatch = startTime.trim().match(/^(\d{1,2}):(\d{2})$/);
  const endMatch = endTime.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!startMatch || !endMatch) return null;
  
  const startMin = parseInt(startMatch[1], 10) * 60 + parseInt(startMatch[2], 10);
  const endMin = parseInt(endMatch[1], 10) * 60 + parseInt(endMatch[2], 10);
  
  const diff = endMin - startMin;
  if (diff < 0) {
    return diff + 1440; // Past midnight
  }
  return diff;
}

const categorizeSession = (session: TrainingSession): 'match' | 'training' | 'other' => {
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

const getCatConfig = (category: 'match' | 'training' | 'other') => {
  const configs = {
    match: {
      borderClass: 'border-l-4 border-emerald-500',
      badgeClass: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-650 dark:text-emerald-400 border-emerald-150',
      label: 'Match',
      icon: <Trophy size={11} strokeWidth={2.5} />
    },
    training: {
      borderClass: 'border-l-4 border-indigo-500',
      badgeClass: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-650 dark:text-indigo-400 border-indigo-150',
      label: 'Träning',
      icon: <Clock size={11} strokeWidth={2.5} />
    },
    other: {
      borderClass: 'border-l-4 border-amber-500',
      badgeClass: 'bg-amber-50 dark:bg-amber-950/40 text-amber-650 dark:text-amber-400 border-amber-150',
      label: 'Övrigt',
      icon: <HelpCircle size={11} strokeWidth={2.5} />
    }
  };
  return configs[category];
};

function renderTextWithLinks(text: string) {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const parts = text.split(urlRegex);
  if (parts.length === 1) return text;

  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      const href = part.startsWith('http') ? part : `https://${part}`;
      return (
        <a
          key={index}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          onClick={(e) => e.stopPropagation()}
          className="text-indigo-600 dark:text-indigo-400 hover:underline underline-offset-4 font-extrabold"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

function SessionItem({ 
  session, 
  date: _date, 
  totalMinutes, 
  onSelectSession, 
  setSessionToDelete,
  onCopySession,
  onUpdateSession,
  squad
}: { 
  session: TrainingSession, 
  date: string, 
  totalMinutes: number, 
  onSelectSession: (id: string, initialTab?: 'schema' | 'attendance') => void, 
  setSessionToDelete: (id: string) => void,
  onCopySession: (id: string) => void,
  onUpdateSession: (updated: TrainingSession) => void,
  squad: any[],
  key?: string
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const category = categorizeSession(session);
  const catConfig = getCatConfig(category);

  // Date details
  const dObj = new Date(session.date);
  const weekdayStr = dObj.toLocaleDateString('sv-SE', { weekday: 'short' }).toUpperCase().replace('.', '').slice(0, 3);
  const dayStr = dObj.getDate();
  const monthStr = dObj.toLocaleDateString('sv-SE', { month: 'short' }).toUpperCase().replace('.', '').slice(0, 3);

  const sessionDuration = getSessionDurationInMinutes(session.startTime, session.endTime);
  let durationText = '';
  if (category === 'match') {
    if (sessionDuration !== null) {
      durationText = `${sessionDuration} min`;
    }
  } else {
    if (sessionDuration !== null && totalMinutes > 0) {
      durationText = `${sessionDuration} min, Planerat: ${totalMinutes} min`;
    } else if (sessionDuration !== null) {
      durationText = `${sessionDuration} min`;
    } else if (totalMinutes > 0) {
      durationText = `Planerat: ${totalMinutes} min`;
    }
  }

  // Attendance calculations
  const attendingLeaderIds = squad ? squad.filter((p: any) => p.role === 'leader').map((p: any) => p.id) : [];
  const registeredLeadersCount = squad ? (session.attendance || []).filter(id => attendingLeaderIds.includes(id)).length : 0;
  const registeredPlayersCount = squad ? (session.attendance || []).length - registeredLeadersCount : 0;

  const totalPlayersSquad = squad ? squad.filter((p: any) => p.role !== 'leader').length + (session.guestPlayers?.length || 0) : 0;
  const totalLeadersSquad = squad ? squad.filter((p: any) => p.role === 'leader').length : 0;

  return (
    <motion.div
      key={session.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-150 dark:border-zinc-500 shadow-sm hover:shadow-md transition-all overflow-hidden relative z-0 ${catConfig.borderClass}`}
    >
      {/* Main card interface */}
      <div 
        onClick={() => setIsExpanded(prev => !prev)}
        className="p-4 cursor-pointer select-none active:bg-zinc-50/50 dark:active:bg-zinc-800/30 transition-colors"
      >
        {/* Title & Chevron Row */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <h4 className="text-zinc-900 dark:text-white font-black text-sm uppercase tracking-tight group-hover:text-indigo-600 transition-colors select-text flex-1">
            {(() => {
              const rawTitle = session.title || 'Träning';
              let cleanTitle = rawTitle.replace(/match\s*/gi, '');
              // Remove leading colons, hyphens or spaces
              cleanTitle = cleanTitle.replace(/^[:\-\s]+/, '').trim();
              if (cleanTitle) {
                return cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
              }
              return rawTitle;
            })()}
          </h4>
          {/* Chevron collapse indicator */}
          <div className="p-1.5 rounded-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-150 dark:border-zinc-700/60 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 shrink-0 self-start">
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </div>

        {/* Details Row under the title */}
        <div className="flex items-start gap-4">
          {/* Compact Left Date Badge */}
          <div className="flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950/60 rounded-xl px-2 py-1.5 min-w-[50px] border border-zinc-150 dark:border-zinc-800 text-center select-none shadow-inner shrink-0 leading-none">
            <span className="text-[9px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-0.5">
              {weekdayStr}
            </span>
            <span className="text-lg font-black text-zinc-900 dark:text-white">
              {dayStr}
            </span>
            <span className="text-[8px] font-black text-zinc-400 dark:text-zinc-500 tracking-wider mt-0.5">
              {monthStr}
            </span>
          </div>

          {/* Mid Details area */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 border text-[9px] font-black rounded-lg uppercase tracking-wider ${catConfig.badgeClass}`}>
                {catConfig.icon}
                <span>{catConfig.label}</span>
              </span>
              
              {isSessionCompletedOrPassed(session) ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateSession({ ...session, isCompleted: false });
                  }}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-600 dark:bg-green-700 text-white text-[9px] font-black rounded-lg uppercase tracking-wider border border-green-700 hover:bg-green-700 dark:hover:bg-green-600 cursor-pointer active:scale-95 transition-all"
                  title="Markera som ej klarmarkerad"
                >
                  <CheckCircle size={9} />
                  <span>Klar</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateSession({ ...session, isCompleted: true });
                  }}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-50 hover:bg-green-100 dark:bg-green-955/30 text-green-600 dark:text-green-400 text-[9px] font-black rounded-lg uppercase tracking-wider border border-green-150/40 cursor-pointer active:scale-95 transition-all"
                  title="Klicka för att klarmarkera"
                >
                  <CheckCircle size={9} />
                  <span>Klar?</span>
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectSession(session.id);
                }}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-955/30 text-indigo-600 dark:text-indigo-400 text-[9px] font-black rounded-lg uppercase tracking-wider border border-indigo-150/40 cursor-pointer active:scale-95 transition-all"
                title="Klicka för att redigera aktiviteten"
              >
                <Edit size={9} />
                <span>Redigera</span>
              </button>
            </div>

            {/* Time & Place row */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 text-[11px] font-medium font-bold">
                <Clock size={12} className="text-zinc-900 dark:text-zinc-100 shrink-0" />
                <span className="capitalize text-zinc-900 dark:text-white font-black">
                  kl. {session.startTime} {session.endTime ? ` - ${session.endTime}` : ''}
                </span>
                {durationText && (
                  <span className="text-zinc-400 dark:text-zinc-500 text-[10px] font-normal">
                    ({durationText})
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 text-[11px] font-bold flex-wrap">
                <MapPin size={12} className={session.location ? 'text-rose-500' : 'text-zinc-350'} />
                <span className={`truncate select-text ${session.location ? 'text-indigo-505 dark:text-indigo-400' : 'text-zinc-400 italic font-medium'}`}>
                  {session.location || 'Plats ej angiven'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/50">
          <div className="flex items-center gap-1 text-[10px] text-zinc-404 dark:text-zinc-500 uppercase tracking-wider font-bold">
            {category !== 'match' && (
              <>
                <ListTodo size={12} />
                <span>{session.moments.length} moment</span>
                <span className="text-zinc-350 dark:text-zinc-704">•</span>
                <span>Planerat: {totalMinutes} min</span>
              </>
            )}
            
            <div className="mx-2 h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
            
            <div className="flex items-center gap-2 shrink-0 select-none">
              <div className="flex items-center gap-1 flex-wrap">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopySession(session.id);
                  }}
                  className="p-1.5 text-zinc-400 hover:text-indigo-500 transition-colors bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-lg cursor-pointer"
                  title="Kopiera träningspass"
                >
                  <Copy size={13} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateSession({ ...session, isIgnored: !session.isIgnored });
                  }}
                  className={`p-1.5 transition-colors border rounded-lg cursor-pointer ${
                    session.isIgnored
                      ? "text-indigo-650 bg-indigo-50 dark:bg-indigo-950 hover:bg-indigo-100 dark:hover:bg-indigo-900 border-indigo-200 dark:border-indigo-850"
                      : "text-zinc-400 hover:text-amber-500 bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700"
                  }`}
                  title={session.isIgnored ? "Återställ pass (visa i listan)" : "Ignorera och dölj pass"}
                >
                  {session.isIgnored ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSessionToDelete(session.id);
                  }}
                  className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-lg cursor-pointer"
                  title="Radera träningspass"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>

          {/* Progress preview */}
          {category !== 'match' && session.moments && session.moments.length > 0 && (
            <div className="mt-2.5 flex gap-1 h-1 select-none">
              {session.moments.map((m, i) => (
                <div 
                  key={i} 
                  className="h-full rounded-full bg-indigo-100 dark:bg-indigo-900/20"
                  style={{ flex: m.duration }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Expandable detailed drawer */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-zinc-50/60 dark:bg-zinc-950/25 border-t border-zinc-100 dark:border-zinc-800/70 overflow-hidden"
          >
            <div className="p-4 text-xs font-medium space-y-4">
              {/* Action buttons (Öppna Planering) */}
              <div className="flex items-center justify-start pb-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSession(session.id);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 bg-indigo-600 text-white rounded-xl font-black hover:bg-indigo-700 text-[10px] uppercase shadow-md shadow-indigo-100 dark:shadow-none transition-all active:scale-95 cursor-pointer inline-flex"
                >
                  <span>Öppna Planering</span>
                  <ArrowRight size={11} strokeWidth={2.5} />
                </button>
              </div>

              {/* Attendance snapshot */}
              <div 
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectSession(session.id, 'attendance');
                }}
                className="bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-150 dark:border-zinc-800 shadow-sm p-3.5 rounded-xl cursor-pointer transition-all active:scale-[0.99] group/attendance"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <p className="font-black text-[9px] text-zinc-400 group-hover/attendance:text-indigo-650 dark:group-hover/attendance:text-indigo-400 uppercase tracking-widest transition-colors">Anmälda spelare</p>
                  <span className="text-[10px] text-indigo-654 dark:text-indigo-400 font-extrabold flex items-center gap-0.5 opacity-0 group-hover/attendance:opacity-100 transition-opacity">
                    Öppna deltagarlistan <ArrowRight size={10} />
                  </span>
                </div>
                <div className="space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300 font-bold">
                  {totalLeadersSquad > 0 ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span>Spelarnärvaro:</span>
                        <span className="text-indigo-650 dark:text-indigo-400 font-extrabold text-xs">
                          {registeredPlayersCount} av {totalPlayersSquad}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-zinc-400 dark:text-zinc-500 text-[11px]">
                        <span>Ledarnärvaro:</span>
                        <span>
                          {registeredLeadersCount} av {totalLeadersSquad}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between text-zinc-700 dark:text-zinc-300 font-bold">
                      <span>Gemensam träningsnärvaro:</span>
                      <span className="text-indigo-650 dark:text-indigo-400 font-extrabold text-xs">
                        {registeredPlayersCount} av {totalPlayersSquad}
                      </span>
                    </div>
                  )}
                </div>
                <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 mt-2 overflow-hidden">
                  <div 
                    className="bg-indigo-650 h-full rounded-full transition-all"
                    style={{ width: `${totalPlayersSquad > 0 ? (registeredPlayersCount / totalPlayersSquad) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Syfte & Anteckningar (Coach notes) */}
              {session.notes ? (
                <div className="bg-amber-50/75 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/60 p-3.5 rounded-xl shadow-sm mt-1.5">
                  <div className="flex items-center gap-1.5 font-black text-[9px] text-amber-750 dark:text-amber-400 uppercase tracking-widest mb-2 border-b border-amber-200/30 dark:border-amber-900/30 pb-1.5">
                    <FileText size={11} className="text-amber-500" />
                    <span>Syfte & Anteckningar</span>
                  </div>
                  <p className="text-zinc-800 dark:text-zinc-200 leading-relaxed font-bold break-words whitespace-pre-wrap select-text">
                    {renderTextWithLinks(session.notes || '')}
                  </p>
                </div>
              ) : null}

              {/* Information / Beskrivning (Practical synced calendar description) */}
              {session.description ? (
                <div className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 p-3.5 rounded-xl shadow-sm mt-1">
                  <div className="flex items-center gap-1.5 font-black text-[9px] text-zinc-400 uppercase tracking-widest mb-2 border-b border-zinc-50 dark:border-zinc-800 pb-1.5">
                    <FileText size={11} className="text-zinc-400" />
                    <span>Information / Beskrivning (från kalender)</span>
                  </div>
                  <p className="text-zinc-650 dark:text-zinc-350 leading-relaxed font-bold break-words whitespace-pre-wrap select-text">
                    {renderTextWithLinks(session.description || '')}
                  </p>
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function TrainingManager({
  exercises,
  sessions,
  deletedSessions = [],
  squad,
  onSelectExercise,
  onDeleteExercise,
  onCopyExercise,
  onEditExercise,
  onReorderExercises,
  onNewExercise,
  onNewSession,
  onAddSessionsBatch,
  onSelectSession,
  onDeleteSession,
  onRestoreSession,
  onDeleteSessionPermanent,
  onCopySession,
  onReorderSessions,
  onUpdateSession,
  onMovePlayer,
  onCopyTeams,
  activeTab,
  onTabChange,
  settings,
  onUpdateSettings,
  openSettings,
  onCloseSettings,
  isCloudDataLoaded = true,
  exerciseBank = [],
  exerciseBankCategories = [],
  onAddBankCategory,
  onRemoveBankCategory,
  onAddBankExercise,
  onUpdateBankExercise,
  onRemoveBankExercise
}: TrainingManagerProps) {
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [sessionToPermanentDelete, setSessionToPermanentDelete] = useState<string | null>(null);
  const [showClearTrashConfirm, setShowClearTrashConfirm] = useState(false);
  const [selectedExerciseForTeams, setSelectedExerciseForTeams] = useState<string | null>(null);
  
  const [localShowSettings, setLocalShowSettings] = useState(false);
  const showSettings = openSettings !== undefined ? openSettings : localShowSettings;
  const setShowSettings = (val: boolean) => {
    if (openSettings !== undefined) {
      if (!val && onCloseSettings) onCloseSettings();
    } else {
      setLocalShowSettings(val);
    }
  };

  const [showTrashModal, setShowTrashModal] = useState(false);

  // Series creation states
  const [showSeriesModal, setShowSeriesModal] = useState(false);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [seriesStartTime, setSeriesStartTime] = useState('');
  const [seriesDuration, setSeriesDuration] = useState<number | ''>('');
  const [seriesTitle, setSeriesTitle] = useState('');
  const [manualDateInput, setManualDateInput] = useState('');

  // Sorting states
  const [completedSortAsc, setCompletedSortAsc] = useState(false); // Default to false (newest/latest first)
  const [showIgnoredInCompleted, setShowIgnoredInCompleted] = useState(false);

  // Series creation helpers
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    // In Swedish/ISO calendars, Monday is 1st day. Sunday in JS Date is 0.
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    const totalDays = new Date(year, month + 1, 0).getDate();
    return { offset, totalDays, year, month };
  };

  const handleCreateSeries = () => {
    if (selectedDates.length === 0) {
      alert("Välj minst ett datum för serien.");
      return;
    }

    const created: TrainingSession[] = selectedDates.map(dateStr => {
      const [year, colMonth, day] = dateStr.split('-').map(Number);
      // set to noon in local time to avoid timezone wraps
      const sessionDate = new Date(year, colMonth - 1, day, 12, 0, 0).getTime();
      
      const startTime = seriesStartTime || settings?.defaultStartTime || '18:00';
      const duration = seriesDuration ? Number(seriesDuration) : (settings?.defaultDuration || 90);
      
      // Calculate end time
      const [h, m] = startTime.split(':').map(Number);
      const tempDate = new Date();
      tempDate.setHours(h, m, 0, 0);
      tempDate.setMinutes(tempDate.getMinutes() + duration);
      const endTime = tempDate.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

      return {
        id: crypto.randomUUID(),
        title: seriesTitle.trim() || 'Träningspass',
        date: sessionDate,
        startTime,
        endTime,
        moments: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    });

    if (onAddSessionsBatch) {
      onAddSessionsBatch(created);
    }
    
    // Reset and close
    setSelectedDates([]);
    setSeriesTitle('');
    setSeriesStartTime('');
    setSeriesDuration('');
    setShowSeriesModal(false);
  };

  const { offset, totalDays, year: viewYear, month: viewMonth } = getDaysInMonth(currentMonth);

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const toggleDate = (dateStr: string) => {
    setSelectedDates(prev => 
      prev.includes(dateStr) 
        ? prev.filter(d => d !== dateStr) 
        : [...prev, dateStr].sort()
    );
  };

  const handleAddManualDate = () => {
    if (manualDateInput && !selectedDates.includes(manualDateInput)) {
      setSelectedDates(prev => [...prev, manualDateInput].sort());
      setManualDateInput('');
    }
  };

  // Local state for settings editing to avoid immediate sync noise
  const [localStartTime, setLocalStartTime] = useState(settings?.defaultStartTime || '18:00');
  const [localDuration, setLocalDuration] = useState(settings?.defaultDuration || 90);
  const [localEndTime, setLocalEndTime] = useState(settings?.defaultEndTime || '19:30');
  
  const [localIcsUrl, setLocalIcsUrl] = useState(settings?.icsUrl || '');
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [hasAutoSynced, setHasAutoSynced] = useState(false);

  const [showConfirmClearPast, setShowConfirmClearPast] = useState(false);
  const [showConfirmClearFuture, setShowConfirmClearFuture] = useState(false);

  const pastSessionsWithNotes = sessions.filter(s => isSessionPassed(s) && s.notes && s.notes.trim() !== '');
  const futureSessionsWithNotes = sessions.filter(s => !isSessionPassed(s) && s.notes && s.notes.trim() !== '');

  const handleClearNotes = (target: 'past' | 'future') => {
    const targetSessions = sessions.filter(s => {
      const isPast = isSessionPassed(s);
      const isMatched = target === 'past' ? isPast : !isPast;
      return isMatched && s.notes && s.notes.trim() !== '';
    });

    targetSessions.forEach(s => {
      onUpdateSession({
        ...s,
        notes: '',
        updatedAt: Date.now()
      });
    });

    if (target === 'past') {
      setShowConfirmClearPast(false);
    } else {
      setShowConfirmClearFuture(false);
    }
  };

  // Synchronize local setting states with outer props when they update (e.g., from cloud Firestore sync)
  const prevShowSettingsRef = React.useRef(showSettings);
  React.useEffect(() => {
    const wasClosed = !prevShowSettingsRef.current;
    if ((!showSettings || (showSettings && wasClosed)) && settings) {
      setLocalStartTime(settings.defaultStartTime || '18:00');
      setLocalDuration(settings.defaultDuration || 90);
      setLocalEndTime(settings.defaultEndTime || calculateEndTime(settings.defaultStartTime || '18:00', settings.defaultDuration || 90));
      setLocalIcsUrl(settings.icsUrl || '');
    }
    prevShowSettingsRef.current = showSettings;
  }, [settings, showSettings]);

  const handleSyncCalendar = async (customUrl?: string, isSilent = false) => {
    const urlToUse = customUrl !== undefined ? customUrl : settings?.icsUrl;
    if (!urlToUse) {
      if (!isSilent) {
        alert("Ange en kalenderlänk (webcal/ics) under Inställningar först.");
      }
      return;
    }

    setIsSyncing(true);
    if (!isSilent) {
      setSyncMessage("Hämtar kalender...");
    }

    try {
      const response = await fetch(`/api/fetch-calendar?url=${encodeURIComponent(urlToUse)}`);
      if (!response.ok) {
        throw new Error(`Kunde inte hämta kalendern (Status ${response.status})`);
      }

      if (!isSilent) {
        setSyncMessage("Tolkar kalender...");
      }
      const icsData = await response.text();
      
      const { parseIcsCalendar } = await import('../utils/icsParser');
      const events = parseIcsCalendar(icsData);

      if (events.length === 0) {
        if (!isSilent) {
          setSyncMessage("Hittade inga händelser i kalendern.");
          setTimeout(() => setSyncMessage(null), 3500);
        }
        setIsSyncing(false);
        return;
      }

      const formatToYYYYMMDD = (timestamp: number) => {
        const d = new Date(timestamp);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const r = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${r}`;
      };

      const existingSessions = sessions || [];
      const newSessions: TrainingSession[] = [];
      let skippedCount = 0;
      let updatedCount = 0;

      for (const ev of events) {
        const matchByExternalId = existingSessions.find(s => s.externalId === ev.externalId);
        const matchByDateTime = !matchByExternalId && existingSessions.find(s => {
          return formatToYYYYMMDD(s.date) === formatToYYYYMMDD(ev.date) && s.startTime === ev.startTime;
        });

        const matchedSession = matchByExternalId || matchByDateTime;

        if (matchedSession) {
          if (matchedSession.isCompleted || matchedSession.isIgnored) {
            skippedCount++;
            continue;
          }

          // Strict protection check: Identify if this matched session represents an active planned activity.
          // If a session has planned moments, coach notes, is started, or is flagged as isPlanned or isLocallyEdited,
          // it must never be overwritten/amended by external automated calendar imports.
          const isPlannedActive = 
            (matchedSession.moments && matchedSession.moments.length > 0) ||
            (matchedSession.notes && matchedSession.notes.trim() !== '') ||
            matchedSession.isStarted ||
            (!forceOverwrite && (matchedSession.isPlanned || matchedSession.isLocallyEdited));

          if (isPlannedActive) {
            skippedCount++;
            continue;
          }

          let changed = false;
          const updated = { ...matchedSession };
          
          if (updated.title !== ev.title) {
            updated.title = ev.title;
            changed = true;
          }
          if (formatToYYYYMMDD(updated.date) !== formatToYYYYMMDD(ev.date)) {
            updated.date = ev.date;
            changed = true;
          }
          if (updated.startTime !== ev.startTime) {
            updated.startTime = ev.startTime;
            changed = true;
          }
          if (ev.endTime && updated.endTime !== ev.endTime) {
            updated.endTime = ev.endTime;
            changed = true;
          }
          if (ev.location && updated.location !== ev.location) {
            updated.location = ev.location;
            changed = true;
          }
          if (ev.description && updated.description !== ev.description) {
            updated.description = ev.description;
            changed = true;
          }
          if (!updated.externalId && ev.externalId) {
            updated.externalId = ev.externalId;
            changed = true;
          }

          if (changed) {
            updated.updatedAt = Date.now();
            onUpdateSession(updated);
            updatedCount++;
          } else {
            skippedCount++;
          }
        } else {
          const newSession: TrainingSession = {
            id: crypto.randomUUID(),
            title: ev.title,
            date: ev.date,
            startTime: ev.startTime,
            endTime: ev.endTime || undefined,
            location: ev.location || undefined,
            moments: [],
            description: ev.description || undefined,
            externalId: ev.externalId,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          newSessions.push(newSession);
        }
      }

      if (newSessions.length > 0) {
        onAddSessionsBatch?.(newSessions);
      }

      if (!isSilent || newSessions.length > 0 || updatedCount > 0) {
        setSyncMessage(
          `Synk klar! Importerade: ${newSessions.length} nya pass, Uppdaterade: ${updatedCount} pass. (Hoppade över: ${skippedCount})`
        );
        setTimeout(() => setSyncMessage(null), 5000);
      }
    } catch (error: any) {
      console.error(error);
      if (!isSilent) {
        setSyncMessage(`Fel vid synkning: ${error.message}`);
        setTimeout(() => setSyncMessage(null), 6000);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  React.useEffect(() => {
    if (settings?.icsUrl && !hasAutoSynced && isCloudDataLoaded) {
      setHasAutoSynced(true);
      handleSyncCalendar(settings.icsUrl, true);
    }
  }, [settings?.icsUrl, hasAutoSynced, isCloudDataLoaded]);

  const calculateEndTime = (start: string, duration: number) => {
    const [h, m] = start.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m, 0, 0);
    date.setMinutes(date.getMinutes() + duration);
    return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  };

  const calculateDuration = (start: string, end: string) => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff < 0) diff += 24 * 60;
    return diff;
  };

  const sortSessionsByDate = () => {
    const nextAsc = !completedSortAsc;
    setCompletedSortAsc(nextAsc);
    
    const planned = sessions.filter(s => !isSessionCompletedOrPassed(s));
    const completed = sessions.filter(s => isSessionCompletedOrPassed(s));
    
    const sortedCompleted = [...completed].sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) {
        return nextAsc ? dateA - dateB : dateB - dateA;
      }
      return nextAsc ? a.startTime.localeCompare(b.startTime) : b.startTime.localeCompare(a.startTime);
    });
    
    onReorderSessions([...planned, ...sortedCompleted]);
  };

  const currentExerciseForTeams = exercises.find(e => e.id === selectedExerciseForTeams);

  return (
    <div className="w-full max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto mb-32 pt-0 sm:pt-4">
      {/* Team Overview Modal */}
      <AnimatePresence>
        {selectedExerciseForTeams && currentExerciseForTeams && (
          <TeamOverviewModal
            exercise={currentExerciseForTeams}
            squad={[...squad, ...(sessions.find(s => s.moments.some(m => m.exerciseId === selectedExerciseForTeams))?.guestPlayers || [])]}
            attendingIds={sessions.find(s => s.moments.some(m => m.exerciseId === selectedExerciseForTeams))?.attendance}
            onMovePlayer={onMovePlayer}
            onClose={() => setSelectedExerciseForTeams(null)}
            exercises={exercises}
            onCopyTeams={(sourceId) => onCopyTeams && onCopyTeams(sourceId, selectedExerciseForTeams)}
            onAddGuest={(name, position) => {
              const session = sessions.find(s => s.moments.some(m => m.exerciseId === selectedExerciseForTeams));
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
              const session = sessions.find(s => s.moments.some(m => m.exerciseId === selectedExerciseForTeams));
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
              const session = sessions.find(s => s.moments.some(m => m.exerciseId === selectedExerciseForTeams));
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
            onStart={() => {
              const id = selectedExerciseForTeams;
              setSelectedExerciseForTeams(null);
              onSelectExercise(id);
            }}
          />
        )}
      </AnimatePresence>
 
      {/* Tab Switcher */}
      <div className="flex p-0.5 bg-zinc-150/70 dark:bg-zinc-900 rounded-none sm:rounded-xl mb-3.5 sm:mb-6 mx-0 sm:mx-0 overflow-x-auto scrollbar-none whitespace-nowrap border-b border-t-0 border-x-0 sm:border border-zinc-200/50 dark:border-zinc-800/70">
        <button
          onClick={() => onTabChange('calendar_view')}
          className={`flex-1 min-w-[70px] flex items-center justify-center gap-1 py-1.5 sm:py-2.5 px-1 rounded-none sm:rounded-lg text-[10px] sm:text-xs font-bold transition-all shrink-0 ${
            activeTab === 'calendar_view'
              ? 'bg-white dark:bg-zinc-805 text-indigo-650 dark:text-indigo-400 shadow-sm font-black'
              : 'text-zinc-500 dark:text-zinc-550 hover:text-zinc-700 dark:hover:text-zinc-350'
          }`}
        >
          <CalendarDays size={13} className="hidden sm:block" />
          <span>Aktiviteter</span>
        </button>
        <button
          onClick={() => onTabChange('completed')}
          className={`flex-1 min-w-[70px] flex items-center justify-center gap-1 py-1.5 sm:py-2.5 px-1 rounded-none sm:rounded-lg text-[10px] sm:text-xs font-bold transition-all shrink-0 ${
            activeTab === 'completed'
              ? 'bg-white dark:bg-zinc-805 text-indigo-650 dark:text-indigo-400 shadow-sm font-black'
              : 'text-zinc-500 dark:text-zinc-550 hover:text-zinc-700 dark:hover:text-zinc-350'
          }`}
        >
          <History size={13} className="hidden sm:block" />
          <span>Genomförda</span>
        </button>
        <button
          onClick={() => onTabChange('exercises')}
          className={`flex-1 min-w-[70px] flex items-center justify-center gap-1 py-1.5 sm:py-2.5 px-1 rounded-none sm:rounded-lg text-[10px] sm:text-xs font-bold transition-all shrink-0 ${
            activeTab === 'exercises'
              ? 'bg-white dark:bg-zinc-805 text-indigo-650 dark:text-indigo-400 shadow-sm font-black'
              : 'text-zinc-500 dark:text-zinc-550 hover:text-zinc-700 dark:hover:text-zinc-350'
          }`}
        >
          <Trophy size={13} className="hidden sm:block" />
          <span>Tävlingar</span>
        </button>
        <button
          onClick={() => onTabChange('bank')}
          className={`flex-1 min-w-[70px] flex items-center justify-center gap-1 py-1.5 sm:py-2.5 px-1 rounded-none sm:rounded-lg text-[10px] sm:text-xs font-bold transition-all shrink-0 ${
            activeTab === 'bank'
              ? 'bg-white dark:bg-zinc-805 text-indigo-650 dark:text-indigo-400 shadow-sm font-black'
              : 'text-zinc-500 dark:text-zinc-550 hover:text-zinc-700 dark:hover:text-zinc-350'
          }`}
        >
          <Library size={13} className="hidden sm:block" />
          <span>Övningsbank</span>
        </button>
      </div>

      {activeTab === 'exercises' ? (
        <GameList
          exercises={exercises}
          sessions={sessions}
          onSelectExercise={onSelectExercise}
          onDeleteExercise={onDeleteExercise}
          onCopyExercise={onCopyExercise}
          onEditExercise={onEditExercise}
          onReorderExercises={onReorderExercises}
          onNewExercise={onNewExercise}
          onShowTeams={(id) => setSelectedExerciseForTeams(id)}
        />
      ) : activeTab === 'bank' ? (
        <ExerciseBankView
          exerciseBank={exerciseBank}
          exerciseBankCategories={exerciseBankCategories}
          onAddBankCategory={onAddBankCategory}
          onRemoveBankCategory={onRemoveBankCategory}
          onAddBankExercise={onAddBankExercise}
          onUpdateBankExercise={onUpdateBankExercise}
          onRemoveBankExercise={onRemoveBankExercise}
          sessions={sessions}
          onUpdateSession={onUpdateSession}
          squad={squad}
        />
      ) : activeTab === 'calendar_view' ? (
        <MobileCalendarView
          sessions={sessions}
          deletedSessionsCount={deletedSessions?.length || 0}
          squad={squad}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
          isSyncing={isSyncing}
          onSync={async () => {
            await handleSyncCalendar(undefined, false);
          }}
          hasSyncUrl={!!settings?.icsUrl}
          onNewSession={onNewSession}
          onOpenTrash={() => setShowTrashModal(true)}
          onOpenSeriesCreator={() => setShowSeriesModal(true)}
        />
      ) : (
        <div className="px-4 sm:px-0">
          <div className="flex items-center justify-end mb-6 gap-2 sm:gap-4">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={sortSessionsByDate}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm cursor-pointer"
                title={completedSortAsc ? "Sorterat: Äldsta först. Klicka för att visa senaste först." : "Sorterat: Senaste först. Klicka för att visa äldsta först."}
              >
                <ArrowUpDown size={14} className="text-zinc-400" />
                <span className="hidden sm:inline">
                  {completedSortAsc ? "Äldsta först" : "Senaste först"}
                </span>
              </button>
              <button
                onClick={() => setShowTrashModal(true)}
                className={`p-2 transition-all bg-white dark:bg-zinc-905 border rounded-xl shadow-sm flex items-center gap-1.5 cursor-pointer ${
                  deletedSessions && deletedSessions.length > 0
                    ? "border-rose-200 dark:border-rose-900/40 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                    : "border-zinc-150 dark:border-zinc-800 text-zinc-450 hover:text-zinc-650"
                }`}
                title="Papperskorg"
              >
                <Trash2 size={20} />
                {deletedSessions && deletedSessions.length > 0 && (
                  <span className="text-[10px] font-black px-1.5 py-0.5 bg-rose-100 dark:bg-rose-950/60 rounded-full text-rose-600 dark:text-rose-405">
                    {deletedSessions.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setShowIgnoredInCompleted(prev => !prev)}
                className={`flex items-center justify-center gap-2 border px-3 sm:px-4 py-2 rounded-xl font-bold transition-all text-sm shadow-sm cursor-pointer ${
                  showIgnoredInCompleted
                    ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/50 text-indigo-650 dark:text-indigo-400 font-extrabold"
                    : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }`}
                title={showIgnoredInCompleted ? "Visa vanliga genomförda pass" : "Visa dolda/ignorerade pass"}
              >
                {showIgnoredInCompleted ? <Eye size={16} className="text-indigo-500" /> : <EyeOff size={16} className="text-zinc-400" />}
                <span className="hidden sm:inline">{showIgnoredInCompleted ? "Visar ignorerade" : "Visa ignorerade"}</span>
              </button>
            </div>
          </div>

          {syncMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 rounded-2xl text-xs font-semibold border border-indigo-100 dark:border-indigo-900/50 flex items-center justify-between gap-3 px-4 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <RefreshCw size={14} className={isSyncing ? "animate-spin text-indigo-500" : "text-indigo-400"} />
                <span>{syncMessage}</span>
              </div>
              <button 
                onClick={() => setSyncMessage(null)} 
                className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200 transition-colors p-1"
              >
                <X size={14} />
              </button>
            </motion.div>
          )}

          {deletedSessions && deletedSessions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 rounded-2xl text-xs font-semibold border border-amber-200 dark:border-amber-900/40 flex items-center justify-between gap-3 px-4 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <Trash2 size={16} className="text-amber-500 animate-pulse shrink-0" />
                <span className="leading-normal">
                  Du har <strong>{deletedSessions.length}</strong> raderade träningspass i din papperskorg. Du kan enkelt återställa dem härifrån.
                </span>
              </div>
              <button 
                onClick={() => setShowTrashModal(true)} 
                className="bg-amber-600 hover:bg-amber-700 text-white font-black text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-lg shrink-0 transition-all cursor-pointer"
              >
                Öppna papperskorgen
              </button>
            </motion.div>
          )}

          {(() => {
            const showIgnoredOnly = showIgnoredInCompleted;
            const filteredSessionsList = [...sessions].filter(s => 
              showIgnoredOnly 
                ? s.isIgnored 
                : (!s.isIgnored && isSessionCompletedOrPassed(s))
            );

            if (filteredSessionsList.length === 0) {
              return (
                <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 sm:p-12 text-center border-2 border-dashed border-zinc-200 dark:border-zinc-800">
                  <div className="w-16 h-16 bg-zinc-50 dark:bg-zinc-950 rounded-2xl flex items-center justify-center mx-auto mb-4 text-zinc-400">
                    {showIgnoredOnly ? <EyeOff size={32} /> : <Calendar size={32} />}
                  </div>
                  <h3 className="text-xl font-bold text-zinc-800 dark:text-zinc-200 mb-2">
                    {showIgnoredOnly 
                      ? 'Inga ignorerade träningspass' 
                      : 'Inga genomförda träningspass'}
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {showIgnoredOnly
                      ? 'Träningspass du döljer eller väljer att ignorera hamnar här.'
                      : 'När du genomfört eller passerat ett träningspass hamnar det automatiskt här.'}
                  </p>
                </div>
              );
            }

            return (
              <div className="grid gap-4">
                {filteredSessionsList.map((session) => {
                  const date = new Date(session.date).toLocaleDateString('sv-SE', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long'
                  });
                  const totalMinutes = session.moments.reduce((acc, m) => acc + m.duration, 0);

                  return (
                    <SessionItem
                      key={session.id}
                      session={session}
                      date={date}
                      totalMinutes={totalMinutes}
                      onSelectSession={onSelectSession}
                      setSessionToDelete={setSessionToDelete}
                      onCopySession={onCopySession}
                      onUpdateSession={onUpdateSession}
                      squad={squad}
                    />
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 text-left"
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-zinc-100 dark:border-zinc-800 max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Standardtider</h3>
                <button onClick={() => setShowSettings(false)} className="text-zinc-400 hover:text-zinc-600">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Standard starttid</label>
                  <input
                    type="time"
                    value={localStartTime}
                    onChange={(e) => {
                      const newStart = e.target.value;
                      setLocalStartTime(newStart);
                      setLocalEndTime(calculateEndTime(newStart, localDuration));
                    }}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-base font-bold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Standardlängd (minuter)</label>
                  <input
                    type="number"
                    value={localDuration}
                    onChange={(e) => {
                      const newDur = parseInt(e.target.value) || 0;
                      setLocalDuration(newDur);
                      setLocalEndTime(calculateEndTime(localStartTime, newDur));
                    }}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-base font-bold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Standard sluttid</label>
                  <input
                    type="time"
                    value={localEndTime}
                    onChange={(e) => {
                      const newEnd = e.target.value;
                      setLocalEndTime(newEnd);
                      setLocalDuration(calculateDuration(localStartTime, newEnd));
                    }}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-base font-bold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/60">
                  <h4 className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-wider mb-2">Kalenderintegration</h4>
                  <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Webcal / ICS-länk</label>
                  <input
                    type="text"
                    value={localIcsUrl}
                    onChange={(e) => setLocalIcsUrl(e.target.value)}
                    placeholder="webcal://..."
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-xs sm:text-sm font-semibold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <p className="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">
                    Klistra in lagets prenumerationslänk (webcal/ics-länk) från en extern tjänst som till exempel <strong className="font-bold text-zinc-500 dark:text-zinc-350">Laget.se</strong>, <strong className="font-bold text-zinc-500 dark:text-zinc-350">SportAdmin</strong> eller <strong className="font-bold text-zinc-500 dark:text-zinc-350">Svenskalag.se</strong>. Träningspass och matcher synkas då automatiskt.
                  </p>
                  
                  {localIcsUrl && (
                    <div className="mt-3.5 p-3 bg-zinc-50 dark:bg-zinc-950/30 rounded-xl border border-zinc-150 dark:border-zinc-800 flex items-start gap-3">
                      <input
                        type="checkbox"
                        id="forceOverwrite"
                        checked={forceOverwrite}
                        onChange={(e) => setForceOverwrite(e.target.checked)}
                        className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-indigo-650 focus:ring-indigo-500 cursor-pointer w-4 h-4"
                      />
                      <label htmlFor="forceOverwrite" className="text-xs font-bold text-zinc-750 dark:text-zinc-250 leading-tight cursor-pointer select-none">
                        Tvinga överskrivning av befintliga pass
                        <span className="block text-[10px] font-normal text-zinc-450 dark:text-zinc-500 mt-1 leading-normal">
                          Aktivera om du vill läsa in samlingstider och ny beskrivnings-info för matcher som redan har synkats in tidigare.
                        </span>
                      </label>
                    </div>
                  )}

                  {localIcsUrl && (
                    <button
                      type="button"
                      onClick={() => handleSyncCalendar(localIcsUrl)}
                      disabled={isSyncing}
                      className="mt-3 w-full py-2 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-bold transition-all border border-indigo-100 dark:border-indigo-950 flex items-center justify-center gap-2"
                    >
                      <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
                      <span>{isSyncing ? "Synkar..." : "Synka kalender nu"}</span>
                    </button>
                  )}
                </div>

                <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/60 space-y-3">
                  <h4 className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-wider">Rensa Syfte & Anteckningar</h4>
                  <p className="text-[10px] text-zinc-400 leading-relaxed">
                    Om pass har fått felaktig information synkad från kalendern kan du rensa fältet <strong className="font-bold text-zinc-500 dark:text-zinc-350">Syfte & Anteckningar</strong> för alla pass.
                  </p>
                  
                  <div className="grid grid-cols-2 gap-2.5">
                    {/* Clear Past Notes */}
                    <div className="flex flex-col gap-1.5">
                      {showConfirmClearPast ? (
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => handleClearNotes('past')}
                            className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[10px] font-black uppercase tracking-tight transition-all flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <span>Ja, rensa ({pastSessionsWithNotes.length})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowConfirmClearPast(false)}
                            className="w-full py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-650 dark:text-zinc-300 rounded-lg text-[9px] font-extrabold uppercase tracking-tight transition-all cursor-pointer"
                          >
                            <span>Avbryt</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (pastSessionsWithNotes.length > 0) {
                              setShowConfirmClearPast(true);
                              setShowConfirmClearFuture(false);
                            }
                          }}
                          disabled={pastSessionsWithNotes.length === 0}
                          className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-tight transition-all border flex items-center justify-center gap-1.5 cursor-pointer ${
                            pastSessionsWithNotes.length > 0
                              ? 'bg-red-50 text-red-650 border-red-100 hover:bg-red-100 dark:bg-red-950/25 dark:text-red-400 dark:border-red-900/30'
                              : 'bg-zinc-50 text-zinc-400 border-zinc-200 dark:bg-zinc-800/20 dark:text-zinc-600 dark:border-zinc-805/30 opacity-60 cursor-not-allowed'
                          }`}
                        >
                          Tidigare pass ({pastSessionsWithNotes.length})
                        </button>
                      )}
                    </div>

                    {/* Clear Future Notes */}
                    <div className="flex flex-col gap-1.5">
                      {showConfirmClearFuture ? (
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => handleClearNotes('future')}
                            className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[10px] font-black uppercase tracking-tight transition-all flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <span>Ja, rensa ({futureSessionsWithNotes.length})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowConfirmClearFuture(false)}
                            className="w-full py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-650 dark:text-zinc-300 rounded-lg text-[9px] font-extrabold uppercase tracking-tight transition-all cursor-pointer"
                          >
                            <span>Avbryt</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (futureSessionsWithNotes.length > 0) {
                              setShowConfirmClearFuture(true);
                              setShowConfirmClearPast(false);
                            }
                          }}
                          disabled={futureSessionsWithNotes.length === 0}
                          className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-tight transition-all border flex items-center justify-center gap-1.5 cursor-pointer ${
                            futureSessionsWithNotes.length > 0
                              ? 'bg-red-50 text-red-650 border-red-100 hover:bg-red-100 dark:bg-red-950/25 dark:text-red-400 dark:border-red-900/30'
                              : 'bg-zinc-50 text-zinc-400 border-zinc-200 dark:bg-zinc-800/20 dark:text-zinc-600 dark:border-zinc-805/30 opacity-60 cursor-not-allowed'
                          }`}
                        >
                          Framtida pass ({futureSessionsWithNotes.length})
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {sessions.filter(s => s.isIgnored).length > 0 && (
                  <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/60">
                    <h4 className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-wider mb-2">Ignorerade pass ({sessions.filter(s => s.isIgnored).length})</h4>
                    <div className="max-h-36 overflow-y-auto space-y-2 border border-zinc-100 dark:border-zinc-800 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950/40">
                      {sessions
                        .filter(s => s.isIgnored)
                        .map((ignoredSession) => (
                          <div key={ignoredSession.id} className="flex items-center justify-between gap-2 p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-100 dark:border-zinc-800/60">
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-black text-zinc-800 dark:text-zinc-200 truncate uppercase leading-none mb-1">{ignoredSession.title}</p>
                              <p className="text-[9px] text-zinc-400 font-bold uppercase leading-none">
                                {new Date(ignoredSession.date).toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' })} • {ignoredSession.startTime}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                onUpdateSession({ ...ignoredSession, isIgnored: false });
                              }}
                              className="px-2 py-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg border border-indigo-150 dark:border-indigo-900/40 transition-all cursor-pointer shrink-0"
                            >
                              Återställ
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {deletedSessions && deletedSessions.length > 0 && (
                  <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/60">
                    <h4 className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-wider mb-2 flex items-center justify-between">
                      <span>Papperskorg ({deletedSessions.length})</span>
                      <button
                        type="button"
                        onClick={() => setShowClearTrashConfirm(true)}
                        className="text-[9px] font-black text-red-500 hover:text-red-700 uppercase tracking-wider cursor-pointer"
                      >
                        Töm papperskorgen
                      </button>
                    </h4>
                    <div className="max-h-36 overflow-y-auto space-y-2 border border-zinc-100 dark:border-zinc-800 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950/40">
                      {deletedSessions.map((deletedSession) => (
                        <div key={deletedSession.id} className="flex items-center justify-between gap-2 p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-100 dark:border-zinc-800/60">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-black text-zinc-800 dark:text-zinc-200 truncate uppercase leading-none mb-1">{deletedSession.title}</p>
                            <p className="text-[9px] text-zinc-400 font-bold uppercase leading-none">
                              {new Date(deletedSession.date).toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' })} • {deletedSession.startTime}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                onRestoreSession?.(deletedSession.id);
                              }}
                              className="px-2 py-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg border border-indigo-150 dark:border-indigo-900/40 transition-all cursor-pointer"
                            >
                              Återställ
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSessionToPermanentDelete(deletedSession.id);
                              }}
                              className="p-1 text-zinc-400 hover:text-red-500 rounded transition-all cursor-pointer"
                              title="Ta bort permanent"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    onUpdateSettings?.({
                      defaultStartTime: localStartTime,
                      defaultEndTime: localEndTime,
                      defaultDuration: localDuration,
                      icsUrl: localIcsUrl.trim()
                    });
                    setShowSettings(false);
                  }}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition-all uppercase text-xs shadow-lg shadow-indigo-200 dark:shadow-none"
                >
                  Spara inställningar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Papperskorg (Trash Can / Recycle Bin) Modal */}
      <AnimatePresence>
        {showTrashModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 text-left"
            onClick={() => setShowTrashModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl border border-zinc-100 dark:border-zinc-800 max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-rose-50 dark:bg-rose-950/40 text-rose-500 rounded-xl">
                    <Trash2 size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Papperskorgen</h3>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Återställ borttagna träningar</p>
                  </div>
                </div>
                <button onClick={() => setShowTrashModal(false)} className="text-zinc-400 hover:text-zinc-650 p-1 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium leading-relaxed bg-zinc-50 dark:bg-zinc-950/45 p-3.5 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                  Här sparas alla raderade träningspass. Du kan återställa dem till planeringen eller de genomförda aktiviteterna med ett enda klick.
                </p>

                {deletedSessions.length === 0 ? (
                  <div className="py-12 text-center border-2 border-dashed border-zinc-100 dark:border-zinc-800 rounded-3xl">
                    <div className="w-12 h-12 bg-zinc-50 dark:bg-zinc-950 rounded-xl flex items-center justify-center mx-auto mb-3 text-zinc-350">
                      <Trash2 size={24} />
                    </div>
                    <p className="text-xs text-zinc-400 font-black uppercase tracking-wider">Papperskorgen är tom</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-[10px] font-black text-zinc-400 uppercase tracking-widest px-1">
                      <span>Raderade pass ({deletedSessions.length})</span>
                      <button
                        type="button"
                        onClick={() => setShowClearTrashConfirm(true)}
                        className="text-red-500 hover:text-red-750 transition-colors cursor-pointer text-[10px]"
                      >
                        Töm papperskorgen
                      </button>
                    </div>

                    <div className="space-y-2.5 max-h-[40vh] overflow-y-auto pr-1">
                      {deletedSessions.map((deletedSession) => {
                        const dateFormatted = new Date(deletedSession.date).toLocaleDateString('sv-SE', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long'
                        });
                        return (
                          <div 
                            key={deletedSession.id} 
                            className="flex items-center justify-between gap-3 p-3 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-150 dark:border-zinc-800/80 hover:border-zinc-200 dark:hover:border-zinc-700 transition-all hover:shadow-sm"
                          >
                            <div className="min-w-0 flex-1">
                              <h4 className="text-sm font-black text-zinc-900 dark:text-white truncate uppercase tracking-tight leading-normal">{deletedSession.title}</h4>
                              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-bold capitalize mt-0.5">
                                {dateFormatted} • {deletedSession.startTime}
                              </p>
                              {deletedSession.moments && deletedSession.moments.length > 0 && (
                                <p className="text-[10px] text-indigo-550 dark:text-indigo-400 font-black uppercase tracking-wider mt-1">
                                  {deletedSession.moments.length} övningar / delmoment
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  onRestoreSession?.(deletedSession.id);
                                }}
                                className="px-3 py-1.5 text-xs font-black text-indigo-600 dark:text-indigo-455 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 bg-indigo-50/40 dark:bg-indigo-950/15 rounded-xl border border-indigo-150 dark:border-indigo-900/50 transition-all cursor-pointer"
                              >
                                Återställ
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSessionToPermanentDelete(deletedSession.id);
                                }}
                                className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-xl transition-all cursor-pointer"
                                title="Ta bort permanent"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {sessionToDelete && (() => {
          const sessionToDeleteData = sessions.find(s => s.id === sessionToDelete);
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
              onClick={() => setSessionToDelete(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">
                  {sessionToDeleteData?.externalId ? 'Ta bort eller ignorera?' : 'Radera träningspass?'}
                </h3>
                <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm font-medium leading-relaxed">
                  {sessionToDeleteData?.externalId 
                    ? `"${sessionToDeleteData?.title}" har synkroniserats från en extern kalender. Välj "Ignorera & dölj" om du inte vill att det ska importeras på nytt vid nästa synk.`
                    : `Är du säker på att du vill radera "${sessionToDeleteData?.title}"? Detta tar bort planeringen permanent.`}
                </p>
                <div className="flex flex-col gap-2.5">
                  {sessionToDeleteData?.externalId && (
                    <button
                      onClick={() => {
                        if (sessionToDeleteData) {
                          onUpdateSession({ ...sessionToDeleteData, isIgnored: true });
                        }
                        setSessionToDelete(null);
                      }}
                      className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-2 shadow-md shadow-indigo-100 dark:shadow-none"
                    >
                      <EyeOff size={16} />
                      Ignorera & dölj (synkas ej mer)
                    </button>
                  )}
                  <button
                    onClick={() => {
                      onDeleteSession(sessionToDelete);
                      setSessionToDelete(null);
                    }}
                    className={`w-full py-3 text-sm font-bold rounded-xl transition-colors ${
                      sessionToDeleteData?.externalId 
                        ? 'bg-zinc-50 dark:bg-zinc-800 text-red-650 hover:bg-zinc-100 dark:hover:bg-zinc-850 text-red-600 dark:text-red-400 border border-zinc-200 dark:border-zinc-800' 
                        : 'bg-red-600 text-white hover:bg-red-700'
                    }`}
                  >
                    {sessionToDeleteData?.externalId ? 'Radera permanent' : 'Ja, radera'}
                  </button>
                  <button
                    onClick={() => setSessionToDelete(null)}
                    className="w-full py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm"
                  >
                    Avbryt
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Permanent Delete Confirmation Modal */}
      <AnimatePresence>
        {sessionToPermanentDelete && (() => {
          const sessionToDeleteData = deletedSessions.find(s => s.id === sessionToPermanentDelete);
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
              onClick={() => setSessionToPermanentDelete(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2 uppercase tracking-tight">
                  Ta bort permanent?
                </h3>
                <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm font-medium leading-relaxed">
                  Är du säker på att du vill ta bort "{sessionToDeleteData?.title}" permanent? Denna åtgärd går inte att ångra och passet försvinner helt från papperskorgen.
                </p>
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => {
                      if (sessionToPermanentDelete) {
                        onDeleteSessionPermanent?.(sessionToPermanentDelete);
                        setSessionToPermanentDelete(null);
                      }
                    }}
                    className="w-full py-3 bg-red-650 hover:bg-red-700 text-red-600 dark:text-red-400 bg-red-650/10 hover:bg-red-650/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/40 bg-zinc-50 dark:bg-zinc-800  py-3 text-sm font-bold rounded-xl transition-colors"
                  >
                    Ja, ta bort permanent
                  </button>
                  <button
                    onClick={() => setSessionToPermanentDelete(null)}
                    className="w-full py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm"
                  >
                    Avbryt
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Töm Papperskorg Confirmation Modal */}
      <AnimatePresence>
        {showClearTrashConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4 bg-opacity-75"
            onClick={() => setShowClearTrashConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2 uppercase tracking-tight">
                Töm papperskorgen?
              </h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm font-medium leading-relaxed">
                Är du säker på att du vill rensa hela papperskorgen permanent? Alla {deletedSessions.length} pass tas bort permanent. Denna åtgärd går inte att ångra.
              </p>
              <div className="flex flex-col gap-2.5">
                <button
                  onClick={() => {
                    const idsToPermanentDelete = deletedSessions.map(s => s.id);
                    onDeleteSessionPermanent?.(idsToPermanentDelete);
                    setShowClearTrashConfirm(false);
                  }}
                  className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-2"
                >
                  Ja, töm papperskorgen
                </button>
                <button
                  onClick={() => setShowClearTrashConfirm(false)}
                  className="w-full py-3 bg-zinc-100 dark:bg-zinc-805 text-zinc-650 text-zinc-600 dark:text-zinc-300 rounded-xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm"
                >
                  Avbryt
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Series Training Session Modal */}
      <AnimatePresence>
        {showSeriesModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-start sm:items-center justify-center p-4 text-left overflow-y-auto"
            onClick={() => setShowSeriesModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl border border-zinc-100 dark:border-zinc-800 my-4 sm:my-8 overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-zinc-50 dark:border-zinc-800">
                <div>
                  <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Planera en serie träningspass</h3>
                  <p className="text-xs text-zinc-400 font-bold mt-0.5">Skapa flera träningar på en och samma gång</p>
                </div>
                <button type="button" onClick={() => setShowSeriesModal(false)} className="p-1 -mr-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors rounded-xl">
                  <X size={24} />
                </button>
              </div>

              {/* Title & Time Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">Standardtitel</label>
                  <input
                    type="text"
                    value={seriesTitle}
                    onChange={(e) => setSeriesTitle(e.target.value)}
                    placeholder="Träningspass"
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm font-bold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">Starttid (valfri)</label>
                  <input
                    type="time"
                    value={seriesStartTime}
                    onChange={(e) => setSeriesStartTime(e.target.value)}
                    placeholder={settings?.defaultStartTime || '18:00'}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm font-bold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 block mt-1 font-bold">Standard: {settings?.defaultStartTime || '18:00'}</span>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">Längd (minuter, valfri)</label>
                  <input
                    type="number"
                    value={seriesDuration}
                    onChange={(e) => setSeriesDuration(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder={String(settings?.defaultDuration || 90)}
                    min="1"
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm font-bold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 block mt-1 font-bold">Standard: {settings?.defaultDuration || 90} min</span>
                </div>
              </div>

              {/* Date section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-h-[300px]">
                {/* Monthly Calendar View */}
                <div className="bg-zinc-50 dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-800/80 flex flex-col justify-between">
                  <div>
                    {/* Header Month Navigation */}
                    <div className="flex items-center justify-between mb-4">
                      <button type="button" onClick={prevMonth} className="p-1.5 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                        <ChevronLeft size={16} />
                      </button>
                      <span className="text-xs sm:text-sm font-black uppercase tracking-tight text-zinc-800 dark:text-zinc-200">
                        {currentMonth.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' })}
                      </span>
                      <button type="button" onClick={nextMonth} className="p-1.5 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                        <ChevronRight size={16} />
                      </button>
                    </div>

                    {/* Week Header */}
                    <div className="grid grid-cols-7 gap-1 text-center mb-1">
                      {['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'].map((day) => (
                        <span key={day} className="text-[10px] font-black uppercase text-zinc-400 dark:text-zinc-600 py-1">
                          {day.slice(0, 3)}
                        </span>
                      ))}
                    </div>

                    {/* Calendar Grid Days */}
                    <div className="grid grid-cols-7 gap-1">
                      {/* Filler empty offset cells */}
                      {Array.from({ length: offset }).map((_, i) => (
                        <div key={`empty-${i}`} className="aspect-square" />
                      ))}
                      {/* Active Days */}
                      {Array.from({ length: totalDays }).map((_, i) => {
                        const dayNum = i + 1;
                        const paddedMonth = String(viewMonth + 1).padStart(2, '0');
                        const paddedDay = String(dayNum).padStart(2, '0');
                        const dateStr = `${viewYear}-${paddedMonth}-${paddedDay}`;
                        const isSelected = selectedDates.includes(dateStr);
                        const isToday = new Date().toLocaleDateString('sv-SE') === dateStr;

                        return (
                          <button
                            type="button"
                            key={`day-${dayNum}`}
                            onClick={() => toggleDate(dateStr)}
                            className={`aspect-square text-xs font-bold rounded-lg transition-all flex items-center justify-center ${
                              isSelected
                                ? 'bg-indigo-600 text-white shadow-md font-black'
                                : isToday
                                ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                          >
                            {dayNum}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-3 font-bold">
                    * Klicka på datum i kalendern för att lägga till eller ta bort dem.
                  </div>
                </div>

                {/* Manual entry / Picked list */}
                <div className="flex flex-col h-full justify-between">
                  {/* Manual picker input */}
                  <div>
                    <label className="block text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">Lägg till specifikt datum</label>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={manualDateInput}
                        onChange={(e) => setManualDateInput(e.target.value)}
                        className="flex-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAddManualDate}
                        className="bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950 dark:hover:bg-indigo-900 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/40 px-4 rounded-xl text-xs font-black uppercase transition-all"
                      >
                        Välj
                      </button>
                    </div>
                  </div>

                  {/* Selected count and list */}
                  <div className="flex-1 flex flex-col mt-4 min-h-[160px] max-h-[180px] border border-zinc-100 dark:border-zinc-800 rounded-2xl bg-zinc-50/50 dark:bg-zinc-900/40 p-3 overflow-hidden">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest font-bold">
                        Valda datum ({selectedDates.length})
                      </span>
                      {selectedDates.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedDates([])}
                          className="text-[10px] font-black text-red-500 hover:text-red-700 uppercase"
                        >
                          Rensa alla
                        </button>
                      )}
                    </div>
                    {selectedDates.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                        <Calendar size={24} className="text-zinc-300 dark:text-zinc-700 mb-1" />
                        <span className="text-xs text-zinc-400 dark:text-zinc-600 font-bold">Inga datum valda än</span>
                      </div>
                    ) : (
                      <div className="flex-1 overflow-y-auto pr-1 flex flex-wrap gap-1.5 align-content-start no-scrollbar max-h-[140px]">
                        {selectedDates.map((dateStr) => {
                          const [year, colMonth, day] = dateStr.split('-').map(Number);
                          const dateObj = new Date(year, colMonth - 1, day);
                          const formatted = dateObj.toLocaleDateString('sv-SE', {
                            day: 'numeric',
                            month: 'short',
                          });
                          return (
                            <div
                              key={dateStr}
                              className="flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 px-2 py-1 rounded-lg text-xs font-black border border-indigo-100/50 dark:border-indigo-900/30"
                            >
                              <span>{formatted}</span>
                              <button
                                type="button"
                                onClick={() => toggleDate(dateStr)}
                                className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-bold ml-1 hover:bg-indigo-100/50 dark:hover:bg-indigo-900/50 rounded p-0.5"
                              >
                                <X size={10} strokeWidth={3} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Action trigger buttons */}
              <div className="flex gap-3 mt-8 pt-4 border-t border-zinc-50 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDates([]);
                    setShowSeriesModal(false);
                  }}
                  className="flex-1 py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-center text-sm"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={handleCreateSeries}
                  disabled={selectedDates.length === 0}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-black uppercase text-xs transition-all shadow-lg shadow-indigo-200 dark:shadow-none"
                >
                  Skapa {selectedDates.length} träningspass
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
