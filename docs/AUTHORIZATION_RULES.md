# Règles fondamentales d'autorisation

Ce document est la **référence unique** de ce qu'un utilisateur peut et ne peut
pas faire sur BlueGenji Esport, selon son identité et ses rôles. Il sert de
grille de lecture à la passe de sécurité (tâche 21 de `TODO.md`) : **toute
divergence entre ce document et le code est un bug**. Là où la formulation du
TODO est plus large que le code, la règle retenue est écrite ici, avec son
motif, dans la section du domaine concerné.

Deux systèmes de rôles **indépendants** cohabitent, et rien ne les mélange :

- les **rôles de plateforme** (`PlatformRole`) — staff du site : `ADMIN`,
  `ARBITRE`, `CASTER`, `COMMUNITY_MANAGER`, `RECRUTEUR` ;
- les **rôles d'équipe** (`TeamRole`) — position dans un roster : `OWNER`,
  `CAPITAINE`, `MANAGER`, `COACH`, `TANK`, `DPS`, `HEAL`.

Un `ADMIN` n'a **aucun** pouvoir sur une équipe dont il n'est pas membre (seule
exception : les équipes fantômes, voir §5). Un `OWNER` d'équipe n'a **aucun**
pouvoir sur la plateforme.

---

## 1. Le socle

### 1.1 Authentification

- L'accès à tout l'espace `/(secured)/*` (`tournois`, `equipes`, `joueurs`,
  `profil`) et à quasiment toutes les routes `/api/*` exige une session.
- Sans session, la garde de `app/(secured)/layout.tsx` **ne redirige pas** :
  elle rend une carte « Connexion requise » en `200`, sans rendre ses enfants —
  aucun contenu protégé n'atteint la réponse.
- Une route API sans session répond `401 UNAUTHORIZED`, jamais 403 : le refus
  d'authentification et le refus de droits ne se confondent pas.
- La destination d'après connexion (`?redirect=`) n'accepte qu'un **chemin du
  site** (`lib/shared/safe-redirect.ts`) : pas de redirection ouverte vers un
  domaine tiers.
- `DEV_AUTH_USER_ID` court-circuite la session **uniquement** si
  `NODE_ENV === "development"`. Jamais en production, en test ni en staging.
