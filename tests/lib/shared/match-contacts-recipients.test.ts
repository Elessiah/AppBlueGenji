import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import enProfile from "@/messages/en/profile.json";
import frProfile from "@/messages/fr/profile.json";
import enLaunch from "@/messages/en/launchModal.json";
import frLaunch from "@/messages/fr/launchModal.json";
import enDialogs from "@/messages/en/tournamentDialogs.json";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
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
    expect(T04?.recipients).toContain("Membres des deux équipes d'un même match et arbitres, dès que ses deux adversaires sont connus et jusqu'à sa fin, et ses casters inscrits le temps du match (de son départ à sa fin) ; contacts de chaque caster aux deux équipes et aux autres casters du match le temps du match, et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin");
    expect(T04?.subPurposes.join("\n")).toMatch(/membres des deux équipes \(joueurs, coachs, managers, propriétaires\)/);
    expect(T04?.subPurposes.join("\n")).toMatch(/d'un ou deux membres par équipe/);
    expect(T04_EN?.recipients.join("\n")).toMatch(/Members of both teams of the same match and referees, from the moment both its opponents are known to its end, and its registered casters while the match is being played/);
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
  it("la notice du profil dit que les deux équipes et les autres casters d'un match casté le voient (FR et EN)", () => {
    expect(frProfile.battletagNotice.asCaster).toContain(
      "Les deux équipes et les autres casters d'un match que tu castes</strong>, le temps du match seulement (de son départ à sa fin).",
    );
    expect(enProfile.battletagNotice.asCaster).toContain(
      "Both teams and the other casters of a match you cast</strong>, only while the match is being played (from its start to its end).",
    );
    expect(readSource("app/(secured)/profil/BattletagVisibilityNotice.tsx")).toContain('"battletagNotice.asCaster"');
  });

  it("la notice du profil nomme les casters du match, au pluriel (FR et EN)", () => {
    expect(frProfile.battletagNotice.caster).toMatch(/^<strong>Les casters de ton match<\/strong>/);
    expect(enProfile.battletagNotice.caster).toMatch(/^<strong>The casters of your match<\/strong>/);
  });
});

