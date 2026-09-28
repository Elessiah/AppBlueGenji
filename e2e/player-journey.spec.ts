import { dismissSiteOverlays, test, expect, type Page } from "./helpers/test";
import {
  apiAs,
  browserAs,
  journeyUnavailableReason,
  launchMatch,
  setUpJourney,
  startDuelTournament,
  tearDownJourney,
  type JourneyFixture,
} from "./helpers/player-journey-fixture";

/**
 * Parcours d'un joueur dans un tournoi : inscription de son équipe, lancement
 * du match, saisie du score dans la modale, confirmation par l'adversaire,
 * désaccord, et forfait sur la manche.
 *
 * Deux joueurs réels, chacun avec **sa** session (voir la fixture) : c'est la
 * seule façon d'exercer le cycle de report, où ce que l'un envoie doit
 * apparaître chez l'autre. Le formulaire en ligne d'avant envoyait bien le
 * score, mais rien ne s'affichait nulle part — ce parcours tient justement ce
 * qui manquait : la trace à l'écran.
 *
 * PRÉREQUIS : une base MySQL (`.env`) et **pas** de bypass `E2E_AUTH_USER`.
 * Ignoré sinon (CI sans base comprise).
 */
const unavailable = journeyUnavailableReason();

let fixture: JourneyFixture | null = null;

