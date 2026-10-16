import React, { useState, useRef, useMemo } from 'react';
import { UserPlus, UserCheck, Send, Trash2, Edit2, X, Users, Upload, FileSpreadsheet, ClipboardList, Camera, Loader2, ArrowUpDown, Check, Search, AlertTriangle, Activity, MoreVertical } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { Badge, Button, Card, EmptyState, IconButton, MenuItem, SectionHeader, SegmentedTabs, Sheet } from './ui';
import { storage, db, ref, uploadBytes, getDownloadURL, getApiUrl, getAuthHeader, doc, getDoc, createInvite } from '../lib/firebase';
import InviteShareModal from './InviteShareModal';
import { SquadPlayer, ClubMember, ClubTeam, TrainingSession } from '../types';
import { deduplicateSquad } from '../lib/clubUtils';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import ImageCropper from './ImageCropper';
import { CachedImage } from './CachedImage';
import { sortLeadersByPosition } from '../lib/teamUtils';
import SquadAttendanceOverview from './SquadAttendanceOverview';

type SortOption = 'standard' | 'number' | 'position' | 'firstname' | 'lastname';

function getLastName(fullName: string): string {
  const name = fullName.trim();
  const lastSpace = name.lastIndexOf(' ');
  if (lastSpace === -1) return '';
  return name.slice(lastSpace + 1);
}

function getFirstName(fullName: string): string {
  const name = fullName.trim();
  const lastSpace = name.lastIndexOf(' ');
  if (lastSpace === -1) return name;
  return name.slice(0, lastSpace);
}

function parseNumber(numStr?: string): number {
  if (!numStr) return Infinity; // Put players without numbers at the end
  const parsed = parseInt(numStr.replace(/\D/g, ''), 10);
  return isNaN(parsed) ? Infinity : parsed;
}

function getPositionWeight(pos?: string): number {
  if (!pos) return 99; // Put players without position at the end
  const p = pos.toLowerCase();
  if (p.includes('mål') || p.includes('mv') || p.includes('gk') || p.includes('keeper')) return 1;
  if (p.includes('back') || p.includes('försvar') || p.includes('def') || p.includes('mittback') || p.includes('ytterback')) return 2;
  if (p.includes('mitt') || p.includes('mf') || p.includes('mid') || p.includes('cen')) return 3;
  if (p.includes('anfall') || p.includes('forward') || p.includes('fw') || p.includes('topp') || p.includes('straff') || p.includes('ytteranfall')) return 4;
  if (p.includes('ledar') || p.includes('tränare') || p.includes('coach')) return 5;
  return 10; // Other positions
}

const comparePlayersByNumber = (a: SquadPlayer, b: SquadPlayer) => {
  const numA = parseNumber(a.number);
  const numB = parseNumber(b.number);
  if (numA !== numB) return numA - numB;
  return a.name.localeCompare(b.name, 'sv');
};

const compareByPosition = (a: SquadPlayer, b: SquadPlayer) => {
  const weightA = getPositionWeight(a.position);
  const weightB = getPositionWeight(b.position);
  if (weightA !== weightB) return weightA - weightB;

  // Secondary: sort by position name alphabetically to keep identical ones together
  const posA = a.position || '';
  const posB = b.position || '';
  const compPos = posA.localeCompare(posB, 'sv');
  if (compPos !== 0) return compPos;

  // Tertiary: sort by shirt number
  const numA = parseNumber(a.number);
  const numB = parseNumber(b.number);
  if (numA !== numB) return numA - numB;

  return a.name.localeCompare(b.name, 'sv');
};

const compareByFirstName = (a: SquadPlayer, b: SquadPlayer) => {
  const firstA = getFirstName(a.name);
  const firstB = getFirstName(b.name);
  const comp = firstA.localeCompare(firstB, 'sv');
  if (comp !== 0) return comp;
  return getLastName(a.name).localeCompare(getLastName(b.name), 'sv');
};

const compareByLastName = (a: SquadPlayer, b: SquadPlayer) => {
  const lastA = getLastName(a.name);
  const lastB = getLastName(b.name);
  const comp = lastA.localeCompare(lastB, 'sv');
  if (comp !== 0) return comp;
  return getFirstName(a.name).localeCompare(getFirstName(b.name), 'sv');
};

interface SquadManagerProps {
  squad: SquadPlayer[];
  sessions?: TrainingSession[];
  onUpdateSquad: (squad: SquadPlayer[]) => void;
  activeClubId?: string | null;
  activeTeamId?: string | null;
  isCoachOrAdmin?: boolean;
  key?: React.Key;
}

