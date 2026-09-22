# Connexion OAuth — Google, Discord, Blizzard

> Trois portes d'entrée, une seule mécanique, et une section de profil pour les
> ouvrir ou les fermer.

## Le problème

Le site avait **deux** façons d'entrer, et elles ne se rejoignaient qu'au prix
d'une supposition :

- **Google OAuth**, qui rattachait une identité neuve à un compte existant dès
  que l'adresse e-mail correspondait ;
- **le code Discord à six chiffres**, envoyé en message privé par le bot — donc
  réservé à qui partage un serveur avec lui.

Trois défauts, qui n'en font qu'un.

**Un joueur hors du serveur ne pouvait pas entrer par Discord.** Le repli était
de saisir son identifiant numérique à dix-huit chiffres, que personne ne connaît
par cœur. Pour un site d'esport dont la communauté vit sur Discord, la porte
principale était la plus étroite.

**Le rattachement par adresse était le chemin d'entrée le plus court du site.**
Obtenir une identité Google affirmant l'adresse d'un membre ouvrait sa session en
un clic. Le contrôle de `email_verified` a rendu ce rattachement honnête, mais il
restait que le site décidait qu'une adresse *est* une personne — sur la foi d'un
fournisseur dont il n'est pas l'émetteur, et au prix d'une colonne d'adresses
dont c'était le seul usage.

**Le BattleTag était une chaîne libre.** Un joueur qui se trompe d'un chiffre
n'est pas ajoutable en jeu, et personne ne peut le lui dire.

## Ce qui a été fait

### Trois portes, une mécanique

`lib/server/oauth-flow.ts` porte l'aller-retour en entier : jeton anti-CSRF,
cookie d'état, filtrage de la destination, refus lisible quand la configuration
manque, distinction entre *se connecter* et *rattacher*. Les six routes
(`/api/auth/<slug>/{start,callback}`) tiennent en cinq lignes et ne font que
nommer leur porte.

Ce qui distingue les fournisseurs se réduit à trois choses — l'URL
d'autorisation, l'échange du code, la forme du profil —, isolées dans un client
par fournisseur (`google-oauth.ts`, `discord-oauth.ts`, `blizzard-oauth.ts`) et
normalisées en une `OAuthIdentity` à quatre champs. Trois copies de la mécanique
auraient divergé sur le seul point où la divergence ne se voit pas : la sécurité.

Le registre (`lib/shared/oauth-providers.ts`) est pur et partagé par le client et
le serveur : les boutons de `/connexion`, la section du profil, les routes et le
journal Discord descendent tous de la même liste.

### Ce qu'on demande, et rien de plus

| Fournisseur | Portée | Ce que le site en retient |
| --- | --- | --- |
| Google | `openid profile` | `google_sub`, la photo (copiée), le nom (proposé comme pseudo) |
| Discord | `identify` | `discord_id`, le pseudo (**certifié**), la photo (copiée) |
| Blizzard | `openid` | `blizzard_sub`, le BattleTag |

Ni adresse e-mail, ni liste de serveurs. Le scope `email` a disparu de la demande
faite à Google, et `bg_users.email` avec lui : la colonne n'avait plus aucun
lecteur une fois le rattachement par adresse retiré, et une colonne d'adresses ne
pesait plus que d'un côté. Elle a fini par être **retirée de la table**, ce qui a
effacé du même geste les adresses collectées avant la règle — voir
`docs/DATABASE_SCHEMA.md`.

Les photos sont **copiées** chez nous (`adoptRemoteAvatar`), jamais relayées :
une URL de CDN rangée en base annoncerait l'IP de chaque visiteur au
fournisseur, à chaque affichage. Voir `USER_AVATAR_IMPORT.md`.

### Discord : la connexion certifie le tag

