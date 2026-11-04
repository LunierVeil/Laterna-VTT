import { useUi as store } from "./store";
import type { UiState } from "./model";

/** App/session-only projection writer. Preserve separate calls and their order. */
export const projectionActions: Pick<UiState, "setMe" | "setConnected" | "setCampaign" | "setUsers" | "setLastInvite" | "setMessages" | "pushMessage" | "setScene" | "setCharacters" | "putCharacter" | "dropCharacter" | "setCombat" | "setSelected" | "setChaining" | "flashError" | "flashNotice" | "openCharacter"> & {captureSession: () => () => boolean} = {
  captureSession: () => {
    const epoch = store.getState().sessionEpoch;
    return () => store.getState().sessionEpoch === epoch;
  },
  setMe: (...args) => store.getState().setMe(...args),
  setConnected: (...args) => store.getState().setConnected(...args),
  setCampaign: (...args) => store.getState().setCampaign(...args),
  setUsers: (...args) => store.getState().setUsers(...args),
  setLastInvite: (...args) => store.getState().setLastInvite(...args),
  setMessages: (...args) => store.getState().setMessages(...args),
  pushMessage: (...args) => store.getState().pushMessage(...args),
  setScene: (...args) => store.getState().setScene(...args),
  setCharacters: (...args) => store.getState().setCharacters(...args),
  putCharacter: (...args) => store.getState().putCharacter(...args),
  dropCharacter: (...args) => store.getState().dropCharacter(...args),
  setCombat: (...args) => store.getState().setCombat(...args),
  setSelected: (...args) => store.getState().setSelected(...args),
  setChaining: (...args) => store.getState().setChaining(...args),
  flashError: (...args) => store.getState().flashError(...args),
  flashNotice: (...args) => store.getState().flashNotice(...args),
  openCharacter: (...args) => store.getState().openCharacter(...args),
};
