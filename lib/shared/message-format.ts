/**
 * Formateur ICU **réduit**, pour les textes de la coquille rendus côté client
 * (`components/i18n/shell-text.tsx`).
 *
 * La coquille (menu d'accessibilité, notifications, en-têtes…) est montée sur
 * **toutes** les pages : y charger `next-intl` côté client enverrait ~12 Ko
 * compressés de formateur à chaque visiteur, page traduite ou non
 * (`docs/features/I18N.md` § Découpage par route). Ses messages n'emploient
 * qu'un sous-ensemble d'ICU, interprété ici en quelques lignes :
 *
 * - `{nom}` — valeur insérée telle quelle (`String(valeur)`, comme ICU) ;
 * - `{nom, plural, =0 {…} one {…} other {…}}` et `#` dans une branche ;
 * - `<balise>…</balise>` — mise en forme riche, confiée à l'appelant.
 *
 * Rien d'autre : pas de `select`, de `number`, de `date`, ni d'échappement par
 * apostrophe (`'{`). Un message de la coquille qui en aurait besoin casse le
 * test d'équivalence avec `next-intl` (`tests/lib/shared/message-format.test.ts`),
 * qui formate chaque message des deux façons.
 */

export type MessageValues = Readonly<Record<string, string | number>>;

type MessageNode =
  | { kind: "text"; value: string }
  | { kind: "argument"; name: string }
  | { kind: "plural"; name: string; options: Readonly<Record<string, MessageNode[]>> }
  | { kind: "pound" }
  | { kind: "tag"; name: string; children: MessageNode[] };

class MessageSyntaxError extends Error {
  constructor(source: string, index: number, reason: string) {
    super(`Message ICU non pris en charge (${reason}) à la position ${index} : ${source}`);
    this.name = "MessageSyntaxError";
  }
}

const TAG_NAME = /^[A-Za-z][\w-]*/;
const ARGUMENT_NAME = /^[A-Za-z_]\w*$/;

type ParseContext = { inPlural: boolean; closingTag: string | null; nested: boolean };

class Parser {
  private index = 0;

  constructor(private readonly source: string) {}

  parseMessage(): MessageNode[] {
    const nodes = this.parseNodes({ inPlural: false, closingTag: null, nested: false });
    if (this.index < this.source.length) this.fail("fin inattendue");
    return nodes;
  }

  private fail(reason: string): never {
    throw new MessageSyntaxError(this.source, this.index, reason);
  }

  private parseNodes(context: ParseContext): MessageNode[] {
    const nodes: MessageNode[] = [];
    let text = "";
    const flush = () => {
      if (text) nodes.push({ kind: "text", value: text });
      text = "";
    };
    while (this.index < this.source.length && !this.atEnd(context)) {
      const node = this.parseSpecial(context);
      if (node) {
        flush();
        nodes.push(node);
      } else {
        text += this.source[this.index];
        this.index += 1;
      }
    }
    flush();
    return nodes;
  }

  /** Fin de la suite en cours : `}` d'une branche, `</…>` d'une balise. */
  private atEnd(context: ParseContext): boolean {
    if (this.source[this.index] === "}") {
      if (!context.nested) this.fail("accolade fermante orpheline");
      return true;
    }
    if (this.source.startsWith("</", this.index)) {
      if (context.closingTag === null) this.fail("balise fermante orpheline");
      return true;
    }
    return false;
  }

  /** Argument, `#` d'une branche de pluriel ou balise ; `null` pour un caractère de texte. */
  private parseSpecial(context: ParseContext): MessageNode | null {
    const char = this.source[this.index];
    if (char === "{") return this.parseArgument();
    if (char === "<") return this.parseTag(context);
    if (char === "#" && context.inPlural) {
      this.index += 1;
      return { kind: "pound" };
    }
    return null;
  }

  private skipSpaces(): void {
    while (/\s/.test(this.source[this.index] ?? "")) this.index += 1;
  }

  private readUntil(stops: string): string {
    const start = this.index;
    while (this.index < this.source.length && !stops.includes(this.source[this.index])) this.index += 1;
    return this.source.slice(start, this.index).trim();
  }

