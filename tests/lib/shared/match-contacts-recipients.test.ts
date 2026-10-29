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
import { DONNEES_PROFIL, DROITS, REFEREE_BATTLETAG_BEFORE_V7_SCOPE, REFEREE_BATTLETAG_SCOPE } from "@/lib/shared/rgpd-policy";
import { DONNEES_PROFIL_EN, DROITS_EN } from "@/lib/shared/rgpd-policy-en";
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
    expect(T04?.subPurposes.join("\n")).toMatch(/d'un ou deux membres par équipe \(un seul dans les tournois Marvel Rivals\)/);
    expect(T04_EN?.recipients.join("\n")).toMatch(/Members of both teams of the same match and referees, from the moment both its opponents are known to its end, and its registered casters while the match is being played/);
    expect(T04_EN?.subPurposes.join("\n")).toMatch(/members of both teams \(players, coaches, managers, owners\)/);
    expect(T04_EN?.subPurposes.join("\n")).toMatch(/one or two members per team \(only one in Marvel Rivals tournaments\)/);
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
    expect(readSource("messages/fr/players.json")).toContain("si tu es présenté comme contact (fenêtres « Contacts » et de lancement) : les membres des deux équipes, les arbitres et les administrateurs, dès que les adversaires sont connus et jusqu'à la fin du match, et les casters le temps du match ;");
    expect(readSource("messages/fr/players.json")).toContain("si tu castes un match : ses deux équipes et ses autres casters le temps du match, et les arbitres et les administrateurs dès que ses adversaires sont connus et jusqu'à sa fin ;");
    expect(readSource("messages/fr/players.json")).toContain("la fenêtre de lancement, elle, ne s'ouvre qu'aux deux équipes, aux casters et à l'arbitre désigné ; la page du match reprend le BattleTag de ses casters et de son arbitre désigné, aux mêmes personnes et aux mêmes moments que la fenêtre « Contacts ».");
    expect(readSource("messages/en/players.json")).toContain("if you're shown as a contact (“Contacts” and launch windows): the members of both teams, referees and administrators, from the moment the opponents are known until the end of the match, and the casters while the match is being played;");
    expect(readSource("messages/en/players.json")).toContain("if you cast a match: both its teams and its other casters while the match is being played, and referees and administrators from the moment its opponents are known until its end;");
    expect(readSource("messages/en/players.json")).toContain("the launch window only opens for both teams, the casters and the assigned referee; the match page repeats the BattleTag of its casters and its assigned referee, to the same people at the same times as the “Contacts” window.");
  });

  it("la règle « Lancement d'un match » renvoie au bouton « Contacts » ouvert dès que les adversaires sont connus", () => {
    expect(readSource("messages/fr/rules.json")).toContain("le bouton « Contacts » de la carte du match montre déjà aux membres des deux équipes et aux arbitres dès que ses deux adversaires sont connus (aux casters, au départ du match) ; ceux d'un caster, les équipes et les autres casters ne les voient qu'au départ du match, les arbitres dès que les adversaires sont connus");
    expect(readSource("messages/en/rules.json")).toContain("the match card's “Contacts” button already shows to the members of both teams and to referees as soon as both its opponents are known (to the casters, once the match starts); a caster's, the teams and the other casters only see once the match starts, referees as soon as the opponents are known");
  });
});

