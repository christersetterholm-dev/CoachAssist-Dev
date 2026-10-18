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
| Lagets taktiktavlor (menyposten Taktiktavla) | `server/tacticalBoards.ts`, `src/components/TacticalBoardsView.tsx` |
| Inlägg (tränarnas meddelanden till laget) | `server/posts.ts`, `src/lib/posts.ts`, `src/components/PostsView.tsx` |
| Startfil på webbhotellet (Passenger) | `app.cjs` → `dist/server.cjs` |
| React-appen | `src/` (`App.tsx` och `LineupBuilder.tsx` är mycket stora) |
| Appens skal (sidomeny, bottenmeny, toppfält, kontomeny) | `src/components/shell/AppShell.tsx` |
| Gemensamma byggklossar (Button, IconButton, Card, SegmentedTabs, Badge, EmptyState, Avatar, Sheet, MenuItem) | `src/components/ui/index.tsx` |
| Startsidan Översikt (nästa aktivitet, svar på kallelse, snabbval, poängtopp) | `src/components/HomeView.tsx` |
| Välkomstsida för utloggade | `src/components/WelcomeScreen.tsx` |
| Tester | `tests/*.test.mjs` (node:test, startar servern mot tom temp-databas) |

### Dokumentlagringen (`/api/docs?path=...`)
Appen läser/skriver JSON-dokument via sökvägar:
- `clubs/<förening>/teams/<lag>/data/<segment>` – segment: sessions, exercises, lineups,
  periods, settings, squad, tacticalboards. `teams/club_global/data/{members,metadata}` = föreningsnivå.
- `tacticalboards` = `{ boards: [{ id, name, sharedWithPlayers, createdAt, updatedAt, state }] }`.
  Appen sparar en tavla i taget via `GET/PUT/DELETE /api/tacticalboards` (inte hela dokumentet),
  och servern skickar bara delade tavlor till spelare – även via `/api/docs`.
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

### Inlägg (`/api/posts`, `server/posts.ts`)
- Egna tabeller (inte dokumentlagringen): `posts` (per förening+lag; rubrik, text, fäst, valfri
  `session_id`, bild `/uploads/...`, länkar som JSON), `post_reads` (läst av, per konto + medlem),
  `post_reactions` (valfri emoji, högst 20 per person och inlägg; `REACTIONS` = snabbvalen),
  `post_comments`. Emojis normaliseras (`normalizeEmoji`, samma i server och app) så att t.ex.
  👍 och 👍️ (med U+FE0F) blir samma reaktion.
- Plusknappen öppnar `src/components/EmojiPicker.tsx`: svensk sökning och kategorier från
  `emojibase-data/sv` (laddas som egen fil först när väljaren öppnas), "Senaste reaktioner"
  sparas i webbläsarens localStorage.
- Tränare/föreningsadmin i laget skriver, ändrar, fäster, tar bort (och tar bort andras
  kommentarer). Alla i laget läser, reagerar och kommenterar. Annat lag/förening får 404.
- "Läst av" räknas mot lagets spelare (roll `player`); bara tränare får siffror och namnlistor.
- Bilder: bara uppladdade (`/uploads/...`). HEIC görs om till JPEG och krymps i webbläsaren
  (`optimizeImageForUpload` i `src/utils/imageOptimizer.ts`, heic2any) – serverns sharp kan inte
  läsa iPhones HEIC. Länkar måste vara http/https och öppnas i ny flik.
- Appen: `usePosts` i App.tsx (hämtar var 5:e minut). Kortet på Översikt (`PostsHomeSection`, med
  miniatyrbild), sidan Inlägg (`view === 'posts'`), läsarket `PostDetailSheet` och skrivarket
  `PostEditorSheet` ligger i `overlays`. Menyvalet Inlägg (märke = olästa) syns i sidomenyn; i
  mobilens bottenmeny finns det inte (för trångt) – där får Översikt märket.

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
- Christer committar och pushar själv med GitHub Desktop. Ge inga git-kommandon för commit/push;
  föreslå i stället ett commit-meddelande (på svenska) som han kan klistra in.

### Servern (webbhotell med cPanel)
- `setterho@setterholm.se`, SSH-nyckel `~/.ssh/coachassist`, appmapp `~/coachassist.setterholm.se`.
- Node 22.23.3 vald i cPanel ("Setup Node.js App"). Passenger startar `app.cjs`. `JWT_SECRET` är satt som miljövariabel där.
  Node-sökvägen står i serverns `.htaccess` (PassengerNodejs) – rör aldrig `.htaccess`.
