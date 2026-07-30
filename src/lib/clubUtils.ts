import { SquadPlayer, ClubMember } from '../types';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

/**
 * Deduplicates an array of SquadPlayer objects by ID, personnummer, email, or (fullName + number/role).
 */
export function deduplicateSquad(squad: SquadPlayer[]): SquadPlayer[] {
  if (!squad || squad.length === 0) return [];

  const result: SquadPlayer[] = [];

  for (const player of squad) {
    if (!player.name || !player.name.trim()) continue;

    const cleanName = player.name.trim();
    const cleanEmail = (player.email || '').trim().toLowerCase();
    const cleanPnr = (player.personnummer || '').replace(/\D/g, '');
    const cleanNum = (player.number || '').trim();

    const idx = result.findIndex(existing => {
      const exName = existing.name.trim().toLowerCase();
      const exEmail = (existing.email || '').trim().toLowerCase();
      const exPnr = (existing.personnummer || '').replace(/\D/g, '');
      const exNum = (existing.number || '').trim();

      if (player.id && existing.id && player.id === existing.id) return true;
      if (cleanPnr && exPnr && cleanPnr === exPnr) return true;
      if (cleanEmail && exEmail && cleanEmail === exEmail) return true;

      if (exName === cleanName.toLowerCase()) {
        if (cleanNum && exNum) {
          return cleanNum === exNum;
        }
        return true;
      }
      return false;
    });

    if (idx !== -1) {
      const existing = result[idx];
      const targetRole: 'leader' | 'player' =
        (existing.role === 'leader' || player.role === 'leader') ? 'leader' : 'player';

      result[idx] = {
        ...existing,
        name: existing.name || cleanName,
        email: existing.email || player.email || undefined,
        phone: existing.phone || player.phone || undefined,
        personnummer: existing.personnummer || player.personnummer || undefined,
        position: existing.position || player.position || undefined,
        number: existing.number || player.number || undefined,
        photoUrl: existing.photoUrl || player.photoUrl || undefined,
        role: targetRole
      };
    } else {
      result.push({
        ...player,
        name: cleanName,
        email: player.email ? player.email.trim() : undefined,
        phone: player.phone ? player.phone.trim() : undefined,
        personnummer: player.personnummer ? player.personnummer.trim() : undefined,
        position: player.position ? player.position.trim() : undefined,
        number: player.number ? player.number.trim() : undefined,
        photoUrl: player.photoUrl ? player.photoUrl.trim() : undefined,
        role: player.role === 'leader' ? 'leader' : 'player'
      });
    }
  }

  return result;
}

/**
 * Deduplicates an array of ClubMember objects by userId, personnummer, email, or (fullName + number).
 */
