# Logos des engagés dans les tournois

## Le problème

Le logo d'une équipe voyageait déjà jusqu'à la fiche d'un tournoi — la liste des
inscrites le porte (`TournamentSnapshot.registrations[].logoUrl`, filtré par
`localUploadUrl` à la sortie) — mais aucune vue ne le rendait. Les cartes de
match, l'arbre, les classements (Survie, Ronde suisse, BG Survie, phases),
l'aperçu du plateau et la liste des inscrites ne montraient que des noms.

Même panne muette sur l'accueil : le classement recevait `logoUrl` depuis
`/api/landing/leaderboard` et ne dessinait que l'initiale ; la carte du match en
direct n'avait pas le logo du tout.

## La règle

**Une table, posée dans le contexte de la page.** Plutôt qu'une colonne de logo
ajoutée à chaque forme de ligne (match, classement suisse, survie, endurance,
phase, aperçu…), la page construit une seule table `team_id → logo` depuis les
inscrites (`buildEntrantLogoMap`, `lib/shared/entrant-logos.ts`) et la pose dans
`EntrantProvider` (`_lib/entrant-link.tsx`). Un engagé affiché n'importe où dans
le plateau est forcément inscrit, et un logo changé se voit partout au même
instantané du flux SSE. Aucun changement de l'instantané ni du serveur.

**Un passage unique pour le rendu.** `EntrantName`
(`_components/EntrantName.tsx`) rend l'emblème puis le nom cliquable
(`EntrantLink`). Les vues ne connaissent plus `EntrantLink` directement :

| Vue | Taille |
| --- | --- |
| `MatchRow` (arbre, survie, suisse, BG Survie — donc tous les plateaux) | 16 px |
| Classements Survie / Suisse / BG Survie / phases, tableau manche par manche | 16 px |
| Liste des inscrites, aperçu du plateau, journal des sanctions | 16 px |
| Bandeau de la championne | 20 px |
| Panneau des contacts, dialogue de score, dialogue des fantômes | 20 px |

Pour une équipe **pas encore inscrite** (dialogue d'inscription des fantômes),
`EntrantLogo` prend un `logoUrl` explicite : la table du contexte ne porte que
les inscrites.

## Ce qui ne casse pas l'interface

- **Hauteur des cartes inchangée** : l'emblème de 16 px tient dans la ligne de
  texte de 13 px, si bien qu'une ligne de match reste à 26,8 px — les
  connecteurs de l'arbre, calés sur des emplacements fixes, ne bougent pas.
- **Alignement** : une case vide (TBD, exemption) réserve la place de l'emblème
  sans rien dessiner, pour que les deux noms d'une carte commencent au même
  endroit.
- **Troncature** : le conteneur est un `inline-flex` au `min-width: 0` ;
  l'emblème garde sa taille (`flex: 0 0`), c'est le nom qui cède, et l'ellipse
  (`truncate`) reste possible — un lien portant lui-même l'image ne le
  permettrait pas.
- **Jamais rogné** : un logo en bannière ou en portrait tient entier dans sa case
  (`object-fit: contain`), posé hors du flux pour ne pas l'élargir.

## Repli et accessibilité

Sans logo, l'emblème montre l'**initiale** du nom (`avatarInitial`), jamais un
fichier de repli — une image absente du dépôt rendrait un 404 pour chaque engagé
sans logo. L'emblème est **toujours décoratif** (`aria-hidden`, `alt=""`) : il
redit le nom écrit juste à côté.

Une entrée solo porte comme logo la **copie d'avatar** de son joueur, qui
respecte déjà son réglage de visibilité (`visibleAvatarUrl`) : rien de plus à
filtrer ici.

## Accueil

`TeamSigil` accepte un `logoUrl` facultatif qui remplace le texte dans le même
cadre (taille et couleur inchangées) ; `label` reste le repli. Branché sur le
classement et sur la carte du match en direct, dont la charge utile gagne
`team1LogoUrl` / `team2LogoUrl` — filtrés par `localUploadUrl` côté serveur, la
vitrine étant lue sans compte.

## Hors champ

Les fiches d'équipe et de joueur (adversaire favori, bête noire, historique) : ces
écrans ne reçoivent qu'un identifiant et un nom, et y ajouter le logo demande de
toucher aux requêtes des statistiques.
