import { SceneView } from "../../../widgets/scene-canvas/ui/SceneView";
import { TopBar } from "../../../widgets/table-header/ui/TopBar";
import { ToolRail, ToolHint } from "../../../features/scene-tools/ui/ToolRail";
import { Sidebar } from "../../../widgets/sidebar/ui/Sidebar";
import { ZoomControl } from "../../../features/scene-tools/ui/ZoomControl";
import { TokenCard } from "../../../widgets/token-inspector/ui/TokenCard";
import { InitiativePanel } from "../../../ui/InitiativePanel";
import { CharacterSheet } from "../../../sheets/CharacterSheet";
import { DiceMenu } from "../../../features/dice/ui/DicePanel";
import { DiceAnimation } from "../../../features/dice/ui/DiceAnimation";
import { SelectionBar } from "../../../features/scene-tools/ui/SelectionBar";
import type { MutableRefObject } from "react";
import type { SceneSocket } from "../../../shared/api/scene-socket";
import type { SceneStage } from "../../../widgets/scene-canvas/lib/stage";
import type { Character, Message } from "../../../shared/api/protocol";

interface TablePageProps {
  hideSidebar: boolean;
  hideRail: boolean;
  onToggleSidebar: () => void;
  onToggleRail: () => void;
  onHideSidebar: () => void;
  onDismissNotice: () => void;
  socket: SceneSocket;
  sceneId: string;
  stageRef: MutableRefObject<SceneStage | null>;
  handleReady: (stage: SceneStage) => void;
  diceOpen: boolean;
  closeDice: () => void;
  animatedRoll: Message | null;
  diceAnimation: boolean;
  openScene: (id: string) => void;
  openCharacter: Character | null;
  error: string | null;
  notice: string | null;
}

export function TablePage({
  hideSidebar, hideRail, onToggleSidebar, onToggleRail, onHideSidebar, onDismissNotice,
  socket, sceneId, stageRef, handleReady, diceOpen, closeDice, animatedRoll, diceAnimation,
  openScene, openCharacter, error, notice,
}: TablePageProps) {
  return (
    <div className={`app ${hideSidebar ? "hide-sidebar" : ""} ${hideRail ? "hide-rail" : ""}`}>
      <div className="mobile-panels">
        <button aria-label={hideSidebar ? "Открыть панели" : "Свернуть панели"} aria-expanded={!hideSidebar} aria-controls="table-sidebar" onClick={onToggleSidebar}>{hideSidebar ? "Чат ›" : "‹ Скрыть чат"}</button>
        <button onClick={onToggleRail}>{hideRail ? "Инструменты" : "Свернуть инструменты"}</button>
      </div>
      <TopBar socket={socket} sceneId={sceneId!} />
      <main>
        <ToolRail socket={socket} stageRef={stageRef} />
        <div className="scene-area">
          <SceneView socket={socket} stageRef={stageRef} onReady={handleReady} />
          <TokenCard socket={socket} stageRef={stageRef} />
          <InitiativePanel socket={socket} />
          <ToolHint />
          <SelectionBar stageRef={stageRef} />
          {diceOpen && <DiceMenu socket={socket} onClose={closeDice} />}
          <DiceAnimation key={animatedRoll?.id ?? "none"} message={diceAnimation ? animatedRoll : null} />
          <ZoomControl stageRef={stageRef} />
        </div>
        <Sidebar onHide={onHideSidebar} socket={socket} sceneId={sceneId!} onOpenScene={openScene} stageRef={stageRef} />
      </main>
      {openCharacter && <CharacterSheet key={openCharacter.id} character={openCharacter} socket={socket} />}
      {error && <div className="toast">{error}</div>}
      {notice && !error && (
        <div className="toast toast-notice" role="status" onClick={onDismissNotice}>
          {notice}
        </div>
      )}
    </div>
  );
}
