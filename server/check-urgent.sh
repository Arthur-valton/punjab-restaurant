#!/bin/bash
# Vérifie si le dernier commit GitHub contient "urgent" → mise à jour immédiate
cd /home/punjab/punjab-restaurant

git fetch origin 2>/dev/null

LATEST_MSG=$(git log origin/main -1 --format="%s")
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

if echo "$LATEST_MSG" | grep -qi "urgent"; then
  echo "$(date): Mise à jour urgente détectée — $LATEST_MSG"
  git reset --hard origin/main
  sudo systemctl restart punjab-print
fi
