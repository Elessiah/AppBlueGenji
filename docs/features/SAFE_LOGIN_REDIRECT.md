# Destination d'après connexion

`/connexion` lit un `?redirect=` pour ramener le visiteur là où il allait — une
fiche de tournoi partagée, par exemple : c'est `AuthGate` qui le pose quand
l'espace sécurisé refuse une page à un visiteur non connecté.

- Décision pure : `lib/shared/safe-redirect.ts`
- Portes : `app/connexion/_components/LoginForm.tsx`, `app/api/auth/google/start/route.ts`,
  `app/api/auth/google/callback/route.ts`

## Le défaut

La valeur n'était contrôlée nulle part. `/connexion?redirect=https://exemple.invalid`
déposait donc l'utilisateur **hors du site** une fois authentifié : une
**redirection ouverte**, l'appât classique du hameçonnage — le lien porte le vrai
domaine, mène à la vraie page de connexion, et n'emmène ailleurs qu'après coup,
quand la confiance est acquise (et la page d'arrivée peut alors réclamer un
« nouveau » mot de passe, ou n'importe quoi d'autre).

La voie Google le reproduisait à l'identique. La destination y traverse le
cookie d'état OAuth et ressortait par :

```ts
new URL(cookieState.redirectTo || "/tournois", base)
```

Une base ne borne rien : `new URL` **l'ignore** dès que la valeur est une URL
absolue. `new URL("https://exemple.invalid", "https://bluegenji.example")` vaut
`https://exemple.invalid`.

## La règle

N'est accepté qu'un **chemin du site** : une chaîne commençant par une seule
barre. Sont refusés, et remplacés par `/tournois` :

| Entrée | Pourquoi |
|---|---|
| `https://exemple.invalid` | URL absolue — le cas d'origine |
| `//exemple.invalid` | protocole-relative : change de domaine sans nommer de schéma |
| `/\exemple.invalid` | même chose : les navigateurs lisent `/\` comme `//` |
| `javascript:alert(1)` | schéma exécutable — ne commence pas par `/` |
| `tournois`, `../admin` | relatif : se résout contre la page courante |
| `/‹CTRL›/exemple.invalid` | tabulation, saut de ligne, retour chariot |
| `/en//exemple.invalid`, `/regles//x` | `//` **n'importe où** dans le chemin : le préfixe de langue, retiré puis reposé, le démasquerait (lot 6) |
| `/en/\exemple.invalid` | contre-barre n'importe où dans le chemin (lue comme une barre) |
| `/en/%2F%2Fexemple.invalid`, `%5C` | barre ou contre-barre encodée, qu'un relais peut décoder |
| tout ce qui n'est pas une chaîne | paramètre absent, tableau, objet |

Le dernier cas de refus n'est pas une précaution de forme : les navigateurs
**retirent** `\t`, `\n` et `\r` d'une URL avant de la résoudre, si bien que
`/‹LF›/exemple.invalid` passerait le test « une seule barre » puis deviendrait
`//exemple.invalid`. On refuse plutôt que de nettoyer — une destination
légitime n'en contient jamais.

Ce qui passe garde sa requête et son fragment (`/tournois/12?phase=2`,
`/tournois/12#match-42`) : c'est tout le contexte du lien partagé. Les trois
derniers refus ne lisent que le **chemin** : une requête peut porter une adresse
(`/tournois?retour=https://…`).

## Langue (lot 6)

La page existe aussi sous `/en/connexion` (`docs/features/I18N.md` § Connexion).
La destination revient **dans la langue de la page de connexion** :
`loginDestination(value, locale)` = `localeHref(safeRedirectPath(value), locale)`
— `/en/connexion?redirect=/regles` ramène sur `/en/regles`, une route pas encore
traduite reste française (`/tournois`), un visiteur français reste français.

- **Voie Discord** : la page calcule `loginDestination` et navigue par
  `useLocaleRouter` (chargement complet si la langue change).