Se connecter par Discord — **par le bouton comme par le code** — pose
`discord_verified_at`. Un aller-retour OAuth mené jusqu'au bout *est* la preuve
que demande la certification (`lib/shared/discord-identity.ts`), et une meilleure
que le code : c'est Discord lui-même qui nomme l'identifiant et le pseudo, là où
le code ne prouve que l'accès aux messages privés d'un identifiant que le site
avait résolu de son côté.

Le pseudo retenu est `username` et non `global_name` : le premier est le tag
stable par lequel on retrouve quelqu'un, le second un libellé décoratif que deux
comptes peuvent partager. Un pseudo entièrement numérique est écarté par
`normalizeDiscordHandle` — on ne publie pas une suite de chiffres là où un arbitre
attend un nom — et le compte se rattache alors sans que son tag soit certifié.

**Le code par message privé reste**, et garde sa raison d'être : il sert le
membre du serveur BlueGenji qui préfère ne pas passer par un écran de
consentement. La page de connexion nomme désormais ce chemin (« OU CODE PAR
MESSAGE PRIVÉ ») au lieu d'un « OU » qui le faisait passer pour une variante du
bouton juste au-dessus.

### Blizzard : le BattleTag fait foi

Le BattleTag **n'a pas de colonne à lui** : il *est*
`bg_users.overwatch_battletag`, le champ que `/profil` propose déjà de saisir. En
ouvrir une seconde donnerait deux BattleTags pour un joueur, dont un faux, et
l'écran devrait choisir.

Blizzard l'**écrase à chaque connexion**, y compris par-dessus une saisie : entre
ce que Blizzard affirme et ce qu'un joueur a tapé, la source fait foi. Un
BattleTag mal recopié ne se voit pas, il se constate le jour où l'ajout en jeu
échoue. Ce qui n'est pas touché, c'est `visible_overwatch` : la connexion corrige
une donnée, elle ne publie rien.

Un compte Battle.net sans BattleTag n'efface rien — on ne détruit pas une saisie
avec du vide.

### « Applications connectées » (`/profil`)

La section liste les trois portes, rattachées ou non, et porte les deux règles de
`lib/server/account-identities.ts` :

- **On ne déplace jamais une porte.** Un compte dont l'identité d'un fournisseur
  est posée la garde : y rattacher une autre identité du même fournisseur est
  refusé (`PROVIDER_ALREADY_LINKED`). Une identité déjà détenue par un autre
  compte du site est refusée aussi (`IDENTITY_ALREADY_LINKED`) — le `SELECT`
  donne le refus lisible, l'index unique tranche la course.
