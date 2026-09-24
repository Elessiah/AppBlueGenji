import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { TOAST_DURATION_MS, ToastProvider, useToast } from "@/components/ui/toast";
import { readSource } from "../helpers/read-source";

/**
 * Notifications. Le rendu serveur montre ce qui existe avant toute
 * notification — les zones d'annonce, qui doivent être là **avant** le premier
 * message pour qu'un lecteur d'écran l'annonce. Le comportement du décompte
 * est éprouvé par sa logique pure (`pausable-countdown.test.ts`) et par la
 * source du composant.
 */
describe("ToastProvider — rendu serveur", () => {
  const html = renderToStaticMarkup(
    <ToastProvider>
      <p>page</p>
    </ToastProvider>,
  );

  it("monte deux zones d'annonce permanentes, vides, invisibles", () => {
    expect(html).toContain('<div class="sr-only" role="status" aria-live="polite"></div>');
    expect(html).toContain('<div class="sr-only" role="alert" aria-live="assertive"></div>');
  });

  it("ne rend aucune pile tant qu'il n'y a rien à dire", () => {
    expect(html).not.toContain('aria-label="Notifications"');
  });

  it("rend la page qu'il enveloppe", () => {
    expect(html).toContain("<p>page</p>");
  });
});

describe("useToast", () => {
  it("refuse d'être appelé hors du fournisseur", () => {
    function Orphan() {
      useToast();
      return null;
    }
    expect(() => renderToStaticMarkup(<Orphan />)).toThrow("useToast doit être utilisé dans ToastProvider");
  });
});

describe("ToastItem — comportement (source)", () => {
  const source = readSource("components/ui/toast.tsx");

  it("garde cinq secondes d'affichage, décompte suspendu exclu", () => {
    expect(TOAST_DURATION_MS).toBe(5000);
    expect(source).toMatch(/startCountdown\(TOAST_DURATION_MS, now\)/);
  });

  it("dérive la suspension de la règle pure, choix explicite compris", () => {
    expect(source).toMatch(/const paused = isCountdownHeld\(override, hovered, focused\)/);
    expect(source).toMatch(/setOverride\(manualPause \? "RUNNING" : "PAUSED"\)/);
  });

  it("ne suspend au focus que s'il vient du clavier", () => {
    expect(source).toMatch(/if \(!event\.target\.matches\(":focus-visible"\)\) return;/);
  });

  it("nomme ses boutons pause, reprise et fermeture", () => {
    expect(source).toContain('"Mettre en pause la notification"');
    expect(source).toContain('"Reprendre le décompte de la notification"');
    expect(source).toContain('aria-label="Fermer la notification"');
  });

  it("n'annonce le type qu'aux lecteurs d'écran, sans le répéter à l'œil", () => {
    expect(source).toMatch(/<span className="sr-only">\{kind\} : <\/span>/);
  });

  it("n'écrit plus aucun style en ligne, barre de progression exceptée", () => {
    expect(source.match(/style=\{/g)).toHaveLength(1);
    expect(source).toMatch(/style=\{\{ animationDuration: `\$\{TOAST_DURATION_MS\}ms` \}\}/);
  });
});
