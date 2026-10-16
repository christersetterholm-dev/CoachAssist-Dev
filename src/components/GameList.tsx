import React from 'react';
import { Trophy, Clock, Trash2, ChevronRight, Plus, Copy, Edit2, GripVertical, ArrowUpDown, Gamepad2, Dice5, Target, Sword, Shield, Crown, Star, Heart, Zap, Flame, Ghost, Skull, Rocket, Car, Bike, Footprints, Dribbble, Music, Coffee, Check, Link, Users, MoreVertical, Play } from 'lucide-react';
import { Reorder } from 'motion/react';
import { Exercise, TrainingSession } from '../types';
import { Badge, Button, EmptyState, IconButton, MenuItem, SegmentedTabs, Sheet } from './ui';

const ICON_MAP: Record<string, any> = {
  Trophy, Gamepad2, Dice5, Target, Sword, Shield, Crown, Star, Heart, Zap, Flame, Ghost, Skull, Rocket, Car, Bike, Footprints, Dribbble, Music, Coffee
};

type Filter = 'all' | 'standalone' | 'linked';

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
  /** Tränare/admin. Spelare ser bara listan och kan öppna/visa lag. */
  canManage?: boolean;
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
  onShowTeams,
  canManage = true,
}: GameListProps) {
  const [exerciseToDelete, setExerciseToDelete] = React.useState<string | null>(null);
  const [menuExerciseId, setMenuExerciseId] = React.useState<string | null>(null);
  const [isReorderMode, setIsReorderMode] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>('all');

  const isLinked = (ex: Exercise) => !!ex.sessionId || sessions.some(s => s.moments?.some(m => m.exerciseId === ex.id));

  const filteredExercises = exercises.filter(ex => {
    if (filter === 'standalone') return !isLinked(ex);
    if (filter === 'linked') return isLinked(ex);
    return true;
  });

  const standaloneCount = exercises.filter(ex => !isLinked(ex)).length;
  const linkedCount = exercises.length - standaloneCount;

  const menuExercise = menuExerciseId ? exercises.find(e => e.id === menuExerciseId) : undefined;
  const closeMenu = () => setMenuExerciseId(null);
  const runFromMenu = (fn: (id: string) => void) => {
    if (!menuExerciseId) return;
    const id = menuExerciseId;
    closeMenu();
    fn(id);
  };

  // Sortering görs bara i "Alla", annars skulle dolda moment försvinna ur ordningen.
  const canReorder = canManage && filter === 'all' && exercises.length > 1;
  const reordering = isReorderMode && canReorder;

  return (
    <div className="w-full max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 sm:pt-2 pb-32">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <SegmentedTabs<Filter>
          size="sm"
          className="sm:w-auto"
          value={filter}
          onChange={(f) => { setFilter(f); setIsReorderMode(false); }}
          tabs={[
            { id: 'all', label: 'Alla', count: exercises.length },
            { id: 'standalone', label: 'Fristående', count: standaloneCount },
            { id: 'linked', label: 'Kopplade', count: linkedCount },
          ]}
        />

        {canManage && (
          <div className="flex items-center gap-2 min-w-0">
            {canReorder && (
              <Button
                variant={reordering ? 'primary' : 'secondary'}
                icon={reordering ? <Check size={18} /> : <ArrowUpDown size={18} />}
                onClick={() => setIsReorderMode(!reordering)}
                aria-label={reordering ? 'Klar' : 'Ändra ordning'}
                className={reordering ? 'flex-1 sm:flex-none' : ''}
              >
                {reordering ? 'Klar' : <span className="hidden sm:inline">Ändra ordning</span>}
              </Button>
            )}
            {!reordering && (
              <Button icon={<Plus size={18} />} onClick={onNewExercise} className="flex-1 sm:flex-none">
                Nytt tävlingsmoment
              </Button>
            )}
          </div>
        )}
      </div>

      {reordering && (
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">Dra i handtaget för att flytta ett moment. Tryck på Klar när du är nöjd.</p>
      )}

      {filteredExercises.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
          <EmptyState
            icon={<Trophy size={26} />}
            title={filter === 'all' ? 'Inga tävlingsmoment än' : 'Inga tävlingsmoment här'}
            text={filter === 'all'
              ? (canManage ? 'Skapa ditt första tävlingsmoment för att börja samla poäng.' : 'Tränaren har inte skapat några tävlingsmoment än.')
              : 'Inga tävlingsmoment matchar filtret.'}
            action={filter === 'all' && canManage ? (
              <Button icon={<Plus size={18} />} onClick={onNewExercise}>Skapa tävlingsmoment</Button>
            ) : undefined}
          />
        </div>
      ) : (
        <Reorder.Group
          axis="y"
          values={filteredExercises}
          onReorder={onReorderExercises}
          className="flex flex-col gap-2.5"
        >
          {filteredExercises.map((exercise) => {
            const sortedTeams = [...exercise.teams].sort((a, b) => b.score - a.score);
            const leader = sortedTeams[0];
            const hasScores = exercise.teams.some(t => t.score !== 0);
            const date = new Date(exercise.date || exercise.updatedAt).toLocaleDateString('sv-SE', {
              month: 'short',
              day: 'numeric',
            });
            const ExerciseIcon = ICON_MAP[exercise.icon] || Trophy;
            const linked = isLinked(exercise);

            return (
              <Reorder.Item
                key={exercise.id}
                value={exercise}
                dragListener={reordering}
                className={`group bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex items-center gap-3 pl-3 pr-1.5 py-3 min-h-[72px] w-full transition-colors ${
                  reordering ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700'
                }`}
                onClick={() => !reordering && onSelectExercise(exercise.id)}
              >
                {reordering && (
                  <span className="text-zinc-400 shrink-0 -ml-1" aria-hidden>
                    <GripVertical size={20} />
                  </span>
                )}

                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0"
                  style={{ backgroundColor: leader?.color || '#6366f1' }}
                >
                  <ExerciseIcon size={22} fill="currentColor" />
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-[15px] sm:text-base text-zinc-900 dark:text-white leading-snug line-clamp-2 break-words">
                    {exercise.name}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} />
                      {date}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{exercise.teams.length} lag</span>
                    {hasScores && leader && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate max-w-[10rem]">
                          {exercise.isFinished ? 'Vann' : 'Leder'}: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{leader.name}</span> ({leader.score})
                        </span>
                      </>
                    )}
                  </div>
                  {(exercise.isFinished || linked) && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {exercise.isFinished && <Badge tone="success" icon={<Check size={12} strokeWidth={3} />}>Avslutad</Badge>}
                      {linked && <Badge tone="brand" icon={<Link size={12} />}>Kopplad till pass</Badge>}
                    </div>
                  )}
                </div>

                {!reordering && (
                  canManage || onShowTeams ? (
                    <IconButton
                      label="Fler val"
                      onClick={(e) => { e.stopPropagation(); setMenuExerciseId(exercise.id); }}
                    >
                      <MoreVertical size={20} />
                    </IconButton>
                  ) : (
                    <ChevronRight size={20} className="text-zinc-300 dark:text-zinc-600 shrink-0 mr-2" />
                  )
                )}
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
      )}

      {/* Meny per tävlingsmoment */}
      <Sheet open={!!menuExercise} onClose={closeMenu} title={menuExercise?.name}>
        <div className="flex flex-col gap-0.5">
          <MenuItem icon={<Play size={18} />} label="Öppna poängräkningen" onClick={() => runFromMenu(onSelectExercise)} />
          {onShowTeams && (
            <MenuItem icon={<Users size={18} />} label="Visa lag" onClick={() => runFromMenu(onShowTeams)} />
          )}
          {canManage && (
            <>
              <MenuItem icon={<Edit2 size={18} />} label="Redigera" description="Lag, poäng och inställningar" onClick={() => runFromMenu(onEditExercise)} />
              <MenuItem icon={<Copy size={18} />} label="Kopiera" description="Skapa ett nytt moment med samma lag" onClick={() => runFromMenu(onCopyExercise)} />
              <MenuItem icon={<Trash2 size={18} />} label="Radera" tone="danger" onClick={() => runFromMenu(setExerciseToDelete)} />
            </>
          )}
        </div>
      </Sheet>

      {/* Bekräfta radering */}
      <Sheet
        open={!!exerciseToDelete}
        onClose={() => setExerciseToDelete(null)}
        title="Radera tävlingsmoment?"
        footer={
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Button variant="secondary" onClick={() => setExerciseToDelete(null)}>Avbryt</Button>
            <Button
              variant="danger"
              icon={<Trash2 size={18} />}
              onClick={() => {
                if (exerciseToDelete) onDeleteExercise(exerciseToDelete);
                setExerciseToDelete(null);
              }}
            >
              Ja, radera
            </Button>
          </div>
        }
      >
        <p className="px-2 pb-2 text-sm text-zinc-600 dark:text-zinc-300">
          "{exercises.find(e => e.id === exerciseToDelete)?.name}" tas bort. Det går inte att ångra.
        </p>
      </Sheet>
    </div>
  );
}
