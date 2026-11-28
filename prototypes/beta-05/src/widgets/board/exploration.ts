import { useEffect, useState } from 'react';
import type { Point } from '../../entities/model';

const step = 48;
const columns = Math.ceil(1100 / step);
const rows = Math.ceil(760 / step);

export const explorationKey = (campaign: string, scene: string, hero: string) =>
  `laterna-beta05:explored:${campaign}:${scene}:${hero}`;

export function readExploration(key: string): number[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(data) ? [...new Set(data.filter(value => Number.isInteger(value) && value >= 0 && value < columns * rows))] : [];
  } catch { return []; }
}

export function writeExploration(key: string, cells: number[]) {
  try { localStorage.setItem(key, JSON.stringify(cells)); } catch { /* optional browser memory */ }
}

export function useExploration(key: string, position: Point | undefined, enabled: boolean) {
  const x = position?.x, y = position?.y;
  const [memory, setMemory] = useState<{ key: string; cells: number[] }>();
  useEffect(() => {
    if (!enabled || x === undefined || y === undefined) return;
    const seen = new Set(readExploration(key));
    for (let cell = 0; cell < columns * rows; cell++) {
      const point = explorationCell(cell);
      if (Math.hypot(point.x + step / 2 - x, point.y + step / 2 - y) <= 108) seen.add(cell);
    }
    const cells = [...seen];
    writeExploration(key, cells);
    setMemory({key, cells});
  }, [key, enabled, x, y]);
  return enabled ? memory?.key === key ? memory.cells : readExploration(key) : [];
}

export function explorationCell(index: number) {
  return { x: index % columns * step, y: Math.floor(index / columns) * step, width: step, height: step };
}
