# Avatars — jamais une origine étrangère

## Le défaut

`createOrGetGoogleUser` rangeait l'URL de `picture` telle quelle dans
`bg_users.avatar_url`, et `UserAvatar` la rendait avec le drapeau `unoptimized`.
Conséquence : chaque page portant cet avatar faisait partir une requête du
navigateur du **visiteur** vers `lh3.googleusercontent.com`.

Ce n'est pas l'IP du titulaire du compte qui partait — c'est celle de **qui
regarde**, à chaque vue, sur l'en-tête de navigation comme sur une fiche de
joueur ou le roster d'une équipe. Le `referrerPolicy="no-referrer"` déjà posé ne
couvrait que le référent, pas la requête elle-même.

Le site avait pourtant déjà tranché la question, pour les logos partenaires :
**le `src` d'une image est toujours une adresse du site**
(`SPONSOR_LOGO_PROXY.md`). Les avatars y échappaient, et aucune lecture du code
ne l'avait montré — `next.config.ts` ne déclare aucun `remotePatterns`, ce dont
on pouvait conclure qu'aucune image distante n'était rendue. C'est faux :
`unoptimized` **court-circuite entièrement cette vérification**. Le mode rapport
de la CSP l'a signalé au premier chargement.

Second point, découvert en corrigeant : le logo d'une **entrée solo** est une
copie de l'avatar du joueur (`solo-entries-service.ts`). L'URL Google se
recopiait donc dans `bg_teams.logo_url`, d'où elle était rendue par les
composants de logo d'équipe — qui ne passent par aucune des gardes d'avatar.

## Copier, plutôt que relayer

Les logos partenaires sont **relayés** à chaque affichage
(`/api/landing/sponsors/[id]/logo`). Les avatars sont **copiés une fois**, à la
connexion. Trois raisons, et aucune ne vaut pour les partenaires :

- un logo partenaire est modifiable à tout moment par le staff et doit suivre ;
  une photo de profil est acquise à la connexion ;
- ils sont six, quand les comptes sont des milliers — un relais par affichage
  ferait un aller-retour serveur par avatar et par page ;
- un avatar est soumis à un **réglage de visibilité** (`visible_avatar`), qu'une
  route publique `/api/users/<id>/avatar` aurait dû réimplémenter. Une seconde
  porte à tenir, là où `visibleAvatarUrl` est justement l'unique passage.

Copié, l'avatar redevient un fichier d'upload ordinaire : même dossier
(`public/uploads/avatars`), même service (`/api/uploads/…`), même
redimensionnement et même cache qu'un avatar téléversé depuis `/profil`.

## Les modules

| Module | Rôle |
|---|---|
| `lib/shared/remote-image.ts` | Ce qu'une URL étrangère doit franchir : `https` seul, filtre d'hôte (bouclage, réseaux privés, CGNAT, lien-local, `169.254.169.254`), liste blanche de types d'image (**pas de SVG** : c'est un document scriptable). |
| `lib/server/remote-image-fetch.ts` | Le téléchargement durci : redirections suivies **à la main** avec revalidation de l'hôte à chaque saut, délai couvrant aussi la lecture du corps, plafond de taille avant et après lecture. |
| `lib/server/user-avatar-import.ts` | `shouldImportGoogleAvatar` (faut-il copier ?) et `importRemoteAvatar` (copier, sans jamais lever). |
| `lib/shared/avatar.ts` | `isLocalAvatarUrl` et `visibleAvatarUrl` : la garantie, posée à la sortie. |
| `lib/server/backfill-avatars.ts` | `npm run backfill:avatars`, pour les comptes d'avant. |

Les deux premiers sont **extraits** du relais partenaires, qui les portait sous
des noms parlant de logos ; `sponsor-logo.ts` les réexporte sous ses anciens
noms. Deux copies auraient divergé, et la divergence se serait vue du mauvais
côté — celui où une garde manque.

## La garantie est posée à la sortie — aux **deux** portes

`visibleAvatarUrl` est la dernière porte que franchit un avatar avant
d'atteindre un client : quatre modules serveur l'appellent, c'est déjà là que
vit le réglage de visibilité. Une URL qui n'est pas un fichier à nous y rend
**`null`**, et l'écran retombe sur la pastille à initiale.

Mais ce n'est pas la seule. **`getCurrentUser` en est une seconde**, et elle ne
consulte pas la visibilité — à raison : c'est son propre avatar que le titulaire
voit dans la barre de navigation et dans l'en-tête public. Elle passe donc par
`localAvatarUrl`, qui pose la même règle d'origine sans la question de la
visibilité. Les deux descendent d'`isLocalAvatarUrl` : « cette adresse est-elle
la nôtre » n'a qu'une réponse.

Oublier cette seconde porte n'aurait pas laissé une fuite, mais fabriqué une
**panne** : `unoptimized` retiré, `next/image` lève sur une origine absente de
`remotePatterns` — toutes les pages d'un compte dont l'avatar est resté une URL
Google auraient cassé.

Filtrer au rendu aurait fait dépendre la règle du prochain écran écrit. Posée
là, elle est totale : il n'existe pas de chemin par lequel une adresse étrangère
sorte du serveur dans un champ d'avatar.

## Sept rendus, pas quatre

