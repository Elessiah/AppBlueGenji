/**
 * Confirmation commune (`components/ui/confirm-action-dialog.tsx`) : le geste
 * confirmé (`runConfirmation`), le balisage rendu (rendu serveur, portail
 * remplacé par son contenu, effet de montage joué une fois), l'écart des rôles
 * de plateforme annoncé avant enregistrement, et la disparition de
 * `window.confirm` (`docs/features/ADMIN_CONFIRMATIONS.md`).
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
const effects = { armed: false };
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => void) => {
      if (!effects.armed) return;
      effects.armed = false;
      effect();
    },
  };
});
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmActionDialog, runConfirmation } from "@/components/ui/confirm-action-dialog";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import { diffPlatformRoles, roleChangeNeedsConfirmation } from "@/lib/shared/permissions";
import { readSource } from "../helpers/read-source";

const globalWithDocument = globalThis as { document?: unknown };
const hadDocument = "document" in globalWithDocument;
beforeAll(() => {
  if (!hadDocument) globalWithDocument.document = { body: {} };
});
afterAll(() => {
  if (!hadDocument) delete globalWithDocument.document;
});

const noop = () => undefined;
const resolved = async () => true;

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  effects.armed = true;
  return renderToStaticMarkup(element);
}

function runner(outcome: () => Promise<boolean>, closeOnSuccess = true) {
  const onClose = jest.fn<() => void>();
  const setBusy = jest.fn<(busy: boolean) => void>();
  const onConfirm = jest.fn(outcome);
  return { onClose, setBusy, onConfirm, run: () => runConfirmation({ onConfirm, onClose, setBusy, closeOnSuccess }) };
}

describe("runConfirmation", () => {
  it("joue le geste puis ferme la modale sur un succès", async () => {
    const r = runner(async () => true);
    await expect(r.run()).resolves.toBe(true);
    expect(r.onConfirm).toHaveBeenCalledTimes(1);
    expect(r.setBusy.mock.calls).toEqual([[true]]);
    expect(r.onClose).toHaveBeenCalledTimes(1);
  });

  it("laisse l'appelant démonter la modale (closeOnSuccess: false), bouton gardé « en cours »", async () => {
    const r = runner(async () => true, false);
    await expect(r.run()).resolves.toBe(true);
    expect(r.onClose).not.toHaveBeenCalled();
    expect(r.setBusy.mock.calls).toEqual([[true]]);
  });

  it("un refus du serveur garde la modale ouverte et réarme le bouton", async () => {
    const r = runner(async () => false);
    await expect(r.run()).resolves.toBe(false);
    expect(r.onClose).not.toHaveBeenCalled();
    expect(r.setBusy.mock.calls).toEqual([[true], [false]]);
  });

  it("une exception réarme aussi le bouton, sans fermer", async () => {
    const r = runner(async () => {
      throw new Error("NETWORK");
    });
    await expect(r.run()).rejects.toThrow("NETWORK");
    expect(r.onClose).not.toHaveBeenCalled();
    expect(r.setBusy.mock.calls).toEqual([[true], [false]]);
  });
});

describe("ConfirmActionDialog — balisage", () => {
  it("alertdialog, focus sur « Annuler », bouton danger armé", () => {
    const html = render(
      <ConfirmActionDialog title="Supprimer ?" confirmLabel="Supprimer" pendingLabel="Suppression…" onClose={noop} onConfirm={resolved}>
        <p>Perdu.</p>
      </ConfirmActionDialog>,
    );
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("aria-describedby=");
    expect(html).toMatch(/<button type="button" class="btn ghost" data-autofocus="true">Annuler<\/button>/);
    expect(html).toMatch(/<button type="submit" class="btn danger">Supprimer<\/button>/);
    expect(html).toContain("<p>Perdu.</p>");
    expect(html).not.toContain("<input");
  });

  it("contenu resté en français sur une page anglaise : modale entière en français, `lang=\"fr\"`", () => {
    const dialog = (
      <ConfirmActionDialog title="Supprimer ?" confirmLabel="Supprimer" pendingLabel="…" contentLang="fr" onClose={noop} onConfirm={resolved}>
        <p>Perdu.</p>
      </ConfirmActionDialog>
    );
    const english = render(
      <ShellTextProvider locale="en" messages={messagesFor("en").shell}>
        {dialog}
      </ShellTextProvider>,
    );
    expect(english).toMatch(/role="alertdialog"[^>]*lang="fr"/);
    expect(english).toContain(">Annuler</button>");
    expect(english).not.toContain("Cancel");
    // Page française : rien n'est ajouté.
    expect(render(dialog)).not.toContain("lang=");
  });

  it("ton primary pour un engagement", () => {
    const html = render(
      <ConfirmActionDialog title="T" confirmLabel="Inscrire" pendingLabel="…" tone="primary" onClose={noop} onConfirm={resolved}>
        <p>x</p>
      </ConfirmActionDialog>,
    );
    expect(html).toMatch(/<button type="submit" class="btn">Inscrire<\/button>/);
  });

  it("texte à recopier : champ focalisé, bouton désarmé tant qu'il est vide", () => {
    const html = render(
      <ConfirmActionDialog title="T" confirmLabel="Dissoudre" pendingLabel="…" requireText="Les Bleus" onClose={noop} onConfirm={resolved}>
        <p>x</p>
      </ConfirmActionDialog>,
    );
    expect(html).toContain("Recopie <strong>Les Bleus</strong> pour confirmer");
    expect(html).toMatch(/<input[^>]*data-autofocus="true"/);
    expect(html).toMatch(/<button type="button" class="btn ghost">Annuler<\/button>/);
    expect(html).toMatch(/<button type="submit" class="btn danger" disabled="">Dissoudre<\/button>/);
  });

  it("libellés communs en anglais sous la coquille anglaise (le texte à recopier n'est pas traduit)", () => {
    const html = render(
      <ShellTextProvider locale="en" messages={messagesFor("en").shell}>
        <ConfirmActionDialog title="T" confirmLabel="Disband" pendingLabel="…" requireText="Les Bleus" onClose={noop} onConfirm={resolved}>
          <p>x</p>
        </ConfirmActionDialog>
      </ShellTextProvider>,
    );
    expect(html).toContain("Type <strong>Les Bleus</strong> to confirm");
    expect(html).toMatch(/<button type="button" class="btn ghost">Cancel<\/button>/);
    expect(html).not.toMatch(/Recopie|Annuler/);
  });

  it("champ requis du contenu : `disabled` désarme, `focusContent` laisse le focus au contenu", () => {
    const html = render(
      <ConfirmActionDialog title="T" confirmLabel="Retirer" pendingLabel="…" disabled focusContent onClose={noop} onConfirm={resolved}>
        <textarea />
      </ConfirmActionDialog>,
    );
    expect(html).not.toContain("data-autofocus");
    expect(html).not.toContain("aria-describedby");
    expect(html).toMatch(/<button type="submit" class="btn danger" disabled="">Retirer<\/button>/);
  });
});

describe("rôles de plateforme — écart annoncé", () => {
  it("liste ce qui est accordé et retiré, dans l'ordre d'affichage", () => {
    expect(diffPlatformRoles(["CASTER", "ARBITRE"], ["RECRUTEUR", "ADMIN", "ARBITRE"])).toEqual({
      granted: ["ADMIN", "RECRUTEUR"],
      removed: ["CASTER"],
    });
  });

  it("retrait de l'administration", () => {
    const change = diffPlatformRoles(["ADMIN"], []);
    expect(change).toEqual({ granted: [], removed: ["ADMIN"] });
    expect(roleChangeNeedsConfirmation(change)).toBe(true);
  });

  it("aucun écart (même sélection, ordre différent, ou vide) : pas de question", () => {
    expect(roleChangeNeedsConfirmation(diffPlatformRoles(["ARBITRE", "CASTER"], ["CASTER", "ARBITRE"]))).toBe(false);
    expect(roleChangeNeedsConfirmation(diffPlatformRoles([], []))).toBe(false);
  });

  it("le panneau des rôles passe par la confirmation quand il y a un écart", () => {
    const panel = readSource("app/(secured)/joueurs/[id]/_components/PlayerRolesPanel.tsx");
    expect(panel).toContain("onClick={requestSave}");
    expect(panel).toContain("if (roleChangeNeedsConfirmation(change)) setPendingChange(change);");
    expect(panel).toContain("onConfirm={saveRoles}");
    expect(panel).toContain("Il perd l&apos;administration");
  });
});

describe("plus de window.confirm", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(join(__dirname, "..", "..", dir), { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name));

  it("aucun appel dans app/, components/, lib/", () => {
    const offenders = ["app", "components", "lib"]
      .flatMap(sourceFiles)
      .filter((file) => {
        const code = readSource(file).replace(/(?:\/\*[\s\S]*?\*\/)|(?:\/\/.*$)/gm, "");
        return /\b(?:window|globalThis)\.confirm\s*\(/.test(code) || /(?:^|[^.\w])confirm\s*\(/m.test(code);
      });
    expect(offenders).toEqual([]);
  });

  it("ESLint le refuse", () => {
    const config = readSource("eslint.config.mjs");
    expect(config).toContain('"no-restricted-globals"');
    expect(config).toContain('{ object: "window", property: "confirm"');
  });

  it.each([
    ["app/association/BureauSection.tsx"],
    ["app/benevoles/BenevolesSection.tsx"],
    ["app/recrutement/RecruitmentSection.tsx"],
    ["components/cyber/landing/AboutPillars.tsx"],
    ["components/cyber/landing/AboutStats.tsx"],
    ["components/cyber/landing/SponsorsGrid.tsx"],
  ])("%s confirme la suppression par la modale commune, qui joue le geste", (path) => {
    const src = readSource(path);
    expect(src).toContain("<ConfirmActionDialog");
    expect(src).toContain("onClick={() => setPendingRemoval(");
    expect(src).toContain("onConfirm={() => remove(pendingRemoval)}");
    expect(src).toMatch(/async function remove\([^)]*\): Promise<boolean>/);
  });

  it("/profil confirme le retrait du tag Discord et la suppression du compte", () => {
    const page = readSource("app/(secured)/profil/page.tsx");
    expect(page).toContain("onDiscordTagRemove={() => setConfirmingTagRemoval(true)}");
    expect(page).toContain("onConfirm={onDiscordTagRemove}");
    expect(page).toContain("setPendingDeletion({ subject, previewed });");
    expect(page).toContain("title={ACCOUNT_DELETION_QUESTION}");
    expect(page).toContain("{accountDeletionConsequences(pendingDeletion.subject)}");
    expect(page).toContain("{deleteAccountLabel(deleting, pendingDeletion !== null)}");
    // Annuler rouvre le bouton « Supprimer mon compte ».
    expect(page).toMatch(/setPendingDeletion\(null\);\s*setDeleting\(false\);/);
    // … et lui rend le focus, perdu sur `body` quand il s'est désarmé.
    expect(page).toContain("requestAnimationFrame(() => deleteButtonRef.current?.focus());");
    expect(page).toContain("ref={deleteButtonRef}");
  });
});
