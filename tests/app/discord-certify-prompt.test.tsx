import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/tournois",
}));

import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ui/toast";
import { CERTIFY_PROMPT_GROUPS, DiscordCertifyPrompt } from "@/components/discord/DiscordCertifyPrompt";
import { scopedText } from "@/lib/shared/scoped-text";
import frCertify from "@/messages/fr/certifyPrompt.json";
import enCertify from "@/messages/en/certifyPrompt.json";
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
const LAZY = readSource("components/discord/DiscordCertifyPromptLazy.tsx");
const ANSWER = readSource("components/discord/certify-prompt-answer.ts");
const FR_TEXT = scopedText("fr", frCertify);
const CERTIFY_PROMPT_ROWS = CERTIFY_PROMPT_GROUPS.flatMap(({ rows }) => rows);

describe("DiscordCertifyPrompt — rendu", () => {
  it("rien au rendu serveur (portail monté après l'hydratation), même due", () => {
    const render = (node: React.JSX.Element) => renderToStaticMarkup(<ToastProvider>{node}</ToastProvider>);
    const empty = render(<span />).replace("<span></span>", "");
    expect(render(<DiscordCertifyPrompt prompt={{ mode: "ONE_CLICK", tag: "keryan" }} canOpen={false} onProfile={false} answered={{ current: false }} text={FR_TEXT} />)).toBe(empty);
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
      /showSuccess\(t\("certified"\)\);\s*(?:\/\/[^\n]*\n\s*)*window\.dispatchEvent\(new Event\(DISCORD_CERTIFIED_EVENT\)\);\s*router\.refresh\(\);/,
    );
    // État changé : la fenêtre se ferme (plus rien à offrir) ; autre refus : elle reste.
    expect(SOURCE).toMatch(
      /if \(closeOnDeadEnd\(code\)\) return;\s*if \(STATE_CHANGED\.has\(code\)\) \{\s*\/\/[^\n]*\n\s*closeForSession\(\);\s*showError\(t\("certifyChanged"\)\);\s*\} else \{\s*showError\(t\("certifyFailed"\)\);/,
    );
  });

  it("compte supprimé ou session close : fermée, toast dédié, pas de « Réessaie » sans fin (deux boutons)", () => {
    expect(SOURCE).toContain('if (code === ACCOUNT_DELETED_ERROR || code === "PROFILE_NOT_FOUND") return "accountDeleted";');
    expect(SOURCE).toContain('if (code === "UNAUTHORIZED") return "sessionEnded";');
    expect(SOURCE).toMatch(/if \(!deadEnd\) return false;\s*setClosed\(true\);\s*showError\(t\(deadEnd\)\);\s*router\.refresh\(\);/);
    // Les deux boutons (« Ne plus voir », « Certifier ») passent par le même garde.
    expect(SOURCE.match(/closeOnDeadEnd\(/g)).toHaveLength(2);
    // « Close pour la session » écrit une seule fois : LATER, avec keepalive.
    expect(SOURCE).toMatch(/const closeForSession = useCallback\(\(\) => \{\s*setClosed\(true\);\s*answered\.current = true;\s*answerPrompt\("LATER"\)\.catch\(\(\) => undefined\);/);
    expect(SOURCE.match(/answerPrompt\("LATER"\)/g)).toHaveLength(1);
  });

  it("focus d'ouverture sur la fenêtre (titre en vue, Entrée inerte), flèche décorative hors du nom accessible", () => {
    expect(SOURCE).not.toContain("data-autofocus");
    expect(SOURCE).toContain('useDialogBehavior({ open, onClose: postpone, locked: busy !== null, initialFocus: "container" })');
    expect(SOURCE).toContain("tabIndex={-1}");
    // Focus visible sur la fenêtre (pas d'`outline: none`).
    const css = readSource("components/discord/DiscordCertifyPrompt.module.css");
    expect(css).toMatch(/\.modal:focus-visible \{\s*outline: 2px solid var\(--blue-500\);/);
    const hook = readSource("lib/shared/hooks/useDialogBehavior.ts");
    expect(hook).toContain('if (initialFocusRef.current === "container") containerRef.current?.focus({ preventScroll: true });');
    expect(SOURCE).toContain('<span aria-hidden="true"> →</span>');
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
    expect(hook).toContain('if (verified) showSuccess(t("discord.alreadyVerified"));');
    expect(hook).toContain("window.addEventListener(DISCORD_CERTIFIED_EVENT, onCertified)");
  });

  it("« Plus tard », Échap et le voile : LATER ; « Ne plus voir » : NEVER", () => {
    expect(SOURCE).toContain('answerPrompt("LATER")');
    expect(SOURCE).toContain('await answerPrompt("NEVER")');
    expect(SOURCE).toContain("useDialogBehavior({ open, onClose: postpone, locked: busy !== null, initialFocus: \"container\" })");
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
    expect(ANSWER).toMatch(/body: JSON\.stringify\(\{ action \}\),[\s\S]*?keepalive: true,/);
    // Montée seulement quand due : une proposition qui réapparaît la remonte neuve (relais).
    expect(LAYOUT).toContain("{certifyPrompt && (");
    expect(LAZY).not.toContain("setFollowedLink(false)");
    expect(SOURCE).not.toContain("[prompt?.mode]");
  });

  it("certifié depuis le dialogue de /profil : la fenêtre encore en attente se ferme", () => {
    expect(LAZY).toContain("window.addEventListener(DISCORD_CERTIFIED_EVENT, onCertified)");
    // Un seul écouteur, chez le relais : aucun trou pendant le chargement du morceau.
    expect(SOURCE).not.toContain("addEventListener(DISCORD_CERTIFIED_EVENT");
    // Close pour la session (LATER), et seulement quand une proposition est due.
    // …et pas une seconde fois après « Plus tard », le dialogue ou « Ne plus voir ».
    expect(LAZY).toMatch(/const onCertified = \(\) => \{\s*setCertified\(true\);\s*if \(answered\.current\) return;\s*answered\.current = true;\s*answerCertifyPrompt\("LATER"\)\.catch\(\(\) => undefined\);/);
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
    expect(LAZY).toContain("if (privacyFollowedLink(event)) setFollowedLink(true);");
    expect(LAZY).toContain("if (certified || followedLink || revoked || !armed) return null;");
    const privacy = readSource("components/privacy/PrivacyChangesModal.tsx");
    expect(privacy).toContain("window.dispatchEvent(privacyAnsweredEvent(followedLink));");
    expect(privacy).toMatch(/const followLink = \(changeId: string\) => \{\s*close\(true\);/);
  });

  it("attend la confidentialité et les conditions, par leurs événements", () => {
    expect(LAZY).toContain("PRIVACY_CHANGES_ANSWERED_EVENT");
    expect(LAZY).toContain("TERMS_ACCEPTED_EVENT");
    // Un seul suivi : la fenêtre reçoit ses attentes du relais, sans écouteur en double.
    expect(SOURCE).not.toContain("PRIVACY_CHANGES_ANSWERED_EVENT");
    expect(SOURCE).not.toContain("TERMS_ACCEPTED_EVENT");
    expect(SOURCE).toContain("const open = canOpen && !closed;");
    expect(SOURCE).not.toContain("certifyPromptOpen(");
    expect(LAZY).toMatch(/certifyPromptOpen\(\{\s*due: true,\s*privacyPending: privacyPending && !privacyAnswered,\s*termsPending: termsAccepted === null \? termsPending : !termsAccepted,\s*pathname,/);
    expect(readSource("components/legal/TermsAcceptanceModal.tsx")).toMatch(
      /setRequested\(false\);\s*window\.dispatchEvent\(new Event\(TERMS_ACCEPTED_EVENT\)\);/,
    );
  });
});

describe("mise en page racine", () => {
  it("monte la fenêtre pour un compte connecté, avec ce qu'elle doit attendre", () => {
    expect(LAYOUT).toMatch(
      /\{certifyPrompt && \(\s*<DiscordCertifyPromptLazy\s+prompt=\{certifyPrompt\}\s+privacyPending=\{privacyChanges\.length > 0\}\s+termsPending=\{termsRequired\}/,
    );
    // Rien de la fenêtre dans le premier chargement : ni import statique, ni textes de la coquille.
    expect(LAYOUT).not.toMatch(/from "@\/components\/discord\/DiscordCertifyPrompt"/);
    expect(LAYOUT).toContain("user?.certifyPromptDue ? loadCertifyPromptSafely(user.id) : Promise.resolve(null)");
  });

  it("chargée à la demande, seulement quand elle est due, chaque langue dans son morceau", () => {
    // …et seulement quand elle peut s'ouvrir (confidentialité, conditions, page), puis reste montée.
    expect(LAZY).toMatch(/const canOpen =\s*!followedLink &&\s*!certified &&\s*certifyPromptOpen\(/);
    expect(LAZY).toContain("if (shown && !armed) setArmed(true);");
    expect(LAZY.match(/\{ ssr: false \}/g)).toHaveLength(2);
    expect(LAZY.match(/orReload\(/g)).toHaveLength(2);
    // Une page française ne télécharge jamais l'anglais, ni l'inverse.
    expect(LAZY).toMatch(/Promise\.all\(\[import\("\.\/DiscordCertifyPrompt"\), import\("@\/messages\/fr\/certifyPrompt\.json"\)\]\)[^\n]*\n\s*withText\(module\.DiscordCertifyPrompt, "fr"/);
    expect(LAZY).toMatch(/Promise\.all\(\[import\("\.\/DiscordCertifyPrompt"\), import\("@\/messages\/en\/certifyPrompt\.json"\)\]\)[^\n]*\n\s*withText\(module\.DiscordCertifyPrompt, "en"/);
    expect(LAZY).not.toMatch(/^import [^\n]*messages\/(fr|en)\/certifyPrompt\.json/m);
    expect(LAZY).not.toMatch(/^import \{[^}]*\} from "\.\/DiscordCertifyPrompt"/m);
    expect(SOURCE).not.toContain("useShellText");
  });

  it("retient ce qui arrive avant le morceau (confidentialité, conditions)", () => {
    expect(LAZY).toContain("window.addEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onPrivacy)");
    expect(LAZY).toContain("if (privacyFollowedLink(event)) setFollowedLink(true);");
    expect(LAZY).toContain("window.addEventListener(TERMS_ACCEPTED_EVENT, onTermsAccepted)");
    expect(LAZY).toContain("window.addEventListener(TERMS_REQUIRED_EVENT, onTermsRequired)");
    expect(LAZY).toContain("privacyPending: privacyPending && !privacyAnswered,");
    expect(LAZY).toContain("termsPending: termsAccepted === null ? termsPending : !termsAccepted,");
    // Certifié avant le chargement (conditions en attente) : close pour la session, une fois, sans charger la fenêtre.
    expect(LAZY).toContain("window.addEventListener(DISCORD_CERTIFIED_EVENT, onCertified)");
  });

  it("jamais sur un état périmé : relue avant une ouverture tardive, fermée en cas de doute", () => {
    // Seule une ouverture dès le chargement se fie à la lecture de la mise en page.
    expect(LAZY).toContain("const [confirmed, setConfirmed] = useState(canOpen);");
    expect(LAZY).toContain("if (!canOpen && confirmed) setConfirmed(false);");
    expect(LAZY).toMatch(/if \(!canOpen \|\| confirmed \|\| revoked \|\| answered\.current\) return;\s*let live = true;\s*recheckCertifyPrompt\(\)/);
    expect(LAZY).toMatch(/if \(next\) \{\s*setCurrent\(next\);\s*setConfirmed\(true\);\s*\} else \{\s*setRevoked\(true\);/);
    expect(LAZY).toContain("const shown = canOpen && confirmed && !revoked;");
    expect(LAZY).toContain("<View prompt={current} canOpen={shown}");
    expect(LAZY).toContain("if (certified || followedLink || revoked || !armed) return null;");
  });

  it("ouverte : relue au retour de l'onglet, fermée par une réponse d'un autre onglet — sans sondage", () => {
    expect(LAZY).toContain('document.addEventListener("visibilitychange", check);');
    expect(LAZY).toContain("if (event.persisted) check();");
    expect(LAZY).toMatch(/if \(!shown\) return;\s*let inFlight = false;/);
    expect(LAZY).toContain("const stopElsewhere = onCertifyPromptAnsweredElsewhere(onElsewhere);");
    expect(LAZY).not.toMatch(/setInterval|setTimeout/);
    expect(ANSWER).toContain("certifyChannel()?.postMessage(action);");
  });

  it("fait taire le recrutement tant qu'elle est due, quelle que soit la page", () => {
    expect(LAYOUT).toContain("const certifyPromptDue = certifyPrompt !== null;");
    expect(LAYOUT).toContain("modalHeld={certifyPromptDue}");
    // Tenue, la modale ne s'ouvrira pas : ses annonces ne partent pas dans la page.
    expect(LAYOUT).toContain("const modalAds = modalOptedOut || certifyPrompt !== null ? [] : spotlight.modal;");
    // Lecture lancée dès la session, attendue avec les conditions.
    expect(LAYOUT).toContain("await Promise.all([termsLoad, certifyPromptLoad])");
    expect(LAYOUT).not.toMatch(/termsModalDue: termsDueOnLoad,\s*certifyPromptDue,/);
  });
});

describe("textes (certifyPrompt) — FR et EN", () => {
  const fr = frCertify;
  const en = enCertify;

  it("hors de la coquille : ni le paquet de chaque page ni l'anglais sérialisé sous /en ne les portent", () => {
    expect(frShell).not.toHaveProperty("certifyPrompt");
    expect(enShell).not.toHaveProperty("certifyPrompt");
  });

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
