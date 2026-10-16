import { TrainingSession } from '../types';
import { getApiUrl } from '../lib/firebase';
import { parseIcsCalendar } from './icsParser';

export interface SyncResult {
  success: boolean;
  message: string;
  updatedSessions: TrainingSession[];
  addedCount: number;
  updatedCount: number;
  removedCount: number;
  skippedCount: number;
  lastSyncedAt: number;
}

export function getSessionContentWeight(session: Partial<TrainingSession>): number {
  let score = 0;
  if (session.moments && session.moments.length > 0) score += session.moments.length * 100;
  if (session.attendance && session.attendance.length > 0) score += session.attendance.length * 10;
  if (session.rsvps && Object.keys(session.rsvps).length > 0) score += Object.keys(session.rsvps).length * 10;
  if (session.guestPlayers && session.guestPlayers.length > 0) score += session.guestPlayers.length * 10;
  if (session.notes && session.notes.trim().length > 0) score += 50;
  if (session.isLocallyEdited) score += 30;
  if (session.isCompleted) score += 20;
  if (session.isIgnored) score += 10;
  return score;
}

export function cleanTitleForMatch(title?: string): string {
  if (!title) return '';
  return title
    .replace(/^\[INSTÄLLT\]\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9åäö]/gi, '')
    .trim();
}

