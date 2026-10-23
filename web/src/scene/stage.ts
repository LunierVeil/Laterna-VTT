import { Application, Container, Graphics, Text, FederatedPointerEvent } from "pixi.js";
import type { Scene, Token, Wall, Tool } from "../types";

const COLORS = {
  background: 0x15161a,
  sceneFill: 0x1e2027,
  grid: 0x2e3340,
  gridMajor: 0x3c4356,
  wall: 0xd0d5e0,
  door: 0x6fa8dc,
  wallGhost: 0xffb562,
  selection: 0xffd166,
  label: 0xe8e8ec,
};

export interface StageCallbacks {
  onMoveToken: (id: string, x: number, y: number, prev: { x: number; y: number }) => void;
  onAddToken: (x: number, y: number) => void;
  onRemoveToken: (id: string) => void;
  /** Возвращает id отправленной команды - по нему стейдж узнаёт свои стены. */
  onAddWall: (x1: number, y1: number, x2: number, y2: number) => string;
  onRemoveWall: (id: string) => void;
  /**
   * Выбранный токен для панели свойств. Зовётся при выборе и при
   * token.updated выбранного, но не при перемещении - иначе драг
   * потащит за собой ререндер React.
   */
  onSelect: (token: Token | null) => void;
  /** Рисуется ли сейчас цепочка стен - для подсказки в интерфейсе. */
  onChainChange: (active: boolean) => void;
}

interface TokenView {
  data: Token;
  node: Container;
  body: Graphics;
  label: Text;
}

/**
 * Императивная PixiJS-сцена. React сюда не заходит - только зовёт методы.
 *
 * Координаты везде в пикселях сцены (как в БД). Экранные координаты
 * получаются трансформом контейнера world.
 */
export class SceneStage {
  app = new Application();
  private world = new Container();
  private bg = new Graphics();
  private gridLayer = new Graphics();
  private wallLayer = new Graphics();
  private ghostLayer = new Graphics();
  private tokenLayer = new Container();

  private tokens = new Map<string, TokenView>();
  private walls = new Map<string, Wall>();

  private gridSize = 70;
  private sceneWidth = 4000;
  private sceneHeight = 3000;

  private tool: Tool = "select";
  private selectedId: string | null = null;

  private dragging: { view: TokenView; from: { x: number; y: number } } | null = null;
  private panning: { startX: number; startY: number; origX: number; origY: number } | null = null;
  private wallStart: { x: number; y: number } | null = null;
  private pointerScene = { x: 0, y: 0 };
  private destroyed = false;

  // Стены, созданные этим клиентом, для отмены по Ctrl+Z. Чужие стены
  // отменять нельзя - иначе один игрок стирает работу другого.
  private myWallCmds = new Set<string>();
  private myWalls: string[] = [];

  constructor(private cb: StageCallbacks) {}

  async mount(parent: HTMLElement) {
    await this.app.init({
      background: COLORS.background,
      antialias: true,
      resizeTo: parent,
      preference: "webgl",
    });

    // Пока шла инициализация, компонент мог размонтироваться
    // (StrictMode монтирует эффекты дважды). Тогда сворачиваемся.
    if (this.destroyed) {
      try {
        this.app.destroy(true, { children: true });
      } catch {
        /* нечего разрушать */
      }
      return;
    }

    parent.appendChild(this.app.canvas);

    this.world.addChild(this.bg, this.gridLayer, this.wallLayer, this.ghostLayer, this.tokenLayer);
    this.app.stage.addChild(this.world);

    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;

    // Ввод по пустому месту слушаем на корне, а не на фоновом Graphics:
    // хит-тест по геометрии Graphics в паре с hitArea на корне
    // отрабатывает ненадёжно, и клики просто пропадали. Токены глушат
    // всплытие у себя, поэтому разделение "токен / фон" сохраняется.
    this.app.stage.on("pointerdown", this.onBackgroundDown);
    this.app.stage.on("pointermove", this.onPointerMove);
    this.app.stage.on("pointerup", this.onPointerUp);
    this.app.stage.on("pointerupoutside", this.onPointerUp);

    this.app.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", this.onKeyDown);

    this.drawBackground();
    this.drawGrid();
  }

