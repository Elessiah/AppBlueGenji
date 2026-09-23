import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const CSS = read("app/(secured)/_shared/annuaire.module.css");
const CARD = read("app/(secured)/joueurs/cards/PlayerCard.tsx");

/**
 * La carte d'un compte anonymisé : en retrait, nommée — et toujours cliquable
 * là où elle l'était.
 *
 * Deux propriétés que rien d'autre ne garde, parce que leurs pannes sont
 * **muettes** : aucune erreur, aucune image cassée, seulement un texte illisible
 * ou un lien qui mène ailleurs.
 *
 * 1. **`opacity` se multiplie de parent à enfant** et aucun enfant ne peut la
 *    défaire. Posée sur la carte, elle emporte la mention « Compte supprimé »,
 *    déjà petite et grise — et le survol qui la relevait n'existe pas au doigt.
 * 2. **`opacity < 1` et `filter` créent un contexte d'empilement.** Sur
 *    `.plTeam`, qui contient le lien d'équipe, le `z-index: 2` d'`.aboveOverlay`
 *    se résoudrait à l'intérieur de ce contexte : le nom de l'équipe repasserait
 *    sous la plaque `.cardOverlay` et mènerait à la fiche du joueur.
 */

/** Règles CSS `sélecteur { déclarations }`, commentaires retirés. */
function rules(css: string): { selector: string; body: string }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; body: string }[] = [];
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: match[1].trim(), body: match[2] });
  }
  return out;
}

/** Déclarations qui s'appliquent à un élément correspondant au prédicat. */
function declarationsFor(predicate: (selector: string) => boolean): string {
  return rules(CSS)
    .filter((rule) => rule.selector.split(",").some((s) => predicate(s.trim())))
    .map((rule) => rule.body)
    .join("\n");
}

const STACKING = /(^|[\s;])(opacity|filter)\s*:/;

describe("carte d'un compte anonymisé", () => {
  it("porte sa classe de retrait et sa mention", () => {
    expect(CARD).toContain("plCardDeleted");
    expect(CARD).toContain("plDeletedMark");
    expect(CARD).toContain("Compte supprimé");
  });

  it("n'assombrit jamais la carte entière — la mention deviendrait illisible", () => {
    // `.plDeletedMark` vit dans la carte : une opacité posée sur l'ancêtre la
    // multiplierait sans qu'aucune règle ne puisse la rendre.
    const onCard = declarationsFor((s) => /^\.plCardDeleted(:\S+)?$/.test(s));
    expect(onCard).not.toMatch(STACKING);
  });

  it("ne pose ni opacité ni filtre sur le bloc qui contient le lien d'équipe", () => {
    // Sinon `.plTeam` devient un contexte d'empilement et le lien passe sous la
    // plaque : un clic sur le nom de l'équipe ouvre la fiche du joueur.
    const onTeam = declarationsFor(
      (s) => s.includes(".plCardDeleted") && s.includes(".plTeam"),
    );
    expect(onTeam).not.toMatch(STACKING);
    // Le retrait s'y fait bien par la couleur.
    expect(onTeam).toMatch(/color\s*:/);
  });

  it("garde le retrait sur les décorations, elles qui ne portent aucun lien", () => {
    const onDecorations = declarationsFor(
      (s) => s.includes(".plCardDeleted") && s.includes(".plPseudo"),
    );
    expect(onDecorations).toMatch(/opacity\s*:/);
  });

  it("n'offre pas au recrutement un compte qu'on ne peut plus rattacher", () => {
    // « FREE AGENT » invite à recruter, et c'est cette branche qui a fermé la
    // porte : `getUserIdByPseudo` refuse le pseudo d'un compte supprimé en
    // `USER_NOT_FOUND`. Sous « Compte supprimé », la mention menait le
    // recruteur droit à ce refus — et la case « Comptes supprimés » qu'ajoute
    // la même branche est ce qui l'expose.
    const branch = CARD.slice(CARD.indexOf("<div className={s.plTeam}>"));
    const freeAgent = branch.indexOf("FREE AGENT");
    expect(freeAgent).toBeGreaterThan(-1);
    expect(branch.slice(0, freeAgent)).toMatch(/player\.isDeleted \? null :/);
  });

  it("laisse la mention à son plein contraste", () => {
    const mark = declarationsFor((s) => s === ".plDeletedMark");
    expect(mark).not.toMatch(STACKING);
    expect(mark).toContain("--ink-mute");
  });
});