- **On ne mure jamais la dernière.** Le site n'a pas de mot de passe et aucune
  récupération par courriel : retirer le seul moyen d'entrer ne délie pas un
  compte, il le ferme. La règle vit dans le module pur
  (`lib/shared/account-connections.ts`), partagé par l'écran — qui met la phrase
  à la place du bouton — et par la route, qui répond **409** (la demande est
  légitime, c'est l'état du compte qui s'y oppose).

Le rattachement **quitte la page** : il demande un aller-retour chez le
fournisseur, donc une navigation vers `/api/auth/<slug>/start?intent=link`, et le
retour atterrit sur `/profil?connected=<slug>` ou `?connection_error=<code>`.
L'URL est nettoyée après lecture, sans quoi un rafraîchissement rejouerait le
message.

**Détacher Discord efface la certification et garde le tag.** La certification
atteste que le compte Discord appartient au joueur ; la preuve venant de partir,
la laisser exposerait à l'organisation un tag que plus rien ne couvre. Le tag
redevient une saisie ordinaire — invisible de tous, administrateurs compris. Le
BattleTag, lui, survit au détachement de Blizzard : il n'est ni une porte
d'entrée ni une attestation.

## Pièges

**L'intention est scellée à l'aller.** `LOGIN` ouvre une session, `LINK` rattache
au compte connecté ; la valeur vit dans le cookie d'état, jamais dans l'URL du
rappel. Lue là, elle serait choisie par l'appelant, et un `intent` retourné en
`LOGIN` transformerait un rattachement en **changement de session** — le joueur
croyait ajouter un moyen de connexion, il vient d'en ouvrir une autre.

**La session est relue au retour.** Dix minutes séparent l'aller du retour.
Rattacher sur la seule foi du cookie d'état poserait une porte d'entrée sur un
compte que plus rien ne prouve être celui de l'appelant. Le contrôle de l'aller
n'est pas inutile pour autant : il évite de promener quelqu'un chez Discord pour
lui annoncer au retour qu'il n'était pas connecté.

**Un seul cookie pour trois portes** (`bg_oauth`, dix minutes). C'est le champ
`provider` qui empêche de les confondre : sans lui, un état obtenu sur la porte
Google serait recevable sur le rappel de Blizzard. Le cookie n'est **pas signé**
— assumé : le `state` ne vaut que par son égalité avec celui de l'URL, et la
destination est refiltrée à la sortie (`lib/shared/safe-redirect.ts`).

**Le cookie se consomme toujours**, même quand le rappel est inexploitable : un
état qui a échoué resterait sinon rejouable dix minutes durant.

**Deux comptes pour une personne, désormais possible.** Un joueur entré par
Discord qui se connecte ensuite par Google obtient un compte **distinct** — c'est
le prix de l'abandon du rattachement par adresse. Le rapprochement se fait depuis
« Applications connectées », en étant connecté au compte qu'on veut garder.

**`normalizeDiscordHandle` refuse un pseudo tout en chiffres.** Un pseudo Discord
peut légitimement n'être composé que de chiffres ; il ne sera alors pas certifié.
Le refus va dans le sens prudent (rien n'est publié à l'arbitrage) et le
rattachement aboutit quand même.

## Fichiers

| Rôle | Fichier |
| --- | --- |
| Registre des fournisseurs (pur) | `lib/shared/oauth-providers.ts` |
| Règles de rattachement/détachement (pur) | `lib/shared/account-connections.ts` |
| Aller-retour, partagé par les trois | `lib/server/oauth-flow.ts` |
| Cookie d'état | `lib/server/oauth-state.ts` |
| Clients | `lib/server/{google,discord,blizzard}-oauth.ts` |
| Service de rattachement | `lib/server/account-identities.ts` |
| Création de compte | `lib/server/users-service.ts` (`createOrGet*User`) |
| Routes | `app/api/auth/<slug>/{start,callback}/route.ts` |
| API du profil | `app/api/profile/connections/{route.ts,[provider]/route.ts}` |
| Écrans | `app/connexion/_components/OAuthButtons.tsx`, `app/(secured)/profil/ConnectedAppsSection.tsx` |
| Refus en français | `app/connexion/_lib/login-errors.ts`, `app/(secured)/profil/connection-errors.ts` |

## Configuration

```env
# Discord — la même application que le bot en pratique
DISCORD_AUTH_CLIENT_ID=       # app de connexion ; à défaut, DISCORD_BOT_CLIENT_ID
DISCORD_CLIENT_SECRET=        # obligatoire
DISCORD_REDIRECT_URI=         # facultatif : déduit d'APP_URL

# Blizzard — https://develop.battle.net/access/clients
BLIZZARD_CLIENT_ID=
BLIZZARD_CLIENT_SECRET=
BLIZZARD_REDIRECT_URI=        # facultatif : déduit d'APP_URL
BLIZZARD_REGION=              # facultatif : « cn » uniquement, sinon origine mondiale
```

Les adresses de rappel doivent être déclarées **à l'identique** côté fournisseur :
`<APP_URL>/api/auth/discord/callback` et `<APP_URL>/api/auth/blizzard/callback`.

Un fournisseur non configuré n'est pas masqué : son bouton renvoie
`/connexion?error=not_configured&provider=<slug>`, qui dit que la panne est chez
nous et invite à passer par une autre porte.
