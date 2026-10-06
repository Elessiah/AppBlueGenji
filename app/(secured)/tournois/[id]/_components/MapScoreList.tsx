"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { NumberInput } from "@/components/ui/number-input";
import { FieldErrorText } from "@/components/ui/field-error-text";
import type { FieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { matchMaxMaps, type MatchFormat } from "@/lib/shared/match-format";
import {
  MAP_SCORE_MAX,
  REPLAY_CODE_MAX_LENGTH,
  deriveMatchScore,
  emptyMap,
  isMapTouched,
  mapFieldKey,
  mapListLimit,
  progressiveMapRows,
  replayCodeHint,
  type MapField,
  type MatchMapInput,
} from "@/lib/shared/match-maps";
import type { TournamentGame } from "@/lib/shared/types";
import { EntrantLogo } from "./EntrantName";
import styles from "./MapScoreList.module.css";

function keepEnterInList(event: KeyboardEvent<HTMLFieldSetElement>) {
  if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
}

interface MapScoreListProps {
  /** Préfixe des `id` de champs — deux modales ne partagent jamais les leurs. */
  idPrefix: string;
  maps: MatchMapInput[];
  onChange: (maps: MatchMapInput[]) => void;
  format: MatchFormat | null;
  game: TournamentGame | null;
  team1Name: string;
  team2Name: string;
  /** Engagés de chaque colonne — leur emblème distingue deux noms proches. */
  team1Id?: number | null;
  team2Id?: number | null;
  /**
   * Lignes minimales : 1 pour un engagé (une ligne vierge d'emblée), 0 pour
   * l'arbitrage (sans map, il pose le score à la main). Les suivantes viennent
   * d'elles-mêmes au fil du format (`progressiveMapRows`).
   */
  minRows?: 0 | 1;
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
  team1Id = null,
  team2Id = null,
  minRows = 0,
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
  // Le compteur ne compte que les maps renseignées, pas la ligne vierge ouverte.
  const played = maps.filter(isMapTouched).length;
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

  // Lignes progressives : la suivante apparaît quand la dernière est complète
  // et que le match n'est pas acquis ; les lignes vierges devenues inutiles
  // s'en vont, les lignes renseignées restent (refusées sur leur champ).
  const change = (next: MatchMapInput[]) => {
    const rows = progressiveMapRows(format, game, next, minRows);
    // Seule une ligne ajoutée **par l'affichage progressif** s'annonce : une
    // liste remplacée de l'extérieur (proposition reçue) arrive déjà remplie.
    autoGrown.current = rows.length > maps.length;
    onChange(rows);
  };

  // Ligne ajoutée d'elle-même : annoncée poliment, sans déplacer le focus de
  // celui qui tape (une ligne retirée ne s'annonce pas, elle était vierge).
  const [announcement, setAnnouncement] = useState("");
  const autoGrown = useRef(false);
  useEffect(() => {
    if (autoGrown.current && !focusNewRow.current) setAnnouncement(`Map ${maps.length} ajoutée : à renseigner.`);
    // Ligne retirée (un nul de passage pendant la frappe) : l'annonce se vide,
    // pour qu'une ligne qui revient soit annoncée de nouveau.
    else if (!autoGrown.current) setAnnouncement("");
    autoGrown.current = false;
  }, [maps.length]);

  const update = (index: number, patch: Partial<MatchMapInput>, field: MapField) => {
    // Rien de changé (un champ de score vide quitté sans saisie rend `NaN`, et
    // `NaN !== NaN`) : ni mise à jour, ni levée des refus.
    if (Object.is(maps[index]?.[field], patch[field])) return;
    // Tout refus se lève : un code en double, une map de trop ou un match
    // inachevé se corrigent souvent sur un **autre** champ que celui désigné.
    fieldErrors.clear();
    change(maps.map((map, i) => (i === index ? { ...map, ...patch } : map)));
  };
  // Le bouton « Retirer » activé disparaît avec sa ligne : le focus va au
  // « Retirer » de la ligne qui prend sa place (ou de la dernière), sinon à
  // « Ajouter une map » — jamais au `<body>`, hors de la modale (WCAG 2.4.3).
  const focusAfterRemove = useRef<number | null>(null);
  // Suit la liste elle-même, pas sa longueur : un retrait suivi d'une ligne
  // vierge rouverte garde la même longueur, et la cible armée ne doit pas
  // survivre pour voler le focus plus tard.
  useEffect(() => {
    const target = focusAfterRemove.current;
    if (target === null) return;
    focusAfterRemove.current = null;
    const index = Math.min(target, maps.length - 1);
    const id = maps.length > 0 ? `${idPrefix}-map-${index}-remove` : `${idPrefix}-map-add`;
    // Une ligne vierge n'a pas de « Retirer » : le focus va alors à son code.
    (document.getElementById(id) ?? document.getElementById(mapFieldId(idPrefix, index, "replayCode")))?.focus();
  }, [maps, idPrefix]);
  const remove = (index: number) => {
    fieldErrors.clear();
    keys.current = keys.current.filter((_, i) => i !== index);
    focusAfterRemove.current = index;
    change(maps.filter((_, i) => i !== index));
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
    // Ajouter une map répond souvent au refus d'une autre (match inachevé) : il se lève.
    fieldErrors.clear();
    keys.current = [...keys.current, newKey()];
    focusNewRow.current = true;
    onChange([...maps, emptyMap()]);
  };

  return (
    // `Entrée` dans un champ de map ne soumet pas le formulaire : corriger un
    // code puis valider d'un même geste trancherait le match sans relecture.
    <fieldset className={styles.list} disabled={disabled} onKeyDown={keepEnterInList}>
      <legend className={styles.legend}>
        Maps jouées{" "}
        <span className={styles.limit}>
          ({played}/{Math.max(shownLimit, played)})
        </span>
      </legend>
      <p id={hintId} className={styles.hint}>
        {replayCodeHint(game)} Une map nulle ne rapporte de point à personne.
        {replayHint}
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
                <span className={styles.mapLabel} aria-hidden="true">
                  Map {index + 1}
                </span>
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
                    // Saisie brute : majuscules par la CSS, normalisation à la
                    // validation et au serveur (`normalizeReplayCode`). Réécrire
                    // la valeur à chaque frappe renverrait le curseur en fin de
                    // champ au milieu d'une correction.
                    onChange={(event) => update(index, { replayCode: event.target.value }, "replayCode")}
                    {...fieldErrors.aria(codeKey, hintId)}
                  />
                  <FieldErrorText fieldId={codeId} message={fieldErrors.message(codeKey)} />
                </div>
                <div className={styles.score}>
                  <label className={styles.fieldLabel} htmlFor={t1Id} title={team1Name}>
                    {team1Id !== null && <EntrantLogo teamId={team1Id} name={team1Name} size={16} />}
                    <span className={styles.fieldLabelText}>
                      <span className="sr-only">Map {index + 1}, score de </span>
                      {team1Name}
                    </span>
                  </label>
                  <NumberInput
                    id={t1Id}
                    className={styles.scoreInput}
                    min={0}
                    max={MAP_SCORE_MAX}
                    inputMode="numeric"
                    value={map.team1Score}
                    onValueChange={(value) => update(index, { team1Score: value }, "team1Score")}
                    // Un champ vidé pour être ressaisi n'émet pas de valeur :
                    // le refus qui le désigne se retire dès la frappe.
                    onEdit={() => fieldErrors.clear(t1Key)}
                    {...fieldErrors.aria(t1Key)}
                  />
                  <FieldErrorText fieldId={t1Id} message={fieldErrors.message(t1Key)} />
                </div>
                <div className={styles.score}>
                  <label className={styles.fieldLabel} htmlFor={t2Id} title={team2Name}>
                    {team2Id !== null && <EntrantLogo teamId={team2Id} name={team2Name} size={16} />}
                    <span className={styles.fieldLabelText}>
                      <span className="sr-only">Map {index + 1}, score de </span>
                      {team2Name}
                    </span>
                  </label>
                  <NumberInput
                    id={t2Id}
                    className={styles.scoreInput}
                    min={0}
                    max={MAP_SCORE_MAX}
                    inputMode="numeric"
                    value={map.team2Score}
                    onValueChange={(value) => update(index, { team2Score: value }, "team2Score")}
                    // Un champ vidé pour être ressaisi n'émet pas de valeur :
                    // le refus qui le désigne se retire dès la frappe.
                    onEdit={() => fieldErrors.clear(t2Key)}
                    {...fieldErrors.aria(t2Key)}
                  />
                  <FieldErrorText fieldId={t2Id} message={fieldErrors.message(t2Key)} />
                </div>
                {/* Rien à retirer d'une ligne vierge (elle reviendrait aussitôt) ;
                    l'arbitrage garde le retrait de sa ligne unique, pour revenir
                    au score à la main. */}
                {(isMapTouched(map) || (minRows === 0 && maps.length === 1)) && (
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
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Sans ligne (arbitrage, score à la main) : la première s'ajoute ici ;
          les suivantes viennent d'elles-mêmes. */}
      {maps.length === 0 && (
        <button id={`${idPrefix}-map-add`} type="button" className={styles.add} onClick={add}>
          <Plus size={16} aria-hidden="true" /> Ajouter une map
        </button>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {/* Région d'état : le score dérivé change à chaque frappe. Rien sans map —
          un « 0 – 0 » contredirait le score posé à la main au-dessus. */}
      {played > 0 && (
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
