export interface SquadPlayer {
  id: string;
  name: string;
  position?: string;
  number?: string;
  photoUrl?: string;
  role?: 'player' | 'leader';
}

export interface LineupPlayer {
  id: string;
  playerId: string;
  x: number; // 0-100 percent
  y: number; // 0-100 percent
  isSubstitute: boolean;
  isHolding?: boolean;
}

export interface Lineup {
  id: string;
  matchTitle: string;
  teamName?: string;
  date: number;
  players: LineupPlayer[];
  playerScale?: number; // 0.5 to 1.5
  nameTagStyle?: 'light' | 'dark';
  nameDisplayMode?: 'first' | 'last' | 'full' | 'initials' | 'firstLastInitial' | 'initialLastName';
  showNameBackground?: boolean;
  nameBackgroundType?: 'classic' | 'badge' | 'minimal' | 'solid' | 'none' | 'transparent';
  formation?: string;
  showPhoto?: boolean;
  showNumber?: boolean;
  showName?: boolean;
  isArchived?: boolean;
  teamLogoUrl?: string;
  pitchType?: 'classic' | 'grass' | 'blue' | 'solid-blue' | 'blue-stripes' | 'blue-grass' | 'solid-white' | 'solid-black';
  orientation?: 'vertical' | 'landscape';
  attackDirection?: 'up' | 'down' | 'left' | 'right';
  notes?: {
    team?: {
      text: string;
      media?: string[];
    };
    opponent?: {
      text: string;
      media?: string[];
    };
  };
  tacticalBoard?: {
    drawings: any[];
    footballPos: { x: number, y: number } | null;
    footballScale?: number;
    opponents: { id: string, x: number, y: number }[];
    showOpponents: boolean;
    opponentColor?: string;
    players?: LineupPlayer[];
  };
  savedTacticalBoards?: TacticalSavedBoard[];
}

export interface TacticalSavedBoard {
  id: string;
  name: string;
  createdAt: number;
  drawings: any[];
  opponents: { id: string, x: number, y: number }[];
  players: LineupPlayer[];
  footballPos: { x: number, y: number } | null;
  footballs?: { id: string, x: number, y: number }[];
  footballScale?: number;
  elementScale?: number;
  showOpponents: boolean;
  opponentColor?: string;
  pitchType?: string;
  pitchSize?: 'full' | 'half';
  orientation?: 'vertical' | 'landscape';
  attackDirection?: 'up' | 'down' | 'left' | 'right';
}

export interface Team {
  id: string;
  name: string;
  color: string;
  score: number;
  playerIds: string[];
}

export interface PeriodStandings {
  playerId: string;
  playerName: string;
  points: number;
  photoUrl?: string | null;
}

export interface BonusPoint {
  id: string;
  playerId: string;
  points: number;
  reason: string;
  date: number;
}

export interface Period {
  id: string;
  name: string;
  startDate: number;
  endDate?: number; // Optional, if present the period is closed
  standings: PeriodStandings[];
  isActive?: boolean; // New field to track which period is currently active for new exercises
  shareId?: string; // ID for the shared version of this period
  bonusPoints?: BonusPoint[];
}

export interface PointsConfig {
  first: number;
  second: number;
  third: number;
}

export interface SessionMoment {
  id: string;
  name: string;
  duration: number; // in minutes
  description?: string;
  exerciseId?: string; // Link to a standalone exercise if applicable
  bankExerciseId?: string; // Link to a bank exercise if applicable
  imageUrl?: string;
  imageUrls?: string[];
  externalLink?: string;
  tacticalBoards?: TacticalSavedBoard[];
}

export interface TrainingSettings {
  defaultStartTime: string;
  defaultEndTime?: string;
  defaultDuration?: number;
  icsUrl?: string;
}

