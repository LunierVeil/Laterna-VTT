import { SceneProperties } from '../../features/scene-editor';
import { useState } from 'react';
import { BookOpen, Boxes, ChevronRight, ScanEye, Sun, Hand, Map, MousePointer2, PanelTop, Plus, BrickWall, Ruler, Settings, Upload, Users, CloudFog, BookOpenCheck } from 'lucide-react';
import type { Campaign, Page, Role, Scene, Tool } from '../../entities/model';
import { MapThumbnail } from '../../shared/map-art';
import { Button, IconButton, Lantern } from '../../shared/ui';

export const mapTools = [
  { id: 'select', name: 'Выбор', icon: MousePointer2, key: 'V' },
  { id: 'pan', name: 'Рука', icon: Hand, key: 'H' },
  { id: 'measure', name: 'Линейка', icon: Ruler, key: 'R' },
  { id: 'wall', name: 'Добавить стену', key: 'W' },
  { id: 'door', name: 'Добавить дверь', key: 'D' },
  { id: 'window', name: 'Добавить окно', key: 'O' },
  { id: 'light', name: 'Добавить источник света', icon: Sun, key: 'L' },
  { id: 'fog', name: 'Нарисовать туман', icon: CloudFog, key: 'F' },
] as const;
const navigation = [
  ['journal', 'Журнал', BookOpen],
  ['spells', 'Книга заклинаний', BookOpenCheck],
] as const;
export function TableHeader({ scene, campaign, role, onRole, onPage, onScreen, onExit, onConnection, screen }: {
  scene: Scene; campaign: Campaign; role: Role; onRole: (role: Role) => void; onPage: (page: Page) => void; onScreen: () => void;
  onExit: () => void; onConnection: () => void; screen: boolean;
}) {
  return <header className="table-header">
    <Button className="table-brand ghost" onClick={onExit} title="Выбрать кампанию"><Lantern size={22}/>Laterna</Button>
    <div className="header-divider"/>
    <span className="header-scene">{scene.name}</span>
    <nav className="main-nav" aria-label="Разделы стола">
      <Button className="nav-current" aria-current="page" onClick={() => onPage(null)}><Map size={17}/>Стол</Button>
      {navigation.map(([id,label,Icon]) => <Button key={id} title={id === 'spells' ? 'Книга заклинаний (K)' : undefined} onClick={() => onPage(id)}><Icon size={16}/>{label}</Button>)}
      {role === 'player' && <Button title="Лист персонажа (C)" onClick={() => onPage('sheet')}><Users size={16}/>Персонаж</Button>}
      {role === 'gm' && <Button data-guide="screen" title="Ширма мастера (M)" aria-pressed={screen} onClick={onScreen}><PanelTop size={16}/>Ширма</Button>}
    </nav>
    <div className="header-end">
      {role === 'gm' && <Button className="connection ghost" onClick={onConnection}><span className="status-dot"/> {campaign.demoSettings?.connected ? campaign.demoSettings.connection + ' · демо' : 'Локально'}</Button>}
      <div className="segmented role-switch" aria-label="Режим просмотра">
        <Button aria-pressed={role === 'gm'} onClick={() => onRole('gm')}>GM View</Button>
        <Button aria-pressed={role === 'player'} onClick={() => onRole('player')}><ScanEye size={14}/>Player View</Button>
      </div>
      {role === 'gm' && <IconButton label="Настройки" onClick={() => onPage('settings')}><Settings size={18}/></IconButton>}
    </div>
  </header>;
}
export function SceneRail({ campaign, scene, onActivate, onPublish, onPage, onScene }: { campaign: Campaign; scene: Scene; onActivate: (id: string) => void; onPublish: (id: string) => void; onScene: (scene: Scene) => void; onPage: (page: Page) => void; }) {
  const [previewId, setPreviewId] = useState<string>();
  const preview = campaign.scenes.find(item => item.id === previewId) ?? scene;
  const live = preview.id === campaign.activeScene;
  const partyScene = campaign.scenes.find(item => item.id === campaign.activeScene);
  return <section className="scene-rail" aria-label="Панель сцен">
    <div className="scene-rail-inner">
      <div className="rail-label">Игроки видят: {partyScene?.name}
      </div><div className="rail-label">Мастер: {scene.name}</div>
      <div className="rail-cover">{preview.background ? <img className="scene-thumbnail" src={preview.background.image} alt=""/> : <MapThumbnail art={preview.art}/>}
        <span className={`badge ${live ? 'live' : ''}`}>{live ? 'В игре' : 'Предпросмотр'}</span></div>
      <div className="rail-scene-title"><strong>{preview.name}</strong><small>{preview.folder}</small></div>
      <Button className="primary full" disabled={live} onClick={() => onPublish(preview.id)}>Показать игрокам</Button>
      <Button className="full" disabled={preview.id === scene.id} onClick={() => onActivate(preview.id)}>Перейти на сцену</Button>
      <SceneProperties key={preview.id} scene={preview} onScene={onScene}/>
      <div className="rail-label library-label">БИБЛИОТЕКА СЦЕН</div>
      {['Без папки', ...campaign.sceneFolders].map(folder => {
        const scenes = campaign.scenes.filter(item => item.folder === folder);
        return scenes.length > 0 && <details key={folder} open><summary><ChevronRight size={14}/>{folder}</summary>{scenes.map(item => <Button className="scene-row" aria-pressed={preview.id === item.id} key={item.id} onClick={() => setPreviewId(item.id)}><Map size={15}/><span>{item.name}</span>{campaign.activeScene === item.id && <small className="badge live">Партия</small>}{scene.id === item.id && <small className="badge">ГМ</small>}</Button>)}</details>;
      })}
      <Button className="full rail-add" onClick={() => onPage('scenes')}><Plus size={15}/>Управление сценами</Button>
      <Button className="full ghost" onClick={() => onPage('import')}><Upload size={15}/>Импорт UVTT</Button>
    </div>
  </section>;
}
export function MapToolbar({ editing, tool, onTool, onAssets }: { editing: boolean; tool: Tool; onTool: (tool: Tool) => void; onAssets: () => void }) {
  const geometry = tool === 'wall' || tool === 'door' || tool === 'window';
  return <nav data-guide="tools" className="map-toolbar" aria-label="Инструменты карты">
    {mapTools.map(item => {
      if (!('icon' in item)) {
        if (!editing || item.id !== 'wall') return null;
        return <div key="geometry" className="tool-break">
          <IconButton label="Геометрия" aria-pressed={geometry} onClick={() => onTool(geometry ? 'select' : 'wall')}>
            <BrickWall size={20} strokeWidth={1.65}/>
          </IconButton>
        </div>;
      }
      if (!editing && (item.id === 'light' || item.id === 'fog')) return null;
      const { id, name, icon: Icon, key } = item;
      return <div key={id}><IconButton label={name} title={`${name} (${key})`} aria-pressed={id === tool} onClick={() => onTool(id)}><Icon size={20} strokeWidth={1.65}/></IconButton></div>;
    })}
    {editing && <div className="tool-break"><IconButton label="Ассеты" title="Ассеты (A)" onClick={onAssets}><Boxes size={20}/></IconButton></div>}
  </nav>;
}
