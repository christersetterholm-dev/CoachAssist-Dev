import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
// import html2canvas from 'html-to-image'; // Removed
import { SquadPlayer, Lineup, LineupPlayer, FormationVariant, FormationPosition, TacticalSavedBoard } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { CachedImage } from './CachedImage';
import { Plus, Minus, X, Trash2, Image as ImageIcon, User, Save, Settings, ClipboardList, Camera, Check, Edit2, Undo2, Redo2, Maximize2, Minimize2, Copy, Trophy, Upload, Pencil, ArrowUpRight, Eraser, RotateCcw, Trash, Shirt, Pin, PinOff, Smartphone, Monitor, ChevronDown, ChevronUp, RefreshCw, GripVertical, Footprints, Archive, ArchiveRestore, Layout, Eye, EyeOff, Target, Play, Move, Route, Type, FolderOpen, Cloud, CloudOff, Bookmark, Network } from 'lucide-react';

import { FORMATION_TEMPLATES } from '../lib/formations';
import { Reorder } from 'motion/react';
import ColorPicker from './ColorPicker';
import ImageCropper from './ImageCropper';

import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../lib/firebase';

interface LineupBuilderProps {
  squad: SquadPlayer[];
  lineup: Lineup | null;
  lineups: Lineup[];
  onUpdateLineup: (lineup: Lineup) => void;
  onSaveLineup: (lineup: Lineup) => void;
  onDeleteLineup: (id: string) => void;
  onSelectLineup: (id: string) => void;
  onCopyLineup: (id: string) => void;
  onReorderLineups: (lineups: Lineup[]) => void;
  onUpdateSquad: (squad: SquadPlayer[]) => void;
  customFormations?: FormationVariant[];
  pinnedFormationIds?: string[];
  onSaveCustomFormation?: (formation: FormationVariant) => void;
  onDeleteCustomFormation?: (id: string) => void;
  onTogglePinFormation?: (id: string) => void;
  user: FirebaseUser | null;
  isSyncing?: boolean;
  sessionActionCount?: number;
  isQuotaExceeded?: boolean;
  syncError?: string | null;
}

interface DelaunayPoint {
  x: number;
  y: number;
  id?: string;
  name?: string;
}

interface DelaunayEdge {
  p1: number;
  p2: number;
}

function getCircumcircle(p1: DelaunayPoint, p2: DelaunayPoint, p3: DelaunayPoint) {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < 1e-9) {
    return { x: 0, y: 0, rSq: -1 };
  }
  const p1Sq = p1.x * p1.x + p1.y * p1.y;
  const p2Sq = p2.x * p2.x + p2.y * p2.y;
  const p3Sq = p3.x * p3.x + p3.y * p3.y;

  const ux = ((p1Sq * (p2.y - p3.y)) + (p2Sq * (p3.y - p1.y)) + (p3Sq * (p1.y - p2.y))) / d;
  const uy = ((p1Sq * (p3.x - p2.x)) + (p2Sq * (p1.x - p3.x)) + (p3Sq * (p2.x - p1.x))) / d;
  const rSq = (p1.x - ux) * (p1.x - ux) + (p1.y - uy) * (p1.y - uy);
  return { x: ux, y: uy, rSq };
}

function getDistanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    const rx = px - ax;
    const ry = py - ay;
    return Math.sqrt(rx * rx + ry * ry);
  }
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  const closestX = ax + clampedT * dx;
  const closestY = ay + clampedT * dy;
  const rx = px - closestX;
  const ry = py - closestY;
  return Math.sqrt(rx * rx + ry * ry);
}

function getDelaunayTriangulation(points: DelaunayPoint[]): DelaunayEdge[] {
  if (points.length < 2) return [];
  if (points.length === 2) {
    return [{ p1: 0, p2: 1 }];
  }

  // To prevent numerical issues, jitter slightly
  const jitteredPoints = points.map((p, i) => ({
    x: p.x + (Math.sin(i) * 0.0001),
    y: p.y + (Math.cos(i) * 0.0001)
  }));

  // Find bounding box for super-triangle
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of jitteredPoints) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const deltaMax = Math.max(dx, dy) || 100;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  // Super-triangle vertices enclosing all points
  const p1 = { x: midX - 20 * deltaMax - 1, y: midY - deltaMax - 1 };
  const p2 = { x: midX, y: midY + 20 * deltaMax + 1 };
  const p3 = { x: midX + 20 * deltaMax + 1, y: midY - deltaMax - 1 };

  const allPoints = [...jitteredPoints, p1, p2, p3];
  const n = jitteredPoints.length;

  interface TriangleDef {
    a: number;
    b: number;
    c: number;
    ux: number;
    uy: number;
    rSq: number;
  }

  const triangles: TriangleDef[] = [];

  function addTriangle(a: number, b: number, c: number) {
    const cc = getCircumcircle(allPoints[a], allPoints[b], allPoints[c]);
    triangles.push({ a, b, c, ux: cc.x, uy: cc.y, rSq: cc.rSq });
  }

  addTriangle(n, n + 1, n + 2);

  for (let i = 0; i < n; i++) {
    const p = allPoints[i];
    const badTriangles: number[] = [];

    for (let j = 0; j < triangles.length; j++) {
      const tri = triangles[j];
      const distSq = (p.x - tri.ux) * (p.x - tri.ux) + (p.y - tri.uy) * (p.y - tri.uy);
      if (distSq < tri.rSq + 1e-9) {
        badTriangles.push(j);
      }
    }

    const polygon: DelaunayEdge[] = [];
    for (const btIndex of badTriangles) {
      const tri = triangles[btIndex];
      const edges = [
        { p1: tri.a, p2: tri.b },
        { p1: tri.b, p2: tri.c },
        { p1: tri.c, p2: tri.a }
      ];

      for (const edge of edges) {
        let isShared = false;
        for (const otherBtIndex of badTriangles) {
          if (btIndex === otherBtIndex) continue;
          const ot = triangles[otherBtIndex];
          const otVertices = [ot.a, ot.b, ot.c];
          if (otVertices.includes(edge.p1) && otVertices.includes(edge.p2)) {
            isShared = true;
            break;
          }
        }
        if (!isShared) {
          polygon.push(edge);
        }
      }
    }

    badTriangles.sort((a, b) => b - a);
    for (const index of badTriangles) {
      triangles.splice(index, 1);
    }

    for (const edge of polygon) {
      addTriangle(edge.p1, edge.p2, i);
    }
  }

  const resultEdges: DelaunayEdge[] = [];
  const edgeKeySet = new Set<string>();

  for (const tri of triangles) {
    if (tri.a >= n || tri.b >= n || tri.c >= n) continue;

    const edges = [
      { p1: tri.a, p2: tri.b },
      { p1: tri.b, p2: tri.c },
      { p1: tri.c, p2: tri.a }
    ];

    for (const edge of edges) {
      const u = Math.min(edge.p1, edge.p2);
      const v = Math.max(edge.p1, edge.p2);
      const key = `${u}-${v}`;
      if (!edgeKeySet.has(key)) {
        edgeKeySet.add(key);
        resultEdges.push({ p1: u, p2: v });
      }
    }
  }

  return resultEdges;
}



interface LineupReorderItemProps {
  key: string;
  l: Lineup;
  activeLineupId?: string;
  onSelectLineup: (id: string) => void;
  toggleArchive: (e: any, id: string) => void;
  onCopyLineup: (id: string) => void;
  onDeleteLineup: (id: string) => void;
  onEditTitle: (id: string, title: string, team: string) => void;
}

