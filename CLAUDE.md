# CoachAssist – projektanteckningar för Claude

Läs den här filen först i varje nytt samtal. Håll den uppdaterad när något viktigt ändras.

## Om projektet och ägaren

- Appen heter **Truppio** (sedan okt 2026; hette CoachAssist/KSK-appen). Repo, mappar och interna
  nycklar (`coachassist.*` i localStorage, databasfilen) heter fortfarande coachassist – byt inte dem.
  Hemskärmens namn och ikon kan föreningen sätta själv i Administration (PWA-ikoner, `system/pwa_icons`);
  det sparade värdet går före standardnamnet Truppio.
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
| Närvaro (tabell, läs/spara, flytt) | `server/attendance.ts` |
| Närvarokort för LOK-stöd (regler, uträkning, låsning) | `server/lok.ts` (tester i `tests/lok.test.mjs`), `src/lib/lok.ts`, `src/components/attendance/Lok*.tsx` |
| Lagets taktiktavlor (menyposten Taktiktavla) | `server/tacticalBoards.ts`, `src/components/TacticalBoardsView.tsx` |
| Animationer i steg på taktiktavlan (räknandet, ingen React) | `src/utils/boardAnimation.ts` (tester i `tests/boardAnimation.test.mjs`) |
| Inlägg (tränarnas meddelanden till laget) | `server/posts.ts`, `src/lib/posts.ts`, `src/components/PostsView.tsx` |
| Chatt (lagchatt, grupper, en-till-en) | `server/chat.ts` (tester i `tests/chat.test.mjs`), `src/lib/chat.ts`, `src/components/chat/` |
| Notiser (Web Push för chatt, inlägg och kallelser) | `server/push.ts` (tester i `tests/push.test.mjs`), `src/lib/push.ts`, `public/sw.js`, `src/components/NotificationsSheet.tsx` |
| Startfil på webbhotellet (Passenger) | `app.cjs` → `dist/server.cjs` |
| React-appen | `src/` (`App.tsx` och `LineupBuilder.tsx` är mycket stora) |
| Appens skal (sidomeny, bottenmeny, toppfält, kontomeny, Mer) | `src/components/shell/AppShell.tsx`, `src/components/shell/MoreSheet.tsx` |
| Gemensamma byggklossar (Button, IconButton, Card, SegmentedTabs, Badge, EmptyState, Avatar, Sheet, MenuItem) | `src/components/ui/index.tsx` |
| Textrutor som tål diktering (TextInput, TextArea) | `src/components/ui/TextField.tsx` |
| Startsidan Översikt (nästa aktivitet, svar på kallelse, snabbval, poängtopp) | `src/components/HomeView.tsx` |
| Menyn Närvaro (aktiviteter, svar, Ny aktivitet, statistik) | `src/components/attendance/` |
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

### Närvaro (menyn, gren `narvaro`, okt 2026)
- `view === 'attendance'` → `AttendanceView`. Flikar Aktiviteter (alla), Statistik och Närvarokort (tränare). Aktiviteter: Kommande/Tidigare, filter Träning/Match/Övrigt; spelare svarar
  direkt på raden (`answerForMe` i `attendance/shared.ts`), tränare ser svar resp. närvaro på en rad för spelare och
  en för tränare (`teamLeaders`; den som också är spelare räknas som spelare) och öppnar passet.
- **Statistik** (`AttendanceStatsView`, även Truppens flik Närvaro; gamla `SquadAttendanceOverview` borttagen): period
  (30 dagar / 6 månader / Halvåret / I år eller egna datum), typer, grupp Spelare/Tränare, en stapel per person uppdelad
  på match/övrigt/träning med procent, medelnärvaro (medel av personernas procent, som laget.se), tryck = detaljer inkl.
  "svarade kommer men bockades inte". Spara som bild (html-to-image, laddas vid behov) eller Excel (xlsx). Uträkningen i
  `src/utils/attendanceStats.ts` (tester i `tests/attendanceStats.test.mjs`): bara genomförda, ej ignorerade pass räknas.
