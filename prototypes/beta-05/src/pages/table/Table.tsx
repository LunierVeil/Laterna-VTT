import { TableGuide } from './TableGuide';
import { QuickActions } from '../../widgets/activity/QuickActions';
import type { CreatureStart } from '../../features/roster';
import { controlsActor, playerHeroId } from '../../entities/model';
import { useEffect, useState } from 'react';
import { BookOpen, Dice5, DoorOpen, EyeOff, Grid2X2, PencilRuler, Swords, Trash2, Undo2, Users, X } from 'lucide-react';
import type { Actor, Campaign, Combat, CombatParticipant, Entry, MapObject, Page, Placement, Point, Role, Scene, Tool, WallMode } from '../../entities/model';
import { canRead, objectKinds } from '../../entities/model';
import { Inspector, TokenSizeSelect } from '../../features/scene-editor';
import { Button, Dialog, Glyph, IconButton } from '../../shared/ui';
import { Activity, DiceOverlay, RollResults, type RollPool } from '../../widgets/activity/Activity';
import { PlayerParty } from '../../widgets/activity/Party';
import { Board } from '../../widgets/board/Board';
import { Screen } from '../../widgets/screen/Screen';
import { Workbench, type CampaignCommands } from '../../widgets/workbench/Workbench';
import { MapToolbar, mapTools, SceneRail, TableHeader } from './Chrome';

interface Props {
  campaign: Campaign; scene: Scene; role: Role; setRole: (role: Role) => void;
  entries: Entry[]; battle?: Combat; srd: Actor[]; canUndo: boolean;
  commands: CampaignCommands & {
    rollPool: RollPool; sendChat: (text: string) => void; startCombat: () => void; configureCombat: (participants: CombatParticipant[]) => void; nextTurn: () => void; endCombat: () => void;
    removeActor: (id: string) => void; changeObjects: (objects: MapObject[]) => void; undo: () => void;
  };
  onExit: () => void;
}
const tableKeys = [
  ['B','Кубики'], ['C','Лист персонажа'], ['J','Книга кампании'], ['K','Книга заклинаний'],
  ['M','Ширма мастера'], ['E','Редактировать карту'], ['A','Ассеты редактора'], ['G','Сетка'],
] as const;
const tips: Partial<Record<Tool, string>> = {
  wall: 'Укажите на карте начало и конец стены', door: 'Укажите два края дверного проёма',
  window: 'Укажите два края окна', light: 'Нажмите на карту, чтобы поставить источник света',
  fog: 'Отметьте два противоположных угла тумана', measure: 'Нажмите на карту и переместите указатель',
};

