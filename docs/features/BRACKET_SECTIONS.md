# 🪜 Arbre de tournoi — Sections repliables

## Objectif

Sur les gros brackets, l'arbre affiché d'un seul bloc obligeait à beaucoup scroller
(horizontalement entre les rounds, verticalement entre les matchs) pour retrouver
son match. L'arbre est désormais découpé en **volets repliables**, un par stade,
avec un repère de qualification en fin de chaque section et un défilement
automatique vers le match du joueur connecté.

Composants concernés :
- `app/(secured)/tournois/[id]/_components/BracketSections.tsx` — découpe en volets + état ouvert/fermé.
- `app/(secured)/tournois/[id]/_components/BracketTree.tsx` — rend une section (un ou plusieurs rounds) + colonne de badges « Qualifié en X ».

## 📐 Découpage en sections

Pour chaque tableau (`UPPER`, `LOWER`, `GRAND`, `THIRD_PLACE`), les rounds sont
regroupés en sections nommées à partir de la **fin** du tableau :

| Distance depuis la finale | Stade |
| --- | --- |
| 0 | `Finale` (`Finale perdants` pour le tableau des perdants) |
| 1 | `Demi-finales` |
| 2 | `Quarts de finale` |
| 3 | `8èmes de finale` |
| ≥ 4 | `Premiers tours` (tous regroupés dans **un seul** volet) |

- Tous les tours antérieurs aux 8èmes sont fusionnés dans le volet **« Premiers tours »**.
- Chaque stade final (8èmes, quarts, demi, finale) occupe **son propre volet**, donc
  les 8èmes de finale sont toujours isolés dès qu'il y a des tours avant eux.
- Les petits brackets génèrent simplement moins de sections.
- `GRAND` / `THIRD_PLACE` (un seul match) → une seule section.

## 🏁 Repère « Qualifié en X »

Pour ne pas « perdre » le joueur au bord d'une section, le dernier round d'un volet
ne trace pas de connecteur vers le volet suivant : chaque match gagnant pointe (`↳`)
vers son propre badge indiquant le stade suivant, ex. **« Qualifié en 8ème de finale »**.
Le libellé est dérivé du nom de la section suivante. La dernière section (finale)
n'a pas de badge.

## 👁️ État par défaut & défilement

- À l'ouverture, **tous les volets sont fermés sauf un** : celui du prochain match
  non terminé du joueur (`team1Id`/`team2Id` = son équipe, sans vainqueur) ; à défaut
  le round actif (premier match non `COMPLETED`) ; à défaut la finale.
- Si le joueur est participant, la page **défile automatiquement** (centrage page +
  scroll horizontal interne) jusqu'à son match, mis en évidence (anneau coloré +
  label « ★ Votre match »). Le défilement ne se déclenche **qu'une fois** au montage,
  pour ne pas perturber la lecture lors des mises à jour live.

## 🎨 Distinction des tableaux

Une couleur d'accent par tableau permet de distinguer principal et perdants d'un
coup d'œil (bordure gauche du volet, label du tableau, badges de qualification) :

| Tableau | Accent |
| --- | --- |
| `UPPER` (principal) | bleu glacier (`--blue-500`) |
| `LOWER` (perdants) | ambre (`--amber`) |
| `GRAND` (grande finale) | bleu clair (`--blue-300`) |
| `THIRD_PLACE` (petite finale) | gris (`--ink-mute`) |
