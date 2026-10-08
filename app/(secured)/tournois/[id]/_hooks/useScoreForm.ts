import { useState } from "react";
import type { BracketMatch, TournamentGame } from "@/lib/shared/types";
import { useMapError } from "../_lib/error-map";
import { mapViolationText, scoreBlockerText, useDialogsText } from "../_lib/dialogs-text";
import {
  adminFormStateFor,
  decideScoreForm,
  initialAdminMaps,
  pendingProposalSignature,
  sameScoreFormState,
  scoresFromMaps,
  storedResultSignature,
  type ScoreFormBlocker,
  type ScoreFormDecision,
  type ScoreFormState,
} from "../_lib/score-form";
import { useToast } from "@/components/ui/toast";
import { useMatchFormat, useTournamentGame } from "../_lib/match-format-context";
import {
  checkMapList,
  isMapTouched,
  progressiveMapRows,
  refusalFieldOnRows,
  trimTrailingBlankMaps,
  refusalOnTouchedRow,
  type MapEntryRules,
  type MapField,
  type MapListViolation,
  type MatchMapInput,
} from "@/lib/shared/match-maps";
import type { MatchFormat } from "@/lib/shared/match-format";
// « Tranché » se lit sur le statut, pas sur la présence d'un vainqueur : un
// match nul n'en a pas et est pourtant terminé. Sur `winnerTeamId`,
// « Enregistrer » restait actif sur une rencontre finie, et la route
// d'enregistrement en réécrivait les scores sans toucher au vainqueur.
import { isMatchPlayed } from "@/lib/shared/match-outcome";

/** L'arbitrage peut se passer du code de replay (replay perdu) : « Pas de code de replay ». */
const ADMIN_MAP_RULES: MapEntryRules = { requireReplayCode: false };

/**
 * @param options.scoreEntryClosed match à planifier ou en attente de son heure
 *   (`isScoreEntryOpen`) : les scores sont refusés, le forfait reste ouvert.
 */
