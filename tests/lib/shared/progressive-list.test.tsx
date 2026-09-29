import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { DirectoryShowMore } from "@/app/(secured)/_shared/DirectoryShowMore";
import { useProgressiveList } from "@/lib/shared/hooks/useProgressiveList";
import { DIRECTORY_PAGE_SIZE, hiddenCount, nextVisibleCount } from "@/lib/shared/progressive-list";
import { readSource } from "../../helpers/read-source";

/**
 * Les annuaires rendaient toutes leurs cartes d'un coup (353 sur le jeu de
 * test) : le rendu est désormais borné à une page, étendue par « Voir plus ».
 */

const noop = () => undefined;

describe("nextVisibleCount", () => {
  it("ajoute une page", () => {
    expect(nextVisibleCount(DIRECTORY_PAGE_SIZE, 500)).toBe(DIRECTORY_PAGE_SIZE * 2);
  });

  it("ne dépasse jamais le total", () => {
    expect(nextVisibleCount(48, 60)).toBe(60);
    expect(nextVisibleCount(60, 60)).toBe(60);
  });

  it("accepte un pas explicite", () => {
    expect(nextVisibleCount(10, 100, 5)).toBe(15);
  });

  it("rend zéro sur une liste vide", () => {
    expect(nextVisibleCount(48, 0)).toBe(0);
  });
});

describe("hiddenCount", () => {
  it("compte les éléments encore masqués", () => {
    expect(hiddenCount(48, 353)).toBe(305);
  });

  it("ne rend jamais un nombre négatif", () => {
    expect(hiddenCount(48, 10)).toBe(0);
    expect(hiddenCount(-3, 0)).toBe(0);
  });
});

describe("DIRECTORY_PAGE_SIZE", () => {
  // La dernière rangée d'une page reste pleine à 2, 3 ou 4 colonnes.
  it("est un multiple de 2, 3 et 4", () => {
    for (const columns of [2, 3, 4]) expect(DIRECTORY_PAGE_SIZE % columns).toBe(0);
  });
});

function Probe({ items, resetKey }: { items: number[]; resetKey: string }) {
  const page = useProgressiveList(items, resetKey);
  return (
    <p data-visible={page.visible.length} data-hidden={page.hidden}>
      {page.visible.join(",")}
    </p>
  );
}

describe("useProgressiveList", () => {
  it("ne rend que la première page", () => {
    const items = Array.from({ length: 353 }, (_, i) => i);
    const html = renderToStaticMarkup(<Probe items={items} resetKey="k" />);
    expect(html).toContain(`data-visible="${DIRECTORY_PAGE_SIZE}"`);
    expect(html).toContain(`data-hidden="${353 - DIRECTORY_PAGE_SIZE}"`);
  });

  it("rend tout quand la liste tient dans une page", () => {
    const html = renderToStaticMarkup(<Probe items={[1, 2, 3]} resetKey="k" />);
    expect(html).toContain('data-visible="3"');
    expect(html).toContain('data-hidden="0"');
    expect(html).toContain(">1,2,3<");
  });
});

describe("useProgressiveList (source)", () => {
  // Une clé seulement comparée, jamais réécrite, ferait revenir la liste
  // dépliée dès qu'on rétablit les filtres d'avant : l'état se réécrit au rendu.
  it("réécrit l'état quand les filtres changent", () => {
    const source = readSource("lib/shared/hooks/useProgressiveList.ts");
    expect(source).toMatch(/if \(state\.key !== resetKey\) \{[^}]*setState\(\{ key: resetKey/);
  });
});

describe("DirectoryShowMore", () => {
  it("disparaît quand tout est affiché", () => {
    expect(renderToStaticMarkup(<DirectoryShowMore hidden={0} noun="joueurs" onShowMore={noop} />)).toBe("");
  });

  it("annonce la page ajoutée et le reste", () => {
    const html = renderToStaticMarkup(<DirectoryShowMore hidden={305} noun="joueurs" onShowMore={noop} />);
    expect(html).toContain("Voir plus (48 sur 305 restants)");
  });

  it("n'annonce jamais plus que ce qui reste", () => {
    const html = renderToStaticMarkup(<DirectoryShowMore hidden={1} noun="équipes" onShowMore={noop} />);
    expect(html).toContain("Voir plus (1 sur 1 restant)");
  });

  // WCAG 2.5.3 : le nom accessible commence par le texte visible.
  it("a un nom accessible qui commence par le texte visible et nomme l'annuaire", () => {
    const html = renderToStaticMarkup(<DirectoryShowMore hidden={20} noun="équipes" onShowMore={noop} />);
    expect(html).toContain('aria-label="Voir plus (20 sur 20 restants) · équipes"');
    expect(html).toContain('type="button"');
  });
});

describe("annuaires", () => {
  it.each(["app/(secured)/joueurs/page.tsx", "app/(secured)/equipes/page.tsx"])(
    "%s borne son rendu et diffère la recherche",
    (file) => {
      const source = readSource(file);
      expect(source).toContain("useDeferredValue(query)");
      expect(source).toContain("useProgressiveList(");
      expect(source).toContain("page.visible.map(");
      expect(source).toContain("<DirectoryShowMore");
      expect(source).not.toMatch(/filtered\.map\(/);
    },
  );
});
