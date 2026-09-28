# Manifeste d'application web

`/manifest.webmanifest` rend le site **installable** (écran d'accueil sur mobile, fenêtre à part sur ordinateur).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `lib/shared/web-manifest.ts` | Contenu du manifeste (pur) : nom, couleurs, icônes, raccourcis |
| `app/manifest.ts` | Route Next — `<link rel="manifest">` est posé seul dans le `<head>` |
| `public/icons/icon-192.png`, `icon-512.png` | Icônes `any`, logo transparent |
| `public/icons/icon-maskable-512.png` | Icône `maskable` : logo à 72 % du côté sur `--cyber-bg`, dans la zone sûre de 80 % d'Android |
| `app/layout.tsx` | `viewport.themeColor` (même couleur) et `appleWebApp.title` (nom sous l'icône iOS) |

## Choix

- **`display: "minimal-ui"`, jamais `standalone`** : en mode autonome, iOS donne à l'app installée ses propres cookies et ouvre l'aller-retour OAuth (Google, Discord, Blizzard) dans une feuille Safari qui ne les partage pas — `bg_oauth` manque au rappel, ou la session reste dans la feuille. iOS ne connaît pas `minimal-ui` et ouvre l'icône dans Safari ; Chrome et Android installent l'app dans une fenêtre avec retour et rechargement. Pour la même raison, pas de `appleWebApp.capable`.
- **Couleurs = `--cyber-bg` (`#05060a`)** : écran de lancement et barre d'état se fondent dans la première page peinte.
- **Aucun service worker** : l'installation n'en exige plus, et un cache hors ligne servirait un plateau de tournoi périmé à qui croit le lire en direct.
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
