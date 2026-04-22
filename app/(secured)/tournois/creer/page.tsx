"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { localDateTimeInput } from "@/lib/shared/dates";
import type { TournamentFormat } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";

export default function CreateTournamentPage() {
  const router = useRouter();
  const { showError } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<TournamentFormat>("SINGLE");
  const [hasThirdPlaceMatch, setHasThirdPlaceMatch] = useState(false);
  const [maxTeams, setMaxTeams] = useState(16);
  const [startVisibilityAt, setStartVisibilityAt] = useState(localDateTimeInput(1));
  const [registrationOpenAt, setRegistrationOpenAt] = useState(localDateTimeInput(3));
  const [registrationCloseAt, setRegistrationCloseAt] = useState(localDateTimeInput(24));
  const [startAt, setStartAt] = useState(localDateTimeInput(30));
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          format,
          maxTeams,
          startVisibilityAt: new Date(startVisibilityAt).toISOString(),
          registrationOpenAt: new Date(registrationOpenAt).toISOString(),
          registrationCloseAt: new Date(registrationCloseAt).toISOString(),
          startAt: new Date(startAt).toISOString(),
          hasThirdPlaceMatch: format === "SINGLE" ? hasThirdPlaceMatch : false,
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
      <Link href="/" className="cta-float-home home" style={{ bottom: 28 }}>
        ⌂ Accueil
      </Link>
      <section className="fade-in">

      <div className="ds-header green">
        <div className="ds-header-body">
          <Link
            href="/tournois"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "var(--text-2)",
              marginBottom: 16,
            }}
          >
            ← Tournois
          </Link>
          <h1 className="ds-title green" style={{ fontSize: "clamp(28px, 3vw, 42px)" }}>
            Créer un tournoi
          </h1>
          <p style={{ color: "var(--text-1)", margin: 0, fontSize: 15 }}>
            Définis les phases temporelles du tournoi et le format de bracket.
          </p>
        </div>
      </div>

      <div className="ds-block">
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <p
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "var(--text-2)",
                margin: "0 0 14px",
              }}
            >
              Identité
            </p>
            <div className="form-grid">
              <div className="field">
                <label>Nom du tournoi</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Mon tournoi" />
              </div>
              <div className="field">
                <label>Format</label>
                <select value={format} onChange={(e) => { setFormat(e.target.value as TournamentFormat); setHasThirdPlaceMatch(false); }}>
                  <option value="SINGLE">Simple élimination</option>
                  <option value="DOUBLE">Double élimination</option>
                </select>
              </div>
              {format === "SINGLE" && (
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="third-place" style={{ marginBottom: 12 }}>
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
                      border: `1.5px solid ${hasThirdPlaceMatch ? "var(--accent-green)" : "var(--line)"}`,
                      borderRadius: "10px",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      backgroundColor: hasThirdPlaceMatch ? "rgba(79,224,162,0.06)" : "transparent",
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
                        accentColor: "var(--accent-green)",
                        cursor: "pointer",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <label htmlFor="third-place" style={{ margin: 0, cursor: "pointer", userSelect: "none", fontSize: 14, fontWeight: 500, color: "var(--text-0)", display: "block", marginBottom: 4 }}>
                        Petite finale
                      </label>
                      <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.4 }}>
                        Ajoute un match pour déterminer la 3ème place entre les deux perdants des demi-finales
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description du tournoi..." />
              </div>
              <div className="field">
                <label>Nombre max d'équipes</label>
                <input type="number" min={2} max={256} value={maxTeams} onChange={(e) => setMaxTeams(Number(e.target.value))} />
              </div>
            </div>
          </div>

          <div>
            <p
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "var(--text-2)",
                margin: "0 0 14px",
              }}
            >
              Planning
            </p>
            <div className="form-grid">
              <div className="field">
                <label>Début visibilité</label>
                <input type="datetime-local" value={startVisibilityAt} onChange={(e) => setStartVisibilityAt(e.target.value)} />
              </div>
              <div className="field">
                <label>Début inscriptions</label>
                <input type="datetime-local" value={registrationOpenAt} onChange={(e) => setRegistrationOpenAt(e.target.value)} />
              </div>
              <div className="field">
                <label>Fin inscriptions</label>
                <input type="datetime-local" value={registrationCloseAt} onChange={(e) => setRegistrationCloseAt(e.target.value)} />
              </div>
              <div className="field">
                <label>Début tournoi</label>
                <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <Link href="/tournois" className="btn ghost" style={{ padding: "11px 24px" }}>
              Annuler
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="btn"
              style={{
                padding: "11px 28px",
                background: "rgba(79,224,162,0.15)",
                borderColor: "rgba(79,224,162,0.35)",
                opacity: loading ? 0.6 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Création..." : "Créer le tournoi"}
            </button>
          </div>
        </form>
      </div>
      </section>
    </>
  );
}
