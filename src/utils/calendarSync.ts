import { TrainingSession } from '../types';
import { getApiUrl } from '../lib/firebase';
import { parseIcsCalendar } from './icsParser';

export interface SyncResult {
  success: boolean;
  message: string;
  updatedSessions: TrainingSession[];
  addedCount: number;
  updatedCount: number;
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
    let skippedCount = 0;
    let updatedCount = 0;

    for (const ev of events) {
      const matchByExternalId = ev.externalId ? currentSessionsList.find(s => s.externalId === ev.externalId) : undefined;
      
      let matchByProximity = undefined;
      if (!matchByExternalId) {
        matchByProximity = currentSessionsList.find(s => {
          return !s.externalId && formatToYYYYMMDD(s.date) === formatToYYYYMMDD(ev.date) && s.startTime === ev.startTime;
        });

        if (!matchByProximity && ev.title) {
          const cleanEvTitle = ev.title.replace(/^\[INSTÄLLT\]\s*/i, '').trim().toLowerCase();
          matchByProximity = currentSessionsList.find(s => {
            if (s.externalId) return false;
            const cleanSTitle = s.title.replace(/^\[INSTÄLLT\]\s*/i, '').trim().toLowerCase();
            const isSameTitle = cleanSTitle === cleanEvTitle || (cleanSTitle.includes('träning') && cleanEvTitle.includes('träning'));
            const dayDiff = Math.abs(s.date - ev.date) / (1000 * 60 * 60 * 24);
            return isSameTitle && dayDiff <= 4;
          });
        }
      }

      const matchedSession = matchByExternalId || matchByProximity;

      if (matchedSession) {
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

        const newSession: TrainingSession = {
          id: `session_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`,
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
          notes: ''
        };

        newSessionsToAdd.push(newSession);
      }
    }

    const finalSessions = [...newSessionsToAdd, ...currentSessionsList];

    return {
      success: true,
      message: `Synkning klar! Läste in ${newSessionsToAdd.length} nya pass och uppdaterade ${updatedCount} pass.`,
      updatedSessions: finalSessions,
      addedCount: newSessionsToAdd.length,
      updatedCount,
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
      skippedCount: 0,
      lastSyncedAt: Date.now()
    };
  }
}
