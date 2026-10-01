import { TrainingSession } from '../types';

export type SessionCategory = 'match' | 'training' | 'other';

/**
 * Intelligent helper to detect whether a session is a match or a regular training session.
 * Accurately analyzes calendar titles ("Träning" vs "Match"), session types, and metadata.
 */
export function isMatchSession(session: Partial<TrainingSession> | null | undefined): boolean {
  if (!session) return false;

  // 1. A linked lineup is definitive proof that this session has or needs a match lineup
  if (session.lineupId) return true;

  const type = (session.type || '').trim().toLowerCase();
  const category = (session.category || '').trim().toLowerCase();
  const title = (session.title || '').trim().toLowerCase();

  // 2. Explicit type or category set by user or system
  if (type === 'match' || type === 'cup' || category === 'match' || category === 'cup') {
    return true;
  }

  // 3. Special case: Pre-match training sessions like "Träning inför match" or "Matchförberedande träning"
  const isPreMatchTraining = 
    title.includes('inför match') || 
    title.includes('inför cup') || 
    title.includes('matchförberedande') ||
    (title.includes('träning') && title.includes('inför'));

  if (isPreMatchTraining && type !== 'match' && category !== 'match') {
    return false;
  }

  // 4. If title explicitly indicates a match or tournament
  // Note: "träningsmatch" is a friendly match, which requires a match lineup
  const hasMatchKeywords = 
    title.includes('match') ||
    title.includes('cup') ||
    title.includes('seriematch') ||
    title.includes('träningsmatch') ||
    title.includes('kval') ||
    title.includes('turnering') ||
    title.includes('sammandrag') ||
    title.includes('derby') ||
    title.includes('slutspel') ||
    title.includes('gruppspel') ||
    title.includes(' vs ') ||
    title.includes(' vs. ') ||
    title.includes(' v. ') ||
    title.includes(' mot ');

  if (hasMatchKeywords) {
    return true;
  }

  // 5. If title indicates regular training
  const hasTrainingKeywords = 
    title.includes('träning') ||
    title.includes('träningspass') ||
    title.includes('fys') ||
    title.includes('istid') ||
    title.includes('pass') ||
    title.includes('teknik') ||
    title.includes('uppstart') ||
    title.includes('fotboll');

  if (hasTrainingKeywords) {
    return false;
  }

  // 6. Explicit training type
  if (type === 'training' || category === 'training') {
    return false;
  }

  // 7. Default fallback is training
  return false;
}

/**
 * Categorize a session into 'match' | 'training' | 'other'
 */
export function categorizeSession(session: Partial<TrainingSession> | null | undefined): SessionCategory {
  if (!session) return 'training';
  if (isMatchSession(session)) return 'match';

  const type = (session.type || '').trim().toLowerCase();
  const category = (session.category || '').trim().toLowerCase();

  if (type === 'other' || category === 'other') {
    return 'other';
  }

  return 'training';
}
