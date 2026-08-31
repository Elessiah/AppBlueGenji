/**
 * Stub des feuilles de style pour Jest.
 *
 * Un test qui importe un composant importe aussi son module CSS, que Node ne
 * sait pas lire. Le proxy rend le nom de la classe demandée, ce qui suffit :
 * les tests portent sur la logique, jamais sur le nom de classe généré.
 */
module.exports = new Proxy(
    {},
    {
        get: (_target, key) => (key === "__esModule" ? false : String(key)),
    },
);
