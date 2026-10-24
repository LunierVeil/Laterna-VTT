import { useEffect, useRef, useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import { uploadImage } from "../net/upload";

// Должны совпадать с MAX_SCENE_SIDE и MAX_UPLOAD_BYTES в server/app/config.py.
const MAX_SIDE = 8192;
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Карта-подложка и размер клетки. Файл уходит на /api/uploads, а сцену
 * меняет только scene.update - как и всё остальное состояние.
 */
export function MapSettings({ socket }: { socket: SceneSocket }) {
  const gridSize = useUi((s) => s.gridSize);
  const background = useUi((s) => s.background);
  const [busy, setBusy] = useState(false);
  const [grid, setGrid] = useState(String(gridSize));
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => setGrid(String(gridSize)), [gridSize]);

  const fail = (msg: string) => useUi.getState().flashError(msg);

  const upload = async (f: File) => {
    setBusy(true);
    try {
      const { url, width, height } = await uploadImage(f, { maxBytes: MAX_BYTES, maxSide: MAX_SIDE, what: "карта" });
      socket.send("scene.update", { background_url: url, width, height });
    } catch (e) {
      fail(e instanceof Error ? e.message : "загрузка не удалась");
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
    <div className="side-panel">
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
      <p className="muted side-note">PNG, JPEG или WebP, до 25 МБ и {MAX_SIDE}px по стороне.</p>

      <form
        className="side-row"
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
      <p className="muted side-note">Подгони под сетку, нарисованную на карте.</p>
    </div>
  );
}
