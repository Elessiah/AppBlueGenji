/**
 * Annonces GETI du jeu de test : quelques annonces de synthèse par catégorie
 * (pseudos, identifiants, équipes et serveurs factices), dans les deux formes
 * réelles — message écrit directement dans le salon, relais de GETI Bot —,
 * posées par le même chemin que le bot (`parsePushedPost` puis
 * `upsertGetiPosts`) : le seed est le seul endroit où ce SQL se joue sur une
 * vraie base.
 */

import type { Pool } from "mysql2/promise";
import {
  deleteGetiPosts,
  listGetiPosts,
  purgeExpiredGetiPosts,
  reconcileGetiChannel,
  upsertGetiPosts,
} from "../geti/posts";
import { parsePushedPost, type GetiPushedPost } from "../geti/wire";
import {
  createGetiAlert,
  listGetiAlerts,
  notifyGetiAlerts,
  purgeGetiAlertHits,
  updateGetiAlert,
} from "../geti/alerts";
import { GETI_ALERT_ERRORS } from "@/lib/shared/geti/alerts";
import { GETI_CATEGORIES, GETI_CHANNEL_IDS, parseGetiPost, type GetiCategory } from "@/lib/shared/geti";
import { GETI_BOT_USER_ID, getiRetentionMs } from "@/lib/shared/geti/ingest";

/** Identifiants de message factices : `1000000000000009NN`, hors de toute plage réelle des six salons (effacés par `cleanup.ts`). */
export const SEED_GETI_MESSAGE_PREFIX = "1000000000000009";

const GETI_BOT = { id: GETI_BOT_USER_ID, username: "GETI Bot", discriminator: "0", bot: true };

type SeedGetiPost = {
  category: GetiCategory;
  /** Âge de l'annonce, en heures. */
  ageHours: number;
  /** Pseudo Discord factice de l'auteur. */
  author: string;
  /** Texte de l'annonce. */
  text: string;
  /** Relais de GETI Bot depuis ce serveur (factice) ; absent : message écrit directement dans le salon. */
  relayedFrom?: string;
  /** Modifiée une heure après sa publication. */
  edited?: boolean;
};

const DAY = 24;

