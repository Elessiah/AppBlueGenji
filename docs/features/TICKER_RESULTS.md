# Bandeau défilant — résultats habillés par camp

Demande du 2026-10-07 : dans les bandeaux défilants des résultats, l'équipe
**gagnante** d'une couleur, la **perdante** d'une autre, et le **score** plus
visible. Un seul composant, `components/cyber/Ticker.tsx`, sert tous les
bandeaux ; seul celui de l'accueil (`getLandingTicker`) montre des résultats
— ceux de `/tournois`, `/equipes` et `/joueurs` ne portent que des phrases et
ne changent pas.

## Données (`lib/shared/ticker-items.ts`)

Une entrée (`TickerItem`) est une **phrase** (chaîne), un **résultat**
(`kind: "result"`) ou un **champion** (`kind: "champion"`). Les textes
arrivent rédigés dans la langue de la page (`landing.ticker.*`, FR et EN) : le
composant n'en connaît aucun.

- `lead` : « RÉSULTAT · Tournoi · » / « RESULT · Tournament · »
  (`ticker.resultLead`), « VAINQUEUR · Tournoi · » (`ticker.winnerLead`).
- `sides` : les deux camps **dans l'ordre du match**, chacun avec nom, score,
  issue (`win` / `loss` / `forfeit` / `none`) et le mot dit au lecteur
  d'écran (`ticker.srWin` « vainqueur » / « winner », `srLoss` « perdant » /
  « loser », `srForfeit` « forfait » / « forfeit »).
- `sr` : note de fin d'un nul (`ticker.srNoWinner` « sans vainqueur » /
  « no winner »).

