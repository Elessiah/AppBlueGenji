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

// Notifications push éteintes par défaut : un `.env` de développement qui porte
// des clés VAPID ferait sinon partir les balayages (`dispatchMatchStartNotices`)
// contre une vraie base depuis n'importe quel test qui publie un évènement de
// tournoi. Des chaînes vides plutôt qu'un `delete` : `dotenv`, chargé plus tard
// par certains modules, n'écrase pas une variable déjà définie. Les tests du
// push injectent leur propre configuration.
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
