/**
 * L'image d'aperçu des liens partagés — la carte que Discord, Twitter ou
 * Messages affichent au-dessus du titre.
 *
 * Un encart sans image se réduit à trois lignes de texte grises dans un salon ;
 * avec image, il occupe la largeur du salon et se reconnaît au coup d'œil. Le
 * site n'en avait aucune, ni pour la vitrine ni pour les tournois.
 *
 * **Ce n'est pas un composant de l'application.** Il n'est jamais monté dans le
 * navigateur : il est rendu par Satori (`next/og`) en PNG, côté serveur. D'où
 * les contraintes du fichier, qui ne sont pas des maladresses :
 *
 * - tout est en `display: flex` — Satori n'implémente ni le flux normal ni la
 *   grille, et un `<div>` à plusieurs enfants sans `display` explicite lève ;
 * - les couleurs sont écrites en dur plutôt qu'en `var(--cyber-bg)` : la
 *   feuille de style du site n'est pas chargée pendant le rendu, une variable
 *   CSS s'y résoudrait en rien ;
 * - la police est celle que `next/og` embarque, et les valeurs sont en pixels
 *   absolus — il n'y a ni viewport ni utilisateur à qui s'adapter.
 */
import type { ReactElement } from "react";

/** Format canonique d'une image d'aperçu (1,91:1), attendu par Open Graph. */
export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

/** Type MIME du rendu, repris tel quel par les routes `opengraph-image`. */
export const SHARE_CARD_CONTENT_TYPE = "image/png";

/** Palette de la carte, figée ici : voir l'en-tête du module. */
const COLORS = {
  background: "#05070c",
  glow: "#0d2740",
  ink: "#eaf2ff",
  inkMute: "#93a7c4",
  accent: "#5ac8ff",
  line: "rgba(90, 200, 255, 0.22)",
} as const;

export type ShareCardFact = { label: string; value: string };

export type ShareCardProps = {
  /** Surtitre en petites capitales : l'état, la rubrique. */
  eyebrow: string;
  /** Le titre, seule ligne que le lecteur retient. */
  title: string;
  /** Une ligne d'accroche sous le titre. Omise si vide. */
  subtitle?: string;
  /** Faits étiquetés alignés en pied de carte. Au plus trois tiennent. */
  facts?: ShareCardFact[];
};

/**
 * Taille du titre selon sa longueur.
 *
 * Un nom de tournoi va de « OW Cup » à soixante caractères. À taille fixe, le
 * premier flotte au milieu du vide et le second déborde de la carte — Satori ne
 * sait pas rétrécir un texte pour qu'il tienne.
 */
function titleFontSize(title: string): number {
  if (title.length <= 28) return 72;
  if (title.length <= 44) return 60;
  if (title.length <= 64) return 50;
  return 42;
}

/** La carte, prête à être passée à `ImageResponse`. */
export function ShareCard({ eyebrow, title, subtitle, facts = [] }: ShareCardProps): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        // Satori ne coupe pas dans un mot : un nom d'une seule pièce plus large
        // que la carte en sortirait, et le PNG le montrerait tronqué au bord.
        overflow: "hidden",
        padding: "64px 72px",
        backgroundColor: COLORS.background,
        // Deux halos plutôt qu'un aplat : la carte reste sombre mais cesse
        // d'être un rectangle noir uni au milieu d'un salon Discord.
        backgroundImage: `radial-gradient(900px 460px at 88% -12%, ${COLORS.glow} 0%, ${COLORS.background} 62%), radial-gradient(700px 400px at -10% 110%, #0a1c2e 0%, ${COLORS.background} 60%)`,
        color: COLORS.ink,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: COLORS.accent,
            }}
          />
          <div
            style={{
              marginLeft: 16,
              fontSize: 26,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: COLORS.accent,
            }}
          >
            {eyebrow}
          </div>
        </div>

        <div
          style={{
            marginTop: 34,
            fontSize: titleFontSize(title),
            lineHeight: 1.1,
            fontWeight: 700,
            wordBreak: "break-word",
            // Satori ne coupe pas les mots : un nom d'équipe sans espace
            // déborderait sans cette limite de lignes.
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 3,
            overflow: "hidden",
          }}
        >
          {title}
        </div>

        {subtitle ? (
          <div
            style={{
              marginTop: 24,
              fontSize: 30,
              lineHeight: 1.35,
              color: COLORS.inkMute,
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {facts.length > 0 ? (
          <div style={{ display: "flex", marginBottom: 36 }}>
            {facts.map((fact) => (
              <div
                key={fact.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  marginRight: 56,
                  maxWidth: 420,
                }}
              >
                <div
                  style={{
                    fontSize: 20,
                    letterSpacing: 3,
                    textTransform: "uppercase",
                    color: COLORS.inkMute,
                  }}
                >
                  {fact.label}
                </div>
                <div style={{ marginTop: 10, fontSize: 30, color: COLORS.ink }}>{fact.value}</div>
              </div>
            ))}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 28,
            borderTop: `2px solid ${COLORS.line}`,
          }}
        >
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: 2 }}>
            BLUEGENJI
          </div>
          <div style={{ display: "flex", fontSize: 24, color: COLORS.inkMute }}>
            Association loi 1901
          </div>
        </div>
      </div>
    </div>
  );
}