export const FICTIONAL_GETI_POSTS: readonly SeedGetiPost[] = [
  {
    category: "lfp",
    ageHours: 2,
    author: "test_geti_capitaine",
    relayedFrom: "[TEST] Serveur Aurore",
    text: "LFP — Team Test Aurore cherche un main tank Master 3 à GM 5, EU, PC, francophone.\nScrims lundi, mercredi et vendredi 21h-23h CET. 18+.",
  },
  {
    category: "lfp",
    ageHours: 3 * DAY,
    author: "test_geti_nova",
    relayedFrom: "Test Serveur Comète",
    text: "Recherche DPS hitscan Diamant 2 minimum pour roster Test Comète (EU, PC). FR/EN. Entraînements mardi et jeudi 20h30-22h30.",
  },
  {
    category: "lfp",
    ageHours: 9 * DAY,
    author: "test_geti_owl",
    text: "LFP flex support plat à diam pour team chill, console, week-end surtout. Pas de prise de tête.",
    edited: true,
  },
  {
    category: "lft",
    ageHours: 5,
    author: "test_geti_luna",
    relayedFrom: "Test Serveur Comète",
    text: "LFT — support Master 2 (main Ana / Kiriko), EU, PC, dispo tous les soirs dès 20h. Francophone, 21 ans.",
  },
  {
    category: "lft",
    ageHours: 2 * DAY,
    author: "test_geti_rein",
    relayedFrom: "[TEST] Serveur Aurore",
    text: "Looking for team: tank GM4, DPS M1. EU, PC, English/French. Available Monday to Thursday 8-11pm CET.",
  },
  {
    category: "lft",
    ageHours: 12 * DAY,
    author: "test_geti_ancien",
    relayedFrom: "Test Serveur Zénith",
    text: "Joueur DPS Diamant 1 cherche équipe sérieuse, EU PC, FR.",
  },
  {
    category: "lfsub",
    ageHours: 1,
    author: "test_geti_coach",
    text: "LFSUB urgent ce soir 21h : un support Diamant 3 - Master 5 pour un scrim, EU, PC, FR.",
  },
  {
    category: "lfsub",
    ageHours: 6 * DAY,
    author: "test_geti_sub",
    relayedFrom: "Test Serveur Zénith",
    text: "Team Test Zénith looking for a sub: off tank, Master+, EU, PC, EN. Scrims Tuesday and Sunday 9pm.",
  },
  {
    category: "lfstaff",
    ageHours: 8,
    author: "test_geti_manager",
    text: "LFSTAFF — équipe Test Boréale (Master) recherche un coach et un analyste, EU, francophone. Bénévole.\n\nOn joue trois soirs par semaine, ambiance sérieuse mais détendue ; une première expérience de coaching suffit.",
  },
  {
    category: "lfstaff",
    ageHours: 10 * DAY,
    author: "test_geti_analyste",
    relayedFrom: "Test Serveur Comète",
    text: "Coach / manager dispo pour une structure Diamant à GM, PC, FR/EN, soirs de semaine.",
  },
  {
    category: "lfs",
    ageHours: 4,
    author: "test_geti_scrim",
    relayedFrom: "[TEST] Serveur Aurore",
    text: "LFS ce soir 21h-23h, Master 3 - GM 5, EU, PC. Team Test Aurore.",
  },
  {
    category: "lfs",
    ageHours: 4 * DAY,
    author: "test_geti_scrim2",
    relayedFrom: "Test Serveur Zénith",
    text: "LFS Diamant 2 à Master 4, jeudi 20h, EU, PC, FR.",
    edited: true,
  },
  {
    category: "lfcast",
    ageHours: 30,
    author: "test_geti_orga",
    relayedFrom: "Test Serveur Comète",
    text: "LFCAST — tournoi Test Hivernal samedi 15h, on cherche un caster et un observateur, FR.",
  },
  {
    category: "lfcast",
    ageHours: 7 * DAY,
    author: "test_geti_caster",
    text: "Caster FR/EN dispo pour vos matchs le week-end, PC, EU.",
  },
  // Page `/geti-info` : une annonce close (entièrement barrée), un niveau de
  // division, un rang Émeraude, une autre région, une annonce longue (repliée).
  {
    category: "lfp",
    ageHours: 20,
    author: "test_geti_clos",
    relayedFrom: "Test Serveur Zénith",
    text: "~~LFP tank Diamant 3 pour roster Test Zénith, EU, PC, FR.~~",
  },
  {
    category: "lfs",
    ageHours: 26,
    author: "test_geti_adv",
    text: "LFS EU PC adv, Emerald 2 - Diamond 4, mardi 20h-22h CET. Team Test Boréale.",
  },
  {
    category: "lft",
    ageHours: 30,
    author: "test_geti_na",
    relayedFrom: "Test Serveur Comète",
    text: "LFT flex DPS, Platinum 1, NA, console, English only. Available Saturday and Sunday from 7pm.\n\nPlayed in two teams last season, mostly scrims and a few open cups. I can adapt to dive or brawl, I review my own games and I am looking for a calm team with a coach.\n\nI prefer regular scrims over tournaments for now. Voice chat is a must, and I am fine with tryouts over several evenings before any decision is made by the team.",
  },
];

const HOUR_MS = 60 * 60 * 1000;

function fakeId(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(2, "0")}`;
}

/** Description de l'encart d'un relais de GETI Bot : en-tête, puis l'annonce citée. */
function relayDescription(authorId: string, post: SeedGetiPost): string {
  return `<@${authorId}>*(${post.author})* sur [${post.relayedFrom}](https://example.com/test-invite)\n\n> ${post.text}`;
}

