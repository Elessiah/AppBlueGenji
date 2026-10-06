/**
 * Contenus éditoriaux du jeu de test : partenaires, membres du bureau et
 * annonces de recrutement.
 */

import type { Pool } from "mysql2/promise";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { toServedUploadUrl } from "@/lib/shared/uploads";

export const FICTIONAL_BUREAU = [
  { name: "Léo Perreaut", role: "Président", role_en: "President", initials: "LP", color: "rgb(89, 212, 255)" },
  { name: "Bryan Boulleaux", role: "Trésorier", role_en: "Treasurer", initials: "BB", color: "rgb(247, 138, 216)" },
  { name: "Sophie Martin", role: "Secrétaire", role_en: "Secretary", initials: "SM", color: "rgb(62, 232, 176)" },
  { name: "Jérôme Dubois", role: "Responsable arbitrage", role_en: "Head of refereeing", initials: "JD", color: "rgb(167, 115, 255)" },
];

// Les trois visages d'une carte partenaire (`lib/shared/sponsor-card.ts`) :
// bandeau + logo, logo seul, bandeau seul — le quatrième, inactif, n'a rien.
export const FICTIONAL_SPONSORS = [
  { name: "Test - HyperX", slug: "test-hyperx", tier: "GOLD" as const, website_url: "https://example.com/hyperx", description: "Périphériques gaming haute performance", description_en: "High-performance gaming peripherals", banner: true, logo: true },
  { name: "Test - SteelSeries", slug: "test-steelseries", tier: "SILVER" as const, website_url: "https://example.com/steelseries", description: "Équipement esport de référence", description_en: "Benchmark esports gear", banner: false, logo: true },
  { name: "Test - Red Bull", slug: "test-redbull", tier: "BRONZE" as const, website_url: "https://example.com/redbull", description: "Énergie pour les champions", description_en: "Energy for champions", banner: true, logo: false },
  { name: "Test - Discord", slug: "test-discord", tier: "PARTNER" as const, website_url: "https://example.com/discord", description: "La plateforme officielle de la communauté", description_en: "The community's official platform", banner: false, logo: false },
];