- **Ny aktivitet** (`NewActivitySheet`, tränare): typ, motståndare + hemma/borta (match), enskild eller varje vecka,
  start/slut/samling, plats, information, LOK-aktivitet, kallelse med sista svarsdag och notis. Sparas som vanliga pass.
- Nya fält i pass: `opponent`, `homeAway`, `lok` (saknas = räknas för LOK, `false` = inte). Typen `other` (Övrigt)
  går också att välja i passvyn.
- **Närvaron lagras i tabellen `attendance`** (`server/attendance.ts`), en rad per person och pass, `present` 1/0. Raden
  med 0 (tränaren tog bort bocken) finns kvar så att en gammal kopia av pass-dokumentet inte lägger tillbaka bocken.
  Vid läsning av `sessions` läggs närvaron in som `attendance` (`overlayAttendance`); vid sparning läggs bara personer
  utan rad till och listan tas bort ur dokumentet (`extractAttendance`). Appen skickar ändringar med
  `POST /api/attendance` `{ clubId, teamId, sessionId, add?, remove? }` (bara tränare, högst 300 personer) –
  `syncAttendanceChange` i App.tsx jämför före/efter i `onUpdateSession`, så alla vyer som ändrar `attendance` går den
  vägen. 404 (pass som inte hunnit sparas) ignoreras; närvaron följer då med när passet sparas. Gammal närvaro i
  dokumenten flyttas vid start (`migrateAttendance`; lokalt flyttades 465 bockar okt 2026).
- **Serier och ändra flera pass** (`src/components/sessions/`): pass som skapas tillsammans (serieformuläret i Kalendern,
  "Varje vecka" i Ny aktivitet) får samma `seriesId`. Ändras tid, plats, samling, information, typ eller LOK i passvyns
  "Tid och plats" frågar appen: bara det här / det här och kommande / alla i serien (även genomförda); pass som har ett
  annat värde behåller det om man inte bockar "skriv över" (`applyChanges` med `onlyIf`). "Hantera serien" och knappen
  Serier i Närvaro öppnar `SeriesSheet`: ändra alla eller kommande (`BulkEditSheet`), förläng (`extendSeries`, samma
  veckodagar/tider, inget upplägg/svar/närvaro) och ta bort pass från ett datum (till papperskorgen). "Välj flera" i
  Närvaro → Aktiviteter ändrar valfria pass (även gamla utan serie, t.ex. LOK på genomförda). LOK-rutan finns i "Tid och
  plats". Tester i `tests/series.test.mjs`.
  **Viktigt:** ändringar av flera pass räknas fram ur `latestDataRef` och sparas i ett anrop (`replaceSessionsNow`,
  `onUpdateSessions`, `onDeleteSessions` i App.tsx). Att anropa `onDeleteSession`/`onUpdateSession` i en loop skickade
  en tom passlista till servern (variabeln som sätts i `setData(prev => …)` hinner inte sättas) – det tömde den lokala
  databasen vid test okt 2026 (återställt).
- Medlemmar har `gender` ('female'/'male', null = räknas fram ur personnumret) och `disability` (funktionsnedsättning)
  i `members`, visas bara för tränare (som personnumret). Ändras i Administrationens medlemsformulär.
