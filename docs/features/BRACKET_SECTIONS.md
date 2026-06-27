# 🪜 Arbre de tournoi — Sections repliables

## Objectif

Sur les gros brackets, l'arbre affiché d'un seul bloc obligeait à beaucoup scroller
(horizontalement entre les rounds, verticalement entre les matchs) pour retrouver
son match. L'arbre est désormais découpé en **volets repliables**, un par stade,
avec un repère de qualification en fin de chaque section et un défilement
automatique vers le match du joueur connecté.

Composants concernés :
- `app/(secured)/tournois/[id]/_lib/bracket-sections.ts` — logique pure de découpage (testée).
- `app/(secured)/tournois/[id]/_components/BracketSections.tsx` — volets repliables, état ouvert/fermé, défilement.
- `app/(secured)/tournois/[id]/_components/BracketTree.tsx` — rend une section (un ou plusieurs rounds) + colonne de badges « Qualifié en X ».

## 📐 Découpage en sections

Pour rester **dense et lisible** (idéalement ~3 colonnes par volet, jamais un stade
isolé ni un volet géant) :

- **« Phase finale »** = les **3 derniers tours** (quart, demi, finale), regroupés.
- Les tours précédents sont scindés en **paquets d'au plus 4 colonnes** (constante
  `MAX_CHUNK_ROUNDS`), répartis en tailles ~égales. Indispensable pour le **tableau des
  perdants**, bien plus long que le principal (12 tours pour 128 équipes).

Exemples :

| Tableau | Volets |
| --- | --- |
| Principal 128 éq. (7 tours) | `Premiers tours` (64es…8es) · `Phase finale` |
| **Perdants 128 éq. (12 tours)** | `Tours 1 à 3` · `Tours 4 à 6` · `Tours 7 à 9` · `Phase finale` |
| Principal 64 éq. (6 tours) | `Premiers tours` (32es…8es) · `Phase finale` |
| 16 éq. (4 tours) | `8èmes de finale` (1 tour) · `Phase finale` |
| 8 éq. (3 tours) | `Phase finale` (quart, demi, finale) |
| 4 éq. (2 tours) | `Phase finale` (demi, finale) |

- Un volet d'**un seul tour** est nommé d'après son stade (`8èmes de finale`, `Finale`).
- Un **paquet unique** de premiers tours s'appelle « Premiers tours » ; **plusieurs**
  paquets s'appellent « Tours A à B ».
- Le badge entre deux paquets de premiers tours affiche « Qualifié au tour suivant ».
- `GRAND` / `THIRD_PLACE` (un seul match) → une seule section.

## 🏁 Repère « Qualifié en X »

Pour ne pas « perdre » le joueur au bord d'un volet, le dernier round des « Premiers
tours » ne trace pas de connecteur vers le volet suivant : chaque match gagnant
pointe (`↳`) vers son propre badge indiquant le **premier stade de la phase finale**,
ex. **« Qualifié en quart de finale »** (les vainqueurs des 8èmes rejoignent les
quarts). Le badge est **cliquable** : il ouvre le volet « Phase finale » et y fait
défiler jusqu'au match d'arrivée (`nextWinnerMatchId`). Le trait et le badge sont
recadrés sur le **centre vertical de la carte** (et non du créneau). Le volet final
n'a pas de badge.

## 👁️ État par défaut & défilement

- À l'ouverture, **tous les volets sont fermés sauf un** : celui du prochain match
  non terminé du joueur (`team1Id`/`team2Id` = son équipe, sans vainqueur) ; à défaut
  le round actif (premier match non `COMPLETED`) ; à défaut la finale.
- Si le joueur est participant, la page **défile automatiquement** (centrage page +
  scroll horizontal interne) jusqu'à son match, mis en évidence (anneau coloré +
  label « ★ Votre match »). Ce défilement initial ne se déclenche **qu'une fois** au
  montage, pour ne pas perturber la lecture lors des mises à jour live.
- Un **clic sur un badge « Qualifié en X »** déclenche un défilement à la demande
  (mécanisme `ScrollRequest { matchId, nonce }`) vers le match d'arrivée, après avoir
  ouvert le volet qui le contient.

## 🎨 Distinction des tableaux

Une couleur d'accent par tableau permet de distinguer principal et perdants d'un
coup d'œil (bordure gauche du volet, label du tableau, badges de qualification) :

| Tableau | Accent |
| --- | --- |
| `UPPER` (principal) | bleu glacier (`--blue-500`) |
| `LOWER` (perdants) | ambre (`--amber`) |
| `GRAND` (grande finale) | bleu clair (`--blue-300`) |
| `THIRD_PLACE` (petite finale) | gris (`--ink-mute`) |
