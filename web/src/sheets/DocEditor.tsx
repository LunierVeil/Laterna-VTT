import { EditorContent, Node, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { cleanDoc, EMPTY_DOC, safeHref, type DocNode } from "./richDoc";

/**
 * Ссылка на счётчик листа (из импорта LSS). В редакторе - неизменяемая
 * плашка; имя и остаток рисует RichText при чтении.
 */
const Resource = Node.create({
  name: "resource",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { id: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-resource]" }];
  },
  renderHTML({ HTMLAttributes }) {
    // Атрибуты ProseMirror ставит через setAttribute - это не HTML-строка.
    return ["span", { "data-resource": HTMLAttributes.id, class: "res-chip" }, "ресурс"];
  },
});

// Только то, что пропустит белый список: остальное выключено, чтобы игрок
// не набрал то, что потом молча пропадёт при сохранении. Горизонтальная
// черта включена - она приходит из LSS (divider).
const extensions = [
  StarterKit.configure({
    blockquote: false,
    codeBlock: false,
    code: false,
    strike: false,
    heading: { levels: [3] },
  }),
  // Ссылки из импорта не теряются при правке. Только https: остальное
  // редактор не примет, а сервер и cleanDoc всё равно выбросят.
  Link.configure({
    openOnClick: false,
    autolink: false,
    linkOnPaste: false,
    protocols: [],
    HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    validate: (href) => safeHref(href) !== null,
  }),
  Resource,
];

/**
 * Редактор описания: жирный, курсив, списки, заголовок. Грузится отдельным
 * куском кода (React.lazy) - только когда кто-то правит карточку.
 */
export default function DocEditor({ initial, onChange }: { initial: unknown; onChange: (doc: DocNode) => void }) {
  const editor = useEditor({
    extensions,
    content: cleanDoc(initial) ?? EMPTY_DOC,
    onUpdate: ({ editor }) => onChange(cleanDoc(editor.getJSON()) ?? EMPTY_DOC),
  });

  if (!editor) return null;
  const btn = (label: string, title: string, active: boolean, run: () => void) => (
    <button
      type="button"
      title={title}
      className={active ? "tool tool-active" : "tool"}
      onMouseDown={(e) => e.preventDefault()} // не уводить фокус из текста
      onClick={run}
    >
      {label}
    </button>
  );

  return (
    <div className="doc-editor">
      <div className="doc-toolbar">
        {btn("Ж", "жирный (Ctrl+B)", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run())}
        {btn("К", "курсив (Ctrl+I)", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run())}
        {btn("•", "список", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run())}
        {btn("1.", "нумерованный список", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run())}
        {btn("H", "подзаголовок", editor.isActive("heading"), () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
      </div>
      <EditorContent editor={editor} className="doc-content" />
    </div>
  );
}
