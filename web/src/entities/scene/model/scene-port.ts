/** Положение выбранного токена на экране; null отключает подписку. */
export interface TokenAnchorPort {
  setAnchorListener(cb: ((a: { x: number; y: number; r: number } | null) => void) | null): void;
}

export interface TokenPlacementPort {
  freeCellNearCenter(): { x: number; y: number };
}

export interface SelectionPort {
  removeSelected(): void;
  clearSelection(): void;
}

export interface ZoomPort {
  zoomBy(factor: number): void;
}

export interface FogUndoPort {
  noteMyFogCmd(cmdId: string): void;
}
