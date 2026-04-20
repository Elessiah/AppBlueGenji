"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import { Coche } from "@/components/Coche";
import type { FullProfileResponse } from "@/lib/shared/types";

const VISIBILITY_LABELS: Record<string, string> = {
  overwatch: "BattleTag OW",
  marvel: "Tag Marvel",
  major: "Majorité",
};

export default function ProfilePage() {
  const [data, setData] = useState<FullProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [pseudo, setPseudo] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [overwatchBattletag, setOverwatchBattletag] = useState("");
  const [marvelRivalsTag, setMarvelRivalsTag] = useState("");
  const [isAdult, setIsAdult] = useState<string>("unknown");
  const [visibility, setVisibility] = useState({
    overwatch: false,
    marvel: false,
    major: false,
  });

  const load = async () => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    const payload = (await response.json()) as FullProfileResponse & { error?: string };
    if (!response.ok) throw new Error(payload.error || "PROFILE_LOAD_FAILED");
    setData(payload);
    setPseudo(payload.profile.pseudo);
    setAvatarUrl(payload.profile.avatarUrl || "");
    setOverwatchBattletag(payload.profile.overwatchBattletag || "");
    setMarvelRivalsTag(payload.profile.marvelRivalsTag || "");
    setIsAdult(payload.profile.isAdult === null ? "unknown" : payload.profile.isAdult ? "yes" : "no");
    const v = payload.profile.visibility;
    setVisibility({ overwatch: !!v.overwatch, marvel: !!v.marvel, major: !!v.major });
  };

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pseudo,
          avatarUrl: avatarUrl.trim() ? avatarUrl.trim() : null,
          overwatchBattletag: overwatchBattletag.trim() ? overwatchBattletag.trim() : null,
          marvelRivalsTag: marvelRivalsTag.trim() ? marvelRivalsTag.trim() : null,
          isAdult: isAdult === "unknown" ? null : isAdult === "yes",
          visibility,
        }),
      });
      const payload = (await response.json()) as FullProfileResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "PROFILE_UPDATE_FAILED");
      setData(payload);
      setStatus("Profil mis à jour.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!data) return <section className="ds-block" style={{ color: "var(--text-2)" }}>Chargement du profil...</section>;

  return (
    <section className="fade-in">
      <div className="ds-header">
        <div className="ds-header-body" style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Image
            className="avatar"
            src={data.profile.avatarUrl || "/vercel.svg"}
            alt={data.profile.pseudo}
            width={60}
            height={60}
            unoptimized
            referrerPolicy="no-referrer"
            style={{ width: 60, height: 60, borderRadius: "50%", border: "2px solid rgba(89,212,255,0.35)" }}
          />
          <div>
            <h1 className="ds-title blue" style={{ fontSize: "clamp(28px, 3vw, 42px)", marginBottom: 6 }}>
              Mon profil
            </h1>
            <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
              Informations personnelles masquées par défaut
            </p>
          </div>
        </div>
      </div>

      <div className="ds-block" style={{ marginBottom: 20 }}>
        <div className="ds-section-title blue">
          <h2>Informations</h2>
        </div>

        {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}
        {status && <p className="success" style={{ marginBottom: 16 }}>{status}</p>}

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-grid">
            <div className="field">
              <label>Pseudo site</label>
              <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} />
            </div>
            <div className="field">
              <label>Avatar URL</label>
              <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="field">
              <label>BattleTag Overwatch</label>
              <input value={overwatchBattletag} onChange={(e) => setOverwatchBattletag(e.target.value)} placeholder="Pseudo#1234" />
            </div>
            <div className="field">
              <label>Tag Marvel Rivals</label>
              <input value={marvelRivalsTag} onChange={(e) => setMarvelRivalsTag(e.target.value)} />
            </div>
            <div className="field">
              <label>Statut majeur</label>
              <select value={isAdult} onChange={(e) => setIsAdult(e.target.value)}>
                <option value="unknown">Non renseigné</option>
                <option value="yes">Oui (18+)</option>
                <option value="no">Non (mineur)</option>
              </select>
            </div>
          </div>

          <div>
            <p
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.09em",
                color: "var(--text-2)",
                margin: "0 0 12px",
              }}
            >
              Visibilité publique
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {Object.entries(visibility).map(([key, value]) => (
                <Coche
                  key={key}
                  label={VISIBILITY_LABELS[key] ?? key}
                  checked={value}
                  theme="joueur"
                  onChange={() =>
                    setVisibility((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))
                  }
                />
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              className="btn"
              style={{
                padding: "11px 28px",
                background: "rgba(89,212,255,0.15)",
                borderColor: "rgba(89,212,255,0.35)",
              }}
            >
              Sauvegarder
            </button>
          </div>
        </form>
      </div>

      <div className="ds-block">
        <div className="ds-section-title blue">
          <h2>Statistiques plateforme</h2>
        </div>
        <div className="ds-stats">
          {[
            { label: "Tournois joués", value: data.stats.tournamentsPlayed },
            { label: "Tournois gagnés", value: data.stats.tournamentsWon },
            { label: "Victoires", value: data.stats.matchesWon },
            { label: "Défaites", value: data.stats.matchesLost },
            { label: "Meilleur rang", value: data.stats.bestRank ?? "—" },
          ].map((stat) => (
            <div key={stat.label} className="ds-stat">
              <div className="ds-stat-label">{stat.label}</div>
              <div className="ds-stat-value">{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          paddingTop: 20,
          borderTop: "1px solid var(--line)",
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <LogoutButton />
      </div>
    </section>
  );
}
