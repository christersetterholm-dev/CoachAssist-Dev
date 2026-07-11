import React, { useState, useRef, useMemo } from 'react';
import { Search, Plus, Trash2, Edit2, Library, Clock, ExternalLink, Upload, Loader2, Save, X, FolderHeart, Check, Calendar, ChevronRight, Image as ImageIcon, ChevronDown, ChevronUp, Layout } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';
import { BankExercise, TrainingSession, SquadPlayer } from '../types';
import TacticalBoardModal from './TacticalBoardModal';

interface ExerciseBankViewProps {
  exerciseBank?: BankExercise[];
  exerciseBankCategories?: string[];
  onAddBankCategory?: (category: string) => void;
  onRemoveBankCategory?: (category: string) => void;
  onAddBankExercise?: (exercise: Omit<BankExercise, "id" | "createdAt">) => void;
  onUpdateBankExercise?: (id: string, updates: Partial<BankExercise>) => void;
  onRemoveBankExercise?: (id: string) => void;
  sessions?: TrainingSession[];
  onUpdateSession?: (updated: TrainingSession) => void;
  squad?: SquadPlayer[];
}

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

const getExerciseCategories = (ex: BankExercise): string[] => {
  if (ex.categories && ex.categories.length > 0) return ex.categories;
  if (ex.category) return [ex.category];
  return [];
};

const getExerciseImages = (ex: BankExercise): string[] => {
  if (ex.imageUrls && ex.imageUrls.length > 0) return ex.imageUrls;
  if (ex.imageUrl) return [ex.imageUrl];
  return [];
};

