# Destination d'après connexion

`/connexion` lit un `?redirect=` pour ramener le visiteur là où il allait — une
fiche de tournoi partagée, par exemple : c'est `AuthGate` qui le pose quand
l'espace sécurisé refuse une page à un visiteur non connecté.

- Décision pure : `lib/shared/safe-redirect.ts`
- Portes : `app/connexion/page.tsx`, `app/api/auth/google/start/route.ts`,
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
| tout ce qui n'est pas une chaîne | paramètre absent, tableau, objet |

Le dernier cas de refus n'est pas une précaution de forme : les navigateurs
**retirent** `\t`, `\n` et `\r` d'une URL avant de la résoudre, si bien que
`/‹LF›/exemple.invalid` passerait le test « une seule barre » puis deviendrait
`//exemple.invalid`. On refuse plutôt que de nettoyer — une destination
légitime n'en contient jamais.

Ce qui passe garde sa requête et son fragment (`/tournois/12?phase=2`,
`/tournois/12#match-42`) : c'est tout le contexte du lien partagé.

## Trois portes, pas une

La valeur franchit trois seuils, et chacun filtre :

1. **`/connexion`** — le paramètre d'URL, pour la voie Discord (`router.push`) ;
2. **l'aller OAuth** (`/api/auth/google/start`) — avant de l'écrire dans le
   cookie d'état ;
3. **le retour OAuth** (`/api/auth/google/callback`) — en la relisant.

Filtrer à l'aller ne suffit pas : le cookie d'état n'est pas signé, il ne fait
pas foi. Et filtrer au seul retour laisserait une valeur hostile voyager dans un
cookie. La fonction étant l'unique implémentation, les trois disent la même
chose.

`AuthGate`, lui, n'a rien à filtrer : sa destination vient de `usePathname()`,
pas d'un paramètre — elle ne peut désigner qu'un chemin du site. Le filtre la
laisse passer telle quelle.