// Annonces de recrutement : couvre l'aperçu tronqué des longues descriptions
// (le cas qui a motivé la modale de lecture), les trois statuts, le cas
// « plusieurs prioritaires » — une seule modale qui se feuillette, et une
// banderole qui défile —, le brouillon inactif, et une facultative placée en
// tête de l'ordre d'affichage : le tri par statut doit la ranger malgré tout
// sous « Autres recrutements ». Chaque annonce a son anglais (lot 5b), sauf
// la dernière : une annonce d'avant la traduction, absente de `/en/recrutement`
// et marquée **EN** dans son éditeur — le cas du rattrapage en production.
export const FICTIONAL_RECRUITMENT_ADS = [
  {
    title: "Test - BlueGenji recrute des Admins",
    title_en: "Test - BlueGenji is recruiting Admins",
    roles_en: "Moderation, tickets, tournament check-ins",
    body_en: "Following a break in our activities, we're looking for new faces for the Admin role.\n\nWhat we offer:\nA clear structure and professional guidance. The association has existed since 2022 as a French nonprofit (law of 1901), which gives us the experience to know what this role needs.\n\nWhat the role involves:\n\n- Keep an eye on text channels to spot toxic behavior, conflicts or spam.\n\n- Step in right away when something goes wrong (reminding the rules, mute, kick if needed).\n\n- Answer member reports quickly.\n\n- Open, sort and handle tickets by category.\n\n- Run tournament check-ins and handle issues during matches.\n\n- Help brainstorm, design and set up events.\n\n- Relay or enforce urgent decisions from the heads of teams.\n\nThe tools you'll have:\nThree Discord servers (main, Marvel Rivals, teams), plus an external ticketing tool to track your tasks and work with the rest of the staff.\n\nIf the role interests you:\nApply directly with the button below, or DM us on Discord so we can talk, get to know each other and maybe set up a voice interview.",
    team_name: "Pôle administration",
    domain: "ADMIN" as const,
    roles: "Modération, tickets, check-ins de tournoi",
    body: "Suite à une pause dans nos activités, nous recherchons de nouvelles têtes pour le poste d'Admin.\n\nCe que nous offrons:\nUne structure claire et un encadrement professionnel. L'association existe depuis 2022 et est sous loi 1901, ce qui nous donne l'expérience nécessaire pour connaître les besoins de ce rôle.\n\nEn quoi consiste le rôle:\n\n- Surveiller les salons textuels pour repérer comportements toxiques, conflits ou spam.\n\n- Intervenir immédiatement en cas de problème (rappel des règles, mute, kick si nécessaire).\n\n- Répondre rapidement aux signalements des membres.\n\n- Ouvrir, trier et gérer les tickets selon leur catégorie.\n\n- Effectuer les check-ins en tournoi et gérer les problèmes pendant les matchs.\n\n- Aider au brainstorm et à la conception des évènements ainsi que leur mise en place.\n\n- Relayer ou faire appliquer les décisions urgentes des directeurs de pôles.\n\nLes outils à disposition:\nTrois serveurs Discord (principal, Marvel Rivals, équipes), ainsi qu'un outil de ticketing externe permettant le suivi de vos tâches et la collaboration avec le reste du staff.\n\nSi le rôle t'intéresse:\nPostule directement via le bouton ci-dessous, ou contacte-nous sur Discord en message privé pour qu'on puisse discuter, échanger, et pourquoi pas planifier un entretien vocal.",
    contact_url: "https://example.com/ticket/admin",
    contact_discord: "recrutement_bg",
    contact_discord_id: "123456789012345678",
    contact_preferred: "DISCORD" as const,
    priority: "PRIORITY" as const,
    active: 1,
  },
  {
    title: "Test - BlueGenji recrute un Graphiste",
    title_en: "Test - BlueGenji is recruiting a Graphic designer",
    roles_en: "Visual identity, posters, overlays",
    body_en: "As our events start up again, we're looking for a graphic designer to handle our visual needs.\n\nWhat we offer:\nA friendly setting, varied projects and real creative freedom over the season's art direction.\n\nWhat the role involves:\n\n- Work with the communication team to define visual needs.\n\n- Write a brand guidelines document for the association.\n\n- Create visual communication material: logos, posters, brochures.\n\n- Be able to make last-minute changes to a visual.\n\n- Set up and maintain a well-organized shared workspace.\n\nThe tools you'll have:\nAn external ticketing tool to track tasks, and regular check-ins with the communication team.\n\nIf the role interests you:\nApply with the link, or come and talk about it on Discord.",
    team_name: "Pôle communication",
    domain: "DESIGN" as const,
    roles: "Identité visuelle, affiches, overlays",
    body: "Suite à une reprise de nos événements, nous recherchons un graphiste pour assurer nos besoins visuels.\n\nCe que nous offrons:\nUn cadre bienveillant, des projets variés et une vraie liberté créative sur la direction artistique de la saison.\n\nEn quoi consiste le rôle:\n\n- Collaborer avec le pôle communication pour définir les besoins visuels.\n\n- Élaborer un cahier des normes graphiques pour l'association.\n\n- Créer les éléments de communication visuelle : logos, affiches, brochures.\n\n- Pouvoir effectuer des modifications de dernière minute sur un visuel.\n\n- Mettre en place et tenir un espace de travail partagé bien organisé.\n\nLes outils à disposition:\nUn outil de ticketing externe pour le suivi des tâches, et des points réguliers avec le pôle communication.\n\nSi le rôle t'intéresse:\nPostule via le lien, ou viens en parler sur Discord.",
    contact_url: "https://example.com/ticket/design",
    contact_discord: DISCORD_INVITE_URL,
    contact_discord_id: null,
    contact_preferred: "LINK" as const,
    // Deuxième prioritaire : seconde page de la modale d'arrivée.
    priority: "PRIORITY" as const,
    active: 1,
  },
  {
    title: "Test - Arbitres pour les tournois du dimanche",
    title_en: "Test - Referees for the Sunday tournaments",
    roles_en: "Referee matches, handle disputes",
    body_en: "Two tournaments a month, on Sunday afternoons. Training is provided by the team: no prior experience needed, just rigour and availability.",
    team_name: "Pôle arbitrage",
    domain: "ARBITRAGE" as const,
    roles: "Arbitrer les matchs, gérer les litiges",
    body: "Deux tournois par mois, le dimanche après-midi. Formation assurée par le pôle : aucune expérience préalable n'est demandée, seulement de la rigueur et de la disponibilité.",
    contact_url: null,
    contact_discord: "arbitrage_bg",
    contact_discord_id: null,
    contact_preferred: "AUTO" as const,
    // Importante : banderole seulement, sans pastille « Urgente ».
    priority: "IMPORTANT" as const,
    active: 1,
  },
  {
    title: "Test - Caster pour les finales",
    title_en: "Test - Caster for the finals",
    roles_en: null,
    body_en: "Commentate the finals live, one evening a month.",
    team_name: null,
    domain: "CASTING" as const,
    roles: null,
    // Description courte : la carte l'affiche en entier, sans « lire la suite ».
    body: "Commenter les finales en direct, une soirée par mois.",
    contact_url: "https://example.com/ticket/casting",
    contact_discord: null,
    contact_discord_id: null,
    contact_preferred: "AUTO" as const,
    priority: "OPTIONAL" as const,
    active: 1,
  },
  {
    title: "Test - Développeur (brouillon)",
    title_en: "Test - Developer (draft)",
    roles_en: null,
    body_en: null,
    team_name: "Pôle dev",
    domain: "DEV" as const,
    roles: null,
    body: null,
    contact_url: null,
    contact_discord: null,
    contact_discord_id: null,
    contact_preferred: "AUTO" as const,
    // Brouillon prioritaire : inactif, donc jamais mis en avant.
    priority: "PRIORITY" as const,
    active: 0,
  },
  {
    title: "Test - Annonce d'avant la traduction",
    title_en: null,
    roles_en: null,
    body_en: null,
    team_name: "Pôle communication",
    domain: "COMMUNICATION" as const,
    roles: "Réseaux sociaux",
    body: "Annonce saisie avant le lot 5b : pas d'anglais, donc absente de la page anglaise.",
    contact_url: null,
    contact_discord: "com_bg",
    contact_discord_id: null,
    contact_preferred: "AUTO" as const,
    priority: "OPTIONAL" as const,
    active: 1,
  },
];

