import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ArrowLeft, Trash2, GripVertical, Clock, Calendar, Check, ListTodo, Save, ChevronDown, ChevronUp, Play, PlusCircle, Users, UserPlus, X, ClipboardList, Edit2, Image as ImageIcon, Link as LinkIcon, Youtube, ExternalLink, Maximize2, Upload, Loader2, FileText, Copy, Library, Download, ChevronRight, ShieldCheck, Layout } from 'lucide-react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'motion/react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';
import { TrainingSession, SessionMoment, Exercise, SquadPlayer } from '../types';
import TeamOverviewModal from './TeamOverviewModal';
import { sortLeadersByPosition } from '../lib/teamUtils';
import MomentCopyModal from './MomentCopyModal';
import TacticalBoardModal from './TacticalBoardModal';

interface SessionEditorProps {
  session: TrainingSession;
  exercises: Exercise[];
  squad?: SquadPlayer[];
  onUpdate: (updated: TrainingSession) => void;
  onClose: () => void;
  onCreateExercise?: (name: string, momentId: string) => string;
  onSelectExercise?: (id: string) => void;
  onEditExercise?: (id: string) => void;
  onDeleteExercise?: (id: string) => void;
  onMovePlayer?: (exerciseId: string, playerId: string, targetTeamId: string) => void;
  onCopyTeams?: (sourceId: string, targetId: string) => void;
  initialMode?: 'plan' | 'live';
  onModeChange?: (mode: 'plan' | 'live') => void;
  initialTab?: 'schema' | 'attendance';
  adminUrl?: string;
  allSessions?: TrainingSession[];
  onUpdateSession?: (updated: TrainingSession) => void;
  exerciseBank?: any[];
  exerciseBankCategories?: string[];
  onSaveToBank?: (moment: SessionMoment) => any;
  onUpdateBankExercise?: (id: string, updates: Partial<any>) => void;
}

interface MomentItemProps {
  moment: SessionMoment;
  details: any;
  mode: 'plan' | 'live';
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
  onOpenTacticalBoard
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

  const isSavedInBank = useMemo(() => {
    return !!bankExercise;
  }, [bankExercise]);

  const hasModifications = useMemo(() => {
    if (!bankExercise) return false;
    
    const bankUrls = bankExercise.imageUrls || (bankExercise.imageUrl ? [bankExercise.imageUrl] : []);
    const momentUrls = moment.imageUrls || (moment.imageUrl ? [moment.imageUrl] : []);
    const urlsDiffer = JSON.stringify([...bankUrls].sort()) !== JSON.stringify([...momentUrls].sort());

    return (
      (moment.name || '').trim() !== (bankExercise.name || '').trim() ||
      (moment.duration || 15) !== (bankExercise.duration || 15) ||
      (moment.description || '').trim() !== (bankExercise.description || '').trim() ||
      (moment.externalLink || '').trim() !== (bankExercise.externalLink || '').trim() ||
      (moment.imageUrl || '').trim() !== (bankExercise.imageUrl || '').trim() ||
      urlsDiffer
    );
  }, [moment, bankExercise]);

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
    setUploadProgress(10);
    
