import { describe, expect, it } from "@jest/globals";
import { buildFrame } from "@/lib/server/tournaments/snapshot";

/**
 * La trame SSE est assemblée à la main pour ne pas sérialiser l'instantané deux
 * fois — une fois pour son empreinte, une fois pour l'enveloppe : sur un
 * plateau de 254 matchs (~150 ko), le second passage se paie à chaque
 * construction, sur un Raspberry Pi.
 *
 * Ce raccourci ne tient que s'il produit du JSON strictement valide. Ces tests
 * sont donc le filet : ils relisent la trame et exigent qu'elle redonne
 * exactement l'objet de départ, y compris sur les caractères qui cassent une
 * concaténation naïve.
 */
function readFrame(frame: Uint8Array) {
  const text = new TextDecoder().decode(frame);
  expect(text.startsWith("data: ")).toBe(true);
  expect(text.endsWith("\n\n")).toBe(true);
  return JSON.parse(text.slice("data: ".length, -2));
}

describe("buildFrame", () => {
  it("relit exactement l'instantané de départ", () => {
    const payload = {
      card: { id: 7, name: "Tournoi" },
      matches: [{ id: 1, team1Score: 3, team2Score: null }],
      registrations: [],
      soloUserIds: {},
      phaseStandings: {},
    };
    const json = JSON.stringify(payload);

    const parsed = readFrame(buildFrame(7, json, "v1"));

    expect(parsed).toEqual({
      type: "snapshot",
      tournamentId: 7,
      version: "v1",
      snapshot: { ...payload, version: "v1" },
    });
  });

  it("survit aux caractères qui cassent une concaténation naïve", () => {
    // Un nom d'équipe peut contenir des guillemets, des accolades, des
    // antislashs, des sauts de ligne ou des émojis — et un saut de ligne non
    // échappé couperait le message SSE en deux.
    const payload = {
      card: { name: 'Team "}\\{ \n ✦ 日本' },
      registrations: [{ teamName: "A B" }],
    };
    const json = JSON.stringify(payload);

    const parsed = readFrame(buildFrame(1, json, 'ver"sion'));

    expect(parsed.snapshot.card.name).toBe('Team "}\\{ \n ✦ 日本');
    expect(parsed.snapshot.registrations[0].teamName).toBe("A B");
    expect(parsed.version).toBe('ver"sion');
    expect(parsed.snapshot.version).toBe('ver"sion');
  });

  it("gère un instantané vide sans produire de JSON invalide", () => {
    // Le contenu réel n'est jamais vide, mais un objet sans champ ferait
    // dégénérer le raccourci en `{,"version":…}`.
    const parsed = readFrame(buildFrame(3, "{}", "v0"));
    expect(parsed.snapshot).toEqual({ version: "v0" });
  });

  it("n'insère jamais un identifiant tel quel", () => {
    // `NaN` ne s'écrit pas en JSON : la trame doit rester lisible plutôt que de
    // faire tomber tous les abonnés à l'analyse.
    const parsed = readFrame(buildFrame(Number.NaN, "{}", "v0"));
    expect(parsed.tournamentId).toBeNull();
  });

  it("ne contient qu'un seul message", () => {
    const payload = JSON.stringify({ card: { name: "A\nB" } });
    const text = new TextDecoder().decode(buildFrame(1, payload, "v1"));
    // Un saut de ligne mal échappé terminerait le message trop tôt : le
    // séparateur SSE ne doit apparaître qu'à la fin.
    expect(text.indexOf("\n\n")).toBe(text.length - 2);
  });
});