export interface CoachData {
  squad: SquadPlayer[];
  exercises: Exercise[];
  sessions: TrainingSession[];
  deletedSessions?: TrainingSession[];
  lineups: Lineup[];
  activeLineupId: string | null;
  periods: Period[];
  currentPeriodId: string | null;
  activeExerciseId: string | null;
  teamUrl?: string;
  adminUrl?: string;
  seriesUrl?: string;
  customFormations?: FormationVariant[];
  pinnedFormationIds?: string[];
  trainingSettings?: TrainingSettings;
  exerciseBank?: BankExercise[];
  exerciseBankCategories?: string[];
}

export interface TrainingSession {
  id: string;
  title: string;
  date: number; // Timestamp
  startTime: string; // "HH:MM"
  endTime?: string; // Optional
  location?: string; // Location of the event
  moments: SessionMoment[];
  attendance?: string[]; // Player IDs or names
  guestPlayers?: SquadPlayer[];
  isCompleted?: boolean;
  isStarted?: boolean;
  isIgnored?: boolean;
  isPlanned?: boolean;
  isLocallyEdited?: boolean;
  actualStartTime?: number;
  notes?: string;
  description?: string;
  externalId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Exercise {
  id: string;
  name: string;
  icon: string;
  date: number;
  teams: Team[];
  sortByScore: boolean;
  showTimer: boolean;
  defaultTimerMinutes: number;
  defaultTimerSeconds: number;
  createdAt: number;
  updatedAt: number;
  isFinished?: boolean;
  finishedAt?: number;
  jokerPlayerIds?: string[];
  pointsConfig?: PointsConfig;
  periodId?: string;
  sessionId?: string; // Optional link to a training session
}

// Keep these for backward compatibility during transition if needed, 
// but we'll migrate the app to use Exercise and Team.
export interface Player {
  id: string;
  name: string;
  color: string;
  score: number;
}

export interface Game extends Exercise {
  players: Player[]; // This will be deprecated
}

export interface FormationPosition {
  x: number;
  y: number;
}

export interface FormationVariant {
  id: string;
  name: string;
  description: string;
  positions: FormationPosition[]; // 10 outfield players (0-9)
  gkPosition?: FormationPosition; // Optional Goalkeeper position
}

export interface FormationTemplate {
  id: string;
  name: string;
  category: string;
  variants: FormationVariant[];
}

export const GAME_ICONS = [
  'Trophy',
  'Gamepad2',
  'Dice5',
  'Target',
  'Sword',
  'Shield',
  'Crown',
  'Star',
  'Heart',
  'Zap',
  'Flame',
  'Ghost',
  'Skull',
  'Rocket',
  'Car',
  'Bike',
  'Footprints',
  'Dribbble',
  'Music',
  'Coffee',
];

export const PRESET_COLORS = [
  "#ef4444", // red-500
  "#f97316", // orange-500
  "#f59e0b", // amber-500
  "#eab308", // yellow-500
  "#84cc16", // lime-500
  "#22c55e", // green-500
  "#10b981", // emerald-500
  "#06b6d4", // cyan-500
  "#0ea5e9", // sky-500
  "#3b82f6", // blue-500
  "#6366f1", // indigo-500
  "#8b5cf6", // violet-500
  "#a855f7", // purple-500
  "#d946ef", // fuchsia-500
  "#ec4899", // pink-500
  "#f43f5e", // rose-500
  "#71717a", // zinc-500
  "#4b5563", // gray-600
  "#1e3a8a", // blue-900 (navy)
  "#18181b", // zinc-950
  "#ffffff", // white
];

export const VEST_COLORS = [
  '#1E3A8A', // Navy (Tröjfärg)
  '#84CC16', // Lime
  '#0EA5E9', // Sky
  '#F97316', // Orange
  '#71717A', // Zinc
];

export interface BankExercise {
  id: string;
  name: string;
  duration: number; // default duration in minutes
  description?: string;
  category?: string; // e.g. 'Uppvärmning', 'Teknik', 'Spel', 'Fys', 'Annat'
  categories?: string[]; // Multiple categories / labels
  imageUrl?: string;
  imageUrls?: string[];
  externalLink?: string;
  createdAt: number;
  tacticalBoards?: TacticalSavedBoard[];
}

