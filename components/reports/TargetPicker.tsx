"use client";

import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import {
  REPORT_TARGET_LABELS,
  REPORT_TARGET_SEARCH_MIN_LENGTH,
  type ReportTargetOption,
  type ReportTargetType,
} from "@/lib/shared/content-reports";
import styles from "./ReportProblem.module.css";

/** Temporisation de la recherche : une requête par pause de frappe, pas par touche. */
const SEARCH_DEBOUNCE_MS = 250;

const PLACEHOLDERS: Record<ReportTargetType, string> = {
  USER: "Pseudo d'un joueur…",
  TEAM: "Nom ou sigle d'une équipe…",
  TOURNAMENT: "Nom d'un tournoi…",
};

interface TargetPickerProps {
  type: ReportTargetType;
  selected: ReportTargetOption[];
  onChange: (next: ReportTargetOption[]) => void;
  /** Plus aucune place : le champ de recherche se désactive. */
  full: boolean;
}

/** Vignette d'une cible : son image publiée, ou son initiale. */
export function TargetThumb({ option }: { option: Pick<ReportTargetOption, "label" | "imageUrl"> }) {
  if (option.imageUrl) {
    // Une image du site (garantie par le serveur, `localUploadUrl`), décorative :
    // le nom est écrit juste à côté.
    return <Image src={option.imageUrl} alt="" className={styles.chipThumb} width={22} height={22} />;
  }
  return (
    <span className={styles.chipThumb} aria-hidden="true">
      {Array.from(option.label.trim())[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

/**
 * Désigner des joueurs, des équipes ou des tournois dans un signalement.
 *
 * Motif `combobox` de l'ARIA, comme `PlayerPseudoCombobox` : les flèches
 * parcourent les propositions, Entrée ajoute, Échap referme la liste (et
 * seulement elle — `useDialogBehavior` laisse passer Échap tant qu'une liste est
 * ouverte). La recherche est faite par le serveur, sur l'annuaire entier : le
 * formulaire vit sur toutes les pages, il ne télécharge rien d'avance.
 */
export function TargetPicker({ type, selected, onChange, full }: TargetPickerProps) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ReportTargetOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searched, setSearched] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < REPORT_TARGET_SEARCH_MIN_LENGTH) {
      setOptions([]);
      setSearched(false);
      return;
    }
    // Seule la dernière réponse compte : une frappe rapide lance plusieurs
    // recherches, et une réponse lente ne doit pas écraser une plus récente.
    const ticket = ++requestRef.current;
    const timer = setTimeout(() => {
      fetch(`/api/reports/targets?type=${type}&q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then(async (response) => (response.ok ? ((await response.json()) as { options: ReportTargetOption[] }).options : []))
        .catch(() => [])
        .then((found) => {
          if (ticket !== requestRef.current) return;
          setOptions(found);
          setSearched(true);
          setActive(-1);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, type]);

  const selectedKeys = new Set(selected.map((option) => option.id));
  const proposals = options.filter((option) => !selectedKeys.has(option.id));
  const showList = open && query.trim().length >= REPORT_TARGET_SEARCH_MIN_LENGTH && searched;
  const optionId = (index: number) => `${listId}-option-${index}`;

  const add = (option: ReportTargetOption) => {
    onChange([...selected, option]);
    setQuery("");
    setOptions([]);
    setSearched(false);
    setActive(-1);
  };

  const remove = (id: number) => onChange(selected.filter((option) => option.id !== id));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (proposals.length === 0 ? -1 : (index + 1) % proposals.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (proposals.length === 0 ? -1 : (index - 1 + proposals.length) % proposals.length));
    } else if (event.key === "Enter") {
      // Entrée ne soumet jamais le formulaire depuis ce champ : elle ajoute la
      // proposition surlignée, ou ne fait rien.
      event.preventDefault();
      if (showList && active >= 0 && proposals[active]) add(proposals[active]);
    } else if (event.key === "Escape" && showList) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  const labels = REPORT_TARGET_LABELS[type];

  return (
    <div className={styles.picker}>
      <label htmlFor={inputId}>{labels.picker}</label>
      {selected.length > 0 && (
        <ul className={styles.chips} aria-label={`${labels.picker} (sélection)`}>
          {selected.map((option) => (
            <li key={option.id} className={styles.chip}>
              <TargetThumb option={option} />
              <span>{option.label}</span>
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() => remove(option.id)}
                aria-label={`Retirer ${option.label}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={`field ${styles.combobox}`}>
        <input
          id={inputId}
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          value={query}
          disabled={full}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={full ? "Nombre maximal d'éléments atteint" : PLACEHOLDERS[type]}
          autoComplete="off"
          spellCheck={false}
        />
        {showList && (
          <ul id={listId} role="listbox" aria-label={labels.picker} className={styles.suggestions}>
            {proposals.length === 0 ? (
              <li role="option" aria-selected={false} aria-disabled="true" className={styles.emptySuggestion}>
                Aucun résultat.
              </li>
            ) : (
              proposals.map((option, index) => (
                <li
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  className={styles.suggestion}
                  // `mousedown` et non `click` : le champ perd le focus avant le
                  // clic, et sa fermeture retirerait l'option sous le pointeur.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    add(option);
                  }}
                  onMouseEnter={() => setActive(index)}
                >
                  <TargetThumb option={option} />
                  <span>{option.label}</span>
                  {option.detail && <span className={styles.suggestionDetail}>{option.detail}</span>}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
