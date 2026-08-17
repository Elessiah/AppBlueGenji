"use client";

import { CSSProperties, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { localDateTimeInput } from "@/lib/shared/dates";
import type { TournamentFormat, TournamentGame } from "@/lib/shared/types";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import { validatePhases } from "@/lib/shared/tournament-phases";
import { can, type PlatformRole } from "@/lib/shared/permissions";
import { useToast } from "@/components/ui/toast";
import { CyberCard, CyberButton } from "@/components/cyber";
import { PhaseBuilder } from "./PhaseBuilder";
import { createDefaultPhase, phaseErrorMessage } from "./phase-form";

// Rythme vertical du formulaire : sections séparées par un filet, même gouttière
// de grille partout, textes d'aide sur les tokens « cyber ».
const SECTION_STACK: CSSProperties = { display: "flex", flexDirection: "column", gap: 28 };
const SECTION_SEPARATOR: CSSProperties = {
  paddingTop: 28,
  borderTop: "1px solid var(--line-soft)",
};
const EYEBROW: CSSProperties = { margin: "0 0 16px" };
const GRID: CSSProperties = { gap: 16 };
const FULL_WIDTH: CSSProperties = { gridColumn: "1 / -1" };
const HINT: CSSProperties = {
  margin: "2px 0 0",
  fontSize: 12.5,
  color: "var(--ink-mute)",
  lineHeight: 1.5,
};

export default function CreateTournamentPage() {
  const router = useRouter();
  const { showError } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [game, setGame] = useState<TournamentGame>("OW2");
  const [format, setFormat] = useState<TournamentFormat>("SINGLE");
  const [hasThirdPlaceMatch, setHasThirdPlaceMatch] = useState(false);
  const [survivalRoundsPerCut, setSurvivalRoundsPerCut] = useState(3);
  const [survivalRoundsBeforeFirstCut, setSurvivalRoundsBeforeFirstCut] = useState(3);
  const [maxTeams, setMaxTeams] = useState(16);
  const [phases, setPhases] = useState<PhaseConfig[]>([
    createDefaultPhase(1, "SWISS"),
    createDefaultPhase(2, "DOUBLE"),
  ]);
  const [startVisibilityAt, setStartVisibilityAt] = useState(localDateTimeInput(1));
  const [registrationOpenAt, setRegistrationOpenAt] = useState(localDateTimeInput(3));
  const [registrationCloseAt, setRegistrationCloseAt] = useState(localDateTimeInput(24));
  const [startAt, setStartAt] = useState(localDateTimeInput(30));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (r) =>
        r.ok ? ((await r.json()) as { user?: { isAdmin?: boolean; roles?: PlatformRole[] } }) : null,
      )
      .then((p) => {
        if (!can(p?.user, "tournaments")) {
          showError("Création de tournoi réservée aux arbitres et administrateurs.");
          router.replace("/tournois");
        }
      })
      .catch(() => undefined);
  }, [router, showError]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      // Validate phases for MULTI format
      if (format === "MULTI") {
        const error = validatePhases(phases);
        if (error) {
          showError(phaseErrorMessage(error));
          setLoading(false);
          return;
        }
      }

      const response = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          game,
          format,
          maxTeams,
          startVisibilityAt: new Date(startVisibilityAt).toISOString(),
          registrationOpenAt: new Date(registrationOpenAt).toISOString(),
          registrationCloseAt: new Date(registrationCloseAt).toISOString(),
          startAt: new Date(startAt).toISOString(),
          hasThirdPlaceMatch: format === "SINGLE" ? hasThirdPlaceMatch : false,
          survivalRoundsPerCut: format === "SURVIVAL" ? survivalRoundsPerCut : undefined,
          survivalRoundsBeforeFirstCut:
            format === "SURVIVAL" ? survivalRoundsBeforeFirstCut : undefined,
          phases: format === "MULTI" ? phases : undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string; id?: number };
      if (!response.ok || !payload.id) throw new Error(payload.error || "TOURNAMENT_CREATE_FAILED");
      router.push(`/tournois/${payload.id}`);
      router.refresh();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Link href="/" className="cta-float-home home">
        ⌂ Accueil
      </Link>
      <section className="fade-in container">
        <div style={{ marginBottom: 28 }}>
          <Link
            href="/tournois"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "var(--ink-mute)",
            }}
          >
            ← Tournois
          </Link>
          <h1
            className="display"
            style={{ fontSize: "clamp(30px, 6vw, 48px)", margin: "12px 0 8px", lineHeight: 1.1 }}
          >
            Créer un tournoi
          </h1>
          <p style={{ color: "var(--ink-mute)", margin: 0, fontSize: 14 }}>
            Définis les phases temporelles, le jeu et le format de bracket.
          </p>
        </div>

        <CyberCard ticks style={{ padding: "clamp(20px, 3vw, 32px)" }}>
          <form onSubmit={onSubmit} style={SECTION_STACK}>
            <section>
              <p className="eyebrow" style={EYEBROW}>
                Identité
              </p>
              <div className="form-grid" style={GRID}>
                <div className="field">
                  <label htmlFor="tournament-name">Nom du tournoi</label>
                  <input
                    id="tournament-name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Mon tournoi"
                  />
                </div>
                <div className="field">
                  <label htmlFor="tournament-game">Jeu</label>
                  <select
                    id="tournament-game"
                    value={game}
                    onChange={(e) => setGame(e.target.value as TournamentGame)}
                  >
                    <option value="OW2">Overwatch 2</option>
                    <option value="MR">Marvel Rivals</option>
                  </select>
                </div>
                <div className="field" style={FULL_WIDTH}>
                  <label htmlFor="tournament-description">Description</label>
                  <textarea
                    id="tournament-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Description du tournoi..."
                  />
                </div>
              </div>
            </section>

            <section style={SECTION_SEPARATOR}>
              <p className="eyebrow" style={EYEBROW}>
                Format
              </p>
              <div className="form-grid" style={GRID}>
                <div className="field">
                  <label htmlFor="tournament-format">Format de bracket</label>
                  <select
                    id="tournament-format"
                    value={format}
                    onChange={(e) => {
                      setFormat(e.target.value as TournamentFormat);
                      setHasThirdPlaceMatch(false);
                    }}
                  >
                    <option value="SINGLE">Simple élimination</option>
                    <option value="DOUBLE">Double élimination</option>
                    <option value="SWISS">Ronde suisse</option>
                    <option value="SURVIVAL">Survie</option>
                    <option value="MULTI">Multi-phases</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="max-teams">Nombre max d&apos;équipes</label>
                  <input
                    id="max-teams"
                    type="number"
                    min={2}
                    max={256}
                    value={maxTeams}
                    onChange={(e) => setMaxTeams(Number(e.target.value))}
                  />
                </div>

                {format === "MULTI" && (
                  <div style={FULL_WIDTH}>
                    <PhaseBuilder
                      phases={phases}
                      maxTeams={maxTeams}
                      onChange={setPhases}
                    />
                  </div>
                )}

                {format === "SURVIVAL" && (
                  <>
                    <div className="field">
                      <label htmlFor="survival-first-cut">Rounds avant la première coupe</label>
                      <input
                        id="survival-first-cut"
                        type="number"
                        min={1}
                        max={50}
                        value={survivalRoundsBeforeFirstCut}
                        onChange={(e) =>
                          setSurvivalRoundsBeforeFirstCut(Number(e.target.value))
                        }
                      />
                      <p style={HINT}>
                        Laisse le classement se former avant la première élimination.
                      </p>
                    </div>

                    <div className="field">
                      <label htmlFor="survival-rounds">Rounds entre les coupes suivantes</label>
                      <input
                        id="survival-rounds"
                        type="number"
                        min={1}
                        max={50}
                        value={survivalRoundsPerCut}
                        onChange={(e) => setSurvivalRoundsPerCut(Number(e.target.value))}
                      />
                      <p style={HINT}>
                        Cadence appliquée après la première coupe.
                      </p>
                    </div>

                    <p style={{ ...HINT, ...FULL_WIDTH }}>
                      Toutes les équipes s&apos;affrontent par paires selon leur classement. À
                      chaque coupe, les deux dernières équipes sont éliminées, jusqu&apos;à la
                      championne. Si le nombre d&apos;inscrites est impair, un barrage entre les
                      deux dernières ouvre le tournoi — aucune victoire d&apos;office n&apos;est
                      distribuée.
                    </p>
                  </>
                )}

                {format === "SINGLE" && (
                  <div className="field" style={FULL_WIDTH}>
                    <label htmlFor="third-place" style={{ marginBottom: 6 }}>
                      Options supplémentaires
                    </label>
                    <div
                      className="checkbox-card"
                      onClick={() => setHasThirdPlaceMatch(!hasThirdPlaceMatch)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: "14px 16px",
                        border: `1.5px solid ${
                          hasThirdPlaceMatch ? "var(--blue-500)" : "var(--line-strong-cy)"
                        }`,
                        borderRadius: 10,
                        cursor: "pointer",
                        transition: "border-color 0.2s ease, background-color 0.2s ease",
                        backgroundColor: hasThirdPlaceMatch
                          ? "rgba(90, 200, 255, 0.07)"
                          : "transparent",
                      }}
                    >
                      <input
                        id="third-place"
                        type="checkbox"
                        checked={hasThirdPlaceMatch}
                        onChange={(e) => setHasThirdPlaceMatch(e.target.checked)}
                        style={{
                          width: 18,
                          height: 18,
                          accentColor: "var(--blue-500)",
                          cursor: "pointer",
                          flexShrink: 0,
                          marginTop: 2,
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <label
                          htmlFor="third-place"
                          style={{
                            display: "block",
                            margin: "0 0 4px",
                            cursor: "pointer",
                            userSelect: "none",
                            fontSize: 14,
                            fontWeight: 500,
                            color: "var(--ink)",
                          }}
                        >
                          Petite finale
                        </label>
                        <p style={{ ...HINT, margin: 0 }}>
                          Ajoute un match pour déterminer la 3ᵉ place entre les deux perdants des
                          demi-finales.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section style={SECTION_SEPARATOR}>
              <p className="eyebrow" style={EYEBROW}>
                Planning
              </p>
              <div className="form-grid" style={GRID}>
                <div className="field">
                  <label htmlFor="visibility-at">Début visibilité</label>
                  <input
                    id="visibility-at"
                    type="datetime-local"
                    value={startVisibilityAt}
                    onChange={(e) => setStartVisibilityAt(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="registration-open-at">Début inscriptions</label>
                  <input
                    id="registration-open-at"
                    type="datetime-local"
                    value={registrationOpenAt}
                    onChange={(e) => setRegistrationOpenAt(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="registration-close-at">Fin inscriptions</label>
                  <input
                    id="registration-close-at"
                    type="datetime-local"
                    value={registrationCloseAt}
                    onChange={(e) => setRegistrationCloseAt(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="start-at">Début tournoi</label>
                  <input
                    id="start-at"
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "flex-end",
                gap: 12,
                paddingTop: 24,
                borderTop: "1px solid var(--line-soft)",
              }}
            >
              <CyberButton variant="ghost" asChild>
                <Link href="/tournois">Annuler</Link>
              </CyberButton>
              <CyberButton
                variant="primary"
                type="submit"
                disabled={loading}
                style={{ opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}
              >
                {loading ? "Création..." : "Créer le tournoi"}
              </CyberButton>
            </div>
          </form>
        </CyberCard>
      </section>
    </>
  );
}
