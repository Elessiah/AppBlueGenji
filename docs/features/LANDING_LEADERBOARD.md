# Classement de l'accueil (`Leaderboard`)

`components/cyber/landing/Leaderboard.tsx` rend le bloc « Top équipes » de la
section « Classement et calendrier », avec ses filtres Général / Overwatch /
Marvel Rivals. Corrections apportées à un audit UI/UX antérieur
(`ERREUR.txt`).

## Ce qui a été corrigé

| Avant | Après |
| --- | --- |
| « Voir le classement complet » menait à `/joueurs`, alors que le tableau classe des **équipes**. | Le lien mène à `/equipes`. |
| Une requête de filtre en échec laissait la pastille du nouveau jeu allumée sur les lignes de l'ancien filtre, sans message ; aucun état de chargement ; l'effet refaisait au montage la requête « all » qu'`initialRows` couvre déjà. | La pastille ne change qu'au succès — un échec la ramène au dernier filtre chargé et affiche un toast d'erreur (`useToast`) ; le premier rendu ne refait pas la requête de `initialRows` ; le tableau porte `aria-busy` pendant le chargement. |
| Un classement vide n'affichait qu'un en-tête sans rangée. | Une phrase « Aucune équipe classée pour le moment. » remplace le corps du tableau. |
| « Top équipes » / « Prochains événements » (`CalendarCard`) étaient des `<span>`, sans niveau de titre ; le titre de l'appel final (`JoinCTA`, « Ton équipe. Notre bracket. ») était un `h3` qui se rattachait à la section Partenaires faute de `h2` propre. | `h3` pour les deux cartes de la section « Classement et calendrier » (sous son `h2`), `h2` pour l'appel final, qui a sa propre section (RGAA 9.1). |
| Le classement était une grille de `<div>` : en-têtes « V–D / PTS / TR » non associés aux cellules aux technologies d'assistance, « TR » non expliqué. | Rôles ARIA de tableau (`role="table"/"row"/"columnheader"/"cell"`) posés sur la même grille CSS, sans toucher à la mise en page ; la colonne « TR » porte `aria-label="Tendance"` (RGAA 5). |
| Les filtres Général / Overwatch / Marvel Rivals n'exposaient pas leur état sélectionné autrement que par la couleur. | `aria-pressed` sur chaque bouton (WCAG 1.4.1 / 4.1.2). |
| « Voir le classement complet » et « ICS → » (`CalendarCard`) mesuraient 236×14 px et 49×14 px : sous les 24 px minimum. | Zone cliquable élargie par `padding` compensé d'une `margin` négative égale, sans agrandir le texte visible (WCAG 2.5.8). |
| Cliquer « Overwatch » ou « Marvel Rivals » n'a jamais rien filtré : `GET /api/landing/leaderboard?game=…` lisait le paramètre, l'ignorait (`console.warn`) et rendait toujours le classement général. | Le filtre est câblé jusqu'au rejeu (`TeamRankingOptions.game`, voir `docs/features/ELO_RANKING.md`) : la route traduit `ow`/`mr` en `OW`/`MR`, la landing rejoue les deux photos (courante et de référence) sur la seule assiette de ce jeu. |

## Règles

- Le dernier filtre **chargé avec succès** est gardé dans une ref
  (`lastLoadedGame`) : un échec y revient plutôt que de laisser l'état visuel
  (la pastille) mentir sur les données affichées. Le retour à ce filtre ne
  redéclenche pas de requête, puisque `rows` porte déjà ses données.
- Le premier rendu ne relance jamais la requête « all » : `initialRows` la
  couvre déjà (rendue côté serveur).
- Les rôles ARIA de tableau s'ajoutent à la grille CSS existante plutôt que de
  la remplacer par un `<table>` : la mise en page (`display: grid` sur
  `.tableHead`/`.row`) ne change pas.
