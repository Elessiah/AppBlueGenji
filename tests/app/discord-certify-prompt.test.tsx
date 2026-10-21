import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/tournois",
}));

import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ui/toast";
import { CERTIFY_PROMPT_ROWS, DiscordCertifyPrompt } from "@/components/discord/DiscordCertifyPrompt";
import frShell from "@/messages/fr/shell.json";
import enShell from "@/messages/en/shell.json";
import { readSource } from "../helpers/read-source";

/**
 * Fenêtre « Certifier ton tag Discord ? » (`docs/features/DISCORD_CERTIFY_PROMPT.md`).
 *
 * Le harnais tourne sans DOM : le comportement se garde sur la source (comme
 * `modal-dialogs.test.ts`), les décisions sur `lib/shared/discord-certify-prompt.ts`
 * et `global-modals.ts` (`tests/lib/shared/discord-certify-prompt.test.ts`).
 */

const SOURCE = readSource("components/discord/DiscordCertifyPrompt.tsx");
const LAYOUT = readSource("app/layout.tsx");

describe("DiscordCertifyPrompt — rendu", () => {
  it("rien au rendu serveur (portail monté après l'hydratation), même due", () => {
    const render = (node: React.JSX.Element) => renderToStaticMarkup(<ToastProvider>{node}</ToastProvider>);
    const empty = render(<span />).replace("<span></span>", "");
    expect(render(<DiscordCertifyPrompt prompt={{ mode: "ONE_CLICK", tag: "keryan" }} privacyPending={false} termsPending={false} />)).toBe(empty);
    expect(render(<DiscordCertifyPrompt prompt={null} privacyPending={false} termsPending={false} />)).toBe(empty);
  });
});

describe("DiscordCertifyPrompt — une proposition, jamais un consentement forcé", () => {
  it("aucune case, rien de précoché", () => {
    expect(SOURCE).not.toMatch(/type="checkbox"|defaultChecked|checked=/);
  });

  it("ne certifie que par la route existante, au clic, avec le tag montré en garde", () => {
    expect(SOURCE).toContain('fetch("/api/profile/discord", {');
    expect(SOURCE).toContain("JSON.stringify({ handle: prompt.tag })");
    expect(SOURCE.match(/fetch\("\/api\/profile\/discord"/g)).toHaveLength(1);
    // Succès : toast + rafraîchissement ; refus : toast.
    expect(SOURCE).toMatch(/showSuccess\(t\("certifyPrompt\.certified"\)\);\s*router\.refresh\(\);/);
    expect(SOURCE).toContain('showError(STATE_CHANGED.has(code) ? t("certifyPrompt.certifyChanged") : t("certifyPrompt.certifyFailed"))');
  });

  it("parcours DIALOG : mène au dialogue de /profil, sans en recopier la logique", () => {
    expect(SOURCE).toContain("router.push(CERTIFY_PROFILE_HREF)");
    expect(SOURCE).toContain("window.dispatchEvent(new Event(CERTIFY_DIALOG_EVENT))");
    expect(SOURCE).not.toMatch(/method: "PUT"/);
    const profile = readSource("app/(secured)/profil/page.tsx");
    expect(profile).toMatch(/useCertifyRequest\(\{\s*ready: !discordStateBusy && discordState\.linked !== null,\s*verified: discordState\.verified,\s*open: openVerifyDialog,/);
  });

  it("« Plus tard », Échap et le voile : LATER ; « Ne plus voir » : NEVER", () => {
    expect(SOURCE).toContain('answerPrompt("LATER")');
    expect(SOURCE).toContain('await answerPrompt("NEVER")');
    expect(SOURCE).toContain("useDialogBehavior({ open, onClose: postpone, locked: busy !== null })");
    expect(SOURCE).toContain("useBackdropDismiss(postpone, busy !== null)");
  });

  it("modale du site : portée dans body, gestes en aria-disabled / aria-busy, jamais disabled natif", () => {
    expect(SOURCE).toContain("createPortal(");
    expect(SOURCE).toContain("document.body");
    expect(SOURCE).toContain('aria-modal="true"');
    expect(SOURCE).toContain("aria-busy=");
    expect(SOURCE).not.toMatch(/\sdisabled[=\s>]/);
    expect(SOURCE).toContain("<ScrollArea");
  });

  it("attend la confidentialité et les conditions, par leurs événements", () => {
    expect(SOURCE).toContain("PRIVACY_CHANGES_ANSWERED_EVENT");
    expect(SOURCE).toContain("TERMS_ACCEPTED_EVENT");
    expect(readSource("components/legal/TermsAcceptanceModal.tsx")).toMatch(
      /setRequested\(false\);\s*window\.dispatchEvent\(new Event\(TERMS_ACCEPTED_EVENT\)\);/,
    );
  });
});

describe("mise en page racine", () => {
  it("monte la fenêtre pour un compte connecté, avec ce qu'elle doit attendre", () => {
    expect(LAYOUT).toMatch(
      /<DiscordCertifyPrompt\s+prompt=\{certifyPrompt\}\s+privacyPending=\{privacyChanges\.length > 0\}\s+termsPending=\{termsRequired\}/,
    );
    expect(LAYOUT).toContain("user?.certifyPromptDue ? await certifyPromptFor(user.id) : null");
  });

  it("fait taire le recrutement tant qu'elle est due", () => {
    expect(LAYOUT).toMatch(/termsModalDue: termsDueOnLoad,\s*certifyPromptDue,/);
  });
});

describe("textes (shell.certifyPrompt) — FR et EN", () => {
  const fr = frShell.certifyPrompt;
  const en = enShell.certifyPrompt;

  it("mêmes clés dans les deux langues, une ligne par public ou effet", () => {
    const keys = (value: object): string[] =>
      Object.entries(value).flatMap(([key, child]) =>
        typeof child === "object" && child !== null ? keys(child).map((sub) => `${key}.${sub}`) : [key],
      );
    expect(keys(en).sort()).toEqual(keys(fr).sort());
    expect(Object.keys(fr.rows)).toEqual([...CERTIFY_PROMPT_ROWS]);
  });

  it("sans certification, personne d'autre que toi : ce que dit canViewDiscordTag", () => {
    const frNone: Record<string, string> = { badge: "Non", dms: "Aucun" };
    const enNone: Record<string, string> = { badge: "No", dms: "None" };
    for (const row of CERTIFY_PROMPT_ROWS) {
      if (row === "you") continue;
      expect([row, fr.rows[row].without]).toEqual([row, frNone[row] ?? "Jamais"]);
      expect([row, en.rows[row].without]).toEqual([row, enNone[row] ?? "Never"]);
    }
    // Visiteurs sans compte : jamais, même certifié.
    expect([fr.rows.visitors.with, en.rows.visitors.with]).toEqual(["Jamais", "Never"]);
  });

  it("dit le retrait, le recours dans « Mon profil », et les trois boutons", () => {
    expect(fr.undo).toBe("Retirer ton tag ou changer de pseudo Discord retire la certification.");
    expect(fr.later).toContain("« Mon profil »");
    expect([fr.certify, fr.postpone, fr.never]).toEqual(["Certifier mon tag", "Plus tard", "Ne plus voir"]);
    expect([en.certify, en.postpone, en.never]).toEqual(["Verify my tag", "Later", "Don't show again"]);
  });
});
