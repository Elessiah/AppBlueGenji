"use client";

import { KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import type { PublicUserProfile } from "@/lib/shared/types";
import { UserAvatar } from "@/components/user-avatar";
import styles from "../team.module.css";

/** Nombre de suggestions affichées : au-delà, mieux vaut préciser la saisie. */
const MAX_SUGGESTIONS = 8;

/**
 * Durée pendant laquelle l'annuaire chargé resert aux montages suivants. La
 * liste ne sert qu'à suggérer — le serveur reste juge (`USER_ALREADY_IN_TEAM`) —,
 * si bien qu'une minute de retard ne coûte rien, là où chaque ouverture de la
 * modale d'attribution retéléchargeait tout l'annuaire.
 */
const PLAYERS_TTL_MS = 60_000;
let playersCache: { at: number; request: Promise<PublicUserProfile[]> } | null = null;

function loadPlayers(): Promise<PublicUserProfile[]> {
  const now = Date.now();
  if (playersCache && now - playersCache.at < PLAYERS_TTL_MS) return playersCache.request;
  const request = fetch("/api/players", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      return ((await res.json()) as { players: PublicUserProfile[] }).players;
    })
    .catch((error: unknown) => {
      // Un échec n'est pas retenu : le montage suivant retentera.
      playersCache = null;
      throw error;
    });
  playersCache = { at: now, request };
  return request;
}

interface PlayerPseudoComboboxProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  describedBy?: string;
  /** Joueurs à ne pas proposer (déjà invités, par exemple). */
  excludeUserIds?: readonly number[];
}

/**
 * Pseudo d'un joueur **sans équipe**, avec suggestions.
 *
 * Sert aux deux endroits de la fiche où l'on désigne un joueur par son pseudo :
 * l'invitation (gestion de l'équipe) et l'attribution d'une fantôme (staff) —
 * la seconde demandait un « pseudo exact » tapé à l'aveugle.
 *
 * Motif `combobox` de l'ARIA : les flèches parcourent la liste, Entrée choisit,
 * Échap la referme. La liste n'était atteignable qu'à la souris.
 *
 * Les joueurs ne sont chargés qu'au montage du champ, donc seulement pour qui
 * peut s'en servir : la page les téléchargeait pour **tout** visiteur, l'annuaire
 * entier à chaque fiche ouverte, pour un formulaire qu'il ne voyait pas.
 */
export function PlayerPseudoCombobox({
  id,
  value,
  onChange,
  placeholder,
  autoFocus,
  describedBy,
  excludeUserIds = [],
}: PlayerPseudoComboboxProps) {
  const listId = useId();
  const [players, setPlayers] = useState<PublicUserProfile[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    loadPlayers()
      .then((list) => {
        if (!cancelled) setPlayers(list);
      })
      .catch(() => {
        // Sans suggestions, le champ reste une saisie libre : rien à signaler.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Un compte supprimé garde sa ligne et donc son pseudo
  // (`compte_supprime_412`) : sans ce filtre, l'annuaire des joueurs le cachait
  // mais l'autocomplétion le proposait encore. Le serveur le refuse
  // (`getUserIdByPseudo` ignore les lignes mortes) — la liste ne doit pas
  // proposer un nom qui mène à un refus. Même raisonnement pour un joueur qui a
  // déjà une équipe : le serveur répondrait `USER_ALREADY_IN_TEAM`.
  const excludeKey = excludeUserIds.join(",");
  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    const excluded = new Set(excludeKey ? excludeKey.split(",").map(Number) : []);
    return players
      .filter(
        (p) =>
          !p.isDeleted && p.team == null && !excluded.has(p.id) && p.pseudo.toLowerCase().includes(q),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [players, value, excludeKey]);

  const expanded = open && suggestions.length > 0;
  const optionId = (index: number) => `${listId}-option-${index}`;

  const choose = (player: PublicUserProfile) => {
    onChange(player.pseudo);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (suggestions.length === 0 ? -1 : (index + 1) % suggestions.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((index) =>
        suggestions.length === 0 ? -1 : (index - 1 + suggestions.length) % suggestions.length,
      );
    } else if (event.key === "Enter" && expanded && active >= 0 && suggestions[active]) {
      // Entrée choisit la suggestion surlignée au lieu de soumettre le formulaire.
      event.preventDefault();
      choose(suggestions[active]);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className={styles.combobox}>
      <input
        id={id}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
      />
      {expanded ? (
        <ul id={listId} role="listbox" aria-label="Joueurs sans équipe" className={styles.suggestions}>
          {suggestions.map((player, index) => (
            <li
              key={player.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className={styles.suggestion}
              // `mousedown` et non `click` : le champ perd le focus avant le
              // clic, et sa fermeture retirerait l'option sous le pointeur.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(player);
              }}
              onMouseEnter={() => setActive(index)}
            >
              <UserAvatar
                src={player.avatarUrl}
                pseudo={player.pseudo}
                size={24}
                borderWidth={1}
                borderColor="rgba(255,157,46,0.3)"
                decorative
              />
              <span>{player.pseudo}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
