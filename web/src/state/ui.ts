import { interactionDefaults } from "./defaults";
import type { UiSlice, SliceCreator } from "./model";

/** Device preference plus transient UI; toast generations belong to this store instance. */
export const createUiSlice: SliceCreator<UiSlice> = (set, get) => {
  let errorGeneration = 0, noticeGeneration = 0;
  return ({
  ...interactionDefaults(),
  diceAnimation: localStorage.getItem("lanterna.diceAnimation") === "on" || (localStorage.getItem("lanterna.diceAnimation") !== "off" && !(navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2)),
  setDiceOpen: (diceOpen) => set({ diceOpen }),
  setDiceAnimation: (diceAnimation) => {localStorage.setItem("lanterna.diceAnimation", diceAnimation ? "on" : "off"); set({diceAnimation});},
  setTool: (tool) => set({ tool }),
  setError: (error) => {errorGeneration++; set({ error });},
  flashError: (error) => {
    const generation = ++errorGeneration, epoch = get().sessionEpoch;
    set({ error });
    setTimeout(() => {
      if (generation === errorGeneration && epoch === get().sessionEpoch && get().error === error) set({ error: null });
    }, 2500);
  },
  flashNotice: (notice) => {
    const generation = ++noticeGeneration, epoch = get().sessionEpoch;
    set({ notice });
    setTimeout(() => {
      if (generation === noticeGeneration && epoch === get().sessionEpoch && get().notice === notice) set({ notice: null });
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
  dismissNotice: () => {noticeGeneration++; set({ notice: null });},
});
};
