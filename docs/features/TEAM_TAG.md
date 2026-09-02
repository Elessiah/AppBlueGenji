# Sigle d'équipe (« trigramme »)

Le sigle est le nom court d'une équipe : **2 à 4 caractères alphanumériques**,
en majuscules, **unique sur tout le site**.

Il existait déjà à l'écran, mais n'appartenait à personne : les cartes de
`/equipes` affichaient les trois premières lettres du nom
(`team.name.slice(0, 3)`). Deux équipes dont le nom commence pareil portaient
donc le même « trigramme », et aucune ne pouvait choisir le sien. Il devient ici
une donnée saisie — `bg_teams.tag` — avec un espace de noms partagé.

## Les décisions, et pourquoi

| Question | Décision |
| --- | --- |
| Longueur | **2 à 4** caractères. |
| Jeu de caractères | `A-Z` et `0-9` uniquement — ni espace, ni ponctuation, ni accent. |
| Casse | Normalisée en **majuscules** à la saisie ; l'unicité est donc insensible à la casse. |
| Obligatoire ? | **Non.** `NULL` = pas de sigle, l'affichage retombe sur les initiales du nom. |
| Équipes fantômes | **Dans** l'espace de noms. |
| Entrées solo | **Hors** de l'espace de noms. |

**Borne basse à 2, et non 3.** Un sigle d'un seul caractère ne distingue plus
rien — 36 valeurs pour tout le site — et redit l'initiale que l'emblème de la
carte affiche déjà. Le nom d'équipe, lui, commence à 3 caractères
(`GHOST_TEAM_NAME_MIN`) : le sigle est plus court que le nom par nature, d'où 2.

**Facultatif, et pas par tiédeur.** Toutes les équipes existantes ont été créées
sans sigle. L'exiger rendrait leur fiche inéditable — on ne pourrait plus
corriger une description sans inventer un sigle au passage — et il faudrait en
générer un pour chacune, c'est-à-dire nommer les équipes à leur place. À défaut
de sigle, `displayTeamTag` rend les initiales du nom : l'affichage d'avant la
fonctionnalité, à l'identique.

**Les fantômes en sont, les entrées solo n'en sont pas.** Une équipe fantôme
(`bg_teams.is_ghost`) s'inscrit aux tournois et s'affiche dans les plateaux au
même titre qu'une équipe réelle : deux sigles identiques s'y confondraient, elle
partage donc l'espace de noms. Une **entrée solo** (`bg_teams.solo_user_id`)
n'est pas une équipe mais un joueur — son identité publique est son profil, elle
n'a ni fiche ni carte d'annuaire. Elle ne se voit jamais attribuer de sigle, et
c'est le `NULL` qui l'en tient à l'écart : aucune règle de plus à écrire, et
MySQL n'oppose pas l'unicité à des `NULL`.

## Où vit la règle

| Fichier | Rôle |
| --- | --- |
| `lib/shared/team-tag.ts` | **Module pur.** Bornes, normalisation, validation, messages français, affichage de repli. Partagé client / serveur. |
| `lib/server/team-tags.ts` | Unicité côté serveur : `SELECT` préalable, traduction de la violation d'index. |
| `lib/server/database.ts` | Colonne `bg_teams.tag` + index unique `uniq_bg_teams_tag`. |
| `lib/server/teams-service.ts` | `createTeam`, `updateTeamMeta`, lecture (`listTeams`, `getTeamDetail`). |
| `lib/server/ghost-teams-service.ts` | `createGhostTeam` — même règle, même espace de noms. |
| `app/api/teams/route.ts` · `app/api/teams/[id]/route.ts` | Codes HTTP. |

Le module pur est l'**unique** implémentation : le formulaire borne ses champs
avec les mêmes constantes que celles qui refusent la requête côté serveur, et le
message affiché est le même texte des deux côtés.

## Les deux contrôles d'unicité, qui ne font pas double emploi

`assertTeamTagAvailable` fait un `SELECT` avant d'écrire : c'est lui qui donne le
refus lisible dans le cas courant. Mais deux créations simultanées passent toutes
deux ce `SELECT` avant que l'une n'ait inséré : le seul juge est alors l'index
unique, et c'est l'`INSERT` de la seconde qui échoue. D'où `mapTeamTagConflict`,
qui enveloppe chaque écriture et traduit `ER_DUP_ENTRY` en
`TEAM_TAG_ALREADY_USED` — le même code que le contrôle préalable, pour que la
course et le cas courant se répondent pareil.