describe("tag Discord d'un caster et BattleTag masqué dans l'avis", () => {
  it("les textes de certification disent que les équipes d'un match casté voient le tag du caster (FR et EN)", () => {
    // Décision du 2026-10-19 : les contacts du caster, le temps du match seulement.
    expect(readSource("lib/shared/discord-identity.ts")).toContain("Si tu castes un match, ses deux équipes et ses autres casters voient le tien le temps du match seulement, dans les fenêtres « Contacts » et de lancement du match et sur sa page, et les arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, dans sa fenêtre « Contacts » et sur sa page.");
    expect(frProfile.verify.exposure.match).toContain("Si tu castes un match, ses deux équipes et ses autres casters voient le tien le temps du match seulement, dans les fenêtres « Contacts » et de lancement du match et sur sa page, et les arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, dans sa fenêtre « Contacts » et sur sa page.");
    expect(enProfile.verify.exposure.match).toContain("If you cast a match, both its teams and its other casters see yours only while the match is being played, in the match's “Contacts” and launch windows and on its page, and the referees from the moment both its opponents are known until its end, in its “Contacts” window and on its page.");
    expect(readSource("lib/shared/rgpd-policy.ts")).toContain("ses casters le temps du match seulement (et, si tu castes un match, ses deux équipes et ses autres casters le temps du match, dans ses fenêtres « Contacts » et de lancement et sur sa page, et les arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, dans sa fenêtre « Contacts » et sur sa page) ;");
    expect(readSource("lib/shared/rgpd-policy-en.ts")).toContain("its casters only while the match is being played (and, if you cast a match, both its teams and its other casters while the match is being played, in its “Contacts” and launch windows and on its page, and the referees from the moment both its opponents are known until its end, in its “Contacts” window and on its page);");
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
    expect(t01?.recipients.join("\n")).toMatch(/Parties d'un même match : dans sa fenêtre « Contacts » et dans sa fenêtre de lancement, pour le BattleTag de tout contact présenté/);
    expect(t01En?.recipients.join("\n")).toMatch(/Parties to the same match: in its “Contacts” window and its launch window, for the BattleTag of any contact presented/);
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
    expect(readSource("lib/shared/identity-sharing.ts")).toContain("\"si tu castes un match : ses deux équipes et ses autres casters le temps du match, dans ses fenêtres « Contacts » et de lancement et sur sa page, et les arbitres dès que ses adversaires sont connus et jusqu'à sa fin, dans sa fenêtre « Contacts » et sur sa page ;\"");
    for (const file of ["messages/fr/profile.json", "messages/fr/login.json"]) {
      expect(readSource(file)).toContain("si tu castes un match : ses deux équipes et ses autres casters le temps du match, dans ses fenêtres « Contacts » et de lancement et sur sa page, et les arbitres dès que ses adversaires sont connus et jusqu'à sa fin, dans sa fenêtre « Contacts » et sur sa page ;");
    }
    for (const file of ["messages/en/profile.json", "messages/en/login.json"]) {
      expect(readSource(file)).toContain("if you cast a match: both its teams and its other casters while the match is being played, in its “Contacts” and launch windows and on its page, and referees from the moment its opponents are known until its end, in its “Contacts” window and on its page;");
    }
  });

  it("casterDiscordWording_allLegalAndUiSources_neverOmitLaunchWindow", () => {
    // Revue #525 : la fenêtre de lancement montre le tag Discord du caster aux équipes et aux
    // autres casters, jamais aux arbitres dès l'appariement (elle ne s'ouvre pas au staff).
    for (const file of ["lib/shared/identity-sharing.ts", "lib/shared/discord-identity.ts", "lib/shared/rgpd-policy.ts", "messages/fr/login.json", "messages/fr/profile.json"]) {
      expect(readSource(file)).not.toContain("jusqu'à sa fin, dans ses fenêtres « Contacts » et de lancement");
      expect(readSource(file)).not.toContain("jusqu'à sa fin, dans les fenêtres « Contacts » et de lancement");
    }
    for (const file of ["lib/shared/rgpd-policy-en.ts", "messages/en/login.json", "messages/en/profile.json"]) {
      expect(readSource(file)).not.toContain("until its end, in its “Contacts” and launch windows");
      expect(readSource(file)).not.toContain("until its end, in the match's “Contacts” and launch windows");
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

  it("le contact d'une équipe engagée sait qu'il est montré à tous les casters du match (FR et EN)", () => {
    expect(frDialogs.certification.leadManager).toContain("et aux casters le temps du match");
    expect(enDialogs.certification.leadManager).toContain("and to the casters while the match is played");
    expect(frDialogs.certification.leadManager).not.toContain("au caster ");
    expect(enDialogs.certification.leadManager).not.toContain("the caster ");
  });
});

/**
 * MATCH-REFEREE MR-2 : le BattleTag (même masqué) de l'arbitre désigné est lu
 * par les deux équipes et le staff dès que les adversaires sont connus, par
 * les casters le temps du match (`buildLaunchReferee`, `ctx.exposes`) ; la
 * fenêtre de lancement s'ouvre aussi à lui. Chaque notice « BattleTag masqué »
 * le dit, en français et en anglais.
 */
describe("BattleTag masqué — arbitre désigné", () => {
  const namespaces = ["profile", "login", "players"] as const;
  const load = (lang: "fr" | "en", ns: (typeof namespaces)[number]) =>
    JSON.parse(readSource(`messages/${lang}/${ns}.json`)) as { audience: { battletag: Record<string, string> } };

  it("la liste « qui le lit » porte une ligne pour l'arbitre désigné, avant celle de la fenêtre de lancement (FR et EN)", () => {
    for (const ns of namespaces) {
      const fr = load("fr", ns).audience.battletag;
      const en = load("en", ns).audience.battletag;
      expect(fr.asReferee).toBe(
        "si tu es l'arbitre désigné d'un match : ses deux équipes, les arbitres et les administrateurs dès que ses adversaires sont connus et jusqu'à sa fin, et ses casters le temps du match (tu peux te retirer d'un match à tout moment ; effacer ton BattleTag te retirerait l'arbitrage, qui demande celui de Battle.net) ;",
      );
      expect(en.asReferee).toBe(
        "if you are the assigned referee of a match: both its teams, referees and administrators from the moment its opponents are known until its end, and its casters while the match is being played (you can withdraw from a match at any time; erasing your BattleTag would remove your refereeing, which requires the one from Battle.net);",
      );
      expect(Object.keys(fr)).toEqual(["title", "match", "asCaster", "asReferee", "launch", "footer"]);
      expect(Object.keys(en)).toEqual(Object.keys(fr));
    }
    expect(readSource("lib/shared/identity-audience.ts")).toContain('["match", "asCaster", "asReferee", "launch"]');
  });

  it("la modale de masquage du profil nomme l'arbitre désigné, y compris dans la fenêtre de lancement (FR et EN)", () => {
    expect(frProfile.battletagNotice.asReferee).toContain("d'un match dont tu es l'arbitre désigné</strong>");
    expect(enProfile.battletagNotice.asReferee).toContain("of a match you are the assigned referee of</strong>");
    expect(readSource("app/(secured)/profil/BattletagVisibilityNotice.tsx")).toContain('"battletagNotice.asReferee"');
    expect(frProfile.battletagNotice.warning).toContain("Si tu es l'arbitre désigné d'un match");
    expect(enProfile.battletagNotice.warning).toContain("If you are the assigned referee of a match");
    expect(frProfile.battletagNotice.warning).toContain("pour les équipes, les casters et l'arbitre désigné, dans sa fenêtre de lancement");
    expect(enProfile.battletagNotice.warning).toContain("for the teams, the casters and the assigned referee, its launch window");
    expect(frProfile.battletagNotice.staff).toContain("ne s'ouvre qu'aux équipes, aux casters et à l'arbitre désigné");
    expect(enProfile.battletagNotice.staff).toContain("only opens for the teams, the casters and the assigned referee");
  });

  it("aucun texte vivant ne borne plus la fenêtre de lancement aux équipes et aux casters (FR et EN)", () => {
    const living = [
      "lib/shared/processing-register.ts",
      "lib/shared/processing-register-en.ts",
      "lib/shared/rgpd-policy.ts",
      "lib/shared/rgpd-policy-en.ts",
      "lib/shared/identity-sharing.ts",
      ...namespaces.flatMap((ns) => [`messages/fr/${ns}.json`, `messages/en/${ns}.json`]),
    ];
    for (const file of living) {
      const text = readSource(file);
      expect(text).not.toMatch(/ne s'ouvre qu'aux (deux )?équipes et aux casters/);
      expect(text).not.toMatch(/only opens for (both|the) teams and the casters/);
    }
  });
});

/**
 * Revue juridique MR-2 #487 : l'arbitre désigné repose sur l'intérêt légitime
 * tant que les conditions d'utilisation n'ont pas de clause (v6 inchangée,
 * clause reportée à la v7) ; depuis la version 7 (TERMS v7, décision de
 * l'utilisateur du 2026-10-27), sa présentation repose sur le contrat ; son avis push figure au registre T12 ; la ligne
 * BattleTag de /rgpd dit son cas ; l'annonce dit l'heure du pseudo seul et la
 * condition de permission du push.
 */
describe("arbitre désigné — registre, /rgpd et annonce (revue juridique)", () => {
  const T12 = PROCESSING_ACTIVITIES.find((a) => a.ref === "T12");
  const T12_EN = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T12");
  const T01 = PROCESSING_ACTIVITIES.find((a) => a.ref === "T01");
  const T01_EN = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T01");
  const REFEREE_ENTRY = "2026-10-arbitre-designe-des-matchs";

  // Décision 30 (2026-10-27) et décision du gestionnaire (revue juridique de
  // #491) : le contrat dès que l'arbitre a accepté la version 7, l'intérêt
  // légitime et son opposition tant qu'il ne l'a pas acceptée.
  it("T04 rattache la présentation de l'arbitre aux conditions v7 une fois acceptées, l'intérêt légitime opposable avant (FR et EN)", () => {
    expect(T04?.legalBasis).toContain(
      "exécution du service (contrat — conditions d'utilisation, section « Contacts de match », depuis leur version 7 : que les parties du match sachent qui l'arbitre et, en Overwatch, puissent l'ajouter en jeu) pour la présentation de l'arbitre désigné aux parties du match, dans ses fenêtres « Contacts » et de lancement et sur la page du match, une fois que cet arbitre a accepté la version 7 des conditions ou une version suivante — tant qu'il ne l'a pas acceptée, intérêt légitime (même but), et il peut s'y opposer (art. 21) par le formulaire de signalement (catégorie RGPD) : retenue, son opposition le retire de tous ses matchs non terminés (le staff en désigne un autre ; ses matchs terminés gardent leur arbitre) et l'empêche d'en prendre un ou de s'en voir confier un tant qu'elle n'est pas levée (à sa seule demande), et continue de valoir une fois la version 7 ou une suivante acceptée — (il peut se retirer d'un match à tout moment, le staff pouvant lui confier de nouveau ce match (sauf opposition retenue), sans avis ; tant qu'il n'a pas accepté la version 7 ou une suivante, la fenêtre d'acceptation couvrant les pages des tournois, il s'en retire en le demandant par le formulaire de signalement)",
    );
    expect(T04_EN?.legalBasis).toContain(
      "for presenting the assigned referee to the parties to the match, in its “Contacts” and launch windows and on the match page, once that referee has accepted version 7 of the terms or a later version — until they accept it, legitimate interest (same aim), and they may object to it (art. 21) through the report form (GDPR category): once upheld, their objection removes them from all their unfinished matches (the staff assigns another referee; their finished matches keep their referee) and stops them taking or being assigned one until it is lifted (at their request only), and still stands once version 7 or a later one is accepted — (they can withdraw from a match at any time, the staff being able to assign that match to them again (unless an objection is upheld), without notice; until they have accepted version 7 or a later one, as the acceptance window covers the tournament pages, they withdraw by asking for it through the report form)",
    );
    expect(T01?.legalBasis).toContain("pour celui de l'arbitre désigné, dans ces fenêtres comme sur la page du match, intérêt légitime, avec droit d'opposition, tant qu'il n'a pas accepté la version 7 des conditions ou une version suivante (registre T04)");
    expect(T01_EN?.legalBasis).toContain("for the assigned referee's, in these windows as on the match page, legitimate interest, with a right to object, until they have accepted version 7 of the terms or a later version (record T04)");
    // Revue juridique de #491 : la preuve d'acceptation (T13) fixe aussi cette base.
    const T13 = PROCESSING_ACTIVITIES.find((a) => a.ref === "T13");
    const T13_EN = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T13");
    expect(T13?.subPurposes).toContain("Fixer la base de la présentation d'un arbitre désigné aux parties de ses matchs (registre T04) : l'intérêt légitime tant qu'il n'a pas accepté la version 7 ou une suivante, le contrat ensuite");
    expect(T13_EN?.subPurposes).toContain("Setting the basis for presenting an assigned referee to the parties to their matches (record T04): legitimate interest until they have accepted version 7 or a later one, the contract afterwards");
    expect(T04?.legalBasis).toContain("exécution du service (les arbitres agissant pour l'association) pour le recueil de son « Prêt »");
    expect(T04_EN?.legalBasis).toContain("performance of the service (the referees acting for the association) for collecting their “Ready”");
    // Revue juridique de #491 : retrait d'office quand l'arbitre devient joueur du match avant son lancement.
    expect(JSON.stringify(T04)).toContain("ou il devient joueur du match avant son lancement)");
    expect(JSON.stringify(T04)).not.toContain("il joue désormais le match), avec le motif");
    expect(JSON.stringify(T04_EN)).toContain("or they become a player of the match before its launch)");
    expect(JSON.stringify(T04_EN)).not.toContain("or they now play the match)");
    expect(T04?.legalBasis).not.toContain("exécution du service (les arbitres agissant pour l'association) pour la présentation de l'arbitre");
    expect(T04?.legalBasis).not.toContain("conditions d'utilisation, les arbitres agissant pour l'association) pour la présentation de l'arbitre");
    expect(T04_EN?.legalBasis).not.toContain("terms of use, the referees acting for the association) for presenting the assigned referee");
  });

  it("T12 liste l'avis du retrait de l'arbitrage (FR et EN)", () => {
    expect(T12?.subPurposes).toContain(
      "Retrait de son arbitrage d'un match (par le staff, match confié à un autre arbitre ou passé en autogestion, ou d'office), avec le motif, pour l'arbitre désigné qui détient encore la permission d'arbitrage",
    );
    expect(T12_EN?.subPurposes).toContain(
      "Removal of their refereeing of a match (by the staff, match assigned to another referee or switched to self-management, or automatically), with the reason, for the assigned referee who still holds the refereeing permission",
    );
    expect(T12_EN?.subPurposes).toHaveLength(T12?.subPurposes.length ?? -1);
  });

  it("la ligne BattleTag de /rgpd dit qui lit celui de l'arbitre désigné (FR et EN)", () => {
    const fr = DONNEES_PROFIL.find((d) => d.donnee === "Pseudo Overwatch")?.finalite ?? "";
    const index = DONNEES_PROFIL.findIndex((d) => d.donnee === "Pseudo Overwatch");
    const en = DONNEES_PROFIL_EN[index]?.finalite ?? "";
    expect(fr).toContain(
      "si tu es l'arbitre désigné d'un match, de ses deux équipes et des arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin et de ses casters le temps du match (voir « Arbitre désigné d'un match »)",
    );
    expect(en).toContain(
      "if you are the assigned referee of a match, by both its teams and the referees from the moment both its opponents are known until its end and by its casters while the match is being played (see “Assigned referee of a match”)",
    );
  });

  it("l'annonce dit le pseudo seul, le retrait par le staff seul et la condition de permission du push (FR et EN)", () => {
    const fr = PRIVACY_CHANGES.find((c) => c.id === REFEREE_ENTRY)?.details.join(" ") ?? "";
    const en = PRIVACY_CHANGES_EN[REFEREE_ENTRY]?.details.join(" ") ?? "";
    expect(fr).toContain("son pseudo seul y paraît dès que la fenêtre de lancement montre le match");
    expect(en).toContain("their username alone appears there as soon as the launch window shows the match");
    expect(fr).toContain("retiré par le staff (retrait, match confié à un autre arbitre ou passé en autogestion)");
    expect(en).toContain("removed from you by the staff (removal, match assigned to another referee or switched to self-management)");
    expect(fr).toContain("tant que tu détiens la permission d'arbitrage");
    expect(en).toContain("as long as you hold the refereeing permission");
    expect(fr).toContain("La fenêtre de lancement s'ouvre aussi à lui");
    expect(en).toContain("The launch window also opens to them");
  });

  it("le résumé de l'annonce dit les moments de chaque lecteur, sans « le staff » (FR et EN)", () => {
    const fr = PRIVACY_CHANGES.find((c) => c.id === REFEREE_ENTRY)?.summary ?? "";
    const en = PRIVACY_CHANGES_EN[REFEREE_ENTRY]?.summary ?? "";
    expect(fr).toContain(
      "Les deux équipes et les arbitres voient son pseudo et son BattleTag dès que les deux adversaires sont connus, les casters du match le temps du match",
    );
    expect(en).toContain(
      "Both teams and the referees see their username and BattleTag as soon as both opponents are known, the match's casters while the match is being played",
    );
    expect(fr).not.toContain("le staff voient");
    expect(en).not.toContain("the staff see");
  });

  // Revue juridique de #487, passe 3 : sans clause des conditions (version 6)
  // et sans demande de l'arbitre que le staff désigne, la présentation de
  // l'arbitre repose sur l'intérêt légitime, opposable par le formulaire de
  // signalement. L'entrée MR-2, en production depuis #487, ne se réécrit pas ;
  // elle reste vraie pour un arbitre qui n'a pas accepté la version 7
  // (revue juridique de #491).
  it("fonde la présentation de l'arbitre sur l'intérêt légitime, avec son opposition (FR et EN)", () => {
    const fr = PRIVACY_CHANGES.find((c) => c.id === REFEREE_ENTRY)?.details.join(" ") ?? "";
    const en = PRIVACY_CHANGES_EN[REFEREE_ENTRY]?.details.join(" ") ?? "";
    expect(fr).toContain("au titre de l'intérêt légitime (qu'elles sachent qui arbitre) : tu t'y opposes par le formulaire de signalement (catégorie RGPD) — retenue, ton opposition fait que le staff ne te confie plus de match, ceux que tu tiens déjà te restant — et tu peux te retirer d'un match à tout moment, le staff pouvant sinon te confier de nouveau ce match, sans avis");
    expect(en).toContain("on the basis of legitimate interest (they know who referees): you object to it through the report form (GDPR category) — once upheld, your objection means the staff no longer assigns you matches, those you already hold staying yours — and you can withdraw from a match at any time, the staff otherwise being able to assign that match to you again, without notice");
    expect(fr).not.toContain("version 7");
    expect(en).not.toContain("version 7");
  });

  // TERMS v7 : le contrat une fois la version 7 acceptée par l'arbitre,
  // l'intérêt légitime et son opposition jusque-là (décision du gestionnaire,
  // revue juridique de #491) — /rgpd, droit d'opposition et ligne BattleTag.
  it("garde l'opposition de l'arbitre tant qu'il n'a pas accepté la version 7, le contrat ensuite (FR et EN)", () => {
    const objectFr = DROITS.find((d) => d.title === "Droit d'opposition")?.text ?? "";
    const objectEn = DROITS_EN.find((d) => d.title === "Right to object")?.text ?? "";
    expect(objectFr).toContain("ainsi que la présentation de l'arbitre désigné aux parties de ses matchs tant qu'il n'a pas accepté la version 7 des conditions d'utilisation ou une version suivante, par le formulaire de signalement");
    expect(objectEn).toContain("as well as the presentation of the assigned referee to the parties to their matches as long as they have not accepted version 7 of the terms of use or a later version, through the report form");
    const row = DONNEES_PROFIL.find((d) => d.donnee === "Pseudo Overwatch");
    expect(row?.extraBases).toContainEqual({ base: "Exécution du contrat", scope: REFEREE_BATTLETAG_SCOPE });
    expect(row?.extraBases).toContainEqual({ base: "Intérêt légitime", scope: REFEREE_BATTLETAG_BEFORE_V7_SCOPE });
    const index = DONNEES_PROFIL.findIndex((d) => d.donnee === "Pseudo Overwatch");
    expect(DONNEES_PROFIL_EN[index]?.extraBases?.map((b) => b.scope)).toEqual(
      expect.arrayContaining([
        "the BattleTag of the assigned referee of a match in an Overwatch tournament (never in Marvel Rivals), even when hidden, in its “Contacts” and launch windows and on the match page: read by both its teams and the referees as soon as both its opponents are known until its end, by its casters while the match is being played (the launch window, at the start of the match, only opens for both teams, the casters and the assigned referee); withdrawal from a match at any time, the staff being able to assign that match to them again, without notice (terms of use, “Match contacts”, once the referee has accepted their version 7 or a later one)",
        "the same presentation of the assigned referee's BattleTag, as long as that referee has not accepted version 7 of the terms of use or a later version — objection through the report form, GDPR category (once upheld, they are removed from all their unfinished matches and can no longer take or be assigned one until it is lifted — at their request only —, even once version 7 or a later one is accepted)",
      ]),
    );
  });
});
