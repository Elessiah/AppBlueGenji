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
`forfeit`, et **aucun score** (`score: null`, la base n'en garde pas) : le
bandeau n'affiche pas un « 0 — 0 » de match joué. Sans vainqueur enregistré, ou vainqueur étranger au match : deux
`none`. Une case vide (exemption, engagé retiré) est `none`, jamais un perdant.
La requête ne retient que les matchs entre **deux engagés** (`is_bye = FALSE`,
`team1_id` et `team2_id` non nuls) : une exemption terminée s'affichait
« Équipe #null 0 — Équipe B 1 ».
Aucune donnée nouvelle n'est collectée : trois colonnes déjà publiques (le
vainqueur d'un match se voit sur la fiche du tournoi) rejoignent la requête.

Noms : forme affichable (`visibleText`, `UNTRUSTED_NAMES.md`), repli
« Équipe #id » / « Team #id » quand la ligne a disparu ou que le nom ne garde
rien. Une entrée solo garde son nom d'engagé (le pseudo), comme avant. Le
bandeau ne porte aucun lien (inchangé).

## Rendu (`Ticker.tsx`, `Ticker.module.css`)

| Issue | Teinte (jeton) | Repère hors couleur | Texte masqué |
| --- | --- | --- | --- |
| Vainqueur | `--teal-400` (néon de réussite) | gras 700, « ▲ » | « (vainqueur) » / « (winner) » |
| Perdant | `--result-loss-ink` (encre réservée à la défaite, `DESIGN_SYSTEM.md` § Défaite) | « ▼ » | « (perdant) » / « (loser) » |
| Forfait | encre du bandeau (`--ink`) — un forfait n'est pas une défaite | le mot « (forfait) » / « (forfeit) » **affiché** après le nom | — (le mot visible suffit) |
| Nul | `--ink` pour les deux | — | « (sans vainqueur) » en fin d'entrée |

- Le mot « forfait » se voit : sans teinte ni repère, un forfait se lirait
  sinon comme une défaite ordinaire.
- Score : `<b class="score">`, 13 px, graisse 800 (le texte du bandeau est à
  11 px, plancher typographique).
- Champion connu : même habillage que le vainqueur ; « Champion inconnu »
  reste en texte simple.
- **Jamais d'ambre** : il ne dit qu'un avertissement (`admin-bright-ui.test.ts`).
  Le forfait, ambré ailleurs (`MatchRow`), reste ici neutre.
- Contraste (fond le plus défavorable, `--cyber-bg-3` seul ; le bandeau pose
  en réalité un noir à 50 % sur la page, ≈ `#030305`) : `--teal-400` 11,10:1
  (13,12:1), `--result-loss-ink` 5,91:1 (6,99:1), 7,06:1 en contraste renforcé
  (`#ff7a9b`), `--ink` 15,67:1.
- Les repères « ▲ » / « ▼ » sont `aria-hidden` : l'issue passe par le texte
  masqué (`.sr-only`), dans la seule copie lue de la piste (la seconde est
  `aria-hidden`). En couleurs forcées, la graisse et les repères demeurent.
- Animation inchangée : `animation-play-state: var(--deco-anim-state)`, pause
  au survol et au bouton, réglage « Réduire les animations »
  (`ACCESSIBILITY_MENU.md`). Le bandeau n'a aucune boucle JS (pas de
  `useClientPower()` à lire).

## API

`GET /api/landing/ticker` renvoie les mêmes entrées : `items` mêle désormais
chaînes et objets. Aucun client du site ni du bot ne lit cette route.

## Tests

- `tests/lib/shared/ticker-items.test.ts` — issue de chaque camp (tranché,
  forfait, double forfait, nul, case vide), texte brut d'une entrée ;
- `tests/lib/server/landing-ticker-results.test.ts` — requête, issue et mots
  masqués FR / EN, nom affichable et repli, champions ;
- `tests/lib/server/landing-ticker-i18n.test.ts` — phrases visibles
  inchangées dans les deux langues ;
- `tests/app/ticker.test.tsx` — rendu par issue, ordre visible, textes
  masqués FR / EN, feuille : jetons, aucun ambre, contraste ≥ 4,5:1, score
  plus grand, animation sous `--deco-anim-state`.
