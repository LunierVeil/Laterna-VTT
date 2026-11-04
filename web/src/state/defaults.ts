import type { CampaignSlice, GameplaySlice, UiSlice } from "./model";

// Fresh containers for initialization and identity reset; device preferences are separate.
export const campaignDefaults = () => ({
  accounts: [], invites: [], lastInvite: null, activeSceneId: null,
  scenes: [], folders: [], users: [],
}) satisfies Pick<CampaignSlice, "accounts" | "invites" | "lastInvite" | "activeSceneId" | "scenes" | "folders" | "users">;
export const gameplayDefaults = () => ({
  characters: {}, combat: null, messages: [], sceneName: "", gridSize: 70, background: null,
}) satisfies Pick<GameplaySlice, "characters" | "combat" | "messages" | "sceneName" | "gridSize" | "background">;
export const interactionDefaults = () => ({
  openCharacterId: null, combatOpen: false, placeHidden: false,
  fogMode: "cover" as const, wallKind: "wall" as const, hiddenRolls: false,
  sideTab: "chat" as const, zoom: 1, tool: "select" as const,
  error: null, notice: null, chaining: false, selected: null,
  selectionCount: 0, selectionEditable: 0, diceOpen: false,
}) satisfies Pick<UiSlice, "openCharacterId" | "combatOpen" | "placeHidden" | "fogMode" | "wallKind" | "hiddenRolls" | "sideTab" | "zoom" | "tool" | "error" | "notice" | "chaining" | "selected" | "selectionCount" | "selectionEditable" | "diceOpen">;
