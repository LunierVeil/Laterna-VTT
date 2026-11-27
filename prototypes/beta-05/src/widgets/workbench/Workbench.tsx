import { GlobalSpellbook } from '../../features/roster/GlobalSpellbook';
import { FloatingWindow } from '../../shared/ui/FloatingWindow';
import { X } from 'lucide-react';
import { canRead, controlsActor, playerHeroId } from '../../entities/model';
import { HeroCreation } from '../../features/roster/HeroCreation';
import type { Actor, Asset, Campaign, Material, Page, Placement, Role, Scene } from '../../entities/model';
import { AssetLibrary } from '../../features/assets';
import { CampaignSettings } from '../../features/campaign-tools';
import { Materials } from '../../features/materials';
import { Roster, Sheet, type CreatureStart, type Roll } from '../../features/roster';
import { SceneLibrary, UVTT } from '../../features/scene-editor';
import { Dialog, IconButton } from '../../shared/ui';

export interface CampaignCommands {
  updateCampaign: (update: (campaign: Campaign) => Campaign) => void;
  writeScene: (scene: Scene, activate?: boolean) => void;
  removeScene: (id: string) => void;
  saveMaterial: (material: Material) => void;
  showMaterial: (material: Material) => void;
  saveActor: (actor: Actor) => void;
  notify: (text: string) => void;
  roll: Roll;
}
const titles = { scenes: 'Библиотека сцен', assets: 'Библиотека ассетов', spells: 'Книга заклинаний', roster: 'NPC и чудовища', 'hero-create': 'Добавить героя', sheet: 'Лист персонажа', journal: 'Материалы кампании', settings: 'Настройки стола', import: 'Импорт Universal VTT' };

function getLayout(key: string): Actor['sheetLayout'] {
  try {
    const value = localStorage.getItem(key);
    if (value === 'full' || value === 'compact' || value === 'classic') return value;
  } catch { /* optional browser preference */ }
}
function setLayout(key: string, value: NonNullable<Actor['sheetLayout']>) {
  try { localStorage.setItem(key, value); } catch { /* actor still stores the active layout */ }
}