test.describe("Parcours joueur dans un tournoi", () => {
  test.skip(unavailable !== null, unavailable ?? "");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ baseURL }) => {
    fixture = await setUpJourney(baseURL!);
  });

  test.afterAll(async () => {
    await tearDownJourney(fixture);
    fixture = null;
  });

  /** Carte du match, repérée par son ancre de lien profond. */
  const matchCard = (page: Page, matchId: number) => page.locator(`#match-${matchId}`);
  const scoreDialog = (page: Page) => page.getByRole("dialog", { name: "Score de mon match" });
  const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });

  /**
   * Centre de lancement du match, qui s'ouvre de lui-même sur la fiche : on le
   * referme par Échap avant d'agir. Les pages de ce parcours naissent de
   * contextes propres à chaque joueur, hors de la fixture `page` : le garde
   * commun (annonce de recrutement, conditions d'utilisation) est donc posé à
   * l'ouverture de la fiche, par `dismissSiteOverlays`.
   */
  async function dismissLaunchCenter(page: Page) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const overlay = page.getByRole("dialog").filter({ hasNotText: "Score de mon match" }).first();
      if (!(await overlay.isVisible().catch(() => false))) return;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
  }

  async function openTournament(page: Page, tournamentId: number, matchId: number) {
    await dismissSiteOverlays(page);
    await page.goto(`/tournois/${tournamentId}`);
    await expect(matchCard(page, matchId)).toBeVisible({ timeout: 30_000 });
    await dismissLaunchCenter(page);
  }

  test("le joueur propose un score, l'adversaire le confirme d'un clic", async ({ browser }) => {
    const f = fixture!;
    const { tournamentId, matchId } = await startDuelTournament(f, `E2E Joueur confirmation ${Date.now()}`);
    await launchMatch(f, matchId);

    // --- Joueur A : saisit 2 – 1 pour son équipe.
    const contextA = await browserAs(browser, f.baseURL, f.playerA.token);
    const pageA = await contextA.newPage();
    await openTournament(pageA, tournamentId, matchId);

    await matchCard(pageA, matchId).getByRole("button", { name: /Saisir le score/ }).click();
    const dialogA = scoreDialog(pageA);
    await expect(dialogA).toBeVisible();
    // Champs vides à l'ouverture : aucun « 0 – 0 » inventé.
    const [fieldA1, fieldA2] = [
      dialogA.getByRole("spinbutton", { name: `Manches gagnées par ${f.playerA.teamName}` }),
      dialogA.getByRole("spinbutton", { name: `Manches gagnées par ${f.playerB.teamName}` }),
    ];
    await expect(fieldA1).toHaveValue("");
    await expect(dialogA.getByRole("button", { name: "Envoyer le score" })).toBeDisabled();

    await fieldA1.fill("2");
    await fieldA2.fill("1");
    await dialogA.getByRole("button", { name: "Envoyer le score" }).click();
    await expect(toasts(pageA).getByText(/Score transmis/)).toBeVisible();
    await expect(dialogA).toHaveCount(0);

    // La carte garde la trace de la proposition — c'est ce qui manquait.
    await expect(matchCard(pageA, matchId)).toContainText(`2 – 1 proposé par ${f.playerA.teamName}`);
    await expect(
      matchCard(pageA, matchId).getByRole("button", { name: /Modifier mon score/ }),
    ).toBeVisible();

    // --- Joueur B : la modale s'ouvre sur la proposition, un clic confirme.
    const contextB = await browserAs(browser, f.baseURL, f.playerB.token);
    const pageB = await contextB.newPage();
    await openTournament(pageB, tournamentId, matchId);

    await matchCard(pageB, matchId).getByRole("button", { name: /Confirmer le score/ }).click();
    const dialogB = scoreDialog(pageB);
    await expect(dialogB).toContainText(`${f.playerA.teamName} propose 2 – 1`);
    await expect(
      dialogB.getByRole("spinbutton", { name: `Manches gagnées par ${f.playerA.teamName}` }),
    ).toHaveValue("2");
    await dialogB.getByRole("button", { name: "Confirmer le score" }).click();
    await expect(toasts(pageB).getByText(/Score confirmé/)).toBeVisible();

    // Le résultat est acquis : plus de bouton, le score s'affiche sur la carte.
    await expect(matchCard(pageB, matchId).getByRole("button", { name: /score/i })).toHaveCount(0);
    await expect(matchCard(pageB, matchId)).not.toContainText("à confirmer");

    // Et côté serveur : le vainqueur est bien l'équipe A.
    const api = await apiAs(f.baseURL, f.playerA.token);
    const detail = (await (await api.get(`/api/tournaments/${tournamentId}`)).json()) as {
      matches: { id: number; status: string; winnerTeamId: number | null; team1Score: number | null; team2Score: number | null; team1Id: number }[];
    };
    await api.dispose();
    const final = detail.matches.find((m) => m.id === matchId)!;
    expect(final.status).toBe("COMPLETED");
    expect(final.winnerTeamId).toBe(f.playerA.teamId);

    await contextA.close();
    await contextB.close();
  });

  test("deux scores contradictoires sont signalés comme un désaccord", async ({ browser }) => {
    const f = fixture!;
    const { tournamentId, matchId } = await startDuelTournament(f, `E2E Joueur désaccord ${Date.now()}`);
    await launchMatch(f, matchId);

    // A annonce sa victoire par l'API ; B, dans l'interface, annonce la sienne.
    const apiA = await apiAs(f.baseURL, f.playerA.token);
    const reported = await apiA.post(`/api/tournaments/${tournamentId}/matches/${matchId}/report`, {
      data: { myScore: 2, opponentScore: 0 },
    });
    expect(reported.ok()).toBe(true);
    await apiA.dispose();

    const contextB = await browserAs(browser, f.baseURL, f.playerB.token);
    const pageB = await contextB.newPage();
    await openTournament(pageB, tournamentId, matchId);

    await matchCard(pageB, matchId).getByRole("button", { name: /Confirmer le score/ }).click();
    const dialog = scoreDialog(pageB);
    await dialog.getByRole("spinbutton", { name: `Manches gagnées par ${f.playerA.teamName}` }).fill("1");
    await dialog.getByRole("spinbutton", { name: `Manches gagnées par ${f.playerB.teamName}` }).fill("2");
    // Le score diffère de la proposition : le bouton redevient un envoi.
    await dialog.getByRole("button", { name: "Envoyer le score" }).click();
    await expect(dialog).toHaveCount(0);

    await expect(matchCard(pageB, matchId)).toContainText("Scores contradictoires");
    await matchCard(pageB, matchId).getByRole("button", { name: /Revoir le score/ }).click();
    await expect(scoreDialog(pageB)).toContainText("Les scores se contredisent");

    await contextB.close();
  });

  test("un responsable d'équipe déclare forfait avant le lancement", async ({ browser }) => {
    const f = fixture!;
    const { tournamentId, matchId } = await startDuelTournament(f, `E2E Joueur forfait ${Date.now()}`);

    const contextB = await browserAs(browser, f.baseURL, f.playerB.token);
    const pageB = await contextB.newPage();
    await openTournament(pageB, tournamentId, matchId);

    // Match pas encore lancé : la carte n'offre que le forfait.
    await matchCard(pageB, matchId).getByRole("button", { name: /Déclarer forfait/ }).click();
    const dialog = scoreDialog(pageB);
    await expect(dialog).toContainText("Le score se saisit une fois le match lancé");
    await expect(dialog.getByRole("spinbutton")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Déclarer forfait sur ce match" }).click();
    await expect(dialog).toContainText(`${f.playerA.teamName} l'emporte 2-0`);
    await dialog.getByRole("button", { name: `Confirmer le forfait de ${f.playerB.teamName}` }).click();
    await expect(toasts(pageB).getByText(/Forfait enregistré/)).toBeVisible();

    // « FF » sur la ligne de l'équipe qui déclare forfait, score plein en face.
    await expect(matchCard(pageB, matchId)).toContainText("FF");

    const api = await apiAs(f.baseURL, f.playerB.token);
    const detail = (await (await api.get(`/api/tournaments/${tournamentId}`)).json()) as {
      matches: { id: number; status: string; winnerTeamId: number | null; forfeitTeamId: number | null }[];
    };
    await api.dispose();
    const final = detail.matches.find((m) => m.id === matchId)!;
    expect(final.status).toBe("COMPLETED");
    expect(final.forfeitTeamId).toBe(f.playerB.teamId);
    expect(final.winnerTeamId).toBe(f.playerA.teamId);

    await contextB.close();
  });
});
