# CoachAssist – projektanteckningar för Claude

Läs den här filen först i varje nytt samtal. Håll den uppdaterad när något viktigt ändras.

## Om projektet och ägaren

- Fotbollsapp för tränare och spelare: träningsplanering med tävlingsmoment och poängliga,
  trupp/medlemsregister, kalender med kallelser och närvaro, laguppställningar, taktiktavla.
- Ägare: Christer Setterholm (root-admin), tränare i Kungsgårdens SK, lag "Seniorer (Herrar)".
- Christer är ny på utveckling: förklara enkelt på svenska, ge exakta Terminal-kommandon,
  undvik jargong. All text i appen är på svenska.
- Ursprungligen byggd i Google AI Studio; flyttad hit i oktober 2026. Repo: GitHub
  `christersetterholm-dev/CoachAssist-Dev`, lokal mapp `~/Projekt/CoachAssist`.

## Beslut som gäller

- **Data tillhör förening och lag**, inte enskilda tränare. Flera tränare delar lagets data.
  Läget där en tränare har allt under sitt eget konto ska inte finnas kvar.
- **Ingen Firestore/Firebase.** `src/lib/firebase.ts` är bara appens API-lager mot vår egen
  server (har kvar Firestore-liknande funktionsnamn: doc/getDoc/setDoc).
- **SQLite** är databasen. Servern använder better-sqlite3 om det fungerar, annars Node 22:s
  inbyggda `node:sqlite` (så är det på webbhotellet).
- **Spelare får konto via inbjudningslänk** som tränaren delar själv (sms/WhatsApp). Ingen
  e-postserver (SMTP) är uppsatt.
- Föräldrar kopplade till barn: planerat, inte byggt.

## Arkitektur

| Del | Fil |
| --- | --- |
| Server (Express) | `server.ts` (stor; dela upp gradvis vid ändringar) |
| Databas, schema, flytt från gammal JSON-databas | `server/database.ts` |
| Medlemsregister, behörigheter, svar på kallelser | `server/registry.ts` |
| Inbjudningslänkar | `server/invites.ts` |
| Startfil på webbhotellet (Passenger) | `app.cjs` → `dist/server.cjs` |
| React-appen | `src/` (`App.tsx` och `LineupBuilder.tsx` är mycket stora) |
| Tester | `tests/*.test.mjs` (node:test, startar servern mot tom temp-databas) |

### Dokumentlagringen (`/api/docs?path=...`)
Appen läser/skriver JSON-dokument via sökvägar:
- `clubs/<förening>/teams/<lag>/data/<segment>` – segment: sessions, exercises, lineups,
  periods, settings, squad. `teams/club_global/data/{members,metadata}` = föreningsnivå.
- `users/<uid>/data/profile` – profil (aktiv förening/lag m.m.). `setDoc(..., {merge:true})`
  slår ihop på servern.
- `shared_leaderboards/<id>` – delade poänglistor (publika att läsa).
- `shared_leaderboards/all_clubs` – räknas fram ur föreningarnas metadata (sparas inte).

### Medlemsregistret (enda sanningen om personer)
- Tabeller `members` (en rad per person och förening; `id` = gamla trupp-id:t, som historiken
  pekar på; `user_id` = kopplat konto) och `team_roles` (roll per lag: admin/coach/player/parent;
  `team_id = 'club_global'` = föreningsnivå).
- Dokumenten `squad` och `club_global/members` finns INTE lagrade längre – servern räknar fram
  dem ur tabellerna vid läsning och översätter tillbaka vid sparning (`getSquadDoc`,
  `saveSquadDoc`, `getMembersDoc`, `saveMembersDoc`). Ledarrader i truppen kan ha id `<id>_leader`.
- Den inloggades egna rader markeras `isMe: true`.

### Behörigheter (`getClubAccess` i registry.ts)
- Root-admin: e-post i `ADMIN_EMAILS` eller `admins/root_admins_list`. Får allt.
- Läsa lagets data: medlem i laget. Skriva: tränare i laget eller föreningsadmin.
- Personnummer/telefon/e-post visas bara för tränare (och för personen själv).
- Bara root-admin skapar föreningar. Tränare kan inte ge sig själva admin-roll.
- Konton kopplas automatiskt till medlemsrader med samma id eller e-post vid inloggning.

