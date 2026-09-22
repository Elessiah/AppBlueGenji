import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

// Les pages d'annuaire sont des client components branchés sur des hooks de
// chargement : on vérifie le libellé au niveau source, comme PublicHeader.
const playersList = read("app/(secured)/joueurs/page.tsx");
const teamsList = read("app/(secured)/equipes/page.tsx");
const playerDetail = read("app/(secured)/joueurs/[id]/page.tsx");
const playerCard = read("app/(secured)/joueurs/cards/PlayerCard.tsx");

describe("Annuaires — titres orientés participation", () => {
  it("titre la liste des joueurs « Joueurs inscrits »", () => {
    expect(playersList).toContain("Joueurs <em>inscrits</em>");
    expect(playersList).not.toContain("Joueurs <em>BlueGenji</em>");
  });

  it("titre la liste des équipes « Équipes inscrites »", () => {
    expect(teamsList).toContain("Équipes <em>inscrites</em>");
    expect(teamsList).not.toContain("Équipes <em>BlueGenji</em>");
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
    expect(playerDetail).toContain("href={`/equipes/${activeTeam.teamId}`}");
    expect(playerDetail).toContain("{activeTeam.teamName}");
  });

  it("dégrade en « Sans équipe » pour un free agent", () => {
    const branch = playerDetail.slice(playerDetail.indexOf("{activeTeam ? ("));
    const fallback = branch.slice(branch.indexOf(") : ("));
    expect(fallback).toContain("Sans équipe");
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
    expect(playerCard).toContain("PLAYER_ROSTER_STATUS_LABEL[playerRosterStatus(player)]");
  });

  it("demande le statut une seule fois — le roster aussi passe par lui", () => {
    // Brancher ici sur `player.team` et là sur le statut partagé remettrait la
    // règle à deux endroits, ce que le module existe pour éviter.
    expect(playerCard).toContain('playerRosterStatus(player) === "ROSTER"');
    expect(playerCard).not.toContain("ROSTER ·");
  });

  it("fait passer le filtre et le compteur par le même prédicat", () => {
    expect(playersList).toContain("isFreeAgent");
    expect(playersList).not.toContain("p.openToRecruitment === false");
  });
});
