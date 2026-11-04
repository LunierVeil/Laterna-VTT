import { createContext, useContext } from "react";

/**
 * Команды листа для блоков, которым мало "записать значение по пути":
 * элемент списка по id и счётчик на дельту. Считает сервер (handlers.py),
 * блок только просит. Контекст - чтобы не тянуть их пропсами через
 * все виды блоков.
 */
import type { SheetOps } from "../../../../entities/character/ui/sheet-port";
export type { SheetOps } from "../../../../entities/character/ui/sheet-port";

export const SheetOpsContext = createContext<SheetOps | null>(null);

export function useSheetOps(): SheetOps {
  const ops = useContext(SheetOpsContext);
  if (!ops) throw new Error("SheetOpsContext не задан");
  return ops;
}
