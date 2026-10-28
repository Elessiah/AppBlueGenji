import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import frProfile from "@/messages/fr/profile.json";
import enProfile from "@/messages/en/profile.json";
import frLogin from "@/messages/fr/login.json";
import enLogin from "@/messages/en/login.json";
import { TERMS_SECTIONS } from "@/lib/shared/terms-of-use";
import { TERMS_SECTIONS_EN } from "@/lib/shared/terms-of-use-en";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import frPlayers from "@/messages/fr/players.json";
import enPlayers from "@/messages/en/players.json";
import { HIDDEN_BATTLETAG_AUDIENCE } from "@/lib/shared/identity-sharing";
import { hiddenBattletagAudienceLines } from "@/lib/shared/identity-audience";

/**
 * CONTACTS-FOLLOWUP (décisions du 2026-10-19) : masqué, le BattleTag ne se lit
 * plus que dans la fenêtre « Contacts » d'un match et dans sa fenêtre de
 * lancement — dit là où on le renseigne (champ du profil, connexion et
 * rattachement Battle.net) et sur la fiche de son titulaire, par **une seule**
 * liste (`HIDDEN_BATTLETAG_AUDIENCE`, derrière le bouton « i »), la même en
 * français et en anglais dans chaque espace qui la montre.
 */
const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const lines = (messages: { audience: { battletag: Record<string, string> } }) =>
  hiddenBattletagAudienceLines((key) => messages.audience.battletag[key.slice("audience.battletag.".length)] ?? key);

describe("avertissement du BattleTag masqué", () => {
  it("est la liste partagée, mot pour mot, dans chaque espace (FR) et identique d'un espace à l'autre (EN)", () => {
    expect(lines(frProfile)).toEqual(HIDDEN_BATTLETAG_AUDIENCE);
    expect(lines(frLogin)).toEqual(HIDDEN_BATTLETAG_AUDIENCE);
    expect(lines(frPlayers)).toEqual(HIDDEN_BATTLETAG_AUDIENCE);
    expect(lines(enLogin)).toEqual(lines(enProfile));
    expect(lines(enPlayers)).toEqual(lines(enProfile));
  });

  it("se lit derrière le « i » du champ BattleTag du profil, verrouillé ou non", () => {
    const page = readSource("app/(secured)/profil/page.tsx");
    const hint = page.slice(page.indexOf('<InfoHint id="profile-battletag-more"'), page.indexOf("</InfoHint>", page.indexOf('<InfoHint id="profile-battletag-more"')));
    // Hors du ternaire : les deux branches (verrouillé par Blizzard ou saisi) la portent.
    expect(hint).toContain("<AudienceList lines={hiddenBattletagAudienceText(text)} />");
    expect(page).toContain('return { status: text.t("games.gameTagNotice"), details: [text.t("games.blizzardNotice")] };');
    expect(hint.lastIndexOf("AudienceList")).toBeGreaterThan(hint.indexOf("<HintDetails lines={battletagNotice.details} />"));
    // Le champ la garde pour description : le lecteur d'écran l'entend entière.
    expect(page).toContain('fieldErrors.aria("battletag", "profile-battletag-hint", "profile-battletag-more")');
  });

  it("se lit au rattachement de Battle.net (profil) et à la connexion par Blizzard", () => {
    expect(readSource("app/(secured)/profil/ConnectedAppsSection.tsx")).toContain("<AudienceList lines={hiddenBattletagAudienceText(text)} />");
    expect(readSource("app/connexion/_components/OAuthButtons.tsx")).toContain("<AudienceList lines={hiddenBattletagAudienceLines(t)} />");
  });

  it("garde dans la modale de masquage son propre avertissement, avant la liste", () => {
    expect(frProfile.battletagNotice.warning).toMatch(/^Tu peux masquer ton BattleTag : il reste visible/);
    expect(enProfile.battletagNotice.warning).toMatch(/^You can hide your BattleTag: it stays visible/);
    const notice = readSource("app/(secured)/profil/BattletagVisibilityNotice.tsx");
    expect(notice.indexOf('t("battletagNotice.warning")')).toBeGreaterThan(-1);
    expect(notice.indexOf('t("battletagNotice.warning")')).toBeLessThan(notice.indexOf('t("battletagNotice.intro")'));
  });

  it("dit au caster qu'il n'a les contacts que le temps du match (FR et EN)", () => {
    expect(frProfile.battletagNotice.caster).toContain("le temps du match seulement (de son départ à sa fin)");
    expect(enProfile.battletagNotice.caster).toContain("only while the match is being played (from its start to its end)");
    expect(frProfile.audience.battletag.match).toContain("et les casters le temps du match");
    expect(enProfile.audience.battletag.match).toContain("and the casters while the match is being played");
  });
});

