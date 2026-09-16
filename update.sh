#!/usr/bin/env bash
#
# Déploie la version courante de `main` sur le serveur.
#
#     ./update.sh
#
# L'ancienne version tenait en quatre lignes sans garde :
#
#     git pull
#     npm install --force
#     npm run build
#     pm2 restart bluegenji
#
# Sans `set -e`, **chaque ligne s'exécutait quoi qu'il arrive** : un `git pull`
# en conflit, une installation partielle ou un build en échec menaient quand
# même au redémarrage — donc à servir un site cassé, ou à ne plus rien servir
# du tout. Et `npm install --force` ne respecte pas `package-lock.json` : deux
# déploiements du même commit pouvaient installer deux arbres différents.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "▸ Récupération du code"
# `--ff-only` : un déploiement n'a rien à fusionner. Si l'avance rapide est
# impossible, quelqu'un a écrit sur le serveur — mieux vaut s'arrêter ici que
# de fabriquer un commit de fusion que personne ne relira.
git pull --ff-only

echo "▸ Dépendances (npm ci — respecte package-lock.json)"
npm ci

echo "▸ Build"
npm run build

echo "▸ Redémarrage"
# `--update-env` : sans lui, pm2 relance le processus avec l'environnement figé
# au premier lancement, et une variable ajoutée à `.env.production` n'arrive
# jamais jusqu'au serveur.
pm2 restart bluegenji --update-env

echo "▸ Contrôle"
sleep 3
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${PORT:-3000}/" || true)"
if [ "$code" = "200" ]; then
  echo "✓ En ligne (HTTP $code)"
else
  echo "✗ Le serveur ne répond pas (HTTP $code) — voir: pm2 logs bluegenji" >&2
  exit 1
fi
