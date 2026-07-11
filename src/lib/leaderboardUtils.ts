import { SquadPlayer, Exercise, Period } from '../types';

export interface PlayerStats extends SquadPlayer {
  totalPoints: number;
  history: {
    date: number;
    exerciseName: string;
    points: number;
    isBonus?: boolean;
  }[];
}

export function calculateLeaderboard(
  squad: SquadPlayer[],
  exercises: Exercise[],
  periodId: string | 'current',
  periods: Period[] = []
): PlayerStats[] {
  // Find the relevant period for bonus points
  const currentPeriod = periods.find(p => p.id === periodId);
  const bonusPoints = currentPeriod?.bonusPoints || [];

  // Get the relevant exercises for the selected view
  const relevantExercises = exercises.filter(e => {
    if (!e.isFinished) return false;
    
    // If viewing a specific period, match against its ID
    return e.periodId === periodId;
  });

  // Calculate total points for each player based on relevant exercises
  const uniqueSquad = Array.from(new Map(squad.map(p => [p.id, p])).values());
  return uniqueSquad.filter(p => !p.id.startsWith('guest_') && p.role !== 'leader').map(player => {
    const history: { date: number; exerciseName: string; points: number; isBonus?: boolean }[] = [];
    let totalPoints = 0;

    // Add points from exercises
    relevantExercises.forEach(exercise => {
      const uniqueScores = Array.from(new Set(exercise.teams.map(t => t.score))).sort((a, b) => b - a);
      const config = exercise.pointsConfig || { first: 1, second: 0, third: 0 };
      
      const playerTeams = exercise.teams.filter(t => t.playerIds.includes(player.id));
      const isJoker = exercise.jokerPlayerIds?.includes(player.id);
      
      let pointsAwarded = 0;
      
      if (isJoker) {
        if (uniqueScores.length > 0) pointsAwarded = config.first;
      } else if (playerTeams.length > 0) {
        playerTeams.forEach(team => {
          const rankIndex = uniqueScores.indexOf(team.score);
          if (rankIndex === 0) pointsAwarded = Math.max(pointsAwarded, config.first);
          else if (rankIndex === 1) pointsAwarded = Math.max(pointsAwarded, config.second);
          else if (rankIndex === 2) pointsAwarded = Math.max(pointsAwarded, config.third);
        });
      }

      if (pointsAwarded > 0) {
        totalPoints += pointsAwarded;
        history.push({
          date: exercise.finishedAt || exercise.date,
          exerciseName: exercise.name,
          points: pointsAwarded
        });
      }
    });

    // Add bonus points
    bonusPoints.filter(bp => bp.playerId === player.id).forEach(bp => {
      totalPoints += bp.points;
      history.push({
        date: bp.date,
        exerciseName: `Bonus: ${bp.reason}`,
        points: bp.points,
        isBonus: true
      });
    });

    return {
      ...player,
      totalPoints,
      history: history.sort((a, b) => b.date - a.date)
    };
  }).sort((a, b) => b.totalPoints - a.totalPoints);
}
