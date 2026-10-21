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

/**
 * CONTACTS-FOLLOWUP (décisions du 2026-10-19) : masqué, le BattleTag ne se lit
 * plus que dans la fenêtre « Contacts » d'un match, ouverte aux deux équipes et
 * aux arbitres — dit là où on le renseigne (champ du
 * profil, connexion et rattachement Battle.net) et là où on le masque (modale
 * de la case « BattleTag OW »), avec la même phrase en français et en anglais.
 */
const FR =
  "Tu peux masquer ton BattleTag : il reste visible pour tes adversaires, les admins et les arbitres pendant un match de tournoi, ainsi que pour son caster, dans la fenêtre « Contacts » du match et dans sa fenêtre de lancement, si tu fais partie des contacts présentés. Si tu castes un match, ses deux équipes le voient aussi le temps du match, et les arbitres et les admins dès que ses deux adversaires sont connus et jusqu'à sa fin. Si tu ne veux pas qu'ils le voient, retire-le de ton profil (s'il vient de Battle.net, détache d'abord ton compte Battle.net — après avoir ajouté un autre moyen de connexion si c'est le seul).";
const EN =
  "You can hide your BattleTag: it stays visible to your opponents, admins and referees during a tournament match, and to its caster, in the match's “Contacts” window and its launch window, if you're among the contacts shown. If you cast a match, both its teams also see it while the match is being played, and referees and admins from the moment both its opponents are known until its end. If you don't want them to see it, remove it from your profile (if it comes from Battle.net, unlink your Battle.net account first — after adding another way to log in if it is your only one).";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("avertissement du BattleTag masqué", () => {
  it("se lit sous le champ BattleTag du profil, verrouillé ou non", () => {
    expect(frProfile.games.hiddenWarning).toBe(FR);
    expect(enProfile.games.hiddenWarning).toBe(EN);
    const page = readSource("app/(secured)/profil/page.tsx");
    const hint = page.slice(page.indexOf('<p id="profile-battletag-hint"'), page.indexOf("</p>", page.indexOf('<p id="profile-battletag-hint"')));
    expect(hint).toContain('{t("games.hiddenWarning")}');
    // Hors du ternaire : les deux branches (verrouillé par Blizzard ou saisi) le portent.
    expect(hint.lastIndexOf('t("games.hiddenWarning")')).toBeGreaterThan(hint.lastIndexOf('t("games.blizzardNotice")'));
  });

  it("se lit au rattachement de Battle.net (profil) et à la connexion par Blizzard", () => {
    expect(frProfile.connections.notes.BLIZZARD).toContain(FR);
    expect(enProfile.connections.notes.BLIZZARD).toContain(EN);
    expect(frLogin.oauth.blizzardNote).toContain(FR);
    expect(enLogin.oauth.blizzardNote).toContain(EN);
  });

  it("ouvre la modale affichée quand on masque le BattleTag", () => {
    expect(frProfile.battletagNotice.warning).toBe(FR);
    expect(enProfile.battletagNotice.warning).toBe(EN);
    const notice = readSource("app/(secured)/profil/BattletagVisibilityNotice.tsx");
    expect(notice.indexOf('t("battletagNotice.warning")')).toBeGreaterThan(-1);
    expect(notice.indexOf('t("battletagNotice.warning")')).toBeLessThan(notice.indexOf('t("battletagNotice.intro")'));
  });

  it("dit au caster qu'il n'a les contacts que le temps du match (FR et EN)", () => {
    expect(frProfile.battletagNotice.caster).toContain("le temps du match seulement (de son départ à sa fin)");
    expect(enProfile.battletagNotice.caster).toContain("only while the match is being played (from its start to its end)");
  });
});

describe("conditions d'utilisation — contacts de match (version 5)", () => {
  const fr = TERMS_SECTIONS.find((s) => s.id === "contacts-de-match");
  const en = TERMS_SECTIONS_EN.find((s) => s.id === "contacts-de-match");

  it("prévoit le partage des contacts aux deux équipes, et au caster le temps du match seulement", () => {
    const text = fr?.paragraphs.join(" ") ?? "";
    expect(text).toContain("**tag Discord** certifié, **BattleTag**, **même masqué**, et **rôle d'équipe**");
    expect(text).toContain("aux **membres des deux équipes** du match et aux **arbitres** (administrateurs compris), dès que ses deux adversaires sont connus et jusqu'à sa fin");
    expect(text).toContain("à son **caster** inscrit **le temps du match** seulement, de son départ à sa fin");
    expect(text).toContain("Au titre de l'organisation du tournoi");
    expect(text).toContain("Un tag Discord non certifié n'est jamais communiqué.");
    // Seule porte d'un BattleTag masqué, staff compris ; contacts du caster le temps du match.
    // Détacher Battle.net suppose un autre moyen de connexion (refus LAST_CONNECTION sinon).
    expect(text).toContain("ne s'efface qu'une fois le compte Battle.net détaché, ce qui suppose un autre moyen de connexion)");
    expect(frProfile.battletagNotice.outro).toContain("après avoir ajouté un autre moyen de connexion si c'est le seul");
    expect(enProfile.battletagNotice.outro).toContain("after adding another way to log in if it is your only one");
    expect(frProfile.battletagLock.change).toContain("après avoir ajouté un autre moyen de connexion si c'est le seul");
    expect(enProfile.battletagLock.change).toContain("after adding another way to log in if it is your only one");
    expect(text).toContain("Ce partage passe par la seule fenêtre « Contacts » du match et par sa fenêtre de lancement, qui la reprend au départ du match : un BattleTag masqué n'est lisible nulle part ailleurs sur le site, pour personne — arbitres et administrateurs compris.");
    expect(text).toContain("celles du caster le sont aux deux équipes sur ce même temps du match, et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin");
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
    expect(text).toContain("the caster's is shared with both teams over that same match time, and with the referees from the moment both its opponents are known until its end");
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

  it("avertissement, modale de masquage et fiche joueur", () => {
    expect(frProfile.battletagNotice.intro).toMatch(FR_LAUNCH);
    expectBoth(frProfile.battletagNotice.intro, FR_CONTACTS, FR_LAUNCH);
    expectBoth(enProfile.battletagNotice.intro, EN_CONTACTS, EN_LAUNCH);
    expectBoth(frProfile.battletagNotice.staff, FR_CONTACTS, FR_LAUNCH);
    expectBoth(enProfile.battletagNotice.staff, EN_CONTACTS, EN_LAUNCH);
    expectBoth(frPlayers.page.battletagHiddenSelf, FR_CONTACTS, FR_LAUNCH);
    expectBoth(enPlayers.page.battletagHiddenSelf, EN_CONTACTS, EN_LAUNCH);
  });

  it("conditions v6, annonce PRIVACY_CHANGES et registre", () => {
    const fr = TERMS_SECTIONS.find((s) => s.id === "contacts-de-match")?.paragraphs.join(" ") ?? "";
    const en = TERMS_SECTIONS_EN.find((s) => s.id === "contacts-de-match")?.paragraphs.join(" ") ?? "";
    expectBoth(fr, FR_CONTACTS, FR_LAUNCH);
    expectBoth(en, EN_CONTACTS, EN_LAUNCH);
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
