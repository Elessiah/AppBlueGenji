"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { CyberCard, CyberButton } from "@/components/cyber";
import { useSetPalette } from "@/lib/palette-context";

export default function CreateTeamPage() {
  const router = useRouter();
  const { showError } = useToast();
  const setPalette = useSetPalette();
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPalette("blue");
  }, [setPalette]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
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
      showError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="fade-in container">
      <Link href="/equipes" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink-mute)", marginBottom: 16 }}>
        ← Équipes
      </Link>
      <h1 className="display" style={{ fontSize: 48, margin: "0 0 8px" }}>
        Créer mon équipe
      </h1>
      <p style={{ color: "var(--ink-mute)", margin: "0 0 24px", fontSize: 14 }}>
        Le rôle Owner est automatiquement attribué au créateur.
      </p>

      <CyberCard ticks>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-grid">
            <div className="field">
              <label>Nom d'équipe</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Mon équipe" />
            </div>
            <div className="field">
              <label>Logo URL (optionnel)</label>
              <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <CyberButton variant="ghost" asChild>
              <Link href="/equipes">Annuler</Link>
            </CyberButton>
            <CyberButton
              variant="primary"
              type="submit"
              disabled={loading}
              style={{ opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}
            >
              {loading ? "Création..." : "Créer l'équipe"}
            </CyberButton>
          </div>
        </form>
      </CyberCard>
    </section>
  );
}