describe("conditions d'utilisation — contacts de match (version 7)", () => {
  const fr = TERMS_SECTIONS.find((s) => s.id === "contacts-de-match");
  const en = TERMS_SECTIONS_EN.find((s) => s.id === "contacts-de-match");

  it("prévoit le partage des contacts aux deux équipes, et aux casters le temps du match seulement", () => {
    const text = fr?.paragraphs.join(" ") ?? "";
    expect(text).toContain("**tag Discord** certifié, **BattleTag**, **même masqué**, et **rôle d'équipe**");
    expect(text).toContain("aux **membres des deux équipes** du match et aux **arbitres** (administrateurs compris), dès que ses deux adversaires sont connus et jusqu'à sa fin");
    // Version 7 : casters au pluriel, chacun voyant aussi les contacts des autres casters du match.
    expect(text).toContain("à ses **casters** inscrits — un match peut en avoir plusieurs — **le temps du match** seulement, de son départ à sa fin");
    expect(text).toContain("Au titre de l'organisation du tournoi");
    expect(text).toContain("Un tag Discord non certifié n'est jamais communiqué.");
    // Seule porte d'un BattleTag masqué, staff compris ; contacts du caster le temps du match.
    // Détacher Battle.net suppose un autre moyen de connexion (refus LAST_CONNECTION sinon).
    expect(text).toContain("ne s'efface qu'une fois le compte Battle.net détaché, ce qui suppose un autre moyen de connexion)");
    expect(frProfile.battletagNotice.outro).toContain("après avoir ajouté un autre moyen de connexion si c'est le seul");
    expect(enProfile.battletagNotice.outro).toContain("after adding another way to log in if it is your only one");
    expect(frProfile.battletagLock.change).toContain("après avoir ajouté un autre moyen de connexion si c'est le seul");
    expect(enProfile.battletagLock.change).toContain("after adding another way to log in if it is your only one");
    // Version 7 : la page du match est le troisième lieu de ce partage, sans les contacts des équipes.
    expect(text).toContain("Ce partage passe par la fenêtre « Contacts » du match, par sa fenêtre de lancement, qui la reprend au départ du match et ne s'ouvre qu'aux deux équipes, aux casters et à l'arbitre désigné, et par la **page du match**, qui reprend les contacts des casters et le BattleTag de l'arbitre désigné — jamais les contacts des équipes — aux mêmes personnes et aux mêmes moments que la fenêtre « Contacts » : un BattleTag masqué n'est lisible nulle part ailleurs sur le site, pour personne — arbitres et administrateurs compris.");
    expect(text).toContain("celles de chaque caster le sont aux deux équipes et aux **autres casters** du match sur ce même temps du match, et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin");
    expect(text).toContain("Masquer son BattleTag ne le retire donc ni de ces fenêtres ni de cette page");
    expect(text).toContain("le code de replay d'une map, visible de tout utilisateur connecté sur la fiche du tournoi");
  });

  // La section renvoie là où la politique dit qui lit le BattleTag (tableau des données).
  it("renvoie à la section « Données collectées » de la politique, ancre présente en FR et EN", () => {
    expect(fr?.links?.[0]?.href).toBe("/rgpd#donnees-collectees");
    expect(en?.links?.[0]?.href).toBe("/rgpd#donnees-collectees");
    expect(readSource("app/rgpd/page.tsx")).toContain('<section id="donnees-collectees"');
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain('<section id="donnees-collectees"');
  });

  it("se traduit en anglais, à la même place", () => {
    expect(TERMS_SECTIONS_EN.map((s) => s.id)).toEqual(TERMS_SECTIONS.map((s) => s.id));
    const text = en?.paragraphs.join(" ") ?? "";
    expect(text).toContain("**even when hidden**");
    // L'annonce v5 (PRIVACY_CHANGES) donne la même marche pour un BattleTag reçu de Battle.net.
    expect(JSON.stringify(PRIVACY_CHANGES.find((c) => c.id === "2026-10-contacts-de-match-caster-et-conditions-v5"))).toContain("après avoir ajouté un autre moyen de connexion si c'est le seul");
    expect(text).toContain("once the Battle.net account is unlinked, which requires another means of logging in)");
    expect(text).toContain("**only while the match is being played**, from its start to its end");
    expect(text).toContain("a hidden BattleTag is readable nowhere else on the site, by anyone — referees and administrators included");
    // Le jeu affiche les identifiants : le code de replay le dit (FR et EN), comme /rgpd.
    expect(text).toContain("a map's replay code, visible to any logged-in user on the tournament page");
    expect(text).toContain("each caster's is shared with both teams and with the **other casters** of the match over that same match time, and with the referees from the moment both its opponents are known until its end");
    expect(text).toContain("and with its registered **casters** — a match may have several — **only while the match is being played**");
    expect(text).toContain("and through the **match page**, which repeats the casters' contacts and the assigned referee's BattleTag — never the teams' contacts — to the same people at the same times as the “Contacts” window");
    expect(text).toContain("Hiding a BattleTag therefore removes it neither from these windows nor from this page");
    expect(en?.paragraphs).toHaveLength(fr?.paragraphs.length ?? -1);
  });
});

