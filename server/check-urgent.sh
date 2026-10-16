#!/bin/bash
# Met le serveur d'impression a jour si un des nouveaux commits contient
# « urgent » (et pas seulement le dernier : l'API commite sans cesse
# « Update active orders », le dernier n'etait presque jamais le bon).
# v3 — tous les nouveaux commits, commandes en cours sauvegardees
cd /home/punjab/punjab-restaurant

git fetch origin 2>/dev/null

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

if git log "$LOCAL..$REMOTE" --format="%s" | grep -qi "urgent"; then
  echo "$(date): Mise a jour urgente detectee — $(git log "$LOCAL..$REMOTE" --format="%s" | grep -i urgent | head -1)"
  # les commandes en cours ne sont plus suivies par git : on les garde quoi qu'il arrive
  cp -f server/active-orders.json /tmp/punjab-active-orders.sauvegarde.json 2>/dev/null || true
  git reset --hard origin/main
  [ -f server/active-orders.json ] || cp -f /tmp/punjab-active-orders.sauvegarde.json server/active-orders.json 2>/dev/null || true
  pkill -f "node server/print-server.js" || true
fi
