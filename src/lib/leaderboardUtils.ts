import { SquadPlayer, Exercise, Period, TrainingSession, PeriodStandingHistoryItem } from '../types';

export interface PlayerStats extends SquadPlayer {
  totalPoints: number;
  history: PeriodStandingHistoryItem[];
}

export function calculateLeaderboard(
  squad: SquadPlayer[],
  exercises: Exercise[],
  periodId: string | 'current',
  periods: Period[] = [],
  sessions: TrainingSession[] = []
): PlayerStats[] {
  // Resolve effective period ID
  const effectivePeriodId = periodId === 'current'
    ? (periods.find(p => p.isActive)?.id || periods[0]?.id || 'current')
    : periodId;

  // Find the relevant period for bonus points
  const currentPeriod = periods.find(p => p.id === effectivePeriodId || p.id === periodId);
  const bonusPoints = currentPeriod?.bonusPoints || [];

  // Get the relevant exercises for the selected view
  const relevantExercises = exercises.filter(e => {
    if (!e.isFinished) return false;
    
    // If viewing a specific period, match against its ID
    if (e.periodId) {
      return e.periodId === effectivePeriodId || e.periodId === periodId;
    }

    // Legacy exercises without periodId match if this is current or only period
    return periodId === 'current' || (periods.length === 1 && periods[0].id === effectivePeriodId);
  });

  // Calculate total points for each player based on relevant exercises
  const uniqueSquad = Array.from(new Map(squad.map(p => [p.id, p])).values());
  return uniqueSquad
    .filter(p => !p.id.startsWith('guest_'))
    .filter(player => {
      // Regular players are always shown in the leaderboard
      if (player.role !== 'leader') return true;

      // Leaders are only shown if they participated in at least one exercise or received bonus points in this period
      const inExercise = relevantExercises.some(e =>
        e.teams?.some(t => t.playerIds?.includes(player.id)) ||
        e.jokerPlayerIds?.includes(player.id)
      );
      const hasBonus = bonusPoints.some(bp => bp.playerId === player.id);

      return inExercise || hasBonus;
    })
    .map(player => {
    const history: PeriodStandingHistoryItem[] = [];
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

        // Resolve session / activity title if exercise is linked
        let sessionTitle: string | undefined;
        if (exercise.sessionId) {
          const sess = sessions.find(s => s.id === exercise.sessionId);
          if (sess) {
            sessionTitle = sess.title || (sess.type === 'match' ? 'Match' : 'Träningspass');
          }
        } else {
          const sess = sessions.find(s => s.moments?.some(m => m.exerciseId === exercise.id));
          if (sess) {
            sessionTitle = sess.title || (sess.type === 'match' ? 'Match' : 'Träningspass');
          }
        }

        history.push({
          date: exercise.finishedAt || exercise.date,
          exerciseName: exercise.name,
          points: pointsAwarded,
          sessionTitle
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
