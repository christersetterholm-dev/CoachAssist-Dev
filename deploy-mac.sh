#!/bin/bash
set -e

# ==============================================================================
# CoachAssist Auto-Deployer för macOS
# Synkar automatiskt senaste versionen till cPanel (setterho@setterholm.se)
# ==============================================================================

SERVER="setterho@setterholm.se"
SSH_KEY="$HOME/.ssh/coachassist"
REMOTE_DIR="~/coachassist.setterholm.se"
WORK_DIR="/tmp/coachassist_deploy_temp"

echo "🚀 Startar deploy av CoachAssist till $SERVER..."

# 1. Skapa ren tillfällig arbetsmapp
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

# 2. Försök ladda ner direkt från AI Studio Shared URL, eller använd senaste zip från Downloads
ZIP_URL="https://ais-pre-5rinf7gvwaklikkeip3eut-372119737616.europe-west3.run.app/api/download-production-bundle"

DOWNLOAD_SUCCESS=false

# Testa ladda ner via curl från delad URL
if curl -sSL --fail "$ZIP_URL" -o "$WORK_DIR/bundle.zip" 2>/dev/null; then
  # Verifiera att det är en giltig zip-fil och inte en inloggningssida
  if unzip -tq "$WORK_DIR/bundle.zip" 2>/dev/null; then
    echo "📦 Hämtade senaste produktionspaketet direkt från AI Studio!"
    DOWNLOAD_SUCCESS=true
  fi
fi

# Om curl misslyckades pga Google-inloggning, ta automatiskt senaste zip från Downloads
if [ "$DOWNLOAD_SUCCESS" = false ]; then
  LATEST_DOWNLOAD=$(ls -t $HOME/Downloads/coachassist-production-bundle*.zip 2>/dev/null | head -n 1)
  if [ -n "$LATEST_DOWNLOAD" ] && [ -f "$LATEST_DOWNLOAD" ]; then
    echo "📦 Använder senaste nedladdade paketet från Downloads: $(basename "$LATEST_DOWNLOAD")"
    cp "$LATEST_DOWNLOAD" "$WORK_DIR/bundle.zip"
  else
    echo "❌ Kunde inte hämta filen via curl och ingen hittades i ~/Downloads."
    echo "Klicka på ladda ner zip i webbläsaren en gång och kör sedan detta script."
    exit 1
  fi
fi

# 3. Packa upp i arbetsmappen
echo "📂 Packar upp filer..."
unzip -qo "$WORK_DIR/bundle.zip" -d "$WORK_DIR/extracted"

# 4. Synka dist-mappen och nödvändiga serverfiler med rsync
echo "🔄 Överför filer till $SERVER via rsync..."
rsync -avz -e "ssh -i $SSH_KEY" \
  "$WORK_DIR/extracted/dist/" \
  "$SERVER:$REMOTE_DIR/dist/"

# Synka även .htaccess, app.cjs, package.json och run-build.cjs om de ändrats
if [ -f "$WORK_DIR/extracted/app.cjs" ]; then
  rsync -avz -e "ssh -i $SSH_KEY" \
    "$WORK_DIR/extracted/app.cjs" \
    "$WORK_DIR/extracted/.htaccess" \
    "$WORK_DIR/extracted/package.json" \
    "$WORK_DIR/extracted/run-build.cjs" \
    "$SERVER:$REMOTE_DIR/" 2>/dev/null || true
fi

# 5. Starta om appen på servern
echo "⚡ Startar om Node.js på servern..."
ssh -i "$SSH_KEY" "$SERVER" "mkdir -p $REMOTE_DIR/tmp && touch $REMOTE_DIR/tmp/restart.txt"

# 6. Städa upp den tillfälliga mappen
rm -rf "$WORK_DIR"

echo ""
echo "========================================================"
echo "🎉 DEPLOY KLAR! CoachAssist är uppdaterad och omstartad."
echo "👉 https://coachassist.setterholm.se/"
echo "========================================================"
