# Suppression d'un compte

> **On efface ce qui ne laisse rien, on anonymise le reste.**
> `lib/shared/account-deletion.ts` (pur) + `deleteOwnAccount`
> (`lib/server/users-service.ts`).

## Le manque

La suppression n'avait qu'un seul geste : **anonymiser**. Le pseudo devient
`compte_supprime_<id>`, les identités (`google_sub`, `discord_id`,
`blizzard_sub`), les coordonnées de jeu et la certification partent, la ligne
reste avec `is_deleted = 1`.

C'est la bonne réponse pour un joueur qui a **joué**. Ses matchs, son palmarès
et le bilan de ses équipes se lisent sur des lignes qui le référencent : le
classement du site se rejoue depuis `bg_matches`, une équipe perdrait des
adversaires, une manche perdrait un engagé. L'effacer réécrirait l'histoire de
gens qui ne l'ont pas demandé.

Ce n'était pas la bonne réponse pour un compte **qui n'a rien laissé**. Un joueur
inscrit un soir, jamais engagé nulle part, repartait en laissant à l'annuaire une
ligne « compte_supprime_412 » pour toujours : rien à préserver, et une trace de
son passage qu'il venait précisément de demander d'effacer. Sur `/joueurs`, ces
lignes s'accumulaient en fin de liste — l'ordre est `is_deleted ASC, pseudo ASC` —
et comptaient dans « Profils référencés ».

## La règle

Un seul critère : **reste-t-il quelque chose qui référence ce compte et qui doit
survivre ?** Trois traces le disent, et aucune n'est décorative.

| Trace | Pourquoi elle retient la ligne |
| --- | --- |
| `tournaments` | Il a été **engagé** — par une équipe inscrite, ou par une entrée solo. C'est la trace qui porte des matchs, donc un classement, donc des points chez les autres. |
| `organizedTournaments` | Il a **créé** un tournoi. `bg_tournaments.organizer_user_id` est `NOT NULL` en `ON DELETE RESTRICT` : la base refuserait l'effacement, et un tournoi sans organisateur n'aurait plus de titulaire. |
| `ownedTeams` | Il est `OWNER` d'une équipe vivante. `bg_team_members` s'efface en cascade : l'effacer laisserait une équipe que personne ne peut plus renommer, dissoudre ni engager. |

Les deux dernières ne figuraient pas dans la demande et ne l'élargissent pas :
ce sont les cas où « effacer complètement » ne veut rien dire — la base refuse,
ou casse quelque chose d'autre.

La décision est **conservatrice** : dans le doute on anonymise, parce que les
deux erreurs ne se valent pas. Anonymiser à tort laisse une ligne de plus à
l'annuaire ; effacer à tort détruit ce que d'autres lisent, et rien ne le défait.

## L'effacement

Les cascades déjà déclarées font l'essentiel — sessions (`bg_user_sessions`),
appartenances (`bg_team_members`), invitations (`bg_team_invitations`, des deux
côtés) — et `bg_endurance_penalties.created_by` passe à `NULL`, la sanction
restant due.

Deux choses demandent un geste, parce qu'aucune clé étrangère ne les couvre.

**`bg_site_visits`** n'en a aucune — une cascade y effacerait l'historique de
fréquentation. Le lien est donc détaché plutôt que la ligne supprimée
(`SET user_id = NULL`) : ce qu'il faut retirer est le lien vers une personne, pas
le fait qu'une page ait été vue. Et **avant** l'effacement du compte, faute de
quoi la ligne ne serait plus retrouvable par `user_id`.

**Le fichier de l'avatar** ne vit pas en base : `avatar_url` ne fait que le
désigner. Or les photos des fournisseurs OAuth sont **copiées** chez nous à la
connexion (`lib/server/user-avatar-import.ts`), si bien que presque tout compte
effaçable — inscrit, jamais engagé — en possède un sous
`public/uploads/avatars/`. La ligne partie, son chemin est perdu pour toujours
et l'image reste servie par `/api/uploads/avatars/…` : une donnée personnelle
publique que plus rien ne désigne, exactement le contraire de ce que la phrase
de succès promet. Le chemin est donc relevé **avant** l'écriture et le fichier
supprimé **après le commit** — un `unlink` ne se défait pas, et une transaction
annulée rendrait un compte vivant sans sa photo. Même geste à l'anonymisation,
qui met `avatar_url` à `NULL` : le fichier n'y survit pas davantage.

