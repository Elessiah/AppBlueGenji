// Environnement commun à toute la suite.
//
// Le journal des suppressions de compte (`lib/server/account-deletion-journal.ts`)
// s'écrit par défaut dans `data/` du dépôt : tout test qui passe par
// `deleteOwnAccount` y déposerait une ligne. On le renvoie dans le dossier
// temporaire, un fichier par processus de test.
const os = require("node:os");
const path = require("node:path");

process.env.ACCOUNT_DELETION_JOURNAL_PATH = path.join(
  os.tmpdir(),
  `bg-test-account-deletions-${process.pid}.jsonl`,
);
