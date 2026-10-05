import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { Pill, pillVariantClass } from "@/components/cyber/Pill";
import { CountUp } from "@/components/cyber/landing/CountUp";
import { Reveal } from "@/components/cyber/landing/Reveal";
import { featuredMatchPill } from "@/lib/shared/landing";
import { readSource } from "../helpers/read-source";

const NOW = Date.parse("2099-03-01T12:00:00Z");

describe("pastille du match mis en avant — une classe par état", () => {
  const cases: Array<[string, Parameters<typeof featuredMatchPill>[0], string]> = [
    ["à l'antenne", { launchPhase: "LAUNCHED", startAt: null, liveState: "LIVE" }, "pill-live"],
    ["lancé", { launchPhase: "LAUNCHED", startAt: null, liveState: "OFF" }, "pill-blue"],
    ["en lancement", { launchPhase: "LOBBY", startAt: null, liveState: "OFF" }, "pill-blue"],
    ["daté", { launchPhase: "SCHEDULED", startAt: "2099-03-04T19:30:00Z", liveState: "OFF" }, "pill-waiting"],
  ];

  it.each(cases)("%s", (_label, match, expected) => {
    const pill = featuredMatchPill(match, NOW);
    expect(pillVariantClass(pill.tone)).toBe(expected);
    const html = renderToStaticMarkup(<Pill variant={pill.tone}>{pill.label}</Pill>);
    expect(html).toContain(`class="pill ${expected}"`);
  });

  it("la pastille de base n'ajoute aucune variante", () => {
    expect(pillVariantClass("default")).toBeNull();
    expect(renderToStaticMarkup(<Pill>x</Pill>)).toContain('class="pill"');
  });
});

describe("animations de l'accueil — contenu visible sans JavaScript", () => {
  it("Reveal ne masque rien au rendu serveur", () => {
    const html = renderToStaticMarkup(
      <Reveal>
        <section>Classement</section>
      </Reveal>,
    );
    expect(html).toContain("Classement");
    expect(html).not.toMatch(/reveal-pending|reveal-in|opacity/);
  });

  it("CountUp écrit la valeur finale au rendu serveur, largeur réservée", () => {
    const html = renderToStaticMarkup(<CountUp value={1234} className="num" />);
    expect(html).toContain(">1234<");
    expect(html).toContain("min-width:4ch");
  });

  it("les deux composants passent par la porte unique du régime de charge", () => {
    for (const file of ["components/cyber/landing/Reveal.tsx", "components/cyber/landing/CountUp.tsx"]) {
      const source = readSource(file);
      expect(source).toContain("useClientPower()");
      expect(source).toContain("decorativeMotion");
    }
  });

  it("Reveal montre la section dès qu'un de ses contrôles prend le focus", () => {
    const source = readSource("components/cyber/landing/Reveal.tsx");
    expect(source).toContain('addEventListener("focusin", reveal)');
    expect(source).toContain('removeEventListener("focusin", reveal)');
    expect(source).not.toMatch(/rootMargin:\s*"[^"]*-\d/);
  });

  it("une section ou un chiffre montré sans animation ne rejoue pas au retour des animations", () => {
    expect(readSource("components/cyber/landing/Reveal.tsx")).toMatch(/if \(!defer\) \{\s*settled\.current = true;/);
    expect(readSource("components/cyber/landing/CountUp.tsx")).toContain("if (element && !decorativeMotion) played.current = true;");
  });

  it("l'accueil enveloppe ses sections sous le hero, pas le hero (LCP)", () => {
    const page = readSource("app/page.tsx");
    expect(page).not.toMatch(/<Reveal>\s*<Hero/);
    expect(page.match(/<Reveal>/g) ?? []).toHaveLength(5);
  });
});
