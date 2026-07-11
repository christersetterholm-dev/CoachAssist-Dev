import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Copy, Download, Upload, Check, Calendar, ListChecks, Info, Search, AlertCircle, FileText, ChevronRight, ExternalLink } from 'lucide-react';
import { TrainingSession, SessionMoment } from '../types';

const DEFAULT_CATEGORIES = [
  'Uppvärmning',
  'Aktivering',
  'Teknik',
  'Spel',
  'Anfallsspel',
  'Speluppbyggnad',
  'Kontring',
  'Avslut',
  'Försvarsspel',
  'Förhindra speluppbyggnad',
  'Återerövring',
  'Förhindra avslut',
  'Fotbollsfys',
  'Explosiv träning',
  'Fotbollsstyrka',
  'Målvakt',
  'Annat'
];

interface MomentCopyModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSession: TrainingSession;
  allSessions: TrainingSession[];
  onUpdateSession: (updated: TrainingSession) => void;
  exerciseBank?: any[];
  exerciseBankCategories?: string[];
}

export default function MomentCopyModal({
  isOpen,
  onClose,
  currentSession,
  allSessions,
  onUpdateSession,
  exerciseBank = [],
  exerciseBankCategories = [],
}: MomentCopyModalProps) {
  const [activeTab, setActiveTab] = useState<'import' | 'export'>('import');
  
  // Mobile step state for responsiveness
  const [mobileStep, setMobileStep] = useState<1 | 2>(1);
  
  // Import Source Selector: 'sessions' vs 'bank'
  const [importSource, setImportSource] = useState<'sessions' | 'bank'>('sessions');
  const [importSelectedBankIds, setImportSelectedBankIds] = useState<Set<string>>(new Set());
  const [previewBankExerciseId, setPreviewBankExerciseId] = useState<string>('');
  const [bankCategoryFilter, setBankCategoryFilter] = useState('Alla');
  
  // Tab 1 (Import) State
  const [selectedSourceSessionId, setSelectedSourceSessionId] = useState<string>('');
  const [importSelectedMomentIds, setImportSelectedMomentIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Tab 2 (Export) State
  const [exportSelectedMomentIds, setExportSelectedMomentIds] = useState<Set<string>>(new Set());
  const [exportTargetSessionIds, setExportTargetSessionIds] = useState<Set<string>>(new Set());
  const [exportSearchQuery, setExportSearchQuery] = useState('');

  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Helper to format date in Swedish
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('sv-SE', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  // Get other sessions sorted so future sessions are first (ascending closest first), then past sessions (descending closest first)
  const otherSessions = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTimestamp = todayStart.getTime();

    return allSessions
      .filter(s => s.id !== currentSession.id)
      .sort((a, b) => {
        const isFutureA = a.date >= todayTimestamp;
        const isFutureB = b.date >= todayTimestamp;

        if (isFutureA && !isFutureB) return -1;
        if (!isFutureA && isFutureB) return 1;

        if (isFutureA && isFutureB) {
          return a.date - b.date; // Future: closest first (ascending)
        } else {
          return b.date - a.date; // Past: most recent first (descending)
        }
      });
  }, [allSessions, currentSession.id]);

  // Filtered source sessions for Import Tab
  const filteredImportSessions = useMemo(() => {
    const sessionsWithMoments = otherSessions.filter(s => s.moments && s.moments.length > 0);
    if (!searchQuery.trim()) return sessionsWithMoments;
    const q = searchQuery.toLowerCase();
    return sessionsWithMoments.filter(s => 
      s.title.toLowerCase().includes(q) || 
      (s.location && s.location.toLowerCase().includes(q)) ||
      formatDate(s.date).toLowerCase().includes(q)
    );
  }, [otherSessions, searchQuery]);

  // Filtered target sessions for Export Tab
  const filteredExportSessions = useMemo(() => {
    if (!exportSearchQuery.trim()) return otherSessions;
    const q = exportSearchQuery.toLowerCase();
    return otherSessions.filter(s => 
      s.title.toLowerCase().includes(q) || 
      (s.location && s.location.toLowerCase().includes(q)) ||
      formatDate(s.date).toLowerCase().includes(q)
    );
  }, [otherSessions, exportSearchQuery]);

  // Bank Exercises filtered
  const filteredBankExercises = useMemo(() => {
    return (exerciseBank || []).filter(ex => {
      const q = searchQuery.toLowerCase();
      const nameMatch = (ex.name || '').toLowerCase().includes(q) || (ex.description || '').toLowerCase().includes(q);
      
      const cats = ex.categories && ex.categories.length > 0 
        ? ex.categories 
        : (ex.category ? [ex.category] : []);
      const categoryMatch = bankCategoryFilter === 'Alla' || cats.includes(bankCategoryFilter);
      
      return nameMatch && categoryMatch;
    });
  }, [exerciseBank, searchQuery, bankCategoryFilter]);

  const previewExercise = useMemo(() => {
    return (exerciseBank || []).find(ex => ex.id === previewBankExerciseId) || filteredBankExercises[0];
  }, [exerciseBank, previewBankExerciseId, filteredBankExercises]);

  // Source Session moments
  const sourceSession = useMemo(() => {
    return otherSessions.find(s => s.id === selectedSourceSessionId);
  }, [otherSessions, selectedSourceSessionId]);

  // Reset function
  const handleClose = () => {
    setSelectedSourceSessionId('');
    setImportSelectedMomentIds(new Set());
    setImportSelectedBankIds(new Set());
    setExportSelectedMomentIds(new Set());
    setExportTargetSessionIds(new Set());
    setSearchQuery('');
    setExportSearchQuery('');
    setSuccessMessage(null);
    setMobileStep(1);
    onClose();
  };

  // Import Action
  const handleImport = () => {
    let copiedMoments: SessionMoment[] = [];

    if (importSource === 'bank') {
      const selectedBankExercises = exerciseBank.filter(ex => importSelectedBankIds.has(ex.id));
      if (selectedBankExercises.length === 0) return;

      copiedMoments = selectedBankExercises.map(ex => ({
        id: `moment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${ex.id.slice(-4)}`,
        name: ex.name,
        duration: ex.duration || 15,
        description: ex.description,
        imageUrl: ex.imageUrl,
        imageUrls: ex.imageUrl ? [ex.imageUrl] : undefined,
        externalLink: ex.externalLink,
        bankExerciseId: ex.id,
      }));
    } else {
      if (!sourceSession) return;
      const selectedMoments = sourceSession.moments.filter(m => importSelectedMomentIds.has(m.id));
      if (selectedMoments.length === 0) return;

      // Create copies: Strip competition settings (exerciseId) & assign new unique IDs
      copiedMoments = selectedMoments.map(m => ({
        id: `moment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${m.id.slice(-4)}`,
        name: m.name,
        duration: m.duration,
        description: m.description,
        imageUrl: m.imageUrl,
        imageUrls: m.imageUrls ? [...m.imageUrls] : undefined,
        externalLink: m.externalLink,
      }));
    }

    if (copiedMoments.length === 0) return;

    // Update current session
    onUpdateSession({
      ...currentSession,
      moments: [...currentSession.moments, ...copiedMoments],
    });

    triggerSuccess(`Hämtade ${copiedMoments.length} övningar till detta träningspass!`);
    
    // Clear selections
    setImportSelectedMomentIds(new Set());
    setImportSelectedBankIds(new Set());
    setMobileStep(1);
  };

  // Export Action
  const handleExport = () => {
    const selectedMoments = currentSession.moments.filter(m => exportSelectedMomentIds.has(m.id));
    if (selectedMoments.length === 0 || exportTargetSessionIds.size === 0) return;

    let targetCount = 0;
    // Iterate and update each selected target session
    allSessions.forEach(session => {
      if (exportTargetSessionIds.has(session.id)) {
        // Deep copy selected moments
        const copiedMoments: SessionMoment[] = selectedMoments.map(m => ({
          id: `moment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${m.id.slice(-4)}`,
          name: m.name,
          duration: m.duration,
          description: m.description,
          imageUrl: m.imageUrl,
          imageUrls: m.imageUrls ? [...m.imageUrls] : undefined,
          externalLink: m.externalLink,
        }));

        onUpdateSession({
          ...session,
          moments: [...session.moments, ...copiedMoments],
        });
        targetCount++;
      }
    });

    triggerSuccess(`Kopierade ${selectedMoments.length} övningar till ${targetCount} andra träningspass!`);
    
    // Clear selections
    setExportSelectedMomentIds(new Set());
    setExportTargetSessionIds(new Set());
    setMobileStep(1);
  };

  const triggerSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => {
      setSuccessMessage(null);
    }, 3500);
  };

  // Selection Checkbox helpers
  const toggleImportMoment = (id: string) => {
    const updated = new Set(importSelectedMomentIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setImportSelectedMomentIds(updated);
  };

  const toggleAllImportMoments = () => {
    if (!sourceSession) return;
    if (importSelectedMomentIds.size === sourceSession.moments.length) {
      setImportSelectedMomentIds(new Set());
    } else {
      setImportSelectedMomentIds(new Set(sourceSession.moments.map(m => m.id)));
    }
  };

  const toggleExportMoment = (id: string) => {
    const updated = new Set(exportSelectedMomentIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setExportSelectedMomentIds(updated);
  };

  const toggleAllExportMoments = () => {
    if (exportSelectedMomentIds.size === currentSession.moments.length) {
      setExportSelectedMomentIds(new Set());
    } else {
      setExportSelectedMomentIds(new Set(currentSession.moments.map(m => m.id)));
    }
  };

  const toggleExportTargetSession = (id: string) => {
    const updated = new Set(exportTargetSessionIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setExportTargetSessionIds(updated);
  };

  const bankCategoriesList = useMemo(() => {
    return ['Alla', ...DEFAULT_CATEGORIES, ...exerciseBankCategories];
  }, [exerciseBankCategories]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-md z-[120] flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 15, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 15, opacity: 0 }}
            className="bg-white dark:bg-zinc-900 rounded-[32px] w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-zinc-100 dark:border-zinc-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 sm:p-8 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                  <Copy size={24} />
                </div>
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Kopiera övningar</h3>
                  <p className="text-xs sm:text-sm text-zinc-500 font-medium">Overför delmoment och övningsbeskrivningar mellan träningspass</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Success Message Banner */}
            <AnimatePresence>
              {successMessage && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="bg-green-500 text-white text-sm font-bold px-6 py-3 flex items-center gap-2"
                >
                  <Check size={18} strokeWidth={3} />
                  <span>{successMessage}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Tabs */}
            <div className="bg-zinc-50 dark:bg-zinc-900/50 px-6 sm:px-8 py-3 border-b border-zinc-100 dark:border-zinc-800 flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => { setActiveTab('import'); setSuccessMessage(null); setMobileStep(1); }}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all ${
                  activeTab === 'import'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100 dark:shadow-none'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Download size={14} />
                Hämta övningar (Importera)
              </button>
              <button
                onClick={() => { setActiveTab('export'); setSuccessMessage(null); setMobileStep(1); }}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all ${
                  activeTab === 'export'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100 dark:shadow-none'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Upload size={14} />
                Kopiera till andra pass (Exportera)
              </button>
            </div>

            {/* Tab content area */}
            <div className="flex-1 overflow-y-auto p-6 sm:p-8 min-h-[40vh] max-h-[60vh] custom-scrollbar">
                  {/* IMPORT TAB */}
              {activeTab === 'import' && (
                <div className="space-y-6">
                  {/* Import Source Switcher Segment */}
                  <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1.5 rounded-2xl max-w-md border border-zinc-200/50 dark:border-zinc-700/50">
                    <button
                      type="button"
                      onClick={() => { setImportSource('sessions'); setSuccessMessage(null); }}
                      className={`flex-1 py-2 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                        importSource === 'sessions'
                          ? 'bg-white dark:bg-zinc-750 text-indigo-600 dark:text-indigo-400 shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
                      }`}
                    >
                      Från andra träningar
                    </button>
                    <button
                      type="button"
                      onClick={() => { setImportSource('bank'); setSuccessMessage(null); }}
                      className={`flex-1 py-2 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                        importSource === 'bank'
                          ? 'bg-white dark:bg-zinc-750 text-indigo-600 dark:text-indigo-400 shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
                      }`}
                    >
                      Från övningsbanken ({exerciseBank.length})
                    </button>
                  </div>

                  {importSource === 'bank' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                      {/* Left Column: Bank list */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-zinc-500 dark:text-zinc-455 uppercase tracking-wider">
                            Välj övningar från banken
                          </label>
                          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                            {filteredBankExercises.length} st
                          </span>
                        </div>

                        {/* Search & Category Filter */}
                        <div className="space-y-2">
                          <div className="relative">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                            <input
                              type="text"
                              placeholder="Sök i övningsbanken..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-805 focus:bg-white dark:focus:bg-zinc-800 border-2 border-zinc-150 dark:border-zinc-850 focus:border-indigo-505 rounded-xl text-xs font-medium outline-none transition-all placeholder:text-zinc-405"
                            />
                          </div>
                          
                          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none whitespace-nowrap">
                            {bankCategoriesList.map(cat => (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => setBankCategoryFilter(cat)}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                                  bankCategoryFilter === cat
                                    ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm'
                                    : 'bg-zinc-50 dark:bg-zinc-850 text-zinc-500 dark:text-zinc-400/80 border border-zinc-200 dark:border-zinc-700'
                                }`}
                              >
                                {cat}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Exercises Checklist */}
                        <div className="border border-zinc-200/60 dark:border-zinc-800 rounded-2xl overflow-hidden max-h-[300px] overflow-y-auto custom-scrollbar divide-y divide-zinc-150 dark:divide-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20">
                          {filteredBankExercises.length === 0 ? (
                            <div className="p-8 text-center text-zinc-400 text-xs font-medium">
                              Inga sparade övningar hittades i banken.
                            </div>
                          ) : (
                            filteredBankExercises.map((ex) => {
                              const isChecked = importSelectedBankIds.has(ex.id);
                              const isPreviewed = ex.id === previewBankExerciseId;
                              return (
                                <div
                                  key={ex.id}
                                  className={`w-full text-left p-3.5 flex items-center justify-between transition-colors cursor-pointer ${
                                    isPreviewed
                                      ? 'bg-indigo-500/5 dark:bg-indigo-500/10'
                                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'
                                  }`}
                                  onClick={() => {
                                    setPreviewBankExerciseId(ex.id);
                                  }}
                                >
                                  <div className="flex items-start gap-3 min-w-0 pr-2">
                                    <div 
                                      className="pt-0.5" 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const updated = new Set(importSelectedBankIds);
                                        if (updated.has(ex.id)) {
                                          updated.delete(ex.id);
                                        } else {
                                          updated.add(ex.id);
                                        }
                                        setImportSelectedBankIds(updated);
                                      }}
                                    >
                                      <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${
                                        isChecked
                                          ? 'border-indigo-600 bg-indigo-600 text-white'
                                          : 'border-zinc-300 dark:border-zinc-705 text-transparent'
                                      }`}>
                                        <Check size={12} strokeWidth={4} />
                                      </div>
                                    </div>
                                    <div className="min-w-0">
                                      <h4 className="text-sm font-black text-zinc-900 dark:text-white truncate">
                                        {ex.name}
                                      </h4>
                                      <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 block truncate">
                                        {(ex.categories && ex.categories.length > 0 ? ex.categories.join(', ') : (ex.category || 'Teknik'))} • {ex.duration || 15} min
                                      </span>
                                    </div>
                                  </div>
                                  <ChevronRight size={14} className="text-zinc-350 shrink-0" />
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* Right Column: Preview & Final action */}
                      <div className="space-y-4">
                        <label className="text-xs font-bold text-zinc-500 dark:text-zinc-455 uppercase tracking-wider block">
                          Förhandsvisning av markerad övning
                        </label>

                        {previewExercise ? (
                          <div className="bg-zinc-50 dark:bg-zinc-950/25 border border-zinc-200/50 dark:border-zinc-805 rounded-2xl p-5 space-y-4 animate-in fade-in duration-200">
                            {previewExercise.imageUrl && (
                              <div className="w-full h-32 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/20">
                                <img
                                  src={previewExercise.imageUrl}
                                  alt={previewExercise.name}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <div>
                              <span className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-650 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/30 px-2 py-0.5 rounded text-[10px] uppercase font-black tracking-wider">
                                {previewExercise.categories && previewExercise.categories.length > 0 ? previewExercise.categories.join(' • ') : (previewExercise.category || 'Teknik')}
                              </span>
                              <h4 className="text-lg font-black text-zinc-900 dark:text-white mt-2 leading-none">
                                {previewExercise.name}
                              </h4>
                              <p className="text-zinc-400 dark:text-zinc-505 text-xs font-semibold mt-1">
                                Rekommenderad tid: {previewExercise.duration} min
                              </p>
                            </div>

                            {previewExercise.description ? (
                              <p className="text-zinc-500 dark:text-zinc-400 text-xs leading-relaxed max-h-[120px] overflow-y-auto whitespace-pre-wrap font-medium custom-scrollbar">
                                {previewExercise.description}
                              </p>
                            ) : (
                              <p className="text-zinc-350 dark:text-zinc-650 text-xs italic">Ingen beskrivning sparad</p>
                            )}

                            <div className="flex items-center justify-between pt-3 border-t border-zinc-150 dark:border-zinc-805">
                              {previewExercise.externalLink ? (
                                <a
                                  href={previewExercise.externalLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 text-xs font-black text-indigo-650 dark:text-indigo-400 hover:underline"
                                >
                                  <ExternalLink size={13} />
                                  Gå till länk
                                </a>
                              ) : (
                                <div />
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  const updated = new Set(importSelectedBankIds);
                                  if (updated.has(previewExercise.id)) {
                                    updated.delete(previewExercise.id);
                                  } else {
                                    updated.add(previewExercise.id);
                                  }
                                  setImportSelectedBankIds(updated);
                                }}
                                className={`px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all border ${
                                  importSelectedBankIds.has(previewExercise.id)
                                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30'
                                    : 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-sm'
                                }`}
                              >
                                {importSelectedBankIds.has(previewExercise.id) ? 'Vald ✓' : 'Välj övning'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="border border-dashed border-zinc-200 dark:border-zinc-805 rounded-2xl p-10 text-center text-zinc-400 flex flex-col items-center justify-center min-h-[290px]">
                            <Info size={32} className="text-zinc-350 mb-2" />
                            <p className="font-bold text-sm">Ingen övning tillgänglig</p>
                            <p className="text-xs max-w-xs mt-1">Skapa först övningar i din övningsbank.</p>
                          </div>
                        )}


                      </div>
                    </div>
                  ) : (
                    otherSessions.filter(s => s.moments && s.moments.length > 0).length === 0 ? (
                      <div className="text-center py-12 text-zinc-400">
                        <AlertCircle className="mx-auto mb-3 text-zinc-350" size={48} />
                        <p className="font-bold">Hittade inga andra träningspass med planerade övningar</p>
                        <p className="text-xs mt-2 max-w-sm mx-auto">Det måste finnas andra träningspass som innehåller sparade övningar för att kunna hämta från dem.</p>
                      </div>
                    ) : (
                      <div>
                      {/* Step Indicator on Mobile */}
                      <div className="md:hidden flex items-center gap-2 mb-4 px-1">
                        <div className={`flex-1 h-1.5 rounded-full transition-colors ${mobileStep === 1 ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-800'}`} />
                        <div className={`flex-1 h-1.5 rounded-full transition-colors ${mobileStep === 2 ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-800'}`} />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                        
                        {/* Left Side: Session Selector List */}
                        <div className={`space-y-4 ${mobileStep === 2 ? 'hidden md:block' : 'block'}`}>
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-zinc-500 dark:text-zinc-455 uppercase tracking-wider">
                              1. Välj ett träningspass att hämta ifrån
                            </label>
                            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                              {filteredImportSessions.length} st
                            </span>
                          </div>
                          
                          {/* Search Input */}
                          <div className="relative">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                            <input
                              type="text"
                              placeholder="Sök pass (datum, titel, plats)..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full pl-10 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-750 focus:bg-white dark:focus:bg-zinc-800 border-2 border-zinc-150 dark:border-zinc-850 focus:border-indigo-500 rounded-xl text-sm font-medium outline-none transition-all"
                            />
                          </div>

                          {/* List representation */}
                          <div className="border border-zinc-100 dark:border-zinc-800 rounded-2xl overflow-hidden max-h-[350px] overflow-y-auto custom-scrollbar divide-y divide-zinc-100 dark:divide-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20">
                            {filteredImportSessions.length === 0 ? (
                              <div className="p-8 text-center text-zinc-400 text-xs">
                                Inga pass matchar sökningen
                              </div>
                            ) : (
                              filteredImportSessions.map((s) => {
                                const isSelected = s.id === selectedSourceSessionId;
                                const momentCount = s.moments?.length || 0;
                                return (
                                  <button
                                    key={s.id}
                                    onClick={() => {
                                      setSelectedSourceSessionId(s.id);
                                      setImportSelectedMomentIds(new Set(s.moments?.map(m => m.id) || []));
                                      setMobileStep(2); // Auto-advance to step 2 on mobile
                                    }}
                                    className={`w-full text-left p-4 flex items-center justify-between transition-colors ${
                                      isSelected
                                        ? 'bg-indigo-500/10 dark:bg-indigo-500/20 border-l-4 border-indigo-600 dark:border-indigo-400'
                                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                    }`}
                                  >
                                    <div className="min-w-0 pr-3">
                                      <div className="flex items-center gap-2 mb-1">
                                        <Calendar size={12} className="text-zinc-400" />
                                        <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                          {formatDate(s.date)} • {s.startTime}{s.endTime ? `-${s.endTime}` : ''}
                                        </span>
                                      </div>
                                      <h4 className="text-sm font-black text-zinc-900 dark:text-white truncate">
                                        {s.title}
                                      </h4>
                                      {s.location && (
                                        <p className="text-[11px] text-zinc-400 truncate mt-0.5">{s.location}</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <span className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-450 font-extrabold text-[10px] px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-700 uppercase tracking-wider">
                                        {momentCount} {momentCount === 1 ? 'övning' : 'övningar'}
                                      </span>
                                      <ChevronRight size={14} className="text-zinc-350" />
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>

                        {/* Right Side: Moments inside the chosen session to import */}
                        <div className={`space-y-4 ${mobileStep === 1 ? 'hidden md:block' : 'block'}`}>
                          {/* Mobile Back Button */}
                          <div className="md:hidden">
                            <button
                              onClick={() => setMobileStep(1)}
                              className="mb-2 py-2 px-4 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold text-xs flex items-center gap-1.5 transition-colors"
                            >
                              ← Välj ett annat träningspass
                            </button>
                          </div>

                          <label className="text-xs font-bold text-zinc-500 dark:text-zinc-455 uppercase tracking-wider block">
                            2. Välj vilka övningar du vill hämta
                          </label>

                          {!selectedSourceSessionId ? (
                            <div className="border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl p-10 text-center text-zinc-400 flex flex-col items-center justify-center min-h-[290px]">
                              <ListChecks size={32} className="text-zinc-300 mb-2" />
                              <p className="font-bold text-sm">Inget pass markerat</p>
                              <p className="text-xs max-w-xs mt-1">Markera ett träningspass till vänster för att se dess övningar.</p>
                            </div>
                          ) : sourceSession?.moments?.length === 0 ? (
                            <div className="border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl p-10 text-center text-zinc-400 flex flex-col items-center justify-center min-h-[290px]">
                              <FileText size={32} className="text-zinc-300 mb-2" />
                              <p className="font-bold text-sm">Träningspasset är tomt</p>
                              <p className="text-xs mt-1">Det valda passet innehåller inga tillagda övningar eller delmoment.</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {/* Warnings/Structure details */}
                              <div className="flex gap-2 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-400 p-3.5 rounded-2xl text-xs border border-amber-100 dark:border-amber-900/30">
                                <Info className="shrink-0 mt-0.5" size={14} />
                                <div>
                                  <span className="font-extrabold block">Tävlingsmoment & resultat kopieras ej</span>
                                  <span className="leading-relaxed">Själva tävlingsreglerna, deltagare och resultat är unika för sitt pass. Det nya momentet skapas som en ren träningsövning med all din förklarande text, tidsplan, länkar och bilder bibehållna.</span>
                                </div>
                              </div>

                              {/* Select All Controls */}
                              <div className="flex items-center justify-between px-2 py-1 select-none">
                                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide">
                                  Valda: {importSelectedMomentIds.size} av {sourceSession?.moments?.length}
                                </span>
                                <button
                                  onClick={toggleAllImportMoments}
                                  className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline hover:opacity-90"
                                >
                                  {importSelectedMomentIds.size === sourceSession?.moments?.length
                                    ? 'Avmarkera alla'
                                    : 'Markera alla'}
                                </button>
                              </div>

                              {/* Moments checklist */}
                              <div className="border border-zinc-100 dark:border-zinc-800 rounded-2xl divide-y divide-zinc-100 dark:divide-zinc-800 max-h-[250px] overflow-y-auto custom-scrollbar bg-white dark:bg-zinc-900">
                                {sourceSession?.moments.map((moment) => {
                                  const isChecked = importSelectedMomentIds.has(moment.id);
                                  const isCompetition = !!moment.exerciseId;
                                  return (
                                    <div
                                      key={moment.id}
                                      onClick={() => toggleImportMoment(moment.id)}
                                      className="flex items-start gap-3 p-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/35 cursor-pointer select-none transition-colors"
                                    >
                                      <div className="pt-0.5">
                                        <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${
                                          isChecked
                                            ? 'border-indigo-600 bg-indigo-600 text-white'
                                            : 'border-zinc-300 dark:border-zinc-700 text-transparent'
                                        }`}>
                                          <Check size={12} strokeWidth={4} />
                                        </div>
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 mb-0.5 justify-between">
                                          <h5 className="text-xs font-black text-zinc-900 dark:text-white truncate">
                                            {moment.name}
                                          </h5>
                                          <span className="shrink-0 text-[10px] font-bold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                                            {moment.duration} min
                                          </span>
                                        </div>
                                        <p className="text-[11px] text-zinc-400 truncate max-w-[250px]">
                                          {moment.description || 'Ingen beskrivning tillagd'}
                                        </p>
                                        {isCompetition && (
                                          <span className="inline-flex mt-1 text-[9px] font-bold text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/20 px-2 py-0.5 rounded border border-amber-100 dark:border-amber-900/30 uppercase tracking-wider">
                                            Innehåller tävling (rensas)
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>



                            </div>
                          )}
                        </div>

                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* EXPORT TAB */}
              {activeTab === 'export' && (
                <div className="space-y-6">
                  {currentSession.moments.length === 0 ? (
                    <div className="text-center py-12 text-zinc-400">
                      <FileText className="mx-auto mb-3 text-zinc-300" size={48} />
                      <p className="font-bold">Detta träningspass har inga tillagda övningar än</p>
                      <p className="text-xs mt-1">Planera eller lägg till några övningar i detta pass först innan du exporterar dem.</p>
                    </div>
                  ) : otherSessions.length === 0 ? (
                    <div className="text-center py-12 text-zinc-400">
                      <AlertCircle className="mx-auto mb-3 text-zinc-300" size={48} />
                      <p className="font-bold">Hittade inga andra träningspass i kalendern</p>
                      <p className="text-xs mt-1">Du måste ha mer än ett träningspass för att kunna exportera moment.</p>
                    </div>
                  ) : (
                    <div>
                      {/* Step Indicator on Mobile */}
                      <div className="md:hidden flex items-center gap-2 mb-4 px-1">
                        <div className={`flex-1 h-1.5 rounded-full transition-colors ${mobileStep === 1 ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-800'}`} />
                        <div className={`flex-1 h-1.5 rounded-full transition-colors ${mobileStep === 2 ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-800'}`} />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                        
                        {/* Left Side: Select Moments from current session */}
                        <div className={`space-y-4 ${mobileStep === 2 ? 'hidden md:block' : 'block'}`}>
                          <div className="flex items-center justify-between select-none">
                            <label className="text-xs font-bold text-zinc-500 dark:text-zinc-455 uppercase tracking-wider">
                              1. Välj övningar att kopiera
                            </label>
                            <button
                              onClick={toggleAllExportMoments}
                              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline hover:opacity-90"
                            >
                              {exportSelectedMomentIds.size === currentSession.moments.length
                                ? 'Avmarkera alla'
                                : 'Markera alla'}
                            </button>
                          </div>

                          <div className="border border-zinc-100 dark:border-zinc-800 rounded-2xl divide-y divide-zinc-100 dark:divide-zinc-800 max-h-[350px] overflow-y-auto custom-scrollbar bg-zinc-50/50 dark:bg-zinc-950/20">
                            {currentSession.moments.map((moment) => {
                              const isChecked = exportSelectedMomentIds.has(moment.id);
                              const isCompetition = !!moment.exerciseId;
                              return (
                                <div
                                  key={moment.id}
                                  onClick={() => toggleExportMoment(moment.id)}
                                  className="flex items-start gap-3 p-3.5 hover:bg-zinc-100 dark:hover:bg-zinc-850 cursor-pointer select-none transition-colors"
                                >
                                  <div className="pt-0.5">
                                    <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${
                                      isChecked
                                        ? 'border-indigo-600 bg-indigo-600 text-white'
                                        : 'border-zinc-300 dark:border-zinc-700 text-transparent'
                                    }`}>
                                      <Check size={12} strokeWidth={4} />
                                    </div>
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-0.5 justify-between">
                                      <h5 className="text-xs font-black text-zinc-900 dark:text-white truncate">
                                        {moment.name}
                                      </h5>
                                      <span className="shrink-0 text-[10px] font-bold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                                        {moment.duration} min
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-zinc-400 truncate max-w-[250px]">
                                      {moment.description || 'Ingen beskrivning tillagd'}
                                    </p>
                                    {isCompetition && (
                                      <span className="inline-flex mt-1 text-[9px] font-bold text-amber-600 dark:text-amber-500 bg-amber-50/70 dark:bg-amber-950/20 px-2 py-0.5 rounded border border-amber-100 dark:border-amber-900/30 uppercase tracking-wider">
                                        Innehåller tävling (rensas)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>


                        </div>

                        {/* Right Side: Select Target Sessions to write to */}
                        <div className={`space-y-4 ${mobileStep === 1 ? 'hidden md:block' : 'block'}`}>
                          {/* Mobile Back Button */}
                          <div className="md:hidden">
                            <button
                              onClick={() => setMobileStep(1)}
                              className="mb-2 py-2 px-4 rounded-xl bg-zinc-100 dark:bg-zinc-805 text-zinc-700 dark:text-zinc-300 font-bold text-xs flex items-center gap-1.5 transition-colors"
                            >
                              ← Ändra valda övningar
                            </button>
                          </div>

                          <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-zinc-500 dark:text-zinc-455 uppercase tracking-wider">
                              2. Välj vilka pass som ska få dessa övningar
                            </label>
                            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                              Valda: {exportTargetSessionIds.size} st
                            </span>
                          </div>

                          {/* Search Input */}
                          <div className="relative">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                            <input
                              type="text"
                              placeholder="Sök pass (datum, titel)..."
                              value={exportSearchQuery}
                              onChange={(e) => setExportSearchQuery(e.target.value)}
                              className="w-full pl-10 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-750 focus:bg-white dark:focus:bg-zinc-800 border-2 border-zinc-150 dark:border-zinc-850 focus:border-indigo-500 rounded-xl text-sm font-medium outline-none transition-all"
                            />
                          </div>

                          {/* Target sessions list representation */}
                          <div className="border border-zinc-100 dark:border-zinc-800 rounded-2xl divide-y divide-zinc-100 dark:divide-zinc-800 max-h-[220px] overflow-y-auto custom-scrollbar bg-white dark:bg-zinc-900">
                            {filteredExportSessions.length === 0 ? (
                              <div className="p-8 text-center text-zinc-400 text-xs">
                                Inga pass matchar sökningen
                              </div>
                            ) : (
                              filteredExportSessions.map((s) => {
                                const isChecked = exportTargetSessionIds.has(s.id);
                                return (
                                  <div
                                    key={s.id}
                                    onClick={() => toggleExportTargetSession(s.id)}
                                    className="flex items-start gap-3 p-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/35 cursor-pointer select-none transition-colors"
                                  >
                                    <div className="pt-0.5">
                                      <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${
                                        isChecked
                                          ? 'border-indigo-600 bg-indigo-600 text-white'
                                          : 'border-zinc-300 dark:border-zinc-700 text-transparent'
                                      }`}>
                                        <Check size={12} strokeWidth={4} />
                                      </div>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 mb-0.5 justify-between">
                                        <h5 className="text-xs font-black text-zinc-900 dark:text-white truncate">
                                          {s.title}
                                        </h5>
                                        <span className="shrink-0 text-[9px] font-bold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                                          {s.moments?.length || 0} övn och {s.attendance?.length || 0} närv
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        <Calendar size={10} className="text-zinc-400" />
                                        <span className="text-[10px] text-zinc-400">
                                          {formatDate(s.date)} • {s.startTime}{s.endTime ? `-${s.endTime}` : ''}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>



                        </div>

                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Footer */}
            <div className="p-4 sm:p-6 bg-zinc-50 dark:bg-zinc-950/20 border-t border-zinc-100 dark:border-zinc-800 flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-3">
              <button
                onClick={handleClose}
                className="w-full sm:w-auto px-6 py-3 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-350 rounded-2xl font-black uppercase tracking-wider text-xs transition-colors text-center"
              >
                Stäng
              </button>

              <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-3">
                {/* 1. Import tab - Bank Source */}
                {activeTab === 'import' && importSource === 'bank' && (
                  <button
                    type="button"
                    onClick={handleImport}
                    disabled={importSelectedBankIds.size === 0}
                    className={`w-full sm:w-auto px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-wider transition-all flex items-center justify-center gap-2 ${
                      importSelectedBankIds.size > 0
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-100 dark:shadow-none cursor-pointer'
                        : 'bg-zinc-100 dark:bg-zinc-850 text-zinc-400 dark:text-zinc-650 cursor-not-allowed'
                    }`}
                  >
                    <Download size={14} />
                    Hämta {importSelectedBankIds.size} valda
                  </button>
                )}

                {/* 2. Import tab - Sessions Source */}
                {activeTab === 'import' && importSource === 'sessions' && selectedSourceSessionId && (
                  <button
                    type="button"
                    onClick={handleImport}
                    disabled={importSelectedMomentIds.size === 0}
                    className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-wider transition-all flex items-center justify-center gap-2 ${
                      mobileStep === 2 ? 'w-full md:w-auto flex' : 'hidden md:flex'
                    } ${
                      importSelectedMomentIds.size > 0
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-100 dark:shadow-none cursor-pointer'
                        : 'bg-zinc-100 dark:bg-zinc-850 text-zinc-400 dark:text-zinc-650 cursor-not-allowed'
                    }`}
                  >
                    <Download size={14} />
                    Hämta {importSelectedMomentIds.size} valda {importSelectedMomentIds.size === 1 ? 'övning' : 'övningar'}
                  </button>
                )}

                {/* 3. Export tab - Step/Tab actions */}
                {activeTab === 'export' && currentSession.moments.length > 0 && otherSessions.length > 0 && (
                  <>
                    {/* Export Action Trigger Button (Desktop, or Mobile Step 2) */}
                    <button
                      type="button"
                      onClick={handleExport}
                      disabled={exportSelectedMomentIds.size === 0 || exportTargetSessionIds.size === 0}
                      className={`px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-wider transition-all flex items-center justify-center gap-2 ${
                        mobileStep === 2 ? 'w-full md:w-auto flex' : 'hidden md:flex'
                      } ${
                        exportSelectedMomentIds.size > 0 && exportTargetSessionIds.size > 0
                          ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-100 dark:shadow-none'
                          : 'bg-zinc-100 dark:bg-zinc-850 text-zinc-400 dark:text-zinc-650 cursor-not-allowed'
                      }`}
                    >
                      <Upload size={14} />
                      Kopiera {exportSelectedMomentIds.size} {exportSelectedMomentIds.size === 1 ? 'övning' : 'övningar'} till {exportTargetSessionIds.size} {exportTargetSessionIds.size === 1 ? 'pass' : 'pass'}
                    </button>

                    {/* Mobile Step 1 Continue Button */}
                    <button
                      type="button"
                      onClick={() => setMobileStep(2)}
                      disabled={exportSelectedMomentIds.size === 0}
                      className={`md:hidden px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-wider transition-all flex items-center justify-center gap-2 ${
                        mobileStep === 1 ? 'w-full flex' : 'hidden'
                      } ${
                        exportSelectedMomentIds.size > 0
                          ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-100 dark:shadow-none'
                          : 'bg-zinc-100 dark:bg-zinc-850 text-zinc-400 dark:text-zinc-650 cursor-not-allowed'
                      }`}
                    >
                      Gå vidare till mottagare →
                    </button>
                  </>
                )}
              </div>
            </div>

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
