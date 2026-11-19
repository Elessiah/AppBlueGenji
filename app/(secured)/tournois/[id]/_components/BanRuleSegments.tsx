import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { blocksImplicitSubmit } from "../_lib/round-maps-editor";

/**
 * Un réglage de bans de la fenêtre « Cartes et bans » (`docs/features/ROUND_MAPS.md`) :
 * une légende, puis un bouton radio par règle, rendus en segments (`.radio-segments`).
 *
 * Les radios d'un même `name` se parcourent aux flèches (natif). Pendant un envoi
 * (`busy`), elles restent focalisables mais figées (`aria-disabled`, geste ignoré :
 * `docs/features/BUSY_BUTTONS.md`) — ce qui est affiché est ce qui part : flèches,
 * Espace et clic y sont annulés, la radio cochée ne bouge même pas un instant. Entrée sur
 * une radio n'envoie pas le formulaire (`blocksImplicitSubmit`) : l'enregistrement
 * reste un geste explicite, comme avec l'ancienne liste déroulante.
 */
/** Touches qui, sur une radio, en cochent une autre (ou celle sous le focus). */
const CHOICE_KEYS: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", " "]);

/** La touche change-t-elle la radio cochée du groupe ? */
export function movesRadioChoice(key: string): boolean {
  return CHOICE_KEYS.has(key);
}

export function BanRuleSegments<Rule extends string>({
  legend,
  name,
  rules,
  value,
  busy,
  isBusy,
  labelOf,
  onChange,
}: Readonly<{
  legend: string;
  /** `name` du groupe radio : unique dans la page. */
  name: string;
  rules: readonly Rule[];
  value: Rule;
  busy: boolean;
  /** Garde synchrone (`useBusyGuard`) : `busy` peut avoir un rendu de retard. */
  isBusy: () => boolean;
  labelOf: (rule: Rule) => string;
  onChange: (rule: Rule) => void;
}>) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (blocksImplicitSubmit(event.key, event.currentTarget.type) || (isBusy() && movesRadioChoice(event.key))) {
      event.preventDefault();
    }
  };
  return (
    <fieldset className="radio-segments-group">
      <legend className="radio-segments-legend">{legend}</legend>
      <div className="radio-segments" data-tap-zone>
        {rules.map((rule) => (
          <label key={rule} className="radio-segment">
            <input
              type="radio"
              name={name}
              value={rule}
              checked={value === rule}
              aria-disabled={busy || undefined}
              onKeyDown={onKeyDown}
              onClick={(event) => {
                // Annulé, le clic laisse la radio cochée en place : rien ne s'affiche comme choisi.
                if (isBusy()) event.preventDefault();
              }}
              onChange={() => {
                if (!isBusy()) onChange(rule);
              }}
            />
            <span>{labelOf(rule)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