- **Närvarokort för LOK-stöd** (`server/lok.ts`, räknas på servern): halvår (`period` "2026-2" = juli–dec), korttyp
  `state` (RF:s föreskrifter fr.o.m. 2025-07-01, `STATE_RULES`, fasta: deltagare som fyller 6–25 under året, ingen övre
  gräns vid funktionsnedsättning, ledare minst 13, minst 3 deltagare + 1 ledare och 45 min, högst 20 per ledare, en gång
  per dag, högst 3 (6–9 år) resp. 5 tillfällen per vecka) eller `municipal` (föreningsadmin fyller i under Administration
  → Närvaro/LOK, sparas i `system_docs` `lok_rules/<förening>`; Sandvikens regler okända, av som standard). Bara
  genomförda pass med `lok !== false`; spelare = deltagare (även den som också är tränare), övriga tränare = ledare; ålder och kön ur
  personnummer om `gender` saknas. Celler 1 / (1) / x som laget.se. API: `GET /api/lok/rules`, `PUT /api/lok/rules`
  (föreningsadmin), `GET /api/lok/card` (lagets tränare), `GET /api/lok/club` (föreningsadmin, alla lag),
  `POST /api/lok/lock` (tränare intygar; summorna sparas i `lok_locks` och kortet visar om närvaron ändrats sedan),
  `POST /api/lok/unlock` (föreningsadmin). Utskrift/PDF: `LokPrint` lägger korten (25 aktiviteter per kort) i `<body>`
  och `body.lok-printing` i index.css döljer resten; `html.lok-printing` släpper appens `height: 100%; overflow: hidden`
  (annars blev PDF:en bara en sida). Prova utskrift med Chrome headless `--print-to-pdf` mot en testsida med byggd CSS. Som laget.se (stämt av mot hela 2026): dagens första aktivitet gäller – den
  som redan räknats samma dag räknas inte igen och inte heller till de tre som krävs, så t.ex. träning efter teori samma
  dag blir (0); den som nått veckotaket räknas däremot till de tre. En aktivitet som inte godkänns visar inom parentes hur
  många som skulle ha räknats. Varje kort (25 aktiviteter, `PER_CARD`) har egen summering (`pages`), och bara de som var
  med på kortets aktiviteter står på det. Övriga aktiviteter visas med sitt namn i rubriken (`activityLabel`).
  Ledare 13–25 år räknas inte som deltagare (laget.se gör så);
  varje lag räknas för sig (en person i två lag samma dag kan räknas två gånger i föreningens summering).
- Tränarnas närvaro (krävs för att ett pass ska räknas): knapparna "Tränare på plats" i passvyns närvaro
  (`SessionRsvpView`, `teamLeaders`) och "Bocka tränare" i Närvarokort → `LeaderBatchSheet` (flera pass på en gång,
  `POST /api/attendance` per pass; appen uppdateras med `onUpdateSession(..., attendanceSynced = true)`).
- Kvar: import från SvFF (FOGIS) när Christer fått uppgifterna; kanslisten ska kolla hur ansökan görs i dag och
  vilka regler Sandvikens kommun har.
- **Ingen koppling till RF:s API** (kostar pengar, gäller inte alla föreningar). Statligt LOK-stöd kräver att närvaron
  finns i RF:s system (IdrottOnline/Idrottsarenan), så Truppio tar fram underlag men skickar inget till RF.

### Passlistan: sammanslagning och historik (okt 2026)
- Appen skickar lagets hela passlista. En mobil med gammal kopia tömde ett planerat pass (30 okt 2026, syntes i
  åtkomstloggen: mobilen skrev upp allt tio gånger). Orsak: kalendersynken från laget.se (`handleSyncCalendar` i
  TrainingManager, körs själv vid start/fokus) räknade på en gammal bild av passen och ersatte hela listan.
- Nu: kalendersynkens resultat läggs in med `mergeSessionChanges` (`src/utils/sessionMerge.ts`, bara fält som synken
  ändrade). Servern slår ihop pass för pass (`server/sessionsMerge.ts`): nyare `updatedAt` på servern vinner, och pass
  i papperskorgen (`deletedAt`) kommer inte tillbaka från en äldre kopia. Svaret har `keptSessions`; då hämtar appen om.
  Pass som saknas i det inskickade tas fortfarande bort (papperskorg, borttagna kalenderpass).
- Varje ändring av passlistan sparar den tidigare versionen i tabellen `sessions_history` (100 senaste per lag, med
  vem och vilken webbläsare som skrev över) – där kan man se vad som hände och hämta tillbaka.
- Användarens ändringar av pass ska sätta `updatedAt: Date.now()`, annars kan de förloras mot en annan enhet.
- `pushDirtySegments` skickar bara ändrade delar (tidigare skickades allt när inget ändrats).
- Åtkomstloggen på servern: `~/access-logs/app.truppio.se-ssl_log` (läsa kräver Christers ok).

### Svar på kallelser
- Tabell `rsvps` (en rad per person och aktivitet). `POST /api/rsvp`, `POST /api/rsvp/clear`.
- Vid läsning av `sessions` läggs svaren in i varje pass (`overlayRsvps`); vid sparning tas
  de ut (`extractRsvps`) så att samtidiga svar aldrig skriver över varandra.
