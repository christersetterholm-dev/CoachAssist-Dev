import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  X, Plus, Trash2, Copy, Move, Pencil, ArrowUpRight, Route, Type, 
  Shirt, Eraser, Undo2, Redo2, RotateCcw, RotateCw, Layout, Check, 
  Edit2, Network, Eye, EyeOff, Minus, GripVertical
} from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { SquadPlayer, TacticalSavedBoard, LineupPlayer } from '../types';
import ColorPicker from './ColorPicker';
import { CachedImage } from './CachedImage';

interface TacticalBoardModalProps {
  boards: TacticalSavedBoard[];
  onSave: (boards: TacticalSavedBoard[]) => void;
  onClose: () => void;
  squad?: SquadPlayer[];
  title?: string;
}

interface BoardElement extends LineupPlayer {
  customName?: string;
  customNumber?: string;
  customColor?: string;
  itemType?: 'player' | 'opponent' | 'cone-orange' | 'cone-yellow' | 'cone-blue' | 'goal' | 'ladder';
  hideNumber?: boolean;
}

// SoccerBallIcon defined exactly like LineupBuilder
const SoccerBallIcon = ({ size = 20, className = "" }: { size?: number | string, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 100 100" 
    xmlns="http://www.w3.org/2000/svg" 
    className={className}
  >
    <circle cx="50" cy="50" r="48" fill="white" stroke="currentColor" strokeWidth="2" />
    <path d="M50 35L62 43L58 57L42 57L38 43Z" fill="currentColor" />
    <path d="M50 5L60 13L57 25L43 25L40 13Z" fill="currentColor" transform="rotate(0, 50, 50)" />
    <path d="M50 5L60 13L57 25L43 25L40 13Z" fill="currentColor" transform="rotate(72, 50, 50)" />
    <path d="M50 5L60 13L57 25L43 25L40 13Z" fill="currentColor" transform="rotate(144, 50, 50)" />
    <path d="M50 5L60 13L57 25L43 25L40 13Z" fill="currentColor" transform="rotate(216, 50, 50)" />
    <path d="M50 5L60 13L57 25L43 25L40 13Z" fill="currentColor" transform="rotate(288, 50, 50)" />
    <line x1="50" y1="35" x2="50" y2="25" stroke="currentColor" strokeWidth="1.5" />
    <line x1="62" y1="43" x2="72" y2="38" stroke="currentColor" strokeWidth="1.5" />
    <line x1="58" y1="57" x2="68" y2="68" stroke="currentColor" strokeWidth="1.5" />
    <line x1="42" y1="57" x2="32" y2="68" stroke="currentColor" strokeWidth="1.5" />
    <line x1="38" y1="43" x2="28" y2="38" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const ConeIcon = ({ color, size = 20 }: { color: string, size?: number | string }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 10 L80 80 L90 85 L10 85 L20 80 Z" fill={color} stroke="white" strokeWidth="2" strokeLinejoin="round" />
    <ellipse cx="50" cy="80" rx="30" ry="6" fill="black" fillOpacity="0.15" />
    <path d="M43 35 H57 L63 55 H37 Z" fill="white" fillOpacity="0.3" />
  </svg>
);

const GoalIcon = ({ size = 24 }: { size?: number | string }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 80 V20 H90 V80" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 20 L25 40 H75 L90 20" stroke="currentColor" strokeWidth="2" strokeDasharray="3,3" />
    <path d="M25 40 V80 H75 V40 Z" stroke="currentColor" strokeWidth="2" strokeDasharray="3,3" />
    <path d="M10 80 H90" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const LadderIcon = ({ size = 24 }: { size?: number | string }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="35" y="10" width="30" height="80" stroke="currentColor" strokeWidth="3" rx="2" />
    <line x1="35" y1="25" x2="65" y2="25" stroke="currentColor" strokeWidth="3" />
    <line x1="35" y1="40" x2="65" y2="40" stroke="currentColor" strokeWidth="3" />
    <line x1="35" y1="55" x2="65" y2="55" stroke="currentColor" strokeWidth="3" />
    <line x1="35" y1="70" x2="65" y2="70" stroke="currentColor" strokeWidth="3" />
  </svg>
);

export default function TacticalBoardModal({ 
  boards: initialBoards = [], 
  onSave, 
  onClose, 
  squad = [],
  title = "Övningens Rittavla"
}: TacticalBoardModalProps) {
  
  // Local list of boards, initialized to ensure we have at least one board
  const [localBoards, setLocalBoards] = useState<TacticalSavedBoard[]>(() => {
    if (initialBoards.length > 0) return JSON.parse(JSON.stringify(initialBoards));
    return [{
      id: Math.random().toString(36).substr(2, 9),
      name: "Skiss 1",
      createdAt: Date.now(),
      drawings: [],
      opponents: [],
      players: [],
      footballPos: null,
      footballScale: 1,
      elementScale: 1.0,
      showOpponents: true,
      opponentColor: '#ef4444',
      pitchType: 'classic',
      pitchSize: 'full',
      orientation: 'landscape',
      attackDirection: 'up'
    } as any];
  });

  const [activeBoardId, setActiveBoardId] = useState<string>(localBoards[0]?.id || "");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isToolboxVisible, setIsToolboxVisible] = useState(true);

  // Active board data
  const activeBoard = useMemo(() => {
    return localBoards.find(b => b.id === activeBoardId) || localBoards[0];
  }, [localBoards, activeBoardId]);

  // Active board state states, synced from the activeBoard
  const [tacticalDrawings, setTacticalDrawings] = useState<any[]>(activeBoard?.drawings || []);
  const [opponents, setOpponents] = useState<{ id: string, x: number, y: number }[]>(activeBoard?.opponents || []);
  const [boardElements, setBoardElements] = useState<BoardElement[]>(activeBoard?.players as BoardElement[] || []);
  const [footballs, setFootballs] = useState<{ id: string, x: number, y: number }[]>(() => {
    if (activeBoard?.footballs) return activeBoard.footballs;
    return activeBoard?.footballPos ? [{ id: 'default-ball', x: activeBoard.footballPos.x, y: activeBoard.footballPos.y }] : [];
  });
  const [footballScale, setFootballScale] = useState<number>(activeBoard?.footballScale || 1.1);
  const [elementScale, setElementScale] = useState<number>(activeBoard?.elementScale || 1.0);
  const [showOpponents, setShowOpponents] = useState<boolean>(activeBoard?.showOpponents !== false);
  const [opponentColor, setOpponentColor] = useState<string>(activeBoard?.opponentColor || '#ef4444');
  const [pitchType, setPitchType] = useState<string>(activeBoard?.pitchType || 'classic');
  const [pitchSize, setPitchSize] = useState<'full' | 'half'>(activeBoard?.pitchSize || 'full');
  const [orientation, setOrientation] = useState<'vertical' | 'landscape'>(activeBoard?.orientation || 'landscape');
  const [attackDirection, setAttackDirection] = useState<'up' | 'down' | 'left' | 'right'>(activeBoard?.attackDirection || 'up');

  // Drawing Tools State
  const [tacticalTool, setTacticalTool] = useState<'pen' | 'arrow' | 'freehand-arrow' | 'eraser' | 'ball' | 'opponent' | 'move' | 'text' | 'circle' | 'rectangle' | 'square' | 'add-element'>('move');
  const [tacticalColor, setTacticalColor] = useState<string>('#ffffff');
  const [tacticalLineWidth, setTacticalLineWidth] = useState<number>(0.8);
  const [tacticalLineType, setTacticalLineType] = useState<'solid' | 'dashed'>('solid');
  const [tacticalFontSize, setTacticalFontSize] = useState<number>(12);
  const [showDelaunayNetwork, setShowDelaunayNetwork] = useState(false);

  const constrainSquare = (p0: { x: number, y: number }, p1: { x: number, y: number }) => {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const sgnX = dx >= 0 ? 1 : -1;
    const sgnY = dy >= 0 ? 1 : -1;
    const side = Math.max(Math.abs(dx), Math.abs(dy) * pitchAspectRatio);
    return {
      x: p0.x + sgnX * side,
      y: p0.y + sgnY * (side / pitchAspectRatio)
    };
  };

  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const [isSubmenuVisible, setIsSubmenuVisible] = useState(true);

  const handleToolSelect = (tool: 'pen' | 'arrow' | 'freehand-arrow' | 'eraser' | 'ball' | 'opponent' | 'move' | 'text' | 'circle' | 'rectangle' | 'square' | 'add-element') => {
    if (tacticalTool === tool) {
      setIsSubmenuVisible(prev => !prev);
    } else {
      setTacticalTool(tool);
      setIsSubmenuVisible(true);
    }
  };

  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [currentPath, setCurrentPath] = useState<{ x: number, y: number }[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingBallId, setDraggingBallId] = useState<string | null>(null);
  const [draggingOpponentId, setDraggingOpponentId] = useState<string | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [isTransforming, setIsTransforming] = useState<'move' | 'resize' | null>(null);
  const [transformStart, setTransformStart] = useState<{ x: number, y: number, initialPoints: any[] } | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isRotatingId, setIsRotatingId] = useState<string | null>(null);

  // Undo/Redo History
  const [history, setHistory] = useState<any[]>([]);
  const [future, setFuture] = useState<any[]>([]);

  const fieldRef = useRef<HTMLDivElement>(null);

  // Ratios for pitch layout
  const isHalfPitch = pitchSize === 'half';
  const pitchRatioW = 68;
  const pitchRatioH = isHalfPitch ? 52.5 : 105;
  const R = pitchRatioH / pitchRatioW; 
  const invR = pitchRatioW / pitchRatioH; 
  const pitchAspectRatio = pitchRatioW / pitchRatioH;
  const markerSuffix = "tactical-board";

  const performErase = (x: number, y: number) => {
    // Erase drawing
    setTacticalDrawings(prev => {
      const filtered = prev.filter(d => {
        if (d.type === 'text') {
          return Math.hypot(d.points[0].x - x, d.points[0].y - y) > 7.5;
        }
        if (d.type === 'circle') {
          const rx = Math.hypot(d.points[0].x - d.points[1].x, d.points[0].y - d.points[1].y);
          const ry = rx * pitchAspectRatio;
          const dx = x - d.points[0].x;
          const dy = y - d.points[0].y;
          const dist = Math.sqrt(Math.pow(dx / rx, 2) + Math.pow(dy / ry, 2));
          const nearBoundary = Math.abs(dist - 1) <= 0.35;
          const nearCenter = Math.hypot(dx, dy) < 7.5;
          return !(nearBoundary || nearCenter);
        }
        if (d.type === 'rectangle' || d.type === 'square') {
          const xMin = Math.min(d.points[0].x, d.points[1].x);
          const xMax = Math.max(d.points[0].x, d.points[1].x);
          const yMin = Math.min(d.points[0].y, d.points[1].y);
          const yMax = Math.max(d.points[0].y, d.points[1].y);
          const inside = x >= xMin - 4 && x <= xMax + 4 && y >= yMin - 4 && y <= yMax + 4;
          return !inside;
        }
        return !d.points.some((p: any) => Math.hypot(p.x - x, p.y - y) < 6);
      });
      
      const remainingIds = new Set(filtered.map(d => d.id));
      if (selectedDrawingId && !remainingIds.has(selectedDrawingId)) {
        setSelectedDrawingId(null);
      }
      return filtered;
    });

    // Erase opponent
    setOpponents(prev => prev.filter(o => Math.hypot(o.x - x, o.y - y) > 7.5));

    // Erase generic elements/players
    setBoardElements(prev => {
      const filtered = prev.filter(el => Math.hypot(el.x - x, el.y - y) > 7.5);
      const remainingIds = new Set(filtered.map(el => el.id));
      if (selectedElementId && !remainingIds.has(selectedElementId)) {
        setSelectedElementId(null);
      }
      return filtered;
    });

    // Erase ball
    setFootballs(prev => prev.filter(fb => Math.hypot(fb.x - x, fb.y - y) > 7.5));
  };

  // Sync active board values when activeBoardId changes
  useEffect(() => {
    if (!activeBoard) return;
    setTacticalDrawings(activeBoard.drawings || []);
    setOpponents(activeBoard.opponents || []);
    setBoardElements(activeBoard.players as BoardElement[] || []);
    setFootballs(activeBoard.footballs || (activeBoard.footballPos ? [{ id: 'default-ball', x: activeBoard.footballPos.x, y: activeBoard.footballPos.y }] : []));
    setFootballScale(activeBoard.footballScale || 1.1);
    setElementScale(activeBoard.elementScale || 1.0);
    setShowOpponents(activeBoard.showOpponents !== false);
    setOpponentColor(activeBoard.opponentColor || '#ef4444');
    setPitchType(activeBoard.pitchType || 'classic');
    setPitchSize(activeBoard.pitchSize || 'full');
    setOrientation(activeBoard.orientation || 'landscape');
    setAttackDirection(activeBoard.attackDirection || 'up');
    
    // Clear selections and tool states when swapping boards
    setSelectedDrawingId(null);
    setEditingTextId(null);
    setHistory([]);
    setFuture([]);
  }, [activeBoardId]);

  // Save current whiteboard state to the master list
  const updateActiveBoardInList = useCallback(() => {
    setLocalBoards(prev => prev.map(b => b.id === activeBoardId ? {
      ...b,
      drawings: JSON.parse(JSON.stringify(tacticalDrawings)),
      opponents,
      players: boardElements,
      footballPos: footballs[0] ? { x: footballs[0].x, y: footballs[0].y } : null,
      footballs,
      footballScale,
      elementScale,
      showOpponents,
      opponentColor,
      pitchType,
      pitchSize,
      orientation,
      attackDirection
    } as any : b));
  }, [activeBoardId, tacticalDrawings, opponents, boardElements, footballs, footballScale, elementScale, showOpponents, opponentColor, pitchType, pitchSize, orientation, attackDirection]);

  // Push to history for Undo/Redo
  const pushHistory = useCallback(() => {
    const currentStateSnapshot = {
      drawings: JSON.parse(JSON.stringify(tacticalDrawings)),
      opponents: [...opponents],
      players: JSON.parse(JSON.stringify(boardElements)),
      footballs: JSON.parse(JSON.stringify(footballs)),
    };
    setHistory(prev => [...prev, currentStateSnapshot]);
    setFuture([]); // Clear redo
  }, [tacticalDrawings, opponents, boardElements, footballs]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target?.tagName === 'INPUT' || 
        target?.tagName === 'TEXTAREA' || 
        target?.isContentEditable
      ) {
        return;
      }
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElementId) {
          pushHistory();
          setBoardElements(prev => prev.filter(item => item.id !== selectedElementId));
          setSelectedElementId(null);
        } else if (selectedDrawingId) {
          pushHistory();
          setTacticalDrawings(prev => prev.filter(item => item.id !== selectedDrawingId));
          setSelectedDrawingId(null);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElementId, selectedDrawingId, pushHistory]);

  // Perform Undo
  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));

    // Save current as future for redo
    const currentSnapshot = {
      drawings: JSON.parse(JSON.stringify(tacticalDrawings)),
      opponents: [...opponents],
      players: JSON.parse(JSON.stringify(boardElements)),
      footballs: JSON.parse(JSON.stringify(footballs)),
    };
    setFuture(prev => [currentSnapshot, ...prev]);

    // Restore state
    setTacticalDrawings(previous.drawings);
    setOpponents(previous.opponents);
    setBoardElements(previous.players);
    setFootballs(previous.footballs || []);
  };

  // Perform Redo
  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(prev => prev.slice(1));

    // Save current as history for undo
    const currentSnapshot = {
      drawings: JSON.parse(JSON.stringify(tacticalDrawings)),
      opponents: [...opponents],
      players: JSON.parse(JSON.stringify(boardElements)),
      footballs: JSON.parse(JSON.stringify(footballs)),
    };
    setHistory(prev => [...prev, currentSnapshot]);

    // Restore state
    setTacticalDrawings(next.drawings);
    setOpponents(next.opponents);
    setBoardElements(next.players);
    setFootballs(next.footballs || []);
  };

  // Auto-sync active state changes back to board list
  useEffect(() => {
    updateActiveBoardInList();
  }, [tacticalDrawings, opponents, boardElements, footballs, footballScale, elementScale, showOpponents, opponentColor, pitchType, orientation, attackDirection]);

  // Coordinate transformations
  const transformCoords = (clientX: number, clientY: number) => {
    if (!fieldRef.current) return { x: 50, y: 50 };
    const rect = fieldRef.current.getBoundingClientRect();
    let x = ((clientX - rect.left) / rect.width) * 100;
    let y = ((clientY - rect.top) / rect.height) * 100;

    // Apply rotation transforms if horizontal pitch
    if (orientation === 'landscape') {
      const vx = x;
      const vy = y;
      if (attackDirection === 'right') {
        x = vy;
        y = 100 - vx;
      } else { // left
        x = 100 - vy;
        y = vx;
      }
    } else if (attackDirection === 'down') {
      x = 100 - x;
      y = 100 - y;
    }

    // Clamp coordinates to pitch bounds
    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));

    return { x, y };
  };

  const getPitchRotation = () => {
    if (orientation === 'landscape') {
      return attackDirection === 'right' ? 'rotate(90deg)' : 'rotate(-90deg)';
    }
    return attackDirection === 'down' ? 'rotate(180deg)' : 'rotate(0deg)';
  };

  const getCounterRotation = () => {
    if (orientation === 'landscape') {
      return attackDirection === 'right' ? '-90deg' : '90deg';
    }
    return attackDirection === 'down' ? '180deg' : '0deg';
  };

  // Pointer Down handler
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!fieldRef.current) return;
    const { x, y } = transformCoords(e.clientX, e.clientY);

    // Ball placement
    if (tacticalTool === 'ball') {
      pushHistory();
      const newBall = { id: Math.random().toString(36).substr(2, 9), x, y };
      setFootballs(prev => [...prev, newBall]);
      setDraggingBallId(newBall.id);
      return;
    }

    // Opponent placement
    if (tacticalTool === 'opponent') {
      pushHistory();
      const newOpponent = { id: Math.random().toString(36).substr(2, 9), x, y };
      setOpponents(prev => [...prev, newOpponent]);
      return;
    }

    // Add Element tool (nothing to do on field click, actions are triggered from Row 2 buttons)
    if (tacticalTool === 'add-element') {
      return;
    }

    // Move tool
    if (tacticalTool === 'move') {
      // Check if clicking resize handle on selected circle, rectangle, or square
      if (selectedDrawingId) {
        const draw = tacticalDrawings.find(d => d.id === selectedDrawingId);
        if (draw && (draw.type === 'circle' || draw.type === 'rectangle' || draw.type === 'square')) {
          const dist = Math.hypot(draw.points[1].x - x, draw.points[1].y - y);
          if (dist < 6) {
            setIsTransforming('resize');
            setTransformStart({ x, y, initialPoints: [...draw.points] });
            return;
          }
        }
      }

      // Check if clicking existing drawings
      const clickedDrawing = tacticalDrawings.slice().reverse().find(d => {
        if (d.type === 'text') {
          return Math.hypot(d.points[0].x - x, d.points[0].y - y) < 8;
        }
        if (d.type === 'circle') {
          const radiusSVG = Math.sqrt(Math.pow(d.points[0].x - d.points[1].x, 2) + Math.pow((d.points[0].y - d.points[1].y) / pitchAspectRatio, 2));
          const dx = x - d.points[0].x;
          const dy = (y - d.points[0].y) / pitchAspectRatio;
          const distToCenter = Math.sqrt(dx*dx + dy*dy);
          return distToCenter < radiusSVG * 1.1;
        }
        if (d.type === 'rectangle' || d.type === 'square') {
          const xMin = Math.min(d.points[0].x, d.points[1].x);
          const xMax = Math.max(d.points[0].x, d.points[1].x);
          const yMin = Math.min(d.points[0].y, d.points[1].y);
          const yMax = Math.max(d.points[0].y, d.points[1].y);
          return x >= xMin - 2 && x <= xMax + 2 && y >= yMin - 2 && y <= yMax + 2;
        }
        return d.points.some((p: any) => Math.hypot(p.x - x, p.y - y) < 5);
      });

      if (clickedDrawing) {
        pushHistory();
        setSelectedDrawingId(clickedDrawing.id);
        setSelectedElementId(null);
        setIsTransforming('move');
        setTransformStart({ x, y, initialPoints: JSON.parse(JSON.stringify(clickedDrawing.points)) });
      } else {
        setSelectedDrawingId(null);
        setSelectedElementId(null);
      }
      return;
    }

    // Eraser Tool
    if (tacticalTool === 'eraser') {
      pushHistory();
      setIsErasing(true);
      performErase(x, y);
      return;
    }

    // Text Tool
    if (tacticalTool === 'text') {
      // Check if clicking near/on an existing text element to edit it directly
      const clickedText = tacticalDrawings.slice().reverse().find(d => {
        return d.type === 'text' && Math.hypot(d.points[0].x - x, d.points[0].y - y) < 8;
      });
      if (clickedText) {
        setEditingTextId(clickedText.id);
        return;
      }

      pushHistory();
      const id = Math.random().toString(36).substr(2, 9);
      const newText = {
        id,
        type: 'text',
        points: [{ x, y }],
        text: '',
        color: tacticalColor,
        fontSize: tacticalFontSize
      };
      setTacticalDrawings(prev => [...prev, newText]);
      setEditingTextId(id);
      return;
    }

    // Freehand Pen / Line / Arrow Drawing
    setIsDrawing(true);
    setCurrentPath([{ x, y }]);
  };

  // Pointer Move handler
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!fieldRef.current) return;
    const { x, y } = transformCoords(e.clientX, e.clientY);

    // Eraser Tool Drag-erase
    if (tacticalTool === 'eraser' && isErasing) {
      performErase(x, y);
      return;
    }

    // Rotating element
    if (isRotatingId) {
      const el = boardElements.find(item => item.id === isRotatingId);
      if (el) {
        const dx = x - el.x;
        const dy = y - el.y;
        const angleRad = Math.atan2(dy, dx);
        let angleDeg = angleRad * (180 / Math.PI) + 90;
        angleDeg = Math.round(angleDeg);
        if (angleDeg > 180) angleDeg -= 360;
        if (angleDeg < -180) angleDeg += 360;
        setBoardElements(prev => prev.map(item => item.id === isRotatingId ? { ...item, rotation: angleDeg } : item));
      }
      return;
    }

    // Draggable ball
    if (draggingBallId) {
      setFootballs(prev => prev.map(fb => fb.id === draggingBallId ? { ...fb, x, y } : fb));
      return;
    }

    // Draggable opponent
    if (draggingOpponentId) {
      setOpponents(prev => prev.map(o => o.id === draggingOpponentId ? { ...o, x, y } : o));
      return;
    }

    // Draggable element (player, cone)
    if (draggingId) {
      setBoardElements(prev => prev.map(el => el.id === draggingId ? { ...el, x, y } : el));
      return;
    }

    // Move / Resize drawing transforms
    if (isTransforming && selectedDrawingId && transformStart) {
      const dx = x - transformStart.x;
      const dy = y - transformStart.y;

      setTacticalDrawings(prev => prev.map(d => {
        if (d.id !== selectedDrawingId) return d;

        if (isTransforming === 'move') {
          const newPoints = transformStart.initialPoints.map((p: any) => ({
            x: p.x + dx,
            y: p.y + dy
          }));
          return { ...d, points: newPoints };
        } else if (isTransforming === 'resize' && d.type === 'circle') {
          return { ...d, points: [d.points[0], { x, y }] };
        } else if (isTransforming === 'resize' && d.type === 'rectangle') {
          return { ...d, points: [d.points[0], { x, y }] };
        } else if (isTransforming === 'resize' && d.type === 'square') {
          const constrained = constrainSquare(d.points[0], { x, y });
          return { ...d, points: [d.points[0], constrained] };
        }
        return d;
      }));
      return;
    }

    if (!isDrawing) return;

    if (tacticalTool === 'pen' || tacticalTool === 'freehand-arrow') {
      setCurrentPath(prev => {
        if (prev.length === 0) return [{ x, y }];
        const last = prev[prev.length - 1];
        const dist = Math.hypot(x - last.x, y - last.y);
        if (dist < 1.2) return prev; // Filter out tiny jitters to stabilize the drawing and arrowheads
        return [...prev, { x, y }];
      });
    } else if (tacticalTool === 'arrow' || tacticalTool === 'circle' || tacticalTool === 'rectangle' || tacticalTool === 'square') {
      if (tacticalTool === 'square') {
        const constrained = constrainSquare(currentPath[0], { x, y });
        setCurrentPath([currentPath[0], constrained]);
      } else {
        setCurrentPath([currentPath[0], { x, y }]);
      }
    }
  };

  // Pointer Up handler
  const handlePointerUp = () => {
    if (isDrawing) {
      if (currentPath.length > 1 || (['circle', 'rectangle', 'square'].includes(tacticalTool) && currentPath.length > 1)) {
        pushHistory();
        const newId = Math.random().toString(36).substr(2, 9);
        setTacticalDrawings(prev => [...prev, {
          id: newId,
          type: tacticalTool,
          points: currentPath,
          color: tacticalColor,
          lineType: tacticalLineType,
          lineWidth: tacticalLineWidth
        }]);
        setSelectedDrawingId(newId);
      }
      setIsDrawing(false);
      setCurrentPath([]);
    }
    setIsTransforming(null);
    setTransformStart(null);
    setDraggingBallId(null);
    setDraggingOpponentId(null);
    setDraggingId(null);
    setIsRotatingId(null);
    setIsErasing(false);
  };

  // Quick action: Clear whiteboard
  const clearBoard = () => {
    pushHistory();
    setTacticalDrawings([]);
    setFootballs([]);
    setOpponents([]);
    setBoardElements([]);
  };

  // Preset tactical board list operations
  const addNewBoard = () => {
    const newBoardObj: TacticalSavedBoard = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Skiss ${localBoards.length + 1}`,
      createdAt: Date.now(),
      drawings: [],
      opponents: [],
      players: [],
      footballPos: null,
      footballScale: 1.1,
      elementScale: 1.0,
      showOpponents: true,
      opponentColor: '#ef4444',
      pitchType: 'classic',
      pitchSize: 'full',
      orientation: 'landscape',
      attackDirection: 'up'
    } as any;

    setLocalBoards(prev => [...prev, newBoardObj]);
    setActiveBoardId(newBoardObj.id);
  };

  const duplicateBoard = (board: TacticalSavedBoard) => {
    const duplicated: TacticalSavedBoard = {
      ...JSON.parse(JSON.stringify(board)),
      id: Math.random().toString(36).substr(2, 9),
      name: `${board.name} (Kopia)`,
      createdAt: Date.now()
    };
    setLocalBoards(prev => [...prev, duplicated]);
    setActiveBoardId(duplicated.id);
  };

  const deleteBoard = (boardId: string) => {
    if (localBoards.length <= 1) {
      alert("Du måste ha minst en rittavla kvar.");
      return;
    }
    const filtered = localBoards.filter(b => b.id !== boardId);
    setLocalBoards(filtered);
    if (activeBoardId === boardId) {
      setActiveBoardId(filtered[0].id);
    }
  };

  const handleStartRename = (id: string, currentName: string) => {
    setRenamingBoardId(id);
    setRenameValue(currentName);
  };

  const handleSaveRename = (id: string) => {
    if (renameValue.trim()) {
      setLocalBoards(prev => prev.map(b => b.id === id ? { ...b, name: renameValue.trim() } : b));
    }
    setRenamingBoardId(null);
  };

  // Add items directly to pitch center for simplified interaction on smaller devices
  const addElementToPitch = (type: 'squad' | 'generic-home' | 'generic-away' | 'cone-orange' | 'cone-yellow' | 'cone-blue' | 'goal' | 'ladder', param?: any) => {
    pushHistory();
    const id = Math.random().toString(36).substr(2, 9);
    let newElem: BoardElement = {
      id,
      playerId: '',
      x: 45 + Math.random() * 10,
      y: 45 + Math.random() * 10,
      isSubstitute: false,
    };

    if (type === 'squad' && param) {
      const sp = param as SquadPlayer;
      // Avoid duplicate squad players on board
      if (boardElements.some(el => el.playerId === sp.id)) return;
      newElem.playerId = sp.id;
      newElem.customName = sp.name;
      newElem.customNumber = sp.number || '';
      newElem.itemType = 'player';
    } else if (type === 'generic-home') {
      newElem.playerId = `home-${id}`;
      newElem.customName = `H${boardElements.filter(el => el.playerId.startsWith('home')).length + 1}`;
      newElem.customNumber = String(boardElements.filter(el => el.playerId.startsWith('home')).length + 1);
      newElem.customColor = '#3b82f6';
      newElem.itemType = 'player';
    } else if (type === 'generic-away') {
      newElem.playerId = `away-${id}`;
      newElem.customName = `B${boardElements.filter(el => el.playerId.startsWith('away')).length + 1}`;
      newElem.customNumber = String(boardElements.filter(el => el.playerId.startsWith('away')).length + 1);
      newElem.customColor = '#f59e0b';
      newElem.itemType = 'opponent';
    } else if (type === 'cone-orange') {
      newElem.playerId = `cone-orange-${id}`;
      newElem.customName = 'Kon';
      newElem.itemType = 'cone-orange';
    } else if (type === 'cone-yellow') {
      newElem.playerId = `cone-yellow-${id}`;
      newElem.customName = 'Kon';
      newElem.itemType = 'cone-yellow';
    } else if (type === 'cone-blue') {
      newElem.playerId = `cone-blue-${id}`;
      newElem.customName = 'Kon';
      newElem.itemType = 'cone-blue';
    } else if (type === 'goal') {
      newElem.playerId = `goal-${id}`;
      newElem.customName = 'Mål';
      newElem.itemType = 'goal';
    } else if (type === 'ladder') {
      newElem.playerId = `ladder-${id}`;
      newElem.customName = 'Stege';
      newElem.itemType = 'ladder';
    }

    setBoardElements(prev => [...prev, newElem]);
  };

  // Helper to resolve squad player data
  const getSquadPlayer = (id: string) => squad.find(sp => sp.id === id);

  // Delaunay triangulation calculation
  const calculatedDelaunayEdges = useMemo(() => {
    if (!showDelaunayNetwork) return [];
    
    // Aggregate all player nodes (both squad & generic home) on the pitch
    const playerNodes = boardElements
      .filter(el => el.itemType === 'player')
      .map(el => ({ x: el.x, y: el.y, id: el.id }));

    if (playerNodes.length < 2) return [];
    if (playerNodes.length === 2) return [{ p1: 0, p2: 1 }];

    // Simple triangulation edges list based on nearest-neighbor constraints
    const edges: { p1: number; p2: number }[] = [];
    const edgeKeys = new Set<string>();

    for (let i = 0; i < playerNodes.length; i++) {
      // Find 3 closest neighbors for each player to draw connections
      const distances = playerNodes.map((p, idx) => ({
        idx,
        dist: Math.hypot(p.x - playerNodes[i].x, p.y - playerNodes[i].y)
      }))
      .filter(item => item.idx !== i)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3);

      for (const neighbor of distances) {
        const u = Math.min(i, neighbor.idx);
        const v = Math.max(i, neighbor.idx);
        const key = `${u}-${v}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push({ p1: u, p2: v });
        }
      }
    }

    return edges.map(edge => ({
      p1: playerNodes[edge.p1],
      p2: playerNodes[edge.p2]
    }));
  }, [boardElements, showDelaunayNetwork]);
  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col text-zinc-100 overflow-hidden font-sans">
      
      {/* Top Bar Header */}
      <div className="h-16 border-b border-zinc-800 bg-zinc-900 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-750 hover:border-zinc-700 text-zinc-400 hover:text-white rounded-xl transition-all flex items-center justify-center mr-1"
            title={isSidebarOpen ? "Dölj sidopanel" : "Visa sidopanel"}
          >
            <Layout size={18} className={isSidebarOpen ? "text-indigo-400" : ""} />
          </button>
          <button
            onClick={() => setIsToolboxVisible(!isToolboxVisible)}
            className="p-2 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-750 hover:border-zinc-700 text-zinc-400 hover:text-white rounded-xl transition-all flex items-center justify-center mr-1"
            title={isToolboxVisible ? "Dölj ritverktyg" : "Visa ritverktyg"}
          >
            {isToolboxVisible ? <EyeOff size={18} className="text-indigo-400" /> : <Eye size={18} />}
          </button>
          <div>
            <h1 className="text-sm font-black uppercase tracking-tight leading-none text-zinc-100">{title}</h1>
          </div>
        </div>

        {/* Quick status message */}
        <div className="hidden md:flex items-center gap-2 text-[10px] font-bold uppercase text-zinc-500 bg-zinc-950 px-3 py-1.5 rounded-full border border-zinc-800/60">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span>Autosparar skisser</span>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => {
              // Trigger main save
              onSave(localBoards);
              onClose();
            }}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-600/10 active:scale-[0.98] transition-all"
            title="Spara ändringar"
          >
            <Check size={14} className="stroke-[3px]" />
            <span>Klar</span>
          </button>
          
          <button 
            onClick={onClose}
            className="p-2.5 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-150 rounded-xl transition-all"
            title="Stäng utan att spara"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Main Workspace Frame */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">

        {/* Left Control Sidebar */}
        <div className={`${isSidebarOpen ? 'w-80 border-r border-zinc-800' : 'w-0 pointer-events-none border-r-0'} bg-zinc-900/40 backdrop-blur-md flex flex-col shrink-0 transition-all duration-300 overflow-hidden z-[120] absolute inset-y-0 left-0 md:relative h-full`}>
          
          {/* Sidebar Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 p-4 shrink-0 bg-zinc-900/80">
            <span className="text-xs font-black uppercase tracking-wider text-white">Rittavlor ({localBoards.length})</span>
            
            {/* Quick close sidebar button inside sidebar itself */}
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg md:hidden"
              title="Dölj panel"
            >
              <X size={16} />
            </button>
          </div>

          {/* List of Boards */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <button
              onClick={addNewBoard}
              className="w-full py-3 px-4 border border-dashed border-indigo-500/30 hover:border-indigo-500/60 bg-indigo-950/10 hover:bg-indigo-950/25 rounded-2xl flex items-center justify-center gap-2 text-indigo-400 text-xs font-black uppercase tracking-widest transition-all"
            >
              <Plus size={14} className="stroke-[3px]" />
              Skapa rittavla
            </button>

            <div className="space-y-2">
              {localBoards.map((board) => {
                const isActive = board.id === activeBoardId;
                const isRenaming = renamingBoardId === board.id;

                return (
                  <div
                    key={board.id}
                    onClick={() => !isRenaming && setActiveBoardId(board.id)}
                    className={`group p-3 rounded-2xl border transition-all cursor-pointer flex flex-col relative ${
                      isActive 
                        ? 'bg-zinc-800/90 border-indigo-500/40 ring-1 ring-indigo-500/20' 
                        : 'bg-zinc-900/30 hover:bg-zinc-800/40 border-zinc-800/45 hover:border-zinc-800'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full min-h-[36px]">
                      {isRenaming ? (
                        <div className="flex items-center gap-1.5 flex-1 mr-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(board.id);
                              if (e.key === 'Escape') setRenamingBoardId(null);
                            }}
                            className="bg-zinc-950 border border-zinc-750 rounded-xl px-2.5 py-1.5 text-xs font-bold text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none flex-1 min-w-0"
                            autoFocus
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSaveRename(board.id);
                            }}
                            className="p-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-white flex items-center justify-center shrink-0 transition-colors"
                            title="Spara"
                          >
                            <Check size={13} className="stroke-[3px]" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingBoardId(null);
                            }}
                            className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center shrink-0 transition-colors"
                            title="Avbryt"
                          >
                            <X size={13} className="stroke-[3px]" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs font-black text-zinc-200 truncate pr-2 uppercase tracking-wide flex-1">
                          {board.name}
                        </span>
                      )}

                      {/* Actions menu / indicators */}
                      {!isRenaming && (
                        <div className={`flex items-center gap-0.5 transition-all shrink-0 ${
                          isActive 
                            ? 'opacity-100' 
                            : 'opacity-80 md:opacity-0 md:group-hover:opacity-100'
                        }`}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartRename(board.id, board.name);
                            }}
                            className="p-1.5 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors"
                            title="Byt namn"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateBoard(board);
                            }}
                            className="p-1.5 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors"
                            title="Duplicera"
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteBoard(board.id);
                            }}
                            className="p-1.5 hover:bg-red-950/40 rounded-lg text-zinc-400 hover:text-red-400 transition-colors"
                            title="Radera"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Small metadata details on the board card */}
                    <span className="text-[9px] text-zinc-500 font-bold uppercase mt-1">
                      {board.drawings?.length || 0} figurer • {board.players?.length || 0} element
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Canvas Area */}
        <div ref={canvasAreaRef} className="flex-1 flex flex-col min-w-0 bg-zinc-950 items-center justify-center p-4 overflow-hidden relative">
          
          {/* The Pitch Container */}
          <div 
            className="w-full h-full flex items-center justify-center overflow-hidden relative select-none"
            style={{ containerType: 'size' }}
          >
            
            {/* Aspect Ratio Responsive Field wrapper */}
            <div
              ref={fieldRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className={`relative border border-white/10 dark:border-white/15 overflow-hidden transition-all duration-300 shadow-2xl touch-none select-none ${
                tacticalTool === 'move' ? 'cursor-default' : 'cursor-crosshair'
              } ${
                pitchType === 'solid-white' ? 'bg-white border-zinc-300' :
                pitchType === 'solid-black' ? 'bg-zinc-950 border-zinc-800' :
                pitchType === 'blue' || pitchType === 'solid-blue' || pitchType === 'blue-stripes' || pitchType === 'blue-grass' ? 'bg-sky-600' : 'bg-[#67a030]'
              }`}
              style={{
                width: orientation === 'landscape' ? `min(calc(100cqw - 16px), calc((100cqh - 16px) * ${R.toFixed(4)}))` : `min(calc(100cqw - 16px), calc((100cqh - 16px) * ${invR.toFixed(4)}))`,
                height: orientation === 'landscape' ? `min(calc((100cqw - 16px) / ${R.toFixed(4)}), calc(100cqh - 16px))` : `min(calc((100cqw - 16px) / ${invR.toFixed(4)}), calc(100cqh - 16px))`,
                aspectRatio: orientation === 'landscape' ? `${pitchRatioH}/${pitchRatioW}` : `${pitchRatioW}/${pitchRatioH}`,
                containerType: 'size'
              }}
            >
              
              {/* Rotating main layer holding drawings, players and ball */}
              <div
                className="absolute inset-0 origin-center pointer-events-none"
                style={{
                  width: orientation === 'landscape' ? `${(invR * 100).toFixed(6)}%` : '100%',
                  height: orientation === 'landscape' ? `${(R * 100).toFixed(6)}%` : '100%',
                  left: orientation === 'landscape' ? `${(((1 - invR) / 2) * 100).toFixed(6)}%` : '0',
                  top: orientation === 'landscape' ? `${(((1 - R) / 2) * 100).toFixed(6)}%` : '0',
                  transform: getPitchRotation(),
                  backgroundImage: (pitchType === 'classic' || pitchType === 'blue-stripes' || pitchType === 'blue') ? (
                    `repeating-linear-gradient(
                      ${attackDirection === 'up' || attackDirection === 'down' ? 'to right' : 'to bottom'},
                      ${(pitchType === 'classic') ? '#8dc343' : '#7dd3fc'},
                      ${(pitchType === 'classic') ? '#8dc343' : '#7dd3fc'} 10%,
                      ${(pitchType === 'classic') ? '#7db436' : '#38bdf8'} 10%,
                      ${(pitchType === 'classic') ? '#7db436' : '#38bdf8'} 20%
                    )${(pitchType === 'blue' || pitchType === 'blue-grass') ? ', radial-gradient(circle at 2px 2px, rgba(255,255,255,0.05) 1px, transparent 0)' : ''}`
                  ) : (pitchType === 'grass' || pitchType === 'blue-grass') ? (
                    `radial-gradient(circle at 2px 2px, rgba(255,255,255,0.1) 1px, transparent 0)`
                  ) : 'none',
                  backgroundSize: (pitchType === 'grass' || pitchType === 'blue' || pitchType === 'blue-grass') ? '20px 20px' : 'auto'
                }}
              >
                
                {/* SVG Markings Overlay for Football Pitch (Inside rotating layer to preserve proportions) */}
                <svg 
                  className={`absolute inset-0 pointer-events-none ${pitchType === 'solid-white' ? 'text-zinc-300' : 'text-white/40'}`} 
                  viewBox={isHalfPitch ? "0 0 68 52.5" : "0 0 68 105"} 
                  preserveAspectRatio="none"
                  style={{
                    width: '100%',
                    height: '100%'
                  }}
                >
                  {isHalfPitch ? (
                    <>
                      {/* Half pitch markings */}
                      <rect x="2" y="2" width="64" height="50.5" fill="none" stroke="currentColor" strokeWidth="0.4" />
                      {/* Penalty Area top */}
                      <rect x="15" y="2" width="38" height="15" fill="none" stroke="currentColor" strokeWidth="0.4" />
                      <rect x="25" y="2" width="18" height="5.5" fill="none" stroke="currentColor" strokeWidth="0.4" />
                      <circle cx="34" cy="13" r="0.5" fill="currentColor" />
                      <path d="M25.8 17 A 9.15 9.15 0 0 0 42.2 17" fill="none" stroke="currentColor" strokeWidth="0.4" />
                      {/* Halfway circle arc (at the bottom of the half pitch, which is the halfway line) */}
                      <path d="M24.85 52.5 A 9.15 9.15 0 0 1 43.15 52.5" fill="none" stroke="currentColor" strokeWidth="0.4" />
                      <circle cx="34" cy="52.5" r="0.5" fill="currentColor" />
                    </>
                  ) : (
                    <>
                      {/* Full pitch markings */}
                      <rect x="2" y="2" width="64" height="101" fill="none" stroke="currentColor" strokeWidth="0.4" />
                      <line x1="2" y1="52.5" x2="66" y2="52.5" stroke="currentColor" strokeWidth="0.4" />
                      <circle cx="34" cy="52.5" r="9.15" fill="none" stroke="currentColor" strokeWidth="0.4" />
                      <circle cx="34" cy="52.5" r="0.5" fill="currentColor" />

                      {/* Goals and penalty areas top & bottom */}
                      <rect x="15" y="2" width="38" height="15" fill="none" stroke="currentColor" strokeWidth="0.4" />
                      <rect x="25" y="2" width="18" height="5.5" fill="none" stroke="currentColor" strokeWidth="0.4" />
                      <circle cx="34" cy="13" r="0.5" fill="currentColor" />
                      <path d="M25.8 17 A 9.15 9.15 0 0 0 42.2 17" fill="none" stroke="currentColor" strokeWidth="0.4" />

                      <rect x="15" y="88" width="38" height="15" fill="none" stroke="currentColor" strokeWidth="0.4" />
                      <rect x="25" y="97.5" width="18" height="5.5" fill="none" stroke="currentColor" strokeWidth="0.4" />
                      <circle cx="34" cy="92" r="0.5" fill="currentColor" />
                      <path d="M25.8 88 A 9.15 9.15 0 0 1 42.2 88" fill="none" stroke="currentColor" strokeWidth="0.4" />
                    </>
                  )}
                </svg>
                
                {/* SVG Tactical Drawings Canvas */}
                <svg
                  className="absolute inset-0 z-20 pointer-events-none"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{ width: '100%', height: '100%' }}
                >
                  <defs>
                    <marker id={`arrowhead-white-${markerSuffix}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="white" /></marker>
                    <marker id={`arrowhead-red-${markerSuffix}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#ef4444" /></marker>
                    <marker id={`arrowhead-yellow-${markerSuffix}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#facc15" /></marker>
                    <marker id={`arrowhead-blue-${markerSuffix}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#3b82f6" /></marker>
                  </defs>

                  {/* Saved drawings */}
                  {tacticalDrawings.map((draw) => (
                    <g key={draw.id}>
                      {draw.type === 'circle' ? (
                        <ellipse
                          cx={draw.points[0].x}
                          cy={draw.points[0].y}
                          rx={Math.sqrt(Math.pow(draw.points[0].x - draw.points[1].x, 2) + Math.pow((draw.points[0].y - draw.points[1].y) / pitchAspectRatio, 2))}
                          ry={Math.sqrt(Math.pow(draw.points[0].x - draw.points[1].x, 2) + Math.pow((draw.points[0].y - draw.points[1].y) / pitchAspectRatio, 2)) * pitchAspectRatio}
                          fill="none"
                          stroke={draw.color}
                          strokeWidth={(draw.lineWidth || 0.8) * 4}
                          strokeDasharray={draw.lineType === 'dashed' ? "6, 4" : "none"}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : (draw.type === 'rectangle' || draw.type === 'square') ? (
                        <rect
                          x={Math.min(draw.points[0].x, draw.points[1].x)}
                          y={Math.min(draw.points[0].y, draw.points[1].y)}
                          width={Math.abs(draw.points[0].x - draw.points[1].x)}
                          height={Math.abs(draw.points[0].y - draw.points[1].y)}
                          fill="none"
                          stroke={draw.color}
                          strokeWidth={(draw.lineWidth || 0.8) * 4}
                          strokeDasharray={draw.lineType === 'dashed' ? "6, 4" : "none"}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : draw.type === 'text' ? (
                        <text
                          x={draw.points[0].x}
                          y={draw.points[0].y}
                          fill={draw.color}
                          fontSize={(draw.fontSize || 12) / 3.5}
                          fontWeight="900"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          style={{ transform: `rotate(${getCounterRotation()})`, transformOrigin: 'center', transformBox: 'fill-box' }}
                          onDoubleClick={() => setEditingTextId(draw.id)}
                          className="cursor-pointer select-none"
                        >
                          {draw.text}
                        </text>
                      ) : draw.type === 'pen' || draw.type === 'freehand-arrow' ? (
                        <path
                          d={`M ${draw.points[0].x} ${draw.points[0].y} ${draw.points.slice(1).map((p: any) => `L ${p.x} ${p.y}`).join(' ')}`}
                          fill="none"
                          stroke={draw.color}
                          strokeWidth={(draw.lineWidth || 0.8) * 4}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeDasharray={draw.lineType === 'dashed' ? "6, 4" : "none"}
                          markerEnd={draw.type === 'freehand-arrow' ? `url(#arrowhead-${draw.color === '#ffffff' ? 'white' : draw.color === '#ef4444' ? 'red' : draw.color === '#3b82f6' ? 'blue' : 'yellow'}-${markerSuffix})` : undefined}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : draw.type === 'arrow' ? (
                        <line
                          x1={draw.points[0].x}
                          y1={draw.points[0].y}
                          x2={draw.points[1].x}
                          y2={draw.points[1].y}
                          stroke={draw.color}
                          strokeWidth={(draw.lineWidth || 0.8) * 4}
                          strokeLinecap="round"
                          strokeDasharray={draw.lineType === 'dashed' ? "6, 4" : "none"}
                          markerEnd={`url(#arrowhead-${draw.color === '#ffffff' ? 'white' : draw.color === '#ef4444' ? 'red' : draw.color === '#3b82f6' ? 'blue' : 'yellow'}-${markerSuffix})`}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : draw.type === 'line' ? (
                        <line
                          x1={draw.points[0].x}
                          y1={draw.points[0].y}
                          x2={draw.points[1].x}
                          y2={draw.points[1].y}
                          stroke={draw.color}
                          strokeWidth={(draw.lineWidth || 0.8) * 4}
                          strokeLinecap="round"
                          strokeDasharray={draw.lineType === 'dashed' ? "6, 4" : "none"}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}

                      {/* Active / Select outline indicator */}
                      {selectedDrawingId === draw.id && tacticalTool === 'move' && (
                        <g className="pointer-events-auto cursor-pointer">
                          {draw.type === 'circle' ? (
                            <>
                              <ellipse
                                cx={draw.points[0].x}
                                cy={draw.points[0].y}
                                rx={Math.sqrt(Math.pow(draw.points[0].x - draw.points[1].x, 2) + Math.pow((draw.points[0].y - draw.points[1].y) / pitchAspectRatio, 2)) + 0.5}
                                ry={(Math.sqrt(Math.pow(draw.points[0].x - draw.points[1].x, 2) + Math.pow((draw.points[0].y - draw.points[1].y) / pitchAspectRatio, 2)) + 0.5) * pitchAspectRatio}
                                fill="none"
                                stroke="#6366f1"
                                strokeWidth="1.5"
                                strokeDasharray="4, 3"
                                vectorEffect="non-scaling-stroke"
                              />
                              {/* Resize handle handle node */}
                              <circle 
                                cx={draw.points[1].x} 
                                cy={draw.points[1].y} 
                                r="1.5" 
                                fill="#6366f1" 
                                stroke="white" 
                                strokeWidth="0.3" 
                                className="cursor-se-resize"
                              />
                            </>
                          ) : (draw.type === 'rectangle' || draw.type === 'square') ? (
                            <>
                              <rect
                                x={Math.min(draw.points[0].x, draw.points[1].x) - 0.5}
                                y={Math.min(draw.points[0].y, draw.points[1].y) - 0.5}
                                width={Math.abs(draw.points[0].x - draw.points[1].x) + 1}
                                height={Math.abs(draw.points[0].y - draw.points[1].y) + 1}
                                fill="none"
                                stroke="#6366f1"
                                strokeWidth="1.5"
                                strokeDasharray="4, 3"
                                vectorEffect="non-scaling-stroke"
                              />
                              {/* Resize handle handle node */}
                              <circle 
                                cx={draw.points[1].x} 
                                cy={draw.points[1].y} 
                                r="1.5" 
                                fill="#6366f1" 
                                stroke="white" 
                                strokeWidth="0.3" 
                                className="cursor-se-resize"
                              />
                            </>
                          ) : draw.type === 'text' ? (
                            <rect
                              x={draw.points[0].x - 6}
                              y={draw.points[0].y - 3}
                              width="12"
                              height="6"
                              fill="none"
                              stroke="#6366f1"
                              strokeWidth="1.5"
                              strokeDasharray="4, 3"
                              vectorEffect="non-scaling-stroke"
                            />
                          ) : (
                            <path
                              d={`M ${draw.points[0].x} ${draw.points[0].y} ${draw.points.slice(1).map((p: any) => `L ${p.x} ${p.y}`).join(' ')}`}
                              fill="none"
                              stroke="#6366f1"
                              strokeWidth="1.5"
                              strokeDasharray="4, 3"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                        </g>
                      )}
                    </g>
                  ))}

                  {/* Preview path currently drawing */}
                  {isDrawing && currentPath.length > 0 && (
                    <g>
                      {tacticalTool === 'circle' && currentPath.length > 1 ? (
                        <ellipse
                          cx={currentPath[0].x}
                          cy={currentPath[0].y}
                          rx={Math.sqrt(Math.pow(currentPath[0].x - currentPath[1].x, 2) + Math.pow((currentPath[0].y - currentPath[1].y) / pitchAspectRatio, 2))}
                          ry={Math.sqrt(Math.pow(currentPath[0].x - currentPath[1].x, 2) + Math.pow((currentPath[0].y - currentPath[1].y) / pitchAspectRatio, 2)) * pitchAspectRatio}
                          fill="none"
                          stroke={tacticalColor}
                          strokeWidth={tacticalLineWidth * 4}
                          strokeDasharray={tacticalLineType === 'dashed' ? "6, 4" : "none"}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : (tacticalTool === 'rectangle' || tacticalTool === 'square') && currentPath.length > 1 ? (
                        <rect
                          x={Math.min(currentPath[0].x, currentPath[1].x)}
                          y={Math.min(currentPath[0].y, currentPath[1].y)}
                          width={Math.abs(currentPath[0].x - currentPath[1].x)}
                          height={Math.abs(currentPath[0].y - currentPath[1].y)}
                          fill="none"
                          stroke={tacticalColor}
                          strokeWidth={tacticalLineWidth * 4}
                          strokeDasharray={tacticalLineType === 'dashed' ? "6, 4" : "none"}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : tacticalTool === 'pen' || tacticalTool === 'freehand-arrow' ? (
                        <path
                          d={`M ${currentPath[0].x} ${currentPath[0].y} ${currentPath.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')}`}
                          fill="none"
                          stroke={tacticalColor}
                          strokeWidth={tacticalLineWidth * 4}
                          strokeDasharray={tacticalLineType === 'dashed' ? "6, 4" : "none"}
                          markerEnd={tacticalTool === 'freehand-arrow' ? `url(#arrowhead-${tacticalColor === '#ffffff' ? 'white' : tacticalColor === '#ef4444' ? 'red' : 'yellow'}-${markerSuffix})` : undefined}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : tacticalTool === 'arrow' && currentPath.length > 1 ? (
                        <line
                          x1={currentPath[0].x}
                          y1={currentPath[0].y}
                          x2={currentPath[1].x}
                          y2={currentPath[1].y}
                          stroke={tacticalColor}
                          strokeWidth={tacticalLineWidth * 4}
                          strokeDasharray={tacticalLineType === 'dashed' ? "6, 4" : "none"}
                          markerEnd={`url(#arrowhead-${tacticalColor === '#ffffff' ? 'white' : tacticalColor === '#ef4444' ? 'red' : 'yellow'}-${markerSuffix})`}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : tacticalTool === 'line' && currentPath.length > 1 ? (
                        <line
                          x1={currentPath[0].x}
                          y1={currentPath[0].y}
                          x2={currentPath[1].x}
                          y2={currentPath[1].y}
                          stroke={tacticalColor}
                          strokeWidth={tacticalLineWidth * 4}
                          strokeDasharray={tacticalLineType === 'dashed' ? "6, 4" : "none"}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                    </g>
                  )}

                  {/* Delaunay network overlay */}
                  {showDelaunayNetwork && calculatedDelaunayEdges.map((edge, idx) => (
                    <line
                      key={idx}
                      x1={edge.p1.x}
                      y1={edge.p1.y}
                      x2={edge.p2.x}
                      y2={edge.p2.y}
                      stroke="rgba(255,255,255,0.2)"
                      strokeWidth="0.4"
                      strokeDasharray="2, 2"
                    />
                  ))}
                </svg>

                {/* Draggable Ball Items */}
                {footballs.map((fb) => (
                  <div
                    key={fb.id}
                    className="absolute z-30 pointer-events-auto select-none cursor-grab active:cursor-grabbing after:absolute after:-inset-3 after:rounded-full"
                    style={{
                      left: `${fb.x}%`,
                      top: `${fb.y}%`,
                      touchAction: 'none',
                      transform: `translate(-50%, -50%) rotate(${getCounterRotation()}) scale(${elementScale})`,
                    }}
                    onPointerDown={(e) => {
                      if (tacticalTool === 'eraser') return;
                      e.stopPropagation();
                      pushHistory();
                      setDraggingBallId(fb.id);
                    }}
                  >
                    <div 
                      className="bg-white rounded-full p-0.5 border border-black shadow-xl"
                      style={{
                        width: `${6.0 * footballScale}cqmin`,
                        height: `${6.0 * footballScale}cqmin`,
                      }}
                    >
                      <SoccerBallIcon className="w-full h-full text-zinc-950" />
                    </div>
                  </div>
                ))}

                {/* Draggable Red Opponents */}
                {showOpponents && opponents.map((opp) => (
                  <div
                    key={opp.id}
                    className="absolute z-30 pointer-events-auto select-none cursor-grab active:cursor-grabbing after:absolute after:-inset-3 after:rounded-full"
                    style={{
                      left: `${opp.x}%`,
                      top: `${opp.y}%`,
                      touchAction: 'none',
                      transform: `translate(-50%, -50%) rotate(${getCounterRotation()}) scale(${elementScale})`,
                    }}
                    onPointerDown={(e) => {
                      if (tacticalTool === 'eraser') return;
                      e.stopPropagation();
                      pushHistory();
                      setDraggingOpponentId(opp.id);
                    }}
                  >
                    <div 
                      className="rounded-full border-2 border-white flex items-center justify-center font-black text-white shadow-xl shrink-0"
                      style={{
                        width: '6.8cqmin',
                        height: '6.8cqmin',
                        fontSize: '1.8cqmin',
                        backgroundColor: opponentColor
                      }}
                    >
                      M
                    </div>
                  </div>
                ))}

                {/* Interactive Board elements (Squad Players & Generic & Cones) */}
                {boardElements.map((el) => {
                  const sp = el.playerId ? getSquadPlayer(el.playerId) : null;
                  const isDragging = draggingId === el.id;
                  const isGoalOrLadder = el.itemType === 'goal' || el.itemType === 'ladder';
                  const rotationValue = el.rotation || 0;
                  const finalTransform = isGoalOrLadder 
                    ? `translate(-50%, -50%) rotate(${rotationValue}deg) scale(${elementScale})`
                    : `translate(-50%, -50%) rotate(${getCounterRotation()}) rotate(${rotationValue}deg) scale(${elementScale})`;

                  return (
                    <div
                      key={el.id}
                      className={`absolute z-30 pointer-events-auto select-none transition-transform cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-40 scale-90' : ''} after:absolute after:-inset-3 after:rounded-xl`}
                      style={{
                        left: `${el.x}%`,
                        top: `${el.y}%`,
                        touchAction: 'none',
                        transform: finalTransform,
                      }}
                      onPointerDown={(e) => {
                        if (tacticalTool === 'eraser') return;
                        e.stopPropagation();
                        pushHistory();
                        setDraggingId(el.id);
                        setSelectedElementId(el.id);
                        setSelectedDrawingId(null);
                      }}
                    >
                      {/* Cone Orange / Yellow / Blue rendering */}
                      {el.itemType?.startsWith('cone') ? (
                        <div className="flex flex-col items-center">
                          <ConeIcon color={el.itemType === 'cone-orange' ? '#f97316' : el.itemType === 'cone-yellow' ? '#eab308' : '#3b82f6'} size="6.8cqmin" />
                        </div>
                      ) : el.itemType === 'goal' ? (
                        <div className={`flex flex-col items-center animate-none ${pitchType === 'solid-white' ? 'text-zinc-800' : 'text-white'}`}>
                          <GoalIcon size="5.5cqmin" />
                        </div>
                      ) : el.itemType === 'ladder' ? (
                        <div className={`flex flex-col items-center animate-none ${pitchType === 'solid-white' ? 'text-zinc-800' : 'text-white'}`}>
                          <LadderIcon size="6cqmin" />
                        </div>
                      ) : (
                        // Standard player jersey rendering
                        <div className="flex flex-col items-center">
                          <div 
                            className="rounded-full border-2 border-white overflow-hidden shadow-2xl flex items-center justify-center shrink-0"
                            style={{ 
                              width: '7.5cqmin', 
                              height: '7.5cqmin',
                              backgroundColor: el.customColor || '#1e3a8a'
                            }}
                          >
                            {sp?.photoUrl && !el.hideNumber ? (
                              <CachedImage 
                                src={sp.photoUrl} 
                                alt={sp.name} 
                                className="w-full h-full object-cover pointer-events-none" 
                                decoding="async"
                              />
                            ) : (
                              <span 
                                className="font-black text-white uppercase leading-none"
                                style={{ fontSize: '2.1cqmin' }}
                              >
                                {el.hideNumber ? '' : (el.customNumber || sp?.number || sp?.name.charAt(0) || el.customName?.charAt(0) || 'P')}
                              </span>
                            )}
                          </div>
                          
                          {/* Name indicator below player node */}
                          {!(el.playerId?.startsWith('home-') || el.playerId?.startsWith('away-')) && (
                            <div 
                              className="bg-zinc-900/90 text-white rounded border border-zinc-750/50 mt-1 truncate font-bold uppercase tracking-tight shadow-md text-center"
                              style={{
                                fontSize: '1.5cqmin',
                                maxWidth: '12cqmin',
                                padding: '0.2cqmin 0.5cqmin',
                                marginTop: '0.5cqmin'
                              }}
                            >
                              {sp?.name || el.customName || 'Spelare'}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Selection highlight & Rotate Handle */}
                      {selectedElementId === el.id && tacticalTool === 'move' && (
                        <>
                          {/* Highlight dashed outline */}
                          <div 
                            className="absolute border-2 border-dashed border-indigo-500 rounded-xl pointer-events-none animate-pulse" 
                            style={{
                              top: '-1.5cqmin',
                              bottom: '-1.5cqmin',
                              left: '-1.5cqmin',
                              right: '-1.5cqmin',
                            }}
                          />
                          
                          {/* Rotation handle */}
                          <div 
                            className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center cursor-alias z-40 pointer-events-auto"
                            style={{
                              top: '-10cqmin'
                            }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              pushHistory();
                              setIsRotatingId(el.id);
                            }}
                          >
                            <div 
                              className="bg-indigo-500" 
                              style={{
                                width: '0.15cqmin',
                                height: '5cqmin'
                              }}
                            />
                            <div 
                              className="rounded-full bg-indigo-600 border border-white flex items-center justify-center shadow-lg hover:scale-125 transition-transform"
                              style={{
                                width: '3.5cqmin',
                                height: '3.5cqmin'
                              }}
                            >
                              <RotateCw size={9} className="text-white" style={{ width: '1.8cqmin', height: '1.8cqmin' }} />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

              </div>
            </div>

            {/* Float inline text editing popup */}
            {editingTextId && (
              <div className="absolute inset-0 z-[130] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
                <div className="bg-zinc-900 p-6 rounded-3xl shadow-2xl border border-zinc-800 w-full max-w-sm mx-auto animate-in zoom-in duration-200">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
                      <Type size={18} />
                    </div>
                    <div>
                      <h3 className="text-sm font-black uppercase text-white tracking-tight leading-none">Skriv på tavlan</h3>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase mt-1">Skriv din text och tryck på spara</p>
                    </div>
                    <button 
                      onClick={() => {
                        const d = tacticalDrawings.find(it => it.id === editingTextId);
                        if (d && !d.text) {
                          setTacticalDrawings(prev => prev.filter(it => it.id !== editingTextId));
                        }
                        setEditingTextId(null);
                      }}
                      className="ml-auto p-1.5 hover:bg-zinc-800 text-zinc-500 hover:text-white rounded-lg transition-colors"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <input 
                    autoFocus
                    type="text"
                    className="w-full px-4 py-3.5 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-0 text-sm font-bold text-white transition-all"
                    placeholder="Din text..."
                    value={tacticalDrawings.find(d => d.id === editingTextId)?.text || ''}
                    onChange={(e) => {
                      setTacticalDrawings(prev => prev.map(d => d.id === editingTextId ? { ...d, text: e.target.value } : d));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setEditingTextId(null);
                      if (e.key === 'Escape') setEditingTextId(null);
                    }}
                  />
                  <div className="grid grid-cols-2 gap-3 mt-5">
                    <button 
                      onClick={() => {
                        setTacticalDrawings(prev => prev.filter(it => it.id !== editingTextId));
                        setEditingTextId(null);
                      }}
                      className="py-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-zinc-500 font-black uppercase text-[10px] tracking-wider active:scale-95 transition-all"
                    >
                      Rensa
                    </button>
                    <button 
                      onClick={() => setEditingTextId(null)}
                      className="py-3 rounded-xl bg-indigo-600 text-white font-black uppercase text-[10px] tracking-wider shadow-lg shadow-indigo-600/10 active:scale-95 transition-all"
                    >
                      Spara
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
          {/* Unified Fixed Top Panel (Matching LineupBuilder style, position & layout exactly) */}
          {isToolboxVisible && (
            <motion.div 
              drag
              dragControls={dragControls}
              dragListener={false}
              dragMomentum={false}
              dragElastic={0}
              dragConstraints={canvasAreaRef}
              className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 p-3 bg-zinc-950/20 backdrop-blur-md rounded-[28px] border border-zinc-800/15 shadow-2xl w-[95vw] max-w-2xl text-zinc-100 select-none touch-none"
            >
              
              {/* Row 1: Tools & Universal Settings */}
              <div className="w-full min-w-0 flex items-center justify-between gap-4 pb-0.5 overflow-x-auto touch-pan-x scrollbar-thin scrollbar-track-transparent">
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Drag Handle */}
                  <div 
                    onPointerDown={(e) => dragControls.start(e)}
                    className="cursor-grab active:cursor-grabbing p-2 text-zinc-550 hover:text-white rounded-xl bg-black/10 hover:bg-black/25 transition-all mr-1.5 shrink-0 flex items-center justify-center h-9 w-7 touch-none select-none"
                    style={{ touchAction: 'none' }}
                    title="Dra för att flytta verktygsfältet"
                  >
                    <GripVertical size={16} />
                  </div>

                  {/* Undo, Redo & Clear */}
                  <div className="flex items-center gap-1 bg-black/15 p-1 rounded-xl mr-1 border border-zinc-800/10">
                    <button 
                      onClick={handleUndo}
                      className={`p-2 rounded-lg transition-all ${history.length === 0 ? 'text-zinc-650 cursor-not-allowed' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                      disabled={history.length === 0}
                      title="Ångra"
                    >
                      <Undo2 size={16} />
                    </button>
                    <button 
                      onClick={handleRedo}
                      className={`p-2 rounded-lg transition-all ${future.length === 0 ? 'text-zinc-650 cursor-not-allowed' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                      disabled={future.length === 0}
                      title="Gör om"
                    >
                      <Redo2 size={16} />
                    </button>
                    <button 
                      onClick={clearBoard}
                      className="p-2 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-all font-bold"
                      title="Radera allt"
                    >
                      <RotateCcw size={16} />
                    </button>
                  </div>

                  {/* Main tools */}
                  <button 
                    onClick={() => handleToolSelect('move')}
                    className={`p-2 rounded-xl transition-all ${tacticalTool === 'move' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Flyttläge"
                  >
                    <Move size={18} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => handleToolSelect('pen')}
                    className={`p-2 rounded-xl transition-all ${tacticalTool === 'pen' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Frihandspenna"
                  >
                    <Pencil size={18} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => handleToolSelect('arrow')}
                    className={`p-2 rounded-xl transition-all ${tacticalTool === 'arrow' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Dra pilar"
                  >
                    <ArrowUpRight size={18} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => handleToolSelect('freehand-arrow')}
                    className={`p-2 rounded-xl transition-all ${tacticalTool === 'freehand-arrow' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Frihandspil"
                  >
                    <Route size={18} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => handleToolSelect('circle')}
                    className={`p-2 rounded-xl transition-all ${tacticalTool === 'circle' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Rita cirkel"
                  >
                    <div className="w-4.5 h-4.5 rounded-full border-2 border-current" />
                  </button>
                  <button 
                    onClick={() => handleToolSelect('rectangle')}
                    className={`p-2 rounded-xl transition-all ${tacticalTool === 'rectangle' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Rita fyrkant"
                  >
                    <div className="w-4.5 h-4.5 border-2 border-current rounded-sm" />
                  </button>
                  <button 
                    onClick={() => handleToolSelect('text')}
                    className={`p-2 rounded-xl transition-all ${tacticalTool === 'text' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Skriv text"
                  >
                    <Type size={18} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => handleToolSelect('ball')}
                    className={`p-2 rounded-xl transition-all ${tacticalTool === 'ball' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Placera boll"
                  >
                    <SoccerBallIcon size={18} className={tacticalTool === 'ball' ? 'text-white' : 'text-zinc-400'} />
                  </button>
                  <button 
                    onClick={() => handleToolSelect('opponent')}
                    className={`p-2 rounded-xl transition-all ${tacticalTool === 'opponent' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Placera motståndare"
                  >
                    <Shirt size={18} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => handleToolSelect('add-element')}
                    className={`p-2 rounded-xl transition-all ${tacticalTool === 'add-element' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Placera spelare & material"
                  >
                    <Plus size={18} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => handleToolSelect('eraser')}
                    className={`p-2 rounded-xl transition-all ${tacticalTool === 'eraser' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title="Suddgummi"
                  >
                    <Eraser size={18} strokeWidth={2.5} />
                  </button>

                  <div className="h-6 w-[1px] bg-zinc-800 mx-1 shrink-0" />

                  <button 
                    onClick={() => setShowDelaunayNetwork(!showDelaunayNetwork)}
                    className={`p-2 rounded-xl transition-all ${showDelaunayNetwork ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    title={showDelaunayNetwork ? "Dölj passningsnät (Delaunay)" : "Visa passningsnät (Delaunay)"}
                  >
                    <Network size={18} strokeWidth={2.5} />
                  </button>
                </div>
              </div>

              {/* Row 2: Contextual Settings & Actions */}
              {isSubmenuVisible && tacticalTool !== 'eraser' && (
                <div className="w-full min-w-0 flex items-center gap-4 py-1 min-h-[48px] overflow-x-auto touch-pan-x scrollbar-thin scrollbar-track-transparent border-t border-zinc-800/10 mt-1 pl-1">
                  <AnimatePresence mode="wait">
                  {(tacticalTool === 'pen' || tacticalTool === 'arrow' || tacticalTool === 'freehand-arrow' || tacticalTool === 'circle' || tacticalTool === 'rectangle' || tacticalTool === 'square' || tacticalTool === 'text') && (
                    <motion.div 
                      key="context-settings"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="flex items-center gap-3 shrink-0"
                    >
                      {/* Tool Colors */}
                      <div className="flex items-center gap-2 pr-3 border-r border-zinc-800 overflow-visible">
                        <ColorPicker 
                          selectedColor={tacticalColor} 
                          onChange={setTacticalColor} 
                          direction="down"
                          minimal={true}
                        />
                      </div>

                      {/* Tool Specific Settings */}
                      <div className="flex items-center gap-3">
                        {tacticalTool === 'text' ? (
                          <div className="flex flex-col gap-0.5">
                             <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Textstorlek</span>
                             <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-xl border border-zinc-800">
                               <button onClick={() => setTacticalFontSize(Math.max(8, tacticalFontSize - 2))} className="text-zinc-500 hover:text-white"><Minus size={12} /></button>
                               <span className="text-[10px] font-black text-white min-w-4 text-center">{tacticalFontSize}</span>
                               <button onClick={() => setTacticalFontSize(Math.min(72, tacticalFontSize + 2))} className="text-zinc-500 hover:text-white"><Plus size={12} /></button>
                             </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                             <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Tjocklek</span>
                             <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-xl border border-zinc-800">
                               <button onClick={() => setTacticalLineWidth(Math.max(0.1, tacticalLineWidth - 0.1))} className="text-zinc-500 hover:text-white"><Minus size={12} /></button>
                               <span className="text-[10px] font-black text-white min-w-4 text-center">{tacticalLineWidth.toFixed(1)}</span>
                               <button onClick={() => setTacticalLineWidth(Math.min(5, tacticalLineWidth + 0.1))} className="text-zinc-500 hover:text-white"><Plus size={12} /></button>
                             </div>
                          </div>
                        )}

                        {(tacticalTool === 'pen' || tacticalTool === 'arrow' || tacticalTool === 'freehand-arrow' || tacticalTool === 'circle' || tacticalTool === 'rectangle' || tacticalTool === 'square') && (
                          <div className="flex bg-black/40 p-1 rounded-xl border border-zinc-800 self-end">
                            <button 
                              onClick={() => setTacticalLineType('solid')}
                              className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${tacticalLineType === 'solid' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                              Hel
                            </button>
                            <button 
                              onClick={() => setTacticalLineType('dashed')}
                              className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${tacticalLineType === 'dashed' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                              Sträck
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {tacticalTool === 'ball' && (
                    <motion.div 
                      key="ball-settings"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="flex items-center gap-3 shrink-0"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Bollstorlek</span>
                        <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-xl border border-zinc-800">
                          <button onClick={() => setFootballScale(Math.max(0.5, footballScale - 0.1))} className="text-zinc-500 hover:text-white"><Minus size={12} /></button>
                          <span className="text-[10px] font-black text-white min-w-4 text-center">{(footballScale * 100).toFixed(0)}%</span>
                          <button onClick={() => setFootballScale(Math.min(3, footballScale + 0.1))} className="text-zinc-500 hover:text-white"><Plus size={12} /></button>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {tacticalTool === 'opponent' && (
                    <motion.div 
                      key="opponent-settings"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="flex items-center gap-3 shrink-0"
                    >
                      {/* Opponent Colors */}
                      <div className="flex items-center gap-2 pr-3 border-r border-zinc-800 overflow-visible">
                        <span className="text-[7px] font-black text-zinc-500 uppercase tracking-tighter mr-1">Färg</span>
                        <ColorPicker 
                          selectedColor={opponentColor} 
                          onChange={(color) => {
                            setOpponentColor(color);
                          }} 
                          direction="down"
                          minimal={true}
                        />
                      </div>

                      {/* Show/Hide Opponents */}
                      <button 
                        onClick={() => setShowOpponents(!showOpponents)}
                        className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border ${showOpponents ? 'bg-emerald-600/10 text-emerald-400 border-emerald-500/30' : 'bg-red-600/10 text-red-400 border-red-500/30'}`}
                      >
                        {showOpponents ? 'Dölj Motstånd' : 'Visa Motstånd'}
                      </button>
                    </motion.div>
                  )}

                  {tacticalTool === 'add-element' && (
                    <motion.div 
                      key="add-element-settings"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="flex items-center gap-4 shrink-0 w-full"
                    >
                      {/* Standard Objects: Blue & Yellow Players */}
                      <div className="flex items-center gap-2 pr-3 border-r border-zinc-850 shrink-0">
                        <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest leading-none block mr-1">Spelare</span>
                        <button
                          onClick={() => addElementToPitch('generic-home')}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800/80 text-[10px] font-bold uppercase transition-all"
                          title="Lägg till blå spelare"
                        >
                          <div className="w-4 h-4 rounded-full bg-blue-600 border border-white flex items-center justify-center font-black text-white text-[9px]">H</div>
                          <span className="text-zinc-300">Blå</span>
                        </button>
                        <button
                          onClick={() => addElementToPitch('generic-away')}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800/80 text-[10px] font-bold uppercase transition-all"
                          title="Lägg till gul spelare"
                        >
                          <div className="w-4 h-4 rounded-full bg-amber-500 border border-white flex items-center justify-center font-black text-white text-[9px]">B</div>
                          <span className="text-zinc-300">Gul</span>
                        </button>
                      </div>

                      {/* Equipment: Cones, Goals, Ladders */}
                      <div className="flex items-center gap-2 pr-3 border-r border-zinc-850 shrink-0">
                        <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest leading-none block mr-1">Material</span>
                        <button
                          onClick={() => addElementToPitch('cone-orange')}
                          className="flex items-center gap-1 p-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800/80 transition-all"
                          title="Lägg till orange kon"
                        >
                          <ConeIcon color="#f97316" size={18} />
                        </button>
                        <button
                          onClick={() => addElementToPitch('cone-yellow')}
                          className="flex items-center gap-1 p-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800/80 transition-all"
                          title="Lägg till gul kon"
                        >
                          <ConeIcon color="#eab308" size={18} />
                        </button>
                        <button
                          onClick={() => addElementToPitch('cone-blue')}
                          className="flex items-center gap-1 p-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800/80 transition-all"
                          title="Lägg till blå kon"
                        >
                          <ConeIcon color="#3b82f6" size={18} />
                        </button>
                        <button
                          onClick={() => addElementToPitch('goal')}
                          className="flex items-center gap-1.5 px-2 py-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800/80 transition-all text-[10px] font-bold uppercase"
                          title="Lägg till mål"
                        >
                          <GoalIcon size={16} />
                          <span className="text-zinc-300">Mål</span>
                        </button>
                        <button
                          onClick={() => addElementToPitch('ladder')}
                          className="flex items-center gap-1.5 px-2 py-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800/80 transition-all text-[10px] font-bold uppercase"
                          title="Lägg till stege"
                        >
                          <LadderIcon size={16} />
                          <span className="text-zinc-300">Stege</span>
                        </button>
                      </div>

                      {/* Squad Players (scrollable list) */}
                      {squad && squad.length > 0 && (
                        <div className="flex items-center gap-2 overflow-visible">
                          <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest leading-none block shrink-0">Trupp</span>
                          <div className="flex items-center gap-1.5 max-w-[280px] overflow-x-auto py-0.5 no-scrollbar scrollbar-none">
                            {squad.map((sp) => {
                              const boardEl = boardElements.find(el => el.playerId === sp.id);
                              const isOnBoard = !!boardEl;

                              return (
                                <button
                                  key={sp.id}
                                  onClick={() => {
                                    if (isOnBoard) {
                                      pushHistory();
                                      setBoardElements(prev => prev.filter(el => el.playerId !== sp.id));
                                      if (boardEl && selectedElementId === boardEl.id) {
                                        setSelectedElementId(null);
                                      }
                                    } else {
                                      addElementToPitch('squad', sp);
                                    }
                                  }}
                                  className={`flex items-center gap-1 px-2 py-1 rounded-xl text-[9px] font-bold transition-all shrink-0 border ${
                                    isOnBoard 
                                      ? 'bg-indigo-950/45 text-indigo-300 border-indigo-500/30' 
                                      : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-800/80'
                                  }`}
                                  title={isOnBoard ? `Ta bort ${sp.name}` : `Placera ${sp.name}`}
                                >
                                  {sp.photoUrl ? (
                                    <img src={sp.photoUrl} alt={sp.name} className="w-3.5 h-3.5 rounded-full object-cover shrink-0" />
                                  ) : (
                                    <div className="w-3.5 h-3.5 rounded-full bg-indigo-900/60 flex items-center justify-center text-[7px] text-white shrink-0">
                                      {sp.name.charAt(0)}
                                    </div>
                                  )}
                                  <span className="truncate max-w-[50px]">{sp.name.split(' ')[0]}</span>
                                  {isOnBoard && <span className="text-[7px] font-black text-indigo-400">✓</span>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {tacticalTool === 'move' && (
                    <div className="flex items-center gap-4 shrink-0">
                      {/* Selected element controls */}
                      {selectedElementId ? (() => {
                        const selectedEl = boardElements.find(item => item.id === selectedElementId);
                        if (!selectedEl) return null;
                        const name = selectedEl.customName || (selectedEl.itemType === 'goal' ? 'Mål' : selectedEl.itemType === 'ladder' ? 'Stege' : 'Spelare');
                        return (
                          <motion.div 
                            key="selected-element-controls"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="flex items-center gap-3 shrink-0"
                          >
                            <span className="text-[9px] font-black uppercase text-indigo-400 truncate max-w-[80px]">{name}</span>
                            
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Rotation</span>
                              <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-xl border border-zinc-800">
                                <button onClick={() => {
                                  pushHistory();
                                  setBoardElements(prev => prev.map(item => item.id === selectedElementId ? { ...item, rotation: (((item.rotation || 0) - 15 + 180) % 360) - 180 } : item));
                                }} className="text-zinc-500 hover:text-white"><Minus size={12} /></button>
                                <span className="text-[10px] font-black text-white min-w-8 text-center">{selectedEl.rotation || 0}°</span>
                                <button onClick={() => {
                                  pushHistory();
                                  setBoardElements(prev => prev.map(item => item.id === selectedElementId ? { ...item, rotation: (((item.rotation || 0) + 15 + 180) % 360) - 180 } : item));
                                }} className="text-zinc-500 hover:text-white"><Plus size={12} /></button>
                              </div>
                            </div>

                            {(selectedEl.itemType === 'player' || selectedEl.itemType === 'opponent' || selectedEl.playerId) && (
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Visa siffra</span>
                                <button
                                  onClick={() => {
                                    pushHistory();
                                    setBoardElements(prev => prev.map(item => item.id === selectedElementId ? { ...item, hideNumber: !item.hideNumber } : item));
                                  }}
                                  className={`px-3 py-1.5 rounded-xl border transition-all text-[10px] font-black uppercase tracking-wider ${
                                    selectedEl.hideNumber 
                                      ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20' 
                                      : 'bg-indigo-600/20 border-indigo-500/25 text-indigo-400 hover:bg-indigo-600/30'
                                  }`}
                                >
                                  {selectedEl.hideNumber ? "Dold" : "Visas"}
                                </button>
                              </div>
                            )}

                            <button
                              onClick={() => {
                                pushHistory();
                                setBoardElements(prev => prev.filter(item => item.id !== selectedElementId));
                                setSelectedElementId(null);
                              }}
                              className="p-2 text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-xl transition-all shrink-0 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider"
                              title="Ta bort element"
                            >
                              <Trash2 size={14} />
                              <span>Ta bort</span>
                            </button>
                          </motion.div>
                        );
                      })() : (
                        <motion.div 
                          key="general-move-settings"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          className="flex items-center gap-3 shrink-0"
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Skala på element</span>
                            <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-xl border border-zinc-800">
                              <button onClick={() => setElementScale(Math.max(0.5, elementScale - 0.1))} className="text-zinc-500 hover:text-white"><Minus size={12} /></button>
                              <span className="text-[10px] font-black text-white min-w-4 text-center">{(elementScale * 100).toFixed(0)}%</span>
                              <button onClick={() => setElementScale(Math.min(3, elementScale + 0.1))} className="text-zinc-500 hover:text-white"><Plus size={12} /></button>
                            </div>
                          </div>

                          {/* Pitch Field Theme Selection */}
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Plantema</span>
                            <select
                              value={pitchType}
                              onChange={(e) => setPitchType(e.target.value)}
                              className="bg-black/40 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-wider text-zinc-350 py-1.5 px-3 focus:ring-0 focus:outline-none shrink-0"
                            >
                              <option value="classic">Grön klassisk</option>
                              <option value="grass">Grön finkornig</option>
                              <option value="blue">Blå klassisk</option>
                              <option value="solid-blue">Blå enfärgad</option>
                              <option value="blue-grass">Blå finkornig</option>
                              <option value="solid-white">Vit enfärgad</option>
                              <option value="solid-black">Svart taktisk</option>
                            </select>
                          </div>

                          {/* Pitch Field Size Selection */}
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Planstorlek</span>
                            <select
                              value={pitchSize}
                              onChange={(e) => setPitchSize(e.target.value as 'full' | 'half')}
                              className="bg-black/40 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-wider text-zinc-350 py-1.5 px-3 focus:ring-0 focus:outline-none shrink-0"
                            >
                              <option value="full">Helplan</option>
                              <option value="half">Halvplan</option>
                            </select>
                          </div>

                          {/* Orientation Landscape/Vertical */}
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Riktning</span>
                            <button
                              onClick={() => setOrientation(prev => prev === 'vertical' ? 'landscape' : 'vertical')}
                              className="px-3 py-1.5 bg-black/40 border border-zinc-800 hover:border-zinc-700 text-zinc-350 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all text-center"
                              title="Ändra planens orientering (Stående / Liggande)"
                            >
                              {orientation === 'vertical' ? 'Stående' : 'Liggande'}
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  )}
                </AnimatePresence>
              </div>
              )}

            </motion.div>
          )}



        </div>

      </div>

    </div>
  );
}
