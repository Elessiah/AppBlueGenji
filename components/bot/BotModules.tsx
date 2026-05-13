"use client";

import { useState } from "react";
import { MODULES } from "./mocks";
import { Icon } from "./Icon";

export function BotModules() {
  const [mods, setMods] = useState(MODULES);
  const toggle = (i: number) => setMods((m) => m.map((x, k) => (k === i ? { ...x, on: !x.on } : x)));

  return (
    <>
      <div className="bot-section-head">
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            SECTION 02
          </div>
          <h2>Modules</h2>
        </div>
        <div className="meta">6 INSTALLÉS · 5 ACTIFS · TOGGLE PAR SERVEUR</div>
      </div>

      <div className="modules">
        {mods.map((m, i) => (
          <div key={m.title} className="card card-lift mod">
            <div className="mod-head">
              <span className="mod-tag">{m.tag}</span>
              <button
                className={"mod-toggle " + (m.on ? "" : "off")}
                onClick={() => toggle(i)}
                role="button"
                aria-label={`${m.on ? "Désactiver" : "Activer"} ${m.title}`}
              />
            </div>
            <div className="mod-icon">
              <Icon name={m.icon as "relay" | "swords" | "user" | "bell" | "key" | "chart" | "discord"} size={20} />
            </div>
            <div className="mod-title">{m.title}</div>
            <div className="mod-desc">{m.desc}</div>
            <div className="mod-foot">
              <span>{m.meta}</span>
              <span className={m.on ? "ok" : "warn"}>{m.on ? "● EN LIGNE" : "○ DÉSACTIVÉ"}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
