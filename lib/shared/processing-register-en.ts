/**
 * Record of processing activities — English translation (lot 7b-2, D1) of
 * `processing-register.ts`, whose French text prevails.
 *
 * Since LEGAL-FILES-DEDUP, both languages are written once, side by side, in
 * `processing-register.ts`: each activity is keyed by its reference (`T01`…)
 * and every text that changes between languages is a `{ fr, en }` pair
 * (`lib/shared/bilingual.ts`). Same activities, same order, same number of
 * items in every heading and the same constants for every duration therefore
 * hold by construction. This module only keeps the English entry points where
 * the pages import them. `REGISTER_UPDATED_AT` is the French register's: a
 * translation is not an update. The CSV export (`/rgpd/registre.csv`) stays
 * French — it is the document handed to the CNIL, in its own model and
 * language.
 */
export {
  ASSOCIATION_GMAIL_FRAMEWORK_EN,
  HETZNER_BACKUP_FRAMEWORK_EN,
  HOST_ARRANGEMENT_EN,
  OUTLOOK_MAIL_FRAMEWORK_EN,
  PROCESSING_ACTIVITIES_EN,
  REGISTER_SCOPE_DETAIL_EN,
  REGISTER_SCOPE_EN,
  RGPD_CONTACT_LINE_EN,
  SPICEWORKS_PROCESSOR_FRAMEWORK_EN,
  SPICEWORKS_SCC_FALLBACK_EN,
  STANDARD_CONTRACTUAL_CLAUSES_EN,
  registerControllerEn,
  transferBasisEn,
} from "@/lib/shared/processing-register";