export default function SquadManager({ squad, sessions = [], onUpdateSquad, activeClubId, activeTeamId, isCoachOrAdmin = true }: SquadManagerProps) {
  const [activeTab, setActiveTab] = useState<'roster' | 'attendance'>('roster');
  const [invite, setInvite] = useState<{ name: string; link?: string; expiresAt?: number; error?: string; loading?: boolean } | null>(null);

  const handleInvite = async (player: SquadPlayer) => {
    if (!activeClubId) return;
    setInvite({ name: player.name, loading: true });
    try {
      const res = await createInvite(activeClubId, player.id);
      setInvite({ name: player.name, link: res.link, expiresAt: res.expiresAt });
    } catch (err: any) {
      setInvite({ name: player.name, error: err?.message || 'Kunde inte skapa inbjudan' });
    }
  };
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuPersonId, setMenuPersonId] = useState<string | null>(null);
  const [showSortSheet, setShowSortSheet] = useState(false);
  const [showSquadMenu, setShowSquadMenu] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPosition, setNewPosition] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [newPhotoUrl, setNewPhotoUrl] = useState('');
  const [newRole, setNewRole] = useState<'player' | 'leader'>('player');
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<SquadPlayer | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [playerToRemove, setPlayerToRemove] = useState<SquadPlayer | null>(null);
  const [pasteData, setPasteData] = useState('');
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch team members state
  const [showFetchMembersModal, setShowFetchMembersModal] = useState(false);
  const [isFetchingMembers, setIsFetchingMembers] = useState(false);
  const [fetchedMembers, setFetchedMembers] = useState<ClubMember[]>([]);
  const [selectedMemberUserIds, setSelectedMemberUserIds] = useState<string[]>([]);
  const [activeTeamName, setActiveTeamName] = useState<string>('');
  const [fetchFilterShowAll, setFetchFilterShowAll] = useState(false);
  const [fetchSearchQuery, setFetchSearchQuery] = useState('');
  const [fetchStatusMessage, setFetchStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [sortBy, setSortBy] = useState<SortOption>(() => {
    return (localStorage.getItem('squad_sort_by') as SortOption) || 'standard';
  });

  const handleSortChange = (option: SortOption) => {
    setSortBy(option);
    localStorage.setItem('squad_sort_by', option);
  };

  // Quick 30-day attendance lookup for players
  const quickAttendanceMap = useMemo(() => {
    if (!sessions || sessions.length === 0) return new Map<string, { pct: number; attended: number; total: number }>();
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentSessions = sessions.filter(s => {
      if (!s || s.isIgnored) return false;
      const d = Number(s.date);
      if (isNaN(d) || d < thirtyDaysAgo) return false;
      return (s.attendance && s.attendance.length > 0) || s.isCompleted || d <= Date.now() + 86400000;
    });

    const total = recentSessions.length;
    const map = new Map<string, { pct: number; attended: number; total: number }>();
    if (total === 0) return map;

    for (const p of squad) {
      const cleanName = p.name.trim().toLowerCase();
      const rawId = p.id.replace('_leader', '');
      let attended = 0;
      for (const s of recentSessions) {
        if (s.attendance && Array.isArray(s.attendance)) {
          const present = s.attendance.some((att: any) => {
            if (typeof att === 'string') {
              return att === p.id || att === rawId || att.replace('_leader', '') === rawId || att.trim().toLowerCase() === cleanName;
            }
            if (att && typeof att === 'object') {
              const objId = att.id || att.playerId;
              return objId === p.id || objId === rawId || (att.name && att.name.trim().toLowerCase() === cleanName);
            }
            return false;
          });
          if (present) attended++;
        }
      }
      const pct = total > 0 ? Math.round((attended / total) * 100) : 0;
      map.set(p.id, { pct, attended, total });
    }
    return map;
  }, [sessions, squad]);

  const handleOpenFetchMembersModal = async () => {
    setIsFetchingMembers(true);
    setShowFetchMembersModal(true);
    setFetchSearchQuery('');
    setFetchFilterShowAll(false);

    try {
      let clubIdToUse = activeClubId;
      let teamIdToUse = activeTeamId;

      if (!clubIdToUse) {
        setIsFetchingMembers(false);
        setFetchedMembers([]);
        setSelectedMemberUserIds([]);
        return;
      }

      const membersRef = doc(db, 'clubs', clubIdToUse, 'teams', 'club_global', 'data', 'members');
      const membersSnap = await getDoc(membersRef);

      const metaRef = doc(db, 'clubs', clubIdToUse, 'teams', 'club_global', 'data', 'metadata');
      const metaSnap = await getDoc(metaRef);
      if (metaSnap.exists()) {
        const teams: ClubTeam[] = metaSnap.data().teams || [];
        if (teamIdToUse) {
          const currentT = teams.find(t => t.id === teamIdToUse);
          if (currentT) setActiveTeamName(currentT.name);
        } else {
          setActiveTeamName(metaSnap.data().name || '');
        }
      }

      if (membersSnap.exists()) {
        const members: ClubMember[] = membersSnap.data().members || [];
        setFetchedMembers(members);

        const relevantMembers = teamIdToUse 
          ? members.filter(m => m.teams && (m.teams.includes(teamIdToUse) || m.teams.length === 0 || (m.roles && (m.roles.includes('admin') || m.roles.includes('coach')))))
          : members;

        const autoSelected = relevantMembers
          .filter(m => {
            const cleanEmail = (m.email || '').trim().toLowerCase();
            const cleanName = (m.fullName || '').trim().toLowerCase();
            return !squad.some(sp => 
              (m.userId && sp.id === m.userId) ||
              (cleanEmail && sp.email && sp.email.trim().toLowerCase() === cleanEmail) ||
              (sp.name.trim().toLowerCase() === cleanName)
            );
          })
          .map(m => m.userId || m.fullName);

        setSelectedMemberUserIds(autoSelected);
      } else {
        setFetchedMembers([]);
        setSelectedMemberUserIds([]);
      }
    } catch (err) {
      console.error("Error fetching team members:", err);
    } finally {
      setIsFetchingMembers(false);
    }
  };

  const handleExecuteAddFetchedMembers = () => {
    if (selectedMemberUserIds.length === 0) return;

    const membersToAdd = fetchedMembers.filter(m => 
      selectedMemberUserIds.includes(m.userId || m.fullName)
    );

    let updatedSquad = [...squad];
    let countAdded = 0;
    let countUpdated = 0;

    for (const member of membersToAdd) {
      const cleanName = member.fullName.trim();
      const cleanEmail = (member.email || '').trim().toLowerCase();
      const memberUserId = member.userId;

      const hasPlayerRole = member.roles?.includes('player') || !member.roles?.some(r => r === 'coach' || r === 'admin');
      const hasLeaderRole = member.roles?.some(r => r === 'coach' || r === 'admin');

      const findIdx = (targetRole: 'player' | 'leader') => {
        return updatedSquad.findIndex(sp => {
          if (sp.role !== targetRole) return false;
          const baseSpId = (sp.id || '').replace('_leader', '');
          if (memberUserId && (sp.id === memberUserId || baseSpId === memberUserId)) return true;
          if (cleanEmail && sp.email && sp.email.trim().toLowerCase() === cleanEmail) return true;
          return sp.name.trim().toLowerCase() === cleanName.toLowerCase();
        });
      };

      if (hasPlayerRole) {
        const playerIdx = findIdx('player');
        if (playerIdx !== -1) {
          updatedSquad[playerIdx] = {
            ...updatedSquad[playerIdx],
            name: cleanName,
            email: member.email || updatedSquad[playerIdx].email,
            phone: member.phone || updatedSquad[playerIdx].phone,
            personnummer: member.personnummer || updatedSquad[playerIdx].personnummer,
            position: member.position || updatedSquad[playerIdx].position,
            number: member.number || updatedSquad[playerIdx].number,
            photoUrl: member.photoUrl || updatedSquad[playerIdx].photoUrl,
            role: 'player'
          };
          countUpdated++;
        } else {
          updatedSquad.push({
            id: memberUserId || crypto.randomUUID(),
            name: cleanName,
            email: member.email || undefined,
            phone: member.phone || undefined,
            personnummer: member.personnummer || undefined,
            position: member.position || undefined,
            number: member.number || undefined,
            photoUrl: member.photoUrl || undefined,
            role: 'player'
          });
          countAdded++;
        }
      }

      if (hasLeaderRole) {
        const leaderIdx = findIdx('leader');
        if (leaderIdx !== -1) {
          updatedSquad[leaderIdx] = {
            ...updatedSquad[leaderIdx],
            name: cleanName,
            email: member.email || updatedSquad[leaderIdx].email,
            phone: member.phone || updatedSquad[leaderIdx].phone,
            personnummer: member.personnummer || updatedSquad[leaderIdx].personnummer,
            position: member.position || updatedSquad[leaderIdx].position,
            number: member.number || updatedSquad[leaderIdx].number,
            photoUrl: member.photoUrl || updatedSquad[leaderIdx].photoUrl,
            role: 'leader'
          };
          countUpdated++;
        } else {
          updatedSquad.push({
            id: memberUserId ? `${memberUserId}_leader` : crypto.randomUUID(),
            name: cleanName,
            email: member.email || undefined,
            phone: member.phone || undefined,
            personnummer: member.personnummer || undefined,
            position: member.position || undefined,
            number: member.number || undefined,
            photoUrl: member.photoUrl || undefined,
            role: 'leader'
          });
          countAdded++;
        }
      }
    }

    onUpdateSquad(updatedSquad);
    setShowFetchMembersModal(false);
    setFetchStatusMessage({
      text: `${countAdded} nya medlemmar lagdes till och ${countUpdated} uppdaterades i truppen!`,
      type: 'success'
    });
    setTimeout(() => setFetchStatusMessage(null), 4500);
  };

  const displayMembers = useMemo(() => {
    let list = fetchedMembers;
    if (activeTeamId && !fetchFilterShowAll) {
      list = list.filter(m => m.teams && m.teams.includes(activeTeamId));
    }
    if (fetchSearchQuery.trim()) {
      const q = fetchSearchQuery.trim().toLowerCase();
      list = list.filter(m => 
        m.fullName.toLowerCase().includes(q) ||
        (m.email && m.email.toLowerCase().includes(q)) ||
        (m.phone && m.phone.includes(q))
      );
    }
    return list;
  }, [fetchedMembers, activeTeamId, fetchFilterShowAll, fetchSearchQuery]);

  const sortedPlayers = useMemo(() => {
    const players = Array.from(new Map(squad.filter(p => p.role !== 'leader').map(p => [p.id, p])).values());
    if (sortBy === 'firstname') {
      return players.sort(compareByFirstName);
    } else if (sortBy === 'lastname') {
      return players.sort(compareByLastName);
    } else if (sortBy === 'number') {
      return players.sort(comparePlayersByNumber);
    } else if (sortBy === 'position') {
      return players.sort(compareByPosition);
    } else {
      // 'standard': Position then shirt number
      return players.sort(compareByPosition);
    }
  }, [squad, sortBy]);

  const sortedLeaders = useMemo(() => {
    const leaders = Array.from(new Map(squad.filter(p => p.role === 'leader').map(p => [p.id, p])).values());
    if (sortBy === 'firstname') {
      return leaders.sort(compareByFirstName);
    } else if (sortBy === 'lastname') {
      return leaders.sort(compareByLastName);
    } else if (sortBy === 'number') {
      return leaders.sort(comparePlayersByNumber);
    } else if (sortBy === 'position') {
      return leaders.sort(compareByPosition);
    } else {
      return sortLeadersByPosition(leaders);
    }
  }, [squad, sortBy]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim()) {
      const newPlayer: SquadPlayer = {
        id: crypto.randomUUID(),
        name: newName.trim(),
        position: newPosition.trim() || undefined,
        number: newNumber.trim() || undefined,
        photoUrl: newPhotoUrl.trim() || undefined,
        role: newRole
      };
      onUpdateSquad([...squad, newPlayer]);
      setNewName('');
      setNewPosition('');
      setNewNumber('');
      setNewPhotoUrl('');
      setNewRole('player');
      setIsAdding(false);
    }
  };

  const handleClearSquad = () => {
    onUpdateSquad([]);
    setShowClearConfirm(false);
  };

  const handleRemove = (player: SquadPlayer) => {
    setPlayerToRemove(player);
  };

  const confirmRemove = () => {
    if (playerToRemove) {
      onUpdateSquad(squad.filter(p => p.id !== playerToRemove.id));
      setPlayerToRemove(null);
    }
  };

  const startEdit = (player: SquadPlayer) => {
    setEditingPlayer(player);
    setNewName(player.name);
    setNewPosition(player.position || '');
    setNewNumber(player.number || '');
    setNewPhotoUrl(player.photoUrl || '');
    setNewRole(player.role || 'player');
    setIsEditingModalOpen(true);
  };

  const handleSaveEdit = () => {
    if (editingPlayer && newName.trim()) {
      onUpdateSquad(squad.map(p => 
        p.id === editingPlayer.id 
          ? { 
              ...p, 
              name: newName.trim(), 
              position: newPosition.trim() || undefined,
              number: newNumber.trim() || undefined,
              photoUrl: newPhotoUrl.trim() || undefined,
              role: newRole
            } 
          : p
      ));
      setIsEditingModalOpen(false);
      setEditingPlayer(null);
      setNewName('');
      setNewPosition('');
      setNewNumber('');
      setNewPhotoUrl('');
      setNewRole('player');
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => setImageToCrop(reader.result as string));
    reader.readAsDataURL(file);
    
    // Reset file input so same file can be selected again
    if (e.target) e.target.value = '';
  };

  const onCropComplete = async (croppedBlob: Blob) => {
    setImageToCrop(null);
    setIsUploading(true);
    let finalPhotoUrl = '';

    // 1. First try server persistent upload
    try {
      const extension = croppedBlob.type === 'image/png' ? 'png' : 'jpg';
      const formData = new FormData();
      formData.append('file', croppedBlob, `photo_${Date.now()}.${extension}`);

      const res = await fetch(getApiUrl('/api/upload'), {
        method: 'POST',
        headers: getAuthHeader(),
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          finalPhotoUrl = data.url;
          setNewPhotoUrl(data.url);
        }
      }
    } catch (serverErr) {
      console.warn('Server upload fallback:', serverErr);
    }

    if (!finalPhotoUrl) {
      // 2. Try Firebase / Storage abstraction
      try {
        const extension = croppedBlob.type === 'image/png' ? 'png' : 'jpg';
        const fileName = `photo_${Date.now()}.${extension}`;
        const playerPath = editingPlayer ? `squad/${editingPlayer.id}/${fileName}` : `squad/temp/${fileName}`;
        const storageRef = ref(storage, playerPath);
        
        const uploadResult = await uploadBytes(storageRef, croppedBlob);
        finalPhotoUrl = await getDownloadURL(uploadResult.ref);
        setNewPhotoUrl(finalPhotoUrl);
      } catch (error) {
        console.warn("Storage upload fallback to Data URL:", error);
        // 3. Fallback: convert cropped blob to Data URL so photo upload never fails
        const reader = new FileReader();
        await new Promise<void>((resolve) => {
          reader.onloadend = () => {
            if (typeof reader.result === 'string') {
              finalPhotoUrl = reader.result;
              setNewPhotoUrl(finalPhotoUrl);
            }
            resolve();
          };
          reader.readAsDataURL(croppedBlob);
        });
      }
    }

    // Auto-update editingPlayer in squad if editing existing player
    if (editingPlayer && finalPhotoUrl) {
      onUpdateSquad(squad.map(p => 
        p.id === editingPlayer.id ? { ...p, photoUrl: finalPhotoUrl } : p
      ));
    }

    setIsUploading(false);
  };

  // Import conflict state
  const [pendingImportPlayers, setPendingImportPlayers] = useState<SquadPlayer[] | null>(null);
  const [importConflicts, setImportConflicts] = useState<Array<{ imported: SquadPlayer; existing: SquadPlayer }>>([]);
  const [importConflictOption, setImportConflictOption] = useState<'merge' | 'skip' | 'add_all'>('merge');
  const [showImportConflictModal, setShowImportConflictModal] = useState(false);

  const executeImportDirect = (playersToImport: SquadPlayer[], mode: 'merge' | 'skip' | 'add_all') => {
    let updatedSquad: SquadPlayer[] = [...squad];

    if (mode === 'merge') {
      for (const np of playersToImport) {
        const npName = np.name.trim().toLowerCase();
        const npPnr = (np.personnummer || '').replace(/\D/g, '');
        const npEmail = (np.email || '').trim().toLowerCase();
        const npNum = (np.number || '').trim();

        const idx = updatedSquad.findIndex(ex => {
          const exName = ex.name.trim().toLowerCase();
          const exPnr = (ex.personnummer || '').replace(/\D/g, '');
          const exEmail = (ex.email || '').trim().toLowerCase();
          const exNum = (ex.number || '').trim();

          if (npPnr && exPnr && npPnr === exPnr) return true;
          if (npEmail && exEmail && npEmail === exEmail) return true;
          if (exName === npName) {
            if (npNum && exNum) return npNum === exNum;
            return true;
          }
          return false;
        });

        if (idx !== -1) {
          const existing = updatedSquad[idx];
          const targetRole: 'leader' | 'player' = (existing.role === 'player' || np.role === 'player') ? 'player' : (existing.role === 'leader' || np.role === 'leader') ? 'leader' : 'player';
          updatedSquad[idx] = {
            ...existing,
            position: np.position || existing.position,
            number: np.number || existing.number,
            photoUrl: np.photoUrl || existing.photoUrl,
            email: np.email || existing.email,
            phone: np.phone || existing.phone,
            personnummer: np.personnummer || existing.personnummer,
            role: targetRole
          };
        } else {
          updatedSquad.push(np);
        }
      }
    } else if (mode === 'skip') {
      for (const np of playersToImport) {
        const npName = np.name.trim().toLowerCase();
        const npPnr = (np.personnummer || '').replace(/\D/g, '');
        const npEmail = (np.email || '').trim().toLowerCase();
        const npNum = (np.number || '').trim();

        const exists = updatedSquad.some(ex => {
          const exName = ex.name.trim().toLowerCase();
          const exPnr = (ex.personnummer || '').replace(/\D/g, '');
          const exEmail = (ex.email || '').trim().toLowerCase();
          const exNum = (ex.number || '').trim();

          if (npPnr && exPnr && npPnr === exPnr) return true;
          if (npEmail && exEmail && npEmail === exEmail) return true;
          if (exName === npName) {
            if (npNum && exNum) return npNum === exNum;
            return true;
          }
          return false;
        });

        if (!exists) {
          updatedSquad.push(np);
        }
      }
    } else {
      updatedSquad = [...updatedSquad, ...playersToImport];
    }

    const cleanResult = deduplicateSquad(updatedSquad);
    onUpdateSquad(cleanResult);
    setPendingImportPlayers(null);
    setImportConflicts([]);
    setShowImportConflictModal(false);
    setIsImporting(false);
    setPasteData('');
    setFetchStatusMessage({
      type: 'success',
      text: `Import klar! ${playersToImport.length} personer bearbetades och truppen sparades utan dubbletter.`
    });
    setTimeout(() => setFetchStatusMessage(null), 4000);
  };

  const processImportedData = (rows: string[][]) => {
    // rows is an array of [name, position, number, photoUrl]
    const newPlayers: SquadPlayer[] = rows
      .map(row => {
        let name = row[0]?.trim();
        const position = row[1]?.trim();
        const number = row[2]?.trim();
        const photoUrl = row[3]?.trim();

        // Specific cleanup for laget.se exports that include "Deltar" status
        if (name && name.endsWith(' Deltar')) {
          name = name.substring(0, name.length - 7).trim();
        }

        return { name, position, number, photoUrl };
      })
      .filter(p => {
        if (!p.name) return false;
        const lowerName = p.name.toLowerCase();
        return lowerName !== 'namn' && lowerName !== 'name' && lowerName !== 'deltar' && lowerName !== 'deltar:';
      })
      .map(p => {
        const positionStr = p.position || '';
        const lowerPos = positionStr.toLowerCase();
        
        // Define common leader keywords
        const leaderKeywords = [
          'tränare', 'ledare', 'lagledare', 'coach', 'manager', 'materialförvaltare', 
          'materialare', 'kiropraktor', 'kiropraktiker', 'styrelse', 'admin', 'scout', 
          'fysio', 'physio', 'fysioterapeut', 'naprapat', 'massör', 'massor', 'massageterapeut', 
          'analytiker', 'analyst', 'läkare', 'lakare', 'doctor', 'doc', 'fys', 
          'assisterande', 'huvudtränare', 'målvaktstränare', 'fystränare', 'ledarskap'
        ];
        
        const isLeader = leaderKeywords.some(kw => lowerPos.includes(kw));

        return {
          id: crypto.randomUUID(),
          name: p.name,
          position: p.position || undefined,
          number: p.number || undefined,
          photoUrl: p.photoUrl || undefined,
          role: (isLeader ? 'leader' : 'player') as 'leader' | 'player'
        };
      });
    
    if (newPlayers.length === 0) return;

    // Check for conflicts with existing squad
    const conflicts: Array<{ imported: SquadPlayer; existing: SquadPlayer }> = [];

    for (const np of newPlayers) {
      const npName = np.name.trim().toLowerCase();
      const npPnr = (np.personnummer || '').replace(/\D/g, '');
      const npEmail = (np.email || '').trim().toLowerCase();
      const npNum = (np.number || '').trim();

      const match = squad.find(ex => {
        const exName = ex.name.trim().toLowerCase();
        const exPnr = (ex.personnummer || '').replace(/\D/g, '');
        const exEmail = (ex.email || '').trim().toLowerCase();
        const exNum = (ex.number || '').trim();

        if (npPnr && exPnr && npPnr === exPnr) return true;
        if (npEmail && exEmail && npEmail === exEmail) return true;
        if (exName === npName) {
          if (npNum && exNum) return npNum === exNum;
          return true;
        }
        return false;
      });

      if (match) {
        conflicts.push({ imported: np, existing: match });
      }
    }

    if (conflicts.length > 0) {
      setPendingImportPlayers(newPlayers);
      setImportConflicts(conflicts);
      setImportConflictOption('merge');
      setShowImportConflictModal(true);
      setIsImporting(false);
    } else {
      executeImportDirect(newPlayers, 'merge');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (extension === 'csv') {
      Papa.parse(file, {
        complete: (results) => {
          const rows = results.data as string[][];
          processImportedData(rows);
        },
        header: false
      });
    } else if (extension === 'xlsx' || extension === 'xls') {
      reader.onload = (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];
        processImportedData(data);
      };
      reader.readAsBinaryString(file);
    }
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePasteImport = () => {
    const lines = pasteData.split('\n').filter(l => l.trim());
    const rows = lines.map(line => {
      // Split by tab first (Excel/Sheets paste), then by comma or semicolon
      if (line.includes('\t')) return line.split('\t');
      if (line.includes(';')) return line.split(';');
      if (line.includes(',')) return line.split(',');
      return [line];
    });
    processImportedData(rows);
  };

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: 'standard', label: 'Position och nummer' },
    { value: 'number', label: 'Tröjnummer' },
    { value: 'position', label: 'Position' },
    { value: 'firstname', label: 'Förnamn' },
    { value: 'lastname', label: 'Efternamn' },
  ];

  const matchesSearch = (p: SquadPlayer) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) ||
      (p.number || '').toLowerCase().includes(q) ||
      (p.position || '').toLowerCase().includes(q);
  };
  const visiblePlayers = sortedPlayers.filter(matchesSearch);
  const visibleLeaders = sortedLeaders.filter(matchesSearch);
  const playerCount = squad.filter(p => p.role !== 'leader').length;
  const leaderCount = squad.filter(p => p.role === 'leader').length;

  const closeEdit = () => {
    setIsEditingModalOpen(false);
    setEditingPlayer(null);
  };

  const openAdd = () => {
    setNewName('');
    setNewPosition('');
    setNewNumber('');
    setNewPhotoUrl('');
    setNewRole('player');
    setIsAdding(true);
  };

  const menuPerson = menuPersonId ? squad.find(p => p.id === menuPersonId) : undefined;
  const runFromMenu = (fn: (p: SquadPlayer) => void) => {
    const p = menuPerson;
    setMenuPersonId(null);
    if (p) fn(p);
  };

  const fieldLabel = 'block text-sm font-semibold text-zinc-600 dark:text-zinc-300 mb-1.5';
  const fieldInput = 'w-full h-12 px-4 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-xl text-base text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500';

  // Formuläret används både för "lägg till" och "redigera"
  const renderPersonForm = () => (
    <div className="px-2 pb-2 space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <div className="w-20 h-20 rounded-full overflow-hidden bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400">
            {isUploading ? (
              <Loader2 size={28} className="animate-spin text-indigo-600" />
            ) : newPhotoUrl ? (
              <CachedImage src={newPhotoUrl} alt="Förhandsvisning" className="w-full h-full object-cover" loading="lazy" decoding="async" />
            ) : (
              <Users size={28} />
            )}
          </div>
          <label className="absolute -bottom-1 -right-1 w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-lg cursor-pointer hover:bg-indigo-700 active:scale-95 transition-all ring-2 ring-white dark:ring-zinc-900" title="Välj bild">
            <Camera size={18} />
            <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} />
          </label>
        </div>
        <div className="flex-1 min-w-0">
          <SegmentedTabs<'player' | 'leader'>
            value={newRole}
            onChange={setNewRole}
            tabs={[
              { id: 'player', label: 'Spelare' },
              { id: 'leader', label: 'Ledare' },
            ]}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">Tryck på kameran för att välja en bild.</p>
        </div>
      </div>

      <div>
        <label htmlFor="person-name" className={fieldLabel}>Namn</label>
        <input
          id="person-name"
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="För- och efternamn"
          className={fieldInput}
          required
        />
      </div>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <div>
          <label htmlFor="person-position" className={fieldLabel}>{newRole === 'leader' ? 'Roll' : 'Position'}</label>
          <input
            id="person-position"
            type="text"
            value={newPosition}
            onChange={(e) => setNewPosition(e.target.value)}
            placeholder={newRole === 'leader' ? 'T.ex. huvudtränare' : 'T.ex. mittback'}
            className={fieldInput}
          />
        </div>
        <div>
          <label htmlFor="person-number" className={fieldLabel}>Nummer</label>
          <input
            id="person-number"
            type="text"
            inputMode="numeric"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
            placeholder="#"
            className={fieldInput}
          />
        </div>
      </div>
    </div>
  );

  const renderPersonRow = (person: SquadPlayer) => {
    const att = person.role !== 'leader' ? quickAttendanceMap.get(person.id) : undefined;
    const subtitle = person.role === 'leader' ? (person.position || 'Ledare') : person.position;
    return (
      <div
        key={person.id}
        className="flex items-center gap-3 pl-4 pr-2 py-2.5 min-h-[64px]"
      >
        <span className="relative shrink-0">
          <span className={`w-11 h-11 rounded-full overflow-hidden flex items-center justify-center font-bold text-sm ${
            person.role === 'leader' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300' : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
          }`}>
            {person.photoUrl
              ? <CachedImage src={person.photoUrl} alt={person.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
              : person.name.charAt(0).toUpperCase()}
          </span>
          {person.number && person.role !== 'leader' && (
            <span className="absolute -bottom-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[11px] font-bold leading-[22px] text-center ring-2 ring-white dark:ring-zinc-900">
              {person.number}
            </span>
          )}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-zinc-900 dark:text-white truncate">{person.name}</span>
            {person.isMe && <Badge tone="brand">Du</Badge>}
            {isCoachOrAdmin && person.accountLinked && (
              <span title="Har ett konto i appen" className="text-emerald-600 dark:text-emerald-400 shrink-0">
                <UserCheck size={16} aria-label="Har konto" />
              </span>
            )}
          </div>
          {(subtitle || (att && att.total > 0)) && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 min-w-0">
              {subtitle && <span className="truncate">{subtitle}</span>}
              {att && att.total > 0 && (
                <span className="inline-flex items-center gap-1 shrink-0" title={`Närvaro senaste 30 dagarna: ${att.attended} av ${att.total} pass`}>
                  {subtitle && <span aria-hidden>·</span>}
                  <span className={`w-1.5 h-1.5 rounded-full ${att.pct >= 80 ? 'bg-emerald-500' : att.pct >= 50 ? 'bg-amber-500' : 'bg-zinc-400'}`} />
                  {att.pct}% närvaro
                </span>
              )}
            </div>
          )}
        </div>

        {isCoachOrAdmin && (
          <IconButton label={`Val för ${person.name}`} onClick={() => setMenuPersonId(person.id)}>
            <MoreVertical size={20} />
          </IconButton>
        )}
      </div>
    );
  };

  const renderSection = (title: string, total: number, people: SquadPlayer[], emptyText: string) => (
    <section>
      <SectionHeader title={`${title} (${total})`} />
      {people.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {searchQuery.trim() ? 'Ingen matchar sökningen.' : emptyText}
        </div>
      ) : (
        <Card padded={false} className="divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
          {people.map(renderPersonRow)}
        </Card>
      )}
    </section>
  );

  return (
    <div className="w-full max-w-4xl lg:max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-16 min-w-0 space-y-4">
      {invite && (
        <InviteShareModal
          name={invite.name}
          link={invite.link}
          expiresAt={invite.expiresAt}
          error={invite.error}
          loading={invite.loading}
          onClose={() => setInvite(null)}
        />
      )}

      {fetchStatusMessage && (
        <div className="p-3 pl-4 rounded-2xl border text-sm font-semibold flex items-center gap-3 bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800">
          <Check size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="flex-1">{fetchStatusMessage.text}</span>
          <IconButton label="Stäng" onClick={() => setFetchStatusMessage(null)}>
            <X size={16} />
          </IconButton>
        </div>
      )}

      {/* Flikar och åtgärder (bara tränare) */}
      {isCoachOrAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <SegmentedTabs<'roster' | 'attendance'>
            className="sm:w-auto"
            value={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: 'roster', label: 'Trupplista', icon: <Users size={16} />, count: squad.length },
              { id: 'attendance', label: 'Närvaro', icon: <Activity size={16} /> },
            ]}
          />
          {activeTab === 'roster' && (
            <div className="flex items-center gap-2 sm:ml-auto">
              <Button icon={<UserPlus size={18} />} onClick={openAdd} className="flex-1 sm:flex-none">Lägg till</Button>
              <Button variant="secondary" icon={<Users size={18} />} onClick={handleOpenFetchMembersModal} className="flex-1 sm:flex-none">Hämta från laget</Button>
              <IconButton label="Fler val" onClick={() => setShowSquadMenu(true)} className="border border-zinc-200 dark:border-zinc-700">
                <MoreVertical size={20} />
              </IconButton>
            </div>
          )}
        </div>
      )}

      {activeTab === 'attendance' && isCoachOrAdmin ? (
        <SquadAttendanceOverview squad={squad} sessions={sessions} isCoachOrAdmin={isCoachOrAdmin} />
      ) : squad.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users size={26} />}
            title="Truppen är tom"
            text={isCoachOrAdmin
              ? 'Hämta medlemmarna som finns i laget, lägg till personer en och en eller importera en lista.'
              : 'Inga spelare eller ledare har lagts till i truppen än.'}
            action={isCoachOrAdmin ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <Button icon={<Users size={18} />} onClick={handleOpenFetchMembersModal}>Hämta från laget</Button>
                <Button variant="secondary" icon={<UserPlus size={18} />} onClick={openAdd}>Lägg till</Button>
                <Button variant="secondary" icon={<Upload size={18} />} onClick={() => setIsImporting(true)}>Importera</Button>
              </div>
            ) : undefined}
          />
        </Card>
      ) : (
        <>
          {/* Sök och sortering */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Sök i truppen"
                aria-label="Sök på namn, nummer eller position"
                className="w-full h-11 pl-10 pr-11 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-base sm:text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:border-indigo-500"
              />
              {searchQuery && (
                <IconButton label="Rensa sökningen" onClick={() => setSearchQuery('')} className="absolute right-0.5 top-1/2 -translate-y-1/2">
                  <X size={16} />
                </IconButton>
              )}
            </div>
            <Button variant="secondary" icon={<ArrowUpDown size={18} />} onClick={() => setShowSortSheet(true)} aria-label="Sortera">
              <span className="hidden sm:inline">{sortOptions.find(o => o.value === sortBy)?.label}</span>
            </Button>
          </div>

          <div className="space-y-6">
            {renderSection('Spelare', playerCount, visiblePlayers, 'Inga spelare i truppen än.')}
            {(leaderCount > 0 || isCoachOrAdmin) && renderSection('Ledare', leaderCount, visibleLeaders, 'Inga ledare än. Lägg till en person och välj Ledare.')}
          </div>
        </>
      )}

      {/* Meny: sortering */}
      <Sheet open={showSortSheet} onClose={() => setShowSortSheet(false)} title="Sortera efter">
        <div className="flex flex-col gap-0.5">
          {sortOptions.map(opt => (
            <MenuItem
              key={opt.value}
              label={opt.label}
              active={sortBy === opt.value}
              trailing={sortBy === opt.value ? <Check size={18} className="text-indigo-600" /> : undefined}
              onClick={() => { handleSortChange(opt.value); setShowSortSheet(false); }}
            />
          ))}
        </div>
      </Sheet>

      {/* Meny: hela truppen */}
      <Sheet open={showSquadMenu} onClose={() => setShowSquadMenu(false)} title="Truppen">
        <div className="flex flex-col gap-0.5">
          <MenuItem icon={<UserPlus size={18} />} label="Lägg till person" onClick={() => { setShowSquadMenu(false); openAdd(); }} />
          <MenuItem icon={<Users size={18} />} label="Hämta från laget" description="Personer i föreningens medlemsregister" onClick={() => { setShowSquadMenu(false); handleOpenFetchMembersModal(); }} />
          <MenuItem icon={<Upload size={18} />} label="Importera lista" description="Excel, CSV eller inklistrad text" onClick={() => { setShowSquadMenu(false); setIsImporting(true); }} />
          {squad.length > 0 && (
            <MenuItem icon={<Trash2 size={18} />} label="Rensa truppen" tone="danger" onClick={() => { setShowSquadMenu(false); setShowClearConfirm(true); }} />
          )}
        </div>
      </Sheet>

      {/* Meny: en person */}
      <Sheet open={!!menuPerson} onClose={() => setMenuPersonId(null)} title={menuPerson?.name}>
        {menuPerson && (
          <div className="flex flex-col gap-0.5">
            <MenuItem icon={<Edit2 size={18} />} label="Redigera" description="Namn, nummer, position och bild" onClick={() => runFromMenu(startEdit)} />
            {menuPerson.accountLinked ? (
              <div className="flex items-center gap-3 px-3 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-emerald-50 dark:bg-emerald-950/40">
                  <UserCheck size={18} />
                </span>
                <span className="font-semibold">Har konto i appen</span>
              </div>
            ) : activeClubId ? (
              <MenuItem icon={<Send size={18} />} label="Bjud in till appen" description="Skapa en länk att skicka med sms eller WhatsApp" onClick={() => runFromMenu(handleInvite)} />
            ) : null}
            {menuPerson.role !== 'leader' && (
              <MenuItem icon={<Activity size={18} />} label="Visa närvaro" onClick={() => runFromMenu(() => setActiveTab('attendance'))} />
            )}
            <MenuItem icon={<Trash2 size={18} />} label="Ta bort ur truppen" tone="danger" onClick={() => runFromMenu(handleRemove)} />
          </div>
        )}
      </Sheet>

      {/* Lägg till person */}
      <Sheet
        open={isAdding}
        onClose={() => setIsAdding(false)}
        title={newRole === 'leader' ? 'Ny ledare' : 'Ny spelare'}
        footer={
          <form onSubmit={handleAdd}>
            <Button type="submit" block disabled={isUploading || !newName.trim()}>
              {newRole === 'leader' ? 'Lägg till ledare' : 'Lägg till spelare'}
            </Button>
          </form>
        }
      >
        {renderPersonForm()}
      </Sheet>

      {/* Redigera person */}
      <Sheet
        open={isEditingModalOpen}
        onClose={closeEdit}
        title={newRole === 'leader' ? 'Redigera ledare' : 'Redigera spelare'}
        footer={
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Button variant="secondary" onClick={closeEdit}>Avbryt</Button>
            <Button onClick={handleSaveEdit} disabled={isUploading || !newName.trim()}>Spara ändringar</Button>
          </div>
        }
      >
        {renderPersonForm()}
      </Sheet>

      {/* Ta bort person */}
      <Sheet
        open={!!playerToRemove}
        onClose={() => setPlayerToRemove(null)}
        title={playerToRemove?.role === 'leader' ? 'Ta bort ledare?' : 'Ta bort spelare?'}
        footer={
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Button variant="secondary" onClick={() => setPlayerToRemove(null)}>Avbryt</Button>
            <Button variant="danger" icon={<Trash2 size={18} />} onClick={confirmRemove}>Ja, ta bort</Button>
          </div>
        }
      >
        <p className="px-2 pb-2 text-sm text-zinc-600 dark:text-zinc-300">
          <span className="font-semibold text-zinc-900 dark:text-white">{playerToRemove?.name}</span> tas bort ur truppen.
        </p>
      </Sheet>

      {/* Rensa truppen */}
      <Sheet
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        title="Rensa truppen?"
        footer={
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Button variant="secondary" onClick={() => setShowClearConfirm(false)}>Avbryt</Button>
            <Button variant="danger" icon={<Trash2 size={18} />} onClick={handleClearSquad}>Ja, rensa allt</Button>
          </div>
        }
      >
        <p className="px-2 pb-2 text-sm text-zinc-600 dark:text-zinc-300">Alla spelare och ledare tas bort ur truppen. Det går inte att ångra.</p>
      </Sheet>

      {/* Importera */}
      <Sheet open={isImporting} onClose={() => setIsImporting(false)} title="Importera truppen">
        <div className="px-2 pb-2 space-y-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 transition-all text-left cursor-pointer"
          >
            <span className="w-11 h-11 bg-indigo-100 dark:bg-indigo-900/50 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <FileSpreadsheet size={22} />
            </span>
            <span>
              <span className="block font-semibold">Välj fil</span>
              <span className="block text-sm text-zinc-500 dark:text-zinc-400">Excel (.xlsx) eller CSV</span>
            </span>
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv,.xlsx,.xls" className="hidden" />

          <div>
            <label htmlFor="squad-paste" className={fieldLabel}>Eller klistra in en lista</label>
            <textarea
              id="squad-paste"
              value={pasteData}
              onChange={(e) => setPasteData(e.target.value)}
              placeholder={'En person per rad: namn, position, nummer\nElias Lindgren\tMålvakt\t1\nKalle Karlsson\tMittback\t4'}
              className="w-full h-36 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 text-base sm:text-sm resize-none"
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">Du kan kopiera kolumner direkt från Excel eller Google Kalkylark.</p>
          </div>
          <Button block icon={<ClipboardList size={18} />} onClick={handlePasteImport} disabled={!pasteData.trim()}>
            Importera listan
          </Button>
        </div>
      </Sheet>

      {/* Dubbletter vid import */}
      <Sheet
        open={showImportConflictModal && !!pendingImportPlayers}
        onClose={() => { setShowImportConflictModal(false); setPendingImportPlayers(null); }}
        title="Några finns redan i truppen"
        footer={
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Button variant="secondary" onClick={() => { setShowImportConflictModal(false); setPendingImportPlayers(null); }}>Avbryt</Button>
            <Button icon={<Check size={18} />} onClick={() => pendingImportPlayers && executeImportDirect(pendingImportPlayers, importConflictOption)}>Importera</Button>
          </div>
        }
      >
        <div className="px-2 pb-2 space-y-4">
          <div className="flex items-start gap-3 text-sm text-zinc-600 dark:text-zinc-300">
            <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
            <p>{importConflicts.length} personer i listan har samma namn (och nummer) som någon som redan finns i truppen.</p>
          </div>
          <div className="max-h-40 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
            {importConflicts.map((c, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-semibold truncate">{c.imported.name} {c.imported.number ? `#${c.imported.number}` : ''}</span>
                <span className="text-xs text-amber-700 dark:text-amber-400 shrink-0">
                  Finns som {c.existing.role === 'leader' ? 'ledare' : 'spelare'} {c.existing.number ? `#${c.existing.number}` : ''}
                </span>
              </div>
            ))}
          </div>
          <div className="space-y-2" role="radiogroup" aria-label="Hur ska dubbletterna hanteras?">
            {([
              { id: 'merge', title: 'Slå ihop och uppdatera (rekommenderas)', desc: 'Befintliga personer får den nya informationen, nya läggs till.' },
              { id: 'skip', title: 'Hoppa över dubbletter', desc: 'Bara nya personer läggs till.' },
              { id: 'add_all', title: 'Lägg till alla som nya', desc: 'Skapar nya rader för alla, utan att slå ihop.' },
            ] as const).map(opt => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={importConflictOption === opt.id}
                onClick={() => setImportConflictOption(opt.id)}
                className={`w-full text-left p-3 rounded-xl border-2 transition-all cursor-pointer ${
                  importConflictOption === opt.id
                    ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/30'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                <div className="text-sm font-semibold">{opt.title}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </Sheet>

      {/* Hämta medlemmar från laget */}
      <Sheet
        open={showFetchMembersModal}
        onClose={() => setShowFetchMembersModal(false)}
        title="Hämta från laget"
        footer={!isFetchingMembers && fetchedMembers.length > 0 ? (
          <Button block icon={<Check size={18} />} disabled={selectedMemberUserIds.length === 0} onClick={handleExecuteAddFetchedMembers}>
            Hämta {selectedMemberUserIds.length} {selectedMemberUserIds.length === 1 ? 'person' : 'personer'}
          </Button>
        ) : undefined}
      >
        {isFetchingMembers ? (
          <div className="py-12 text-center space-y-3">
            <Loader2 size={32} className="animate-spin text-indigo-600 mx-auto" />
            <p className="text-sm text-zinc-500">Hämtar medlemmar…</p>
          </div>
        ) : fetchedMembers.length === 0 ? (
          <EmptyState
            icon={<Users size={26} />}
            title="Inga medlemmar hittades"
            text={!activeClubId || !activeTeamId
              ? 'Inget lag är valt. Välj förening och lag i kontomenyn först.'
              : 'Laget har inga medlemmar i medlemsregistret än. Lägg till dem under Administration.'}
          />
        ) : (
          <div className="px-2 pb-2 space-y-3">
            {activeTeamName && <p className="text-sm text-zinc-500 dark:text-zinc-400">Medlemmar i {activeTeamName}</p>}
            <div className="relative">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              <input
                type="search"
                placeholder="Sök medlem"
                value={fetchSearchQuery}
                onChange={(e) => setFetchSearchQuery(e.target.value)}
                className="w-full h-11 pl-10 pr-4 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 rounded-xl text-base sm:text-sm outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              {activeTeamId ? (
                <SegmentedTabs<'team' | 'club'>
                  size="sm"
                  value={fetchFilterShowAll ? 'club' : 'team'}
                  onChange={(v) => setFetchFilterShowAll(v === 'club')}
                  tabs={[{ id: 'team', label: 'Laget' }, { id: 'club', label: 'Hela föreningen' }]}
                />
              ) : <span />}
              <Button
                variant="ghost"
                size="sm"
                className="!h-10"
                onClick={() => {
                  const visibleIds = displayMembers.map(m => m.userId || m.fullName);
                  setSelectedMemberUserIds(selectedMemberUserIds.length === visibleIds.length ? [] : visibleIds);
                }}
              >
                {selectedMemberUserIds.length === displayMembers.length ? 'Avmarkera alla' : 'Välj alla'}
              </Button>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
              {displayMembers.length === 0 ? (
                <div className="p-6 text-center text-sm text-zinc-500">Ingen matchar sökningen.</div>
              ) : displayMembers.map((member) => {
                const mId = member.userId || member.fullName;
                const isSelected = selectedMemberUserIds.includes(mId);
                const cleanEmail = (member.email || '').trim().toLowerCase();
                const cleanName = (member.fullName || '').trim().toLowerCase();
                const alreadyInSquad = squad.some(sp =>
                  (member.userId && sp.id === member.userId) ||
                  (cleanEmail && sp.email && sp.email.trim().toLowerCase() === cleanEmail) ||
                  (sp.name.trim().toLowerCase() === cleanName)
                );
                const isCoach = member.roles?.some(r => r === 'coach' || r === 'admin');
                return (
                  <label
                    key={mId}
                    className={`flex items-center gap-3 px-3 py-2.5 min-h-[56px] cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50/60 dark:bg-indigo-950/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => setSelectedMemberUserIds(isSelected
                        ? selectedMemberUserIds.filter(id => id !== mId)
                        : [...selectedMemberUserIds, mId])}
                      className="w-5 h-5 accent-indigo-600 cursor-pointer shrink-0"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{member.fullName}</span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {isCoach ? 'Tränare/ledare' : 'Spelare'}{member.email ? ` · ${member.email}` : ''}
                      </span>
                    </span>
                    {alreadyInSquad ? <Badge>I truppen</Badge> : <Badge tone="success">Ny</Badge>}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </Sheet>

      <AnimatePresence>
        {imageToCrop && (
          <ImageCropper
            image={imageToCrop}
            onCropComplete={onCropComplete}
            onCancel={() => setImageToCrop(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
