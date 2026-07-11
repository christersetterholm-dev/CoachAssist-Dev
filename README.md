# CoachAssist ⚽️

**CoachAssist** är ett komplett och kraftfullt digitalt verktyg för fotbollscoacher som underlättar planering, lagbygge, taktikgenomgångar och träningsstatistik. Det är designat för att vara snabbt, intuitivt och fullt responsivt på både mobil och dator.

---

## 🌟 Huvudfunktioner

- **Taktiktavla (Whiteboard)**: Rita spelsystem, övningar och taktiska rörelser med ritverktyg (penna, pilar, linjer, cirklar och fyrkanter). Flytta spelare och bollar fritt för att visualisera spelmönster.
- **Laguppställningar (Lineup Builder)**: Bygg startelvor och formationer (t.ex. 4-4-2, 4-3-3, 3-5-2) med drag-and-drop. Spara och organisera uppställningar inför matcher och träningar.
- **Spelartrupp (Squad Management)**: Hantera hela träningsgruppen med bilder, positioner, tröjnummer och kontaktinformation.
- **Tävlingsmoment & Poängräkning**: Planera träningspass med interna tävlingsmoment. Fördela poäng till spelarna för att automatiskt bygga och hålla liv i en spännande poängliga över tid.
- **Kalender & Planering**: Strukturera kommande träningar, matcher och lagaktiviteter direkt i appen.

---

## 🚀 Köra appen lokalt

Följ dessa steg för att köra **CoachAssist** på din egen dator:

### Förutsättningar
- [Node.js](https://nodejs.org/) (version 18 eller senare rekommenderas)
- [npm](https://www.npmjs.com/) (följer med Node.js)

### Installationssteg

1. **Klona eller ladda ner källkoden** till din dator.
2. **Installera beroenden**:
   ```bash
   npm install
   ```
3. **Starta utvecklingsservern**:
   ```bash
   npm run dev
   ```
4. **Öppna appen**:
   Öppna din webbläsare och gå till [http://localhost:3000](http://localhost:3000) (eller den port som visas i terminalen).

---

## 🛠️ Teknikstack

- **Frontend**: React (TypeScript), Vite, Tailwind CSS, Motion (f.d. Framer Motion)
- **Backend/Server**: Express (TypeScript)
- **Ikoner**: Lucide React
- **Databas & Synk**: Firebase Firestore & Firebase Authentication (stödjer automatisk molnsparning för sparad data)

---

## 💡 Bra att veta om Gemini API
Den automatiska texten på GitHub kan nämna `GEMINI_API_KEY`. **CoachAssist** fokuserar helt på att erbjuda kraftfulla taktiska och administrativa verktyg för coacher och använder för närvarande **inte** Gemini AI API. Du behöver därför **inte** konfigurera någon AI-nyckel i din `.env.local` för att köra appen.

---

Utvecklad med passion för fotboll och smidig lagledning! ⚽️🏃‍♂️
