import { useEffect, useRef, useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";

// Должны совпадать с MAX_SCENE_SIDE и MAX_UPLOAD_BYTES в server/app/config.py.
const MAX_SIDE = 8192;
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Карта-подложка и размер клетки. Файл уходит на /api/uploads, а сцену
 * меняет только scene.update - как и всё остальное состояние.
 */
export function SceneMenu({ socket }: { socket: SceneSocket }) {
  const gridSize = useUi((s) => s.gridSize);
  const background = useUi((s) => s.background);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grid, setGrid] = useState(String(gridSize));
  const root = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => setGrid(String(gridSize)), [gridSize]);

  // Закрыть по клику мимо и по Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const fail = (msg: string) => useUi.getState().flashError(msg);

  const upload = async (f: File) => {
    if (f.size > MAX_BYTES) return fail(`файл больше ${MAX_BYTES / 1024 / 1024} МБ`);
    setBusy(true);
    try {
      // Размер узнаём до отправки: слишком большую карту отсекаем сразу,
      // а не после того, как она легла на сервер.
      let width: number, height: number;
      try {
        const bmp = await createImageBitmap(f);
        ({ width, height } = bmp);
        bmp.close();
      } catch {
        return fail("это не картинка или формат не поддерживается");
      }
      if (width > MAX_SIDE || height > MAX_SIDE) {
        return fail(`карта ${width}×${height}, максимум ${MAX_SIDE} по стороне - уменьши`);
      }

      const res = await fetch("/api/uploads", { method: "POST", body: f });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return fail(body.detail || `загрузка не удалась (${res.status})`);

      socket.send("scene.update", { background_url: body.url, width, height });
      setOpen(false);
    } catch (e) {
      console.error("загрузка карты", e);
      fail("загрузка не удалась");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const applyGrid = () => {
    const n = Math.round(Number(grid));
    if (!Number.isFinite(n) || n < 10 || n > 400) {
      setGrid(String(gridSize));
      return fail("клетка - от 10 до 400 пикселей");
    }
    if (n !== gridSize) socket.send("scene.update", { grid_size: n });
  };

  return (
    <div className="scene-menu" ref={root}>
      <button className={open ? "tool tool-active" : "tool"} onClick={() => setOpen((o) => !o)}>
        Карта
      </button>
      {open && (
        <div className="scene-menu-pop">
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <button className="tool" disabled={busy} onClick={() => file.current?.click()}>
            {busy ? "Загрузка..." : background ? "Заменить карту" : "Загрузить карту"}
          </button>
          {background && (
            <button
              className="tool"
              disabled={busy}
              onClick={() => socket.send("scene.update", { background_url: null })}
            >
              Убрать карту
            </button>
          )}
          <p className="muted scene-menu-note">PNG, JPEG или WebP, до 25 МБ и {MAX_SIDE}px по стороне.</p>

          <form
            className="scene-menu-row"
            onSubmit={(e) => {
              e.preventDefault();
              applyGrid();
            }}
          >
            <label htmlFor="grid-size">Клетка, px</label>
            <input
              id="grid-size"
              type="number"
              min={10}
              max={400}
              value={grid}
              onChange={(e) => setGrid(e.target.value)}
              onBlur={applyGrid}
            />
          </form>
          <p className="muted scene-menu-note">Подгони под сетку, нарисованную на карте.</p>
        </div>
      )}
    </div>
  );
}
