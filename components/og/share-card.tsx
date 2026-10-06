/**
 * L'image d'aperçu des liens partagés — la carte que Discord, Twitter ou
 * Messages affichent au-dessus du titre.
 *
 * Un encart sans image se réduit à trois lignes de texte grises dans un salon ;
 * avec image, il occupe la largeur du salon et se reconnaît au coup d'œil.
 *
 * **Ce n'est pas un composant de l'application.** Il n'est jamais monté dans le
 * navigateur : il est rendu par Satori (`next/og`) en PNG, côté serveur. D'où
 * les contraintes du fichier, qui ne sont pas des maladresses :
 *
 * - tout est en `display: flex` — Satori n'implémente ni le flux normal ni la
 *   grille, et un `<div>` à plusieurs enfants sans `display` explicite lève ;
 * - les couleurs sont écrites en dur plutôt qu'en `var(--cyan-400)` : la
 *   feuille de style du site n'est pas chargée pendant le rendu, une variable
 *   CSS s'y résoudrait en rien. Chaque valeur cite le jeton de `globals.css`
 *   dont elle est la copie ;
 * - la police est celle que `next/og` embarque : celles du dépôt sont en WOFF2,
 *   que Satori ne lit pas, et en aller chercher une ailleurs serait une requête
 *   réseau à chaque rendu. Les valeurs sont en pixels absolus — il n'y a ni
 *   viewport ni utilisateur à qui s'adapter.
 *
 * **Palette.** Celle de la refonte « néons froids » (`DESIGN_SYSTEM.md`) : fond
 * noir, halos cyan, violet et rose, filet au dégradé de marque (`--grad-brand`),
 * pastille d'état au ton de son sens. La carte entièrement noire d'avant
 * passait pour éteinte au milieu d'un salon.
 */
import type { ReactElement } from "react";
import type { ShareStateTone } from "@/lib/shared/share-metadata";

/** Format canonique d'une image d'aperçu (1,91:1), attendu par Open Graph. */
export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

/** Type MIME du rendu, repris tel quel par les routes `opengraph-image`. */
export const SHARE_CARD_CONTENT_TYPE = "image/png";

/**
 * Palette de la carte, copiée des jetons de `app/globals.css` (voir l'en-tête).
 * Exportée pour que les tests vérifient le contraste de chaque couleur de texte.
 */
export const SHARE_CARD_COLORS = {
  /** `--cyber-bg` */
  background: "#05060a",
  /** `--ink` — titre, valeurs. */
  ink: "#eaf4ff",
  /** `--ink-mute` — sous-titre, mentions. */
  inkMute: "#a3bcd8",
  /** `--cyan-400` — jeu, premier fait. */
  cyan: "#3ee6ff",
  /** `--blue-500` — bleu glacier de la marque, milieu du dégradé. */
  blue: "#5ac8ff",
  /** `--blue-300` — ton `info` (en cours). */
  blueSoft: "#8fd5ff",
  /** `--violet-300` — ton `accent` (à venir), deuxième fait. */
  violetSoft: "#c4b5fd",
  /** `--violet-400` — fin du dégradé de marque, halo. */
  violet: "#a78bfa",
  /** `--pink-400` — ton `highlight` (inscriptions ouvertes), halo. */
  pink: "#f78ad8",
  /** `--teal-400` — ton `success` (terminé), troisième fait. */
  teal: "#3ee8b0",
} as const;

/** Tons des pastilles, ceux des variantes `.pill-*` (`DESIGN_SYSTEM.md`). */
export type ShareCardTone = ShareStateTone;

/** Couleur de texte de chaque ton — la même que la variante `.pill-*`. */
export const SHARE_CARD_TONE_COLORS: Record<ShareCardTone, string> = {
  accent: SHARE_CARD_COLORS.violetSoft,
  highlight: SHARE_CARD_COLORS.pink,
  info: SHARE_CARD_COLORS.blueSoft,
  success: SHARE_CARD_COLORS.teal,
};

/**
 * Couleur de l'intitulé de chaque fait, dans l'ordre : trois néons distincts
 * plutôt qu'un gris répété trois fois.
 */
export const SHARE_CARD_FACT_COLORS = [
  SHARE_CARD_COLORS.cyan,
  SHARE_CARD_COLORS.violetSoft,
  SHARE_CARD_COLORS.teal,
] as const;