/**
 * Décision du 2026-10-19 : tout texte qui dit où se lit un BattleTag masqué
 * nomme la fenêtre « Contacts » du match **et** sa fenêtre de lancement (qui
 * la reprend au départ du match), en français comme en anglais.
 */
describe("BattleTag masqué — les deux fenêtres nommées partout", () => {
  // L'annonce des conditions v6 : lue par son identifiant, des entrées
  // ultérieures (annonces #live par soirée) pouvant la suivre.
  const V6_ENTRY_ID = "2026-10-conditions-v6-acceptation-pour-tous";
  const FR_CONTACTS = /fenêtre « Contacts »/;
  const FR_LAUNCH = /fenêtre de lancement/;
  const EN_CONTACTS = /“Contacts” window/;
  const EN_LAUNCH = /launch window/;

  const expectBoth = (text: string, contacts: RegExp, launch: RegExp) => {
    expect(text).toMatch(contacts);
    expect(text).toMatch(launch);
  };

  it("liste partagée, modale de masquage et fiche joueur", () => {
    expect(frProfile.battletagNotice.intro).toMatch(FR_LAUNCH);
    expectBoth(frProfile.battletagNotice.intro, FR_CONTACTS, FR_LAUNCH);
    expectBoth(enProfile.battletagNotice.intro, EN_CONTACTS, EN_LAUNCH);
    expectBoth(frProfile.battletagNotice.staff, FR_CONTACTS, FR_LAUNCH);
    expectBoth(enProfile.battletagNotice.staff, EN_CONTACTS, EN_LAUNCH);
    expectBoth(frPlayers.audience.battletag.title, FR_CONTACTS, FR_LAUNCH);
    expectBoth(enPlayers.audience.battletag.title, EN_CONTACTS, EN_LAUNCH);
  });

  it("conditions v6, annonce PRIVACY_CHANGES et registre", () => {
    const fr = TERMS_SECTIONS.find((s) => s.id === "contacts-de-match")?.paragraphs.join(" ") ?? "";
    const en = TERMS_SECTIONS_EN.find((s) => s.id === "contacts-de-match")?.paragraphs.join(" ") ?? "";
    expectBoth(fr, FR_CONTACTS, FR_LAUNCH);
    expectBoth(en, EN_CONTACTS, EN_LAUNCH);
    // Changé sans nouvelle version : la clause date elle-même ce qu'elle ouvre aux arbitres.
    expect(fr).toContain("(en vigueur depuis le 21 octobre 2026 : auparavant, aux arbitres aussi le temps du match seulement)");
    expect(en).toContain("(in force since 21 October 2026: before, to the referees too only while the match was being played)");
    const entryFr = JSON.stringify(PRIVACY_CHANGES.find((c) => c.id === V6_ENTRY_ID));
    const entryEn = JSON.stringify(PRIVACY_CHANGES_EN[V6_ENTRY_ID]);
    expectBoth(entryFr, FR_CONTACTS, FR_LAUNCH);
    expectBoth(entryEn, EN_CONTACTS, EN_LAUNCH);
    // Chaque phrase du registre qui cite la fenêtre « Contacts » nomme aussi la fenêtre de lancement.
    const frLines = JSON.stringify(PROCESSING_ACTIVITIES).split('","').filter((line) => FR_CONTACTS.test(line));
    const enLines = JSON.stringify(PROCESSING_ACTIVITIES_EN).split('","').filter((line) => EN_CONTACTS.test(line));
    expect(frLines.length).toBeGreaterThan(0);
    expect(enLines.length).toBeGreaterThan(0);
    for (const line of frLines) expect(line).toMatch(FR_LAUNCH);
    for (const line of enLines) expect(line).toMatch(EN_LAUNCH);
  });

  it("annonce v6 : chaque compte connecté doit accepter les conditions (FR et EN)", () => {
    expect(JSON.stringify(PRIVACY_CHANGES.find((c) => c.id === V6_ENTRY_ID))).toContain("chaque compte connecté doit désormais les accepter");
    expect(JSON.stringify(PRIVACY_CHANGES_EN[V6_ENTRY_ID])).toContain(
      "every logged-in account must now accept them",
    );
  });
});

