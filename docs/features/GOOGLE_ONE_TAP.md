# Google One Tap

Une quatrième façon d'obtenir une identité Google, à côté de l'aller-retour
OAuth classique (`/api/auth/google/{start,callback}`) — pas un cinquième
compte, ni une cinquième colonne : les deux chemins convergent vers le même
`createOrGetOAuthUser` (`lib/server/account-identities.ts`), et un compte né
par l'un se retrouve par l'autre.

- Vérification du jeton : `lib/server/google-one-tap.ts`
- Route : `app/api/auth/google/one-tap/route.ts`
- Composant client : `components/auth/google-one-tap.tsx`, monté par
  `app/layout.tsx`

## Pourquoi un second chemin

L'OAuth classique quitte le site (le navigateur part chez Google, en revient
avec un `code`) et demande un clic explicite. One Tap rend son invite
**dans** la page, sans navigation, et peut proposer la connexion au visiteur
qui a déjà une session Google ouverte dans son navigateur, sans qu'il ait
rien à chercher. Le geste que ça sert n'est pas nouveau — c'est la même porte
Google — seulement plus court pour qui l'a déjà empruntée une fois.

## Un jeton, pas un code

L'aller-retour classique échange un `code` contre un profil, **côté
serveur**, avec le secret client en preuve. One Tap ne passe jamais par notre
serveur pour obtenir l'identité : le script
`accounts.google.com/gsi/client` rend directement au navigateur un JWT signé
(`credential`), que le site reçoit et doit vérifier **lui-même** — il n'y a
ni secret partagé ni échange à faire, la signature du jeton est toute la
preuve.

Quatre contrôles, tous obligatoires (`verifyGoogleOneTapCredential`) :

1. la **signature** RS256, contre les clés publiques que Google publie
   (`www.googleapis.com/oauth2/v3/certs`, relues au plus une fois par heure,
   vol unique) ;
2. l'**émetteur** (`iss`) ;
3. le **destinataire** (`aud`), comparé à `GOOGLE_CLIENT_ID` — c'est lui qui
   empêche un jeton émis pour un autre site Google d'ouvrir une session ici ;
4. l'**expiration** (`exp`).

Node vérifie nativement une signature RSA depuis une clé publique au format
JWK (`crypto.createPublicKey({ format: "jwk" })`) : aucune dépendance de plus
pour ça, dans un projet qui n'en prend déjà aucune pour parler à Google (voir
`google-oauth.ts`, en `fetch` brut). Les clés **tournent sans préavis** côté
Google — le module ne les épingle jamais par `kid`, il relit le jeu de clés
dès qu'un `kid` inconnu se présente.

Un jeton qui échoue n'importe lequel des quatre contrôles rend le même refus
(`GOOGLE_ONE_TAP_INVALID`) : aucun des cas n'appelle un geste différent du
joueur, qui n'a qu'à réessayer de se connecter.

## Où ça s'affiche

`app/layout.tsx` (la mise en page racine, déjà `async` pour la CSP — voir
plus bas) résout l'utilisateur courant et ne monte le composant que pour un
visiteur **sans session** :

```tsx
{!user && googleClientId && <GoogleOneTap clientId={googleClientId} nonce={nonce} />}
```

`getCurrentUser()` est mémoïsé par requête (`cache()` de React) : cet appel
ne coûte rien de plus sur les pages où `PublicHeader`/`PublicFooter` le
lisent déjà. Sans `GOOGLE_CLIENT_ID` configuré, le composant ne se monte pas
du tout — comme les boutons OAuth classiques, qui échouent proprement plutôt
que d'afficher un bouton mort.

## Vers où ça mène après connexion

Sur `/connexion`, un `?redirect=` attend d'être honoré comme pour les trois
autres portes (`lib/shared/safe-redirect.ts`). Ailleurs — la page d'accueil,
une fiche de tournoi consultée sans compte — il n'y en a pas : le composant
appelle `router.refresh()`, qui suffit à refléter la session sur place, sans
arracher le visiteur à la page qu'il regardait.

## Politique de sécurité du contenu

One Tap rend son invite dans un **cadre** (iframe) qui appartient à Google —
contrairement à l'OAuth classique, qui ne quitte jamais notre origine côté
serveur. C'est la seule iframe du site, et `lib/shared/csp.ts` l'ouvre par
son nom, à quatre endroits seulement :

- `script-src` — le script `gsi/client` (toujours sous `strict-dynamic`, donc
  encore soumis au nonce pour le premier chargement) ;
- `frame-src` — le cadre de l'invite ;
- `connect-src` — les appels que le script fait lui-même à Google ;
- `style-src` — la feuille de styles de l'invite (`gsi/style`), chargée par un
  `<link>` que `'unsafe-inline'` ne couvre pas. Constaté en la faisant
  refuser en conditions réelles, pas déduit de la documentation de Google.

Rien d'autre n'emprunte ces quatre ouvertures : un écran qui réintroduirait
une iframe ou un script tiers ailleurs se ferait toujours refuser.

## Plafond de débit

`GOOGLE_ONE_TAP_RULE` (`lib/server/api-guard.ts`) borne la route par **IP
appelante**, comme la demande de code Discord par IP
(`DISCORD_CODE_REQUEST_IP_RULE`) : la route est anonyme, aucun compte n'est
connu avant que le jeton ne soit vérifié, donc c'est le seul axe disponible.
Ce qu'il protège n'est pas une session usurpable — la signature du jeton s'en
charge — mais la **dépense** : chaque appel peut déclencher une lecture du
jeu de clés Google et, sur un jeton valide, une écriture en base.

## Ce que Google exige en dehors du code

Le `GOOGLE_CLIENT_ID` est le même que celui de l'OAuth classique — **aucune
variable d'environnement de plus**. Mais One Tap vérifie l'origine appelante
directement contre la liste des **« Authorized JavaScript origins »** de la
console Google Cloud, une case distincte des « Authorized redirect URIs »
qu'exige déjà l'échange de code. Un client Google configuré pour l'OAuth
classique seul peut donc avoir besoin d'y ajouter l'origine du site
(`https://bluegenji-esport.fr`, `http://localhost:3000` en développement)
avant que l'invite ne s'affiche.
