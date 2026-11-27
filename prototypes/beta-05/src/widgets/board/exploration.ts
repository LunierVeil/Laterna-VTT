import { useEffect, useState } from 'react';
import type { Point } from '../../entities/model';

const step = 48;
const columns = Math.ceil(1100 / step);
const rows = Math.ceil(760 / step);
function read(key: string): number[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(data) ? data.filter(value => Number.isInteger(value) && value >= 0 && value < columns * rows) : [];
  } catch { return []; }
}
function write(key: string, cells: number[]) {
  try { localStorage.setItem(key, JSON.stringify(cells)); } catch { /* local demo remains usable in memory */ }
}
export function useExploration(key: string, position: Point | undefined, enabled: boolean) {
  const [memory, setMemory] = useState(() => read(key));
  useEffect(() => {
    if (!enabled || !position) return;
    const seen = new Set(read(key));
    for (let cell = 0; cell < columns * rows; cell++) {
      const point = explorationCell(cell);
      if (Math.hypot(point.x + step / 2 - position.x, point.y + step / 2 - position.y) <= 108) seen.add(cell);
    }
    const cells = [...seen]; write(key, cells); setMemory(cells);
  }, [key, enabled, position?.x, position?.y]);
  return { memory, reset: () => { write(key, []); setMemory([]); } };
}
export function explorationCell(index: number) {
  return { x: index % columns * step, y: Math.floor(index / columns) * step, width: step, height: step };
}