`UserAvatar` se présente comme le passage unique des avatars, et il ne l'est
pas : **trois écrans appellent `<Image>` directement**, chacun avec son
`unoptimized` — la carte d'équipe (roster), la section des membres d'une fiche
d'équipe, et la carte d'annuaire d'un joueur. Ils rendaient donc des URL Google
exactement comme les quatre autres.

Le drapeau est retiré des sept. Il ne reste que sur le **logo d'équipe** de la
carte d'annuaire : `bg_teams.logo_url` n'a pas d'équivalent de
`visibleAvatarUrl` pour lui garantir une origine (voir `ERREUR.txt`).

Corollaire utile : les avatars profitent enfin du redimensionnement, du WebP et
du cache long — et `next/image` **lèverait** si une origine étrangère
réapparaissait, ce qui est le bon comportement pour une régression de ce genre.
Un test de source garde les trois rendus directs, qu'aucun test de rendu ne
couvre.

## Ce qui déclenche une copie

`shouldImportGoogleAvatar` répond oui quand l'avatar en place **n'est pas** un
fichier à nous :

- compte sans avatar → copie ;
- compte dont `avatar_url` porte encore une URL Google → copie, donc les comptes
  d'avant la correction se réparent d'eux-mêmes à leur prochaine connexion ;
- compte avec un avatar **téléversé** → on n'y touche pas.

Ce dernier point referme un défaut préexistant. L'ancien code écrivait
`avatar_url = COALESCE(?, avatar_url)` à **chaque** connexion Google : la photo
choisie sur `/profil` était remplacée par celle de Google au prochain passage
par le bouton de connexion. Le défaut ne pouvait pas survivre au passage à une
copie — resservir Google à chaque connexion aurait laissé un fichier orphelin
par connexion, et l'effacer aurait détruit la photo choisie.

**Contrepartie assumée** : une photo changée **côté Google** ne se propage plus
au site. Elle se change sur `/profil`, où l'on choisit déjà la sienne.

## L'import ne fait jamais échouer une connexion

`importRemoteAvatar` rend `null` plutôt que de lever, quelle que soit la cause :
hôte injoignable, format refusé (`fetchRemoteImage` admet GIF et AVIF, que
`storeImageBuffer` refuse), disque plein. Le compte est alors simplement sans
avatar — pastille à initiale — et la tentative sera refaite au prochain passage,
`shouldImportGoogleAvatar` n'ayant toujours rien de local à constater.

À la création d'un compte, la ligne est insérée avec `avatar_url` à `NULL` puis
mise à jour : le nom du fichier porte l'identifiant du compte, qui n'existe
qu'une fois la ligne écrite.

## Les comptes d'avant

```bash
NODE_ENV=production npm run backfill:avatars
```

Il est fait pour tourner **sur le serveur**, et il importe `lib/server/script-env.ts`
pour cela : `dotenv/config`, qu'emploient les autres scripts `tsx`, ne connaît que
`.env` — or la production n'en a pas, sa configuration vit dans `.env.production`,
que Next charge seul. Lancé en production le 16/09/2026 dans sa première version,
le script est mort sur `Missing required environment variable DB_HOST` avant
d'avoir rien lu. `script-env` choisit ses fichiers d'après `NODE_ENV`, que le shell
du serveur n'exporte pas (seul pm2 le pose) : d'où le préfixe, sans lequel
`.env.production` reste ignoré. Oublié, le script le dit avant de mourir
(`missingNodeEnvNotice`) — il ne se rabat **pas** seul sur la production, un poste
de développement pouvant garder un `.env.production`.

Rapatrie d'un coup les photos des comptes dont l'avatar est resté une URL
étrangère. Séquentiel à dessein — ouvrir des dizaines de connexions simultanées
chez un tiers est la façon la plus sûre de se faire plafonner au milieu du lot.
Sans danger à relancer : il ne regarde que les lignes dont l'avatar n'est pas
déjà un fichier à nous, et une ligne qu'il n'a pas su rapatrier reste dans
l'état où il l'a trouvée.

Il **resynchronise aussi les entrées solo**, et c'est son point le moins
évident : le logo d'une entrée solo est une copie de l'avatar du joueur, si bien
que l'URL étrangère s'est aussi recopiée dans `bg_teams.logo_url` — d'où elle
ressort par les composants de logo d'équipe, qui ne passent par aucune garde
d'avatar. La resynchronisation relit l'avatar au travers de `visibleAvatarUrl` :
elle repose le fichier rapatrié, ou efface le logo quand il n'y en a pas eu.
Sans elle, rapatrier l'avatar laisserait la fuite là où elle est le moins
visible.

Sans lui, rien n'est cassé : les comptes concernés affichent leur initiale
jusqu'à leur prochaine connexion.

## Effet sur la CSP

`img-src` est redevenue `'self' data: blob:`. L'hôte de Google y avait été admis
le temps d'une PR — une politique qui décrit un site qui n'existe pas ne peut
jamais être appliquée, et l'application est le but. La directive redevient donc
ce qu'elle doit être : un **détecteur**. Si un écran réintroduisait une image
tierce, le collecteur le dirait au premier chargement.

Il ne reste dès lors qu'un obstacle au passage en mode application, celui des
cinq routes prérendues (voir `CLAUDE.md`).
