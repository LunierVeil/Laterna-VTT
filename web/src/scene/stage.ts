import { Application, Assets, Circle, Container, Graphics, Sprite, Text, Texture, FederatedPointerEvent } from "pixi.js";
import type { Combat, FogRect, Scene, Token, Wall, Tool, TokenPreview } from "../types";

const COLORS = {
  background: 0x121318,
  sceneFill: 0x2a2620,
  grid: 0x1f1c18,
  gridMajor: 0x16140f,
  wall: 0xe7e1d4,
  door: 0x6fa8dc,
  doorLocked: 0xd9534f,
  wallGhost: 0xf0b14a,
  selection: 0xf0b14a,
  turn: 0xff8c42,
  label: 0xe9e6df,
  eraseOwn: 0xe0605a,
  eraseForeign: 0x8b90a0,
};

/** Расстояние от точки до отрезка стены. */
function distToWall(p: { x: number; y: number }, w: Wall): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / len2)) : 0;
  return Math.hypot(p.x - (w.x1 + t * dx), p.y - (w.y1 + t * dy));
}

export interface StageCallbacks {
  onMoveToken: (id: string, x: number, y: number, prev: { x: number; y: number }) => void;
  onAddToken: (x: number, y: number) => void;
  onPreview?: (payload: {id: string; drag_id: string; step: number; x: number; y: number}) => void;
  onPreviewEnd?: (drag_id: string) => void;
  onRemoveToken: (id: string) => void;
  /** Возвращает id отправленной команды - по нему стейдж узнаёт свои стены. */
  onAddWall: (x1: number, y1: number, x2: number, y2: number) => string;
  onRemoveWall: (id: string) => void;
  /** Клик по двери в режиме выбора: открыть/закрыть, у ГМ с Shift - запереть. */
  onDoor: (id: string, state: "open" | "closed" | "locked") => void;
  /**
   * Выбранный токен для карточки токена. Зовётся при выборе и при
   * token.updated выбранного, но не при перемещении - иначе драг
   * потащит за собой ререндер React.
   */
  onSelect: (token: Token | null) => void;
  onSelectionChange?: (count: number, editable: number) => void;
  /** Рисуется ли сейчас цепочка стен - для подсказки в интерфейсе. */
  onChainChange: (active: boolean) => void;
  /** Двойной клик по токену - открыть его лист. */
  onOpenToken: (token: Token) => void;
  /** Масштаб поменялся - для индикатора "100%". Зовётся на шаг колеса, не на кадр. */
  onZoom: (scale: number) => void;
  /** Пинг: Alt+клик или долгое нажатие на телефоне. Точка - в пикселях сцены. */
  onPing: (x: number, y: number) => void;
  /** Рамка инструмента "Туман" (ГМ): закрыть или открыть. Возвращает id команды. */
  onFog: (mode: "cover" | "reveal", x: number, y: number, w: number, h: number) => string;
  /** Ctrl+Z, когда последним своим действием был туман. */
  onFogUndo: () => void;
}

/**
 * Что показать на токене из привязанного листа. Приходит из React (листы
 * живут там) по id персонажа; у кого листа нет - у того и полоски нет.
 */
export interface CharacterStats {
  hp?: number;
  max?: number;
  badge?: string;
  /** Скорость в футах - подпись при перетаскивании: "25 / 30 фт". */
  speed?: number;
}

/**
 * Футов в клетке. Пока константа - стандарт 5e; настройкой сцены станет,
 * когда понадобится другой масштаб (карты мира, гексы).
 */
const FEET_PER_CELL = 5;

interface TokenView {
  data: Token;
  node: Container;
  /** Заливка цветом - под картинкой (видна сквозь прозрачные PNG). */
  base: Graphics;
  /** Картинка токена, вписанная в круг маской. */
  image: Sprite;
  imageMask: Graphics;
  /** Какую картинку уже грузим/показали - чтобы опоздавшая не перетёрла новую. */
  imageUrl: string | null;
  /** Поверх картинки: обводка, выделение, полоска хитов, значок. */
  body: Graphics;
  label: Text;
  /** Значок на токене (КД) - правый нижний угол. */
  badge: Text;
  /** Хиты числом поверх полоски. */
  hpText: Text;
  /** Время прошлого нажатия - для двойного клика. */
  lastDown: number;
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
  private map = new Sprite();
  private mapUrl: string | null = null;
  private gridLayer = new Graphics();
  private wallLayer = new Graphics();
  private ghostLayer = new Graphics();
  private tokenLayer = new Container();
  private movementLayer = new Container();
  private movementPreviews = new Map<string, {node: Container; line: Graphics; body: Graphics; image: Sprite; mask: Graphics; step: number; tokenId: string; expires: number}>();
  private previewClosed = new Set<string>();
  private previewSteps = new Map<string, number>();
  // Линейка и путь перетаскиваемого токена - поверх токенов.
  private measureLayer = new Graphics();
  /** Туман: над картой и сеткой, под стенами и токенами (свой токен в тумане виден). */
  private fogLayer = new Graphics();
  private fog: FogRect[] = [];
  private fogMode: "cover" | "reveal" = "cover";
  private fogDrag: { x: number; y: number } | null = null;
  /** Свои команды тумана (cmd_id) - для Ctrl+Z, как свои стены. */
  private myFogCmds = new Set<string>();
  /** Порядок своих действий для Ctrl+Z: стена или туман. */
  private myActions: ("wall" | "fog")[] = [];
  /** Пинги - над всем, гаснут сами по тикеру, React не трогают. */
  private pingLayer = new Container();
  private pings: { node: Container; ring: Graphics; color: number; born: number }[] = [];
  /** Долгое нажатие пальцем - пинг (на телефоне нет Alt). */
  private longPress: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  private measureLabel = new Text({
    text: "",
    style: {
      fill: 0xffffff,
      fontSize: 14,
      fontWeight: "700",
      fontFamily: "system-ui, sans-serif",
      stroke: { color: 0x000000, width: 4 },
    },
  });
  private measuring: { x: number; y: number } | null = null;