/**
 * Écrit une image de partenaire de test sous `public/uploads/sponsors` : un vrai
 * fichier, pour que les cartes de la matrice se présentent comme en production
 * (et non avec une URL étrangère, qu'elles refuseraient d'afficher). Un fichier
 * **par partenaire** : supprimer ou remplacer l'image de l'un efface son fichier.
 */
async function ensureSeedSponsorImage(slug: string, kind: "banner" | "logo"): Promise<string> {
  const dir = path.join(process.cwd(), "public", "uploads", "sponsors");
  const filename = `seed-${slug}-${kind}.webp`;
  await mkdir(dir, { recursive: true });
  const [width, height] = kind === "banner" ? [1200, 400] : [256, 256];
  const svg =
    kind === "banner"
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="#0b1a2c"/><stop offset="1" stop-color="#1d5f8a"/></linearGradient></defs>` +
        `<rect width="100%" height="100%" fill="url(#g)"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<text x="128" y="160" font-family="sans-serif" font-size="110" font-weight="700"` +
        ` fill="#5ac8ff" text-anchor="middle">${slug.replace(/^test-/, "").slice(0, 2).toUpperCase()}</text></svg>`;
  const image = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .webp({ quality: 82 })
    .toBuffer();
  await writeFile(path.join(dir, filename), image);
  return toServedUploadUrl(`/uploads/sponsors/${filename}`);
}

export async function createSponsors(db: Pool): Promise<void> {
  console.log("🤝 Création des sponsors...");
  for (let i = 0; i < FICTIONAL_SPONSORS.length; i++) {
    const s = FICTIONAL_SPONSORS[i];
    try {
      const bannerUrl = s.banner ? await ensureSeedSponsorImage(s.slug, "banner") : null;
      const logoUrl = s.logo ? await ensureSeedSponsorImage(s.slug, "logo") : null;
      await db.execute(
        `INSERT INTO bg_sponsors (name, slug, tier, logo_url, banner_url, website_url, description, description_en, display_order, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        // Le dernier sponsor est inactif : couvre le filtrage de la page partenaires.
        [s.name, s.slug, s.tier, logoUrl, bannerUrl, s.website_url, s.description, s.description_en, (i + 1) * 10, i === FICTIONAL_SPONSORS.length - 1 ? 0 : 1]
      );
    } catch (error) {
      console.error(`  ✗ ${s.name}:`, (error as Error).message);
    }
  }
  console.log(`  ✓ ${FICTIONAL_SPONSORS.length} sponsors créés (dont 1 inactif)`);
}

export async function createRecruitmentAds(db: Pool): Promise<void> {
  console.log("📣 Création des annonces de recrutement...");
  for (let i = 0; i < FICTIONAL_RECRUITMENT_ADS.length; i++) {
    const ad = FICTIONAL_RECRUITMENT_ADS[i];
    try {
      await db.execute(
        `INSERT INTO bg_recruitment_ads
           (title, title_en, roles_en, body_en, team_name, domain, roles, body, contact_url, contact_discord,
            contact_discord_id, contact_preferred, priority, active, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ad.title,
          ad.title_en,
          ad.roles_en,
          ad.body_en,
          ad.team_name,
          ad.domain,
          ad.roles,
          ad.body,
          ad.contact_url,
          ad.contact_discord,
          ad.contact_discord_id,
          ad.contact_preferred,
          ad.priority,
          ad.active,
          // La facultative passe en tête de l'ordre brut (voir plus haut).
          ad.priority === "OPTIONAL" ? 0 : (i + 1) * 10,
        ]
      );
    } catch (error) {
      console.error(`  \u2717 ${ad.title}:`, (error as Error).message);
    }
  }
  const published = FICTIONAL_RECRUITMENT_ADS.filter((a) => a.active === 1);
  const count = (priority: string) => published.filter((a) => a.priority === priority).length;
  console.log(
    `  ✓ ${FICTIONAL_RECRUITMENT_ADS.length} annonces créées (dont 1 brouillon · ` +
      `${count("PRIORITY")} prioritaires, ${count("IMPORTANT")} importante(s), ${count("OPTIONAL")} facultative(s))`
  );
}

export async function createBureau(db: Pool): Promise<void> {
  console.log("🏛️  Création des membres du bureau...");
  for (let i = 0; i < FICTIONAL_BUREAU.length; i++) {
    const m = FICTIONAL_BUREAU[i];
    try {
      await db.execute(
        `INSERT INTO bg_bureau_members (name, role, role_en, initials, color, display_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [m.name, m.role, m.role_en, m.initials, m.color, (i + 1) * 10]
      );
    } catch (error) {
      console.error(`  ✗ ${m.name}:`, (error as Error).message);
    }
  }
  console.log(`  ✓ ${FICTIONAL_BUREAU.length} membres du bureau créés`);
}