- **Svara på flera pass** (`src/components/MultiRsvpSheet.tsx`, okt 2026): ett ark med kommande pass,
  kryssrutor, snabbval Obesvarade/Alla/Datum (från–till) och Avmarkera, sedan Kommer/Delvis/Kan inte och en
  gemensam kommentar (t.ex. "Skadad"). Öppnas från Översikt (knappen under svarsknapparna för spelare,
  "Svara på flera" vid Kommande för tränare) och Kalendern (knapp i verktygsraden för spelare, i plusmenyn för
  tränare). Spelare svarar för sig själva; tränare väljer "Svaret gäller": sig själva eller någon i truppen
  (märks "Tränare (namn)", samma rätt som i passvyn). Ligger i App.tsx `overlays` (`isMultiRsvpOpen`).
  Sparas med `POST /api/rsvp/batch` `{ clubId, teamId, memberId, sessionIds (1–200), status (null = ta bort),
  comment? }` i en transaktion, allt eller inget (okänt pass ger 404 med `missing`). Kommentaren ersätter de
  valda passens kommentarer (tom tar bort); utan `comment` behålls varje pass egen. Samma behörighet som
  `/api/rsvp` (`rsvpContext` i server.ts), men inte för gästspelare.

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

### Chatt (`/api/chat`, `server/chat.ts`, okt 2026)
- Per förening. Tre sorter: `team` (en lagchatt per lag, skapas automatiskt; vem som är med räknas
  fram ur `team_roles`, föreningsadmin räknas inte in), `group` (vem som helst startar; skaparen är
  gruppadmin och kan utse fler; alla kan lämna; föreningsadmin som är med kan "ta över"), `direct`
  (en per par, `direct_key`; syns för mottagaren först när något skrivits). Bara personer med konto
  kopplat till en medlemsrad i föreningen kan chatta.
- Tabeller: `chat_conversations`, `chat_participants` (roll, `left_at`, `last_read_seq` = läst till),
  `chat_messages` (`seq` stigande; `kind` text/event – händelser som "X lade till Y"; `rev` höjs vid
  varje ändring, från `chat_revs`), `chat_reactions`, `chat_files`, `chat_reports`.
- Privat: den som inte är med får 404, även root-admin. Personlistan skickar bara namn, bild och lag.
  Lagets tränare kan ta bort meddelanden i lagchatten. Anmälda meddelanden visas för föreningsadmin och
  tränare i avsändarens lag – bara meddelandet och två före/efter.
- Filer ligger i `DATA_DIR/chat_files/` (inte publikt) och hämtas via `/api/chat/files/:id` med
  inloggning (appen gör blob-adresser). Bilder krymps/HEIC görs om i webbläsaren. Tillåtna typer i
  `FILE_TYPES`. `deploy.sh` packar `chat_files/` till `backups/` (3 senaste).
- Gränser (`LIMITS`): 4000 tecken, 30 meddelanden/min, 20 grupper/dygn, 100 i en grupp, 10 MB/fil,
  5 filer/meddelande, 1 GB/förening, ändra inom 15 min.
- Utöver notiserna (se nedan) frågar appen `?after=<rev>` var 3:e s i en öppen chatt (10 s efter 2 min utan aktivitet),
  `/api/chat/summary` var 30:e s för märket, listan var 15:e s, inget när appen ligger i bakgrunden.
  (Websocket/SSE passar inte Passenger på webbhotellet.)
- Appen: `useChatSummary` i App.tsx (märket), `view === 'chat'` → `ChatView` (lista; på mobil täcker en
  öppen chatt hela skärmen, från 768 px lista + chatt bredvid). Skrivfältet är en ostyrd `TextArea`.

### Notiser (`/api/push`, `server/push.ts`, okt 2026)
- Web Push med egna VAPID-nycklar (paketet `web-push`, ingen Firebase). Nycklarna skapas första gången
  och sparas i `system_docs` (`system/vapid_keys`), eller sätts med `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`.
  Avsändaradress `VAPID_SUBJECT` (standard `mailto:` + första i `ADMIN_EMAILS`). Byts nycklarna måste alla slå på igen.
