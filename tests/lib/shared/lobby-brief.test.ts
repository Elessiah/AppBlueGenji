import { describe, expect, it } from "@jest/globals";
import { formatLobbyBriefDm, MAPS_LINE_MAX } from "@/lib/server/tournaments/lobby-brief-dm";
import { GAME_SETTINGS_TEXT, type LobbyBriefSide } from "@/lib/shared/lobby-brief";
import { GAME_SETTINGS } from "@/lib/shared/match-page";
import enTournament from "@/messages/en/tournament.json";
import frTournament from "@/messages/fr/tournament.json";
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
    game: "OW",
    teamName: "Renards",
    opponentName: "Nova",
    hosting: true,
    banFirst: false,
    firstMap: "Ilios",
    maps: [],
    nextBan: "LOSER",
    cast: false,
    decision: "UNDECIDED",
    ...overrides,
  };
}

/** Un côté aux noms d'équipe de 60 caractères, casté, avec vocal, en autogestion : le plus long message. */
function cappedSide(overrides: Partial<LobbyBriefSide>): LobbyBriefSide {
  return side({ teamName: "R".repeat(60), opponentName: "N".repeat(60), cast: true, voice: true, decision: "SELF_MANAGED", ...overrides });
}

/** Le message complet attendu, pour les assertions exactes. */
const INVITE = "https://discord.gg/Sgdh3p4VhC";

