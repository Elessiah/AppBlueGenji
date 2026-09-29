# Manifeste d'application web

`/manifest.webmanifest` rend le site **installable** (écran d'accueil sur mobile, fenêtre à part sur ordinateur).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `lib/shared/web-manifest.ts` | Contenu du manifeste (pur) : nom, couleurs, icônes, raccourcis |
| `app/manifest.ts` | Route Next — `<link rel="manifest">` est posé seul dans le `<head>` |
| `public/icons/icon-192.png`, `icon-512.png` | Icônes `any`, logo transparent |
| `public/icons/icon-maskable-512.png` | Icône `maskable` : logo à 72 % du côté sur `--cyber-bg`, dans la zone sûre de 80 % d'Android |
| `public/screenshots/home-wide.webp`, `home-narrow.webp` | Captures de l'invite d'installation (1280 × 800 et 780 × 1688) |
| `lib/shared/apple-startup-images.ts` | Écrans de lancement iOS (pur) : un écran par entrée, `media` et dimensions |
| `app/apple-startup/[file]/route.ts` + `lib/server/apple-startup-image.ts` | Rendu des écrans de lancement, à la compilation |
| `app/layout.tsx` | `viewport.themeColor` (même couleur), `appleWebApp.title` (nom sous l'icône iOS) et `appleWebApp.startupImage` |

## Choix

- **`display: "minimal-ui"`, jamais `standalone`** : en mode autonome, iOS donne à l'app installée ses propres cookies et ouvre l'aller-retour OAuth (Google, Discord, Blizzard) dans une feuille Safari qui ne les partage pas — `bg_oauth` manque au rappel, ou la session reste dans la feuille. Jusqu'à iOS 18, iOS ne connaît pas `minimal-ui` et ouvre l'icône dans Safari ; **depuis iOS 26**, l'ajout coche par défaut « Ouvrir en tant qu'app web », qui impose le mode autonome quel que soit le manifeste — le manifeste réduit le risque, il ne le supprime pas. Chrome et Android installent l'app dans une fenêtre avec retour et rechargement. Pour la même raison, pas de `appleWebApp.capable`.
- **Si le mode autonome est imposé quand même** (réglage par défaut d'iOS 26, navigateur intégré d'une application) : `/connexion` le détecte (`lib/shared/login-environment.ts` — `navigator.standalone`, `display-mode`, jetons d'agent utilisateur) et affiche **avant le clic** un avertissement au-dessus des boutons OAuth (`loginEnvironmentNotice`, note reliée à chaque bouton par `aria-describedby`) : dans l'app iOS, la redirection d'erreur s'ouvre dans une feuille Safari qui ne se sait plus installée, si bien que prévenir au retour est impossible. Dans un navigateur intégré, où l'erreur revient au même endroit, un refus `state`, `oauth`, `params` ou `session` reçoit en plus le conseil (`oauthErrorMessage(kind, provider, environment)`).
- **Captures d'écran** : une large, une étroite — sans elles, Chrome et Android n'offrent que l'invite minimale (icône et nom). C'est l'accueil tel qu'un visiteur l'ouvre, **sans** la banderole ni la modale de recrutement : une annonce datée y resterait des mois après son retrait. WebP, bornes de Chrome tenues par le test (côtés de 320 à 3840 px, rapport ≤ 2,3).
- **Écrans de lancement iOS** : quand iOS ouvre l'app en mode autonome (défaut d'iOS 26), il affiche l'image dont le `media` correspond **exactement** à l'écran et à l'orientation, et du blanc s'il n'en trouve aucune — il ne redimensionne rien. D'où une image par écran (iPhone XR et au-delà, SE 2ᵉ gén., iPad pris en charge) et par orientation : fond `--cyber-bg`, logo au centre (30 % du petit côté). Ce ne sont **pas** des fichiers du dépôt — quarante PNG à régénérer à chaque changement de logo dériveraient — mais une route rendue **à la compilation** (`force-static`, `dynamicParams = false` : une taille absente de la liste répond 404). `device-width`/`device-height` restent ceux du portrait dans le `media` du paysage, c'est `orientation` qui départage. Un nouvel iPhone = une entrée dans `APPLE_SCREENS`. Toujours pas de `capable` : les images ne servent que quand iOS impose le mode autonome.
- **Couleurs = `--cyber-bg` (`#05060a`)** : écran de lancement et barre d'état se fondent dans la première page peinte.
- **Un seul service worker, et aucun cache du site** : `public/push-sw.js` porte les notifications push **et** la page hors ligne. Posé pour tout visiteur (`components/service-worker-registration.tsx`, même chemin et même portée que l'abonnement push, donc un seul enregistrement), il n'intercepte que les **navigations**, les envoie au réseau (préchargement de navigation activé) et ne rend `public/offline.html` que si le réseau a **échoué** — une 404 ou une 500 reste la réponse du serveur. Cette page statique (aucun script, aucune ressource externe, styles en ligne admis par `style-src 'unsafe-inline'`) est le **seul** fichier en cache : un cache des pages servirait un plateau de tournoi périmé à qui croit le lire en direct. Son bouton « Réessayer » est un lien vide, qui recharge l'adresse demandée. Modifier `offline.html` = avancer `OFFLINE_CACHE` dans le service worker (l'ancien cache est effacé à l'activation). Sans cela, l'app installée, qui n'a pas de barre d'adresse, restait sur la page d'erreur du navigateur.
- **Raccourcis** : Tournois, Équipes, Mon profil. Pages protégées : sans session, elles affichent la carte « Connexion requise », rien n'est exposé.
- **Middleware** : `.webmanifest` est exclu du `matcher`, comme les autres fichiers statiques — une CSP n'a rien à dire d'un JSON.
- CSP : `manifest-src 'self'` était déjà posée.

## Régénérer les icônes

Depuis `public/logo_bg.webp` (701 × 701, transparent), avec `sharp` :

```js
const sharp = require("sharp");
for (const s of [192, 512]) await sharp("public/logo_bg.webp").resize(s, s).png().toFile(`public/icons/icon-${s}.png`);
const logo = await sharp("public/logo_bg.webp").resize(369, 369).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#05060a" } })
  .composite([{ input: logo, gravity: "center" }]).png().toFile("public/icons/icon-maskable-512.png");
```

## Refaire les captures d'écran

À refaire quand l'accueil change. Depuis la production, avec le Chromium de Playwright (`npm run e2e:install`) : fenêtres de 1280 × 800 (densité 1) et de 390 × 844 (densité 2, `isMobile`), `/api/visits` intercepté pour ne pas compter la capture comme une visite, modale (« Plus tard ») et banderole (« Fermer la banderole de recrutement ») de recrutement fermées, **sans** `reducedMotion` — il ferait paraître le témoin « Mode éco », qu'un visiteur ne voit pas. Puis `sharp(png).webp({ quality: 82 })` vers `public/screenshots/`, et reporter les dimensions dans `APP_SCREENSHOTS` si elles changent.
