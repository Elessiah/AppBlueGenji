"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import type { FullProfileResponse } from "@/lib/shared/types";

const VISIBILITY_LABELS: Record<string, string> = {
  avatar: "Avatar",
  pseudo: "Pseudo",
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
    avatar: false,
    pseudo: false,
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
    setVisibility(payload.profile.visibility);
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

  if (!data) {
    return (
      <section
        style={{
          borderRadius: 16,
          border: "1px solid var(--line)",
          background: "rgba(13,18,30,0.8)",
          padding: "28px 32px",
          color: "var(--text-2)",
        }}
      >
        Chargement du profil…
      </section>
    );
  }

  return (
    <section className="fade-in">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          borderRadius: 22,
          border: "1px solid rgba(79,224,162,0.15)",
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
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse at 0% 50%, rgba(79,224,162,0.07) 0%, transparent 50%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, transparent, #4fe0a2 40%, transparent)",
          }}
        />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 20 }}>
          <Image
            className="avatar"
            src={data.profile.avatarUrl || "/vercel.svg"}
            alt={data.profile.pseudo}
            width={60}
            height={60}
            unoptimized
            referrerPolicy="no-referrer"
            style={{ width: 60, height: 60, borderRadius: "50%", border: "2px solid rgba(79,224,162,0.35)" }}
          />
          <div>
            <h1
              style={{
                fontFamily: "var(--font-title), sans-serif",
                fontSize: "clamp(28px, 3vw, 42px)",
                fontWeight: 700,
                letterSpacing: "0.02em",
                margin: "0 0 6px",
                background: "linear-gradient(135deg, #f3f7ff 20%, #4fe0a2 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Mon profil
            </h1>
            <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
              Informations personnelles masquées par défaut
            </p>
          </div>
        </div>
      </div>

      {/* ── FORM ───────────────────────────────────────────────────────── */}
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 20,
          background: "rgba(13,18,30,0.88)",
          padding: "32px 36px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 24 }}>
          <span
            style={{
              flexShrink: 0,
              width: 4,
              height: 28,
              background: "linear-gradient(180deg, #4fe0a2, #59d4ff)",
              borderRadius: 2,
              marginTop: 2,
            }}
          />
          <h2
            style={{
              fontFamily: "var(--font-title), sans-serif",
              fontSize: 20,
              margin: 0,
              letterSpacing: "0.02em",
            }}
          >
            Informations
          </h2>
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
              <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
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

          {/* Visibility */}
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
                <label
                  key={key}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 14px",
                    borderRadius: 999,
                    border: `1px solid ${value ? "rgba(79,224,162,0.4)" : "var(--line)"}`,
                    background: value ? "rgba(79,224,162,0.1)" : "rgba(255,255,255,0.03)",
                    cursor: "pointer",
                    fontSize: 14,
                    userSelect: "none",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  {/* Checkbox natif caché — le label entier est cliquable */}
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={() =>
                      setVisibility((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))
                    }
                    style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
                  />
                  {/* Indicateur custom */}
                  <span
                    style={{
                      flexShrink: 0,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      border: `1.5px solid ${value ? "rgba(79,224,162,0.8)" : "rgba(255,255,255,0.2)"}`,
                      background: value ? "var(--accent-green)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.15s",
                      fontSize: 10,
                      color: "var(--bg-0)",
                      fontWeight: 900,
                      lineHeight: 1,
                    }}
                  >
                    {value && "✓"}
                  </span>
                  <span style={{ color: value ? "var(--text-0)" : "var(--text-1)" }}>
                    {VISIBILITY_LABELS[key] ?? key}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              style={{
                padding: "11px 28px",
                borderRadius: 999,
                border: "1px solid rgba(79,224,162,0.35)",
                background: "rgba(79,224,162,0.15)",
                color: "var(--text-0)",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Sauvegarder
            </button>
          </div>
        </form>
      </div>

      {/* ── STATS ──────────────────────────────────────────────────────── */}
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 20,
          background: "rgba(13,18,30,0.85)",
          padding: "28px 36px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 22 }}>
          <span
            style={{
              flexShrink: 0,
              width: 4,
              height: 28,
              background: "linear-gradient(180deg, #ff9d2e, #59d4ff)",
              borderRadius: 2,
              marginTop: 2,
            }}
          />
          <h2
            style={{
              fontFamily: "var(--font-title), sans-serif",
              fontSize: 20,
              margin: 0,
              letterSpacing: "0.02em",
            }}
          >
            Statistiques plateforme
          </h2>
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {[
            { label: "Tournois joués", value: data.stats.tournamentsPlayed },
            { label: "Tournois gagnés", value: data.stats.tournamentsWon },
            { label: "Victoires", value: data.stats.matchesWon },
            { label: "Défaites", value: data.stats.matchesLost },
            { label: "Meilleur rang", value: data.stats.bestRank ?? "—" },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{ borderLeft: "2px solid rgba(89,212,255,0.3)", paddingLeft: 14 }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--text-2)",
                }}
              >
                {stat.label}
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── DÉCONNEXION ────────────────────────────────────────────────── */}
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
