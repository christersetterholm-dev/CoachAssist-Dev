import { SquadPlayer } from '../types';

export const POSITION_ORDER = [
  'MV', 'Målvakt',
  'MB', 'Mittback',
  'YB', 'Ytterback', 'VB', 'HB', 'Vänsterback', 'Högerback',
  'VMF', 'HMF', 'YMF', 'Yttermittfältare',
  'CM', 'CDM', 'CAM', 'MF', 'Mittfält', 'Innermittfältare',
  'FW', 'Forwards', 'Forward', 'Anfallare', 'ST', 'RW', 'LW'
];

export function getPositionRank(position?: string): number {
  if (!position) return 999;
  const p = position.toUpperCase();
  
  if (p.includes('MV') || p.includes('MÅLVAKT')) return 0;
  if (p.includes('MB') || p.includes('MITTBACK')) return 1;
  if (p.includes('YB') || p.includes('YTTERBACK') || p.includes('VB') || p.includes('HB') || p.includes('VÄNSTERBACK') || p.includes('HÖGERBACK')) return 2;
  
  // Yttermittfältare
  if (p.includes('VMF') || p.includes('HMF') || p.includes('YMF') || p.includes('YTTERMITTFÄLT')) return 3;
  
  // Innermittfältare
  if (p.includes('CM') || p.includes('CDM') || p.includes('CAM') || p.includes('INNERMITTFÄLT') || p.includes('MF') || p.includes('MITTFÄLT')) return 4;
  
  if (p.includes('FW') || p.includes('FORWARD') || p.includes('ANFALLARE') || p.includes('ST') || p.includes('RW') || p.includes('LW')) return 5;
  
  return 500;
}

export function getLeaderRank(position?: string): number {
  if (!position) return 100;
  const p = position.toLowerCase();

  // 1. Huvudtränare / Tränare
  if (p.includes('huvud') || p.includes('head') || p === 'tränare' || p === 'tranare' || p === 'manager' || p === 'coach') return 0;

  // 2. Assisterande tränare
  if (p.includes('assisterande') || p.includes('assistant') || p.includes('ass.')) return 1;

  // 3. Målvaktstränare / Fystränare
  if (p.includes('målvaktstränare') || p.includes('målvaktstranare') || p.includes('mv-tränare') || p.includes('mv-tranare') || p.includes('goalkeeper')) return 2;
  if (p.includes('fystränare') || p.includes('fys.tränare') || p.includes('fys-tränare') || p.includes('fystranare') || p.includes('fys.tranare') || p.includes('fysiotränare') || p.includes('fysiotranare')) return 3;

  // 4. Lagledare
  if (p.includes('lagledare') || p.includes('team manager')) return 4;

  // 5. Analytiker
  if (p.includes('analytiker') || p.includes('analyst')) return 5;

  // 6. Medicinsk staber/fysio
  if (
    p.includes('fysio') || p.includes('physio') || p.includes('naprapat') || 
    p.includes('kiropraktor') || p.includes('massör') || p.includes('massor') || 
    p.includes('läkare') || p.includes('lakare') || p.includes('sjukgymnast') ||
    p.includes('doctor') || p.includes('medicin')
  ) return 6;

  // 7. Materialförvaltare
  if (p.includes('material') || p.includes('kit')) return 7;

  // 8. Övriga ledarroller
  if (p.includes('ledare') || p.includes('admin') || p.includes('styrelse')) return 8;

  return 50;
}

export function sortLeadersByPosition(leaders: SquadPlayer[]): SquadPlayer[] {
  if (!Array.isArray(leaders)) return [];
  return [...leaders].sort((a, b) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    const rankA = getLeaderRank(a?.position);
    const rankB = getLeaderRank(b?.position);
    
    if (rankA !== rankB) return rankA - rankB;
    
    // alphabetical if same rank
    const nameA = a?.name || '';
    const nameB = b?.name || '';
    return nameA.localeCompare(nameB, 'sv');
  });
}

export function sortPlayersByPosition(playerIds: string[], squad: SquadPlayer[]): string[] {
  if (!Array.isArray(playerIds)) return [];
  const safeSquad = Array.isArray(squad) ? squad : [];
  return [...playerIds].sort((a, b) => {
    const playerA = safeSquad.find(p => p && p.id === a);
    const playerB = safeSquad.find(p => p && p.id === b);
    
    const rankA = getPositionRank(playerA?.position);
    const rankB = getPositionRank(playerB?.position);
    
    if (rankA !== rankB) return rankA - rankB;
    
    // If same rank, sort by name
    return (playerA?.name || '').localeCompare(playerB?.name || '', 'sv');
  });
}

/**
 * Robustly matches an input line or extracted name to a squad player.
 * Prevents false positives like "den", "br", "ink" matching "Dennis Brink".
 */
export function findSquadMatch(rawName: string, squad: SquadPlayer[]): SquadPlayer | undefined {
  if (!rawName || typeof rawName !== 'string') return undefined;
  
  // Clean punctuation, leading list markers like "1. ", "•", dashes, colons
  let cleanInput = rawName
    .replace(/^[\s\d+.:•\-*–—\t]+/, '')
    .replace(/[\s.:•\-*–—\t]+$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  if (cleanInput.length < 2) return undefined;

  // Block generic noise, dates or status terms from ever matching
  const blockedExact = [
    'den', 'det', 'de', 'och', 'av', 'att', 'inbjudna', 'kallade', 'kallad',
    'anmälda', 'anmäld', 'deltagare', 'deltagit', 'deltar', 'deltar ej', 'ej svarat',
    'datum', 'tid', 'plats', 'svar', 'svarat', 'har inte svarat', 'obesvarad',
    'ingen', 'alla', 'samling', 'match', 'träning', 'information', 'spelare', 'ledare'
  ];
  if (blockedExact.includes(cleanInput)) return undefined;

  // 1. Exact full name match (case-insensitive)
  const exact = squad.find(p => p && p.name && p.name.trim().toLowerCase() === cleanInput);
  if (exact) return exact;

  // 2. Reversed name match: "Brink, Dennis" or "Brink Dennis" -> "Dennis Brink"
  const commaParts = cleanInput.split(',').map(s => s.trim());
  if (commaParts.length === 2) {
    const reversed = `${commaParts[1]} ${commaParts[0]}`.trim();
    const revMatch = squad.find(p => p && p.name && p.name.trim().toLowerCase() === reversed);
    if (revMatch) return revMatch;
  }

  // 3. Multi-word match: all words of player name are present in input line
  // e.g. "11 Dennis Brink (Back)" or "Dennis Brink Deltar"
  const inputWords = cleanInput
    .split(/[^a-zåäöéèüíóáñæø0-9]+/i)
    .filter(w => w.length > 1 && !/^\d+$/.test(w));

  if (inputWords.length >= 2) {
    const matchBothWords = squad.find(p => {
      if (!p || !p.name) return false;
      const pWords = p.name.toLowerCase().split(/[^a-zåäöéèüíóáñæø0-9]+/i).filter(w => w.length > 1);
      return pWords.length >= 2 && pWords.every(pw => cleanInput.includes(pw));
    });
    if (matchBothWords) return matchBothWords;
  }

  // 4. Single-word match (e.g. "Haythem"): ONLY if length >= 3 and unique in squad as a first or last name
  if (inputWords.length === 1 && inputWords[0].length >= 3) {
    const word = inputWords[0];
    const matchingSquad = squad.filter(p => {
      if (!p || !p.name) return false;
      const pWords = p.name.toLowerCase().split(/[^a-zåäöéèüíóáñæø0-9]+/i).filter(Boolean);
      return pWords.some(pw => pw === word);
    });
    if (matchingSquad.length === 1) {
      return matchingSquad[0];
    }
  }

  // 5. Line contains the full player name with word boundary (e.g. "Spelare: Dennis Brink är redo")
  const containsFullPlayer = squad.find(p => {
    if (!p || !p.name) return false;
    const pName = p.name.trim().toLowerCase();
    if (pName.length < 4) return false;
    const regex = new RegExp(`(^|[^a-zåäöéèüíóáñæø])${pName}([^a-zåäöéèüíóáñæø]|$)`, 'i');
    return regex.test(cleanInput);
  });
  if (containsFullPlayer) return containsFullPlayer;

  return undefined;
}
