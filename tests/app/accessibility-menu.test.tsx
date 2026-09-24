import { describe, expect, it } from "@jest/globals";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AccessibilityMenu,
  AccessibilityPanel,
  accessibilityButtonLabel,
} from "@/components/accessibility/AccessibilityMenu";
import { A11Y_SETTINGS, type A11ySettingKey } from "@/lib/shared/accessibility-settings";
import { readSource } from "../helpers/read-source";

const noop = () => undefined;

const panel = (settings: A11ySettingKey[]) =>
  renderToStaticMarkup(
    <AccessibilityPanel
      id="a11y-panel"
      titleId="a11y-title"
      settings={settings}
      onToggle={noop}
      onReset={noop}
      onClose={noop}
    />,
  );

/** Une case du panneau, repérée par sa description (identifiant stable). */
function checkboxFor(html: string, key: A11ySettingKey): string {
  const match = html.match(new RegExp(`<input[^>]*aria-describedby="a11y-panel-${key}"[^>]*/?>`));
  if (!match) throw new Error(`case introuvable pour ${key}`);
  return match[0];
}

describe("accessibilityButtonLabel", () => {
  it("nomme le bouton sans compteur quand rien n'est actif", () => {
    expect(accessibilityButtonLabel(0)).toBe("Réglages d'accessibilité");
  });

  it("dit combien de réglages sont actifs, accordé", () => {
    expect(accessibilityButtonLabel(1)).toBe("Réglages d'accessibilité (1 actif)");
    expect(accessibilityButtonLabel(3)).toBe("Réglages d'accessibilité (3 actifs)");
  });
});

describe("AccessibilityMenu — rendu serveur", () => {
  it("rend un bouton fermé, sans panneau ni compteur, quand rien n'est actif", () => {
    const html = renderToStaticMarkup(<AccessibilityMenu initialSettings={[]} />);
    expect(html).toContain('aria-label="Réglages d&#x27;accessibilité"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("aria-controls");
    expect(html).not.toContain('role="region"');
    expect(html).toMatch(/<button type="button"/);
  });

  it("annonce les réglages actifs, à l'œil comme à l'oreille", () => {
    const html = renderToStaticMarkup(<AccessibilityMenu initialSettings={["contrast", "motion"]} />);
    expect(html).toContain("(2 actifs)");
    // Le chiffre visible est décoratif : l'intitulé le porte déjà.
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>2<\/span>/);
  });

  it("se rend toujours en contraste renforcé, réglage coché ou non", () => {
    for (const settings of [[], ["contrast"]] as A11ySettingKey[][]) {
      const html = renderToStaticMarkup(<AccessibilityMenu initialSettings={settings} />);
      expect(html).toMatch(/^<div class="root a11y-always-contrast">/);
    }
  });

  it("garde le logo décoratif — le bouton est nommé par son intitulé", () => {
    const html = renderToStaticMarkup(<AccessibilityMenu initialSettings={[]} />);
    expect(html).toMatch(/<span class="[^"]*icon[^"]*" aria-hidden="true"><\/span>/);
  });
});