export default function ExerciseBankView({
  exerciseBank = [],
  exerciseBankCategories = [],
  onAddBankCategory,
  onRemoveBankCategory,
  onAddBankExercise,
  onUpdateBankExercise,
  onRemoveBankExercise,
  sessions = [],
  onUpdateSession,
  squad = []
}: ExerciseBankViewProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Alla');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [editingExercise, setEditingExercise] = useState<BankExercise | null>(null);

  // Selection and Add to Session states
  const [selectedExerciseIds, setSelectedExerciseIds] = useState<Set<string>>(new Set());
  const [showAddToSessionModal, setShowAddToSessionModal] = useState(false);
  const [exercisesToAddToSession, setExercisesToAddToSession] = useState<BankExercise[]>([]);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [successAnimation, setSuccessAnimation] = useState(false);
  const [lastSelectedSessionTitle, setLastSelectedSessionTitle] = useState('');

  const toggleSelectExercise = (id: string) => {
    setSelectedExerciseIds(prev => {
      const copy = new Set(prev);
      if (copy.has(id)) {
        copy.delete(id);
      } else {
        copy.add(id);
      }
      return copy;
    });
  };

  const handleAddSingleToSession = (ex: BankExercise) => {
    setExercisesToAddToSession([ex]);
    setShowAddToSessionModal(true);
  };

  const handlePlanMultiple = () => {
    const selected = exerciseBank.filter(ex => selectedExerciseIds.has(ex.id));
    if (selected.length === 0) return;
    setExercisesToAddToSession(selected);
    setShowAddToSessionModal(true);
  };

  const clearSelection = () => {
    setSelectedExerciseIds(new Set());
  };

  const handleSelectTargetSession = (targetSession: TrainingSession) => {
    if (!onUpdateSession) return;

    const newMoments = exercisesToAddToSession.map((ex, idx) => ({
      id: `moment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${ex.id.slice(-4)}-${idx}`,
      name: ex.name,
      duration: ex.duration || 15,
      description: ex.description,
      imageUrl: ex.imageUrl,
      imageUrls: ex.imageUrls || (ex.imageUrl ? [ex.imageUrl] : undefined),
      externalLink: ex.externalLink,
      bankExerciseId: ex.id,
    }));

    onUpdateSession({
      ...targetSession,
      moments: [...(targetSession.moments || []), ...newMoments],
    });

    setLastSelectedSessionTitle(targetSession.title);
    setSuccessAnimation(true);

    setTimeout(() => {
      setSelectedExerciseIds(new Set());
      setSuccessAnimation(false);
      setShowAddToSessionModal(false);
      setExercisesToAddToSession([]);
    }, 1800);
  };

  // Sort sessions: future sessions closest first, then past sessions most recent first
  const sortedSessions = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTimestamp = todayStart.getTime();

    return [...(sessions || [])]
      .filter(s => {
        const q = sessionSearchQuery.toLowerCase();
        return (
          s.title.toLowerCase().includes(q) ||
          (s.location && s.location.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const isFutureA = a.date >= todayTimestamp;
        const isFutureB = b.date >= todayTimestamp;

        if (isFutureA && !isFutureB) return -1;
        if (!isFutureA && isFutureB) return 1;

        if (isFutureA && isFutureB) {
          return a.date - b.date; // Future: ascending (closest first)
        } else {
          return b.date - a.date; // Past: descending (closest first)
        }
      });
  }, [sessions, sessionSearchQuery]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('sv-SE', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };
  
  // Image display lightbox state
  const [viewingImageInfo, setViewingImageInfo] = useState<{ urls: string[], index: number } | null>(null);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formDuration, setFormDuration] = useState(15);
  const [formDescription, setFormDescription] = useState('');
  const [formCategories, setFormCategories] = useState<string[]>(['Teknik']);
  const [formExternalLink, setFormExternalLink] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [formImageUrls, setFormImageUrls] = useState<string[]>([]);
  const [formTacticalBoards, setFormTacticalBoards] = useState<any[]>([]);
  const [isFormTacticalBoardOpen, setIsFormTacticalBoardOpen] = useState(false);
  const [tacticalBoardExercise, setTacticalBoardExercise] = useState<BankExercise | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dynamic Categories List for filter and selection
  const bankCategoriesList = ['Alla', ...DEFAULT_CATEGORIES, ...exerciseBankCategories];
  const assignmentCategoriesList = [...DEFAULT_CATEGORIES, ...exerciseBankCategories];

  const resetForm = () => {
    setFormName('');
    setFormDuration(15);
    setFormDescription('');
    setFormCategories(['Teknik']);
    setFormExternalLink('');
    setFormImageUrl('');
    setFormImageUrls([]);
    setFormTacticalBoards([]);
    setEditingExercise(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleOpenEdit = (ex: BankExercise) => {
    setEditingExercise(ex);
    setFormName(ex.name || '');
    setFormDuration(ex.duration || 15);
    setFormDescription(ex.description || '');
    setFormTacticalBoards(ex.tacticalBoards || []);
    
    // Fallback if ex.categories isn't present
    const initialCats = ex.categories && ex.categories.length > 0 
      ? ex.categories 
      : (ex.category ? [ex.category] : ['Teknik']);
    setFormCategories(initialCats);
    
    setFormExternalLink(ex.externalLink || '');
    setFormImageUrl('');
    setFormImageUrls(ex.imageUrls || (ex.imageUrl ? [ex.imageUrl] : []));
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    const finalCategories = formCategories.length > 0 ? formCategories : ['Annat'];

    const firstImg = formImageUrls[0] || formImageUrl.trim() || undefined;
    const finalUrls = formImageUrls.length > 0 ? formImageUrls : (formImageUrl.trim() ? [formImageUrl.trim()] : []);

    const dataPayload = {
      name: formName.trim(),
      duration: Number(formDuration) || 15,
      description: formDescription.trim() || undefined,
      category: finalCategories[0], // for compatibility
      categories: finalCategories,
      externalLink: formExternalLink.trim() || undefined,
      imageUrl: firstImg,
      imageUrls: finalUrls.length > 0 ? finalUrls : undefined,
      tacticalBoards: formTacticalBoards
    };

    if (editingExercise) {
      if (onUpdateBankExercise) {
        onUpdateBankExercise(editingExercise.id, dataPayload);
      }
    } else {
      if (onAddBankExercise) {
        onAddBankExercise(dataPayload);
      }
    }

    setIsModalOpen(false);
    resetForm();
  };

  const handleDelete = (id: string, name: string) => {
    const confirm = window.confirm(`Är du säker på att du vill ta bort "${name}" från övningsbanken?`);
    if (confirm && onRemoveBankExercise) {
      onRemoveBankExercise(id);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const filesArray = Array.from(files) as File[];
    setIsUploading(true);
    setUploadProgress(10);

    try {
      const uploadPromises = filesArray.map(async (file) => {
        if (file.size > 5 * 1024 * 1024) {
          console.warn(`Filen ${file.name} är för stor (max 5MB)`);
          return null;
        }

        const fileName = `${Date.now()}_${file.name}`;
        const storageRef = ref(storage, `moments/bank_exercises/${fileName}`);
        const uploadTask = uploadBytesResumable(storageRef, file);

        return new Promise<string | null>((resolve, reject) => {
          uploadTask.on('state_changed',
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(progress);
            },
            (error) => {
              console.error("Upload error", error);
              reject(error);
            },
            async () => {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              resolve(downloadURL);
            }
          );
        });
      });

      const results = await Promise.all(uploadPromises);
      const filteredResults = results.filter((url): url is string => url !== null);

      if (filteredResults.length > 0) {
        setFormImageUrls(prev => [...prev, ...filteredResults]);
      }
      setIsUploading(false);
    } catch (error) {
      console.error("Upload failed:", error);
      setIsUploading(false);
      alert("Kunde inte ladda upp en eller flera bilder.");
    }

    if (e.target) e.target.value = '';
  };

  // Filter bank items
  const filteredExercises = exerciseBank.filter(ex => {
    const matchesSearch = 
      (ex.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (ex.description || '').toLowerCase().includes(search.toLowerCase());
    
    const cats = getExerciseCategories(ex);
    const matchesCategory = selectedCategory === 'Alla' || cats.includes(selectedCategory);
    
    return matchesSearch && matchesCategory;
  });

  return (
    <div id="exercise-bank-container" className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-800 p-4 rounded-2xl border border-zinc-200/50 dark:border-zinc-700/50 shadow-sm">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Sök bland övningar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 pl-10 pr-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-800 dark:text-zinc-150 transition-colors placeholder:text-zinc-400"
          />
          {search && (
            <button 
              onClick={() => setSearch('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-650 dark:hover:text-zinc-200 rounded-full"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <button
          onClick={handleOpenCreate}
          className="flex items-center justify-center gap-2 bg-indigo-600 dark:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors shadow-sm"
        >
          <Plus size={16} />
          Skapa ny övning
        </button>
      </div>

      {/* Category Tabs & Manage Categories Button */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div className="flex flex-nowrap sm:flex-wrap gap-1.5 overflow-x-auto sm:overflow-x-visible pb-1 scrollbar-none whitespace-nowrap sm:whitespace-normal flex-1">
          {bankCategoriesList.map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                selectedCategory === category
                  ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100 shadow-sm'
                  : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-750 border-zinc-200 dark:border-zinc-700'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        <button
          onClick={() => setIsCategoryModalOpen(true)}
          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-zinc-50 dark:bg-zinc-900 text-zinc-650 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/60 rounded-xl text-xs font-bold uppercase tracking-wider transition-all self-start md:self-auto shadow-sm"
        >
          <FolderHeart size={14} className="text-zinc-550" />
          <span>Kategorier</span>
        </button>
      </div>

      {/* Exercises List */}
      {filteredExercises.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 bg-white dark:bg-zinc-800 rounded-3xl border border-zinc-200/50 dark:border-zinc-700/50 shadow-sm text-center">
          <div className="p-4 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-505 dark:text-indigo-400 rounded-full mb-4">
            <Library size={32} />
          </div>
          <h3 className="text-zinc-800 dark:text-zinc-150 font-bold text-base mb-1">Inga övningar hittades</h3>
          <p className="text-zinc-400 dark:text-zinc-500 text-sm max-w-sm">
            {search || selectedCategory !== 'Alla' 
              ? 'Försök ändra din sökning eller klicka på en annan kategori.'
              : 'Skapa din första övning i banken genom att klicka på knappen ovan för att komma igång!'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredExercises.map(ex => {
              const isSelected = selectedExerciseIds.has(ex.id);
              return (
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  key={ex.id}
                  className={`bg-white dark:bg-zinc-800 rounded-2xl border transition-all duration-300 flex flex-col overflow-hidden group hover:shadow-md relative ${
                    isSelected
                      ? 'border-indigo-500 dark:border-indigo-400 ring-2 ring-indigo-500/15 dark:ring-indigo-400/15 shadow-md shadow-indigo-50/20'
                      : 'border-zinc-200/50 dark:border-zinc-700/50 shadow-sm'
                  }`}
                >
                  {/* Select Checkbox Indicator */}
                  <div className="absolute top-3 right-3 z-20">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectExercise(ex.id);
                      }}
                      className={`w-6 h-6 rounded-full border flex items-center justify-center transition-all ${
                        isSelected
                          ? 'bg-indigo-600 border-indigo-600 dark:bg-indigo-500 dark:border-indigo-500 text-white shadow-sm shadow-indigo-150'
                          : 'bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm border-zinc-300 dark:border-zinc-650 hover:border-indigo-500 hover:scale-105 active:scale-95 text-transparent'
                      }`}
                      title={isSelected ? "Avmarkera övning" : "Markera övning"}
                    >
                      <Check size={12} className="stroke-[3.5]" />
                    </button>
                  </div>

                  {/* Thumbnail */}
                  {ex.imageUrl && (
                    <div 
                      onClick={() => {
                        const images = getExerciseImages(ex);
                        if (images.length > 0) {
                          setViewingImageInfo({ urls: images, index: 0 });
                        }
                      }}
                      className="w-full h-36 relative overflow-hidden bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-750 cursor-zoom-in group/thumb"
                    >
                      <img
                        src={ex.imageUrl}
                        alt={ex.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover/thumb:scale-[1.03]"
                      />
                      {getExerciseImages(ex).length > 1 && (
                        <div className="absolute bottom-3 right-3 bg-zinc-950/70 border border-white/10 text-white text-[10px] font-black px-2 py-1 rounded-lg backdrop-blur-md flex items-center gap-1 shadow-sm z-10">
                          <ImageIcon size={11} className="text-zinc-300" />
                          <span>1 / {getExerciseImages(ex).length}</span>
                        </div>
                      )}
                      <div className="absolute top-3 left-3 flex flex-wrap gap-1 max-w-[70%] pointer-events-none">
                        {getExerciseCategories(ex).map(cat => (
                          <span key={cat} className="bg-zinc-900/80 backdrop-blur-sm text-white px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider">
                            {cat}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Content */}
                  <div className="p-5 flex-1 flex flex-col">
                    {!ex.imageUrl && (
                      <div className="flex flex-wrap gap-1 mb-2.5 max-w-[85%]">
                        {getExerciseCategories(ex).map(cat => (
                          <span key={cat} className="bg-zinc-100 dark:bg-zinc-900 text-zinc-650 dark:text-zinc-450 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-zinc-200/35 dark:border-zinc-800/80">
                            {cat}
                          </span>
                        ))}
                      </div>
                    )}

                    <h4 className="text-zinc-800 dark:text-zinc-150 font-bold text-base line-clamp-2 leading-tight group-hover:text-indigo-650 dark:group-hover:text-indigo-400 transition-colors pr-6">
                      {ex.name}
                    </h4>

                    <div className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500 text-xs mt-1.5 font-semibold">
                      <Clock size={13} />
                      <span>Rekommenderad tid: {ex.duration || 15} min</span>
                    </div>

                    {ex.description && (
                      <p className="text-zinc-400 dark:text-zinc-500 text-xs mt-3 line-clamp-3 leading-relaxed">
                        {ex.description}
                      </p>
                    )}

                    <div className="mt-auto pt-4 flex items-center justify-between gap-1.5 border-t border-zinc-100 dark:border-zinc-750/50">
                      {ex.externalLink ? (
                        <a
                          href={ex.externalLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-zinc-400 hover:text-indigo-650 dark:hover:text-indigo-400 text-xs font-semibold transition-colors"
                        >
                          <ExternalLink size={13} />
                          Läs mer
                        </a>
                      ) : (
                        <div />
                      )}

                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleAddSingleToSession(ex)}
                          className="p-1 px-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 rounded-lg text-[11px] font-black uppercase tracking-wider flex items-center gap-0.5 transition-all"
                          title="Lägg till i träningspass"
                        >
                          <Plus size={13} />
                          <span>Planera</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setTacticalBoardExercise(ex)}
                          className="p-1 px-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 rounded-lg text-[11px] font-black uppercase tracking-wider flex items-center gap-0.5 transition-all"
                          title="Öppna rittavla"
                        >
                          <Layout size={11} />
                          <span>Rittavla {ex.tacticalBoards && ex.tacticalBoards.length > 0 ? `(${ex.tacticalBoards.length})` : ''}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(ex)}
                          className="p-1 px-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-750 text-zinc-500 hover:text-zinc-850 dark:hover:text-zinc-200 rounded-lg text-[11px] font-black uppercase tracking-wider flex items-center gap-0.5 transition-all"
                          title="Redigera övning"
                        >
                          <Edit2 size={11} />
                          <span>Ändra</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(ex.id, ex.name)}
                          className="p-1 px-1.5 hover:bg-red-50 dark:hover:bg-red-955/20 text-zinc-400 hover:text-red-500 rounded-lg text-[11px] font-black uppercase tracking-wider flex items-center gap-0.5 transition-all"
                          title="Ta bort övning"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Floating Multi-Select Action Bar */}
      <AnimatePresence>
        {selectedExerciseIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            className="fixed bottom-[84px] sm:bottom-[88px] left-1/2 -translate-x-1/2 z-[45] bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3.5 border border-zinc-800 dark:border-zinc-200 w-[92%] max-w-md justify-between animate-in fade-in slide-in-from-bottom-5 duration-200"
          >
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-full bg-indigo-650 text-white text-[10px] flex items-center justify-center font-black">
                {selectedExerciseIds.size}
              </span>
              <span className="text-xs font-black uppercase tracking-wider">
                {selectedExerciseIds.size === 1 ? 'Övning' : 'Övningar'} markerad{selectedExerciseIds.size === 1 ? '' : 'e'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearSelection}
                className="text-xs font-black uppercase tracking-wider px-3 py-1.5 rounded-lg text-zinc-400 dark:text-zinc-500 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
              >
                Avbryt
              </button>
              <button
                onClick={handlePlanMultiple}
                className="flex items-center gap-1 bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-750 dark:hover:bg-indigo-600 text-white dark:text-white px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md active:scale-95"
              >
                <Plus size={14} className="stroke-[3]" />
                Planera
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add To Training Session Modal Picker */}
      <AnimatePresence>
        {showAddToSessionModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-zinc-850 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-zinc-200/80 dark:border-zinc-750"
            >
              <div className="flex items-center justify-between bg-zinc-55 dark:bg-zinc-900/50 px-6 py-4.5 border-b border-zinc-150 dark:border-zinc-750">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-lg">
                    <Calendar size={18} />
                  </span>
                  <h3 className="text-zinc-900 dark:text-white font-black text-base uppercase tracking-wider">
                    Välj träningspass
                  </h3>
                </div>
                {!successAnimation && (
                  <button
                    onClick={() => {
                      setShowAddToSessionModal(false);
                      setExercisesToAddToSession([]);
                    }}
                    className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 dark:text-zinc-500 rounded-full transition-colors"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              {successAnimation ? (
                <div className="p-12 flex flex-col items-center justify-center text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 rounded-full flex items-center justify-center shadow-lg"
                  >
                    <Check size={36} className="stroke-[3]" />
                  </motion.div>
                  <h4 className="text-zinc-900 dark:text-white text-lg font-black uppercase tracking-wider">
                    Övningar tillagda!
                  </h4>
                  <p className="text-zinc-500 dark:text-zinc-400 text-sm max-w-sm">
                    Kopierade {exercisesToAddToSession.length} {exercisesToAddToSession.length === 1 ? 'övning' : 'övningar'} till passet <span className="font-extrabold text-indigo-600 dark:text-indigo-400">"{lastSelectedSessionTitle}"</span>.
                  </p>
                </div>
              ) : (
                <div className="p-6 space-y-5">
                  <p className="text-zinc-500 dark:text-zinc-400 text-xs font-semibold">
                    Välj vilket träningspass du vill lägga till de <span className="font-extrabold text-zinc-900 dark:text-white">{exercisesToAddToSession.length}</span> valda {exercisesToAddToSession.length === 1 ? 'övningen' : 'övningarna'} till:
                  </p>

                  {/* Session Search Input */}
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Sök pass..."
                      value={sessionSearchQuery}
                      onChange={(e) => setSessionSearchQuery(e.target.value)}
                      className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 pl-9 pr-4 py-2 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-805 dark:text-zinc-150 transition-colors"
                    />
                  </div>

                  {/* Sessions Scroll List */}
                  <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-700">
                    {sessions.length === 0 ? (
                      <div className="py-8 text-center text-zinc-400 text-sm">
                        Inga träningspass tillgängliga.
                      </div>
                    ) : sortedSessions.length === 0 ? (
                      <div className="py-8 text-center text-zinc-400 text-sm">
                        Inga träningspass matchar din sökning.
                      </div>
                    ) : (
                      sortedSessions.map(session => (
                        <button
                          key={session.id}
                          onClick={() => handleSelectTargetSession(session)}
                          className="w-full text-left p-3.5 bg-zinc-50 hover:bg-indigo-50/40 dark:bg-zinc-900/40 dark:hover:bg-indigo-950/20 border border-zinc-150 dark:border-zinc-800 rounded-xl flex items-center justify-between gap-3 group transition-all"
                        >
                          <div className="flex-1 min-w-0">
                            <h4 className="text-zinc-800 dark:text-zinc-150 font-black text-sm group-hover:text-indigo-650 dark:group-hover:text-indigo-400 transition-colors truncate">
                              {session.title}
                            </h4>
                            <p className="text-xs text-zinc-405 dark:text-zinc-500 mt-0.5 flex items-center gap-1.5 font-bold">
                              <span>{formatDate(session.date)}</span>
                              <span>•</span>
                              <span>{session.startTime}{session.endTime ? `-${session.endTime}` : ''}</span>
                              {session.location && (
                                <>
                                  <span>•</span>
                                  <span className="truncate max-w-[120px]">{session.location}</span>
                                </>
                              )}
                            </p>
                          </div>
                          <ChevronRight size={16} className="text-zinc-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-transform group-hover:translate-x-0.5" />
                        </button>
                      ))
                    )}
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddToSessionModal(false);
                        setExercisesToAddToSession([]);
                      }}
                      className="px-5 py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl text-xs font-black uppercase tracking-wider transition-colors"
                    >
                      Stäng
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Category Management Modal */}
      <AnimatePresence>
        {isCategoryModalOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-zinc-800 w-full max-w-md rounded-3xl shadow-xl overflow-hidden border border-zinc-200 dark:border-zinc-700"
            >
              <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50 px-6 py-4 border-b border-zinc-200/50 dark:border-zinc-700/50">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-lg">
                    <FolderHeart size={16} />
                  </span>
                  <h3 className="text-zinc-800 dark:text-zinc-150 font-bold text-base">
                    Hantera egna kategorier
                  </h3>
                </div>
                <button
                  onClick={() => setIsCategoryModalOpen(false)}
                  className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-805 text-zinc-400 dark:text-zinc-500 rounded-full transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Add New Category form */}
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newCategoryInput.trim()) return;
                    if (onAddBankCategory) {
                      onAddBankCategory(newCategoryInput.trim());
                    }
                    setNewCategoryInput('');
                  }}
                  className="space-y-2"
                >
                  <label className="text-zinc-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider block">
                    Skapa ny kategori
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCategoryInput}
                      onChange={(e) => setNewCategoryInput(e.target.value)}
                      placeholder="t.ex. Smålagsspel, Nickar..."
                      maxLength={30}
                      className="flex-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-800 dark:text-zinc-200"
                    />
                    <button
                      type="submit"
                      className="flex items-center gap-1 bg-indigo-600 dark:bg-indigo-500 text-white px-4 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors shadow-sm"
                    >
                      <Plus size={14} />
                      <span>Lägg till</span>
                    </button>
                  </div>
                </form>

                {/* Category Lists */}
                <div className="space-y-2">
                  <label className="text-zinc-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider block">
                    Dina egna kategorier
                  </label>
                  {exerciseBankCategories.length === 0 ? (
                    <p className="text-zinc-400 dark:text-zinc-500 text-xs italic py-2">
                      Du har inte skapat några egna kategorier än.
                    </p>
                  ) : (
                    <div className="max-h-56 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-750/55 rounded-xl border border-zinc-200 dark:border-zinc-700">
                      {exerciseBankCategories.map(cat => (
                        <div key={cat} className="flex items-center justify-between px-4 py-2.5 bg-zinc-50/50 dark:bg-zinc-900/10">
                          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{cat}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const confirmDelete = window.confirm(`Är du säker på att du vill ta bort kategorin "${cat}"? Övningar med denna kategori kommer inte raderas men tilldelas inte längre denna kategori automatiskt.`);
                              if (confirmDelete && onRemoveBankCategory) {
                                onRemoveBankCategory(cat);
                                if (selectedCategory === cat) {
                                  setSelectedCategory('Alla');
                                }
                              }
                            }}
                            className="p-1 hover:bg-red-50 dark:hover:bg-red-955/30 text-zinc-400 hover:text-red-500 rounded-lg transition-colors"
                            title="Ta bort kategori"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-750/50 text-right">
                  <button
                    type="button"
                    onClick={() => setIsCategoryModalOpen(false)}
                    className="px-5 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-650 text-zinc-700 dark:text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors animate-none"
                  >
                    Stäng
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create / Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-zinc-800 w-full max-w-lg rounded-3xl shadow-xl overflow-hidden border border-zinc-200 dark:border-zinc-700"
            >
              <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50 px-6 py-4 border-b border-zinc-200/50 dark:border-zinc-700/50">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-lg">
                    <FolderHeart size={16} />
                  </span>
                  <h3 className="text-zinc-800 dark:text-zinc-150 font-bold text-base">
                    {editingExercise ? 'Redigera övning' : 'Skapa övning i banken'}
                  </h3>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-805 text-zinc-400 dark:text-zinc-500 rounded-full transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-zinc-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider">
                    Övningsnamn *
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="t.ex. Kvadraten, Spelvändning..."
                    className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-800 dark:text-zinc-155"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Duration */}
                  <div className="space-y-1.5">
                    <label className="text-zinc-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider">
                      Tid budget (min) *
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={formDuration}
                      onChange={(e) => setFormDuration(Number(e.target.value) || 15)}
                      className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-800 dark:text-zinc-155"
                    />
                  </div>
                </div>

                {/* Categories / Tags Selection */}
                <div className="space-y-2 pt-1">
                  <label className="text-zinc-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider block">
                    Välj kategorier / etiketter (många möjliga) *
                  </label>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    Klicka på etiketterna nedan för att välja vilka kategorier övningen tillhör.
                  </p>
                  <div className="flex flex-wrap gap-1.5 p-3 bg-zinc-50 dark:bg-zinc-900/60 rounded-2xl border border-zinc-200/65 dark:border-zinc-700/60 max-h-48 overflow-y-auto">
                    {assignmentCategoriesList.map(cat => {
                      const isSelected = formCategories.includes(cat);
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setFormCategories(prev => prev.filter(c => c !== cat));
                            } else {
                              setFormCategories(prev => [...prev, cat]);
                            }
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1 cursor-pointer select-none ${
                            isSelected
                              ? 'bg-indigo-600 dark:bg-indigo-500 border-indigo-600 dark:border-indigo-500 text-white shadow-sm font-black'
                              : 'bg-white dark:bg-zinc-850 hover:bg-zinc-100 dark:hover:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-650 dark:text-zinc-350'
                          }`}
                        >
                          <span>{cat}</span>
                          {isSelected && <X size={12} className="ml-0.5 opacity-80" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-zinc-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider">
                    Beskrivning / Instruktioner
                  </label>
                  <textarea
                    rows={4}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Instruktioner för övningen..."
                    className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-800 dark:text-zinc-155 resize-none placeholder:text-zinc-400"
                  />
                </div>

                {/* Image Upload/Link */}
                <div className="space-y-1.5">
                  <label className="text-zinc-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider block">
                    Övningsbilder ({formImageUrls.length})
                  </label>

                  {/* Thumbnails grid */}
                  {formImageUrls.length > 0 && (
                    <div className="flex flex-wrap gap-2 p-3 bg-zinc-50 dark:bg-zinc-900/40 rounded-2xl border border-zinc-150 dark:border-zinc-750/80">
                      {formImageUrls.map((url, idx) => (
                        <div key={idx} className="relative group w-20 h-20 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-750 shadow-sm shrink-0 bg-white dark:bg-zinc-800">
                          <img src={url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          <button
                            type="button"
                            onClick={() => {
                              setFormImageUrls(prev => prev.filter((_, i) => i !== idx));
                            }}
                            className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors opacity-90 group-hover:opacity-100"
                            title="Ta bort bild"
                          >
                            <X size={10} />
                          </button>
                          {idx === 0 && (
                            <span className="absolute bottom-1 left-1 px-1 bg-indigo-650 text-white text-[8px] font-black uppercase rounded">
                              Huvudbild
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Image Inputs */}
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={formImageUrl}
                        onChange={(e) => setFormImageUrl(e.target.value)}
                        placeholder="Klistra in en bildlänk..."
                        className="flex-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-805 dark:text-zinc-150"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (formImageUrl.trim()) {
                              setFormImageUrls(prev => [...prev, formImageUrl.trim()]);
                              setFormImageUrl('');
                            }
                          }
                        }}
                      />
                      {formImageUrl.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            if (formImageUrl.trim()) {
                              setFormImageUrls(prev => [...prev, formImageUrl.trim()]);
                              setFormImageUrl('');
                            }
                          }}
                          className="bg-zinc-100 dark:bg-zinc-750 hover:bg-zinc-250 dark:hover:bg-zinc-700 px-3.5 rounded-xl text-xs font-bold transition-colors text-zinc-700 dark:text-zinc-300"
                        >
                          Lägg till
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 px-4 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 border border-indigo-100/30"
                      >
                        {isUploading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Upload size={14} />
                        )}
                        <span>{formImageUrls.length > 0 ? 'Fler' : 'Välj bilder'}</span>
                      </button>
                    </div>

                    {isUploading && (
                      <div className="w-full bg-zinc-100 dark:bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-indigo-650 h-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    )}

                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      multiple
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>
                </div>

                {/* External Link */}
                <div className="space-y-1.5">
                  <label className="text-zinc-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider">
                    Länk till video (t.ex. youtube) eller mer info
                  </label>
                  <input
                    type="url"
                    value={formExternalLink}
                    onChange={(e) => setFormExternalLink(e.target.value)}
                    placeholder="https://www.youtube.com/... eller liknande"
                    className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-800 dark:text-zinc-155"
                  />
                </div>

                {/* Tactical Boards Whiteboard Section */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-zinc-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider block">
                    Rittavlor ({formTacticalBoards.length})
                  </label>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    Skapa och rita illustrationer eller taktiska genomgångar för övningen.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsFormTacticalBoardOpen(true);
                      }}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/25 dark:hover:bg-emerald-950/45 text-emerald-750 dark:text-emerald-400 rounded-xl text-xs font-black uppercase tracking-wider transition-all border border-emerald-200 dark:border-emerald-900/40 active:scale-95"
                    >
                      <Layout size={14} />
                      <span>{formTacticalBoards.length > 0 ? 'Öppna rittavlor' : 'Skapa rittavla'}</span>
                    </button>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="pt-4 flex gap-3 border-t border-zinc-100 dark:border-zinc-750/50">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-3 border border-zinc-250 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-750 text-zinc-650 dark:text-zinc-350 rounded-xl text-sm font-bold transition-colors"
                  >
                    Avbryt
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 bg-indigo-600 dark:bg-indigo-500 text-white hover:bg-indigo-750 dark:hover:bg-indigo-600 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98]"
                  >
                    <Save size={16} />
                    Spara
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewingImageInfo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[120] flex items-center justify-center p-4 sm:p-8"
            onClick={() => setViewingImageInfo(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-5xl w-full max-h-full flex flex-col items-center gap-6"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setViewingImageInfo(null)}
                className="absolute -top-12 sm:top-0 sm:-right-16 p-3 text-white/50 hover:text-white transition-colors"
                title="Stäng bild"
              >
                <X size={32} />
              </button>
              
              <div className="relative w-full h-[60vh] sm:h-[70vh] rounded-2xl overflow-hidden shadow-2xl bg-zinc-900 border border-white/10 flex items-center justify-center group">
                <img 
                  src={viewingImageInfo.urls[viewingImageInfo.index]} 
                  alt="Fullskärmsbild" 
                  className="max-w-full max-h-full object-contain"
                  referrerPolicy="no-referrer"
                />

                {viewingImageInfo.urls.length > 1 && (
                  <>
                    <button
                      onClick={() => setViewingImageInfo(prev => prev ? ({ ...prev, index: (prev.index - 1 + prev.urls.length) % prev.urls.length }) : null)}
                      className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/40 hover:bg-black/60 text-white rounded-full transition-all opacity-100 sm:opacity-0 group-hover:opacity-100"
                    >
                      <ChevronDown className="rotate-90" size={24} />
                    </button>
                    <button
                      onClick={() => setViewingImageInfo(prev => prev ? ({ ...prev, index: (prev.index + 1) % prev.urls.length }) : null)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/40 hover:bg-black/60 text-white rounded-full transition-all opacity-100 sm:opacity-0 group-hover:opacity-100"
                    >
                      <ChevronUp className="rotate-90" size={24} />
                    </button>
                    <div className="absolute bottom-4 left-1/2 -translate-y-1/2 -translate-x-1/2 px-3 py-1 bg-black/40 text-white text-[10px] font-black rounded-full backdrop-blur-md">
                      {viewingImageInfo.index + 1} / {viewingImageInfo.urls.length}
                    </div>
                  </>
                )}
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setViewingImageInfo(null)}
                  className="bg-white/10 hover:bg-white/20 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest backdrop-blur-md transition-all border border-white/10"
                >
                  Stäng
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Direct whiteboard modal from exercise cards */}
      {tacticalBoardExercise && (
        <TacticalBoardModal
          boards={tacticalBoardExercise.tacticalBoards || []}
          onSave={(updatedBoards) => {
            if (onUpdateBankExercise) {
              onUpdateBankExercise(tacticalBoardExercise.id, { tacticalBoards: updatedBoards });
            }
            setTacticalBoardExercise(null);
          }}
          onClose={() => setTacticalBoardExercise(null)}
          squad={squad}
          title={`Rittavla - ${tacticalBoardExercise.name}`}
        />
      )}

      {/* Whiteboard modal from within Create/Edit Form modal */}
      {isFormTacticalBoardOpen && (
        <TacticalBoardModal
          boards={formTacticalBoards}
          onSave={(updatedBoards) => {
            setFormTacticalBoards(updatedBoards);
            setIsFormTacticalBoardOpen(false);
          }}
          onClose={() => setIsFormTacticalBoardOpen(false)}
          squad={squad}
          title={`Rittavlor - ${formName || 'Ny övning'}`}
        />
      )}
    </div>
  );
}