  private tokens = new Map<string, TokenView>();
  private walls = new Map<string, Wall>();

  private gridSize = 70;
  private sceneWidth = 4000;
  private sceneHeight = 3000;

  private tool: Tool = "select";
  private selectedId: string | null = null;
  private selectedIds = new Set<string>();
  private marquee: {start: {x: number; y: number}; base: string[]} | null = null;
  /**
   * Куда прикрепить карточку выбранного токена: экранные координаты центра
   * и радиус. Карточка двигает свой DOM-узел сама, мимо React, - иначе
   * перетаскивание токена гоняло бы ререндер на каждый кадр.
   */
  private anchorListener: ((a: { x: number; y: number; r: number } | null) => void) | null = null;
  private lastAnchor = "";

  // grab - где внутри токена его взяли, чтобы большой токен не прыгал
  // центром под курсор.
  private dragging: {
    view: TokenView;
    pingOnClick: boolean;
    id: string;
    step: number;
    lastSent: number;
    to: {x: number; y: number};
    from: { x: number; y: number };
    grab: { x: number; y: number };
  } | null = null;
  private panning: { startX: number; startY: number; origX: number; origY: number } | null = null;
  private wallStart: { x: number; y: number } | null = null;
  private pointerScene = { x: 0, y: 0 };
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;

  // Стены, созданные этим клиентом, для отмены по Ctrl+Z. Чужие стены
  // отменять нельзя - иначе один игрок стирает работу другого.
  private myWallCmds = new Set<string>();
  private myWalls: string[] = [];

  // ГМ может стирать любые стены. Решает сервер, это только для подсветки.
  private gm = false;
  private stats = new Map<string, CharacterStats>();
  private currentTurnToken: string | null = null;

  /** me - id пользователя этого клиента: по нему видно, что своё. */
  constructor(
    private cb: StageCallbacks,
    private me: string,
  ) {}

  /** То же правило, что _require_owner на сервере: своё, общее или ГМ. */
  private canEdit(ownerId: string | null) {
    return this.gm || ownerId === null || ownerId === this.me;
  }

  private setCurrentTurn(combat: Combat | null | undefined) {
    const entry = combat?.entries.find((e) => e.id === combat.current);
    const next = entry?.token_id ?? null;
    if (next === this.currentTurnToken) return;
    const prev = this.currentTurnToken;
    this.currentTurnToken = next;
    for (const id of [prev, next]) {
      const v = id ? this.tokens.get(id) : undefined;
      if (v) this.redrawToken(v);
    }
  }

  /** Хиты и КД из листов: characterId -> что показать. */
  setCharacterStats(stats: Map<string, CharacterStats>) {
    if (this.destroyed) return;
    this.stats = stats;
    for (const view of this.tokens.values()) if (view.data.character_id) this.redrawToken(view);
  }

  setGm(gm: boolean) {
    if (this.destroyed) return;
    this.gm = gm;
    this.drawFog();
    if (this.tool === "erase") this.updateEraseHover();
  }

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

    this.map.visible = false;

    this.world.addChild(
      this.bg,
      this.map,
      this.gridLayer,
      this.fogLayer,
      this.wallLayer,
      this.ghostLayer,
      this.tokenLayer,
      this.movementLayer,
      this.measureLayer,
      this.measureLabel,
      this.pingLayer,
    );
    this.measureLabel.anchor.set(0, 1);
    this.measureLabel.visible = false;
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
    this.app.ticker.add(this.tickAnchor);
    this.app.ticker.add(this.tickPings);
    this.app.ticker.add(this.tickPreviews);
    this.app.stage.on("pointercancel", this.onPointerCancel);
    window.addEventListener("blur", this.onPointerCancel);
    // PixiJS 8 EventBoundary does not map native pointercancel/touchcancel.
    window.addEventListener("pointercancel", this.onPointerCancel, true);
    window.addEventListener("touchcancel", this.onPointerCancel, true);

