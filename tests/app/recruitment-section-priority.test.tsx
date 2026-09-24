import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { RecruitmentSection } from "@/app/recrutement/RecruitmentSection";
import { ToastProvider } from "@/components/ui/toast";
import type { RecruitmentAd, RecruitmentPriority } from "@/lib/shared/recruitment";

/**
 * Page `/recrutement` : les statuts ne se mélangent jamais.
 *
 * Prioritaires puis importantes forment « Recrutement en cours », les
 * facultatives sont rangées à part sous « Autres recrutements ». Rendu
 * serveur : c'est ce que reçoit le visiteur, et ce que la gestion voit avant
 * tout geste.
 */
function ad(id: number, priority: RecruitmentPriority, overrides: Partial<RecruitmentAd> = {}): RecruitmentAd {
  return {
    id,
    title: `Annonce ${id}`,
    teamName: null,
    domain: "AUTRE",
    roles: null,
    body: null,
    contactUrl: null,
    contactDiscord: null,
    contactDiscordId: null,
    contactPreferred: "AUTO",
    priority,
    active: true,
    ...overrides,
  };
}

function render(ads: RecruitmentAd[], isAdmin = false) {
  return renderToStaticMarkup(
    <ToastProvider>
      <RecruitmentSection initialAds={ads} isAdmin={isAdmin} />
    </ToastProvider>,
  );
}

/** Position d'un titre d'annonce dans le balisage. */
const at = (markup: string, id: number) => markup.indexOf(`>Annonce ${id}<`);

describe("RecruitmentSection — groupes par statut", () => {
  // Ordre reçu volontairement mêlé : c'est le statut qui range, pas la liste.
  const ads = [ad(1, "OPTIONAL"), ad(2, "IMPORTANT"), ad(3, "PRIORITY"), ad(4, "OPTIONAL")];

  it("range prioritaires, puis importantes, puis « Autres recrutements »", () => {
    const markup = render(ads);
    const others = markup.indexOf("Autres recrutements");
    expect(others).toBeGreaterThan(0);
    expect(at(markup, 3)).toBeLessThan(at(markup, 2));
    expect(at(markup, 2)).toBeLessThan(others);
    expect(at(markup, 1)).toBeGreaterThan(others);
    expect(at(markup, 4)).toBeGreaterThan(at(markup, 1));
  });

  it("ne donne la pastille « Urgente » qu'aux prioritaires", () => {
    const markup = render(ads);
    expect((markup.match(/pill-urgent/g) ?? []).length).toBe(1);
  });

  it("n'ouvre pas « Autres recrutements » sans facultative", () => {
    expect(render([ad(1, "PRIORITY")])).not.toContain("Autres recrutements");
  });

  it("dit que rien n'est urgent quand il n'y a que des facultatives", () => {
    const markup = render([ad(1, "OPTIONAL")]);
    expect(markup).toContain("Aucun recrutement urgent en ce moment.");
    expect(markup).toContain("Autres recrutements");
  });

  it("ne montre aucun badge de statut au visiteur", () => {
    expect(render(ads)).not.toContain("Prioritaire");
  });
});

describe("RecruitmentSection — gestion", () => {
  it("nomme le statut de chaque annonce", () => {
    const markup = render([ad(1, "PRIORITY"), ad(2, "IMPORTANT"), ad(3, "OPTIONAL")], true);
    expect(markup).toContain("Prioritaire");
    expect(markup).toContain("Importante");
    expect(markup).toContain("Facultative");
  });

  it("borne les flèches à leur statut", () => {
    // 1 et 2 prioritaires, 3 importante : 2 ne descend pas chez les importantes,
    // 3 ne monte pas chez les prioritaires.
    const markup = render([ad(1, "PRIORITY"), ad(2, "PRIORITY"), ad(3, "IMPORTANT")], true);
    const button = (label: string) => {
      const index = markup.indexOf(`aria-label="${label}"`);
      const start = markup.lastIndexOf("<button", index);
      return markup.slice(start, markup.indexOf(">", index));
    };
    expect(button("Descendre l&#x27;annonce Annonce 1")).not.toContain("disabled");
    expect(button("Descendre l&#x27;annonce Annonce 2")).toContain("disabled");
    expect(button("Monter l&#x27;annonce Annonce 3")).toContain("disabled");
    expect(button("Monter l&#x27;annonce Annonce 3")).toContain("parmi les annonces « Importante »");
  });
});