export function useScoreForm(
  match: BracketMatch | null,
  options: {
    scoreEntryClosed?: boolean;
    /**
     * Rattache un refus de map à son champ (`useFieldErrors`), en plus de la
     * notification — avant l'envoi comme après un refus du serveur.
     */
    onMapRefusal?: (field: { index: number; field: MapField }, message: string) => void;
    /** Les maps viennent d'être remplacées de l'extérieur : leurs refus ne valent plus. */
    onMapsReset?: () => void;
  } = {},
) {
  const { showError, showSuccess } = useToast();
  const mapError = useMapError();
  const dialogText = useDialogsText();
  const matchFormat = useMatchFormat(match);
  const game = useTournamentGame();
  // Détail map par map (`docs/features/MAP_SCORES.md`) : seule saisie du
  // score, qui en est **dérivé** — aucun score à la main.
  // Lignes affichées, une à une au fil du format (`progressiveMapRows`, une
  // ligne vierge d'emblée) ; ce qui se valide et part en retire la ligne vierge
  // de fin (`sentMaps`).
  const openingRows = () => progressiveMapRows(matchFormat, game, initialAdminMaps(match), ADMIN_MAP_RULES);
  // Valeurs d'ouverture : le score se lit sur les maps d'ouverture, jamais sur
  // le score stocké ou proposé — c'est lui qui part.
  const openingState = () => adminFormStateFor(match, openingRows());
  const [state, setState] = useState<ScoreFormState>(openingState);
  const [maps, setMaps] = useState<MatchMapInput[]>(openingRows);
  const sentMaps = trimTrailingBlankMaps(maps);
  const [submitting, setSubmitting] = useState(false);

  // Le dialogue reste monté entre deux ouvertures : sans resynchronisation, il
  // rouvrirait sur le score du match précédemment édité. On se réaligne sur
  // l'**empreinte du résultat enregistré**, pas seulement sur l'identifiant du
  // match — le match reçu vient de la liste rafraîchie par le flux SSE, et il
  // peut donc changer sans que le dialogue soit refermé (un autre membre du
  // staff saisit le score pendant que celui-ci l'a sous les yeux).
  //
  // Ce qui arrive alors dépend de ce que le lecteur a fait :
  // · rien saisi → on adopte silencieusement la nouvelle valeur ;
  // · une saisie en cours → on la garde, et on signale le désaccord plutôt que
  //   de l'effacer ou de la laisser écraser le travail de l'autre.
  const [synced, setSynced] = useState(() => ({
    signature: storedResultSignature(match),
    proposals: pendingProposalSignature(match),
    // Valeurs adoptées au dernier alignement : c'est à elles que se compare la
    // saisie courante pour savoir si le lecteur a tapé quelque chose. Comparer
    // au match qui *arrive* ne le dirait pas — il a précisément changé.
    baseline: openingState(),
    // Même rôle pour les maps : corriger un code ou ajouter une map nulle ne
    // change pas le score, et doit pourtant compter comme une saisie.
    mapsBaseline: openingRows(),
  }));
  const [conflict, setConflict] = useState(false);

  const signature = storedResultSignature(match);
  const proposals = pendingProposalSignature(match);
  if (signature !== synced.signature || proposals !== synced.proposals) {
    const untouched = sameScoreFormState(state, synced.baseline) && sameMaps(maps, synced.mapsBaseline);
    const nextMaps = openingRows();
    const next = adminFormStateFor(match, nextMaps);
    setSynced({ signature, proposals, baseline: next, mapsBaseline: nextMaps });

    if (untouched) {
      setState(next);
      setMaps(nextMaps);
      options.onMapsReset?.();
      setConflict(false);
    } else if (signature !== synced.signature && !submitting) {
      // Seul un résultat **enregistré** fait conflit : une proposition
      // d'équipe arrivée pendant la saisie n'écrase rien, la saisie reste.
      //
      // Pas pendant un envoi : le flux rapporte alors **notre propre** écriture,
      // qui arrive presque toujours avant la réponse HTTP. Sans cette réserve,
      // l'arbitre voyait « ce match a été modifié pendant ta saisie » accuser un
      // tiers de sa propre validation, le temps que le dialogue se referme.
      setConflict(true);
    }
  }

  /** Reprendre la valeur enregistrée, en abandonnant la saisie en cours. */
  const adoptStoredResult = () => {
    const nextMaps = openingRows();
    const next = adminFormStateFor(match, nextMaps);
    setSynced({ signature, proposals, baseline: next, mapsBaseline: nextMaps });
    setState(next);
    setMaps(nextMaps);
    options.onMapsReset?.();
    setConflict(false);
  };

  // Le serveur ne rend qu'un code : la même règle, rejouée ici, retrouve le
  // champ qu'il désigne.
  const flagMapRefusal = (code: string, decisive: boolean) => {
    const local = checkMapList(matchFormat, game, sentMaps, { decisive, ...ADMIN_MAP_RULES });
    const target = refusalFieldOnRows(local, maps);
    if (!target || local.error !== code || !options.onMapRefusal) return;
    options.onMapRefusal(target, mapViolationText(dialogText, local.error, matchFormat, game));
  };

  /** Contrôle des maps avant l'envoi ; `true` (refus signalé) bloque l'envoi. */
  const refuseMaps = (decisive: boolean): boolean => {
    const mapCheck = checkMapList(matchFormat, game, sentMaps, { decisive, ...ADMIN_MAP_RULES });
    if (!mapCheck.error) return false;
    flagMapRefusal(mapCheck.error, decisive);
    showError(mapViolationText(dialogText, mapCheck.error, matchFormat, game));
    return true;
  };

  // Le score suit les maps ; sans map renseignée, il n'y en a pas (champs
  // vides : « Saisis au moins une map jouée »).
  const updateMaps = (next: MatchMapInput[]) => {
    setMaps(next);
    setState((s) => ({ ...s, ...scoresFromMaps(next) }));
  };

  const decision = decideScoreForm(state, {
    format: matchFormat,
    decided: match !== null && isMatchPlayed(match),
    scoreEntryClosed: options.scoreEntryClosed === true,
  });

  // Un forfait écarte les maps : elles ne partent pas, et leurs refus se taisent.
  // De même saisie fermée (liste masquée) : c'est la fermeture qui bloque.
  const mapsSent =
    maps.some(isMapTouched) &&
    options.scoreEntryClosed !== true &&
    state.forfeitTeamId === undefined &&
    state.doubleForfeit !== true;

  const submit = async (action: "save" | "resolve") => {
    if (!match) return false;

    // Les maps se jugent par la règle du report d'équipe : un résultat validé
    // doit décrire un match terminé, un enregistrement seulement rester dans
    // les limites. Un forfait les écarte. **Avant** le contrôle du score : une
    // map au score vide ou au code manquant doit être désignée à son champ,
    // pas noyée dans « score incomplet » sur le score qui en dérive.
    const sendMaps = mapsSent;
    const decisive = action === "resolve";
    if (sendMaps && refuseMaps(decisive)) return false;
    const blocker = action === "save" ? decision.saveBlocker : decision.resolveBlocker;
    if (blocker) {
      showError(scoreBlockerText(dialogText, blocker, matchFormat));
      return false;
    }

    setSubmitting(true);
    try {
      const endpoint =
        action === "save"
          ? `/api/admin/matches/${match.id}/scores`
          : `/api/admin/matches/${match.id}/resolve`;
      const method = action === "save" ? "PATCH" : "POST";

      const body = adminScoreBody(state, sendMaps ? sentMaps : null);
      if (!body) {
        showError(scoreBlockerText(dialogText, "INCOMPLETE", matchFormat));
        return false;
      }

      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "API_ERROR");

      showSuccess(
        action === "save"
          ? dialogText.t("score.admin.saved")
          : dialogText.t("score.admin.resolved"),
      );
      return true;
    } catch (e) {
      const code = (e as Error).message;
      if (sendMaps) flagMapRefusal(code, decisive);
      showError(mapError(code));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    maps,
    setMaps: updateMaps,
    /**
     * Une map est refusée (code manquant, score vide…) : le bouton reste
     * actionnable pour que l'envoi **désigne** le champ fautif, au lieu d'un
     * bouton grisé sur « score incomplet » (`refuseMaps`). Porte le motif,
     * que l'infobulle du bouton affiche à la place du blocage de score.
     * Rien sous un forfait : la liste est masquée et ses maps ne partent pas.
     */
    mapsRefused: mapRefusals(matchFormat, game, mapsSent ? sentMaps : [], decision),
    game,
    forfeitTeamId: state.forfeitTeamId,
    doubleForfeit: state.doubleForfeit === true,
    submitting,
    decision,
    /** Le résultat enregistré a changé pendant qu'une saisie était en cours. */
    conflict,
    adoptStoredResult,
    /** Une saisie est en cours, non enregistrée. */
    dirty: !sameScoreFormState(state, openingState()) || !sameMaps(maps, openingRows()),
    // Forfait nominatif et double forfait s'excluent : en choisir un retire
    // l'autre, pour que le formulaire ne porte jamais deux verdicts.
    setForfeitTeamId: (id?: number) =>
      setState((s) => ({ ...s, forfeitTeamId: id, doubleForfeit: undefined })),
    setDoubleForfeit: (on: boolean) =>
      setState((s) => ({
        ...s,
        doubleForfeit: on ? true : undefined,
        forfeitTeamId: on ? undefined : s.forfeitTeamId,
      })),
    submit,
    /**
     * Refuse d'avance des maps qui ne partiraient pas (champ désigné, toast) :
     * à appeler **avant** une confirmation, qui sinon couvrirait le champ fautif.
     */
    refuseMapsBefore: (action: "save" | "resolve") => mapsSent && refuseMaps(action === "resolve"),
  };
}