describe("page du match (#489) : chaque avertissement du BattleTag masqué la nomme", () => {
  it("dans la liste partagée, la case du profil et l'encart de visibilité, en français et en anglais", () => {
    const frNotice = frProfile.battletagNotice;
    const enNotice = enProfile.battletagNotice;
    const fr = [HIDDEN_BATTLETAG_AUDIENCE.title, frProfile.privacy.battletagNotice, frNotice.warning, frNotice.intro, frNotice.staff];
    const en = [lines(enProfile).title, enProfile.privacy.battletagNotice, enNotice.warning, enNotice.intro, enNotice.staff];
    for (const text of fr) expect(text).toMatch(/page du match|sur sa page|la page d'un match/);
    for (const text of en) expect(text).toMatch(/match page|on its page|the page of a match/);
    // Le public de la page est celui de la fenêtre « Contacts », arbitres et administrateurs compris.
    expect(HIDDEN_BATTLETAG_AUDIENCE.items.at(-1)).toContain("aux mêmes personnes et aux mêmes moments que la fenêtre « Contacts »");
    expect(lines(enProfile).items.at(-1)).toContain("to the same people at the same times as the “Contacts” window");
  });
});

// TERMS v7 : l'arbitre désigné entre dans la section « Contacts de match ».
describe("conditions d'utilisation — arbitre désigné (version 7)", () => {
  const fr = TERMS_SECTIONS.find((s) => s.id === "contacts-de-match")?.paragraphs.join(" ") ?? "";
  const en = TERMS_SECTIONS_EN.find((s) => s.id === "contacts-de-match")?.paragraphs.join(" ") ?? "";

  it("présente son pseudo et son BattleTag, jamais son tag Discord, aux équipes et aux arbitres dès que les adversaires sont connus, aux casters le temps du match (FR et EN)", () => {
    expect(fr).toContain("Un match peut aussi avoir un **arbitre désigné** : une personne du staff habilitée à arbitrer (permission d'arbitrage, tag Discord certifié et compte Battle.net rattaché)");
    expect(fr).toContain("son **pseudo** et son **BattleTag**, **même masqué** — jamais son tag Discord — sont communiqués aux membres des deux équipes et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, et aux casters du match le temps du match");
    expect(en).toContain("A match may also have an **assigned referee**: a staff member entitled to referee (refereeing permission, certified Discord tag and linked Battle.net account)");
    expect(en).toContain("their **username** and **BattleTag**, **even when hidden** — never their Discord tag — are shared with the members of both teams and with the referees from the moment both its opponents are known until its end, and with the casters of the match while the match is being played");
  });

  it("ne montre au public que « Arbitre désigné », et dit le retrait et la fin de la présentation (FR et EN)", () => {
    expect(fr).toContain("Le public et les autres joueurs ne lisent que « Arbitre désigné ».");
    // Revue de #491 : devenir joueur du match ne retire l'arbitre qu'avant le lancement (`keepEligibleReferees`).
    expect(fr).toContain("L'arbitre peut se retirer d'un match à tout moment, le staff pouvant le lui confier de nouveau ; il n'est plus présenté s'il ne remplit plus ces conditions ou si, avant le lancement du match, il devient l'un de ses joueurs.");
    expect(en).toContain("The public and other players only read “Referee assigned”.");
    expect(en).toContain("The referee can withdraw from a match at any time, the staff being able to assign it to them again; they are no longer presented if they no longer meet these requirements or if, before the match is launched, they become one of its players.");
  });
});