L'**entrée solo** compte comme un engagement *par elle-même* : `bg_teams
.solo_user_id` n'a volontairement pas de clé étrangère (une cascade effacerait
l'engagé, et avec lui l'historique des matchs), donc l'effacement du compte la
laisserait pendre sur un identifiant disparu.

Les trois questions sont posées en **une** requête, trois `EXISTS` indexés. Les
poser séparément laisserait un `await` entre elles : un tournoi créé entre la
deuxième et la troisième, et la ligne partirait quand même — sur une base qui la
refuse.

## La transaction, et le verrou

Lecture des traces et écriture vivent dans **une seule transaction**, ouverte par
un verrou sur la ligne du compte (`SELECT … FOR UPDATE`, en **toute première
instruction** : sous `REPEATABLE READ`, c'est la première lecture *ordinaire* qui
fige l'instantané, donc une trace lue avant le verrou daterait d'avant
l'attente).

Elle répond à deux choses distinctes.

D'abord à l'**état intermédiaire** : le détachement des visites et le `DELETE`
étaient deux instructions autocommitées, si bien qu'un `DELETE` refusé (verrou
expiré, `RESTRICT`) laissait un compte bien vivant dont la fréquentation était
anonymisée pour toujours.

Ensuite à la **course**, et c'est là que le verrou sert. La plupart des traces
sont tenues par des clés étrangères : une inscription d'équipe passe par
`bg_team_members`, dont la clé refuserait de pointer vers un compte effacé, et
`organizer_user_id` est en `RESTRICT` — la base tranche toute seule, bruyamment.
Une seule ne l'est pas : **l'entrée solo**. Rien n'empêcherait d'en créer une
pour un compte que la transaction voisine vient d'effacer, et elle pendrait alors
sur un identifiant disparu — tout `JOIN bg_users` la laisserait silencieusement
de côté, nom et logo figés à jamais. `ensureSoloEntry` pose donc **le même
verrou** sur la ligne du compte avant de créer l'entrée : ou bien l'inscription
passe la première et la suppression *voit* l'entrée solo (donc anonymise), ou
bien la suppression passe la première et l'inscription ne trouve plus personne
(`USER_NOT_FOUND`).

## Ce que le joueur lit

La confirmation **décrit ce qui va se passer**. Une phrase unique servait aux deux
cas et promettait la conservation des statistiques à des comptes qui n'en ont
aucune ; le joueur qui n'a jamais joué a droit à la vraie réponse — il ne restera
rien.

Le **mode ne suffit pas** à la rédiger. « Tes statistiques de tournoi resteront
conservées — elles appartiennent aussi aux équipes que tu as affrontées » est
vrai d'un joueur qui a joué, et faux de celui dont la ligne n'est retenue que par
une équipe qu'il possède ou par un tournoi qu'il a organisé : il n'a aucune
statistique et n'a affronté personne. Le plan porte donc le **motif**
(`AccountRetentionReason`), une phrase par motif, et celle du propriétaire
d'équipe nomme **le geste qui lèverait la conservation** — transférer ou
dissoudre l'équipe. Refuser un effacement complet sans dire ce qui l'ouvrirait
serait le plus désagréable des deux refus. Mode et motif sont construits par
`accountDeletionPlan` et par lui seul : calculés séparément, ils pourraient se
contredire dans une même réponse.

`GET /api/profile/deletion` rend le mode sans rien écrire, appelé **sur le chemin
de la suppression** et jamais au chargement du profil : la réponse ne change pas
quand la fiche change, et trois `EXISTS` à chaque visite pour une question que
presque personne ne pose seraient du gaspillage. Ce n'est pas une promesse :
`DELETE /api/profile` repose la question sur son propre instantané et **rend le
plan appliqué**, que le message de succès reprend — le `mode` servant de témoin
de réponse, un motif `null` étant une réponse (« rien ne retient la ligne ») et
non une absence. Un aperçu injoignable retombe
sur la phrase la plus prudente, celle qui promet le moins d'effacement.

Le bouton se ferme **avant** l'aller-retour d'aperçu, et non après la
confirmation : `window.confirm` bloquait à lui seul le second clic tant qu'il
était la première instruction du gestionnaire, mais un `await` posé devant lui
rouvre la fenêtre — deux clics, deux confirmations, deux `DELETE`, dont le second
échoue en 400 et affiche une erreur juste après le succès. Une annulation le
rouvre.

## Les comptes anonymisés à l'annuaire

`/joueurs` les masque **par défaut**, derrière une case à cocher qui les compte
(`Comptes supprimés (3)`), rendue seulement s'il y en a — une `<Coche>`, comme
partout ailleurs sur le site, et non la case par défaut du navigateur. La case n'est pas un
filtre de plus : tout ce que la page montre ou compte descend de la même liste,
sans quoi elle changerait les cartes sans changer les compteurs qui les
surmontent.

Ils ne sont pas **retirés** de la réponse : c'est le seul moyen de retrouver un
adversaire d'un tournoi passé, et la ligne ne porte plus rien de personnel.
`listPlayers` rend donc `isDeleted`, et le filtre est côté client comme les
autres de cet écran.

La carte d'un compte anonymisé est **en retrait** et porte la mention « Compte
supprimé ». Le retrait est posé sur les décorations une par une, jamais sur la
carte entière : `opacity` se multiplie de parent à enfant et aucun enfant ne peut
la défaire, si bien qu'une carte assombrie rendait illisible la mention qui
explique justement pourquoi elle l'est — et le survol qui la relevait n'existe
pas au doigt.

Un bloc y échappe, et pas par exception décorative : **`.plTeam`**, le seul en
retrait qui contienne un lien. `opacity < 1` comme `filter` créent un **contexte
d'empilement**, et le `z-index: 2` d'`.aboveOverlay` — posé pour faire repasser
le nom de l'équipe **au-dessus** de la plaque `.cardOverlay` (`z-index: 1`) — s'y
résoudrait alors *à l'intérieur* de `.plTeam`, qui repasserait entier sous la
plaque. Le nom de l'équipe mènerait à la fiche du joueur, sans qu'aucune règle
ne paraisse en cause. Son retrait se fait donc par la **couleur**, qui ne crée
aucun contexte. Les deux propriétés sont gardées par
`tests/app/deleted-player-card.test.ts` : leurs pannes sont muettes, ni erreur ni
image cassée.

## Ce qui arrive après, et ce qui reste atteignable

Le verrou ferme la transaction, il ne ferme pas ce qui la suit. Deux écritures
du profil étaient **déjà parties** quand la suppression a commencé : elles
attendent le verrou, et reprennent **après** son commit, sur une ligne qu'elles
croient encore vivante. Le téléversement d'un avatar y reposait une photo
personnelle toute neuve, servie à tout le site par `/api/uploads/avatars/…` ; la
sauvegarde du profil y reposait l'identité entière — pseudo réel, BattleTag, tag
Marvel, tag Discord — puis `syncSoloEntryIdentity` la republiait jusque dans les
brackets et sur la carte de match en direct de la vitrine, que lit un visiteur
sans compte.

Le remède est le même des deux côtés, et il tient dans la clause `WHERE` :
`updateUserAvatar` et `updateOwnProfile` écrivent `WHERE id = ? AND
is_deleted = 0`, puis relisent `affectedRows`. Le nombre est lisible parce que
mysql2 pose `FOUND_ROWS` : il compte les lignes **appariées**, pas celles qui ont
changé — zéro ne dit donc pas « rien à modifier » mais « aucune ligne vivante ».
L'avatar rend alors un booléen, que la route traduit en ménage (le fichier est
déjà sur le disque, il faut le reprendre) ; le profil lève `ACCOUNT_DELETED`, que
la route rend en **409** — la saisie était bonne, c'est l'état de la ligne qui a
changé sous elle — et que `accountDeletedWriteMessage` met en français dans la
notification. Ni l'un ni l'autre n'atteint la resynchronisation de l'entrée solo,
qui est la moitié la plus visible du dégât.

Les mêmes secondes séparent le contrôle de l'écriture sur deux chemins plus
lourds, et ceux-là reposent une **porte d'entrée**. `writeVerifiedTag`
(certification du tag Discord) écrit `discord_id`, et `linkOAuthIdentity` écrit
`google_sub`, `discord_id` ou `blizzard_sub` : ce sont exactement les colonnes
par lesquelles `createOrGetDiscordUser` et ses sœurs retrouvent un compte à la
connexion, et que l'anonymisation met à `NULL`. Une certification lancée avant la
suppression — un message privé, une saisie — ou un aller-retour OAuth de
plusieurs secondes reprenait après le commit et rouvrait la porte, tag personnel
certifié compris, republié à l'arbitrage par `canViewDiscordTag`. Les cinq
variantes d'écriture portent donc `AND is_deleted = 0`, comme le **détachement**
d'une identité le faisait déjà, et `loadDiscordRow` filtre lui aussi : leur
`affectedRows = 0` retombe sur `PROFILE_NOT_FOUND`, qui est la vérité.

La plus longue de ces courses n'est pas une écriture de profil mais
`adoptRemoteAvatar` : entre sa lecture de `avatar_url` et son écriture, elle
**télécharge** l'image chez le fournisseur et la retraite. La photo repartait
donc sur la ligne anonymisée, servie publiquement par `/api/uploads/avatars/…`.
La condition ne suffit pas ici : le fichier est sur le disque avant l'écriture,
et sur un compte **effacé** plus aucune ligne ne le désigne — l'écriture refusée
reprend donc ce qu'elle vient de poser, faute de quoi une photo personnelle
orpheline survivait au compte.

Une ligne anonymisée reste par ailleurs **atteignable par son pseudo**
(`compte_supprime_412` est un pseudo comme un autre), et c'est par là qu'on la
rattachait encore à une équipe vivante. `getUserIdByPseudo` — l'unique traduction
« pseudo → compte à rattacher », partagée par l'invitation dans une équipe et par
la reprise d'une fantôme — filtre donc `is_deleted = 0`. Ses deux appelants
traitaient déjà le `null` en `USER_NOT_FOUND`, ce qu'un compte supprimé doit
précisément être pour eux : sans le filtre, une invitation partait vers un compte
qui n'a plus aucun moyen d'ouvrir une session pour l'accepter, une demande
d'adhésion déposée *avant* la suppression le faisait **rejoindre** le roster
séance tenante, et la reprise d'une fantôme en faisait un `OWNER` sans titulaire.
L'autocomplétion d'ajout de membre applique le même écart côté écran
(`!p.isDeleted`), non pour garder le secret mais pour ne pas proposer un nom qui
ne mène qu'à un refus.

Le pseudo n'est cependant pas le seul chemin vers un roster, et c'est le dernier
qui restait ouvert : une **demande d'adhésion** (`kind = 'REQUEST'`) déposée
avant la suppression reste `PENDING` — `bg_team_invitations` n'est purgée que par
la cascade du mode « effacement » — et le gérant de l'équipe la voit comme une
autre. L'accepter passe par `respondToInvitation`, qui travaille sur un
**identifiant**, jamais sur un pseudo : aucun filtre de résolution ne l'atteint,
et le compte supprimé rejoignait le roster séance tenante, réapparaissant sur la
fiche d'équipe et « avec équipe » à l'annuaire. `anonymizeAccount` passe donc en
`CANCELLED`, dans sa transaction, tout ce qui pend au nom du compte — demandes
comme invitations, ces dernières n'ayant plus personne pour les accepter une fois
les sessions et les identités parties. `CANCELLED` plutôt qu'un `DELETE` : la
ligne ne nomme plus personne, et l'équipe garde la trace d'un échange qui a eu
lieu.

## Ce que l'effacement réveille

L'anonymisation n'a jamais fait partir une ligne `bg_users`. L'effacement, lui,
la fait partir — et il réveille du même coup **toutes les cascades** que
personne n'avait vues s'exécuter. Deux d'entre elles demandaient une réponse.

`bg_team_invitations.created_by` était `NOT NULL` en `ON DELETE CASCADE` : un
gérant d'équipe qui n'a jamais joué supprime son compte, et les invitations
qu'il avait envoyées disparaissent de la boîte de trois joueurs sans que
personne ne les ait retirées — alors que la même situation sur un compte à
historique les laisse intactes, puisqu'il est anonymisé. Or une invitation est
l'acte de **l'équipe** (seule sa gestion peut l'émettre), la colonne n'est lue
nulle part, et le projet tranche déjà ce cas ailleurs de la même façon :
`bg_endurance_penalties.created_by` passe à `NULL`, la sanction restant due. La
colonne devient donc nullable et sa clé `ON DELETE SET NULL` — une manœuvre en
trois temps sur une base peuplée (clé retirée, colonne élargie, clé reposée :
une colonne référencée ne change pas de nullabilité tant qu'une contrainte
s'appuie dessus), gardée par une lecture d'`information_schema` sans laquelle
chaque démarrage détruirait et reposerait la clé.

`bg_discord_login_challenges` pose le problème inverse : elle n'a **aucune** clé
étrangère — elle est indexée sur un identifiant Discord, pas sur un compte du
site —, donc rien ne la couvre. Son seul ménage est la purge des lignes expirées
depuis un jour, déclenchée par la demande de code d'un *autre* joueur : un soir
calme, l'identifiant Discord d'un compte effacé reste en base indéfiniment, et
c'est la même coordonnée que le tag. La suppression efface donc ces lignes dans
sa transaction, l'identifiant étant relevé **sous le verrou**, en même temps que
le chemin de l'avatar — une seconde lecture ne le trouverait plus, la ligne
étant partie ou vidée de son `discord_id`.

## La phrase qu'on ne sait pas encore écrire

La confirmation décrit le sort du compte, et elle le demande au serveur
(`GET /api/profile/deletion`). Cette requête peut échouer. L'écran partait alors
d'une hypothèse — celle du joueur qui a joué — et la gardait : « tes informations
personnelles seront effacées (le compte devient anonyme), mais tes statistiques
de tournoi resteront conservées ». Le commentaire disait « la phrase la plus
prudente, celle qui promet le moins d'effacement », et c'est là que le
raisonnement se renverse : le serveur **re-décide** sur son propre instantané et
peut effacer entièrement. Le joueur avait consenti à devenir anonyme.

Le repli n'est donc ni l'une ni l'autre des deux phrases, mais une troisième, qui
ne promet rien : « le site n'a pas pu dire ce qu'il en restera ; selon ce que tu
as laissé, il sera rendu anonyme ou effacé entièrement ». Refuser de confirmer
n'était pas une option — supprimer son compte est un droit, et un aperçu en échec
n'a pas à le suspendre. `RETENTION_UNKNOWN` n'est pas un motif de conservation de
plus : c'est l'absence de réponse, et elle porte le `default` du `switch` — une
valeur inattendue doit mener à la description la plus prudente, pas à la plus
définitive des quatre.

## Quand la base refuse quand même

Les contrôles de clé étrangère lisent la **dernière version commitée**, et non
l'instantané de la transaction : un tournoi créé entre la lecture des traces et
le `DELETE` retient la ligne que les traces disaient libre, et
`fk_bg_tournaments_organizer` (`ON DELETE RESTRICT`) refuse. Le verrou du compte
ne ferme pas ce cas — l'organisateur d'un tournoi n'est pas tenu d'être celui qui
le crée.

Le message brut de MySQL nomme la base, la table et la contrainte, et
`DELETE /api/profile` rend le message de l'erreur : il partirait tel quel dans la
notification du joueur. `isReferencedRowError` (`lib/server/mysql-errors.ts`) le
traduit donc en `ACCOUNT_STILL_REFERENCED`, et `accountDeletionErrorMessage` en
une phrase française qui nomme la suite : **réessayer**, le second passage lisant
la trace neuve et anonymisant. Tout code inconnu retombe sur la phrase générique
— une notification est lue par un joueur, jamais par qui a nommé le code.

## Voir aussi

- `docs/AUTHORIZATION_RULES.md` — qui peut supprimer quoi.
- `docs/features/SOLO_TOURNAMENTS.md` — pourquoi l'entrée solo survit à son joueur.
