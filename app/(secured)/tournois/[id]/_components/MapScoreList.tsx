"use client";

import { useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { NumberInput } from "@/components/ui/number-input";
import { FieldErrorText } from "@/components/ui/field-error-text";
import type { FieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { matchMaxMaps, type MatchFormat } from "@/lib/shared/match-format";
import {
  MAP_SCORE_MAX,
  REPLAY_CODE_MAX_LENGTH,
  canAddMap,
  deriveMatchScore,
  emptyMap,
  mapFieldKey,
  mapListLimit,
  replayCodeHint,
  type MapField,
  type MatchMapInput,
} from "@/lib/shared/match-maps";
import type { TournamentGame } from "@/lib/shared/types";
import styles from "./MapScoreList.module.css";

interface MapScoreListProps {
  /** Préfixe des `id` de champs — deux modales ne partagent jamais les leurs. */
  idPrefix: string;
  maps: MatchMapInput[];
  onChange: (maps: MatchMapInput[]) => void;
  format: MatchFormat | null;
  game: TournamentGame | null;
  team1Name: string;
  team2Name: string;
  disabled: boolean;
  fieldErrors: FieldErrors<string>;
}

/** `id` du contrôle d'un champ de la liste. */
export function mapFieldId(idPrefix: string, index: number, field: MapField): string {
  return `${idPrefix}-map-${index}-${field}`;
}

/** Table clé de champ → `id`, pour `useFieldErrors`. */
export function mapFieldIds(idPrefix: string, count: number): Record<string, string> {
  const ids: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    for (const field of ["replayCode", "team1Score", "team2Score"] as MapField[]) {
      ids[mapFieldKey(index, field)] = mapFieldId(idPrefix, index, field);
    }
  }
  return ids;
}

/**
 * Saisie **map par map** d'un match (`docs/features/MAP_SCORES.md`) : une ligne
 * par map jouée — code de replay et score de chaque camp —, ajoutées une à une
 * jusqu'au plafond du format. Le score du match, dérivé (map gagnée = un point,
 * map nulle = rien), se lit en direct sous la liste ; c'est lui qui part dans le
 * circuit de report habituel.
 */
export function MapScoreList({
  idPrefix,
  maps,
  onChange,
  format,
  game,
  team1Name,
  team2Name,
  disabled,
  fieldErrors,
}: Readonly<MapScoreListProps>) {
  const limit = mapListLimit(format);
  // Le compteur annonce le format (BO3 → 3 maps) ; les maps nulles rejouées
  // au-delà (`DRAWN_MAP_REPLAY_ALLOWANCE`) le font avancer quand elles servent.
  const shownLimit = format ? matchMaxMaps(format) : limit;
  const replayHint =
    format && limit > shownLimit ? ` Une map nulle peut être rejouée (${limit - shownLimit} au plus).` : "";
  const score = deriveMatchScore(maps);
  const hintId = `${idPrefix}-map-hint`;

  // Clés de ligne stables : retirer la map 2 ne doit pas faire hériter la
  // ligne suivante de l'état React (focus, saisie en cours) de celle retirée.
  // Réalignées sur la longueur quand la liste est remplacée de l'extérieur
  // (proposition reçue par le flux, réouverture).
  const nextKey = useRef(0);
  const keys = useRef<number[]>([]);
  const newKey = () => {
    nextKey.current += 1;
    return nextKey.current;
  };
  if (keys.current.length !== maps.length) {
    keys.current = maps.map((_, i) => keys.current[i] ?? newKey());
  }

  const update = (index: number, patch: Partial<MatchMapInput>, field: MapField) => {
    // Rien de changé (un champ de score vide quitté sans saisie rend `NaN`, et
    // `NaN !== NaN`) : ni mise à jour, ni levée du refus rattaché au champ.
    if (Object.is(maps[index]?.[field], patch[field])) return;
    fieldErrors.clear(mapFieldKey(index, field));
    onChange(maps.map((map, i) => (i === index ? { ...map, ...patch } : map)));
  };
  // Le bouton « Retirer » activé disparaît avec sa ligne : le focus va au
  // « Retirer » de la ligne qui prend sa place (ou de la dernière), sinon à
  // « Ajouter une map » — jamais au `<body>`, hors de la modale (WCAG 2.4.3).
  const focusAfterRemove = useRef<number | null>(null);
  useEffect(() => {
    const target = focusAfterRemove.current;
    if (target === null) return;
    focusAfterRemove.current = null;
    const id = maps.length > 0 ? `${idPrefix}-map-${Math.min(target, maps.length - 1)}-remove` : `${idPrefix}-map-add`;
    document.getElementById(id)?.focus();
  }, [maps.length, idPrefix]);
  const remove = (index: number) => {
    fieldErrors.clear();
    keys.current = keys.current.filter((_, i) => i !== index);
    focusAfterRemove.current = index;
    onChange(maps.filter((_, i) => i !== index));
  };
  // Après un ajout, le focus va au code de la nouvelle ligne : c'est la suite
  // de la saisie, et le bouton « Ajouter » peut se désactiver sous le focus
  // (plafond atteint), ce qui le renverrait au `<body>`.
  const focusNewRow = useRef(false);
  useEffect(() => {
    if (!focusNewRow.current) return;
    focusNewRow.current = false;
    if (maps.length > 0) document.getElementById(mapFieldId(idPrefix, maps.length - 1, "replayCode"))?.focus();
  }, [maps.length, idPrefix]);
  const add = () => {
    keys.current = [...keys.current, newKey()];
    focusNewRow.current = true;
    onChange([...maps, emptyMap()]);
  };

  return (
    <fieldset className={styles.list} disabled={disabled}>
      <legend className={styles.legend}>
        Maps jouées <span className={styles.limit}>({maps.length}/{Math.max(shownLimit, maps.length)})</span>
      </legend>
      <p id={hintId} className={styles.hint}>
        {replayCodeHint(game)} Une map nulle ne rapporte de point à personne.{replayHint}
      </p>

      {maps.length > 0 && (
        <ol className={styles.rows}>
          {maps.map((map, index) => {
            const codeKey = mapFieldKey(index, "replayCode");
            const t1Key = mapFieldKey(index, "team1Score");
            const t2Key = mapFieldKey(index, "team2Score");
            const codeId = mapFieldId(idPrefix, index, "replayCode");
            const t1Id = mapFieldId(idPrefix, index, "team1Score");
            const t2Id = mapFieldId(idPrefix, index, "team2Score");
            return (
              <li key={keys.current[index]} className={styles.row}>
                <span className={styles.mapLabel} aria-hidden="true">Map {index + 1}</span>
                {/* Chaque nom de champ porte le numéro de map (masqué à l'œil) : sur
                    cinq lignes, « Code de replay » seul ne dirait pas laquelle. La
                    phrase d'erreur reste hors du `<label>`, sans quoi elle entrerait
                    dans le nom du champ et serait lue deux fois. */}
                <div className={styles.code}>
                  <label className={styles.fieldLabel} htmlFor={codeId}>
                    <span className="sr-only">Map {index + 1}, </span>Code de replay
                  </label>
                  <input
                    id={codeId}
                    className={styles.codeInput}
                    type="text"
                    value={map.replayCode}
                    maxLength={REPLAY_CODE_MAX_LENGTH}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    onChange={(event) => update(index, { replayCode: event.target.value.toUpperCase() }, "replayCode")}
                    {...fieldErrors.aria(codeKey, hintId)}
                  />
                  <FieldErrorText fieldId={codeId} message={fieldErrors.message(codeKey)} />
                </div>
                <div className={styles.score}>
                  <label className={styles.fieldLabel} htmlFor={t1Id} title={team1Name}>
                    <span className="sr-only">Map {index + 1}, score de </span>{team1Name}
                  </label>
                  <NumberInput
                    id={t1Id}
                    className={styles.scoreInput}
                    min={0}
                    max={MAP_SCORE_MAX}
                    value={map.team1Score}
                    onValueChange={(value) => update(index, { team1Score: value }, "team1Score")}
                    {...fieldErrors.aria(t1Key)}
                  />
                  <FieldErrorText fieldId={t1Id} message={fieldErrors.message(t1Key)} />
                </div>
                <div className={styles.score}>
                  <label className={styles.fieldLabel} htmlFor={t2Id} title={team2Name}>
                    <span className="sr-only">Map {index + 1}, score de </span>{team2Name}
                  </label>
                  <NumberInput
                    id={t2Id}
                    className={styles.scoreInput}
                    min={0}
                    max={MAP_SCORE_MAX}
                    value={map.team2Score}
                    onValueChange={(value) => update(index, { team2Score: value }, "team2Score")}
                    {...fieldErrors.aria(t2Key)}
                  />
                  <FieldErrorText fieldId={t2Id} message={fieldErrors.message(t2Key)} />
                </div>
                <button
                  id={`${idPrefix}-map-${index}-remove`}
                  type="button"
                  className={styles.remove}
                  onClick={() => remove(index)}
                  aria-label={`Retirer la map ${index + 1}`}
                  title={`Retirer la map ${index + 1}`}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <button
        id={`${idPrefix}-map-add`}
        type="button"
        className={styles.add}
        onClick={add}
        disabled={!canAddMap(format, maps)}
      >
        <Plus size={16} aria-hidden="true" /> Ajouter une map
      </button>

      {/* Région d'état : le score dérivé change à chaque frappe. Rien sans map —
          un « 0 – 0 » contredirait le score posé à la main au-dessus. */}
      {maps.length > 0 && (
        <output className={styles.summary}>
          <span className={styles.summaryLabel}>Score du match</span>
          <span className={styles.summaryScore}>
            {team1Name} {score.team1} – {score.team2} {team2Name}
          </span>
        </output>
      )}
    </fieldset>
  );
}