  private expect(char: string): void {
    if (this.source[this.index] !== char) this.fail(`« ${char} » attendu`);
    this.index += 1;
  }

  private parseArgument(): MessageNode {
    this.expect("{");
    const name = this.readUntil(",}");
    if (!ARGUMENT_NAME.test(name)) this.fail("nom d'argument");
    if (this.source[this.index] === "}") {
      this.index += 1;
      return { kind: "argument", name };
    }
    this.expect(",");
    const type = this.readUntil(",}");
    if (type !== "plural") this.fail(`type « ${type} »`);
    this.expect(",");
    const options: Record<string, MessageNode[]> = {};
    for (;;) {
      this.skipSpaces();
      if (this.source[this.index] === "}") break;
      const selector = this.readUntil("{} \t\n");
      if (!selector) this.fail("sélecteur de pluriel");
      this.skipSpaces();
      this.expect("{");
      options[selector] = this.parseNodes({ inPlural: true, closingTag: null, nested: true });
      this.expect("}");
    }
    if (!("other" in options)) this.fail("branche « other » absente");
    this.expect("}");
    return { kind: "plural", name, options };
  }

  private parseTag(context: ParseContext): MessageNode {
    this.expect("<");
    const name = TAG_NAME.exec(this.source.slice(this.index))?.[0];
    if (!name) this.fail("nom de balise");
    this.index += name.length;
    this.expect(">");
    const children = this.parseNodes({ inPlural: context.inPlural, closingTag: name, nested: context.nested });
    const closing = `</${name}>`;
    if (!this.source.startsWith(closing, this.index)) this.fail(`« ${closing} » attendu`);
    this.index += closing.length;
    return { kind: "tag", name, children };
  }
}

const parsed = new Map<string, MessageNode[]>();

/** L'arbre d'un message, analysé une fois puis gardé (les messages sont en nombre fini). */
export function parseMessage(source: string): MessageNode[] {
  let nodes = parsed.get(source);
  if (!nodes) {
    nodes = new Parser(source).parseMessage();
    parsed.set(source, nodes);
  }
  return nodes;
}

/** Rendu d'une balise riche : reçoit ses enfants déjà formatés. */
export type TagRenderer<T> = (children: Array<string | T>) => T;

function pluralBranch(
  node: Extract<MessageNode, { kind: "plural" }>,
  count: number,
  locale: string,
): MessageNode[] {
  const exact = node.options[`=${count}`];
  if (exact) return exact;
  return node.options[new Intl.PluralRules(locale).select(count)] ?? node.options.other;
}

function formatNodes<T>(
  nodes: readonly MessageNode[],
  locale: string,
  values: MessageValues,
  tags: Readonly<Record<string, TagRenderer<T>>>,
  count: number | null,
): Array<string | T> {
  const out: Array<string | T> = [];
  const push = (part: string | T) => {
    const last = out.at(-1);
    if (typeof part === "string" && typeof last === "string") out[out.length - 1] = last + part;
    else out.push(part);
  };
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        push(node.value);
        break;
      case "argument":
        push(String(values[node.name] ?? ""));
        break;
      case "pound":
        push(new Intl.NumberFormat(locale).format(count ?? 0));
        break;
      case "plural": {
        const n = Number(values[node.name] ?? 0);
        for (const part of formatNodes(pluralBranch(node, n, locale), locale, values, tags, n)) push(part);
        break;
      }
      case "tag": {
        const render = tags[node.name];
        const children = formatNodes(node.children, locale, values, tags, count);
        if (render) push(render(children));
        else for (const part of children) push(part);
        break;
      }
    }
  }
  return out;
}

/** Message formaté en morceaux : texte et rendus des balises riches. */
export function formatMessageParts<T>(
  locale: string,
  source: string,
  values: MessageValues = {},
  tags: Readonly<Record<string, TagRenderer<T>>> = {},
): Array<string | T> {
  return formatNodes(parseMessage(source), locale, values, tags, null);
}

/** Message formaté en texte brut (une balise riche n'y laisse que son contenu). */
export function formatMessage(locale: string, source: string, values: MessageValues = {}): string {
  return formatMessageParts<string>(locale, source, values).join("");
}
