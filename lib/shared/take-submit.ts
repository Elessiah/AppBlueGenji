/**
 * Prend l'envoi d'un formulaire de fenêtre : le navigateur ne navigue pas, et
 * l'événement **ne remonte pas**.
 *
 * Les fenêtres du profil (code du bot, certification du tag) sont portées dans
 * `document.body`, mais React fait remonter leurs événements par l'arbre des
 * composants : sans cela, l'envoi d'un code arriverait jusqu'au formulaire du
 * profil qui les contient et pourrait déclencher son enregistrement. La garde de
 * la page (`event.target !== event.currentTarget`) reste, mais ne porte plus
 * seule cette règle.
 *
 * Module **pur**.
 */
export function takeSubmit(event: { preventDefault: () => void; stopPropagation: () => void }): void {
  event.preventDefault();
  event.stopPropagation();
}
