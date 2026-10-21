import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/tournois",
}));

import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ui/toast";
import { CERTIFY_PROMPT_GROUPS, DiscordCertifyPrompt } from "@/components/discord/DiscordCertifyPrompt";
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
const CERTIFY_PROMPT_ROWS = CERTIFY_PROMPT_GROUPS.flatMap(({ rows }) => rows);

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
    // Un clic seulement : jamais de code envoyé que la fenêtre ne saurait faire saisir.
    expect(SOURCE).toContain("JSON.stringify({ handle: prompt.tag, linkedOnly: true })");
    expect(SOURCE.match(/fetch\("\/api\/profile\/discord"/g)).toHaveLength(1);
    // Seul `VERIFIED` vaut succès (un code envoyé n'est pas une certification).
    expect(SOURCE).toContain('if (payload.status !== "VERIFIED") throw new Error("DISCORD_TAG_CHANGED");');
    // Succès : close pour la session (LATER), toast, /profil relit son état, rafraîchissement.
    expect(SOURCE).toMatch(
      /showSuccess\(t\("certifyPrompt\.certified"\)\);\s*(?:\/\/[^\n]*\n\s*)*window\.dispatchEvent\(new Event\(DISCORD_CERTIFIED_EVENT\)\);\s*router\.refresh\(\);/,
    );
    // État changé : la fenêtre se ferme (plus rien à offrir) ; autre refus : elle reste.
    expect(SOURCE).toMatch(
      /if \(closeOnDeadEnd\(code\)\) return;\s*if \(STATE_CHANGED\.has\(code\)\) \{\s*\/\/[^\n]*\n\s*closeForSession\(\);\s*showError\(t\("certifyPrompt\.certifyChanged"\)\);\s*\} else \{\s*showError\(t\("certifyPrompt\.certifyFailed"\)\);/,
    );
  });

  it("compte supprimé ou session close : fermée, toast dédié, pas de « Réessaie » sans fin (deux boutons)", () => {
    expect(SOURCE).toContain('if (code === ACCOUNT_DELETED_ERROR || code === "PROFILE_NOT_FOUND") return "certifyPrompt.accountDeleted";');
    expect(SOURCE).toContain('if (code === "UNAUTHORIZED") return "certifyPrompt.sessionEnded";');
    expect(SOURCE).toMatch(/if \(!deadEnd\) return false;\s*setClosed\(true\);\s*showError\(t\(deadEnd\)\);\s*router\.refresh\(\);/);
    // Les deux boutons (« Ne plus voir », « Certifier ») passent par le même garde.
    expect(SOURCE.match(/closeOnDeadEnd\(/g)).toHaveLength(2);
    // « Close pour la session » écrit une seule fois : LATER, avec keepalive.
    expect(SOURCE).toMatch(/const closeForSession = useCallback\(\(\) => \{\s*setClosed\(true\);\s*answered\.current = true;\s*answerPrompt\("LATER"\)\.catch\(\(\) => undefined\);/);
    expect(SOURCE.match(/answerPrompt\("LATER"\)/g)).toHaveLength(1);
  });

  it("focus d'ouverture sur la fenêtre (titre en vue, Entrée inerte), flèche décorative hors du nom accessible", () => {
    expect(SOURCE).not.toContain("data-autofocus");
    expect(SOURCE).toMatch(/dialog\?\.focus\(\{ preventScroll: true \}\);\s*if \(dialog\) dialog\.scrollTop = 0;/);
    // Joué après celui du hook : déclaré après lui.
    expect(SOURCE.indexOf("dialog?.focus({ preventScroll: true })")).toBeGreaterThan(SOURCE.indexOf("useDialogBehavior({ open"));
    expect(SOURCE).toContain("tabIndex={-1}");
    expect(SOURCE).toContain('<span aria-hidden="true"> →</span>');
    const css = readSource("components/discord/DiscordCertifyPrompt.module.css");
    expect(css).not.toMatch(/grid-row:/);
  });

  it("parcours DIALOG : mène au dialogue de /profil, sans en recopier la logique", () => {
    expect(SOURCE).toContain("router.push(CERTIFY_PROFILE_HREF)");
    expect(SOURCE).toContain("window.dispatchEvent(new Event(CERTIFY_DIALOG_EVENT))");
    expect(SOURCE).not.toMatch(/method: "PUT"/);
    const profile = readSource("app/(secured)/profil/page.tsx");
    expect(profile).toMatch(
      /useCertifyRequest\(\{\s*ready: !discordStateBusy && discordState\.linked !== null,\s*verified: discordState\.verified,\s*open: openVerifyDialog,\s*refresh: \(\) => void loadDiscordState\(\),/,
    );
    const hook = readSource("app/(secured)/profil/useCertifyRequest.ts");
    // Tag déjà certifié : un toast le dit, au lieu d'un clic resté sans suite.
    expect(hook).toContain('if (verified) showSuccess(t("certifyPrompt.alreadyVerified"));');
    expect(hook).toContain("window.addEventListener(DISCORD_CERTIFIED_EVENT, onCertified)");
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

  it("« Plus tard » survit à un départ de page (keepalive) ; un changement de parcours ne rouvre rien", () => {
    expect(SOURCE).toMatch(/body: JSON\.stringify\(\{ action \}\),[\s\S]*?keepalive: true,/);
    expect(SOURCE).toMatch(/useEffect\(\(\) => \{\s*if \(!due\) return;\s*setClosed\(false\);\s*answered\.current = false;\s*\}, \[due\]\);/);
    expect(SOURCE).not.toContain("[prompt?.mode]");
  });

  it("certifié depuis le dialogue de /profil : la fenêtre encore en attente se ferme", () => {
    expect(SOURCE).toContain("window.addEventListener(DISCORD_CERTIFIED_EVENT, onCertified)");
    // Close pour la session (LATER), et seulement quand une proposition est due.
    // …et pas une seconde fois après « Plus tard », le dialogue ou « Ne plus voir ».
    expect(SOURCE).toMatch(/const onCertified = \(\) => \{\s*if \(dueRef\.current && !answered\.current\) closeForSession\(\);\s*\};/);
    expect(SOURCE).toMatch(/await answerPrompt\("NEVER"\);\s*answered\.current = true;/);
    const profile = readSource("app/(secured)/profil/page.tsx");
    expect(profile).toMatch(/setDiscordState\(\(prev\) => \(\{ \.\.\.prev, tag, verified: true[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*window\.dispatchEvent\(certifiedFromProfileEvent\(\)\);/);
    // /profil ne se relit pas pour son propre événement.
    const hook = readSource("app/(secured)/profil/useCertifyRequest.ts");
    expect(hook).toContain("if (!certifiedFromProfile(event)) refreshRef.current();");
  });

  it("le corps défilant garde un plancher : le tableau reste lisible à fort zoom", () => {
    const css = readSource("components/discord/DiscordCertifyPrompt.module.css");
    expect(css).toMatch(/min-height: min\(120px, 22vh\);\s*min-height: min\(120px, 22dvh\);/);
    // …et la fenêtre entière défile alors (hauteur bornée, repli vh compris).
    expect(SOURCE).toContain("className={`${styles.modal} dialog-bounded`}");
    expect(css).not.toMatch(/max-height: calc\(100dvh/);
  });

  it("ne couvre pas l'écran où un lien de la modale de confidentialité envoie agir", () => {
    expect(SOURCE).toContain("if (privacyFollowedLink(event)) setClosed(true);");
    const privacy = readSource("components/privacy/PrivacyChangesModal.tsx");
    expect(privacy).toContain("window.dispatchEvent(privacyAnsweredEvent(followedLink));");
    expect(privacy).toMatch(/const followLink = \(changeId: string\) => \{\s*close\(true\);/);
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
    expect(LAYOUT).toContain("user?.certifyPromptDue ? loadCertifyPromptSafely(user.id) : Promise.resolve(null)");
  });

  it("fait taire le recrutement tant qu'elle est due, quelle que soit la page", () => {
    expect(LAYOUT).toContain("const certifyPromptDue = certifyPrompt !== null;");
    expect(LAYOUT).toContain("modalHeld={certifyPromptDue}");
    expect(LAYOUT).not.toMatch(/termsModalDue: termsDueOnLoad,\s*certifyPromptDue,/);
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
    expect(Object.keys(fr.groups)).toEqual(CERTIFY_PROMPT_GROUPS.map(({ group }) => group));
  });

  it("sans certification, personne d'autre que toi : ce que dit canViewDiscordTag", () => {
    const frNone: Record<string, string> = { badge: "Non", dms: "Aucun" };
    const enNone: Record<string, string> = { badge: "No", dms: "None" };
    for (const row of CERTIFY_PROMPT_ROWS) {
      expect([row, fr.rows[row].without]).toEqual([row, frNone[row] ?? "Jamais"]);
      expect([row, en.rows[row].without]).toEqual([row, enNone[row] ?? "Never"]);
    }
    // Visiteurs sans compte : jamais, même certifié.
    expect([fr.rows.visitors.with, en.rows.visitors.with]).toEqual(["Jamais", "Never"]);
  });

  it("compte sans tag : propose de l'ajouter, sans parler d'un tag existant", () => {
    expect(SOURCE).toContain('const noTag = prompt.mode === "DIALOG" && !prompt.hasTag;');
    expect([fr.titleNoTag, fr.addTag]).toEqual(["Ajouter et certifier ton tag Discord ?", "Ajouter mon tag"]);
    expect([en.titleNoTag, en.addTag]).toEqual(["Add and verify your Discord tag?", "Add my tag"]);
    expect(fr.introNoTag).not.toContain("Ta connexion ne l'a pas certifié");
  });

  it("dit le retrait, le recours dans « Mon profil », et les trois boutons", () => {
    expect(fr.undo).toBe("Retirer ton tag ou changer de pseudo Discord retire la certification.");
    expect(fr.later).toContain("« Mon profil »");
    expect([fr.certify, fr.postpone, fr.never]).toEqual(["Certifier mon tag", "Plus tard", "Ne plus voir"]);
    expect([en.certify, en.postpone, en.never]).toEqual(["Verify my tag", "Later", "Don't show again"]);
  });
});