- Tabell `push_subscriptions` (en rad per enhet: adress, nycklar, konto, `chat`/`posts`/`sessions` på/av). Högst 10
  enheter per konto. Samma enhet med nytt konto tillhör det nya kontot. 404/410 från push-tjänsten tar bort raden.
  Bara adresser hos de vanliga push-tjänsterna godtas (`PUSH_HOSTS`); `PUSH_ALLOW_ANY_ENDPOINT=1` bara i testerna.
- Skickas: nytt chattmeddelande (till alla andra i chatten, inte den som har chatten öppen – `markActive` när
  appen hämtar meddelanden, 15 s), nytt inlägg (till alla med roll i laget utom författaren). Ändringar,
  reaktioner och kommentarer ger ingen notis. Skickas i bakgrunden efter svaret.
- Kallelser (`sessions`): `POST /api/sessions/notify` (bara tränare, högst 10 per lag och timme) skickar EN notis till
  alla med roll i laget utom avsändaren. Appen skickar en sammanfattning av passen (id, titel, datum, tid) eftersom de
  kanske inte hunnit sparas. Rutan "Skicka notis till laget" finns i serieformuläret (på som standard) och i arket
  Skapa kallelse (på vid första publicering, av vid ändring). Ett pass öppnar kallelsen, flera öppnar kalendern
  (`view: 'sessions'` i `pushOpen`).
- `public/sw.js` är appens servicearbetare: visar notisen och vid tryck skickar `{ type: 'coachassist-open', open }`
  till ett öppet fönster, annars öppnas `/?open=<json>`. Den cachar ingenting. App.tsx (`pushOpen`) öppnar chatten
  (`openChatId`) eller inlägget (`openPostId`).
- Appen: menyposten **Notiser** (Mer och kontomenyn) öppnar `NotificationsSheet` – slå på, välj Chatt/Inlägg/Kallelser,
  testnotis, stäng av. Gäller en enhet. iPhone/iPad: bara när appen är tillagd på hemskärmen (iOS 16.4+).
  Notisarket har valen Chatt, Inlägg och Kallelser.
  `syncPush` vid start förnyar enhetens adress om samma konto slagit på notiser (`coachassist.push` i localStorage).
  Utloggning stänger av notiserna på enheten.
- Claudes webbläsare (i Claude-appen) kan inte registrera servicearbetare – prova notiser i Safari/Chrome eller på telefonen.

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
- Från VM:en når Claude inte GitHub: där committar och pushar Christer själv med GitHub Desktop.
  Föreslå i stället ett commit-meddelande (på svenska) som han kan klistra in.

### När Claude arbetar i Claude-appen på Macen (Code)
- Claude sköter hela flödet när Christer ber om det: egen gren, commit (svenska meddelanden),
  slå ihop till `main` (`git merge --ff-only`), `git push origin main` och `npm run deploy`.
  Tillåtelserna står i `.claude/settings.local.json` (finns bara på Macen, inte i git).
  Driftsätt bara när Christer ber om det.
- Pushen loggar in via GitHub CLI (`gh`, Homebrew) över HTTPS som kontot **christersetterholm-dev**
  (äger repot). Kontot `christersetterholm` finns också i `gh` men har inte skrivrätt (403).
  Vid 403 eller "could not read Username": kolla `gh auth status`, byt med
  `gh auth switch -u christersetterholm-dev`, kör vid behov `gh auth setup-git`.
- Går något inte (spärr eller fel): säg vad som stoppade och ge exakta steg för GitHub Desktop
  eller Terminal. I GitHub Desktop slår man ihop genom att stå på **main** och välja grenen i
  Branch → Merge into current branch.

### Servern (webbhotell med cPanel)
- `setterho@setterholm.se`, SSH-nyckel `~/.ssh/coachassist`, appmapp `~/coachassist.setterholm.se`.
- Node 22.23.3 vald i cPanel ("Setup Node.js App"). Passenger startar `app.cjs`. `JWT_SECRET` är satt som miljövariabel där.
  Node-sökvägen står i serverns `.htaccess` (PassengerNodejs) – rör aldrig `.htaccess`.
