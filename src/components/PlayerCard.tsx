import { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, Palette, Check } from 'lucide-react';
import { motion } from 'motion/react';
import { Team, SquadPlayer, VEST_COLORS, PRESET_COLORS } from '../types';
import { Sheet } from './ui';

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
  const [scoreAreaHeight, setScoreAreaHeight] = useState<number>(200);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const teamPlayers = Array.from(
    new Map(
      squad.filter(p => team.playerIds.includes(p.id)).map(p => [p.id, p])
    ).values()
  );
  // Korta kort (många lag): placering och färgknapp bredvid varandra, eller dolda om det inte får plats
  const compact = scoreAreaHeight < 92;
  const tooShort = scoreAreaHeight < 42;
  const pickColor = (c: string) => {
    onUpdateColor?.(team.id, c);
    setShowColorPicker(false);
  };
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
      setScoreAreaHeight(height);
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
    // Ingen egen layout-animering: ramen runt kortet (App.tsx) sköter flytten, annars skalades kortet en kort
    // stund vid varje poängändring och knapparna kändes sega.
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ 
        opacity: 1, 
        scale: isOver || isAnyPlayerDragging ? 1.02 : 1,
        boxShadow: isOver ? `0 0 20px ${team.color}40` : '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
        backgroundColor: isAnyPlayerDragging ? `${team.color}EE` : team.color,
        borderColor: isOver ? 'rgba(255,255,255,0.5)' : (isAnyPlayerDragging ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.05)'),
        zIndex: isThisPlayerDragging ? 100 : (isAnyPlayerDragging ? 10 : 1)
      }}
      data-team-id={team.id}
      onMouseEnter={() => isAnyPlayerDragging && setIsOver(true)}
      onMouseLeave={() => setIsOver(false)}
      className={`relative rounded-2xl flex items-stretch transition-all duration-300 border flex-1 min-h-0 ${disabled ? 'opacity-90' : ''}`}
    >
      {/* Minus Button */}
      {!disabled && (
        <button
          type="button"
          aria-label={`Ta bort ett poäng från ${team.name}`}
          onClick={() => onUpdateScore(team.id, -1)}
          className="touch-manipulation select-none w-16 sm:w-24 bg-black/10 text-white flex items-center justify-center hover:bg-black/20 active:bg-black/30 transition-all border-r border-white/10 shrink-0"
        >
          <Minus size={24} strokeWidth={4} className="sm:size-[32px]" />
        </button>
      )}

      {/* Central Column */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-1 sm:p-2 border-b border-white/10 flex flex-col items-center justify-center shrink-0">
          <div className="flex flex-wrap justify-center gap-0.5 sm:gap-1 px-2">
            {teamPlayers.length > 0 ? (
              teamPlayers.map((p, pIdx) => (
                <motion.span 
                  key={`${p.id || 'player'}-${pIdx}`} 
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
                  className={`text-[10px] sm:text-xs leading-tight font-semibold text-white bg-black/15 px-1.5 sm:px-2 py-px sm:py-0.5 rounded-full cursor-grab active:cursor-grabbing touch-none z-50 select-none`}
                >
                  {p.name}
                </motion.span>
              ))
            ) : (
              <span className="text-[10px] sm:text-xs font-semibold text-white/60">Inga spelare</span>
            )}
          </div>
        </div>

        {/* Score Display */}
        <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden flex items-center justify-center p-0.5 relative">
          {!tooShort && (
          <button 
            type="button"
            aria-label={`Placering ${rank}`}
            onClick={(e) => {
              e.stopPropagation();
              onRankClick?.();
            }}
            className="absolute top-1 left-1 sm:top-2 sm:left-2 flex items-center justify-center w-10 h-10 bg-white/20 hover:bg-white/30 active:bg-white/40 rounded-full border border-white/30 shadow-inner z-10 transition-colors cursor-pointer"
          >
            <span className="text-base sm:text-lg font-bold text-white">{rank}</span>
          </button>
          )}

          {!disabled && onUpdateColor && !tooShort && (
            <button
              type="button"
              aria-label={`Byt färg på ${team.name}`}
              title="Byt färg"
              onClick={(e) => {
                e.stopPropagation();
                setShowColorPicker(true);
              }}
              className={`absolute z-10 flex ${compact ? 'top-1 left-12 sm:top-2 sm:left-14' : 'bottom-1 left-1 sm:bottom-2 sm:left-2'} items-center justify-center w-10 h-10 rounded-full bg-white/20 text-white border border-white/30 shadow-inner hover:bg-white/30 active:bg-white/40 transition-colors cursor-pointer`}
            >
              <Palette size={18} />
            </button>
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
              type="button"
              aria-label={`Två poäng till ${team.name}`}
              onClick={() => onUpdateScore(team.id, 2)}
              className="touch-manipulation select-none flex-1 bg-white/5 text-white text-sm sm:text-xl font-black hover:bg-white/15 active:bg-white/25 transition-all flex items-center justify-center"
            >
              +2
            </button>
            <button
              type="button"
              aria-label={`Tre poäng till ${team.name}`}
              onClick={() => onUpdateScore(team.id, 3)}
              className="touch-manipulation select-none flex-1 bg-white/5 text-white text-sm sm:text-xl font-black hover:bg-white/15 active:bg-white/25 transition-all border-t border-white/10 flex items-center justify-center"
            >
              +3
            </button>
          </div>

          <button
            type="button"
            aria-label={`Ett poäng till ${team.name}`}
            onClick={() => onUpdateScore(team.id, 1)}
            className="touch-manipulation select-none w-20 sm:w-28 bg-white/20 text-white flex items-center justify-center hover:bg-white/30 active:bg-white/40 transition-all border-l border-white/10"
          >
            <Plus size={32} strokeWidth={4} className="sm:size-[48px]" />
          </button>
        </div>
      )}

      {/* Portal: kortet har transform, så ett fast placerat ark måste ligga utanför det */}
      {onUpdateColor && createPortal(
        <Sheet open={showColorPicker} onClose={() => setShowColorPicker(false)} title={`Färg för ${team.name}`}>
          <div className="px-2 pb-2 space-y-5">
            <div>
              <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Västfärger</p>
              <div className="grid grid-cols-5 gap-3">
                {VEST_COLORS.map(c => (
                  <ColorSwatch key={c} color={c} selected={team.color.toLowerCase() === c.toLowerCase()} onPick={pickColor} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Fler färger</p>
              <div className="grid grid-cols-6 gap-3">
                {PRESET_COLORS.filter(c => !VEST_COLORS.includes(c)).slice(0, 12).map(c => (
                  <ColorSwatch key={c} color={c} selected={team.color.toLowerCase() === c.toLowerCase()} onPick={pickColor} />
                ))}
              </div>
            </div>
          </div>
        </Sheet>,
        document.body
      )}
    </motion.div>
  );
}

const ColorSwatch = ({ color, selected, onPick }: { color: string; selected: boolean; onPick: (c: string) => void }) => (
  <button
    type="button"
    aria-label={`Välj färg ${color}`}
    aria-pressed={selected}
    onClick={() => onPick(color)}
    className={`w-full aspect-square min-h-[40px] rounded-full flex items-center justify-center transition-transform active:scale-95 cursor-pointer ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 ${selected ? 'ring-2 ring-indigo-600 dark:ring-indigo-400' : 'ring-1 ring-black/10'}`}
    style={{ backgroundColor: color }}
  >
    {selected && <Check size={18} strokeWidth={3} className="text-white drop-shadow" />}
  </button>
);
