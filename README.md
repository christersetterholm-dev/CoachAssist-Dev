# CoachAssist ⚽️

Digitalt verktyg för fotbollstränare: träningsplanering med tävlingsmoment och poängliga,
trupp och medlemsregister, kalender, laguppställningar och taktiktavla.

## Kom igång lokalt

Kräver Node.js 20 eller senare.

```bash
npm install          # en gång, och när package.json ändrats
npm run dev          # startar appen på http://localhost:3000
```

Första gången: skapa ett konto direkt i den lokala databasen (t.ex. för en root-admin):

```bash
npm run set-password -- din@epost.se
```

## Vanliga kommandon

| Kommando | Vad det gör |
| --- | --- |
| `npm run dev` | Startar servern och appen i utvecklingsläge |
| `npm test` | Kör API-testerna (behörigheter, datalagring) mot en tillfällig databas |
| `npm run typecheck` | Typkontroll av både app och server |
| `npm run build` | Bygger appen (`dist/`) och servern (`dist/server.cjs`) |
| `npm run deploy` | Testar, bygger och laddar upp till webbhotellet (se nedan) |

## Driftsättning

```bash
npm run deploy
```

Skriptet `deploy.sh` kör typkontroll och tester, bygger appen, säkerhetskopierar databasen
på servern (`backups/`), laddar upp `dist/`, `app.cjs` och `package.json` via rsync/SSH och
startar om appen. Databasen och uppladdade bilder på servern rörs aldrig.
Kräver SSH-nyckeln `~/.ssh/coachassist`.

## Struktur

| Sökväg | Innehåll |
| --- | --- |
| `server.ts` | Express-server: inloggning, behörigheter, dokumentlagring i SQLite, filuppladdning, kalenderflöde |
| `app.cjs` | Startfil för cPanel/Passenger, startar `dist/server.cjs` |
| `src/` | React-appen |
| `src/lib/firebase.ts` | Klientens API-lager mot servern (har kvar Firestore-liknande funktionsnamn) |
| `scripts/` | Byggskript och verktyg (t.ex. `set-password.ts`) |
| `tests/` | API-tester (`node:test`) |

## Miljövariabler

Se `.env.example`. Lokalt läses en `.env`-fil i projektmappen; på webbhotellet sätts
variablerna i cPanels Node.js-vy. Viktigast är `JWT_SECRET`.
