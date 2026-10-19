#!/bin/bash
# =============================================================================
# Laddar upp informationssidan (mappen site/) till truppio.se på webbhotellet.
#
#   ./deploy-site.sh     (eller npm run deploy-site)
#
# Rör bara filerna i site/. cPanels egna filer i ~/truppio.se (.htaccess,
# php.ini, .well-known för certifikatet) lämnas orörda.
# =============================================================================
set -euo pipefail

SERVER="setterho@setterholm.se"
SSH_KEY="$HOME/.ssh/coachassist"
REMOTE_DIR="truppio.se"                # relativt hemkatalogen på servern
SITE_URL="https://truppio.se"

cd "$(dirname "$0")"
SSH="ssh -i $SSH_KEY -o ConnectTimeout=15"

[[ -f "$SSH_KEY" ]] || { echo "❌ Hittar inte SSH-nyckeln $SSH_KEY"; exit 1; }
$SSH "$SERVER" "test -d ~/$REMOTE_DIR" || { echo "❌ Hittar inte ~/$REMOTE_DIR på servern"; exit 1; }

echo "▶ Laddar upp informationssidan"
# site/* (inte site/) så att mappens egna rättigheter, som cPanel satt, lämnas orörda
rsync -az -e "$SSH" site/* "$SERVER:$REMOTE_DIR/"

echo "🎉 Klart! Sidan finns på $SITE_URL"
