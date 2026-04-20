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
      if (!response.ok || !payload.teamId) throw new Error(payload.error || "TEAM_CREATE_FAILED");
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
      <div className="ds-header orange">
        <div className="ds-header-body">
          <Link
            href="/equipes"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "var(--text-2)",
              marginBottom: 16,
            }}
          >
            ← Equipes
          </Link>
          <h1 className="ds-title orange" style={{ fontSize: "clamp(28px, 3vw, 42px)" }}>
            Creer mon equipe
          </h1>
          <p style={{ color: "var(--text-1)", margin: 0, fontSize: 15 }}>
            Le role Owner est automatiquement attribue au createur.
          </p>
        </div>
      </div>

      <div className="ds-block">
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-grid">
            <div className="field">
              <label>Nom d'equipe</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Mon equipe" />
            </div>
            <div className="field">
              <label>
                Logo URL <span style={{ color: "var(--text-2)", fontWeight: 400 }}>(optionnel)</span>
              </label>
              <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
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
              className="btn"
              style={{
                padding: "11px 28px",
                background: "rgba(255,157,46,0.15)",
                borderColor: "rgba(255,157,46,0.35)",
                opacity: loading ? 0.6 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Creation..." : "Creer l'equipe"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
