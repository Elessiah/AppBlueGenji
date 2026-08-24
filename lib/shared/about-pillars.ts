export type AboutPillar = {
  id: number;
  title: string;
  text: string;
};

export type AboutPillarInput = {
  title: string;
  text: string;
};

/**
 * Piliers affichés à droite de la SECTION 03 tant qu'aucune ligne n'existe en
 * base (ou si la base est injoignable). Les `id` négatifs marquent ces cartes
 * « de secours » comme non modifiables côté interface. Partagé client/serveur.
 */
export const FALLBACK_ABOUT_PILLARS: AboutPillar[] = [
  {
    id: -1,
    title: "Accessible",
    text: "Inscription gratuite, matchmaking par niveau et support francophone sur Discord.",
  },
  {
    id: -2,
    title: "Compétitif",
    text: "Brackets arbitrés, admins formés et rulebook versionné. On prend le jeu au sérieux.",
  },
  {
    id: -3,
    title: "Communautaire",
    text: "Watch parties, coaching ouvert et entraide entre équipes. L'asso avant le scoreboard.",
  },
];

export const ABOUT_PILLAR_TITLE_MAX = 60;
export const ABOUT_PILLAR_TEXT_MAX = 240;

export type AboutPillarValidationResult =
  | { ok: true; value: AboutPillarInput }
  | { ok: false; error: string };

/** Valide et normalise un pilier (titre + texte). Les deux champs sont requis. */
export function validateAboutPillarInput(input: AboutPillarInput): AboutPillarValidationResult {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const text = typeof input.text === "string" ? input.text.trim() : "";

  if (!title) return { ok: false, error: "TITLE_REQUIRED" };
  if (title.length > ABOUT_PILLAR_TITLE_MAX) return { ok: false, error: "TITLE_TOO_LONG" };
  if (!text) return { ok: false, error: "TEXT_REQUIRED" };
  if (text.length > ABOUT_PILLAR_TEXT_MAX) return { ok: false, error: "TEXT_TOO_LONG" };

  return { ok: true, value: { title, text } };
}
