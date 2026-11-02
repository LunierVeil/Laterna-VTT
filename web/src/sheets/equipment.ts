import type { Block } from "./schema";

/** Shared JSON/card editor contract for PC and NPC equipment. */
export const equipmentBlock: Extract<Block, {kind: "cards"}> = {
          kind: "cards",
          title: "Снаряжение",
          path: "equipment",
          titleKey: "name",
          addLabel: "+ Предмет",
          resourcesPath: "resources",
          fields: [
            { key: "qty", label: "Кол-во", kind: "number", width: 4, min: 0, max: 99999 },
            { key: "weight", label: "Вес, фнт", kind: "number", width: 5, min: 0, max: 99999, decimal: true },
            { key: "link", label: "Ссылка (https)", kind: "link" },
          ],
          weight: {
            weight: "weight",
            qty: "qty",
            // Подсказка без штрафов: что считать перегрузом, решает стол.
            capacity: { score: "abilities.str.score", factor: 15, label: "Сила × 15" },
          },
        };
