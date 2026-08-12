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

export async function syncTeamCalendar(
  icsUrl: string,
  existingSessions: TrainingSession[],
  forceOverwrite: boolean = false
): Promise<SyncResult> {
  if (!icsUrl) {
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

  try {
    const response = await fetch(getApiUrl(`/api/fetch-calendar?url=${encodeURIComponent(icsUrl)}`));
    if (!response.ok) {
      throw new Error(`Kunde inte hämta kalendern (Status ${response.status})`);
    }

    const icsData = await response.text();
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

    const formatToYYYYMMDD = (timestamp: number) => {
      const d = new Date(timestamp);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const r = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${r}`;
    };

    const currentSessionsList = [...existingSessions];
    const newSessionsToAdd: TrainingSession[] = [];
    const matchedExistingIds = new Set<string>();

    let skippedCount = 0;
    let updatedCount = 0;
    let removedCount = 0;

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
      // 1. Match by externalId if present
      const matchByExternalId = ev.externalId ? currentSessionsList.find(s => s.externalId === ev.externalId) : undefined;
      
      let matchByProximity = undefined;
      if (!matchByExternalId) {
        // 2. Proximity matching ONLY applies to sessions without an externalId (manually created local sessions)
        matchByProximity = currentSessionsList.find(s => {
          if (matchedExistingIds.has(s.id) || s.externalId) return false;
          // Match same date and start time
          return formatToYYYYMMDD(s.date) === formatToYYYYMMDD(ev.date) && s.startTime === ev.startTime;
        });

        if (!matchByProximity && ev.title) {
          const cleanEvTitle = ev.title.replace(/^\[INSTÄLLT\]\s*/i, '').trim().toLowerCase();
          matchByProximity = currentSessionsList.find(s => {
            if (matchedExistingIds.has(s.id) || s.externalId) return false;
            // Match same date and identical title (excluding [INSTÄLLT])
            const cleanSTitle = s.title.replace(/^\[INSTÄLLT\]\s*/i, '').trim().toLowerCase();
            return formatToYYYYMMDD(s.date) === formatToYYYYMMDD(ev.date) && cleanSTitle === cleanEvTitle;
          });
        }
      }

      const matchedSession = matchByExternalId || matchByProximity;

      if (matchedSession) {
        matchedExistingIds.add(matchedSession.id);

        if ((matchedSession.isCompleted || matchedSession.isIgnored) && !forceOverwrite) {
          skippedCount++;
          continue;
        }

        let changed = false;
        const sessionIndex = currentSessionsList.findIndex(s => s.id === matchedSession.id);
        if (sessionIndex === -1) continue;

        const updated = { ...currentSessionsList[sessionIndex] };
        
        if (updated.title !== ev.title) {
          updated.title = ev.title;
          changed = true;
        }
        if (formatToYYYYMMDD(updated.date) !== formatToYYYYMMDD(ev.date)) {
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
        if (!updated.externalId && ev.externalId) {
          updated.externalId = ev.externalId;
          changed = true;
        }

        if (changed) {
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
        const newSession: TrainingSession = {
          id: `session_${Math.random().toString(36).substring(2, 9)}_${now}`,
          externalId: ev.externalId,
          title: ev.title,
          date: ev.date,
          startTime: ev.startTime,
          endTime: ev.endTime || calculateEndTime(ev.startTime, 90),
          location: ev.location || '',
          description: ev.description || '',
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

    // Filter out auto-synced sessions that were removed from external ICS feed and have no local edits/planning
    const finalSessionsList: TrainingSession[] = [];
    for (const session of currentSessionsList) {
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
        (session.notes && session.notes.trim().length > 0);

      if (hasLocalEdits) {
        // Keep user's planned session even if removed from external feed
        finalSessionsList.push(session);
      } else {
        // Unedited auto-synced session removed from external feed -> remove it
        removedCount++;
      }
    }

    const combinedSessions = [...newSessionsToAdd, ...finalSessionsList];
    combinedSessions.sort((a, b) => {
      if (a.date !== b.date) return a.date - b.date;
      return (a.startTime || '').localeCompare(b.startTime || '');
    });

    const addedCount = newSessionsToAdd.length;
    let message = '';
    if (addedCount === 0 && updatedCount === 0 && removedCount === 0) {
      message = 'Kalendern är redan helt uppdaterad (inga ändringar hittades).';
    } else {
      const parts: string[] = [];
      if (addedCount > 0) parts.push(`${addedCount} nya pass`);
      if (updatedCount > 0) parts.push(`${updatedCount} uppdaterade pass`);
      if (removedCount > 0) parts.push(`${removedCount} borttagna/inställda pass`);
      message = `Synkning klar! ${parts.join(', ')}.`;
    }

    return {
      success: true,
      message,
      updatedSessions: combinedSessions,
      addedCount,
      updatedCount,
      removedCount,
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