/**
 * Halos du fond : couleur, opacité au cœur, côté de la boîte carrée et position
 * de son coin haut-gauche. Le dégradé s'éteint à 70 % du rayon « coin le plus
 * lointain », soit au milieu des bords de la boîte : aucune arête ne se voit.
 * Leurs cœurs sont posés hors de la zone de texte, et les tests recomposent le
 * fond point par point dans {@link SHARE_CARD_TEXT_BOX} pour y vérifier le
 * contraste de chaque couleur de texte.
 */
export const SHARE_CARD_GLOWS = [
  { color: SHARE_CARD_COLORS.cyan, alpha: 0.4, size: 900, place: { top: -550, left: 750 } },
  { color: SHARE_CARD_COLORS.violet, alpha: 0.45, size: 900, place: { top: 280, left: -450 } },
  { color: SHARE_CARD_COLORS.pink, alpha: 0.35, size: 700, place: { top: 450, left: 800 } },
] as const;

/** Marges intérieures de la carte, sous le filet de marque. */
export const SHARE_CARD_PADDING = { top: 48, right: 72, bottom: 44, left: 72 } as const;

/** Hauteur du filet de marque en tête de carte. */
const BRAND_BAR_HEIGHT = 10;

/** Zone où un texte peut tomber, en pixels de la carte (bornes incluses). */
export const SHARE_CARD_TEXT_BOX = {
  left: SHARE_CARD_PADDING.left,
  right: SHARE_CARD_SIZE.width - SHARE_CARD_PADDING.right,
  top: BRAND_BAR_HEIGHT + SHARE_CARD_PADDING.top,
  bottom: SHARE_CARD_SIZE.height - SHARE_CARD_PADDING.bottom,
} as const;

/** Opacité du voile d'une pastille, ajouté sous son texte. */
export const SHARE_CARD_BADGE_FILL_ALPHA = 0.08;

/** Dégradé de marque (`--grad-brand`) : cyan, glacier, violet. */
const BRAND_GRADIENT = `linear-gradient(100deg, ${SHARE_CARD_COLORS.cyan}, ${SHARE_CARD_COLORS.blue} 45%, ${SHARE_CARD_COLORS.violet})`;

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Un halo par `<div>` positionné : Satori place mal les centres d'un
 * `background-image` à plusieurs `radial-gradient` (vérifié au rendu — les
 * halos glissaient au milieu des bords), alors qu'un dégradé centré dans sa
 * propre boîte tombe exactement où on la pose.
 */
function Glows(): ReactElement {
  return (
    <>
      {SHARE_CARD_GLOWS.map((glow) => (
        <div
          key={glow.color}
          style={{
            display: "flex",
            position: "absolute",
            width: glow.size,
            height: glow.size,
            ...glow.place,
            backgroundImage: `radial-gradient(circle, ${rgba(glow.color, glow.alpha)} 0%, ${rgba(glow.color, 0)} 70%)`,
          }}
        />
      ))}
    </>
  );
}

export type ShareCardFact = { label: string; value: string };

export type ShareCardProps = {
  /** Première pastille : le jeu, la rubrique. Toujours cyan. */
  eyebrow: string;
  /** Seconde pastille, colorée par son sens : l'état d'un tournoi. */
  state?: { label: string; tone: ShareCardTone };
  /** Le titre, seule ligne que le lecteur retient. */
  title: string;
  /** Une ligne d'accroche sous le titre. Omise si vide. */
  subtitle?: string;
  /** Faits étiquetés alignés en pied de carte. Au plus trois tiennent. */
  facts?: ShareCardFact[];
  /** Logo en URL `data:` (`shareCardLogo`), ou rien : la carte s'en passe. */
  logoSrc?: string | null;
};

/**
 * Taille du titre selon sa longueur.
 *
 * Un nom de tournoi va de « OW Cup » à soixante caractères. À taille fixe, le
 * premier flotte au milieu du vide et le second déborde de la carte — Satori ne
 * sait pas rétrécir un texte pour qu'il tienne.
 */
export function titleFontSize(title: string): number {
  if (title.length <= 28) return 76;
  if (title.length <= 44) return 62;
  if (title.length <= 64) return 52;
  return 44;
}

/**
 * Lignes accordées à l'accroche selon la longueur du titre.
 *
 * La colonne de texte n'a que 528 px de haut : un titre sur deux ou trois
 * lignes plus une accroche sur deux pousserait celle-ci dans les faits du pied.
 * Seul un titre qui tient sur une ligne laisse la place d'une seconde.
 */
export function subtitleLineClamp(title: string): number {
  return title.length <= 16 ? 2 : 1;
}

