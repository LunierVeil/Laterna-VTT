import { interactionDefaults } from "./defaults";
import type { UiSlice, SliceCreator } from "./model";

/** Existing ui defaults/actions; cross-domain partial updates retain their original order. */
export const createUiSlice: SliceCreator<UiSlice> = (set, get) => ({
  ...interactionDefaults(),
  diceAnimation: localStorage.getItem("lanterna.diceAnimation") === "on" || (localStorage.getItem("lanterna.diceAnimation") !== "off" && !(navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2)),
  setDiceOpen: (diceOpen) => set({ diceOpen }),
  setDiceAnimation: (diceAnimation) => {localStorage.setItem("lanterna.diceAnimation", diceAnimation ? "on" : "off"); set({diceAnimation});},
  setTool: (tool) => set({ tool }),
  setError: (error) => set({ error }),
  flashError: (error) => {
    set({ error });
    setTimeout(() => {
      // Не гасим более свежую ошибку, пришедшую за это время.
      if (get().error === error) set({ error: null });
    }, 2500);
  },
  flashNotice: (notice) => {
    set({ notice });
    setTimeout(() => {
      if (get().notice === notice) set({ notice: null });
    }, 8000);
  },
  setChaining: (chaining) => set({ chaining }),
  setSelected: (selected) => set({ selected }),
  openCharacter: (openCharacterId) => set({ openCharacterId }),
  setCombatOpen: (combatOpen) => set({ combatOpen }),
  setPlaceHidden: (placeHidden) => set({ placeHidden }),
  setFogMode: (fogMode) => set({ fogMode }),
  setWallKind: (wallKind) => set({ wallKind }),
  setHiddenRolls: (hiddenRolls) => set({ hiddenRolls }),
  setSideTab: (sideTab) => set({ sideTab }),
  setZoom: (zoom) => set({ zoom }),
  setSelectionCounts: (selectionCount, selectionEditable) => set({ selectionCount, selectionEditable }),
  dismissNotice: () => set({ notice: null }),
});
