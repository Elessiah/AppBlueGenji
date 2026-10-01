# Tap Selection

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Sélection de texte au toucher** (`app/globals.css`) : boutons, libellés, `summary` et rôles `button`/`tab`/`switch`/`option`/`menuitem` ne se sélectionnent pas et portent `touch-action: manipulation` — sur mobile, appuyer plusieurs fois sur « + » dans la modale de score sélectionnait le texte alentour. Règle posée sur l'élément, donc acquise pour tout contrôle futur ; champs de saisie rétablis en `user-select: text` (iOS bloque sinon l'édition sous un ancêtre non sélectionnable). Un groupe de boutons qu'on tape en rafale (pavé de score, flèches de réordonnancement, défilement de bannière) porte en plus **`data-tap-zone`**, qui étend le blocage à son texte voisin. Balayage : `tests/app/tap-selection.test.ts`.
