/**
 * Menyposten Taktiktavla: lagets egna taktiktavlor.
 *
 * Tränare skapar, döper om, kopierar, delar och tar bort tavlor. En ny tavla är tom; spelare
 * från truppen tas fram via knappen Visa truppen. Själva tavlan är samma taktiktavla som under Uppställning
 * (LineupBuilder i läget standaloneBoard). Spelare ser bara tavlor som tränaren har delat, och
 * deras ändringar sparas inte.
 *
 * Varje tavla sparas för sig via /api/tacticalboards (se server/tacticalBoards.ts).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Edit2, Eye, EyeOff, MoreHorizontal, Plus, Presentation, Trash2 } from 'lucide-react';
import type { Lineup, LineupPlayer, SquadPlayer, TeamTacticalBoard } from '../types';
import { listTacticalBoards, saveTacticalBoard, deleteTacticalBoard } from '../lib/firebase';
import { Button, Card, EmptyState, IconButton, MenuItem, Sheet, TextInput } from './ui';
import LineupBuilder from './LineupBuilder';

type BuilderProps = React.ComponentProps<typeof LineupBuilder>;

interface Props {
  clubId?: string | null;
  teamId?: string | null;
  /** Appen räknar den inloggade som tränare/admin (används bara för att förklara om servern inte gör det). */
  isCoachOrAdmin?: boolean;
  squad: SquadPlayer[];
  /** Det som taktiktavlan behöver från appen (formationer, inloggad användare m.m.). */
  builderProps: Pick<BuilderProps, 'user' | 'onUpdateSquad' | 'customFormations' | 'pinnedFormationIds' | 'onTogglePinFormation' | 'onSaveCustomFormation' | 'onDeleteCustomFormation'>;
  /** Talar om för appen när en tavla är öppen (då döljs menyerna). */
  onBoardOpenChange?: (open: boolean) => void;
}

