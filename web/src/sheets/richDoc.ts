/**
 * Белый список для документов TipTap - тот же, что server/app/richtext.py.
 *
 * Сервер чистит всё, что сохраняется, а RichText рисует только известное.
 * Здесь - перед тем как отдать документ редактору: TipTap падает на
 * незнакомых узлах, а документ мог прийти из старой версии или из файла.
 */

export interface DocNode {
  type: string;
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
  content?: DocNode[];
}

const NODES = new Set([
  "doc", "paragraph", "text", "hardBreak", "heading", "bulletList", "orderedList", "listItem", "resource",
  "horizontalRule",
]);
// LSS называет горизонтальную черту divider, TipTap - horizontalRule.
const ALIASES: Record<string, string> = { divider: "horizontalRule" };
const MARKS = new Set(["bold", "italic", "link"]);
const MAX_DEPTH = 12;
const HREF = /^https:\/\/[^\s<>"'`\\]+$/;

/**
 * Ссылка из текста - только https с хостом, как server/app/richtext.py.
 * React не запрещает javascript: в href (только предупреждает), поэтому
 * проверяем и здесь, на отрисовке.
 */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000 || !HREF.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname ? value : null;
  } catch {
    return null;
  }
}

export function cleanDoc(node: unknown, depth = 0): DocNode | null {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return null;
  const n = node as Record<string, unknown>;
  const type = typeof n.type === "string" ? (ALIASES[n.type] ?? n.type) : n.type;
  if (typeof type !== "string" || !NODES.has(type)) return null;
  if (type === "text") {
    if (typeof n.text !== "string" || !n.text) return null;
    const marks: { type: string; attrs?: Record<string, unknown> }[] = [];
    for (const raw of Array.isArray(n.marks) ? n.marks : []) {
      const m = raw as { type?: unknown; attrs?: { href?: unknown } };
      if (typeof m?.type !== "string" || !MARKS.has(m.type)) continue;
      if (m.type !== "link") marks.push({ type: m.type });
      else {
        const href = safeHref(m.attrs?.href);
        if (href) marks.push({ type: "link", attrs: { href } });
      }
    }
    return marks.length ? { type, text: n.text, marks } : { type, text: n.text };
  }
  if (type === "horizontalRule") return { type };
  const attrs = (n.attrs && typeof n.attrs === "object" ? n.attrs : {}) as Record<string, unknown>;
  if (type === "resource") {
    return typeof attrs.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(attrs.id) ? { type, attrs: { id: attrs.id } } : null;
  }
  const out: DocNode = { type };
  if (type === "heading") out.attrs = { level: 3 };
  const content = (Array.isArray(n.content) ? n.content : [])
    .map((c) => cleanDoc(c, depth + 1))
    .filter((c): c is DocNode => c !== null);
  if (content.length) out.content = content;
  return out;
}

/** Весь текст документа - для поиска по листу. */
export function docText(node: unknown, depth = 0): string {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return "";
  const n = node as { text?: unknown; content?: unknown };
  const own = typeof n.text === "string" ? n.text : "";
  const kids = Array.isArray(n.content) ? n.content.map((c) => docText(c, depth + 1)).join(" ") : "";
  return `${own} ${kids}`;
}

export const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };
