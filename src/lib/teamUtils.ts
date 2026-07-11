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
  return [...leaders].sort((a, b) => {
    const rankA = getLeaderRank(a.position);
    const rankB = getLeaderRank(b.position);
    
    if (rankA !== rankB) return rankA - rankB;
    
    // alphabetical if same rank
    return a.name.localeCompare(b.name, 'sv');
  });
}

export function sortPlayersByPosition(playerIds: string[], squad: SquadPlayer[]): string[] {
  return [...playerIds].sort((a, b) => {
    const playerA = squad.find(p => p.id === a);
    const playerB = squad.find(p => p.id === b);
    
    const rankA = getPositionRank(playerA?.position);
    const rankB = getPositionRank(playerB?.position);
    
    if (rankA !== rankB) return rankA - rankB;
    
    // If same rank, sort by name
    return (playerA?.name || '').localeCompare(playerB?.name || '');
  });
}
