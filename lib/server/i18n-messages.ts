/**
 * Catalogue des messages de chaque langue — serveur seulement.
 *
 * Importé statiquement : le catalogue reste dans le paquet serveur, et le
 * navigateur n'en reçoit que les espaces de noms qu'un sous-arbre client
 * demande (`components/i18n/IntlMessages.tsx`).
 *
 * Le typage `Record<Locale, Messages>` fait du français la référence : une clé
 * anglaise manquante casse `npm run typecheck`. Une clé **en trop** passe (un
 * import JSON n'est pas un littéral) : c'est le test de parité qui la refuse
 * (`tests/lib/shared/i18n-messages-parity.test.ts`).
 */
import enCommon from "@/messages/en/common.json";
import frCommon from "@/messages/fr/common.json";
import enLanding from "@/messages/en/landing.json";
import frLanding from "@/messages/fr/landing.json";
import enShell from "@/messages/en/shell.json";
import frShell from "@/messages/fr/shell.json";
import enRules from "@/messages/en/rules.json";
import frRules from "@/messages/fr/rules.json";
import enRanking from "@/messages/en/ranking.json";
import frRanking from "@/messages/fr/ranking.json";
import enStats from "@/messages/en/stats.json";
import frStats from "@/messages/fr/stats.json";
import enLabels from "@/messages/en/labels.json";
import frLabels from "@/messages/fr/labels.json";
import enShare from "@/messages/en/share.json";
import frShare from "@/messages/fr/share.json";
import enLogin from "@/messages/en/login.json";
import frLogin from "@/messages/fr/login.json";
import enBot from "@/messages/en/bot.json";
import frBot from "@/messages/fr/bot.json";
import enAssociation from "@/messages/en/association.json";
import frAssociation from "@/messages/fr/association.json";
import enVolunteers from "@/messages/en/volunteers.json";
import frVolunteers from "@/messages/fr/volunteers.json";
import enRecruitment from "@/messages/en/recruitment.json";
import frRecruitment from "@/messages/fr/recruitment.json";
import enLegal from "@/messages/en/legal.json";
import frLegal from "@/messages/fr/legal.json";
import enTournaments from "@/messages/en/tournaments.json";
import frTournaments from "@/messages/fr/tournaments.json";
import enTournament from "@/messages/en/tournament.json";
import frTournament from "@/messages/fr/tournament.json";
import enTournamentViews from "@/messages/en/tournamentViews.json";
import frTournamentViews from "@/messages/fr/tournamentViews.json";
import enTournamentErrors from "@/messages/en/tournamentErrors.json";
import frTournamentErrors from "@/messages/fr/tournamentErrors.json";
import enTournamentActions from "@/messages/en/tournamentActions.json";
import frTournamentActions from "@/messages/fr/tournamentActions.json";
import enTournamentDialogs from "@/messages/en/tournamentDialogs.json";
import frTournamentDialogs from "@/messages/fr/tournamentDialogs.json";
import enTournamentImage from "@/messages/en/tournamentImage.json";
import frTournamentImage from "@/messages/fr/tournamentImage.json";
import enTournamentForm from "@/messages/en/tournamentForm.json";
import frTournamentForm from "@/messages/fr/tournamentForm.json";
import enLaunchModal from "@/messages/en/launchModal.json";
import frLaunchModal from "@/messages/fr/launchModal.json";
import type { Locale } from "@/lib/shared/locales";
import type { Messages } from "@/lib/shared/i18n-messages";

const CATALOG: Readonly<Record<Locale, Messages>> = {
  fr: { common: frCommon, landing: frLanding, shell: frShell, rules: frRules, ranking: frRanking, stats: frStats, labels: frLabels, share: frShare, login: frLogin, bot: frBot, association: frAssociation, volunteers: frVolunteers, recruitment: frRecruitment, legal: frLegal, tournaments: frTournaments, tournament: frTournament, tournamentViews: frTournamentViews, tournamentErrors: frTournamentErrors, tournamentActions: frTournamentActions, tournamentDialogs: frTournamentDialogs, tournamentImage: frTournamentImage, tournamentForm: frTournamentForm, launchModal: frLaunchModal },
  en: { common: enCommon, landing: enLanding, shell: enShell, rules: enRules, ranking: enRanking, stats: enStats, labels: enLabels, share: enShare, login: enLogin, bot: enBot, association: enAssociation, volunteers: enVolunteers, recruitment: enRecruitment, legal: enLegal, tournaments: enTournaments, tournament: enTournament, tournamentViews: enTournamentViews, tournamentErrors: enTournamentErrors, tournamentActions: enTournamentActions, tournamentDialogs: enTournamentDialogs, tournamentImage: enTournamentImage, tournamentForm: enTournamentForm, launchModal: enLaunchModal },
};

export function messagesFor(locale: Locale): Messages {
  return CATALOG[locale];
}