const INPUT = 'w-full h-12 px-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-base font-semibold text-zinc-900 dark:text-white placeholder:text-zinc-400 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-indigo-500/60';
const newId = () => `tb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const isLeader = (p: SquadPlayer) => p.role === 'leader' || /_leader$/.test(p.id);

const formatDate = (ms: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })} kl. ${d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
};

// Tavlan som en "uppställning", så att LineupBuilder kan visa den. Spelare som inte står på
// planen ligger på bänken, så att hela truppen går att ta fram.
function boardToLineup(board: TeamTacticalBoard, squad: SquadPlayer[]): Lineup {
  const st = board.state || {};
  const placed: LineupPlayer[] = (st.players || []).filter(p => !p.isSubstitute);
  const placedIds = new Set(placed.map(p => p.playerId));
  const bench: LineupPlayer[] = squad
    .filter(sp => !isLeader(sp) && !placedIds.has(sp.id))
    .map(sp => ({ id: `tbp_${sp.id}`, playerId: sp.id, x: 50, y: 50, isSubstitute: true }));
  const players = [...placed, ...bench];
  return {
    id: board.id,
    matchTitle: board.name,
    date: board.updatedAt || Date.now(),
    players,
    formation: st.formation || '',
    playerScale: st.playerScale || 1,
    pitchType: st.pitchType || 'classic',
    orientation: st.orientation || 'vertical',
    attackDirection: st.attackDirection || (st.orientation === 'landscape' ? 'right' : 'up'),
    showPhoto: true,
    showName: true,
    showNumber: true,
    tacticalBoard: {
      drawings: st.drawings || [],
      footballPos: st.footballPos || null,
      ...(st.footballs ? { footballs: st.footballs } : {}),
      footballScale: st.footballScale || 1,
      opponents: st.opponents || [],
      showOpponents: st.showOpponents ?? true,
      showPositionDescriptions: st.showPositionDescriptions ?? false,
      opponentColor: st.opponentColor || '#ef4444',
      players,
      ...(st.animation ? { animation: st.animation } : {}),
    },
  };
}

// Tillbaka från "uppställning" till det som sparas för tavlan. Bänken sparas inte.
function lineupToState(l: Lineup): TeamTacticalBoard['state'] {
  const tb = l.tacticalBoard;
  return {
    drawings: tb?.drawings || [],
    // Den gula markeringen för en nyss framtagen spelare sparas inte.
    players: (tb?.players || l.players || []).filter(p => !p.isSubstitute).map(p => ({ ...p, isHolding: false })),
    opponents: tb?.opponents || [],
    footballPos: tb?.footballPos || null,
    ...(tb?.footballs ? { footballs: tb.footballs } : {}),
    footballScale: tb?.footballScale || 1,
    showOpponents: tb?.showOpponents ?? true,
    showPositionDescriptions: tb?.showPositionDescriptions ?? false,
    opponentColor: tb?.opponentColor || '#ef4444',
    pitchType: l.pitchType,
    orientation: l.orientation,
    attackDirection: l.attackDirection,
    playerScale: l.playerScale,
    formation: l.formation,
    ...(tb?.animation ? { animation: tb.animation } : {}),
  };
}

export default function TacticalBoardsView({ clubId, teamId, isCoachOrAdmin, squad, builderProps, onBoardOpenChange }: Props) {
  const [boards, setBoards] = useState<TeamTacticalBoard[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openLineup, setOpenLineup] = useState<Lineup | null>(null);
  const [nameSheet, setNameSheet] = useState<{ mode: 'new' | 'rename'; id?: string; value: string } | null>(null);
  const [menuFor, setMenuFor] = useState<TeamTacticalBoard | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TeamTacticalBoard | null>(null);

  // Senaste versionen av tavlorna, för sparningar som sker efter att tavlan stängts.
  const boardsRef = useRef<TeamTacticalBoard[]>([]);
  boardsRef.current = boards;
  const pendingRef = useRef<{ lineup: Lineup; timer: ReturnType<typeof setTimeout> } | null>(null);

  const load = useCallback(async () => {
    if (!clubId || !teamId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const r = await listTacticalBoards(clubId, teamId);
      setBoards(r.boards || []);
      setCanEdit(!!r.canEdit);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Kunde inte hämta taktiktavlorna.');
    } finally {
      setLoading(false);
    }
  }, [clubId, teamId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { onBoardOpenChange?.(!!openLineup); }, [openLineup, onBoardOpenChange]);
  useEffect(() => () => onBoardOpenChange?.(false), [onBoardOpenChange]);

  // Sparar en tavla på servern och uppdaterar listan.
  const persist = useCallback(async (board: TeamTacticalBoard) => {
    if (!clubId || !teamId) return;
    setBoards(prev => {
      const exists = prev.some(b => b.id === board.id);
      return exists ? prev.map(b => (b.id === board.id ? board : b)) : [board, ...prev];
    });
    try {
      const saved = await saveTacticalBoard(clubId, teamId, board);
      if (saved) setBoards(prev => prev.map(b => (b.id === saved.id ? saved : b)));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Kunde inte spara taktiktavlan.');
    }
  }, [clubId, teamId]);

  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    const meta = boardsRef.current.find(b => b.id === p.lineup.id);
    if (!meta) return;
    persist({ ...meta, state: lineupToState(p.lineup), updatedAt: Date.now() });
  }, [persist]);

  useEffect(() => () => flushPending(), [flushPending]);

  // Taktiktavlan rapporterar ändringar hit. Tränarens ändringar sparas efter en kort stund.
  const handleUpdate = useCallback((l: Lineup) => {
    setOpenLineup(prev => (prev && prev.id === l.id ? l : prev));
    if (!canEdit) return;
    if (pendingRef.current) clearTimeout(pendingRef.current.timer);
    pendingRef.current = { lineup: l, timer: setTimeout(flushPending, 800) };
  }, [canEdit, flushPending]);

  const openBoard = (b: TeamTacticalBoard) => setOpenLineup(boardToLineup(b, squad));
  const closeBoard = () => {
    flushPending();
    setOpenLineup(null);
  };

  const createBoard = async (name: string) => {
    const now = Date.now();
    const board: TeamTacticalBoard = { id: newId(), name, sharedWithPlayers: false, createdAt: now, updatedAt: now, state: {} };
    await persist(board);
    openBoard(board);
  };

  const copyBoard = (b: TeamTacticalBoard) => {
    const now = Date.now();
    persist({ ...b, id: newId(), name: `Kopia av ${b.name}`.slice(0, 120), sharedWithPlayers: false, createdAt: now, updatedAt: now });
  };

  const removeBoard = async (b: TeamTacticalBoard) => {
    if (!clubId || !teamId) return;
    setBoards(prev => prev.filter(x => x.id !== b.id));
    try {
      await deleteTacticalBoard(clubId, teamId, b.id);
    } catch (e: any) {
      setError(e?.message || 'Kunde inte ta bort taktiktavlan.');
      load();
    }
  };

  const toggleShared = (b: TeamTacticalBoard) => persist({ ...b, sharedWithPlayers: !b.sharedWithPlayers });

  const submitName = () => {
    if (!nameSheet) return;
    const name = nameSheet.value.trim();
    if (!name) return;
    if (nameSheet.mode === 'new') {
      createBoard(name);
    } else {
      const b = boards.find(x => x.id === nameSheet.id);
      if (b) persist({ ...b, name });
    }
    setNameSheet(null);
  };

  const sorted = useMemo(() => [...boards].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [boards]);

  // En öppen tavla visas i hela fönstret.
  if (openLineup) {
    return (
      <LineupBuilder
        key={openLineup.id}
        {...builderProps}
        standaloneBoard
        onExitBoard={closeBoard}
        squad={squad}
        lineup={openLineup}
        lineups={[]}
        onUpdateLineup={handleUpdate}
        onSaveLineup={handleUpdate}
        onDeleteLineup={() => {}}
        onSelectLineup={() => {}}
        onCopyLineup={() => {}}
        onReorderLineups={() => {}}
        isCoachOrAdmin={canEdit}
      />
    );
  }

  if (!clubId || !teamId) {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <EmptyState icon={<Presentation size={28} />} title="Välj ett lag" text="Taktiktavlorna hör till ett lag. Välj lag i kontomenyn." />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full p-4 sm:p-6 flex flex-col gap-4 pb-24">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md">
            {canEdit
              ? 'Lagets taktiktavlor. En ny tavla är tom – ta fram spelare med knappen Visa truppen. Spelarna ser bara tavlor du delar.'
              : 'Taktiktavlor som tränarna har delat med laget.'}
          </p>
          {canEdit && (
            <Button icon={<Plus size={18} />} onClick={() => setNameSheet({ mode: 'new', value: `Taktiktavla ${new Date().toLocaleDateString('sv-SE')}` })}>
              Ny tavla
            </Button>
          )}
        </div>

        {error && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-sm font-semibold text-red-700 dark:text-red-300">
            <span>{error}</span>
            <Button size="sm" variant="secondary" onClick={load}>Försök igen</Button>
          </div>
        )}

        {!loading && !error && isCoachOrAdmin && !canEdit && (
          <div className="px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-sm font-semibold text-amber-800 dark:text-amber-200">
            Du är inte registrerad som tränare i det här laget, så du kan bara se delade tavlor. Kontrollera din roll under Truppen eller Administration.
          </div>
        )}

        {loading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 py-8 text-center">Hämtar taktiktavlor…</p>
        ) : error && sorted.length === 0 ? null : sorted.length === 0 ? (
          <EmptyState
            icon={<Presentation size={28} />}
            title={canEdit ? 'Inga taktiktavlor än' : 'Inga delade taktiktavlor'}
            text={canEdit ? 'Skapa en tavla för t.ex. fasta situationer, press eller uppspel.' : 'När en tränare delar en tavla syns den här.'}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map(b => (
              <Card key={b.id} padded={false} className="flex items-center gap-2 p-2 pl-3">
                <button
                  type="button"
                  onClick={() => openBoard(b)}
                  className="flex-1 min-w-0 flex items-center gap-3 py-2 text-left cursor-pointer"
                >
                  <span className="w-11 h-11 shrink-0 rounded-xl bg-emerald-600/90 text-white flex items-center justify-center">
                    <Presentation size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-zinc-900 dark:text-white truncate">{b.name}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      Ändrad {formatDate(b.updatedAt)}
                      {canEdit && (b.sharedWithPlayers ? ' · Delad med spelarna' : ' · Bara tränare')}
                    </span>
                  </span>
                </button>
                {canEdit && (
                  <>
                    <IconButton
                      label={b.sharedWithPlayers ? 'Delad med spelarna – tryck för att sluta dela' : 'Inte delad – tryck för att dela med spelarna'}
                      className={`w-11 h-11 ${b.sharedWithPlayers ? 'text-indigo-600 dark:text-indigo-300' : ''}`}
                      onClick={() => toggleShared(b)}
                    >
                      {b.sharedWithPlayers ? <Eye size={20} /> : <EyeOff size={20} />}
                    </IconButton>
                    <IconButton label={`Mer för ${b.name}`} className="w-11 h-11" onClick={() => setMenuFor(b)}>
                      <MoreHorizontal size={20} />
                    </IconButton>
                  </>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Namn för ny tavla eller nytt namn */}
      <Sheet
        open={!!nameSheet}
        onClose={() => setNameSheet(null)}
        title={nameSheet?.mode === 'rename' ? 'Byt namn' : 'Ny taktiktavla'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNameSheet(null)}>Avbryt</Button>
            <Button onClick={submitName} disabled={!nameSheet?.value.trim()}>{nameSheet?.mode === 'rename' ? 'Spara' : 'Skapa och öppna'}</Button>
          </div>
        }
      >
        <label className="flex flex-col gap-1.5 px-2 pb-2">
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Namn</span>
          <TextInput
            autoFocus
            type="text"
            className={INPUT}
            value={nameSheet?.value || ''}
            maxLength={120}
            onChange={(e) => setNameSheet(prev => (prev ? { ...prev, value: e.target.value } : prev))}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => { if (e.key === 'Enter') submitName(); }}
            placeholder="T.ex. Hörnor anfall"
          />
        </label>
      </Sheet>

      {/* Fler val för en tavla */}
      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.name}>
        {menuFor && (
          <div className="flex flex-col gap-1 px-2 pb-2">
            <MenuItem icon={<Edit2 size={18} />} label="Byt namn" onClick={() => { setNameSheet({ mode: 'rename', id: menuFor.id, value: menuFor.name }); setMenuFor(null); }} />
            <MenuItem icon={<Copy size={18} />} label="Kopiera" description="Kopian delas inte med spelarna" onClick={() => { copyBoard(menuFor); setMenuFor(null); }} />
            <MenuItem
              icon={menuFor.sharedWithPlayers ? <EyeOff size={18} /> : <Eye size={18} />}
              label={menuFor.sharedWithPlayers ? 'Sluta dela med spelarna' : 'Dela med spelarna'}
              onClick={() => { toggleShared(menuFor); setMenuFor(null); }}
            />
            <MenuItem icon={<Trash2 size={18} />} tone="danger" label="Ta bort" onClick={() => { setConfirmDelete(menuFor); setMenuFor(null); }} />
          </div>
        )}
      </Sheet>

      {/* Bekräfta borttagning */}
      <Sheet
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Ta bort taktiktavlan?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Avbryt</Button>
            <Button variant="danger" icon={<Trash2 size={18} />} onClick={() => { if (confirmDelete) removeBoard(confirmDelete); setConfirmDelete(null); }}>Ta bort</Button>
          </div>
        }
      >
        <p className="px-3 pb-3 text-sm text-zinc-600 dark:text-zinc-300">
          "{confirmDelete?.name}" tas bort för alla i laget. Det går inte att ångra.
        </p>
      </Sheet>
    </div>
  );
}