export function deduplicateClubMembers(members: ClubMember[]): ClubMember[] {
  if (!members || members.length === 0) return [];

  const result: ClubMember[] = [];

  for (const member of members) {
    if (!member.fullName || !member.fullName.trim()) continue;

    const cleanName = member.fullName.trim();
    const cleanEmail = (member.email || '').trim().toLowerCase();
    const cleanPnr = (member.personnummer || '').replace(/\D/g, '');
    const cleanNum = (member.number || '').trim();

    const idx = result.findIndex(existing => {
      const exName = existing.fullName.trim().toLowerCase();
      const exEmail = (existing.email || '').trim().toLowerCase();
      const exPnr = (existing.personnummer || '').replace(/\D/g, '');
      const exNum = (existing.number || '').trim();

      if (member.userId && existing.userId && member.userId === existing.userId) return true;
      if (cleanPnr && exPnr && cleanPnr === exPnr) return true;
      if (cleanEmail && exEmail && cleanEmail === exEmail) return true;

      if (exName === cleanName.toLowerCase()) {
        if (cleanNum && exNum) {
          return cleanNum === exNum;
        }
        return true;
      }
      return false;
    });

    if (idx !== -1) {
      const existing = result[idx];
      const mergedRoles = Array.from(new Set([...(existing.roles || []), ...(member.roles || [])]));
      const mergedTeams = Array.from(new Set([...(existing.teams || []), ...(member.teams || [])]));

      result[idx] = {
        ...existing,
        fullName: existing.fullName || cleanName,
        email: existing.email || member.email || '',
        phone: existing.phone || member.phone,
        personnummer: existing.personnummer || member.personnummer,
        position: existing.position || member.position,
        number: existing.number || member.number,
        photoUrl: existing.photoUrl || member.photoUrl,
        roles: mergedRoles,
        teams: mergedTeams
      };
    } else {
      result.push({
        ...member,
        fullName: cleanName,
        email: member.email ? member.email.trim() : '',
        phone: member.phone ? member.phone.trim() : undefined,
        personnummer: member.personnummer ? member.personnummer.trim() : undefined,
        position: member.position ? member.position.trim() : undefined,
        number: member.number ? member.number.trim() : undefined,
        photoUrl: member.photoUrl ? member.photoUrl.trim() : undefined,
        roles: member.roles || ['player'],
        teams: member.teams || []
      });
    }
  }

  return result;
}

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
  if (!clubId || !teamId || !squad || squad.length === 0) return;

  try {
    const cleanSquad = deduplicateSquad(squad);
    const membersRef = doc(db, 'clubs', clubId, 'teams', 'club_global', 'data', 'members');
    const membersSnap = await getDoc(membersRef);
    let members: ClubMember[] = membersSnap.exists() ? (membersSnap.data().members || []) : [];
    members = deduplicateClubMembers(members);

    let isModified = false;

    for (const player of cleanSquad) {
      if (!player.name || !player.name.trim()) continue;
      const cleanName = player.name.trim();
      const cleanEmail = (player.email || '').trim().toLowerCase();
      const cleanPnr = (player.personnummer || '').replace(/\D/g, '');
      const cleanNum = (player.number || '').trim();
      const targetRole: 'coach' | 'player' = player.role === 'leader' ? 'coach' : 'player';

      const idx = members.findIndex(m => {
        const mEmail = (m.email || '').trim().toLowerCase();
        const mName = (m.fullName || '').trim().toLowerCase();
        const mPnr = (m.personnummer || '').replace(/\D/g, '');
        const mNum = (m.number || '').trim();

        if (player.id && m.userId === player.id) return true;
        if (cleanPnr && mPnr && cleanPnr === mPnr) return true;
        if (cleanEmail && mEmail === cleanEmail) return true;

        if (mName === cleanName.toLowerCase()) {
          if (cleanNum && mNum) {
            return cleanNum === mNum;
          }
          return true;
        }

        return false;
      });

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
          (player.personnummer && existing.personnummer !== player.personnummer) ||
          (player.position && existing.position !== player.position) ||
          (player.number && existing.number !== player.number) ||
          (player.photoUrl && existing.photoUrl !== player.photoUrl) ||
          (cleanEmail && (existing.email || '').trim().toLowerCase() !== cleanEmail);

        if (hasChanged) {
          members[idx] = {
            ...existing,
            fullName: cleanName,
            email: player.email || existing.email || '',
            phone: player.phone || existing.phone,
            personnummer: player.personnummer || existing.personnummer,
            position: player.position || existing.position,
            number: player.number || existing.number,
            photoUrl: player.photoUrl || existing.photoUrl,
            roles: updatedRoles,
            teams: updatedTeams
          };
          isModified = true;
        }
      } else {
        const newMember: ClubMember = {
          userId: player.id || 'player_' + Math.random().toString(36).substring(2, 10),
          email: player.email || '',
          fullName: cleanName,
          phone: player.phone || undefined,
          personnummer: player.personnummer || undefined,
          position: player.position || undefined,
          number: player.number || undefined,
          photoUrl: player.photoUrl || undefined,
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
 * into the team's squad list if they aren't in squad yet. Also pushes any missing
 * squad players into the club members list.
 */
export async function getMergedSquadAndClubMembers(
  squad: SquadPlayer[],
  clubId: string,
  teamId: string
): Promise<{ mergedSquad: SquadPlayer[]; hasChanges: boolean }> {
  const cleanInputSquad = deduplicateSquad(squad);
  if (!clubId || !teamId) return { mergedSquad: cleanInputSquad, hasChanges: cleanInputSquad.length !== squad.length };

  try {
    const membersRef = doc(db, 'clubs', clubId, 'teams', 'club_global', 'data', 'members');
    const membersSnap = await getDoc(membersRef);
    if (!membersSnap.exists()) {
      if (cleanInputSquad && cleanInputSquad.length > 0) {
        await syncSquadToClubMembers(cleanInputSquad, clubId, teamId);
      }
      return { mergedSquad: cleanInputSquad, hasChanges: cleanInputSquad.length !== squad.length };
    }

    let members: ClubMember[] = membersSnap.data().members || [];
    members = deduplicateClubMembers(members);
    const teamMembers = members.filter(m => m.teams && m.teams.includes(teamId));

    let updatedSquad = [...cleanInputSquad];

    for (const member of teamMembers) {
      if (!member.fullName) continue;
      const cleanName = member.fullName.trim();
      const cleanEmail = (member.email || '').trim().toLowerCase();
      const cleanPnr = (member.personnummer || '').replace(/\D/g, '');
      const cleanNum = (member.number || '').trim();

      const squadIdx = updatedSquad.findIndex(sp => {
        const spEmail = (sp.email || '').trim().toLowerCase();
        const spName = (sp.name || '').trim().toLowerCase();
        const spPnr = (sp.personnummer || '').replace(/\D/g, '');
        const spNum = (sp.number || '').trim();

        if (member.userId && sp.id === member.userId) return true;
        if (cleanPnr && spPnr && cleanPnr === spPnr) return true;
        if (cleanEmail && spEmail === cleanEmail) return true;

        if (spName === cleanName.toLowerCase()) {
          if (cleanNum && spNum) {
            return cleanNum === spNum;
          }
          return true;
        }
        return false;
      });

      if (squadIdx === -1) {
        const isLeader = member.roles?.some(r => r === 'coach' || r === 'admin');
        const newSquadPlayer: SquadPlayer = {
          id: member.userId || crypto.randomUUID(),
          name: cleanName,
          email: member.email || undefined,
          phone: member.phone || undefined,
          personnummer: member.personnummer || undefined,
          position: member.position || undefined,
          number: member.number || undefined,
          photoUrl: member.photoUrl || undefined,
          role: isLeader ? 'leader' : 'player',
        };
        updatedSquad.push(newSquadPlayer);
      } else {
        const existingSp = updatedSquad[squadIdx];
        const newEmail = member.email || existingSp.email;
        const newPhone = member.phone || existingSp.phone;
        const newPnr = member.personnummer || existingSp.personnummer;
        const newPos = member.position || existingSp.position;
        const newNum = member.number || existingSp.number;
        const newPhoto = member.photoUrl || existingSp.photoUrl;

        updatedSquad[squadIdx] = {
          ...existingSp,
          email: newEmail,
          phone: newPhone,
          personnummer: newPnr,
          position: newPos,
          number: newNum,
          photoUrl: newPhoto
        };
      }
    }

    const finalMergedSquad = deduplicateSquad(updatedSquad);
    const hasChanges = JSON.stringify(finalMergedSquad) !== JSON.stringify(squad);

    const missingInMembers = finalMergedSquad.some(sp => {
      const spEmail = (sp.email || '').trim().toLowerCase();
      const spName = (sp.name || '').trim().toLowerCase();
      const spPnr = (sp.personnummer || '').replace(/\D/g, '');
      const spNum = (sp.number || '').trim();

      return !members.some(m => {
        const mEmail = (m.email || '').trim().toLowerCase();
        const mName = (m.fullName || '').trim().toLowerCase();
        const mPnr = (m.personnummer || '').replace(/\D/g, '');
        const mNum = (m.number || '').trim();

        if (sp.id && m.userId === sp.id) return true;
        if (spPnr && mPnr && spPnr === mPnr) return true;
        if (spEmail && mEmail === spEmail) return true;

        if (spName === mName.toLowerCase()) {
          if (spNum && mNum) {
            return spNum === mNum;
          }
          return true;
        }
        return false;
      });
    });

    if (missingInMembers) {
      await syncSquadToClubMembers(finalMergedSquad, clubId, teamId);
    }

    return { mergedSquad: finalMergedSquad, hasChanges };
  } catch (err) {
    console.error('Failed to merge squad with club members:', err);
    return { mergedSquad: deduplicateSquad(squad), hasChanges: false };
  }
}


