import { useEffect, useRef, useState } from "react";
import { useUi } from "../state/store";
import type { SceneSocket } from "../net/socket";
import type { SceneInfo } from "../types";
import { MapSettings } from "./MapSettings";
import { ConfirmDialog } from "./ConfirmDialog";
import { Logo } from "./icons";

/** GM-only browser. Folder metadata never contains or renders scene state. */
export function ScenesPanel({ socket, sceneId, onOpenScene }: {
  socket: SceneSocket; sceneId: string; onOpenScene: (id: string) => void;
}) {
  const scenes = useUi(s => s.scenes), folders = useUi(s => s.folders);
  const activeSceneId = useUi(s => s.activeSceneId), userId = useUi(s => s.me?.id);
  const [name, setName] = useState(""), [folderName, setFolderName] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [sceneRename, setSceneRename] = useState<{id: string; name: string} | null>(null);
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const settings = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (editingSceneId === sceneId && settings.current) {settings.current.open = true; settings.current.scrollIntoView({block:"nearest"});}
  }, [editingSceneId, sceneId]);
  const [rename, setRename] = useState<{id: string; name: string} | null>(null);
  const [remove, setRemove] = useState<{id: string; name: string; folder: boolean} | null>(null);
  const key = `lanterna.sceneFolders.${userId}`;
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try { const v: unknown = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []; }
    catch { return []; }
  });
  const toggle = (id: string) => {
    const next = collapsed.includes(id) ? collapsed.filter(v => v !== id) : [...collapsed, id];
    setCollapsed(next); localStorage.setItem(key, JSON.stringify(next));
  };
  const move = (id: string, folder_id: string | null, before_id?: string) => {
    socket.send("scene.move", {id, folder_id, ...(before_id ? {before_id} : {})}); setMenu(null);
  };
  const drop = (e: React.DragEvent, folder: string | null, before?: string) => {
    e.preventDefault(); e.stopPropagation();
    const id = e.dataTransfer.getData("application/x-laterna-scene");
    if (id && id !== before && scenes.some(s => s.id === id)) move(id, folder, before);
  };
  const card = (s: SceneInfo, siblings: SceneInfo[], index: number) => (
    <li key={s.id} data-scene-id={s.id} className={`scene-row scene-card ${s.id === sceneId ? "scene-row-here" : ""} ${s.id === activeSceneId ? "scene-card-active" : ""}`}
      draggable onDragStart={e => {e.dataTransfer.setData("application/x-laterna-scene", s.id); e.dataTransfer.effectAllowed = "move";}}
      onDragOver={e => e.preventDefault()} onDrop={e => drop(e, s.folder_id ?? null, s.id)}
      onContextMenu={e => {e.preventDefault(); setMenu(s.id);}}>
      <button type="button" className="scene-preview" aria-label={`Открыть сцену ${s.name}`} onClick={() => onOpenScene(s.id)}>
        <span className="scene-placeholder" role="img" aria-label="Сцена без превью"><Logo size={36} /></span>
        {s.preview_url && <img key={s.preview_url} src={s.preview_url} alt={`Превью: ${s.name}`} loading="lazy" draggable={false} decoding="async" onError={e => {e.currentTarget.hidden = true;}} />}
      </button>
      <span className="scene-row-name" title={s.name}>{s.name}</span>
      {s.id === activeSceneId && <span className="badge-live">видят игроки</span>}
      {s.id === sceneId && <span className="scene-gm-badge">Открыта у ГМ</span>}
      <span className="scene-row-actions">
        {s.id !== sceneId && <button className="tool" onClick={() => onOpenScene(s.id)}>Открыть</button>}
        {s.id !== activeSceneId && <button className="tool" onClick={() => socket.send("scene.activate", {id: s.id})}>Показать</button>}
        <button className="tool" aria-label={`Действия сцены ${s.name}`} aria-expanded={menu === s.id} onClick={() => setMenu(menu === s.id ? null : s.id)}>⋯</button>
      </span>
      {menu === s.id && <div className="scene-actions" role="group" aria-label={`Меню сцены ${s.name}`}>
        <button className="tool" onClick={() => {setEditingSceneId(s.id); onOpenScene(s.id); setMenu(null);if(s.id===sceneId&&settings.current){settings.current.open=true;settings.current.scrollIntoView({block:"nearest"});}}}>Настройки сцены</button>
        <button className="tool" onClick={() => setSceneRename({id:s.id,name:s.name})}>Переименовать сцену</button>
        {sceneRename?.id === s.id && <form className="scene-rename" onSubmit={e => {e.preventDefault();socket.send("scene.rename",sceneRename);setSceneRename(null);setMenu(null);}}>
          <input aria-label="Новое название сцены" maxLength={200} value={sceneRename.name} onChange={e => setSceneRename({...sceneRename,name:e.target.value})} />
          <button className="tool" disabled={!sceneRename.name.trim()}>Сохранить название</button>
        </form>}
        <label>Папка<select aria-label={`Папка сцены ${s.name}`} value={s.folder_id ?? ""} onChange={e => move(s.id, e.target.value || null)}>
          <option value="">Без папки</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select></label>
        <div className="side-row">
          <button className="tool" disabled={!index} onClick={() => move(s.id, s.folder_id ?? null, siblings[index - 1]?.id)}>Выше</button>
          <button className="tool" disabled={index === siblings.length - 1} onClick={() => move(s.id, s.folder_id ?? null, siblings[index + 2]?.id)}>Ниже</button>
          {s.id !== activeSceneId && <button className="tool tool-danger" onClick={() => setRemove({id: s.id, name: s.name, folder: false})}>Удалить сцену</button>}
          <button className="tool" aria-label="Закрыть меню сцены" onClick={() => setMenu(null)}>×</button>
        </div>
      </div>}
    </li>
  );
  return <div className="side-panel scene-browser">
    <div className="scene-current-summary" role="status">
      <strong>Игроки: {scenes.find(s=>s.id===activeSceneId)?.name}</strong>
      <span>У ГМ: {scenes.find(s=>s.id===sceneId)?.name}</span>
      <div className="side-row"><button className="tool" onClick={() => {const s=scenes.find(s=>s.id===activeSceneId);if(s){const id=s.folder_id??"";setCollapsed(v=>v.filter(f=>f!==id));onOpenScene(s.id);}}}>К сцене игроков</button>
      <button className="tool" onClick={() => {setEditingSceneId(sceneId);if(settings.current){settings.current.open=true;settings.current.scrollIntoView({block:"nearest"});}}}>Настройки открытой сцены</button></div>
    </div>
    <form className="side-row" onSubmit={e => {e.preventDefault(); if (folderName.trim()) {socket.send("folder.create", {name: folderName.trim()}); setFolderName("");}}}>
      <input className="grow" placeholder="Новая папка" aria-label="Название новой папки" maxLength={200} value={folderName} onChange={e => setFolderName(e.target.value)} />
      <button className="tool" disabled={!folderName.trim()}>+ Папка</button>
    </form>
    {[...folders, {id: "", name: "Без папки"}].map(f => {
      const list = scenes.filter(s => (s.folder_id ?? "") === f.id), shut = collapsed.includes(f.id);
      return <section key={f.id} className="scene-folder" data-folder-id={f.id} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, f.id || null)}>
        <div className="scene-folder-heading">
          <button className="tool grow" aria-expanded={!shut} onClick={() => toggle(f.id)}>{shut ? "▸" : "▾"} {f.name} ({list.length})</button>
          {f.id && <>
            <button className="tool" aria-label={`Переименовать папку ${f.name}`} onClick={() => setRename({id: f.id, name: f.name})}>✎</button>
            <button className="tool" aria-label={`Удалить папку ${f.name}`} onClick={() => setRemove({id: f.id, name: f.name, folder: true})}>×</button>
          </>}
        </div>
        {rename?.id === f.id && <form className="side-row" onSubmit={e => {e.preventDefault(); if (rename.name.trim()) {socket.send("folder.rename", rename); setRename(null);}}}>
          <input aria-label="Новое название папки" className="grow" maxLength={200} value={rename.name} onChange={e => setRename({...rename, name: e.target.value})} />
          <button className="tool">Сохранить</button><button type="button" className="tool" onClick={() => setRename(null)}>Отмена</button>
        </form>}
        {!shut && <ul className="scene-list scene-grid">{list.map((s, i) => card(s, list, i))}</ul>}
        {!shut && !list.length && <p className="muted side-note">Можно перенести сцену сюда</p>}
      </section>;
    })}
    <form className="side-row" onSubmit={e => {e.preventDefault(); socket.send("scene.create", {name: name.trim()}); setName("");}}>
      <input className="grow" placeholder="Новая сцена" maxLength={200} value={name} onChange={e => setName(e.target.value)} /><button className="tool">Создать</button>
    </form>
    <p className="muted side-note">Новая сцена скрыта, пока не нажмёшь «Показать».</p>
    <details className="scene-settings" ref={settings}><summary>Настройки: {scenes.find(s=>s.id===sceneId)?.name}</summary><MapSettings socket={socket} /></details>
    {remove && <ConfirmDialog title={`Удалить ${remove.folder ? "папку" : "сцену"} «${remove.name}»?`}
      text={remove.folder ? "Сцены сохранятся и будут перемещены в «Без папки»." : "Сцена будет удалена вместе с токенами, стенами и туманом."}
      confirmLabel={remove.folder ? "Удалить папку" : "Удалить сцену"} danger onCancel={() => setRemove(null)} onConfirm={() => {
        socket.send(remove.folder ? "folder.delete" : "scene.delete", {id: remove.id}); setRemove(null); setMenu(null);
      }} />}
  </div>;
}