export const formatToYYYYMMDD = (timestamp: number) => {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const r = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${r}`;
};

/**
 * Deduplicates and consolidates an array of sessions:
 * Merges any duplicate sessions occurring on the same date/time or with matching externalId,
 * strictly preserving any user-planned content (moments, attendance, notes, guest players)
 * and dropping redundant empty copies.
 */
export function deduplicateSessionsList(sessions: TrainingSession[]): { deduplicated: TrainingSession[]; removedCount: number } {
  if (!sessions || sessions.length <= 1) return { deduplicated: sessions || [], removedCount: 0 };

  const byDate = new Map<string, TrainingSession[]>();
  for (const s of sessions) {
    if (!s || !s.id) continue;
    const dateKey = formatToYYYYMMDD(s.date);
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, []);
    }
    byDate.get(dateKey)!.push({ ...s });
  }

  const result: TrainingSession[] = [];
  let removedCount = 0;

  for (const [_, daySessions] of byDate.entries()) {
    if (daySessions.length === 1) {
      result.push(daySessions[0]);
      continue;
    }

    const mergedDaySessions: TrainingSession[] = [];
    const handledIndices = new Set<number>();

    // Sort by content score descending so planned sessions take priority as primary
    daySessions.sort((a, b) => getSessionContentWeight(b) - getSessionContentWeight(a));

    for (let i = 0; i < daySessions.length; i++) {
      if (handledIndices.has(i)) continue;

      const primary = { ...daySessions[i] };
      handledIndices.add(i);

      for (let j = i + 1; j < daySessions.length; j++) {
        if (handledIndices.has(j)) continue;

        const candidate = daySessions[j];
        
        // Check if candidate is a duplicate of primary:
        const sameExternalId = Boolean(primary.externalId && candidate.externalId && primary.externalId === candidate.externalId);
        
        const sameStartTime = Boolean(primary.startTime && candidate.startTime && primary.startTime.trim() === candidate.startTime.trim());
        const primaryCleanTitle = cleanTitleForMatch(primary.title);
        const candidateCleanTitle = cleanTitleForMatch(candidate.title);
        const sameTitle = Boolean(primaryCleanTitle && candidateCleanTitle && primaryCleanTitle === candidateCleanTitle);
        const titleOverlap = Boolean(
          primaryCleanTitle && candidateCleanTitle &&
          (primaryCleanTitle.includes(candidateCleanTitle) || candidateCleanTitle.includes(primaryCleanTitle))
        );
        const candidateHasNoContent = getSessionContentWeight(candidate) === 0;
        const primaryHasContent = getSessionContentWeight(primary) > 0;

        const [pH, pM] = (primary.startTime || '18:00').split(':').map(Number);
        const [cH, cM] = (candidate.startTime || '18:00').split(':').map(Number);
        const timeDiffMinutes = Math.abs((pH * 60 + (pM || 0)) - (cH * 60 + (cM || 0)));
        const closeTime = timeDiffMinutes <= 60;
        const reasonableTimeWindow = timeDiffMinutes <= 150; // Within 2.5 hours on the same day

        // Check categories:
        const pCat = primary.category || primary.type || 'training';
        const cCat = candidate.category || candidate.type || 'training';
        const sameCategory = pCat === cCat;

        const isDuplicate = 
          sameExternalId || 
          (sameStartTime && (sameTitle || candidateHasNoContent || titleOverlap)) ||
          (closeTime && (sameTitle || titleOverlap)) ||
          // If candidate has no planning content and primary has coach's planning:
          // merge if within reasonable time window (2.5 hours) or same category on same day!
          (candidateHasNoContent && primaryHasContent && (reasonableTimeWindow || sameCategory || titleOverlap)) ||
          // If candidate is empty and within reasonable time window:
          (candidateHasNoContent && (sameStartTime || (closeTime && titleOverlap)));

        if (isDuplicate) {
          // Merge candidate into primary
          handledIndices.add(j);
          removedCount++;

          // Copy missing calendar metadata from candidate if primary was missing it, or adopt calendar details
          if (candidate.externalId) primary.externalId = candidate.externalId;
          if (candidate.location && (!primary.location || primary.location.trim().length === 0)) primary.location = candidate.location;
          if (candidate.description && (!primary.description || primary.description.trim().length === 0)) primary.description = candidate.description;
          if (candidate.category) primary.category = candidate.category;
          if (candidate.type) primary.type = candidate.type;
          if (candidate.endTime && !primary.endTime) primary.endTime = candidate.endTime;
          // If primary has a generic title while candidate has a specific calendar title, use candidate title
          if (candidate.title && (!primary.title || primary.title === 'Träningspass' || primary.title === 'Träning')) {
            primary.title = candidate.title;
          }

          // Merge any moments from candidate if candidate had them
          if (candidate.moments && candidate.moments.length > 0) {
            const existingMomentIds = new Set((primary.moments || []).map(m => m.id));
            const newMoments = (candidate.moments || []).filter(m => m && !existingMomentIds.has(m.id));
            if (newMoments.length > 0) {
              primary.moments = [...(primary.moments || []), ...newMoments];
            }
          }

          // Merge attendance
          if (candidate.attendance && candidate.attendance.length > 0) {
            const existingAtt = new Set(primary.attendance || []);
            const newAtt = candidate.attendance.filter(pId => pId && !existingAtt.has(pId));
            if (newAtt.length > 0) {
              primary.attendance = [...(primary.attendance || []), ...newAtt];
            }
          }

          // Merge RSVPs
          if (candidate.rsvps && Object.keys(candidate.rsvps).length > 0) {
            primary.rsvps = { ...(candidate.rsvps || {}), ...(primary.rsvps || {}) };
          }

          // Merge guest players
          if (candidate.guestPlayers && candidate.guestPlayers.length > 0) {
            const existingG = new Set((primary.guestPlayers || []).map(g => g.id));
            const newG = (candidate.guestPlayers || []).filter(g => g && !existingG.has(g.id));
            if (newG.length > 0) {
              primary.guestPlayers = [...(primary.guestPlayers || []), ...newG];
            }
          }
        }
      }

      mergedDaySessions.push(primary);
    }

    result.push(...mergedDaySessions);
  }

  result.sort((a, b) => {
    if (a.date !== b.date) return a.date - b.date;
    return (a.startTime || '').localeCompare(b.startTime || '');
  });

  return { deduplicated: result, removedCount };
}

export async function syncTeamCalendar(
  icsUrl: string,
  existingSessions: TrainingSession[],
  forceOverwrite: boolean = false
): Promise<SyncResult> {
  let cleanUrl = (icsUrl || '').trim();
  // Strip accidental leading characters like !, #, quotes
  cleanUrl = cleanUrl.replace(/^[!#\s"']+|["'\s]+$/g, '').trim();

  if (!cleanUrl) {
    return {
      success: false,
      message: 'Ingen kalenderlänk (webcal/ics) angiven.',
      updatedSessions: existingSessions,
      addedCount: 0,
      updatedCount: 0,
      removedCount: 0,
      skippedCount: 0,
      lastSyncedAt: Date.now()
    };
  }

  const cleanHttpUrl = cleanUrl.replace(/^webcal:\/\//i, 'https://');

  try {
    const cacheBuster = `&_t=${Date.now()}`;
    let icsData = '';

    // 1. Direct fetch attempt: Services like laget.se (cal.laget.se) support direct browser fetch (Access-Control-Allow-Origin: *)
    try {
      const directController = new AbortController();
      const directTimer = setTimeout(() => directController.abort(), 6000);
      const directRes = await fetch(cleanHttpUrl, {
        signal: directController.signal,
        headers: {
          'Accept': 'text/calendar, text/plain, */*'
        }
      });
      clearTimeout(directTimer);
      if (directRes.ok) {
        const text = await directRes.text();
        if (text && text.includes('BEGIN:VCALENDAR')) {
          icsData = text;
        }
      }
    } catch (_) {
      // Direct CORS fetch failed or not supported by remote host, proceed to backend proxy
    }

    // 2. First-party Backend Proxy (/api/fetch-calendar)
    if (!icsData) {
      try {
        const proxyUrl = getApiUrl(`/api/fetch-calendar?url=${encodeURIComponent(cleanHttpUrl)}${cacheBuster}`);
        const response = await fetch(proxyUrl, {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        });
        if (response.ok) {
          const text = await response.text();
          if (text && text.includes('BEGIN:VCALENDAR')) {
            icsData = text;
          }
        }
      } catch (_) {}

      // Fallback: Try direct relative /api/fetch-calendar if getApiUrl had path prefix differences
      if (!icsData && typeof window !== 'undefined' && window.location?.origin) {
        try {
          const directProxyUrl = `/api/fetch-calendar?url=${encodeURIComponent(cleanHttpUrl)}${cacheBuster}`;
          const response = await fetch(directProxyUrl, {
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache'
            }
          });
          if (response.ok) {
            const text = await response.text();
            if (text && text.includes('BEGIN:VCALENDAR')) {
              icsData = text;
            }
          }
        } catch (_) {}
      }
    }

    // 3. Fallback proxies if both direct and backend proxies failed (for static/offline hosting)
    if (!icsData) {
      const fallbackProxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(cleanHttpUrl)}`
      ];
      for (const pUrl of fallbackProxies) {
        try {
          const fbCtrl = new AbortController();
          const fbTimer = setTimeout(() => fbCtrl.abort(), 6000);
          const fbRes = await fetch(pUrl, { signal: fbCtrl.signal });
          clearTimeout(fbTimer);
          if (fbRes.ok) {
            const text = await fbRes.text();
            if (text && text.includes('BEGIN:VCALENDAR')) {
              icsData = text;
              break;
            }
          }
        } catch (_) {}
      }
    }

    if (!icsData) {
      throw new Error('Kunde inte nå kalendern (varken direkt eller via servern). Kontrollera att länken är giltig.');
    }

    const events = parseIcsCalendar(icsData);

    if (events.length === 0) {
      return {
        success: true,
        message: 'Hittade inga händelser i kalendern.',
        updatedSessions: existingSessions,
        addedCount: 0,
        updatedCount: 0,
        removedCount: 0,
        skippedCount: 0,
        lastSyncedAt: Date.now()
      };
    }

    const currentSessionsList = [...existingSessions];
    const newSessionsToAdd: TrainingSession[] = [];
    const matchedExistingIds = new Set<string>();
    const duplicateSessionIdsToRemove = new Set<string>();

    let skippedCount = 0;
    let updatedCount = 0;
    let removedCount = 0;
    let mergedDuplicatesCount = 0;

    // Calculate time horizon of external events
    let minIcsDate = Infinity;
    let maxIcsDate = -Infinity;
    for (const ev of events) {
      if (ev.date < minIcsDate) minIcsDate = ev.date;
      if (ev.date > maxIcsDate) maxIcsDate = ev.date;
    }

    const nowTimestamp = Date.now();
    const horizonStart = Math.min(minIcsDate, nowTimestamp - 24 * 60 * 60 * 1000);
    const horizonEnd = maxIcsDate + 24 * 60 * 60 * 1000;

    for (const ev of events) {
      const evDateYMD = formatToYYYYMMDD(ev.date);
      const evCleanTitle = cleanTitleForMatch(ev.title);
      const [evH, evM] = (ev.startTime || '18:00').split(':').map(Number);
      const evTotalMinutes = evH * 60 + (evM || 0);

      // Find all candidates in currentSessionsList that could represent this event
      const candidates = currentSessionsList.filter(s => {
        if (matchedExistingIds.has(s.id) || duplicateSessionIdsToRemove.has(s.id)) return false;

        // 1. Exact externalId match
        if (ev.externalId && s.externalId && s.externalId === ev.externalId) {
          return true;
        }

        const sDateYMD = formatToYYYYMMDD(s.date);
        if (sDateYMD !== evDateYMD) return false;

        // 2. Same date and exact start time
        if (s.startTime && s.startTime.trim() === ev.startTime.trim()) {
          return true;
        }

        // 3. Same date and matching cleaned title or title overlap
        const sCleanTitle = cleanTitleForMatch(s.title);
        if (sCleanTitle && evCleanTitle && (sCleanTitle === evCleanTitle || sCleanTitle.includes(evCleanTitle) || evCleanTitle.includes(sCleanTitle))) {
          return true;
        }

        // 4. Same date and start time within 120 min (2 hours) and similar title / category
        const [sH, sMin] = (s.startTime || '18:00').split(':').map(Number);
        const sTotalMinutes = sH * 60 + (sMin || 0);
        const diffMinutes = Math.abs(sTotalMinutes - evTotalMinutes);
        if (diffMinutes <= 120) {
          if (
            (sCleanTitle && evCleanTitle && (sCleanTitle.includes(evCleanTitle) || evCleanTitle.includes(sCleanTitle))) ||
            (s.category && ev.category && s.category === ev.category) ||
            (!s.category && ev.category === 'training')
          ) {
            return true;
          }
        }

        // 5. If this session on the same date has coach planning content (moments, exercises, attendance, notes)
        // and is within 150 min (2.5 hours), treat as the planned session to update instead of creating a duplicate!
        if (getSessionContentWeight(s) > 0 && diffMinutes <= 150) {
          return true;
        }

        return false;
      });

      if (candidates.length > 0) {
        // Sort candidates by content weight descending:
        // The one with the coach's plan (moments, exercises, notes) is chosen as primary!
        candidates.sort((a, b) => getSessionContentWeight(b) - getSessionContentWeight(a));
        const primarySession = candidates[0];

        // If there are other candidates, they are duplicate sessions in the database (e.g. empty synced copies)
        for (let i = 1; i < candidates.length; i++) {
          const duplicate = candidates[i];
          duplicateSessionIdsToRemove.add(duplicate.id);
          matchedExistingIds.add(duplicate.id);
          mergedDuplicatesCount++;

          // Merge any moments from duplicate if present
          if (duplicate.moments && duplicate.moments.length > 0) {
            const existingMIds = new Set((primarySession.moments || []).map(m => m.id));
            const newM = (duplicate.moments || []).filter(m => m && !existingMIds.has(m.id));
            if (newM.length > 0) {
              primarySession.moments = [...(primarySession.moments || []), ...newM];
            }
          }
          // Merge attendance
          if (duplicate.attendance && duplicate.attendance.length > 0) {
            const existingAtt = new Set(primarySession.attendance || []);
            const newAtt = duplicate.attendance.filter(pId => pId && !existingAtt.has(pId));
            if (newAtt.length > 0) {
              primarySession.attendance = [...(primarySession.attendance || []), ...newAtt];
            }
          }
          // Merge RSVPs
          if (duplicate.rsvps && Object.keys(duplicate.rsvps).length > 0) {
            primarySession.rsvps = { ...(duplicate.rsvps || {}), ...(primarySession.rsvps || {}) };
          }
        }

        matchedExistingIds.add(primarySession.id);

        if ((primarySession.isCompleted || primarySession.isIgnored) && !forceOverwrite) {
          skippedCount++;
          continue;
        }

        let changed = false;
        const sessionIndex = currentSessionsList.findIndex(s => s.id === primarySession.id);
        if (sessionIndex === -1) continue;

        const updated = { ...currentSessionsList[sessionIndex] };
        
        if (updated.title !== ev.title) {
          updated.title = ev.title;
          changed = true;
        }
        if (formatToYYYYMMDD(updated.date) !== evDateYMD) {
          updated.date = ev.date;
          changed = true;
        }
        if (updated.startTime !== ev.startTime) {
          updated.startTime = ev.startTime;
          changed = true;
        }
        if (ev.endTime && updated.endTime !== ev.endTime) {
          updated.endTime = ev.endTime;
          changed = true;
        }
        if (ev.location && updated.location !== ev.location) {
          updated.location = ev.location;
          changed = true;
        }
        if (ev.description && updated.description !== ev.description) {
          updated.description = ev.description;
          changed = true;
        }
        if (ev.externalId && updated.externalId !== ev.externalId) {
          updated.externalId = ev.externalId;
          changed = true;
        }
        if (ev.category && (!updated.category || updated.category !== ev.category)) {
          updated.category = ev.category;
          updated.type = ev.category;
          changed = true;
        }

        if (changed || candidates.length > 1) {
          updated.updatedAt = Date.now();
          currentSessionsList[sessionIndex] = updated;
          updatedCount++;
        }
      } else {
        const calculateEndTime = (startStr: string, durationMinutes: number) => {
          const [h, m] = startStr.split(':').map(Number);
          const endM = (h * 60 + m + durationMinutes) % (24 * 60);
          const endH = Math.floor(endM / 60);
          const minRem = endM % 60;
          return `${String(endH).padStart(2, '0')}:${String(minRem).padStart(2, '0')}`;
        };

        const now = Date.now();
        const sessionCategory = ev.category || (ev.title.toLowerCase().includes('match') ? 'match' : 'training');
        const newSession: TrainingSession = {
          id: `session_${Math.random().toString(36).substring(2, 9)}_${now}`,
          externalId: ev.externalId,
          title: ev.title,
          date: ev.date,
          startTime: ev.startTime,
          endTime: ev.endTime || calculateEndTime(ev.startTime, 90),
          location: ev.location || '',
          description: ev.description || '',
          category: sessionCategory,
          type: sessionCategory,
          isCompleted: false,
          attendance: [],
          moments: [],
          notes: '',
          createdAt: now,
          updatedAt: now
        };

        newSessionsToAdd.push(newSession);
      }
    }

    // Filter out duplicate sessions and removed auto-synced sessions
    const finalSessionsList: TrainingSession[] = [];
    for (const session of currentSessionsList) {
      if (duplicateSessionIdsToRemove.has(session.id)) {
        // Explicitly removed duplicate session (its content was merged into primary)
        continue;
      }

      if (matchedExistingIds.has(session.id)) {
        finalSessionsList.push(session);
        continue;
      }

      // If it has no externalId, it was created manually in the app -> keep it
      if (!session.externalId) {
        finalSessionsList.push(session);
        continue;
      }

      // If it is outside the horizon range of the ICS feed, keep it
      if (session.date < horizonStart || session.date > horizonEnd) {
        finalSessionsList.push(session);
        continue;
      }

      // Check if session has user edits or planning content
      const hasLocalEdits = 
        session.isLocallyEdited || 
        session.isCompleted || 
        session.isIgnored || 
        (session.moments && session.moments.length > 0) || 
        (session.attendance && session.attendance.length > 0) || 
        (session.rsvps && Object.keys(session.rsvps).length > 0) || 
        (session.guestPlayers && session.guestPlayers.length > 0) || 
        (session.notes && session.notes.trim().length > 0);

      if (hasLocalEdits) {
        // Keep user's planned session even if removed from external feed
        finalSessionsList.push(session);
      } else {
        // Unedited auto-synced session removed from external feed -> remove it
        removedCount++;
      }
    }

    // Final deduplication guarantee pass:
    // Merges any duplicate sessions by date, time, and externalId
    const rawCombined = [...newSessionsToAdd, ...finalSessionsList];
    const { deduplicated: cleanSessions, removedCount: postDedupRemoved } = deduplicateSessionsList(rawCombined);
    const totalRemoved = removedCount + mergedDuplicatesCount + postDedupRemoved;

    const addedCount = newSessionsToAdd.length;
    let message = '';
    if (addedCount === 0 && updatedCount === 0 && totalRemoved === 0) {
      message = `Kalendern är redan helt uppdaterad. Alla ${events.length} händelser från kalendern finns inlagda.`;
    } else {
      const parts: string[] = [];
      if (addedCount > 0) parts.push(`${addedCount} nya pass`);
      if (updatedCount > 0) parts.push(`${updatedCount} uppdaterade pass`);
      if (totalRemoved > 0) parts.push(`${totalRemoved} borttagna/rensade dubblettpass`);
      message = `Synkning klar! ${parts.join(', ')} (${events.length} händelser i kalendern).`;
    }

    return {
      success: true,
      message,
      updatedSessions: cleanSessions,
      addedCount,
      updatedCount,
      removedCount: totalRemoved,
      skippedCount,
      lastSyncedAt: Date.now()
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Ett fel uppstod vid kalendersynkronisering.',
      updatedSessions: existingSessions,
      addedCount: 0,
      updatedCount: 0,
      removedCount: 0,
      skippedCount: 0,
      lastSyncedAt: Date.now()
    };
  }
}