describe("formatLobbyBriefDm", () => {
  it("écrit le check-in en français : titre, préparation, paramètres, maps et pied", () => {
    expect(formatLobbyBriefDm(side({ decision: "SELF_MANAGED" }), URL)).toBe(
      [
        "# Check-in du match « Renards » Vs « Nova »",
        "*Manche 2 · « Coupe » — coup d'envoi dans moins de 15 minutes.*",
        "",
        "**Votre match est en autogestion.** Voici les éléments importants à savoir.",
        `*Les contacts et les BattleTags à inviter sont sur la page du match : ${URL}*`,
        "",
        "## Avant le coup d'envoi",
        `* Le salon de check-in est ouvert sur Discord — ${INVITE}`,
        "* Gauche (hôte) : « Renards » · Droite : « Nova »",
        "* **C'est à ton équipe de créer la partie.**",
        "",
        "## Paramètres de partie",
        "* Mode compétitif",
        "* Pas de killcam",
        "* Pause à la déconnexion",
        "",
        "## Déroulé des maps",
        "* Map 1 : « Ilios »",
        "* Bans de la carte 1 : « Nova » d'abord, puis « Renards ».",
        "* Cartes suivantes : l'équipe qui a perdu la carte précédente bannit en premier ; en cas d'égalité, même ordre qu'à la carte précédente.",
        "",
        "N'oubliez pas de rentrer les scores du match **au plus vite après la fin de votre match**.",
        "Un problème ? Signalez-le depuis la page du match, ou pinguez le rôle @Arbitre sur Discord.",
        "",
        "GL HF :)",
      ].join("\n"),
    );
  });

  it("vu du côté qui n'héberge pas : l'adversaire à gauche, et les réglages à vérifier", () => {
    const text = formatLobbyBriefDm(side({ hosting: false, banFirst: true, decision: "SELF_MANAGED" }), URL);
    expect(text).toContain("* Gauche (hôte) : « Nova » · Droite : « Renards »");
    expect(text).toContain("* L'équipe hôte crée la partie : **vérifie les paramètres** avant de lancer.");
    expect(text).toContain("* Bans de la carte 1 : « Renards » d'abord, puis « Nova ».");
    expect(text).not.toContain("créer la partie.**");
  });

  it("la ligne du vocal n'est écrite que pour un match suivi par les salons vocaux", () => {
    const withVoice = formatLobbyBriefDm(side({ voice: true }), URL);
    expect(withVoice).toContain(
      `* Tous les joueurs doivent rejoindre le salon vocal de leur équipe, ouvert par le bot — ${INVITE}`,
    );
    expect(formatLobbyBriefDm(side({ voice: true }), URL, "en")).toContain(
      "* Every player must join their team's voice channel, opened by the bot",
    );
    // Option éteinte, entrée solo ou fantôme : le bot n'ouvrira aucun salon.
    expect(formatLobbyBriefDm(side(), URL)).not.toContain("salon vocal");
  });

  it("dit la carte pas encore fixée et la section du cast, avec le live quand il est public", () => {
    const referee = formatLobbyBriefDm(side({ firstMap: null, cast: true, decision: "REFEREE" }), URL);
    expect(referee).toContain("* Map 1 : pas encore fixée");
    expect(referee).toContain("## Match casté");
    expect(referee).toContain("* Invitez les casters inscrits (leurs contacts sont sur la page du match).");
    expect(referee).toContain("* Triez les joueurs par rôle dans le salon.");
    expect(referee).toContain("* Ajoute l'arbitre désigné en jeu : il invitera les joueurs dans le salon.");
    // Sans lien de diffusion public, aucune ligne de diffusion.
    expect(referee).not.toContain("Diffusion");
    // Un live sans cast inscrit n'ouvre pas la section.
    expect(formatLobbyBriefDm(side({ streamUrl: "https://twitch.tv/bluegenji" }), URL)).not.toContain("## Match casté");
  });

  it("formatLobbyBriefDm_castWithStream_streamLineFrEnNoLiveWording", () => {
    const cast = side({ cast: true, streamUrl: "https://twitch.tv/bluegenji" });

    const fr = formatLobbyBriefDm(cast, URL);
    const en = formatLobbyBriefDm(cast, URL, "en");

    expect(fr).toContain("* Diffusion : <https://twitch.tv/bluegenji>");
    expect(en).toContain("* Stream: <https://twitch.tv/bluegenji>");
    // Rien n'est encore à l'antenne quinze minutes avant : jamais « En direct » (CLAUDE.md).
    expect([fr.includes("En direct"), en.includes("Live on")]).toEqual([false, false]);
  });

  it("sans décision d'arbitrage, ne charge personne de créer la partie", () => {
    const text = formatLobbyBriefDm(side(), URL);
    expect(text).toContain("Voici les éléments importants à savoir avant le coup d'envoi.");
    expect(text).not.toMatch(/créer la partie|arbitre désigné|autogestion/i);
  });

  it("en anglais, avec le lien passé par la langue du compte", () => {
    const text = formatLobbyBriefDm(side({ cast: true, decision: "SELF_MANAGED", firstMap: null }), URL, "en");
    expect(text).toBe(
      [
        "# “Renards” Vs “Nova” check-in",
        "*Round 2 · “Coupe” — kickoff in less than 15 minutes.*",
        "",
        "**Your match is self-managed.** Here is what you need to know.",
        `*The contacts and the BattleTags to invite are on the match page: ${localizedSiteUrl(URL, "en")}*`,
        "",
        "## Before kickoff",
        `* The check-in channel is open on Discord — ${INVITE}`,
        "* Left (host): “Renards” · Right: “Nova”",
        "* **Your team creates the game.**",
        "",
        "## Game settings",
        "* Competitive mode",
        "* No killcam",
        "* Pause on disconnect",
        "",
        "## Map order",
        "* Map 1: not set yet",
        "* Map 1 bans: “Nova” first, then “Renards”.",
        "* Next maps: the team that lost the previous map bans first; on a draw, same order as on the previous map.",
        "",
        "## Cast match",
        "* Invite the signed-up casters (their contacts are on the match page).",
        "* Sort the players by role in the lobby.",
        "",
        "Remember to enter the match scores **as soon as your match ends**.",
        "Any issue? Report it from the match page, or ping the @Arbitre role on Discord.",
        "",
        "GL HF :)",
      ].join("\n"),
    );
  });

  it("formatLobbyBriefDm_marvelRivalsReferee_noBattletagNorInGameAdd", () => {
    const fr = formatLobbyBriefDm(side({ game: "MR", decision: "REFEREE" }), URL);
    const en = formatLobbyBriefDm(side({ game: "MR", decision: "REFEREE" }), URL, "en");

    expect(fr).toContain("* L'arbitre désigné invitera les joueurs dans le salon.");
    expect(fr).toContain(`*Vous pouvez retrouver les contacts sur la page du match : ${URL}*`);
    expect(en).toContain("* The assigned referee will invite the players to the lobby.");
    expect(en).toContain(`*You can find the contacts on the match page: ${localizedSiteUrl(URL, "en")}*`);
    for (const text of [fr, en]) {
      expect(text).not.toMatch(/BattleTag|Ajoute l'arbitre|Add the assigned/);
    }
  });

  it("formatLobbyBriefDm_marvelRivalsCast_notifiesCastersInsteadOfInviting", () => {
    const fr = formatLobbyBriefDm(side({ game: "MR", decision: "SELF_MANAGED", cast: true }), URL);

    expect(fr).toContain("* Prévenez les casters inscrits (leurs contacts sont sur la page du match).");
    expect(fr).not.toContain("Invitez les casters");
    expect(formatLobbyBriefDm(side({ game: "MR", decision: "SELF_MANAGED", cast: true }), URL, "en")).toContain(
      "* Notify the signed-up casters",
    );
  });

  it("en tournoi individuel, ne nomme personne : « toi » et « ton adversaire »", () => {
    const solo = side({
      solo: true,
      teamName: "PseudoA",
      opponentName: "PseudoB",
      hosting: false,
      banFirst: true,
      decision: "SELF_MANAGED",
    });
    const fr = formatLobbyBriefDm(solo, URL);
    const en = formatLobbyBriefDm(solo, URL, "en");
    for (const text of [fr, en]) {
      expect(text).not.toContain("PseudoA");
      expect(text).not.toContain("PseudoB");
    }
    expect(fr).toContain("# Check-in de ton match");
    expect(fr).toContain("* Gauche (hôte) : ton adversaire · Droite : toi");
    expect(fr).toContain("* Bans de la carte 1 : toi d'abord, puis ton adversaire.");
    expect(en).toContain("# Your match check-in");
    expect(en).toContain("* Left (host): your opponent · Right: you");
    expect(en).toContain("* Map 1 bans: you first, then your opponent.");
  });

  it("n'écrit ni BattleTag ni tag Discord, et neutralise les textes saisis (noms, carte)", () => {
    const text = formatLobbyBriefDm(
      side({ teamName: "Ren\nards <@&1>", opponentName: "@everyone", firstMap: "Ilios\n## Paramètres de partie" }),
      URL,
    );
    expect(text).not.toMatch(/#\d{4,}/);
    expect(text).not.toContain("<@&1>");
    expect(text).not.toContain("@everyone");
    // Une seule section par titre : un nom ne peut pas en ouvrir une fausse.
    expect(text.split("\n").filter((line) => line === "## Paramètres de partie")).toHaveLength(1);
    expect(text.split("\n").filter((line) => line.startsWith("# Check-in"))).toHaveLength(1);
  });
});

describe("formatLobbyBriefDm — cartes du round", () => {
  it("formatLobbyBriefDm_imposedAndPoolSlots_listsThemWithoutLoserPick", () => {
    const text = formatLobbyBriefDm(
      side({
        maps: [
          { number: 1, kind: "IMPOSED", map: "Ilios", candidates: ["Ilios"] },
          { number: 2, kind: "POOL", map: null, candidates: ["Busan", "Nepal"] },
        ],
      }),
      URL,
    );

    // La règle « choisie par le perdant » n'est pas appliquée (pas de scores par carte) : le brief la tait.
    expect(text).toContain("* Map 1 : « Ilios »\n* Map 2 : à choisir parmi « Busan », « Nepal »\n");
    expect(text).not.toContain("perdu la carte précédente)");
  });

  it("formatLobbyBriefDm_mapsOverMax_cutAtWholeSlotWithPointerToMatchPage", () => {
    const pool = Array.from({ length: 20 }, (_, index) => `Carte-${String(index).padStart(2, "0")}-${"x".repeat(50)}`);
    const maps = Array.from({ length: 9 }, (_, index) => ({ number: index + 1, kind: "POOL" as const, map: null, candidates: pool }));

    const text = formatLobbyBriefDm(side({ maps, cast: true, decision: "SELF_MANAGED", voice: true }), URL);

    const lines = text.split("\n");
    const section = lines.slice(lines.indexOf("## Déroulé des maps") + 1);
    // Le premier créneau dépasse déjà la borne : le bloc ne garde que le renvoi.
    expect(section[0]).toBe("* Suite des cartes sur la page du match.");
    expect(section.filter((row) => row.startsWith("* Map "))).toHaveLength(0);
    // Un message plus long que 2 000 caractères n'est pas remis par Discord.
    expect(text.length).toBeLessThan(2000);
  });

  it("formatLobbyBriefDm_longNamesAndFullMaps_cappedAtDiscordLimitFrAndEn", () => {
    const pool = ["Lijiang Tower", "Busan", "Nepal", "Oasis", "Antarctic Peninsula"];
    const long = cappedSide({
      tournamentName: `Coupe${"x".repeat(55)}`,
      maps: Array.from({ length: 5 }, (_, index) => ({ number: index + 1, kind: "POOL" as const, map: null, candidates: pool })),
      tiebreakMap: "New Junk City",
      streamUrl: "https://twitch.tv/bluegenji",
    });

    const fr = formatLobbyBriefDm(long, URL);
    const en = formatLobbyBriefDm(long, URL, "en");

    // Plus long que 2 000 caractères, Discord refuserait le message : les cartes cèdent l'excédent.
    expect([fr.length <= 2000, en.length <= 2000]).toEqual([true, true]);
    expect(fr).toContain("* Suite des cartes sur la page du match.");
    expect(en).toContain("* More maps on the match page.");
    // Le pied du message reste entier.
    expect([fr.endsWith("GL HF :)"), en.endsWith("GL HF :)")]).toEqual([true, true]);
  });

  it("formatLobbyBriefDm_fewMapsButMaximalNamesAndStream_cappedAtDiscordLimit", () => {
    // Noms aux longueurs des colonnes (tournoi 120, équipes 60), lien de 247 caractères.
    const long = cappedSide({
      tournamentName: "T".repeat(120),
      maps: Array.from({ length: 3 }, (_, index) => ({ number: index + 1, kind: "POOL" as const, map: null, candidates: ["A".repeat(40), "B".repeat(40)] })),
      tiebreakMap: "M".repeat(64),
      streamUrl: `https://twitch.tv/${"s".repeat(229)}`,
    });

    const fr = formatLobbyBriefDm(long, URL);
    const en = formatLobbyBriefDm(long, URL, "en");

    expect([fr.length <= 2000, en.length <= 2000]).toEqual([true, true]);
    expect(fr).toContain("* Suite des cartes sur la page du match.");
  });

  it("formatLobbyBriefDm_mapsOverMaxInEnglish_pointsToMatchPage", () => {
    const pool = Array.from({ length: 20 }, (_, index) => `Map-${String(index).padStart(2, "0")}-${"x".repeat(50)}`);
    const maps = Array.from({ length: 9 }, (_, index) => ({ number: index + 1, kind: "POOL" as const, map: null, candidates: pool }));

    const text = formatLobbyBriefDm(side({ maps }), URL, "en");

    expect(text).toContain("* More maps on the match page.");
    expect(MAPS_LINE_MAX).toBeLessThan(2000);
  });

  it("formatLobbyBriefDm_mapsUnderMax_keptWhole", () => {
    const maps = [{ number: 1, kind: "POOL" as const, map: null, candidates: ["Busan", "Nepal"] }];

    const text = formatLobbyBriefDm(side({ maps }), URL);

    expect(text).not.toContain("Suite des cartes");
  });
});

describe("formatLobbyBriefDm — EF-32", () => {
  it("formatLobbyBriefDm_hostBansFirst_banOrderFollowsTheRule", () => {
    const text = formatLobbyBriefDm(side({ hosting: true, banFirst: true }), URL);

    expect(text).toContain("* Bans de la carte 1 : « Renards » d'abord, puis « Nova ».");
    expect(formatLobbyBriefDm(side({ hosting: true, banFirst: true }), URL, "en")).toContain(
      "* Map 1 bans: “Renards” first, then “Nova”.",
    );
  });

  it("formatLobbyBriefDm_launchedMatch_subtitleSaysLaunched", () => {
    expect(formatLobbyBriefDm(side({ launched: true }), URL).split("\n")[1]).toBe(
      "*Manche 2 · « Coupe » — match lancé.*",
    );
    expect(formatLobbyBriefDm(side({ launched: true, solo: true }), URL, "en").split("\n")[1]).toBe(
      "*Round 2 · “Coupe” — match started.*",
    );
    // Les réglages restent : ils servent à créer la partie.
    expect(formatLobbyBriefDm(side({ launched: true }), URL)).toContain("* Map 1 : « Ilios »");
  });

  it("formatLobbyBriefDm_selfManagedAgainstGhost_noCreationLine", () => {
    const text = formatLobbyBriefDm(side({ decision: "SELF_MANAGED", opponentGhost: true }), URL);

    expect(text).not.toContain("créer la partie");
    expect(text).not.toContain("autogestion");
    expect(formatLobbyBriefDm(side({ decision: "REFEREE", opponentGhost: true }), URL)).toContain(
      "Un arbitre est désigné pour votre match.",
    );
  });

  it("formatLobbyBriefDm_siteRootUnknown_noLinkLine", () => {
    const text = formatLobbyBriefDm(side(), null);

    expect(text).not.toContain("page du match :");
    expect(text).not.toContain("BattleTags à inviter");
    // Le reste du message tient quand même, pied compris.
    expect(text.split("\n").at(-1)).toBe("GL HF :)");
  });
});

describe("paramètres de partie — une seule liste", () => {
  it("le check-in et la page du match disent les mêmes paramètres, dans le même ordre", () => {
    // La liste et son ordre viennent de `GAME_SETTINGS` : le check-in les rend
    // par `GAME_SETTINGS_TEXT`, la page par ses clés `matchPage.gameSettings.*`.
    for (const locale of ["fr", "en"] as const) {
      const keys = Object.keys(GAME_SETTINGS_TEXT[locale]);
      expect(keys).toEqual([...GAME_SETTINGS]);
      for (const setting of GAME_SETTINGS) {
        expect(GAME_SETTINGS_TEXT[locale][setting]).not.toBe("");
      }
    }
    // Chaque paramètre a sa clé de traduction, en français et en anglais.
    for (const setting of GAME_SETTINGS) {
      expect(frTournament.matchPage.gameSettings[setting]).toBeTruthy();
      expect(enTournament.matchPage.gameSettings[setting]).toBeTruthy();
    }
  });

  it("le message privé les écrit dans l'ordre de la liste", () => {
    const dm = formatLobbyBriefDm(side(), URL);
    const lines = dm.split("\n");
    const start = lines.indexOf("## Paramètres de partie");
    expect(start).toBeGreaterThan(0);
    expect(lines.slice(start + 1, start + 1 + GAME_SETTINGS.length)).toEqual(
      GAME_SETTINGS.map((setting) => `* ${GAME_SETTINGS_TEXT.fr[setting]}`),
    );
  });
});

describe("lobbyBriefPush", () => {
  it("résume les réglages, vers la page du match, sans remplacer l'appel aux « Prêt »", () => {
    const push = lobbyBriefPush(side({ cast: true }));
    expect(push.title).toBe("Check-in du match : réglages");
    expect(push.body).toBe(
      "Match casté : trie les joueurs par rôle. Gauche (hôte) : « Renards » · Droite (1er ban) : « Nova » · 1re carte : Ilios.",
    );
    expect(push.url).toBe(localeHref(matchPageHref(4, 40), "fr"));
    expect(push.url).toBe("/tournois/4/matchs/40");
    const start = matchStartPush({ ...side(), solo: false }, "LOBBY");
    expect(push.tag).not.toBe(start.tag);
  });

  it("en anglais, et en individuel sans pseudo", () => {
    const en = lobbyBriefPush(side({ hosting: false, banFirst: true, firstMap: null }), "en");
    expect(en.title).toBe("Match check-in: settings");
    expect(en.body).toBe("Left (host): “Nova” · Right (1st ban): “Renards” · 1st map: not set yet.");
    expect(en.url).toBe(localeHref(matchPageHref(4, 40), "en"));
    const solo = lobbyBriefPush(side({ solo: true, teamName: "PseudoA", opponentName: "PseudoB" }));
    expect(solo.body).not.toMatch(/PseudoA|PseudoB/);
    expect(solo.body).toBe("Gauche (hôte) : toi · Droite (1er ban) : ton adversaire · 1re carte : Ilios.");
  });

  it("lobbyBriefPush_longestNamesAndMap_castReminderGivesWayAndMapIsKept", () => {
    const push = lobbyBriefPush(
      side({ cast: true, teamName: "N".repeat(50), opponentName: "M".repeat(50), firstMap: "C".repeat(64) }),
    );

    expect(push.body).toBe(
      `Gauche (hôte) : « ${"N".repeat(50)} » · Droite (1er ban) : « ${"M".repeat(50)} » · 1re carte : ${"C".repeat(64)}.`,
    );
    expect(clipPushText(push.body, PUSH_BODY_MAX)).toBe(push.body);
  });

  it("lobbyBriefPush_shortNamesCastMatch_keepsCastReminder", () => {
    const push = lobbyBriefPush(side({ cast: true, teamName: "N".repeat(30), opponentName: "M".repeat(30) }));

    expect(push.body.startsWith("Match casté : trie les joueurs par rôle.")).toBe(true);
    expect(Array.from(push.body).length).toBeLessThanOrEqual(PUSH_BODY_MAX);
  });

  it("lobbyBriefPush_mapEndingWithPunctuation_singleFinalPeriod", () => {
    expect(lobbyBriefPush(side({ firstMap: "Ilios." })).body).toBe(
      "Gauche (hôte) : « Renards » · Droite (1er ban) : « Nova » · 1re carte : Ilios.",
    );
    expect(lobbyBriefPush(side({ firstMap: "Ilios !… " }), "en").body).toBe(
      "Left (host): “Renards” · Right (1st ban): “Nova” · 1st map: Ilios.",
    );
    // Une carte faite de ponctuation seule reste écrite.
    expect(lobbyBriefPush(side({ firstMap: "..." })).body).toContain("1re carte : ....");
  });

  it("lobbyBriefPush_nameWithSeparator_quotedSoTheBodyStaysReadable", () => {
    const push = lobbyBriefPush(side({ teamName: "A · B" }));

    expect(push.body).toBe("Gauche (hôte) : « A · B » · Droite (1er ban) : « Nova » · 1re carte : Ilios.");
  });

  it("lobbyBriefPush_bidiOverrideInStoredName_strippedFromBody", () => {
    const push = lobbyBriefPush(side({ teamName: "Ren\u202Eards", opponentName: "No\u200Bva" }));

    expect(push.body).toBe("Gauche (hôte) : « Renards » · Droite (1er ban) : « Nova » · 1re carte : Ilios.");
  });

  it("lobbyBriefPush_invisibleCharactersInMap_strippedFromBody", () => {
    const push = lobbyBriefPush(side({ firstMap: "Il\u202Eios\u200B." }));

    expect(push.body).toBe("Gauche (hôte) : « Renards » · Droite (1er ban) : « Nova » · 1re carte : Ilios.");
  });

  it("lobbyBriefPush_emptyOrInvisibleOnlyMap_fallsBackToNotSetYet", () => {
    expect(lobbyBriefPush(side({ firstMap: "" })).body).toContain("1re carte : pas encore fixée.");
    expect(lobbyBriefPush(side({ firstMap: "\u200B\u202E" }), "en").body).toContain("1st map: not set yet.");
  });

  it("lobbyBriefPush_nameWithQuoteMarks_cannotCloseTheQuotation", () => {
    const fr = lobbyBriefPush(side({ teamName: "A » · Droite : « B" }));
    const en = lobbyBriefPush(side({ teamName: "A” · Right: “B" }), "en");

    expect(fr.body).toContain('Gauche (hôte) : « A " · Droite : " B » ·');
    expect(en.body).toContain('Left (host): “A" · Right: "B” ·');
  });

  it("formatLobbyBriefDm_nameWithQuoteMarks_cannotCloseTheQuotation", () => {
    const fr = formatLobbyBriefDm(side({ teamName: "A » · B" }), URL);
    const en = formatLobbyBriefDm(side({ teamName: "A” · B" }), URL, "en");

    expect(fr).toContain('Gauche (hôte) : « A " · B »');
    expect(en).toContain('Left (host): “A" · B”');
  });

  it("lobbyBriefPush_whitespaceOnlyMap_fallsBackToNotSetYet", () => {
    expect(lobbyBriefPush(side({ firstMap: "   " })).body).toContain("1re carte : pas encore fixée.");
    expect(lobbyBriefPush(side({ firstMap: "  	" }), "en").body).toContain("1st map: not set yet.");
  });

  it("lobbyBriefPush_nameWithOtherQuoteMarks_cannotCloseTheQuotation", () => {
    const push = lobbyBriefPush(side({ teamName: "A„ B‟ C‹ D›" }));

    expect(push.body).toContain('Gauche (hôte) : « A" B" C" D" » ·');
  });

  it("formatLobbyBriefDm_blankOrInvisibleFirstMap_fallsBackToNotSetYet", () => {
    expect(formatLobbyBriefDm(side({ firstMap: "" }), URL)).toContain("* Map 1 : pas encore fixée");
    expect(formatLobbyBriefDm(side({ firstMap: "\u200B\u202E " }), URL, "en")).toContain("* Map 1: not set yet");
  });

  it("formatLobbyBriefDm_nameWithOtherQuoteMarks_cannotCloseTheQuotation", () => {
    const dm = formatLobbyBriefDm(side({ teamName: "A„ B‹ C›" }), URL);

    expect(dm).toContain('Gauche (hôte) : « A" B" C" »');
  });

  it("matchStartPush_bidiOverrideInStoredNames_strippedFromBody", () => {
    const push = matchStartPush(
      { tournamentId: 4, tournamentName: "Cou\u202Epe", matchId: 40, teamName: "Ren\u202Eards", opponentName: "Nova" },
      "LOBBY",
    );

    expect(push.body).not.toMatch(/\u202E/u);
    expect(push.body).toContain("Renards");
    expect(push.body).toContain("Coupe");
  });

  it("lobbyBriefPush_launchedMatch_saysLaunchedInBothLanguages", () => {
    expect(lobbyBriefPush(side({ launched: true })).title).toBe("Match lancé : réglages de la partie");
    expect(lobbyBriefPush(side({ launched: true }), "en").title).toBe("Match started: game settings");
  });

  it("a son sujet, ouvert à tous, juste après le départ de match, libellé en français et en anglais", () => {
    expect(PUSH_TOPICS.MATCH_LOBBY_BRIEF.audience).toBeNull();
    expect(Object.keys(PUSH_TOPICS).indexOf("MATCH_LOBBY_BRIEF")).toBe(Object.keys(PUSH_TOPICS).indexOf("MATCH_START") + 1);
    expect(frPush.topics.MATCH_LOBBY_BRIEF.label).toBe(PUSH_TOPICS.MATCH_LOBBY_BRIEF.label);
    expect(enPush.topics.MATCH_LOBBY_BRIEF.label).toBe("Match check-in");
  });
});

describe("check-in du match — registre des traitements (T04, T12)", () => {
  it("le déclare en français et en anglais : moment, destinataires, contenu, ce qui n'y est jamais, base et push", () => {
    const fr = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T04")!;
    const en = PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T04")!;
    const frBrief = fr.subPurposes.find((line) => line.includes("le check-in du match"))!;
    const enBrief = en.subPurposes.find((line) => line.includes("the match check-in"))!;
    // Le moment : le quart d'heure, et le repli sur l'ouverture du salon.
    expect(frBrief).toContain("15 minutes avant le coup d'envoi d'un match");
    expect(frBrief).toContain("ou à l'ouverture de son salon si elle vient plus tôt ou si le match n'a pas d'horaire");
    expect(frBrief).toContain("(de nouveau s'il rouvre, par exemple après un changement d'horaire)");
    // Les destinataires : tous les joueurs, et plus les seuls gestionnaires.
    expect(frBrief).toContain("tous les joueurs de chacune de ses engagées");
    expect(frBrief).toContain("sans BattleTag, tag Discord ni pseudo de joueur");
    expect(enBrief).toContain("15 minutes before a match kicks off");
    expect(enBrief).toContain("every player of each of its entrants");
    expect(enBrief).toContain("without any BattleTag, Discord tag or player username");
    expect(enBrief).toContain("(again if it reopens, for instance after a change of time)");
    expect(fr.legalBasis).toContain("le check-in du match envoyé aux membres de ses engagées");
    expect(en.legalBasis).toContain("the match check-in sent to the members of its entrants");
    const frPushActivity = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T12")!;
    const enPushActivity = PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T12")!;
    expect(frPushActivity.subPurposes.join(" ")).toContain("Check-in de ses matchs");
    expect(enPushActivity.subPurposes.join(" ")).toContain("Check-in of their matches");
  });

  it("déclare la garde des réservations du check-in, en français et en anglais", () => {
    const fr = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T04")!;
    const en = PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T04")!;
    expect(fr.retention.join(" ")).toContain("celles du check-in du match (match, appariement et engagée) : jusqu'à la réouverture du salon (lancement annulé, horaire changé, retour arrière), sinon avec le match");
    expect(en.retention.join(" ")).toContain("those of match check-ins sent (match, pairing and entrant): until the lobby reopens (launch cancelled, time changed, rollback), otherwise with the match");
  });
});

describe("check-in du match — changement de politique (PRIVACY_CHANGES)", () => {
  const ID = "2026-11-check-in-du-match";

  it("annonce le nouveau moment et les nouveaux destinataires, en français et en anglais", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === ID)!;
    const en = PRIVACY_CHANGES_EN[ID];
    expect(fr.details.join(" ")).toContain("15 minutes avant le coup d'envoi, au lieu de l'ouverture du salon");
    expect(fr.details.join(" ")).toContain("tous les membres des deux engagées — joueurs, coachs et managers compris —, et plus seulement leurs propriétaires et managers");
    expect(en.details.join(" ")).toContain("15 minutes before kickoff, instead of when the lobby opens");
    expect(en.details.join(" ")).toContain("every member of both entrants — players, coaches and managers included —, no longer only their owners and managers");
    // Ce qui ne change pas reste dit : aucun pseudo, et l'interrupteur de « Mon profil ».
    expect(fr.details.join(" ")).toContain("ni BattleTag, ni tag Discord, ni pseudo de joueur");
    expect(en.details.join(" ")).toContain("no BattleTag, no Discord tag and no player username");
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