export function Workbench({ page, expandedSidebar, campaign, role, srd, actorId, materialId, quickCreate, openBook, connection, onPortrait, reduceMotion, onMotion, onClose, onExit, onPlace, onActivate, onSheet, onMaterial, commands }: {
  page: NonNullable<Page>; expandedSidebar: boolean; campaign: Campaign; role: Role; srd: Actor[];
  actorId?: string; materialId?: string; quickCreate?: CreatureStart; openBook: boolean; connection: boolean; onPortrait?: (asset: Asset) => void;
  reduceMotion: boolean; onMotion: (value: boolean) => void; onClose: () => void; onExit: () => void;
  onPlace: (item: Placement) => void; onActivate: (id: string) => void; onSheet: (id: string) => void; onMaterial: (id: string) => void; commands: CampaignCommands;
}) {
  const gm = role === 'gm';
  if (!gm && page !== 'sheet' && page !== 'journal' && page !== 'hero-create' && page !== 'spells' && !(page === 'roster' && quickCreate?.startsWith('companion'))) return null;
  const selectedActor = gm ? campaign.actors.find(item => item.id === actorId) ?? campaign.actors.find(a => a.kind === 'hero') : campaign.actors.find(item => item.id === (actorId ?? playerHeroId(campaign)) && controlsActor(item, playerHeroId(campaign)));
  const layoutKey = (id: string) => `laterna-beta05:sheet:${campaign.id}:${id}`;
  const remembered = selectedActor ? getLayout(layoutKey(selectedActor.id)) : undefined;
  const actor = selectedActor && remembered ? { ...selectedActor, sheetLayout: remembered } : selectedActor;
  const compact = actor?.sheetLayout === 'compact';
  function changeLayout(value: NonNullable<Actor['sheetLayout']>) {
    if (!actor) return;
    setLayout(layoutKey(actor.id), value);
    commands.saveActor({ ...actor, sheetLayout: value });
  }
  function addFolder(key: 'sceneFolders' | 'materialFolders' | 'assetFolders', name: string) {
    if (name.toLowerCase() === 'без папки' || campaign[key].some(folder => folder.toLowerCase() === name.toLowerCase())) return;
    commands.updateCampaign(current => current[key].includes(name) ? current : { ...current, [key]: [...current[key], name] });
  }
  function placeAsset(asset: Asset) {
    onPlace({ name: asset.name, kind: asset.kind === 'Портреты' ? 'token' : 'prop', symbol: asset.symbol, color: asset.color, image: asset.image });
  }

  const docked = page === 'sheet' || page === 'roster' || page === 'journal' || page === 'hero-create' || page === 'spells';
  const title = page === 'sheet' && actor ? actor.name : titles[page];
  const content = <>
    {page === 'scenes' && <SceneLibrary campaign={campaign} onActivate={onActivate} onSave={(next, active) => { commands.writeScene(next, active); commands.notify('Сцена сохранена'); }} onDelete={commands.removeScene} onFolder={name => addFolder('sceneFolders', name)}/>}
    {page === 'assets' && <AssetLibrary assets={campaign.assets} folders={campaign.assetFolders}
      onUpload={asset => { commands.updateCampaign(current => ({ ...current, assets: [...current.assets, asset] })); commands.notify('Ассет добавлен'); }}
      onFolder={name => addFolder('assetFolders', name)}
      onDecal={(name, decal) => onPlace({ kind: 'prop', name, decal, symbol: 'map', color: '#ac8c67' })} onPlace={placeAsset} onPortrait={onPortrait}
      onMove={(id, folder) => commands.updateCampaign(current => ({
        ...current, assets: current.assets.map(asset => asset.id === id ? { ...asset, folder } : asset),
      }))}
      onRemove={id => { commands.updateCampaign(current => ({ ...current, assets: current.assets.filter(asset => asset.id !== id) })); commands.notify('Ассет удалён'); }}/>}
    {page === 'roster' && <Roster controller={gm ? undefined : playerHeroId(campaign)} onClose={onClose} quickCreate={quickCreate} actors={campaign.actors} srd={srd} onSheet={onSheet}
      onSave={a => { commands.saveActor(a); commands.notify('Карточка существа сохранена'); if (!gm) onSheet(a.id); }}
      onPlace={a => onPlace({ actorId: a.id, name: a.name, kind: 'token', symbol: a.symbol, color: a.color })}/>}
    {page === 'hero-create' && <HeroCreation onSave={hero => {
      commands.updateCampaign(current => ({
        ...current, actors: [...current.actors, hero],
        playerHeroId: gm ? current.playerHeroId : hero.id,
      }));
      onSheet(hero.id);
    }}/>}
    {page === 'spells' && <GlobalSpellbook actors={gm ? campaign.actors : campaign.actors.filter(a => controlsActor(a, playerHeroId(campaign)))}
      targets={campaign.actors.filter(a => gm || controlsActor(a, playerHeroId(campaign)))} onSave={commands.saveActor} onClose={onClose}/>}
    {page === 'sheet' && <Sheet materials={campaign.materials.filter(material => canRead(material, role))} onMaterial={onMaterial} actor={actor} role={role} onChange={commands.saveActor} onRoll={commands.roll} compact={compact} onClassic={() => changeLayout('classic')} onCompact={value => changeLayout(value ? 'compact' : 'full')}/>}
    {page === 'journal' && <Materials materials={campaign.materials} folders={campaign.materialFolders} role={role} initialId={materialId} openBook={openBook}
      onSave={material => { commands.saveMaterial(material); commands.notify('Материал сохранён'); }}
      onShow={commands.showMaterial} onDelete={id => { commands.updateCampaign(current => ({ ...current, materials: current.materials.filter(material => material.id !== id) })); commands.notify('Материал удалён'); }}
      onFolder={name => addFolder('materialFolders', name)}/>}
    {page === 'settings' && <CampaignSettings campaign={campaign} initial={connection ? 'Подключение' : 'Кампания'} onNotify={commands.notify}
      onSettings={demoSettings => commands.updateCampaign(current => ({ ...current, demoSettings }))}
      onSave={(name, subtitle) => { commands.updateCampaign(current => ({ ...current, name, subtitle })); commands.notify('Настройки сохранены'); }} onExit={onExit} reduceMotion={reduceMotion} onMotion={onMotion}/>}
    {page === 'import' && <UVTT onImport={next => { commands.writeScene(next); commands.notify('Демонстрационная сцена импортирована'); }}/>}
  </>;
  if (page === 'assets') return <aside className="assets-workspace" aria-label={title}>
    <header><h2>{title}</h2><IconButton label="Закрыть окно" onClick={onClose}><X size={17}/></IconButton></header>
    <div className="assets-workspace-body">{content}</div>
  </aside>;
  if (page === 'sheet') return <FloatingWindow id="character-sheet" label={titles.sheet} title={actor ? `${actor.name} (лист персонажа)` : titles.sheet} onClose={onClose}
    className={`docked-workbench docked-sheet ${expandedSidebar ? '' : 'docked-sidebar-collapsed'} ${compact ? 'docked-sheet-compact' : ''} ${actor?.sheetLayout === 'classic' ? 'docked-sheet-classic' : ''}`}>
    <div className="dialog-body">{content}</div>
  </FloatingWindow>;
  return docked ? <section className={`docked-workbench docked-${page} ${expandedSidebar ? '' : 'docked-sidebar-collapsed'}`} aria-label={titles[page]}>
    {page !== 'spells' && <header className="dialog-head"><div><h2>{title}</h2>{page === 'journal' && <span className="prototype-status">PROPOSED</span>}</div><IconButton label="Закрыть окно" onClick={onClose}><X size={18}/></IconButton></header>}
    <div className="dialog-body">{content}</div>
  </section> : <Dialog key={page} title={title} eyebrow={campaign.name} onClose={onClose} wide={page !== 'settings'}>{content}</Dialog>;
}
