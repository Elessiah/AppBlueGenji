import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registrationConfirmText } from "@/app/(secured)/tournois/[id]/_lib/registration-confirm";

const read = (path: string) => readFileSync(join(__dirname, "..", "..", path), "utf8");

describe("confirmation d'inscription", () => {
  it("récapitule tournoi et coup d'envoi pour une équipe", () => {
    const text = registrationConfirmText({ name: "Coupe d'hiver", participantType: "TEAM" }, "12/10/2026 20:00");
    expect(text.title).toContain("« Coupe d'hiver »");
    expect(text.body.join(" ")).toContain("12/10/2026 20:00");
    expect(text.body.join(" ")).toContain("seul le staff");
    expect(text.confirmLabel).toBe("Inscrire mon équipe");
  });

  it("tutoie le joueur en tournoi individuel", () => {
    const text = registrationConfirmText({ name: "Solo", participantType: "SOLO" }, "demain");
    expect(text.title).toBe("T'inscrire à « Solo » ?");
    expect(text.confirmLabel).toBe("M'inscrire");
    expect(text.body.join(" ")).not.toContain("équipe");
  });

  it("passe par la confirmation, bouton désactivé pendant l'envoi", () => {
    const page = read("app/(secured)/tournois/[id]/page.tsx");
    expect(page).toMatch(/const registerTeam = \(\) => \{[\s\S]*?setPendingConfirm\(/);
    expect(page).toContain("run: performRegister");
    const dialog = read("app/(secured)/tournois/[id]/_components/ConfirmActionDialog.tsx");
    expect(dialog).toMatch(/if \(busy\) return;/);
    expect(dialog).toMatch(/type="submit"[^>]*disabled=\{busy\}/);
  });
});
