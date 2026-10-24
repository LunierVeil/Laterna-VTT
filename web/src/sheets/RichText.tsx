import type { ReactNode } from "react";

/**
 * Тексты способностей из импорта - документы TipTap. Рисуем разбором узлов
 * в React-элементы по белому списку. innerHTML и dangerouslySetInnerHTML
 * запрещены: файл присылает игрок, а текст увидит вся кампания - это XSS.
 * React сам экранирует строки, поэтому текст остаётся текстом.
 *
 * Неизвестные узлы и метки пропускаются. Сервер при импорте режет по
 * такому же списку - это второй слой, а не замена этому.
 */

interface Node {
  type?: unknown;
  text?: unknown;
  marks?: unknown;
  attrs?: unknown;
  content?: unknown;
}

export interface ResourceInfo {
  id?: unknown;
  name?: unknown;
  current?: unknown;
  max?: unknown;
}

const MAX_DEPTH = 12;

function children(node: Node, resources: ResourceInfo[], depth: number): ReactNode[] {
  if (!Array.isArray(node.content)) return [];
  return node.content.map((c, i) => <Rich key={i} node={c as Node} resources={resources} depth={depth + 1} />);
}

function Rich({ node, resources, depth }: { node: Node; resources: ResourceInfo[]; depth: number }): ReactNode {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return null;
  switch (node.type) {
    case "doc":
      return <>{children(node, resources, depth)}</>;
    case "paragraph":
      return <p>{children(node, resources, depth)}</p>;
    case "heading":
      return <h4>{children(node, resources, depth)}</h4>;
    case "bulletList":
      return <ul>{children(node, resources, depth)}</ul>;
    case "orderedList":
      return <ol>{children(node, resources, depth)}</ol>;
    case "listItem":
      return <li>{children(node, resources, depth)}</li>;
    case "hardBreak":
      return <br />;
    case "text": {
      if (typeof node.text !== "string") return null;
      let out: ReactNode = node.text;
      const marks = Array.isArray(node.marks) ? node.marks : [];
      for (const m of marks) {
        const type = (m as { type?: unknown })?.type;
        if (type === "bold") out = <strong>{out}</strong>;
        else if (type === "italic") out = <em>{out}</em>;
      }
      return out;
    }
    case "resource": {
      // Ссылка на счётчик листа по id: показываем имя и сколько осталось.
      const id = (node.attrs as { id?: unknown } | undefined)?.id;
      const r = resources.find((x) => x.id === id);
      if (!r) return null;
      const name = typeof r.name === "string" ? r.name : "ресурс";
      const count = typeof r.current === "number" && typeof r.max === "number" ? ` ${r.current}/${r.max}` : "";
      return (
        <span className="res-chip">
          {name}
          {count}
        </span>
      );
    }
    default:
      return null;
  }
}

export function RichText({ doc, resources }: { doc: unknown; resources: ResourceInfo[] }) {
  return (
    <div className="rich-text">
      <Rich node={doc as Node} resources={resources} depth={0} />
    </div>
  );
}