- Data i appmappen: `coachassist.db` (SQLite), `uploads/` (bilder), `backups/` (kopior som
  deploy tar). `coachassist_db.json.flyttad-*` = gamla JSON-databasen (sparad orörd).
  `gammalt/` = flyttade rester från AI Studio-tiden (kan raderas).
- Ikonfilerna i approten skrivs av appens PWA-ikonfunktion och ska vara kvar.
- `deploy.sh` vägrar köra om servern har Node äldre än 22.13.
- **Domänen truppio.se** (registrerad hos Loopia, DNS i Loopias DNS-editor: `@`, `www` och `app` → A
  46.246.119.18). I cPanel är `app.truppio.se` upplagd med samma mapp som `coachassist.setterholm.se`,
  alltså samma app och databas på båda adresserna (okt 2026; den gamla adressen ska vara kvar tills vidare).
  `truppio.se` har egen mapp `~/truppio.se` med informationssidan från `site/` i repot
  (`npm run deploy-site`, laddar bara upp `site/`). `~/truppio.se/.htaccess` (bara på servern) skickar http till https;
  för app-adresserna görs det med Force HTTPS Redirect i cPanel. Inloggning, notiser och hemskärmsikon gäller per
  adress. **Flytten (okt 2026, `server/moved.ts`):** på `coachassist.setterholm.se` visar servern en flyttsida för
  allt utom `/api/`, `/uploads/` och `/sw.js`. Den stänger av notiserna där och skickar vidare till samma sida på
  `app.truppio.se` med inloggningen i #-delen (`#flytt=<token>&notiser=1`), som appen tar emot i `takeMovedLogin`
  (firebase.ts) och sedan öppnar Notiser. Gamla kalenderprenumerationer fungerar alltså kvar. Styrs av
  `OLD_HOSTS`/`NEW_ORIGIN` (tester i `tests/moved.test.mjs`). `deploy.sh` kontrollerar `https://app.truppio.se`.

## Gränssnittet (ombyggt okt 2026, gren `ux-ombyggnad`)

