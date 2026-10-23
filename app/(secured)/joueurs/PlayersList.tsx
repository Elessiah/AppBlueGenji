"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PublicUserProfile, PlayerRole } from "@/lib/shared/types";
import { isFreeAgent } from "@/lib/shared/player-roster-status";
import { useToast } from "@/components/ui/toast";
import { Ticker } from "@/components/cyber/Ticker";
import { BgCanvas } from "../_shared/BgCanvas";
import { AnnuaireSearchField } from "../_shared/AnnuaireSearchField";
import { DirectoryShowMore } from "../_shared/DirectoryShowMore";
import { useProgressiveList } from "@/lib/shared/hooks/useProgressiveList";
import { UserX } from "lucide-react";
import { PlayerCard } from "./cards/PlayerCard";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { richNodes } from "@/components/i18n/shell-text";
import { usePlayersText } from "@/components/i18n/players-text";
import { compareLocalText } from "@/lib/shared/dates";
import { playerErrorMessage } from "./_lib/player-errors";
import s from "../_shared/annuaire.module.css";

const ACCENT_RGB = "90, 200, 255";

type RoleFilter = "all" | "DPS" | "TANK" | "HEAL" | "COACH";
type StatusFilter = "all" | "free" | "unaffiliated";
type SortKey = "pseudo" | "tournaments" | "created";

