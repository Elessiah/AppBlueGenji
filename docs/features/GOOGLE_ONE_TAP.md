# Google One Tap

Une quatrième façon d'obtenir une identité Google, à côté de l'aller-retour
OAuth classique (`/api/auth/google/{start,callback}`) — pas un cinquième
compte, ni une cinquième colonne : les deux chemins convergent vers le même
`createOrGetOAuthUser` (`lib/server/account-identities.ts`), et un compte né
par l'un se retrouve par l'autre.

- Vérification du jeton : `lib/server/google-one-tap.ts`
- Route : `app/api/auth/google/one-tap/route.ts`
- Composant client : `components/auth/google-one-tap.tsx`, monté par
  `app/connexion/_components/LoginForm.tsx` — et **nulle part ailleurs**

## Pourquoi un second chemin

L'OAuth classique quitte le site (le navigateur part chez Google, en revient
avec un `code`) et demande un clic explicite. One Tap rend son invite
**dans** la page, sans navigation, et peut proposer la connexion au visiteur
qui a déjà une session Google ouverte dans son navigateur, sans qu'il ait
à chercher le bon bouton. Le geste que ça sert n'est pas nouveau — c'est la même porte
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

## Où ça s'affiche — et pourquoi seulement là

**Sur `/connexion`, et seulement après le consentement.** La page serveur
(`app/connexion/page.tsx`) résout ce qu'elle est seule à savoir — la session et
`GOOGLE_CLIENT_ID` — et passe au formulaire une configuration, ou `null` :

```tsx
const oneTap = !user && clientId ? { clientId, nonce } : null;
```

Le formulaire (`LoginForm`) ne monte l'invite qu'une fois la modale RGPD
**lue et acceptée** :

```tsx
{oneTap && consentRead && consentGiven && <GoogleOneTap … redirect={redirect} />}
```

`consentRead` n'est pas redondant : `consentGiven` part à `true` pour que la
modale ne clignote pas au premier rendu, si bien que monter l'invite sur lui
seul ferait partir le script chez Google avant qu'on ait lu le stockage.

### Pourquoi l'invite a quitté la mise en page racine

Elle y était montée pour **tout visiteur sans session, sur toutes les pages**.
Le navigateur de quiconque ouvrait l'accueil chargeait donc
`accounts.google.com/gsi/client` : Google recevait l'IP et la page consultée,
lisait sa propre session pour proposer « Continuer en tant que … », et pouvait
poser un cookie `g_state` **sur notre domaine** quand l'invite était fermée —
sans que personne n'ait rien demandé. Un module tiers qui accède au terminal
sans action de l'utilisateur relève du consentement (ePrivacy art. 5.3, lignes
directrices de la CNIL sur les modules sociaux), et le site est coresponsable
de ce qu'il fait charger (CJUE, *Fashion ID*). `/rgpd` promettait en outre
« aucun traceur tiers ».

Sur `/connexion`, le visiteur est venu se connecter et vient d'accepter la
politique, qui nomme désormais Google, `g_state` et cette page. Ne pas
remonter le composant ailleurs sans reprendre ce raisonnement et `/rgpd`.

### En quittant la page

Le script survit à une navigation client, et son invite avec. Le nettoyage du
composant appelle donc `google.accounts.id.cancel()` : sans lui, l'invite
suivrait le visiteur hors de `/connexion`.

## Vers où ça mène après connexion

Vers la même destination que les trois autres portes de la page : le
`redirect` que `LoginForm` a déjà filtré (`lib/shared/safe-redirect.ts`),
`/tournois` par défaut. Il est relu au moment de la réponse de Google (une
`ref`), l'invite ne s'initialisant qu'une fois alors que la page lit son
`?redirect=` dans un effet.

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

Elles restent posées sur **toutes** les pages alors que seule `/connexion`
charge l'invite : une navigation client ne relit aucun en-tête, le document
garde la politique de la page d'arrivée. Les réserver à `/connexion` casserait
l'invite pour qui y vient par un lien depuis l'accueil.

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