- **Voie OAuth** : les boutons ajoutent `lang=en` à la route de départ
  (`oauthStartPath(…, { locale })`). L'aller **scelle** la destination dans
  cette langue (`sealedReturnPath` : `/en/tournois`, préfixe compris même pour
  une route pas encore traduite) ; le retour relit la langue dans cette
  destination (`sealedReturnLocale`), renvoie un refus sur `/en/connexion` et une
  réussite sur `loginDestination(saved.redirectTo, locale)`. Le cookie `bg_oauth`
  ne gagne **aucun champ** (ce que `/rgpd` en dit, « la page où vous ramener »,
  reste exact), et l'**adresse de rappel** enregistrée chez Google, Discord et
  Blizzard (`/api/auth/<slug>/callback`) ne change pas. Sans cookie d'état
  lisible au retour (expiré, contexte qui l'isole), la langue n'est plus connue :
  le refus revient sur `/connexion`, en français.
- **Visiteur déjà connecté** : `signedInLoginRedirect` compare la destination
  **sans préfixe** (`/en/connexion` est la page elle-même) ; la page la rend
  ensuite dans sa langue (`localeHref`).

## Trois portes, pas une

La valeur franchit trois seuils, et chacun filtre :

1. **`/connexion`** (et `/en/connexion`) — le paramètre d'URL, pour la voie Discord (`router.push`) ;
2. **l'aller OAuth** (`/api/auth/google/start`) — avant de l'écrire dans le
   cookie d'état ;
3. **le retour OAuth** (`/api/auth/google/callback`) — en la relisant.

Filtrer à l'aller ne suffit pas : le cookie d'état n'est pas signé, il ne fait
pas foi. Et filtrer au seul retour laisserait une valeur hostile voyager dans un
cookie. La fonction étant l'unique implémentation, les trois disent la même
chose.

`AuthGate`, lui, n'a rien à filtrer : sa destination vient de `usePathname()`,
pas d'un paramètre — elle ne peut désigner qu'un chemin du site. Le filtre la
laisse passer telle quelle. Préfixe de langue compris, et son lien passe par
`LocaleLink` : la page de connexion est celle de la langue lue.

## Visiteur déjà connecté

Un compte connecté qui ouvrait `/connexion` voyait le formulaire et la modale
d'entrée d'un nouveau compte, sans que rien ne lui dise qu'il avait une
session. `app/connexion/page.tsx` le redirige désormais, côté serveur et avant
tout rendu, par `signedInLoginRedirect` : la destination demandée
(`?redirect=`, filtrée par `safeRedirectPath` comme aux trois portes), ou
`/tournois`. Une destination qui ramène à `/connexion` elle-même est écartée —
la page se redirigerait vers elle-même à l'infini.

Exception : un compte connecté qui arrive avec `?error=` reste sur la page, qui
annonce le refus. Un rattachement OAuth raté avant la lecture de son intention
(`params`, `state`) retombe encore ici plutôt que sur `/profil` (consigné dans
`ERREUR.txt`), et le rediriger ferait disparaître le message.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Destination d'après connexion** (`lib/shared/safe-redirect.ts` pur) : le `?redirect=` de `/connexion` n'était contrôlé nulle part — `/connexion?redirect=https://exemple.invalid` déposait l'utilisateur **hors du site** une fois authentifié (redirection ouverte, l'appât classique du hameçonnage : vrai domaine, vraie page de connexion, et l'on ne part ailleurs qu'une fois la confiance acquise). La voie Google la reproduisait, la valeur traversant le cookie d'état OAuth pour ressortir par `new URL(redirectTo, base)` — **une base ne borne rien**, `new URL` l'ignore dès que la valeur est absolue. N'est accepté qu'un **chemin du site** : une seule barre en tête, donc ni `//exemple.invalid` (protocole-relative) ni `/\exemple.invalid` (que les navigateurs lisent pareil) ni un schéma exécutable ni un chemin relatif ; refus aussi de tout **caractère de contrôle** — les navigateurs retirent tabulation, saut de ligne et retour chariot avant de résoudre une URL, si bien qu'un saut de ligne glissé après la barre ferait redevenir `/…/exemple.invalid` une adresse protocole-relative. Filtré aux **trois** portes : la page de connexion, l'aller OAuth (avant écriture du cookie d'état) et le retour OAuth (le cookie n'est pas signé, il ne fait pas foi). `AuthGate` n'a rien à filtrer, sa destination venant de `usePathname()`. Voir `docs/features/SAFE_LOGIN_REDIRECT.md`.
