import { describe, expect, it } from "@jest/globals";
import enTournament from "@/messages/en/tournament.json";
import frTournament from "@/messages/fr/tournament.json";
import enTournamentServer from "@/messages/en/tournamentServer.json";
import frTournamentServer from "@/messages/fr/tournamentServer.json";
import enTournaments from "@/messages/en/tournaments.json";
import frTournaments from "@/messages/fr/tournaments.json";
import enTournamentsShared from "@/messages/en/tournamentsShared.json";
import frTournamentsShared from "@/messages/fr/tournamentsShared.json";
import { englishTournamentSheet } from "@/components/i18n/english-loaders-tournament";
import { messagesFor } from "@/lib/server/i18n-messages";
import { tournamentPageMessages } from "@/lib/shared/tournament-page-text";
import { tournamentsSharedMessages } from "@/lib/shared/tournaments-text";

const sorted = (value: object): string[] => Object.keys(value).sort((a, b) => a.localeCompare(b));

describe("espaces serveur de la fiche (tournamentServer)", () => {
  it.each([
    ["fr", frTournamentServer, frTournament],
    ["en", enTournamentServer, enTournament],
  ])("tournamentServer_%s_holdsOnlyServerPartsOutOfTheClientFile", (_locale, server, client) => {
    expect(sorted(server)).toEqual(["meta", "settings", "share"]);

    expect(sorted(client).filter((key) => ["meta", "settings", "share"].includes(key))).toEqual([]);
  });

  it("tournamentPageMessages_englishCatalog_returnsTheWholeClientNamespace", () => {
    expect(tournamentPageMessages(messagesFor("en"))).toBe(enTournament);
  });
});

describe("textes communs à la liste et à la fiche (tournamentsShared)", () => {
  it.each([
    ["fr", frTournamentsShared, frTournaments],
    ["en", enTournamentsShared, enTournaments],
  ])("tournamentsShared_%s_holdsOnlySharedPartsOutOfTheListFile", (_locale, shared, list) => {
    expect(sorted(shared)).toEqual(["matchFormat", "participants", "rulesHelp"]);
    expect(sorted(list)).toEqual(["cards", "list", "meta", "ticker"]);
  });

  it("tournamentsSharedMessages_englishCatalog_readsTheSharedFileAndLabels", () => {
    const messages = messagesFor("en");
    expect(tournamentsSharedMessages(messages)).toEqual({ ...enTournamentsShared, labels: messages.labels });
  });
});

describe("englishTournamentSheet", () => {
  it("load_englishChunk_carriesPageActionsAndSharedTexts", async () => {
    const loaded = await englishTournamentSheet.load();
    const messages = messagesFor("en");
    expect(loaded.page).toEqual(tournamentPageMessages(messages));
    expect(loaded.shared).toEqual(tournamentsSharedMessages(messages));
    expect(sorted(loaded)).toEqual(["actions", "page", "shared"]);
  });
});