L'issue est lue **côté serveur** sur le résultat enregistré
(`tickerOutcomes`) : `winner_team_id`, `forfeit_team_id`, `double_forfeit` de
`bg_matches` — jamais devinée d'après les scores. Double forfait : deux
`forfeit`, et **aucun score** (`score: null`, même si une ancienne ligne garde
un 0-0) : le bandeau n'affiche pas un « 0 — 0 » de match joué. L'issue
est bâtie sur `lib/shared/match-outcome.ts` (double forfait, nul), comme les
fiches. Un **vainqueur enregistré** qui désigne un camp est suivi, comme l'arbre
et le classement : le forfait nominatif ne sert alors qu'à marquer l'*autre*
camp « forfait » plutôt que « perdant » (une ligne incohérente — vainqueur =
camp forfait — se lit comme son vainqueur). Sans vainqueur propre au match, un
forfait nominatif donne la victoire à son adversaire. Un forfait se chiffre au
score plein du format du tournoi (`tickerScores`, `forfeitMapCount` : FT3 →
3-0, saisie libre → 1-0) quand les colonnes sont vides ou à 0-0 (forfaits
antérieurs à la règle) ; un score de forfait déjà écrit, qui suit le format de
sa phase, est gardé tel quel — **différence avec les fiches** : celles-ci
recalculent toujours le score plein du format du tournoi
(`forfeitAwareMapScore`), si bien qu'un forfait de play-offs de BG Survie se lit
2-0 au bandeau et 3-0 sur la fiche. Sans vainqueur enregistré, ou vainqueur
étranger au match : deux `none`. Il n'y a pas de branche « case vide » : la
requête n'amène que des matchs entre deux engagés.
La requête ne retient que les matchs entre **deux engagés** (`is_bye = FALSE`,
`team1_id` et `team2_id` non nuls) : une exemption terminée s'affichait
« Équipe #null 0 — Équipe B 1 ». Elle exige aussi une **issue enregistrée** —
vainqueur, forfait, double forfait, ou nul à scores égaux (comme
`playedMatchSql`) : une ligne close sans rien de cela se serait lue « A 0 — B 0
(sans vainqueur) ». Résultats, inscriptions et champions ne lisent que les
tournois **publiés** (`start_visibility_at <= NOW()`, comme le compteur de
l'accueil) : un tournoi encore masqué n'y montre ni nom, ni engagés, ni score.
Aucune donnée nouvelle n'est collectée : trois colonnes déjà publiques (tournois publiés seulement) et le
format de match du tournoi (le vainqueur d'un match se voit sur la fiche du tournoi) rejoignent la requête.

Noms : forme affichable (`visibleText`, `UNTRUSTED_NAMES.md`), repli
« Équipe #id » / « Team #id » quand la ligne a disparu ou que le nom ne garde
rien. L'issue de chaque camp et les noms nettoyés se calculent **une fois**, au
chargement mis en cache (`loadLandingTicker`) ; la langue ne rédige que les
textes à la sortie (`formatTickerEntry`). Les identifiants de camp passent par
`Number()` comme ceux du vainqueur et du forfait. Un champion dont le nom ne se
lit pas (ligne d'équipe disparue) s'écrit sous le repli en texte simple, sans
mise en valeur. Une entrée solo garde son nom d'engagé (le pseudo), comme avant. Le
bandeau ne porte aucun lien (inchangé).

## Rendu (`Ticker.tsx`, `Ticker.module.css`)

| Issue | Teinte (jeton) | Repère hors couleur | Texte masqué |
| --- | --- | --- | --- |
| Vainqueur | `--teal-400` (néon de réussite) | gras 700, « ✓ » | « (vainqueur) » / « (winner) » |
| Perdant | `--result-loss-ink` (encre réservée à la défaite, `DESIGN_SYSTEM.md` § Défaite) | « ✕ » | « (perdant) » / « (loser) » |
| Forfait | encre du bandeau (`--ink`) — un forfait n'est pas une défaite | le mot « (forfait) » / « (forfeit) » **affiché** après le nom | — (le mot visible suffit) |
| Nul | `--ink` pour les deux | — | « (sans vainqueur) » en fin d'entrée ; **affichée** quand les scores diffèrent (format à égalité permise : 2-1 sans vainqueur) |

- Le mot « forfait » se voit : sans teinte ni repère, un forfait se lirait
  sinon comme une défaite ordinaire.
- Score : `<b class="score">`, 13 px, graisse 800 (le texte du bandeau est à
  11 px, plancher typographique).
- « ✓ » / « ✕ » et non « ▲ » / « ▼ » : ces derniers disent un mouvement de rang
  sur `/classement` et dans les vues d'endurance (« ▼Alpha 2 » se lisait « Alpha
  a perdu 2 places »).
- Champion connu : même habillage que le vainqueur (composant `OutcomeName`
  partagé avec les camps d'un résultat) ; « Champion inconnu »
  reste en texte simple.
- **Jamais d'ambre** : il ne dit qu'un avertissement (`admin-bright-ui.test.ts`).
  Le forfait, ambré ailleurs (`MatchRow`), reste ici neutre.
- Contraste (fond le plus défavorable, `--cyber-bg-3` seul ; le bandeau pose
  en réalité un noir à 50 % sur la page, ≈ `#030305`) : `--teal-400` 11,10:1
  (13,12:1), `--result-loss-ink` 5,91:1 (6,99:1), 7,06:1 en contraste renforcé
  (`#ff7a9b`), `--ink` 15,67:1.
- Les repères « ✓ » / « ✕ » sont `aria-hidden` : l'issue passe par le texte
  masqué (`.sr-only`), rendu dans la seule copie lue de la piste — la seconde,
  `aria-hidden`, ne l'embarque pas (le mot « forfait » et la note d'un nul aux
  scores inégaux, visibles, y restent). Le texte masqué est `user-select: none`
  dans le bandeau : copier une entrée en pause ne colle pas de mots invisibles. En couleurs forcées, la graisse et les repères demeurent.
- Animation inchangée : `animation-play-state: var(--deco-anim-state)`, pause
  au survol et au bouton, réglage « Réduire les animations »
  (`ACCESSIBILITY_MENU.md`). Le bandeau n'a aucune boucle JS (pas de
  `useClientPower()` à lire).

## Base de données

La requête des résultats trie les matchs terminés par `updated_at` : index
`idx_bg_matches_status_updated (status, updated_at)` (schéma + `RECENT_SCHEMA_CHANGES`,
`docs/DATABASE_SCHEMA.md`), pour ne pas lire puis trier tout l'historique terminé
à chaque recalcul du cache.

## API

`GET /api/landing/ticker` renvoie les mêmes entrées : `items` mêle désormais
chaînes et objets. Aucun client du site ni du bot ne lit cette route.

## Tests

- `tests/lib/shared/ticker-items.test.ts` — issue de chaque camp (tranché,
  forfait, double forfait, nul, vainqueur étranger), scores affichés (forfait au score
  plein, double forfait sans score, vainqueur enregistré suivi) ; le texte brut d'une
  entrée (`tickerItemText`) vit dans `tests/helpers/ticker-text.ts` ;
- `tests/lib/server/ticker-index-migration.test.ts` — index `(status, updated_at)` : schéma neuf et bases existantes ;
- `tests/lib/server/landing-ticker-results.test.ts` — requête, issue et mots
  masqués FR / EN, nom affichable et repli, champions ;
- `tests/lib/server/landing-ticker-i18n.test.ts` — phrases visibles
  inchangées dans les deux langues ;
- `tests/app/ticker.test.tsx` — rendu par issue, ordre visible, textes
  masqués FR / EN, feuille : jetons, aucun ambre, contraste ≥ 4,5:1, score
  plus grand, animation sous `--deco-anim-state`.