function LineupReorderItem({ 
  l, 
  activeLineupId, 
  onSelectLineup, 
  toggleArchive, 
  onCopyLineup, 
  onDeleteLineup,
  onEditTitle
}: LineupReorderItemProps) {
  const controls = useDragControls();

  return (
    <Reorder.Item 
      key={l.id}
      value={l}
      dragListener={false}
      dragControls={controls}
      className={`group p-4 rounded-3xl border transition-all flex items-center justify-between w-full min-w-0 ${
        activeLineupId === l.id 
          ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 ring-1 ring-indigo-200 dark:ring-indigo-800' 
          : 'bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800 hover:border-zinc-200 dark:hover:border-zinc-700'
      }`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
        <div 
          className="cursor-grab active:cursor-grabbing text-zinc-300 dark:text-zinc-700 hover:text-zinc-400 transition-colors shrink-0 p-2 -m-2 touch-none"
          onPointerDown={(e) => controls.start(e)}
        >
          <GripVertical size={18} />
        </div>
        <div 
          className="flex-1 cursor-pointer min-w-0 overflow-hidden pr-2" 
          onClick={() => onSelectLineup(l.id)}
        >
          <h4 className="font-black text-zinc-900 dark:text-white tracking-tight leading-tight truncate text-sm sm:text-base">
            {l.matchTitle || 'Namnlös Match'}
          </h4>
          <span className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-loose truncate block">
            {new Date(l.date).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0 ml-2">
        <button
          onClick={() => onEditTitle(l.id, l.matchTitle || '', l.teamName || '')}
          className="p-2.5 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-xl transition-all"
          title="Redigera rubriker"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={(e) => toggleArchive(e, l.id)}
          className="p-2.5 text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-xl transition-all"
          title="Arkivera"
        >
          <Archive size={16} />
        </button>
        <button
          onClick={() => onCopyLineup(l.id)}
          className="p-2.5 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-xl transition-all"
          title="Kopiera"
        >
          <Copy size={16} />
        </button>
        <button
          onClick={() => onDeleteLineup(l.id)}
          className="p-2.5 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-xl transition-all"
          title="Radera"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </Reorder.Item>
  );
}

export default function LineupBuilder({ 
  squad, 
  lineup, 
  lineups,
  onUpdateLineup, 
  onSaveLineup,
  onDeleteLineup,
  onSelectLineup,
  onCopyLineup,
  onReorderLineups,
  onUpdateSquad,
  customFormations = [],
  pinnedFormationIds = [],
  onSaveCustomFormation,
  onDeleteCustomFormation,
  onTogglePinFormation,
  user,
  isSyncing = false,
  sessionActionCount = 0,
  isQuotaExceeded = false,
  syncError = null
}: LineupBuilderProps) {
  const SoccerBallIcon = ({ size = 20, className = "" }: { size?: number, className?: string }) => (
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

  const [lineupName, setLineupName] = useState(lineup?.matchTitle || '');
  const [teamName, setTeamName] = useState(lineup?.teamName || '');
  
  // Exclude leaders (role === 'leader') from lineup building and drawing boards
  const squadPlayers = React.useMemo(() => {
    return squad.filter(p => p.role !== 'leader');
  }, [squad]);
  const [players, setPlayers] = useState<LineupPlayer[]>(lineup?.players || []);
  const [playerScale, setPlayerScale] = useState(lineup?.playerScale || 1);
  const [nameTagStyle, setNameTagStyle] = useState<'light' | 'dark'>(lineup?.nameTagStyle || 'light');
  const [nameDisplayMode, setNameDisplayMode] = useState<'first' | 'last' | 'full' | 'initials' | 'firstLastInitial' | 'initialLastName'>(lineup?.nameDisplayMode || 'first');
  const [showNameBackground, setShowNameBackground] = useState(lineup?.showNameBackground ?? true);
  const [nameBackgroundType, setNameBackgroundType] = useState<'classic' | 'badge' | 'minimal'>(lineup?.nameBackgroundType || 'classic');
  const [showPhoto, setShowPhoto] = useState(lineup?.showPhoto ?? true);
  const [showName, setShowName] = useState(lineup?.showName ?? true);
  const [showImport, setShowImport] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [importResult, setImportResult] = useState<{ found: string[], missing: string[] } | null>(null);
  const [showNumber, setShowNumber] = useState(lineup?.showNumber ?? true);
  const [teamLogoUrl, setTeamLogoUrl] = useState(lineup?.teamLogoUrl || '');
  const [pitchType, setPitchType] = useState<'classic' | 'grass' | 'blue' | 'solid-blue' | 'blue-stripes' | 'blue-grass' | 'solid-white' | 'solid-black'>(lineup?.pitchType || 'classic');
  const [orientation, setOrientation] = useState<'vertical' | 'landscape'>('vertical');
  const [attackDirection, setAttackDirection] = useState<'up' | 'down' | 'left' | 'right'>('up');
  const [currentFormation, setCurrentFormation] = useState<string>(lineup?.formation || '');
  
  // Custom Logo Upload States
  const [showLogoPicker, setShowLogoPicker] = useState(false);
  const [logoToCrop, setLogoToCrop] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [previewZoom, setPreviewZoom] = useState(1);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
  const [isFormationsExpanded, setIsFormationsExpanded] = useState(true);
  const [hoveredPlayerId, setHoveredPlayerId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [teamNotes, setTeamNotes] = useState(lineup?.notes?.team?.text || '');
  const [teamMedia, setTeamMedia] = useState<string[]>(lineup?.notes?.team?.media || []);
  const [opponentNotes, setOpponentNotes] = useState(lineup?.notes?.opponent?.text || '');
  const [opponentMedia, setOpponentMedia] = useState<string[]>(lineup?.notes?.opponent?.media || []);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [selectedMediaUrl, setSelectedMediaUrl] = useState<string | null>(null);
  const teamTextareaRef = useRef<HTMLTextAreaElement>(null);
  const opponentTextareaRef = useRef<HTMLTextAreaElement>(null);

  const isVideo = (url: string) => {
    return url.toLowerCase().match(/\.(mp4|webm|ogg|mov)$/) || url.includes('video');
  };

  const adjustTextAreaHeight = (textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  useEffect(() => {
    if (showNotesModal) {
      // Give time for the modal animation/mounting before calculating height
      const timer = setTimeout(() => {
        adjustTextAreaHeight(teamTextareaRef.current);
        adjustTextAreaHeight(opponentTextareaRef.current);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showNotesModal, teamNotes, opponentNotes]);

  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedForEdit, setSelectedForEdit] = useState<string | null>(null); // LineupPlayer id
  const [pickerMode, setPickerMode] = useState<'starter' | 'sub' | null>(null);
  const [sortBySelected, setSortBySelected] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number, y: number } | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(false);
  const [isDrawingsVisible, setIsDrawingsVisible] = useState(false);
  const [showDelaunayNetwork, setShowDelaunayNetwork] = useState(false);
  const [passingNetworkMode, setPassingNetworkMode] = useState<'triangulation' | 'standard' | 'maximum' | 'ultra' | 'lanes'>('standard');
  const [fullScreenZoom, setFullScreenZoom] = useState(1);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isArchiveExpanded, setIsArchiveExpanded] = useState(false);
  const [showSavedLineups, setShowSavedLineups] = useState(true);
  const [showBenchMaximized, setShowBenchMaximized] = useState(false);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const [showTacticalSavedBoardsModal, setShowTacticalSavedBoardsModal] = useState(false);
  const [newSavedBoardName, setNewSavedBoardName] = useState('');
  const [showSaveOnCloseModal, setShowSaveOnCloseModal] = useState(false);
  const [exitBoardName, setExitBoardName] = useState('');
  const dragControls = useDragControls();
  const markerSuffix = useMemo(() => Math.random().toString(36).substring(2, 7), []);

  // Tactical Board State
  const [tacticalTool, setTacticalTool] = useState<'pen' | 'arrow' | 'freehand-arrow' | 'eraser' | 'ball' | 'opponent' | 'move' | 'text' | 'circle' | 'rectangle' | 'square'>('move');
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const pitchAspectRatio = 68/105;
  const constrainSquare = (p0: { x: number, y: number }, p1: { x: number, y: number }) => {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const signX = Math.sign(dx) || 1;
    const signY = Math.sign(dy) || 1;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    // Since width maps to 0..100 and height maps to 0..100, we must adjust for pitch's aspect ratio (width/height)
    // to render as a perfect 1:1 visual square on screen.
    const size = Math.max(absX, absY * pitchAspectRatio);
    return {
      x: p0.x + signX * size,
      y: p0.y + signY * (size / pitchAspectRatio)
    };
  };
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [isTransforming, setIsTransforming] = useState<'move' | 'resize' | null>(null);
  const [transformStart, setTransformStart] = useState<{ x: number, y: number, initialPoints: any[] } | null>(null);

  // Sync tactical players with main players (handles additions/deletions/subs while keeping custom positioning on the drawing board)
  useEffect(() => {
    setTacticalPlayers(prevTactical => {
      const prevList = prevTactical || [];
      const prevMap = new Map<string, LineupPlayer>(prevList.map(p => [p.id, p]));
      
      const updatedTactical = players.map(p => {
        // If not maximized, ALWAYS copy the coordinates from main players!
        // This ensures they don't end up in a heap at 50,50 because of stale coordinates synced when they were on the bench.
        if (!isMaximized) {
          return { ...p };
        }

        const match = prevMap.get(p.id);
        if (match) {
          // Preserve the custom tactical coordinates and state, but update other details from main state
          return {
            ...p,
            x: match.x,
            y: match.y,
            isHolding: match.isHolding,
          };
        }
        return { ...p };
      });

      if (JSON.stringify(prevList) !== JSON.stringify(updatedTactical)) {
        return updatedTactical;
      }
      return prevList;
    });
  }, [isMaximized, players]);

  const [tacticalDrawings, setTacticalDrawings] = useState<any[]>(lineup?.tacticalBoard?.drawings || []);
  const [tacticalLineType, setTacticalLineType] = useState<'solid' | 'dashed'>('solid');
  const [tacticalLineWidth, setTacticalLineWidth] = useState<number>(0.8);
  const [tacticalFontSize, setTacticalFontSize] = useState<number>(16);
  const [tacticalColor, setTacticalColor] = useState('#ffffff');
  const [footballPos, setFootballPos] = useState<{ x: number, y: number } | null>(lineup?.tacticalBoard?.footballPos || null);
  const [footballScale, setFootballScale] = useState<number>(lineup?.tacticalBoard?.footballScale || 1);
  const [opponents, setOpponents] = useState<{ id: string, x: number, y: number }[]>(lineup?.tacticalBoard?.opponents || []);
  const [showOpponents, setShowOpponents] = useState(lineup?.tacticalBoard?.showOpponents ?? true);
  const [opponentColor, setOpponentColor] = useState(lineup?.tacticalBoard?.opponentColor || '#ef4444');
  const [tacticalPlayers, setTacticalPlayers] = useState<LineupPlayer[]>(lineup?.tacticalBoard?.players || []);

  const tacticalSnapshotRef = useRef<{
    drawings: string;
    opponents: string;
    players: string;
    footballPos: string;
    footballScale: number;
    showOpponents: boolean;
    opponentColor: string;
    pitchType: string;
  } | null>(null);

  const updateTacticalSnapshot = (
    drawingsList: any[],
    opponentsList: any[],
    playersList: LineupPlayer[],
    footballPosition: { x: number; y: number } | null,
    scale: number,
    showOpps: boolean,
    color: string,
    pType: string
  ) => {
    const simplifiedPlayers = (playersList || []).map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      isSubstitute: !!p.isSubstitute
    }));

    tacticalSnapshotRef.current = {
      drawings: JSON.stringify(drawingsList || []),
      opponents: JSON.stringify(opponentsList || []),
      players: JSON.stringify(simplifiedPlayers),
      footballPos: JSON.stringify(footballPosition),
      footballScale: scale,
      showOpponents: showOpps,
      opponentColor: color,
      pitchType: pType,
    };
  };

  const isTacticalBoardModified = () => {
    if (!tacticalSnapshotRef.current) return false;

    const simplifiedPlayers = (tacticalPlayers || []).map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      isSubstitute: !!p.isSubstitute
    }));

    const currentDrawings = JSON.stringify(tacticalDrawings || []);
    const currentOpponents = JSON.stringify(opponents || []);
    const currentPlayers = JSON.stringify(simplifiedPlayers);
    const currentFootballPos = JSON.stringify(footballPos);

    const snapshot = tacticalSnapshotRef.current;

    const hasNewDrawings = currentDrawings !== snapshot.drawings;
    const hasNewOpponents = currentOpponents !== snapshot.opponents;
    const hasNewPlayers = currentPlayers !== snapshot.players;
    const hasNewFootball = currentFootballPos !== snapshot.footballPos;
    const hasNewScale = footballScale !== snapshot.footballScale;
    const hasNewShowOpponents = showOpponents !== snapshot.showOpponents;
    const hasNewOpponentColor = opponentColor !== snapshot.opponentColor;
    const hasNewPitchType = pitchType !== snapshot.pitchType;

    return (
      hasNewDrawings ||
      hasNewOpponents ||
      hasNewPlayers ||
      hasNewFootball ||
      hasNewScale ||
      hasNewShowOpponents ||
      hasNewOpponentColor ||
      hasNewPitchType
    );
  };

  // Whenever entering rittavlan/maximized mode, copy the current lineup's player positions to the tactical players and set initial snapshot
  useEffect(() => {
    if (isMaximized) {
      const initialTacticalPlayers = players.map(p => ({ ...p }));
      setTacticalPlayers(initialTacticalPlayers);
      updateTacticalSnapshot(
        tacticalDrawings,
        opponents,
        initialTacticalPlayers,
        footballPos,
        footballScale,
        showOpponents,
        opponentColor,
        pitchType
      );
    } else {
      tacticalSnapshotRef.current = null;
    }
  }, [isMaximized]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<{ x: number, y: number }[]>([]);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const lastTapTime = useRef<number>(0);

  const handlePointerDownWithDeletion = (e: React.PointerEvent, type: 'opponent' | 'ball', id?: string) => {
    e.stopPropagation();
    
    // Check for double tap
    const now = Date.now();
    if (now - lastTapTime.current < 300) {
      pushHistory();
      if (type === 'opponent' && id) {
        setOpponents(prev => prev.filter(o => o.id !== id));
      } else if (type === 'ball') {
        setFootballPos(null);
      }
      setHasUnsavedChanges(true);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      return;
    }
    lastTapTime.current = now;

    // Direct eraser check
    if (tacticalTool === 'eraser' || tacticalTool === 'move') {
      pushHistory();
      if (type === 'opponent' && id) {
        if (tacticalTool === 'eraser') setOpponents(prev => prev.filter(o => o.id !== id));
      } else if (type === 'ball') {
        if (tacticalTool === 'eraser') setFootballPos(null);
      }
      if (tacticalTool === 'eraser') {
        setHasUnsavedChanges(true);
        return;
      }
    }

    // Long press detection
    longPressTimer.current = setTimeout(() => {
      pushHistory();
      if (type === 'opponent' && id) {
        setOpponents(prev => prev.filter(o => o.id !== id));
      } else if (type === 'ball') {
        setFootballPos(null);
      }
      setHasUnsavedChanges(true);
      // Vibrate if supported
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 600);

    // Continue with normal dragging
    if (type === 'ball') {
      pushHistory();
      setDraggingBall(true);
    } else if (type === 'opponent' && id) {
      pushHistory();
      setDraggingOpponentId(id);
    }
  };

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const [draggingBall, setDraggingBall] = useState(false);
  const [draggingOpponentId, setDraggingOpponentId] = useState<string | null>(null);
  const [tempTitle, setTempTitle] = useState('');
  const [tempTeamName, setTempTeamName] = useState('');
  const [editingLineupId, setEditingLineupId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isScreenshotMode, setIsScreenshotMode] = useState(false);
  const [showScreenshotTip, setShowScreenshotTip] = useState(false);
  const [showFormationModal, setShowFormationModal] = useState(false);
  const [showOpponentFormationModal, setShowOpponentFormationModal] = useState(false);
  const [showSaveFormation, setShowSaveFormation] = useState(false);
  const [newFormationName, setNewFormationName] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lineupHistories, setLineupHistories] = useState<Record<string, any[]>>({});
  const [lineupFutures, setLineupFutures] = useState<Record<string, any[]>>({});
  const isRestoringHistory = useRef(false);
  // Sync local state when lineup prop changes (remote updates)
  useEffect(() => {
    if (!lineup) return;
    
    const isNewId = lineup.id !== currentIdRef.current;
    
    // We only want to force a full state reset if it's a new ID
    // or if we DON'T have unsaved changes (meaning we are following the cloud truth).
    if (isNewId || !hasUnsavedChanges) {
      setLineupName(lineup.matchTitle || '');
      setTeamName(lineup.teamName || '');
      setPlayers(lineup.players || []);
      setPlayerScale(lineup.playerScale ?? 1.0);
      setNameTagStyle(lineup.nameTagStyle || 'light');
      setNameDisplayMode(lineup.nameDisplayMode || 'full');
      setShowNameBackground(lineup.showNameBackground ?? true);
      setNameBackgroundType(lineup.nameBackgroundType || 'classic');
      setShowPhoto(lineup.showPhoto ?? true);
      setShowName(lineup.showName ?? true);
      setShowNumber(lineup.showNumber ?? true);
      setTeamLogoUrl(lineup.teamLogoUrl || '');
      setPitchType(lineup.pitchType || 'classic');
      setCurrentFormation(lineup.formation || '');
      setTeamNotes(lineup.notes?.team?.text || '');
      setTeamMedia(lineup.notes?.team?.media || []);
      setOpponentNotes(lineup.notes?.opponent?.text || '');
      setOpponentMedia(lineup.notes?.opponent?.media || []);
      setTacticalDrawings(lineup.tacticalBoard?.drawings || []);
      setFootballPos(lineup.tacticalBoard?.footballPos || null);
      setFootballScale(lineup.tacticalBoard?.footballScale || 1);
      setOpponents(lineup.tacticalBoard?.opponents || []);
      setShowOpponents(lineup.tacticalBoard?.showOpponents ?? true);
      setOpponentColor(lineup.tacticalBoard?.opponentColor || '#ef4444');
      const savedTacticalPlayers = lineup.tacticalBoard?.players || [];
      setTacticalPlayers(
        savedTacticalPlayers.length > 0 
          ? savedTacticalPlayers.map(p => ({ ...p }))
          : (lineup.players || []).map(p => ({ ...p }))
      );
      
      // Deduplicate players by ID
      const deduplicatedPlayers = Array.from(new Map((lineup.players || []).map(p => [p.id, p])).values());
      setPlayers(deduplicatedPlayers);
      
      currentIdRef.current = lineup.id;
      setHasUnsavedChanges(false);
    }
  }, [lineup, hasUnsavedChanges]);;

  const currentId = lineup?.id || 'temp';
  const currentIdRef = useRef(currentId);
  const history = lineupHistories[currentId] || [];
  const future = lineupFutures[currentId] || [];

  // Undo/Redo history (lineupHistories / lineupFutures) is kept strictly local in the component's state
  // to avoid sending massive history lists of snapshots back and forth to Firestore on every interactive change.
  // This completely resolves the "Quota exceeded" errors and keeps the tactical board extremely fast.
  useEffect(() => {
    // History sync to Firestore is removed to preserve quota.
    // The undo/redo stacks remain fully functional in-memory.
  }, [lineupHistories, lineupFutures]);

  const pushHistory = useCallback(() => {
    setLineupHistories(prev => {
      const currentHistory = prev[currentId] || [];
      const snapshot = {
        lineupName,
        teamName,
        playerScale,
        nameTagStyle,
        nameDisplayMode,
        showNameBackground,
        nameBackgroundType,
        showPhoto,
        showName,
        showNumber,
        teamLogoUrl,
        pitchType,
        orientation,
        attackDirection,
        players: JSON.parse(JSON.stringify(players)),
        tacticalPlayers: JSON.parse(JSON.stringify(tacticalPlayers)),
        footballPos: footballPos ? { ...footballPos } : null,
        footballScale: footballScale || 1,
        opponents: JSON.parse(JSON.stringify(opponents)),
        tacticalDrawings: JSON.parse(JSON.stringify(tacticalDrawings)),
        showOpponents,
        opponentColor,
        formation: currentFormation
      };
      const newHistory = [...currentHistory, snapshot];
      if (newHistory.length > 50) return { ...prev, [currentId]: newHistory.slice(newHistory.length - 50) };
      return { ...prev, [currentId]: newHistory };
    });
    setLineupFutures(prev => ({ ...prev, [currentId]: [] })); // Clear future for this specific lineup
  }, [currentId, lineupName, teamName, playerScale, nameTagStyle, nameDisplayMode, showNameBackground, nameBackgroundType, showPhoto, showName, showNumber, teamLogoUrl, pitchType, players, tacticalPlayers, footballPos, opponents, tacticalDrawings, showOpponents, opponentColor, currentFormation]);

  const handleUndo = useCallback(() => {
    if (history.length === 0 || isRestoringHistory.current) return;
    
    // Capture current state before undoing to save to future
    const currentSnapshot = {
      lineupName,
      teamName,
      playerScale,
      nameTagStyle,
      nameDisplayMode,
      showNameBackground,
      nameBackgroundType,
      showPhoto,
      showName,
      showNumber,
      teamLogoUrl,
      pitchType,
      players: JSON.parse(JSON.stringify(players)),
      tacticalPlayers: JSON.parse(JSON.stringify(tacticalPlayers)),
      footballPos: footballPos ? { ...footballPos } : null,
      footballScale: footballScale || 1,
      opponents: JSON.parse(JSON.stringify(opponents)),
      tacticalDrawings: JSON.parse(JSON.stringify(tacticalDrawings)),
      showOpponents,
      opponentColor,
      formation: currentFormation
    };
    
    const last = history[history.length - 1];
    setLineupHistories(prev => ({ ...prev, [currentId]: prev[currentId].slice(0, prev[currentId].length - 1) }));
    setLineupFutures(prev => ({ ...prev, [currentId]: [currentSnapshot, ...(prev[currentId] || [])].slice(0, 50) }));
    
    isRestoringHistory.current = true;
    
    setLineupName(last.lineupName);
    setTeamName(last.teamName);
    setPlayerScale(last.playerScale);
    setNameTagStyle(last.nameTagStyle);
    setNameDisplayMode(last.nameDisplayMode);
    setShowNameBackground(last.showNameBackground);
    setNameBackgroundType(last.nameBackgroundType);
    setShowPhoto(last.showPhoto);
    setShowName(last.showName ?? true);
    setShowNumber(last.showNumber);
    setTeamLogoUrl(last.teamLogoUrl);
    setPitchType(last.pitchType);
    setPlayers(JSON.parse(JSON.stringify(last.players)));
    setTacticalPlayers(JSON.parse(JSON.stringify(last.tacticalPlayers || last.players)));
    setFootballPos(last.footballPos ? { ...last.footballPos } : null);
    setFootballScale(last.footballScale || 1);
    setOpponents(JSON.parse(JSON.stringify(last.opponents)));
    setTacticalDrawings(JSON.parse(JSON.stringify(last.tacticalDrawings)));
    setShowOpponents(last.showOpponents);
    setOpponentColor(last.opponentColor || '#ef4444');
    setCurrentFormation(last.formation);
    setHasUnsavedChanges(true);

    // Reset the flag after state updates have settled
    setTimeout(() => {
      isRestoringHistory.current = false;
    }, 100);
  }, [currentId, history, lineupName, teamName, playerScale, nameTagStyle, nameDisplayMode, showNameBackground, nameBackgroundType, showPhoto, showName, showNumber, teamLogoUrl, pitchType, orientation, attackDirection, players, footballPos, footballScale, opponents, tacticalDrawings, showOpponents, opponentColor, currentFormation]);

  const handleRedo = useCallback(() => {
    const futures = lineupFutures[currentId] || [];
    if (futures.length === 0 || isRestoringHistory.current) return;
    
    // Save current state to history before redoing
    const currentSnapshot = {
      lineupName,
      teamName,
      playerScale,
      nameTagStyle,
      nameDisplayMode,
      showNameBackground,
      nameBackgroundType,
      showPhoto,
      showName,
      showNumber,
      teamLogoUrl,
      pitchType,
      players: JSON.parse(JSON.stringify(players)),
      tacticalPlayers: JSON.parse(JSON.stringify(tacticalPlayers)),
      footballPos: footballPos ? { ...footballPos } : null,
      footballScale: footballScale || 1,
      opponents: JSON.parse(JSON.stringify(opponents)),
      tacticalDrawings: JSON.parse(JSON.stringify(tacticalDrawings)),
      showOpponents,
      opponentColor,
      formation: currentFormation
    };
    
    const next = futures[0];
    setLineupFutures(prev => ({ ...prev, [currentId]: prev[currentId].slice(1) }));
    setLineupHistories(prev => ({ ...prev, [currentId]: [...(prev[currentId] || []), currentSnapshot].slice(-50) }));
    
    isRestoringHistory.current = true;
    
    setLineupName(next.lineupName);
    setTeamName(next.teamName);
    setPlayerScale(next.playerScale);
    setNameTagStyle(next.nameTagStyle);
    setNameDisplayMode(next.nameDisplayMode);
    setShowNameBackground(next.showNameBackground);
    setNameBackgroundType(next.nameBackgroundType);
    setShowPhoto(next.showPhoto);
    setShowName(next.showName ?? true);
    setShowNumber(next.showNumber);
    setTeamLogoUrl(next.teamLogoUrl);
    setPitchType(next.pitchType);
    setPlayers(JSON.parse(JSON.stringify(next.players)));
    setTacticalPlayers(JSON.parse(JSON.stringify(next.tacticalPlayers || next.players)));
    setFootballPos(next.footballPos ? { ...next.footballPos } : null);
    setFootballScale(next.footballScale || 1);
    setOpponents(JSON.parse(JSON.stringify(next.opponents)));
    setTacticalDrawings(JSON.parse(JSON.stringify(next.tacticalDrawings)));
    setShowOpponents(next.showOpponents);
    setOpponentColor(next.opponentColor || '#ef4444');
    setCurrentFormation(next.formation);
    setHasUnsavedChanges(true);

    // Reset the flag after state updates have settled
    setTimeout(() => {
      isRestoringHistory.current = false;
    }, 100);
  }, [currentId, lineupFutures, lineupName, teamName, playerScale, nameTagStyle, nameDisplayMode, showNameBackground, nameBackgroundType, showPhoto, showName, showNumber, teamLogoUrl, pitchType, orientation, attackDirection, players, footballPos, footballScale, opponents, tacticalDrawings, showOpponents, opponentColor, currentFormation]);

  const handleSelectLineupWithHistory = useCallback((id: string) => {
    if (id === lineup?.id) {
      pushHistory();
      setTacticalPlayers(players.map(p => ({ ...p })));
      setTacticalDrawings([]);
      setFootballPos(null);
      setOpponents([]);
      setHasUnsavedChanges(true);
      return;
    }
    onSelectLineup(id);
  }, [lineup?.id, onSelectLineup, players]);

  const fieldRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  // Tactical Board Handlers
  const transformCoords = (clientX: number, clientY: number) => {
    if (!fieldRef.current) return { x: 0, y: 0 };
    const rect = fieldRef.current.getBoundingClientRect();
    let x = ((clientX - rect.left) / rect.width) * 100;
    let y = ((clientY - rect.top) / rect.height) * 100;

    // Map screen relative coordinates back to pitch coordinates based on rotation
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
    return { x, y };
  };

  const handleTacticalStart = (e: React.PointerEvent) => {
    if (!isMaximized || !fieldRef.current) return;
    const { x, y } = transformCoords(e.clientX, e.clientY);

    if (tacticalTool === 'ball') {
      pushHistory();
      setFootballPos({ x, y });
      setDraggingBall(true);
      return;
    }
    if (tacticalTool === 'move') {
      // First check if we're clicking a resize handle of a selected drawing
      if (selectedDrawingId) {
        const draw = tacticalDrawings.find(d => d.id === selectedDrawingId);
        if (draw) {
          if (draw.type === 'circle' || draw.type === 'rectangle' || draw.type === 'square') {
             // Resize handle check (near the bottom right of the "bounding box" or edge)
             const dist = Math.hypot(draw.points[1].x - x, draw.points[1].y - y);
             if (dist < 5) {
                setIsTransforming('resize');
                setTransformStart({ x, y, initialPoints: [...draw.points] });
                return;
             }
          } else if (draw.type === 'text') {
             // For text, resizing is harder to define without a box, maybe just move for now
             // Or allow resizing via a handle near the text
          }
        }
      }

      // Detect if we're clicking a drawing to select or move
      const clickedDrawing = tacticalDrawings.slice().reverse().find(d => {
        if (d.type === 'text') {
           return Math.hypot(d.points[0].x - x, d.points[0].y - y) < 8;
        }
        if (d.type === 'circle') {
           const radiusSVG = Math.sqrt(Math.pow(d.points[0].x - d.points[1].x, 2) + Math.pow((d.points[0].y - d.points[1].y) / pitchAspectRatio, 2));
           const dx = x - d.points[0].x;
           const dy = (y - d.points[0].y) / pitchAspectRatio;
           const distToCenter = Math.sqrt(dx*dx + dy*dy);
           return distToCenter < radiusSVG * 1.1; // Clicked inside or near edge
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
        setIsTransforming('move');
        setTransformStart({ x, y, initialPoints: JSON.parse(JSON.stringify(clickedDrawing.points)) });
      } else {
        setSelectedDrawingId(null);
      }
      return;
    }

    if (tacticalTool === 'opponent') {
      pushHistory();
      const newOpponent = { id: Math.random().toString(36).substr(2, 9), x, y };
      setOpponents(prev => [...prev, newOpponent]);
      return;
    }

    if (tacticalTool === 'eraser') {
      pushHistory();
      // Find and remove clicked drawing
      setTacticalDrawings(prev => prev.filter(d => {
        if (d.type === 'text') {
           // Click near center of text
           return Math.hypot(d.points[0].x - x, d.points[0].y - y) > 5;
        }
        if (d.type === 'circle') {
           // Click near edge of circle, accounting for aspect ratio distortion
           const rx = Math.hypot(d.points[0].x - d.points[1].x, d.points[0].y - d.points[1].y);
           const ry = rx * pitchAspectRatio;
           const dx = x - d.points[0].x;
           const dy = y - d.points[0].y;
           const dist = Math.sqrt(Math.pow(dx / rx, 2) + Math.pow(dy / ry, 2));
           return Math.abs(dist - 1) > 0.2; // Tolerance for clicking on the line
        }
        if (d.type === 'rectangle' || d.type === 'square') {
           const xMin = Math.min(d.points[0].x, d.points[1].x);
           const xMax = Math.max(d.points[0].x, d.points[1].x);
           const yMin = Math.min(d.points[0].y, d.points[1].y);
           const yMax = Math.max(d.points[0].y, d.points[1].y);
           const inside = x >= xMin - 2 && x <= xMax + 2 && y >= yMin - 2 && y <= yMax + 2;
           return !inside;
        }
        return !d.points.some((p: any) => Math.hypot(p.x - x, p.y - y) < 3);
      }));;
      // Also remove opponents if clicked near
      setOpponents(prev => prev.filter(o => Math.hypot(o.x - x, o.y - y) > 5));
      // Remove football if clicked near
      if (footballPos && Math.hypot(footballPos.x - x, footballPos.y - y) < 5 * footballScale) {
        setFootballPos(null);
      }
      setHasUnsavedChanges(true);
      return;
    }

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
      setHasUnsavedChanges(true);
      return;
    }

    setIsDrawing(true);
    setCurrentPath([{ x, y }]);
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

  const handleTacticalMove = (e: React.PointerEvent) => {
    if (!isMaximized || !fieldRef.current) return;
    const { x, y } = transformCoords(e.clientX, e.clientY);

    if (draggingBall) {
      setFootballPos({ x, y });
      return;
    }

    if (draggingOpponentId) {
      setOpponents(prev => prev.map(o => o.id === draggingOpponentId ? { ...o, x, y } : o));
      return;
    }

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
        } else if (isTransforming === 'resize') {
          if (d.type === 'circle') {
             // For circle, points[0] is center, points[1] defines radius
             // Here we just update points[1]
             const newPoints = [d.points[0], { x, y }];
             return { ...d, points: newPoints };
          }
          if (d.type === 'rectangle') {
             const newPoints = [d.points[0], { x, y }];
             return { ...d, points: newPoints };
          }
          if (d.type === 'square') {
             const constrained = constrainSquare(d.points[0], { x, y });
             const newPoints = [d.points[0], constrained];
             return { ...d, points: newPoints };
          }
        }
        return d;
      }));
      setHasUnsavedChanges(true);
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

  const handleTacticalEnd = () => {
    if (isDrawing) {
      if (currentPath.length > 1) {
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
        setHasUnsavedChanges(true);
      }
      setIsDrawing(false);
      setCurrentPath([]);
    }
    if (draggingBall || draggingOpponentId) {
      setHasUnsavedChanges(true);
    }
    setIsTransforming(null);
    setTransformStart(null);
    clearLongPress();
    setDraggingBall(false);
    setDraggingOpponentId(null);
  };

  const clearTactical = () => {
    pushHistory();
    setTacticalDrawings([]);
    setFootballPos(null);
    setOpponents([]);
    setTacticalPlayers(JSON.parse(JSON.stringify(players)));
    setHasUnsavedChanges(true);
  };

  const handleCloseTacticalRequest = () => {
    const modified = isTacticalBoardModified();

    if (modified) {
      setShowSaveOnCloseModal(true);
    } else {
      // Clean and close directly
      clearTactical();
      setIsMaximized(false);
      setShowSavedLineups(true);
      setShowBenchMaximized(false);
      setShowZoomMenu(false);
    }
  };

  const handleSaveAndExitTactical = () => {
    const nameToUse = exitBoardName.trim() || `Taktisk ritning ${new Date().toLocaleDateString('sv-SE')}`;
    
    const newBoard: TacticalSavedBoard = {
      id: Math.random().toString(36).substring(2, 9),
      name: nameToUse,
      createdAt: Date.now(),
      drawings: JSON.parse(JSON.stringify(tacticalDrawings)),
      opponents: JSON.parse(JSON.stringify(opponents)),
      players: JSON.parse(JSON.stringify(tacticalPlayers)),
      footballPos: footballPos ? { ...footballPos } : null,
      footballScale,
      showOpponents,
      opponentColor,
      pitchType,
    };

    const currentSaved = lineup.savedTacticalBoards || [];
    const updatedLineup = {
      ...lineup,
      savedTacticalBoards: [newBoard, ...currentSaved]
    };

    onUpdateLineup(updatedLineup);
    
    // Clear live view and exit
    clearTactical();
    setIsMaximized(false);
    setShowSavedLineups(true);
    setShowBenchMaximized(false);
    setShowZoomMenu(false);
    
    setShowSaveOnCloseModal(false);
    setExitBoardName('');
  };

  const handleDiscardAndExitTactical = () => {
    // Clear live view without saving and exit
    clearTactical();
    setIsMaximized(false);
    setShowSavedLineups(true);
    setShowBenchMaximized(false);
    setShowZoomMenu(false);
    
    setShowSaveOnCloseModal(false);
    setExitBoardName('');
  };



  // Use refs for dragging to keep event listeners stable and avoid re-binding performance hits
  const dragInfoRef = useRef<{ id: string; x: number; y: number; hoveredId: string | null } | null>(null);
  const lastInteractionTimeRef = useRef<number>(0);

  // Global listeners for dragging - Optimized for performance
  useEffect(() => {
    if (!draggingId) {
      dragInfoRef.current = null;
      return;
    }

    // Initialize drag info
    const initialPlayer = players.find(p => p.id === draggingId);
    if (initialPlayer) {
      dragInfoRef.current = { 
        id: draggingId, 
        x: initialPlayer.x, 
        y: initialPlayer.y, 
        hoveredId: null 
      };
    }

    const handlePointerMove = (e: PointerEvent) => {
      if (!fieldRef.current || !dragInfoRef.current) return;
      
      const rect = fieldRef.current.getBoundingClientRect();
      const rawVX = ((e.clientX - rect.left) / rect.width) * 100;
      const rawVY = ((e.clientY - rect.top) / rect.height) * 100;

      let rawX, rawY;
      if (orientation === 'landscape') {
        if (attackDirection === 'right') {
          rawX = rawVY;
          rawY = 100 - rawVX;
        } else { // left
          rawX = 100 - rawVY;
          rawY = rawVX;
        }
      } else if (attackDirection === 'down') {
        rawX = 100 - rawVX;
        rawY = 100 - rawVY;
      } else {
        rawX = rawVX;
        rawY = rawVY;
      }

      // Clamped coordinates for the "ghost" position on field
      // Use 2 decimal places to avoid jitter and excessive state updates
      const x = Number(Math.max(2, Math.min(98, rawX)).toFixed(2));
      const y = Number(Math.max(2, Math.min(98, rawY)).toFixed(2));

      // Swap detection: Find closest starter player within radius
      let closestId = null;
      let minDistance = 4; // Further reduced radius (from 6) to avoid accidental "sucking"

      activePlayers.forEach(p => {
        if (p.id === draggingId || p.isSubstitute) return;
        
        const dx = rawX - p.x;
        const dy = rawY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < minDistance) {
          minDistance = dist;
          closestId = p.id;
        }
      });

      // Update ref and state
      dragInfoRef.current.x = x;
      dragInfoRef.current.y = y;
      dragInfoRef.current.hoveredId = closestId;
      
      // Update visual states for rendering
      setDragPos({ x, y });
      setHoveredPlayerId(closestId);
    };

    const handlePointerUp = (e: PointerEvent) => {
      const info = dragInfoRef.current;
      if (draggingId && info) {
        if (!fieldRef.current) return;
        const rect = fieldRef.current.getBoundingClientRect();
        
        const isInFieldX = e.clientX >= rect.left && e.clientX <= rect.right;
        const isInFieldY = e.clientY >= rect.top && e.clientY <= rect.bottom;
        
        const targetId = info.hoveredId;
        
        if (targetId) {
          // --- SWAP LOGIC ---
          pushHistory();
          
          setActivePlayers((prev: LineupPlayer[]) => {
            const dPlayer = prev.find(p => p.id === draggingId);
            const tPlayer = prev.find(p => p.id === targetId);
            
            if (!dPlayer || !tPlayer) return prev;
            const isSubstReplacement = dPlayer.isSubstitute || dPlayer.isHolding;

            return prev.map(p => {
              if (p.id === draggingId) {
                return { ...p, isSubstitute: false, x: tPlayer.x, y: tPlayer.y, isHolding: false };
              }
              if (p.id === targetId) {
                if (isSubstReplacement) {
                  return { ...p, isSubstitute: true, isHolding: false };
                } else {
                  return { ...p, x: dPlayer.x, y: dPlayer.y, isHolding: false };
                }
              }
              return p;
            });
          });
        } else if (isInFieldX && isInFieldY) {
          pushHistory();
          setActivePlayers((prev: LineupPlayer[]) => prev.map(p => 
            p.id === draggingId 
              ? { ...p, isSubstitute: false, x: info.x, y: info.y, isHolding: false } 
              : p
          ));
        } else {
          pushHistory();
          setActivePlayers((prev: LineupPlayer[]) => prev.map(p => 
            p.id === draggingId ? { ...p, isSubstitute: true, isHolding: false } : p
          ));
        }
        setHasUnsavedChanges(true);
      }
      
      lastInteractionTimeRef.current = Date.now();
      setDraggingId(null);
      setDragPos(null);
      setHoveredPlayerId(null);
      dragInfoRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingId, players, tacticalPlayers, isMaximized, pushHistory]);

  useEffect(() => {
    // Ignore internal prop updates for 2 seconds after a local change
    // This solves the "sliding back" issue where a stale parent update overwrites the local drop position
    const timeSinceInteraction = Date.now() - lastInteractionTimeRef.current;
    if (isRestoringHistory.current || draggingId || timeSinceInteraction < 2000 || hasUnsavedChanges) {
      if (!draggingId && timeSinceInteraction >= 2000 && !hasUnsavedChanges) {
        isRestoringHistory.current = false;
      }
      return;
    }
    if (lineup) {
      setLineupName(prev => {
        if (prev !== lineup.matchTitle) return lineup.matchTitle;
        return prev;
      });
      setTeamName(prev => {
        if (prev !== (lineup.teamName || '')) return lineup.teamName || '';
        return prev;
      });
      setPlayers(prev => {
        const deduplicated = Array.from(new Map((lineup.players || []).map(p => [p.id, p])).values());
        if (JSON.stringify(prev) !== JSON.stringify(deduplicated)) return deduplicated;
        return prev;
      });
      setPlayerScale(prev => {
        if (prev !== lineup.playerScale) return lineup.playerScale || 1;
        return prev;
      });
      setNameTagStyle(prev => {
         const style = lineup.nameTagStyle || 'light';
         if (prev !== style) return style;
         return prev;
      });
      setNameDisplayMode(prev => {
        const mode = lineup.nameDisplayMode || 'first';
        if (prev !== mode) return mode;
        return prev;
      });
      setShowNameBackground(prev => {
        const show = lineup.showNameBackground ?? true;
        if (prev !== show) return show;
        return prev;
      });
      setNameBackgroundType(prev => {
        const type = lineup.nameBackgroundType || 'classic';
        if (prev !== type) return type;
        return prev;
      });
      setShowPhoto(prev => {
        const show = lineup.showPhoto ?? true;
        if (prev !== show) return show;
        return prev;
      });
      setShowNumber(prev => {
        const show = lineup.showNumber ?? true;
        if (prev !== show) return show;
        return prev;
      });
      setTeamLogoUrl(prev => {
        if (prev !== (lineup.teamLogoUrl || '')) return lineup.teamLogoUrl || '';
        return prev;
      });
      setPitchType(prev => {
        const type = lineup.pitchType || 'classic';
        if (prev !== type) return type;
        return prev;
      });
      setCurrentFormation(prev => {
        const form = lineup.formation || '';
        if (prev !== form) return form;
        return prev;
      });

      // Update tactical board from remote data if different
      setTacticalDrawings(prev => {
        const remote = lineup.tacticalBoard?.drawings || [];
        if (JSON.stringify(prev) !== JSON.stringify(remote)) return remote;
        return prev;
      });
      setFootballPos(prev => {
        const remote = lineup.tacticalBoard?.footballPos || null;
        if (JSON.stringify(prev) !== JSON.stringify(remote)) return remote;
        return prev;
      });
      setOpponents(prev => {
        const remote = lineup.tacticalBoard?.opponents || [];
        if (JSON.stringify(prev) !== JSON.stringify(remote)) return remote;
        return prev;
      });
      setShowOpponents(prev => {
        const remote = lineup.tacticalBoard?.showOpponents ?? true;
        if (prev !== remote) return remote;
        return prev;
      });

      setTeamNotes(prev => {
        const remote = lineup.notes?.team?.text || '';
        if (prev !== remote) return remote;
        return prev;
      });
      setTeamMedia(prev => {
        const remote = lineup.notes?.team?.media || [];
        if (JSON.stringify(prev) !== JSON.stringify(remote)) return remote;
        return prev;
      });
      setOpponentNotes(prev => {
        const remote = lineup.notes?.opponent?.text || '';
        if (prev !== remote) return remote;
        return prev;
      });
      setOpponentMedia(prev => {
        const remote = lineup.notes?.opponent?.media || [];
        if (JSON.stringify(prev) !== JSON.stringify(remote)) return remote;
        return prev;
      });
    } else {
      setLineupName('');
      setTeamName('');
      setPlayers([]);
      setPlayerScale(1);
      setNameTagStyle('light');
      setNameDisplayMode('first');
      setShowNameBackground(true);
      setNameBackgroundType('classic');
      setShowPhoto(true);
      setShowNumber(true);
      setTeamLogoUrl('');
      setPitchType('classic');
      setCurrentFormation('');
    }
  }, [lineup, hasUnsavedChanges]);

  // Separate effect to handle "Reset" when unsaved changes was set to false by auto-save
  useEffect(() => {
    if (!lineup || !hasUnsavedChanges) return;

    const currentNotes = {
      team: { text: teamNotes, media: teamMedia },
      opponent: { text: opponentNotes, media: opponentMedia }
    };
    const currentTactical = {
      drawings: tacticalDrawings,
      footballPos,
      footballScale,
      opponents,
      showOpponents,
      opponentColor,
      players: tacticalPlayers
    };

    const isStillDifferent = 
      lineup.matchTitle !== lineupName ||
      (lineup.teamName || '') !== teamName ||
      lineup.playerScale !== playerScale ||
      lineup.nameTagStyle !== nameTagStyle ||
      lineup.nameDisplayMode !== nameDisplayMode ||
      lineup.showNameBackground !== showNameBackground ||
      lineup.nameBackgroundType !== nameBackgroundType ||
      lineup.showPhoto !== showPhoto ||
      lineup.showName !== showName ||
      lineup.showNumber !== showNumber ||
      lineup.teamLogoUrl !== teamLogoUrl ||
      lineup.formation !== currentFormation ||
      lineup.pitchType !== pitchType ||
      JSON.stringify(lineup.players || []) !== JSON.stringify(players) ||
      JSON.stringify(lineup.tacticalBoard || {}) !== JSON.stringify(currentTactical) ||
      JSON.stringify(lineup.notes || {}) !== JSON.stringify(currentNotes);

    if (!isStillDifferent) {
      setHasUnsavedChanges(false);
    }
  }, [lineup, lineupName, teamName, players, playerScale, nameTagStyle, nameDisplayMode, showNameBackground, nameBackgroundType, currentFormation, showPhoto, showName, showNumber, teamLogoUrl, pitchType, orientation, attackDirection, tacticalDrawings, footballPos, footballScale, opponents, showOpponents, opponentColor, tacticalPlayers, teamNotes, teamMedia, opponentNotes, opponentMedia, hasUnsavedChanges]);

  // Auto-save changes back to the parent
  useEffect(() => {
    if (!lineup) return;
    
    // Create current state object for comparison
    const currentState: Lineup = {
      ...lineup,
      matchTitle: lineupName,
      teamName,
      players,
      playerScale,
      nameTagStyle,
      nameDisplayMode,
      showNameBackground,
      nameBackgroundType,
      showPhoto,
      showName,
      showNumber,
      teamLogoUrl,
      pitchType,
      orientation: lineup.orientation,
      attackDirection: lineup.attackDirection,
      formation: currentFormation,
      notes: {
        team: { text: teamNotes, media: teamMedia },
        opponent: { text: opponentNotes, media: opponentMedia }
      },
      tacticalBoard: {
        drawings: tacticalDrawings,
        footballPos,
        footballScale,
        opponents,
        showOpponents,
        opponentColor,
        players: tacticalPlayers
      }
    };

    // Skip if current local state is identical to what we got from props
    // This prevents the "ping-pong" effect when receiving remote updates
    const remoteTactical = {
      drawings: lineup.tacticalBoard?.drawings || [],
      footballPos: lineup.tacticalBoard?.footballPos || null,
      footballScale: lineup.tacticalBoard?.footballScale || 1,
      opponents: lineup.tacticalBoard?.opponents || [],
      showOpponents: lineup.tacticalBoard?.showOpponents ?? true,
      opponentColor: lineup.tacticalBoard?.opponentColor || '#ef4444',
      players: lineup.tacticalBoard?.players || []
    };

    const remoteNotes = {
      team: { 
        text: lineup.notes?.team?.text || '', 
        media: lineup.notes?.team?.media || [] 
      },
      opponent: { 
        text: lineup.notes?.opponent?.text || '', 
        media: lineup.notes?.opponent?.media || [] 
      }
    };

    const isDifferent = 
      lineup.matchTitle !== lineupName ||
      (lineup.teamName || '') !== teamName ||
      lineup.playerScale !== playerScale ||
      lineup.nameTagStyle !== nameTagStyle ||
      lineup.nameDisplayMode !== nameDisplayMode ||
      lineup.showNameBackground !== showNameBackground ||
      lineup.nameBackgroundType !== nameBackgroundType ||
      lineup.showPhoto !== showPhoto ||
      lineup.showName !== showName ||
      lineup.showNumber !== showNumber ||
      lineup.teamLogoUrl !== teamLogoUrl ||
      lineup.formation !== currentFormation ||
      pitchType !== (lineup.pitchType || 'classic') ||
      JSON.stringify(lineup.players || []) !== JSON.stringify(players) ||
      JSON.stringify(remoteTactical) !== JSON.stringify(currentState.tacticalBoard) ||
      JSON.stringify(remoteNotes) !== JSON.stringify(currentState.notes);

    // If local state matches props exactly, we handle the unsaved changes state
    if (!isDifferent) {
      if (hasUnsavedChanges) {
        console.log("LineupBuilder: Local matches prop, clearing unsaved changes flag.");
        setHasUnsavedChanges(false);
      }
      return;
    }

    if (!hasUnsavedChanges) return;

    const timeout = setTimeout(() => {
      onUpdateLineup({
        ...currentState,
        date: Date.now() // Set new date only when actually pushing changes
      });
    }, 400); // Reduced from 800ms to 400ms for extra fast auto-save
    
    return () => {
      clearTimeout(timeout);
      // Flush changes ONLY when unmounting or switching to a different lineup
      // to avoid triggering parent updates on every single micro-render/drag step.
      if (hasUnsavedChanges && (!lineup || lineup.id !== currentIdRef.current)) {
        onUpdateLineup({
          ...currentState,
          date: Date.now()
        });
      }
    };
  }, [lineupName, teamName, players, tacticalPlayers, playerScale, nameTagStyle, nameDisplayMode, showNameBackground, nameBackgroundType, currentFormation, showPhoto, showName, showNumber, teamLogoUrl, pitchType, orientation, attackDirection, tacticalDrawings, footballPos, footballScale, opponents, showOpponents, opponentColor, teamNotes, teamMedia, opponentNotes, opponentMedia, lineup?.id, hasUnsavedChanges]);

  const applyFormation = (variant: FormationVariant) => {
    pushHistory();
    setCurrentFormation(variant.name);

    const onField = starters;
    if (onField.length === 0) return;

    // Identify Goalkeeper: The specific player with the highest Y (closest to bottom)
    const gkIndex = onField.reduce((prevIdx, curr, currIdx, arr) => {
      const prev = arr[prevIdx];
      return curr.y > prev.y ? currIdx : prevIdx;
    }, 0);

    const gk = onField[gkIndex];
    const others = onField.filter((_, idx) => idx !== gkIndex);

    // Sort others by their current Y (to preserve general role: Def -> Mid -> Att)
    others.sort((a, b) => {
      const yDiff = b.y - a.y; 
      if (Math.abs(yDiff) > 10) return yDiff;
      return a.x - b.x; // Left to right
    });

    const newPlayers = [...players];
    
    // Position GK (either from variant.gkPosition or default central bottom)
    const gkInNew = newPlayers.find(p => p.id === gk.id);
    if (gkInNew) {
      if (variant.gkPosition) {
        gkInNew.x = variant.gkPosition.x;
        gkInNew.y = variant.gkPosition.y;
      } else {
        gkInNew.x = 50;
        gkInNew.y = 94;
      }
    }

    // Position others based on variant positions
    others.forEach((p, idx) => {
      if (idx < variant.positions.length) {
        const pInNew = newPlayers.find(lp => lp.id === p.id);
        if (pInNew) {
          pInNew.x = variant.positions[idx].x;
          pInNew.y = variant.positions[idx].y;
        }
      }
    });

    setActivePlayers(newPlayers);
    setShowFormationModal(false);
    setHasUnsavedChanges(true);
  };

  const applyOpponentFormation = (variant: FormationVariant) => {
    pushHistory();
    
    // Create exactly 11 opponent circles
    const newOpponents: { id: string, x: number, y: number }[] = [];
    
    // 1. Goalkeeper (Opponent's perspective: flipped according to custom formation if defined, else central top)
    if (variant.gkPosition) {
      newOpponents.push({
        id: Math.random().toString(36).substr(2, 9),
        x: 100 - variant.gkPosition.x,
        y: 100 - variant.gkPosition.y
      });
    } else {
      newOpponents.push({
        id: Math.random().toString(36).substr(2, 9),
        x: 50,
        y: 6 
      });
    }

    // 2. Outfield players (Flipped coordinates)
    variant.positions.forEach(pos => {
      newOpponents.push({
        id: Math.random().toString(36).substr(2, 9),
        x: 100 - pos.x, // Flip x to preserve left/right from opponent view
        y: 100 - pos.y
      });
    });

    setOpponents(newOpponents);
    setShowOpponentFormationModal(false);
    setShowOpponents(true);
    setHasUnsavedChanges(true);
    setTacticalTool('move'); // Switch back to move for convenience
  };

  const handleMediaUpload = async (file: File, type: 'team' | 'opponent') => {
    if (!file || !lineup?.id) return;
    setIsUploadingMedia(true);
    setUploadError(null);
    try {
      // 1MB limit for safety if we were using firestore, but Storage handles more.
      // However, we check file size just in case.
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("Filen är för stor (max 5MB)");
      }

      const fileRef = ref(storage, `lineups/${lineup.id}/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      if (type === 'team') {
        setTeamMedia(prev => [...prev, url]);
      } else {
        setOpponentMedia(prev => [...prev, url]);
      }
      setHasUnsavedChanges(true);
    } catch (err: any) {
      console.error("Error uploading media:", err);
      setUploadError(err.message || "Ett fel uppstod vid uppladdning av filen.");
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleMediaDelete = async (url: string, type: 'team' | 'opponent') => {
    if (!url) return;
    
    // Optimistically update local state
    if (type === 'team') {
      setTeamMedia(prev => prev.filter(m => m !== url));
    } else {
      setOpponentMedia(prev => prev.filter(m => m !== url));
    }
    setHasUnsavedChanges(true);

    try {
      // Create a reference from the URL
      // Firebase Storage SDK allows creating a ref directly from a download URL
      const fileRef = ref(storage, url);
      await deleteObject(fileRef);
    } catch (err) {
      console.error("Error deleting media from storage:", err);
      // We don't necessarily want to revert local state if storage fails (e.g. file already gone)
      // but we log it for debugging.
    }
  };

  const handleSaveCurrentAsFormation = () => {
    if (!newFormationName.trim() || !onSaveCustomFormation) return;

    const onField = starters;
    if (onField.length !== 11) {
      alert("Du måste ha exakt 11 spelare på planen för att spara en formation.");
      return;
    }

    // GK is the one with highest Y
    const gkIndex = onField.reduce((prevIdx, curr, currIdx, arr) => {
      const prev = arr[prevIdx];
      return curr.y > prev.y ? currIdx : prevIdx;
    }, 0);

    const gk = onField[gkIndex];
    const outfield = onField.filter((_, idx) => idx !== gkIndex);
    
    // Sort outfield for consistency (optional)
    outfield.sort((a, b) => {
      const yDiff = b.y - a.y;
      if (Math.abs(yDiff) > 10) return yDiff;
      return a.x - b.x;
    });

    const newFormation: FormationVariant = {
      id: crypto.randomUUID(),
      name: newFormationName.trim(),
      description: `Egen formation skapad ${new Date().toLocaleDateString('sv-SE')}`,
      positions: outfield.map(p => ({ x: p.x, y: p.y })),
      gkPosition: { x: gk.x, y: gk.y }
    };

    onSaveCustomFormation(newFormation);
    setNewFormationName('');
    setShowSaveFormation(false);
    setCurrentFormation(newFormation.name);
    setHasUnsavedChanges(true);
  };

  // Save the current tactical board state as a named preset
  const handleSaveTacticalBoard = () => {
    if (!newSavedBoardName.trim()) return;
    
    const newBoard: TacticalSavedBoard = {
      id: Math.random().toString(36).substring(2, 9),
      name: newSavedBoardName.trim(),
      createdAt: Date.now(),
      drawings: JSON.parse(JSON.stringify(tacticalDrawings)),
      opponents: JSON.parse(JSON.stringify(opponents)),
      players: JSON.parse(JSON.stringify(tacticalPlayers)),
      footballPos: footballPos ? { ...footballPos } : null,
      footballScale,
      showOpponents,
      opponentColor,
      pitchType,
    };

    const currentSaved = lineup.savedTacticalBoards || [];
    const updatedLineup = {
      ...lineup,
      savedTacticalBoards: [newBoard, ...currentSaved]
    };

    onUpdateLineup(updatedLineup);
    setNewSavedBoardName('');
    
    // Update the snapshot so they can exit without prompt immediately after saving
    updateTacticalSnapshot(
      tacticalDrawings,
      opponents,
      tacticalPlayers,
      footballPos,
      footballScale,
      showOpponents,
      opponentColor,
      pitchType
    );

    setHasUnsavedChanges(true);
  };

  // Load a saved tactical board preset
  const handleLoadTacticalBoard = (board: TacticalSavedBoard) => {
    pushHistory();
    const newDrawings = JSON.parse(JSON.stringify(board.drawings || []));
    const newOpponents = JSON.parse(JSON.stringify(board.opponents || []));
    const newPlayers = JSON.parse(JSON.stringify(board.players || []));
    const newFootballPos = board.footballPos ? { ...board.footballPos } : null;
    const newFootballScale = board.footballScale !== undefined ? board.footballScale : footballScale;
    const newShowOpponents = board.showOpponents ?? true;
    const newOpponentColor = board.opponentColor || opponentColor;
    const newPitchType = board.pitchType || pitchType;

    setTacticalDrawings(newDrawings);
    setOpponents(newOpponents);
    setTacticalPlayers(newPlayers);
    setFootballPos(newFootballPos);
    setFootballScale(newFootballScale);
    setShowOpponents(newShowOpponents);
    setOpponentColor(newOpponentColor);
    if (newPitchType) setPitchType(newPitchType as any);
    
    // Update the snapshot so they can exit without prompt if they make no new modifications
    updateTacticalSnapshot(
      newDrawings,
      newOpponents,
      newPlayers,
      newFootballPos,
      newFootballScale,
      newShowOpponents,
      newOpponentColor,
      newPitchType
    );

    setHasUnsavedChanges(true);
    setShowTacticalSavedBoardsModal(false);
  };

  // Delete a saved tactical board preset
  const handleDeleteTacticalBoard = (boardId: string) => {
    const currentSaved = lineup.savedTacticalBoards || [];
    const updatedLineup = {
      ...lineup,
      savedTacticalBoards: currentSaved.filter(b => b.id !== boardId)
    };

    onUpdateLineup(updatedLineup);
    setHasUnsavedChanges(true);
  };

  const toggleArchive = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const targetLineup = lineups.find(l => l.id === id);
    if (targetLineup) {
      onUpdateLineup({
        ...targetLineup,
        isArchived: !targetLineup.isArchived
      });
    }
  };

  const handleSave = (title: string = tempTitle, team: string = tempTeamName) => {
    const idToUpdate = editingLineupId || lineup?.id;
    
    if (!idToUpdate) {
      const newLineup: Lineup = {
        id: crypto.randomUUID(),
        matchTitle: title || 'Ny Laguppställning',
        teamName: team || 'Ditt Lag',
        date: Date.now(),
        players: [],
        playerScale: 1,
        nameTagStyle: 'light',
        notes: {
          team: { text: teamNotes, media: teamMedia },
          opponent: { text: opponentNotes, media: opponentMedia }
        },
        tacticalBoard: {
          drawings: tacticalDrawings,
          footballPos,
          footballScale,
          opponents,
          showOpponents,
          opponentColor,
          players: tacticalPlayers
        }
      };
      onSaveLineup(newLineup);
      setLineupName(title || 'Ny Laguppställning');
      setTeamName(team || 'Ditt Lag');
      setIsEditingTitle(false);
      setEditingLineupId(null);
      return;
    }

    if (idToUpdate === lineup?.id) {
      setLineupName(title);
      setTeamName(team);
      setHasUnsavedChanges(true); // Let the auto-save effect handle the construction of the object
      setIsEditingTitle(false);
      setEditingLineupId(null);
    } else {
      const target = lineups.find(x => x.id === idToUpdate);
      if (target) {
        onUpdateLineup({
          ...target,
          matchTitle: title,
          teamName: team
        });
      }
      setIsEditingTitle(false);
      setEditingLineupId(null);
    }
  };

  const openTitleEditForLineup = (id: string, currentTitle: string, currentTeam: string) => {
    setEditingLineupId(id);
    setTempTitle(currentTitle);
    setTempTeamName(currentTeam);
    setIsEditingTitle(true);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setLogoToCrop(reader.result as string);
        setShowLogoPicker(true);
      });
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const handleCreateNew = () => {
    const newLineup: Lineup = {
      id: crypto.randomUUID(),
      matchTitle: 'Ny Laguppställning',
      date: Date.now(),
      players: [],
      playerScale: 1,
      nameTagStyle: 'light'
    };
    onSaveLineup(newLineup);
  };

  const handleImportPlayers = () => {
    if (!pastedText.trim()) return;

    const excludedWords = ['deltar ej', 'deltar', 'ej svarat', 'anmäld', 'reserv'];
    const lines = pastedText.split(/[\n,;]/);
    const namesToFind = lines
      .map(line => {
        let cleanName = line.trim();
        excludedWords.forEach(word => {
          const regex = new RegExp(word, 'gi');
          cleanName = cleanName.replace(regex, '');
        });
        return cleanName.trim();
      })
      .filter(name => name.length > 2); // Ignore very short strings

    const foundNames: string[] = [];
    const missingNames: string[] = [];
    const newPlayers: LineupPlayer[] = [...players];
    let changed = false;

    namesToFind.forEach(name => {
      // Try exact match first
      let match = squadPlayers.find(s => s.name.toLowerCase() === name.toLowerCase());
      
      // Try partial match if no exact match
      if (!match) {
        match = squadPlayers.find(s => 
          s.name.toLowerCase().includes(name.toLowerCase()) || 
          name.toLowerCase().includes(s.name.toLowerCase())
        );
      }

      if (match) {
        foundNames.push(match.name);
        const alreadyInLineup = newPlayers.find(p => p.playerId === match!.id);
        if (!alreadyInLineup) {
          newPlayers.push({
            id: crypto.randomUUID(),
            playerId: match.id,
            x: 50,
            y: 50,
            isSubstitute: false
          });
          changed = true;
        } else if (alreadyInLineup.isSubstitute) {
          // If already on bench, move to pitch
          alreadyInLineup.isSubstitute = false;
          alreadyInLineup.y = 50;
          changed = true;
        }
      } else {
        missingNames.push(name);
      }
    });

    if (changed) {
      pushHistory();
      setPlayers(newPlayers);
      setHasUnsavedChanges(true);
    }

    setImportResult({ found: foundNames, missing: missingNames });
    setPastedText('');
  };

  const togglePlayerInLineup = (playerId: string, isSubstitute: boolean) => {
    const existingPlayer = activePlayers.find(p => p.playerId === playerId);
    
    pushHistory();
    if (existingPlayer) {
      // If it exists but with different status, update status
      if (existingPlayer.isSubstitute !== isSubstitute) {
        setActivePlayers((prev: LineupPlayer[]) => prev.map(p => 
          p.playerId === playerId ? { ...p, isSubstitute } : p
        ));
      } else {
        // If it exists with same status, remove it
        setActivePlayers((prev: LineupPlayer[]) => prev.filter(p => p.playerId !== playerId));
      }
    } else {
      // Add new player correctly positioned
      const newPlayer: LineupPlayer = {
        id: crypto.randomUUID(),
        playerId,
        x: 50,
        y: isSubstitute ? 95 : 50,
        isSubstitute
      };
      setActivePlayers((prev: LineupPlayer[]) => [...prev, newPlayer]);
    }
    setHasUnsavedChanges(true);
  };

  const toggleSubstitute = (id: string) => {
    pushHistory();
    setActivePlayers((prev: LineupPlayer[]) => prev.map(p => 
      p.id === id ? { ...p, isSubstitute: !p.isSubstitute } : p
    ));
    setHasUnsavedChanges(true);
  };

  const removePlayer = (id: string) => {
    pushHistory();
    setActivePlayers((prev: LineupPlayer[]) => prev.filter(p => p.id !== id));
    setSelectedForEdit(null);
    setHasUnsavedChanges(true);
  };

  const handleReorderSubs = (newSubs: LineupPlayer[]) => {
    // Keep history for undo/redo
    // Note: Reorder triggers frequently, but pushHistory is memoized/guarded usually? 
    // Actually in TrainingManager it was pushed on each reorder.
    // However, if we want to avoid too many snapshots, we might need a debounce, 
    // but typically Framer Motion sorting is interactive.
    
    const starters = activePlayers.filter(p => !p.isSubstitute);
    setActivePlayers([...starters, ...newSubs]);
    setHasUnsavedChanges(true);
  };

  const updateSquadPlayerInfo = (playerId: string, updates: Partial<SquadPlayer>) => {
    onUpdateSquad(squad.map(p => p.id === playerId ? { ...p, ...updates } : p));
    setHasUnsavedChanges(true);
  };

  const getVisibleName = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    if (nameDisplayMode === 'first') return parts[0];
    if (nameDisplayMode === 'last') return parts.length > 1 ? parts[parts.length - 1] : parts[0];
    if (nameDisplayMode === 'initials') {
      const first = parts[0]?.[0] || '';
      const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
      return `${first}.${last}`.toUpperCase();
    }
    if (nameDisplayMode === 'firstLastInitial') {
      const first = parts[0] || '';
      const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1]?.[0] || ''}.` : '';
      return `${first}${lastInitial}`;
    }
    if (nameDisplayMode === 'initialLastName') {
      const firstInitial = parts[0]?.[0] ? `${parts[0][0]}. ` : '';
      const last = parts.length > 1 ? parts[parts.length - 1] : '';
      return last ? `${firstInitial}${last}` : (parts[0] || '');
    }
    return fullName;
  };

  const getSquadPlayer = (id: string) => squadPlayers.find(s => s.id === id);

  const calculateBestSpawnPosition = useCallback((currentPlayers: LineupPlayer[]) => {
    const corners = [
      { x: 8, y: 8 },    // Top Left
      { x: 92, y: 8 },   // Top Right
      { x: 8, y: 92 },   // Bottom Left
      { x: 92, y: 92 }   // Bottom Right
    ];
    let bestCorner = corners[0];
    let maxMinDistance = -1;

    corners.forEach(corner => {
      let minDistance = 999999;
      currentPlayers.forEach(p => {
        if (!p.isSubstitute) {
          const dx = p.x - corner.x;
          const dy = p.y - corner.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDistance) {
            minDistance = dist;
          }
        }
      });
      if (minDistance > maxMinDistance) {
        maxMinDistance = minDistance;
        bestCorner = corner;
      }
    });
    return bestCorner;
  }, []);
  
  const activePlayers = isMaximized ? tacticalPlayers : players;
  const setActivePlayers = isMaximized ? setTacticalPlayers : setPlayers;

  const validLineupPlayers = useMemo(() => {
    const uniqueIds = new Set<string>();
    const uniquePlayerIds = new Set<string>();
    return activePlayers.filter(p => {
      // Must be in squad
      if (!squadPlayers.some(s => s.id === p.playerId)) return false;
      // Must have unique instance ID to avoid map key collisions
      if (uniqueIds.has(p.id)) return false;
      // Also preserve "one per squad player" rule for UI logic
      if (uniquePlayerIds.has(p.playerId)) return false;
      
      uniqueIds.add(p.id);
      uniquePlayerIds.add(p.playerId);
      return true;
    });
  }, [activePlayers, squad]);

  const starters = useMemo(() => validLineupPlayers.filter(p => !p.isSubstitute), [validLineupPlayers]);
  const subs = useMemo(() => validLineupPlayers.filter(p => p.isSubstitute), [validLineupPlayers]);

  const renderLineupContent = (isSimplified: boolean = false, customRef?: React.Ref<HTMLDivElement>) => {
    // Standard international dimension ratios (105 x 68 meters)
    const pitchRatioW = 68;
    const pitchRatioH = 105;
    const R = pitchRatioH / pitchRatioW; // 1.5441176470588236
    const invR = pitchRatioW / pitchRatioH; // 0.6476190476190476
    const isFieldMaximized = isMaximized && !isSimplified;

    return (
      <div 
        ref={customRef || (isSimplified ? null : exportRef)} 
        id={isSimplified ? "preview-container" : "export-container"} 
        className={`transition-all ${
          isFieldMaximized 
            ? 'max-w-none bg-transparent border-none shadow-none rounded-[40px] !p-0 w-full' 
            : `bg-white dark:bg-zinc-900 border-y sm:border border-zinc-100 dark:border-zinc-800/80 rounded-none sm:rounded-3xl shadow-none sm:shadow-xl p-1 sm:p-4 mb-2 sm:mb-3 ${
                orientation === 'landscape' ? 'max-w-[1380px]' : 'max-w-3xl'
              } mx-auto w-full`
        } ${isSimplified ? 'w-full mx-auto' : ''}`}
        style={isSimplified ? { maxWidth: '1000px' } : undefined}
      >
        {/* Export Header - Title & Team Logo */}
        {(!isFieldMaximized) && (
          <div className="flex items-center justify-between mb-1 sm:mb-2 px-4 sm:px-2 pt-2 sm:pt-0">
            <div 
              className={`flex flex-col ${isSimplified ? '' : 'cursor-pointer group/title'}`}
              onClick={isSimplified ? undefined : () => {
                setTempTitle(lineupName);
                setTempTeamName(teamName);
                setIsEditingTitle(true);
              }}
            >
              <div className="flex flex-col gap-0.5">
                <h1 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white tracking-tight leading-none">
                  {teamName || 'Ditt Lag'}
                </h1>
                <h2 className="text-xs sm:text-sm font-bold text-zinc-500 dark:text-zinc-400 tracking-tight leading-none flex items-center gap-1.5 overflow-hidden mt-1">
                  <span className="whitespace-nowrap">{lineupName || 'Namnlös Match'}</span>
                  {!isSimplified && <Edit2 size={12} className="opacity-0 group-hover/title:opacity-100 transition-opacity" />}
                  {!isSimplified && (
                    <AnimatePresence>
                      {(hasUnsavedChanges || (user && sessionActionCount > 0) || isSyncing || isQuotaExceeded || syncError) && (
                        <motion.span
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          className={`inline-flex items-center gap-1.5 ml-2 text-[9px] font-black px-1.5 py-0.5 rounded-full border transition-all duration-300 ${
                            isQuotaExceeded || syncError
                              ? 'bg-red-500/10 text-red-500 border-red-500/20 dark:bg-red-500/20'
                              : isSyncing
                                ? 'bg-indigo-500/10 text-indigo-500 border-indigo-500/30 dark:bg-indigo-500/20 animate-pulse'
                                : 'bg-amber-500/10 text-amber-500 border-amber-500/20 dark:bg-amber-500/20'
                          }`}
                        >
                          {isQuotaExceeded ? (
                            <>
                              <CloudOff size={10} className="shrink-0" />
                              <span>Molngräns nådd</span>
                            </>
                          ) : syncError ? (
                            <>
                              <CloudOff size={10} className="shrink-0 text-red-500" />
                              <span className="max-w-[120px] truncate" title={syncError}>Synkfel</span>
                            </>
                          ) : isSyncing ? (
                            <>
                              <RefreshCw size={10} className="animate-spin shrink-0" />
                              <span>Synkar...</span>
                            </>
                          ) : (
                            <>
                              <Cloud size={10} className="shrink-0 animate-pulse text-amber-500" />
                              <span>Väntar...</span>
                            </>
                          )}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  )}
                </h2>
              </div>
              {(!lineupName && !teamName && !isSimplified) && (
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mt-2">Tryck för att ändra rubriker</span>
              )}
            </div>
            {/* Team Logo / Icon */}
            <div className="flex items-center gap-3">
              {!isSimplified && (
                <input
                  type="file"
                  ref={logoInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={handleLogoUpload}
                />
              )}
              <div className="text-right hidden xs:block">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{user?.displayName || 'Gäst'}</p>
              </div>
              <div className="relative group/logo">
                <div 
                  onClick={isSimplified ? undefined : () => logoInputRef.current?.click()}
                  className={`w-10 h-10 sm:w-12 sm:h-12 transition-all relative ${isSimplified ? '' : 'hover:scale-105 active:scale-95 cursor-pointer'}`}
                >
                  {teamLogoUrl ? (
                    <CachedImage src={teamLogoUrl} alt="Team Logo" className="w-full h-full object-contain border-0 outline-none select-none shadow-none ring-0" />
                  ) : user?.photoURL ? (
                    <CachedImage src={user.photoURL} alt="User Profile" className="w-full h-full rounded-full object-cover border border-zinc-200 dark:border-zinc-800" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl sm:rounded-2xl border-2 border-dashed border-indigo-200 dark:border-indigo-900/40">
                      <ImageIcon className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                  )}
                  {!isSimplified && (
                    <div className="absolute inset-0 bg-indigo-600/10 opacity-0 group-hover/logo:opacity-100 flex items-center justify-center transition-opacity rounded-xl sm:rounded-2xl">
                      <Upload size={14} className="text-indigo-600" />
                    </div>
                  )}
                </div>
                {teamLogoUrl && !isSimplified && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setTeamLogoUrl('');
                      setHasUnsavedChanges(true);
                      if (logoInputRef.current) logoInputRef.current.value = '';
                    }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white opacity-0 group-hover/logo:opacity-100 transition-opacity shadow-lg z-10 hover:bg-red-600 hover:scale-110 active:scale-90"
                    title="Ta bort logotyp"
                  >
                    <X size={10} strokeWidth={3} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Pitch and Bench Side-by-Side Flex Layout */}
        <div 
          className={`flex ${!isFieldMaximized && orientation === 'landscape' ? 'flex-col lg:flex-row gap-4 items-center lg:items-start justify-center' : 'flex-col'} w-full origin-top`}
          style={previewZoom !== 1 ? { zoom: previewZoom } : undefined}
        >
          {/* Pitch Container */}
          <div className={`${!isFieldMaximized && orientation === 'landscape' ? 'w-auto flex-shrink-0 flex justify-center' : 'w-full'} relative`}>
          {/* Tactical Toolbar for selected drawing */}
          {(selectedDrawingId || tacticalTool === 'eraser') && !isTransforming && (
            <div 
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onPointerMove={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="absolute -top-16 left-1/2 -translate-x-1/2 z-[110] flex items-center gap-2 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md px-4 py-2 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 animate-in fade-in slide-in-from-top-2 duration-300 pointer-events-auto"
            >
              {tacticalTool === 'eraser' ? (
                <>
                  <span className="text-xs font-bold text-orange-600 dark:text-orange-400 flex items-center gap-1.5 px-1 bg-orange-50/50 dark:bg-orange-950/20 py-1.5 rounded-xl border border-orange-200/50 dark:border-orange-900/40">
                    <Eraser size={14} className="text-orange-600" /> Suddgummi aktivt. Klicka på fribandslinjer, pilar eller figurer för att sudda.
                  </span>
                  <button 
                    onClick={() => {
                      pushHistory();
                      setTacticalDrawings([]);
                      setFootballPos(null);
                      setOpponents([]);
                      setSelectedDrawingId(null);
                      setHasUnsavedChanges(true);
                    }}
                    className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 hover:bg-red-100 transition-colors ml-2"
                    title="Radera allt ritat"
                  >
                    <Trash2 size={18} />
                  </button>
                  <button 
                    onClick={() => {
                      setSelectedDrawingId(null);
                      setTacticalTool('move');
                    }}
                    className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-indigo-600 transition-colors ml-1"
                    title="Avsluta suddgummi"
                  >
                    <X size={18} />
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 border-r border-zinc-200 dark:border-zinc-800 pr-2 mr-1">
                    {['#ffffff', '#ef4444', '#facc15'].map(color => (
                      <button 
                        key={color}
                        onClick={() => {
                          setTacticalColor(color);
                          setTacticalDrawings(prev => prev.map(d => d.id === selectedDrawingId ? { ...d, color } : d));
                          setHasUnsavedChanges(true);
                        }}
                        className={`w-6 h-6 rounded-full border-2 transition-transform active:scale-90 ${
                          tacticalDrawings.find(d => d.id === selectedDrawingId)?.color === color ? 'border-indigo-500 scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>

                  {tacticalDrawings.find(d => d.id === selectedDrawingId)?.type === 'text' && (
                    <button 
                      onClick={() => setEditingTextId(selectedDrawingId)}
                      className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-indigo-600 transition-colors"
                      title="Redigera text"
                    >
                      <Type size={18} />
                    </button>
                  )}

                  <div className="flex items-center gap-1 px-2 border-r border-zinc-200 dark:border-zinc-800 mr-1 text-zinc-400">
                    <button 
                      onClick={() => {
                        const drawing = tacticalDrawings.find(d => d.id === selectedDrawingId);
                        if (!drawing) return;
                        if (drawing.type === 'text') {
                          const newSize = Math.max(8, (drawing.fontSize || 16) - 2);
                          setTacticalFontSize(newSize);
                          setTacticalDrawings(prev => prev.map(d => d.id === selectedDrawingId ? { ...d, fontSize: newSize } : d));
                        } else {
                          const newWidth = Math.max(0.2, (drawing.lineWidth || 0.8) - 0.1);
                          setTacticalLineWidth(newWidth);
                          setTacticalDrawings(prev => prev.map(d => d.id === selectedDrawingId ? { ...d, lineWidth: newWidth } : d));
                        }
                        setHasUnsavedChanges(true);
                      }}
                      className="p-1 hover:text-zinc-600"
                    >
                       <Minus size={16} />
                    </button>
                    <span className="text-[10px] font-black w-6 text-center text-zinc-800 dark:text-zinc-200">
                      {(() => {
                        const drawing = tacticalDrawings.find(d => d.id === selectedDrawingId);
                        if (!drawing) return '0.8';
                        return drawing.type === 'text' 
                          ? Math.round(drawing.fontSize || 16) 
                          : (drawing.lineWidth || 0.8).toFixed(1);
                      })()}
                    </span>
                    <button 
                      onClick={() => {
                        const drawing = tacticalDrawings.find(d => d.id === selectedDrawingId);
                        if (!drawing) return;
                        if (drawing.type === 'text') {
                          const newSize = Math.min(48, (drawing.fontSize || 16) + 2);
                          setTacticalFontSize(newSize);
                          setTacticalDrawings(prev => prev.map(d => d.id === selectedDrawingId ? { ...d, fontSize: newSize } : d));
                        } else {
                          const newWidth = Math.min(5, (drawing.lineWidth || 0.8) + 0.1);
                          setTacticalLineWidth(newWidth);
                          setTacticalDrawings(prev => prev.map(d => d.id === selectedDrawingId ? { ...d, lineWidth: newWidth } : d));
                        }
                        setHasUnsavedChanges(true);
                      }}
                      className="p-1 hover:text-zinc-600"
                    >
                       <Plus size={16} />
                    </button>
                  </div>

                  <button 
                    onClick={() => {
                      setTacticalTool('eraser');
                    }}
                    className={`p-2 rounded-xl transition-colors ${
                      tacticalTool === 'eraser'
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'bg-orange-50 dark:bg-orange-900/10 text-orange-650 dark:text-orange-400 hover:bg-orange-100'
                    }`}
                    title="Aktivera suddgummi (Sudd-läge)"
                  >
                    <Eraser size={18} />
                  </button>

                  <button 
                    onClick={() => {
                      pushHistory();
                      clearTactical();
                      setSelectedDrawingId(null);
                    }}
                    className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 hover:bg-red-100 transition-colors"
                    title="Radera allt ritat"
                  >
                    <Trash2 size={18} />
                  </button>
                  
                  <button 
                    onClick={() => {
                      setSelectedDrawingId(null);
                    }}
                    className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-indigo-600 transition-colors ml-1"
                    title="Stäng inställningar"
                  >
                    <X size={18} />
                  </button>
                </>
              )}
            </div>
          )}

          {/* The Football Pitch */}
          <div 
            className={`football-pitch relative rounded-none sm:rounded-[40px] overflow-hidden border-y-[6px] border-x-0 sm:border-[8px] border-white/20 shadow-none sm:shadow-2xl transition-all duration-500 ${isFieldMaximized ? 'mb-0' : 'mb-0 sm:mb-3'} ${
              orientation === 'landscape'
                ? `aspect-[105/68] w-auto h-auto mx-auto ${
                    isFieldMaximized 
                      ? 'max-h-[calc(100vh-24px)] max-w-full lg:max-w-none' 
                      : ''
                  }`
                : `aspect-[68/105] w-auto h-auto mx-auto ${
                    isFieldMaximized 
                      ? 'max-h-[calc(100vh-24px)] max-w-full' 
                      : ''
                  }`
            } ${
              (pitchType === 'blue' || pitchType === 'solid-blue' || pitchType === 'blue-stripes' || pitchType === 'blue-grass') 
                ? 'bg-sky-300' 
                : pitchType === 'solid-white' 
                ? 'bg-white' 
                : pitchType === 'solid-black' 
                  ? 'bg-zinc-950' 
                  : 'bg-[#8dc343]'
            } ${(isFieldMaximized) ? (tacticalTool === 'move' ? 'cursor-default' : 'cursor-crosshair') + ' touch-none select-none' : ''}`}
            onPointerDown={isSimplified ? undefined : handleTacticalStart}
            onPointerMove={isSimplified ? undefined : handleTacticalMove}
            onPointerUp={isSimplified ? undefined : handleTacticalEnd}
            onPointerLeave={isSimplified ? undefined : handleTacticalEnd}
            style={{
              width: isFieldMaximized 
                ? (orientation === 'landscape' ? `min(98vw, calc((100vh - 24px) * ${R}))` : `min(98vw, calc((100vh - 24px) * ${invR}))`)
                : (orientation === 'landscape' 
                    ? `min(96vw, 1024px, calc((100vh - 160px) * ${R}))` 
                    : `min(100%, 680px, calc((100vh - 240px) * ${invR}))`),
              height: isFieldMaximized
                ? (orientation === 'landscape' ? `min(calc(98vw / ${R}), calc(100vh - 24px))` : `min(calc(98vw / ${invR}), calc(100vh - 24px))`)
                : (orientation === 'landscape' 
                    ? `min(calc(96vw / ${R}), 663px, calc(100vh - 160px))` 
                    : `min(calc(680px * ${R}), calc(100vh - 240px))`),
              aspectRatio: orientation === 'landscape' ? '105/68' : '68/105',
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

          {/* Inline Text Editor - Outside rotating layer to keep it readable */}
          {editingTextId && (
            <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/5 backdrop-blur-sm p-4">
              <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-sm mx-auto animate-in zoom-in duration-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600">
                    <Type size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase text-zinc-900 dark:text-white tracking-tight leading-none">Skriv på tavlan</h3>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase mt-1">Välj text och tryck på klar</p>
                  </div>
                  <button 
                    onClick={() => {
                      const d = tacticalDrawings.find(it => it.id === editingTextId);
                      if (d && !d.text) {
                        setTacticalDrawings(prev => prev.filter(it => it.id !== editingTextId));
                      }
                      setEditingTextId(null);
                    }}
                    className="ml-auto p-2 text-zinc-400 hover:text-zinc-600 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                <input 
                  autoFocus
                  type="text"
                  className="w-full px-5 py-4 rounded-2xl bg-zinc-100 dark:bg-zinc-800 border-2 border-transparent focus:border-indigo-600 focus:ring-0 text-base font-bold transition-all"
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
                <div className="grid grid-cols-2 gap-3 mt-6">
                  <button 
                    onClick={() => {
                      setTacticalDrawings(prev => prev.filter(it => it.id !== editingTextId));
                      setEditingTextId(null);
                    }}
                    className="py-4 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-black uppercase text-[10px] tracking-widest active:scale-95 transition-all"
                  >
                    Rensa
                  </button>
                  <button 
                    onClick={() => setEditingTextId(null)}
                    className="py-4 rounded-2xl bg-indigo-600 text-white font-black uppercase text-[10px] tracking-widest shadow-lg shadow-indigo-600/20 active:scale-95 transition-all"
                  >
                    Spara
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Main Container that rotates for landscape */}
          <div 
            ref={isSimplified ? null : fieldRef}
            className="absolute inset-0 transition-transform duration-500 origin-center"
            style={{
              width: orientation === 'landscape' ? `${(invR * 100).toFixed(6)}%` : '100%',
              height: orientation === 'landscape' ? `${(R * 100).toFixed(6)}%` : '100%',
              left: orientation === 'landscape' ? `${(((1 - invR) / 2) * 100).toFixed(6)}%` : '0',
              top: orientation === 'landscape' ? `${(((1 - R) / 2) * 100).toFixed(6)}%` : '0',
              transform: getPitchRotation()
            }}
          >
            {/* Tactical Drawing Layer */}
          {isMaximized && isDrawingsVisible && (
            <svg 
              className="absolute inset-0 z-40 pointer-events-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ width: '100%', height: '100%' }}
            >
              <defs>
                <marker id={`arrowhead-white-${markerSuffix}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="white" /></marker>
                <marker id={`arrowhead-red-${markerSuffix}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#ef4444" /></marker>
                <marker id={`arrowhead-yellow-${markerSuffix}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#facc15" /></marker>
              </defs>
              
              {/* Previous Drawings */}
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
                      fontSize={draw.fontSize / 3}
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
                      markerEnd={draw.type === 'freehand-arrow' ? `url(#arrowhead-${draw.color === '#ffffff' ? 'white' : draw.color === '#ef4444' ? 'red' : 'yellow'}-${markerSuffix})` : undefined}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : (
                    <line
                      x1={draw.points[0].x}
                      y1={draw.points[0].y}
                      x2={draw.points[1].x}
                      y2={draw.points[1].y}
                      stroke={draw.color}
                      strokeWidth={(draw.lineWidth || 0.8) * 4}
                      strokeDasharray={draw.lineType === 'dashed' ? "6, 4" : "none"}
                      markerEnd={`url(#arrowhead-${draw.color === '#ffffff' ? 'white' : draw.color === '#ef4444' ? 'red' : 'yellow'}-${markerSuffix})`}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  
                  {/* Selection Indicator */}
                  {selectedDrawingId === draw.id && tacticalTool === 'move' && (
                    <g className="pointer-events-none">
                      {draw.type === 'circle' && (
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
                          {/* Resize Handle */}
                          <circle 
                             cx={draw.points[1].x}
                             cy={draw.points[1].y}
                             r="1.2"
                             fill="white"
                             stroke="#6366f1"
                             strokeWidth="0.4"
                             className="pointer-events-auto cursor-nwse-resize"
                          />
                        </>
                      )}
                      {(draw.type === 'rectangle' || draw.type === 'square') && (
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
                          {/* Resize Handle */}
                          <circle 
                             cx={draw.points[1].x}
                             cy={draw.points[1].y}
                             r="1.2"
                             fill="white"
                             stroke="#6366f1"
                             strokeWidth="0.4"
                             className="pointer-events-auto cursor-nwse-resize"
                          />
                        </>
                      )}
                      {draw.type === 'text' && (
                        <rect 
                           x={draw.points[0].x - 4}
                           y={draw.points[0].y - 3}
                           width="8"
                           height="6"
                           fill="none"
                           stroke="#6366f1"
                           strokeWidth="1.5"
                           strokeDasharray="4, 3"
                           vectorEffect="non-scaling-stroke"
                           style={{ transform: `rotate(${getCounterRotation()})`, transformOrigin: `${draw.points[0].x}% ${draw.points[0].y}%` }}
                        />
                      )}
                    </g>
                  )}
                </g>
              ))}

              {/* Current Drawing */}
              {!isSimplified && isDrawing && currentPath.length > 1 && (
                <g>
                   {tacticalTool === 'circle' ? (
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
                   ) : (tacticalTool === 'rectangle' || tacticalTool === 'square') ? (
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
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={tacticalLineType === 'dashed' ? "6, 4" : "none"}
                      markerEnd={tacticalTool === 'freehand-arrow' ? `url(#arrowhead-${tacticalColor === '#ffffff' ? 'white' : tacticalColor === '#ef4444' ? 'red' : 'yellow'}-${markerSuffix})` : undefined}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : (
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
                  )}
                </g>
              )}

              {/* Automatically generated Delaunay Network (Passningsmöjligheter) */}
              {showDelaunayNetwork && starters.length >= 2 && (() => {
                const pointsList = starters.map(p => {
                  const isDragging = draggingId === p.id;
                  const displayX = isDragging && dragPos ? dragPos.x : p.x;
                  const displayY = isDragging && dragPos ? dragPos.y : p.y;
                  return { x: displayX, y: displayY, id: p.id };
                });
                
                const edges: { p1: number; p2: number }[] = [];
                const edgeKeySet = new Set<string>();

                const addEdge = (u: number, v: number) => {
                  const min = Math.min(u, v);
                  const max = Math.max(u, v);
                  const key = `${min}-${max}`;
                  if (!edgeKeySet.has(key)) {
                    edgeKeySet.add(key);
                    edges.push({ p1: min, p2: max });
                  }
                };

                // 1. Calculate Delaunay edges
                const delaunayEdges = getDelaunayTriangulation(pointsList);
                for (const edge of delaunayEdges) {
                  addEdge(edge.p1, edge.p2);
                }

                // 2. If standard, maximum, ultra or lanes, enrich/increase connections by connecting nearest neighbors or unblocked lines
                if (passingNetworkMode !== 'triangulation') {
                  if (passingNetworkMode === 'lanes') {
                    for (let i = 0; i < pointsList.length; i++) {
                      for (let j = i + 1; j < pointsList.length; j++) {
                        const pi = pointsList[i];
                        const pj = pointsList[j];
                        const dx = pi.x - pj.x;
                        const dy = pi.y - pj.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        
                        if (distance <= 65) {
                          let blocked = false;
                          for (let k = 0; k < pointsList.length; k++) {
                            if (k === i || k === j) continue;
                            const pk = pointsList[k];
                            const distToSeg = getDistanceToSegment(pk.x, pk.y, pi.x, pi.y, pj.x, pj.y);
                            if (distToSeg < 7.2) {
                              blocked = true;
                              break;
                            }
                          }
                          if (!blocked) {
                            addEdge(i, j);
                          }
                        }
                      }
                    }
                  } else {
                    const k = passingNetworkMode === 'ultra' ? 5 : passingNetworkMode === 'maximum' ? 4 : 3;
                    for (let i = 0; i < pointsList.length; i++) {
                      const pi = pointsList[i];
                      const distances = pointsList
                        .map((pj, j) => {
                          if (i === j) return { index: j, dist: Infinity };
                          const dx = pi.x - pj.x;
                          const dy = pi.y - pj.y;
                          return { index: j, dist: dx * dx + dy * dy };
                        })
                        .sort((a, b) => a.dist - b.dist);

                      // Add connections to the closest k teammates
                      for (let nIdx = 0; nIdx < Math.min(k, distances.length); nIdx++) {
                        const neighbor = distances[nIdx];
                        if (neighbor && neighbor.dist !== Infinity) {
                          addEdge(i, neighbor.index);
                        }
                      }
                    }
                  }
                }

                return (
                  <g className="pointer-events-none z-10">
                    {edges.map((edge, idx) => {
                      const p1 = pointsList[edge.p1];
                      const p2 = pointsList[edge.p2];
                      if (!p1 || !p2) return null;
                      return (
                        <line
                          key={`delaunay-edge-${idx}`}
                          x1={p1.x}
                          y1={p1.y}
                          x2={p2.x}
                          y2={p2.y}
                          stroke="#6366f1"
                          strokeWidth="0.55"
                          strokeOpacity={0.75}
                          strokeDasharray="2, 1.5"
                          className="animate-pulse"
                          style={{
                            animationDuration: '2.5s'
                          }}
                        />
                      );
                    })}
                  </g>
                );
              })()}
            </svg>
          )}

          {/* Opponents Layer */}
          {isMaximized && showOpponents && isDrawingsVisible && opponents.map((opp) => (
            <div 
              key={opp.id}
              className={`absolute z-40 transition-none select-none ${isSimplified ? '' : 'cursor-move'}`}
              onPointerDown={isSimplified ? undefined : (e) => handlePointerDownWithDeletion(e, 'opponent', opp.id)}
              onPointerUp={isSimplified ? undefined : clearLongPress}
              onPointerCancel={isSimplified ? undefined : clearLongPress}
              onPointerMove={isSimplified ? undefined : () => {
                if (draggingOpponentId === opp.id) {
                  clearLongPress();
                }
              }}
              style={{
                left: `${opp.x}%`,
                top: `${opp.y}%`,
                transform: `translate(-50%, -50%) rotate(${getCounterRotation()})`,
                width: `${playerScale * 50}px`,
                height: `${playerScale * 50}px`,
              }}
            >
              <div className="w-full h-full flex items-center justify-center">
                <Shirt 
                  size={playerScale * 40} 
                  style={{ color: opponentColor }}
                  fill="currentColor"
                  className="drop-shadow-md"
                />
              </div>
            </div>
          ))}

          {/* Football Icon */}
          {isMaximized && footballPos && isDrawingsVisible && (
            <div 
              className={`absolute z-50 transition-none select-none ${isSimplified ? '' : 'cursor-move'}`}
              onPointerDown={isSimplified ? undefined : (e) => handlePointerDownWithDeletion(e, 'ball')}
              onPointerUp={isSimplified ? undefined : clearLongPress}
              onPointerCancel={isSimplified ? undefined : clearLongPress}
              onPointerMove={isSimplified ? undefined : () => {
                if (draggingBall) {
                  clearLongPress();
                }
              }}
              style={{
                left: `${footballPos.x}%`,
                top: `${footballPos.y}%`,
                transform: `translate(-50%, -50%) rotate(${getCounterRotation()}) scale(${footballScale})`,
              }}
            >
              <div className="w-6 h-6 sm:w-8 sm:h-8 shadow-lg">
                <SoccerBallIcon className="w-full h-full text-zinc-900" />
              </div>
            </div>

          )}

          {/* Main Field Lines Inset */}
          <div className={`absolute top-[2%] bottom-[2%] left-[4%] right-[4%] border-2 pointer-events-none ${pitchType === 'solid-white' ? 'border-zinc-950/20' : 'border-white/50'}`} />
          <div className={`absolute top-1/2 left-[4%] right-[4%] h-[2px] ${pitchType === 'solid-white' ? 'bg-zinc-950/20' : 'bg-white/50'}`} />
          <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[25%] aspect-square border-2 rounded-full flex items-center justify-center ${pitchType === 'solid-white' ? 'border-zinc-950/20' : 'border-white/50'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${pitchType === 'solid-white' ? 'bg-zinc-950/20' : 'bg-white/50'}`} />
          </div>

          <div className={`absolute top-[2%] left-1/2 -translate-x-1/2 w-[55%] h-[14%] border-b-2 border-x-2 pointer-events-none ${pitchType === 'solid-white' ? 'border-zinc-950/20' : 'border-white/50'}`}>
            <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-[51%] h-[35%] border-b-2 border-x-2 ${pitchType === 'solid-white' ? 'border-zinc-950/20' : 'border-white/50'}`} />
            <div className={`absolute top-[65%] left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${pitchType === 'solid-white' ? 'bg-zinc-950/20' : 'bg-white/50'}`} />
          </div>
          <div className={`absolute top-[16%] left-1/2 -translate-x-1/2 w-[16%] h-[3%] border-b-2 rounded-b-full overflow-hidden pointer-events-none ${pitchType === 'solid-white' ? 'border-zinc-950/20' : 'border-white/50'}`} />
          
          <div className={`absolute bottom-[2%] left-1/2 -translate-x-1/2 w-[55%] h-[14%] border-t-2 border-x-2 pointer-events-none ${pitchType === 'solid-white' ? 'border-zinc-950/20' : 'border-white/50'}`}>
            <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-[51%] h-[35%] border-t-2 border-x-2 ${pitchType === 'solid-white' ? 'border-zinc-950/20' : 'border-white/50'}`} />
            <div className={`absolute bottom-[65%] left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${pitchType === 'solid-white' ? 'bg-zinc-950/20' : 'bg-white/50'}`} />
          </div>
          <div className={`absolute bottom-[16%] left-1/2 -translate-x-1/2 w-[16%] h-[3%] border-t-2 rounded-t-full overflow-hidden pointer-events-none ${pitchType === 'solid-white' ? 'border-zinc-950/20' : 'border-white/50'}`} />

          {/* Soccer Goal Nets & Perspective Posts (Simplified outside baseline) */}
          <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-0" viewBox="0 0 100 100" preserveAspectRatio="none">
            {/* TOP GOAL */}
            {/* Shading/Net depth */}
            <polygon
              points="44,2 56,2 55,0.2 45,0.2"
              fill={pitchType === 'solid-white' ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.05)"}
            />
            {/* Net back boundary wire */}
            <line x1="45" y1="0.2" x2="55" y2="0.2" stroke={pitchType === 'solid-white' ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.3)"} strokeWidth="0.12" />
            
            {/* Net connection lines */}
            <line x1="42.5" y1="0.8" x2="45" y2="0.2" stroke={pitchType === 'solid-white' ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.3)"} strokeWidth="0.12" />
            <line x1="57.5" y1="0.8" x2="55" y2="0.2" stroke={pitchType === 'solid-white' ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.3)"} strokeWidth="0.12" />
            <line x1="44" y1="2" x2="45" y2="0.2" stroke={pitchType === 'solid-white' ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.3)"} strokeWidth="0.12" />
            <line x1="56" y1="2" x2="55" y2="0.2" stroke={pitchType === 'solid-white' ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.3)"} strokeWidth="0.12" />

            {/* Solid Front Goal Posts & Crossbar */}
            {/* Crossbar */}
            <line x1="42.5" y1="0.8" x2="57.5" y2="0.8" stroke={pitchType === 'solid-white' ? "#18181b" : "#ffffff"} strokeWidth="0.35" strokeLinecap="round" />
            {/* Left Post (leans slightly inward to baseline bottom) */}
            <line x1="44" y1="2" x2="42.5" y2="0.8" stroke={pitchType === 'solid-white' ? "#18181b" : "#ffffff"} strokeWidth="0.35" strokeLinecap="round" />
            {/* Right Post (leans slightly inward to baseline bottom) */}
            <line x1="56" y1="2" x2="57.5" y2="0.8" stroke={pitchType === 'solid-white' ? "#18181b" : "#ffffff"} strokeWidth="0.35" strokeLinecap="round" />

            {/* BOTTOM GOAL */}
            {/* Shading/Net depth */}
            <polygon
              points="44,98 56,98 55,99.8 45,99.8"
              fill={pitchType === 'solid-white' ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.05)"}
            />
            {/* Net back boundary wire */}
            <line x1="45" y1="99.8" x2="55" y2="99.8" stroke={pitchType === 'solid-white' ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.3)"} strokeWidth="0.12" />
            
            {/* Net connection lines */}
            <line x1="42.5" y1="99.2" x2="45" y2="99.8" stroke={pitchType === 'solid-white' ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.3)"} strokeWidth="0.12" />
            <line x1="57.5" y1="99.2" x2="55" y2="99.8" stroke={pitchType === 'solid-white' ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.3)"} strokeWidth="0.12" />
            <line x1="44" y1="98" x2="45" y2="99.8" stroke={pitchType === 'solid-white' ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.3)"} strokeWidth="0.12" />
            <line x1="56" y1="98" x2="55" y2="99.8" stroke={pitchType === 'solid-white' ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.3)"} strokeWidth="0.12" />

            {/* Solid Front Goal Posts & Crossbar */}
            {/* Crossbar */}
            <line x1="42.5" y1="99.2" x2="57.5" y2="99.2" stroke={pitchType === 'solid-white' ? "#18181b" : "#ffffff"} strokeWidth="0.35" strokeLinecap="round" />
            {/* Left Post (leans slightly inward to baseline bottom) */}
            <line x1="44" y1="98" x2="42.5" y2="99.2" stroke={pitchType === 'solid-white' ? "#18181b" : "#ffffff"} strokeWidth="0.35" strokeLinecap="round" />
            {/* Right Post (leans slightly inward to baseline bottom) */}
            <line x1="56" y1="98" x2="57.5" y2="99.2" stroke={pitchType === 'solid-white' ? "#18181b" : "#ffffff"} strokeWidth="0.35" strokeLinecap="round" />
          </svg>

          {/* Draggable Players on Field */}
          <AnimatePresence>
            {starters.map((p) => {
              const sp = getSquadPlayer(p.playerId);
              if (!sp) return null;
              
              const isDragging = draggingId === p.id;
              const displayX = isDragging && dragPos ? dragPos.x : p.x;
              const displayY = isDragging && dragPos ? dragPos.y : p.y;

              return (
                <div
                  key={p.id}
                  data-player-id={p.id}
                  className={`absolute z-10 player-node group select-none transition-all ${
                    isSimplified ? '' : (isEditMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing')
                  } ${isDragging ? 'opacity-40 scale-90 pointer-events-none' : ''} ${hoveredPlayerId === p.id ? 'z-40' : ''} ${p.isHolding ? 'z-30' : ''}`}
                  style={{
                    left: `${displayX}%`,
                    top: `${displayY}%`,
                    touchAction: 'none',
                    transform: `translate(-50%, -50%) rotate(${getCounterRotation()})`,
                    transition: (isDragging || isSimplified || (Date.now() - lastInteractionTimeRef.current < 50)) ? 'none' : 'left 0.5s cubic-bezier(0.19, 1, 0.22, 1), top 0.5s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.3s ease, transform 0.3s ease'
                  }}
                  onPointerDown={isSimplified ? undefined : (e) => {
                    e.stopPropagation();
                    if (!isEditMode) {
                      if (p.isHolding) {
                        // Tapping/dragging the holding player immediately clears the holding state (amber highlight)
                        // so they become normally movable and stay exactly where placed.
                        pushHistory();
                        setActivePlayers((prev: LineupPlayer[]) => prev.map(lp => 
                          lp.id === p.id ? { ...lp, isHolding: false } : lp
                        ));
                        setHasUnsavedChanges(true);
                      }

                      // We completely removed the automatic onPointerDown swapping behavior
                      // that was causing subs to jump on top of the goalkeeper when clicking other players.
                      pushHistory();
                      setDraggingId(p.id);
                      setDragPos({ x: p.x, y: p.y });
                    }
                  }}
                  onClick={isSimplified ? undefined : (e) => {
                    e.stopPropagation();
                    if (isEditMode) {
                      setSelectedForEdit(p.id);
                    }
                  }}
                >
                  <div className="flex flex-col items-center">
                    <div className="relative">
                      {/* Highlight glow when being a drop target or in holding state */}
                      <AnimatePresence>
                        {(hoveredPlayerId === p.id || p.isHolding) && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ 
                              opacity: p.isHolding ? [0.4, 0.7, 0.4] : 1, 
                              scale: p.isHolding ? [1.2, 1.4, 1.2] : 1.5 
                            }}
                            transition={p.isHolding ? { repeat: Infinity, duration: 2 } : {}}
                            exit={{ opacity: 0, scale: 0.5 }}
                            className={`absolute inset-0 ${p.isHolding ? 'bg-amber-500/30 dark:bg-amber-400/30' : 'bg-indigo-500/20 dark:bg-indigo-400/20'} rounded-full blur-xl z-0`}
                          />
                        )}
                      </AnimatePresence>

                      <div 
                        className={`rounded-full border-2 bg-zinc-100 dark:bg-zinc-800 overflow-hidden shadow-2xl transition-all ${
                          !isSimplified && isEditMode 
                            ? 'border-indigo-500 ring-4 ring-indigo-500/20' 
                            : (hoveredPlayerId === p.id ? 'border-indigo-400 ring-4 ring-indigo-400/40 scale-110 shadow-indigo-200' : (p.isHolding ? 'border-amber-400 ring-4 ring-amber-400/40 shadow-lg' : 'border-white'))
                        } ${!isSimplified ? 'group-hover:scale-110' : ''}`}
                        style={{ 
                          width: `${3.5 * playerScale}rem`, 
                          height: `${3.5 * playerScale}rem`,
                          display: showPhoto ? 'flex' : 'none'
                        }}
                      >
                        {sp.photoUrl ? (
                          <CachedImage 
                            src={sp.photoUrl} 
                            alt={sp.name} 
                            className="w-full h-full object-cover pointer-events-none" 
                            decoding="async"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-blue-900 to-indigo-950 flex items-center justify-center text-white/50">
                            <User size={24 * playerScale} />
                          </div>
                        )}

                        {/* Swap indicator icon */}
                        {hoveredPlayerId === p.id && (() => {
                          const dPlayer = players.find(lp => lp.id === draggingId);
                          const isReplacement = dPlayer && (dPlayer.isSubstitute || dPlayer.isHolding);
                          return (
                            <div className="absolute inset-0 bg-indigo-600/60 backdrop-blur-[1px] flex flex-col items-center justify-center text-white p-2">
                              {isReplacement ? (
                                <>
                                  <ArrowUpRight size={28} className="animate-bounce" />
                                  <span className="text-[10px] font-bold uppercase leading-none mt-1">Byt in</span>
                                </>
                              ) : (
                                <>
                                  <RefreshCw size={28} className="animate-spin-slow" />
                                  <span className="text-[10px] font-bold uppercase leading-none mt-1">Skifta</span>
                                </>
                              )}
                            </div>
                          );
                        })()}

                        {!isSimplified && isEditMode && (
                          <div className="absolute inset-0 bg-indigo-600/20 flex items-center justify-center">
                            <Edit2 size={20 * playerScale} className="text-white" />
                          </div>
                        )}
                      </div>
                      {sp.number && showNumber && (
                        <div 
                          className="absolute bg-zinc-900 text-white rounded-full flex items-center justify-center font-black border-2 border-white shadow-lg"
                          style={{
                            width: `${1.5 * playerScale}rem`,
                            height: `${1.5 * playerScale}rem`,
                            fontSize: `${0.6 * playerScale}rem`,
                            bottom: showPhoto ? 0 : 'auto',
                            right: showPhoto ? 0 : 'auto',
                            top: !showPhoto ? '50%' : 'auto',
                            left: !showPhoto ? '50%' : 'auto',
                            transform: !showPhoto ? 'translate(-50%, -50%)' : 'none',
                            position: showPhoto ? 'absolute' : 'relative'
                          }}
                        >
                          {sp.number}
                        </div>
                      )}
                    </div>
                    {showName && (
                      <div className="mt-1">
                        <div 
                          className={`font-black text-center tracking-tight leading-tight transition-all flex flex-col items-center group/names ${
                            (nameBackgroundType === 'badge' || nameBackgroundType === 'transparent') ? (
                              `rounded-full px-2 py-0.5 shadow-md border ${
                                hoveredPlayerId === p.id 
                                  ? 'bg-indigo-600 text-white border-indigo-400 scale-105'
                                  : (nameTagStyle === 'dark' 
                                      ? (nameBackgroundType === 'transparent' ? 'bg-zinc-900/20 backdrop-blur-md text-white border-zinc-700/30' : 'bg-zinc-900 text-white border-zinc-800') 
                                      : (nameBackgroundType === 'transparent' ? 'bg-white/20 backdrop-blur-md text-black border-white/30' : 'bg-white text-black border-zinc-200'))
                              }`
                            ) : 'gap-0.5'
                          }`}
                          style={{
                            fontSize: `${0.6 * playerScale}rem`,
                            opacity: isDragging ? 0.3 : 1,
                          }}
                        >
                          {(() => {
                            const displayName = getVisibleName(sp.name);
                            const useSingleLine = ['initials', 'firstLastInitial', 'initialLastName'].includes(nameDisplayMode);
                            const parts = useSingleLine ? [displayName] : displayName.split(' ');
                            return parts.map((part, i) => (
                              <div 
                                key={i} 
                                className={`truncate whitespace-nowrap ${
                                  hoveredPlayerId === p.id ? 'text-white' : (
                                    nameBackgroundType === 'solid' ? (
                                      `px-1.5 ${nameTagStyle === 'dark' ? 'bg-zinc-900 text-white' : 'bg-white text-black shadow-sm'}`
                                    ) : 
                                    (nameBackgroundType === 'badge' || nameBackgroundType === 'transparent') ? '' : 
                                    (nameTagStyle === 'dark' ? 'text-zinc-900' : 'text-white drop-shadow-md')
                                  )
                                }`}
                              >
                                {part}
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Dragged Sub Overlay */}
            {draggingId && dragPos && !starters.some(p => p.id === draggingId) && (() => {
              const p = players.find(lp => lp.id === draggingId);
              const sp = p ? getSquadPlayer(p.playerId) : null;
              if (!p || !sp) return null;
              
              return (
                <div
                  className="absolute z-[100] player-node pointer-events-none"
                  style={{
                    left: `${dragPos.x}%`,
                    top: `${dragPos.y}%`,
                    transform: `translate(-50%, -50%) rotate(${getCounterRotation()}) scale(1.25)`,
                  }}
                >
                  <div className="flex flex-col items-center">
                    <div className="relative">
                      <div 
                        className="rounded-full border-2 border-indigo-400 bg-zinc-100 dark:bg-zinc-800 overflow-hidden shadow-2xl"
                        style={{ 
                          width: `${3.5 * playerScale}rem`, 
                          height: `${3.5 * playerScale}rem`,
                          display: showPhoto ? 'flex' : 'none'
                        }}
                      >
                        {sp.photoUrl ? (
                          <CachedImage src={sp.photoUrl} alt={sp.name} className="w-full h-full object-cover" decoding="async" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-blue-900 to-indigo-950 flex items-center justify-center text-white/50">
                            <User size={24 * playerScale} />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-1">
                      <div className="bg-indigo-600 text-white px-3 py-1 rounded-full shadow-lg border border-indigo-400">
                        <p className="font-black uppercase tracking-widest leading-none whitespace-nowrap" style={{ fontSize: `${0.6 * playerScale}rem` }}>
                          {sp.name}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </AnimatePresence>
          </div>
        </div>
      </div>

        {/* Bench Area */}
        {!isFieldMaximized && (
          <div className={`bench-container mb-0 ${orientation === 'landscape' ? 'w-full lg:w-[124px] lg:shrink-0 lg:max-h-[85vh] lg:overflow-y-auto no-scrollbar' : 'w-full'}`}>
            <Reorder.Group 
              axis={orientation === 'landscape' ? "y" : "x"}
              values={subs}
              onReorder={handleReorderSubs}
              className={`p-1.5 sm:p-3 bg-zinc-50 dark:bg-zinc-950 rounded-none sm:rounded-3xl border-y sm:border border-x-0 sm:border-x border-zinc-100 dark:border-zinc-800 transition-all ${
                orientation === 'landscape'
                  ? 'grid grid-cols-4 lg:flex lg:flex-col gap-2 lg:gap-4 justify-center lg:justify-start lg:items-center w-full lg:py-6'
                  : subs.length > 7 
                    ? 'grid grid-cols-4 sm:flex sm:flex-wrap justify-center gap-2 sm:gap-3' 
                    : 'flex flex-wrap justify-center gap-1.5 sm:gap-3'
              }`}
            >
              {subs.length === 0 ? (
                <p className="text-[10px] text-zinc-400 dark:text-zinc-600 italic py-4 text-center w-full">Inga avbytare...</p>
              ) : (
                subs.map(p => {
                  const sp = getSquadPlayer(p.playerId);
                  if (!sp) return null;
                  const isDragging = draggingId === p.id;
                  
                  return (
                    <Reorder.Item 
                      key={p.id} 
                      value={p}
                      className={`flex flex-col items-center gap-0 group transition-all ${isDragging ? 'opacity-0' : 'opacity-100'} ${isSimplified ? '' : 'cursor-grab active:cursor-grabbing'}`}
                      onClick={isSimplified ? undefined : (e) => {
                        e.stopPropagation();
                        if (isEditMode) {
                          setSelectedForEdit(p.id)
                        } else {
                          // Quick add to holding area on pitch
                          pushHistory();
                          setActivePlayers((prev: LineupPlayer[]) => {
                            // Any existing holding player gets deselected, but remains on the field!
                            const nextState = prev.map(lp => {
                              if (lp.id === p.id) {
                                return lp; // Clicked player
                              }
                              if (lp.isHolding) {
                                return { ...lp, isHolding: false };
                              }
                              return lp;
                            });

                            // Calculate best spawn corner based on current field starters
                            const spawnPos = calculateBestSpawnPosition(nextState);

                            return nextState.map(lp => {
                              if (lp.id === p.id) {
                                return { ...lp, isSubstitute: false, x: spawnPos.x, y: spawnPos.y, isHolding: true };
                              }
                              return lp;
                            });
                          });
                          setHasUnsavedChanges(true);
                        }
                      }}
                    >
                      <div className="relative">
                        <div 
                          className={`rounded-full border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-center overflow-hidden shadow-sm transition-all ${!isSimplified ? 'group-hover:scale-110' : ''}`}
                          style={{
                            width: `${3.0 * playerScale}rem`,
                            height: `${3.0 * playerScale}rem`,
                            display: showPhoto ? 'flex' : 'none'
                          }}
                        >
                          {sp.photoUrl ? (
                            <CachedImage 
                              src={sp.photoUrl} 
                              alt={sp.name} 
                              className="w-full h-full object-cover" 
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <div className="w-full h-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400">
                              <User size={20 * playerScale} />
                            </div>
                          )}
                        </div>
                        {sp.number && showNumber && (
                          <div 
                            className="absolute bg-zinc-900 text-white rounded-full flex items-center justify-center font-black border-2 border-white shadow-lg transition-all"
                            style={{
                              width: `${1.3 * playerScale}rem`,
                              height: `${1.3 * playerScale}rem`,
                              fontSize: `${0.55 * playerScale}rem`,
                              bottom: showPhoto ? 0 : 'auto',
                              right: showPhoto ? -2 : 'auto',
                              top: !showPhoto ? '50%' : 'auto',
                              left: !showPhoto ? '50%' : 'auto',
                              transform: !showPhoto ? 'translate(-50%, -50%)' : 'none',
                              position: showPhoto ? 'absolute' : 'relative',
                              zIndex: 10
                            }}
                          >
                            {sp.number}
                          </div>
                        )}
                      </div>
                      {showName && (
                        <div 
                          className="font-bold text-zinc-900 dark:text-white max-w-[70px] text-center leading-tight transition-all"
                          style={{
                            fontSize: `${0.55 * playerScale}rem`,
                            marginTop: `${0.2 * playerScale}rem`
                          }}
                        >
                          {(() => {
                            const displayName = getVisibleName(sp.name);
                            const useSingleLine = ['initials', 'firstLastInitial', 'initialLastName'].includes(nameDisplayMode);
                            const parts = useSingleLine ? [displayName] : displayName.split(' ');
                            return parts.map((part, i) => (
                              <div key={i} className="truncate whitespace-nowrap">{part}</div>
                            ));
                          })()}
                        </div>
                      )}
                    </Reorder.Item>
                  );
                })
              )}
            </Reorder.Group>
          </div>
        )}
        
        </div> {/* Close main side-by-side Flex Layout */}
      </div>
    );
  };

  return (
    <div 
      className={`mx-auto transition-all duration-500 w-full px-0 sm:px-6 ${isMaximized ? 'fixed inset-0 z-50 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-1 xs:p-2 md:p-3 overflow-hidden flex flex-col items-center justify-center' : 'max-w-[1600px] pt-0 sm:pt-4 pb-32'}`}
    >
      {isMaximized && (
        <>
          <div className="fixed top-3 left-3 right-3 z-[100] flex justify-end pointer-events-none">
            <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap scrollbar-none touch-pan-x py-1 px-2 pointer-events-auto max-w-full">
              <button
                onClick={() => setIsDrawingsVisible(!isDrawingsVisible)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-xl border transition-all flex-shrink-0 group pointer-events-auto ${
                  isDrawingsVisible
                    ? 'bg-amber-600 text-white border-amber-500 hover:bg-amber-700'
                    : 'bg-amber-600/10 text-amber-650 hover:bg-amber-600/20 border-amber-500/35'
                }`}
                title={isDrawingsVisible ? "Dölj ritat/placerat på planen" : "Visa ritat/placerat på planen"}
              >
                {isDrawingsVisible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <button
                onClick={() => setShowDelaunayNetwork(!showDelaunayNetwork)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-xl border transition-all flex-shrink-0 group pointer-events-auto ${
                  showDelaunayNetwork
                    ? 'bg-amber-600 text-white border-amber-500 hover:bg-amber-700'
                    : 'bg-amber-600/10 text-amber-650 hover:bg-amber-600/20 border-amber-500/35'
                }`}
                title={showDelaunayNetwork ? "Dölj passningsnät (Delaunay)" : "Visa passningsnät (Delaunay)"}
              >
                <Network size={16} />
              </button>
              <button
                onClick={() => {
                  const nextVisible = !isControlsVisible;
                  setIsControlsVisible(nextVisible);
                  if (nextVisible) {
                    setTacticalTool('pen');
                    setIsDrawingsVisible(true);
                  } else {
                    setTacticalTool('move');
                  }
                }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-xl border transition-all flex-shrink-0 group pointer-events-auto ${
                  isControlsVisible 
                    ? 'bg-amber-600 text-white border-amber-500 hover:bg-amber-700' 
                    : 'bg-amber-600/10 text-amber-650 hover:bg-amber-600/20 border-amber-500/35'
                }`}
                title={isControlsVisible ? "Dölj ritverktyg" : "Visa ritverktyg"}
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => setShowFormationModal(true)}
                className="w-8 h-8 bg-amber-600/10 text-amber-650 hover:bg-amber-600/20 border border-amber-500/35 rounded-lg flex items-center justify-center shadow-xl transition-all flex-shrink-0 group pointer-events-auto"
                title="Välj formation / positioner"
              >
                <Layout size={16} />
              </button>
              <button
                onClick={() => setShowNotesModal(true)}
                className="w-8 h-8 bg-amber-600/10 text-amber-650 hover:bg-amber-600/20 border border-amber-500/35 rounded-lg flex items-center justify-center shadow-xl transition-all flex-shrink-0 group pointer-events-auto"
                title="Anteckningar"
              >
                <ClipboardList size={16} />
              </button>
              <button
                onClick={() => setShowTacticalSavedBoardsModal(true)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-xl border transition-all flex-shrink-0 group pointer-events-auto ${
                  showTacticalSavedBoardsModal 
                    ? 'bg-amber-600 text-white border-amber-500 hover:bg-amber-700' 
                    : 'bg-amber-600/10 text-amber-650 hover:bg-amber-600/20 border-amber-500/35'
                }`}
                title="Spara / Öppna rittavlor"
              >
                <Bookmark size={16} />
              </button>
              <button
                onClick={() => {
                  const nextVal = !showSavedLineups;
                  setShowSavedLineups(nextVal);
                  if (nextVal) {
                    setShowBenchMaximized(false);
                    setShowZoomMenu(false);
                  }
                }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-xl border transition-all flex-shrink-0 group pointer-events-auto ${
                  showSavedLineups 
                    ? 'bg-amber-600 text-white border-amber-500 hover:bg-amber-700' 
                    : 'bg-amber-600/10 text-amber-650 hover:bg-amber-600/20 border-amber-500/35'
                }`}
                title={showSavedLineups ? "Dölj sparade laguppställningar" : "Visa sparade laguppställningar"}
              >
                <FolderOpen size={16} />
              </button>
              <button
                onClick={() => {
                  const nextVal = !showBenchMaximized;
                  setShowBenchMaximized(nextVal);
                  if (nextVal) {
                    setShowSavedLineups(false);
                    setShowZoomMenu(false);
                  }
                }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-xl border transition-all flex-shrink-0 group pointer-events-auto ${
                  showBenchMaximized 
                    ? 'bg-amber-600 text-white border-amber-500 hover:bg-amber-700' 
                    : 'bg-amber-600/10 text-amber-650 hover:bg-amber-600/20 border-amber-500/35'
                }`}
                title={showBenchMaximized ? "Dölj avbätare" : "Visa avbytare (Bänk)"}
              >
                <Shirt size={16} />
              </button>
              <button
                onClick={() => {
                  const nextVal = !showZoomMenu;
                  setShowZoomMenu(nextVal);
                  if (nextVal) {
                    setShowSavedLineups(false);
                    setShowBenchMaximized(false);
                  }
                }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-xl border transition-all flex-shrink-0 group pointer-events-auto ${
                  showZoomMenu 
                    ? 'bg-amber-600 text-white border-amber-500 hover:bg-amber-700' 
                    : 'bg-amber-600/10 text-amber-650 hover:bg-amber-600/20 border-amber-500/35'
                }`}
                title={showZoomMenu ? "Dölj inställningar & zoom" : "Visa inställningar & zoom"}
              >
                <Settings size={16} />
              </button>
              <button
                onClick={() => {
                  const newOrientation = orientation === 'vertical' ? 'landscape' : 'vertical';
                  setOrientation(newOrientation);
                  if (newOrientation === 'landscape') {
                    setAttackDirection('right');
                  } else {
                    setAttackDirection('up');
                  }
                }}
                className="w-8 h-8 bg-amber-600/10 text-amber-650 hover:bg-amber-600/20 border border-amber-500/35 rounded-lg flex items-center justify-center shadow-xl transition-all flex-shrink-0 group pointer-events-auto"
                title={orientation === 'landscape' ? "Byt till stående läge" : "Byt till liggande läge (TV)"}
              >
                {orientation === 'landscape' ? <Smartphone size={16} /> : <Monitor size={16} />}
              </button>
              <button
                onClick={handleCloseTacticalRequest}
                className="w-8 h-8 bg-amber-600/10 text-amber-650 hover:bg-amber-600/20 border border-amber-500/35 rounded-lg flex items-center justify-center shadow-xl transition-all flex-shrink-0 group pointer-events-auto"
                title="Lämna rittavlan"
              >
                <Minimize2 size={16} className="group-hover:rotate-12 transition-transform" />
              </button>
            </div>
          </div>

          {/* Floating Compact Lineups Menu under top right controls bar */}
          <AnimatePresence>
            {showSavedLineups && (
              <motion.div 
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="fixed top-14 right-3 z-[155] w-72 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-2 max-h-[60vh] overflow-y-auto scrollbar-thin pointer-events-auto font-sans"
              >
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2 mb-1">
                  <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider">Mina Laguppställningar</span>
                  <button 
                    onClick={() => setShowSavedLineups(false)}
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-250 transition-colors p-0.5 rounded"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[45vh] pr-0.5">
                  {lineups.filter(l => !l.isArchived).length === 0 ? (
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-650 italic p-2 text-center">Inga sparade laguppställningar än...</p>
                  ) : (
                    Array.from(new Map(lineups.filter(l => !l.isArchived).map(l => [l.id, l])).values()).map(l => {
                      const isSelected = l.id === lineup?.id;
                      return (
                        <button
                          key={l.id}
                          onClick={() => {
                            handleSelectLineupWithHistory(l.id);
                          }}
                          className={`p-2.5 rounded-xl border text-left transition-all flex items-center justify-between text-xs font-bold ${
                            isSelected
                              ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                              : 'bg-zinc-50 dark:bg-zinc-950/40 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border-zinc-200/50 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700'
                          }`}
                        >
                          <span className="truncate pr-2">{l.matchTitle || l.teamName || 'Namnlös Match'}</span>
                          <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded shrink-0 ${
                            isSelected 
                              ? 'bg-white/20 text-white' 
                              : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                          }`}>
                            {l.formation || 'Ingen'}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Floating Compact Zoom Menu under top right controls bar */}
          <AnimatePresence>
            {showZoomMenu && (
              <motion.div 
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="fixed top-14 right-3 z-[155] w-72 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-3.5 flex flex-col gap-3 pointer-events-auto font-sans"
              >
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider">Inställningar & Zoom</span>
                  <button 
                    onClick={() => setShowZoomMenu(false)}
                    className="text-zinc-400 hover:text-zinc-650 dark:hover:text-zinc-200 transition-colors p-0.5 rounded"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  {/* Field Zoom */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Spelplanens storlek (Zoom)</span>
                    <div className="flex items-center justify-between bg-zinc-50 dark:bg-black/20 p-1.5 rounded-xl border border-zinc-100 dark:border-zinc-800">
                      <button 
                        onClick={() => setFullScreenZoom(Math.max(0.2, fullScreenZoom - 0.1))}
                        className="w-8 h-8 flex items-center justify-center bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-all border border-zinc-200/50 dark:border-zinc-800"
                        title="Minska planens zoom"
                      >
                        <Minus size={14} />
                      </button>
                      <div className="flex flex-col items-center">
                        <span className="text-[11px] font-black text-zinc-900 dark:text-white">{Math.round(fullScreenZoom * 100)}%</span>
                        {fullScreenZoom !== 1 && (
                          <button 
                            onClick={() => setFullScreenZoom(1)}
                            className="text-[9px] text-indigo-600 dark:text-indigo-400 hover:underline font-semibold mt-0.5"
                          >
                            Återställ
                          </button>
                        )}
                      </div>
                      <button 
                        onClick={() => setFullScreenZoom(Math.min(3.0, fullScreenZoom + 0.1))}
                        className="w-8 h-8 flex items-center justify-center bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-all border border-zinc-200/50 dark:border-zinc-800"
                        title="Öka planens zoom"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Player Scale */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Spelarnas storlek</span>
                    <div className="flex items-center justify-between bg-zinc-50 dark:bg-black/20 p-1.5 rounded-xl border border-zinc-100 dark:border-zinc-800">
                      <button 
                        onClick={() => {
                          setPlayerScale(Math.max(0.5, playerScale - 0.05));
                          setHasUnsavedChanges(true);
                        }}
                        className="w-8 h-8 flex items-center justify-center bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-all border border-zinc-200/50 dark:border-zinc-800"
                        title="Minska spelarnas storlek"
                      >
                        <Minus size={14} />
                      </button>
                      <div className="flex flex-col items-center">
                        <span className="text-[11px] font-black text-zinc-900 dark:text-white">{Math.round(playerScale * 100)}%</span>
                        {playerScale !== 1 && (
                          <button 
                            onClick={() => {
                              setPlayerScale(1);
                              setHasUnsavedChanges(true);
                            }}
                            className="text-[9px] text-indigo-600 dark:text-indigo-400 hover:underline font-semibold mt-0.5"
                          >
                            Återställ
                          </button>
                        )}
                      </div>
                      <button 
                        onClick={() => {
                          setPlayerScale(Math.min(2.0, playerScale + 0.05));
                          setHasUnsavedChanges(true);
                        }}
                        className="w-8 h-8 flex items-center justify-center bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-all border border-zinc-200/50 dark:border-zinc-800"
                        title="Öka spelarnas storlek"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Passningsnätverk settings */}
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
                    <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Passningsnätverk (Kopplingar)</span>
                    <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-50 dark:bg-black/20 rounded-xl border border-zinc-100 dark:border-zinc-800">
                      <button
                        onClick={() => {
                          setPassingNetworkMode('triangulation');
                          setHasUnsavedChanges(true);
                        }}
                        className={`px-2 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all text-center leading-none ${
                          passingNetworkMode === 'triangulation'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                        }`}
                        title="Enbart Delaunay-triangulering"
                      >
                        Trianglar
                      </button>
                      <button
                        onClick={() => {
                          setPassingNetworkMode('standard');
                          setHasUnsavedChanges(true);
                        }}
                        className={`px-2 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all text-center leading-none ${
                          passingNetworkMode === 'standard'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                        }`}
                        title="Standard (trianglar + 3 närmaste)"
                      >
                        Standard (3)
                      </button>
                      <button
                        onClick={() => {
                          setPassingNetworkMode('maximum');
                          setHasUnsavedChanges(true);
                        }}
                        className={`px-2 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all text-center leading-none ${
                          passingNetworkMode === 'maximum'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                        }`}
                        title="Maximal (trianglar + 4 närmaste)"
                      >
                        Maximal (4)
                      </button>
                      <button
                        onClick={() => {
                          setPassingNetworkMode('ultra');
                          setHasUnsavedChanges(true);
                        }}
                        className={`px-2 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all text-center leading-none ${
                          passingNetworkMode === 'ultra'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                        }`}
                        title="Ultimat (trianglar + 5 närmaste)"
                      >
                        Ultimat (5)
                      </button>
                      <button
                        onClick={() => {
                          setPassingNetworkMode('lanes');
                          setHasUnsavedChanges(true);
                        }}
                        className={`col-span-2 px-2 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all text-center leading-none ${
                          passingNetworkMode === 'lanes'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                        }`}
                        title="Öppna Spelvägar (Korsande linjer tillåtna för alla fria passningskanaler)"
                      >
                        Öppna Spelvägar (Fritt)
                      </button>
                    </div>
                  </div>

                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Floating Compact Bench Dock in maximized mode */}
          <AnimatePresence>
            {showBenchMaximized && (
              <motion.div 
                initial={orientation === 'vertical' 
                  ? { opacity: 0, x: -40, y: '-50%' } 
                  : { opacity: 0, y: 30, x: '-50%' }}
                animate={orientation === 'vertical'
                  ? { opacity: 1, x: 0, y: '-50%' }
                  : { opacity: 1, y: 0, x: '-50%' }}
                exit={orientation === 'vertical'
                  ? { opacity: 0, x: -40, y: '-50%' }
                  : { opacity: 0, y: 30, x: '-50%' }}
                style={orientation === 'vertical' ? { top: '50%' } : undefined}
                className={orientation === 'vertical' 
                  ? "fixed left-4 z-[99] w-64 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col gap-3 pointer-events-auto font-sans max-h-[75vh]" 
                  : `fixed left-1/2 z-[99] w-[95vw] max-w-xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-2 pointer-events-auto font-sans transition-all duration-300 ${isControlsVisible ? 'bottom-40 md:bottom-36' : 'bottom-6'}`}
              >
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-1.5 px-1 bg-transparent">
                  <div className="flex items-center gap-1.5">
                    <Shirt size={14} className="text-indigo-600 dark:text-indigo-400" />
                    <span className="text-[10px] font-black uppercase text-zinc-500 dark:text-zinc-400 tracking-wider">Avbytarbänk ({subs.length})</span>
                  </div>
                  <button 
                    onClick={() => setShowBenchMaximized(false)}
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-0.5 rounded"
                  >
                    <X size={14} />
                  </button>
                </div>
                
                <div className={orientation === 'vertical' 
                  ? "flex flex-col gap-2 overflow-y-auto max-h-[60vh] pr-1.5 scrollbar-thin"
                  : "flex items-center gap-2 overflow-x-auto min-h-[64px] scrollbar-thin py-1 px-1"}
                >
                  {subs.length === 0 ? (
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-600 italic py-3 text-center w-full">Inga avbytare i den här laguppställningen...</p>
                  ) : (
                    subs.map(p => {
                      const sp = getSquadPlayer(p.playerId);
                      if (!sp) return null;
                      
                      return (
                        <button
                          key={p.id}
                          className={orientation === 'vertical'
                            ? "flex items-center gap-3 w-full px-3 py-2.5 rounded-2xl border border-zinc-100/50 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-950/20 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:border-zinc-200 dark:hover:border-zinc-700 transition-all active:scale-95 text-left"
                            : "flex flex-col items-center gap-1 shrink-0 px-2.5 py-1.5 rounded-xl border border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:border-zinc-200 dark:hover:border-zinc-700/50 transition-all active:scale-95"}
                          onClick={(e) => {
                            e.stopPropagation();
                            // Quick add to holding area on pitch
                            pushHistory();
                            setActivePlayers((prev: LineupPlayer[]) => {
                              // Any existing holding player gets deselected, but remains on the field!
                              const nextState = prev.map(lp => {
                                if (lp.id === p.id) {
                                  return lp; // Clicked player
                                }
                                if (lp.isHolding) {
                                  return { ...lp, isHolding: false };
                                }
                                return lp;
                              });

                              // Calculate best spawn corner based on current field starters
                              const spawnPos = calculateBestSpawnPosition(nextState);

                              return nextState.map(lp => {
                                if (lp.id === p.id) {
                                  return { ...lp, isSubstitute: false, x: spawnPos.x, y: spawnPos.y, isHolding: true };
                                }
                                return lp;
                              });
                            });
                            setHasUnsavedChanges(true);
                          }}
                        >
                          <div className="relative shrink-0">
                            <div 
                              className="rounded-full border border-zinc-200 dark:border-zinc-850 bg-white dark:bg-zinc-900 flex items-center justify-center overflow-hidden shadow-sm"
                              style={{
                                width: '2.5rem',
                                height: '2.5rem',
                                display: showPhoto ? 'flex' : 'none'
                              }}
                            >
                              {sp.photoUrl ? (
                                <CachedImage 
                                  src={sp.photoUrl} 
                                  alt={sp.name} 
                                  className="w-full h-full object-cover" 
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                <div className="w-full h-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400">
                                  <User size={16} />
                                </div>
                              )}
                            </div>
                            {sp.number && showNumber && (
                              <div 
                                className="absolute bg-zinc-900 text-white rounded-full flex items-center justify-center font-black border border-white shadow-sm z-10"
                                style={{
                                  width: '1.2rem',
                                  height: '1.2rem',
                                  fontSize: '0.5rem',
                                  bottom: showPhoto ? -2 : 'auto',
                                  right: showPhoto ? -2 : 'auto',
                                  top: !showPhoto ? '50%' : 'auto',
                                  left: !showPhoto ? '50%' : 'auto',
                                  transform: !showPhoto ? 'translate(-50%, -50%)' : 'none',
                                  position: showPhoto ? 'absolute' : 'relative',
                                }}
                              >
                                {sp.number}
                              </div>
                            )}
                          </div>
                          {orientation === 'vertical' ? (
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate">
                                {sp.name}
                              </span>
                              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mt-0.5">
                                Tryck för att sätta på plan
                              </span>
                            </div>
                          ) : (
                            <span className="text-[9px] font-bold text-zinc-700 dark:text-zinc-350 truncate max-w-[64px] text-center leading-tight">
                              {getVisibleName(sp.name)}
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isControlsVisible && (
              <motion.div 
                drag
                dragMomentum={false}
                dragControls={dragControls}
                dragListener={false}
                dragConstraints={{ 
                  left: -Math.max(0, window.innerWidth / 2 - 20), 
                  right: Math.max(0, window.innerWidth / 2 - 20),
                  top: -window.innerHeight + 150,
                  bottom: 20
                }}
                initial={{ opacity: 0, y: 50, x: '-50%' }}
                animate={{ opacity: 1, y: 0, x: '-50%' }}
                exit={{ opacity: 0, y: 50, x: '-50%' }}
                className="fixed bottom-10 left-1/2 z-[100] flex flex-col gap-3 p-3 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl rounded-[32px] border border-zinc-200 dark:border-zinc-800 shadow-2xl w-[95vw] max-w-2xl"
              >
            <div className="flex flex-col gap-3">
              {/* Row 1: Tools & Universal Settings */}
              <div className="w-full min-w-0 flex items-center gap-4 pb-0.5 overflow-x-auto touch-pan-x scrollbar-thin scrollbar-track-transparent scrollbar-thumb-zinc-700">
                <div className="flex items-center gap-1 shrink-0">
                  <div 
                    className="p-2 cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 touch-none"
                    onPointerDown={(e) => dragControls.start(e)}
                  >
                    <GripVertical size={20} />
                  </div>
                  
                  {/* Undo, Redo & Clear moved to the left */}
                  <div className="flex items-center gap-1 bg-black/5 dark:bg-black/20 p-1 rounded-xl mr-1">
                    <button 
                      onClick={handleUndo}
                      className={`p-2 rounded-lg transition-all ${history.length === 0 ? 'text-zinc-300 dark:text-zinc-800' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                      disabled={history.length === 0}
                      title="Ångra"
                    >
                      <Undo2 size={18} />
                    </button>
                    <button 
                      onClick={handleRedo}
                      className={`p-2 rounded-lg transition-all ${future.length === 0 ? 'text-zinc-300 dark:text-zinc-800' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                      disabled={future.length === 0}
                      title="Gör om"
                    >
                      <Redo2 size={18} />
                    </button>
                    <button 
                      onClick={clearTactical}
                      className="p-2 rounded-lg text-zinc-500 hover:text-red-500 hover:bg-red-500/10 transition-all font-bold"
                      title="Radera allt"
                    >
                      <Trash size={18} />
                    </button>
                  </div>

                  <button 
                    onClick={() => setTacticalTool('move')}
                    className={`p-2.5 rounded-xl transition-all ${tacticalTool === 'move' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title="Flyttläge"
                  >
                    <Move size={20} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => setTacticalTool('pen')}
                    className={`p-2.5 rounded-xl transition-all ${tacticalTool === 'pen' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title="Frihandspenna"
                  >
                    <Pencil size={20} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => setTacticalTool('arrow')}
                    className={`p-2.5 rounded-xl transition-all ${tacticalTool === 'arrow' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title="Dra pilar"
                  >
                    <ArrowUpRight size={20} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => setTacticalTool('freehand-arrow')}
                    className={`p-2.5 rounded-xl transition-all ${tacticalTool === 'freehand-arrow' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title="Frihandspil"
                  >
                    <Route size={20} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => setTacticalTool('circle')}
                    className={`p-2.5 rounded-xl transition-all ${tacticalTool === 'circle' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title="Rita cirkel"
                  >
                    <div className="w-5 h-5 rounded-full border-2 border-current" />
                  </button>
                  <button 
                    onClick={() => setTacticalTool('rectangle')}
                    className={`p-2.5 rounded-xl transition-all ${tacticalTool === 'rectangle' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title="Rita fyrkant"
                  >
                    <div className="w-5 h-5 border-2 border-current rounded-sm" />
                  </button>
                  <button 
                    onClick={() => setTacticalTool('text')}
                    className={`p-2.5 rounded-xl transition-all ${tacticalTool === 'text' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title="Skriv text"
                  >
                    <Type size={20} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => setTacticalTool('ball')}
                    className={`p-2.5 rounded-xl transition-all ${tacticalTool === 'ball' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title="Placera boll"
                  >
                    <SoccerBallIcon size={20} className={tacticalTool === 'ball' ? 'text-white' : 'text-zinc-500'} />
                  </button>
                  <button 
                    onClick={() => setTacticalTool('opponent')}
                    className={`p-2.5 rounded-xl transition-all ${tacticalTool === 'opponent' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title="Placera motståndare"
                  >
                    <Shirt size={20} strokeWidth={2.5} />
                  </button>
                  <button 
                    onClick={() => setTacticalTool('eraser')}
                    className={`p-2.5 rounded-xl transition-all ${tacticalTool === 'eraser' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title="Suddgummi"
                  >
                    <Eraser size={20} strokeWidth={2.5} />
                  </button>

                  <div className="h-6 w-[1px] bg-zinc-200 dark:bg-zinc-800 mx-1 shrink-0" />

                  <button 
                    onClick={() => setShowDelaunayNetwork(!showDelaunayNetwork)}
                    className={`p-2.5 rounded-xl transition-all ${showDelaunayNetwork ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title={showDelaunayNetwork ? "Dölj passningsnät (Delaunay)" : "Visa passningsnät (Delaunay)"}
                  >
                    <Network size={20} strokeWidth={2.5} />
                  </button>
                </div>






              </div>

              {/* Row 2: Contextual Settings & Actions */}
              <div className="w-full min-w-0 flex items-center gap-4 py-1 min-h-[52px] overflow-x-auto touch-pan-x scrollbar-thin scrollbar-track-transparent">
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
                          direction="up"
                          minimal={true}
                        />
                      </div>

                      {/* Tool Specific Settings */}
                      <div className="flex items-center gap-3">
                        {tacticalTool === 'text' ? (
                          <div className="flex flex-col gap-0.5">
                             <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Textstorlek</span>
                             <div className="flex items-center gap-2 bg-zinc-100 dark:bg-black/40 px-3 py-1.5 rounded-xl">
                               <button onClick={() => setTacticalFontSize(Math.max(8, tacticalFontSize - 2))} className="text-zinc-500 hover:text-white"><Minus size={12} /></button>
                               <span className="text-[10px] font-black text-zinc-900 dark:text-white min-w-4 text-center">{tacticalFontSize}</span>
                               <button onClick={() => setTacticalFontSize(Math.min(72, tacticalFontSize + 2))} className="text-zinc-500 hover:text-white"><Plus size={12} /></button>
                             </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                             <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Tjocklek</span>
                             <div className="flex items-center gap-2 bg-zinc-100 dark:bg-black/40 px-3 py-1.5 rounded-xl">
                               <button onClick={() => setTacticalLineWidth(Math.max(0.1, tacticalLineWidth - 0.1))} className="text-zinc-500 hover:text-white"><Minus size={12} /></button>
                               <span className="text-[10px] font-black text-zinc-900 dark:text-white min-w-4 text-center">{tacticalLineWidth.toFixed(1)}</span>
                               <button onClick={() => setTacticalLineWidth(Math.min(5, tacticalLineWidth + 0.1))} className="text-zinc-500 hover:text-white"><Plus size={12} /></button>
                             </div>
                          </div>
                        )}

                        {(tacticalTool === 'pen' || tacticalTool === 'arrow' || tacticalTool === 'freehand-arrow' || tacticalTool === 'circle' || tacticalTool === 'rectangle' || tacticalTool === 'square') && (
                          <div className="flex bg-zinc-100 dark:bg-black/40 p-1 rounded-xl">
                            <button 
                              onClick={() => setTacticalLineType('solid')}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${tacticalLineType === 'solid' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                            >
                              Hel
                            </button>
                            <button 
                              onClick={() => setTacticalLineType('dashed')}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${tacticalLineType === 'dashed' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
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
                        <div className="flex items-center gap-2 bg-zinc-100 dark:bg-black/40 px-3 py-1.5 rounded-xl">
                          <button onClick={() => setFootballScale(Math.max(0.5, footballScale - 0.1))} className="text-zinc-500 hover:text-white"><Minus size={12} /></button>
                          <span className="text-[10px] font-black text-zinc-900 dark:text-white min-w-4 text-center">{(footballScale * 100).toFixed(0)}%</span>
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
                            setHasUnsavedChanges(true);
                          }} 
                          direction="up"
                          minimal={true}
                        />
                      </div>

                      {/* Opponent Formation Button */}
                      <button 
                        onClick={() => setShowOpponentFormationModal(true)}
                        className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest shadow-lg flex items-center gap-2"
                      >
                        <Layout size={14} />
                        <span>Formation</span>
                      </button>

                      {/* Show/Hide Opponents */}
                      <button 
                        onClick={() => setShowOpponents(!showOpponents)}
                        className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border ${showOpponents ? 'bg-emerald-600/10 text-emerald-400 border-emerald-500/30' : 'bg-red-600/10 text-red-400 border-red-500/30'}`}
                      >
                        {showOpponents ? 'Dölj Motstånd' : 'Visa Motstånd'}
                      </button>
                    </motion.div>
                  )}

                  {tacticalTool === 'move' && (
                    <motion.div 
                      key="move-settings"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="flex items-center gap-4 shrink-0"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Lagformation</span>
                        <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-black/40 p-1 rounded-xl border border-zinc-200 dark:border-zinc-800">
                          {Array.from(new Set(pinnedFormationIds)).slice(0, 3).map(id => {
                            const temp = FORMATION_TEMPLATES.find(t => t.id === id);
                            if (temp) {
                              const variant = temp.variants[0];
                              const isSelected = currentFormation === variant.name;
                              return (
                                <button
                                  key={id}
                                  onClick={() => applyFormation(variant)}
                                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                                    isSelected 
                                      ? 'bg-indigo-600 text-white shadow-sm' 
                                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-white dark:hover:bg-zinc-800'
                                  }`}
                                >
                                  {temp.name}
                                </button>
                              );
                            }
                            return null;
                          })}
                          <button 
                            onClick={() => setShowFormationModal(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-white dark:hover:bg-zinc-800 transition-all border border-dashed border-zinc-300 dark:border-zinc-700 ml-1"
                          >
                            <Layout size={12} />
                            <span>{currentFormation || 'Fler'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800" />

                      <div className="flex flex-col gap-0.5">
                        <span className="text-[7px] font-black text-zinc-500 uppercase tracking-widest pl-1 leading-none mb-1">Status</span>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center px-4 py-1.5 bg-zinc-100 dark:bg-black/20 rounded-xl">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Flyttläge aktivt</span>
                          </div>
                          
                          <button 
                            onClick={() => {
                              const positions: FormationPosition[] = tacticalPlayers
                                .filter(p => !p.isSubstitute)
                                .map(p => ({
                                  id: p.id,
                                  x: p.x,
                                  y: p.y,
                                  role: p.role || 'Player'
                                }));
                              
                              if (positions.length > 0) {
                                setNewFormationName('');
                                setShowSaveFormation(true);
                              }
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-indigo-50 dark:hover:bg-zinc-700/50 transition-all font-black text-[10px] uppercase shadow-sm group"
                            title="Spara denna layout som en ny formation"
                          >
                            <Save size={12} className="group-hover:scale-110 transition-transform" />
                            Spara som formation
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )}



      <div className={isMaximized ? "w-full h-full flex items-center justify-center overflow-hidden" : "w-full rounded-3xl"}>
        <div className={isMaximized ? "w-full h-full flex items-center justify-center overflow-hidden transition-all duration-300" : "transition-all duration-300"} style={{ zoom: isMaximized ? fullScreenZoom : undefined }}>
          {renderLineupContent(false)}
        </div>
      </div>

        {!isMaximized && (
          <>
            <div className="flex flex-col items-center gap-2 mt-1">
            {/* Consolidated Player Controls */}
            <div className="flex flex-wrap sm:flex-nowrap justify-center items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-zinc-100/50 dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                <button
                  onClick={() => setPickerMode('starter')}
                  className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 bg-white dark:bg-zinc-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-zinc-800 rounded-xl transition-all font-black text-[9px] uppercase shadow-sm active:scale-95 group whitespace-nowrap"
                  title="Hantera startelva"
                >
                  <div className="flex items-center shrink-0">
                    <span className="whitespace-nowrap">På planen ({starters.length})</span>
                  </div>
                  <div className="w-[1px] h-3 bg-zinc-200 dark:bg-zinc-800 shrink-0" />
                  <Plus size={12} className="group-hover:scale-110 transition-transform shrink-0" />
                </button>

                <div className="w-[1px] h-5 bg-zinc-200 dark:bg-zinc-800 mx-0.5 sm:mx-1 shrink-0" />

                <button
                  onClick={() => setPickerMode('sub')}
                  className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-xl transition-all font-black text-[9px] uppercase shadow-sm active:scale-95 group whitespace-nowrap"
                  title="Hantera bänk"
                >
                  <div className="flex items-center shrink-0">
                    <span className="whitespace-nowrap">På bänken ({subs.length})</span>
                  </div>
                  <div className="w-[1px] h-3 bg-zinc-200 dark:bg-zinc-800 shrink-0" />
                  <Plus size={12} className="group-hover:scale-110 transition-transform shrink-0" />
                </button>
              </div>

              {/* Mode & Global Actions Group */}
            <div className="flex items-center gap-1 p-1 bg-zinc-100/50 dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex-nowrap overflow-x-auto no-scrollbar">
              <button
                onClick={() => setIsEditMode(!isEditMode)}
                className={`p-2.5 rounded-xl transition-all shrink-0 ${
                  isEditMode 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 dark:shadow-none' 
                    : 'bg-white dark:bg-zinc-900 text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 shadow-sm border border-transparent'
                }`}
                title="Redigera spelare"
              >
                <Edit2 size={20} />
              </button>
              <button
                onClick={() => setShowNotesModal(true)}
                className="p-2.5 bg-white dark:bg-zinc-900 text-zinc-400 rounded-xl border border-transparent shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all active:scale-95 shrink-0"
                title="Anteckningar"
              >
                <ClipboardList size={20} />
              </button>
              <button
                onClick={handleUndo}
                disabled={history.length === 0}
                className={`p-2.5 rounded-xl transition-all shrink-0 ${
                  history.length === 0 
                    ? 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed opacity-50 border border-transparent' 
                    : 'bg-white dark:bg-zinc-900 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 shadow-sm border border-zinc-100 dark:border-zinc-800 active:scale-95'
                }`}
                title="Ångra"
              >
                <Undo2 size={20} />
              </button>
              <button
                onClick={handleRedo}
                disabled={future.length === 0}
                className={`p-2.5 rounded-xl transition-all shrink-0 ${
                  future.length === 0 
                    ? 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed opacity-50 border border-transparent' 
                    : 'bg-white dark:bg-zinc-900 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 shadow-sm border border-zinc-100 dark:border-zinc-800 active:scale-95'
                }`}
                title="Gör om"
              >
                <Redo2 size={20} />
              </button>
              <div className="w-[1px] h-5 bg-zinc-200 dark:bg-zinc-800 mx-1 shrink-0" />
              <button
                onClick={() => {
                  const newOrientation = orientation === 'vertical' ? 'landscape' : 'vertical';
                  setOrientation(newOrientation);
                  if (newOrientation === 'landscape') {
                    setAttackDirection('right');
                  } else {
                    setAttackDirection('up');
                  }
                }}
                className={`p-2.5 rounded-xl border transition-all active:scale-95 shrink-0 shadow-sm ${
                  orientation === 'landscape' 
                    ? 'bg-indigo-600 text-white border-indigo-500' 
                    : 'bg-white dark:bg-zinc-900 text-zinc-500 border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50'
                }`}
                title={orientation === 'landscape' ? "Byt till stående läge" : "Byt till liggande läge (TV)"}
              >
                {orientation === 'landscape' ? <Smartphone size={20} /> : <Monitor size={20} />}
              </button>
              <button
                onClick={() => setShowSavedLineups(!showSavedLineups)}
                className={`p-2.5 rounded-xl border transition-all active:scale-95 shrink-0 shadow-sm ${
                  showSavedLineups 
                    ? 'bg-amber-600 text-white border-amber-500 shadow-md' 
                    : 'bg-white dark:bg-zinc-900 text-zinc-500 border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50'
                }`}
                title={showSavedLineups ? "Dölj sparade laguppställningar" : "Visa sparade laguppställningar"}
              >
                <FolderOpen size={20} />
              </button>
              <button
                onClick={() => setShowPreview(true)}
                className="p-2.5 bg-white dark:bg-zinc-900 text-zinc-500 rounded-xl border border-zinc-100 dark:border-zinc-800 shadow-sm hover:bg-zinc-50 transition-all active:scale-95 shrink-0"
                title="Förhandsgranska & Skärmklipp"
              >
                <Camera size={20} />
              </button>
              <button
                onClick={() => {
                  const targetMaximized = !isMaximized;
                  setIsMaximized(targetMaximized);
                  setShowSavedLineups(!targetMaximized);
                  setShowBenchMaximized(false);
                  setShowZoomMenu(false);
                }}
                className="p-2.5 bg-white dark:bg-zinc-900 text-zinc-500 rounded-xl border border-zinc-100 dark:border-zinc-800 shadow-sm hover:bg-zinc-50 transition-all active:scale-95 shrink-0"
                title={isMaximized ? "Lämna rittavlan" : "Rittavla"}
              >
                {isMaximized ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
              </button>
            </div>
          </div>
        </div>

        <div className={`grid grid-cols-1 gap-6 mt-6 items-start w-full ${
          showSavedLineups 
            ? 'lg:grid-cols-2' 
            : 'max-w-4xl mx-auto'
        }`}>
          {/* Column 1: Formationer & Inställningar för Zoom, Storlek och Layout */}
          <div className="flex flex-col gap-6">
            {/* Section: Formationer */}
            <div className="flex flex-col bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                <button 
                  onClick={() => setIsFormationsExpanded(!isFormationsExpanded)}
                  className="flex items-center justify-between p-4 w-full hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group/header"
                >
                  <div className="flex items-center justify-between flex-1 pr-4">
                    <div className="flex items-center gap-2">
                      <Footprints size={16} className="text-zinc-400 group-hover/header:text-indigo-500 transition-colors" />
                      <span className="text-xs font-black text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Formationer</span>
                    </div>
                    {currentFormation && (
                      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2.5 py-0.5 rounded-full uppercase border border-indigo-100 dark:border-indigo-800/50">
                        {currentFormation}
                      </span>
                    )}
                  </div>
                  {isFormationsExpanded ? <ChevronUp size={16} className="text-zinc-400" /> : <ChevronDown size={16} className="text-zinc-400" />}
                </button>

                <motion.div
                  initial={false}
                  animate={{ height: isFormationsExpanded ? 'auto' : 0, opacity: isFormationsExpanded ? 1 : 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-wrap gap-2 p-5 pt-0">
                    {/* Dynamic Quick Access based on pins - Ensure unique IDs */}
                    {Array.from(new Set(pinnedFormationIds)).map(id => {
                      // Check if it's a standard formation first
                      const temp = FORMATION_TEMPLATES.find(t => t.id === id);
                      if (temp) {
                        const variant = temp.variants[0];
                        const isSelected = currentFormation === variant.name;
                        return (
                          <button
                            key={id}
                            onClick={() => applyFormation(variant)}
                            className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                              isSelected
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100'
                            }`}
                          >
                            {temp.name}
                          </button>
                        );
                      }

                      // Check if it's a custom formation
                      const custom = customFormations.find(f => f.id === id);
                      if (custom) {
                        const isSelected = currentFormation === custom.name;
                        return (
                          <button
                            key={id}
                            onClick={() => applyFormation(custom)}
                            className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                              isSelected
                                ? 'bg-emerald-600 text-white shadow-md'
                                : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100'
                            }`}
                          >
                            {custom.name}
                          </button>
                        );
                      }

                      return null;
                    })}
                    
                    {/* Fill defaults if no pins (fallback UX) */}
                    {pinnedFormationIds.length === 0 && ['4-4-2', '4-3-3', '4-2-3-1'].map(id => {
                      const temp = FORMATION_TEMPLATES.find(t => t.id === id);
                      if (!temp) return null;
                      return (
                        <button
                          key={id}
                          onClick={() => applyFormation(temp.variants[0])}
                          className="px-4 py-2 rounded-xl text-xs font-black bg-zinc-50 dark:bg-zinc-955 text-zinc-650 dark:text-zinc-405 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 transition-all font-mono"
                        >
                          {temp.name}
                        </button>
                      );
                    })}

                    <button
                      onClick={() => setShowFormationModal(true)}
                      className="px-4 py-2 rounded-xl text-xs font-black bg-zinc-900 dark:bg-white text-white dark:text-black hover:opacity-90 transition-all flex items-center gap-2"
                    >
                      <Plus size={14} />
                      <span>Fler formationer</span>
                    </button>
                    <button
                      onClick={() => setShowSaveFormation(true)}
                      className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-600 text-white hover:bg-emerald-700 transition-all flex items-center gap-2 shadow-lg shadow-emerald-100 dark:shadow-none"
                    >
                      <Plus size={14} />
                      <span>Spara egen formation</span>
                    </button>
                  </div>
                </motion.div>
            </div>

            {/* Combined Section: Zoom, Storlek & Layout */}
            <div className="flex flex-col bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2">
              <button 
                onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                className="flex items-center justify-between p-4 w-full hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group/header"
              >
                <div className="flex items-center gap-2">
                  <Settings size={16} className="text-zinc-400 group-hover/header:text-indigo-500 transition-colors" />
                  <span className="text-xs font-black text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">Inställningar</span>
                </div>
                {isSettingsExpanded ? <ChevronUp size={16} className="text-zinc-400" /> : <ChevronDown size={16} className="text-zinc-400" />}
              </button>

              <motion.div
                initial={false}
                animate={{ height: isSettingsExpanded ? 'auto' : 0, opacity: isSettingsExpanded ? 1 : 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-6 p-5 pt-0">
                  {/* Part 1: Zoom & Storlek (HÖGST UPP) */}
                  <div className="flex flex-col gap-3">
                    <span className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest ml-1">Zoom & Storlek</span>
                    
                    {/* Zoom interface rows */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-zinc-50 dark:bg-zinc-950 p-3 rounded-2xl border border-zinc-100 dark:border-zinc-800/80">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest leading-none mb-1">Zoom Gränssnitt</span>
                        <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400">Anpassa storleken på skärmen</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button 
                          onClick={() => setPreviewZoom(Math.max(0.5, Math.round((previewZoom - 0.05) * 100) / 100))}
                          className="w-8 h-8 flex items-center justify-center bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-all border border-zinc-200/50 dark:border-zinc-800/80"
                          title="Minska zoom"
                        >
                          <Minus size={14} />
                        </button>
                        <div className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg shadow-inner min-w-[60px] text-center flex items-center justify-center">
                          <span className="text-xs font-mono font-black text-zinc-650 dark:text-zinc-300">
                            {Math.round(previewZoom * 100)}%
                          </span>
                        </div>
                        <button 
                          onClick={() => setPreviewZoom(Math.min(1.5, Math.round((previewZoom + 0.05) * 100) / 100))}
                          className="w-8 h-8 flex items-center justify-center bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-all border border-zinc-200/50 dark:border-zinc-800/80"
                          title="Öka zoom"
                        >
                          <Plus size={14} />
                        </button>
                        {previewZoom !== 1 && (
                          <button 
                            onClick={() => setPreviewZoom(1)}
                            className="w-8 h-8 flex items-center justify-center bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-indigo-650 transition-all border border-zinc-200/50 dark:border-zinc-800/80"
                            title="Återställ zoom"
                          >
                            <RotateCcw size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Scale interface rows */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-zinc-50 dark:bg-zinc-950 p-3 rounded-2xl border border-zinc-100 dark:border-zinc-800/80">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest leading-none mb-1">Spelarstorlek</span>
                        <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400">Ändra cirklarnas storlek på spelplanen</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button 
                          onClick={() => {
                            setPlayerScale(Math.max(0.5, Math.round((playerScale - 0.05) * 100) / 100));
                            setHasUnsavedChanges(true);
                          }}
                          className="w-8 h-8 flex items-center justify-center bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-all border border-zinc-200/50 dark:border-zinc-800/80"
                          title="Minska spelarstorlek"
                        >
                          <Minus size={14} />
                        </button>
                        <div className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg shadow-inner min-w-[60px] text-center flex items-center justify-center">
                          <span className="text-xs font-mono font-black text-zinc-650 dark:text-zinc-300">
                            {Math.round(playerScale * 100)}%
                          </span>
                        </div>
                        <button 
                          onClick={() => {
                            setPlayerScale(Math.min(1.5, Math.round((playerScale + 0.05) * 100) / 100));
                            setHasUnsavedChanges(true);
                          }}
                          className="w-8 h-8 flex items-center justify-center bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-all border border-zinc-200/50 dark:border-zinc-800/80"
                          title="Öka spelarstorlek"
                        >
                          <Plus size={14} />
                        </button>
                        {playerScale !== 1 && (
                          <button 
                            onClick={() => {
                              setPlayerScale(1);
                              setHasUnsavedChanges(true);
                            }}
                            className="w-8 h-8 flex items-center justify-center bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-indigo-650 transition-all border border-zinc-200/50 dark:border-zinc-800/80"
                            title="Återställ spelarstorlek"
                          >
                            <RotateCcw size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Horizontal Line Divider */}
                  <div className="h-[1px] bg-zinc-150 dark:bg-zinc-800/80 w-full" />

                  {/* Part 2: Spelarutseende */}
                  <div className="flex flex-col gap-3">
                    <span className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest ml-1">Spelarutseende</span>
                    
                    <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {/* Theme Style */}
                      <div className="flex flex-col gap-2">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Namnfärg</span>
                        <div className="flex gap-1 p-1 bg-zinc-50 dark:bg-zinc-955 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                          <button
                            onClick={() => {
                              setNameTagStyle('light');
                              setHasUnsavedChanges(true);
                            }}
                            className={`flex-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${
                              nameTagStyle === 'light'
                                ? 'bg-indigo-600 text-white shadow-lg'
                                : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                          >
                            Ljus
                          </button>
                          <button
                            onClick={() => {
                              setNameTagStyle('dark');
                              setHasUnsavedChanges(true);
                            }}
                            className={`flex-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${
                              nameTagStyle === 'dark'
                                ? 'bg-indigo-600 text-white shadow-lg'
                                : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                          >
                            Mörk
                          </button>
                        </div>
                      </div>

                      {/* Photo Toggle */}
                      <div className="flex flex-col gap-2">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Spelarfoto</span>
                        <button
                          onClick={() => {
                            setShowPhoto(!showPhoto);
                            setHasUnsavedChanges(true);
                          }}
                          className={`flex items-center justify-between px-4 py-3 rounded-2xl border transition-all ${
                            showPhoto
                              ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg'
                              : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-100 dark:border-zinc-800 text-zinc-550 hover:bg-zinc-100'
                          }`}
                        >
                          <span className="text-[10px] font-black uppercase tracking-widest">{showPhoto ? 'Ja' : 'Nej'}</span>
                          <Camera size={14} className={showPhoto ? 'text-white' : 'text-zinc-400'} />
                        </button>
                      </div>

                      {/* Number Toggle */}
                      <div className="flex flex-col gap-2">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Tröjnummer</span>
                        <button
                          onClick={() => {
                            setShowNumber(!showNumber);
                            setHasUnsavedChanges(true);
                          }}
                          className={`flex items-center justify-between px-4 py-3 rounded-2xl border transition-all ${
                            showNumber
                              ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg'
                              : 'bg-zinc-50 dark:bg-zinc-955 border-zinc-100 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-100'
                          }`}
                        >
                          <span className="text-[10px] font-black uppercase tracking-widest">{showNumber ? 'Ja' : 'Nej'}</span>
                          <div className={`w-3 h-3 rounded-md border-2 border-current flex items-center justify-center ${showNumber ? 'bg-white border-white' : 'border-zinc-400'}`}>
                            {showNumber && <div className="w-1.5 h-1.5 bg-indigo-600 rounded-sm" />}
                          </div>
                        </button>
                      </div>

                      {/* Name Toggle */}
                      <div className="flex flex-col gap-2">
                        <span className="text-[10px] font-black text-zinc-405 uppercase tracking-widest ml-1">Spelarnamn</span>
                        <button
                          onClick={() => {
                            setShowName(!showName);
                            setHasUnsavedChanges(true);
                          }}
                          className={`flex items-center justify-between px-4 py-3 rounded-2xl border transition-all ${
                            showName
                              ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg'
                              : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-100 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-100'
                          }`}
                        >
                          <span className="text-[10px] font-black uppercase tracking-widest">{showName ? 'Ja' : 'Nej'}</span>
                          <User size={14} className={showName ? 'text-white' : 'text-zinc-400'} />
                        </button>
                      </div>

                      {/* Name Mode */}
                      <div className="flex flex-col gap-2 col-span-2 md:col-span-2 lg:col-span-3">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Namnformat</span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1 p-1 bg-zinc-50 dark:bg-zinc-955 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                          <button onClick={() => {
                            setNameDisplayMode('first');
                            setHasUnsavedChanges(true);
                          }} className={`px-2 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${nameDisplayMode === 'first' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>Förnamn</button>
                          <button onClick={() => {
                            setNameDisplayMode('last');
                            setHasUnsavedChanges(true);
                          }} className={`px-2 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${nameDisplayMode === 'last' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>Efternamn</button>
                          <button onClick={() => {
                            setNameDisplayMode('full');
                            setHasUnsavedChanges(true);
                          }} className={`px-2 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${nameDisplayMode === 'full' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>Hela namnet</button>
                          <button onClick={() => {
                            setNameDisplayMode('initials');
                            setHasUnsavedChanges(true);
                          }} className={`px-2 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${nameDisplayMode === 'initials' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-405 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>Initialer</button>
                          <button onClick={() => {
                            setNameDisplayMode('firstLastInitial');
                            setHasUnsavedChanges(true);
                          }} className={`px-2 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${nameDisplayMode === 'firstLastInitial' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-405 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>Namn + I.</button>
                          <button onClick={() => {
                            setNameDisplayMode('initialLastName');
                            setHasUnsavedChanges(true);
                          }} className={`px-2 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${nameDisplayMode === 'initialLastName' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-405 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>I. + Efternamn</button>
                        </div>
                      </div>

                      {/* Background Type */}
                      <div className="flex flex-col gap-2 col-span-2 md:col-span-3">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Skyltstil</span>
                        <div className="flex gap-1 p-1 bg-zinc-50 dark:bg-zinc-955 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                          <button onClick={() => {
                            setNameBackgroundType('badge');
                            setShowNameBackground(true);
                            setHasUnsavedChanges(true);
                          }} className={`flex-1 px-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${nameBackgroundType === 'badge' && showNameBackground ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Badge</button>
                          <button onClick={() => {
                            setNameBackgroundType('transparent');
                            setShowNameBackground(true);
                            setHasUnsavedChanges(true);
                          }} className={`flex-1 px-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${nameBackgroundType === 'transparent' && showNameBackground ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Genomskinlig</button>
                          <button onClick={() => {
                            setNameBackgroundType('solid');
                            setShowNameBackground(true);
                            setHasUnsavedChanges(true);
                          }} className={`flex-1 px-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${nameBackgroundType === 'solid' && showNameBackground ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Bakgrund</button>
                          <button onClick={() => {
                            setNameBackgroundType('none');
                            setShowNameBackground(false);
                            setHasUnsavedChanges(true);
                          }} className={`flex-1 px-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${(!showNameBackground || nameBackgroundType === 'none') ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Ingen</button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 col-span-2 md:col-span-3">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Planstil</span>
                        <div className="grid grid-cols-2 xs:grid-cols-3 gap-1 p-1 bg-zinc-50 dark:bg-zinc-955 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                          <button onClick={() => {
                            setPitchType('classic');
                            setHasUnsavedChanges(true);
                          }} className={`px-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${pitchType === 'classic' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Grön Ränder</button>
                          <button onClick={() => {
                            setPitchType('blue-stripes');
                            setHasUnsavedChanges(true);
                          }} className={`px-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${pitchType === 'blue-stripes' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Blå Ränder</button>
                          <button onClick={() => {
                            setPitchType('grass');
                            setHasUnsavedChanges(true);
                          }} className={`px-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${pitchType === 'grass' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Gräs</button>
                          <button onClick={() => {
                            setPitchType('blue-grass');
                            setHasUnsavedChanges(true);
                          }} className={`px-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${pitchType === 'blue-grass' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Blå Gräs</button>
                          <button onClick={() => {
                            setPitchType('blue');
                            setHasUnsavedChanges(true);
                          }} className={`px-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${pitchType === 'blue' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Mix Blå</button>
                          <button onClick={() => {
                            setPitchType('solid-blue');
                            setHasUnsavedChanges(true);
                          }} className={`px-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${pitchType === 'solid-blue' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Solid Blå</button>
                          <button onClick={() => {
                            setPitchType('solid-white');
                            setHasUnsavedChanges(true);
                          }} className={`px-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${pitchType === 'solid-white' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Solid Vit</button>
                          <button onClick={() => {
                            setPitchType('solid-black');
                            setHasUnsavedChanges(true);
                          }} className={`px-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${pitchType === 'solid-black' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Solid Svart</button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 col-span-2 md:col-span-3">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Spelriktning</span>
                        <div className="flex gap-1 p-1 bg-zinc-50 dark:bg-zinc-955 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                          {orientation === 'vertical' ? (
                            <>
                              <button onClick={() => {
                                setAttackDirection('up');
                              }} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${attackDirection === 'up' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Uppåt</button>
                              <button onClick={() => {
                                setAttackDirection('down');
                              }} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${attackDirection === 'down' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Nedåt</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => {
                                setAttackDirection('left');
                              }} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${attackDirection === 'left' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Vänster</button>
                              <button onClick={() => {
                                setAttackDirection('right');
                              }} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${attackDirection === 'right' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400'}`}>Höger</button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Automated Pass network setting */}
                      <div className="flex flex-col gap-2 col-span-2 md:col-span-3">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Automatiskt Passningsnätverk</span>
                        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-5 gap-1 p-1 bg-zinc-50 dark:bg-zinc-955 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                          <button
                            onClick={() => {
                              setPassingNetworkMode('triangulation');
                              setHasUnsavedChanges(true);
                            }}
                            className={`flex px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex-col items-center justify-center gap-1 text-center ${
                              passingNetworkMode === 'triangulation'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <span>Triangulering</span>
                            <span className="text-[8px] opacity-75 font-medium lowercase">enbart trianglar</span>
                          </button>
                          <button
                            onClick={() => {
                              setPassingNetworkMode('standard');
                              setHasUnsavedChanges(true);
                            }}
                            className={`flex px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex-col items-center justify-center gap-1 text-center ${
                              passingNetworkMode === 'standard'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'text-zinc-450 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <span>Standard (3)</span>
                            <span className="text-[8px] opacity-75 font-medium lowercase">trianglar + 3 närmaste</span>
                          </button>
                          <button
                            onClick={() => {
                              setPassingNetworkMode('maximum');
                              setHasUnsavedChanges(true);
                            }}
                            className={`flex px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex-col items-center justify-center gap-1 text-center ${
                              passingNetworkMode === 'maximum'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'text-zinc-450 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <span>Maximalt (4)</span>
                            <span className="text-[8px] opacity-75 font-medium lowercase">trianglar + 4 närmaste</span>
                          </button>
                          <button
                            onClick={() => {
                              setPassingNetworkMode('ultra');
                              setHasUnsavedChanges(true);
                            }}
                            className={`flex px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex-col items-center justify-center gap-1 text-center ${
                              passingNetworkMode === 'ultra'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'text-zinc-450 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <span>Ultimat (5)</span>
                            <span className="text-[8px] opacity-75 font-medium lowercase">trianglar + 5 närmaste</span>
                          </button>
                          <button
                            onClick={() => {
                              setPassingNetworkMode('lanes');
                              setHasUnsavedChanges(true);
                            }}
                            className={`flex px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex-col items-center justify-center gap-1 text-center col-span-2 xs:col-span-1 sm:col-span-1 ${
                              passingNetworkMode === 'lanes'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'text-zinc-450 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <span>Spelvägar</span>
                            <span className="text-[8px] opacity-75 font-medium lowercase">fria passningskanaler</span>
                          </button>
                        </div>
                      </div>

                    </div>
                  </div>

                </div>
              </motion.div>
            </div>
          </div>

          {/* Column 2: Sparade laguppställningar */}
          {showSavedLineups && (
            <div className="flex flex-col gap-6 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-5 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1">
                <h3 className="text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-widest leading-none">Sparade Laguppställningar</h3>
                <button
                  onClick={handleCreateNew}
                  className="flex items-center justify-center gap-2 px-3.5 py-1.5 bg-indigo-600 text-white rounded-xl font-bold text-[10px] uppercase tracking-wider hover:bg-indigo-700 transition-all shadow-md active:scale-95 w-full sm:w-auto shrink-0"
                >
                  <Plus size={14} />
                  <span>Skapa Ny</span>
                </button>
              </div>

              <Reorder.Group 
                axis="y" 
                values={Array.from(new Map(lineups.filter(l => !l.isArchived).map(l => [l.id, l])).values())} 
                onReorder={(reordered) => {
                  const archived = lineups.filter(l => l.isArchived);
                  onReorderLineups([...reordered, ...archived]);
                }}
                className="flex flex-col gap-3 w-full"
              >
                {lineups.filter(l => !l.isArchived).length === 0 ? (
                  <div className="p-8 text-center bg-zinc-50 dark:bg-zinc-950 rounded-2xl border-2 border-dashed border-zinc-150 dark:border-zinc-800/60">
                    <p className="text-zinc-400 font-medium italic text-xs">Inga sparade laguppställningar än...</p>
                  </div>
                ) : (
                  Array.from(new Map(lineups.filter(l => !l.isArchived).map(l => [l.id, l])).values()).map(l => (
                    <LineupReorderItem
                      key={l.id}
                      l={l}
                      activeLineupId={lineup?.id}
                      onSelectLineup={handleSelectLineupWithHistory}
                      toggleArchive={toggleArchive}
                      onCopyLineup={onCopyLineup}
                      onDeleteLineup={onDeleteLineup}
                      onEditTitle={openTitleEditForLineup}
                    />
                  ))
                )}
              </Reorder.Group>

              {/* Archived Lineups Section */}
              {lineups.some(l => l.isArchived) && (
                <div className="pt-4 mt-6 border-t border-zinc-100 dark:border-zinc-800">
                  <button 
                    onClick={() => setIsArchiveExpanded(!isArchiveExpanded)}
                    className="flex items-center justify-between w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-955 rounded-2xl hover:bg-zinc-100 dark:hover:bg-zinc-900/60 transition-all group border border-zinc-150 dark:border-zinc-800/50"
                  >
                    <div className="flex items-center gap-2">
                      <Archive size={16} className="text-zinc-400 group-hover:text-amber-500 transition-colors" />
                      <span className="text-xs font-black text-zinc-650 dark:text-zinc-400 uppercase tracking-widest">
                        Arkiverade ({lineups.filter(l => l.isArchived).length})
                      </span>
                    </div>
                    {isArchiveExpanded ? <ChevronUp size={16} className="text-zinc-400" /> : <ChevronDown size={16} className="text-zinc-400" />}
                  </button>

                  <AnimatePresence>
                    {isArchiveExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-col gap-3 w-full mt-4">
                          {Array.from(new Map(lineups.filter(l => l.isArchived).map(l => [l.id, l])).values()).map(l => (
                            <div 
                              key={l.id}
                              className="group p-4 bg-zinc-50/50 dark:bg-zinc-900/20 rounded-[20px] border border-zinc-100/80 dark:border-zinc-800 flex items-center justify-between w-full min-w-0 opacity-70 hover:opacity-100 transition-all"
                            >
                              <div 
                                className="flex-1 cursor-pointer min-w-0 pr-2" 
                                onClick={() => handleSelectLineupWithHistory(l.id)}
                              >
                                <h4 className="font-bold text-zinc-700 dark:text-zinc-300 tracking-tight leading-tight truncate text-xs">
                                  {l.matchTitle || 'Namnlös Match'}
                                </h4>
                                <span className="text-[9px] font-medium text-zinc-400 uppercase tracking-widest leading-none mt-1.5 block">
                                  Arkiverad
                                </span>
                              </div>

                              <div className="flex items-center gap-1 shrink-0 ml-2">
                                <button
                                  onClick={() => openTitleEditForLineup(l.id, l.matchTitle || '', l.teamName || '')}
                                  className="p-1.5 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-100/50 dark:hover:bg-zinc-900/40 rounded-lg transition-all"
                                  title="Redigera rubriker"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  onClick={(e) => toggleArchive(e, l.id)}
                                  className="p-1.5 text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-150/50 dark:hover:bg-emerald-950/20 rounded-lg transition-all"
                                  title="Återställ"
                                >
                                  <ArchiveRestore size={14} />
                                </button>
                                <button
                                  onClick={() => onCopyLineup(l.id)}
                                  className="p-1.5 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-100/50 dark:hover:bg-indigo-900/40 rounded-lg transition-all"
                                  title="Kopiera"
                                >
                                  <Copy size={14} />
                                </button>
                                <button
                                  onClick={() => onDeleteLineup(l.id)}
                                  className="p-1.5 text-zinc-400 hover:text-red-650 dark:hover:text-red-405 hover:bg-red-150/50 dark:hover:bg-red-955/20 rounded-lg transition-all"
                                  title="Radera"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
        </div>
      </>
    )}
      <AnimatePresence>
        {/* Logo Cropping Modal */}
        {showLogoPicker && logoToCrop && (
          <ImageCropper
            image={logoToCrop}
            onCropComplete={(croppedBlob) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                if (typeof reader.result === 'string') {
                  setTeamLogoUrl(reader.result);
                  setShowLogoPicker(false);
                  setLogoToCrop(null);
                  setHasUnsavedChanges(true);
                }
              };
              reader.readAsDataURL(croppedBlob);
            }}
            onCancel={() => {
              setShowLogoPicker(false);
              setLogoToCrop(null);
            }}
          />
        )}

        {/** Title Edit Modal */}
        {isEditingTitle && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4"
            onClick={() => {
              setIsEditingTitle(false);
              setEditingLineupId(null);
            }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white dark:bg-zinc-900 rounded-[32px] p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-black text-zinc-900 dark:text-white mb-6 tracking-tight">Redigera rubriker</h3>
              
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5 ml-1">Lagnamn</label>
                  <input
                    autoFocus
                    type="text"
                    value={tempTeamName}
                    onChange={(e) => setTempTeamName(e.target.value)}
                    placeholder="Ditt lags namn..."
                    className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-950 border-2 border-zinc-100 dark:border-zinc-800 rounded-2xl text-lg font-bold outline-none focus:border-indigo-600 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5 ml-1">Matchrubrik</label>
                  <input
                    type="text"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    placeholder="Namn på matchen..."
                    className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-950 border-2 border-zinc-100 dark:border-zinc-800 rounded-2xl text-lg font-bold outline-none focus:border-indigo-600 transition-colors"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSave(tempTitle, tempTeamName);
                      }
                    }}
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setIsEditingTitle(false);
                    setEditingLineupId(null);
                  }}
                  className="flex-1 py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-bold rounded-2xl active:scale-95 transition-all"
                >
                  Avbryt
                </button>
                <button
                  onClick={() => handleSave(tempTitle, tempTeamName)}
                  className="flex-1 py-4 bg-indigo-600 text-white font-black rounded-2xl active:scale-95 shadow-lg shadow-indigo-100 dark:shadow-none transition-all"
                >
                  Spara
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {/** Save Formation Name Modal */}
        <AnimatePresence>
          {showSaveFormation && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-md z-[110] flex items-center justify-center p-4"
              onClick={() => setShowSaveFormation(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="bg-zinc-50 dark:bg-zinc-950 rounded-[32px] p-8 max-w-md w-full shadow-2xl border border-white dark:border-zinc-900"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-2xl font-black text-zinc-900 dark:text-white">Spara formation</h3>
                  <button onClick={() => setShowSaveFormation(false)} className="text-zinc-400 hover:text-zinc-600">
                    <X size={24} />
                  </button>
                </div>
                
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1 mb-2 block">Formationsnamn</label>
                    <input 
                      type="text"
                      placeholder="T.ex. 4-3-3 Offensiv"
                      value={newFormationName}
                      onChange={(e) => setNewFormationName(e.target.value)}
                      className="w-full h-14 px-6 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 text-zinc-900 dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-sm"
                      autoFocus
                    />
                  </div>

                  <button
                    onClick={handleSaveCurrentAsFormation}
                    disabled={!newFormationName.trim()}
                    className="w-full py-4 bg-indigo-600 text-white font-black rounded-2xl active:scale-95 disabled:opacity-50 disabled:grayscale transition-all shadow-lg shadow-indigo-100 dark:shadow-none"
                  >
                    Spara Formation
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/** Formation Details Modal */}
        {showFormationModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4"
            onClick={() => setShowFormationModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-zinc-50 dark:bg-zinc-950 rounded-[40px] p-8 max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-white dark:border-zinc-900 custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-3xl font-black text-zinc-900 dark:text-white tracking-tight">Välj formation</h3>
                  <p className="text-sm text-zinc-500 font-medium mt-1">Utforska olika taktiska uppställningar för ditt lag.</p>
                </div>
                <button onClick={() => setShowFormationModal(false)} className="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-zinc-600 shadow-sm">
                  <X size={24} />
                </button>
              </div>

            <div className="space-y-10">
                {customFormations.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 px-1">
                      <div className="h-6 w-1 bg-emerald-600 rounded-full" />
                      <h4 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tighter">Mina Formationer</h4>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {customFormations.map((v) => (
                        <div key={v.id} className="relative group">
                          <button
                            onClick={() => applyFormation(v)}
                            className={`w-full text-left p-6 rounded-3xl border-2 transition-all hover:scale-[1.01] active:scale-[0.99] ${
                              currentFormation === v.name
                                ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/20'
                                : 'border-white dark:border-zinc-900 bg-white dark:bg-zinc-900 shadow-sm'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`text-base font-black ${currentFormation === v.name ? 'text-emerald-600' : 'text-zinc-900 dark:text-white'}`}>
                                    {v.name}
                                  </span>
                                </div>
                                <p className="text-xs text-zinc-500 leading-relaxed font-medium">
                                  {v.description}
                                </p>
                              </div>
                              <div className="hidden sm:flex shrink-0 w-20 h-20 bg-zinc-100 dark:bg-zinc-800 rounded-2xl items-center justify-center border border-zinc-200 dark:border-zinc-700">
                                <div className="w-14 h-14 relative">
                                    <div className="absolute inset-0 border border-zinc-300 dark:border-zinc-600 rounded-md" />
                                    {v.positions.map((pos, idx) => (
                                      <div 
                                        key={idx} 
                                        className="absolute w-1 h-1 bg-emerald-500 rounded-full"
                                        style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
                                      />
                                    ))}
                                    <div className="absolute w-1 h-1 bg-emerald-500 rounded-full" style={{ left: '50%', top: '90%', transform: 'translate(-50%, -50%)' }} />
                                </div>
                              </div>
                            </div>
                          </button>
                          <div className="absolute top-4 right-4 flex gap-1">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                onTogglePinFormation?.(v.id);
                              }}
                              className={`p-2 rounded-full duration-200 ${
                                pinnedFormationIds.includes(v.id) 
                                  ? 'bg-amber-100 text-amber-600' 
                                  : 'text-zinc-400 hover:bg-zinc-100'
                              }`}
                              title={pinnedFormationIds.includes(v.id) ? "Avpinna" : "Pinna på startsidan"}
                            >
                              {pinnedFormationIds.includes(v.id) ? <PinOff size={16} /> : <Pin size={16} />}
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteCustomFormation?.(v.id);
                              }}
                              className="p-2 text-zinc-400 hover:text-red-500 rounded-full hover:bg-red-50 duration-200"
                              title="Radera"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {FORMATION_TEMPLATES.map((template) => (
                  <div key={template.id} className="space-y-4">
                    <div className="flex items-center gap-3 px-1">
                      <div className="h-6 w-1 bg-indigo-600 rounded-full" />
                      <h4 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tighter">{template.name} ({template.category})</h4>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {template.variants.map((v) => {
                        const isPinned = pinnedFormationIds.includes(template.id);
                        return (
                          <div key={v.id} className="relative group">
                            <button
                              onClick={() => applyFormation(v)}
                              className={`w-full text-left p-6 rounded-3xl border-2 transition-all hover:scale-[1.01] active:scale-[0.99] ${
                                currentFormation === v.name
                                  ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/20'
                                  : 'border-white dark:border-zinc-900 bg-white dark:bg-zinc-900 shadow-sm'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className={`text-base font-black ${currentFormation === v.name ? 'text-indigo-600' : 'text-zinc-900 dark:text-white'}`}>
                                      {v.name}
                                    </span>
                                    {currentFormation === v.name && (
                                      <div className="bg-indigo-600 text-white rounded-full p-1">
                                        <Check size={10} />
                                      </div>
                                    )}
                                  </div>
                                  <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed font-medium">
                                    {v.description}
                                  </p>
                                </div>
                                <div className="hidden sm:flex shrink-0 w-24 h-24 bg-zinc-100 dark:bg-zinc-800 rounded-2xl items-center justify-center border border-zinc-200 dark:border-zinc-700">
                                   <div className="w-16 h-16 relative">
                                      {/* Miniature pitch preview */}
                                      <div className="absolute inset-0 border border-zinc-300 dark:border-zinc-600 rounded-md" />
                                      <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-zinc-300 dark:border-zinc-600" />
                                      {v.positions.map((pos, idx) => (
                                        <div 
                                          key={idx} 
                                          className="absolute w-1 h-1 bg-indigo-500 rounded-full"
                                          style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
                                        />
                                      ))}
                                      <div className="absolute w-1 h-1 bg-indigo-500 rounded-full" style={{ left: '50%', top: '90%', transform: 'translate(-50%, -50%)' }} />
                                   </div>
                                </div>
                              </div>
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                onTogglePinFormation?.(template.id);
                              }}
                              className={`absolute top-4 right-4 p-2 rounded-full duration-200 ${
                                isPinned 
                                  ? 'bg-amber-100 text-amber-600' 
                                  : 'text-zinc-400 hover:bg-zinc-100'
                              }`}
                              title={isPinned ? "Avpinna" : "Pinna på startsidan"}
                            >
                              {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
        {showTacticalSavedBoardsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-[110] flex items-center justify-center p-4 font-sans"
            onClick={() => setShowTacticalSavedBoardsModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-zinc-50 dark:bg-zinc-950 rounded-[40px] p-6 sm:p-8 max-w-xl w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-white dark:border-zinc-900 custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-2xl sm:text-3xl font-black text-zinc-900 dark:text-white tracking-tight">Taktiska ritningar</h3>
                  <p className="text-sm text-zinc-500 font-medium mt-1">Spara och ladda dina anpassade rittavlor manuellt.</p>
                </div>
                <button 
                  onClick={() => setShowTacticalSavedBoardsModal(false)} 
                  className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 shadow-sm transition-transform active:scale-95"
                >
                  <X size={20} />
                </button>
              </div>

              {/* SECTION: Save current view */}
              <div className="bg-white dark:bg-zinc-900 p-4 sm:p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm mb-6">
                <h4 className="text-base font-black text-zinc-800 dark:text-zinc-200 mb-3">Spara aktuell rittavla</h4>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={newSavedBoardName}
                    onChange={(e) => setNewSavedBoardName(e.target.value)}
                    placeholder="Namnge ritningen (t.ex. Hörnvariant A)..."
                    className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white"
                  />
                  <button
                    onClick={handleSaveTacticalBoard}
                    disabled={!newSavedBoardName.trim()}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-md shadow-emerald-600/10 flex items-center justify-center gap-1.5 transition-all active:scale-95 pr-5 pointer-events-auto"
                  >
                    <Save size={16} />
                    Spara
                  </button>
                </div>
              </div>

              {/* SECTION: Saved presets list */}
              <div>
                <h4 className="text-base font-black text-zinc-800 dark:text-zinc-200 mb-3 block">Sparade ritningar</h4>
                {(!lineup || !lineup.savedTacticalBoards || lineup.savedTacticalBoards.length === 0) ? (
                  <div className="text-center py-8 text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl">
                    <Bookmark className="mx-auto mb-2 opacity-30" size={32} />
                    <p className="text-xs font-semibold">Inga sparade rittavlor ännu.</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">Skriv ett namn ovan för att spara din första ritning.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {lineup.savedTacticalBoards.map((board) => (
                      <div 
                        key={board.id} 
                        className="flex items-center justify-between p-3.5 sm:p-4 bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800/80 rounded-2xl hover:border-emerald-500/30 transition-all shadow-sm group"
                      >
                        <div className="flex-1 min-w-0 pr-2">
                           <p className="text-sm font-black text-zinc-800 dark:text-zinc-200 truncate">{board.name}</p>
                           <p className="text-[10px] text-zinc-500 mt-0.5">
                             Sparad {new Date(board.createdAt).toLocaleDateString('sv-SE')} kl. {new Date(board.createdAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                           </p>
                        </div>
                        <div className="flex items-center gap-2 pointer-events-auto">
                          <button
                            onClick={() => handleLoadTacticalBoard(board)}
                            className="px-3 py-1.5 bg-emerald-600/15 text-emerald-650 hover:bg-emerald-600 hover:text-white text-xs font-black rounded-lg transition-all active:scale-90 flex items-center gap-1"
                          >
                            <FolderOpen size={12} />
                            Öppna
                          </button>
                          <button
                            onClick={() => handleDeleteTacticalBoard(board.id)}
                            className="p-1.5 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-all active:scale-90"
                            title="Ta bort sparad ritning"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </motion.div>
          </motion.div>
        )}

        {/** Save & Close Tactical board Dialog Modal */}
        {showSaveOnCloseModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-[200] flex items-center justify-center p-4 font-sans"
            onClick={() => setShowSaveOnCloseModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-zinc-50 dark:bg-zinc-950 rounded-[40px] p-6 sm:p-8 max-w-lg w-full shadow-2xl border border-white dark:border-zinc-900 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-amber-600/10 dark:bg-amber-600/20 flex items-center justify-center text-amber-650 shrink-0">
                  <Bookmark size={24} />
                </div>
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white tracking-tight">Spara taktisk ritning?</h3>
                  <p className="text-xs text-zinc-500 font-medium">Vill du spara dina ändringar på rittavlan innan du stänger?</p>
                </div>
              </div>

              {/* Name Field */}
              <div className="mb-6">
                <label className="block text-[10px] font-black uppercase text-zinc-400 dark:text-zinc-500 tracking-wider mb-2">Namnge din ritning</label>
                <input
                  type="text"
                  value={exitBoardName}
                  onChange={(e) => setExitBoardName(e.target.value)}
                  placeholder="Hörnvariant, Frisparkstaktik, etc..."
                  className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-zinc-900 dark:text-white font-bold"
                />
              </div>

              {/* Warning box for NO option */}
              <div className="bg-red-500/10 dark:bg-red-500/15 border border-red-500/35 p-4 rounded-2xl text-xs text-red-700 dark:text-red-400 font-semibold mb-6 flex gap-2.5 items-start">
                <span className="text-base leading-none shrink-0">⚠️</span>
                <p className="leading-normal">
                  <strong className="block font-black uppercase tracking-wider text-[10px] text-red-800 dark:text-red-300 mb-1">Vad händer om du svarar Nej?</strong>
                  Rittavlan kommer att rensas helt från klotter, ritningar och uppställda motståndare. Du kommer att återgå till den aktiva ordinarie laguppställningen. Din ritning går förlorad om du inte sparar den.
                </p>
              </div>

              {/* Dialog buttons */}
              <div className="flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={handleSaveAndExitTactical}
                  className="flex-1 px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all text-sm flex items-center justify-center gap-1.5 order-2 sm:order-1"
                >
                  <Save size={16} />
                  Ja, spara & stäng
                </button>
                <button
                  type="button"
                  onClick={handleDiscardAndExitTactical}
                  className="px-5 py-3.5 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold rounded-2xl active:scale-95 transition-all text-sm order-1 sm:order-2"
                >
                  Nej, stäng utan att spara
                </button>
                <button
                  type="button"
                  onClick={() => setShowSaveOnCloseModal(false)}
                  className="px-4 py-3.5 bg-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-250 font-bold text-sm text-center shrink-0 order-3 active:scale-95 transition-all"
                >
                  Avbryt
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/** Opponent Formation Modal */}
        {showOpponentFormationModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-[110] flex items-center justify-center p-4"
            onClick={() => setShowOpponentFormationModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-zinc-50 dark:bg-zinc-950 rounded-[40px] p-8 max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-white dark:border-zinc-900 custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-3xl font-black text-zinc-900 dark:text-white tracking-tight">Motståndaruppställning</h3>
                  <p className="text-sm text-zinc-500 font-medium mt-1">Välj en formation för motståndarna (spegelvänd mot toppmålet).</p>
                </div>
                <button onClick={() => setShowOpponentFormationModal(false)} className="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-zinc-600 shadow-sm">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-10">
                {FORMATION_TEMPLATES.map((template) => (
                  <div key={template.id} className="space-y-4">
                    <div className="flex items-center gap-3 px-1">
                      <div className="h-6 w-1 bg-emerald-600 rounded-full" />
                      <h4 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tighter">{template.name}</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {template.variants.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => applyOpponentFormation(v)}
                          className="group relative text-left p-5 rounded-3xl border-2 border-white dark:border-zinc-900 bg-white dark:bg-zinc-900 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] hover:border-emerald-500"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex-1">
                              <span className="text-base font-black text-zinc-900 dark:text-white group-hover:text-emerald-600 transition-colors">
                                {v.name}
                              </span>
                              <p className="text-[10px] text-zinc-500 font-medium line-clamp-2 mt-1">
                                {v.description}
                              </p>
                            </div>
                            <div className="shrink-0 w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                               <div className="w-12 h-12 relative">
                                  <div className="absolute inset-0 border border-zinc-300 dark:border-zinc-600 rounded-md" />
                                  {/* Opponent perspective: GK at top, y flipped */}
                                  <div className="absolute w-1 h-1 bg-red-500 rounded-full" style={{ left: '50%', top: '10%', transform: 'translate(-50%, -50%)' }} />
                                  {v.positions.map((pos, idx) => (
                                    <div 
                                      key={idx} 
                                      className="absolute w-1 h-1 bg-red-400 rounded-full"
                                      style={{ left: `${100 - pos.x}%`, top: `${100 - pos.y}%`, transform: 'translate(-50%, -50%)' }}
                                    />
                                  ))}
                               </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}

        {/** Notes & Media Modal */}
        {showNotesModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-[110] flex items-center justify-center p-4"
            onClick={() => setShowNotesModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-zinc-50 dark:bg-zinc-950 rounded-[40px] p-6 sm:p-8 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-white dark:border-zinc-900 custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-3xl font-black text-zinc-900 dark:text-white tracking-tight">Anteckningar</h3>
                    {hasUnsavedChanges && (
                      <div className="flex items-center gap-2 px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full animate-pulse">
                        <RefreshCw size={12} className="animate-spin" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Sparar...</span>
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-zinc-500 font-medium mt-1">Planera strategier och spela in observationer.</p>
                </div>
                <button onClick={() => setShowNotesModal(false)} className="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-zinc-600 shadow-sm transition-all active:scale-95">
                  <X size={24} />
                </button>
              </div>

              {uploadError && (
                <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 rounded-2xl flex items-center gap-3 text-red-600 dark:text-red-400 text-sm font-bold animate-in fade-in slide-in-from-top-2">
                  <X size={18} className="shrink-0" />
                  <p>{uploadError}</p>
                  <button onClick={() => setUploadError(null)} className="ml-auto p-1 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors">
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Team Notes */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600">
                      <Trophy size={20} />
                    </div>
                    <h4 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter">Vårt Lag</h4>
                  </div>
                  <textarea
                    ref={teamTextareaRef}
                    value={teamNotes}
                    onChange={(e) => {
                      setTeamNotes(e.target.value);
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Skriv anteckningar om ditt lag..."
                    style={{ minHeight: '100px' }}
                    className="w-full p-4 rounded-3xl bg-white dark:bg-zinc-900 border-2 border-zinc-100 dark:border-zinc-800 focus:border-indigo-500 transition-all outline-none text-sm resize-none overflow-hidden"
                  />
                  
                  {/* Media Upload */}
                  <div className="space-y-3">
                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-2">Media</span>
                    <div className="grid grid-cols-4 gap-2">
                       {teamMedia.map((url, i) => (
                         <div key={i} className="relative aspect-square rounded-2xl bg-zinc-200 dark:bg-zinc-800 overflow-hidden group cursor-pointer" onClick={() => setSelectedMediaUrl(url)}>
                           {isVideo(url) ? (
                             <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                               <Play size={24} className="text-white group-hover:scale-125 transition-transform" />
                             </div>
                           ) : (
                             <CachedImage src={url} alt="Media" className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                           )}
                           <button 
                             onClick={(e) => {
                               e.stopPropagation();
                               handleMediaDelete(url, 'team');
                             }}
                             className="absolute top-1.5 right-1.5 bg-black/70 hover:bg-red-600 text-white p-2 rounded-xl transition-all shadow-lg z-10"
                             title="Ta bort media"
                           >
                             <Trash2 size={14} />
                           </button>
                         </div>
                       ))}
                       <label className={`aspect-square rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-900/50 transition-all group ${isUploadingMedia ? 'opacity-50 pointer-events-none' : ''}`}>
                         {isUploadingMedia ? (
                           <RefreshCw size={16} className="text-indigo-600 animate-spin" />
                         ) : (
                           <Plus size={16} className="text-zinc-400 group-hover:scale-110 transition-transform" />
                         )}
                         <span className="text-[8px] font-black text-zinc-400 uppercase">{isUploadingMedia ? 'Laddar...' : 'Lägg till'}</span>
                         <input 
                           type="file" 
                           accept="image/*,video/*" 
                           className="hidden" 
                           disabled={isUploadingMedia}
                           onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleMediaUpload(file, 'team');
                           }}
                         />
                       </label>
                    </div>
                  </div>
                </div>

                {/* Opponent Notes */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600">
                      <Target size={20} />
                    </div>
                    <h4 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter">Motståndarna</h4>
                  </div>
                  <textarea
                    ref={opponentTextareaRef}
                    value={opponentNotes}
                    onChange={(e) => {
                      setOpponentNotes(e.target.value);
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Skriv anteckningar om motståndarna..."
                    style={{ minHeight: '100px' }}
                    className="w-full p-4 rounded-3xl bg-white dark:bg-zinc-900 border-2 border-zinc-100 dark:border-zinc-800 focus:border-red-500 transition-all outline-none text-sm resize-none overflow-hidden"
                  />

                  {/* Media Upload */}
                  <div className="space-y-3">
                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-2">Media</span>
                    <div className="grid grid-cols-4 gap-2">
                       {opponentMedia.map((url, i) => (
                         <div key={i} className="relative aspect-square rounded-2xl bg-zinc-200 dark:bg-zinc-800 overflow-hidden group cursor-pointer" onClick={() => setSelectedMediaUrl(url)}>
                           {isVideo(url) ? (
                             <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                               <Play size={24} className="text-white group-hover:scale-125 transition-transform" />
                             </div>
                           ) : (
                             <CachedImage src={url} alt="Media" className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                           )}
                           <button 
                             onClick={(e) => {
                               e.stopPropagation();
                               handleMediaDelete(url, 'opponent');
                             }}
                             className="absolute top-1.5 right-1.5 bg-black/70 hover:bg-red-600 text-white p-2 rounded-xl transition-all shadow-lg z-10"
                             title="Ta bort media"
                           >
                             <Trash2 size={14} />
                           </button>
                         </div>
                       ))}
                       <label className={`aspect-square rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-900/50 transition-all group ${isUploadingMedia ? 'opacity-50 pointer-events-none' : ''}`}>
                         {isUploadingMedia ? (
                           <RefreshCw size={16} className="text-red-500 animate-spin" />
                         ) : (
                           <Plus size={16} className="text-zinc-400 group-hover:scale-110 transition-transform" />
                         )}
                         <span className="text-[8px] font-black text-zinc-400 uppercase">{isUploadingMedia ? 'Laddar...' : 'Lägg till'}</span>
                         <input 
                           type="file" 
                           accept="image/*,video/*" 
                           className="hidden" 
                           disabled={isUploadingMedia}
                           onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleMediaUpload(file, 'opponent');
                           }}
                         />
                       </label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-12 p-6 bg-indigo-50 dark:bg-indigo-900/10 rounded-[32px] border border-indigo-100 dark:border-indigo-900/30 flex items-center justify-between">
                 <div className="flex items-center gap-4">
                   <div className="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-900 flex items-center justify-center text-indigo-600 shadow-sm">
                      {hasUnsavedChanges ? <RefreshCw size={24} className="animate-spin" /> : <Save size={24} />}
                   </div>
                   <div>
                     <p className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                       {hasUnsavedChanges ? 'Sparar ändringar...' : 'Ändringar sparas automatiskt'}
                     </p>
                     <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Dina anteckningar är kopplade till denna specifika matchuppställning.</p>
                   </div>
                 </div>
                 <button 
                  onClick={() => setShowNotesModal(false)}
                  className="px-8 py-3 bg-indigo-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all active:scale-95"
                 >
                   Stäng
                 </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/** Media Viewer Lightbox */}
        {selectedMediaUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[200] flex items-center justify-center p-4 sm:p-10"
            onClick={() => setSelectedMediaUrl(null)}
          >
            <button 
              onClick={() => setSelectedMediaUrl(null)} 
              className="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all active:scale-95 z-[210]"
            >
              <X size={24} />
            </button>

            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="relative max-w-full max-h-full flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              {isVideo(selectedMediaUrl) ? (
                <video 
                  src={selectedMediaUrl} 
                  controls 
                  autoPlay 
                  className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl"
                />
              ) : (
                <CachedImage 
                  src={selectedMediaUrl} 
                  alt="Media Viewer" 
                  className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl" 
                />
              )}
              <div className="absolute top-full mt-6 left-1/2 -translate-x-1/2 flex items-center gap-3">
                 <a 
                   href={selectedMediaUrl} 
                   target="_blank" 
                   rel="noopener noreferrer"
                   className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-full text-xs font-black uppercase tracking-widest transition-all backdrop-blur-md flex items-center gap-2"
                 >
                   <Play size={14} />
                   Öppna i fullskärm
                 </a>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/** Player Selection Modal */}
        {pickerMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => {
              setPickerMode(null);
              setShowImport(false);
              setImportResult(null);
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-2xl">
                  <button 
                    onClick={() => setShowImport(false)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      !showImport 
                      ? 'bg-white dark:bg-zinc-700 text-indigo-600 shadow-sm' 
                      : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                  >
                    Välj spelare
                  </button>
                  <button 
                    onClick={() => setShowImport(true)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      showImport 
                      ? 'bg-white dark:bg-zinc-700 text-indigo-600 shadow-sm' 
                      : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                  >
                    Klistra in namn
                  </button>
                </div>
                <button onClick={() => {
                  setPickerMode(null);
                  setShowImport(false);
                  setImportResult(null);
                }} className="text-zinc-400 hover:text-zinc-600 p-2">
                  <X size={24} />
                </button>
              </div>

              {!showImport ? (
                <>
                  <div className="flex bg-zinc-50 dark:bg-zinc-950 p-1 rounded-xl mb-4 border border-zinc-100 dark:border-zinc-800">
                    <button 
                      onClick={() => setPickerMode('starter')}
                      className={`flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                        pickerMode === 'starter' 
                        ? 'bg-white dark:bg-zinc-700 text-indigo-600 shadow-sm' 
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      På planen ({starters.length})
                    </button>
                    <button 
                      onClick={() => setPickerMode('sub')}
                      className={`flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                        pickerMode === 'sub' 
                        ? 'bg-white dark:bg-zinc-700 text-indigo-600 shadow-sm' 
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      På bänken ({subs.length})
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 mb-3 px-1">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-bold">
                      Spelare ({(Array.from(new Map(squadPlayers.map(sp => [sp.id, sp])).values())).length} st)
                    </span>
                    <button
                      onClick={() => setSortBySelected(!sortBySelected)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
                        sortBySelected
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                          : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-650 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                      title={sortBySelected ? "Inaktivera sortering" : "Sortera valda först"}
                    >
                      <span className="shrink-0">Sortera valda först</span>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sortBySelected ? 'bg-white' : 'bg-zinc-400 dark:bg-zinc-650'}`} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
                    {(() => {
                      const uniqueSquadPlayers = Array.from(new Map(squadPlayers.map(sp => [sp.id, sp])).values()) as SquadPlayer[];
                      const sortedPlayers = !sortBySelected 
                        ? uniqueSquadPlayers 
                        : [...uniqueSquadPlayers].sort((a, b) => {
                            const aItem = players.find(p => p.playerId === a.id);
                            const bItem = players.find(p => p.playerId === b.id);
                            
                            const aIsCurrent = aItem && (
                              (pickerMode === 'starter' && !aItem.isSubstitute) ||
                              (pickerMode === 'sub' && aItem.isSubstitute)
                            );
                            const bIsCurrent = bItem && (
                              (pickerMode === 'starter' && !bItem.isSubstitute) ||
                              (pickerMode === 'sub' && bItem.isSubstitute)
                            );

                            if (aIsCurrent && !bIsCurrent) return -1;
                            if (!aIsCurrent && bIsCurrent) return 1;
                            
                            const aIsOther = aItem && !aIsCurrent;
                            const bIsOther = bItem && !bIsCurrent;
                            if (aIsOther && !bIsOther) return -1;
                            if (!aIsOther && bIsOther) return 1;

                            return 0;
                          });
                      
                      return sortedPlayers.map(sp => {
                        const itemInLineup = players.find(p => p.playerId === sp.id);
                        const isCurrentMode = itemInLineup && (
                          (pickerMode === 'starter' && !itemInLineup.isSubstitute) ||
                          (pickerMode === 'sub' && itemInLineup.isSubstitute)
                        );
                        const isOtherMode = itemInLineup && !isCurrentMode;

                        return (
                          <button
                            key={sp.id}
                            onClick={() => togglePlayerInLineup(sp.id, pickerMode === 'sub')}
                            className={`flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all text-left relative ${
                              isCurrentMode 
                                ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/20 shadow-sm' 
                                : isOtherMode
                                  ? 'border-zinc-200 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-900/40 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors'
                                  : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-100 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-900/30 transition-colors'
                            }`}
                          >
                            <div className="relative">
                              <div className={`w-10 h-10 bg-white dark:bg-zinc-900 rounded-lg flex items-center justify-center text-zinc-400 shadow-sm overflow-hidden ${isOtherMode ? 'opacity-70' : ''}`}>
                                {sp.photoUrl ? (
                                  <CachedImage 
                                    src={sp.photoUrl} 
                                    alt={sp.name} 
                                    className="w-full h-full object-cover" 
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <User size={20} />
                                )}
                              </div>
                              {sp.number && (
                                <div className={`absolute w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black border-2 shadow-sm transition-all ${
                                  isCurrentMode 
                                    ? 'bg-white text-indigo-600 border-indigo-600 -top-1.5 -left-1.5' 
                                    : 'bg-indigo-600 text-white border-white dark:border-zinc-900 -top-1.5 -right-1.5'
                                }`}>
                                  {sp.number}
                                </div>
                              )}
                              {isCurrentMode && !sp.number && (
                                <div className="absolute -top-2 -right-2 bg-indigo-600 text-white rounded-full p-0.5 animate-in zoom-in">
                                  <Check size={12} />
                                </div>
                              )}
                              {isCurrentMode && sp.number && (
                                <div className="absolute -bottom-1 -right-1 bg-indigo-600 text-white rounded-full p-0.5 animate-in zoom-in shadow-sm">
                                  <Check size={10} />
                                </div>
                              )}
                              {isOtherMode && (
                                <div className="absolute -top-2 -right-2 bg-zinc-500 text-white rounded-full p-0.5 px-1.5 shadow-sm">
                                  <span className="text-[7px] font-black uppercase tracking-tighter">{itemInLineup.isSubstitute ? 'BÄNK' : 'PLAN'}</span>
                                </div>
                              )}
                            </div>
                            <span className={`text-[10px] font-black text-center line-clamp-1 uppercase tracking-tight ${
                              isOtherMode ? 'text-zinc-500 dark:text-zinc-500' : 'text-zinc-900 dark:text-white'
                            }`}>
                              {sp.name}
                            </span>
                          </button>
                        );
                      });
                    })()}
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-800/50">
                    <p className="text-xs text-indigo-700 dark:text-indigo-300 font-medium leading-relaxed">
                      Klistra in en lista med namn (t.ex. från kallelse). Vi matchar dem mot truppen och lägger till dem på planen. Ord som "Deltar" filtreras bort automatiskt.
                    </p>
                  </div>
                  
                  <textarea
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder="Klistra in namn här..."
                    className="w-full h-40 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                  />

                  {importResult && (
                    <div className="space-y-2">
                      {importResult.found.length > 0 && (
                        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                          Hittade: {importResult.found.join(', ')}
                        </p>
                      )}
                      {importResult.missing.length > 0 && (
                        <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">
                          Kunde inte matcha: {importResult.missing.join(', ')}
                        </p>
                      )}
                    </div>
                  )}

                  <button
                    onClick={handleImportPlayers}
                    disabled={!pastedText.trim()}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 dark:shadow-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Check size={18} />
                    <span>Aktivera spelare</span>
                  </button>
                </div>
              )}

              <div className="mt-6">
                <button
                  onClick={() => setPickerMode(null)}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
                >
                  Klar
                </button>
              </div>

              {squadPlayers.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm text-zinc-500 mb-4">Inga spelare i truppen än.</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}

        {/** Player Detail Edit Modal */}
        {selectedForEdit && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedForEdit(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              {(() => {
                const lp = players.find(p => p.id === selectedForEdit);
                const sp = lp ? getSquadPlayer(lp.playerId) : null;
                if (!lp || !sp) return null;

                return (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="relative group">
                        <div className="w-20 h-20 bg-zinc-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center overflow-hidden border-2 border-zinc-100 dark:border-zinc-800">
                          {sp.photoUrl ? (
                            <CachedImage 
                              src={sp.photoUrl} 
                              alt={sp.name} 
                              className="w-full h-full object-cover" 
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <User size={32} className="text-zinc-400" />
                          )}
                        </div>
                        <label className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-2xl">
                          <Camera className="text-white" size={20} />
                          <input 
                            type="text" 
                            className="hidden" 
                            onBlur={(e) => updateSquadPlayerInfo(sp.id, { photoUrl: (e.target as any).value })}
                            onChange={() => {
                              const url = prompt("Klistra in länk till bild:", sp.photoUrl);
                              if (url !== null) updateSquadPlayerInfo(sp.id, { photoUrl: url });
                            }}
                          />
                        </label>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-black text-zinc-900 dark:text-white leading-tight">{sp.name}</h3>
                        <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{sp.position || 'Okänd position'}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5 ml-1">Tröjnummer</label>
                        <input
                          type="text"
                          value={sp.number || ''}
                          onChange={(e) => updateSquadPlayerInfo(sp.id, { number: e.target.value })}
                          placeholder="#"
                          className="w-full px-4 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-white font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div className="flex flex-col justify-end">
                        <button
                          onClick={() => toggleSubstitute(lp.id)}
                          className={`w-full py-2 rounded-xl font-bold text-xs transition-all ${
                            lp.isSubstitute 
                              ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500' 
                              : 'bg-indigo-600 text-white'
                          }`}
                        >
                          {lp.isSubstitute ? 'Gör till ordinarie' : 'Gör till avbytare'}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                      <button
                        onClick={() => setSelectedForEdit(null)}
                        className="w-full py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-bold active:scale-95 transition-all text-sm"
                      >
                        Klar
                      </button>
                      <button
                        onClick={() => removePlayer(lp.id)}
                        className="w-full py-3 text-red-500 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all text-sm"
                      >
                        <Trash2 size={18} />
                        Ta bort från laguppställning
                      </button>
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Preview & Export Modal */}
      <AnimatePresence>
        {showPreview && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-zinc-950/98 backdrop-blur-md z-[250] flex flex-col items-center justify-between p-0 overflow-hidden select-none"
          >
            {/* Screenshot Tip Banner */}
            <AnimatePresence>
              {isScreenshotMode && showScreenshotTip && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="fixed top-8 left-1/2 -translate-x-1/2 z-[270] bg-zinc-900/90 backdrop-blur-md border border-zinc-800 text-white font-black uppercase text-[10px] tracking-widest px-6 py-3 rounded-2xl shadow-2xl pointer-events-none text-center"
                >
                  Tips: Klicka var som helst för att visa knapparna igen!
                </motion.div>
              )}
            </AnimatePresence>

            {/* Top Toolbar - Fades out in screenshot mode */}
            <div className={`w-full bg-zinc-900/80 backdrop-blur-md border-b border-zinc-800 p-4 flex flex-col sm:flex-row items-center justify-between gap-4 z-[260] transition-all duration-300 ${isScreenshotMode ? 'opacity-0 pointer-events-none h-0 p-0 overflow-hidden border-none' : 'opacity-100'}`}>
              <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
                <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-1.5 leading-none">
                  <Camera size={14} className="text-zinc-400" /> Skärmbildsläge
                </h2>
                <p className="text-[10px] text-zinc-400 font-medium tracking-wide mt-1">
                  Planen och bänken anpassas automatiskt. Justera zoom och spelarstorlek så allt ryms.
                </p>
              </div>

              {/* Sliders and Toggles Row */}
              <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
                {/* Scale control */}
                <div className="flex flex-col gap-1 w-28 sm:w-32">
                  <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    <span>Minska kort</span>
                    <span className="text-zinc-400">{Math.round(previewZoom * 100)}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.3" 
                    max="1.2" 
                    step="0.01" 
                    value={previewZoom}
                    onChange={(e) => setPreviewZoom(parseFloat(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>

                {/* Player Scale control */}
                <div className="flex flex-col gap-1 w-28 sm:w-32">
                  <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    <span>Spelare</span>
                    <span className="text-zinc-400">{Math.round(playerScale * 100)}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.5" 
                    max="1.5" 
                    step="0.05" 
                    value={playerScale}
                    onChange={(e) => {
                      setPlayerScale(parseFloat(e.target.value));
                      setHasUnsavedChanges(true);
                    }}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-400"
                  />
                </div>

                {/* Quick reset button */}
                <button
                  onClick={() => {
                    setPreviewZoom(0.85);
                    setPlayerScale(1.0);
                  }}
                  className="p-2 bg-zinc-800 hover:bg-zinc-700 hover:text-white text-zinc-400 rounded-xl transition-all"
                  title="Återställ inställningar"
                >
                  <RotateCcw size={14} />
                </button>

                {/* Switch Orientation */}
                <button
                  onClick={() => {
                    const newOrientation = orientation === 'landscape' ? 'vertical' : 'landscape';
                    setOrientation(newOrientation);
                    if (newOrientation === 'landscape') {
                      setAttackDirection('right');
                    } else {
                      setAttackDirection('up');
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 hover:text-white text-zinc-300 rounded-xl transition-all text-[9px] font-black uppercase tracking-widest whitespace-nowrap"
                >
                  <RefreshCw size={10} />
                  <span>{orientation === 'landscape' ? 'Stående' : 'Liggande'}</span>
                </button>
              </div>

              {/* Close button */}
              <button 
                onClick={() => {
                  setShowPreview(false);
                  setIsScreenshotMode(false);
                }}
                className="p-2 sm:p-2.5 bg-zinc-800 hover:bg-red-950 hover:text-red-300 text-zinc-400 rounded-full transition-all active:scale-90"
              >
                <X size={18} />
              </button>
            </div>

            {/* Immersive Preview Area */}
            <div 
              className={`flex-1 w-full max-w-full flex items-center justify-center overflow-auto p-4 transition-all duration-300 ${isScreenshotMode ? 'p-0 bg-zinc-950' : 'bg-zinc-900/10'}`}
              onClick={isScreenshotMode ? () => {
                setIsScreenshotMode(false);
                setShowScreenshotTip(false);
              } : undefined}
            >
              <div 
                className="transition-transform duration-300 origin-center select-none animate-in fade-in zoom-in-95 duration-500 w-full max-w-full flex justify-center"
                style={{ 
                  maxWidth: '1000px',
                }}
              >
                {/* Simulated Device Frame Border for preview if not in screenshot mode */}
                <div className={`transition-all duration-300 overflow-hidden ${isScreenshotMode ? 'rounded-none border-none shadow-none p-0' : 'bg-white dark:bg-zinc-900 rounded-3xl shadow-[0_0_85px_rgba(0,0,0,0.65)] border border-white/5 overflow-hidden'}`}>
                  {renderLineupContent(true)}
                </div>
              </div>
            </div>

            {/* Bottom action bar - Fades out in screenshot mode */}
            <div className={`w-full p-6 bg-gradient-to-t from-zinc-950 to-transparent flex justify-center items-center gap-4 z-[260] transition-all duration-300 ${isScreenshotMode ? 'opacity-0 pointer-events-none h-0 p-0 overflow-hidden' : 'opacity-100'}`}>
              <button
                onClick={() => {
                  setIsScreenshotMode(true);
                  setShowScreenshotTip(true);
                  setTimeout(() => {
                    setShowScreenshotTip(false);
                  }, 3000);
                }}
                className="flex items-center justify-center gap-2 px-8 py-4 bg-white text-zinc-950 hover:bg-zinc-100 rounded-2xl font-black uppercase text-[11px] tracking-widest shadow-2xl transition-all active:scale-95 duration-200"
              >
                <Camera size={16} />
                <span>Klar för skärmbild! (Dölj knappar)</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
