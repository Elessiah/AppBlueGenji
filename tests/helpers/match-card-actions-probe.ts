import { createElement } from "react";
import {
  groupMatchCardActions,
  matchCardActionName,
  type MatchCardAction,
} from "@/app/(secured)/tournois/[id]/_lib/match-card-actions";

/**
 * Double de `MatchCardActions` pour les tests qui rendent la carte entière
 * (`MatchRow`) : le vrai composant ne monte la liste de « Plus d'actions »
 * qu'à l'ouverture, qu'un rendu statique ne peut pas provoquer. La sonde
 * écrit **toutes** les actions reçues, chacune avec son `data-action`, son
 * nom accessible et, pour la principale, `data-primary="true"` — le rangement
 * est celui du module pur, le même que le composant.
 *
 * Usage : `jest.mock(".../_components/MatchCardActions", () =>
 * jest.requireActual<typeof import("../helpers/match-card-actions-probe")>(
 * "../helpers/match-card-actions-probe").probeModule())`.
 */
export function probeModule() {
  return {
    MatchCardActions: ({
      actions,
      matchLabel,
    }: Readonly<{ actions: readonly MatchCardAction[]; matchLabel: string }>) => {
      const { primary } = groupMatchCardActions(actions);
      return createElement(
        "ul",
        { "data-probe": "match-card-actions" },
        actions.map((action) =>
          createElement(
            "li",
            {
              key: action.id,
              "data-action": action.id,
              "data-primary": action === primary ? "true" : undefined,
            },
            matchCardActionName(action.label, matchLabel),
          ),
        ),
      );
    },
  };
}