- Navigering: sidomeny från 768 px bredd (iPad/dator) med alla funktioner; profilbilden överst i
  sidomenyn öppnar kontomenyn. Ordning: Översikt, Kalender, Chatt, Inlägg, Uppställning, Taktiktavla,
  Poängliga, Truppen, Övningsbanken (bara tränare; `exercisebank` är en genväg till Kalenderns flik
  Övningar, `trainingTab === 'bank'`), sedan Lagsida och Administration. På mobil: bottenmeny med Översikt (alltid först) + tre valfria +
  **Mer** (`LayoutGrid`). Mer (`src/components/shell/MoreSheet.tsx`) visar övriga funktioner som
  rutor, Anpassa menyn, lag, tema, Hämta senaste, Skakskydd och Logga ut. Uppe till vänster i
  toppfältet visas den inloggades profilbild (öppnar Mer). Valet sparas i profilen (`mobileNav`, följer kontot); standard för tränare
  Kalender/Uppställning/Chatt, för spelare Kalender/Chatt/Poängliga (`defaultMobileNav`). Märket på
  Mer = olästa chattar och väntande ansökningar som inte har egen knapp.
  På mobil glider toppfält och bottenmeny undan när man skrollar neråt och kommer tillbaka uppåt
  (`onMainScroll` i AppShell; ark och ytor märkta `data-keep-bars` räknas inte). Inställningen
  "Dölj toppfältet i Uppställning" (Anpassa menyn, profilfältet `hideLineupTopBar`) tar bort
  toppfältet där helt; sidans knappar (storskärm) ligger då i en rund ruta nere till höger.
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
  **Animation i steg** (okt 2026): knappen Animera (klappa, sist i verktygsraden) eller Mer → Animation
  gör tavlan till steg: steg 1 = utgångsläget, ett nytt steg börjar som kopia av det valda. Stegraden
  (Föregående/Spela/Nästa, stegnummer, Nytt steg, Redigera) ligger ovanför verktygsraden; tryck på det
  valda steget eller pennan öppnar arket med stegets text, flytta tidigare/senare och ta bort. Spelare,
  motståndare och boll glider mellan stegen (Långsam 2,5 s / Normal 1,5 s / Snabb 0,9 s per steg i Mer);
  ritningarna hör till sitt steg och byts när spelarna är framme. Valfria streckade spår. Tempoknappen
  bredvid Spela (0,25× / 0,5× / 1× / 1,5×, alla – även spelare och i helskärm) skalar uppspelningen
  ovanpå tavlans hastighet; den sparas per enhet i `localStorage` (`coachassist.boardPlaybackRate`),
  inte i tavlan, och kan bytas mitt i en uppspelning. Under
  uppspelning går tavlan inte att ändra. Spelare (`boardReadOnly`) får bara uppspelningen och börjar på
  steg 1; i helskärm visas en kompakt rad "Steg 2 av 5" nere till vänster och stegets text överst.
  Datamodell: `tacticalBoard.animation` / tavlans `state.animation` = `{ frames: [{ id, players,
  opponents, footballPos, drawings, note }], speed, showTrails, current }`. Det valda steget visas och
  redigeras i tavlans vanliga state (tacticalPlayers, opponents …); `animationForSave` lägger in det i
  `frames` vid sparning. Tavlans vanliga fält sparas som det valda steget, så äldre appversioner visar
  en stillbild. Max 20 steg. Ångra/Gör om omfattar stegen.
  **Bollar** (okt 2026): flera bollar går (högst 10). Med verktyget Boll lägger ett tryck på planen till
  en ny boll; en rad överst visar tips, Bollens storlek −/+ (50–300 %, samma som i Mer) och Ta bort alla
  bollar. Suddet tar bort enskilda bollar. Bollens storlek följer spelarnas storlek (22 px × spelarstorlek
  × bollstorlek). Sparas som `footballs: [{ id, x, y }]` både på tavlan och i varje steg; `footballPos`
  (första bollen) sparas också för äldre appversioner, och gamla tavlor med bara `footballPos` läses
  som en boll med id `ball-1` (`normalizeBalls` i boardAnimation.ts). I stegen glider bollar med samma
  id, och en boll som bara finns i ett av stegen tonas in/ut.
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
- **Fritextrutor** (namn, beskrivningar, anteckningar, kommentarer) ska vara `TextInput`/`TextArea`
  från `src/components/ui`, inte `<input>`/`<textarea>`. Christers dikteringsverktyg klistrar ibland in
  text utan input-händelse, och en React-styrd ruta (value + onChange) skrev då över texten vid nästa
  omritning. Byggklossarna används som vanliga rutor (value + onChange) men React skriver bara in nya
  värden utifrån; en fokuserad ruta kollas var 250 ms, och när man lämnar den eller den försvinner, så
  att sådan text ändå når onChange. Utan `value` är de helt ostyrda (ref + defaultValue, läs vid sparning
  – så gör Inlägg). Sök på "DICTATION". LineupBuilder har kvar vanliga rutor (inte genomgången än).
  Stil: meningsversaler (inte VERSALER), `font-semibold`/`font-bold`, tryckytor minst 40 px.
- Kalendern (`MobileCalendarView.tsx`) har tre vyer, valet sparas i webbläsaren (`calendar_view_mode`):
  **Agenda** (standard, en rad per dag i månaden; raden "Inga fler aktiviteter" när månaden är slut),
  **Månad** (`src/components/calendar/MonthGrid.tsx`: rutnät mån–sön med veckonummer, prick +
  klockslag + namn per aktivitet, röda dagar från `src/utils/swedishHolidays.ts`, panel för vald dag
  med "Ny aktivitet den här dagen" – `onNewSession(date)`) och **Lista** (kort, Kommande/Historik).
- Serie träningspass (+ i kalendern → `showSeriesModal` i `TrainingManager.tsx`): titel, tid, längd,
  samling (`gatheringTime`, "HH:MM"), plats, information (`description`), snabbval "Återkommer varje
  vecka" (veckodagar från–till, lägger till datum i kalendern) och "Skapa kallelse direkt" (sätter
  `rsvpConfig` i varje pass; sista svarsdag räknas som X dagar före passet). Samling och information
  kan ändras per pass i passets detaljark och visas i kallelsen, kalendern och på Översikt.