- Data i appmappen: `coachassist.db` (SQLite), `uploads/` (bilder), `backups/` (kopior som
  deploy tar). `coachassist_db.json.flyttad-*` = gamla JSON-databasen (sparad orörd).
  `gammalt/` = flyttade rester från AI Studio-tiden (kan raderas).
- Ikonfilerna i approten skrivs av appens PWA-ikonfunktion och ska vara kvar.
- `deploy.sh` vägrar köra om servern har Node äldre än 22.13.

## Gränssnittet (ombyggt okt 2026, gren `ux-ombyggnad`)

- Navigering: bottenmeny på mobil (Översikt, Kalender, Truppen, Uppställn., Taktik, Poäng), sidomeny från
  768 px bredd (iPad/dator). Lagsida, Administration, profil, tema, "Hämta senaste" och
  Logga ut ligger i kontomenyn (avataren) och i sidomenyn.
- Startvy är `home` (Översikt). Poängräkning (`exercise`) och skapa tävlingsmoment (`setup`)
  är "fokusvyer" utan meny, med eget sidhuvud och tillbakaknapp (`handleFocusBack`).
- Storskärmsläge (`isPresenting` i App.tsx): knappen "Visa på storskärm" på Uppställning och
  Poängliga döljer menyer, försöker helskärm och skickar `presentationMode` till
  `LineupBuilder` (bara planen, skalad) och `Leaderboard` (två kolumner, inga knappar).
  Knappen för att lämna läget ligger i nedre högra hörnet och tonas bort efter 3 s (Esc stänger).
- Uppställning (`LineupBuilder.tsx`): är vyn minst 720 px bred (1080 px med liggande plan)
  ligger planen till vänster och en sidopanel till höger med flikarna Sparade, Formation,
  Utseende och Anteckningar. Bredden mäts på vyn själv (ResizeObserver), inte på fönstret. I
  smalare vyer (mobil, iPad på höjden) finns verktygsraden under planen och flikarna öppnas
  i ark (`Sheet`).
- Bildläge ("Skärmbild att skicka till spelarna", `isSnapshotMode` i LineupBuilder): täcker
  hela skärmen och visar bara lagkortet (`renderLineupContent(true)`) med plan och bänk i fast
  storlek, skalat till skärmen. Ett tryck visar Klar i två sekunder, och Esc stänger. Den ersätter
  den gamla förhandsgranskningen/skärmbildsmodalen.
- Taktiktavlan (`isMaximized` i LineupBuilder, ombyggd okt 2026): övre rad med Ångra/Gör om/
  Visa-dölj ritningar (vänster) och Taktiktavlor/Bildläge/Liggande-stående plan/Helskärm/Mer/Stäng
  (höger; under 640 px ligger Taktiktavlor och Bildläge i Mer). En
  verktygsrad (48 px knappar) längst ner, lodrätt till vänster när skärmen ligger ner och är minst
  900 px bred: Flytta, Penna, Pil, Löpning, Linje, Zon, Text, Boll, Motståndare, Sudd, färg, Bänken.
  Övriga inställningar ligger i arket Mer; Rensa allt frågar "Bara ritningar" eller "Allt".
  `boardMode`: 'edit' | 'present' (helskärm: bara planen, verktygen fälls in, knapp för liggande plan) | 'snapshot'
  (bildläge: inga knappar, tryck visar Klar, Esc stänger). Planens storlek räknas med CSS-variablerna
  `--board-rx`/`--board-ry` så att den inte hamnar under raderna.
  Ritningar (`tacticalBoard.drawings`): löpning sparas som `freehand-arrow` med `lineType: 'dashed'`,
  zon som `rectangle`/`circle` med `filled: true`; bara `line` är en ny typ (äldre appversioner ritar
  den som en pil). Suddet träffar hela linjen (`hitDrawing`) och suddar längs hela draget.
  Apple Pencil: med "Pennan ritar alltid" (på) ritar pennan och fingret flyttar – först när en penna
  har använts (`pointerType === 'pen'`). Med ett ritverktyg går tryck på en spelare vidare till
  planen, så en pil kan börja vid spelaren.
  Taktiktavlans rutor är ark (`Sheet`): Text på tavlan, Nummer och roll (dubbeltryck på spelare),
  Sparade taktiktavlor, Spara taktiktavlan? (vid Stäng), Spara som formation och Motståndarnas
  formation. Formationsrutan (blått/rött lag) har kvar sin egen ram men nya flikar och typografi.