export function Table({ campaign, scene, role, setRole, entries, battle, srd, canUndo, commands, onExit }: Props) {
  const [guide,setGuide] = useState(false);
  const [lowOpacity,setLowOpacity] = useState(false);
  const [dockActions,setDockActions] = useState(false);
  const [quickActions, setQuickActions] = useState(false);
  const [hotkeys, setHotkeys] = useState(false);
  const [hotkeyQuery, setHotkeyQuery] = useState('');
  const [book, setBook] = useState(false);
  const [readMaterialIds, setReadMaterialIds] = useState<string[]>([]);
  const [tokenDetails, setTokenDetails] = useState<string>();
  const [quickCreate, setQuickCreate] = useState<CreatureStart>();
  const [page, setPage] = useState<Page>(null);
  const [edit, setEdit] = useState(false);
  const [combatRequest, setCombatRequest] = useState(0);
  const [closeCombatRequest, setCloseCombatRequest] = useState(0);
  const [activity, setActivity] = useState(true);
  const [screen, setScreen] = useState(false);
  const [screenSize, setScreenSize] = useState<Point>();
  const [screenPosition, setScreenPosition] = useState<Point>();
  const [dice, setDice] = useState(false);
  const [reduceMotion, setMotion] = useState(false);
  const [wallMode, setWallMode] = useState<WallMode>('line');
  const [tool, setTool] = useState<Tool>('select');
  const [group, setGroup] = useState<string[]>([]);
  const [deleteGroup, setDeleteGroup] = useState(false);
  useEffect(() => { setGroup([]); setDeleteGroup(false); }, [scene.id, role]);
  const [selected, setSelected] = useState<string | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [actorId, setActorId] = useState<string>();
  const [materialId, setMaterialId] = useState<string>();
  const [connection, setConnection] = useState(false);
  const [context, setContext] = useState<{ id: string; x: number; y: number }>();
  const [deleting, setDeleting] = useState(false);
  const gm = role === 'gm';
  const editing = gm && edit;
  const object = scene.objects.find(item => item.id === selected && (gm || !item.secret));
  const inspectedToken = scene.objects.find(item => item.id === tokenDetails && (gm || !item.secret));
  const contextual = scene.objects.find(item => item.id === context?.id && (gm || !item.secret));
  const contextActor = contextual?.kind === 'token' ? campaign.actors.find(actor => actor.id === contextual.actorId) : undefined;
  const hero = campaign.actors.find(actor => actor.id === playerHeroId(campaign)) ?? (gm ? campaign.actors.find(a => a.kind === 'hero') : undefined);
  const materials = campaign.materials.filter(m => canRead(m, 'player'));
  const featuredLetter = materials.find(m => m.shown) ?? materials.find(m => m.kind === 'letter');

  function changeRole(next: Role) {
    setQuickActions(false);
    if (role === next) return;
    setTokenDetails(undefined); setRole(next); setPage(null); setTool('select'); setSelected(null);
    setPlacement(null); setScreen(false); setDice(false); setContext(undefined); setDeleting(false);
  }
  function openPage(next: Page) {
    setBook(false); setQuickCreate(undefined); setPage(next); setActorId(undefined); setMaterialId(undefined); setConnection(false); setContext(undefined);
  }
  function openSheet(id?: string) { openPage('sheet'); setActorId(id); }
  function openMaterial(id?: string) { openPage('journal'); setMaterialId(id); }
  function activate(id: string) {
    setTokenDetails(undefined); commands.updateCampaign(c => ({ ...c, gmScene: id }));
    setSelected(null); setPlacement(null); setContext(undefined); setTool('select'); setPage(null);
  }
  function arm(item: Placement) {
    if (!gm && !controls(item.actorId)) return;
    setPlacement(item); setTool('select'); setPage(null); setSelected(null); setScreen(false);
    commands.notify(`Выберите место для «${item.name}»`);
  }
  function adjustHeroHp(actor: Actor, delta: number) {
    if (!gm && actor.id !== playerHeroId(campaign)) return;
    const hp = Math.max(0, Math.min(actor.maxHp, actor.hp + delta));
    commands.saveActor({ ...actor, hp, deathSaves: hp > 0 || actor.hp > 0 ? undefined : actor.deathSaves });
  }
  function adjustTokenHp(token: MapObject, actor: Actor, delta: number) {
    if (!gm) return;
    updateObject({ ...token, hp: Math.max(0, Math.min(actor.maxHp, (token.hp ?? actor.maxHp) + delta)) });
  }
  function chooseTool(value: Tool) {
    setTool(value); setGroup([]); setPlacement(null); setSelected(null); setContext(undefined);
  }
  const controls = (id?: string) => controlsActor(campaign.actors.find(actor => actor.id === id), playerHeroId(campaign));
  function useDoor(door: MapObject) {
    if (gm || door.secret || door.kind !== 'door' || !door.end) return;
    const end = door.end;
    const near = scene.objects.some(token => token.kind === 'token' && !token.secret && controls(token.actorId) &&
      Math.hypot(token.x - (door.x + end.x) / 2, token.y - (door.y + end.y) / 2) <= scene.grid * 1.5);
    if (!near) { commands.notify('Подойдите ближе к двери'); return; }
    if (door.locked) { commands.notify('Дверь заперта'); return; }
    updateObject({ ...door, open: !door.open });
    commands.notify(door.open ? 'Дверь закрыта' : 'Дверь открыта');
  }
  function updateObject(next: MapObject) { commands.changeObjects(scene.objects.map(item => item.id === next.id ? next : item)); }
  function deleteObject() {
    if (object) commands.changeObjects(scene.objects.filter(item => item.id !== object.id));
    setSelected(null); setContext(undefined); setDeleting(false);
    commands.notify('Объект удалён');
  }

  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key !== 'Escape' && event.target instanceof HTMLElement && (['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (guide) return;
      if (event.key === '/' && !hotkeys) { event.preventDefault(); setHotkeyQuery(''); setHotkeys(true); return; }
      if (hotkeys) { if (event.key === 'Escape') { event.preventDefault(); setHotkeys(false); } return; }
      if (page) {
        if (event.key === 'Escape' && ['sheet', 'roster', 'hero-create', 'journal', 'assets', 'spells'].includes(page)) setPage(null);
        return;
      }
      if (event.key === 'Escape' && quickActions) { setQuickActions(false); return; }
      if (event.key === 'Escape' && (context || deleting || deleteGroup)) {
        setContext(undefined); setDeleting(false); setDeleteGroup(false); return;
      }
      if (event.key === 'Escape') {
        setPlacement(null); setTool('select'); setContext(undefined); setDeleting(false); setGroup([]); return;
      }
      const key = (event.code.startsWith('Key') ? event.code.slice(3) : event.key).toUpperCase();
      const shortcuts: Partial<Record<string, () => void>> = {
        B: () => setDice(value => !value),
        C: () => hero ? openSheet(hero.id) : openPage('hero-create'),
        J: () => { openPage('journal'); setBook(true); },
        K: () => openPage('spells'),
        ...(gm ? { M: () => setScreen(value => !value),
          E: () => { setEdit(value => !value); chooseTool('select'); },
          G: () => commands.writeScene({ ...scene, showGrid: !scene.showGrid }),
          ...(editing ? { A: () => openPage('assets') } : {}) } : {}),
      };
      if (shortcuts[key]) { if (!event.repeat) shortcuts[key]?.(); return; }
      const match = mapTools.find(item => item.key === key);
      if (match && (editing || mapTools.indexOf(match) < 3)) {
        setTool(match.id); setGroup([]); setPlacement(null); setSelected(null); setContext(undefined);
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [page, editing, hotkeys, gm, scene, hero, commands, context, deleting, deleteGroup, quickActions, guide]);

  const brief = placement ? `Разместить: ${placement.name}` : tips[tool];
  const workbench = page && <Workbench key={`${page}/${actorId ?? ''}/${materialId ?? ''}/${quickCreate}/${book}`} expandedSidebar={activity} page={page} campaign={campaign} role={role} quickCreate={quickCreate} openBook={book} srd={srd} actorId={actorId} materialId={materialId} connection={connection} onExit={onExit} reduceMotion={reduceMotion} onMotion={setMotion}
      onPortrait={object?.kind === 'token' ? asset => {
        updateObject({ ...object, symbol: asset.symbol, color: asset.color, image: asset.image });
        setPage(null); commands.notify('Портрет токена обновлён');
      } : undefined}
      onClose={() => setPage(null)} onPlace={arm} onActivate={activate} onSheet={openSheet} onMaterial={openMaterial} commands={commands}/>;
  return <div className={`table-shell ${reduceMotion ? 'reduced-motion' : ''} ${lowOpacity ? 'translucent-screen' : ''} ${dockActions ? 'quick-actions-docked' : ''}`}>
    <TableHeader scene={scene} campaign={campaign} role={role} onRole={changeRole} onPage={openPage} onScreen={() => setScreen(value => !value)} screen={screen} onExit={onExit}
      onConnection={() => { openPage('settings'); setConnection(true); }}/>
    <main className={`table-main ${activity || page === 'assets' ? 'with-right' : 'with-collapsed-right'}`} onClick={() => { if (context) setContext(undefined); }}>
      <MapToolbar editing={editing} tool={tool} onTool={chooseTool} onAssets={() => openPage('assets')}/>
      <Board campaignId={campaign.id} heroName={hero?.name} heroId={playerHeroId(campaign)} actors={campaign.actors} activeActorId={battle?.order[battle.turn]} key={`${scene.id}/${playerHeroId(campaign)}`} scene={scene} role={role} editing={editing} tool={tool} wallMode={wallMode} selected={selected} placement={placement}
        group={group} onGroup={setGroup} onSelect={setSelected} onUseDoor={useDoor} onChange={commands.changeObjects} onPlaced={() => { commands.notify('Объект размещён на сцене'); setPlacement(null); }}
        toolbar={<div className="quickbar" onDoubleClick={() => {
          setDice(false); setPage(null); setScreen(false); setCloseCombatRequest(count => count + 1);
        }}>
          <Button aria-label="Быстрые действия" aria-pressed={quickActions} onClick={() => setQuickActions(value=>!value)}>Действия</Button>
          <Button title="Кубики (B)" aria-pressed={dice} onClick={() => setDice(value => !value)}><Dice5 size={17}/>Кубики</Button>
          <Button title="Лист персонажа (C)" onClick={() => hero ? openSheet(hero.id) : openPage('hero-create')}><Users size={17}/>{gm ? 'Лист героя' : 'Мой лист'}</Button>
          <Button onClick={() => openMaterial(!gm ? featuredLetter?.id : undefined)}><BookOpen size={17}/>{gm ? 'Материалы' : 'Раздатки'}</Button>
          {(gm || battle) && <Button onClick={event => {
            if (event.detail > 1) return;
            setActivity(true);
            if (!battle) commands.startCombat();
            setCombatRequest(count => count + 1);
          }}><Swords size={17}/>{battle ? `Раунд ${battle.round}` : 'Начать бой'}</Button>}
          {gm && <IconButton label="Переключить сетку" title="Сетка (G)" aria-pressed={scene.showGrid} onClick={event => { if (event.detail <= 1) commands.writeScene({ ...scene, showGrid: !scene.showGrid }); }}><Grid2X2 size={16}/></IconButton>}
        </div>}
        onOpenToken={item => {
          if (item.actorId && (gm || controls(item.actorId))) openSheet(item.actorId);
          else { openPage(null); setTokenDetails(item.id); }
        }}
        onContext={(item, x, y) => { setDeleting(false); setContext({ id: item.id, x, y }); }}>
        {quickActions && <QuickActions actors={campaign.actors.filter(actor=>gm || controls(actor.id))} onSave={commands.saveActor}
          onRoll={commands.roll} onSheet={id=>{setQuickActions(false);openSheet(id);}} onClose={()=>setQuickActions(false)}/>}
        <div className="board-controls">
          <Button onClick={()=>setGuide(true)}>Гид</Button>
          {gm && <>
            {editing && <IconButton label="Отменить действие" onClick={commands.undo} disabled={!canUndo}><Undo2 size={17}/></IconButton>}
            <Button className="edit-toggle" title="Редактировать карту (E)" aria-pressed={editing} onClick={() => { setEdit(value => !value); chooseTool('select'); }}>
              <PencilRuler size={16}/>{editing ? 'Вернуться к игре' : 'Редактировать карту'}
            </Button>
          </>}
        </div>
        {!editing && <Button className="board-campaign-book glass" title="Книга кампании (J)" onClick={() => {
          openPage('journal'); setBook(true); setReadMaterialIds(campaign.materials.filter(item => canRead(item, role)).map(item => item.id));
        }}><BookOpen size={20}/>Книга кампании
          {materials.some(item => item.shown && !readMaterialIds.includes(item.id)) && <i className="status-dot" aria-label="Новая запись"/>}
        </Button>}
        {tool === 'select' && group.length > 0 && <div className="selection glass group-selection" aria-label="Группа токенов">
          <strong>Выбрано: {group.length}</strong>
          {gm && <>
            <Button onClick={() => commands.changeObjects(scene.objects.map(item => group.includes(item.id) ? { ...item, secret: true } : item))}>Скрыть группу</Button>
            <Button onClick={() => commands.changeObjects(scene.objects.map(item => group.includes(item.id) ? { ...item, secret: false } : item))}>Показать группу</Button>
            <IconButton label="Удалить группу" onClick={() => setDeleteGroup(true)}><Trash2 size={16}/></IconButton>
          </>}
          <IconButton label="Снять выделение" onClick={() => setGroup([])}><X size={16}/></IconButton>
        </div>}
        {brief && <div className="placement-hint glass"><span>{brief}</span><IconButton label="Отменить инструмент" onClick={() => chooseTool('select')}><X size={15}/></IconButton></div>}
        {editing && !screen && <Inspector object={object} tool={tool} wallMode={wallMode} onWallMode={setWallMode} onTool={chooseTool} onUndo={commands.undo} canUndo={canUndo} onObject={updateObject} onDelete={() => setDeleting(true)}/>}
        {!editing && object && !screen && <div className="selection glass">
          <span className="tiny-avatar" style={{ color: object.color }}><Glyph name={object.symbol ?? 'map'} size={16}/></span>
          <div><strong>{object.name}</strong><small>{objectKinds[object.kind]}</small></div>
          {object.actorId && (gm || controls(object.actorId)) && <Button onClick={() => openSheet(object.actorId)}>Лист</Button>}
          {gm && object.kind === 'door' && <Button disabled={object.locked} onClick={() => updateObject({ ...object, open: !object.open })}>{object.open ? 'Закрыть' : 'Открыть'}</Button>}
          <IconButton label="Снять выделение" onClick={() => setSelected(null)}><X size={16}/></IconButton>
        </div>}
        {screen && gm && <Screen size={screenSize} onSize={setScreenSize} position={screenPosition} onPosition={setScreenPosition} scenes={campaign.scenes} activeScene={scene.id} actors={campaign.actors} materials={campaign.materials} battle={battle}
          onClose={() => setScreen(false)} onScene={activate} onSheet={openSheet} onRoster={() => openPage('roster')} onMaterial={openMaterial} onNewMaterial={() => openMaterial()}
          onRoll={commands.roll} onBattle={() => { setActivity(true); if (battle) commands.nextTurn(); else commands.startCombat(); }}/>}
        {!gm && !page && <PlayerParty actors={campaign.actors} heroId={playerHeroId(campaign)} showAllyNumbers={Boolean(campaign.demoSettings?.showAllyHp)}
          onSheet={openSheet} onHp={adjustHeroHp}/>}
      </Board>
      <Activity combatRequest={combatRequest} closeCombatRequest={closeCombatRequest} sceneId={scene.id} sceneName={scene.name} role={role} entries={entries} battle={battle} actors={campaign.actors}
        expanded={activity} onToggle={() => setActivity(value => !value)} onSheet={openSheet} onAddHero={() => openPage('hero-create')} onBooks={() => openPage('roster')} heroId={playerHeroId(campaign)}
        onHeroHp={adjustHeroHp} onTokenHp={adjustTokenHp} sceneTokens={scene.objects.filter(item => item.kind === 'token')}
        onQuickCreate={kind => { openPage('roster'); setQuickCreate(kind); }}
        onPlaceActor={actor => arm({ name: actor.name, actorId: actor.id, kind: 'token', symbol: actor.symbol, color: actor.color, image: actor.characterIdentity?.portrait })}
        onRemoveActor={actor => { if (actorId === actor.id) setPage(null); commands.removeActor(actor.id); }}
        scenes={<SceneRail campaign={campaign} scene={scene} onActivate={activate} onPublish={id => commands.updateCampaign(current => ({
          ...current, gmScene: current.gmScene ?? current.activeScene, activeScene: id,
        }))} onPage={openPage} onScene={commands.writeScene}/>}
        hiddenActorIds={scene.objects.filter(item => item.secret && item.actorId && !scene.objects.some(other => other.actorId === item.actorId && !other.secret)).map(item => item.actorId!)}
        sceneActorIds={scene.objects.flatMap(item => item.actorId ? [item.actorId] : [])}
        onConfigure={commands.configureCombat} onSend={commands.sendChat} onStart={commands.startCombat} onNext={commands.nextTurn} onEnd={commands.endCombat}/>
      {page === 'assets' && workbench}
    </main>
    {dice && <DiceOverlay role={role} onRoll={commands.roll} onPool={commands.rollPool} onClose={() => setDice(false)}/>}
    {hotkeys && <Dialog title="Горячие клавиши" onClose={() => setHotkeys(false)}>
      <label>Поиск по клавишам<input autoFocus type="search" value={hotkeyQuery} onChange={event => setHotkeyQuery(event.target.value)}/></label>
      {[
        { title: 'Стол', rows: [['/', 'Открыть справочник'], ['Esc', 'Закрыть окно или отменить инструмент'], ...mapTools.slice(0, 3).map(item => [item.key, item.name])] },
        { title: 'Панели', rows: tableKeys.filter(([key]) => gm || !['M','E','A','G'].includes(key)) },
        ...(gm ? [{ title: 'Редактор карты', rows: mapTools.slice(3).map(item => [item.key, item.name]) }] : []),
      ].map(group => {
        const rows = group.rows.filter(row => row.join(' ').toLocaleLowerCase().includes(hotkeyQuery.trim().toLocaleLowerCase()));
        return rows.length > 0 && <section className="character-block" key={group.title}><h3>{group.title}</h3>
          {rows.map(([key, label]) => <div className="attack-row" key={key}><span>{label}</span><kbd>{key}</kbd></div>)}
        </section>;
      })}
    </Dialog>}
    {guide && <TableGuide onClose={()=>setGuide(false)} lowOpacity={lowOpacity} onOpacity={setLowOpacity} dock={dockActions} onDock={setDockActions}/>}
    <RollResults entries={entries} role={role} expanded={activity}/>
    {context && contextual && <div className="context-menu glass" style={{ left: Math.min(context.x, window.innerWidth - 235), top: Math.min(context.y, window.innerHeight - 170) }} onClick={e => e.stopPropagation()}>
      <strong>{contextual.name}</strong>
      {contextual.actorId && (gm || controls(contextual.actorId)) && <Button className="ghost" onClick={() => openSheet(contextual.actorId)}><Users size={15}/>Открыть лист</Button>}
      {contextActor && (gm || controls(contextActor.id)) && <div className="inline-form" aria-label="Хиты токена">
        <IconButton label="Уменьшить хиты" onClick={() => contextActor.kind === 'hero' ? adjustHeroHp(contextActor, -1) : adjustTokenHp(contextual, contextActor, -1)} disabled={!gm && contextActor.kind !== 'hero'}>−</IconButton>
        <output>{contextActor.kind === 'hero' ? contextActor.hp : contextual.hp ?? contextActor.maxHp} / {contextActor.maxHp} HP</output>
        <IconButton label="Увеличить хиты" onClick={() => contextActor.kind === 'hero' ? adjustHeroHp(contextActor, 1) : adjustTokenHp(contextual, contextActor, 1)} disabled={!gm && contextActor.kind !== 'hero'}>+</IconButton>
      </div>}
      {gm && contextual.kind === 'token' && <TokenSizeSelect object={contextual} onObject={updateObject}/>}
      {gm && contextual.kind === 'door' && <Button disabled={contextual.locked} className="ghost" onClick={() => { updateObject({ ...contextual, open: !contextual.open }); setContext(undefined); }}><DoorOpen size={15}/>{contextual.open ? 'Закрыть дверь' : 'Открыть дверь'}</Button>}
      {gm && contextual.kind === 'door' && <Button onClick={() => {
        updateObject({ ...contextual, locked: !contextual.locked, open: false }); setContext(undefined);
      }}>{contextual.locked ? 'Отпереть дверь' : 'Запереть дверь'}</Button>}
      {gm && contextual.kind === 'door' && <Button onClick={() => {
        updateObject({ ...contextual, secret: !contextual.secret }); setContext(undefined);
      }}>{contextual.secret ? 'Показать игрокам' : 'Скрыть от игроков'}</Button>}
      {gm && (contextual.kind === 'token' || contextual.kind === 'prop') && <Button className="ghost" onClick={() => { updateObject({ ...contextual, secret: !contextual.secret }); setContext(undefined); }}><EyeOff size={15}/>{contextual.secret ? 'Показать игрокам' : 'Скрыть от игроков'}</Button>}
      {gm && <Button className="ghost danger-text" onClick={() => { setDeleting(true); setContext(undefined); }}><Trash2 size={15}/>Удалить объект</Button>}
      {!gm && contextual.actorId !== hero?.id && <span className="micro">{objectKinds[contextual.kind]}</span>}
    </div>}
    {gm && deleteGroup && <Dialog title="Удалить выбранные токены?" onClose={() => setDeleteGroup(false)}>
      <Button onClick={() => setDeleteGroup(false)}>Отмена</Button>
      <Button className="danger" onClick={() => {
        commands.changeObjects(scene.objects.filter(item => !group.includes(item.id)));
        setGroup([]); setDeleteGroup(false);
      }}>Удалить токены</Button>
    </Dialog>}
    {deleting && object && gm && <div className="delete-popover glass confirm" role="alertdialog" aria-label="Подтверждение удаления"><strong>Удалить «{object.name}»?</strong><Button onClick={() => setDeleting(false)}>Отмена</Button><Button className="danger" onClick={deleteObject}>Удалить</Button></div>}
    {inspectedToken && <Dialog title={inspectedToken.name} onClose={() => setTokenDetails(undefined)}>
      {gm ? <TokenSizeSelect object={inspectedToken} onObject={updateObject}/> : <p>Токен на сцене</p>}
    </Dialog>}
    {page !== 'assets' && workbench}
  </div>;
}