- iCal-prenumeration: `GET /api/calendar/<förening>/<lag>/<nyckel>/events.ics` (`handleIcsFeed` i server.ts). Nyckeln är
  slumpad per lag (tabell `calendar_feed_keys`, `server/calendarFeed.ts`); fel nyckel ger 404. Någon i laget hämtar länken via
  `GET /api/calendar-feed` (skapar nyckeln första gången), tränare byter den med `POST /api/calendar-feed/rotate` ("Skapa ny länk",
  gamla slutar fungera). Rutan `CalendarFeedLink` visas i arket bakom knappen Prenumerera i kalenderns verktygsrad (för alla; med
  direktknappar webcal: för Apple och Google Kalender), under kalenderns inställningar (kugghjulet) och i Administration.
  Alla pass utom ignorerade; DESCRIPTION = samling, information, anteckningar och moment (inte moment om `hideContentForPlayers`).
  Gamla adresser utan nyckel (`/api/calendar/events.ics`, `/<förening>/<lag>/events.ics`) är borttagna och ger 404.
- Huvudadministratören räknas som tränare i kalendern och passvyerna (`effectiveUserRoles` med
  `root_admin` i App.tsx).
- Spelare ser inte Övningsbanken eller tävlingsknapparna i poänglistan (`canManage`).
- Passvyn (`SessionEditor` + `SessionRsvpView`): tränaren har flikarna Planera / Träna / Närvaro,
  momenten visas som tidslinje och svaren grupperade per status (tryck på en person för att ändra
  svar; bocken markerar närvaro). Flikarna Kommer/Delvis/Kan inte visar hela truppen (de med svaret först,
  ordningen låst medan fliken är öppen) och knappen till höger sparar svaret åt spelaren (`toggleStatusForPlayer`). Spelaren landar på Kallelse (vad, när, var, svara Kommer/Delvis/
  Kan inte med kommentar) och ser Upplägg i läsläge, eller inte alls om `hideContentForPlayers`.
  Två kolumner från 768 px. "Skapa kallelse" sätter sista svarsdag och meddelande (spelarna kan svara
  ändå); inga mejl skickas, men tränaren kan välja att skicka en notis (se Notiser).

## Konventioner

- Ordval: allt som tidigare hette "rittavla" heter **taktiktavla** – både uppställningens
  `isMaximized`-läge och ritytan för övningar/moment (TacticalBoardModal). Gäller samtal och appens texter.

- Arbeta på en egen git-gren per uppgift; slå ihop till `main` när tester och typkontroll går
  igenom. Commit-meddelanden på svenska.
- Lägg till/uppdatera tester i `tests/` för server- och behörighetsändringar.
- Ändra inte produktionsdata direkt; prova databasflyttar mot en kopia först.

## Kvar att göra / idéer

- Chatt, senare: svara på/citera ett meddelande, sök i meddelanden, tysta en chatt (även dess notiser),
  blockera, @-omnämnanden, föräldrar.
- Inlägg: visa kopplade inlägg även i passvyn (`SessionRsvpView`).
- Notiser, senare: kommentarer på egna inlägg, påminnelser om obesvarade kallelser (kräver cron-jobb i cPanel), märke med
  antal olästa på appikonen (`setAppBadge`), notis från annan förening byter inte förening (öppnar bara chattlistan).
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
- Taktiktavlans animationer, etapp 4 (stäm av med Christer): spara som video/GIF. Animationen finns
  inte heller i övningarnas taktiktavla (`TacticalBoardModal`).
- E-post via SMTP (inbjudningar, glömt lösenord) om det behövs senare.
- iOS-app (pausat, utrett okt 2026): steg 1 webbnotiser är klart (se Notiser); steg 2 Capacitor-skal runt befintliga appen för riktiga notiser via APNs och
  låst stående läge i t.ex. poängräkningen. Påminnelser kräver cron-jobb i cPanel (Passenger kan sova).
