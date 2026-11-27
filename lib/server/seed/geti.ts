/**
 * Annonces GETI du jeu de test : quelques annonces de synthèse par catégorie
 * (pseudos, identifiants, équipes et serveurs factices), posées par le même
 * chemin que le bot (`parsePushedPost` puis `upsertGetiPosts`) — le seed est
 * le seul endroit où ce SQL se joue sur une vraie base.
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
import { GETI_CATEGORIES, GETI_CHANNEL_IDS, type GetiCategory } from "@/lib/shared/geti";
import { GETI_RETENTION_MS } from "@/lib/shared/geti/ingest";

/** Identifiants de message factices : `1000000000000009NN`, hors de toute plage réelle des six salons (effacés par `cleanup.ts`). */
export const SEED_GETI_MESSAGE_PREFIX = "1000000000000009";
const FAKE_BOT = { id: "100000000000000090", username: "Test_RelaisBot", discriminator: "0", bot: true };

type SeedGetiPost = {
  category: GetiCategory;
  /** Âge de l'annonce, en heures. */
  ageHours: number;
  /** Message d'un joueur… */
  author?: string;
  content?: string;
  /** … ou relais d'un bot : ligne d'auteur et description de l'encart. */
  relay?: { authorName: string; description: string; mention?: { id: string; username: string } };
  /** Modifiée une heure après sa publication. */
  edited?: boolean;
};

const DAY = 24;

export const FICTIONAL_GETI_POSTS: readonly SeedGetiPost[] = [
  {
    category: "lfp",
    ageHours: 2,
    author: "test_geti_capitaine",
    content:
      "LFP — Team Test Aurore cherche un main tank Master 3 à GM 5, EU, PC, francophone. Scrims lundi, mercredi et vendredi 21h-23h CET. 18+.",
  },
  {
    category: "lfp",
    ageHours: 3 * DAY,
    relay: {
      authorName: "Test_Nova (@test_geti_nova)",
      description:
        "Recherche DPS hitscan Diamant 2 minimum pour roster Test Comète (EU, PC). FR/EN. Entraînements mardi et jeudi 20h30-22h30.\n*Sent from : [Test Serveur Comète](https://discord.gg/test)* by <@100000000000000011>",
    },
  },
  {
    category: "lfp",
    ageHours: 9 * DAY,
    author: "test_geti_owl",
    content: "LFP flex support plat à diam pour team chill, console, week-end surtout. Pas de prise de tête.",
    edited: true,
  },
  {
    category: "lft",
    ageHours: 5,
    author: "test_geti_luna",
    content: "LFT — support Master 2 (main Ana / Kiriko), EU, PC, dispo tous les soirs dès 20h. Francophone, 21 ans.",
  },
  {
    category: "lft",
    ageHours: 2 * DAY,
    author: "test_geti_rein",
    content: "Looking for team: tank GM4, DPS M1. EU, PC, English/French. Available Monday to Thursday 8-11pm CET.",
  },
  {
    category: "lft",
    ageHours: 12 * DAY,
    relay: {
      authorName: "Test Pseudo Affiché",
      description: "Joueur DPS Diamant 1 cherche équipe sérieuse, EU PC, FR. Contact : <@100000000000000012>",
      mention: { id: "100000000000000012", username: "test_geti_mentionne" },
    },
  },
  {
    category: "lfsub",
    ageHours: 1,
    author: "test_geti_coach",
    content: "LFSUB urgent ce soir 21h : un support Diamant 3 - Master 5 pour un scrim, EU, PC, FR.",
  },
  {
    category: "lfsub",
    ageHours: 6 * DAY,
    author: "test_geti_sub",
    content: "Team Test Zénith looking for a sub: off tank, Master+, EU, PC, EN. Scrims Tuesday and Sunday 9pm.",
  },
  {
    category: "lfstaff",
    ageHours: 8,
    author: "test_geti_manager",
    content: "LFSTAFF — équipe Test Boréale (Master) recherche un coach et un analyste, EU, francophone. Bénévole.",
  },
  {
    category: "lfstaff",
    ageHours: 10 * DAY,
    author: "test_geti_analyste",
    content: "Coach / manager dispo pour une structure Diamant à GM, PC, FR/EN, soirs de semaine.",
  },
  {
    category: "lfs",
    ageHours: 4,
    author: "test_geti_scrim",
    content: "LFS ce soir 21h-23h, Master 3 - GM 5, EU, PC. Team Test Aurore.",
  },
  {
    category: "lfs",
    ageHours: 4 * DAY,
    relay: {
      authorName: "test_geti_scrim2#4821",
      description: "LFS Diamant 2 à Master 4, jeudi 20h, EU, PC, FR.",
    },
  },
  {
    category: "lfcast",
    ageHours: 30,
    author: "test_geti_orga",
    content: "LFCAST — tournoi Test Hivernal samedi 15h, on cherche un caster et un observateur, FR.",
  },
  {
    category: "lfcast",
    ageHours: 7 * DAY,
    author: "test_geti_caster",
    content: "Caster FR/EN dispo pour vos matchs le week-end, PC, EU.",
  },
];

