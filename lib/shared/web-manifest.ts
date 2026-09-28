import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "./share-metadata";

/**
 * Manifeste d'application web (`/manifest.webmanifest`).
 *
 * Il fait du site une application **installable** — écran d'accueil sur
 * mobile, fenêtre à part sur ordinateur — et donne au navigateur ce qu'il ne
 * peut pas deviner : le nom court sous l'icône, la couleur de la barre d'état,
 * l'écran de lancement. Aucun service worker n'est posé : l'installation n'en
 * exige plus, et un cache hors ligne servirait un plateau de tournoi périmé à
 * qui croit le lire en direct.
 *
 * Les couleurs sont celles du fond « Cyber minimal » (`--cyber-bg`) : l'écran
 * de lancement et la barre d'état se fondent ainsi dans la première page
 * peinte, au lieu d'un éclair blanc entre les deux.
 */

/** `--cyber-bg` — fond du site, écran de lancement et barre d'état. */
export const APP_BACKGROUND_COLOR = "#05060a";

/**
 * `minimal-ui`, et pas `standalone` : les connexions Google, Discord et
 * Blizzard sortent du site puis y reviennent. En `standalone`, iOS donne à
 * l'app installée un stock de cookies à elle et ouvre l'aller-retour OAuth
 * dans une feuille Safari qui ne le partage pas — le cookie d'état posé au
 * départ manque au rappel, ou la session atterrit dans la feuille et l'app
 * reste déconnectée. iOS ne connaît pas `minimal-ui` et ouvre alors l'icône
 * dans Safari, où la connexion marche ; Chrome et Android installent quand
 * même l'app, dans une fenêtre qui garde retour et rechargement.
 */
export const APP_DISPLAY = "minimal-ui" as const;

/** Nom affiché sous l'icône, là où « BlueGenji Esport » serait tronqué. */
export const APP_SHORT_NAME = "BlueGenji";

/**
 * Icônes du manifeste, fichiers de `public/icons/`.
 *
 * Deux usages distincts, jamais une icône pour les deux : `any` garde la
 * transparence du logo, `maskable` le pose sur le fond du site avec une marge
 * (logo à 72 % du côté) pour survivre au rognage en cercle ou en goutte
 * d'Android, dont la zone sûre est un disque de 80 %.
 */
export const APP_ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
] as const satisfies MetadataRoute.Manifest["icons"];

/**
 * Raccourcis de l'icône installée (appui long, clic droit). Des pages que l'on
 * ouvre pour agir, pas la vitrine ; une page protégée affiche sa carte
 * « Connexion requise » à un lecteur sans session, rien n'y est donc exposé.
 */
export const APP_SHORTCUTS = [
  { name: "Tournois", url: "/tournois" },
  { name: "Équipes", url: "/equipes" },
  { name: "Mon profil", url: "/profil" },
] as const;

export function buildWebManifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_NAME,
    short_name: APP_SHORT_NAME,
    description: SITE_DESCRIPTION,
    lang: "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: APP_DISPLAY,
    orientation: "any",
    background_color: APP_BACKGROUND_COLOR,
    theme_color: APP_BACKGROUND_COLOR,
    categories: ["sports", "games", "entertainment"],
    icons: APP_ICONS.map((icon) => ({ ...icon })),
    shortcuts: APP_SHORTCUTS.map((shortcut) => ({
      ...shortcut,
      icons: [{ src: APP_ICONS[0].src, sizes: APP_ICONS[0].sizes, type: APP_ICONS[0].type }],
    })),
  };
}
