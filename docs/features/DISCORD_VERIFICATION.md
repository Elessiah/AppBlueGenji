# Certification du tag Discord

> `lib/shared/discord-identity.ts` (pur) · `lib/server/discord-verification.ts` ·
> `GET|POST|PUT /api/profile/discord` · `components/discord-tag.tsx` ·
> `app/(secured)/profil/DiscordVerificationDialog.tsx`

## Le manque

Un tournoi ne se gère pas sans joindre les joueurs. Reprogrammer une manche,
trancher un litige de score, confirmer un forfait, vérifier un roster : tout cela
se règle en message privé Discord, jamais sur une fiche de profil.

Or le tag Discord du site avait deux défauts, et le second est le pire :

1. **Il n'était visible de personne.** `getFullProfile` ne le renseignait que
   pour le propriétaire du compte. L'organisation devait donc le demander à
   chaque fois, à chaque tournoi, à chaque joueur.
2. **Rien ne disait qu'il était le bon.** C'était une chaîne libre : on pouvait y
   écrire le tag d'un autre, un tag périmé, ou une faute de frappe. Un arbitre
   qui écrit au mauvais joueur ne le sait pas — c'est la panne silencieuse par
   excellence, le message part, quelqu'un le reçoit, et ce n'est pas le bon.

## La règle

> Un tag **certifié** est visible des administrateurs en permanence, et de
> l'arbitrage tant que son titulaire est engagé dans un tournoi vivant. Un tag
> **non certifié** n'est visible de personne — administrateurs compris.

La deuxième moitié est la charnière, et elle n'est pas une précaution de style :
les comptes existants ont saisi ce tag sous le régime « visible de moi seul ».
L'exposer rétroactivement changerait la finalité d'une donnée déjà collectée sans
que personne n'ait rien dit. Un compte qui ne fait pas la démarche reste donc
**exactement** dans l'état où il était — la certification est facultative, et
c'est elle qui porte le consentement.

Le public se lit dans `canViewDiscordTag`, et l'ordre des cas *est* la règle :

| Lecteur                              | Voit le tag                                  |
| ------------------------------------ | -------------------------------------------- |
| Le propriétaire du compte            | Toujours, certifié ou non                    |
| N'importe qui, tag **non certifié**  | **Jamais**                                   |
| Administrateur                       | Toujours (tag certifié)                       |
| Permission `tournaments` (arbitre)   | Si le joueur est engagé dans un tournoi vivant |
| Caster (`casting`), joueur, visiteur | Jamais — le tag n'est **pas** public          |

La clause « non certifié » passe **avant** les rôles. Ce n'est pas un détail
d'écriture : placée après, elle serait oubliée le jour où un rôle s'ajoute.

### Le tag et la certification sont deux faits, pas un

Le tableau ci-dessus ne concerne **que le tag**. La *certification*, elle,
s'annonce à tout lecteur d'une fiche (`canSeeDiscordVerification`) :

| Fait            | Ce qu'il dit                      | Public                    |
| --------------- | --------------------------------- | ------------------------- |
| Le tag          | **Comment** joindre le joueur     | Filtré (tableau ci-dessus) |
| La certification| **Qu'il est joignable**           | Tout lecteur de la fiche   |

D'où l'affichage « Masqué ✅ » : la coordonnée reste secrète, l'état se lit. Il
manquait à quelqu'un de précis — le **capitaine** dont le tournoi exige « tous
les Discord vérifiés » (`docs/features/REGISTRATION_FILTERS.md`) : il lisait un
refus qui nommait la condition sans jamais lui dire **qui** de son roster devait
encore certifier. Un mur sans poignée.

La certification ne nomme personne, ne mène à personne et ne se retourne pas
contre son titulaire : c'est une propriété de son compte, au même titre que son
ancienneté.

« Tournoi vivant » = tout état sauf `FINISHED`. La bonne borne est le palmarès :
un tournoi clos n'a plus de manche à reprogrammer. Le fait est **global** et non
relatif au lecteur — un arbitre arbitre le site, pas un tournoi en particulier ;
lui demander de prouver son affectation tournoi par tournoi n'existe nulle part
dans le modèle de permissions.

## La preuve

