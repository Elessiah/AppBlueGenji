"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { TournamentFormat } from "@/lib/shared/types";

function localDate(hoursFromNow: number): string {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

export default function CreateTournamentPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<TournamentFormat>("SINGLE");
  const [maxTeams, setMaxTeams] = useState(16);
  const [startVisibilityAt, setStartVisibilityAt] = useState(localDate(1));
  const [registrationOpenAt, setRegistrationOpenAt] = useState(localDate(3));
  const [registrationCloseAt, setRegistrationCloseAt] = useState(localDate(24));
  const [startAt, setStartAt] = useState(localDate(30));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
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
        }),
      });
      const payload = (await response.json()) as { error?: string; id?: number };
      if (!response.ok || !payload.id) throw new Error(payload.error || "TOURNAMENT_CREATE_FAILED");
      router.push(`/tournois/${payload.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="fade-in">
      <Link href="/" className="cta-float-home" style={{ bottom: 28 }}>
        ⌂ Accueil
      </Link>

      <div className="ds-header">
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
          <h1 className="ds-title blue" style={{ fontSize: "clamp(28px, 3vw, 42px)" }}>
            Creer un tournoi
          </h1>
          <p style={{ color: "var(--text-1)", margin: 0, fontSize: 15 }}>
            Definis les phases temporelles du tournoi et le format de bracket.
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
              Identite
            </p>
            <div className="form-grid">
              <div className="field">
                <label>Nom du tournoi</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Mon tournoi" />
              </div>
              <div className="field">
                <label>Format</label>
                <select value={format} onChange={(e) => setFormat(e.target.value as TournamentFormat)}>
                  <option value="SINGLE">Simple elimination</option>
                  <option value="DOUBLE">Double elimination</option>
                </select>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description du tournoi..." />
              </div>
              <div className="field">
                <label>Nombre max d'equipes</label>
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
                <label>Debut visibilite</label>
                <input type="datetime-local" value={startVisibilityAt} onChange={(e) => setStartVisibilityAt(e.target.value)} />
              </div>
              <div className="field">
                <label>Debut inscriptions</label>
                <input type="datetime-local" value={registrationOpenAt} onChange={(e) => setRegistrationOpenAt(e.target.value)} />
              </div>
              <div className="field">
                <label>Fin inscriptions</label>
                <input type="datetime-local" value={registrationCloseAt} onChange={(e) => setRegistrationCloseAt(e.target.value)} />
              </div>
              <div className="field">
                <label>Debut tournoi</label>
                <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </div>
            </div>
          </div>

          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}

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
                background: "rgba(89,212,255,0.15)",
                borderColor: "rgba(89,212,255,0.35)",
                opacity: loading ? 0.6 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Creation..." : "Creer le tournoi"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
