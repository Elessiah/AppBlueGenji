#!/usr/bin/env bash
#
# Démarre le serveur de production. Rien d'autre.
#
# Ce fichier lançait auparavant, dans cet ordre :
#
#     git pull; npm run build; npm run test; npm run seed; next start
#
# Quatre gestes qui n'ont pas leur place dans un démarrage, et un qui est
# dangereux :
#
#   - `npm run seed` **écrit dans la base de l'environnement courant**. Sur la
#     production, il y aurait créé la matrice de test — une centaine d'équipes
#     de remplissage et des dizaines de tournois — dans la base que le site
#     sert. Il ne l'a jamais fait, par deux accidents (`dotenv/config` ne lit
#     que `.env`, absent du serveur) et depuis peu par un refus explicite sur
#     `NODE_ENV=production` ; aucun des trois n'est une raison de le garder ici.
#   - `git pull` faisait changer la version servie à chaque redémarrage, y
#     compris un redémarrage que personne n'a demandé (reboot, `pm2 resurrect`).
#     Ce qui tourne doit être décidé par un déploiement, pas par un démarrage.
#   - `npm run test` mettait la disponibilité du site à la merci d'un test
#     instable.
#   - `next start` n'est pas dans le `PATH` ; la ligne n'aurait pas abouti.
#
# En pratique pm2 ne passe pas par ici — il lance le binaire de Next
# directement — donc ce fichier ne se déclenchait que sur un `npm start` tapé à
# la main. C'est exactement ce qui le rendait dangereux : un piège qu'on ne
# rencontre qu'un jour de fatigue.
#
# Le déploiement, lui, vit dans `update.sh`.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"

# `exec` : le serveur remplace ce shell, donc il reçoit directement les signaux
# d'arrêt de pm2 au lieu de les voir mourir dans un processus intermédiaire.
exec ./node_modules/.bin/next start -H "$HOST" -p "$PORT"
