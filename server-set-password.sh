#!/bin/bash
# Sätter ett nytt lösenord (eller skapar kontot) direkt i databasen på servern.
#   ./server-set-password.sh din@epost.se
set -euo pipefail
EMAIL="${1:-}"
[[ -n "$EMAIL" ]] || { echo "Ange e-postadress: ./server-set-password.sh din@epost.se"; exit 1; }
SERVER="setterho@setterholm.se"
SSH_KEY="$HOME/.ssh/coachassist"
REMOTE_DIR="coachassist.setterholm.se"
NODE_BIN=$(ssh -i "$SSH_KEY" "$SERVER" "grep -m1 '^PassengerNodejs' ~/$REMOTE_DIR/.htaccess | sed -E 's/^PassengerNodejs[[:space:]]+\"?([^\"]+)\"?.*/\\1/'")
[[ -n "$NODE_BIN" ]] || { echo "❌ Hittar inte Node-versionen på servern"; exit 1; }
ssh -t -i "$SSH_KEY" "$SERVER" "cd ~/$REMOTE_DIR && $NODE_BIN dist/set-password.cjs '$EMAIL'"