- **Le code Discord se compte, et il se compte en base.** Six chiffres ne sont
  un secret que si les essais sont bornés : `bg_discord_login_challenges.attempts`
  existait sans être jamais relu, et rien ne plafonnait
  `/api/auth/discord/verify` — un tiers connaissant le pseudo Discord d'un joueur
  (public sur n'importe quel serveur) pouvait énumérer le million de
  combinaisons jusqu'à ouvrir sa session.

  Deux bornes tiennent désormais le secret, **toutes deux en base** :
  `MAX_DISCORD_CODE_ATTEMPTS` (5 essais par code, après quoi il est **brûlé**,
  correct ou non) et `MAX_DISCORD_CODES_PER_WINDOW` (5 codes par compte et par
  quart d'heure).

  **Les deux se réservent, elles ne se relisent pas.** L'essai tient en une seule
  instruction — `UPDATE … SET attempts = attempts + 1 WHERE id = ? AND
  attempts < ?`, puis `affectedRows` — et non en une lecture suivie d'une
  écriture : séparées par un `await`, dix vérifications lancées de front lisaient
  toutes `attempts = 0` et comparaient toutes une combinaison. L'émission d'un
  code avait exactement la même forme (`SELECT COUNT(*)`, `await`, `INSERT`), sur
  la borne que ce document présente comme *celle qui tient réellement la force
  brute* : comptage et insertion vivent donc sous un **verrou nommé** porté par
  le compte visé (`lib/server/named-lock.ts`), ce qui fait attendre toute demande
  concurrente visant ce même compte — et aucune autre.

  Le remède évident, une transaction à `SELECT … FOR UPDATE`, **ne convient pas
  ici**, et il a fallu une vraie base pour le voir : sur la plage vide d'un
  compte sans ligne, chaque transaction pose un verrou d'intervalle sur la même
  plage puis demande, pour insérer, une intention qui entre en conflit avec celui
  des autres. Douze demandes lancées de front rendaient onze `ER_LOCK_DEADLOCK`
  et **un** code, là où cinq étaient attendus. C'est la raison d'être de la règle
  de travail « valider aussi en conditions réelles » : aucun test à base simulée
  ne pouvait montrer cela.

  Les plafonds de débit (`DISCORD_CODE_VERIFY_RULE`, `DISCORD_CODE_REQUEST_RULE`,
  `DISCORD_CODE_REQUEST_IP_RULE`) sont une première ligne gratuite, **pas** la
  garantie : ils vivent dans une `Map` d'un seul processus dont le seau se vide
  entièrement dès qu'on lui fabrique dix mille clés (`rate-limit.ts`), et la clé
  est justement un identifiant que l'appelant choisit. Celui par IP a un rôle
  propre : il est posé **avant** la résolution du pseudo, seul moyen de borner
  l'appel sortant vers le bot que cette route anonyme déclenche — et il est
  **large**, une IP n'étant pas une personne (un tournoi en réseau local sort
  tout entier par la même).

  **L'axe d'un plafond dit qui il refuse.** Celui de la *demande* porte sur le
  compte visé, à dessein : ce qu'il protège est le téléphone de la victime, que
  chaque appel fait vibrer. Celui de la *vérification* a été posé sur le même
  axe, et s'est retourné contre elle — la route est anonyme, l'identifiant
  Discord d'un joueur se lit dans la réponse de la demande, et dix codes bidon
  fermaient sa connexion pour un quart d'heure. Sa clé est donc le **couple
  (compte visé, IP appelante)** : l'attaquant ne plafonne que lui-même, et le
  décompte des essais reste, lui, porté par le code en base — changer d'IP n'en
  donne pas un de plus.

  Un code neuf **rend le précédent inatteignable par sa seule existence** :
  `verifyDiscordChallenge` ne lit que le **dernier émis**. Rien n'est écrit, donc
  rien ne peut échouer à mi-chemin — et le geste symétrique est ce qui compte :
  un envoi raté **supprime** sa ligne (`discardDiscordChallenge`), sans quoi la
  mort-née resterait la dernière et masquerait le code que le joueur tient de sa
  demande précédente, refusé comme invalide en lui brûlant ses cinq essais. Rien
  n'est invalidé *avant* l'envoi, pour la même raison inverse : l'ancien tué et
  le neuf jamais reçu laissaient le joueur sans rien du tout.

- **Trois portes, et aucune ne se revendique par une adresse.** Le compte n'a
  pas de mot de passe : il s'ouvre par une identité OAuth rattachée — `google_sub`,
  `discord_id`, `blizzard_sub` — et, pour Discord, par le code reçu en message
  privé, qui passe par le *même* `discord_id`. Chaque colonne est donc une porte
  d'entrée, et `lib/server/account-identities.ts` en porte les deux règles.

  **On ne déplace jamais une porte.** Un compte dont l'identité d'un fournisseur
  est posée la garde : y rattacher une autre identité du même fournisseur est
  refusé (`PROVIDER_ALREADY_LINKED`), plutôt que de faire glisser l'identité de
  connexion d'un compte à un autre. C'est la règle que la certification Discord
  appliquait déjà sous le nom `DISCORD_ID_MISMATCH`, énoncée pour les trois.
  Symétriquement, une identité déjà détenue par un autre compte du site est
  refusée (`IDENTITY_ALREADY_LINKED`) : le `SELECT` donne le refus lisible,
  l'index unique de la colonne tranche la course.

  **On ne mure jamais la dernière.** Détacher le seul moyen de connexion ne
  délie pas un compte, il le **ferme** — définitivement, le site n'ayant aucune
  récupération par courriel. Le refus vit dans le module pur
  (`lib/shared/account-connections.ts`), partagé par l'écran qui met une phrase à
  la place du bouton et par la route qui répond **409** (et non 403 : la demande
  est légitime, c'est l'état du compte qui s'y oppose).

  **Ce que cela remplace.** La connexion Google rattachait une identité neuve
  (`google_sub` inconnu) à un compte du site sur la seule **égalité de chaîne**
  de l'adresse e-mail. Contrôler `email_verified` avait rendu ce rattachement
  honnête — sans lui, obtenir une identité Google affirmant l'adresse d'un membre
  ouvrait sa session en un clic, sans code ni plafond, le chemin d'entrée le plus
  court du site. Il restait que le site décidait qu'une adresse *est* une
  personne, sur la foi d'un fournisseur dont il n'est pas l'émetteur.

  Le geste que ce rattachement rendait — « j'entre par Discord, je veux aussi
  entrer par Google » — se fait désormais là où il se prouve tout seul :
  `/profil`, section « Applications connectées », où le joueur est **déjà
  connecté** quand il rattache, ce qui vaut mieux qu'une adresse. Une identité
  inconnue ouvre donc un compte neuf, et rien d'autre.

  **Corollaire : le site ne collecte plus d'adresse.** Le scope `email` a
  disparu de la demande faite à Google, et `bg_users.email` n'a plus aucun
  lecteur. Privée de son unique usage, une colonne d'adresses ne pesait plus que
  d'un côté — c'est ce qu'une fuite fait le plus regretter. Discord est demandé
  en `identify` seul, Blizzard en `openid` seul : ni adresse, ni liste de
  serveurs. Les lignes écrites avant cette règle gardaient leur adresse ;
  la colonne a depuis été retirée, ce qui les a effacées du même geste (voir
  `docs/DATABASE_SCHEMA.md`).

  **L'intention d'un aller-retour est scellée à l'aller.** `LOGIN` ouvre une
  session, `LINK` rattache au compte connecté ; la valeur vit dans le cookie
  d'état, jamais dans l'URL du rappel — lue là, elle serait choisie par
  l'appelant, et un `intent` retourné en `LOGIN` transformerait un rattachement
  en changement de session. La session est relue **au retour** aussi : dix
  minutes séparent les deux, et rattacher sur la seule foi du cookie poserait une
  porte d'entrée sur un compte que plus rien ne prouve être celui de l'appelant.
  Le cookie porte aussi le **fournisseur** : unique pour les trois portes, c'est
  le seul contrôle qui empêche un état obtenu sur l'une d'être reçu sur une
  autre.

  **Le revers du plafonnement, assumé :** qui connaît le pseudo Discord d'un
  joueur peut brûler ses codes et épuiser ses quotas, donc le tenir hors du
  chemin « code par message privé » par fenêtres d'un quart d'heure. C'est le
  prix de tout plafonnement d'un code à usage unique, très inférieur à celui
  d'une session ouverte par énumération — et il s'est allégé : un compte né par
  Discord garde désormais la porte **OAuth Discord**, qui ne dépend ni du bot ni
  d'un message privé. Chaque demande laisse par ailleurs une trace chez la
  victime, qui reçoit le message.

### 1.2 Les six permissions

| Permission    | Domaine                                                          |
| ------------- | ---------------------------------------------------------------- |
| `tournaments` | Créer et gérer les tournois, arbitrer les matchs                  |
| `casting`     | **Lecture seule** de l'aperçu du plateau avant lancement          |
| `live`        | **Écriture** de l'état de diffusion d'un match (antenne, chaîne)  |
| `showcase`    | Site vitrine + association                                        |
| `recruitment` | Annonces de recrutement                                           |
| `roles`       | Attribution des rôles de plateforme                               |

### 1.3 Qui a quoi

| Rôle                | `tournaments` | `casting` | `live` | `showcase` | `recruitment` | `roles` |
| ------------------- | :-----------: | :-------: | :----: | :--------: | :-----------: | :-----: |
| `ADMIN`             | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ARBITRE`           | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `CASTER`            | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `COMMUNITY_MANAGER` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `RECRUTEUR`         | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| *(aucun rôle)*      | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Les rôles sont **cumulables** : un compte `ARBITRE` + `RECRUTEUR` obtient
l'union des deux lignes. `ADMIN` est un super-rôle — `can()` lui rend `true` sur
toute permission, quel que soit le contenu de `roles`.

### 1.4 La règle d'écriture d'une garde

Un domaine scopé se protège **toujours** par `can(user, "<permission>")`, jamais
par un test direct de `user.isAdmin` — sinon l'arbitre, le caster ou le CM
perdent le droit qu'on vient de leur donner.

```ts
const user = await getCurrentUser();
if (!user) return fail("UNAUTHORIZED", 401);
if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
```

**Une seule exception dans tout le projet** : la suppression définitive d'un
tournoi teste `user.isAdmin === true` (§4.6). L'attribution des rôles (§7) est
elle aussi réservée à `ADMIN`, mais elle l'exprime par sa permission —
`can(user, "roles")`, que seul `ADMIN` porte : même public, même règle
d'écriture que partout ailleurs.

---

## 2. Compte et profil

### 2.1 Ce qu'un utilisateur peut faire sur son propre compte

- Modifier son pseudo, ses tags de jeu, son pseudo Discord, sa majorité, ses
  réglages de visibilité, son ouverture au recrutement (`PATCH /api/profile`).
- Téléverser ou retirer son avatar (`POST` / `DELETE /api/profile/avatar`).
- Exporter toutes ses données personnelles (`GET /api/profile/export`, RGPD
  art. 20).
- Anonymiser son compte (`DELETE /api/profile`) — la session est détruite dans
  la foulée.

Toutes ces routes agissent sur `user.id` **pris de la session**, jamais sur un
identifiant fourni par le corps de la requête : il n'existe aucun chemin pour
modifier le profil d'autrui.

### 2.2 Ce qu'il ne peut pas faire

- ❌ Modifier le profil, l'avatar ou les réglages d'un autre compte — aucune
  route ne l'expose, **pas même pour un `ADMIN`**.
- ❌ Se donner des rôles : `POST /api/admin/users/[id]/roles` refuse en
  `400 CANNOT_MODIFY_SELF` quand la cible est l'appelant. Un compte sans `ADMIN`
  est de toute façon refusé en `403` avant d'y arriver.
- ❌ Lire les champs qu'un autre a masqués (§2.3).

### 2.3 Informations privées d'un profil

`applyVisibility` masque, pour tout viewer qui n'est pas le propriétaire :

| Champ                       | Masquable | Réglage                      |
| --------------------------- | :-------: | ---------------------------- |
| Avatar                      | ✅        | `visible_avatar`             |
| Battletag Overwatch         | ✅        | `visible_overwatch`          |
| Tag Marvel Rivals           | ✅        | `visible_marvel`             |
| Majorité (`isAdult`)        | ✅        | `visible_major`              |
| Pseudo Discord              | —         | **règle propre** : certifié → administration et arbitrage ; non certifié → personne (§2.4) |
| Pseudo                      | ❌        | jamais masqué — il identifie le joueur en bracket, roster et feuille de match |

Le masquage est appliqué **côté serveur, à la source** : le champ masqué vaut
`null` dans la réponse, il n'est pas seulement caché à l'affichage.

« À la source » veut dire **partout où le champ est lu**, et pas seulement dans
les deux lectures de profil. L'avatar en donne la mesure : `getFullProfile` et
`listPlayers` le masquaient bien, mais trois autres lectures allaient chercher
`bg_users.avatar_url` sans consulter le réglage — le roster d'une carte
d'annuaire (`listTeams`), celui d'une fiche d'équipe (`getTeamDetail`), et le
**logo d'une entrée solo**, recopié dans `bg_teams` puis servi jusqu'à la carte
du match en direct de l'accueil, que lit un visiteur sans compte. La règle est
donc écrite une seule fois, `visibleAvatarUrl` (`lib/shared/avatar.ts`), et les
cinq lectures y passent — les quatre du site et celle du jeu de test, qui
reproduisait la fuite à chaque exécution. Le propriétaire continue de voir la
sienne ; l'entrée solo, elle, est une valeur **stockée** servie à tout le monde,
elle n'a pas de lecteur à qui faire exception.

Une valeur stockée demande un **rattrapage**, et pas seulement une règle à
l'écriture : les entrées solo créées avant cette passe portaient déjà la copie,
et rien ne les aurait réécrites avant la prochaine inscription ou la prochaine
édition de profil de leur joueur. `lib/server/database.ts` vide donc ces
logos-là au démarrage, en une écriture idempotente rejouée à chaque fois — un
filet, pas une migration à cocher. Le chemin inverse (l'avatar redevient public)
est tenu par `syncSoloEntryIdentity`, appelé sur la bascule du réglage.

Deux points volontaires, à ne pas prendre pour des fuites :

- Les **badges de jeu** (OW / MR) restent affichés même quand le tag exact est
  masqué. « Joue à Overwatch » est une information d'appariement ; le battletag
  exact, qui permet de contacter le joueur hors du site, est une donnée de
  contact. Le réglage protège le second, pas le premier.
- Les **titres staff** (`displayRoles`) sont publics : un arbitre ou un caster
  doit être reconnaissable, c'est ce qui rend l'arbitrage opposable. En revanche
  `isAdmin` et le champ `roles` (celui qui sert à l'édition) ne sont renseignés
  **que pour un viewer administrateur**.

Ni l'e-mail, ni le `google_sub`, ni le `discord_id` ne sortent jamais d'un profil
consulté par un tiers ; ils n'apparaissent que dans l'export RGPD du
propriétaire.

### 2.4 Le tag Discord — un public, pas un réglage

Le tag Discord n'a **pas** de case de visibilité : il a un public, décidé par
`canViewDiscordTag` (`lib/shared/discord-identity.ts`), et l'ordre des cas *est*
la règle :

| Lecteur                              | Voit le tag                                    |
| ------------------------------------ | ---------------------------------------------- |
| Le propriétaire du compte            | Toujours, certifié ou non                      |
| N'importe qui, tag **non certifié**  | **Jamais**, administrateur compris              |
| Administrateur                       | Toujours (tag certifié)                         |
| Permission `tournaments`             | Si le joueur est engagé dans un tournoi vivant  |
| `casting`, joueur, visiteur          | Jamais — le tag n'est **pas** public            |

La clause « non certifié » passe **avant** les rôles, et ce n'est pas un détail
d'écriture : c'est elle qui protège les comptes qui ont saisi leur tag sous le
régime « visible de moi seul », et placée après elle serait oubliée au premier
rôle ajouté. La certification est facultative et porte le consentement à
l'exposition (`docs/features/DISCORD_VERIFICATION.md`) ; elle se perd à toute
modification du tag.

« Tournoi vivant » = tout état sauf `FINISHED` : le besoin de joindre un joueur
naît du tournoi et s'éteint avec lui. Le fait est **global**, pas relatif au
lecteur — un arbitre arbitre le site, pas un tournoi en particulier.

**Le tag et la certification sont deux faits distincts.** Le tableau ci-dessus ne
porte que sur le **tag** — la coordonnée, qui dit *comment* joindre. La
**certification** dit seulement *que le joueur est joignable* par l'organisation,
ne nomme personne, et s'annonce donc à tout lecteur d'une fiche
(`canSeeDiscordVerification`) : d'où l'affichage « Masqué ✅ ». Elle manquait au
capitaine dont le tournoi exige « tous les Discord vérifiés », qui lisait un refus
sans savoir qui de son roster devait encore certifier.

Le filtrage est posé **à la sortie** (`visibleDiscordTag`), comme celui de
l'avatar : un écran ajouté demain n'a rien à afficher plutôt qu'à se souvenir
d'une règle. Trois lectures y passent — `getFullProfile`, le panneau de contacts
d'un tournoi (`GET /api/admin/tournaments/[id]/contacts`, qui n'a plus que la
certification à appliquer, en SQL, puisque tout joueur listé est engagé dans *ce*
tournoi) et le profil du titulaire. Rien de tout cela n'entre dans
`TournamentSnapshot`, qui est diffusé tel quel à tous les abonnés du flux.

---

## 3. Équipes

### 3.1 Rôles d'équipe et pouvoirs

| Action                                | `OWNER` | `MANAGER` | Autre membre | Non-membre |
| ------------------------------------- | :-----: | :-------: | :----------: | :--------: |
| Modifier nom / description / sigle    | ✅ | ❌   | ❌ | ❌ |
| Modifier / retirer le logo            | ✅ | ✅   | ❌ | ❌ |
| Inviter un joueur                     | ✅ | ✅   | ❌ | ❌ |
| Répondre à une demande d'adhésion     | ✅ | ✅   | ❌ | ❌ |
| Retirer une invitation envoyée        | ✅ | ✅   | ❌ | ❌ |
| Changer les rôles d'un membre         | ✅ | ✅ \* | ❌ | ❌ |
| Exclure un membre                     | ✅ | ✅   | ❌ | ❌ |
| **Inscrire l'équipe à un tournoi**    | ✅ | ✅   | ❌ | ❌ |
| Transférer la propriété               | ✅ | ❌   | ❌ | ❌ |
| Dissoudre l'équipe                    | ✅ | ❌   | ❌ | ❌ |
| **Retirer l'équipe d'un tournoi**      | ✅ | ✅   | ❌ | ❌ |
| Quitter l'équipe                      | ❌ \*\* | ✅ | ✅ | — |
| Demander à rejoindre                  | — | —     | —  | ✅ |
| Retirer sa propre demande             | — | —     | —  | ✅ |

\* Un `MANAGER` ne peut pas toucher aux rôles de l'`OWNER`
(`targetIsOwner && !requesterIsOwner` → `FORBIDDEN`).
\*\* L'`OWNER` doit d'abord transférer la propriété (`OWNER_MUST_TRANSFER`) ; il
ne peut pas non plus être exclu (`CANNOT_KICK_OWNER`).

La gestion d'une équipe n'est pas monolithique. La ligne de partage n'est pas
« propriétaire ou pas » mais **identité, propriété et existence d'un côté,
conduite de l'équipe de l'autre** : ce qui touche au nom, au sigle, à la
propriété ou à l'existence de l'équipe est `OWNER` seul ; ce qui relève de sa
conduite au quotidien — logo, membres, rôles, invitations, **et l'engagement en
tournoi** (§4.2) — est ouvert au `MANAGER`, c'est précisément le métier du rôle.
La règle se lit donc « **pas de gestion sans rôle de gestion** », et non
« `OWNER` seul partout ».

Règles structurelles qui tiennent quel que soit le rôle :

- Le rôle `OWNER` ne s'attribue **jamais** par la route des rôles : il est filtré
  de toute liste soumise (`filter(role => role !== "OWNER")`). Il ne se déplace
  que par `POST /api/teams/[id]/transfer-ownership`, appelé par l'`OWNER`
  lui-même, vers un membre existant, et jamais vers soi-même — ni vers un
  compte **supprimé** (`MEMBER_ACCOUNT_DELETED`) : l'anonymisation ne détache pas
  de l'équipe, et l'équipe n'aurait plus personne capable de la conduire.
- Un membre doit garder au moins un rôle (`MISSING_ROLE`).
- Un utilisateur n'appartient qu'à **une** équipe active à la fois
  (`USER_ALREADY_IN_TEAM`) — contrôlé à la création, à l'invitation, à la
  demande d'adhésion et à l'acceptation. L'acceptation est **atomique**
  (`acceptIntoTeam`) : verrou sur la ligne du joueur, puis invitation réservée
  par un `UPDATE … WHERE status = 'PENDING'` — deux acceptations simultanées ne
  peuvent plus toutes deux passer.
- Retirer une invitation ou une demande en attente (`cancelInvitation`,
  `DELETE /api/invitations/[id]`) revient à qui l'a émise, au sens de l'acte :
  la **gestion** de l'équipe pour une invitation, le **joueur** pour sa demande.
  Le destinataire, lui, répond (`respondToInvitation`).
- Une équipe dissoute (`deleted_at`) n'est plus gérable : son nom et son sigle
  sont libérés, ses membres détachés, mais son historique de matchs demeure.
- Il n'existe **aucun ajout direct** d'un membre : on invite, et l'invité
  accepte (`inviteToTeam`) — sauf si une demande de sa part était déjà en
  attente, que l'invitation valide alors sur-le-champ. Une fonction d'ajout
  forcé subsistait dans le service, sans route ni appelant, avec une règle qui
  n'était plus celle du document ; elle a été retirée plutôt que réparée.
- Ni une **équipe fantôme** ni une **entrée solo** ne se rejoint
  (`TEAM_NOT_JOINABLE`, 409) : ni l'une ni l'autre n'a de membre, donc personne
  n'a qualité pour répondre — la demande restait en attente à jamais et son
  auteur se voyait refuser toute autre équipe par `ALREADY_REQUESTED`. Une
  fantôme s'attribue par `POST /api/teams/[id]/claim` (§5).

### 3.2 Ce qu'un joueur ne peut pas faire

- ❌ Modifier une équipe dont il n'est pas membre — `getMemberRoles` rend `null`,
  toutes les fonctions de gestion lèvent `FORBIDDEN`.
- ❌ Modifier une autre équipe que la sienne, même s'il est `OWNER` de la sienne :
  les droits se lisent **sur la ligne d'appartenance à l'équipe visée**, jamais
  sur un statut global.
- ❌ Se hisser `OWNER` d'une équipe où il est `MANAGER`.
- ❌ Toucher à quoi que ce soit en tant qu'`ADMIN` du site : les rôles de
  plateforme n'ouvrent aucun droit sur une équipe **réelle**. La seule
  dérogation vise les équipes fantômes (§5).

---

## 4. Tournois et matchs

### 4.1 Lire un tournoi

| Situation                                     | Sans rôle | `casting` | `tournaments` |
| --------------------------------------------- | :-------: | :-------: | :-----------: |
| Tournoi publié (`start_visibility_at` passé)   | ✅ | ✅ | ✅ |
| Tournoi **non publié**                         | ❌ 404 | ❌ 404 | ✅ |
| Liste `?scope=hidden`                          | ❌ 403 | ❌ 403 | ✅ |
| Aperçu du plateau avant lancement (`preview`)  | ❌ `null` | ✅ | ✅ |

Un tournoi non publié se refuse en **404, jamais 403** : sur un identifiant
consécutif et devinable, un « interdit » confirmerait l'existence qu'on protège.
La règle est posée à un seul endroit, `getVisibleTournamentSnapshot`, et
s'applique aux **deux** portes de lecture — le flux SSE (chemin nominal) et la
lecture REST de secours — ainsi qu'à la route d'image d'aperçu, servie hors des
mises en page.

Aucune route d'écriture n'a à contrôler la visibilité : `validateDateOrder`
garantit `startVisibilityAt <= registrationOpenAt`, donc un tournoi caché est
toujours `UPCOMING`.

### 4.2 S'engager

- Un joueur inscrit **son engagé** — son équipe active, ou lui-même en tournoi
  individuel (`resolveUserEntrantTeamId`). Il ne peut désigner personne d'autre :
  la route `POST /api/tournaments/[id]/register` ne prend aucun corps.
- **Engager une équipe demande d'en avoir la charge** : `OWNER` ou `MANAGER`
  (`hasTeamManagementRole`, `lib/shared/team-roles.ts`). Un joueur du roster est
  refusé en `403 NOT_TEAM_MANAGER`. Une inscription vaut promesse de se
  présenter : elle expose l'équipe entière à un forfait et occupe une place que
  d'autres attendent — c'est un acte qui engage l'équipe, au même titre
  qu'inviter ou exclure. Les rôles sont relus **dans la transaction**, sur la
  ligne d'appartenance : le droit se juge à l'instant de l'écriture, pas à celui
  où la page a été rendue.
- En **tournoi individuel**, la question ne se pose pas : le joueur n'engage que
  lui-même, par une entrée solo qui n'a ni membre ni rôle.
- Côté interface, la règle voyage dans le contexte du lecteur
  (`TournamentViewerContext.canRegisterEntrant`) : le bouton ne s'affiche pas là
  où le serveur refuserait, et une phrase prend sa place plutôt qu'un vide
  (`_lib/register-entry.ts`).
- Le staff `tournaments` inscrit des **équipes fantômes** en lot
  (`POST /api/admin/tournaments/[id]/ghost-registrations`), et rien d'autre : une
  équipe réelle ou une entrée solo se fait refuser par `NOT_A_GHOST_TEAM`.
- **Le tournoi peut poser des conditions** (`lib/shared/registration-filters.ts`) :
  un effectif minimal et une exigence de tag Discord certifié
  (`NONE` / `ANY_PLAYER` / `ALL_PLAYERS`). Trois refus distincts, en **409** — la
  saisie est bonne, c'est l'état de l'équipe qui ne convient pas, et il se
  corrige. Deux portées à retenir : les **équipes fantômes** n'y sont pas soumises
  (le contrôle vit dans `registerCurrentUserTeam`, jamais dans le tronc commun),
  et une inscription **déjà enregistrée** n'est jamais relue. Voir
  `docs/features/REGISTRATION_FILTERS.md`.
- Signaler un problème (`POST .../report-issue`) est réservé aux **engagés** du
  tournoi (`NOT_REGISTERED` → 403), revérifié côté serveur.

### 4.3 Reporter un score (côté joueur)

`POST /api/tournaments/[id]/matches/[matchId]/report` n'accepte que ceci :

- ✅ le tournoi est `RUNNING` (`TOURNAMENT_NOT_RUNNING` sinon) ;
- ✅ l'appelant a un engagé dans ce tournoi (`NO_ACTIVE_TEAM` sinon) ;
- ✅ **cet engagé est l'une des deux équipes du match** — sinon `NOT_IN_MATCH`.
  Le score est écrit dans la colonne de *son* camp (`team1_report_*` ou
  `team2_report_*`), déduite du match, jamais du corps de la requête ;
- ✅ le match n'est pas déjà tranché (`MATCH_ALREADY_COMPLETED`) et a bien deux
  engagées (`MATCH_NOT_READY`). « Tranché » se lit sur le **statut**
  (`isMatchPlayed`, `lib/shared/match-outcome.ts`), jamais sur la présence d'un
  vainqueur : un match nul n'en a pas et est pourtant terminé. Lu sur
  `winner_team_id`, ce refus laissait rouvrir toute rencontre close par une
  égalité — le statut repassait en `AWAITING_CONFIRMATION`, deux reports
  concordants réécrivaient le score, et le verrou de manche n'y opposait rien
  puisqu'il ne vit que du côté de l'arbitrage ;
- ✅ le score constitue un **résultat final** au format de la manche
  (`checkMatchScores`).

Un report d'équipe ne tranche rien seul : deux reports concordants closent la
rencontre, deux reports contradictoires ouvrent un **conflit** qui part au canal
arbitre. Un joueur ne peut donc en aucun cas :

- ❌ saisir le score d'un match où son équipe ne joue pas ;
- ❌ saisir un score pour l'équipe adverse ;
- ❌ écraser un résultat déjà validé.

### 4.4 Arbitrer (permission `tournaments`)

Réservé à `ADMIN` et `ARBITRE` :

- créer un tournoi (`POST /api/tournaments`) ;
- l'éditer (`PATCH /api/tournaments/[id]/edit`) — dans la fenêtre autorisée :
  tout tant qu'il est caché, cinq champs une fois annoncé, **rien** une fois
  lancé ou terminé ;
- le lancer par anticipation (`POST /api/admin/tournaments/[id]/launch`) ;
- réordonner le seeding (`PATCH .../seeding`), jusqu'à la première saisie de
  score ;
- **retirer un engagé du plateau**
  (`DELETE /api/admin/tournaments/[id]/registrations/[teamId]`), jusqu'au début
  du tournoi (§4.8) ;
- enregistrer un score en cours de rencontre
  (`PATCH /api/admin/matches/[id]/scores`) et **valider un résultat**
  (`POST /api/admin/matches/[id]/resolve`), forfait d'une manche compris ;
- programmer l'heure d'un match (`PUT /api/admin/matches/[id]/schedule`) ;
- poser et retirer une pénalité d'endurance (`POST` / `DELETE .../penalties`) ;
- forcer le forfait de n'importe quel engagé (`POST .../forfeit` avec `teamId`) ;
- reculer d'un stade (`POST /api/admin/tournaments/[id]/rollback`) ;
- fixer la chaîne officielle du tournoi (`PUT /api/admin/tournaments/[id]/live`) ;
- inscrire et gérer les équipes fantômes (§5).

Un `CASTER` n'a **aucun** de ces droits.

### 4.5 Diffuser (permission `live`)

`ADMIN`, `ARBITRE` et `CASTER` — et eux seuls — écrivent l'état de diffusion d'un
**match** : `PUT` / `POST /api/admin/matches/[matchId]/live` (chaîne,
déclencheur `AUTO` / `MANUAL` / `START_TIME`, ouverture de l'antenne).

La **chaîne officielle du tournoi** est un autre droit : elle passe par
`PUT /api/admin/tournaments/[id]/live`, protégé par `tournaments`. Un `CASTER`
ouvre l'antenne d'un match, il ne décide pas de la chaîne du tournoi.

`live` n'ouvre **rien d'autre** : ni score, ni horaire, ni seeding, ni édition.

### 4.6 Supprimer un tournoi

`DELETE /api/admin/tournaments/[id]` teste `user.isAdmin === true`. C'est le
**seul** point du projet où le contrôle n'est pas une permission scopée : un
arbitre gère un tournoi, il ne l'efface pas. Le champ
`TournamentDetail.canDelete` transporte ce droit, distinct de `canManage`, par
les deux portes (flux + REST).

Aucune équipe ni aucun joueur n'est supprimé au passage — seules les lignes
portant un `tournament_id`, plus les rappels de match.

### 4.7 Abandonner

`POST /api/tournaments/[id]/forfeit` :

- un joueur ne peut forfaiter **que son propre engagé** — passer un `teamId`
  différent du sien est refusé en `403 FORBIDDEN` ;
- **et il lui faut la charge de l'équipe** (`OWNER` ou `MANAGER`,
  `hasTeamManagementRole`) : un joueur du roster est refusé en
  `403 NOT_TEAM_MANAGER`, exactement comme à l'inscription (§4.2). C'est la même
  règle parce que c'est le même engagement : retirer une équipe d'un tournoi la
  condamne — capital à zéro en BG Survie, éliminée ailleurs — et rien ne le
  défait. Un `DPS` ne pouvait pas engager son équipe mais pouvait la désengager :
  le geste le plus lourd des deux était le moins gardé. En **tournoi individuel**
  la question ne se pose pas, l'engagé est le joueur lui-même ;
- le staff `tournaments` peut forfaiter n'importe quel engagé, sans cette
  qualité ;
- dans tous les cas, refusé hors `RUNNING`, et dès les play-offs d'endurance
  lancés.

### 4.8 Retirer un engagé (avant le coup d'envoi)

`DELETE /api/admin/tournaments/[id]/registrations/[teamId]`, permission
`tournaments` — et **elle seule** : un engagé ne peut pas se retirer lui-même,
pas plus qu'un capitaine ne peut retirer son équipe. L'inscription est effacée,
la place rendue.

La fenêtre s'arrête **au début du tournoi**, bornes comprises
(`lib/shared/entrant-removal.ts`) : au coup d'envoi le tirage est fait, et retirer
une inscrite laisserait un match sans adversaire. Après, la seule sortie est
l'abandon (§4.7) — d'où deux gestes qui ne se recouvrent jamais, l'un avant et
l'autre après la même borne.

L'état est lu **deux fois**, stocké et calculé : le premier rattrape un tournoi
lancé par anticipation ou clos à la main, le second un tournoi dont l'heure de
début est passée sans que la colonne ait été recalée. Refus en `409`.

Aucune équipe ni aucun joueur n'est supprimé : ni la fantôme retirée du plateau,
ni l'entrée solo d'un joueur. Voir `docs/features/ENTRANT_REMOVAL.md`.

---

## 5. Équipes fantômes et entrées solo

Une **équipe fantôme** (`bg_teams.is_ghost`) est une équipe sans joueur, créée
par le staff `tournaments` pour remplir un plateau ou inviter une structure.
C'est la seule dérogation d'administration sur une équipe, portée par le
paramètre `viewerManagesGhostTeams` des fonctions de `teams-service` :

- ✅ le staff `tournaments` crée, renomme, logote, inscrit en lot et dissout une
  équipe **fantôme** sans en être membre ;
- ✅ il peut l'**attribuer** à un joueur réel (`POST /api/teams/[id]/claim`), qui
  en devient `OWNER` — l'équipe cesse alors d'être fantôme, et la dérogation
  s'éteint avec elle ;
- ❌ la dérogation ne s'applique **jamais** à une équipe réelle : le même staff
  n'a aucun droit sur une équipe qui a des membres.

Une **entrée solo** (`bg_teams.solo_user_id`) représente un joueur dans un
tournoi individuel. Ce n'est pas une équipe : elle naît avec `is_ghost = 0`, se
fait refuser par `NOT_A_GHOST_TEAM` comme une équipe réelle, et reste exclue de
`/equipes`, du classement du site et du compteur d'équipes.

---

## 6. Vitrine, association, recrutement

| Domaine                                                         | Permission    | Rôles                        |
| --------------------------------------------------------------- | ------------- | ---------------------------- |
| Sponsors (`/api/landing/sponsors/*`)                             | `showcase`    | `ADMIN`, `COMMUNITY_MANAGER` |
| Association : bureau, piliers, stats, contact                    | `showcase`    | idem                         |
| Bénévoles (`/api/benevoles/*`)                                   | `showcase`    | idem                         |
| Textes éditables de la vitrine (`PATCH` / `DELETE /api/site-copy`) | `showcase`  | idem                         |
| Annonces de recrutement (`/api/recruitment/*`)                   | `recruitment` | `ADMIN`, `RECRUTEUR`         |

En **lecture**, ces contenus sont publics (`GET` sans garde) — c'est leur raison
d'être. Une seule nuance : `GET /api/recruitment` ne renvoie les annonces
masquées qu'à un porteur de `recruitment`.

Un `ARBITRE` ou un `CASTER` **ne peut pas** modifier le site vitrine, et un
`COMMUNITY_MANAGER` ne peut pas toucher aux tournois.

---

## 7. Attribution des rôles

`POST /api/admin/users/[id]/roles` — **`ADMIN` strict** :

- ❌ un non-admin est refusé en `403`, quel que soit son cumul de rôles : aucun
  chemin ne permet de s'accorder ou d'accorder un privilège qu'on n'a pas ;
- ❌ un administrateur ne peut pas modifier **ses propres** rôles
  (`CANNOT_MODIFY_SELF`, 400) — garde anti-auto-verrouillage ;
- ✅ le corps est validé rôle par rôle (`isPlatformRole`) puis normalisé
  (`sanitizePlatformRoles`) : une valeur inconnue est écartée, jamais persistée ;
- l'appel **remplace** l'ensemble des rôles de la cible ; `ADMIN` est stocké dans
  `bg_users.is_admin`, les autres dans `platform_roles_json`.

Un administrateur **peut** promouvoir un autre compte `ADMIN` : c'est le seul
chemin de promotion, et il exige déjà `ADMIN`. Il n'existe donc aucune élévation
depuis un rang inférieur, et donc aucune escalade de privilège — `ADMIN` est le
sommet, la confiance qu'on lui accorde est totale par construction. La seule
garde utile à ce niveau est l'interdiction de se modifier soi-même, qui protège
de l'auto-verrouillage, pas de l'abus.

---

## 8. Ce qui n'est protégé par aucun rôle

Volontairement ouvert, à connaître pour ne pas le confondre avec un trou :

- `GET /api/landing/*` (stats, live, leaderboard, calendrier, ticker),
  `GET /api/association/*`, `GET /api/benevoles`, `GET /api/site-copy`,
  `GET /api/recruitment/highlight`, `GET /api/bot/*` — la vitrine publique.
- `POST /api/visits` — la mesure de fréquentation : anonyme par construction,
  seule une empreinte SHA-256 salée est stockée, jamais l'IP. Bornée par un
  plafond de 30 insertions par IP et par minute.
- `GET /api/uploads/[...path]` — sert `public/uploads/`, avec refus de toute
  remontée de dossier et liste blanche d'extensions.
- Les routes d'authentification (`/api/auth/*`), par nature — ouvertes, mais
  **plafonnées** : voir §1.1 pour le code Discord, qui est un secret et se
  compte comme tel.

En revanche, l'annuaire des joueurs (`/api/players`) et celui des équipes
(`/api/teams`) **exigent une session** : ce sont des données de membres.

---

## 9. Les gardes qui ne sont pas des rôles

Des refus légitimes ne relèvent pas des permissions, et ne doivent pas être
« corrigés » en ajoutant un rôle :

- **Verrou de score** (`lib/shared/match-lock.ts`) — un score n'est plus
  modifiable, **y compris par un administrateur**, dès que la manche suivante
  porte la moindre saisie. La sortie est le retour en arrière (§4.4), pas un
  privilège. Le verrou ne se déclenche que sur un match **tranché**, et là aussi
  « tranché » se lit sur le statut : `checkDownstreamMatchesHaveNoScores`
  sortait sur `winner_team_id === null`, donc n'opposait **rien** à la réécriture
  d'un match nul — l'interface, elle, le donnait pour verrouillé
  (`isScoreEditLocked` juge sur `decided`), et c'était l'interface qui avait
  raison.
- **Fenêtres d'édition d'un tournoi** — `FULL` / `RESTRICTED` / `LOCKED` : aucun
  rôle n'ouvre `LOCKED`.
- **États du tournoi** — abandon et pénalités sont refusés hors `RUNNING` ; la
  correction d'un score, elle, reste permise sur un tournoi terminé (le
  classement se rejoue, le tournoi ne se rouvre pas).
- **Plafonds de débit** (`lib/server/rate-limit.ts`, réglages dans
  `lib/server/api-guard.ts`) — indépendants des rôles. Deux d'entre eux ne sont
  pas de simples garde-fous de charge mais des **contrôles d'accès** : ceux du
  code de connexion Discord (§1.1), qui portent sur le compte visé et non sur
  l'appelant, précisément parce qu'une identité d'appelant se renouvelle.

---

## Voir aussi

- [`docs/features/PERMISSION_ROLES.md`](features/PERMISSION_ROLES.md) — le système de rôles
- [`docs/features/TOURNAMENT_VISIBILITY_ACCESS.md`](features/TOURNAMENT_VISIBILITY_ACCESS.md) — accès à un tournoi non publié
- [`docs/features/GHOST_TEAMS.md`](features/GHOST_TEAMS.md) — équipes fantômes
- [`docs/features/SOLO_TOURNAMENTS.md`](features/SOLO_TOURNAMENTS.md) — entrées solo
- [`docs/features/LIVE_STREAMS.md`](features/LIVE_STREAMS.md) — `live` vs `casting`
- [`docs/features/TOURNAMENT_DELETION.md`](features/TOURNAMENT_DELETION.md) — le seul `isAdmin` du projet
- [`docs/features/SAFE_LOGIN_REDIRECT.md`](features/SAFE_LOGIN_REDIRECT.md) — redirection d'après connexion
- [`docs/features/RGPD_DATA_RIGHTS.md`](features/RGPD_DATA_RIGHTS.md) — export et anonymisation
