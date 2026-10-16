import { SquadPlayer, ClubMember } from '../types';

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
    const playerRole: 'leader' | 'player' = player.role === 'leader' ? 'leader' : 'player';
    const basePlayerId = (player.id || '').replace('_leader', '');

    const idx = result.findIndex(existing => {
      const exRole: 'leader' | 'player' = existing.role === 'leader' ? 'leader' : 'player';
      // Only treat as duplicate if they have the exact same squad role ('player' vs 'player' or 'leader' vs 'leader')
      if (exRole !== playerRole) return false;

      const baseExId = (existing.id || '').replace('_leader', '');
      const exName = existing.name.trim().toLowerCase();
      const exEmail = (existing.email || '').trim().toLowerCase();
      const exPnr = (existing.personnummer || '').replace(/\D/g, '');
      const exNum = (existing.number || '').trim();

      if (basePlayerId && baseExId && basePlayerId === baseExId) return true;
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

      const pickVal = (newVal?: string, oldVal?: string) => {
        if (newVal !== undefined && newVal !== null && newVal.trim() !== '') return newVal.trim();
        if (oldVal !== undefined && oldVal !== null && oldVal.trim() !== '') return oldVal.trim();
        return undefined;
      };

      const mergedRoles = Array.from(new Set([...(existing.roles || []), ...(player.roles || [])]));

      result[idx] = {
        id: existing.id || player.id,
        name: player.name?.trim() || existing.name?.trim() || cleanName,
        email: pickVal(player.email, existing.email),
        phone: pickVal(player.phone, existing.phone),
        personnummer: pickVal(player.personnummer, existing.personnummer),
        position: pickVal(player.position, existing.position),
        number: pickVal(player.number, existing.number),
        photoUrl: pickVal(player.photoUrl, existing.photoUrl),
        role: playerRole,
        roles: mergedRoles.length > 0 ? mergedRoles : undefined
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
        role: playerRole
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

      const pickEmail = () => {
        const memEmail = (member.email || '').trim();
        const exEmail = (existing.email || '').trim();
        if (memEmail && !memEmail.includes('@noemail.local')) return memEmail;
        if (exEmail && !exEmail.includes('@noemail.local')) return exEmail;
        return memEmail || exEmail || '';
      };

      const pickVal = (newVal?: string, oldVal?: string) => {
        if (newVal !== undefined && newVal !== null && newVal.trim() !== '') return newVal.trim();
        if (oldVal !== undefined && oldVal !== null && oldVal.trim() !== '') return oldVal.trim();
        return undefined;
      };

      let bestUserId = member.userId || existing.userId;
      if (existing.userId && !existing.userId.startsWith('player_') && member.userId && member.userId.startsWith('player_')) {
        bestUserId = existing.userId;
      }

      const mergedRoles = Array.from(new Set([...(existing.roles || []), ...(member.roles || [])]));
      const mergedTeams = Array.from(new Set([...(existing.teams || []), ...(member.teams || [])]));

      result[idx] = {
        userId: bestUserId,
        fullName: member.fullName?.trim() || existing.fullName?.trim() || cleanName,
        email: pickEmail(),
        phone: pickVal(member.phone, existing.phone),
        personnummer: pickVal(member.personnummer, existing.personnummer),
        position: pickVal(member.position, existing.position),
        number: pickVal(member.number, existing.number),
        photoUrl: pickVal(member.photoUrl, existing.photoUrl),
        roles: mergedRoles.length > 0 ? mergedRoles : ['player'],
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
