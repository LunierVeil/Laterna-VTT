import type { UiData } from "./model";

// SessionSlice data; no store, commands or calculations.
export const selectMe = (state: Readonly<UiData>) => state.me;
export const selectIsGm = (state: Readonly<UiData>) => state.isGm;
export const selectConnected = (state: Readonly<UiData>) => state.connected;

// CampaignSlice data; no store, commands or calculations.
export const selectAccounts = (state: Readonly<UiData>) => state.accounts;
export const selectInvites = (state: Readonly<UiData>) => state.invites;
export const selectLastInvite = (state: Readonly<UiData>) => state.lastInvite;
export const selectActiveSceneId = (state: Readonly<UiData>) => state.activeSceneId;
export const selectScenes = (state: Readonly<UiData>) => state.scenes;
export const selectFolders = (state: Readonly<UiData>) => state.folders;
export const selectUsers = (state: Readonly<UiData>) => state.users;

// GameplaySlice data; no store, commands or calculations.
export const selectCharacters = (state: Readonly<UiData>) => state.characters;
export const selectCombat = (state: Readonly<UiData>) => state.combat;
export const selectMessages = (state: Readonly<UiData>) => state.messages;
export const selectSceneName = (state: Readonly<UiData>) => state.sceneName;
export const selectGridSize = (state: Readonly<UiData>) => state.gridSize;
export const selectBackground = (state: Readonly<UiData>) => state.background;

// UiSlice data; no store, commands or calculations.
export const selectOpenCharacterId = (state: Readonly<UiData>) => state.openCharacterId;
export const selectCombatOpen = (state: Readonly<UiData>) => state.combatOpen;
export const selectPlaceHidden = (state: Readonly<UiData>) => state.placeHidden;
export const selectFogMode = (state: Readonly<UiData>) => state.fogMode;
export const selectWallKind = (state: Readonly<UiData>) => state.wallKind;
export const selectHiddenRolls = (state: Readonly<UiData>) => state.hiddenRolls;
export const selectSideTab = (state: Readonly<UiData>) => state.sideTab;
export const selectZoom = (state: Readonly<UiData>) => state.zoom;
export const selectTool = (state: Readonly<UiData>) => state.tool;
export const selectError = (state: Readonly<UiData>) => state.error;
export const selectNotice = (state: Readonly<UiData>) => state.notice;
export const selectChaining = (state: Readonly<UiData>) => state.chaining;
export const selectSelected = (state: Readonly<UiData>) => state.selected;
export const selectSelectionCount = (state: Readonly<UiData>) => state.selectionCount;
export const selectSelectionEditable = (state: Readonly<UiData>) => state.selectionEditable;
export const selectDiceOpen = (state: Readonly<UiData>) => state.diceOpen;
export const selectDiceAnimation = (state: Readonly<UiData>) => state.diceAnimation;