describe("BattleTag masqué — lecteurs d'un même match", () => {
  it("la politique et la notice nomment les membres des deux équipes, pas seulement les joueurs (FR et EN)", () => {
    expect(frProfile.battletagNotice.players).toMatch(/Les membres des deux équipes de ton match/);
    expect(enProfile.battletagNotice.players).toMatch(/The members of both teams of your match/);
    expect(readSource("lib/shared/rgpd-policy.ts")).toContain("des membres de ses deux équipes et des arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin");
    expect(readSource("lib/shared/rgpd-policy-en.ts")).toContain("by the members of both its teams and the referees from the moment both its opponents are known to its end");
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

describe("textes joueur et règles — mêmes lecteurs que le code", () => {
  it("l'indication du BattleTag masqué compte le caster, en français et en anglais", () => {
    // Fiche du titulaire : la liste partagée, derrière le « i ».
    expect(readSource("messages/fr/players.json")).toContain("si tu y es présenté comme contact : les membres des deux équipes, les arbitres et les administrateurs, dès que les adversaires sont connus et jusqu'à la fin du match, et les casters le temps du match ;");
    expect(readSource("messages/fr/players.json")).toContain("si tu castes un match : ses deux équipes et ses autres casters le temps du match, et les arbitres et les administrateurs dès que ses adversaires sont connus et jusqu'à sa fin ;");
    expect(readSource("messages/fr/players.json")).toContain("la fenêtre de lancement, elle, ne s'ouvre qu'aux deux équipes et aux casters.");
    expect(readSource("messages/en/players.json")).toContain("if you're shown there as a contact: the members of both teams, referees and administrators, from the moment the opponents are known until the end of the match, and the casters while the match is being played;");
    expect(readSource("messages/en/players.json")).toContain("if you cast a match: both its teams and its other casters while the match is being played, and referees and administrators from the moment its opponents are known until its end;");
    expect(readSource("messages/en/players.json")).toContain("the launch window only opens for both teams and the casters.");
  });

  it("la règle « Lancement d'un match » renvoie au bouton « Contacts » ouvert dès que les adversaires sont connus", () => {
    expect(readSource("messages/fr/rules.json")).toContain("le bouton « Contacts » de la carte du match montre déjà aux membres des deux équipes et aux arbitres dès que ses deux adversaires sont connus (aux casters, au départ du match) ; ceux d'un caster, les équipes et les autres casters ne les voient qu'au départ du match, les arbitres dès que les adversaires sont connus");
    expect(readSource("messages/en/rules.json")).toContain("the match card's “Contacts” button already shows to the members of both teams and to referees as soon as both its opponents are known (to the casters, once the match starts); a caster's, the teams and the other casters only see once the match starts, referees as soon as the opponents are known");
  });
});

describe("tag Discord d'un caster et BattleTag masqué dans l'avis", () => {
  it("les textes de certification disent que les équipes d'un match casté voient le tag du caster (FR et EN)", () => {
    // Décision du 2026-10-19 : les contacts du caster, le temps du match seulement.
    expect(readSource("lib/shared/discord-identity.ts")).toContain("Si tu castes un match, ses deux équipes et ses autres casters voient le tien le temps du match seulement, et les arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin.");
    expect(frProfile.verify.exposure.match).toContain("Si tu castes un match, ses deux équipes et ses autres casters voient le tien le temps du match seulement, et les arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin.");
    expect(enProfile.verify.exposure.match).toContain("If you cast a match, both its teams and its other casters see yours only while the match is being played, and the referees from the moment both its opponents are known until its end.");
    expect(readSource("lib/shared/rgpd-policy.ts")).toContain("ses casters le temps du match seulement (et, si tu castes un match, ses deux équipes et ses autres casters le temps du match, et les arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin) ;");
    expect(readSource("lib/shared/rgpd-policy-en.ts")).toContain("its casters only while the match is being played (and, if you cast a match, both its teams and its other casters while the match is being played, and the referees from the moment both its opponents are known until its end);");
  });

  it("l'avis de changement dit que le BattleTag présenté peut être masqué (FR et EN)", () => {
    expect(PRIVACY_CHANGES.find((c) => c.id === ENTRY_ID)?.details.join("\n")).toContain("le BattleTag, même masqué, d'un ou deux membres");
    expect(PRIVACY_CHANGES_EN[ENTRY_ID]?.details.join("\n")).toContain("the BattleTag, even if hidden, of one or two members");
  });
});

describe("registre et avis — tout ce que montre une fiche de contact", () => {
  it("T04 déclare rôles d'équipe et statut de certification des contacts, T01 les membres des deux équipes (FR et EN)", () => {
    expect(T04?.dataCategories.join("\n")).toMatch(/Rôles d'équipe et statut de certification/);
    expect(T04_EN?.dataCategories.join("\n")).toMatch(/Team roles and certification status/);
    const t01 = PROCESSING_ACTIVITIES.find((a) => a.ref === "T01");
    const t01En = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T01");
    expect(t01?.recipients.join("\n")).toMatch(/Parties d'un même match, dans sa seule fenêtre « Contacts »/);
    expect(t01En?.recipients.join("\n")).toMatch(/Parties to the same match, only in its “Contacts” window/);
  });

  it("l'avis dit que « les joueurs » des anciens textes étaient tous les membres des deux équipes (FR et EN)", () => {
    expect(PRIVACY_CHANGES.find((c) => c.id === ENTRY_ID)?.details.join("\n")).toMatch(/Nos textes disaient « les joueurs »/);
    expect(PRIVACY_CHANGES_EN[ENTRY_ID]?.details.join("\n")).toMatch(/Our texts said “the players”/);
  });
});

describe("caster et équipes entre eux, fiches de contact", () => {
  it("T04 donne la finalité de mise en relation des parties, une seule fois chaque catégorie (FR et EN)", () => {
    expect(T04?.purpose).toMatch(/et aux parties d'un match \(membres des deux équipes, casters inscrits\) de se joindre pour l'organiser/);
    expect(T04_EN?.purpose).toMatch(/and the parties to a match \(members of both teams, signed-up casters\) to reach each other to organise it/);
    for (const list of [T04?.dataCategories ?? [], T04_EN?.dataCategories ?? []]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("les publics du tag Discord comptent les équipes d'un match casté (FR et EN)", () => {
    expect(readSource("lib/shared/identity-sharing.ts")).toContain("\"si tu castes un match : ses deux équipes et ses autres casters le temps du match, et les arbitres dès que ses adversaires sont connus et jusqu'à sa fin ;\"");
    for (const file of ["messages/fr/profile.json", "messages/fr/login.json"]) {
      expect(readSource(file)).toContain("si tu castes un match : ses deux équipes et ses autres casters le temps du match, et les arbitres dès que ses adversaires sont connus et jusqu'à sa fin ;");
    }
    for (const file of ["messages/en/profile.json", "messages/en/login.json"]) {
      expect(readSource(file)).toContain("if you cast a match: both its teams and its other casters while the match is being played, and referees from the moment its opponents are known until its end;");
    }
  });

  it("/rgpd et l'avis disent le rôle d'équipe et l'origine Battle.net montrés sur une fiche (FR et EN)", () => {
    expect(readSource("lib/shared/rgpd-policy.ts")).toContain("il est montré avec ton rôle d'équipe et l'indication qu'il vient ou non d'un compte Battle.net rattaché");
    expect(readSource("lib/shared/rgpd-policy-en.ts")).toContain("it is shown with your team role and whether it comes from a linked Battle.net account");
    expect(PRIVACY_CHANGES.find((c) => c.id === ENTRY_ID)?.details.join("\n")).toContain("avec le rôle d'équipe et l'indication d'un BattleTag tiré d'un compte Battle.net rattaché");
    expect(PRIVACY_CHANGES_EN[ENTRY_ID]?.details.join("\n")).toContain("with the team role and whether the BattleTag comes from a linked Battle.net account");
  });
});

describe("certification Discord et caster retiré", () => {
  it("l'avis de confidentialité du profil compte les parties du match parmi les lecteurs du tag certifié (FR et EN)", () => {
    expect(frProfile.privacy.discordNotice).toContain("Certifié, il est déjà visible de l'organisation et des contacts de tes matchs.");
    expect(enProfile.privacy.discordNotice).toContain("Once verified, the organizers and your match contacts already see it.");
    expect(frProfile.audience.discord.match).toContain("les membres des deux équipes de ton match, dès que ses adversaires sont connus et jusqu'à sa fin, et ses casters le temps du match");
    expect(enProfile.audience.discord.match).toContain("the members of both teams of your match, from the moment its opponents are known until its end, and its casters while the match is being played");
  });

  it("T04 dit qu'un caster devenu inéligible est retiré à la lecture des contacts (FR et EN)", () => {
    expect(T04?.retention.join("\n")).toMatch(/un caster qui ne remplit plus les conditions de son inscription .* ne reçoit plus les contacts et n'est plus montré ; son inscription est effacée si c'est constaté avant le lancement du match/);
    expect(T04_EN?.retention.join("\n")).toMatch(/a caster who no longer meets the conditions of their sign-up .* no longer receives the contacts and is no longer shown; the sign-up is erased if this is noticed before the match is launched/);
  });
});

describe("T04 — caster d'un compte supprimé", () => {
  it("est retiré de tout match non terminé, comme le fait l'effacement (FR et EN)", () => {
    expect(T04?.retention.join("\n")).toContain("le caster d'un compte supprimé est retiré des matchs non terminés");
    expect(T04_EN?.retention.join("\n")).toContain("the caster of a deleted account is removed from matches that are not over");
    expect(readSource("lib/server/users/account-erasure.ts")).toContain("withdrawUserCasts(connection, userId, false)");
  });
});

describe("tag Discord d'un caster — arbitres", () => {
  it("la liste d'exposition dit que les arbitres le lisent dès que les adversaires d'un match casté sont connus (FR et EN)", () => {
    const fr = "Les arbitres le voient uniquement quand tu es engagé dans un tournoi en cours ou à venir — plus après —, ou, pour un match que tu castes, dès que ses deux adversaires sont connus et jusqu'à sa fin.";
    expect(readSource("lib/shared/discord-identity.ts")).toContain(fr);
    expect(frProfile.verify.exposure.referees).toBe(fr);
    expect(enProfile.verify.exposure.referees).toBe(
      "Referees can see it only while you're entered in an ongoing or upcoming tournament — not after —, or, for a match you cast, from the moment both its opponents are known until its end.",
    );
  });

  // Le staff n'est dit qu'une fois, sur sa propre ligne : la ligne du caster ne parle que des équipes.
  it("le BattleTag masqué d'un caster : la ligne du staff dit quand les arbitres le lisent (FR et EN)", () => {
    expect(frProfile.battletagNotice.asCaster).not.toContain("arbitres");
    expect(enProfile.battletagNotice.asCaster).not.toContain("referees");
    expect(frProfile.battletagNotice.staff).toContain(
      "aux mêmes moments que les deux équipes pour un match que tu joues, dès que ses deux adversaires sont connus et jusqu'à sa fin pour un match que tu castes",
    );
    expect(enProfile.battletagNotice.staff).toContain(
      "at the same times as both teams for a match you play, from the moment both its opponents are known until its end for a match you cast",
    );
  });
});

describe("Co-casters — les textes qui disent qui lit les contacts", () => {
  it("la fenêtre « Contacts » nomme les casters et dit que les autres casters lisent la fiche d'un caster (FR et EN)", () => {
    expect(frLaunch.contacts.lead).toContain("le temps du match, à ses casters");
    expect(frLaunch.contacts.lead).toContain("Celle d'un caster : aux deux équipes et aux autres casters le temps du match");
    expect(enLaunch.contacts.lead).toContain("while the match is being played, its casters");
    expect(enLaunch.contacts.lead).toContain("A caster's: to both teams and the other casters while the match is being played");
  });

  it("la priorité du contact d'équipe nomme les casters du match (FR et EN)", () => {
    const fr = [frDialogs.certification.rows.matches.does, frDialogs.certification.rows.matches.doesDiscordOnly];
    const en = [enDialogs.certification.rows.matches.does, enDialogs.certification.rows.matches.doesDiscordOnly];
    for (const text of fr) expect(text).toContain("aux deux équipes du match, à ses casters, aux arbitres");
    for (const text of en) expect(text).toContain("to both teams of the match, its casters, and the site's");
  });
});