  /**
   * Безопасно в любой момент, в том числе до того, как app.init()
   * успел отработать - именно так это и вызывается в StrictMode.
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    window.removeEventListener("keydown", this.onKeyDown);

    const canvas = this.app.canvas as HTMLCanvasElement | undefined;
    if (canvas) canvas.removeEventListener("wheel", this.onWheel);

    try {
      this.app.destroy(true, { children: true });
    } catch {
      /* app мог не успеть инициализироваться - разрушать нечего */
    }
  }

  get isAlive(): boolean {
    return !this.destroyed;
  }

  setTool(tool: Tool) {
    if (this.destroyed) return;
    this.tool = tool;
    this.endChain();
  }

  /** Закончить цепочку стен, не выходя из инструмента. */
  endChain() {
    if (this.destroyed) return;
    const had = this.wallStart !== null;
    this.wallStart = null;
    this.ghostLayer.clear();
    if (had) this.cb.onChainChange(false);
  }

  /** Убрать последнюю стену, поставленную этим клиентом. */
  undoWall() {
    if (this.destroyed) return;
    while (this.myWalls.length) {
      const id = this.myWalls.pop()!;
      if (this.walls.has(id)) {
        this.cb.onRemoveWall(id);
        return;
      }
    }
  }

  // --- состояние сцены -----------------------------------------------

  setSnapshot(scene: Scene) {
    if (this.destroyed) return;
    this.gridSize = scene.grid_size;
    this.sceneWidth = scene.width;
    this.sceneHeight = scene.height;

    for (const view of this.tokens.values()) view.node.destroy({ children: true });
    this.tokens.clear();
    this.walls.clear();

    this.drawBackground();
    this.drawGrid();

    for (const w of scene.walls) this.walls.set(w.id, w);
    this.drawWalls();
    for (const t of scene.tokens) this.addToken(t);

    // После переподключения выбранный токен мог исчезнуть или измениться.
    const sel = this.selectedId;
    this.select(sel && this.tokens.has(sel) ? sel : null);
  }

  applyEvent(name: string, payload: any, cmdId?: string | null) {
    if (this.destroyed) return;
    switch (name) {
      case "token.added":
        this.addToken(payload.token);
        break;
      case "token.moved":
        this.setTokenPosition(payload.id, payload.x, payload.y);
        break;
      case "token.updated":
        this.updateToken(payload.token);
        break;
      case "token.removed":
        this.removeToken(payload.id);
        break;
      case "wall.added":
        this.walls.set(payload.wall.id, payload.wall);
        if (cmdId && this.myWallCmds.has(cmdId)) {
          this.myWallCmds.delete(cmdId);
          this.myWalls.push(payload.wall.id);
        }
        this.drawWalls();
        break;
      case "wall.removed":
        this.walls.delete(payload.id);
        this.myWalls = this.myWalls.filter((id) => id !== payload.id);
        this.drawWalls();
        break;
      case "scene.updated":
        if (payload.grid_size) {
          this.gridSize = payload.grid_size;
          this.drawGrid();
        }
        break;
    }
  }

  // --- токены ---------------------------------------------------------

  private addToken(data: Token) {
    if (this.tokens.has(data.id)) {
      this.updateToken(data);
      return;
    }
    const node = new Container();
    const body = new Graphics();
    const label = new Text({
      text: data.name,
      style: { fill: COLORS.label, fontSize: 13, fontFamily: "system-ui, sans-serif" },
    });
    label.anchor.set(0.5, 0);
    node.addChild(body, label);

    node.eventMode = "static";
    node.cursor = "pointer";

    const view: TokenView = { data, node, body, label };
    node.on("pointerdown", (e: FederatedPointerEvent) => this.onTokenDown(e, view));

    this.tokens.set(data.id, view);
    this.tokenLayer.addChild(node);
    this.redrawToken(view);
  }

  private updateToken(data: Token) {
    const view = this.tokens.get(data.id);
    if (!view) return this.addToken(data);
    view.data = data;
    view.label.text = data.name;
    this.redrawToken(view);
    if (this.selectedId === data.id) this.cb.onSelect(data);
  }

  private removeToken(id: string) {
    const view = this.tokens.get(id);
    if (!view) return;
    // Токен могли удалить, пока его тащат (другой клиент). Иначе на
    // отпускании уйдёт token.move для несуществующего токена.
    if (this.dragging?.view === view) this.dragging = null;
    view.node.destroy({ children: true });
    this.tokens.delete(id);
    if (this.selectedId === id) this.select(null);
  }

  private setTokenPosition(id: string, x: number, y: number) {
    const view = this.tokens.get(id);
    if (!view) return;
    view.data = { ...view.data, x, y };
    view.node.position.set(x, y);
  }

  private redrawToken(view: TokenView) {
    const r = (view.data.size * this.gridSize) / 2 - 3;
    const color = parseInt(view.data.color.replace("#", ""), 16) || 0xc75c5c;

    view.body.clear();
    view.body.circle(0, 0, r).fill({ color });
    view.body.circle(0, 0, r).stroke({ width: 2, color: 0x000000, alpha: 0.4 });
    if (this.selectedId === view.data.id) {
      view.body.circle(0, 0, r + 4).stroke({ width: 2.5, color: COLORS.selection });
    }

    view.label.position.set(0, r + 4);
    view.node.position.set(view.data.x, view.data.y);
  }

  private select(id: string | null) {
    const prev = this.selectedId;
    this.selectedId = id;
    if (prev) {
      const v = this.tokens.get(prev);
      if (v) this.redrawToken(v);
    }
    if (id) {
      const v = this.tokens.get(id);
      if (v) this.redrawToken(v);
    }
    this.cb.onSelect(id ? (this.tokens.get(id)?.data ?? null) : null);
  }

  get selected(): string | null {
    return this.selectedId;
  }

  // --- отрисовка ------------------------------------------------------

  private drawBackground() {
    this.bg.clear();
    this.bg.rect(0, 0, this.sceneWidth, this.sceneHeight).fill({ color: COLORS.sceneFill });
  }

  private drawGrid() {
    const g = this.gridLayer;
    g.clear();
    const step = this.gridSize;
    for (let x = 0, i = 0; x <= this.sceneWidth; x += step, i++) {
      g.moveTo(x, 0).lineTo(x, this.sceneHeight);
      g.stroke({ width: 1, color: i % 5 === 0 ? COLORS.gridMajor : COLORS.grid, alpha: 0.9 });
    }
    for (let y = 0, i = 0; y <= this.sceneHeight; y += step, i++) {
      g.moveTo(0, y).lineTo(this.sceneWidth, y);
      g.stroke({ width: 1, color: i % 5 === 0 ? COLORS.gridMajor : COLORS.grid, alpha: 0.9 });
    }
    for (const view of this.tokens.values()) this.redrawToken(view);
  }

  private drawWalls() {
    const g = this.wallLayer;
    g.clear();
    for (const w of this.walls.values()) {
      const isDoor = w.kind === "door" || w.kind === "secret_door";
      g.moveTo(w.x1, w.y1).lineTo(w.x2, w.y2);
      g.stroke({ width: 4, color: isDoor ? COLORS.door : COLORS.wall, alpha: 0.9 });
    }
  }

  private drawGhostWall() {
    const g = this.ghostLayer;
    g.clear();
    if (!this.wallStart) return;
    const end = this.snapCorner(this.pointerScene);
    g.moveTo(this.wallStart.x, this.wallStart.y).lineTo(end.x, end.y);
    g.stroke({ width: 3, color: COLORS.wallGhost, alpha: 0.85 });
    g.circle(this.wallStart.x, this.wallStart.y, 4).fill({ color: COLORS.wallGhost });
  }

  // --- привязка к сетке -----------------------------------------------

  private snapCenter(p: { x: number; y: number }) {
    const g = this.gridSize;
    return { x: Math.floor(p.x / g) * g + g / 2, y: Math.floor(p.y / g) * g + g / 2 };
  }

  private snapCorner(p: { x: number; y: number }) {
    const g = this.gridSize;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }

  // --- ввод -------------------------------------------------------------

  private toScene(e: FederatedPointerEvent) {
    return this.world.toLocal(e.global);
  }

  private onTokenDown = (e: FederatedPointerEvent, view: TokenView) => {
    if (this.tool !== "select") return;
    e.stopPropagation();
    this.select(view.data.id);
    this.dragging = { view, from: { x: view.data.x, y: view.data.y } };
  };

  private onBackgroundDown = (e: FederatedPointerEvent) => {
    const p = this.toScene(e);

    // ПКМ во время цепочки - закончить её, а не панорамировать.
    if (e.button === 2 && this.tool === "wall" && this.wallStart) {
      this.endChain();
      return;
    }

    if (e.button === 1 || e.button === 2 || this.tool === "select") {
      if (this.tool === "select" && e.button === 0) this.select(null);
      this.panning = {
        startX: e.global.x,
        startY: e.global.y,
        origX: this.world.position.x,
        origY: this.world.position.y,
      };
      return;
    }

    if (this.tool === "token" && e.button === 0) {
      const c = this.snapCenter(p);
      this.cb.onAddToken(c.x, c.y);
      return;
    }

    if (this.tool === "wall" && e.button === 0) {
      const c = this.snapCorner(p);
      if (!this.wallStart) {
        this.wallStart = c;
        this.cb.onChainChange(true);
      } else if (c.x === this.wallStart.x && c.y === this.wallStart.y) {
        // Повторный клик в ту же точку - закончить цепочку.
        this.endChain();
        return;
      } else {
        const cmdId = this.cb.onAddWall(this.wallStart.x, this.wallStart.y, c.x, c.y);
        this.myWallCmds.add(cmdId);
        // Цепочка: конец этой стены становится началом следующей.
        this.wallStart = c;
      }
      this.drawGhostWall();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    // Не перехватываем набор текста в чате.
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

    if (e.key === "Escape") {
      this.endChain();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (this.wallStart) this.endChain();
      else this.undoWall();
      return;
    }
    // Backspace - для маков, где отдельной Delete нет.
    if ((e.key === "Delete" || e.key === "Backspace") && this.tool === "select" && this.selectedId) {
      e.preventDefault();
      // Не оптимистично: ждём token.removed от сервера, он может отказать.
      if (!this.dragging) this.cb.onRemoveToken(this.selectedId);
    }
  };

  private onPointerMove = (e: FederatedPointerEvent) => {
    this.pointerScene = this.toScene(e);

    if (this.panning) {
      this.world.position.set(
        this.panning.origX + (e.global.x - this.panning.startX),
        this.panning.origY + (e.global.y - this.panning.startY),
      );
      return;
    }

    if (this.dragging) {
      const c = this.snapCenter(this.pointerScene);
      this.dragging.view.node.position.set(c.x, c.y);
      return;
    }

    if (this.tool === "wall" && this.wallStart) this.drawGhostWall();
  };

  private onPointerUp = () => {
    this.panning = null;

    if (this.dragging) {
      const { view, from } = this.dragging;
      this.dragging = null;
      const to = { x: view.node.position.x, y: view.node.position.y };
      if (to.x === from.x && to.y === from.y) return;
      this.cb.onMoveToken(view.data.id, to.x, to.y, from);
    }
  };

  /** Откат оптимистичного перемещения, когда сервер отказал. */
  revertToken(id: string, x: number, y: number) {
    this.setTokenPosition(id, x, y);
  }

  /** Применить перемещение локально, не дожидаясь сервера. */
  applyLocalMove(id: string, x: number, y: number) {
    this.setTokenPosition(id, x, y);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = this.app.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const before = this.world.toLocal({ x: px, y: py } as any);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = Math.max(0.15, Math.min(4, this.world.scale.x * factor));
    this.world.scale.set(next);
    const after = this.world.toLocal({ x: px, y: py } as any);

    // Держим точку под курсором на месте.
    this.world.position.x += (after.x - before.x) * next;
    this.world.position.y += (after.y - before.y) * next;
  };
}
