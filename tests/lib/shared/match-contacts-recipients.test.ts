import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import enProfile from "@/messages/en/profile.json";
import frProfile from "@/messages/fr/profile.json";
import { readSource } from "../../helpers/read-source";

/**
 * Contacts d'un match (bouton « Contacts », modale de lancement) : la lecture
 * prend tout membre en cours des deux équipes (`bg_team_members.left_at IS
 * NULL`, quel que soit son rôle), et la fiche présentée peut être celle d'un
 * coach ou d'un manager. Les textes doivent le dire, en français et en anglais.
 */
const T04 = PROCESSING_ACTIVITIES.find((a) => a.ref === "T04");
const T04_EN = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T04");
const ENTRY_ID = "2026-10-contacts-de-match-avant-le-depart";

describe("contacts d'un match — destinataires et personnes présentées", () => {
  it("le registre T04 nomme les membres des deux équipes, pas seulement les joueurs", () => {
    expect(T04?.recipients).toContain("Membres des deux équipes et caster d'un même match, dès que ses deux adversaires sont connus et jusqu'à sa fin");
    expect(T04?.subPurposes.join("\n")).toMatch(/membres des deux équipes \(joueurs, coachs, managers, propriétaires\)/);
    expect(T04?.subPurposes.join("\n")).toMatch(/d'un ou deux membres par équipe/);
    expect(T04_EN?.recipients.join("\n")).toMatch(/Members of both teams and caster of the same match/);
    expect(T04_EN?.subPurposes.join("\n")).toMatch(/members of both teams \(players, coaches, managers, owners\)/);
    expect(T04_EN?.subPurposes.join("\n")).toMatch(/one or two members per team/);
  });

  it("le registre T04 borne les « Prêt » aux tournois qui ont la phase de lancement", () => {
    const ready = T04?.subPurposes.find((p) => p.startsWith("Recueillir les « Prêt »"));
    expect(ready).toMatch(/dans les seuls tournois qui ont la phase de lancement/);
    const readyEn = T04_EN?.subPurposes.find((p) => p.startsWith("Collecting the “Ready”"));
    expect(readyEn).toMatch(/only in tournaments that have the launch phase/);
  });

  it("l'entrée de changement dit qui est présenté et qui voit, en français et en anglais", () => {
    const entry = PRIVACY_CHANGES.find((c) => c.id === ENTRY_ID);
    expect(entry?.summary).toMatch(/^Les membres des deux équipes et le caster de ton match/);
    expect(entry?.details.join("\n")).toMatch(/d'un ou deux membres par équipe \(joueur, coach, manager ou propriétaire\)/);
    const en = PRIVACY_CHANGES_EN[ENTRY_ID];
    expect(en?.summary).toMatch(/^The members of both teams and the caster of your match/);
    expect(en?.details.join("\n")).toMatch(/one or two members per team \(player, coach, manager or owner\)/);
  });
});

describe("BattleTag masqué d'un caster", () => {
  it("la notice du profil dit que les deux équipes d'un match casté le voient (FR et EN)", () => {
    expect(frProfile.battletagNotice.asCaster).toMatch(/Les deux équipes d'un match que tu castes/);
    expect(enProfile.battletagNotice.asCaster).toMatch(/Both teams of a match you cast/);
    expect(readSource("app/(secured)/profil/BattletagVisibilityNotice.tsx")).toContain('"battletagNotice.asCaster"');
  });
});

describe("BattleTag masqué — lecteurs d'un même match", () => {
  it("la politique et la notice nomment les membres des deux équipes, pas seulement les joueurs (FR et EN)", () => {
    expect(frProfile.battletagNotice.players).toMatch(/Les membres des deux équipes de chaque match de ton équipe/);
    expect(enProfile.battletagNotice.players).toMatch(/The members of both teams of every match your team plays/);
    expect(readSource("lib/shared/rgpd-policy.ts")).toContain("lisible des membres des deux équipes de tes matchs");
    expect(readSource("lib/shared/rgpd-policy-en.ts")).toContain("readable by the members of both teams of your matches");
  });
});

describe("modale « Contacts » — fermée quand l'action disparaît", () => {
  const source = readSource("app/(secured)/tournois/[id]/_components/MatchCardActions.tsx");
  const reset = 'if (contactsOpen && !actions.some((a) => a.id === "contacts")) setContactsOpen(false);';

  it("un instantané qui retire l'action (match terminé) ferme la modale avant son rendu", () => {
    expect(source).toContain(reset);
    expect(source.indexOf(reset)).toBeLessThan(source.indexOf("{contactsOpen && ("));
  });
});
