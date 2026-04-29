#!/bin/bash
cd "/Users/alexandrecaillard/Documents/MINI APP RESTAURANT"

echo "Démarrage du serveur Punjab..."

# Tuer les anciens processus
lsof -ti:3001 | xargs kill -9 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1

CF_TOKEN="eyJhIjoiNmQzZWUzZjA0OGRhOTNiNmE0YzVlNzY5ZjQ3NWY1MjQiLCJ0IjoiNjVhOTdkMTktZGUxZi00MTM0LTg2ZmItYjNhYjMzM2Q1NGE4IiwicyI6Ik56WmpZVFppTkdNdE1XUmpaQzAwWmpFMExXSTRabU10Tm1Zell6ZGtPV015TUdGaCJ9"

# Boucle indépendante pour Node
(
  while true; do
    echo "[Node] Démarrage..."
    /opt/homebrew/bin/node server/print-server.js
    echo "[Node] Crash détecté. Relance dans 3s..."
    sleep 3
  done
) &
NODE_LOOP=$!

# Boucle indépendante pour cloudflared
(
  while true; do
    echo "[Cloudflare] Démarrage du tunnel..."
    /opt/homebrew/bin/cloudflared tunnel --no-autoupdate run --token "$CF_TOKEN"
    echo "[Cloudflare] Tunnel arrêté. Relance dans 5s..."
    sleep 5
  done
) &
CF_LOOP=$!

echo "Tout tourne !"
echo "  KDS     → https://print.restaurant-dev.fr/kds"
echo "  Service → https://print.restaurant-dev.fr/service"
echo "  (Node loop PID: $NODE_LOOP, CF loop PID: $CF_LOOP)"

# Attraper Ctrl+C pour tout arrêter proprement
trap "echo 'Arrêt...'; kill $NODE_LOOP $CF_LOOP 2>/dev/null; pkill -f 'cloudflared tunnel'; lsof -ti:3001 | xargs kill -9 2>/dev/null; exit 0" INT TERM

wait $NODE_LOOP $CF_LOOP
