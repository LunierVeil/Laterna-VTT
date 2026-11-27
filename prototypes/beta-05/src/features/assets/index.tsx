import { DecalPatterns } from './DecalPatterns';
import { useState } from 'react';
import { Folder, ImagePlus, Plus, Search } from 'lucide-react';
import { uid, type Asset, type DecalPattern } from '../../entities/model';
import { Button, Empty, Glyph } from '../../shared/ui';

const categories = ['Все', 'Объекты', 'Декали', 'Портреты'] as const;
export function AssetLibrary({ assets, folders, onUpload, onFolder, onPlace, onPortrait, onRemove, onMove, onDecal }: {
  onDecal: (name: string, pattern: DecalPattern) => void; assets: Asset[]; folders: string[]; onUpload: (asset: Asset) => void; onFolder: (name: string) => void;
  onPlace: (asset: Asset) => void; onPortrait?: (asset: Asset) => void; onRemove: (id: string) => void; onMove: (id: string, folder: string) => void;
}) {
  const [kind, setKind] = useState<typeof categories[number]>('Все');
  const [folder, setFolder] = useState('');
  const [search, setSearch] = useState('');
  const [activeId, setActive] = useState<string>();
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState<File>();
  const [uploadError, setUploadError] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [uploadKind, setUploadKind] = useState<Asset['kind']>('Объекты');
  const [uploadFolder, setUploadFolder] = useState('Мои ассеты');
  const [newFolder, setNewFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [remove, setRemove] = useState(false);
  const filtered = assets.filter(asset => (kind === 'Все' || kind === asset.kind) && (!folder || folder === asset.folder) && asset.name.toLowerCase().includes(search.trim().toLowerCase()));

  const active = filtered.find(asset => asset.id === activeId);
  return <>
    <div className="dialog-tools">
      <div className="search-input"><Search size={16}/><input type="search" placeholder="Поиск ассетов…" aria-label="Поиск ассетов" value={search} onChange={e => setSearch(e.target.value)}/></div>
      <Button className="primary" onClick={() => { setUploadFolder(folder || 'Мои ассеты'); setShowUpload(value => !value); }}><Plus size={15}/>Загрузить ассет</Button>
    </div>
    <div className="asset-folders" aria-label="Папки ассетов">
      <Button aria-pressed={!folder} onClick={() => setFolder('')}>Все папки</Button>
      {folders.map(name => <Button key={name} aria-pressed={folder === name} onClick={() => setFolder(name)}><Folder size={14}/>{name}</Button>)}
      <Button onClick={() => setNewFolder(value => !value)}>{newFolder ? 'Отмена' : 'Новая папка'}</Button>
    </div>
    {newFolder && <form className="inline-form" onSubmit={e => { e.preventDefault(); if (folderName.trim()) { onFolder(folderName.trim()); setFolder(folderName.trim()); setFolderName(''); setNewFolder(false); } }}><input aria-label="Название папки" placeholder="Название папки" value={folderName} onChange={e => setFolderName(e.target.value)} required maxLength={55}/><button className="button" type="submit">Создать папку</button></form>}
    {showUpload && <form className="upload-box editor" onSubmit={e => {
      e.preventDefault();
      if (!uploadName.trim()) return;
      if (file && (!['image/png', 'image/webp'].includes(file.type) || file.size > 5_000_000)) {
        setUploadError('Выберите PNG или WebP размером до 5 МБ.');
        return;
      }
      const save = (image?: string) => {
        onFolder(uploadFolder);
        onUpload({ id: uid(), name: uploadName.trim(), kind: uploadKind, folder: uploadFolder,
          symbol: uploadKind === 'Портреты' ? 'user' : 'chest', color: '#bdb2ce', image, source: file?.name });
        setShowUpload(false); setUploadName(''); setFile(undefined); setUploadError('');
      };
      if (!file) { save(); return; }
      const reader = new FileReader();
      reader.onload = () => { if (typeof reader.result === 'string') save(reader.result); };
      reader.onerror = () => setUploadError('Файл не удалось прочитать.');
      reader.readAsDataURL(file);
    }}>
      <p>Без файла используется демонстрационная пиктограмма.</p>
      <div className="form-grid">
        <label>Название ассета<input value={uploadName} onChange={e => setUploadName(e.target.value)} required maxLength={80}/></label>
        <label>Категория<select value={uploadKind} onChange={e => setUploadKind(e.target.value as Asset['kind'])}>{categories.slice(1).map(name => <option key={name}>{name}</option>)}</select></label>
        <label>Папка<select value={uploadFolder} onChange={e => setUploadFolder(e.target.value)}>{[...new Set(['Мои ассеты', ...folders.filter(name => name !== 'Стартовый набор')])].map(name => <option key={name}>{name}</option>)}</select></label>
        <label>Изображение PNG/WebP<input type="file" accept="image/png,image/webp" onChange={e => { const file = e.target.files?.[0]; setFile(file); setUploadError(''); if (file) setUploadName(file.name.replace(/\.[^.]+$/, '')); }}/></label>
      </div>
      {uploadError && <p role="alert">{uploadError}</p>}
      <button className="button primary" type="submit"><ImagePlus size={15}/>Добавить в библиотеку</button>
    </form>}
    <div className="segmented filter-tabs">{categories.map(category => <Button aria-pressed={kind === category} key={category} onClick={() => setKind(category)}>{category}</Button>)}</div>
    {kind === 'Декали' && <DecalPatterns onPlace={onDecal}/>}
    {active && <div className="asset-preview">
      <div className="asset-icon" style={{ color: active.color }}><Glyph name={active.symbol} size={30}/></div>
      <div><strong>{active.name}</strong><p>{active.kind} · {active.folder} · {active.source ?? (active.folder === 'Стартовый набор' ? 'Стартовая графика Laterna' : 'Демонстрационная пиктограмма')}</p></div>
      <Button className="primary" onClick={() => onPlace(active)}><Plus size={16}/>Разместить на сцене</Button>
      <label>Папка выбранного ассета<select value={active.folder} onChange={event => {
        onMove(active.id, event.target.value);
        if (folder) setFolder(event.target.value);
      }}>{folders.map(name => <option key={name}>{name}</option>)}</select></label>
      {active.kind === 'Портреты' && onPortrait && <Button onClick={() => onPortrait(active)}>Применить к выбранному токену</Button>}
      {active.folder !== 'Стартовый набор' && <Button className="danger-text" onClick={() => setRemove(true)}>Удалить ассет</Button>}
      {remove && <div className="confirm"><strong>Удалить ассет?</strong><Button onClick={() => setRemove(false)}>Отмена</Button><Button className="danger" onClick={() => { onRemove(active.id); setActive(undefined); setRemove(false); }}>Удалить</Button></div>}
    </div>}
    {filtered.length ? <div className="card-grid asset-grid">{filtered.map(asset => <button type="button" className="catalog-card asset-card" aria-pressed={asset.id === active?.id} key={asset.id} onClick={() => { setActive(asset.id); setRemove(false); }}>
      <div className="catalog-art" style={{ color: asset.color }}>{asset.image ? <img src={asset.image} alt=""/> : <div className="asset-art"><Glyph name={asset.symbol} size={43}/></div>}</div>
      <div className="catalog-content"><h4>{asset.name}</h4><p>{asset.kind} · {asset.folder}</p></div>
    </button>)}</div> : <Empty>Ассеты по этому запросу не найдены.</Empty>}
  </>;
}
