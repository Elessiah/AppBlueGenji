import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Câblage de l'image d'un tournoi, là où une panne serait **muette** : une
 * colonne oubliée dans un `SELECT` rend `image: null` partout sans une erreur,
 * une colonne absente d'un `GROUP BY` ne casse qu'en production
 * (`ONLY_FULL_GROUP_BY`), et un écran qui oublie le composant n'affiche
 * simplement rien.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const IMAGE_COLUMNS = ["image_url", "image_fit", "image_focus_x", "image_focus_y"];

describe("lectures d'une carte de tournoi", () => {
  const readers = {
    "liste des tournois (index.ts)": read("lib/server/tournaments/index.ts"),
    "carte d'un tournoi (repository.ts)": read("lib/server/tournaments/repository.ts"),
  };

  it.each(Object.entries(readers))("%s sélectionne et regroupe les quatre colonnes", (_, source) => {
    const query = source.match(/COALESCE\(COUNT\(r\.id\), 0\) AS registered_teams[\s\S]*?GROUP BY([\s\S]*?)(`|ORDER BY)/);
    expect(query).not.toBeNull();
    const selectPart = source.slice(0, source.indexOf(query![0]));
    const groupBy = query![1];
    for (const column of IMAGE_COLUMNS) {
      expect(selectPart).toContain(`t.${column},`);
      expect(groupBy).toContain(`t.${column}`);
    }
  });

  it("mapCard passe la ligne par la lecture tolérante et filtrée", () => {
    expect(read("lib/server/tournaments/_internal.ts")).toContain(
      "image: parseTournamentImage(row.image_url, row.image_fit, row.image_focus_x, row.image_focus_y)",
    );
  });
});

describe("schéma", () => {
  const database = read("lib/server/database.ts");

  it("déclare les colonnes pour une base neuve et les ajoute à une base qui tourne", () => {
    const create = database.match(/CREATE TABLE IF NOT EXISTS bg_tournaments \(([\s\S]*?)\) ENGINE/);
    expect(create).not.toBeNull();
    for (const column of IMAGE_COLUMNS) {
      expect(create![1]).toMatch(new RegExp(`\\n\\s*${column} `));
      expect(database).toMatch(new RegExp(`ALTER TABLE bg_tournaments ADD COLUMN ${column} `));
    }
  });

  it("garde la colonne d'URL facultative : l'image n'est jamais obligatoire", () => {
    expect(database).toMatch(/\n\s*image_url VARCHAR\(255\) NULL,/);
  });
});

describe("écrans", () => {
  it("la fiche porte le bandeau et la pastille, et n'ouvre le réglage qu'au staff", () => {
    const header = read("app/(secured)/tournois/[id]/_components/TournamentHeader.tsx");
    expect(header).toMatch(/<TournamentImageBanner\s+image=\{card\.image\}/);
    expect(header).toMatch(/<TournamentImageEmblem image=\{card\.image\}/);
    expect(header).toContain("const showImageEdit = detail.isAdmin && !frozen;");
    expect(header).toMatch(/\{showImageEdit && \([\s\S]{0,200}onClick=\{onEditImage\}/);
  });

  it("la page monte le dialogue pour le staff seulement, et le referme au changement de tournoi", () => {
    const page = read("app/(secured)/tournois/[id]/page.tsx");
    expect(page).toContain("{imageDialogOpen && detail.isAdmin && !frozen && (");
    expect(page).toMatch(/<TournamentImageDialog[\s\S]{0,200}image=\{detail\.card\.image\}/);
    expect(page).toContain("useEffect(() => setImageDialogOpen(false), [tournamentId]);");
    expect(page).toContain("onEditImage={() => setImageDialogOpen(true)}");
  });

  it("la modale se réaligne sur l'image du flux, mais jamais pendant son propre envoi", () => {
    const dialog = read("app/(secured)/tournois/[id]/_components/TournamentImageDialog.tsx");
    expect(dialog).toContain("if (!busy && imageFingerprint(base) !== imageFingerprint(image)) {");
    expect(dialog).toContain("resyncImageDraft(base, image, value)");
    // CLAUDE.md : une zone qui défile passe par <ScrollArea>.
    expect(dialog).toContain('<ScrollArea orientation="y"');
    expect(dialog).not.toMatch(/overflowY:\s*"auto"/);
  });

  it("la liste charge en priorité les premiers bandeaux, dans l'ordre d'affichage", () => {
    const page = read("app/(secured)/tournois/page.tsx");
    expect(page).toMatch(/const priorityBanners = priorityBannerIds\(\[/);
    for (const card of ["StateCard t={t}", "RunningCard key={t.id} t={t}", "RegistrationCard key={t.id} t={t}", "UpcomingCard key={t.id} t={t}"]) {
      expect(page).toContain(`<${card} priority={priorityBanners.has(t.id)} />`);
    }
  });

  it("les quatre cartes de /tournois posent le bandeau et la pastille", () => {
    for (const name of ["FinishedCard", "RegistrationCard", "RunningCard", "UpcomingCard"]) {
      const source = read(`app/(secured)/tournois/cards/${name}.tsx`);
      expect(source).toMatch(/<TournamentImageBanner\s+image=\{t\.image\}[\s\S]{0,200}priority=\{priority\}/);
      expect(source).toContain("<TournamentImageEmblem image={t.image}");
    }
  });

  it("l'accueil habille le tournoi mis en avant comme les suivants", () => {
    const board = read("components/cyber/landing/TournamentBoard.tsx");
    expect(board).toContain("image={featured.image}");
    expect(board).toContain("image={card.image}");
  });

  it("la création envoie l'image une fois le tournoi né, sans défaire la création sur un échec", () => {
    const form = read("app/(secured)/tournois/_components/TournamentForm.tsx");
    expect(form).toMatch(/\{mode === "create" && \([\s\S]{0,300}<TournamentImagePicker existing=\{null\}/);
    const create = read("app/(secured)/tournois/creer/page.tsx");
    expect(create).toContain("await applyImageChange(payload.id, imagePickerChange(null, image), image.file);");
    const upload = create.indexOf("applyImageChange(payload.id");
    expect(create.indexOf("router.push(`/tournois/${payload.id}`)")).toBeGreaterThan(upload);
    expect(create.slice(create.lastIndexOf("try {", upload), upload)).toContain("try {");
  });

  it("la suppression d'un tournoi efface son fichier après le commit", () => {
    const deletion = read("lib/server/tournaments/deletion.ts");
    expect(deletion.indexOf("await deleteStoredImage(imagePath)")).toBeGreaterThan(
      deletion.indexOf("await connection.commit()"),
    );
  });
});
