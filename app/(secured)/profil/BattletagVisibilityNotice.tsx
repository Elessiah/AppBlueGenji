"use client";

import { createPortal } from "react-dom";
import { CyberButton } from "@/components/cyber/CyberButton";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { richNodes } from "@/components/i18n/shell-text";
import { useProfileText } from "@/components/i18n/profile-text";

/**
 * Ce que masquer le BattleTag **ne fait pas**, dit au moment où on le masque.
 *
 * La case « BattleTag OW » se lit comme un interrupteur : décochée, le joueur
 * comprend « plus personne ne le voit ». Ce n'est pas ce qu'elle signifiera —
 * le tag reste lisible de ceux qui en ont besoin pour jouer et pour arbitrer :
 * les joueurs des matchs qu'il dispute, qui s'ajoutent en jeu par lui, et
 * l'organisation des tournois où il est engagé. Un réglage qui promet plus
 * qu'il ne tient est pire qu'un réglage absent : il fait baisser la garde.
 *
 * **Une modale, et seulement à la bascule vers « masqué ».** L'information ne
 * vaut qu'au moment où elle corrige une attente — posée en permanence sous la
 * case, elle deviendrait du décor qu'on ne lit plus, et l'afficher aussi en
 * cochant n'apprendrait rien (rendre public ne surprend personne).
 *
 * **Un seul bouton**, et c'est le point : il n'y a rien à accepter ni à
 * refuser, la case est déjà décochée et le `PATCH` n'est même pas parti. C'est
 * une *information*, pas une confirmation — la déguiser en question obligerait
 * à répondre pour un geste déjà fait, et suggérerait qu'un « non » existe.
 */
export function BattletagVisibilityNotice({ onClose }: Readonly<{ onClose: () => void }>) {
  // Le focus entre dans la modale (sur son seul bouton) et Échap en sort :
  // sans cela, un lecteur d'écran resterait sur la case à cocher, et le clavier
  // n'aurait aucun moyen de refermer ce qu'il vient d'ouvrir. La pile partagée
  // verrouille aussi le défilement et piège la tabulation.
  const dialogRef = useDialogBehavior({ open: true, onClose });
  const text = useProfileText();
  const { t } = text;
  const strong = { strong: (chunks: React.ReactNode[]) => <strong>{chunks}</strong> };

  // Portée dans <body> : `/profil` rend la modale dans son `<section
  // class="fade-in">`, dont l'animation laisse un `transform` posé — la section
  // devenait la référence de `position: fixed`, et la notice se centrait au
  // milieu de la page (2 500 px de haut), hors de l'écran.
  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(4, 8, 14, 0.78)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="battletag-visibility-title"
        aria-describedby="battletag-visibility-body"
        tabIndex={-1}
        style={{
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          background: "var(--cyber-bg-1)",
          border: "1px solid var(--line-strong-cy)",
          borderRadius: "var(--r-cy-lg)",
          padding: 32,
        }}
      >
        <span className="eyebrow">{t("battletagNotice.eyebrow")}</span>
        <h2
          id="battletag-visibility-title"
          className="display"
          style={{ fontSize: 24, margin: "12px 0 16px" }}
        >
          {t("battletagNotice.title")}
        </h2>

        <div id="battletag-visibility-body">
          <p style={{ color: "var(--ink-mute)", fontSize: 14, lineHeight: 1.7, margin: "0 0 16px" }}>
            {t("battletagNotice.intro")}
          </p>

          <ul
            style={{
              color: "var(--ink-mute)",
              fontSize: 14,
              lineHeight: 1.7,
              margin: "0 0 16px",
              paddingLeft: 20,
            }}
          >
            <li>{richNodes(text.rich("battletagNotice.players", {}, strong))}</li>
            <li>{richNodes(text.rich("battletagNotice.caster", {}, strong))}</li>
            <li>{richNodes(text.rich("battletagNotice.asCaster", {}, strong))}</li>
            <li>{richNodes(text.rich("battletagNotice.staff", {}, strong))}</li>
          </ul>

          <p style={{ color: "var(--ink-dim)", fontSize: 13, lineHeight: 1.7, margin: "0 0 24px" }}>
            {t("battletagNotice.outro")}
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <CyberButton variant="primary" onClick={onClose}>
            {t("battletagNotice.ok")}
          </CyberButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
