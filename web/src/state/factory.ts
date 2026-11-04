import type { StateCreator } from "zustand";
import type { UiState } from "./model";
import { createSessionSlice } from "./session";
import { createCampaignSlice } from "./campaign";
import { createGameplaySlice } from "./gameplay";
import { createUiSlice } from "./ui";

/** One flat state; no lifecycle/reset or transport behavior is added here. */
export const createUiState: StateCreator<UiState> = (set, get, store) => ({
  ...createSessionSlice(set, get, store),
  ...createCampaignSlice(set, get, store),
  ...createGameplaySlice(set, get, store),
  ...createUiSlice(set, get, store),
});