/** Le corps tel que le bot le pousserait. */
function wirePost(post: SeedGetiPost, index: number, now: number): Record<string, unknown> {
  const postedAt = new Date(now - post.ageHours * HOUR_MS);
  const authorId = fakeId("1000000000000001", index);
  const relayed = post.relayedFrom !== undefined;
  return {
    id: fakeId(SEED_GETI_MESSAGE_PREFIX, index),
    channelId: GETI_CHANNEL_IDS[post.category],
    content: relayed ? "" : post.text,
    author: relayed ? GETI_BOT : { id: authorId, username: post.author, discriminator: "0", bot: false },
    embeds: relayed ? [{ description: relayDescription(authorId, post) }] : [],
    postedAt: postedAt.toISOString(),
    editedAt: post.edited ? new Date(postedAt.getTime() + HOUR_MS).toISOString() : null,
  };
}

function pushed(body: Record<string, unknown>): GetiPushedPost {
  const post = parsePushedPost(body);
  if (!post) throw new Error("annonce GETI du seed illisible");
  return post;
}

/**
 * Deux alertes du compte donné, et la passe d'alertes jouée sur la vraie base
 * (trace `INSERT IGNORE`, réservation du délai) — sans rien envoyer : l'envoi
 * est remplacé, ni push ni message privé ne partent du seed.
 */
export async function createGetiAlerts(db: Pool, userId: number): Promise<void> {
  console.log("🔔 Création des alertes GETI...");
  const now = Date.now();
  const named = await createGetiAlert(userId, { category: "lfp", search: "?role=tank&reg=eu", name: "Test - Tank EU" });
  const unnamed = await createGetiAlert(userId, { category: "lft", search: "", name: null });
  const duplicate = await createGetiAlert(userId, { category: "lfp", search: "?reg=eu&role=tank", name: "Test - doublon" });
  if (typeof named === "string" || typeof unnamed === "string" || duplicate !== GETI_ALERT_ERRORS.duplicate) {
    throw new Error(`alertes GETI : création inattendue (${String(named)}, ${String(unnamed)}, ${String(duplicate)})`);
  }
  const paused = await updateGetiAlert(userId, unnamed.id, { paused: true });
  if (typeof paused === "string" || !paused.paused) throw new Error("alertes GETI : mise en pause refusée");

  // Une annonce récente qui correspond à l'alerte nommée : vue une fois, pas deux ; l'alerte en pause ne voit rien.
  const fresh = pushed(wirePost({ category: "lfp", ageHours: 0, author: "test_geti_alerte", text: "LFP — équipe Test Alerte cherche un main tank Diamant, EU." }, 93, now));
  const lft = pushed(wirePost({ category: "lft", ageHours: 0, author: "test_geti_alerte", text: "LFT — support Master cherche une équipe, EU." }, 94, now));
  const posts = [fresh, lft].map((post) => ({
    messageId: post.messageId,
    category: post.category,
    parsed: parseGetiPost(post.raw),
    postedAt: post.postedAt,
    editedAt: post.editedAt,
  }));
  const sent: number[] = [];
  const send = async (alert: { id: number }) => {
    sent.push(alert.id);
    return true;
  };
  const first = await notifyGetiAlerts(posts, now, db, send);
  const again = await notifyGetiAlerts(posts, now, db, send);
  const purged = await purgeGetiAlertHits(db, now);
  const kept = await listGetiAlerts(userId, db);
  if (first.matched !== 1 || first.notified !== 1 || again.matched !== 0 || sent.join() !== String(named.id) || purged !== 0 || kept.length !== 2) {
    throw new Error(
      `alertes GETI : bilan inattendu (${first.matched} touchée(s), ${first.notified} prévenu(s), puis ${again.matched} ; ${purged} trace(s) purgée(s), ${kept.length} alerte(s))`,
    );
  }
  console.log(`  ✓ ${kept.length} alertes créées (1 active, 1 en pause), 1 annonce signalée une seule fois`);
}

