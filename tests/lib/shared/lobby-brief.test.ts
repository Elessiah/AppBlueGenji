import { describe, expect, it } from "@jest/globals";
import { formatLobbyBriefDm, type LobbyBriefSide } from "@/lib/shared/lobby-brief";
import { localizedSiteUrl } from "@/lib/shared/dm-language";
import { localeHref } from "@/lib/shared/locales";
import { matchPageHref } from "@/lib/shared/match-anchor";
import { clipPushText, PUSH_BODY_MAX, PUSH_TOPICS } from "@/lib/shared/push-notifications";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import { lobbyBriefPush, matchStartPush } from "@/lib/shared/push-messages";
import enPush from "@/messages/en/push.json";
import frPush from "@/messages/fr/push.json";

const URL = "https://bluegenji.test/tournois/4/matchs/40";

function side(overrides: Partial<LobbyBriefSide> = {}): LobbyBriefSide {
  return {
    tournamentId: 4,
    tournamentName: "Coupe",
    matchId: 40,
    bracket: "UPPER",
    roundNumber: 2,
    solo: false,
    teamName: "Renards",
    opponentName: "Nova",
    hosting: true,
    firstMap: "Ilios",
    cast: false,
    decision: "UNDECIDED",
    ...overrides,
  };
}

describe("formatLobbyBriefDm", () => {
  it("donne les réglages en français : hôte à gauche, l'autre à droite et au premier ban", () => {
    expect(formatLobbyBriefDm(side(), URL)).toBe(
      [
        "🎮 BlueGenji — Le salon de ton match « Renards » contre « Nova » est ouvert (Manche 2, « Coupe »).",
        "• Gauche (hôte) : « Renards »",
        "• Droite : « Nova »",
        "• Première carte : « Ilios »",
        "• Premier ban : « Nova »",
        `BattleTags à inviter et réglages à jour : ${URL}`,
      ].join("\n"),
    );
  });

  it("vu du côté qui n'héberge pas : l'adversaire à gauche, ton équipe à droite et au premier ban", () => {
    const text = formatLobbyBriefDm(side({ hosting: false }), URL);
    expect(text).toContain("• Gauche (hôte) : « Nova »");
    expect(text).toContain("• Droite : « Renards »");
    expect(text).toContain("• Premier ban : « Renards »");
  });

  it("dit la carte pas encore fixée, rappelle le tri par rôle d'un match casté et la décision d'arbitrage", () => {
    const referee = formatLobbyBriefDm(side({ firstMap: null, cast: true, decision: "REFEREE" }), URL);
    expect(referee).toContain("• Première carte : pas encore fixée");
    expect(referee).toContain("• Match casté : trie les joueurs par rôle dans le salon.");
    expect(referee).toContain("• Arbitre désigné : ajoute-le en jeu, il invitera les joueurs dans le salon.");
    const self = formatLobbyBriefDm(side({ decision: "SELF_MANAGED" }), URL);
    expect(self).toContain("les managers des deux équipes s'invitent mutuellement, puis invitent les casters.");
    expect(self).not.toContain("Match casté");
    // Sans décision : aucune ligne (le staff en est averti à part).
    expect(formatLobbyBriefDm(side(), URL)).not.toMatch(/Arbitre|Autogestion/);
  });

  it("en anglais, avec le lien passé par la langue du compte", () => {
    const text = formatLobbyBriefDm(side({ cast: true, decision: "SELF_MANAGED", firstMap: null }), URL, "en");
    expect(text).toBe(
      [
        "🎮 BlueGenji — The lobby of your match “Renards” vs “Nova” is open (Round 2, “Coupe”).",
        "• Left (host): “Renards”",
        "• Right: “Nova”",
        "• First map: not set yet",
        "• First ban: “Nova”",
        "• Cast match: sort the players by role in the lobby.",
        "• Self-managed: the host team creates the game, the managers of both teams invite each other, then invite the casters.",
        `BattleTags to invite and up-to-date settings: ${localizedSiteUrl(URL, "en")}`,
      ].join("\n"),
    );
  });

  it("en tournoi individuel, ne nomme personne : « toi » et « ton adversaire »", () => {
    const solo = side({ solo: true, teamName: "PseudoA", opponentName: "PseudoB", hosting: false, decision: "SELF_MANAGED" });
    const fr = formatLobbyBriefDm(solo, URL);
    const en = formatLobbyBriefDm(solo, URL, "en");
    for (const text of [fr, en]) {
      expect(text).not.toContain("PseudoA");
      expect(text).not.toContain("PseudoB");
    }
    expect(fr).toContain("Le salon de ton match est ouvert");
    expect(fr).toContain("• Gauche (hôte) : ton adversaire");
    expect(fr).toContain("• Premier ban : toi");
    expect(fr).toContain("l'hôte crée la partie et invite son adversaire, puis les casters.");
    expect(en).toContain("• Left (host): your opponent");
    expect(en).toContain("• First ban: you");
  });

  it("n'écrit ni BattleTag ni tag Discord, et neutralise les textes saisis (noms, carte)", () => {
    const text = formatLobbyBriefDm(
      side({ teamName: "Ren\nards <@&1>", opponentName: "@everyone", firstMap: "Ilios\n• Premier ban : faux" }),
      URL,
    );
    expect(text).not.toMatch(/#\d{4,}/);
    expect(text).not.toContain("<@&1>");
    expect(text).not.toContain("@everyone");
    // Six lignes, toutes rédigées par le site : un nom ne peut pas en ouvrir une fausse.
    expect(text.split("\n")).toHaveLength(6);
    expect(text.split("\n").filter((line) => line.startsWith("• Premier ban"))).toHaveLength(1);
  });
});

describe("lobbyBriefPush", () => {
  it("résume les réglages, vers la page du match, sans remplacer l'appel aux « Prêt »", () => {
    const push = lobbyBriefPush(side({ cast: true }));
    expect(push.title).toBe("Salon ouvert : réglages du match");
    expect(push.body).toBe(
      "Match casté : trie les joueurs par rôle. Gauche (hôte) : Renards · Droite (1er ban) : Nova · 1re carte : Ilios.",
    );
    expect(push.url).toBe(localeHref(matchPageHref(4, 40), "fr"));
    expect(push.url).toBe("/tournois/4/matchs/40");
    const start = matchStartPush({ ...side(), solo: false }, "LOBBY");
    expect(push.tag).not.toBe(start.tag);
  });

  it("en anglais, et en individuel sans pseudo", () => {
    const en = lobbyBriefPush(side({ hosting: false, firstMap: null }), "en");
    expect(en.title).toBe("Lobby open: match settings");
    expect(en.body).toBe("Left (host): Nova · Right (1st ban): Renards · 1st map: not set yet.");
    expect(en.url).toBe(localeHref(matchPageHref(4, 40), "en"));
    const solo = lobbyBriefPush(side({ solo: true, teamName: "PseudoA", opponentName: "PseudoB" }));
    expect(solo.body).not.toMatch(/PseudoA|PseudoB/);
    expect(solo.body).toBe("Gauche (hôte) : toi · Droite (1er ban) : ton adversaire · 1re carte : Ilios.");
  });

  it("aux noms et à la carte les plus longs, la coupe ne retire que la fin de la carte", () => {
    const long = "N".repeat(60);
    const push = lobbyBriefPush(side({ cast: true, teamName: long, opponentName: "M".repeat(60), firstMap: "C".repeat(64) }));
    const shown = clipPushText(push.body, PUSH_BODY_MAX);
    expect(shown.startsWith("Match casté : trie les joueurs par rôle.")).toBe(true);
    expect(shown).toContain(`Droite (1er ban) : ${"M".repeat(60)} · 1re carte : C`);
  });

  it("a son sujet, ouvert à tous, juste après le départ de match, libellé en français et en anglais", () => {
    expect(PUSH_TOPICS.MATCH_LOBBY_BRIEF.audience).toBeNull();
    expect(Object.keys(PUSH_TOPICS).indexOf("MATCH_LOBBY_BRIEF")).toBe(Object.keys(PUSH_TOPICS).indexOf("MATCH_START") + 1);
    expect(frPush.topics.MATCH_LOBBY_BRIEF.label).toBe(PUSH_TOPICS.MATCH_LOBBY_BRIEF.label);
    expect(enPush.topics.MATCH_LOBBY_BRIEF.label).toBe("Lobby settings");
  });
});

describe("brief du salon — registre des traitements (T04, T12)", () => {
  it("le déclare en français et en anglais : destinataires, contenu, ce qui n'y est jamais, base et push", () => {
    const fr = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T04")!;
    const en = PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T04")!;
    const frBrief = fr.subPurposes.find((line) => line.includes("ouverture du salon"))!;
    const enBrief = en.subPurposes.find((line) => line.includes("lobby of a match opens"))!;
    expect(frBrief).toContain("propriétaires et managers d'une équipe, joueur d'une entrée solo");
    expect(frBrief).toContain("sans BattleTag, tag Discord ni pseudo de joueur");
    expect(frBrief).toContain("(de nouveau s'il rouvre, par exemple après un changement d'horaire)");
    expect(enBrief).toContain("owners and managers of a team, the player of a solo entry");
    expect(enBrief).toContain("without any BattleTag, Discord tag or player username");
    expect(enBrief).toContain("(again if it reopens, for instance after a change of time)");
    expect(fr.legalBasis).toContain("les réglages du salon envoyés à ceux qui gèrent les engagées d'un match");
    expect(en.legalBasis).toContain("the lobby settings sent to those who manage the entrants of a match");
    const frPushActivity = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T12")!;
    const enPushActivity = PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T12")!;
    expect(frPushActivity.subPurposes.join(" ")).toContain("Réglages du salon de ses matchs");
    expect(enPushActivity.subPurposes.join(" ")).toContain("Lobby settings of their matches");
  });

  it("déclare la garde des réservations du brief, en français et en anglais", () => {
    const fr = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T04")!;
    const en = PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T04")!;
    expect(fr.retention.join(" ")).toContain("et des réglages du salon (match, appariement et engagée) : conservées avec le match");
    expect(en.retention.join(" ")).toContain("and of lobby settings sent (match, pairing and entrant): kept with the match");
  });
});

describe("brief du salon — changement de politique (PRIVACY_CHANGES)", () => {
  const ID = "2026-10-reglages-du-salon-aux-managers";

  it("dit que le sujet push est actif par défaut et que le brief repart quand le salon rouvre", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === ID)!;
    const en = PRIVACY_CHANGES_EN[ID];
    expect(fr.details.join(" ")).toContain("« Réglages du salon », actif par défaut pour qui a activé les notifications push");
    expect(fr.details.join(" ")).toContain("de nouveau s'il rouvre, par exemple après un changement d'horaire");
    expect(en.details.join(" ")).toContain("“Lobby settings”, on by default for anyone who turned on push notifications");
    expect(en.details.join(" ")).toContain("again if it reopens, for instance after a change of time");
  });
});
