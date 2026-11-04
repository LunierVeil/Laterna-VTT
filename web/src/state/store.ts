import { create } from "zustand";
import { createUiState } from "./factory";
import type { UiState } from "./model";

export type { SideTab } from "./model";

/** Canonical production instance. Raw API is internal/test instrumentation only. */
export const useUi = create<UiState>(createUiState);