export async function createGetiPosts(db: Pool): Promise<void> {
  console.log("📡 Création des annonces GETI...");
  const now = Date.now();
  const posts = FICTIONAL_GETI_POSTS.map((post, index) => pushed(wirePost(post, index, now)));

  // Cas limites joués sur la vraie base : une annonce hors de la fenêtre de
  // garde de sa catégorie (14 jours, 7 pour un scrim — jamais enregistrée) et
  // une annonce supprimée sur Discord.
  const expiredAfter = (category: GetiCategory) => (getiRetentionMs(category) + HOUR_MS) / HOUR_MS;
  const expired = [
    pushed(wirePost({ category: "lft", ageHours: expiredAfter("lft"), author: "test_geti_perime", text: "LFT trop ancien" }, 90, now)),
    pushed(wirePost({ category: "lfs", ageHours: expiredAfter("lfs"), author: "test_geti_perime", text: "LFS trop ancien" }, 91, now)),
  ];
  const deleted = pushed(wirePost({ category: "lfs", ageHours: 1, author: "test_geti_supprime", text: "LFS annulé" }, 92, now));
  const outcome = await upsertGetiPosts(db, [...posts, ...expired, deleted], now);
  // Rejouée : la modification d'une annonce déjà gardée passe par `ON DUPLICATE KEY UPDATE`.
  await upsertGetiPosts(db, posts.slice(0, 1), now);
  const removed = await deleteGetiPosts(db, [deleted.messageId]);

  // Réconciliation d'un salon dont rien n'a disparu, puis purge : aucune ligne ne doit partir.
  const lfp = posts.filter((post) => post.category === "lfp");
  const reconciled = await reconcileGetiChannel(
    db,
    { channelId: GETI_CHANNEL_IDS.lfp, since: new Date(now - getiRetentionMs("lfp")), until: new Date(now), ids: lfp.map((post) => post.messageId) },
    now,
  );
  const mine = async () => {
    const [rows] = await db.execute(`SELECT COUNT(*) AS total FROM bg_geti_posts WHERE message_id LIKE '${SEED_GETI_MESSAGE_PREFIX}%'`);
    return Number((rows as { total: number }[])[0]?.total ?? 0);
  };
  const beforePurge = await mine();
  await purgeExpiredGetiPosts(db, now);
  const afterPurge = await mine();
  if (
    outcome.stored !== posts.length + 1 ||
    outcome.expired !== expired.length ||
    removed !== 1 ||
    reconciled !== 0 ||
    beforePurge !== posts.length ||
    afterPurge !== posts.length
  ) {
    throw new Error(
      `annonces GETI : bilan inattendu (${outcome.stored} gardées, ${outcome.expired} périmée(s), ${removed} supprimée(s), ${reconciled} réconciliée(s), ${beforePurge} puis ${afterPurge} après purge)`,
    );
  }

  const counts: string[] = [];
  for (const category of GETI_CATEGORIES) {
    const page = await listGetiPosts({ category, includeUnknown: true }, { pageSize: 100 }, db, now);
    const seeded = page.posts.filter((post) => post.messageId.startsWith(SEED_GETI_MESSAGE_PREFIX));
    const expected = FICTIONAL_GETI_POSTS.filter((post) => post.category === category);
    const unread = seeded.filter((post) => post.authorTag === null).length;
    if (seeded.length !== expected.length || unread > 0) {
      throw new Error(`annonces GETI : ${seeded.length} relue(s) en ${category} (${unread} sans pseudo), ${expected.length} attendue(s)`);
    }
    counts.push(`${category} ${seeded.length}`);
  }
  const relays = FICTIONAL_GETI_POSTS.filter((post) => post.relayedFrom !== undefined).length;
  console.log(`  ✓ ${posts.length} annonces créées (${counts.join(" · ")} ; ${relays} relais, ${posts.length - relays} directes)`);
}
