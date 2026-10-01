import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { SecuredLoading } from "@/app/(secured)/_shared/SecuredLoading";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/**
 * La barre de navigation de l'espace connecté est rendue par une mise en page
 * serveur que l'App Router ne rejoue pas d'une page à l'autre. Chaque geste qui
 * change ce qu'elle affiche doit donc demander un `router.refresh()` — sans
 * quoi la barre reste figée jusqu'au F5, panne muette qu'aucun rendu isolé ne
 * montre.
 */
describe("barre de navigation — rafraîchie après les gestes qui la changent", () => {
  /** Extrait le corps d'un geste : de son marqueur jusqu'au `catch` suivant. */
  const gesture = (source: string, marker: string) => {
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("catch", start);
    return source.slice(start, end);
  };

  it.each<[string, string]>([
    ["app/(secured)/profil/page.tsx", 'showSuccess("Profil mis à jour.")'],
    ["app/(secured)/profil/page.tsx", 'showSuccess("Avatar mis à jour.")'],
    ["app/(secured)/profil/page.tsx", 'showSuccess("Avatar supprimé.")'],
    ["app/(secured)/profil/page.tsx", 'Invitation acceptée.'],
    ["app/(secured)/equipes/[id]/_components/MembershipActions.tsx", "showSuccess(await request())"],
    ["app/(secured)/equipes/[id]/_components/TeamSettings.tsx", 'showSuccess("Équipe mise à jour.")'],
    ["app/(secured)/equipes/[id]/_components/TeamSettings.tsx", 'router.push("/equipes")'],
    ["app/(secured)/admin/signalements/page.tsx", "showSuccess(success)"],
  ])("%s — %s", (file, marker) => {
    expect(gesture(read(file), marker)).toContain("router.refresh()");
  });

  it("l'invitation refusée ne relance pas la mise en page pour rien", () => {
    expect(gesture(read("app/(secured)/profil/page.tsx"), "Invitation acceptée.")).toContain(
      "if (accept) router.refresh()",
    );
  });
});

describe("frontière de chargement de l'espace connecté", () => {
  it.each(["tournois", "equipes", "joueurs", "profil", "signalements"])(
    "le segment %s a sa frontière, qui rend le squelette partagé",
    (segment) => {
      expect(read(`app/(secured)/${segment}/loading.tsx`)).toContain("export { SecuredLoading as default }");
    },
  );

  it("n'enveloppe pas la racine : le 404 de l'administration garderait sinon un statut 200", () => {
    expect(existsSync(join(process.cwd(), "app/(secured)/loading.tsx"))).toBe(false);
    expect(existsSync(join(process.cwd(), "app/(secured)/admin/loading.tsx"))).toBe(false);
  });

  it("annonce le chargement et masque le décor, sans aria-busy qui ne retomberait jamais", () => {
    const html = renderToStaticMarkup(<SecuredLoading />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Chargement…");
    expect(html).not.toContain("aria-busy");
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("son animation suit le régime de charge et le mouvement réduit", () => {
    const css = read("app/(secured)/_shared/SecuredLoading.module.css");
    expect(css).toContain("animation-play-state: var(--deco-anim-state)");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