### Svar på kallelser
- Tabell `rsvps` (en rad per person och aktivitet). `POST /api/rsvp`, `POST /api/rsvp/clear`.
- Vid läsning av `sessions` läggs svaren in i varje pass (`overlayRsvps`); vid sparning tas
  de ut (`extractRsvps`) så att samtidiga svar aldrig skriver över varandra.

### Poängligor
- `getConsolidatedPeriods` samlar bara från det egna laget/användaren (läckte tidigare mellan lag).

## Köra, testa, driftsätta

```bash
npm install            # på Macen
npm run dev            # http://localhost:3000, startar om automatiskt vid serverändringar (tsx watch)
npm test               # API-tester
npm run typecheck      # app + server
npm run deploy         # typkontroll, tester, bygge, backup, uppladdning, omstart
npm run set-password -- e@post.se            # lokalt konto/lösenord
./server-set-password.sh e@post.se           # samma sak på servern via SSH
```

### När Claude arbetar via Cowork (Linux-VM mot den kopplade mappen)
- npm-registret och GitHub nås INTE därifrån (403). Kör inte `npm install` i VM:en.
- `node_modules` är Mac-byggda: esbuild/vite/better-sqlite3 fungerar inte i VM:en, men ren JS
  gör det. Typkontroll: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  (och `-p tsconfig.server.json`).
- Tester i VM:en: `TEST_TS_RUNNER="--experimental-strip-types" node --test tests/*.test.mjs`
  (servern faller tillbaka på node:sqlite). Importer av egna .ts-filer måste ha `.ts`-ändelse.
- Gränssnittet testas i Claudes webbläsare mot `http://localhost:3000` när Christer har
  `npm run dev` igång på Macen. Använd `http://127.0.0.1:3000` för en andra, separat
  inloggning (t.ex. som spelare). Lösenord får Claude inte skriva in – be Christer logga in.
- Christer måste själv starta om `npm run dev` i Terminal om den inte redan går i watch-läge.
- `git push` måste Christer köra själv från Macen.

### Servern (webbhotell med cPanel)
- `setterho@setterholm.se`, SSH-nyckel `~/.ssh/coachassist`, appmapp `~/coachassist.setterholm.se`.
- Node 22.23.3 vald i cPanel ("Setup Node.js App"). Passenger startar `app.cjs`.
  Node-sökvägen står i serverns `.htaccess` (PassengerNodejs) – rör aldrig `.htaccess`.
- Data i appmappen: `coachassist.db` (SQLite), `uploads/` (bilder), `backups/` (kopior som
  deploy tar). `coachassist_db.json.flyttad-*` = gamla JSON-databasen (sparad orörd).
  `gammalt/` = flyttade rester från AI Studio-tiden (kan raderas).
- Ikonfilerna i approten skrivs av appens PWA-ikonfunktion och ska vara kvar.
- `deploy.sh` vägrar köra om servern har Node äldre än 22.13.

## Konventioner

- Arbeta på en egen git-gren per uppgift; slå ihop till `main` när tester och typkontroll går
  igenom. Commit-meddelanden på svenska.
- Lägg till/uppdatera tester i `tests/` för server- och behörighetsändringar.
- Ändra inte produktionsdata direkt; prova databasflyttar mot en kopia först.

## Kvar att göra / idéer

- Föräldrar kopplade till barn (svara på kallelser åt dem).
- Spelarvyn: dölj spara-/redigeringsknappar i träningsplaneringen för spelare.
- `admins/root_admins_list` kan läsas av alla inloggade – begränsa.
- Rate-limit litar på `X-Forwarded-For` (kan förfalskas).
- Vite-HMR via websocket fungerar inte i middleware-läget (ofarligt, sidan laddas om manuellt).
- Dela upp `server.ts`, `App.tsx`, `LineupBuilder.tsx` gradvis; appen laddas som ett stort JS-paket (3,4 MB).
- E-post via SMTP (inbjudningar, glömt lösenord) om det behövs senare.
- Sätt `JWT_SECRET` som miljövariabel i cPanel om det inte redan är gjort.
