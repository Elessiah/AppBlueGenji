"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function CreateTeamPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          logoUrl: logoUrl.trim() ? logoUrl.trim() : null,
        }),
      });
      const payload = (await response.json()) as { error?: string; teamId?: number };
      if (!response.ok || !payload.teamId) {
        throw new Error(payload.error || "TEAM_CREATE_FAILED");
      }
      router.push(`/equipes/${payload.teamId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="fade-in">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          borderRadius: 22,
          border: "1px solid rgba(255,157,46,0.15)",
          background:
            "linear-gradient(135deg, rgba(11,16,27,0.97) 0%, rgba(18,26,44,0.95) 100%)",
          overflow: "hidden",
          padding: "40px 40px 36px",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, transparent, #ff9d2e 40%, transparent)",
          }}
        />
        <div style={{ position: "relative" }}>
          <Link
            href="/equipes"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "var(--text-2)",
              marginBottom: 16,
              transition: "color 0.15s",
            }}
          >
            ← Équipes
          </Link>
          <h1
            style={{
              fontFamily: "var(--font-title), sans-serif",
              fontSize: "clamp(28px, 3vw, 42px)",
              fontWeight: 700,
              letterSpacing: "0.02em",
              margin: "0 0 10px",
              background: "linear-gradient(135deg, #f3f7ff 20%, #ff9d2e 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Créer mon équipe
          </h1>
          <p style={{ color: "var(--text-1)", margin: 0, fontSize: 15 }}>
            Le rôle Owner est automatiquement attribué au créateur.
          </p>
        </div>
      </div>

      {/* ── FORM ───────────────────────────────────────────────────────── */}
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 20,
          background: "rgba(13,18,30,0.88)",
          padding: "32px 36px",
        }}
      >
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-grid">
            <div className="field">
              <label>Nom d'équipe</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mon équipe"
              />
            </div>
            <div className="field">
              <label>
                Logo URL{" "}
                <span style={{ color: "var(--text-2)", fontWeight: 400 }}>(optionnel)</span>
              </label>
              <input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>

          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <Link href="/equipes" className="btn ghost" style={{ padding: "11px 24px" }}>
              Annuler
            </Link>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "11px 28px",
                borderRadius: 999,
                border: "1px solid rgba(255,157,46,0.35)",
                background: "rgba(255,157,46,0.15)",
                color: "var(--text-0)",
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Création…" : "Créer l'équipe"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
