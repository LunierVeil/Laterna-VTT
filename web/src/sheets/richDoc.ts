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
  marks?: { type: string }[];
  attrs?: Record<string, unknown>;
  content?: DocNode[];
}

const NODES = new Set(["doc", "paragraph", "text", "hardBreak", "heading", "bulletList", "orderedList", "listItem", "resource"]);
const MARKS = new Set(["bold", "italic"]);
const MAX_DEPTH = 12;

export function cleanDoc(node: unknown, depth = 0): DocNode | null {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return null;
  const n = node as Record<string, unknown>;
  const type = n.type;
  if (typeof type !== "string" || !NODES.has(type)) return null;
  if (type === "text") {
    if (typeof n.text !== "string" || !n.text) return null;
    const marks = (Array.isArray(n.marks) ? n.marks : [])
      .map((m) => (m as { type?: unknown })?.type)
      .filter((t): t is string => typeof t === "string" && MARKS.has(t))
      .map((t) => ({ type: t }));
    return marks.length ? { type, text: n.text, marks } : { type, text: n.text };
  }
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
