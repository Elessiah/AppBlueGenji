import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { membershipErrorMessage, teamErrorMessage } from "@/app/(secured)/equipes/_lib/team-errors";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const UPLOAD_SCREENS = [
  "app/(secured)/profil/page.tsx",
  "app/(secured)/equipes/creer/page.tsx",
  "app/(secured)/equipes/[id]/_components/TeamSettings.tsx",
];

/**
 * Les trois écrans qui envoient une image contrôlent le fichier par la même
 * fonction, aux bornes du serveur : trois copies des constantes auraient
 * divergé au premier changement de limite, et l'une d'elles disait encore
 * « trop lourde ou format non supporté » sans dire lequel.
 */
describe("précontrôle d'image — une seule règle pour tous les écrans", () => {
  it.each(UPLOAD_SCREENS)("%s passe par precheckImageUpload", (path) => {
    const source = read(path);
    expect(source).toContain("precheckImageUpload(file)");
    expect(source).not.toMatch(/const (ACCEPTED_IMAGE_TYPES|MAX_IMAGE_BYTES)/);
    expect(source).not.toContain("trop lourde ou format non supporté");
    expect(source).not.toContain('accept="image/png,image/jpeg,image/webp"');
  });
});

/**
 * Les dialogues de `/profil` traduisent dans leur `catch`, et non au `throw` :
 * sans quoi le `TypeError` d'une coupure réseau affichait son message anglais.
 */
describe("dialogues de /profil — aucun message brut au toast", () => {
  it.each([
    "app/(secured)/profil/DiscordVerificationDialog.tsx",
    "app/(secured)/profil/ConnectedAppsSection.tsx",
  ])("%s traduit ce qu'il attrape", (path) => {
    const source = read(path);
    expect(source).not.toContain("showError((e as Error).message)");
    expect(source).not.toMatch(/throw new Error\(\w+ErrorMessage\(/);
  });
});

describe("teamErrorMessage — repli nommé par le geste", () => {
  it("sert le repli du geste au code absent comme au code inconnu", () => {
    const named = teamErrorMessage("LOGO_UPLOAD_FAILED");
    for (const code of [undefined, "", "Failed to fetch"]) {
      expect(teamErrorMessage(code, "LOGO_UPLOAD_FAILED")).toBe(named);
    }
    expect(membershipErrorMessage("BOOM", "INVITATION_RESPOND_FAILED")).toBe(
      teamErrorMessage("INVITATION_RESPOND_FAILED"),
    );
  });

  it("garde le repli générique sans geste nommé, ou sur un geste inconnu", () => {
    expect(teamErrorMessage("BOOM")).toBe("L'opération a échoué.");
    expect(teamErrorMessage("BOOM", "NOT_A_CODE")).toBe("L'opération a échoué.");
  });

  it("ne remplace jamais un refus nommé par le repli", () => {
    expect(teamErrorMessage("TEAM_DELETED", "LOGO_UPLOAD_FAILED")).toBe(teamErrorMessage("TEAM_DELETED"));
  });
});