const STRUCTURAL_BLOCKERS: ReadonlySet<ScoreFormBlocker> = new Set<ScoreFormBlocker>([
  "ALREADY_DECIDED",
  "DOUBLE_FORFEIT",
  "NOT_IN_LAUNCH",
]);

function isStructuralBlocker(blocker: ScoreFormBlocker | null): boolean {
  return blocker !== null && STRUCTURAL_BLOCKERS.has(blocker);
}

/** Refus des maps qui partiraient, pour l'enregistrement et pour la validation. */
function mapRefusals(
  format: MatchFormat | null,
  game: TournamentGame | null | undefined,
  maps: ReadonlyArray<MatchMapInput>,
  decision: Pick<ScoreFormDecision, "saveBlocker" | "resolveBlocker">,
): { save: MapListViolation | null; resolve: MapListViolation | null; onBlankRow: boolean } {
  if (maps.length === 0) return { save: null, resolve: null, onBlankRow: false };
  const save = checkMapList(format, game, maps, { decisive: false, ...ADMIN_MAP_RULES });
  const resolve = checkMapList(format, game, maps, { decisive: true, ...ADMIN_MAP_RULES });
  // Un geste interdit pour une autre raison que les maps (résultat déjà
  // tranché, double forfait, saisie fermée) le reste : le refus de map ne
  // rouvre pas le bouton, et c'est cette raison-là qui s'affiche.
  return {
    save: isStructuralBlocker(decision.saveBlocker) ? null : save.error,
    resolve: isStructuralBlocker(decision.resolveBlocker) ? null : resolve.error,
    // Le refus affiché désigne une ligne vierge, qu'on vient d'ajouter : il se tait.
    onBlankRow: !refusalOnTouchedRow(resolve.error ? resolve : save, maps),
  };
}

/**
 * Corps d'une saisie d'arbitrage : double forfait, forfait, ou maps — dans cet
 * ordre de priorité. `null` quand il n'y a rien à envoyer (aucune map).
 */
function adminScoreBody(
  state: ScoreFormState,
  maps: MatchMapInput[] | null,
): { forfeitTeamId?: number; doubleForfeit?: true; maps?: MatchMapInput[] } | null {
  if (state.doubleForfeit === true) return { doubleForfeit: true };
  if (state.forfeitTeamId !== undefined) return { forfeitTeamId: state.forfeitTeamId };
  return maps ? { maps } : null;
}

function sameMaps(a: ReadonlyArray<MatchMapInput>, b: ReadonlyArray<MatchMapInput>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