    try {
      // Process uploads in parallel for better performance and to reduce stale state window
      const uploadPromises = filesArray.map(async (file) => {
        // Check size (limit to 5MB for safety)
        if (file.size > 5 * 1024 * 1024) {
          console.warn(`Filen ${file.name} är för stor (max 5MB)`);
          return null;
        }

        const fileName = `${Date.now()}_${file.name}`;
        const storageRef = ref(storage, `moments/${momentRef.current.id}/${fileName}`);
        const uploadTask = uploadBytesResumable(storageRef, file);

        return new Promise<string | null>((resolve, reject) => {
          uploadTask.on('state_changed', 
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              // Simple progress calculation (we'll just show the last one's progress or average)
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
        // Use the ref to get the absolute latest state of the moment before updating
        const latestMoment = momentRef.current;
        const currentUrls = latestMoment.imageUrls || (latestMoment.imageUrl ? [latestMoment.imageUrl] : []);
        
        updateMoment(latestMoment.id, { 
          imageUrls: [...currentUrls, ...filteredResults],
          imageUrl: undefined // Always migrate to the array version
        });
      }
      
      setUploadProgress(null);
    } catch (error: any) {
      console.error("Setup error", error);
      setUploadProgress(null);
      if (error?.code === 'storage/unauthorized') {
        alert("Behörighet saknas i Firebase Storage. Se instruktioner i chatten för att fixa detta!");
      } else {
        alert("Kunde inte ladda upp en eller flera bilder.");
      }
    }

    // Reset input
    if (e.target) e.target.value = '';
  };

  return (
    <Reorder.Item
      key={moment.id}
      value={moment}
      dragListener={false}
      dragControls={dragControls}
      className="group relative bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-sm border border-zinc-100 dark:border-zinc-800"
    >
      <div className="flex gap-4">
        {/* Time/Reorder indicator */}
        <div className="flex flex-col items-center gap-2 pt-1 select-none">
          {/* Enhanced Drag Handle for better touch response */}
          <div 
            onPointerDown={(e) => dragControls.start(e)}
            className="p-3 -m-3 cursor-grab active:cursor-grabbing touch-none text-zinc-300 dark:text-zinc-700 hover:text-indigo-500 transition-colors"
          >
            <GripVertical size={24} />
          </div>
          
          <div className={`font-black flex flex-col items-center pointer-events-none ${mode === 'live' ? 'mt-1 gap-1' : 'mt-2 text-[10px]'}`}>
            <span className={`${mode === 'live' ? 'bg-indigo-600 text-white px-2.5 py-1 text-sm sm:text-base rounded-xl font-black shadow-md' : 'bg-indigo-600 text-white px-1.5 py-0.5 rounded-md mb-0.5'} whitespace-nowrap shadow-sm`}>{details.startTimeStr}</span>
            <div className={`w-px bg-zinc-200 dark:bg-zinc-700 ${mode === 'live' ? 'h-3 my-0.5' : 'h-4 my-0.5'}`} />
            <span className={`${mode === 'live' ? 'bg-zinc-800 dark:bg-zinc-700 text-white px-2.5 py-1 text-sm sm:text-base rounded-xl font-black shadow-md' : 'bg-zinc-800 dark:bg-zinc-700 text-white px-1.5 py-0.5 rounded-md'} whitespace-nowrap shadow-sm`}>{details.endTimeStr}</span>
          </div>
        </div>
        {/* Main moment info */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
            <div className="flex-1 min-w-0">
              {mode === 'plan' ? (
                <input
                  type="text"
                  value={moment.name || ''}
                  onChange={(e) => updateMoment(moment.id, { name: e.target.value })}
                  className="w-full bg-transparent border-none p-0 text-lg font-black text-zinc-900 dark:text-white focus:ring-0"
                  placeholder="Namn på moment..."
                />
              ) : (
                <h4 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight break-words [overflow-wrap:anywhere]">
                  {moment.name || sessionTitle || 'Namnlöst moment'}
                </h4>
              )}
            </div>
            <div className={`flex items-center gap-1 font-black shrink-0 w-fit ${
              mode === 'live'
                ? 'bg-indigo-100/80 dark:bg-indigo-900/40 border-2 border-indigo-200 dark:border-indigo-900/30 px-3 py-1.5 rounded-2xl scale-110 origin-right shadow-sm'
                : 'bg-zinc-50 dark:bg-zinc-950 px-2 py-1 rounded-lg border border-zinc-100 dark:border-zinc-800'
            }`}>
              <Clock size={mode === 'live' ? 14 : 12} className={mode === 'live' ? 'text-indigo-600 dark:text-indigo-400 font-bold' : 'text-zinc-400'} />
              {mode === 'plan' ? (
                <div className="relative flex items-center">
                  <select
                    value={moment.duration}
                    onChange={(e) => updateMoment(moment.id, { duration: parseInt(e.target.value) || 0 })}
                    className="appearance-none bg-transparent border-none p-0 pr-1 text-sm font-black text-zinc-900 dark:text-white focus:ring-0 text-center cursor-pointer min-w-[20px]"
                  >
                    {Array.from({ length: 120 }, (_, i) => i + 1).map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <span className={`font-black ${mode === 'live' ? 'text-lg text-indigo-700 dark:text-indigo-300' : 'text-sm text-zinc-900 dark:text-white'}`}>{moment.duration}</span>
              )}
              <span className={`font-bold uppercase ${mode === 'live' ? 'text-[11px] text-indigo-600 dark:text-indigo-400' : 'text-[10px] text-zinc-400'}`}>min</span>
            </div>
          </div>

          {mode === 'plan' ? (
            <textarea
              ref={textareaRef}
              value={moment.description || ''}
              onChange={(e) => updateMoment(moment.id, { description: e.target.value })}
              className="w-full bg-transparent border-none p-0 text-base text-zinc-500 dark:text-zinc-400 focus:ring-0 resize-none overflow-hidden min-h-[40px]"
              placeholder="Beskriv vad som ska göras i det här momentet..."
              rows={1}
            />
          ) : (
            moment.description && (
               <p className="text-sm text-zinc-600 dark:text-zinc-400 font-medium leading-relaxed break-words [overflow-wrap:anywhere]">
                 {moment.description}
               </p>
            )
          )}

          {/* Media Section */}
          <div className="space-y-4 pt-2">
            {mode === 'plan' ? (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setShowMediaInputs(!showMediaInputs)}
                  className="flex items-center gap-2 text-[10px] font-black text-zinc-400 uppercase tracking-widest hover:text-indigo-600 transition-colors w-fit relative"
                >
                  <ImageIcon size={14} />
                  <span>Media & Länkar</span>
                  {(!showMediaInputs && ((moment.imageUrls?.length || 0) > 0 || moment.imageUrl || moment.externalLink)) && (
                    <span className="flex h-4 min-w-[1rem] px-1 items-center justify-center bg-indigo-500 text-white text-[8px] font-bold rounded-full shadow-sm">
                      {((moment.imageUrls?.length || 0) + (moment.imageUrl ? 1 : 0) + (moment.externalLink ? 1 : 0))}
                    </span>
                  )}
                  <ChevronDown size={14} className={`transition-transform ${showMediaInputs ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {showMediaInputs && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="space-y-3 overflow-hidden"
                    >
                      <div className="flex flex-col gap-2 bg-zinc-50 dark:bg-zinc-950 p-3 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                        {/* Title & Count */}
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                            Övningsbilder ({(moment.imageUrls?.length || 0) + (moment.imageUrl ? 1 : 0)})
                          </span>
                        </div>

                        {/* Thumbnails if any */}
                        {((moment.imageUrls && moment.imageUrls.length > 0) || moment.imageUrl) && (
                          <div className="flex flex-wrap gap-2 p-2 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800">
                            {moment.imageUrl && (
                              <div className="relative group w-16 h-16 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-805 shadow-sm shrink-0 bg-white dark:bg-zinc-950">
                                <img src={moment.imageUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                <button
                                  type="button"
                                  onClick={() => updateMoment(moment.id, { imageUrl: undefined })}
                                  className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors opacity-90 group-hover:opacity-100"
                                  title="Ta bort bild"
                                >
                                  <X size={10} />
                                </button>
                                <span className="absolute bottom-1 left-1 px-1 bg-indigo-600 text-white text-[8px] font-black uppercase rounded">
                                  Huvudbild
                                </span>
                              </div>
                            )}
                            {moment.imageUrls?.map((url, idx) => (
                              <div key={idx} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-805 shadow-sm shrink-0 bg-white dark:bg-zinc-950">
                                <img src={url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newUrls = (moment.imageUrls || []).filter((_, i) => i !== idx);
                                    updateMoment(moment.id, { imageUrls: newUrls });
                                  }}
                                  className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors opacity-90 group-hover:opacity-100"
                                  title="Ta bort bild"
                                >
                                  <X size={10} />
                                </button>
                                {!moment.imageUrl && idx === 0 && (
                                  <span className="absolute bottom-1 left-1 px-1 bg-indigo-600 text-white text-[8px] font-black uppercase rounded">
                                    Huvudbild
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Add image (link & upload) */}
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <div className="flex-1 flex items-center gap-2 bg-white dark:bg-zinc-900 px-3 py-2 rounded-xl border border-zinc-150 dark:border-zinc-800 min-w-0">
                              <ImageIcon size={14} className="text-zinc-400 shrink-0" />
                              <input
                                type="text"
                                value={imageUrlInput}
                                onChange={(e) => setImageUrlInput(e.target.value)}
                                placeholder="Klistra in en bildlänk..."
                                className="flex-1 min-w-0 bg-transparent border-none p-0 text-xs font-bold text-zinc-805 dark:text-zinc-150 focus:ring-0 placeholder:text-zinc-400"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (imageUrlInput.trim()) {
                                      const currentUrls = moment.imageUrls || (moment.imageUrl ? [moment.imageUrl] : []);
                                      updateMoment(moment.id, {
                                        imageUrls: [...currentUrls, imageUrlInput.trim()],
                                        imageUrl: undefined
                                      });
                                      setImageUrlInput('');
                                    }
                                  }
                                }}
                              />
                            </div>
                            
                            {imageUrlInput.trim() && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (imageUrlInput.trim()) {
                                    const currentUrls = moment.imageUrls || (moment.imageUrl ? [moment.imageUrl] : []);
                                    updateMoment(moment.id, {
                                      imageUrls: [...currentUrls, imageUrlInput.trim()],
                                      imageUrl: undefined
                                    });
                                    setImageUrlInput('');
                                  }
                                }}
                                className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-350 dark:hover:bg-zinc-700 px-3 rounded-xl text-xs font-bold transition-colors text-zinc-700 dark:text-zinc-300"
                              >
                                Lägg till
                              </button>
                            )}

                            <input
                              type="file"
                              ref={fileInputRef}
                              onChange={handleFileUpload}
                              accept="image/*"
                              multiple
                              className="hidden"
                            />
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={uploadProgress !== null}
                              className={`flex items-center justify-center gap-1.5 bg-indigo-55 hover:bg-indigo-105 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 px-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 border border-indigo-100/20 whitespace-nowrap`}
                            >
                              {uploadProgress !== null ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Upload size={14} />
                              )}
                              <span>{((moment.imageUrls?.length || 0) + (moment.imageUrl ? 1 : 0)) > 0 ? 'Fler' : 'Välj bilder'}</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {uploadProgress !== null && (
                        <div className="px-3 pb-1">
                          <div className="w-full h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                            <motion.div 
                              className="h-full bg-indigo-600"
                              initial={{ width: 0 }}
                              animate={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                          <span className="text-[8px] font-black text-indigo-600 uppercase tracking-widest mt-1 block">
                            Laddar upp {Math.round(uploadProgress)}%
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-950 p-3 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                        <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 shrink-0">
                          {isYouTube(moment.externalLink) ? <Youtube size={16} /> : <LinkIcon size={16} />}
                        </div>
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <input
                            type="url"
                            value={moment.externalLink || ''}
                            onChange={(e) => updateMoment(moment.id, { externalLink: e.target.value })}
                            className="flex-1 min-w-0 bg-transparent border-none p-0 text-base font-bold text-zinc-900 dark:text-white focus:ring-0 placeholder:text-zinc-400"
                            placeholder="Externt klipp eller länk (t.ex. YouTube)..."
                          />
                          {moment.externalLink && (
                            <button
                              type="button"
                              onClick={() => updateMoment(moment.id, { externalLink: undefined })}
                              className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                              title="Ta bort länk"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              (moment.imageUrl || moment.imageUrls || moment.externalLink) && (
                <div className="flex flex-wrap gap-4">
                  {moment.imageUrl && (
                    <button
                      onClick={() => {
                        const urls = [moment.imageUrl!];
                        if (moment.imageUrls) urls.push(...moment.imageUrls);
                        onViewImage && onViewImage(urls, 0);
                      }}
                      className="relative group w-32 aspect-video bg-zinc-100 dark:bg-zinc-800 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 shadow-sm hover:shadow-md transition-all active:scale-95"
                    >
                      <img 
                        src={moment.imageUrl} 
                        alt="Beskrivande bild"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all">
                        <Maximize2 size={24} className="text-white opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all" />
                      </div>
                    </button>
                  )}

                  {moment.imageUrls?.map((url, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        const urls = moment.imageUrl ? [moment.imageUrl, ...moment.imageUrls!] : moment.imageUrls!;
                        const index = moment.imageUrl ? idx + 1 : idx;
                        onViewImage && onViewImage(urls, index);
                      }}
                      className="relative group w-32 aspect-video bg-zinc-100 dark:bg-zinc-800 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 shadow-sm hover:shadow-md transition-all active:scale-95"
                    >
                      <img 
                        src={url} 
                        alt={`Beskrivande bild ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all">
                        <Maximize2 size={24} className="text-white opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all" />
                      </div>
                    </button>
                  ))}

                  {moment.externalLink && (
                    <a
                      href={moment.externalLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-full flex flex-col justify-center gap-1.5 p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/30 rounded-2xl hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all group"
                    >
                      <div className="flex items-center gap-2">
                        {isYouTube(moment.externalLink) ? (
                          <div className="w-8 h-8 rounded-lg bg-red-600 text-white flex items-center justify-center shadow-lg shadow-red-200 dark:shadow-none">
                            <Youtube size={16} />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-none">
                            <LinkIcon size={16} />
                          </div>
                        )}
                        <div className="flex flex-col">
                          <span className="text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Öppna länk</span>
                          <span className="text-xs font-bold text-zinc-900 dark:text-white flex items-center gap-1">
                            {isYouTube(moment.externalLink) ? 'Visa videoklipp' : 'Visa extern länk'}
                            <ExternalLink size={10} className="text-zinc-400" />
                          </span>
                        </div>
                      </div>
                    </a>
                  )}
                </div>
              )
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-50 dark:border-zinc-950">
            {mode === 'plan' ? (
              <>
                <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-950 p-1.5 rounded-xl border border-zinc-100 dark:border-zinc-800">
                  <div className="relative">
                    <select
                      value={moment.exerciseId || ''}
                      onChange={(e) => updateMoment(moment.id, { exerciseId: e.target.value || undefined })}
                      className="appearance-none bg-transparent text-[10px] font-bold text-zinc-500 px-3 py-1 pr-8 rounded-lg focus:ring-0 cursor-pointer max-w-[150px] truncate uppercase tracking-wider border-none"
                    >
                      <option value="">Ingen tävling...</option>
                      {exercises.map(ex => (
                        <option key={ex.id} value={ex.id}>{ex.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400" />
                  </div>

                  {moment.exerciseId && (
                    <div className="flex items-center gap-1 border-l border-zinc-200 dark:border-zinc-800 ml-1 pl-1">
                      {onEditExercise && (
                        <button
                          onClick={() => onEditExercise(moment.exerciseId!)}
                          className="p-1.5 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                          title="Redigera tävlingsmoment"
                        >
                          <Edit2 size={14} />
                        </button>
                      )}
                      {onDeleteExercise && (
                        <button
                          onClick={() => {
                            setConfirmDeleteExercise({
                              exerciseId: moment.exerciseId!,
                              momentId: moment.id,
                              name: exercises.find(ex => ex.id === moment.exerciseId)?.name || 'Tävlingsmoment'
                            });
                          }}
                          className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                          title="Radera tävlingsmoment"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onOpenTacticalBoard && onOpenTacticalBoard(moment)}
                  className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg transition-all border shadow-sm bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/25 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/40 active:scale-95"
                  title="Öppna rittavla för att förklara övningen"
                >
                  <Layout size={11} />
                  <span>Rittavla {moment.tacticalBoards && moment.tacticalBoards.length > 0 ? `(${moment.tacticalBoards.length})` : ''}</span>
                </button>

                {onCreateExercise && !moment.exerciseId && (
                  <button
                    onClick={() => {
                      const dateObj = new Date(sessionDate);
                      const dateStr = `${dateObj.getDate()}/${dateObj.getMonth() + 1} -${dateObj.getFullYear().toString().slice(-2)}`;
                      const baseName = (moment.name && moment.name.trim()) || sessionTitle || 'Nytt tävlingsmoment';
                      const exerciseName = `${baseName} - ${dateStr}`;
                      onCreateExercise(exerciseName, moment.id);
                    }}
                    className="flex items-center gap-1 text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-2 py-1.5 rounded-lg transition-colors border border-indigo-100 dark:border-indigo-900/30 shadow-sm"
                  >
                    + Tävling
                  </button>
                )}

                {onSaveToBank && (
                  <>
                    {!isSavedInBank ? (
                      <button
                        type="button"
                        onClick={() => {
                          const newBankId = onSaveToBank(moment);
                          if (newBankId && typeof newBankId === 'string') {
                            updateMoment(moment.id, { bankExerciseId: newBankId });
                          }
                        }}
                        className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg transition-colors border shadow-sm bg-zinc-50 dark:bg-zinc-900/50 text-zinc-650 dark:text-zinc-350 border-zinc-200 dark:border-zinc-705/55 hover:bg-zinc-100 dark:hover:bg-zinc-805"
                      >
                        <Library size={10} />
                        <span>Spara till bank</span>
                      </button>
                    ) : (
                      <>
                        {hasModifications && onUpdateBankExercise ? (
                          <div className="flex flex-wrap gap-2 items-center">
                            <button
                              type="button"
                              onClick={() => {
                                if (bankExercise) {
                                  if (!moment.bankExerciseId) {
                                    updateMoment(moment.id, { bankExerciseId: bankExercise.id });
                                  }
                                  onUpdateBankExercise(bankExercise.id, {
                                    name: moment.name,
                                    duration: moment.duration || 15,
                                    description: moment.description,
                                    externalLink: moment.externalLink,
                                    imageUrl: moment.imageUrl,
                                    imageUrls: moment.imageUrls || (moment.imageUrl ? [moment.imageUrl] : []),
                                    tacticalBoards: moment.tacticalBoards,
                                  });
                                  setJustUpdatedBank(true);
                                  setTimeout(() => setJustUpdatedBank(false), 2000);
                                }
                              }}
                              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg transition-colors border shadow-sm bg-amber-50 hover:bg-amber-100/80 dark:bg-amber-950/25 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/40"
                              title="Uppdatera övningen i övningsbanken med den här träningens ändringar"
                            >
                              <Upload size={11} />
                              <span>{justUpdatedBank ? 'Bank uppdaterad!' : 'Uppdatera i banken'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                if (bankExercise) {
                                  updateMoment(moment.id, {
                                    name: bankExercise.name || '',
                                    duration: bankExercise.duration || 15,
                                    description: bankExercise.description || '',
                                    externalLink: bankExercise.externalLink || '',
                                    imageUrl: bankExercise.imageUrl || '',
                                    imageUrls: bankExercise.imageUrls || (bankExercise.imageUrl ? [bankExercise.imageUrl] : []),
                                    bankExerciseId: bankExercise.id,
                                  });
                                  setJustFetchedBank(true);
                                  setTimeout(() => setJustFetchedBank(false), 2000);
                                }
                              }}
                              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg transition-colors border shadow-sm bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/25 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-900/40"
                              title="Hämta den sparade versionen från övningsbanken och skriv över ändringarna i detta pass"
                            >
                              <Download size={11} className={justFetchedBank ? "animate-bounce" : ""} />
                              <span>{justFetchedBank ? 'Hämtat!' : 'Hämta från banken'}</span>
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg transition-colors border shadow-sm bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30"
                          >
                            <Check size={11} className="stroke-[3]" />
                            <span>{justUpdatedBank ? 'Bank uppdaterad!' : justFetchedBank ? 'Hämtat!' : 'Sparad i banken'}</span>
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {onOpenTacticalBoard && (
                  <button
                    type="button"
                    onClick={() => onOpenTacticalBoard(moment)}
                    className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all border shadow-sm active:scale-95 cursor-pointer ${
                      moment.tacticalBoards && moment.tacticalBoards.length > 0
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500 shadow-emerald-100 dark:shadow-none'
                        : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-750 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
                    }`}
                    title="Öppna rittavla för att visa övningen"
                  >
                    <Layout size={14} />
                    <span>Visa rittavla {moment.tacticalBoards && moment.tacticalBoards.length > 0 ? `(${moment.tacticalBoards.length})` : ''}</span>
                  </button>
                )}

                {moment.exerciseId && onSelectExercise && (
                  <>
                    <button
                      onClick={() => onSelectExercise(moment.exerciseId!)}
                      className="bg-indigo-600 text-white px-3.5 py-2 rounded-xl font-black text-xs flex items-center justify-center gap-2 shadow-md shadow-indigo-100 dark:shadow-none hover:bg-indigo-700 transition-all active:scale-[0.98] cursor-pointer"
                    >
                      <Play fill="currentColor" size={12} />
                      Starta tävling
                    </button>
                    <button
                      onClick={() => onShowTeams && onShowTeams(moment.exerciseId!)}
                      className="p-2.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-2xl hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all border border-zinc-200 dark:border-zinc-700 cursor-pointer"
                      title="Visa lagöversikt"
                    >
                      <Users size={16} />
                    </button>
                  </>
                )}
                {moment.exerciseId && onEditExercise && (
                  <button
                    onClick={() => onEditExercise(moment.exerciseId!)}
                    className="p-2.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-2xl hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all border border-zinc-200 dark:border-zinc-700 cursor-pointer"
                    title="Redigera tävlingsmoment"
                  >
                    <Edit2 size={16} />
                  </button>
                )}
              </div>
            )}

            <div className="ml-auto flex items-center gap-2">
              {mode === 'plan' && onAddAfter && (
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={onAddAfter}
                  className="p-2 text-zinc-300 hover:text-indigo-500 transition-colors"
                  title="Lägg till moment under"
                >
                  <PlusCircle size={18} />
                </motion.button>
              )}
              <button
                onClick={() => setConfirmDeleteMoment({ id: moment.id, name: moment.name || 'Namnlöst moment' })}
                className={`p-2 text-zinc-300 hover:text-red-500 transition-colors ${mode === 'plan' ? 'block' : 'hidden'}`}
                title="Ta bort moment"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Reorder.Item>
  );
}

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
  onUpdateBankExercise
}: SessionEditorProps) {
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [selectedExerciseForTeams, setSelectedExerciseForTeams] = useState<string | null>(null);
  const [exerciseToDelete, setExerciseToDelete] = useState<{ exerciseId: string, momentId: string, name: string } | null>(null);
  const [momentToDelete, setMomentToDelete] = useState<{ id: string, name: string } | null>(null);
  const [viewingImageInfo, setViewingImageInfo] = useState<{ urls: string[], index: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'schema' | 'attendance'>(initialTab);
  const [tacticalBoardMoment, setTacticalBoardMoment] = useState<SessionMoment | null>(null);
  const mode = initialMode;
  const setMode = onModeChange || (() => {});

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync activeTab when initialTab or session changes
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, session.id]);

  // Use a ref for the session to avoid stale closures in event handlers
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Auto-resize notes textarea
  useEffect(() => {
    const adjustHeight = () => {
      if (notesTextareaRef.current) {
        notesTextareaRef.current.style.height = 'auto';
        notesTextareaRef.current.style.height = `${notesTextareaRef.current.scrollHeight}px`;
      }
    };

    if (showNotes) {
      adjustHeight();
      const timeoutId = setTimeout(adjustHeight, 10);
      window.addEventListener('resize', adjustHeight);
      return () => {
        clearTimeout(timeoutId);
        window.removeEventListener('resize', adjustHeight);
      };
    }
  }, [session.notes, showNotes, mode]);

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
      
      const startTimeStr = momentStart.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
      const endTimeStr = momentEnd.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
      
      currentMinutes += moment.duration;
      
      return {
        ...moment,
        startTimeStr,
        endTimeStr
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
    const start = startH * 60 + startM;
    const end = endH * 60 + endM;
    let diff = end - start;
    if (diff < 0) diff += 24 * 60; // Handle overnight (rare for training but still)
    return diff;
  }, [session.startTime, session.endTime, totalPlannedMinutes]);

  const timeStatus = useMemo(() => {
    if (!session.endTime) return { label: 'Sätt sluttid för att spåra tidsbudget', color: 'text-zinc-400' };
    const diff = sessionDuration - totalPlannedMinutes;
    if (diff === 0) return { label: 'Perfekt planerat!', color: 'text-green-500' };
    if (diff > 0) return { label: `${diff} min kvar att fylla`, color: 'text-amber-500' };
    return { label: `${Math.abs(diff)} min för mycket planerat`, color: 'text-red-500' };
  }, [sessionDuration, totalPlannedMinutes, session.endTime]);

  const addMoment = (index?: number) => {
    const newMoment: SessionMoment = {
      id: Math.random().toString(36).substring(7),
      name: '',
      duration: 10,
      description: ''
    };
    
    const newMoments = [...session.moments];
    if (typeof index === 'number') {
      newMoments.splice(index + 1, 0, newMoment);
    } else {
      newMoments.push(newMoment);
    }

    onUpdate({
      ...session,
      moments: newMoments,
      updatedAt: Date.now()
    });

    if (typeof index !== 'number') {
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({
            top: scrollContainerRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 100);
    }
  };

  const updateMoment = (id: string, updates: Partial<SessionMoment>) => {
    const currentSession = sessionRef.current;
    onUpdate({
      ...currentSession,
      moments: currentSession.moments.map(m => m.id === id ? { ...m, ...updates } : m),
      updatedAt: Date.now()
    });
  };

  const removeMoment = (id: string) => {
    const currentSession = sessionRef.current;
    onUpdate({
      ...currentSession,
      moments: currentSession.moments.filter(m => m.id !== id),
      updatedAt: Date.now()
    });
  };

  const handleQuickAddGuest = (name: string) => {
    const currentSession = sessionRef.current;
    const newGuest: SquadPlayer = {
      id: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      name: name.trim(),
    };

    onUpdate({
      ...currentSession,
      guestPlayers: [...(currentSession.guestPlayers || []), newGuest],
      attendance: [...(currentSession.attendance || []), newGuest.id],
      updatedAt: Date.now()
    });
  };

  const handleReorder = (newMoments: SessionMoment[]) => {
    const currentSession = sessionRef.current;
    onUpdate({
      ...currentSession,
      moments: newMoments,
      updatedAt: Date.now()
    });
  };

  return (
    <div ref={scrollContainerRef} className="fixed inset-0 bg-zinc-50 dark:bg-black z-[60] flex flex-col overflow-y-auto overflow-x-hidden">
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
                onUpdate({
                  ...currentSession,
                  attendance: [...currentAttendance, playerId],
                  updatedAt: Date.now()
                });
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

      {/* Non-sticky Main Header Info */}
      <div className="bg-white dark:bg-zinc-900 shrink-0 border-b border-zinc-100 dark:border-zinc-850">
        <div className="max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 py-2 sm:py-3 flex items-center gap-3">
          <button 
            onClick={onClose}
            className="p-2 -ml-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft size={22} />
          </button>
          
          <div className="flex-1 min-w-0">
            {mode === 'plan' ? (
              <input
                type="text"
                value={session.title}
                onChange={(e) => onUpdate({ ...session, title: e.target.value })}
                placeholder="Träningspassets namn..."
                className="w-full bg-transparent border-none p-0 text-base sm:text-lg font-black text-zinc-900 dark:text-white focus:ring-0 placeholder:text-zinc-300 dark:placeholder:text-zinc-700 leading-tight uppercase"
              />
            ) : (
              <h2 className="text-base sm:text-lg font-black text-zinc-900 dark:text-white truncate uppercase leading-tight">
                {session.title || 'Träning'}
              </h2>
            )}
          </div>

          <button
            onClick={onClose}
            className="bg-indigo-600 text-white p-2 sm:p-2.5 rounded-xl font-black flex items-center shadow-lg shadow-indigo-100 dark:shadow-none transition-all active:scale-95 shrink-0 hover:bg-indigo-700"
            title="Spara"
          >
            <Save size={20} />
          </button>
        </div>

        <div className="max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 pb-3 flex flex-col gap-2">
          <div className="grid grid-cols-[1.6fr_1fr] sm:flex sm:items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => mode === 'plan' && setShowTimePicker(true)}
              className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 h-11 rounded-xl border transition-colors w-full sm:w-auto ${
                mode === 'plan' 
                  ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700' 
                  : 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-900/30'
              }`}
            >
              <Calendar size={15} className={`shrink-0 ${mode === 'plan' ? "text-zinc-500" : "text-indigo-400"}`} />
              <span className={`text-[11px] sm:text-xs md:text-sm font-black truncate uppercase tracking-tight ${mode === 'plan' ? "text-zinc-700 dark:text-zinc-300" : "text-indigo-600 dark:text-indigo-400"}`}>
                {new Date(session.date).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })}
              </span>
              <div className={`w-px h-3.5 mx-0.5 sm:mx-1 shrink-0 ${mode === 'plan' ? "bg-zinc-300 dark:bg-zinc-700" : "bg-indigo-200 dark:bg-indigo-900/30"}`} />
              <Clock size={15} className={`shrink-0 ${mode === 'plan' ? "text-zinc-500" : "text-indigo-400"}`} />
              <span className={`text-[11px] sm:text-xs md:text-sm font-black truncate uppercase tracking-tight ${mode === 'plan' ? "text-zinc-700 dark:text-zinc-300" : "text-indigo-600 dark:text-indigo-400"}`}>
                {session.startTime} - {session.endTime || calculatedEndTime}
              </span>
            </button>

            {!session.isCompleted ? (
              <button
                onClick={() => onUpdate({ ...session, isCompleted: true })}
                className="px-3 h-11 bg-green-600 text-white border border-transparent rounded-xl font-black flex items-center justify-center gap-1.5 text-[10px] md:text-xs shadow-lg shadow-green-100 dark:shadow-none transition-all active:scale-95 shrink-0 hover:bg-green-700 uppercase tracking-tight w-full sm:w-auto"
              >
                <Check size={14} strokeWidth={3} className="shrink-0" />
                <span className="truncate">Klarmarkera</span>
              </button>
            ) : (
              <button
                onClick={() => onUpdate({ ...session, isCompleted: false })}
                className="px-3 h-11 bg-green-100 text-green-705 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-xl font-black flex items-center justify-center gap-1.5 text-[10px] md:text-xs transition-all active:scale-95 shrink-0 uppercase tracking-tight w-full sm:w-auto"
              >
                <Check size={14} className="shrink-0" />
                <span className="truncate">Genomförd</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sticky Navigation and Mode Tabs Row */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-50 py-2.5 sm:py-3 shadow-md dark:shadow-zinc-950/20 shrink-0">
        <div className="max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-[1.6fr_1fr] sm:flex sm:items-center gap-2 w-full sm:w-auto">
            {/* Steg-kontroll: Planera & Träna */}
            <div className="flex items-center p-0.5 h-11 bg-zinc-100 dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shrink-0 w-full sm:w-auto">
              <button
                onClick={() => {
                  setMode('plan');
                  setActiveTab('schema');
                }}
                className={`h-full px-2 xs:px-3 sm:px-4 rounded-lg text-[10px] xs:text-xs md:text-sm font-black uppercase tracking-tight transition-all flex items-center justify-center gap-1 xs:gap-1.5 flex-1 sm:flex-initial truncate ${
                  activeTab === 'schema' && mode === 'plan' 
                    ? 'bg-white text-zinc-900 dark:bg-zinc-700 dark:text-white border border-zinc-200/50 dark:border-zinc-600 shadow-sm scale-[1.01]' 
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-450 dark:hover:text-zinc-200'
                }`}
              >
                <Edit2 size={12} className={`shrink-0 ${activeTab === 'schema' && mode === 'plan' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-500'}`} />
                <span className="truncate">Planera</span>
              </button>

              <div className="px-0.5 text-zinc-350 dark:text-zinc-650 shrink-0">
                <ChevronRight size={12} className="stroke-[2.5]" />
              </div>

              <button
                onClick={() => {
                  setMode('live');
                  setActiveTab('schema');
                }}
                className={`h-full px-2 xs:px-3 sm:px-4 rounded-lg text-[10px] xs:text-xs md:text-sm font-black uppercase tracking-tight transition-all flex items-center justify-center gap-1 xs:gap-1.5 flex-1 sm:flex-initial truncate ${
                  activeTab === 'schema' && mode === 'live'
                    ? 'bg-white text-zinc-900 dark:bg-zinc-700 dark:text-white border border-zinc-200/50 dark:border-zinc-600 shadow-sm scale-[1.01]' 
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-450 dark:hover:text-zinc-200'
                }`}
              >
                <Play size={12} fill={activeTab === 'schema' && mode === 'live' ? 'currentColor' : 'none'} className={`shrink-0 ${activeTab === 'schema' && mode === 'live' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-500'}`} />
                <span className="truncate">Träna</span>
              </button>
            </div>

            {/* Separat Deltagare-knapp */}
            <button
              onClick={() => setActiveTab('attendance')}
              className={`px-3 h-11 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-tight border transition-all flex items-center justify-center gap-1.5 w-full sm:w-auto ${
                activeTab === 'attendance'
                  ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-805 shadow-sm'
                  : 'bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-550 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800'
              }`}
            >
              <Users size={12} className={activeTab === 'attendance' ? 'text-indigo-500 shrink-0' : 'text-zinc-505 dark:text-zinc-400 shrink-0'} />
              <span className="truncate">Deltagare ({session.attendance?.length || 0})</span>
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showTimePicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
            onClick={() => setShowTimePicker(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Inställningar för träningspass</h3>
                <button onClick={() => setShowTimePicker(false)} className="text-zinc-400 hover:text-zinc-600 p-1">
                  <Check className="text-green-500" size={24} />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Datum</label>
                  <input
                    type="date"
                    value={new Date(session.date).toISOString().split('T')[0]}
                    onChange={(e) => onUpdate({ ...session, date: new Date(e.target.value).getTime() })}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-base font-bold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Starttid</label>
                    <input
                      type="time"
                      value={session.startTime}
                      onChange={(e) => onUpdate({ ...session, startTime: e.target.value })}
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-base font-bold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Sluttid</label>
                    <input
                      type="time"
                      value={session.endTime || calculatedEndTime}
                      onChange={(e) => onUpdate({ ...session, endTime: e.target.value })}
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-base font-bold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>

                <div className="bg-zinc-50 dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                  <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-zinc-500 uppercase">Tid nyttjad</span>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${session.endTime && totalPlannedMinutes > sessionDuration ? 'bg-red-100 text-red-600' : 'bg-indigo-100 text-indigo-600'}`}>
                          {totalPlannedMinutes} {session.endTime ? `/ ${sessionDuration}` : ''} min
                      </span>
                  </div>
                  {session.endTime && (
                    <div className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                            className={`h-full transition-all duration-500 ${totalPlannedMinutes > sessionDuration ? 'bg-red-500' : 'bg-indigo-500'}`}
                            style={{ width: `${Math.min(100, (totalPlannedMinutes / sessionDuration) * 100)}%` }}
                        />
                    </div>
                  )}
                  {timeStatus && (
                      <p className={`text-[10px] font-bold mt-2 text-center ${timeStatus.color}`}>
                          {timeStatus.label}
                      </p>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div 
        className="flex-1 p-4 sm:p-6"
      >
        <div className="w-full max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto space-y-6">
          {activeTab === 'schema' ? (
            <>
              {/* Notes Section */}
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 shadow-sm overflow-hidden"
              >
                <button 
                  onClick={() => setShowNotes(!showNotes)}
                  className="w-full flex items-center justify-between p-5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
                      <FileText size={16} />
                    </div>
                    <span className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight">Syfte & Anteckningar</span>
                    {session.notes && !showNotes && (
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse ml-1" />
                    )}
                  </div>
                  <motion.div
                    animate={{ rotate: showNotes ? 180 : 0 }}
                    className="text-zinc-400"
                  >
                    <ChevronDown size={20} />
                  </motion.div>
                </button>
                
                <AnimatePresence>
                  {showNotes && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="px-5 pb-5 pt-0">
                        {mode === 'plan' ? (
                          <textarea
                            ref={notesTextareaRef}
                            value={session.notes || ''}
                            onChange={(e) => onUpdate({ ...session, notes: e.target.value, updatedAt: Date.now() })}
                            placeholder="Skriv in mål, syfte eller anteckningar för träningen..."
                            className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-2xl p-4 text-base text-zinc-600 dark:text-zinc-400 focus:ring-2 focus:ring-indigo-500 outline-none resize-none min-h-[120px] font-medium overflow-hidden"
                            rows={1}
                          />
                        ) : (
                          session.notes ? (
                            <div className="bg-zinc-50 dark:bg-zinc-950 rounded-2xl p-4 border border-zinc-100 dark:border-zinc-800">
                              <p className="text-sm text-zinc-600 dark:text-zinc-400 font-medium whitespace-pre-wrap leading-relaxed italic">
                                "{session.notes}"
                              </p>
                            </div>
                          ) : (
                            <p className="text-xs text-zinc-400 italic px-2">Inga anteckningar för detta pass.</p>
                          )
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {mode === 'plan' && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-3xl border border-zinc-100 dark:border-zinc-800 shadow-sm"
                >
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                        <Clock size={16} />
                      </div>
                      <span className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight">Tidsanvändning</span>
                    </div>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${session.endTime && totalPlannedMinutes > sessionDuration ? 'bg-red-100 text-red-600' : 'bg-indigo-100 text-indigo-600'}`}>
                      {totalPlannedMinutes} {session.endTime ? `/ ${sessionDuration}` : ''} min
                    </span>
                  </div>
                  {session.endTime && (
                    <div className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${totalPlannedMinutes > sessionDuration ? 'bg-red-500' : 'bg-indigo-500'}`}
                        style={{ width: `${Math.min(100, (totalPlannedMinutes / sessionDuration) * 100)}%` }}
                      />
                    </div>
                  )}
                  {timeStatus && (
                    <p className={`text-[10px] font-bold mt-2 text-center ${timeStatus.color}`}>
                      {timeStatus.label}
                    </p>
                  )}
                </motion.div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
                <h3 className="text-sm font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <ListTodo size={16} />
                  Schema ({totalPlannedMinutes} minuter)
                </h3>
                {mode === 'live' && !session.isStarted && (
                  <button
                    onClick={() => {
                      if ('Notification' in window && Notification.permission === 'default') {
                        Notification.requestPermission();
                      }
                      onUpdate({ ...session, isStarted: true, actualStartTime: Date.now(), updatedAt: Date.now() });
                    }}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-2.5 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all active:scale-95"
                  >
                    <Play size={14} fill="currentColor" />
                    Starta passet (aktiverar notiser)
                  </button>
                )}
                {mode === 'live' && session.isStarted && (
                   <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/30 rounded-xl">
                     <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                     <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">Passet är igång</span>
                     <button
                        onClick={() => onUpdate({ ...session, isStarted: false, updatedAt: Date.now() })}
                        className="ml-2 text-[8px] font-bold text-zinc-400 hover:text-red-500 uppercase"
                     >
                        Nollställ
                     </button>
                   </div>
                )}
                {mode === 'plan' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => addMoment()}
                      className="flex items-center justify-center gap-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 px-5 py-2.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors shadow-sm"
                    >
                      <PlusCircle size={16} />
                      Lägg till moment
                    </motion.button>
                    {allSessions && onUpdateSession && (
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setShowCopyModal(true)}
                        className="flex items-center justify-center gap-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-350 px-5 py-2.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shadow-sm border border-zinc-200/50 dark:border-zinc-700/50"
                      >
                        <Copy size={14} />
                        Kopiera / Hämta övningar
                      </motion.button>
                    )}
                  </div>
                )}
              </div>

              <Reorder.Group axis="y" values={session.moments} onReorder={handleReorder} className="space-y-4">
                {session.moments.map((moment, index) => (
                  <MomentItem
                    key={moment.id}
                    moment={moment}
                    details={momentDetails[index]}
                    mode={mode}
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
                  />
                ))}
              </Reorder.Group>

              {session.moments.length > 0 && mode === 'plan' && (
                <div className="pt-4 pb-4 flex justify-center">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => addMoment()}
                    className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors shadow-sm"
                  >
                    <PlusCircle size={18} />
                    Lägg till moment längst ner
                  </motion.button>
                </div>
              )}

              {/* Completion button at bottom - very prominent */}
              {!session.isCompleted && (
                <div className="pt-6 pb-8 flex flex-col items-center justify-center">
                  <button
                    onClick={() => onUpdate({ ...session, isCompleted: true })}
                    className="w-full max-w-xs py-3 px-4 bg-green-600 text-white rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-green-100/50 dark:shadow-none hover:bg-green-700 transition-all active:scale-[0.98] uppercase tracking-wider"
                  >
                    <Check size={16} strokeWidth={3} className="shrink-0" />
                    <span className="text-center leading-none">Klarmarkera träningspass</span>
                  </button>
                  <p className="text-center text-zinc-400 text-[10px] font-bold uppercase tracking-wider mt-2.5">
                    Avsluta passet och arkivera det under genomförda
                  </p>
                </div>
              )}

              {session.moments.length === 0 && (
                <div className="text-center py-12 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl flex flex-col items-center justify-center gap-3">
                  <p className="text-zinc-400 text-sm font-medium">Inga moment tillagda än</p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      onClick={() => addMoment()}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors shadow-sm"
                    >
                      Lägg till första momentet
                    </button>
                    {allSessions && onUpdateSession && (
                      <button
                        onClick={() => setShowCopyModal(true)}
                        className="bg-zinc-105 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-4 py-2 rounded-xl font-bold text-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                      >
                        Hämta från annat pass
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <ParticipantManager 
              session={session} 
              squad={squad} 
              onUpdate={onUpdate}
              adminUrl={adminUrl}
            />
          )}
          
          <div className="pb-32" />
        </div>
      </div>

      {/* Exercise Delete Confirmation Modal */}
      <AnimatePresence>
        {exerciseToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4 text-left"
            onClick={() => setExerciseToDelete(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-black text-zinc-900 dark:text-white mb-2 uppercase tracking-tight">Radera tävling?</h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-8 font-medium">
                Är du säker på att du vill radera "{exerciseToDelete.name}"? 
                Detta tar även bort alla lag och resultat permanent.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    if (onDeleteExercise) {
                      updateMoment(exerciseToDelete.momentId, { exerciseId: undefined });
                      onDeleteExercise(exerciseToDelete.exerciseId);
                    }
                    setExerciseToDelete(null);
                  }}
                  className="w-full py-4 bg-red-600 text-white rounded-2xl font-black hover:bg-red-700 transition-all uppercase text-xs shadow-lg shadow-red-200 dark:shadow-none"
                >
                  Ja, radera tävlingen
                </button>
                <button
                  onClick={() => setExerciseToDelete(null)}
                  className="w-full py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-2xl font-black hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all uppercase text-xs"
                >
                  Avbryt
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Moment Delete Confirmation Modal */}
      <AnimatePresence>
        {momentToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4 text-left"
            onClick={() => setMomentToDelete(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-black text-zinc-900 dark:text-white mb-2 uppercase tracking-tight">Radera moment?</h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-8 font-medium text-sm">
                Är du säker på att du vill radera "{momentToDelete.name}" från schemat?
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    removeMoment(momentToDelete.id);
                    setMomentToDelete(null);
                  }}
                  className="w-full py-4 bg-red-600 text-white rounded-2xl font-black hover:bg-red-700 transition-all uppercase text-xs shadow-lg shadow-red-200 dark:shadow-none"
                >
                  Ja, radera momentet
                </button>
                <button
                  onClick={() => setMomentToDelete(null)}
                  className="w-full py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-2xl font-black hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all uppercase text-xs"
                >
                  Avbryt
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* Reusable Whiteboard Modal for Moments */}
      {tacticalBoardMoment && (
        <TacticalBoardModal
          boards={tacticalBoardMoment.tacticalBoards || []}
          onSave={(updatedBoards) => {
            updateMoment(tacticalBoardMoment.id, { tacticalBoards: updatedBoards });
            setTacticalBoardMoment(null);
          }}
          onClose={() => setTacticalBoardMoment(null)}
          squad={squad}
          title={`Rittavla - ${tacticalBoardMoment.name || 'Moment'}`}
        />
      )}
    </div>
  );
}

function isValidPlayerName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();

  // 1. Must contain at least one letter (a-z, including Swedish standard letters/accents)
  if (!/[a-zåäöéèüíóáñæø]/i.test(trimmed)) {
    return false;
  }

  // 2. Exact match check for common status words or phrases, including user specified words
  const blockedExact = [
    'ja', 'nej', 'kanske', 'deltar', 'deltar ej', 'ej svarat', 'anmäld', 'reserv',
    'kommentar', 'svara', 'obesvarad', 'status', 'tid', 'plats', 'anmäld', 'avanmäld',
    'gäst', 'gästspelare', 'provspelare', 'ledare', 'tränare', 'spelare', 'ej svarat',
    'nej tack', 'skjuts', 'bil', 'bilar', 'platser', 'lediga', 'ja tack', 'platser kvar',
    'platser lediga', 'förare', 'plats kvar', 'kör ej', 'kör', 'vill ha skjuts'
  ];
  if (blockedExact.includes(lower)) {
    return false;
  }

  // 3. Regular Expression patterns for status/driving/tickets etc. (e.g. "4 platser", "2 bilar")
  if (/\b\d+\s*(platser|plats|lediga|bilar|bil|skolkort|st|stycken)\b/i.test(lower)) {
    return false;
  }

  if (lower.startsWith('kommentar:') || lower.startsWith('svar saknas')) {
    return false;
  }
  if (lower.includes('platser') && (lower.includes('kvar') || lower.includes('lediga'))) {
    return false;
  }

  // 4. Length check: Too short to be a name
  if (trimmed.length < 2) {
    return false;
  }

  return true;
}

function ParticipantManager({ 
  session, 
  squad, 
  onUpdate, 
  adminUrl,
}: { 
  session: TrainingSession, 
  squad: SquadPlayer[], 
  onUpdate: (updated: TrainingSession) => void,
  adminUrl?: string,
}) {
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPosition, setGuestPosition] = useState("");
  const [sortAttendingFirst, setSortAttendingFirst] = useState(false);
  const attendance = session.attendance || [];
  const guestPlayers = session.guestPlayers || [];

  const handleTogglePlayer = (id: string) => {
    const newAttendance = attendance.includes(id)
      ? attendance.filter(pid => pid !== id)
      : [...attendance, id];
    onUpdate({ ...session, attendance: newAttendance, updatedAt: Date.now() });
  };

  const handleAddGuest = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!guestName.trim()) return;

    const newGuest: SquadPlayer = {
      id: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      name: guestName.trim(),
      position: guestPosition.trim() || undefined,
    };

    // Update both in one go to ensure consistency and prevent state overwrite
    onUpdate({
      ...session,
      guestPlayers: [...guestPlayers, newGuest],
      attendance: [...attendance, newGuest.id],
      updatedAt: Date.now()
    });
    setGuestName("");
    setGuestPosition("");
  };

  const removeGuest = (id: string) => {
    onUpdate({
      ...session,
      guestPlayers: guestPlayers.filter(p => p.id !== id),
      attendance: attendance.filter(pid => pid !== id),
      updatedAt: Date.now()
    });
  };

  const updateGuestPosition = (guestId: string, position: string) => {
    onUpdate({
      ...session,
      guestPlayers: guestPlayers.map(p => p.id === guestId ? { ...p, position: position || undefined } : p),
      updatedAt: Date.now()
    });
  };

  const handlePaste = () => {
    const lines = pasteValue.split(/[\n,;]/);
    const parsedNames = lines
      .map(line => {
        let trimmed = line.trim();
        if (trimmed.endsWith(' Deltar')) {
          trimmed = trimmed.substring(0, trimmed.length - 7).trim();
        }
        return trimmed;
      })
      .filter(name => {
        return name.length > 0 && isValidPlayerName(name);
      });

    const newAttendance = [...attendance];
    const newGuestPlayers = [...guestPlayers];

    parsedNames.forEach(name => {
      const foundInSquad = squad.find(p => p.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(p.name.toLowerCase()));
      if (foundInSquad) {
        if (!newAttendance.includes(foundInSquad.id)) {
          newAttendance.push(foundInSquad.id);
        }
      } else {
        const foundInGuests = newGuestPlayers.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (foundInGuests) {
          if (!newAttendance.includes(foundInGuests.id)) {
            newAttendance.push(foundInGuests.id);
          }
        } else {
          // Create new guest
          const guest: SquadPlayer = {
            id: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            name: name
          };
          newGuestPlayers.push(guest);
          newAttendance.push(guest.id);
        }
      }
    });

    // CONSOLDIDATED UPDATE
    onUpdate({
      ...session,
      attendance: Array.from(new Set(newAttendance)),
      guestPlayers: newGuestPlayers,
      updatedAt: Date.now()
    });
    
    setPasteMode(false);
    setPasteValue("");
  };

  const sortedSquad = useMemo(() => {
    // Deduplicate squad if needed (though it should be unique by ID)
    const squadList = Array.from(new Map(squad.map(p => [p.id, p])).values());
    
    if (!sortAttendingFirst) return squadList;

    // Stable sort: present players first, then maintaining original order (role)
    return [...squadList].sort((a, b) => {
      const aPresent = attendance.includes(a.id);
      const bPresent = attendance.includes(b.id);
      
      if (aPresent === bPresent) return 0;
      return aPresent ? -1 : 1;
    });
  }, [squad, attendance, sortAttendingFirst]);

  const sortedPlayers = useMemo(() => {
    return sortedSquad.filter(p => p.role !== 'leader');
  }, [sortedSquad]);

  const sortedLeaders = useMemo(() => {
    const leadersList = sortedSquad.filter(p => p.role === 'leader');
    if (sortAttendingFirst) {
      const presentLeaders = sortLeadersByPosition(leadersList.filter(p => attendance.includes(p.id)));
      const absentLeaders = sortLeadersByPosition(leadersList.filter(p => !attendance.includes(p.id)));
      return [...presentLeaders, ...absentLeaders];
    }
    return sortLeadersByPosition(leadersList);
  }, [sortedSquad, sortAttendingFirst, attendance]);

  const attendingPlayersCount = useMemo(() => {
    return attendance.filter(id => {
      const p = squad.find(x => x.id === id);
      return !p || p.role !== 'leader';
    }).length;
  }, [attendance, squad]);

  const attendingLeadersCount = useMemo(() => {
    return attendance.filter(id => {
      const p = squad.find(x => x.id === id);
      return p && p.role === 'leader';
    }).length;
  }, [attendance, squad]);

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Users size={16} />
              Närvarande ({attendingPlayersCount} spelare{squad.some(p => p.role === 'leader') ? `, ${attendingLeadersCount} ledare` : ''})
            </h3>
            <p className="text-[10px] text-zinc-500 font-medium mt-1">Välj medlemmar från truppen eller lägg till provspelare</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            {adminUrl && (
              <a
                href={adminUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-bold text-xs hover:underline whitespace-nowrap transition-colors"
                title="Öppna Adminsida"
              >
                <ShieldCheck size={14} />
                <span>Öppna adminsida</span>
              </a>
            )}
            {adminUrl && <div className="w-px h-3 bg-zinc-200 dark:bg-zinc-800" />}
            <button
              onClick={() => setPasteMode(true)}
              className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-bold text-xs hover:underline whitespace-nowrap"
            >
              <ClipboardList size={14} />
              Klistra in lista
            </button>
            <div className="w-px h-3 bg-zinc-200 dark:bg-zinc-800" />
            <button
              onClick={() => onUpdate({ ...session, attendance: squad.map(p => p.id), updatedAt: Date.now() })}
              className="text-zinc-400 hover:text-indigo-600 font-bold text-[10px] uppercase whitespace-nowrap"
            >
              Alla närvarande
            </button>
            <div className="w-px h-3 bg-zinc-200 dark:bg-zinc-800" />
            <button
              onClick={() => onUpdate({ ...session, attendance: [], updatedAt: Date.now() })}
              className="text-zinc-400 hover:text-red-500 font-bold text-[10px] uppercase whitespace-nowrap"
            >
              Ingen närvarande
            </button>
            <div className="w-px h-3 bg-zinc-200 dark:bg-zinc-800" />
            <button
              onClick={() => setSortAttendingFirst(!sortAttendingFirst)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold text-[10px] uppercase transition-all ${
                sortAttendingFirst 
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm' 
                  : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-500 border-zinc-100 dark:border-zinc-700 hover:border-zinc-200'
              }`}
              title="Sortera närvarande först"
            >
              <Users size={12} className={sortAttendingFirst ? 'text-white' : 'text-zinc-400'} />
              <span>Närvarande först</span>
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {/* Players List */}
          <div className="space-y-2">
            {sortedLeaders.length > 0 && (
              <h4 className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest pl-1">Spelare</h4>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {sortedPlayers.map(player => {
                const isPresent = attendance.includes(player.id);
                return (
                  <button
                    key={player.id}
                    onClick={() => handleTogglePlayer(player.id)}
                    className={`flex items-center gap-3 p-3 rounded-2xl border transition-all text-left group ${
                      isPresent 
                        ? 'bg-[#16A34A]/25 dark:bg-[#16A34A]/20 border-[#16A34A]/50 dark:border-[#16A34A]/40 shadow-sm' 
                        : 'bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800 hover:border-zinc-200 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                      isPresent ? 'bg-[#16A34A] text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 group-hover:text-zinc-600'
                    }`}>
                      {player.photoUrl ? (
                        <img src={player.photoUrl} alt="" className="w-full h-full object-cover rounded-xl" />
                      ) : (
                        <span className="text-[10px] font-black uppercase">{player.name.substring(0, 1)}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black truncate uppercase text-zinc-900 dark:text-zinc-100">
                        {player.name}
                      </p>
                      {player.number && (
                        <p className="text-[10px] font-bold text-zinc-400">#{player.number}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Leaders List */}
          {sortedLeaders.length > 0 && (
            <div className="space-y-2 pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <h4 className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest pl-1">Ledare</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {sortedLeaders.map(player => {
                  const isPresent = attendance.includes(player.id);
                  return (
                    <button
                      key={player.id}
                      onClick={() => handleTogglePlayer(player.id)}
                      className={`flex items-center gap-3 p-3 rounded-2xl border transition-all text-left group ${
                        isPresent 
                          ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-650 shadow-sm' 
                          : 'bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800 hover:border-zinc-200 dark:hover:border-zinc-700'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                        isPresent ? 'bg-zinc-700 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 group-hover:text-zinc-600'
                      }`}>
                        {player.photoUrl ? (
                          <img src={player.photoUrl} alt="" className="w-full h-full object-cover rounded-xl" />
                        ) : (
                          <span className="text-[10px] font-black uppercase">{player.name.substring(0, 1)}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-black truncate uppercase text-zinc-900 dark:text-zinc-100">
                          {player.name}
                        </p>
                        <p className="text-[9px] font-bold text-indigo-650 dark:text-indigo-400 uppercase tracking-wider">
                          {player.position || 'Ledare'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Guest Players Section */}
      <div className="space-y-4 pt-6 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
            <UserPlus size={14} />
            Provspelare / Tillfälliga
          </h4>
        </div>

        <form onSubmit={handleAddGuest} className="flex flex-col sm:flex-row gap-3 w-full">
          <input
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Namn på provspelare..."
            className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl px-4 py-3 text-base font-bold text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm min-w-0"
          />
          <select
            value={guestPosition}
            onChange={(e) => setGuestPosition(e.target.value)}
            className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm cursor-pointer"
          >
            <option value="">Position (Valfritt)</option>
            <option value="MV">Målvakt (MV)</option>
            <option value="MB">Mittback (MB)</option>
            <option value="YB">Ytterback (YB)</option>
            <option value="MF">Mittfältare (MF)</option>
            <option value="YMF">Yttermittfältare (YMF)</option>
            <option value="FW">Forward (FW)</option>
          </select>
          <button
            type="submit"
            className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest shadow-sm hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all active:scale-95 whitespace-nowrap min-h-[44px]"
          >
            Lägg till
          </button>
        </form>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from(new Map(guestPlayers.map(p => [p.id, p])).values()).map(guest => {
            const isPresent = attendance.includes(guest.id);
            return (
              <div
                key={guest.id}
                className={`flex items-center justify-between gap-2 p-3 rounded-2xl border transition-all group relative ${
                  isPresent 
                    ? 'bg-amber-50/80 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 shadow-sm' 
                    : 'bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => handleTogglePlayer(guest.id)}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                      isPresent ? 'bg-amber-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 group-hover:text-zinc-600'
                    }`}
                  >
                    <span className="text-[10px] font-black uppercase text-white">{guest.name.substring(0, 1)}</span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => handleTogglePlayer(guest.id)}
                      className="text-xs font-black truncate uppercase text-left w-full block hover:underline text-zinc-900 dark:text-zinc-100"
                    >
                      {guest.name}
                    </button>
                    <div className="flex items-center">
                      <select
                        value={guest.position || ""}
                        onChange={(e) => updateGuestPosition(guest.id, e.target.value)}
                        className="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-transparent border-none focus:ring-0 cursor-pointer outline-none uppercase p-0 m-0"
                      >
                        <option value="" className="bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">Provspelare</option>
                        <option value="MV" className="bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">Mv (Målvakt)</option>
                        <option value="MB" className="bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">Mb (Mittback)</option>
                        <option value="YB" className="bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">Yb (Ytterback)</option>
                        <option value="MF" className="bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">Mf (Mittfält)</option>
                        <option value="YMF" className="bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">Ymf (Ytter-mf)</option>
                        <option value="FW" className="bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">Fw (Forward)</option>
                      </select>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeGuest(guest.id)}
                  className="p-1.5 text-zinc-300 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Manual names from past logic that are NOT in current guests or squad */}
      {attendance.some(id => !squad.find(p => p.id === id) && !guestPlayers.find(p => p.id === id)) && (
        <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800">
          <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-4">Manuellt inlagda (historiskt)</h4>
          <div className="flex flex-wrap gap-2">
            {Array.from(new Set(attendance.filter(id => !squad.find(p => p.id === id) && !guestPlayers.find(p => p.id === id)))).map(idOrName => (
              <div key={idOrName} className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700">
                <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase">
                  {idOrName.startsWith('guest_') ? 'Okänd provspelare' : idOrName}
                </span>
                <button 
                  onClick={() => onUpdate({ ...session, attendance: attendance.filter(id => id !== idOrName), updatedAt: Date.now() })}
                  className="text-zinc-400 hover:text-red-500"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Paste Modal */}
      <AnimatePresence>
        {pasteMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4 text-left"
            onClick={() => setPasteMode(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-lg w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <ClipboardList size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Klistra in deltagare</h3>
                  <p className="text-xs text-zinc-500 font-medium">Klistra in namn från t.ex. Svenska Lag, SportAdmin eller liknande</p>
                </div>
              </div>

              <textarea
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
                placeholder="Klistra in lista på namn här (separera med radbyte eller kommatecken)..."
                className="w-full h-48 bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-100 dark:border-zinc-800 rounded-2xl p-4 text-base font-medium outline-none focus:ring-2 focus:ring-indigo-500 resize-none mb-6"
              />

              <div className="flex gap-3">
                <button
                  onClick={() => setPasteMode(false)}
                  className="flex-1 py-4 px-6 rounded-2xl font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors uppercase text-xs"
                >
                  Avbryt
                </button>
                <button
                  onClick={handlePaste}
                  className="flex-[2] py-4 px-6 rounded-2xl font-black bg-indigo-600 text-white shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all uppercase text-xs"
                >
                  Lägg till deltagare
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
