import { describe, expect, it } from "@jest/globals";
import { discordInline, discordQuote } from "@/lib/shared/discord-text";
import { entrantLabel } from "@/lib/shared/log-privacy";
import { buildIssueReportMessage } from "@/lib/shared/discord-notifications";
import { formatTeamJoinRequestNotice } from "@/lib/shared/team-join-request-notice";
import { formatReportAlert } from "@/lib/shared/content-reports";

const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

/** Vrai si Discord reconnaîtrait une mention dans le texte. */
function hasLiveMention(text: string): boolean {
  return /@(everyone|here)\b/.test(text) || /<@[&!]?\d+>/.test(text) || /<#\d+>/.test(text);
}

/** Vrai si Discord rendrait un lien masqué `[texte](adresse)`. */
function hasMaskedLink(text: string): boolean {
  return /(?<!\\)\[[^\]]*(?<!\\)\]\(/.test(text);
}

describe("discordInline", () => {
  it("désamorce @everyone et @here sans changer ce qu'on lit", () => {
    const out = discordInline("@everyone");
    expect(hasLiveMention(out)).toBe(false);
    expect(out.replaceAll(ZERO_WIDTH_SPACE, "")).toBe("@everyone");
    expect(hasLiveMention(discordInline("Team @here"))).toBe(false);
  });

  it.each(["<@100000000000000001>", "<@!100000000000000001>", "<@&200000000000000002>", "<#300000000000000003>"])(
    "désamorce la mention par identifiant %s",
    (raw) => {
      expect(hasLiveMention(discordInline(raw))).toBe(false);
    },
  );

  it("échappe le balisage : un lien masqué ne devient pas cliquable", () => {
    const out = discordInline("[Valider le score](https://exemple.invalid/piege)");
    expect(hasMaskedLink(out)).toBe(false);
    expect(out).toBe("\\[Valider le score\\]\\(https://exemple.invalid/piege\\)");
  });

  it("échappe gras, italique, barré, code, spoiler et titre", () => {
    expect(discordInline("**a** _b_ ~~c~~ `d` ||e|| # f")).toBe(
      "\\*\\*a\\*\\* \\_b\\_ \\~\\~c\\~\\~ \\`d\\` \\|\\|e\\|\\| \\# f",
    );
  });

  it("tient sur une ligne : un saut de ligne ne forge pas une ligne de journal", () => {
    const out = discordInline("Les Loups\n✅ Fin de match : Les Loups l'emporte");
    expect(out).not.toContain("\n");
    expect(out.startsWith("Les Loups ✅")).toBe(true);
  });

  it("laisse un nom ordinaire tel quel", () => {
    expect(discordInline("Les Loups de l'Ouest")).toBe("Les Loups de l'Ouest");
    expect(discordInline("Équipe 42")).toBe("Équipe 42");
  });
});

describe("discordQuote", () => {
  it("cite chaque ligne : aucune ne commence comme une ligne du site", () => {
    const out = discordQuote("Bonjour\n\n✅ Fin de match : faux\r\nmerci");
    expect(out.split("\n")).toEqual(["> Bonjour", "> ✅ Fin de match : faux", "> merci"]);
  });

  it("désamorce mentions et liens masqués dans le texte libre", () => {
    const out = discordQuote("@everyone regardez [ici](https://exemple.invalid)");
    expect(hasLiveMention(out)).toBe(false);
    expect(hasMaskedLink(out)).toBe(false);
  });
});

describe("rédacteurs Discord", () => {
  it("entrantLabel neutralise le nom d'une équipe", () => {
    expect(hasLiveMention(entrantLabel({ name: "@everyone", participantType: "TEAM" }))).toBe(false);
  });

  it("le signalement d'un problème cite le texte libre et neutralise les noms", () => {
    const message = buildIssueReportMessage({
      tournamentName: "Coupe <@&200000000000000002>",
      tournamentUrl: "https://bluegenji-esport.fr/tournois/1",
      entrant: { name: "[clic](https://exemple.invalid)", participantType: "TEAM" },
      match: null,
      message: "@here\n**Arbitrage requis** — faux",
    });
    expect(hasLiveMention(message)).toBe(false);
    expect(hasMaskedLink(message)).toBe(false);
    expect(message).toContain("> \\*\\*Arbitrage requis\\*\\* — faux");
    // Les balises posées par le site restent actives.
    expect(message.startsWith("**Signalement de problème**")).toBe(true);
  });

  it("l'avis de demande d'adhésion neutralise le nom de l'équipe", () => {
    const notice = formatTeamJoinRequestNotice({ teamName: "@everyone", url: "https://bluegenji-esport.fr/equipes/1" });
    expect(hasLiveMention(notice)).toBe(false);
  });

  it("l'alerte de signalement neutralise les noms désignés", () => {
    const alert = formatReportAlert({
      id: 3,
      category: "MODERATION",
      targets: [{ type: "TEAM", label: "@everyone" }],
      fromMember: true,
      adminUrl: "https://bluegenji-esport.fr/admin/signalements?id=3",
    });
    expect(hasLiveMention(alert)).toBe(false);
  });
});

describe("discordInline — barre oblique inverse", () => {
  it("échappe la barre oblique elle-même : un nom ne peut pas défaire la balise qui le suit", () => {
    const backslash = String.fromCharCode(92);
    expect(discordInline(`x${backslash}`)).toBe(`x${backslash}${backslash}`);
  });
});
