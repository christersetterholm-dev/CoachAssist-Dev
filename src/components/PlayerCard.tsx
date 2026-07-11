import React, { useState, useRef, useLayoutEffect } from 'react';
import { Minus, Plus, Palette, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Team, SquadPlayer, VEST_COLORS, PRESET_COLORS } from '../types';

interface PlayerCardProps {
  team: Team;
  squad: SquadPlayer[];
  rank: number;
  onUpdateScore: (id: string, delta: number) => void;
  onUpdateColor?: (id: string, color: string) => void;
  onRankClick?: () => void;
  disabled?: boolean;
  exerciseId?: string;
  onMovePlayer?: (exerciseId: string, playerId: string, targetTeamId: string) => void;
  draggedPlayerId?: string | null;
  isAnyPlayerDragging?: boolean;
  onDragStart?: (playerId: string) => void;
  onDragEnd?: () => void;
}

export default function PlayerCard({ 
  team, 
  squad, 
  rank, 
  onUpdateScore, 
  onUpdateColor,
  onRankClick, 
  disabled, 
  exerciseId, 
  onMovePlayer,
  draggedPlayerId,
  isAnyPlayerDragging,
  onDragStart,
  onDragEnd
}: PlayerCardProps) {
  const [fontSize, setFontSize] = useState<number>(120);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const teamPlayers = Array.from(
    new Map(
      squad.filter(p => team.playerIds.includes(p.id)).map(p => [p.id, p])
    ).values()
  );
  const isThisPlayerDragging = draggedPlayerId && team.playerIds.includes(draggedPlayerId);

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const calculateFontSize = () => {
      if (!containerRef.current) return;
      const { height, width } = containerRef.current.getBoundingClientRect();
      const scoreStr = team.score.toString();
      const scoreLength = scoreStr.length;
      
      let size = height * 0.85;
      const charWidthRatio = 0.7;
      const maxWidthSize = (width * 0.9) / (scoreLength * charWidthRatio);
      
      setFontSize(Math.min(size, maxWidthSize));
    };

    const observer = new ResizeObserver(() => {
      calculateFontSize();
    });

    observer.observe(containerRef.current);
    calculateFontSize();

    return () => observer.disconnect();
  }, [team.score]);

  const handleDragEnd = (playerId: string, info: any) => {
    onDragEnd?.();
    setIsOver(false);
    if (!exerciseId || !onMovePlayer) return;
    
    // elementsFromPoint is more robust as it finds all layers under the point
    const elements = document.elementsFromPoint(info.point.x, info.point.y);
    // Find the first team element that is NOT the source team
    const teamElement = elements
      .map(el => (el as HTMLElement).closest?.('[data-team-id]'))
      .find(te => te && te.getAttribute('data-team-id') !== team.id);
 
    if (teamElement) {
      const targetTeamId = teamElement.getAttribute('data-team-id');
      if (targetTeamId && targetTeamId !== team.id) {
        onMovePlayer(exerciseId, playerId, targetTeamId);
      }
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ 
        opacity: 1, 
        scale: isOver || isAnyPlayerDragging ? 1.02 : 1,
        boxShadow: isOver ? `0 0 20px ${team.color}40` : '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
        backgroundColor: isAnyPlayerDragging ? `${team.color}EE` : team.color,
        borderColor: isOver ? 'rgba(255,255,255,0.5)' : (isAnyPlayerDragging ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.05)'),
        zIndex: showColorPicker ? 110 : (isThisPlayerDragging ? 100 : (isAnyPlayerDragging ? 10 : 1))
      }}
      data-team-id={team.id}
      onMouseEnter={() => isAnyPlayerDragging && setIsOver(true)}
      onMouseLeave={() => setIsOver(false)}
      className={`relative rounded-2xl flex items-stretch transition-all duration-300 border flex-1 min-h-0 ${disabled ? 'opacity-90' : ''}`}
    >
      {/* Minus Button */}
      {!disabled && (
        <button
          onClick={() => onUpdateScore(team.id, -1)}
          className="w-16 sm:w-24 bg-black/10 text-white flex items-center justify-center hover:bg-black/20 active:bg-black/30 transition-all border-r border-white/10 shrink-0"
        >
          <Minus size={24} strokeWidth={4} className="sm:size-[32px]" />
        </button>
      )}

      {/* Central Column */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-1 sm:p-2 border-b border-white/10 flex flex-col items-center justify-center shrink-0">
          <div className="flex flex-wrap justify-center gap-1 px-2">
            {teamPlayers.length > 0 ? (
              teamPlayers.map(p => (
                <motion.span 
                  key={p.id} 
                  drag={!disabled}
                  dragSnapToOrigin
                  onDragStart={() => onDragStart?.(p.id)}
                  onDragEnd={(e: any, info) => {
                    const point = (e.nativeEvent || e).clientX !== undefined ? (e.nativeEvent || e) : info.point;
                    handleDragEnd(p.id, { point: { x: point.clientX || point.x, y: point.clientY || point.y } });
                  }}
                  whileTap={{ scale: 0.95 }}
                  whileDrag={{ 
                    zIndex: 9999, 
                    scale: 1.1,
                    pointerEvents: 'none'
                  }}
                  className={`text-[8px] sm:text-[10px] font-bold text-white/80 bg-white/10 px-1.5 py-0.5 rounded-full cursor-grab active:cursor-grabbing touch-none z-50 select-none`}
                >
                  {p.name}
                </motion.span>
              ))
            ) : (
              <span className="text-[8px] sm:text-[10px] font-bold text-white/40 italic">Inga spelare</span>
            )}
          </div>
        </div>

        {/* Score Display */}
        <div ref={containerRef} className="flex-1 flex items-center justify-center p-0.5 relative">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onRankClick?.();
            }}
            className="absolute top-1 left-1 sm:top-2 sm:left-2 flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 bg-white/20 hover:bg-white/30 active:bg-white/40 rounded-full border border-white/30 shadow-inner z-10 transition-colors cursor-pointer"
          >
            <span className="text-sm sm:text-lg font-black text-white">{rank}</span>
          </button>

          {!disabled && onUpdateColor && (
            <div className="absolute bottom-1 left-1 sm:bottom-2 sm:left-2 z-[60]">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setShowColorPicker(!showColorPicker);
                }}
                className={`flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full border border-white/30 shadow-inner transition-all cursor-pointer ${showColorPicker ? 'bg-white text-indigo-600 scale-110' : 'bg-white/20 text-white hover:bg-white/30'}`}
              >
                <Palette size={16} className="sm:size-5" />
              </button>

              <AnimatePresence>
                {showColorPicker && (
                   <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    className="absolute bottom-full left-0 mb-2 p-3 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl z-[100] w-[200px] sm:w-[240px]"
                   >
                     <div className="flex items-center justify-between mb-3 px-1">
                       <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Välj färg</span>
                       <button onClick={() => setShowColorPicker(false)} className="text-zinc-400 hover:text-zinc-600">
                         <X size={14} />
                       </button>
                     </div>
                     
                     <div className="space-y-4">
                       {/* Common Vest Colors */}
                       <div className="grid grid-cols-5 gap-2">
                         {VEST_COLORS.map(c => (
                           <button
                             key={c}
                             onClick={(e) => {
                               e.stopPropagation();
                               onUpdateColor(team.id, c);
                               setShowColorPicker(false);
                             }}
                             className={`w-full aspect-square rounded-full border-2 transition-transform hover:scale-110 active:scale-95 ${team.color.toLowerCase() === c.toLowerCase() ? 'border-zinc-900 dark:border-white shadow-lg' : 'border-transparent'}`}
                             style={{ backgroundColor: c }}
                           />
                         ))}
                       </div>

                       {/* More Colors */}
                       <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
                         <div className="grid grid-cols-6 gap-1.5 px-0.5">
                           {PRESET_COLORS.filter(c => !VEST_COLORS.includes(c)).slice(0, 12).map(c => (
                             <button
                               key={c}
                               onClick={(e) => {
                                 e.stopPropagation();
                                 onUpdateColor(team.id, c);
                                 setShowColorPicker(false);
                               }}
                               className={`w-full aspect-square rounded-full border transition-transform hover:scale-110 active:scale-95 ${team.color.toLowerCase() === c.toLowerCase() ? 'border-zinc-900 dark:border-white' : 'border-transparent'}`}
                               style={{ backgroundColor: c }}
                             />
                           ))}
                         </div>
                       </div>
                     </div>
                   </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          
          <span 
            className="font-black text-white tabular-nums drop-shadow-md leading-none select-none transition-all duration-300"
            style={{ fontSize: `${fontSize}px` }}
          >
            {team.score}
          </span>
        </div>
      </div>

      {/* Plus Buttons */}
      {!disabled && (
        <div className="flex shrink-0">
          <div className="w-12 sm:w-16 flex flex-col border-l border-white/10">
            <button
              onClick={() => onUpdateScore(team.id, 2)}
              className="flex-1 bg-white/5 text-white text-sm sm:text-xl font-black hover:bg-white/15 active:bg-white/25 transition-all flex items-center justify-center"
            >
              +2
            </button>
            <button
              onClick={() => onUpdateScore(team.id, 3)}
              className="flex-1 bg-white/5 text-white text-sm sm:text-xl font-black hover:bg-white/15 active:bg-white/25 transition-all border-t border-white/10 flex items-center justify-center"
            >
              +3
            </button>
          </div>

          <button
            onClick={() => onUpdateScore(team.id, 1)}
            className="w-20 sm:w-28 bg-white/20 text-white flex items-center justify-center hover:bg-white/30 active:bg-white/40 transition-all border-l border-white/10"
          >
            <Plus size={32} strokeWidth={4} className="sm:size-[48px]" />
          </button>
        </div>
      )}
    </motion.div>
  );
}