function Badge({ label, color }: Readonly<{ label: string; color: string }>): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        marginRight: 16,
        padding: "8px 20px",
        borderRadius: 999,
        border: `2px solid ${rgba(color, 0.55)}`,
        backgroundColor: rgba(color, SHARE_CARD_BADGE_FILL_ALPHA),
        color,
        fontSize: 24,
        fontWeight: 700,
        letterSpacing: 3,
        textTransform: "uppercase",
      }}
    >
      <div
        style={{
          display: "flex",
          width: 12,
          height: 12,
          marginRight: 12,
          borderRadius: 6,
          backgroundColor: color,
          boxShadow: `0 0 12px ${color}`,
        }}
      />
      {label}
    </div>
  );
}

/** La carte, prête à être passée à `ImageResponse`. */
export function ShareCard({
  eyebrow,
  state,
  title,
  subtitle,
  facts = [],
  logoSrc,
}: Readonly<ShareCardProps>): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        // Satori ne coupe pas dans un mot : un nom d'une seule pièce plus large
        // que la carte en sortirait, et le PNG le montrerait tronqué au bord.
        overflow: "hidden",
        backgroundColor: SHARE_CARD_COLORS.background,
        color: SHARE_CARD_COLORS.ink,
        fontFamily: "sans-serif",
      }}
    >
      <Glows />
      {/* Filet de marque en tête : ce qui se voit en premier à petite taille. */}
      <div style={{ display: "flex", width: "100%", height: BRAND_BAR_HEIGHT, backgroundImage: BRAND_GRADIENT }} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flexGrow: 1,
          padding: `${SHARE_CARD_PADDING.top}px ${SHARE_CARD_PADDING.right}px ${SHARE_CARD_PADDING.bottom}px ${SHARE_CARD_PADDING.left}px`,
        }}
      >
        {/* Le bloc du haut cède avant le pied : s'il manque de place, il est
            rogné au lieu de chevaucher les faits. */}
        <div style={{ display: "flex", flexDirection: "column", flexShrink: 1, minHeight: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Badge label={eyebrow} color={SHARE_CARD_COLORS.cyan} />
            {state ? <Badge label={state.label} color={SHARE_CARD_TONE_COLORS[state.tone]} /> : null}
          </div>

          <div
            style={{
              marginTop: 30,
              fontSize: titleFontSize(title),
              lineHeight: 1.08,
              fontWeight: 700,
              wordBreak: "break-word",
              // Satori ne coupe pas les mots : un nom d'équipe sans espace
              // déborderait sans cette limite de lignes.
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 3,
              // Satori n'applique la limite de lignes qu'avec l'ellipse.
              textOverflow: "ellipsis",
              overflow: "hidden",
            }}
          >
            {title}
          </div>

          <div
            style={{
              display: "flex",
              width: 180,
              height: 6,
              marginTop: 22,
              borderRadius: 3,
              backgroundImage: BRAND_GRADIENT,
            }}
          />

          {subtitle ? (
            <div
              style={{
                marginTop: 20,
                fontSize: 28,
                lineHeight: 1.35,
                color: SHARE_CARD_COLORS.inkMute,
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: subtitleLineClamp(title),
                textOverflow: "ellipsis",
                overflow: "hidden",
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
          {facts.length > 0 ? (
            <div style={{ display: "flex", marginBottom: 28 }}>
              {facts.map((fact, index) => {
                const color = SHARE_CARD_FACT_COLORS[index % SHARE_CARD_FACT_COLORS.length];
                return (
                  <div
                    key={fact.label}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      marginRight: 48,
                      maxWidth: 420,
                      paddingLeft: 18,
                      borderLeft: `4px solid ${color}`,
                    }}
                  >
                    <div
                      style={{
                        // 24 px : la vignette Discord réduit la carte de moitié, voire au tiers ;
                        // les mêmes faits figurent en texte sous l'encart.
                        fontSize: 24,
                        letterSpacing: 2,
                        textTransform: "uppercase",
                        color,
                      }}
                    >
                      {fact.label}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 32, fontWeight: 700, color: SHARE_CARD_COLORS.ink }}>
                      {fact.value}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div style={{ display: "flex", width: "100%", height: 2, backgroundImage: BRAND_GRADIENT, opacity: 0.6 }} />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 22,
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              {logoSrc ? (
                // Satori exige une balise <img> : `next/image` n'existe pas ici.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoSrc} width={48} height={48} alt="" style={{ marginRight: 16 }} />
              ) : null}
              <div style={{ display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: 2 }}>BLUEGENJI</div>
            </div>
            <div style={{ display: "flex", fontSize: 24, color: SHARE_CARD_COLORS.inkMute }}>
              Association loi 1901
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
