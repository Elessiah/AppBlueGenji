/**
 * Inscription d'un caster sur un match qui a déjà un stream
 * (`docs/features/MATCH_LAUNCH.md` § Casters et streams) : les choix offerts
 * (`_lib/cast-claim.ts`), la fenêtre qui les rend (`CastClaimDialog`), les
 * liens de streams du bandeau (`matchStreamLinks`) et les branchements de la
 * carte (clic direct sans stream, choix du caster retiré par le staff).
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
// Rendu serveur : seul l'effet de montage de la confirmation est joué (sans
// lui, elle ne rend rien) ; les autres effets n'ont pas lieu d'être ici.
const effects = { armed: false };
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => void) => {
      if (!effects.armed || !String(effect).includes("setMounted")) return;
      effects.armed = false;
      effect();
    },
  };
});
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));

import { renderToStaticMarkup } from "react-dom/server";
import { CastClaimDialog } from "@/app/(secured)/tournois/[id]/_components/CastClaimDialog";
import { matchStreamLinks } from "@/app/(secured)/tournois/[id]/_components/MatchLiveStrip";
import { castClaimBody, castClaimChoiceKey, castClaimChoices } from "@/app/(secured)/tournois/[id]/_lib/cast-claim";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";
import { bracketMatch, matchCaster } from "../helpers/bracket-match";
import { readSource } from "../helpers/read-source";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import enDialogs from "@/messages/en/tournamentDialogs.json";

const globalWithDocument = globalThis as { document?: unknown };
const hadDocument = "document" in globalWithDocument;
beforeAll(() => {
  if (!hadDocument) globalWithDocument.document = { body: {} };
});
afterAll(() => {
  if (!hadDocument) delete globalWithDocument.document;
});

const TWO_STREAMS = bracketMatch({
  streams: [
    { id: 3, liveUrl: "https://twitch.tv/match", staff: true },
    { id: 4, liveUrl: null, staff: false },
  ],
  casters: [
    matchCaster({ userId: 9, pseudo: "Voix", streamId: 3 }),
    matchCaster({ userId: 12, pseudo: "Écho", streamId: 3 }),
    matchCaster({ userId: 13, pseudo: "Solo", streamId: 4 }),
  ],
});

describe("castClaimChoices — un choix par stream, puis « ouvrir le sien »", () => {
  it("liste les streams dans leur ordre, chacun avec ses casters, et finit par le stream à part", () => {
    expect(castClaimChoices(TWO_STREAMS)).toEqual([
      { kind: "JOIN", streamId: 3, liveUrl: "https://twitch.tv/match", casterPseudos: ["Voix", "Écho"] },
      { kind: "JOIN", streamId: 4, liveUrl: null, casterPseudos: ["Solo"] },
      { kind: "SEPARATE" },
    ]);
  });

  it("un stream que personne ne tient (lien du staff) se rejoint aussi", () => {
    const match = bracketMatch({ streams: [{ id: 1, liveUrl: "https://kick.com/bg", staff: true }] });
    expect(castClaimChoices(match)[0]).toEqual({
      kind: "JOIN",
      streamId: 1,
      liveUrl: "https://kick.com/bg",
      casterPseudos: [],
    });
  });

  it("sans stream : seul le stream à part reste", () => {
    expect(castClaimChoices(bracketMatch())).toEqual([{ kind: "SEPARATE" }]);
  });

  it("donne une clé stable par choix", () => {
    const keys = castClaimChoices(TWO_STREAMS).map(castClaimChoiceKey);
    expect(keys).toEqual(["join-3", "join-4", "separate"]);
  });
});

describe("castClaimBody — le corps envoyé à POST /api/matches/[id]/caster", () => {
  it("rejoindre : le stream seul, aucun lien même saisi", () => {
    expect(castClaimBody({ kind: "JOIN", streamId: 4, liveUrl: null, casterPseudos: [] }, "twitch.tv/x")).toEqual({
      streamId: 4,
    });
  });

  it("à part : le lien rogné, ou null quand il est vide", () => {
    expect(castClaimBody({ kind: "SEPARATE" }, "  twitch.tv/voix ")).toEqual({ liveUrl: "twitch.tv/voix" });
    expect(castClaimBody({ kind: "SEPARATE" }, "   ")).toEqual({ liveUrl: null });
    expect(castClaimBody({ kind: "SEPARATE" }, "")).toEqual({ liveUrl: null });
  });
});

function renderDialog(locale: "fr" | "en") {
  effects.armed = true;
  const dialog = (
    <CastClaimDialog
      match={TWO_STREAMS}
      matchLabel="Alpha contre Bravo"
      onClose={() => undefined}
      onClaim={async () => ({ ok: true })}
    />
  );
  if (locale === "fr") return renderToStaticMarkup(dialog);
  return renderToStaticMarkup(
    <TournamentActionsTextProvider locale="en" messages={tournamentActionsMessages(messagesFor("en"))}>
      {dialog}
    </TournamentActionsTextProvider>,
  );
}

describe("CastClaimDialog — rendu", () => {
  it("un bouton radio par choix, le premier coché et focalisé ; casters et plateforme nommés", () => {
    const html = renderDialog("fr");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    const first = /<input[^>]*value="join-3"[^>]*>/.exec(html)?.[0] ?? "";
    expect(first).toContain('checked=""');
    expect(first).toContain('data-autofocus="true"');
    expect(/<input[^>]*value="separate"[^>]*>/.exec(html)?.[0]).not.toContain("checked");
    expect(html).toContain("Co-caster avec Voix, Écho");
    expect(html).toContain("Twitch");
    expect(html).toContain("sans lien");
    expect(html).toContain("Ouvrir mon propre stream");
    expect(html).toContain("<legend");
  });

  it("le champ du lien n'apparaît qu'en choisissant son propre stream", () => {
    expect(renderDialog("fr")).not.toContain('inputmode="url"');
  });

  it("parle anglais sous /en", () => {
    const html = renderDialog("en");
    expect(html).toContain("Co-cast with Voix, Écho");
    expect(html).toContain("Open my own stream");
    expect(html).toContain("no link");
    expect(html).not.toContain("Ouvrir mon propre stream");
  });
});

describe("matchStreamLinks — tous les liens du bandeau, le premier en tête", () => {
  it("garde l'ordre des streams, saute ceux sans lien et ne double jamais le premier", () => {
    const match = bracketMatch({
      liveUrl: "https://twitch.tv/match",
      streams: [
        { id: 3, liveUrl: "https://twitch.tv/match", staff: true },
        { id: 4, liveUrl: null, staff: false },
        { id: 5, liveUrl: "https://kick.com/voix", staff: false },
      ],
    });
    expect(matchStreamLinks(match)).toEqual(["https://twitch.tv/match", "https://kick.com/voix"]);
  });

  it("lecture partielle (sans streams) : le premier lien seul ; sans lien, rien", () => {
    expect(matchStreamLinks(bracketMatch({ liveUrl: "https://twitch.tv/x" }))).toEqual(["https://twitch.tv/x"]);
    expect(matchStreamLinks(bracketMatch())).toEqual([]);
  });
});

describe("CastClaimDialog — un stream choisi qui disparaît", () => {
  const source = readSource("app/(secured)/tournois/[id]/_components/CastClaimDialog.tsx");

  it("n'est pas remplacé en silence par le premier : plus rien n'est choisi, l'envoi est désarmé", () => {
    expect(source).toContain("choices.find((option) => castClaimChoiceKey(option) === choiceKey) ?? null;");
    expect(source).toContain("disabled={choice === null || urlInvalid}");
    expect(source).toContain("if (choice === null) return false;");
  });
});

describe("MatchCardActions — branchements du cast", () => {
  const card = readSource("app/(secured)/tournois/[id]/_components/MatchCardActions.tsx");

  it("sans stream, « Caster » inscrit d'un clic ; sinon la fenêtre fait choisir", () => {
    expect(card).toContain("if (match.streams.length === 0) {");
    expect(card).toContain('send(`/api/matches/${match.id}/caster`, "POST", {})');
    expect(card).toContain("<CastClaimDialog match={match}");
  });

  it("le staff choisit le caster retiré, désigné par ?userId= ; le caster se retire sans paramètre", () => {
    expect(card).toContain("/api/matches/${match.id}/caster?userId=${encodeURIComponent(");
    expect(card).toContain('send(`/api/matches/${match.id}/caster`, "DELETE")');
    expect(card).toContain("{match.casters.length > 1 && (");
    // Un arbitre qui caste aussi le match passe par ce choix, lui compris.
    expect(card).toContain("if (!isCaster || releasesOthers) {");
  });

  it("le caster à retirer est fixé à l'ouverture ; parti entre-temps, la fenêtre se ferme au lieu d'en viser un autre", () => {
    expect(card).toContain("setReleaseTarget(casters[0]?.userId ?? null);");
    expect(card).toContain("const releasedCaster = casters.find((caster) => caster.userId === releaseTarget) ?? null;");
    expect(card).toContain("if (open && releasedCaster === null) setOpen(false);");
    expect(card).toContain("confirmRelease: open && releasedCaster !== null");
    expect(card).not.toContain("?? match.casters[0] ?? null");
  });

  it("le choix du caster à retirer garde le focus sur « Annuler » : un Entrée réflexe sur un bouton radio ne retire personne", () => {
    const start = card.indexOf("{confirmRelease && (");
    const dialog = card.slice(start, card.indexOf("</ConfirmActionDialog>", start));
    expect(dialog).toContain('name={`release-caster-${match.id}`}');
    expect(dialog).not.toContain("focusContent");
    expect(dialog).not.toContain("data-autofocus");
  });
});

describe("Configuration du direct — l'aide du lien du staff", () => {
  it("dit qu'un champ vide laisse le premier lien d'un caster à l'annonce (FR et EN)", () => {
    expect(frDialogs.live.urlHint).toContain("sans lien du staff : son annonce sur Discord renverra alors au premier lien ouvert par un caster");
    expect(enDialogs.live.urlHint).toContain("without a staff link: its Discord announcement will then point to the first link opened by a caster");
  });
});
