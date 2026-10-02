/**
 * Balayage : toute notification adressée à une personne passe par le point
 * d'entrée unique (`lib/server/notify.ts`), qui l'envoie aussi en push.
 *
 * Une notification Discord écrite demain à côté de ce point d'entrée
 * n'arriverait jamais sur un téléphone abonné — et rien d'autre ne le verrait.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { PUSH_TOPIC_KEYS } from "@/lib/shared/push-notifications";
import { readSource } from "../../helpers/read-source";
import { stripLineComments } from "../../helpers/strip-comments";

const ROOT = join(__dirname, "..", "..", "..");

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const FILES = [...sources("lib"), ...sources("app")].map((path) => ({
  path: relative(ROOT, join(ROOT, path)).split(sep).join("/"),
  code: stripLineComments(readSource(path)),
}));

/** Appels d'une fonction, **déclaration exclue**. */
function callSites(code: string, name: string): number[] {
  const sites: number[] = [];
  const pattern = new RegExp(`(?<!function )\\b${name}\\(`, "g");
  for (let match = pattern.exec(code); match; match = pattern.exec(code)) sites.push(match.index);
  return sites;
}

describe("un seul point d'entrée pour les notifications", () => {
  it("n'appelle le message privé Discord que depuis notify.ts", () => {
    const offenders = FILES.filter(
      ({ path, code }) =>
        path !== "lib/server/notify.ts" &&
        path !== "lib/server/bot-integration.ts" &&
        callSites(code, "pushDiscordDirectMessages").length > 0,
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("n'alerte arbitres et direction que depuis un notifyStaff", () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const { path, code } of FILES) {
      if (path === "lib/server/bot-integration.ts") continue;
      for (const name of ["pushRefereeAlert", "pushLeadershipAlert"]) {
        for (const index of callSites(code, name)) {
          seen += 1;
          // L'appel doit être la fonction d'envoi Discord d'un `notifyStaff` :
          // `discord: () => pushRefereeAlert(...)`, dans le bloc ouvert juste avant.
          const before = code.slice(Math.max(0, index - 400), index);
          if (!/notifyStaff\(\{[\s\S]*discord: \(\) =>\s*$/.test(before)) offenders.push(`${path} (${name})`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // Le balayage a bien vu les trois envois d'aujourd'hui : une règle qui ne
    // trouve rien à vérifier passerait sans rien garantir.
    expect(seen).toBeGreaterThanOrEqual(3);
  });

  it("saurait repérer un appel direct", () => {
    expect(callSites("await pushDiscordDirectMessages(m, r, c);", "pushDiscordDirectMessages")).toHaveLength(1);
    expect(callSites("export async function pushDiscordDirectMessages(", "pushDiscordDirectMessages")).toHaveLength(0);
  });

  it("donne un producteur à chaque sujet du registre", () => {
    const server = FILES.filter(({ path }) => path.startsWith("lib/server/")).map(({ code }) => code).join("\n");
    const orphans = PUSH_TOPIC_KEYS.filter((topic) => !server.includes(`"${topic}"`));
    expect(orphans).toEqual([]);
  });
});

describe("branchements du moteur", () => {
  it("balaie les départs de match à chaque publication d'évènement de tournoi", () => {
    const code = stripLineComments(readSource("lib/server/tournaments/notifications.ts"));
    const publishers = code.match(/export function publish\w+\([^)]*\)[^{]*\{[^}]*?scheduleMatchStartNotices\(\)/g) ?? [];
    const all = code.match(/export function publish\w+/g) ?? [];
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(publishers).toHaveLength(all.length);
  });

  it("annonce le coup d'envoi depuis le journal, et le score à confirmer après le commit d'un report", () => {
    expect(readSource("lib/server/tournaments/bot-logs.ts")).toMatch(
      /entry\.kind === "tournament_started"\) \{\s*void notifyTournamentStart\(entry\.tournamentId\)/,
    );
    const index = stripLineComments(readSource("lib/server/tournaments/index.ts"));
    expect(index).toMatch(/publishScoreReportedEvent\(tournamentId, matchId\);\s*void notifyScoreToConfirm\(matchId\);/);
    expect(index).toMatch(/void dispatchMatchStartNotices\(\)/);
  });

  it("efface les abonnements d'un compte anonymisé", () => {
    const users = readSource("lib/server/users/account-erasure.ts");
    expect(users).toContain("DELETE FROM bg_push_subscriptions WHERE user_id = ?");
    expect(users).toContain("DELETE FROM bg_push_topic_optouts WHERE user_id = ?");
  });
});
