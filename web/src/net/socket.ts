import type { Scene, ServerMessage } from "../types";

type Listener = (msg: ServerMessage) => void;

interface Pending {
  revert: () => void;
}

/**
 * Клиент протокола.
 *
 * Отвечает за три вещи, которые легко сделать неправильно:
 *  - дедупликация по seq (повтор игнорируем, разрыв -> перезапрос снапшота)
 *  - оптимистичные изменения с откатом по ошибке
 *  - переподключение с новым снапшотом, а не с продолжением с места обрыва
 */
export class SceneSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private pending = new Map<string, Pending>();
  private lastSeq = -1;
  private closedByUs = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private sceneId: string) {}

  connect() {
    this.closedByUs = false;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    // Кто подключается, сервер узнаёт по cookie сессии. В адресе ничего
    // про пользователя нет: адрес попадает в логи, и его легко подделать.
    const url = `${proto}://${location.host}/ws/scene/${this.sceneId}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data) as ServerMessage);
    ws.onopen = () => {
      this.retry = 0;
    };
    ws.onclose = () => {
      if (this.closedByUs) return;
      // Все неподтверждённые изменения откатываем: после обрыва мы не
      // знаем, дошли они или нет. Снапшот при переподключении всё равно
      // перезатрёт состояние.
      this.revertAll();
      this.retry += 1;
      this.retryTimer = setTimeout(() => this.connect(), Math.min(1000 * this.retry, 8000));
    };
  }

  close() {
    // Сервер мог закрыть сокет чуть раньше нас (сцену скрыли) - тогда
    // переподключение уже запланировано, и без этого старый сокет
    // через секунду ожил бы и полез в старую сцену.
    clearTimeout(this.retryTimer);
    this.closedByUs = true;
    this.ws?.close();
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(msg: ServerMessage) {
    for (const l of this.listeners) l(msg);
  }

  private revertAll() {
    for (const p of this.pending.values()) p.revert();
    this.pending.clear();
  }

  private async onMessage(msg: ServerMessage) {
    if (msg.type === "snapshot") {
      this.lastSeq = msg.seq;
      this.revertAll();
      this.emit(msg);
      return;
    }

    if (msg.type === "error") {
      if (msg.cmd_id) {
        this.pending.get(msg.cmd_id)?.revert();
        this.pending.delete(msg.cmd_id);
      }
      this.emit(msg);
      return;
    }

    // Чат и список сцен общие на кампанию и идут мимо seq сцены.
    if (msg.type === "auth_required") {
      // Без сессии переподключаться бессмысленно - сервер ответит тем же.
      this.closedByUs = true;
      this.emit(msg);
      return;
    }

    if (msg.type === "presence" || msg.type === "chat" || msg.type === "campaign" || msg.type === "reply") {
      this.emit(msg);
      return;
    }

    // event
    if (msg.seq <= this.lastSeq) return; // повтор, уже применяли

    if (msg.seq > this.lastSeq + 1) {
      // Разрыв в нумерации: мы что-то пропустили. Чинить догоном событий
      // некорректно, проще честно перезапросить состояние целиком.
      await this.resync();
      return;
    }

    this.lastSeq = msg.seq;
    if (msg.cmd_id) this.pending.delete(msg.cmd_id);
    this.emit(msg);
  }

  private async resync() {
    const res = await fetch(`/api/scenes/${this.sceneId}`);
    const scene = (await res.json()) as Scene;
    if (!scene || (scene as any).error) return;
    this.revertAll();
    this.lastSeq = scene.seq;
    this.emit({ type: "snapshot", seq: scene.seq, scene });
  }

  /**
   * Отправить команду. optimistic.apply выполняется сразу,
   * optimistic.revert - если сервер ответил ошибкой или связь порвалась.
   */
  send(
    name: string,
    payload: Record<string, unknown>,
    optimistic?: { apply: () => void; revert: () => void },
  ): string {
    const id = crypto.randomUUID();
    if (optimistic) {
      optimistic.apply();
      this.pending.set(id, { revert: optimistic.revert });
    }
    this.ws?.send(JSON.stringify({ type: "cmd", id, name, payload }));
    return id;
  }
}
