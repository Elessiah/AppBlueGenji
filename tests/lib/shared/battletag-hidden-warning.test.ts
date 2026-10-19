import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import frProfile from "@/messages/fr/profile.json";
import enProfile from "@/messages/en/profile.json";
import frLogin from "@/messages/fr/login.json";
import enLogin from "@/messages/en/login.json";
import { TERMS_SECTIONS } from "@/lib/shared/terms-of-use";
import { TERMS_SECTIONS_EN } from "@/lib/shared/terms-of-use-en";

/**
 * CONTACTS-FOLLOWUP (décisions du 2026-10-19) : masqué, le BattleTag ne se lit
 * plus que dans la fenêtre « Contacts » d'un match, ouverte aux deux équipes et
 * aux arbitres — dit là où on le renseigne (champ du
 * profil, connexion et rattachement Battle.net) et là où on le masque (modale
 * de la case « BattleTag OW »), avec la même phrase en français et en anglais.
 */
const FR =
  "Tu peux masquer ton BattleTag : il ne reste alors visible que dans la fenêtre « Contacts » de tes matchs de tournoi, si tu fais partie des contacts présentés : pour les deux équipes et les arbitres dès que les deux adversaires sont connus, et pour le caster le temps du match. Si tu ne veux pas qu'ils le voient, retire-le de ton profil (s'il vient de Battle.net, détache d'abord ton compte Battle.net — après avoir ajouté un autre moyen de connexion si c'est le seul).";
const EN =
  "You can hide your BattleTag: it then only stays visible in the “Contacts” window of your tournament matches, if you're among the contacts shown: to both teams and the referees from the moment both opponents are known, and to the caster while the match is being played. If you don't want them to see it, remove it from your profile (if it comes from Battle.net, unlink your Battle.net account first — after adding another way to sign in if it is your only one).";

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
    expect(text).toContain("Ce partage passe par la seule fenêtre « Contacts » du match, que reprend sa fenêtre de lancement au départ du match : un BattleTag masqué n'est lisible nulle part ailleurs, pour personne — arbitres et administrateurs compris.");
    expect(text).toContain("celles du caster le sont aux deux équipes et aux arbitres sur ce même temps du match");
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
    expect(text).toContain("**only while the match is being played**, from its start to its end");
    expect(text).toContain("a hidden BattleTag is readable nowhere else, by anyone — referees and administrators included");
    expect(text).toContain("the caster's is shared with both teams and the referees over that same match time");
    expect(en?.paragraphs).toHaveLength(fr?.paragraphs.length ?? -1);
  });
});
