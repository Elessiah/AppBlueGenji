import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

/**
 * « Prêt », « Retour » et la confirmation retirent chacun le bouton qui avait
 * le focus : sans geste de la modale, le focus tombait sur `<body>`, derrière
 * le voile. Le composant dépend du réseau et du flux de lancement ; la règle
 * se lit donc sur la source.
 */
describe("MatchLaunchCenter — focus rendu après chaque étape", () => {
  const source = readSource("components/match-launch/MatchLaunchCenter.tsx");
  const css = readSource("components/match-launch/MatchLaunchCenter.module.css");

  it("« Prêt » envoie le focus à l'étape de confirmation", () => {
    const ready = source.slice(source.indexOf("className={`btn ${styles.readyButton}`}\n                  onClick"));
    expect(ready).toMatch(/pendingFocusRef\.current = "confirm";\s*setConfirming\(true\);/);
  });

  it("l'étape de confirmation est focalisable et nommée par sa question", () => {
    const confirm = source.slice(source.indexOf("ref={confirmRef}"), source.indexOf("</p>", source.indexOf("ref={confirmRef}")));
    expect(confirm).toContain('role="group"');
    expect(confirm).toContain("aria-labelledby={confirmTextId}");
    expect(confirm).toContain("tabIndex={-1}");
    expect(confirm).toContain("id={confirmTextId}");
  });

  it("« Retour » et Échap rendent le focus au bouton « Prêt »", () => {
    const back = source.slice(source.indexOf('className="btn ghost"\n                onClick'));
    expect(back).toMatch(/pendingFocusRef\.current = "ready";\s*setConfirming\(false\);/);
    const escape = source.slice(source.indexOf("onClose: () => {"));
    expect(escape).toMatch(/if \(confirming\) \{\s*pendingFocusRef\.current = "ready";\s*setConfirming\(false\);/);
  });

  it("après l'envoi, le focus va au bouton qui remplace « Prêt », ou reste à l'étape en échec", () => {
    const send = source.slice(source.indexOf("const setReady"), source.indexOf("const copy"));
    expect(send).toMatch(/setConfirming\(false\);\s*pendingFocusRef\.current = "ready";/);
    expect(send).toContain('pendingFocusRef.current = confirming ? "confirm" : "ready";');
  });

  it("les deux boutons « Prêt » portent la même référence", () => {
    expect(source.match(/ref=\{readyRef\}/g)).toHaveLength(2);
  });

  it("n'applique le focus qu'une fois l'envoi fini, avec la modale en repli", () => {
    const effect = source.slice(source.indexOf("const target = pendingFocusRef.current;"));
    expect(effect).toMatch(/if \(target === null \|\| busy\) return;\s*pendingFocusRef\.current = null;/);
    expect(effect).toContain("(element ?? dialogRef.current)?.focus();");
  });

  it("montre un anneau au clavier sur l'étape focalisée", () => {
    expect(css).toMatch(/\.confirm:focus-visible\s*\{[^}]*outline:\s*2px solid/);
  });
});