**C'est celle de la connexion, ni plus ni moins** : un code à six chiffres reçu
en message privé sur le compte revendiqué. `bg_discord_login_challenges` est
réutilisée telle quelle, avec ses deux bornes en base (cinq essais par code, cinq
codes par quart d'heure, cf. `docs/AUTHORIZATION_RULES.md` §1.1). Un second
mécanisme de secret, moins éprouvé, n'aurait rien apporté.

Deux chemins, une seule règle :

- **Compte déjà relié à Discord** (né par l'OAuth, par le code en message
  privé, ou certifié une première fois) : la preuve existe, il l'a faite en
  ouvrant sa session. Le dialogue le renvoie **chez Discord**
  (`/api/auth/discord/start?intent=link`) : le rattachement retrouve la même
  identité, ne déplace aucune porte, et réécrit certifié le pseudo que Discord
  nomme (`linkOAuthIdentity` rend alors `REFRESHED`, et le profil annonce
  « Discord reconfirmé » plutôt qu'un rattachement qui n'a pas eu lieu). Aucun
  appel au bot.
- **Compte sans Discord rattaché** : rien n'a été prouvé. Le bot résout le tag,
  code en message privé, puis confirmation.

### Pourquoi un compte relié ne passe plus par le bot

Il y passait : le site envoyait le tag au bot et vérifiait qu'il résolvait vers
l'identifiant déjà rattaché. Or le bot ne résout un tag qu'en cherchant parmi les
membres des serveurs **qu'il partage** avec le joueur, un serveur après l'autre.
Un compte venu par OAuth Discord — ou par un code demandé avec son identifiant
numérique, le repli prévu justement pour qui n'est sur aucun de ces serveurs —
n'en partage souvent aucun : la recherche les parcourait **tous**, dépassait les
trois secondes de l'appel, et le profil annonçait « bot non joignable ». Aboutie,
elle aurait de toute façon répondu « tag introuvable ». On demandait au bot de
prouver ce que Discord atteste lui-même en un aller-retour.

Le chemin serveur (`startDiscordVerification` qui conclut sur place quand le tag
résout vers l'identifiant rattaché) est **conservé** : il reste une preuve juste,
et un compte rattaché entre l'ouverture du profil et le clic y aboutit encore.

**« Trop lent » n'est plus « injoignable ».** Un appel au bot qui dépasse son
délai lève désormais `BOT_INTERNAL_TIMEOUT` (504), distinct de
`BOT_INTERNAL_UNREACHABLE` (503, connexion refusée) : le premier est le cas
ordinaire d'un tag absent des serveurs du bot, et sa phrase renvoie au geste
(vérifier le tag, rejoindre le serveur, ou passer par l'identifiant / le bouton
Discord) au lieu d'annoncer une panne.

**Se connecter par Discord certifie le tag**, sans le moindre geste
supplémentaire : la route de connexion **consomme** le défi
(`consumeDiscordChallenge`) au lieu de le vérifier, récupère le tag qui a servi à
résoudre l'identifiant, et `createOrGetDiscordUser` l'écrit certifié. Tous les
comptes nés par cette porte se certifient donc à leur prochaine connexion, sans
migration.

**L'exposition est donc annoncée sur les deux chemins, pas seulement dans le
dialogue.** C'est le seul endroit où la certification se produit sans qu'on l'ait
demandée : un membre qui entre toujours par Discord et n'avait jamais rempli le
champ « Pseudo Discord » verrait son handle devenir lisible par les
administrateurs et l'arbitrage. La deuxième étape de `/connexion` porte donc la
phrase — ce que la certification ouvre, à qui, et le geste qui l'annule — et
`lib/shared/rgpd-policy.ts` déclare les **deux** voies. Le geste d'annulation
existait déjà ; encore faut-il savoir qu'il y a quelque chose à annuler.

### Le tag écrit est celui du défi, jamais celui du client

`bg_discord_login_challenges.handle` retient le tag de la demande. La
confirmation ne lit **pas** le tag que le client renvoie : entre les deux
requêtes, cette seconde valeur n'est plus couverte par la moindre preuve. C'est
la ligne du défi qui porte la preuve, donc c'est elle qui dit quoi écrire.

### Un identifiant numérique n'est pas un tag

La connexion accepte un identifiant Discord en repli, quand le bot ne partage
aucun serveur avec le joueur. La certification le refuse
(`normalizeDiscordHandle` rend `null`) : c'est un **pseudo** qu'elle publie à
l'arbitrage, et un nombre de dix-huit chiffres affiché là où un arbitre attend un
nom lui ferait croire qu'il a certifié son tag.

Le prédicat vit dans le module **pur** (`isDiscordNumericId` /
`isCertifiableDiscordHandle`) parce qu'il a deux appelants de part et d'autre de
la frontière : le serveur, qui décide ce qui s'écrit, et la page de connexion,
qui n'annonce la certification **que** si la saisie en produira une. Deux copies
auraient divergé en une phrase fausse — un écran promettant ce que le serveur
refuse.

### On ne déplace jamais une porte d'entrée

Un compte dont le `discord_id` est posé le garde. Un tag qui résout vers un autre
compte Discord est refusé (`DISCORD_ID_MISMATCH`, 409) plutôt que de faire glisser
l'identité de connexion d'un compte Discord à un autre — `discord_id` **est** un
moyen de connexion. L'état est relu à la confirmation, le compte ayant pu se
rattacher entre-temps.

Un Discord déjà certifié par un **autre compte du site** est refusé de même
(`DISCORD_ALREADY_LINKED`, 409). Deux contrôles qui ne font pas double emploi : le
`SELECT` préalable donne le refus lisible, l'index unique sur `discord_id` tranche
la course entre deux certifications simultanées.

## Ce qui défait la certification

> **Toute modification du tag la fait perdre.**

Elle ne dit pas « ce compte a un Discord » (c'est `discord_id`) mais « le tag
stocké a été prouvé » : un tag réécrit n'a rien prouvé. `updateOwnProfile` pose le
`CASE` **avant** l'affectation de `discord_pseudo`, MySQL évaluant les
affectations de gauche à droite — placé après, il lirait déjà la valeur neuve et
ne verrait jamais de changement (même piège que la réservation d'essai d'un code).
`<=>` et non `=`, le tag pouvant être `NULL` des deux côtés.

La comparaison hérite de la **collation de la colonne** (`utf8mb4_0900_ai_ci`,
insensible à la casse) : corriger « keryan » en « Keryan » ne défait donc pas la
certification, ce qui est le bon comportement — les pseudos Discord sont
eux-mêmes insensibles à la casse, la preuve continue de désigner le même compte.
Ne pas durcir ceci en comparaison binaire : on recertifierait pour une majuscule.

C'est aussi le geste d'annulation offert au joueur : modifier son tag retire
l'exposition, et le dialogue le lui dit avant qu'il ne certifie. Il n'y a donc
**pas** de route de décertification — un second chemin laisserait un compte
certifié sur un tag qu'il vient de changer.

L'anonymisation du compte efface le tag **et** sa date : une date restée seule
ferait d'un compte anonymisé un compte « vérifié » sans tag.

## Un compte Discord rattaché possède son tag

> **Le champ se lit, il ne se saisit plus** — `lib/shared/discord-tag-lock.ts`.

Deux façons d'écrire `bg_users.discord_pseudo` coexistaient sans se connaître :
la **saisie libre** de `/profil`, que la certification vient prouver ensuite, et
le **rattachement OAuth** — connexion par Discord ou ajout de Discord dans
« Applications connectées » —, qui écrit le pseudo que Discord nomme lui-même et
le pose certifié (`linkOAuthIdentity`).

Laisser la première ouverte une fois la seconde faite ne pouvait produire que du
faux. Le champ invitait à réécrire à la main une donnée que le fournisseur venait
d'attester, et **toute modification défait la certification** (section
précédente) : le joueur perdait donc, d'une faute de frappe, la seule chose qui
rendait son tag visible de l'arbitrage, pour se voir ensuite proposer un bouton
« Recertifier » qui ne fait que replacer ce que Discord disait déjà. Un
aller-retour entier pour revenir au point de départ, avec entre les deux une
fenêtre où le site exposait un tag inventé.

D'où la règle, écrite **une fois** dans un module pur et tenue aux deux bouts :

- **L'écran** passe le champ en `readOnly` (et non `disabled` : la valeur reste
  lisible au lecteur d'écran et atteignable au clavier) et **retire
  « Recertifier »** — il ne ferait que reposer ce que Discord dit déjà. Il ne
  retire pas les gestes qui ont encore un objet : « Certifier mon tag » tant que
  le tag enregistré ne l'est pas, « Enregistrer mon tag » quand il n'y en a
  aucun, « Retirer mon tag » dès qu'il y en a un — le champ ne se vidant plus à
  la main, cette sortie n'existerait nulle part ailleurs. Le détail des trois
  états est plus bas, section « Où le tag s'affiche ».
- **La route** refuse la réécriture en **409 `DISCORD_TAG_LOCKED`** : la saisie
  est bonne, c'est l'état du compte qui l'interdit. Le refus ne tombe que sur un
  tag **différent** du tag stocké, et la comparaison est **exacte, casse
  comprise**. Elle ne l'a pas toujours été : elle tolérait la casse parce que le
  formulaire renvoyait le champ à chaque sauvegarde et que refuser sur sa seule
  présence rendait tout le profil inenregistrable. Le client ne soumet plus ce
  champ que s'il a changé, et la tolérance est devenue nuisible — laisser passer
  une différence de casse rendait un **200 qui n'écrivait rien**, l'écriture
  gardant la valeur stockée quoi qu'ait décidé ce contrôle (constaté contre un
  vrai MySQL : la colonne restait sur son orthographe d'origine pendant que la
  route annonçait « Profil mis à jour »). Le refus dit maintenant ce que
  l'écriture fait : c'est Discord qui nomme ce tag, sa casse comprise. La
  comparaison qui décide de la **décertification** reste, elle, insensible à la
  casse — elle répond à une autre question, « la preuve porte-t-elle encore sur
  ce tag ? », et les pseudos Discord sont eux-mêmes insensibles à la casse.
- **L'écriture** garde le tag par elle-même :
  `discord_pseudo = CASE WHEN NOT ? THEN discord_pseudo WHEN discord_id IS NOT NULL AND ? IS NOT NULL THEN discord_pseudo ELSE ? END`.
  Le `SELECT` donne le refus lisible, la requête tranche la course — un
  rattachement peut tomber entre les deux. Un `CASE` jumeau couvre
  `discord_verified_at`, qui n'a aucune raison de tomber quand rien ne change.

### Retirer son tag reste possible

Un compte rattaché ne peut pas **inventer** un autre tag ; il peut en revanche
**retirer** le sien, et ce n'est pas une exception. Effacer son tag *est* le
geste d'annulation de l'exposition, le seul que le site offre — il n'existe
aucune route de décertification.

Le lui refuser enfermerait le cas le plus courant, un compte **né par Discord** :
son tag est certifié donc lisible de l'arbitrage, et détacher Discord lui serait
refusé en `LAST_CONNECTION` faute d'une autre porte. Il ne lui resterait que la
suppression du compte. D'où la forme du verrou : il ne mord que sur une valeur
**non nulle** et différente, et l'effacement n'interroge même pas le
rattachement.

### Un champ absent n'est pas un champ vidé

`discordPseudo` manquant valait `null`, donc un effacement : une requête
partielle qui ne parlait pas du tag le supprimait, et sa certification avec.
Aucun appelant ne le faisait — le formulaire renvoie toujours le champ —, mais
le verrou en aurait fait un **409 sur tout compte rattaché**, ce qui rend la
distinction obligatoire autant que juste. D'où le premier `WHEN` des deux
`CASE` : « le patch parle-t-il du tag ? ».

Le verrou se lit sur le **rattachement seul**, ni sur le tag ni sur la
certification. Un compte rattaché dont Discord n'a donné aucun pseudo affichable
— un `username` entièrement numérique, que `normalizeDiscordHandle` écarte —
reste donc verrouillé : ce qu'il saisirait ne serait de toute façon pas
certifiable (la certification vérifie que le tag résout vers *son* identifiant
Discord, et rejette le même numérique), donc invisible de tous. Un champ ouvert
sur rien est un piège, pas une liberté ; l'aide du champ le dit en toutes
lettres plutôt que de laisser croire à un chargement raté.

Le refus **nomme les deux gestes qui le lèvent**, et seulement ceux qui existent
toujours : se renommer sur Discord puis se reconnecter (la connexion réécrit le
tag et le recertifie), ou **retirer son tag** — le geste d'annulation de
l'exposition, que la route accepte parce qu'il n'efface rien d'autre. Détacher
Discord depuis « Applications connectées » rend bien le tag à la saisie libre
(`unlinkOAuthIdentity`), mais la phrase ne le nomme pas : ce n'est pas un geste
pour le cas le plus courant, un compte **né** par Discord, à qui ce bouton est
refusé en `LAST_CONNECTION` faute d'une autre porte. Un refus qui nomme une
sortie inexistante se lit comme une panne.

**Un rattachement inconnu verrouille aussi.** L'écran reçoit l'état par un appel
à part, donc il ne le connaît pas au premier rendu et pas du tout si l'appel
échoue : `linked` y vaut alors `null`, et `checkDiscordTagEdit` refuse
(`UNKNOWN_LINK`). Le prédicat teste les deux valeurs **connues** et fait
retomber tout le reste sur l'inconnu — écrit dans l'autre sens (`=== null`
d'abord), un `undefined` glissait entre les branches et *ouvrait* le champ, ce
que l'écran rend atteignable en alimentant cet état par un `as` sur une réponse
JSON que rien ne valide.

**Attendre n'est pas échouer**, et les deux se disaient pareil : le profil se
rend dès que `GET /api/profile` répond, régulièrement avant
`GET /api/profile/discord`, si bien que la phrase annonçait une panne pendant le
temps normal d'un aller-retour. Un drapeau `pending` les sépare — l'appelant est
le seul à savoir laquelle des deux, et le module reste pur en se contentant de
ne plus supposer. L'attente se dit alors comme une attente, sans cause ni geste :
il n'y a rien à réessayer tant que le premier essai n'a pas répondu.

Le verrou porte sinon **sa propre sortie** : un bouton « Réessayer » relit
l'état sans rechargement. Sans lui, une panne de lecture coûtait bien plus que
le champ — tous les gestes étant sous `linked === true`, « Retirer mon tag »
disparaissait avec eux, c'est-à-dire la seule annulation d'exposition que le
site offre, et il n'existait aucun recours hors d'un rechargement manuel. Le défaut inverse n'était pas tenable — le champ ouvert
laissait saisir un tag que la route refuse en 409, et ce refus emporte **toute**
la sauvegarde, le `PATCH` étant indivisible. L'aide du champ dit alors le verrou
et sa sortie (recharger), sans affirmer un rattachement que rien n'établit.

## Où le tag s'affiche

- **`/profil`** — le sien, toujours, avec la pastille. Le champ passe en lecture
  seule dès que le compte porte un `discord_id` (section précédente), mais les
  **gestes restent** : « Certifier mon tag » tant que le tag enregistré n'est pas
  certifié — un tag saisi avant la règle, ou rattaché sans que Discord ait donné
  de pseudo certifiable —, et « Retirer mon tag », seule sortie de l'exposition.
  Ces deux gestes sont sous le **rattachement**, jamais sous la présence d'un
  tag : posés sur le tag, ils disparaissaient tous les deux à l'état que le
  retrait vient de produire (rattaché, sans tag), ne laissant qu'une reconnexion
  par Discord. Sans tag enregistré le bouton dit « Enregistrer mon tag » : il n'y
  a rien à *certifier*, et le geste se prouve seul — le dialogue renvoie chez
  Discord, qui nomme le pseudo, et le rattachement l'écrit certifié.
  **Le formulaire ne soumet que ce qu'il a changé** : il renvoyait le tag de son
  instantané de montage à chaque sauvegarde, si bien qu'un tag réécrit ailleurs
  entre-temps (renommage sur Discord puis connexion depuis un autre appareil)
  faisait refuser **tout** le `PATCH` en 409, pseudo et visibilités emportés par
  un champ auquel personne n'avait touché. La clé est omise quand la valeur n'a
  pas bougé, ce qui n'efface rien : `updateOwnProfile` ne touche `discord_pseudo`
  que si le patch en parle.
  La condition porte sur la **valeur**, et non sur le verrou, parce que le verrou
  se lit sur un état que l'écran peut avoir périmé : un onglet ouvert avant le
  rattachement porte encore `linked: false`, et c'est exactement le cas où le
  refus tombe. La valeur, elle, dit ce qu'il faut savoir — ce champ a-t-il
  quelque chose à écrire ?
  Ce qui disparaît sur un compte rattaché est « Recertifier » : il ne ferait que
  reposer ce que Discord dit déjà. L'état vient de `GET /api/profile/discord`, qui parle
  du tag **enregistré** : un champ modifié sans être sauvegardé ne gagne ni ne
  perd la pastille — et c'est le même état qui décide du verrou, jamais la
  saisie en cours.
- **`/joueurs/[id]`** — le tag si le serveur l'a laissé passer, « Masqué » sinon,
  et **la pastille dans les deux cas** quand le joueur est certifié. « Masqué »
  couvre aussi bien le tag filtré que le tag absent, exactement comme les deux
  champs voisins : les deux cas sont indiscernables, donc l'affichage ne dit rien
  de plus que ce qu'il montre.
- **Fiche d'un tournoi, panneau « Contacts Discord »** — réservé au staff
  `tournaments`, chargé **à la demande** par
  `GET /api/admin/tournaments/[id]/contacts`. Rien de tout cela ne voyage dans
  `TournamentSnapshot`, qui est calculé une fois et **diffusé tel quel à tous les
  abonnés du flux** : y glisser des tags reviendrait à les envoyer à tout
  spectateur connecté.

  Le panneau **se ferme avec le tournoi** (`tournamentGrantsContactAccess`, refus
  en 409 côté route, panneau non rendu côté page) : la règle n'ouvre l'arbitrage
  que sur un tournoi vivant, et sans cette borne ce chemin-ci l'aurait contournée —
  six mois après la finale, un arbitre y aurait encore lu les coordonnées de tous
  ceux qui ont joué, quand la fiche d'un joueur, elle, les refuse déjà. Deux
  chemins vers la même donnée doivent s'arrêter au même endroit.

  Ses **deux** refus se lisent dans le panneau lui-même, pas seulement en toast
  (qui s'efface) : `contactsPanelView` (`_lib/contacts-panel-view.ts`) décide la
  vue, et l'échec y porte son message et un bouton « Réessayer ». La règle est
  sortie du JSX pour une raison précise : trois états font quatre vues, et
  écrite en ternaires imbriqués elle avait un cas sans branche — chargement
  retombé, liste encore `null` après un échec —, qui laissait un bloc déplié
  parfaitement vide. `TOURNAMENT_FINISHED` est par ailleurs traduit comme
  `CONTACTS_LOAD_FAILED` : la clôture peut tomber entre le rendu et le clic, et
  `mapError` rend le code brut faute d'entrée.

La pastille (`components/discord-tag.tsx`, `public/badge-certifie.webp`) s'affiche
donc **avec ou sans son tag** — `discordVerified` ne suit pas `discordPseudo`, les
deux champs répondent à deux questions différentes. Le composant n'a qu'un seul
chemin de rendu pour cette raison : son repli sortait d'abord avant la pastille,
si bien qu'un joueur certifié dont le tag était filtré n'annonçait rien du tout.
Un appelant pour qui « pas de tag » *signifie* « pas certifié » — le panneau de
contacts, dont le serveur n'envoie que des tags certifiés — passe
`verified={tag !== null}` : la règle reste la sienne, le composant affiche.

Le panneau de contacts met en avant l'engagé **injoignable** (aucun tag certifié
parmi ses joueurs) : c'est lui qui appelle un geste — relancer le capitaine,
envisager un forfait — et il se perdrait dans trente lignes uniformes.

## Le revers, assumé

Un tag certifié est un tag exposé à l'organisation, et l'organisation change de
mains. La contrepartie est bornée : le public est fermé (deux rôles, dont un sous
condition de tournoi), le tag n'est jamais public, aucune page ne le rend à un
joueur ni à un caster, et le joueur reprend la main d'une modification de champ.
Ce qui reste est un choix de sa part, énoncé avant le clic
(`DISCORD_VERIFICATION_EXPOSURE`, écrit à côté de la règle qui l'applique pour
qu'aucune des deux ne dérive sans l'autre).

## Voir aussi

- `docs/AUTHORIZATION_RULES.md` §2.3 — informations privées d'un profil
- `docs/features/REGISTRATION_FILTERS.md` — le tag certifié comme condition
  d'inscription
- `lib/shared/rgpd-policy.ts` — la finalité déclarée de la donnée
