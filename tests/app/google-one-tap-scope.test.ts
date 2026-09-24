import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";

/**
 * L'invite Google One Tap ne se charge que sur `/connexion`, après consentement.
 *
 * Montée par la mise en page racine, elle faisait appel à Google sur chaque page
 * pour tout visiteur anonyme — IP, page consultée, cookie `g_state` —, sans que
 * personne l'ait demandé. Aucun test ne peut observer un script tiers chargé
 * dans un navigateur : ces assertions portent donc sur la **source**, faute de
 * pouvoir monter les pages (environnement Jest `node`).
 */
const ROOT = process.cwd();
const source = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

/** Tous les `.tsx` / `.ts` de `app/` et `components/`, chemins relatifs. */
function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe("Google One Tap — périmètre de chargement", () => {
  it("n'est plus monté par la mise en page racine", () => {
    const layout = source("app", "layout.tsx");
    expect(layout).not.toContain("google-one-tap");
    expect(layout).not.toContain("<GoogleOneTap");
  });

  it("n'est importé que par le formulaire de connexion", () => {
    const importers = [...sourceFiles("app"), ...sourceFiles("components")]
      .filter((file) => source(file).includes("@/components/auth/google-one-tap"))
      .map((file) => relative(ROOT, join(ROOT, file)).replace(/\\/g, "/"));
    expect(importers).toEqual(["app/connexion/_components/LoginForm.tsx"]);
  });

  it("n'est configuré par la page serveur que pour un visiteur sans session, client Google posé", () => {
    const page = source("app", "connexion", "page.tsx");
    expect(page).not.toMatch(/^\s*["']use client["']/m);
    expect(page).toMatch(/!user && clientId \? \{ clientId, nonce \} : null/);
    expect(page).toContain("CSP_NONCE_HEADER");
  });

  it("attend que le consentement soit lu et accordé avant de monter l'invite", () => {
    const form = source("app", "connexion", "_components", "LoginForm.tsx");
    // `consentGiven` part à `true` (pas de clignotement de la modale) : seul, il
    // laisserait partir le script avant la lecture du stockage.
    expect(form).toMatch(/useState\(true\)/);
    expect(form).toMatch(/const \[consentRead, setConsentRead\] = useState\(false\)/);
    expect(form).toMatch(/oneTap && consentRead && consentGiven && \(/);
    expect(form).toMatch(/setConsentRead\(true\)/);
  });

  it("mène à la destination filtrée de la page, comme les autres portes", () => {
    const form = source("app", "connexion", "_components", "LoginForm.tsx");
    expect(form).toMatch(/<GoogleOneTap[^>]*redirect=\{redirect\}/);
    const component = source("components", "auth", "google-one-tap.tsx");
    expect(component).toContain("router.push(redirectRef.current)");
    // La valeur est déjà filtrée : le composant ne relit plus l'URL lui-même.
    expect(component).not.toContain("window.location.search");
  });

  it("retire l'invite en quittant la page", () => {
    const component = source("components", "auth", "google-one-tap.tsx");
    expect(component).toMatch(/window\.google\?\.accounts\.id\.cancel\(\)/);
  });
});

describe("Google One Tap — ce qui en est dit aux visiteurs", () => {
  it("la politique nomme Google, la page et le cookie g_state, et ne promet plus « aucun tiers »", () => {
    const rgpd = source("app", "rgpd", "page.tsx");
    expect(rgpd).toContain("Google One Tap");
    expect(rgpd).toContain("g_state");
    expect(rgpd).not.toContain("AUCUN TIERS");
    expect(rgpd).not.toMatch(/aucun traceur tiers/);
  });

  it("la politique liste les deux clés de stockage qu'elle oubliait", () => {
    const rgpd = source("app", "rgpd", "page.tsx");
    expect(rgpd).toContain("bg:last-visit-ping");
    expect(rgpd).toContain("bg_rgpd_consent");
    // Les clés doivent être celles que le code emploie vraiment.
    expect(source("components", "visit-tracker.tsx")).toContain('"bg:last-visit-ping"');
    expect(source("app", "connexion", "_components", "LoginForm.tsx")).toContain('"bg_rgpd_consent"');
  });

  it("la modale de consentement annonce l'invite avant qu'on l'accepte", () => {
    const modal = source("components", "cyber", "RgpdConsentModal.tsx");
    expect(modal).toContain("Google One");
    expect(modal).toContain("g_state");
  });

  it("le changement est déclaré aux comptes existants", () => {
    const change = PRIVACY_CHANGES.find((c) => c.id === "2026-09-google-one-tap-connexion");
    expect(change).toBeDefined();
    expect(change?.details.join(" ")).toContain("g_state");
    // Dernière entrée : l'ordre du registre est celui de publication.
    expect(PRIVACY_CHANGES[PRIVACY_CHANGES.length - 1]).toBe(change);
  });

  it("le registre des traitements compte les visiteurs de la page de connexion", () => {
    const auth = PROCESSING_ACTIVITIES.find((a) => a.ref === "T02");
    expect(auth?.subPurposes.some((p) => p.includes("Google One Tap"))).toBe(true);
    expect(auth?.dataSubjects.some((p) => p.includes("Google One Tap"))).toBe(true);
  });
});