La traduction regarde le **nom de l'index**. `bg_teams` porte deux uniques (le
nom, le sigle) ; sans cette distinction, la route retombait sur son repli
historique et annonçait « nom déjà utilisé » à qui venait de saisir un sigle
pris — envoyant corriger le mauvais champ.

## Codes d'erreur

| Code | HTTP | Sens |
| --- | --- | --- |
| `TEAM_TAG_TOO_SHORT` | 400 | Moins de 2 caractères. |
| `TEAM_TAG_TOO_LONG` | 400 | Plus de 4 caractères. |
| `TEAM_TAG_NOT_ALPHANUMERIC` | 400 | Espace, ponctuation, accent… |
| `TEAM_TAG_ALREADY_USED` | 409 | Sigle déjà porté par une autre équipe. |

Trois refus de forme plutôt qu'un `INVALID_TEAM_TAG` unique : le message doit
dire *quoi* corriger. `teamTagErrorMessage` les rend en français, en **toast**
(`useToast()`), jamais en texte inline — règle universelle du projet.

L'ordre des contrôles n'est pas indifférent : le jeu de caractères passe avant la
longueur. Une saisie comme « BG ESPORT » est d'abord fautive par son espace ;
annoncer « trop long » enverrait raccourcir un sigle qu'il faut d'abord
débarrasser de son espace.

## Migration sur une base déjà peuplée

Trois étapes, chacune sans effet sur une base déjà à jour :

1. `ADD COLUMN tag VARCHAR(4) NULL` — toutes les équipes existantes se
   retrouvent sans sigle, et l'unicité MySQL ignorant les `NULL`, aucune ne
   entre en conflit avec une autre ;
2. **mise en forme et libération des doublons** — les valeurs sont passées en
   majuscules, puis, pour chaque sigle porté plusieurs fois, il est conservé à la
   **plus ancienne** des équipes (`MIN(id)`) et effacé chez les autres ;
3. `ADD UNIQUE INDEX uniq_bg_teams_tag (tag)`.

L'étape 2 ne sert à rien sur une base qui n'a jamais eu la colonne — c'est le cas
nominal. Elle existe pour la base qui l'aurait reçue par une version
intermédiaire, remplie sans contrainte : sans elle, la création de l'index
échouerait, l'unicité ne serait jamais posée, et rien ne le dirait.

Une équipe qui perd son sigle retombe sur ses initiales et pourra en choisir un
autre. **Effacer plutôt qu'inventer un suffixe** : un sigle est un nom, il se
choisit ; « DRA2 » attribué dans le dos d'une équipe serait une donnée fausse.

La colonne garde la collation par défaut d'`utf8mb4`, insensible à la casse :
« bg » et « BG » se heurtent à l'index. C'est une ceinture — le service normalise
en majuscules avant d'écrire.

## Affichage

`displayTeamTag(tag, name)` est le seul point d'entrée d'affichage : le sigle
s'il existe, les initiales du nom sinon (jamais stockées, donc non tenues par les
bornes ci-dessus ; seuls les caractères qui ne sont ni lettre ni chiffre sont
écartés, pour lire « LÉQ » et non « L'É »).

`TeamSigil` (`components/cyber/`) porte désormais un `label` et non une `letter` :
la case est carrée et de taille fixe, c'est le texte qui s'y adapte — sa taille
de police est calculée d'après la longueur, sans quoi un sigle de quatre
caractères débordait du cadre de 24 px.

Le sigle entre aussi dans la recherche de `/equipes` : on cherche une équipe par
« BG » comme par son nom complet.

## Jeu de test

`npm run seed` attribue un sigle à chaque équipe — écrits à la main pour les
équipes nommées (`DRGN`, `PHNX`, …), une équipe volontairement **sans** sigle
pour couvrir l'affichage de repli, un sigle **numérique** (`ST01`) pour couvrir
le jeu de caractères, et `bulkTeamTag(i)` (`lib/server/seed-cases.ts`) pour les
~140 équipes de remplissage : « B » suivi du rang en base 36 sur trois
caractères. Deux rangs distincts ne peuvent pas produire la même chaîne — sans
quoi l'index unique ferait échouer le seed à la première collision.