    // Pixi's resizeTo listens to window resize, not flex-layout changes.
    // Collapsing a panel or wrapping the header resizes the host without
    // a window event; keep both the drawing surface and its hit area in sync.
    this.resizeObserver = new ResizeObserver(() => {
      if (this.destroyed || !parent.clientWidth || !parent.clientHeight) return;
      if (this.app.screen.width === parent.clientWidth && this.app.screen.height === parent.clientHeight) return;
      this.app.resize();
      this.app.stage.hitArea = this.app.screen;
      this.lastAnchor = ""; // reposition the selected token card for the new bounds
    });
    this.resizeObserver.observe(parent);
  }

  /** Пинг от участника: кольцо с именем на ~4 секунды. */
  showPing(x: number, y: number, author: string, color: string) {
    if (this.destroyed) return;
    const node = new Container();
    node.position.set(x, y);
    const ring = new Graphics();
    const label = new Text({
      text: author,
      style: { fill: 0xffffff, fontSize: 13, fontWeight: "600", fontFamily: "IBM Plex Sans, sans-serif", stroke: { color: 0x000000, width: 3 } },
    });
    label.anchor.set(0.5, 0);
    label.position.set(0, this.gridSize * 0.6 + 4);
    node.addChild(ring, label);
    this.pingLayer.addChild(node);
    this.pings.push({ node, ring, color: parseInt(color.replace("#", ""), 16) || 0xf0b14a, born: performance.now() });
  }

  private tickPings = () => {
    if (!this.pings.length) return;
    const now = performance.now();
    const r0 = this.gridSize * 0.6;
    this.pings = this.pings.filter((p) => {
      const t = (now - p.born) / 1000;
      if (t >= 4) {
        p.node.destroy({ children: true });
        return false;
      }
      // Кольцо пульсирует раз в секунду, последнюю секунду - гаснет.
      const pulse = (t % 1) / 1;
      p.ring.clear();
      p.ring.circle(0, 0, r0).stroke({ width: 3, color: p.color });
      p.ring.circle(0, 0, r0 * (1 + pulse)).stroke({ width: 2, color: p.color, alpha: 1 - pulse });
      p.node.alpha = t > 3 ? 4 - t : 1;
      return true;
    });
  };

  private cancelLongPress() {
    if (this.longPress) clearTimeout(this.longPress.timer);
    this.longPress = null;
  }

  /** Подписка на положение выбранного токена на экране; null - отписаться. */
  setAnchorListener(cb: ((a: { x: number; y: number; r: number } | null) => void) | null) {
    this.anchorListener = cb;
    this.lastAnchor = "";
  }

  private tickAnchor = () => {
    if (!this.anchorListener) return;
    const view = this.selectedId ? this.tokens.get(this.selectedId) : undefined;
    if (!view) {
      if (this.lastAnchor !== "none") this.anchorListener(null);
      this.lastAnchor = "none";
      return;
    }
    const p = view.node.getGlobalPosition();
    const r = ((view.data.size * this.gridSize) / 2) * this.world.scale.x;
    const key = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(r)}`;
    if (key === this.lastAnchor) return;
    this.lastAnchor = key;
    this.anchorListener({ x: p.x, y: p.y, r });
  };

  /**
   * Безопасно в любой момент, в том числе до того, как app.init()
   * успел отработать - именно так это и вызывается в StrictMode.
   */
  destroy() {
    this.clearDragPreviews();
    window.removeEventListener("blur", this.onPointerCancel);
    window.removeEventListener("pointercancel", this.onPointerCancel, true);
    window.removeEventListener("touchcancel", this.onPointerCancel, true);
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    window.removeEventListener("keydown", this.onKeyDown);

    try {
      // Pixi's canvas getter requires an initialized renderer, too.
      const canvas = this.app.canvas as HTMLCanvasElement | undefined;
      if (canvas) canvas.removeEventListener("wheel", this.onWheel);
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
    this.cancelDrag();
    this.tool = tool;
    this.marquee = null;
    this.endChain();
    this.clearMeasure();
    this.setCursor("default");
    if (tool === "erase") this.updateEraseHover();
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
  /** Ctrl+Z: последнее своё действие - стена или туман. Чужое не трогаем. */
  undoMine() {
    if (this.destroyed) return;
    while (this.myActions.length) {
      const kind = this.myActions.pop()!;
      if (kind === "fog") {
        this.cb.onFogUndo();
        return;
      }
      while (this.myWalls.length) {
        const id = this.myWalls.pop()!;
        if (this.walls.has(id)) {
          this.cb.onRemoveWall(id);
          return;
        }
      }
    }
  }

  /** Режим инструмента "Туман" - из панели (состояние интерфейса). */
  setFogMode(mode: "cover" | "reveal") {
    this.fogMode = mode;
  }

  /** Своя команда тумана, отправленная кнопкой ("скрыть всё") - для Ctrl+Z. */
  noteMyFogCmd(cmdId: string) {
    this.myFogCmds.add(cmdId);
  }

  private drawFog() {
    const g = this.fogLayer;
    g.clear();
    // Мастер видит карту под туманом (полупрозрачно), игрок - нет.
    for (const r of this.fog) {
      g.rect(r.x, r.y, r.w, r.h).fill({ color: 0x07080b, alpha: this.gm ? 0.55 : 1 });
      if (this.gm) g.rect(r.x, r.y, r.w, r.h).stroke({ width: 1, color: 0x6fa8dc, alpha: 0.5 });
    }
  }

  // --- состояние сцены -----------------------------------------------

  setSnapshot(scene: Scene) {
    if (this.destroyed) return;
    this.clearDragPreviews();
    this.gridSize = scene.grid_size;
    this.sceneWidth = scene.width;
    this.sceneHeight = scene.height;

    for (const view of this.tokens.values()) view.node.destroy({ children: true });
    this.tokens.clear();
    this.walls.clear();

    this.drawBackground();
    this.drawGrid();
    this.setMap(scene.background_url);

    for (const w of scene.walls) this.walls.set(w.id, w);
    this.drawWalls();
    this.fog = scene.fog ?? [];
    this.drawFog();
    for (const t of scene.tokens) this.addToken(t);
    this.setCurrentTurn(scene.combat);

    // После переподключения выбранный токен мог исчезнуть или измениться.
    this.dragging = null;
    this.marquee = null;
    this.ghostLayer.clear();
    this.setSelection([...this.selectedIds]);
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
        this.clearTokenPreviews(payload.token.id);
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
          this.myActions.push("wall");
        }
        this.drawWalls();
        break;
      case "wall.updated":
        this.walls.set(payload.wall.id, payload.wall);
        this.drawWalls();
        break;
      case "wall.removed":
        this.walls.delete(payload.id);
        this.myWalls = this.myWalls.filter((id) => id !== payload.id);
        this.drawWalls();
        break;
      case "fog.updated":
        this.clearDragPreviews();
        // Игроку сервер дописал, что вышло из тумана и что ушло под него.
        for (const id of payload.remove_tokens ?? []) this.removeToken(id);
        for (const t of payload.add_tokens ?? []) if (!this.tokens.has(t.id)) this.addToken(t);
        for (const id of payload.remove_walls ?? []) this.walls.delete(id);
        for (const w of payload.add_walls ?? []) this.walls.set(w.id, w);
        if (payload.remove_walls?.length || payload.add_walls?.length) this.drawWalls();
        this.fog = payload.fog ?? [];
        this.drawFog();
        if (cmdId && this.myFogCmds.has(cmdId)) {
          this.myFogCmds.delete(cmdId);
          this.myActions.push("fog");
        }
        break;
      case "combat.updated":
        this.setCurrentTurn(payload.combat);
        break;
      case "scene.updated":
        this.clearDragPreviews();
        this.gridSize = payload.grid_size;
        this.sceneWidth = payload.width;
        this.sceneHeight = payload.height;
        this.drawBackground();
        this.drawGrid();
        this.drawWalls();
        this.setMap(payload.background_url);
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
    const base = new Graphics();
    const image = new Sprite();
    image.anchor.set(0.5);
    image.visible = false;
    const imageMask = new Graphics();
    image.mask = imageMask;
    const body = new Graphics();
    const label = new Text({
      text: data.name,
      style: {
        fill: COLORS.label,
        fontSize: 13,
        fontWeight: "500",
        fontFamily: "IBM Plex Sans, system-ui, sans-serif",
        stroke: { color: 0x000000, width: 3 },
      },
    });
    label.anchor.set(0.5, 0);
    const badge = new Text({
      text: "",
      style: { fill: 0xffffff, fontSize: 11, fontWeight: "700", fontFamily: "IBM Plex Mono, monospace" },
    });
    badge.anchor.set(0.5);
    const hpText = new Text({
      text: "",
      style: {
        fill: 0xffffff,
        fontSize: 11,
        fontWeight: "600",
        fontFamily: "IBM Plex Mono, monospace",
        stroke: { color: 0x000000, width: 2.5 },
      },
    });
    hpText.anchor.set(0.5);
    node.addChild(base, image, imageMask, body, label, badge, hpText);

    node.eventMode = "static";
    node.cursor = "pointer";

    const view: TokenView = { data, node, base, image, imageMask, imageUrl: null, body, label, badge, hpText, lastDown: 0 };
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
    if (this.selectedIds.has(data.id)) this.setSelection([...this.selectedIds]);
  }

  /**
   * Картинка токена: квадрат по кругу, обрезанный маской. Грузится
   * асинхронно - если за это время картинку сменили или токен удалили,
   * опоздавшая не применяется.
   */
  private setTokenImage(view: TokenView, r: number) {
    const url = view.data.image_url || view.data.portrait_url;
    view.imageMask.clear();
    view.imageMask.circle(0, 0, r).fill({ color: 0xffffff });
    if (!url) {
      view.imageUrl = null;
      view.image.visible = false;
      return;
    }
    const fit = () => {
      // Обрезка "по кругу": меньшая сторона = диаметр, остальное - под маску.
      const t = view.image.texture;
      const scale = (2 * r) / Math.min(t.width || 1, t.height || 1);
      view.image.scale.set(scale);
      view.image.visible = true;
    };
    if (view.imageUrl === url && view.image.texture !== Texture.EMPTY) return fit();
    view.imageUrl = url;
    Assets.load<Texture>(url)
      .then((tex) => {
        if (this.destroyed || view.node.destroyed || view.imageUrl !== url) return;
        view.image.texture = tex;
        fit();
      })
      .catch((e) => console.error("не удалось загрузить картинку токена", url, e));
  }

  private removeToken(id: string) {
    this.clearTokenPreviews(id);
    const view = this.tokens.get(id);
    if (!view) return;
    // Токен могли удалить, пока его тащат (другой клиент). Иначе на
    // отпускании уйдёт token.move для несуществующего токена.
    if (this.dragging?.view === view) this.dragging = null;
    view.node.destroy({ children: true });
    this.tokens.delete(id);
    if (this.selectedIds.has(id)) this.setSelection([...this.selectedIds].filter(v => v !== id));
  }

  private setTokenPosition(id: string, x: number, y: number) {
    this.clearTokenPreviews(id);
    const view = this.tokens.get(id);
    if (!view) return;
    view.data = { ...view.data, x, y };
    view.node.position.set(x, y);
  }

  private redrawToken(view: TokenView) {
    const r = (view.data.size * this.gridSize) / 2 - 3;
    const color = parseInt(view.data.color.replace("#", ""), 16) || 0xc75c5c;

    // Зона клика - ровно круг токена. Иначе PixiJS ловит и обводки: кольцо
    // выделения (r+4) и хода (r+8) дотягивались до соседней клетки, и клик
    // по двери рядом с выбранным токеном доставался токену.
    view.node.hitArea = new Circle(0, 0, r);

    view.base.clear();
    view.base.circle(0, 0, r).fill({ color });
    this.setTokenImage(view, r);

    view.body.clear();
    view.body.circle(0, 0, r).stroke({ width: 2, color: 0x000000, alpha: 0.4 });
    if (this.selectedIds.has(view.data.id)) {
      view.body.circle(0, 0, r + 4).stroke({ width: 2.5, color: COLORS.selection });
    }
    // Чей ход в бою - видно на карте, не только в трекере.
    if (this.currentTurnToken === view.data.id) {
      view.body.circle(0, 0, r + 8).stroke({ width: 3, color: COLORS.turn });
    }

    // Хиты и КД из листа - если лист этому клиенту виден.
    // Полоска хитов - поперёк нижнего края токена, с числом; КД - щит в
    // правом нижнем углу; имя - под токеном, ниже кольца хода.
    const sheet = view.data.character_id ? this.stats.get(view.data.character_id) : undefined;
    // У экземпляра моба хиты свои (token.hp), максимум и КД - из листа-шаблона.
    const stats = sheet && view.data.hp != null ? { ...sheet, hp: view.data.hp } : sheet;
    const hasBar = stats?.hp !== undefined && !!stats.max;
    if (hasBar) {
      const w = Math.max(44, 1.6 * r);
      const h = 14;
      const y = r - h / 2;
      const ratio = Math.max(0, Math.min(1, stats!.hp! / stats!.max!));
      const color = ratio > 0.5 ? 0x4f9a52 : ratio > 0.25 ? 0xc29a32 : 0xb8443f;
      view.body.roundRect(-w / 2, y, w, h, 4).fill({ color: 0x111216, alpha: 0.9 });
      if (ratio > 0) view.body.roundRect(-w / 2, y, w * ratio, h, 4).fill({ color });
      view.body.roundRect(-w / 2, y, w, h, 4).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
      view.hpText.text = `${stats!.hp}/${stats!.max}`;
      view.hpText.position.set(0, r);
      view.hpText.visible = true;
    } else {
      view.hpText.visible = false;
    }
    if (stats?.badge) {
      // Щит: над полоской хитов, чтобы не перекрывать число.
      const bx = r * 0.78;
      const by = r * 0.78 - (hasBar ? 9 : 0);
      view.body
        .poly([bx - 10, by - 10, bx + 10, by - 10, bx + 10, by + 1, bx, by + 11, bx - 10, by + 1])
        .fill({ color: 0x1f2129 })
        .stroke({ width: 1.5, color: 0x9fc3ff });
      view.badge.text = stats.badge;
      view.badge.position.set(bx, by - 1);
      view.badge.visible = true;
    } else {
      view.badge.visible = false;
    }

    const turn = this.currentTurnToken === view.data.id;
    view.label.position.set(0, r + (turn ? 12 : hasBar ? 8 : 4));
    // Скрытый от игроков токен ГМ видит полупрозрачным - чтобы не забыть,
    // что игроки его не видят. Игрокам такие токены не приходят вовсе.
    view.node.alpha = view.data.layer === "gm" ? 0.5 : 1;
    view.node.position.set(view.data.x, view.data.y);
  }

  private select(id: string | null) {
    this.setSelection(id ? [id] : []);
  }

  private setSelection(ids: string[]) {
    const previous = this.selectedIds;
    this.selectedIds = new Set(ids.filter(id => this.tokens.has(id)));
    this.selectedId = this.selectedIds.size === 1 ? [...this.selectedIds][0] : null;
    for (const id of new Set([...previous, ...this.selectedIds])) {
      const view = this.tokens.get(id);
      if (view) this.redrawToken(view);
    }
    this.cb.onSelect(this.selectedId ? this.tokens.get(this.selectedId)!.data : null);
    this.cb.onSelectionChange?.(this.selectedIds.size, [...this.selectedIds].filter(id => this.canEdit(this.tokens.get(id)!.data.owner_id)).length);
  }

  clearSelection() { this.select(null); }

  removeSelected() {
    if (this.dragging || this.marquee || this.destroyed) return;
    // Same authoritative command per token; never remove foreign tokens locally.
    for (const id of this.selectedIds) {
      const view = this.tokens.get(id);
      if (view && this.canEdit(view.data.owner_id)) this.cb.onRemoveToken(id);
    }
  }

  get selected(): string | null {
    return this.selectedId;
  }

  // --- отрисовка ------------------------------------------------------

  private drawBackground() {
    this.bg.clear();
    this.bg.rect(0, 0, this.sceneWidth, this.sceneHeight).fill({ color: COLORS.sceneFill });
    // Карта растягивается на всю сцену: размер сцены и так берётся из картинки.
    this.map.width = this.sceneWidth;
    this.map.height = this.sceneHeight;
  }

  /**
   * Подложка сцены. Грузится асинхронно, поэтому проверяем, что за время
   * загрузки фон не сменили ещё раз и стейдж не разрушили - иначе старая
   * картинка, догрузившись позже, перетрёт новую.
   */
  private setMap(url: string | null) {
    if (url === this.mapUrl) return;
    this.mapUrl = url;
    if (!url) {
      this.map.texture = Texture.EMPTY;
      this.map.visible = false;
      return;
    }
    Assets.load<Texture>(url)
      .then((tex) => {
        if (this.destroyed || this.mapUrl !== url) return;
        this.map.texture = tex;
        this.map.visible = true;
        this.drawBackground();
      })
      .catch((e) => console.error("не удалось загрузить карту", url, e));
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
      if (w.kind !== "door") {
        g.moveTo(w.x1, w.y1).lineTo(w.x2, w.y2);
        g.stroke({ width: 4, color: COLORS.wall, alpha: 0.9 });
        continue;
      }
      if (w.door_state === "open") {
        // Открытая - разрыв посередине: видно, что проход есть.
        const dx = (w.x2 - w.x1) * 0.25;
        const dy = (w.y2 - w.y1) * 0.25;
        g.moveTo(w.x1, w.y1).lineTo(w.x1 + dx, w.y1 + dy);
        g.moveTo(w.x2, w.y2).lineTo(w.x2 - dx, w.y2 - dy);
        g.stroke({ width: 4, color: COLORS.door, alpha: 0.9 });
      } else {
        g.moveTo(w.x1, w.y1).lineTo(w.x2, w.y2);
        g.stroke({ width: 6, color: w.door_state === "locked" ? COLORS.doorLocked : COLORS.door, alpha: 0.95 });
      }
    }
    // Стену под курсором могли удалить или добавить рядом новую.
    if (this.tool === "erase") this.updateEraseHover();
  }

  // --- стирание стен --------------------------------------------------

  /** Ближайшая стена в пределах нескольких экранных пикселей от точки. */
  private wallAt(p: { x: number; y: number }): Wall | null {
    let best: Wall | null = null;
    let bestDist = 8 / this.world.scale.x;
    for (const w of this.walls.values()) {
      const d = distToWall(p, w);
      if (d <= bestDist) {
        best = w;
        bestDist = d;
      }
    }
    return best;
  }

  private updateEraseHover() {
    const g = this.ghostLayer;
    g.clear();
    const w = this.wallAt(this.pointerScene);
    if (!w) {
      this.setCursor("default");
      return;
    }
    // Чужую тоже подсвечиваем, но блёклым ореолом: клик по ней сервер отклонит.
    const mine = this.canEdit(w.owner_id);
    g.moveTo(w.x1, w.y1).lineTo(w.x2, w.y2);
    if (mine) g.stroke({ width: 8, color: COLORS.eraseOwn, alpha: 0.9 });
    else g.stroke({ width: 14, color: COLORS.eraseForeign, alpha: 0.35 });
    this.setCursor(mine ? "pointer" : "not-allowed");
  }

  /**
   * PixiJS применяет stage.cursor только на следующем движении мыши.
   * Когда стена исчезла под неподвижным курсором, ставим его сразу.
   */
  private setCursor(cursor: string) {
    this.app.stage.cursor = cursor;
    this.app.canvas.style.cursor = cursor === "default" ? "inherit" : cursor;
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

  /**
   * Центр токена размера size, привязанный к сетке. Нечётные размеры
   * встают центром в клетку, чётные - на пересечение линий.
   */
  private snapToken(p: { x: number; y: number }, size: number) {
    const g = this.gridSize;
    const half = (size * g) / 2;
    return {
      x: Math.round((p.x - half) / g) * g + half,
      y: Math.round((p.y - half) / g) * g + half,
    };
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
    if (this.tool === "ping" && e.button === 0) {
      e.stopPropagation();
      const p = this.toScene(e);
      this.cb.onPing(p.x, p.y);
      return;
    }
    if (this.tool !== "select") return;
    e.stopPropagation();
    if (e.altKey && !this.canEdit(view.data.owner_id)) {
      const p = this.toScene(e);
      this.cb.onPing(p.x, p.y);
      return;
    }
    if (e.shiftKey && !e.altKey && e.button === 0) {
      view.lastDown = 0;
      const ids = new Set(this.selectedIds);
      if (ids.has(view.data.id)) ids.delete(view.data.id);
      else ids.add(view.data.id);
      this.setSelection([...ids]);
      return;
    }
    // Двойной клик - открыть лист. Одиночный выбирает и тащит: лист,
    // выскакивающий на каждом ходе, мешал бы.
    const now = performance.now();
    if (!e.altKey && now - view.lastDown < 350) {
      view.lastDown = 0;
      this.cb.onOpenToken(view.data);
      return;
    }
    view.lastDown = now;
    this.select(view.data.id);
    // Чужой токен выбрать можно (посмотреть), тащить - нет: сервер всё
    // равно откажет, и токен отскочил бы назад. Решает сервер, это - чтобы
    // не дёргать картинку зря.
    if (!this.canEdit(view.data.owner_id)) return;
    const p = this.toScene(e);
    this.dragging = {
      id: crypto.randomUUID(), step: 0, lastSent: -Infinity,
      to: {x: view.data.x, y: view.data.y},
      view,
      pingOnClick: e.altKey,
      from: { x: view.data.x, y: view.data.y },
      grab: { x: p.x - view.data.x, y: p.y - view.data.y },
    };
  };

  private onBackgroundDown = (e: FederatedPointerEvent) => {
    const p = this.toScene(e);

    // Пинг - в любом инструменте: Alt+клик, на телефоне - долгое нажатие.
    if ((e.altKey || this.tool === "ping") && e.button === 0) {
      this.cb.onPing(p.x, p.y);
      return;
    }
    if (e.pointerType === "touch") {
      this.cancelLongPress();
      this.longPress = {
        x: e.global.x,
        y: e.global.y,
        timer: setTimeout(() => {
          this.longPress = null;
          this.panning = null; // держал палец - это пинг, а не панорама
          this.cb.onPing(p.x, p.y);
        }, 600),
      };
    }

    // ПКМ во время цепочки - закончить её, а не панорамировать.
    if (e.button === 2 && this.tool === "wall" && this.wallStart) {
      this.endChain();
      return;
    }

    if (this.tool === "fog" && this.gm && e.button === 0) {
      this.fogDrag = { x: p.x, y: p.y };
      return;
    }

    if (this.tool === "ruler" && e.button === 0) {
      // От центра клетки: меряют "отсюда туда", а не от пикселя.
      this.measuring = this.snapToken(p, 1);
      this.drawMeasure(this.measuring, this.measuring);
      return;
    }

    if (this.tool === "erase" && e.button === 0) {
      const wall = this.wallAt(p);
      if (wall) {
        // Не оптимистично: стена пропадёт по wall.removed, сервер может отказать.
        this.cb.onRemoveWall(wall.id);
        return;
      }
      // Мимо стен - панорама, как в режиме выбора.
    }

    if (this.tool === "select" && e.button === 0) {
      // Дверь под курсором - открыть или закрыть. Решает сервер: запертую
      // игроку не откроет, ГМ с Shift запирает и отпирает.
      const door = this.doorAt(p);
      if (door) {
        const next =
          e.shiftKey && this.gm
            ? door.door_state === "locked" ? "closed" : "locked"
            : door.door_state === "open" ? "closed" : "open";
        this.cb.onDoor(door.id, next);
        return;
      }
    }

    if (this.tool === "select" && e.button === 0 && e.shiftKey) {
      this.cancelLongPress();
      this.marquee = {start: {x: p.x, y: p.y}, base: [...this.selectedIds]};
      this.pointerScene = p;
      return;
    }

    if (e.button === 1 || e.button === 2 || this.tool === "select" || this.tool === "erase") {
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
      const c = this.snapToken(p, 1);
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
    // И выпадающие списки листа, и редактор описаний (contenteditable):
    // Delete в них не должен удалять токен, Ctrl+Z - отменять стену.
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)
    )
      return;

    if (e.key === "Escape") {
      this.cancelDrag();
      this.marquee = null;
      this.select(null);
      this.endChain();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (this.wallStart) this.endChain();
      else this.undoMine();
      return;
    }
    // Backspace - для маков, где отдельной Delete нет.
    if ((e.key === "Delete" || e.key === "Backspace") && this.tool === "select" && this.selectedIds.size) {
      e.preventDefault();
      if (!e.repeat) this.removeSelected();
    }
  };

  private onPointerMove = (e: FederatedPointerEvent) => {
    this.pointerScene = this.toScene(e);
    if (this.longPress && Math.hypot(e.global.x - this.longPress.x, e.global.y - this.longPress.y) > 10) {
      this.cancelLongPress(); // повёл пальцем - это панорама
    }

    if (this.marquee) {
      const r = this.fogRect(this.marquee.start, this.pointerScene);
      this.ghostLayer.clear().rect(r.x, r.y, r.w, r.h)
        .fill({color: COLORS.selection, alpha: 0.12})
        .stroke({width: 1.5 / this.world.scale.x, color: COLORS.selection});
      return;
    }
    if (this.fogDrag) {
      const r = this.fogRect(this.fogDrag, this.pointerScene);
      const g = this.ghostLayer;
      g.clear();
      g.rect(r.x, r.y, r.w, r.h)
        .fill({ color: this.fogMode === "cover" ? 0x07080b : 0xf0b14a, alpha: 0.25 })
        .stroke({ width: 2, color: this.fogMode === "cover" ? 0x6fa8dc : 0xf0b14a });
      return;
    }

    if (this.panning) {
      this.world.position.set(
        this.panning.origX + (e.global.x - this.panning.startX),
        this.panning.origY + (e.global.y - this.panning.startY),
      );
      return;
    }

    if (this.dragging) {
      const { view, grab } = this.dragging;
      const raw = { x: this.pointerScene.x - grab.x, y: this.pointerScene.y - grab.y };
      const c = e.altKey ? raw : this.snapToken(raw, view.data.size);
      this.dragging.to = {x: Math.max(0, Math.min(this.sceneWidth, c.x)), y: Math.max(0, Math.min(this.sceneHeight, c.y))};
      const drag = this.dragging;
      this.drawMovementPreview(drag.id, view.data.id, drag.to.x, drag.to.y, ++drag.step);
      if (performance.now() - drag.lastSent >= 100) {
        drag.lastSent = performance.now();
        this.cb.onPreview?.({id: view.data.id, drag_id: drag.id, step: drag.step, ...drag.to});
      }
      // Сколько прошёл и сколько можно по листу. Не запрещаем - решает стол
      // (рывок, хоумбрю); сервер проверяет только стены.
      const speed = view.data.character_id ? this.stats.get(view.data.character_id)?.speed : undefined;
      this.drawMeasure(this.dragging.from, c, speed, (view.data.size * this.gridSize) / 2);
      return;
    }

    if (this.measuring) {
      this.drawMeasure(this.measuring, this.snapToken(this.pointerScene, 1));
      return;
    }

    if (this.tool === "wall" && this.wallStart) this.drawGhostWall();
    if (this.tool === "erase") this.updateEraseHover();
    // Над дверью в режиме выбора - рука: её можно открыть. Только корню
    // сцены: над токеном PixiJS сам возьмёт курсор токена.
    if (this.tool === "select") this.app.stage.cursor = this.doorAt(this.pointerScene) ? "pointer" : "default";
  };

  private doorAt(p: { x: number; y: number }): Wall | null {
    const w = this.wallAt(p);
    return w && w.kind === "door" ? w : null;
  }

  private fogRect(a: { x: number; y: number }, b: { x: number; y: number }) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  private onPointerUp = () => {
    if (this.marquee) {
      const r = this.fogRect(this.marquee.start, this.pointerScene);
      const ids = new Set(this.marquee.base);
      this.marquee = null;
      this.ghostLayer.clear();
      if (r.w >= 4 && r.h >= 4) {
        for (const [id, view] of this.tokens) {
          const {x, y} = view.data;
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) ids.add(id);
        }
        this.setSelection([...ids]);
      }
    }
    if (this.fogDrag) {
      const r = this.fogRect(this.fogDrag, this.pointerScene);
      this.fogDrag = null;
      this.ghostLayer.clear();
      // Случайный клик без рамки - не команда.
      if (r.w >= 4 && r.h >= 4) this.myFogCmds.add(this.cb.onFog(this.fogMode, r.x, r.y, r.w, r.h));
    }
    this.cancelLongPress();
    this.panning = null;
    this.measuring = null;
    this.clearMeasure();

    if (this.dragging) {
      const { view, from, pingOnClick, id, to, step } = this.dragging;
      this.dragging = null;
      this.dropPreview(id, true);
      if (step > 0) this.cb.onPreviewEnd?.(id);
      if (to.x === from.x && to.y === from.y) {
        if (pingOnClick) this.cb.onPing(to.x, to.y);
        return;
      }
      view.lastDown = 0; // a completed drag is not the first click of a double-click
      this.cb.onMoveToken(view.data.id, to.x, to.y, from);
    }
  };

  private onPointerCancel = () => {
    this.cancelDrag();
    this.panning = null;
    this.marquee = null;
    this.fogDrag = null;
    this.ghostLayer.clear();
  };

  private cancelDrag() {
    const drag = this.dragging;
    if (!drag) return;
    this.dragging = null;
    this.dropPreview(drag.id, true);
    if (drag.step > 0) this.cb.onPreviewEnd?.(drag.id);
    drag.view.lastDown = 0;
    drag.view.node.position.set(drag.view.data.x, drag.view.data.y);
    this.clearMeasure();
  }

  private dropPreview(id: string, final = false) {
    const view = this.movementPreviews.get(id);
    if (view) {view.node.destroy({children:true}); this.movementPreviews.delete(id);}
    if (final) {
      this.previewClosed.add(id);
      if (this.previewClosed.size > 512) this.previewClosed.delete(this.previewClosed.values().next().value!);
    }
  }

  clearDragPreviews() {
    this.cancelDrag();
    for (const id of [...this.movementPreviews.keys()]) this.dropPreview(id, true);
  }

  private clearTokenPreviews(id: string) {
    if (this.dragging?.view.data.id === id) this.cancelDrag();
    for (const [key, view] of this.movementPreviews) if (view.tokenId === id) this.dropPreview(key, true);
  }

  applyTokenPreview(message: TokenPreview) {
    if (this.destroyed) return;
    const last = this.previewSteps.get(message.drag_id) ?? 0;
    if (message.step < last || (!message.end && message.step === last)) return;
    this.previewSteps.set(message.drag_id, message.step);
    if (this.previewSteps.size > 512) this.previewSteps.delete(this.previewSteps.keys().next().value!);
    if (message.end) {this.dropPreview(message.drag_id, message.final !== false); return;}
    if (typeof message.x !== "number" || typeof message.y !== "number" || !Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
    this.drawMovementPreview(message.drag_id, message.id, message.x, message.y, message.step);
  }

  private drawMovementPreview(id: string, tokenId: string, x: number, y: number, step: number) {
    if (this.previewClosed.has(id)) return;
    const token = this.tokens.get(tokenId);
    if (!token) return;
    let view = this.movementPreviews.get(id);
    if (!view) {
      const node = new Container(), line = new Graphics(), body = new Graphics(), image = new Sprite(), mask = new Graphics();
      node.eventMode = "none";
      image.mask = mask;
      node.addChild(line, body, image, mask);
      this.movementLayer.addChild(node);
      view = {node, line, body, image, mask, tokenId, step, expires:0};
      this.movementPreviews.set(id, view);
    }
    view.step = step;
    view.expires = performance.now() + 2000;
    const radius = token.data.size * this.gridSize / 2 - 3;
    view.line.clear().moveTo(token.data.x, token.data.y).lineTo(x, y).stroke({width:1.5/this.world.scale.x,color:COLORS.selection,alpha:0.65});
    view.body.clear().circle(x,y,radius).fill({color:parseInt(token.data.color.replace("#", ""),16)||0xc75c5c,alpha:0.4}).stroke({width:2,color:COLORS.selection,alpha:0.7});
    view.image.visible = token.image.visible && token.image.texture !== Texture.EMPTY;
    if (view.image.visible) {
      view.image.texture = token.image.texture;
      view.image.anchor.set(0.5);
      view.image.position.set(x,y);
      const scale = 2*radius/Math.min(view.image.texture.width,view.image.texture.height);
      view.image.scale.set(scale);
      view.image.alpha = 0.45;
    }
    view.mask.clear().circle(x,y,radius).fill({color:0xffffff});
  }

  private tickPreviews = () => {
    const now = performance.now();
    const drag = this.dragging;
    if (drag && drag.step > 0 && now - drag.lastSent >= 100) {
      drag.lastSent = now;
      this.drawMovementPreview(drag.id, drag.view.data.id, drag.to.x, drag.to.y, ++drag.step);
      this.cb.onPreview?.({id:drag.view.data.id,drag_id:drag.id,step:drag.step,...drag.to});
    }
    for (const [id, view] of this.movementPreviews) if (view.expires <= now && this.dragging?.id !== id) this.dropPreview(id, false);
  };

  // --- расстояния -----------------------------------------------------

  /**
   * Клеток между точками. Как в 5e по умолчанию: диагональ - тоже одна
   * клетка (наибольшая из разниц по осям).
   */
  private cellsBetween(a: { x: number; y: number }, b: { x: number; y: number }) {
    const g = this.gridSize;
    return Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / g);
  }

  /** radius - у перетаскиваемого токена: подпись над ним, а не на значке КД. */
  private drawMeasure(a: { x: number; y: number }, b: { x: number; y: number }, speed?: number, radius?: number) {
    const ft = this.cellsBetween(a, b) * FEET_PER_CELL;
    const over = speed !== undefined && ft > speed;
    const color = over ? 0xe0605a : COLORS.selection;
    const g = this.measureLayer;
    g.clear();
    if (ft === 0) {
      this.measureLabel.visible = false;
      return;
    }
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 3, color, alpha: 0.9 });
    g.circle(a.x, a.y, 5).fill({ color });
    g.circle(b.x, b.y, 5).fill({ color });
    this.measureLabel.text = speed !== undefined ? `${ft} / ${speed} фт` : `${ft} фт`;
    this.measureLabel.style.fill = over ? 0xffb0a8 : 0xffffff;
    if (radius) {
      this.measureLabel.anchor.set(0.5, 1);
      this.measureLabel.anchor.set(0, 0);
      const corner = this.world.toLocal({ x: 16, y: 16 } as any);
      this.measureLabel.position.copyFrom(corner);
    } else {
      this.measureLabel.anchor.set(0, 1);
      this.measureLabel.position.set(b.x + 12, b.y - 12);
    }
    this.measureLabel.scale.set(1 / this.world.scale.x);
    this.measureLabel.visible = true;
  }

  private clearMeasure() {
    this.measureLayer.clear();
    this.measureLabel.visible = false;
  }

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
    this.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
  };

  /**
   * Свободная клетка у центра экрана - куда ставить токен из списка мобов.
   * Пятерых гоблинов подряд не надо растаскивать из одной клетки.
   */
  dropPoint(clientX: number, clientY: number) {
    const rect = this.app.canvas.getBoundingClientRect();
    return this.snapToken(this.world.toLocal({ x: clientX - rect.left, y: clientY - rect.top } as any), 1);
  }

  freeCellNearCenter(): { x: number; y: number } {
    const p = this.world.toLocal({ x: this.app.screen.width / 2, y: this.app.screen.height / 2 } as any);
    const c = this.snapToken(p, 1); // в клетку, как и при постановке кликом
    const g = this.gridSize;
    const busy = (x: number, y: number) =>
      [...this.tokens.values()].some((v) => Math.abs(v.data.x - x) < g / 2 && Math.abs(v.data.y - y) < g / 2);
    // Кольцами вокруг центра: сначала соседние клетки, потом дальше.
    for (let ring = 0; ring <= 6; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const x = c.x + dx * g;
          const y = c.y + dy * g;
          if (x > 0 && y > 0 && x < this.sceneWidth && y < this.sceneHeight && !busy(x, y)) return { x, y };
        }
      }
    }
    return c;
  }

  /** Кнопки масштаба: относительно центра экрана. */
  zoomBy(factor: number) {
    if (this.destroyed) return;
    this.zoomAt(factor, this.app.screen.width / 2, this.app.screen.height / 2);
  }

  /** Масштаб с точкой (px, py) на экране, которая остаётся на месте. */
  private zoomAt(factor: number, px: number, py: number) {
    const before = this.world.toLocal({ x: px, y: py } as any);
    const next = Math.max(0.15, Math.min(4, this.world.scale.x * factor));
    this.world.scale.set(next);
    const after = this.world.toLocal({ x: px, y: py } as any);

    // Держим точку под курсором на месте.
    this.world.position.x += (after.x - before.x) * next;
    this.world.position.y += (after.y - before.y) * next;
    this.cb.onZoom(next);
  }
}
