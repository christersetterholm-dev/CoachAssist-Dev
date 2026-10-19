# CoachAssist ⚽️

En app för hela fotbollslaget – tränare, spelare och förening. Kalender med kallelser och
närvaro, chatt, inlägg och notiser, laguppställningar, taktiktavla med animationer och
träningar med tävlingsmoment och poängliga. All data tillhör föreningen och laget, så flera
tränare delar samma lag. Appen är på svenska och fungerar i mobilen, på surfplattan och på datorn
(kan läggas till på hemskärmen).

## Vad appen gör

**Kalender och kallelser**
- Träningar, matcher och andra aktiviteter i vyerna Agenda, Månad och Lista (med svenska röda dagar).
- Serier av träningspass som återkommer varje vecka, med samlingstid, plats och information.
- Kallelser med sista svarsdag. Spelarna svarar Kommer, Delvis eller Kan inte – på ett pass
  eller på flera på en gång – och tränaren ser svaren och bockar av närvaro.
- Prenumerera på lagets kalender i Apple eller Google Kalender (iCal-länk med hemlig nyckel).

**Kommunikation**
- Chatt: en lagchatt per lag, egna grupper och en-till-en-samtal, med bilder, filer och reaktioner.
- Inlägg: tränarna skriver meddelanden till laget med bild och länkar; alla kan reagera och
  kommentera, och tränarna ser vilka som läst.
- Notiser i telefonen eller datorn (Web Push) för chatt, inlägg och nya kallelser.

**Taktik och uppställningar**
- Laguppställningar med formationer, bänk och anteckningar, och en bild att skicka till spelarna.
- Taktiktavla med pennor, pilar, löpningar, zoner, motståndare och flera bollar.
- Animation i steg: spelare och boll glider mellan stegen, med valbart tempo.
- Lagets sparade taktiktavlor kan delas med spelarna.
- Storskärmsläge för att visa uppställningen eller poänglistan på en tv eller projektor.

**Träning och tävling**
- Passplanering med moment, övningsbank och taktiktavla för övningar.
- Tävlingsmoment med poängräkning och en poängliga över perioder.

**Trupp och förening**
- Medlemsregister per förening med roller per lag (admin, tränare, spelare).
- Spelarna får konto via en inbjudningslänk som tränaren delar själv (sms, WhatsApp).
- Personuppgifter som telefon och e-post visas bara för tränare och för personen själv.

## Teknik

- React och Vite (TypeScript) i webbläsaren.
- Egen Express-server (`server.ts`) med SQLite som databas – ingen Firebase.
  Servern använder better-sqlite3, eller Node 22:s inbyggda `node:sqlite` om det inte går.
- Inloggning med e-post och lösenord (valfritt Google), notiser med egna VAPID-nycklar.
- Körs på ett webbhotell med cPanel och Passenger.

## Kom igång lokalt

Kräver Node.js 22.13 eller senare.

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
| `npm run dev` | Startar servern och appen i utvecklingsläge (startar om automatiskt när serverkoden ändras) |
| `npm test` | Kör testerna mot en tillfällig databas |
| `npm run typecheck` | Typkontroll av både app och server |
| `npm run build` | Bygger appen (`dist/`) och servern (`dist/server.cjs`) |
| `npm run deploy` | Testar, bygger och laddar upp till webbhotellet (se nedan) |

## Driftsättning

```bash
npm run deploy
```

Skriptet `deploy.sh` kör typkontroll och tester, bygger appen, säkerhetskopierar databasen och
chattens filer på servern (`backups/`), laddar upp `dist/`, `app.cjs` och `package.json` via
rsync/SSH och startar om appen. Databasen och uppladdade filer på servern skrivs aldrig över.
Kräver SSH-nyckeln `~/.ssh/coachassist`.

## Struktur

| Sökväg | Innehåll |
| --- | --- |
| `server.ts` | Express-servern: inloggning, dokumentlagring, uppladdning, kalenderflöde |
| `server/` | Delar av servern: databas och schema, medlemsregister och behörigheter, inbjudningar, chatt, inlägg, notiser, taktiktavlor, kalenderprenumeration |
| `app.cjs` | Startfil för cPanel/Passenger, startar `dist/server.cjs` |
| `src/` | React-appen (`src/components/ui` = gemensamma byggklossar) |
| `src/lib/firebase.ts` | Appens API-lager mot servern (har kvar Firestore-liknande funktionsnamn) |
| `public/sw.js` | Servicearbetare som visar notiser |
| `scripts/` | Byggskript och verktyg (t.ex. `set-password.ts`) |
| `tests/` | Tester med `node:test` (API, behörigheter, chatt, notiser, animationer) |
| `CLAUDE.md` | Utförliga projektanteckningar: beslut, arkitektur och vad som är kvar att göra |

## Miljövariabler

Se `.env.example`. Lokalt läses en `.env`-fil i projektmappen; på webbhotellet sätts
variablerna i cPanels Node.js-vy. Viktigast är `JWT_SECRET` och `ADMIN_EMAILS`.
Notisernas nycklar skapas automatiskt första gången (kan sättas med `VAPID_PUBLIC_KEY` och
`VAPID_PRIVATE_KEY`).
