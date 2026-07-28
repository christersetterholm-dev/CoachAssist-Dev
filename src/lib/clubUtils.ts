import { SquadPlayer, ClubMember } from '../types';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

/**
 * Synchronizes squad players & leaders to the club's global members list,
 * ensuring that every person in `squad` exists as a `ClubMember`
 * assigned to `teamId` with roles `['player']` or `['coach']`.
 */
export async function syncSquadToClubMembers(
  squad: SquadPlayer[],
  clubId: string,
  teamId: string
): Promise<void> {
  if (!clubId || !teamId || !squad) return;

  try {
    const membersRef = doc(db, 'clubs', clubId, 'teams', 'club_global', 'data', 'members');
    const membersSnap = await getDoc(membersRef);
    let members: ClubMember[] = membersSnap.exists() ? (membersSnap.data().members || []) : [];

    let isModified = false;

    for (const player of squad) {
      if (!player.name || !player.name.trim()) continue;
      const cleanName = player.name.trim();
      const cleanEmail = (player.email || '').trim().toLowerCase();
      const targetRole: 'coach' | 'player' = player.role === 'leader' ? 'coach' : 'player';

      // Find existing member by id, email, or name
      const idx = members.findIndex(m => 
        (player.id && m.userId === player.id) ||
        (cleanEmail && m.email.trim().toLowerCase() === cleanEmail) ||
        (m.fullName.trim().toLowerCase() === cleanName.toLowerCase())
      );

      if (idx !== -1) {
        const existing = members[idx];
        const existingRoles = existing.roles || [];
        const existingTeams = existing.teams || [];

        const updatedRoles = Array.from(new Set([...existingRoles, targetRole]));
        const updatedTeams = Array.from(new Set([...existingTeams, teamId]));

        const hasChanged = 
          updatedRoles.length !== existingRoles.length ||
          updatedTeams.length !== existingTeams.length ||
          existing.fullName !== cleanName ||
          (player.phone && existing.phone !== player.phone) ||
          (player.personnummer && existing.personnummer !== player.personnummer);

        if (hasChanged) {
          members[idx] = {
            ...existing,
            fullName: cleanName,
            phone: player.phone || existing.phone,
            personnummer: player.personnummer || existing.personnummer,
            roles: updatedRoles,
            teams: updatedTeams
          };
          isModified = true;
        }
      } else {
        // Create new member
        const newMember: ClubMember = {
          userId: player.id || 'player_' + Math.random().toString(36).substring(2, 10),
          email: player.email || '',
          fullName: cleanName,
          phone: player.phone || undefined,
          personnummer: player.personnummer || undefined,
          roles: [targetRole],
          teams: [teamId]
        };
        members.push(newMember);
        isModified = true;
      }
    }

    if (isModified) {
      await setDoc(membersRef, { members, updatedAt: Date.now() });
    }
  } catch (err) {
    console.error('Failed to sync squad to club members:', err);
  }
}

/**
 * Fetches club members for a team and merges any members with role player/coach/admin
 * into the team's squad list if they aren't in squad yet.
 */
export async function getMergedSquadAndClubMembers(
  squad: SquadPlayer[],
  clubId: string,
  teamId: string
): Promise<{ mergedSquad: SquadPlayer[]; hasChanges: boolean }> {
  if (!clubId || !teamId) return { mergedSquad: squad, hasChanges: false };

  try {
    const membersRef = doc(db, 'clubs', clubId, 'teams', 'club_global', 'data', 'members');
    const membersSnap = await getDoc(membersRef);
    if (!membersSnap.exists()) return { mergedSquad: squad, hasChanges: false };

    const members: ClubMember[] = membersSnap.data().members || [];
    const teamMembers = members.filter(m => m.teams && m.teams.includes(teamId));

    let updatedSquad = [...squad];
    let hasChanges = false;

    for (const member of teamMembers) {
      if (!member.fullName) continue;
      const cleanName = member.fullName.trim();
      const cleanEmail = (member.email || '').trim().toLowerCase();

      const existsInSquad = updatedSquad.some(sp => 
        (member.userId && sp.id === member.userId) ||
        (cleanEmail && sp.email && sp.email.trim().toLowerCase() === cleanEmail) ||
        (sp.name.trim().toLowerCase() === cleanName.toLowerCase())
      );

      if (!existsInSquad) {
        const isLeader = member.roles?.some(r => r === 'coach' || r === 'admin');
        const newSquadPlayer: SquadPlayer = {
          id: member.userId || crypto.randomUUID(),
          name: cleanName,
          email: member.email || undefined,
          phone: member.phone || undefined,
          personnummer: member.personnummer || undefined,
          role: isLeader ? 'leader' : 'player',
        };
        updatedSquad.push(newSquadPlayer);
        hasChanges = true;
      }
    }

    return { mergedSquad: updatedSquad, hasChanges };
  } catch (err) {
    console.error('Failed to merge squad with club members:', err);
    return { mergedSquad: squad, hasChanges: false };
  }
}
