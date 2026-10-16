import React, { useState, useMemo } from 'react';
import { 
  Calendar, 
  Search, 
  ArrowUpDown, 
  Check, 
  X, 
  Trophy, 
  Dumbbell, 
  Shirt, 
  Activity, 
  Copy, 
  ChevronDown, 
  ChevronUp, 
  Download,
  CheckCircle2,
  XCircle,
  Users,
  Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SquadPlayer, TrainingSession } from '../types';
import { CachedImage } from './CachedImage';
import { isMatchSession } from '../utils/sessionCategory';
import { Badge, Button, Card, EmptyState, IconButton, MenuItem, SegmentedTabs, Sheet } from './ui';

interface SquadAttendanceOverviewProps {
  squad: SquadPlayer[];
  sessions: TrainingSession[];
  isCoachOrAdmin?: boolean;
}

type PeriodPreset = 'last30' | 'thisMonth' | 'last90' | 'lastYear' | 'thisYear' | 'all' | 'custom';
type EventTypeFilter = 'all' | 'training' | 'match';
type SortField = 'percentage' | 'trainings' | 'matches' | 'total' | 'name' | 'number';
type RoleFilter = 'players' | 'leaders' | 'all';

function isPlayerPresentInSession(player: SquadPlayer, session: TrainingSession): boolean {
  if (!session.attendance || !Array.isArray(session.attendance)) return false;
  const playerId = player.id;
  const rawId = playerId.replace('_leader', '');
  const cleanName = player.name.trim().toLowerCase();

  return session.attendance.some((att: any) => {
    if (typeof att === 'string') {
      if (att === playerId || att === rawId) return true;
      if (att.replace('_leader', '') === rawId) return true;
      if (att.trim().toLowerCase() === cleanName) return true;
    } else if (att && typeof att === 'object') {
      const objId = att.id || att.playerId;
      if (objId && (objId === playerId || objId === rawId || String(objId).replace('_leader', '') === rawId)) return true;
      if (att.name && att.name.trim().toLowerCase() === cleanName) return true;
    }
    return false;
  });
}