export default function PlayersList() {
  const { showError } = useToast();
  const text = usePlayersText();
  const { t } = text;
  // Bandeau mémoïsé (`Ticker`) : ses libellés gardent leur référence d'une
  // frappe à l'autre — le texte ne change qu'avec la langue.
  const tickerItems = useMemo(() => [t("ticker.directory"), t("ticker.roster"), t("ticker.tournaments")], [t]);
  const tickerLabels = useMemo(
    () => ({
      label: t("ticker.label"),
      resume: t("ticker.resume"),
      pause: t("ticker.pause"),
      resumeShort: t("ticker.resumeShort"),
      pauseShort: t("ticker.pauseShort"),
    }),
    [t],
  );
  const [players, setPlayers] = useState<PublicUserProfile[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("pseudo");
  // Les comptes anonymisés sortent de l'annuaire **par défaut** : sous leur
  // pseudo d'emprunt, ils ne sont plus personne, et la ligne n'existe que pour
  // qui remonte un ancien match. Masqués par défaut, donc, mais jamais retirés
  // — c'est le seul moyen de retrouver un adversaire d'un tournoi passé.
  const [showDeleted, setShowDeleted] = useState(false);

  // Le texte par une référence : l'annuaire ne se relit jamais sur un simple
  // changement de texte (revue de performance du lot 9-2).
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    fetch("/api/players", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: string; players?: PublicUserProfile[] };
        if (!response.ok || !payload.players) {
          throw new Error(payload.error || "PLAYERS_LOAD_FAILED");
        }
        setPlayers(payload.players);
      })
      .catch((e) => showError(playerErrorMessage(textRef.current, (e as Error).message, "PLAYERS_LOAD_FAILED")));
  }, [showError]);

  // L'annuaire, comptes supprimés compris ou non : tout ce que la page montre
  // ou compte en descend, sinon la case à cocher changerait la liste sans
  // changer les compteurs qui la surmontent.
  const listed = useMemo(
    () => (showDeleted ? players : players.filter((p) => !p.isDeleted)),
    [players, showDeleted],
  );

  // La recherche filtre sur une valeur **différée** : la frappe met le champ à
  // jour tout de suite, le refiltrage de la grille suit sans la bloquer.
  const deferredQuery = useDeferredValue(query);
  // Clé de recherche de chaque joueur : calculée à la première recherche qui le
  // lit, puis gardée pour l'annuaire chargé — rien sans recherche, rien à
  // chaque frappe ni au cochage des comptes supprimés (revue de performance du lot 9-2).
  // Table faible pour la vie de l'écran : une liste rechargée apporte des entrées neuves.
  const [searchKeys] = useState(() => new WeakMap<(typeof players)[number], string>());
  const searchKeyOf = useCallback((p: (typeof players)[number]): string => {
    let key = searchKeys.get(p);
    if (key === undefined) {
      key = `${p.pseudo} ${p.team?.name || ""}`.toLowerCase();
      searchKeys.set(p, key);
    }
    return key;
  }, [searchKeys]);
  // Trié une fois par liste et par ordre choisi ; la recherche ne fait ensuite
  // qu'un filtre, qui garde l'ordre (revue de performance du lot 9-2).
  const sorted = useMemo(() => {
    const r = [...listed];
    if (sort === "pseudo") {
      const compare = compareLocalText(text.locale);
      r.sort((a, b) => compare(a.pseudo, b.pseudo));
    }
    if (sort === "tournaments") r.sort((a, b) => (b.tournamentsCount || 0) - (a.tournamentsCount || 0));
    // Les plus récents d'abord.
    if (sort === "created") r.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return r;
  }, [listed, sort, text.locale]);
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return sorted.filter((p) => {
      if (q && !searchKeyOf(p).includes(q)) return false;
      if (roleFilter !== "all" && !(p.roles || []).includes(roleFilter as PlayerRole)) return false;
      // Free agent = sans roster ET ouvert au recrutement : un joueur qui a
      // décoché « ouvert aux propositions » ne veut pas être démarché.
      if (statusFilter === "free" && !isFreeAgent(p)) return false;
      // Sans équipe, qu'il soit ouvert aux propositions ou non.
      if (statusFilter === "unaffiliated" && p.team) return false;
      return true;
    });
  }, [searchKeyOf, sorted, deferredQuery, roleFilter, statusFilter]);

  // Rendu borné à une page de cartes ; tout filtre modifié repart de la première.
  const gridRef = useRef<HTMLDivElement>(null);
  const page = useProgressiveList(
    filtered,
    JSON.stringify([deferredQuery.trim().toLowerCase(), roleFilter, statusFilter, sort, showDeleted]),
  );

  // Le prédicat partagé (#139) posé sur la liste **affichée** (#142) : les deux
  // conditions du compteur venaient de branches différentes et aucune ne
  // remplace l'autre — « free agent » se lit toujours sur l'ouverture au
  // recrutement, et un compteur qui ne suivrait pas la case « comptes
  // supprimés » contredirait la liste qu'il surmonte.
  // Comptés une fois par liste, pas à chaque frappe dans la recherche (revue de performance du lot 9-2).
  const { freeAgents, owCount, mrCount } = useMemo(
    () => ({
      freeAgents: listed.filter(isFreeAgent).length,
      owCount: listed.filter((p) => (p.games || []).includes("OW")).length,
      mrCount: listed.filter((p) => (p.games || []).includes("MR")).length,
    }),
    [listed],
  );
  // Celui-ci se compte sur **tout** l'annuaire : c'est l'étiquette de la case,
  // et elle doit dire combien de comptes elle ferait apparaître.
  const deletedCount = useMemo(() => players.filter((p) => p.isDeleted).length, [players]);

  const accentStyle = {
    "--g-rgb": ACCENT_RGB,
    "--g-300": "#8fd5ff",
    "--g-500": "#5ac8ff",
  } as React.CSSProperties;

  return (
    <div style={accentStyle}>
      <BgCanvas rgb={ACCENT_RGB} />

      <header className={s.page}>
        <div className="fabric" />
        <div className={`container ${s.pageInner}`}>
          <div className={s.pageHead}>
            <div>
              <span className="eyebrow">{t("list.eyebrow")}</span>
              <h1 className={s.title}>{richNodes(text.rich("list.title", {}, { em: (chunks) => <em>{chunks}</em> }))}</h1>
              <div className={s.subtitle}>{t("list.subtitle")}</div>
            </div>
            <LocaleLink href="/profil" className={s.cta}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 14a6 6 0 0 1 12 0"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              {t("list.myProfile")}
            </LocaleLink>
          </div>

          <div className={s.metrics}>
            <div className={s.metric}>
              <div className={s.metricNum}>
                <em>{listed.length}</em>
              </div>
              <div className={s.metricLbl}>{t("list.metrics.profiles")}</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{freeAgents}</div>
              <div className={s.metricLbl}>{t("list.metrics.freeAgents")}</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{owCount}</div>
              <div className={s.metricLbl}>{t("list.metrics.overwatch")}</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{mrCount}</div>
              <div className={s.metricLbl}>{t("list.metrics.marvelRivals")}</div>
            </div>
          </div>

          <div className={s.toolbar}>
            <AnnuaireSearchField
              label={t("list.searchLabel")}
              placeholder={t("list.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={s.filters}>
              {(
                [
                  "all",
                  "DPS",
                  "TANK",
                  "HEAL",
                  "COACH",
                ] as const
              ).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`${s.chip} ${roleFilter === k ? s.chipOn : ""}`}
                  aria-pressed={roleFilter === k}
                  onClick={() => setRoleFilter(k)}
                >
                  {t(`list.roleFilter.${k}`)}
                </button>
              ))}
            </div>
          </div>

          <div className={s.sortRow}>
            <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
              <span>{t("list.count", { count: filtered.length })}</span>
              <span style={{ color: "var(--ink-faint)" }}>·</span>
              <div style={{ display: "flex", gap: 12 }}>
                {(
                  ["all", "free", "unaffiliated"] as const
                ).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setStatusFilter(k)}
                    className={`${s.sortBtn} ${statusFilter === k ? s.sortBtnOn : ""}`}
                    aria-pressed={statusFilter === k}
                  >
                    {t(`list.statusFilter.${k}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className={s.sortOpts}>
              <span style={{ color: "var(--ink-dim)" }}>{t("list.sortBy")}</span>
              {(["pseudo", "tournaments", "created"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`${s.sortBtn} ${sort === k ? s.sortBtnOn : ""}`}
                  aria-pressed={sort === k}
                  onClick={() => setSort(k)}
                >
                  {t(`list.sort.${k}`)}
                </button>
              ))}
              {/* Volontairement effacé : un bouton libellé « Comptes
                  supprimés (N) » en tête d'annuaire invitait à y cliquer, et
                  emmenait le lecteur loin des joueurs qu'il cherchait. Une
                  icône seule, en retrait, au bout de la rangée — son nom
                  accessible et son infobulle disent ce qu'elle fait. */}
              {deletedCount > 0 && (
                <button
                  type="button"
                  className={`${s.deletedToggle} ${showDeleted ? s.deletedToggleOn : ""}`}
                  // Un nom **constant**, l'état porté par `aria-pressed` : une
                  // infobulle qui passerait à « Masquer » contredirait le nom
                  // accessible, et les deux publics liraient deux actions.
                  aria-pressed={showDeleted}
                  aria-label={t("list.showDeleted", { count: deletedCount })}
                  title={t("list.showDeleted", { count: deletedCount })}
                  onClick={() => setShowDeleted((shown) => !shown)}
                >
                  <UserX size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <Ticker items={tickerItems} labels={tickerLabels} />

      <section className={`container ${s.sections}`}>
        <div className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionIx}>01</span>
            <span className={s.sectionTtl}>
              {t("list.sectionTitle")} <span className={s.sectionAccent}>{t("list.sectionAccent")}</span>
            </span>
            <span className={s.sectionCount}>{t("list.sectionCount", { count: filtered.length })}</span>
          </div>

          <div style={{ paddingTop: 24 }}>
            <div className={s.plGrid} ref={gridRef}>
              {page.visible.map((p) => (
                <PlayerCard key={p.id} player={p} />
              ))}
            </div>
            <DirectoryShowMore
              hidden={page.hidden}
              shown={page.visible.length}
              noun={t("list.showMoreNoun")}
              label={(step, hidden) => t("list.showMore", { step, hidden })}
              gridRef={gridRef}
              onShowMore={page.showMore}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
