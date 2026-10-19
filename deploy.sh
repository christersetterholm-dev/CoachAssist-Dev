#!/bin/bash
# =============================================================================
# Driftsätter CoachAssist till webbhotellet (cPanel).
#
#   ./deploy.sh              kontrollerar, testar, bygger och laddar upp
#   ./deploy.sh --skip-tests hoppar över testerna (snabbare)
#
# Kräver SSH-nyckeln ~/.ssh/coachassist (samma som tidigare).
# Databasen och uppladdade bilder på servern rörs aldrig, men databasen (och chattens filer)
# säkerhetskopieras före varje uppdatering (sparas i backups/ på servern).
# =============================================================================
set -euo pipefail

SERVER="setterho@setterholm.se"
SSH_KEY="$HOME/.ssh/coachassist"
REMOTE_DIR="coachassist.setterholm.se"           # relativt hemkatalogen på servern
SITE_URL="https://coachassist.setterholm.se"

SKIP_TESTS=false
[[ "${1:-}" == "--skip-tests" ]] && SKIP_TESTS=true

cd "$(dirname "$0")"
SSH="ssh -i $SSH_KEY -o ConnectTimeout=15"
step() { echo; echo "▶ $1"; }

step "Kontrollerar förutsättningar"
[[ -f "$SSH_KEY" ]] || { echo "❌ Hittar inte SSH-nyckeln $SSH_KEY"; exit 1; }
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  echo "⚠️  Det finns ändringar som inte är sparade i git:"
  git status --short | head -10
  read -r -p "Vill du driftsätta ändå? (j/N) " svar
  [[ "$svar" =~ ^[jJyY]$ ]] || exit 1
fi
[[ -d node_modules ]] || npm install

step "Typkontroll"
npm run typecheck --silent

if ! $SKIP_TESTS; then
  step "Kör tester"
  npm test --silent
fi

step "Bygger appen"
rm -rf dist
npm run build --silent

step "Ansluter till servern"
$SSH "$SERVER" "test -d ~/$REMOTE_DIR" || { echo "❌ Hittar inte ~/$REMOTE_DIR på servern"; exit 1; }
# Den Node-version Passenger använder står i serverns .htaccess (PassengerNodejs)
NODE_BIN=$($SSH "$SERVER" "grep -m1 '^PassengerNodejs' ~/$REMOTE_DIR/.htaccess | sed -E 's/^PassengerNodejs[[:space:]]+\"?([^\"]+)\"?.*/\\1/'" 2>/dev/null || true)
[[ -n "$NODE_BIN" ]] || { echo "❌ Hittar inte PassengerNodejs i ~/$REMOTE_DIR/.htaccess"; exit 1; }
ACTIVATE="source \"$(dirname "$NODE_BIN")/activate\""   # cPanels Node-miljö (samma som 'Run NPM Install')
NODE_VERSION=$($SSH "$SERVER" "$NODE_BIN -v" 2>/dev/null || echo "okänd")
echo "  Node på servern: $NODE_VERSION"
if [[ ! "$NODE_VERSION" =~ ^v(2[3-9]|[3-9][0-9])\. && ! "$NODE_VERSION" =~ ^v22\.(1[3-9]|[2-9][0-9]) ]]; then
  echo "❌ Appen kräver Node 22.13 eller senare på servern (för inbyggd SQLite)."
  echo "   Välj Node 22 i cPanel > Setup Node.js App och kör sedan deploy igen."
  exit 1
fi

step "Säkerhetskopierar databasen på servern"
$SSH "$SERVER" 'cd ~/'"$REMOTE_DIR"' && mkdir -p backups && stamp=$(date +%Y%m%d-%H%M%S) && found=0
  for f in coachassist.db coachassist_db.json; do
    if [ -f "$f" ]; then cp "$f" "backups/$stamp-$f"; found=1; echo "  ✓ $f kopierad till backups/$stamp-$f"; fi
  done
  [ $found = 1 ] || echo "  (ingen databasfil hittades)"
  if [ -d chat_files ]; then tar -czf "backups/$stamp-chat_files.tar.gz" chat_files && echo "  ✓ chattens filer packade till backups/$stamp-chat_files.tar.gz"; fi
  ls -1t backups/*-chat_files.tar.gz 2>/dev/null | tail -n +4 | xargs -r rm --
  ls -1t backups/* 2>/dev/null | tail -n +41 | xargs -r rm --'

step "Laddar upp filer"
OLD_PKG=$($SSH "$SERVER" "cat ~/$REMOTE_DIR/package.json 2>/dev/null | md5sum" || true)
rsync -az -e "$SSH" dist/ "$SERVER:$REMOTE_DIR/dist/"
rsync -az --delete -e "$SSH" dist/assets/ "$SERVER:$REMOTE_DIR/dist/assets/"
rsync -az -e "$SSH" app.cjs package.json package-lock.json "$SERVER:$REMOTE_DIR/"
NEW_PKG=$($SSH "$SERVER" "cat ~/$REMOTE_DIR/package.json | md5sum")

HAS_MODULES=$($SSH "$SERVER" "test -f ~/$REMOTE_DIR/node_modules/express/package.json && echo ja || echo nej")
if [[ "$OLD_PKG" != "$NEW_PKG" || "$HAS_MODULES" != "ja" ]]; then
  step "Installerar paket på servern (npm install)"
  if ! $SSH "$SERVER" "$ACTIVATE && cd ~/$REMOTE_DIR && npm install --omit=dev --no-audit --no-fund"; then
    echo "⚠️  npm install på servern misslyckades. Öppna cPanel > Setup Node.js App och klicka 'Run NPM Install'."
  fi
fi

step "Startar om appen"
$SSH "$SERVER" "mkdir -p ~/$REMOTE_DIR/tmp && touch ~/$REMOTE_DIR/tmp/restart.txt"

step "Kontrollerar att appen svarar"
sleep 3
for i in 1 2 3 4 5; do
  if curl -fsS "$SITE_URL/api/health" >/dev/null 2>&1; then
    echo
    echo "🎉 Klart! $SITE_URL är uppdaterad."
    exit 0
  fi
  sleep 4
done
echo "⚠️  Appen svarar inte på $SITE_URL/api/health ännu. Kontrollera sidan i webbläsaren."
echo "    Om något gått fel finns felmeddelandet i ~/$REMOTE_DIR/server-crash.log på servern."
exit 1
