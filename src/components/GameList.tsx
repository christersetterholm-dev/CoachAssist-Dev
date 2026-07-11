import React from 'react';
import { Trophy, Clock, Trash2, ChevronRight, Plus, Copy, Edit2, GripVertical, ArrowUpDown, Gamepad2, Dice5, Target, Sword, Shield, Crown, Star, Heart, Zap, Flame, Ghost, Skull, Rocket, Car, Bike, Footprints, Dribbble, Music, Coffee, Check, Link, Layout, Users } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { Exercise, TrainingSession } from '../types';

const ICON_MAP: Record<string, any> = {
  Trophy, Gamepad2, Dice5, Target, Sword, Shield, Crown, Star, Heart, Zap, Flame, Ghost, Skull, Rocket, Car, Bike, Footprints, Dribbble, Music, Coffee
};

interface GameListProps {
  exercises: Exercise[];
  sessions?: TrainingSession[];
  onSelectExercise: (id: string) => void;
  onDeleteExercise: (id: string) => void;
  onCopyExercise: (id: string) => void;
  onEditExercise: (id: string) => void;
  onReorderExercises: (exercises: Exercise[]) => void;
  onNewExercise: () => void;
  onShowTeams?: (id: string) => void;
  key?: React.Key;
}

export default function GameList({ 
  exercises, 
  sessions = [], 
  onSelectExercise, 
  onDeleteExercise, 
  onCopyExercise, 
  onEditExercise, 
  onReorderExercises, 
  onNewExercise,
  onShowTeams
}: GameListProps) {
  const [exerciseToDelete, setExerciseToDelete] = React.useState<string | null>(null);
  const [isReorderMode, setIsReorderMode] = React.useState(false);
  const [filter, setFilter] = React.useState<'all' | 'standalone' | 'linked'>('all');

  const handleDeleteConfirm = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setExerciseToDelete(id);
  };

  const confirmDelete = () => {
    if (exerciseToDelete) {
      onDeleteExercise(exerciseToDelete);
      setExerciseToDelete(null);
    }
  };

  const filteredExercises = exercises.filter(ex => {
    if (filter === 'all') return true;
    const isLinked = ex.sessionId || sessions.some(s => s.moments.some(m => m.exerciseId === ex.id));
    if (filter === 'standalone') return !isLinked;
    if (filter === 'linked') return isLinked;
    return true;
  });

  const standaloneCount = exercises.filter(ex => !(ex.sessionId || sessions.some(s => s.moments.some(m => m.exerciseId === ex.id)))).length;
  const linkedCount = exercises.length - standaloneCount;

  return (
    <div className="w-full max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto sm:p-6 pb-32">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 px-4 sm:px-0 pt-1 sm:pt-0">
        <div className="flex p-0.5 sm:p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl w-full sm:w-auto">
          <button
            onClick={() => setFilter('all')}
            className={`flex-1 sm:flex-none px-2 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-black sm:font-bold uppercase sm:capitalize tracking-tight sm:tracking-normal transition-all ${
              filter === 'all'
                ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            Alla ({exercises.length})
          </button>
          <button
            onClick={() => setFilter('standalone')}
            className={`flex-1 sm:flex-none px-2 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-black sm:font-bold uppercase sm:capitalize tracking-tight sm:tracking-normal transition-all ${
              filter === 'standalone'
                ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            Fristående ({standaloneCount})
          </button>
          <button
            onClick={() => setFilter('linked')}
            className={`flex-1 sm:flex-none px-2 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-black sm:font-bold uppercase sm:capitalize tracking-tight sm:tracking-normal transition-all ${
              filter === 'linked'
                ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            Kopplade ({linkedCount})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {exercises.length > 1 && (
            <button
              onClick={() => setIsReorderMode(!isReorderMode)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl font-bold transition-all text-sm border ${
                isReorderMode 
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-600 dark:bg-indigo-950/30 dark:border-indigo-800' 
                  : 'bg-white border-zinc-200 text-zinc-600 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-400'
              }`}
              title={isReorderMode ? 'Avsluta sortering' : 'Sortera tävlingsmoment'}
            >
              <ArrowUpDown size={18} />
              <span className="hidden xs:inline">{isReorderMode ? 'Klar' : 'Sortera'}</span>
            </button>
          )}
          <button
            onClick={onNewExercise}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 dark:shadow-none text-sm"
          >
            <Plus size={18} />
            Nytt tävlingsmoment
          </button>
        </div>
      </div>

      {filteredExercises.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 sm:p-12 text-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 mx-4 sm:mx-0">
          <div className="w-12 h-12 sm:w-16 sm:h-16 bg-zinc-50 dark:bg-zinc-950 rounded-2xl flex items-center justify-center mx-auto mb-4 text-zinc-400">
            <Layout size={24} className="sm:size-8" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-zinc-800 dark:text-zinc-200 mb-2">Inga tävlingsmoment hittades</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 sm:mb-8">
            {filter === 'all' ? 'Skapa ditt första tävlingsmoment för att börja samla poäng!' : 'Inga tävlingsmoment matchar ditt filter.'}
          </p>
          {filter === 'all' && (
            <button
              onClick={onNewExercise}
              className="bg-indigo-600 text-white px-6 py-2.5 sm:px-8 sm:py-3 rounded-2xl font-bold hover:bg-indigo-700 transition-all text-sm sm:text-base"
            >
              Skapa tävlingsmoment
            </button>
          )}
        </div>
      ) : (
        <Reorder.Group 
          axis="y" 
          values={filteredExercises} 
          onReorder={onReorderExercises}
          className="flex flex-col gap-2 sm:gap-4"
        >
          {filteredExercises.map((exercise) => {
            const leader = [...exercise.teams].sort((a, b) => b.score - a.score)[0];
            const date = new Date(exercise.date || exercise.updatedAt).toLocaleDateString('sv-SE', {
              month: 'short',
              day: 'numeric',
            });
            const ExerciseIcon = ICON_MAP[exercise.icon] || Trophy;
            const isLinked = exercise.sessionId || sessions.some(s => s.moments.some(m => m.exerciseId === exercise.id));

            return (
              <Reorder.Item
                key={exercise.id}
                value={exercise}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                dragListener={isReorderMode}
                className={`group bg-white dark:bg-zinc-900 py-3 px-4 sm:rounded-2xl border-b sm:border border-zinc-100 dark:border-zinc-800 shadow-sm hover:shadow-md transition-all flex items-center gap-3 sm:gap-4 w-full z-0 ${
                  isReorderMode ? 'cursor-grab active:cursor-grabbing active:scale-[0.98] active:shadow-lg' : 'cursor-pointer'
                }`}
                onClick={() => !isReorderMode && onSelectExercise(exercise.id)}
              >
                <AnimatePresence>
                  {isReorderMode && (
                    <motion.div 
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      className="text-zinc-300 dark:text-zinc-700 p-1 -ml-2 hover:text-zinc-400 transition-colors shrink-0 overflow-hidden"
                    >
                      <GripVertical size={20} />
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="relative shrink-0">
                  <div 
                    className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center text-white shadow-inner"
                    style={{ backgroundColor: leader?.color || '#6366f1' }}
                  >
                    <ExerciseIcon size={24} className="sm:size-7" fill="currentColor" />
                  </div>
                  {isLinked && (
                    <div className="absolute -top-1.5 -right-1.5 bg-indigo-600 text-white p-1 rounded-lg shadow-sm border-2 border-white dark:border-zinc-900" title="Kopplad till träningspass">
                      <Link size={10} strokeWidth={3} />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-black text-base sm:text-xl text-zinc-900 dark:text-white truncate leading-tight">
                      {exercise.name}
                    </h3>
                    {isLinked && (
                      <span className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[8px] font-black uppercase tracking-tighter rounded border border-indigo-100 dark:border-indigo-800">
                        Kopplad
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[10px] sm:text-xs text-zinc-400 dark:text-zinc-500 font-medium">
                      <span className="flex items-center gap-1">
                        <Clock size={10} className="sm:size-3" />
                        {date}
                      </span>
                      <span>•</span>
                      <span>{exercise.teams.length} lag</span>
                      {exercise.isFinished && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-bold">
                            <Check size={10} strokeWidth={3} className="sm:size-3" />
                            Avslutad
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {onShowTeams && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onShowTeams(exercise.id);
                          }}
                          className="p-2 text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-xl transition-all"
                          title="Visa lag"
                        >
                          <Users size={18} className="sm:size-5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditExercise(exercise.id);
                        }}
                        className="p-2 text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-xl transition-all"
                        title="Redigera"
                      >
                        <Edit2 size={18} className="sm:size-5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCopyExercise(exercise.id);
                        }}
                        className="p-2 text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-xl transition-all"
                        title="Kopiera"
                      >
                        <Copy size={18} className="sm:size-5" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteConfirm(e, exercise.id)}
                        className="p-2 text-zinc-200 dark:text-zinc-700 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-all"
                        title="Radera"
                      >
                        <Trash2 size={18} className="sm:size-5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="text-zinc-300 dark:text-zinc-700 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors shrink-0">
                  <ChevronRight size={20} className="sm:size-6" />
                </div>
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
      )}

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {exerciseToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setExerciseToDelete(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">Radera tävlingsmoment?</h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-8">
                Är du säker på att du vill radera "{exercises.find(e => e.id === exerciseToDelete)?.name}"? Detta kan inte ångras.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={confirmDelete}
                  className="w-full py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
                >
                  Ja, radera
                </button>
                <button
                  onClick={() => setExerciseToDelete(null)}
                  className="w-full py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Avbryt
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
