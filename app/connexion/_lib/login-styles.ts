import type { CSSProperties } from "react";

/**
 * Aide rédigée sous un champ ou un bouton de la page de connexion.
 *
 * Ces aides étaient en JetBrains Mono 10 px, espacées et en `--ink-dim` — des
 * **paragraphes** entiers (ce que le code fait du tag, pourquoi le bot doit
 * partager un serveur, ce qu'enregistre le pseudo) rendus en police de
 * sur-titre, illisibles sur mobile. Une phrase se lit en Inter, à une taille de
 * texte courant, dans la teinte atténuée qui reste au-dessus de `--ink-dim`.
 */
export const LOGIN_HELP_TEXT_STYLE: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  lineHeight: 1.5,
  letterSpacing: "normal",
  color: "var(--ink-mute)",
};
