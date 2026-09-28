import { generateVapidKeys } from "./web-push";

/**
 * Tire une paire de clés VAPID pour les notifications push (`lib/server/web-push.ts`).
 *
 *     npm run push:keys
 *
 * À recopier dans `.env` (ou `.env.production`) **une fois pour toutes** : la clé
 * publique est gravée dans chaque abonnement d'appareil, et en changer rend tous
 * les abonnements existants muets — les joueurs devraient réactiver les
 * notifications sur chacun de leurs appareils.
 */
const { publicKey, privateKey } = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:contact@exemple.invalid  # à remplacer par une adresse de l'association");
