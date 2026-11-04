import { useUi as store } from "./store";
import type { UiData, UiState } from "./model";

export type { SideTab } from "./model";
export * from "./selectors";

// Data-only snapshots, cached by root identity. Whole-state subscriptions still
// observe every root update; field selectors retain their existing Object.is behavior.
const snapshots = new WeakMap<UiState, Readonly<UiData>>();
function dataSnapshot(state: UiState): Readonly<UiData> {
  let data = snapshots.get(state);
  if (!data) {
    data = {
      me: state.me,
      isGm: state.isGm,
      connected: state.connected,
      sessionEpoch: state.sessionEpoch,
      accounts: state.accounts,
      invites: state.invites,
      lastInvite: state.lastInvite,
      activeSceneId: state.activeSceneId,
      scenes: state.scenes,
      folders: state.folders,
      users: state.users,
      characters: state.characters,
      combat: state.combat,
      messages: state.messages,
      sceneName: state.sceneName,
      gridSize: state.gridSize,
      background: state.background,
      openCharacterId: state.openCharacterId,
      combatOpen: state.combatOpen,
      placeHidden: state.placeHidden,
      fogMode: state.fogMode,
      wallKind: state.wallKind,
      hiddenRolls: state.hiddenRolls,
      sideTab: state.sideTab,
      zoom: state.zoom,
      tool: state.tool,
      error: state.error,
      notice: state.notice,
      chaining: state.chaining,
      selected: state.selected,
      selectionCount: state.selectionCount,
      selectionEditable: state.selectionEditable,
      diceOpen: state.diceOpen,
      diceAnimation: state.diceAnimation,
    };
    snapshots.set(state, data);
  }
  return data;
}

function usePublicUi(): Readonly<UiData>;
function usePublicUi<T>(selector: (state: Readonly<UiData>) => T): T;
function usePublicUi<T>(selector?: (state: Readonly<UiData>) => T): Readonly<UiData> | T {
  return store<Readonly<UiData> | T>(selector
    ? state => selector(dataSnapshot(state))
    : dataSnapshot);
}

/** UI read API: no raw setState/subscribe or projection-writing actions. */
export const useUi = Object.assign(usePublicUi, {
  getState: (): Readonly<UiData> => dataSnapshot(store.getState()),
});

/** UI intents only; setters read the same canonical instance at call time. */
export const uiActions: Pick<UiState, "setDiceOpen" | "setDiceAnimation" | "setTool" | "setError" | "flashError" | "flashNotice" | "setChaining" | "setSelected" | "openCharacter" | "setCombatOpen" | "setPlaceHidden" | "setFogMode" | "setWallKind" | "setHiddenRolls" | "setSideTab" | "setZoom" | "setSelectionCounts" | "dismissNotice"> & {endSession: () => void; clearLastInvite: () => void} = {
  setDiceOpen: (...args) => store.getState().setDiceOpen(...args),
  setDiceAnimation: (...args) => store.getState().setDiceAnimation(...args),
  setTool: (...args) => store.getState().setTool(...args),
  setError: (...args) => store.getState().setError(...args),
  flashError: (...args) => store.getState().flashError(...args),
  flashNotice: (...args) => store.getState().flashNotice(...args),
  setChaining: (...args) => store.getState().setChaining(...args),
  setSelected: (...args) => store.getState().setSelected(...args),
  openCharacter: (...args) => store.getState().openCharacter(...args),
  setCombatOpen: (...args) => store.getState().setCombatOpen(...args),
  setPlaceHidden: (...args) => store.getState().setPlaceHidden(...args),
  setFogMode: (...args) => store.getState().setFogMode(...args),
  setWallKind: (...args) => store.getState().setWallKind(...args),
  setHiddenRolls: (...args) => store.getState().setHiddenRolls(...args),
  setSideTab: (...args) => store.getState().setSideTab(...args),
  setZoom: (...args) => store.getState().setZoom(...args),
  setSelectionCounts: (...args) => store.getState().setSelectionCounts(...args),
  dismissNotice: (...args) => store.getState().dismissNotice(...args),
  // Identity reset preserves device preferences but removes private projections.
  endSession: () => store.getState().setMe(null),
  // Existing pre-request cleanup; UI cannot write a new server invite code.
  clearLastInvite: () => store.getState().setLastInvite(null),
};
