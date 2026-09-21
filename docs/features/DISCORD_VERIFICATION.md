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

- **Compte déjà relié à Discord** (né par cette porte, ou certifié une première
  fois) : la preuve existe, il l'a faite en ouvrant sa session. Le site vérifie
  seulement que le tag saisi **résout vers cet identifiant-là**, et certifie sur
  place, sans message privé. C'est le « un seul bouton ».
- **Compte Google** : rien n'a été prouvé. Code, puis confirmation.

`discordVerificationNeedsCode(linkedDiscordId)` tranche, et le dialogue ne rejoue
pas la règle : il envoie le tag et lit `status` (`VERIFIED` ou `CODE_SENT`).

**Se connecter par Discord certifie le tag**, sans le moindre geste
supplémentaire : la route de connexion **consomme** le défi
(`consumeDiscordChallenge`) au lieu de le vérifier, récupère le tag qui a servi à
résoudre l'identifiant, et `createOrGetDiscordUser` l'écrit certifié. Tous les
comptes nés par cette porte se certifient donc à leur prochaine connexion, sans
migration.

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

## Où le tag s'affiche

- **`/profil`** — le sien, toujours, avec la pastille et le bouton de
  certification. L'état vient de `GET /api/profile/discord`, qui parle du tag
  **enregistré** : un champ modifié sans être sauvegardé ne gagne ni ne perd la
  pastille.
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
