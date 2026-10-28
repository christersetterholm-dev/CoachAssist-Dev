import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ArrowLeft, Trash2, GripVertical, Clock, Calendar, Check, CheckCircle2, ListTodo, Save, ChevronDown, ChevronLeft, ChevronRight, Play, PlusCircle, Users, X, Edit2, Image as ImageIcon, Link as LinkIcon, Youtube, ExternalLink, Maximize2, Upload, Loader2, FileText, Copy, Library, Download, Layout, Bell, Eye, EyeOff, UserCheck, Trophy, Dumbbell, MapPin, RotateCcw, Shapes } from 'lucide-react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'motion/react';
import { storage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from '../lib/firebase';
import { TrainingSession, SessionMoment, Exercise, SquadPlayer, UserProfile, getExerciseImages } from '../types';
import TeamOverviewModal from './TeamOverviewModal';
import MomentCopyModal from './MomentCopyModal';
import TacticalBoardModal from './TacticalBoardModal';
import { SessionRsvpView } from './SessionRsvpView';
import { categorizeSession, isMatchSession } from '../utils/sessionCategory';
import { optimizeImageForUpload } from '../utils/imageOptimizer';
import { Button, IconButton, Card, SectionHeader, SegmentedTabs, Badge, EmptyState, Sheet, TextArea, TextInput } from './ui';

interface SessionEditorProps {
  session: TrainingSession;
  exercises: Exercise[];
  squad?: SquadPlayer[];
  onUpdate: (updated: TrainingSession) => void;
  onClose: () => void;
  user?: any;
  userRoles?: string[];
  /** Huvudadministratören får alltid planera och ändra, även utan roll i laget. */
  isRootAdmin?: boolean;
  userProfile?: UserProfile;
  onCreateExercise?: (name: string, momentId: string) => string;
  onSelectExercise?: (id: string) => void;
  onEditExercise?: (id: string) => void;
  onDeleteExercise?: (id: string) => void;
  onMovePlayer?: (exerciseId: string, playerId: string, targetTeamId: string) => void;
  onCopyTeams?: (sourceId: string, targetId: string) => void;
  initialMode?: 'plan' | 'live';
  onModeChange?: (mode: 'plan' | 'live') => void;
  initialTab?: 'schema' | 'attendance' | 'rsvp';
  adminUrl?: string;
  allSessions?: TrainingSession[];
  onUpdateSession?: (updated: TrainingSession) => void;
  exerciseBank?: any[];
  exerciseBankCategories?: string[];
  onSaveToBank?: (moment: SessionMoment) => any;
  onUpdateBankExercise?: (id: string, updates: Partial<any>) => void;
  onOpenLineup?: (session: TrainingSession) => void;
}

interface MomentItemProps {
  moment: SessionMoment;
  details: any;
  mode: 'plan' | 'live' | 'view';
  exercises: Exercise[];
  sessionDate: number;
  updateMoment: (id: string, updates: Partial<SessionMoment>) => void;
  removeMoment: (id: string) => void;
  setConfirmDeleteMoment: (info: { id: string, name: string } | null) => void;
  onCreateExercise?: (name: string, momentId: string) => string;
  onSelectExercise?: (id: string) => void;
  onEditExercise?: (id: string) => void;
  onDeleteExercise?: (id: string) => void;
  onShowTeams?: (id: string) => void;
  onViewImage?: (urls: string[], index: number) => void;
  setConfirmDeleteExercise: (info: { exerciseId: string, momentId: string, name: string } | null) => void;
  sessionTitle?: string;
  key?: string;
  exerciseBank?: any[];
  onSaveToBank?: (moment: SessionMoment) => any;
  onUpdateBankExercise?: (id: string, updates: Partial<any>) => void;
  onOpenTacticalBoard?: (moment: SessionMoment) => void;
  isCoachOrAdmin?: boolean;
}

function MomentItem({ 
  moment, 
  details, 
  mode, 
  exercises, 
  sessionDate,
  sessionTitle,
  updateMoment, 
  removeMoment: _removeMoment, 
  setConfirmDeleteMoment,
  onCreateExercise, 
  onSelectExercise,
  onEditExercise,
  onDeleteExercise,
  onShowTeams,
  onViewImage,
  setConfirmDeleteExercise,
  onAddAfter,
  exerciseBank = [],
  onSaveToBank,
  onUpdateBankExercise,
  onOpenTacticalBoard,
  isCoachOrAdmin = true
}: MomentItemProps & { onAddAfter?: () => void }) {
  const dragControls = useDragControls();
  const [showMediaInputs, setShowMediaInputs] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [imageUrlInput, setImageUrlInput] = useState('');

  const [justUpdatedBank, setJustUpdatedBank] = useState(false);
  const [justFetchedBank, setJustFetchedBank] = useState(false);

  const bankExercise = useMemo(() => {
    if (moment.bankExerciseId) {
      return (exerciseBank || []).find((ex: any) => ex.id === moment.bankExerciseId);
    }
    if (!moment.name?.trim()) return null;
    return (exerciseBank || []).find(
      (ex: any) => ex.name?.trim().toLowerCase() === moment.name?.trim().toLowerCase()
    );
  }, [exerciseBank, moment.bankExerciseId, moment.name]);

  const allMomentImages = useMemo(() => {
    const list: string[] = [];
    if (moment.imageUrls && Array.isArray(moment.imageUrls)) {
      moment.imageUrls.forEach(u => {
        if (typeof u === 'string' && u.trim() && !list.includes(u.trim())) {
          list.push(u.trim());
        }
      });
    }
    if (typeof moment.imageUrl === 'string' && moment.imageUrl.trim() && !list.includes(moment.imageUrl.trim())) {
      list.unshift(moment.imageUrl.trim());
    }
    if (typeof (moment as any).image === 'string' && (moment as any).image.trim() && !list.includes((moment as any).image.trim())) {
      list.push((moment as any).image.trim());
    }
    if (typeof (moment as any).photoUrl === 'string' && (moment as any).photoUrl.trim() && !list.includes((moment as any).photoUrl.trim())) {
      list.push((moment as any).photoUrl.trim());
    }

    // Fallback: If moment has no images of its own, check if linked bank exercise has images
    if (list.length === 0 && bankExercise) {
      const bankImgs = getExerciseImages(bankExercise);
      for (const img of bankImgs) {
        if (!list.includes(img)) list.push(img);
      }
    }

    return list;
  }, [moment.imageUrl, moment.imageUrls, (moment as any).image, (moment as any).photoUrl, bankExercise]);

  const mediaCount = useMemo(() => {
    return allMomentImages.length + (moment.externalLink?.trim() ? 1 : 0);
  }, [allMomentImages.length, moment.externalLink]);

  const isSavedInBank = useMemo(() => {
    return !!bankExercise;
  }, [bankExercise]);

  const hasModifications = useMemo(() => {
    if (!bankExercise) return false;
    
    const bankUrls = (bankExercise.imageUrls && bankExercise.imageUrls.length > 0)
      ? bankExercise.imageUrls.filter(Boolean)
      : (bankExercise.imageUrl ? [bankExercise.imageUrl] : []);
    const momentUrls = allMomentImages;
    const urlsDiffer = JSON.stringify([...bankUrls].sort()) !== JSON.stringify([...momentUrls].sort());

    return (
      (moment.name || '').trim() !== (bankExercise.name || '').trim() ||
      (moment.duration || 15) !== (bankExercise.duration || 15) ||
      (moment.description || '').trim() !== (bankExercise.description || '').trim() ||
      (moment.externalLink || '').trim() !== (bankExercise.externalLink || '').trim() ||
      urlsDiffer
    );
  }, [moment, bankExercise, allMomentImages]);

  useEffect(() => {
    const adjustHeight = () => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    };

    // Run immediately
    adjustHeight();

    // Also run after a short delay to handle potential layout shifts on mobile
    const timeoutId = setTimeout(adjustHeight, 10);
    
    // Add window resize listener
    window.addEventListener('resize', adjustHeight);
    
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', adjustHeight);
    };
  }, [moment.description, mode]);

  // Keep latest moment in a ref to avoid stale closures during async operations like upload
  const momentRef = useRef(moment);
  momentRef.current = moment;

  const isYouTube = (url?: string) => {
    if (!url) return false;
    return url.includes('youtube.com') || url.includes('youtu.be');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const filesArray = Array.from(files) as File[];
    setUploadProgress(5);
    
    try {
      // Process uploads in parallel with HEIC conversion and JPEG compression
      const uploadPromises = filesArray.map(async (rawFile, idx) => {
        try {
          const optimizedFile = await optimizeImageForUpload(rawFile);
          const cleanName = optimizedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const fileName = `${Date.now()}_${idx}_${cleanName}`;
          const storageRef = ref(storage, `moments/${momentRef.current.id}/${fileName}`);
          const uploadTask = uploadBytesResumable(storageRef, optimizedFile);

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
        } catch (fileErr) {
          console.error(`Error processing file ${rawFile.name}:`, fileErr);
          return null;
        }
      });

      const results = await Promise.all(uploadPromises);
      const filteredResults = results.filter((url): url is string => url !== null);
      
      if (filteredResults.length > 0) {
        // Use the ref to get the absolute latest state of the moment before updating
        const latestMoment = momentRef.current;
        const currentUrls = (latestMoment.imageUrls && latestMoment.imageUrls.length > 0)
          ? latestMoment.imageUrls.filter(Boolean)
          : (latestMoment.imageUrl ? [latestMoment.imageUrl] : []);
        const combined = [...currentUrls, ...filteredResults];
        
        updateMoment(latestMoment.id, { 
          imageUrls: combined,
          imageUrl: combined[0] || undefined
        });
      }
      
      setUploadProgress(null);
    } catch (error: any) {
      console.error("Setup error", error);
      setUploadProgress(null);
      if (error?.code === 'storage/unauthorized') {
        alert("Bilden kunde inte laddas upp eftersom du saknar behörighet. Logga ut och in igen och försök på nytt.");
      } else {
        alert("Kunde inte ladda upp en eller flera bilder.");
      }
    }

    // Reset input
    if (e.target) e.target.value = '';
  };

  const isPlan = mode === 'plan';
  const isLive = mode === 'live';
  const boardCount = moment.tacticalBoards?.length || 0;

  const addImageUrl = () => {
    if (!imageUrlInput.trim()) return;
    const newUrls = [...allMomentImages, imageUrlInput.trim()];
    updateMoment(moment.id, { imageUrls: newUrls, imageUrl: newUrls[0] || undefined });
    setImageUrlInput('');
  };

  return (
    <Reorder.Item
      key={moment.id}
      value={moment}
      dragListener={false}
      dragControls={dragControls}
      className="relative flex gap-3 sm:gap-4"
    >
      {/* Tidslinje */}
      <div className="w-12 sm:w-14 shrink-0 flex flex-col items-center select-none" aria-hidden="true">
        <span className={`mt-4 font-bold tabular-nums ${isLive ? 'text-base text-indigo-600 dark:text-indigo-400' : 'text-sm text-zinc-900 dark:text-white'}`}>
          {details.startTimeStr}
        </span>
        <span className="text-xs font-medium tabular-nums text-zinc-400">{details.endTimeStr}</span>
        <span className="mt-2 flex-1 w-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <div className="flex-1 min-w-0 pb-4">
        <Card padded={false} className="p-3.5 sm:p-4 space-y-3">
          <div className="flex items-start gap-1.5">
            {isCoachOrAdmin && isPlan && (
              <div
                onPointerDown={(e) => dragControls.start(e)}
                className="w-10 h-10 -ml-1.5 shrink-0 flex items-center justify-center rounded-xl cursor-grab active:cursor-grabbing touch-none text-zinc-300 dark:text-zinc-600 hover:text-indigo-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                title="Dra för att flytta"
                aria-label="Dra för att flytta momentet"
              >
                <GripVertical size={20} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              {isPlan ? (
                <TextInput
                  type="text"
                  value={moment.name || ''}
                  onChange={(e) => updateMoment(moment.id, { name: e.target.value })}
                  className="w-full h-10 bg-transparent border-none px-0 text-base sm:text-lg font-bold text-zinc-900 dark:text-white focus:ring-0 placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
                  placeholder="Namn på momentet"
                  aria-label="Namn på momentet"
                />
              ) : (
                <h4 className="pt-1.5 text-base sm:text-lg font-bold text-zinc-900 dark:text-white break-words [overflow-wrap:anywhere]">
                  {moment.name || sessionTitle || 'Namnlöst moment'}
                </h4>
              )}
            </div>
            {isPlan ? (
              <label className="shrink-0 h-10 inline-flex items-center gap-1 pl-2.5 pr-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-sm font-semibold text-zinc-700 dark:text-zinc-200 cursor-pointer">
                <Clock size={14} className="text-zinc-400" />
                <select
                  value={Number(moment.duration) || 10}
                  onChange={(e) => updateMoment(moment.id, { duration: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  className="appearance-none bg-transparent border-none p-0 text-sm font-semibold text-zinc-900 dark:text-white focus:ring-0 text-right cursor-pointer"
                  aria-label="Längd i minuter"
                >
                  {Array.from({ length: 120 }, (_, i) => i + 1).map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <span className="text-zinc-500 dark:text-zinc-400">min</span>
              </label>
            ) : (
              <Badge tone={isLive ? 'brand' : 'neutral'} icon={<Clock size={12} />} className="shrink-0 mt-2">{moment.duration} min</Badge>
            )}
          </div>

          {isPlan ? (
            <TextArea
              ref={textareaRef}
              value={moment.description || ''}
              onChange={(e) => updateMoment(moment.id, { description: e.target.value })}
              className="w-full bg-transparent border-none p-0 text-base sm:text-sm text-zinc-600 dark:text-zinc-300 focus:ring-0 resize-none overflow-hidden min-h-[40px] placeholder:text-zinc-400"
              placeholder="Beskriv vad som ska göras i momentet"
              aria-label="Beskrivning"
              rows={1}
            />
          ) : (
            moment.description && (
              <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {moment.description}
              </p>
            )
          )}

          {/* Bilder och länkar */}
          {isPlan ? (
            <div className="space-y-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-10 -ml-2"
                icon={<ImageIcon size={16} />}
                onClick={() => setShowMediaInputs(!showMediaInputs)}
                aria-expanded={showMediaInputs}
              >
                Bilder och länk
                {!showMediaInputs && mediaCount > 0 && <Badge tone="brand" className="h-5 px-1.5">{mediaCount}</Badge>}
                <ChevronDown size={16} className={`transition-transform ${showMediaInputs ? 'rotate-180' : ''}`} />
              </Button>

              <AnimatePresence>
                {showMediaInputs && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="space-y-3 overflow-hidden"
                  >
                    <div className="space-y-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
                      <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Bilder ({allMomentImages.length})</p>
                      {allMomentImages.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {allMomentImages.map((url, idx) => (
                            <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 shrink-0 bg-white dark:bg-zinc-950">
                              <img src={url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              <button
                                type="button"
                                onClick={() => {
                                  const targetUrl = allMomentImages[idx];
                                  const newUrls = allMomentImages.filter((_, i) => i !== idx);
                                  updateMoment(moment.id, {
                                    imageUrls: newUrls.length > 0 ? newUrls : undefined,
                                    imageUrl: newUrls[0] || undefined
                                  });
                                  if (targetUrl && (targetUrl.includes('/uploads/') || targetUrl.includes('photo_'))) {
                                    deleteObject(targetUrl).catch(e => console.warn('Could not delete image on moment image removal:', e));
                                  }
                                }}
                                className="absolute top-0 right-0 w-7 h-7 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white rounded-bl-lg"
                                title="Ta bort bild"
                                aria-label="Ta bort bild"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="url"
                          value={imageUrlInput}
                          onChange={(e) => setImageUrlInput(e.target.value)}
                          placeholder="Klistra in en bildlänk"
                          aria-label="Bildlänk"
                          className="flex-1 min-w-0 h-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 text-base sm:text-sm text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-400"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addImageUrl();
                            }
                          }}
                        />
                        {imageUrlInput.trim() && (
                          <Button variant="secondary" size="sm" className="h-10" onClick={addImageUrl}>Lägg till</Button>
                        )}
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleFileUpload}
                          accept="image/*, .heic, .HEIC, .heif, .HEIF, .png, .jpg, .jpeg, .webp"
                          multiple
                          className="hidden"
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-10"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadProgress !== null}
                          icon={uploadProgress !== null ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                        >
                          {allMomentImages.length > 0 ? 'Fler' : 'Välj bild'}
                        </Button>
                      </div>
                      {uploadProgress !== null && (
                        <div>
                          <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                            <motion.div className="h-full bg-indigo-600" initial={{ width: 0 }} animate={{ width: `${uploadProgress}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-indigo-600 mt-1 block">Laddar upp {Math.round(uploadProgress)} %</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
                      <span className="w-10 h-10 rounded-xl bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-500 shrink-0">
                        {isYouTube(moment.externalLink) ? <Youtube size={18} /> : <LinkIcon size={18} />}
                      </span>
                      <input
                        type="url"
                        value={moment.externalLink || ''}
                        onChange={(e) => updateMoment(moment.id, { externalLink: e.target.value })}
                        className="flex-1 min-w-0 h-10 bg-transparent border-none p-0 text-base sm:text-sm text-zinc-900 dark:text-white focus:ring-0 placeholder:text-zinc-400"
                        placeholder="Länk till video eller sida (t.ex. YouTube)"
                        aria-label="Länk"
                      />
                      {moment.externalLink && (
                        <IconButton label="Ta bort länk" onClick={() => updateMoment(moment.id, { externalLink: undefined })}>
                          <X size={16} />
                        </IconButton>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            (allMomentImages.length > 0 || moment.externalLink) && (
              <div className="flex flex-wrap gap-2">
                {allMomentImages.map((url, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onViewImage && onViewImage(allMomentImages, idx)}
                    className="relative group w-32 aspect-video bg-zinc-100 dark:bg-zinc-800 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 transition-all active:scale-95 cursor-pointer"
                    aria-label={`Visa bild ${idx + 1}`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all">
                      <Maximize2 size={22} className="text-white opacity-0 group-hover:opacity-100 transition-all" />
                    </span>
                  </button>
                ))}
                {moment.externalLink && (
                  <a
                    href={moment.externalLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[44px] inline-flex items-center gap-2.5 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors text-sm font-semibold"
                  >
                    {isYouTube(moment.externalLink) ? <Youtube size={18} className="text-red-600" /> : <LinkIcon size={18} />}
                    {isYouTube(moment.externalLink) ? 'Visa video' : 'Öppna länk'}
                    <ExternalLink size={14} className="opacity-60" />
                  </a>
                )}
              </div>
            )
          )}

          {/* Åtgärder */}
          {isPlan ? (
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <div className="inline-flex items-center gap-0.5">
                <label className="relative">
                  <span className="sr-only">Tävlingsmoment</span>
                  <select
                    value={moment.exerciseId || ''}
                    onChange={(e) => updateMoment(moment.id, { exerciseId: e.target.value || undefined })}
                    className="appearance-none h-10 max-w-[180px] truncate bg-zinc-100 dark:bg-zinc-800 border-none rounded-xl pl-3 pr-8 text-sm font-semibold text-zinc-700 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    <option value="">Ingen tävling</option>
                    {exercises.map(ex => (
                      <option key={ex.id} value={ex.id}>{ex.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400" />
                </label>
                {moment.exerciseId && onEditExercise && (
                  <IconButton label="Redigera tävlingen" onClick={() => onEditExercise(moment.exerciseId!)}>
                    <Edit2 size={16} />
                  </IconButton>
                )}
                {moment.exerciseId && onDeleteExercise && (
                  <IconButton
                    label="Radera tävlingen"
                    className="hover:text-red-600"
                    onClick={() => setConfirmDeleteExercise({
                      exerciseId: moment.exerciseId!,
                      momentId: moment.id,
                      name: exercises.find(ex => ex.id === moment.exerciseId)?.name || 'Tävlingsmoment'
                    })}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                )}
              </div>

              {onCreateExercise && !moment.exerciseId && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-10"
                  icon={<Trophy size={15} />}
                  onClick={() => {
                    const dateObj = new Date(sessionDate);
                    const dateStr = `${dateObj.getDate()}/${dateObj.getMonth() + 1} -${dateObj.getFullYear().toString().slice(-2)}`;
                    const baseName = (moment.name && moment.name.trim()) || sessionTitle || 'Nytt tävlingsmoment';
                    onCreateExercise(`${baseName} - ${dateStr}`, moment.id);
                  }}
                >
                  Ny tävling
                </Button>
              )}

              <Button
                variant="secondary"
                size="sm"
                className="h-10"
                icon={<Layout size={15} />}
                onClick={() => onOpenTacticalBoard && onOpenTacticalBoard(moment)}
              >
                Taktiktavla{boardCount > 0 ? ` (${boardCount})` : ''}
              </Button>

              {onSaveToBank && (
                !isSavedInBank ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-10"
                    icon={<Library size={15} />}
                    onClick={() => {
                      const newBankId = onSaveToBank(moment);
                      if (newBankId && typeof newBankId === 'string') {
                        updateMoment(moment.id, { bankExerciseId: newBankId });
                      }
                    }}
                  >
                    Spara i banken
                  </Button>
                ) : hasModifications && onUpdateBankExercise ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-10"
                      icon={<Upload size={15} />}
                      title="Uppdatera övningen i övningsbanken med ändringarna i det här passet"
                      onClick={() => {
                        if (!bankExercise) return;
                        if (!moment.bankExerciseId) updateMoment(moment.id, { bankExerciseId: bankExercise.id });
                        const momentImages = allMomentImages;
                        onUpdateBankExercise(bankExercise.id, {
                          name: moment.name,
                          duration: moment.duration || 15,
                          description: moment.description,
                          externalLink: moment.externalLink,
                          imageUrl: momentImages[0] || undefined,
                          imageUrls: momentImages.length > 0 ? momentImages : undefined,
                          tacticalBoards: moment.tacticalBoards,
                        });
                        setJustUpdatedBank(true);
                        setTimeout(() => setJustUpdatedBank(false), 2000);
                      }}
                    >
                      {justUpdatedBank ? 'Banken uppdaterad' : 'Uppdatera banken'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-10"
                      icon={<Download size={15} />}
                      title="Hämta den sparade versionen från övningsbanken och skriv över ändringarna i passet"
                      onClick={() => {
                        if (!bankExercise) return;
                        const bankImages = getExerciseImages(bankExercise);
                        updateMoment(moment.id, {
                          name: bankExercise.name || '',
                          duration: bankExercise.duration || 15,
                          description: bankExercise.description || '',
                          externalLink: bankExercise.externalLink || '',
                          imageUrl: bankImages[0] || undefined,
                          imageUrls: bankImages.length > 0 ? bankImages : undefined,
                          bankExerciseId: bankExercise.id,
                          tacticalBoards: bankExercise.tacticalBoards ? JSON.parse(JSON.stringify(bankExercise.tacticalBoards)) : undefined,
                        });
                        setJustFetchedBank(true);
                        setTimeout(() => setJustFetchedBank(false), 2000);
                      }}
                    >
                      {justFetchedBank ? 'Hämtat' : 'Hämta från banken'}
                    </Button>
                  </>
                ) : (
                  <Badge tone="success" icon={<Check size={12} strokeWidth={3} />} className="h-10 px-3">
                    {justUpdatedBank ? 'Banken uppdaterad' : justFetchedBank ? 'Hämtat' : 'Sparad i banken'}
                  </Badge>
                )
              )}

              <div className="ml-auto flex items-center">
                {onAddAfter && (
                  <IconButton label="Lägg till moment efter det här" onClick={onAddAfter}>
                    <PlusCircle size={18} />
                  </IconButton>
                )}
                <IconButton
                  label="Ta bort momentet"
                  className="hover:text-red-600"
                  onClick={() => setConfirmDeleteMoment({ id: moment.id, name: moment.name || 'Namnlöst moment' })}
                >
                  <Trash2 size={18} />
                </IconButton>
              </div>
            </div>
          ) : (
            (isCoachOrAdmin || boardCount > 0) && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {isCoachOrAdmin && moment.exerciseId && onSelectExercise && (
                  <Button size="sm" className="h-10" icon={<Play size={14} fill="currentColor" />} onClick={() => onSelectExercise(moment.exerciseId!)}>
                    Starta tävling
                  </Button>
                )}
                {onOpenTacticalBoard && (isCoachOrAdmin || boardCount > 0) && (
                  <Button variant="secondary" size="sm" className="h-10" icon={<Layout size={15} />} onClick={() => onOpenTacticalBoard(moment)}>
                    Taktiktavla{boardCount > 0 ? ` (${boardCount})` : ''}
                  </Button>
                )}
                {isCoachOrAdmin && moment.exerciseId && onShowTeams && (
                  <IconButton label="Visa lagen" onClick={() => onShowTeams(moment.exerciseId!)}>
                    <Users size={18} />
                  </IconButton>
                )}
                {isCoachOrAdmin && moment.exerciseId && onEditExercise && (
                  <IconButton label="Redigera tävlingen" onClick={() => onEditExercise(moment.exerciseId!)}>
                    <Edit2 size={18} />
                  </IconButton>
                )}
              </div>
            )
          )}
        </Card>
      </div>
    </Reorder.Item>
  );
}

const dateInputValue = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fieldClass =
  'w-full h-11 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3.5 text-base text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-zinc-400';
const fieldLabel = 'block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5';

type EditorTab = 'plan' | 'live' | 'rsvp';

export default function SessionEditor({
  session,
  exercises,
  squad = [],
  onUpdate,
  onClose,
  onCreateExercise,
  onSelectExercise,
  onEditExercise,
  onDeleteExercise,
  onMovePlayer,
  onCopyTeams,
  initialMode = 'plan',
  onModeChange,
  initialTab = 'schema',
  adminUrl,
  allSessions,
  onUpdateSession,
  exerciseBank = [],
  exerciseBankCategories = [],
  onSaveToBank,
  onUpdateBankExercise,
  onOpenLineup,
  user,
  userRoles,
  userProfile,
  isRootAdmin
}: SessionEditorProps) {
  const isCoachOrAdmin = useMemo(() => {
    if (!user) return true; // Offline or fallback mode
    return !!isRootAdmin || userRoles?.includes('admin') || userRoles?.includes('coach') || userRoles?.includes('root_admin') || false;
  }, [user, userRoles, isRootAdmin]);

  // Spelare landar på kallelsen; tränare där de valde.
  const startTab = isCoachOrAdmin ? initialTab : 'rsvp';

  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showVisibilityInfoModal, setShowVisibilityInfoModal] = useState(false);
  const [showCompletionInfoModal, setShowCompletionInfoModal] = useState(false);
  const [selectedExerciseForTeams, setSelectedExerciseForTeams] = useState<string | null>(null);
  const [exerciseToDelete, setExerciseToDelete] = useState<{ exerciseId: string, momentId: string, name: string } | null>(null);
  const [momentToDelete, setMomentToDelete] = useState<{ id: string, name: string } | null>(null);
  const [viewingImageInfo, setViewingImageInfo] = useState<{ urls: string[], index: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'schema' | 'attendance' | 'rsvp'>(startTab);
  const [tacticalBoardMoment, setTacticalBoardMoment] = useState<SessionMoment | null>(null);
  const mode = initialMode;
  const setMode = onModeChange || (() => {});

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setActiveTab(startTab);
  }, [startTab, session.id]);

  // Use a ref for the session to avoid stale closures in event handlers
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const isMatch = useMemo(() => isMatchSession(session), [session]);
  const contentHidden = !isCoachOrAdmin && !!session.hideContentForPlayers;
  const canEditPlan = isCoachOrAdmin && mode === 'plan';
  // Spelare ser alltid passet i läsläge; tränare planerar eller kör passet.
  const momentMode: 'plan' | 'live' | 'view' = isCoachOrAdmin ? mode : 'view';

  const currentTab: EditorTab = activeTab === 'schema' && !contentHidden ? (isCoachOrAdmin ? mode : 'plan') : 'rsvp';
  const handleTabChange = (t: EditorTab) => {
    if (t === 'rsvp') {
      setActiveTab('attendance');
      return;
    }
    if (isCoachOrAdmin) setMode(t);
    setActiveTab('schema');
  };

  const tabs: { id: EditorTab; label: string; icon?: React.ReactNode; count?: number }[] = isCoachOrAdmin
    ? [
        { id: 'plan', label: 'Planera', icon: <Edit2 size={15} /> },
        { id: 'live', label: 'Träna', icon: <Play size={15} /> },
        { id: 'rsvp', label: 'Närvaro', icon: <UserCheck size={15} />, count: session.attendance?.length || 0 },
      ]
    : [
        { id: 'rsvp', label: 'Kallelse', icon: <Bell size={15} /> },
        ...(contentHidden ? [] : [{ id: 'plan' as EditorTab, label: 'Upplägg', icon: <ListTodo size={15} /> }]),
      ];

  // Notes textarea grows with its content
  useEffect(() => {
    const el = notesTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [session.notes, mode, activeTab]);

  const currentExercise = useMemo(() =>
    exercises.find(e => e.id === selectedExerciseForTeams),
  [exercises, selectedExerciseForTeams]);

  const totalPlannedMinutes = useMemo(() => session.moments.reduce((acc, m) => acc + m.duration, 0), [session.moments]);

  const momentDetails = useMemo(() => {
    let currentMinutes = 0;
    const [startH, startM] = session.startTime.split(':').map(Number);
    const startDate = new Date();
    startDate.setHours(startH || 0, startM || 0, 0, 0);

    return session.moments.map(moment => {
      const momentStart = new Date(startDate.getTime() + currentMinutes * 60000);
      const momentEnd = new Date(momentStart.getTime() + moment.duration * 60000);
      currentMinutes += moment.duration;
      return {
        ...moment,
        startTimeStr: momentStart.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }),
        endTimeStr: momentEnd.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
      };
    });
  }, [session.startTime, session.moments]);

  const calculatedEndTime = useMemo(() => {
    const [startH, startM] = session.startTime.split(':').map(Number);
    const date = new Date();
    date.setHours(startH || 0, startM || 0, 0, 0);
    date.setMinutes(date.getMinutes() + totalPlannedMinutes);
    return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }, [session.startTime, totalPlannedMinutes]);

  const sessionDuration = useMemo(() => {
    if (!session.endTime) return totalPlannedMinutes;
    const [startH, startM] = session.startTime.split(':').map(Number);
    const [endH, endM] = session.endTime.split(':').map(Number);
    let diff = (endH * 60 + endM) - (startH * 60 + startM);
    if (diff < 0) diff += 24 * 60;
    return diff;
  }, [session.startTime, session.endTime, totalPlannedMinutes]);

  const timeStatus = useMemo(() => {
    if (!session.endTime) return { label: 'Sätt en sluttid för att se hur mycket tid som är kvar', color: 'text-zinc-500 dark:text-zinc-400' };
    const diff = sessionDuration - totalPlannedMinutes;
    if (diff === 0) return { label: 'Precis rätt planerat', color: 'text-emerald-600 dark:text-emerald-400' };
    if (diff > 0) return { label: `${diff} min kvar att fylla`, color: 'text-amber-600 dark:text-amber-400' };
    return { label: `${Math.abs(diff)} min för mycket planerat`, color: 'text-red-600 dark:text-red-400' };
  }, [sessionDuration, totalPlannedMinutes, session.endTime]);

  const addMoment = (index?: number) => {
    const newMoment: SessionMoment = {
      id: Math.random().toString(36).substring(7),
      name: '',
      duration: 10,
      description: ''
    };
    const currentSession = sessionRef.current;
    const newMoments = [...currentSession.moments];
    if (typeof index === 'number') newMoments.splice(index + 1, 0, newMoment);
    else newMoments.push(newMoment);

    const updated = { ...currentSession, moments: newMoments, updatedAt: Date.now() };
    sessionRef.current = updated;
    onUpdate(updated);

    if (typeof index !== 'number') {
      setTimeout(() => {
        scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
      }, 100);
    }
  };

  const updateMoment = (id: string, updates: Partial<SessionMoment>) => {
    const currentSession = sessionRef.current;
    const updated = {
      ...currentSession,
      moments: currentSession.moments.map(m => m.id === id ? { ...m, ...updates } : m),
      updatedAt: Date.now()
    };
    sessionRef.current = updated;
    onUpdate(updated);
  };

  const removeMoment = (id: string) => {
    const currentSession = sessionRef.current;
    const updated = { ...currentSession, moments: currentSession.moments.filter(m => m.id !== id), updatedAt: Date.now() };
    sessionRef.current = updated;
    onUpdate(updated);
  };

  const handleQuickAddGuest = (name: string) => {
    const currentSession = sessionRef.current;
    const newGuest: SquadPlayer = {
      id: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      name: name.trim(),
    };
    const updated = {
      ...currentSession,
      guestPlayers: [...(currentSession.guestPlayers || []), newGuest],
      attendance: [...(currentSession.attendance || []), newGuest.id],
      updatedAt: Date.now()
    };
    sessionRef.current = updated;
    onUpdate(updated);
  };

  const handleReorder = (newMoments: SessionMoment[]) => {
    const currentSession = sessionRef.current;
    const updated = { ...currentSession, moments: newMoments, updatedAt: Date.now() };
    sessionRef.current = updated;
    onUpdate(updated);
  };

  const dateLabel = new Date(session.date).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeLabel = `${session.startTime}–${session.endTime || calculatedEndTime}`;

  const metaContent = (
    <>
      <span className="inline-flex items-center gap-1.5">
        {isMatch ? <Trophy size={15} className="text-amber-500" /> : <Dumbbell size={15} className="text-indigo-500" />}
        {isMatch ? 'Match' : 'Träning'}
      </span>
      <span className="text-zinc-300 dark:text-zinc-600">·</span>
      <span className="inline-flex items-center gap-1.5"><Calendar size={15} className="text-zinc-400" />{dateLabel}</span>
      <span className="text-zinc-300 dark:text-zinc-600">·</span>
      <span className="inline-flex items-center gap-1.5 tabular-nums"><Clock size={15} className="text-zinc-400" />{timeLabel}</span>
      {session.gatheringTime && (
        <>
          <span className="text-zinc-300 dark:text-zinc-600">·</span>
          <span className="tabular-nums">Samling {session.gatheringTime}</span>
        </>
      )}
      {session.location && (
        <>
          <span className="text-zinc-300 dark:text-zinc-600">·</span>
          <span className="inline-flex items-center gap-1.5 min-w-0"><MapPin size={15} className="text-zinc-400 shrink-0" /><span className="truncate">{session.location}</span></span>
        </>
      )}
    </>
  );

  const timeUsageCard = canEditPlan ? (
    <Card>
      <SectionHeader
        title="Tid"
        action={
          <span className={`text-sm font-bold tabular-nums ${session.endTime && totalPlannedMinutes > sessionDuration ? 'text-red-600' : 'text-zinc-900 dark:text-white'}`}>
            {totalPlannedMinutes}{session.endTime ? ` av ${sessionDuration}` : ''} min
          </span>
        }
      />
      {session.endTime && (
        <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${totalPlannedMinutes > sessionDuration ? 'bg-red-500' : 'bg-indigo-500'}`}
            style={{ width: `${Math.min(100, sessionDuration ? (totalPlannedMinutes / sessionDuration) * 100 : 0)}%` }}
          />
        </div>
      )}
      <p className={`text-sm font-medium mt-2 ${timeStatus.color}`}>{timeStatus.label}</p>
    </Card>
  ) : null;

  const liveCard = isCoachOrAdmin && mode === 'live' ? (
    <Card>
      {session.isStarted ? (
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
            Passet är igång
          </span>
          <Button variant="secondary" size="sm" className="h-10" onClick={() => onUpdate({ ...session, isStarted: false, updatedAt: Date.now() })}>
            Avsluta
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Starta passet så får du en notis när det är dags att byta moment.</p>
          <Button
            block
            icon={<Play size={16} fill="currentColor" />}
            onClick={() => {
              if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
              }
              onUpdate({ ...session, isStarted: true, actualStartTime: Date.now(), updatedAt: Date.now() });
            }}
          >
            Starta passet
          </Button>
        </div>
      )}
    </Card>
  ) : null;

  const notesCard = canEditPlan || session.notes ? (
    <Card>
      <SectionHeader title="Syfte och anteckningar" icon={<FileText size={16} />} />
      {canEditPlan ? (
        <TextArea
          ref={notesTextareaRef}
          value={session.notes || ''}
          onChange={(e) => {
            const updated = { ...sessionRef.current, notes: e.target.value, updatedAt: Date.now() };
            sessionRef.current = updated;
            onUpdate(updated);
          }}
          placeholder="Mål och syfte med passet"
          aria-label="Syfte och anteckningar"
          className="w-full bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-base sm:text-sm text-zinc-700 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-none min-h-[88px] overflow-hidden"
          rows={2}
        />
      ) : (
        <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">{session.notes}</p>
      )}
    </Card>
  ) : null;

  const completeButton = isCoachOrAdmin ? (
    session.isCompleted ? (
      <Button variant="secondary" block icon={<Check size={16} strokeWidth={3} className="text-emerald-600" />} onClick={() => setShowCompletionInfoModal(true)}>
        Passet är genomfört
      </Button>
    ) : (
      <Button variant="success" block icon={<Check size={16} strokeWidth={3} />} onClick={() => onUpdate({ ...session, isCompleted: true, updatedAt: Date.now() })}>
        Klarmarkera passet
      </Button>
    )
  ) : null;

  return (
    <div ref={scrollContainerRef} className="fixed inset-0 bg-zinc-50 dark:bg-zinc-950 z-[60] flex flex-col overflow-y-auto overflow-x-hidden">
      {/* Team Overview Modal */}
      <AnimatePresence>
        {selectedExerciseForTeams && currentExercise && (
          <TeamOverviewModal
            exercise={currentExercise}
            squad={[...(squad || []), ...(session.guestPlayers || [])]}
            attendingIds={session.attendance}
            onMovePlayer={onMovePlayer || (() => {})}
            onClose={() => setSelectedExerciseForTeams(null)}
            exercises={exercises}
            onCopyTeams={(sourceId) => onCopyTeams && onCopyTeams(sourceId, selectedExerciseForTeams)}
            onAddGuest={handleQuickAddGuest}
            onAddSquadPlayerToAttendance={(playerId) => {
              const currentSession = sessionRef.current;
              const currentAttendance = currentSession.attendance || [];
              if (!currentAttendance.includes(playerId)) {
                onUpdate({ ...currentSession, attendance: [...currentAttendance, playerId], updatedAt: Date.now() });
              }
            }}
            onRemovePlayerFromAttendance={(playerId) => {
              const currentSession = sessionRef.current;
              const currentAttendance = currentSession.attendance || [];
              const isGuest = playerId.startsWith('guest_');
              onUpdate({
                ...currentSession,
                attendance: currentAttendance.filter(id => id !== playerId),
                guestPlayers: isGuest ? (currentSession.guestPlayers || []).filter(p => p.id !== playerId) : currentSession.guestPlayers,
                updatedAt: Date.now()
              });
            }}
            onStart={() => {
              const id = selectedExerciseForTeams;
              setSelectedExerciseForTeams(null);
              onSelectExercise && onSelectExercise(id!);
            }}
          />
        )}
      </AnimatePresence>

      {/* Bildvisning */}
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
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative max-w-5xl w-full max-h-full flex flex-col items-center gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative w-full h-[65vh] sm:h-[72vh] rounded-2xl overflow-hidden bg-zinc-900 flex items-center justify-center">
                <img
                  src={viewingImageInfo.urls[viewingImageInfo.index]}
                  alt=""
                  className="max-w-full max-h-full object-contain"
                  referrerPolicy="no-referrer"
                />
                {viewingImageInfo.urls.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="Föregående bild"
                      onClick={() => setViewingImageInfo(prev => prev ? ({ ...prev, index: (prev.index - 1 + prev.urls.length) % prev.urls.length }) : null)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full"
                    >
                      <ChevronLeft size={24} />
                    </button>
                    <button
                      type="button"
                      aria-label="Nästa bild"
                      onClick={() => setViewingImageInfo(prev => prev ? ({ ...prev, index: (prev.index + 1) % prev.urls.length }) : null)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full"
                    >
                      <ChevronRight size={24} />
                    </button>
                    <span className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/50 text-white text-xs font-semibold rounded-full tabular-nums">
                      {viewingImageInfo.index + 1} av {viewingImageInfo.urls.length}
                    </span>
                  </>
                )}
              </div>
              <Button variant="secondary" onClick={() => setViewingImageInfo(null)}>Stäng</Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidhuvud */}
      <header className="sticky top-0 z-50 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-b border-zinc-200 dark:border-zinc-800 pt-safe shrink-0">
        <div className="max-w-6xl mx-auto px-3 sm:px-6">
          <div className="flex items-center gap-2 h-14">
            <IconButton label="Tillbaka" onClick={onClose} className="-ml-1">
              <ArrowLeft size={22} />
            </IconButton>
            <div className="flex-1 min-w-0">
              {canEditPlan ? (
                <TextInput
                  type="text"
                  value={session.title}
                  onChange={(e) => onUpdate({ ...session, title: e.target.value })}
                  placeholder="Passets namn"
                  aria-label="Passets namn"
                  className="w-full h-10 bg-transparent border-none px-0 text-lg font-bold text-zinc-900 dark:text-white focus:ring-0 placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
                />
              ) : (
                <h1 className="text-lg font-bold text-zinc-900 dark:text-white truncate">{session.title || (isMatch ? 'Match' : 'Träning')}</h1>
              )}
            </div>
            {isCoachOrAdmin && (
              <>
                <IconButton
                  label={session.hideContentForPlayers ? 'Upplägget är dolt för spelare' : 'Upplägget syns för spelare'}
                  onClick={() => setShowVisibilityInfoModal(true)}
                  className={session.hideContentForPlayers ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/60 dark:text-amber-300' : ''}
                >
                  {session.hideContentForPlayers ? <EyeOff size={20} /> : <Eye size={20} />}
                </IconButton>
                <IconButton
                  label={session.isCompleted ? 'Passet är genomfört' : 'Klarmarkera passet'}
                  onClick={() => setShowCompletionInfoModal(true)}
                  className={session.isCompleted ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300' : ''}
                >
                  <CheckCircle2 size={20} />
                </IconButton>
                <span className="hidden sm:block"><Button size="sm" className="h-10" icon={<Save size={16} />} onClick={onClose}>Spara</Button></span>
              </>
            )}
          </div>

          <div className="pb-3">
            <div className="flex items-center gap-2">
              {tabs.length > 1 && (
                <SegmentedTabs size="lg" tabs={tabs} value={currentTab} onChange={handleTabChange} className="flex-1 sm:flex-none" />
              )}
              {isMatch && onOpenLineup && (
                <Button variant="secondary" size="sm" className="h-11 shrink-0" icon={<Users size={16} />} onClick={() => onOpenLineup(session)}>
                  <span className="hidden sm:inline">Laguppställning</span>
                  <span className="sm:hidden">Uppställning</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Innehåll */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {isCoachOrAdmin && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowTimePicker(true)}
              className="max-w-full min-h-[40px] inline-flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-750 text-sm font-semibold text-zinc-700 dark:text-zinc-200 text-left transition-colors cursor-pointer"
              aria-label="Ändra typ, datum, tid och plats"
            >
              {metaContent}
              <Edit2 size={13} className="text-zinc-400 ml-0.5" />
            </button>
          </div>
        )}

        {activeTab === 'schema' && !contentHidden && (
          <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-[auto_1fr] md:gap-x-6 md:gap-y-4 md:items-start">
            {(liveCard || notesCard) && (
              <div className="md:col-start-2 md:row-start-1 space-y-4">
                {liveCard}
                {notesCard}
              </div>
            )}
            <div className="md:col-start-2 md:row-start-2 space-y-4 md:order-none order-last">
              {timeUsageCard}
              {isCoachOrAdmin && session.hideContentForPlayers && (
                <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60">
                  <p className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
                    <EyeOff size={16} /> Upplägget är dolt för spelarna
                  </p>
                  <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">De ser bara tid, plats och kallelse.</p>
                </Card>
              )}
              {completeButton}
            </div>

            <section className="md:col-start-1 md:row-start-1 md:row-span-2 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-bold text-zinc-500 dark:text-zinc-400">
                  Upplägg · {session.moments.length} moment ·{' '}
                  <span className={canEditPlan && session.endTime && totalPlannedMinutes !== sessionDuration ? timeStatus.color : ''}>
                    {totalPlannedMinutes}{canEditPlan && session.endTime ? ` av ${sessionDuration}` : ''} min
                  </span>
                </h2>
                {canEditPlan && session.moments.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {allSessions && onUpdateSession && (
                      <Button variant="secondary" size="sm" className="h-10" icon={<Copy size={15} />} onClick={() => setShowCopyModal(true)}>
                        Hämta övningar
                      </Button>
                    )}
                    <Button size="sm" className="h-10" icon={<PlusCircle size={16} />} onClick={() => addMoment()}>
                      Nytt moment
                    </Button>
                  </div>
                )}
              </div>

              {session.moments.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<ListTodo size={24} />}
                    title="Inga moment än"
                    text={isCoachOrAdmin ? 'Bygg passet moment för moment, eller hämta övningar från ett annat pass eller övningsbanken.' : 'Tränaren har inte lagt in något upplägg för passet.'}
                    action={canEditPlan ? (
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <Button icon={<PlusCircle size={16} />} onClick={() => addMoment()}>Lägg till första momentet</Button>
                        {allSessions && onUpdateSession && (
                          <Button variant="secondary" icon={<Copy size={15} />} onClick={() => setShowCopyModal(true)}>Hämta övningar</Button>
                        )}
                      </div>
                    ) : isCoachOrAdmin ? (
                      <Button variant="secondary" icon={<Edit2 size={15} />} onClick={() => handleTabChange('plan')}>Gå till Planera</Button>
                    ) : undefined}
                  />
                </Card>
              ) : (
                <Reorder.Group axis="y" values={session.moments} onReorder={handleReorder}>
                  {session.moments.map((moment, index) => (
                    <MomentItem
                      key={moment.id}
                      moment={moment}
                      details={momentDetails[index]}
                      mode={momentMode}
                      exercises={exercises}
                      sessionDate={session.date}
                      sessionTitle={session.title}
                      updateMoment={updateMoment}
                      removeMoment={removeMoment}
                      onCreateExercise={onCreateExercise}
                      onSelectExercise={onSelectExercise}
                      onEditExercise={onEditExercise}
                      onDeleteExercise={onDeleteExercise}
                      setConfirmDeleteExercise={setExerciseToDelete}
                      setConfirmDeleteMoment={setMomentToDelete}
                      onShowTeams={(id) => setSelectedExerciseForTeams(id)}
                      onViewImage={(urls, idx) => setViewingImageInfo({ urls, index: idx })}
                      onAddAfter={() => addMoment(index)}
                      exerciseBank={exerciseBank}
                      onSaveToBank={onSaveToBank}
                      onUpdateBankExercise={onUpdateBankExercise}
                      onOpenTacticalBoard={(m) => setTacticalBoardMoment(m)}
                      isCoachOrAdmin={isCoachOrAdmin}
                    />
                  ))}
                </Reorder.Group>
              )}

              {canEditPlan && session.moments.length > 0 && (
                <div className="flex gap-3 sm:gap-4">
                  <div className="w-12 sm:w-14 shrink-0 text-center text-sm font-bold tabular-nums text-zinc-400 pt-3">{calculatedEndTime}</div>
                  <Button variant="secondary" className="flex-1 border-dashed" icon={<PlusCircle size={18} />} onClick={() => addMoment()}>
                    Lägg till moment
                  </Button>
                </div>
              )}

            </section>
          </div>
        )}

        {activeTab !== 'schema' || contentHidden ? (
          <>
            {contentHidden && (
              <Card className="mb-4 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
                  <EyeOff size={16} /> Tränaren har inte visat upplägget än
                </p>
              </Card>
            )}
            <SessionRsvpView
              session={session}
              squad={squad}
              onUpdateSession={onUpdate}
              user={user}
              userRoles={userRoles}
              userProfile={userProfile}
              adminUrl={adminUrl}
              onOpenLineup={isMatch && onOpenLineup ? () => onOpenLineup(session) : undefined}
            />
          </>
        ) : null}

        <div className="pb-24" />
      </main>

      {/* Typ, datum, tid och plats */}
      <Sheet
        open={showTimePicker && isCoachOrAdmin}
        onClose={() => setShowTimePicker(false)}
        title="Tid och plats"
        footer={<Button block onClick={() => setShowTimePicker(false)}>Klar</Button>}
      >
        <div className="px-2 pb-2 space-y-4">
          <div>
            <p className={fieldLabel}>Typ</p>
            <SegmentedTabs
              size="lg"
              tabs={[
                { id: 'training', label: 'Träning', icon: <Dumbbell size={15} /> },
                { id: 'match', label: 'Match', icon: <Trophy size={15} /> },
                { id: 'other', label: 'Övrigt', icon: <Shapes size={15} /> },
              ]}
              value={categorizeSession(session)}
              onChange={(t) => onUpdate({ ...session, type: t, category: t, updatedAt: Date.now() })}
            />
          </div>
          <div>
            <label htmlFor="session-date" className={fieldLabel}>Datum</label>
            <input
              id="session-date"
              type="date"
              value={dateInputValue(session.date)}
              onChange={(e) => {
                if (!e.target.value) return;
                const [y, m, d] = e.target.value.split('-').map(Number);
                onUpdate({ ...session, date: new Date(y, m - 1, d, 12, 0, 0).getTime(), updatedAt: Date.now() });
              }}
              className={fieldClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="session-start" className={fieldLabel}>Start</label>
              <input id="session-start" type="time" value={session.startTime} onChange={(e) => onUpdate({ ...session, startTime: e.target.value, updatedAt: Date.now() })} className={fieldClass} />
            </div>
            <div>
              <label htmlFor="session-end" className={fieldLabel}>Slut</label>
              <input id="session-end" type="time" value={session.endTime || calculatedEndTime} onChange={(e) => onUpdate({ ...session, endTime: e.target.value, updatedAt: Date.now() })} className={fieldClass} />
            </div>
          </div>
          <div>
            <label htmlFor="session-gathering" className={fieldLabel}>Samling (valfri)</label>
            <input id="session-gathering" type="time" value={session.gatheringTime || ''} onChange={(e) => onUpdate({ ...session, gatheringTime: e.target.value || undefined, updatedAt: Date.now() })} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="session-location" className={fieldLabel}>Plats</label>
            <TextInput
              id="session-location"
              type="text"
              value={session.location || ''}
              onChange={(e) => onUpdate({ ...session, location: e.target.value || undefined, updatedAt: Date.now() })}
              placeholder="T.ex. Sportvallen, plan 2"
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="session-description" className={fieldLabel}>Information / beskrivning</label>
            <TextArea
              id="session-description"
              value={session.description || ''}
              onChange={(e) => onUpdate({ ...session, description: e.target.value || undefined, updatedAt: Date.now() })}
              placeholder="T.ex. samlingstid, vad man ska ta med"
              rows={3}
              className={`${fieldClass} resize-none min-h-[80px]`}
            />
          </div>
          <p className={`text-sm font-medium ${timeStatus.color}`}>
            Planerat {totalPlannedMinutes}{session.endTime ? ` av ${sessionDuration}` : ''} min. {timeStatus.label}.
          </p>
        </div>
      </Sheet>

      {/* Radera tävling */}
      <Sheet
        open={!!exerciseToDelete}
        onClose={() => setExerciseToDelete(null)}
        title="Radera tävlingen?"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExerciseToDelete(null)}>Avbryt</Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => {
                if (exerciseToDelete && onDeleteExercise) {
                  updateMoment(exerciseToDelete.momentId, { exerciseId: undefined });
                  onDeleteExercise(exerciseToDelete.exerciseId);
                }
                setExerciseToDelete(null);
              }}
            >
              Radera
            </Button>
          </div>
        }
      >
        <p className="px-2 pb-2 text-sm text-zinc-600 dark:text-zinc-300">
          ”{exerciseToDelete?.name}” raderas tillsammans med alla lag och resultat. Det går inte att ångra.
        </p>
      </Sheet>

      {/* Radera moment */}
      <Sheet
        open={!!momentToDelete}
        onClose={() => setMomentToDelete(null)}
        title="Ta bort momentet?"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setMomentToDelete(null)}>Avbryt</Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => {
                if (momentToDelete) removeMoment(momentToDelete.id);
                setMomentToDelete(null);
              }}
            >
              Ta bort
            </Button>
          </div>
        }
      >
        <p className="px-2 pb-2 text-sm text-zinc-600 dark:text-zinc-300">
          ”{momentToDelete?.name}” tas bort från passets upplägg.
        </p>
      </Sheet>

      {/* Moment Copy Modal */}
      {allSessions && onUpdateSession && (
        <MomentCopyModal
          isOpen={showCopyModal}
          onClose={() => setShowCopyModal(false)}
          currentSession={session}
          allSessions={allSessions}
          onUpdateSession={onUpdateSession}
          exerciseBank={exerciseBank}
          exerciseBankCategories={exerciseBankCategories}
        />
      )}

      {/* Taktiktavla för ett moment (spelare kan titta men inte spara) */}
      {tacticalBoardMoment && (
        <TacticalBoardModal
          boards={tacticalBoardMoment.tacticalBoards || []}
          onSave={(updatedBoards) => {
            if (isCoachOrAdmin) updateMoment(tacticalBoardMoment.id, { tacticalBoards: updatedBoards });
            setTacticalBoardMoment(null);
          }}
          onClose={() => setTacticalBoardMoment(null)}
          squad={squad}
          title={`Taktiktavla – ${tacticalBoardMoment.name || 'Moment'}`}
        />
      )}

      {/* Synlighet för spelare */}
      <Sheet
        open={showVisibilityInfoModal && isCoachOrAdmin}
        onClose={() => setShowVisibilityInfoModal(false)}
        title="Synlighet för spelare"
        footer={
          <Button
            block
            variant={session.hideContentForPlayers ? 'primary' : 'secondary'}
            icon={session.hideContentForPlayers ? <Eye size={16} /> : <EyeOff size={16} />}
            onClick={() => {
              onUpdate({ ...session, hideContentForPlayers: !session.hideContentForPlayers, updatedAt: Date.now() });
              setShowVisibilityInfoModal(false);
            }}
          >
            {session.hideContentForPlayers ? 'Visa upplägget för spelarna' : 'Dölj upplägget för spelarna'}
          </Button>
        }
      >
        <div className="px-2 pb-2 space-y-3">
          <Badge tone={session.hideContentForPlayers ? 'warning' : 'success'} icon={session.hideContentForPlayers ? <EyeOff size={12} /> : <Eye size={12} />}>
            {session.hideContentForPlayers ? 'Dolt för spelare' : 'Synligt för spelare'}
          </Badge>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {session.hideContentForPlayers
              ? 'Spelarna ser bara tid, plats och kallelse – inte moment, övningar eller anteckningar.'
              : 'Spelarna kan se passets upplägg, övningar och anteckningar.'}
          </p>
        </div>
      </Sheet>

      {/* Klarmarkering */}
      <Sheet
        open={showCompletionInfoModal && isCoachOrAdmin}
        onClose={() => setShowCompletionInfoModal(false)}
        title={session.isCompleted ? 'Passet är genomfört' : 'Klarmarkera passet'}
        footer={
          <Button
            block
            variant={session.isCompleted ? 'secondary' : 'success'}
            icon={session.isCompleted ? <RotateCcw size={16} /> : <Check size={16} strokeWidth={3} />}
            onClick={() => {
              onUpdate({ ...session, isCompleted: !session.isCompleted, updatedAt: Date.now() });
              setShowCompletionInfoModal(false);
            }}
          >
            {session.isCompleted ? 'Markera som ej genomfört' : 'Klarmarkera passet'}
          </Button>
        }
      >
        <p className="px-2 pb-2 text-sm text-zinc-600 dark:text-zinc-300">
          {session.isCompleted
            ? 'Passet räknas som genomfört i kalendern och statistiken.'
            : 'Klarmarkera passet när det är genomfört, så räknas det med i lagets statistik.'}
        </p>
      </Sheet>
    </div>
  );
}
