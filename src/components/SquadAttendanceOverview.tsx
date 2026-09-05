import { useState, useMemo } from 'react';
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
  Clock,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SquadPlayer, TrainingSession } from '../types';
import { CachedImage } from './CachedImage';

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

function isMatchSession(session: TrainingSession): boolean {
  const t = (session.type || session.category || '').toLowerCase();
  const title = (session.title || '').toLowerCase();
  return t === 'match' || t === 'cup' || title.includes('match') || title.includes('cup') || !!session.lineupId;
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
      label = `Säsong/År ${now.getFullYear()}`;
    } else if (periodPreset === 'all') {
      start = 0;
      end = Date.now() + 86400000 * 365;
      label = 'Alla registrerade tillfällen';
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
    let report = `📊 NÄRVARORAPPORT: ${dateRangeLabel.toUpperCase()}\n`;
    report += `Pass under perioden: ${totalTrainingsCount} träningar, ${totalMatchesCount} matcher (${totalSessionsCount} totalt)\n`;
    report += `Genomsnittlig närvaro i truppen: ${squadAveragePercentage}%\n\n`;
    report += `SPELARE (${processedStats.length} st):\n`;
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

  const getBadgeColor = (pct: number) => {
    if (pct >= 80) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    if (pct >= 60) return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';
    if (pct >= 40) return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700';
  };

  const getProgressColor = (pct: number) => {
    if (pct >= 80) return 'bg-emerald-500';
    if (pct >= 60) return 'bg-indigo-600';
    if (pct >= 40) return 'bg-amber-500';
    return 'bg-zinc-400';
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-300">
      {/* Top Header Card with Period Selector & Actions */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-3xl p-5 sm:p-7 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
                <Activity size={20} />
              </span>
              <h3 className="text-lg sm:text-xl font-black text-zinc-900 dark:text-white tracking-tight">
                Närvarostatistik & Deltagande
              </h3>
            </div>
            <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-1 font-medium">
              {dateRangeLabel} • Baserat på registrerad närvaro i kalendern
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleCopyReport}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer border border-zinc-200/80 dark:border-zinc-700"
              title="Kopiera textrapport"
            >
              {copiedNotification ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
              <span>{copiedNotification ? 'Kopierad!' : 'Kopiera rapport'}</span>
            </button>
            <button
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer border border-zinc-200/80 dark:border-zinc-700"
              title="Ladda ner som Excel/CSV"
            >
              <Download size={15} />
              <span>Exportera CSV</span>
            </button>
          </div>
        </div>

        {/* Period Selector Tabs */}
        <div className="pt-5 space-y-4">
          <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <Calendar size={15} className="text-indigo-500" />
            <span className="text-[11px] font-black uppercase tracking-wider">Välj tidsperiod:</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'last30', label: 'Senaste månaden (30 d)' },
              { id: 'thisMonth', label: 'Denna månad' },
              { id: 'last90', label: 'Senaste 3 månaderna' },
              { id: 'thisYear', label: 'Innevarande år' },
              { id: 'lastYear', label: 'Senaste året (12 mån)' },
              { id: 'all', label: 'All tid' },
              { id: 'custom', label: 'Anpassad period...' }
            ].map(p => (
              <button
                key={p.id}
                onClick={() => setPeriodPreset(p.id as PeriodPreset)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                  periodPreset === p.id
                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs'
                    : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom Date Pickers */}
          {periodPreset === 'custom' && (
            <div className="flex flex-wrap items-center gap-3 p-3.5 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 animate-in fade-in">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Från:</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-800 dark:text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Till:</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-bold text-zinc-800 dark:text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-3xl p-4 sm:p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider">Genomförda träningar</span>
            <Dumbbell size={18} className="text-indigo-500" />
          </div>
          <div className="mt-3">
            <div className="text-2xl sm:text-3xl font-black text-zinc-900 dark:text-white">{totalTrainingsCount}</div>
            <p className="text-[10px] sm:text-xs text-zinc-400 mt-0.5 font-medium">registrerade träningspass</p>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-3xl p-4 sm:p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider">Spelade matcher</span>
            <Shirt size={18} className="text-emerald-500" />
          </div>
          <div className="mt-3">
            <div className="text-2xl sm:text-3xl font-black text-zinc-900 dark:text-white">{totalMatchesCount}</div>
            <p className="text-[10px] sm:text-xs text-zinc-400 mt-0.5 font-medium">registrerade matcher</p>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-3xl p-4 sm:p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider">Snittnärvaro</span>
            <Activity size={18} className="text-amber-500" />
          </div>
          <div className="mt-3">
            <div className="text-2xl sm:text-3xl font-black text-zinc-900 dark:text-white">{squadAveragePercentage}%</div>
            <p className="text-[10px] sm:text-xs text-zinc-400 mt-0.5 font-medium">deltagande i truppen</p>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-3xl p-4 sm:p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider">Flitigast deltagande</span>
            <Trophy size={18} className="text-amber-500" />
          </div>
          <div className="mt-3 min-w-0">
            <div className="text-lg sm:text-xl font-black text-zinc-900 dark:text-white truncate">
              {topAttendee ? topAttendee.player.name : '—'}
            </div>
            <p className="text-[10px] sm:text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 font-bold truncate">
              {topAttendee ? `${topAttendee.percentage}% (${topAttendee.totalAttended} av ${topAttendee.totalSessionsCount} pass)` : 'Ingen data'}
            </p>
          </div>
        </div>
      </div>

      {/* Filter, Search & View Controls */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-3xl p-4 sm:p-5 shadow-xs space-y-3.5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Sök spelare efter namn, tröjnummer eller position..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-xs font-bold text-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:border-indigo-500"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Role Filter & Event Type Tabs */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-zinc-50 dark:bg-zinc-950 p-1 border border-zinc-200 dark:border-zinc-800 rounded-xl">
              {[
                { id: 'players', label: 'Spelare' },
                { id: 'leaders', label: 'Ledare' },
                { id: 'all', label: 'Alla' }
              ].map(r => (
                <button
                  key={r.id}
                  onClick={() => setRoleFilter(r.id as RoleFilter)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    roleFilter === r.id
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="flex items-center bg-zinc-50 dark:bg-zinc-950 p-1 border border-zinc-200 dark:border-zinc-800 rounded-xl">
              {[
                { id: 'all', label: 'Alla pass' },
                { id: 'training', label: 'Endast träning' },
                { id: 'match', label: 'Endast match' }
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setEventTypeFilter(t.id as EventTypeFilter)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    eventTypeFilter === t.id
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sort Bar */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs overflow-x-auto scrollbar-none">
          <div className="flex items-center gap-1 text-zinc-400 shrink-0 font-bold">
            <ArrowUpDown size={14} />
            <span className="text-[10px] uppercase tracking-wider">Sortera:</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {[
              { id: 'percentage', label: 'Närvaro %' },
              { id: 'trainings', label: 'Träningar' },
              { id: 'matches', label: 'Matcher' },
              { id: 'total', label: 'Totalt pass' },
              { id: 'name', label: 'Namn' },
              { id: 'number', label: 'Nummer' }
            ].map(s => (
              <button
                key={s.id}
                onClick={() => handleToggleSort(s.id as SortField)}
                className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                  sortField === s.id
                    ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                {s.label} {sortField === s.id ? (sortAsc ? '↑' : '↓') : ''}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Players Attendance List */}
      {processedStats.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl p-12 text-center text-zinc-400">
          <Users size={36} className="mx-auto mb-3 opacity-50" />
          <p className="font-bold text-sm text-zinc-600 dark:text-zinc-300">Inga personer matchade dina filter</p>
          <p className="text-xs text-zinc-400 mt-1">Prova att ändra sökord eller tidsperiod.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {processedStats.map(({ player, trainingsAttended, totalTrainingsCount, trainingPct, matchesAttended, totalMatchesCount, matchPct, totalAttended, totalSessionsCount, percentage, sessionHistory }) => {
            const isExpanded = expandedPlayerId === player.id;

            return (
              <div 
                key={player.id}
                className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-3xl shadow-xs overflow-hidden transition-all hover:border-zinc-300 dark:hover:border-zinc-700"
              >
                {/* Main Row */}
                <div 
                  onClick={() => setExpandedPlayerId(isExpanded ? null : player.id)}
                  className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer select-none"
                >
                  {/* Player Info */}
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className="relative shrink-0">
                      <div className="w-12 h-12 rounded-2xl overflow-hidden bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-black border border-zinc-100 dark:border-zinc-800 shadow-inner">
                        {player.photoUrl ? (
                          <CachedImage 
                            src={player.photoUrl} 
                            alt={player.name} 
                            className="w-full h-full object-cover" 
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="text-sm uppercase">{player.name.charAt(0)}</span>
                        )}
                      </div>
                      {player.number && (
                        <div className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-[10px] font-black border-2 border-white dark:border-zinc-900 shadow-xs">
                          {player.number}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-extrabold text-sm sm:text-base text-zinc-900 dark:text-white truncate">
                          {player.name}
                        </h4>
                        {player.role === 'leader' && (
                          <span className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-bold text-[9px] px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0">
                            Ledare
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-semibold mt-0.5">
                        {player.position && <span>{player.position}</span>}
                        {player.position && <span>•</span>}
                        <span>Totalt {totalAttended} av {totalSessionsCount} pass</span>
                      </div>
                    </div>
                  </div>

                  {/* Attendance Visual & Stats Breakdown */}
                  <div className="flex items-center justify-between md:justify-end gap-5 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-zinc-100 dark:border-zinc-800">
                    {/* Detailed Counts Breakdown */}
                    <div className="grid grid-cols-2 gap-3 text-right">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Träning</span>
                        <span className="text-xs font-black text-zinc-800 dark:text-zinc-200">
                          {trainingsAttended}/{totalTrainingsCount} <span className="text-[10px] font-semibold text-zinc-400">({trainingPct}%)</span>
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Match</span>
                        <span className="text-xs font-black text-zinc-800 dark:text-zinc-200">
                          {matchesAttended}/{totalMatchesCount} <span className="text-[10px] font-semibold text-zinc-400">({matchPct}%)</span>
                        </span>
                      </div>
                    </div>

                    {/* Percentage Badge & Progress */}
                    <div className="flex items-center gap-3">
                      <div className="w-24 sm:w-28 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[11px] font-black">
                          <span className="text-zinc-500">Närvaro</span>
                          <span className="text-zinc-900 dark:text-white font-black">{percentage}%</span>
                        </div>
                        <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${getProgressColor(percentage)}`}
                            style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
                          />
                        </div>
                      </div>

                      <div className={`px-2.5 py-1.5 rounded-xl border text-xs font-black shrink-0 ${getBadgeColor(percentage)}`}>
                        {percentage}%
                      </div>

                      <div className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Session Attendance Timeline */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 p-4 sm:p-6"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h5 className="text-xs font-black uppercase text-zinc-400 tracking-wider flex items-center gap-1.5">
                          <Clock size={14} />
                          <span>Historik över pass under vald period ({sessionHistory.length} st)</span>
                        </h5>
                        <div className="text-xs text-zinc-500 font-bold">
                          Deltagit på {totalAttended} av {sessionHistory.length} tillfällen
                        </div>
                      </div>

                      {sessionHistory.length === 0 ? (
                        <p className="text-xs text-zinc-400 py-3 text-center">Inga pass registrerade under denna period.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
                          {sessionHistory.map(({ session: s, attended, isMatch }) => {
                            const dateStr = new Date(s.date).toLocaleDateString('sv-SE', {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short'
                            });

                            return (
                              <div
                                key={s.id}
                                className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                                  attended 
                                    ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-900/40 text-zinc-800 dark:text-zinc-200' 
                                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 opacity-80'
                                }`}
                              >
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className={`p-1 rounded-lg shrink-0 ${
                                    isMatch 
                                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' 
                                      : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                                  }`}>
                                    {isMatch ? <Shirt size={12} /> : <Dumbbell size={12} />}
                                  </span>
                                  <div className="truncate">
                                    <p className="font-bold truncate leading-tight">{s.title || (isMatch ? 'Match' : 'Träning')}</p>
                                    <p className="text-[10px] text-zinc-400 font-semibold">{dateStr} {s.startTime ? `kl ${s.startTime}` : ''}</p>
                                  </div>
                                </div>

                                <div className="shrink-0">
                                  {attended ? (
                                    <span className="inline-flex items-center gap-1 font-bold text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-100/80 dark:bg-emerald-950 px-2 py-0.5 rounded-md">
                                      <CheckCircle2 size={12} /> Närvarande
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 font-bold text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-md">
                                      <XCircle size={12} /> Frånvarande
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