- Menyposten **Taktiktavla** (`view === 'tacticalboards'`, `TacticalBoardsView`): lagets egna
  taktiktavlor för alla i laget. Tränare skapar, byter namn, kopierar, delar (öga) och tar bort; en
  ny tavla är tom och spelare tas fram med Visa truppen (hela truppen, ingen gräns på 7). Tavlan
  visas med `LineupBuilder` i läget `standaloneBoard` (öppnas direkt i taktiktavlan; uppställningens
  sparade tavlor, anteckningar och publicering är dolda; Stäng går tillbaka till listan). Spelare
  ser bara delade tavlor och utan verktyg (`boardReadOnly`). Tavlan översätts till och från en
  "uppställning" i `boardToLineup`/`lineupToState`; bänken sparas inte.
- Ny kod ska använda byggklossarna i `src/components/ui` i stället för egna knappklasser.
  Stil: meningsversaler (inte VERSALER), `font-semibold`/`font-bold`, tryckytor minst 40 px.
- Spelare ser inte Övningsbanken eller tävlingsknapparna i poänglistan (`canManage`).
- Passvyn (`SessionEditor` + `SessionRsvpView`): tränaren har flikarna Planera / Träna / Närvaro,
  momenten visas som tidslinje och svaren grupperade per status (tryck på en person för att ändra
  svar; bocken markerar närvaro). Spelaren landar på Kallelse (vad, när, var, svara Kommer/Delvis/
  Kan inte med kommentar) och ser Upplägg i läsläge, eller inte alls om `hideContentForPlayers`.
  Två kolumner från 768 px. "Skapa kallelse" sätter bara sista svarsdag och meddelande – inga
  mejl eller notiser skickas.

## Konventioner

- Ordval: allt som tidigare hette "rittavla" heter **taktiktavla** – både uppställningens
  `isMaximized`-läge och ritytan för övningar/moment (TacticalBoardModal). Gäller samtal och appens texter.

- Arbeta på en egen git-gren per uppgift; slå ihop till `main` när tester och typkontroll går
  igenom. Commit-meddelanden på svenska.
- Lägg till/uppdatera tester i `tests/` för server- och behörighetsändringar.
- Ändra inte produktionsdata direkt; prova databasflyttar mot en kopia först.

## Kvar att göra / idéer

- Inlägg: visa kopplade inlägg även i passvyn (`SessionRsvpView`); notiser när nytt inlägg kommer.
- `isProduction` i server.ts blir sant om mappens sökväg innehåller "dist" (t.ex. en worktree som
  heter `distracted-...`) – då letar `npm run dev` efter `dist/index.html`. Kontrollera hellre mappnamnet exakt.

- Föräldrar kopplade till barn (svara på kallelser åt dem).
- `admins/root_admins_list` kan läsas av alla inloggade – begränsa.
- Rate-limit litar på `X-Forwarded-For` (kan förfalskas).
- Vite-HMR via websocket fungerar inte i middleware-läget (ofarligt, sidan laddas om manuellt).
- Dela upp `server.ts`, `App.tsx`, `LineupBuilder.tsx` gradvis; appen laddas som ett stort JS-paket (3,4 MB).
- Gränssnittet, kvar att göra i nya stilen:
  LineupBuilders övriga modaler (spelarväljare, rubrik, anteckningar) som har kvar VERSALER. Klara: uppställningen (sidopanel och bildläge), taktiktavlan, Översikt, kalender, passplanering
  och kallelser, Truppen, Tävlingsmoment och GameSetup, Profil, Poängliga, Administrationens
  ram/flikar (flikarnas innehåll har bara fått lugnare typografi).
- `hideContentForPlayers` döljs bara i appen; servern skickar ändå passets moment till spelare.
- Tränarens app visade inte en spelares nya svar ens efter omladdning (servern hade svaret);
  troligen används pass som sparats i webbläsaren i stället för serverns. Utred synkningen.
- I poängräkningen (`view === 'exercise'` i App.tsx) är timerpanelen och jokerraden ovanför
  poängkorten fortfarande i gammal stil (VERSALER).
- E-post via SMTP (inbjudningar, glömt lösenord) om det behövs senare.
- iOS-app och notiser (pausat, utrett okt 2026): steg 1 webbnotiser (Web Push/PWA, egen server,
  ingen Firebase); steg 2 Capacitor-skal runt befintliga appen för riktiga notiser via APNs och
  låst stående läge i t.ex. poängräkningen. Påminnelser kräver cron-jobb i cPanel (Passenger kan sova).