describe("AccessibilityPanel", () => {
  it("est une région nommée par son titre", () => {
    const html = panel([]);
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-labelledby="a11y-title"');
    expect(html).toMatch(/id="a11y-title"[^>]*>Accessibilité</);
  });

  it("propose chaque réglage du registre, avec sa description reliée", () => {
    const html = panel([]);
    for (const setting of A11Y_SETTINGS) {
      expect(html).toContain(setting.label);
      expect(html).toContain(setting.description.replace(/'/g, "&#x27;"));
      expect(html).toContain(`id="a11y-panel-${setting.key}"`);
    }
  });

  it("dit tout désactivé par défaut, et coche ce qui est actif", () => {
    expect(panel([])).toContain("désactivés par défaut");
    const html = panel(["focus", "font"]);
    expect(checkboxFor(html, "focus")).toContain("checked");
    expect(checkboxFor(html, "font")).toContain("checked");
    expect(checkboxFor(html, "contrast")).not.toContain("checked");
  });

  it("nomme chaque case par son seul intitulé, la description à part", () => {
    const html = panel([]);
    for (const setting of A11Y_SETTINGS) {
      const box = checkboxFor(html, setting.key);
      expect(box).toContain(`aria-labelledby="a11y-panel-${setting.key}-label"`);
      expect(html).toMatch(new RegExp(`id="a11y-panel-${setting.key}-label"[^>]*>${setting.label}</span>`));
    }
  });

  it("porte des cases natives, sans rôle ajouté", () => {
    const html = panel([]);
    expect(html).not.toContain('role="switch"');
    expect(checkboxFor(html, "links")).toContain('type="checkbox"');
  });

  it("garde « Tout désactiver » focalisable, désarmé par aria-disabled", () => {
    expect(panel([])).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Tout désactiver/);
    expect(panel(["links"])).toMatch(/<button[^>]*aria-disabled="false"[^>]*>Tout désactiver/);
    expect(panel([])).not.toMatch(/<button[^>]*disabled=""[^>]*>Tout désactiver/);
  });

  it("nomme le bouton de fermeture et renvoie au zoom pour la taille du texte", () => {
    const html = panel([]);
    expect(html).toContain('aria-label="Fermer le menu d&#x27;accessibilité"');
    expect(html).toContain("zoom de ton navigateur");
  });

  it("fait défiler la liste dans une ScrollArea nommée", () => {
    expect(panel([])).toMatch(/class="scroll-area[^"]*"[^>]*role="region"[^>]*aria-label="Réglages d&#x27;accessibilité"/);
  });
});

describe("AccessibilityMenu — comportement (source)", () => {
  const source = readSource("components/accessibility/AccessibilityMenu.tsx");

  it("applique un choix à la page ouverte et le garde dans le cookie", () => {
    expect(source).toMatch(/root\.setAttribute\("data-a11y", attribute\)/);
    expect(source).toMatch(/root\.removeAttribute\("data-a11y"\)/);
    expect(source).toMatch(/document\.cookie = a11yCookieString\(keys, window\.location\.protocol === "https:"\)/);
  });

  it("survit à des cookies refusés : l'écriture est gardée", () => {
    expect(source).toMatch(/try \{\s*document\.cookie = a11yCookieString[\s\S]*?\} catch \{/);
  });

  it("se referme à Échap en rendant le focus au bouton, et au clic à côté", () => {
    expect(source).toMatch(/event\.key !== "Escape"[\s\S]*?if \(inside\) buttonRef\.current\?\.focus\(\)/);
    expect(source).toMatch(/rootRef\.current\?\.contains\(event\.target as Node\)/);
  });

  it("se referme quand le focus clavier quitte le menu — il masquerait la suite", () => {
    expect(source).toMatch(/document\.addEventListener\("focusin", onOutside\)/);
    expect(source).toMatch(/document\.removeEventListener\("focusin", onOutside\)/);
  });

  it("laisse Échap à une modale ouverte par-dessus, sans lui reprendre le focus", () => {
    expect(source).toMatch(/if \(!inside && active !== null && active !== document\.body\) return;/);
  });

  it("place le panneau après le bouton dans le document : Tab y entre", () => {
    expect(source.indexOf("className={styles.fab}")).toBeLessThan(source.indexOf("<AccessibilityPanel"));
  });
});

describe("régime de charge — le réglage « Réduire les animations »", () => {
  const store = readSource("lib/shared/hooks/useClientPower.ts");

  it("est lu sur l'attribut de <html> et observé, pour les boucles JS", () => {
    expect(store).toContain('hasA11ySetting(document.documentElement.getAttribute("data-a11y"), "motion")');
    expect(store).toContain(
      'settings.observe(document.documentElement, { attributes: true, attributeFilter: ["data-a11y"] })',
    );
    expect(store).toContain("settings.disconnect()");
    expect(store).toContain("input.motionSetting === previous.motionSetting");
  });
});

describe("icône du bouton", () => {
  it("existe dans public/ et sert de masque, colorable par la feuille", () => {
    expect(existsSync(join(__dirname, "..", "..", "public", "accessibility-icon.webp"))).toBe(true);
    const css = readSource("components/accessibility/AccessibilityMenu.module.css");
    expect(css).toMatch(/mask: url\("\/accessibility-icon\.webp"\)/);
    expect(css).toMatch(/-webkit-mask: url\("\/accessibility-icon\.webp"\)/);
    expect(css).toMatch(/\.icon \{[^}]*background-color: currentColor/);
  });
});