const HOUR_MS = 60 * 60 * 1000;

function messageId(index: number): string {
  return `${SEED_GETI_MESSAGE_PREFIX}${String(index).padStart(2, "0")}`;
}

/** Le corps tel que le bot le pousserait. */
function wirePost(post: SeedGetiPost, index: number, now: number): Record<string, unknown> {
  const postedAt = new Date(now - post.ageHours * HOUR_MS);
  return {
    id: messageId(index),
    channelId: GETI_CHANNEL_IDS[post.category],
    content: post.content ?? "",
    author: post.relay
      ? FAKE_BOT
      : { id: `1000000000000001${String(index).padStart(2, "0")}`, username: post.author, discriminator: "0", bot: false },
    embeds: post.relay ? [{ authorName: post.relay.authorName, description: post.relay.description }] : [],
    mentions: post.relay?.mention ? [{ ...post.relay.mention, discriminator: "0" }] : [],
    postedAt: postedAt.toISOString(),
    editedAt: post.edited ? new Date(postedAt.getTime() + HOUR_MS).toISOString() : null,
  };
}

function pushed(body: Record<string, unknown>): GetiPushedPost {
  const post = parsePushedPost(body);
  if (!post) throw new Error("annonce GETI du seed illisible");
  return post;
}

export async function createGetiPosts(db: Pool): Promise<void> {
  console.log("📡 Création des annonces GETI...");
  const now = Date.now();
  const posts = FICTIONAL_GETI_POSTS.map((post, index) => pushed(wirePost(post, index, now)));

  // Deux cas limites joués sur la vraie base : une annonce hors de la fenêtre
  // de garde (jamais enregistrée) et une annonce supprimée sur Discord.
  const expired = pushed(
    wirePost({ category: "lft", ageHours: 0, author: "test_geti_perime", content: "LFT trop ancien" }, 90, now - GETI_RETENTION_MS - HOUR_MS),
  );
  const deleted = pushed(
    wirePost({ category: "lfs", ageHours: 1, author: "test_geti_supprime", content: "LFS annulé" }, 91, now),
  );
  const outcome = await upsertGetiPosts(db, [...posts, expired, deleted], now);
  // Rejouée : la modification d'une annonce déjà gardée passe par `ON DUPLICATE KEY UPDATE`.
  await upsertGetiPosts(db, posts.slice(0, 1), now);
  const removed = await deleteGetiPosts(db, [deleted.messageId]);

  // Réconciliation d'un salon dont rien n'a disparu, puis purge : aucune ligne ne doit partir.
  const lfp = posts.filter((post) => post.category === "lfp");
  const reconciled = await reconcileGetiChannel(
    db,
    { channelId: GETI_CHANNEL_IDS.lfp, since: new Date(now - GETI_RETENTION_MS), until: new Date(now), ids: lfp.map((post) => post.messageId) },
    now,
  );
  const purged = await purgeExpiredGetiPosts(db, now);
  if (outcome.stored !== posts.length + 1 || outcome.expired !== 1 || removed !== 1 || reconciled !== 0 || purged !== 0) {
    throw new Error(
      `annonces GETI : bilan inattendu (${outcome.stored} gardées, ${outcome.expired} périmée(s), ${removed} supprimée(s), ${reconciled} réconciliée(s), ${purged} purgée(s))`,
    );
  }

  const counts: string[] = [];
  for (const category of GETI_CATEGORIES) {
    const page = await listGetiPosts({ category, includeUnknown: true }, { pageSize: 100 }, db, now);
    const mine = page.posts.filter((post) => post.messageId.startsWith(SEED_GETI_MESSAGE_PREFIX)).length;
    const expected = FICTIONAL_GETI_POSTS.filter((post) => post.category === category).length;
    if (mine !== expected) throw new Error(`annonces GETI : ${mine} relue(s) en ${category}, ${expected} attendue(s)`);
    counts.push(`${category} ${mine}`);
  }
  console.log(`  ✓ ${posts.length} annonces créées (${counts.join(" · ")})`);
}
