import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BgCanvas, NETWORK_FRAME_INTERVAL_MS } from "@/app/(secured)/_shared/BgCanvas";
import { readSource } from "../helpers/read-source";

/**
 * Les composants qui coûtaient des images en continu, et ce qu'ils doivent au
 * régime de charge (`lib/shared/client-power.ts`). Sans DOM, les boucles ne se
 * lancent pas : on tient le rendu, et la forme du code là où elle est la règle.
 */

describe("BgCanvas", () => {
  it("rend le fond radial en CSS, sans canevas ni boucle", () => {
    // Il redessinait le même dégradé à chaque image, pour toujours.
    const html = renderToStaticMarkup(<BgCanvas rgb="1, 2, 3" />);
    expect(html).not.toContain("<canvas");
    expect(html).toContain("radial-gradient(circle 100vw at 70% 30%, rgba(1, 2, 3, 0.15) 0%");
    expect(html).toContain('aria-hidden="true"');
  });

  it("garde un canevas pour le réseau animé", () => {
    expect(renderToStaticMarkup(<BgCanvas mode="network" />)).toContain("<canvas");
  });

  it("plafonne le réseau à trente images par seconde", () => {
    expect(NETWORK_FRAME_INTERVAL_MS).toBeCloseTo(1000 / 30, 5);
    const source = readSource("app/(secured)/_shared/BgCanvas.tsx");
    expect(source).toContain("if (time - last < NETWORK_FRAME_INTERVAL_MS) return;");
  });

  it("obéit au régime : libère, fige ou anime", () => {
    const source = readSource("app/(secured)/_shared/BgCanvas.tsx");
    expect(source).toContain("const { canvas: policy } = useClientPower();");
    // Libérer = rendre le tampon de pixels, pas seulement cesser de dessiner.
    expect(source).toMatch(/if \(policy === "RELEASE"\) \{[\s\S]{0,300}canvas\.width = 0;\s*canvas\.height = 0;/);
    expect(source).toMatch(/if \(policy === "STILL"\) \{\s*return \(\) => window\.removeEventListener/);
  });
});

describe("LogoWithGlow", () => {
  it("ne fait tourner sa boucle que pendant qu'il rattrape la souris, et jamais au calme", () => {
    const source = readSource("components/logo-with-glow.tsx");
    expect(source).toContain('const tilts = size !== "sm" && decorativeMotion;');
    expect(source).toContain("if (!tilts) return;");
    // La boucle ne se relance que tant qu'il reste de l'écart à combler.
    expect(source).toMatch(/if \(Math\.abs\(t\.x - c\.x\) > 0\.01 \|\| Math\.abs\(t\.y - c\.y\) > 0\.01\) \{\s*raf = requestAnimationFrame\(tick\);/);
  });
});

describe("signal sonore", () => {
  it("referme son contexte audio une fois la note jouée", () => {
    // Un contexte neuf à chaque signal, jamais rendu : mémoire et fil audio de
    // plus à chaque score, sur un poste qui fait tourner un jeu.
    const source = readSource("app/(secured)/tournois/[id]/_lib/sounds.ts");
    expect(source).toMatch(/oscillator\.onended = \(\) => \{\s*void context\.close\(\)/);
  });
});

describe("horloges", () => {
  it("passent par l'horloge soumise au régime", () => {
    expect(readSource("components/cyber/CountdownStrip.tsx")).toContain("useClock(1000)");
    expect(readSource("app/(secured)/tournois/[id]/_components/TournamentProgress.tsx")).toContain(
      "useClock(TICK_MS, !isFinished)",
    );
    const bot = readSource("components/bot/BotStatusStrip.tsx");
    expect(bot).toContain("if (first === null || !clocks) return;");
  });

  it("s'arrêtent onglet caché et se recalent au retour", () => {
    const source = readSource("lib/shared/hooks/useClock.ts");
    expect(source).toContain("const running = enabled && clocks;");
    expect(source).toMatch(/setNow\(Date\.now\(\)\);\s*if \(!running\) return;/);
  });
});

describe("magasin du régime", () => {
  it("ne re-rend pas ses consommateurs à chaque mesure de cadence", () => {
    // `current` change d'identité à chaque relevé publié ; `current.input`
    // seulement quand le régime peut changer.
    const source = readSource("lib/shared/hooks/useClientPower.ts");
    expect(source).toMatch(
      /export function useClientPowerInput\(\): ClientPowerInput \{[\s\S]{0,300}useSyncExternalStore\(subscribe, getInputSnapshot, getServerInputSnapshot\)/,
    );
    expect(source).toMatch(/function getInputSnapshot\(\): ClientPowerInput \{\s*return current\.input;/);
  });
});

describe("flux du bot", () => {
  it("se ferme onglet caché et repart de l'historique au retour", () => {
    const source = readSource("components/bot/BotLiveFeed.tsx");
    expect(source).toContain("setTimeout(() => setSuspended(true), quietStreamAfterMs)");
    expect(source).toMatch(/if \(everSuspendedRef\.current\) \{\s*setItems\(\[\]\);\s*setBuffer\(\[\]\);/);
    expect(source).toContain("}, [suspended]);");
  });
});

describe("flux du tournoi", () => {
  const hook = readSource("app/(secured)/tournois/[id]/_hooks/useTournamentLive.ts");

  it("annonce sur l'état reçu, avant de décider du rendu", () => {
    const alert = hook.indexOf("const alert = viewerAlert(previous.detail, next.detail);");
    const delay = hook.indexOf("const delay = policyRef.current.snapshotRenderDelayMs;");
    expect(alert).toBeGreaterThan(0);
    expect(delay).toBeGreaterThan(alert);
  });

  it("ne regroupe jamais le match du lecteur", () => {
    expect(hook).toMatch(/touchesViewerMatches\(previous\.detail, next\.detail\);\s*if \(urgent\) \{\s*flushRender\(\);/);
  });

  it("se déclasse par `?quiet=1` et se reclasse au retour", () => {
    expect(hook).toContain('const quiet = quietRef.current ? "?quiet=1" : "";');
    expect(hook).toMatch(/if \(quietAfter === null\) \{\s*if \(quietRef\.current\) \{\s*quietRef\.current = false;\s*reconnectRef\.current\?\.\(\);/);
  });

  it("suit le régime sans re-rendre la page", () => {
    // Par `useClientPower()`, chaque alt-tab redessinerait l'arbre entier.
    expect(hook).not.toContain("useClientPower()");
    expect(hook).toContain("const unsubscribe = subscribeClientPower(apply);");
  });

  it("déclare le match à tous les onglets du site", () => {
    expect(hook).toContain("useMatchFocusLease(matchFocus);");
  });
});
