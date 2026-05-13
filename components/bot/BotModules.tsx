import { BotModulesPayload } from "@/lib/shared/types";
import { Icon } from "./Icon";

const MODULE_CONFIG = {
  annonces: { title: "Annonces", desc: "Diffusion d'annonces cross-serveur", icon: "bell" },
  scrims: { title: "Scrims", desc: "Organisation des matchs scrims", icon: "swords" },
  recrutement: { title: "Recrutement", desc: "Gestion des demandes d'adhésion", icon: "user" },
  notifications: { title: "Notifications", desc: "Alertes en temps réel", icon: "bell" },
  oauth: { title: "OAuth", desc: "Connexion Discord intégrée", icon: "key" },
  stats: { title: "Stats", desc: "Statistiques détaillées", icon: "chart" },
} as const;

type IconName = "relay" | "swords" | "user" | "bell" | "key" | "chart" | "discord";

export function BotModules({ payload }: { payload: BotModulesPayload | null }) {
  const list = payload?.modules ?? [];
  const activeCount = list.filter((m) => m.enabled).length;

  return (
    <>
      <div className="bot-section-head">
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            SECTION 02
          </div>
          <h2>Modules</h2>
        </div>
        <div className="meta">{list.length} INSTALLÉS · {activeCount} ACTIFS · LECTURE SEULE</div>
      </div>

      <div className="modules">
        {list.map((m) => {
          const config = MODULE_CONFIG[m.key];
          if (!config) return null;
          const enabled = m.enabled;
          return (
            <div key={m.key} className="card card-lift mod">
              <div className="mod-head">
                <span className="mod-tag">{m.key.toUpperCase()}</span>
                <span
                  className={"mod-toggle " + (enabled ? "" : "off")}
                  aria-hidden="true"
                />
              </div>
              <div className="mod-icon">
                <Icon name={config.icon as IconName} size={20} />
              </div>
              <div className="mod-title">{config.title}</div>
              <div className="mod-desc">{config.desc}</div>
              <div className="mod-foot">
                <span>{m.count30j} · 30j</span>
                <span className={enabled ? "ok" : "warn"}>{enabled ? "● EN LIGNE" : "○ DÉSACTIVÉ"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
