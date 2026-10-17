import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

// Les pages d'annuaire sont des client components branchés sur des hooks de
// chargement : on vérifie le libellé au niveau source, comme PublicHeader.
const playersList = read("app/(secured)/joueurs/PlayersList.tsx");
const teamsList = read("app/(secured)/equipes/TeamsList.tsx");
const playerDetail = read("app/(secured)/joueurs/[id]/page.tsx");
const playerCard = read("app/(secured)/joueurs/cards/PlayerCard.tsx");
// Depuis le lot 9 de la traduction, les libellés vivent dans les messages.
const frPlayers = JSON.parse(read("messages/fr/players.json")) as typeof import("@/messages/fr/players.json");
const frTeams = JSON.parse(read("messages/fr/teams.json")) as typeof import("@/messages/fr/teams.json");

describe("Annuaires — titres orientés participation", () => {
  it("titre la liste des joueurs « Joueurs inscrits »", () => {
    expect(frPlayers.list.title).toBe("Joueurs <em>inscrits</em>");
    expect(playersList).toContain('text.rich("list.title"');
  });

  it("titre la liste des équipes « Équipes inscrites »", () => {
    expect(frTeams.list.title).toBe("Équipes <em>inscrites</em>");
    expect(teamsList).toContain('text.rich("list.title"');
  });
});

describe("Fiche joueur — badge d'appartenance", () => {
  it("remplace le badge décoratif « Joueur BlueGenji »", () => {
    expect(playerDetail).not.toContain("Joueur BlueGenji");
  });

  it("dérive l'équipe courante de la timeline (adhésion non close)", () => {
    expect(playerDetail).toMatch(
      /const activeTeam = data\.teamsTimeline\.find\(\(entry\) => entry\.leftAt === null\) \?\? null;/,
    );
  });

  it("affiche l'équipe courante en lien vers sa fiche", () => {
    expect(playerDetail).toContain("<TeamLink");
    expect(playerDetail).toContain("teamId={activeTeam.teamId}");
    expect(playerDetail).toContain("<LocaleLink");
    expect(playerDetail).toContain("{activeTeam.teamName}");
  });

  it("dégrade en « Sans équipe » pour un free agent", () => {
    const branch = playerDetail.slice(playerDetail.indexOf("{activeTeam ? ("));
    const fallback = branch.slice(branch.indexOf(") : ("));
    expect(fallback).toContain('t("page.noTeam")');
    expect(frPlayers.page.noTeam).toBe("Sans équipe");
  });

  it("conserve les rôles de plateforme affichés à côté du badge", () => {
    expect(playerDetail).toContain("data.displayRoles.map");
  });
});

describe("Carte d'annuaire — « free agent » n'est pas « sans équipe »", () => {
  it("ne code plus le libellé en dur dans la carte", () => {
    expect(playerCard).not.toContain(">FREE AGENT<");
  });

  it("dérive le libellé du statut partagé", () => {
    expect(playerCard).toContain("const rosterStatus = playerRosterStatus(player);");
    expect(playerCard).toContain("t(`card.rosterStatus.${rosterStatus}`)");
  });

  it("demande le statut une seule fois — le roster aussi passe par lui", () => {
    // Brancher ici sur `player.team` et là sur le statut partagé remettrait la
    // règle à deux endroits, ce que le module existe pour éviter.
    expect(playerCard).toContain('rosterStatus === "ROSTER"');
    expect(playerCard.match(/playerRosterStatus\(/g)).toHaveLength(1);
    expect(playerCard).not.toContain("ROSTER ·");
  });

  it("fait passer le filtre et le compteur par le même prédicat", () => {
    expect(playersList).toContain("isFreeAgent");
    expect(playersList).not.toContain("p.openToRecruitment === false");
  });
});