export default function SquadAttendanceOverview({ squad, sessions }: SquadAttendanceOverviewProps) {
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('last30');
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('players');
  const [sortField, setSortField] = useState<SortField>('percentage');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);
  const [copiedNotification, setCopiedNotification] = useState<boolean>(false);
  const [showPeriodSheet, setShowPeriodSheet] = useState(false);
  const [showSortSheet, setShowSortSheet] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);

  // Custom date range state
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  // Calculate actual date boundaries
  const { startDate, endDate, dateRangeLabel } = useMemo(() => {
    const now = new Date();
    let start: number = 0;
    let end: number = Date.now();
    let label = '';

    if (periodPreset === 'last30') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      d.setHours(0, 0, 0, 0);
      start = d.getTime();
      end = now.getTime();
      label = `Senaste 30 dagarna (${new Date(start).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })} – ${now.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })})`;
    } else if (periodPreset === 'thisMonth') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      start = d.getTime();
      const endMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      end = endMonth.getTime();
      label = `Innevarande månad (${now.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' })})`;
    } else if (periodPreset === 'last90') {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      d.setHours(0, 0, 0, 0);
      start = d.getTime();
      end = now.getTime();
      label = `Senaste 90 dagarna (${new Date(start).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })} – ${now.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })})`;
    } else if (periodPreset === 'lastYear') {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      d.setHours(0, 0, 0, 0);
      start = d.getTime();
      end = now.getTime();
      label = `Senaste 12 månaderna (${new Date(start).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })} – ${now.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })})`;
    } else if (periodPreset === 'thisYear') {
      const d = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
      start = d.getTime();
      const endYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
      end = endYear.getTime();
      label = `År ${now.getFullYear()}`;
    } else if (periodPreset === 'all') {
      start = 0;
      end = Date.now() + 86400000 * 365;
      label = 'Alla registrerade pass';
    } else if (periodPreset === 'custom') {
      const s = new Date(customStartDate + 'T00:00:00');
      const e = new Date(customEndDate + 'T23:59:59');
      start = isNaN(s.getTime()) ? 0 : s.getTime();
      end = isNaN(e.getTime()) ? Date.now() : e.getTime();
      label = `${new Date(start).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date(end).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }

    return { startDate: start, endDate: end, dateRangeLabel: label };
  }, [periodPreset, customStartDate, customEndDate]);

  // Filter sessions within date range and that have taken place / attendance recorded
  const relevantSessions = useMemo(() => {
    if (!Array.isArray(sessions)) return [];

    return sessions
      .filter(s => {
        if (!s || s.isIgnored) return false;
        const sessionDate = Number(s.date);
        if (isNaN(sessionDate)) return false;

        // Check date range
        if (sessionDate < startDate || sessionDate > endDate) return false;

        // Only count past sessions or sessions with registered attendance or marked completed
        const hasAttendance = Array.isArray(s.attendance) && s.attendance.length > 0;
        const isPastOrToday = sessionDate <= Date.now() + (24 * 60 * 60 * 1000);
        return hasAttendance || s.isCompleted || isPastOrToday;
      })
      .sort((a, b) => b.date - a.date); // newest first
  }, [sessions, startDate, endDate]);

  // Categorized counts for the period
  const totalTrainingsCount = useMemo(() => {
    return relevantSessions.filter(s => !isMatchSession(s)).length;
  }, [relevantSessions]);

  const totalMatchesCount = useMemo(() => {
    return relevantSessions.filter(s => isMatchSession(s)).length;
  }, [relevantSessions]);

  const totalSessionsCount = relevantSessions.length;

  // Filter squad based on role
  const filteredSquad = useMemo(() => {
    if (roleFilter === 'players') {
      return squad.filter(p => p.role !== 'leader');
    }
    if (roleFilter === 'leaders') {
      return squad.filter(p => p.role === 'leader');
    }
    return squad;
  }, [squad, roleFilter]);

  // Calculate attendance statistics per player
  const playerStats = useMemo(() => {
    return filteredSquad.map(player => {
      let trainingsAttended = 0;
      let matchesAttended = 0;
      const sessionHistory: { session: TrainingSession; attended: boolean; isMatch: boolean }[] = [];

      for (const s of relevantSessions) {
        const isMatch = isMatchSession(s);
        const attended = isPlayerPresentInSession(player, s);

        if (attended) {
          if (isMatch) matchesAttended++;
          else trainingsAttended++;
        }

        sessionHistory.push({
          session: s,
          attended,
          isMatch
        });
      }

      const totalAttended = trainingsAttended + matchesAttended;
      
      let effectiveTotalEvents = totalSessionsCount;
      let effectiveAttended = totalAttended;

      if (eventTypeFilter === 'training') {
        effectiveTotalEvents = totalTrainingsCount;
        effectiveAttended = trainingsAttended;
      } else if (eventTypeFilter === 'match') {
        effectiveTotalEvents = totalMatchesCount;
        effectiveAttended = matchesAttended;
      }

      const percentage = effectiveTotalEvents > 0 
        ? Math.round((effectiveAttended / effectiveTotalEvents) * 100) 
        : 0;

      const trainingPct = totalTrainingsCount > 0 
        ? Math.round((trainingsAttended / totalTrainingsCount) * 100) 
        : 0;

      const matchPct = totalMatchesCount > 0 
        ? Math.round((matchesAttended / totalMatchesCount) * 100) 
        : 0;

      // Recent 5 events trend
      const recentTrend = sessionHistory.slice(0, 5).map(item => item.attended);

      return {
        player,
        trainingsAttended,
        totalTrainingsCount,
        trainingPct,
        matchesAttended,
        totalMatchesCount,
        matchPct,
        totalAttended,
        totalSessionsCount,
        percentage,
        sessionHistory,
        recentTrend
      };
    });
  }, [filteredSquad, relevantSessions, totalTrainingsCount, totalMatchesCount, totalSessionsCount, eventTypeFilter]);

  // Apply search and sorting
  const processedStats = useMemo(() => {
    let list = [...playerStats];

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(item => 
        item.player.name.toLowerCase().includes(q) ||
        (item.player.number && item.player.number.includes(q)) ||
        (item.player.position && item.player.position.toLowerCase().includes(q))
      );
    }

    // Sort
    list.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'percentage') {
        comparison = b.percentage - a.percentage;
        if (comparison === 0) comparison = b.totalAttended - a.totalAttended;
      } else if (sortField === 'trainings') {
        comparison = b.trainingsAttended - a.trainingsAttended;
      } else if (sortField === 'matches') {
        comparison = b.matchesAttended - a.matchesAttended;
      } else if (sortField === 'total') {
        comparison = b.totalAttended - a.totalAttended;
      } else if (sortField === 'name') {
        comparison = a.player.name.localeCompare(b.player.name, 'sv');
      } else if (sortField === 'number') {
        const numA = parseInt((a.player.number || '').replace(/\D/g, ''), 10) || 9999;
        const numB = parseInt((b.player.number || '').replace(/\D/g, ''), 10) || 9999;
        comparison = numA - numB;
      }

      return sortAsc ? -comparison : comparison;
    });

    return list;
  }, [playerStats, searchQuery, sortField, sortAsc]);

  // Overall squad average percentage
  const squadAveragePercentage = useMemo(() => {
    if (playerStats.length === 0) return 0;
    const totalPct = playerStats.reduce((acc, curr) => acc + curr.percentage, 0);
    return Math.round(totalPct / playerStats.length);
  }, [playerStats]);

  // Top attendee
  const topAttendee = useMemo(() => {
    if (playerStats.length === 0) return null;
    const sorted = [...playerStats].sort((a, b) => b.percentage - a.percentage || b.totalAttended - a.totalAttended);
    return sorted[0]?.percentage > 0 ? sorted[0] : null;
  }, [playerStats]);

  const handleToggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  // Copy attendance summary to clipboard
  const handleCopyReport = () => {
    let report = `📊 Närvarorapport: ${dateRangeLabel}\n`;
    report += `Pass under perioden: ${totalTrainingsCount} träningar, ${totalMatchesCount} matcher (${totalSessionsCount} totalt)\n`;
    report += `Genomsnittlig närvaro i truppen: ${squadAveragePercentage}%\n\n`;
    report += `Personer (${processedStats.length} st):\n`;
    report += `--------------------------------------------------\n`;

    processedStats.forEach((stat, index) => {
      const num = stat.player.number ? `#${stat.player.number} ` : '';
      report += `${index + 1}. ${num}${stat.player.name}: ${stat.percentage}% (${stat.totalAttended}/${stat.totalSessionsCount} pass) — Träning: ${stat.trainingsAttended}/${stat.totalTrainingsCount} (${stat.trainingPct}%), Match: ${stat.matchesAttended}/${stat.totalMatchesCount} (${stat.matchPct}%)\n`;
    });

    navigator.clipboard.writeText(report);
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 3000);
  };

  // Export CSV
  const handleExportCsv = () => {
    const headers = ['Namn', 'Tröjnummer', 'Position', 'Roll', 'Närvaro %', 'Träningar deltagit', 'Totala träningar', 'Träning %', 'Matcher deltagit', 'Totala matcher', 'Match %', 'Totalt deltagit', 'Totala tillfällen'];
    
    const rows = processedStats.map(s => [
      `"${s.player.name.replace(/"/g, '""')}"`,
      `"${s.player.number || ''}"`,
      `"${s.player.position || ''}"`,
      `"${s.player.role === 'leader' ? 'Ledare' : 'Spelare'}"`,
      `${s.percentage}%`,
      s.trainingsAttended,
      s.totalTrainingsCount,
      `${s.trainingPct}%`,
      s.matchesAttended,
      s.totalMatchesCount,
      `${s.matchPct}%`,
      s.totalAttended,
      s.totalSessionsCount
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `narvarorapport_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getProgressColor = (pct: number) => {
    if (pct >= 80) return 'bg-emerald-500';
    if (pct >= 60) return 'bg-indigo-600';
    if (pct >= 40) return 'bg-amber-500';
    return 'bg-zinc-400';
  };

  const periodOptions: { id: PeriodPreset; label: string }[] = [
    { id: 'last30', label: 'Senaste 30 dagarna' },
    { id: 'thisMonth', label: 'Denna månad' },
    { id: 'last90', label: 'Senaste 3 månaderna' },
    { id: 'thisYear', label: 'I år' },
    { id: 'lastYear', label: 'Senaste 12 månaderna' },
    { id: 'all', label: 'All tid' },
    { id: 'custom', label: 'Välj datum själv' },
  ];
  const sortOptions: { id: SortField; label: string }[] = [
    { id: 'percentage', label: 'Närvaro i procent' },
    { id: 'total', label: 'Antal pass totalt' },
    { id: 'trainings', label: 'Antal träningar' },
    { id: 'matches', label: 'Antal matcher' },
    { id: 'name', label: 'Namn' },
    { id: 'number', label: 'Tröjnummer' },
  ];
  const currentPeriodLabel = periodOptions.find(p => p.id === periodPreset)?.label || '';
  const currentSortLabel = sortOptions.find(s => s.id === sortField)?.label || '';

  return (
    <div className="w-full space-y-4 animate-in fade-in duration-300">
      {/* Period och åtgärder */}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          icon={<Calendar size={18} />}
          onClick={() => setShowPeriodSheet(true)}
          className="flex-1 sm:flex-none justify-start"
        >
          <span className="truncate">{currentPeriodLabel}</span>
          <ChevronDown size={16} className="ml-auto sm:ml-1 text-zinc-400" />
        </Button>
        <IconButton label="Dela rapport" onClick={() => setShowShareSheet(true)}>
          {copiedNotification ? <Check size={20} className="text-emerald-600" /> : <Share2 size={20} />}
        </IconButton>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 -mt-1">{dateRangeLabel}. Bygger på närvaron som registrerats i kalendern.</p>

      {periodPreset === 'custom' && (
        <Card className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            Från
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="h-11 px-3 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:border-indigo-500"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            Till
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="h-11 px-3 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:border-indigo-500"
            />
          </label>
        </Card>
      )}

      {/* Nyckeltal */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={<Dumbbell size={18} className="text-indigo-500" />} label="Träningar" value={String(totalTrainingsCount)} />
        <StatTile icon={<Shirt size={18} className="text-emerald-500" />} label="Matcher" value={String(totalMatchesCount)} />
        <StatTile icon={<Activity size={18} className="text-amber-500" />} label="Snittnärvaro" value={`${squadAveragePercentage}%`} />
        <StatTile
          icon={<Trophy size={18} className="text-amber-500" />}
          label="Flitigast"
          value={topAttendee ? topAttendee.player.name : '–'}
          sub={topAttendee ? `${topAttendee.percentage}%, ${topAttendee.totalAttended} av ${topAttendee.totalSessionsCount} pass` : 'Ingen närvaro registrerad'}
          small
        />
      </div>

      {/* Sök och filter */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input
            type="search"
            placeholder="Sök person"
            aria-label="Sök på namn, nummer eller position"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-11 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-base sm:text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:border-indigo-500"
          />
          {searchQuery && (
            <IconButton label="Rensa sökningen" onClick={() => setSearchQuery('')} className="absolute right-0.5 top-1/2 -translate-y-1/2">
              <X size={16} />
            </IconButton>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <SegmentedTabs<RoleFilter>
            size="sm"
            value={roleFilter}
            onChange={setRoleFilter}
            tabs={[
              { id: 'players', label: 'Spelare' },
              { id: 'leaders', label: 'Ledare' },
              { id: 'all', label: 'Alla' },
            ]}
          />
          <SegmentedTabs<EventTypeFilter>
            size="sm"
            value={eventTypeFilter}
            onChange={setEventTypeFilter}
            tabs={[
              { id: 'all', label: 'Alla pass' },
              { id: 'training', label: 'Träning' },
              { id: 'match', label: 'Match' },
            ]}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{processedStats.length} personer</span>
          <Button variant="ghost" icon={<ArrowUpDown size={16} />} onClick={() => setShowSortSheet(true)}>
            {currentSortLabel} {sortAsc ? '↑' : '↓'}
          </Button>
        </div>
      </div>

      {/* Lista */}
      {processedStats.length === 0 ? (
        <Card>
          <EmptyState icon={<Users size={26} />} title="Ingen matchar filtret" text="Prova ett annat sökord eller en annan period." />
        </Card>
      ) : (
        <Card padded={false} className="divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
          {processedStats.map(({ player, trainingsAttended, totalTrainingsCount, trainingPct, matchesAttended, totalMatchesCount, matchPct, totalAttended, totalSessionsCount, percentage, sessionHistory }) => {
            const isExpanded = expandedPlayerId === player.id;
            return (
              <div key={player.id}>
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedPlayerId(isExpanded ? null : player.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 min-h-[64px] text-left cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  <PlayerPhoto player={player} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{player.name}</span>
                      {player.role === 'leader' && <Badge>Ledare</Badge>}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                      {totalAttended} av {totalSessionsCount} pass
                      <span className="hidden sm:inline"> · Träning {trainingsAttended}/{totalTrainingsCount} ({trainingPct}%) · Match {matchesAttended}/{totalMatchesCount} ({matchPct}%)</span>
                    </div>
                  </div>
                  <div className="w-20 sm:w-28 shrink-0 flex flex-col items-end gap-1">
                    <span className="text-base font-bold tabular-nums">{percentage}%</span>
                    <div className="w-full h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${getProgressColor(percentage)}`} style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }} />
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp size={18} className="text-zinc-400 shrink-0" /> : <ChevronDown size={18} className="text-zinc-400 shrink-0" />}
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden bg-zinc-50/70 dark:bg-zinc-950/50"
                    >
                      <div className="px-4 py-3 space-y-3">
                        <div className="flex flex-wrap gap-2 sm:hidden">
                          <Badge tone="brand" icon={<Dumbbell size={12} />}>Träning {trainingsAttended}/{totalTrainingsCount} ({trainingPct}%)</Badge>
                          <Badge tone="success" icon={<Shirt size={12} />}>Match {matchesAttended}/{totalMatchesCount} ({matchPct}%)</Badge>
                        </div>
                        {sessionHistory.length === 0 ? (
                          <p className="text-sm text-zinc-500 py-2">Inga pass under perioden.</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-y-auto">
                            {sessionHistory.map(({ session: s, attended, isMatch }) => (
                              <div
                                key={s.id}
                                className={`p-2.5 rounded-xl border flex items-center gap-2.5 ${
                                  attended
                                    ? 'bg-white dark:bg-zinc-900 border-emerald-200 dark:border-emerald-900/50'
                                    : 'bg-white/60 dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800 text-zinc-500'
                                }`}
                              >
                                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isMatch ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'}`}>
                                  {isMatch ? <Shirt size={14} /> : <Dumbbell size={14} />}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold truncate">{s.title || (isMatch ? 'Match' : 'Träning')}</p>
                                  <p className="text-xs text-zinc-500">
                                    {new Date(s.date).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })}
                                    {s.startTime ? ` kl ${s.startTime}` : ''}
                                  </p>
                                </div>
                                {attended
                                  ? <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" aria-label="Närvarande" />
                                  : <XCircle size={18} className="text-zinc-400 shrink-0" aria-label="Frånvarande" />}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </Card>
      )}

      <Sheet open={showPeriodSheet} onClose={() => setShowPeriodSheet(false)} title="Tidsperiod">
        <div className="flex flex-col gap-0.5">
          {periodOptions.map(p => (
            <MenuItem
              key={p.id}
              label={p.label}
              active={periodPreset === p.id}
              trailing={periodPreset === p.id ? <Check size={18} className="text-indigo-600" /> : undefined}
              onClick={() => { setPeriodPreset(p.id); setShowPeriodSheet(false); }}
            />
          ))}
        </div>
      </Sheet>

      <Sheet open={showSortSheet} onClose={() => setShowSortSheet(false)} title="Sortera">
        <div className="flex flex-col gap-0.5">
          {sortOptions.map(s => (
            <MenuItem
              key={s.id}
              label={s.label}
              description={sortField === s.id ? (sortAsc ? 'Stigande – tryck för fallande' : 'Fallande – tryck för stigande') : undefined}
              active={sortField === s.id}
              trailing={sortField === s.id ? <span className="text-indigo-600 font-bold">{sortAsc ? '↑' : '↓'}</span> : undefined}
              onClick={() => { handleToggleSort(s.id); if (sortField !== s.id) setShowSortSheet(false); }}
            />
          ))}
        </div>
      </Sheet>

      <Sheet open={showShareSheet} onClose={() => setShowShareSheet(false)} title="Dela närvarorapport">
        <div className="flex flex-col gap-0.5">
          <MenuItem
            icon={<Copy size={18} />}
            label="Kopiera som text"
            description="Klistra in i t.ex. ett sms eller WhatsApp"
            onClick={() => { handleCopyReport(); setShowShareSheet(false); }}
          />
          <MenuItem
            icon={<Download size={18} />}
            label="Ladda ner som Excel-fil (CSV)"
            onClick={() => { handleExportCsv(); setShowShareSheet(false); }}
          />
        </div>
      </Sheet>
    </div>
  );
}

const StatTile = ({ icon, label, value, sub, small }: { icon: React.ReactNode; label: string; value: string; sub?: string; small?: boolean }) => (
  <Card className="!p-4 min-w-0">
    <div className="flex items-center justify-between gap-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
      <span className="truncate">{label}</span>
      {icon}
    </div>
    <div className={`mt-2 font-bold text-zinc-900 dark:text-white truncate ${small ? 'text-lg' : 'text-2xl sm:text-3xl'}`}>{value}</div>
    {sub && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">{sub}</p>}
  </Card>
);

const PlayerPhoto = ({ player }: { player: SquadPlayer }) => (
  <span className="relative shrink-0">
    <span className="w-10 h-10 rounded-full overflow-hidden bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold text-sm flex items-center justify-center">
      {player.photoUrl
        ? <CachedImage src={player.photoUrl} alt={player.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
        : player.name.charAt(0).toUpperCase()}
    </span>
    {player.number && (
      <span className="absolute -bottom-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[10px] font-bold leading-5 text-center ring-2 ring-white dark:ring-zinc-900">
        {player.number}
      </span>
    )}
  </span>
);
