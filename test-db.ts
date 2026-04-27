import "dotenv/config";
import { getDatabase } from "@/lib/server/database";

(async () => {
  console.log("🔌 Test de connexion DB...");
  console.log(`DB_HOST: ${process.env.DB_HOST}`);
  console.log(`DB_USER: ${process.env.DB_USER}`);
  console.log(`DB_DATABASE: ${process.env.DB_DATABASE}`);

  try {
    console.log("⏳ Appel getDatabase()...");
    const db = await getDatabase();
    console.log("✅ Connexion OK");

    const [rows] = await db.execute("SELECT COUNT(*) as c FROM bg_users");
    console.log(`✅ bg_users count: ${(rows as any)[0].c}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Erreur:", error);
    process.exit(1);
  }
})();
