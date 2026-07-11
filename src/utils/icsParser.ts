export interface ParsedIcsEvent {
  externalId: string;
  title: string;
  date: number; // Midday timestamp for the session date
  startTime: string; // "HH:MM"
  endTime?: string; // "HH:MM"
  description?: string;
  location?: string;
}

export function parseIcsCalendar(icsData: string): ParsedIcsEvent[] {
  const events: ParsedIcsEvent[] = [];
  
  if (!icsData) return events;

  // Unfold folded lines (lines wrapped with a space or tab on the next line)
  const unfolded = icsData.replace(/\r?\n[ \t]/g, '').replace(/\r[ \t]/g, '');
  const lines = unfolded.split(/\r?\n|\r|\n/);
  
  let currentEvent: {
    externalId?: string;
    title?: string;
    dtStartRaw?: string;
    dtEndRaw?: string;
    description?: string;
    location?: string;
  } | null = null;
  
  // Helper to parse ICS date-times
  const parseDateTime = (raw: string): { timestamp: number; timeStr: string } | null => {
    const colonIndex = raw.indexOf(':');
    let value = colonIndex !== -1 ? raw.slice(colonIndex + 1) : raw;
    value = value.trim();
    
    if (!value || value.length < 8) return null;
    
    const year = parseInt(value.slice(0, 4), 10);
    const month = parseInt(value.slice(4, 6), 10) - 1;
    const day = parseInt(value.slice(6, 8), 10);
    
    if (value.includes('T')) {
      const tIndex = value.indexOf('T');
      const hour = parseInt(value.slice(tIndex + 1, tIndex + 3), 10);
      const minute = parseInt(value.slice(tIndex + 3, tIndex + 5), 10);
      
      const isUtc = value.endsWith('Z');
      let dateObj: Date;
      
      if (isUtc) {
        // Construct in UTC, convert to local
        dateObj = new Date(Date.UTC(year, month, day, hour, minute));
      } else {
        // Construct in local timezone
        dateObj = new Date(year, month, day, hour, minute);
      }
      
      const timeStr = dateObj.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
      
      // We set the date timestamp to standard Swedish local midday (12:00:00) so it doesn't shift days with timezone offsets
      const sessionDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 12, 0, 0).getTime();
      
      return {
        timestamp: sessionDate,
        timeStr
      };
    } else {
      // All day event (e.g. VALUE=DATE:20261012 or just 20261012)
      const dateObj = new Date(year, month, day, 12, 0, 0);
      return {
        timestamp: dateObj.getTime(),
        timeStr: '18:00' // Default start time if none specified
      };
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed === 'BEGIN:VEVENT') {
      currentEvent = {};
    } else if (trimmed === 'END:VEVENT') {
      if (currentEvent) {
        const { externalId, title, dtStartRaw, dtEndRaw, description, location } = currentEvent;
        if (dtStartRaw) {
          const startInfo = parseDateTime(dtStartRaw);
          const endInfo = dtEndRaw ? parseDateTime(dtEndRaw) : null;
          
          if (startInfo) {
            events.push({
              externalId: externalId || `ics-${startInfo.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
              title: title?.trim() || 'Träningspass',
              date: startInfo.timestamp,
              startTime: startInfo.timeStr || '18:00',
              endTime: endInfo?.timeStr || undefined,
              location: location || '',
              description: description || ''
            });
          }
        }
      }
      currentEvent = null;
    } else if (currentEvent) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      
      const keyPart = trimmed.slice(0, colonIdx);
      const valuePart = trimmed.slice(colonIdx + 1);
      
      const key = keyPart.split(';')[0].toUpperCase();
      
      if (key === 'UID') {
        currentEvent.externalId = valuePart.trim();
      } else if (key === 'SUMMARY') {
        currentEvent.title = valuePart
          .replace(/\\,/g, ',')
          .replace(/\\;/g, ';')
          .replace(/\\n/g, '\n')
          .trim();
      } else if (key === 'LOCATION') {
        currentEvent.location = valuePart
          .replace(/\\,/g, ',')
          .replace(/\\;/g, ';')
          .replace(/\\n/g, '\n')
          .trim();
      } else if (key === 'DTSTART') {
        currentEvent.dtStartRaw = trimmed;
      } else if (key === 'DTEND') {
        currentEvent.dtEndRaw = trimmed;
      } else if (key === 'DESCRIPTION' || key === 'COMMENT' || key.startsWith('X-ALT-DESC') || key.includes('SAMLING')) {
        let val = valuePart
          .replace(/\\,/g, ',')
          .replace(/\\;/g, ';')
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '')
          .trim();
        
        // If it's a custom key containing SAMLING, label it clearly if it isn't already labeled
        if (key.includes('SAMLING') && !val.toLowerCase().includes('samling')) {
          val = `Samlingstid: ${val}`;
        }

        if (currentEvent.description) {
          if (!currentEvent.description.includes(val)) {
            currentEvent.description += '\n' + val;
          }
        } else {
          currentEvent.description = val;
        }
      }
    }
  }
  
  return events;
}
