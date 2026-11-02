import { createContext, useContext } from "react";

/**
 * Команды листа для блоков, которым мало "записать значение по пути":
 * элемент списка по id и счётчик на дельту. Считает сервер (handlers.py),
 * блок только просит. Контекст - чтобы не тянуть их пропсами через
 * все виды блоков.
 */
export interface SheetOps {
  list: (path: string, op: "add" | "update" | "remove", extra: { item?: object; item_id?: string; changes?: object }) => void;
  counter: (path: string, delta: number, maxPath?: string) => void;
  roll?: (formula: string, label: string) => void;
}

export const SheetOpsContext = createContext<SheetOps | null>(null);

export function useSheetOps(): SheetOps {
  const ops = useContext(SheetOpsContext);
  if (!ops) throw new Error("SheetOpsContext не задан");
  return ops;
}
