import { LightingPanel } from './LightingPanel';
import { useState, useRef, type FormEvent } from 'react';
import { Aperture, BrickWall, Check, DoorClosed, Eye, EyeOff, Folder, ImagePlus, Layers3, Pencil, Plus, Trash2, PanelsTopLeft } from 'lucide-react';
import { emptyScene, objectKinds, tokenSizes, type TokenSize, type Campaign, type MapObject, type Scene, type WallMode, type Tool } from '../../entities/model';
import { readUvtt } from './uvtt';
import { MapThumbnail } from '../../shared/map-art';
import { Back, Button, Empty, IconButton } from '../../shared/ui';

export function SceneLibrary({ campaign, onSave, onActivate, onDelete, onFolder }: {
  campaign: Campaign; onSave: (s: Scene, active?: boolean) => void; onActivate: (id: string) => void; onDelete: (id: string) => void; onFolder: (name: string) => void;
}) {
  const [draft, setDraft] = useState<Scene | null>(null);
  const [search, setSearch] = useState('');
  const [newFolder, setNewFolder] = useState(false);
  const [folder, setFolder] = useState('');
  const [deleting, setDeleting] = useState<Scene | null>(null);
  const folders = ['Без папки', ...campaign.sceneFolders];
  function save(event: FormEvent) {
    event.preventDefault();
    if (draft?.name.trim()) {
      onSave({ ...draft, name: draft.name.trim() });
      setDraft(null);
    }
  }
  if (draft) return <form onSubmit={save} className="editor">
    <Back onClick={() => setDraft(null)}>Сцены</Back>
    <div className="form-grid">
      <label>Название сцены<input required maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
      <label>Папка<select value={draft.folder} onChange={e => setDraft({ ...draft, folder: e.target.value })}>{folders.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Подложка<select value={draft.background ? 'uvtt' : draft.art} onChange={e => setDraft({ ...draft, background: undefined, art: e.target.value as Scene['art'] })}>
        {draft.background && <option value="uvtt">Импортирована из UVTT</option>}<option value="abbey">Аббатство</option><option value="crypt">Крипта</option><option value="woods">Старая переправа</option></select></label>
      <label>Размер клетки<input type="number" required min={0.01} max={760} step="any" value={draft.grid} onChange={e => setDraft({ ...draft, grid: Number(e.target.value) })}/></label>
    </div>
    <label className="checkline"><input type="checkbox" checked={draft.showGrid} onChange={e => setDraft({ ...draft, showGrid: e.target.checked })}/>Показывать сетку</label>
    <button className="button primary" type="submit">Сохранить сцену</button>
  </form>;
  return <>
    <div className="dialog-tools"><input type="search" placeholder="Поиск сцен…" aria-label="Поиск сцен" value={search} onChange={e => setSearch(e.target.value)}/>
      <Button onClick={() => setNewFolder(value => !value)}><Folder size={16}/>Папка</Button>
      <Button className="primary" onClick={() => setDraft(emptyScene('', 'Без папки'))}><Plus size={16}/>Новая сцена</Button>
    </div>
    {newFolder && <form className="inline-form" onSubmit={e => { e.preventDefault(); if (folder.trim()) { onFolder(folder.trim()); setFolder(''); setNewFolder(false); } }}>
      <input aria-label="Название папки" placeholder="Название папки" value={folder} onChange={e => setFolder(e.target.value)} required maxLength={55}/><button className="button" type="submit">Создать папку</button>
    </form>}
    {deleting && <div className="confirm"><strong>Удалить сцену «{deleting.name}»?</strong><Button onClick={() => setDeleting(null)}>Отмена</Button><Button className="danger" onClick={() => { onDelete(deleting.id); setDeleting(null); }}>Удалить</Button></div>}
    {folders.map(name => {
      const scenes = campaign.scenes.filter(scene => scene.folder === name && scene.name.toLowerCase().includes(search.toLowerCase()));
      if (!scenes.length && (search || name === 'Без папки')) return null;
      return <section className="scene-group" key={name}><h3><Folder size={15}/>{name}</h3>
        {scenes.length ? <div className="card-grid">{scenes.map(scene => <article className="catalog-card" key={scene.id}>
          <div className="catalog-art">{scene.background ? <img className="scene-thumbnail" src={scene.background.image} alt=""/> : <MapThumbnail art={scene.art}/>}<span className={`badge ${scene.id === campaign.activeScene ? 'live' : ''}`}>{scene.id === campaign.activeScene ? 'Активна' : 'Неактивна'}</span></div>
          <div className="catalog-content"><h4>{scene.name}</h4><p>5 фт. на клетку · {scene.objects.length} объектов</p><div className="card-actions">
            <Button className="primary" onClick={() => onActivate(scene.id)}>{scene.id === campaign.activeScene ? 'Открыть' : 'Активировать'}</Button>
            <IconButton label={`Редактировать ${scene.name}`} onClick={() => setDraft(scene)}><Pencil size={15}/></IconButton>
            <IconButton label={`Удалить ${scene.name}`} disabled={campaign.scenes.length < 2} onClick={() => setDeleting(scene)}><Trash2 size={15}/></IconButton>
          </div></div>
        </article>)}</div> : <Empty>В этой папке пока нет сцен.</Empty>}
      </section>;
    })}
    {search && !campaign.scenes.some(s => s.name.toLowerCase().includes(search.toLowerCase())) && <Empty>Сцены по этому запросу не найдены.</Empty>}
  </>;
}

export function Inspector({ object, tool, wallMode, onWallMode, onTool, onUndo, canUndo, onObject, onDelete }: {
  wallMode: WallMode; onWallMode: (mode: WallMode) => void; tool: Tool; onTool: (tool: Tool) => void; onUndo: () => void; canUndo: boolean;
  object?: MapObject; onObject: (o: MapObject) => void; onDelete: () => void;
}) {
  if (tool === 'wall' || tool === 'door' || tool === 'window') return <aside className="inspector geometry-inspector" aria-label="Геометрия">
    <h2>Геометрия</h2>
    <p>Разметка сцены · только для ГМ</p>
    <div className="geometry-tools">{([['wall', 'Стена', BrickWall], ['door', 'Дверь', DoorClosed], ['window', 'Окно', PanelsTopLeft]] as const).map(([id, label, Icon]) =>
      <Button key={id} aria-pressed={tool === id} onClick={() => onTool(id)}><Icon size={17}/>{label}</Button>)}</div>
    {tool === 'wall' && <><label>Форма стены<select value={wallMode} onChange={event => onWallMode(event.target.value as WallMode)}>
      <option value="line">Прямые линии</option><option value="curve">Кривые линии</option><option value="rectangle">Квадрат / прямоугольник</option><option value="circle">Круг</option><option value="ellipse">Овал</option>
    </select></label><p>{wallMode === 'line' ? 'Щёлкайте по вершинам. Каждый отрезок продолжает стену.'
      : wallMode === 'curve' ? 'Укажите начало, изгиб и конец. Следующая кривая продолжит стену.'
      : 'Укажите два противоположных угла. Каждая сторона редактируется отдельно.'}</p></>}
    {tool !== 'wall' && <p>Укажите начало и конец отрезка на карте.</p>}
    <div className="geometry-tools">
      <Button onClick={onUndo} disabled={!canUndo}>Отменить шаг</Button>
      <Button className="selected" onClick={() => onTool('select')}>Готово</Button>
    </div>
    <p>Esc — отменить размещение.</p>
  </aside>;
  if (object && (object.kind === 'wall' || object.kind === 'door' || object.kind === 'window')) {
    const Icon = { wall: BrickWall, door: DoorClosed, window: PanelsTopLeft }[object.kind];
    return <aside className="inspector segment-inspector glass" aria-label={objectKinds[object.kind]}>
      <div><Icon size={17}/><strong>{objectKinds[object.kind]}</strong>
        <IconButton label="Удалить отрезок" onClick={onDelete}><Trash2 size={16}/></IconButton>
      </div>
      <small>Перетащите конец отрезка на карте</small>
      {object.kind !== 'wall' && <label className="checkline"><input type="checkbox" checked={object.showGeometryIcon !== false}
        onChange={event => onObject({ ...object, showGeometryIcon: event.target.checked })}/>Значок на карте</label>}
    </aside>;
  }
  if (!object) return null;
  return <aside className="inspector glass" aria-label={objectKinds[object.kind]}>
    <div className="inspector-head"><Layers3 size={16}/><strong>{objectKinds[object.kind]}</strong></div>
      {object.kind === 'token' && <TokenSizeSelect object={object} onObject={onObject}/>}
      <label>Название<input aria-label="Название объекта" maxLength={80} value={object.name} onChange={e => onObject({ ...object, name: e.target.value })}/></label>
      {object.kind === 'light' && <LightingPanel key={object.id} object={object} onChange={onObject}/>}
      {(object.kind === 'token' || object.kind === 'prop') && <Button onClick={() => onObject({ ...object, secret: !object.secret })}>{object.secret ? <Eye size={15}/> : <EyeOff size={15}/>} {object.secret ? 'Показать игрокам' : 'Скрыть от игроков'}</Button>}
      <Button className="ghost danger-text" onClick={onDelete}><Trash2 size={15}/>Удалить объект</Button>
  </aside>;
}

export function TokenSizeSelect({ object, onObject }: { object: MapObject; onObject: (next: MapObject) => void }) {
  return <label>Размер токена<select value={object.size ?? 'medium'} onChange={event =>
    onObject({ ...object, size: event.target.value as TokenSize })}>
    {Object.entries(tokenSizes).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
  </select></label>;
}

export function SceneProperties({ scene, onScene }: { scene: Scene; onScene: (next: Scene) => void }) {
  return <details className="scene-properties">
    <summary>Настройки сцены</summary>
    <label>Освещение сцены <output>{scene.ambient}%</output><input aria-label="Освещение сцены" type="range" min={0} max={100}
      value={scene.ambient} onChange={event => onScene({ ...scene, ambient: Number(event.target.value) })}/></label>
    <label className="checkline"><input type="checkbox" checked={scene.vision}
      onChange={event => onScene({ ...scene, vision: event.target.checked })}/>Динамический обзор</label>
    <label className="checkline"><input type="checkbox" checked={scene.explored}
      onChange={event => onScene({ ...scene, explored: event.target.checked })}/>Разведанная область</label>
    <div className="micro"><Aperture size={13}/> Визуальная имитация обзора</div>
  </details>;
}

export function UVTT({ onImport }: { onImport: (scene: Scene) => void }) {
  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState<ReturnType<typeof readUvtt>>();
  const [error, setError] = useState('');
  const fileRequest = useRef(0);
  const [layers, setLayers] = useState({ walls: true, doors: true, lights: true, grid: true });
  const [done, setDone] = useState(false);
  const valid = /\.(uvtt|dd2vtt|df2vtt)$/i.test(name);
  return <div className="editor">
    <p className="lede">Проверьте подложку, сетку и объекты до появления сцены в библиотеке. Можно загрузить локальный файл или открыть демонстрационный пример.</p>
    <div className="inline-form"><label className="file-label"><ImagePlus size={18}/>Выбрать UVTT-файл<input type="file" accept=".uvtt,.dd2vtt,.df2vtt" onChange={async e => {
      const selected = e.target.files?.[0];
      const request = ++fileRequest.current;
      setLoaded(undefined); setError(''); setDone(false); setName('');
      if (!selected) return;
      try {
        if (selected.size > 20_000_000) throw new Error('Размер файла превышает 20 МБ.');
        const parsed = readUvtt(await selected.text(), selected.name);
        const preview = new Image();
        preview.src = parsed.scene.background?.image ?? '';
        await preview.decode().catch(() => { throw new Error('Не удалось прочитать изображение карты.'); });
        if (request === fileRequest.current) { setName(selected.name); setLoaded(parsed); }
      } catch (cause) {
        if (request === fileRequest.current) setError(cause instanceof Error ? cause.message : 'Не удалось открыть UVTT.');
      }
    }}/></label>
      <Button onClick={() => { fileRequest.current++; setLoaded(undefined); setError(''); setName('Аббатство.dd2vtt'); setDone(false); }}>Использовать пример</Button></div>
    {error && <div className="error" role="alert">{error}</div>}
    {name && !valid && <div className="error" role="alert">Формат «{name}» не поддерживается. Выберите .uvtt, .dd2vtt или .df2vtt.</div>}
    {valid && !done && <div className="import-preview">
      <div className="import-art">{loaded?.scene.background ? <svg viewBox="0 0 1100 760" aria-label="Предпросмотр импортированной карты">
        <image href={loaded.scene.background.image} x={loaded.scene.background.x} y={loaded.scene.background.y}
          width={loaded.scene.background.width} height={loaded.scene.background.height} preserveAspectRatio="none"/>
        {layers.grid && <><defs><pattern id="uvtt-preview-grid" patternUnits="userSpaceOnUse" x={loaded.scene.background.x}
          y={loaded.scene.background.y} width={loaded.scene.grid} height={loaded.scene.grid}><path d={`M${loaded.scene.grid} 0H0V${loaded.scene.grid}`} fill="none" stroke="#eee" strokeOpacity=".45"/></pattern></defs>
          <rect x={loaded.scene.background.x} y={loaded.scene.background.y} width={loaded.scene.background.width} height={loaded.scene.background.height} fill="url(#uvtt-preview-grid)"/></>}
        {loaded.scene.objects.map(object => object.end && (object.kind === 'wall' ? layers.walls : layers.doors) ?
          <line key={object.id} x1={object.x} y1={object.y} x2={object.end.x} y2={object.end.y} stroke={object.kind === 'wall' ? '#eb9a6c' : '#f0ca7c'} strokeWidth={3}/>
          : object.kind === 'light' && layers.lights && <circle key={object.id} cx={object.x} cy={object.y} r={object.radius} fill={object.color} fillOpacity=".3"/>)}
      </svg> : <><MapThumbnail art="abbey"/><svg viewBox="0 0 500 300" preserveAspectRatio="none" aria-hidden>
        {layers.grid && <path d="M50 0v300m50-300v300m50-300v300m50-300v300m50-300v300m50-300v300m50-300v300m50-300v300m50-300v300M0 50h500M0 100h500M0 150h500M0 200h500M0 250h500" stroke="#c7d1c3" strokeOpacity=".26"/>}
        {layers.walls && <path d="M160 68H320V130H394V229H112V136H160Z" fill="none" stroke="#eb9a6c" strokeWidth="3"/>}
        {layers.doors && <path d="M244 229h48" stroke="#f0ca7c" strokeWidth="5" strokeDasharray="6 3"/>}
        {layers.lights && <circle cx="250" cy="105" r="39" fill="#f0b14a" fillOpacity=".27" stroke="#f0b14a" strokeDasharray="4 4"/>}
      </svg></>}</div>
      <div className="editor"><h3>{name}</h3><div className="badge">Universal VTT · {loaded?.version ?? 'образец 0.3'}</div>
        {([['walls','Стены'],['doors','Двери'],['lights','Источники света'],['grid','Сетка']] as const).map(([key,label]) => <label className="checkline" key={key}><input type="checkbox" checked={layers[key]} onChange={e => setLayers({ ...layers, [key]: e.target.checked })}/>{label}</label>)}
        <div className="warning">{loaded ? `Пропущено элементов: ${loaded.omitted}. Порталы импортируются как двери. Интенсивность света не переносится.` : 'Окно из образца импортируется как участок стены.'}</div>
        <Button className="primary" onClick={() => {
          if (loaded) {
            onImport({ ...loaded.scene, showGrid: layers.grid, objects: loaded.scene.objects.filter(object =>
              object.kind === 'wall' ? layers.walls : object.kind === 'door' ? layers.doors : layers.lights) });
            setDone(true);
            return;
          }
          const draft = emptyScene(name.replace(/\.[^.]+$/, ''), 'Без папки');
          onImport({ ...draft, showGrid: layers.grid, objects: [
            ...(layers.walls ? [{ id: draft.id + 'wall', kind: 'wall' as const, name: 'Стена из UVTT', x: 381, y: 260, end: { x: 581, y: 260 } }] : []),
            ...(layers.doors ? [{ id: draft.id + 'door', kind: 'door' as const, name: 'Дверь из UVTT', x: 460, y: 537, end: { x: 508, y: 537 } }] : []),
            ...(layers.lights ? [{ id: draft.id + 'light', kind: 'light' as const, name: 'Свет из UVTT', x: 481, y: 241, radius: 130, color: '#f0b14a' }] : []),
          ] });
          setDone(true);
        }}>Подтвердить импорт</Button>
      </div>
    </div>}
    {done && <div className="success"><Check size={19}/>Сцена создана. Откройте её через библиотеку сцен.</div>}
  </div>;
}
