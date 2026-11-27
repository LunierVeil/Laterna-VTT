import { DiceVisual } from './DiceVisual';
import { controlsActor } from '../../entities/model';
import { AnchoredPopover } from '../../shared/ui/AnchoredPopover';
import { FloatingWindow } from '../../shared/ui/FloatingWindow';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Dice5, EyeOff, Flag, History, HeartPulse, Layers, MessageCircle, ChevronLeft, Users, Send, Skull, Swords, Trash2, Plus, MapPin, X } from 'lucide-react';
import type { Actor, Combat, CombatParticipant, Entry, MapObject, Role } from '../../entities/model';
import { PartyHealth, PartyOverview } from './Party';
import type { CreatureKind, CreatureStart, Roll } from '../../features/roster';
import { Button, Empty, Glyph, IconButton } from '../../shared/ui';

export function Activity({ entries, role, battle, actors, hiddenActorIds, onSend, expanded, onToggle, scenes, heroId, onSheet, onAddHero, onBooks, onStart, onNext, onEnd, sceneId, sceneName, sceneActorIds, onConfigure, onQuickCreate, onPlaceActor, onRemoveActor, onHeroHp, onTokenHp, sceneTokens, combatRequest, closeCombatRequest }: {
  entries: Entry[]; role: Role; battle?: Combat; actors: Actor[]; hiddenActorIds: string[]; sceneId: string; sceneName: string; sceneActorIds: string[];
  combatRequest: number; closeCombatRequest: number;
  sceneTokens: MapObject[]; onHeroHp: (actor: Actor, delta: number) => void;
  onTokenHp: (token: MapObject, actor: Actor, delta: number) => void;
  onQuickCreate: (kind: CreatureStart) => void; onPlaceActor: (actor: Actor) => void; onRemoveActor: (actor: Actor) => void;
  onConfigure: (participants: CombatParticipant[]) => void;
  onSend: (text: string) => void; expanded: boolean; onToggle: () => void; scenes: ReactNode; heroId?: string; onAddHero: () => void; onBooks: () => void; onSheet: (id: string) => void; onStart: () => void; onNext: () => void; onEnd: () => void;
}) {
  const [tab, setTab] = useState<'chat' | 'actors' | 'party' | 'scenes' | 'events' | 'combat'>('chat');
  const [confirmRemove, setConfirmRemove] = useState<Actor>();
  const [creatureKind, setCreatureKind] = useState<CreatureKind>();
  const [actorGroup, setActorGroup] = useState<'hero' | 'npc'>('hero');
  const [configuring, setConfiguring] = useState(false);
  const [message, setMessage] = useState('');
  const [ending, setEnding] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const shown = entries.filter(entry => tab === 'events' ? entry.kind !== 'chat' : entry.kind !== 'event');
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [entries.length, tab, expanded]);
  useEffect(() => { if (battle) setTab('combat'); }, [Boolean(battle)]);
  useEffect(() => { if (combatRequest) setTab('combat'); }, [combatRequest]);
  useEffect(() => { if (closeCombatRequest) setTab(current => current === 'combat' ? 'chat' : current); }, [closeCombatRequest]);
  useEffect(() => {
    if (role === 'player') {
      setTab(current => (current === 'scenes' || current === 'party') ? 'chat' : current);
      setConfiguring(false);
      setEnding(false);
      setConfirmRemove(undefined);
    }
  }, [role]);

  return <aside className={`activity panel ${expanded ? '' : 'activity-collapsed'}`} aria-label="Правая панель стола">
    <IconButton className="sidebar-toggle" label={expanded ? 'Свернуть правую панель' : 'Развернуть правую панель'} aria-expanded={expanded} onClick={onToggle}>
      {expanded ? <ChevronRight size={17}/> : <ChevronLeft size={17}/>}
    </IconButton>
    <nav className="side-tabs" aria-label="Разделы правой панели">
      <Button aria-pressed={tab === 'chat'} onClick={() => { setTab('chat'); if (!expanded) onToggle(); }}><MessageCircle size={16}/>Чат</Button>
      <Button aria-pressed={tab === 'actors'} onClick={() => { setTab('actors'); if (!expanded) onToggle(); }}><Users size={16}/>Персонажи</Button>
      {role === 'gm' && <Button aria-pressed={tab === 'party'} onClick={() => { setTab('party'); if (!expanded) onToggle(); }}><HeartPulse size={16}/>Партия</Button>}
      {!expanded && battle && <Button aria-pressed={tab === 'combat'} onClick={() => { setTab('combat'); onToggle(); }}><Swords size={16}/>Раунд {battle.round}</Button>}
      {role === 'gm' && <Button aria-pressed={tab === 'scenes'} onClick={() => { setTab('scenes'); if (!expanded) onToggle(); }}><Layers size={16}/>Сцены</Button>}
    </nav>
    {expanded && (tab === 'scenes' && role === 'gm' ? scenes : tab === 'party' && role === 'gm' ?
      <PartyOverview actors={actors} tokens={sceneTokens} sceneName={sceneName} onSheet={onSheet} onHeroHp={onHeroHp} onTokenHp={onTokenHp}/>
      : tab === 'actors' ? <div className="activity-content actor-sidebar">
      {role === 'gm' && <div className="segmented actor-group" aria-label="Состав персонажей">
        <Button aria-pressed={actorGroup === 'hero'} onClick={() => setActorGroup('hero')}><Users size={16}/>Герои</Button>
        <Button aria-pressed={actorGroup === 'npc'} onClick={() => setActorGroup('npc')}><Skull size={16}/>NPC / монстры</Button>
      </div>}
      {actors.filter(actor => role === 'gm' ? (actor.kind === 'hero') === (actorGroup === 'hero') : Boolean(heroId && controlsActor(actor, heroId))).map(actor =>
        <div className="sidebar-actor-card" key={actor.id}><div className="sidebar-actor-row">
          <Button className="scene-row" onClick={() => { setTab('chat'); onSheet(actor.id); }}>
            <Glyph name={actor.symbol} size={16}/>{actor.name}
          </Button>
          <IconButton label={`На сцену: ${actor.name}`} disabled={sceneActorIds.includes(actor.id)} onClick={() => onPlaceActor(actor)}><MapPin size={16}/></IconButton>
          <IconButton label={`Удалить: ${actor.name}`} onClick={() => setConfirmRemove(actor)}><Trash2 size={16}/></IconButton>
          </div>
          {role === 'gm' && actor.kind === 'hero' && <>
            <small>КД {actor.ac}{actor.sheetProfile && ` · ${actor.sheetProfile.speed} фт.`}</small>
            <PartyHealth actor={actor} numbers onChange={delta => onHeroHp(actor, delta)}/>
            {!!actor.conditions?.length && <small className="party-conditions">{actor.conditions.join(' · ')}</small>}
          </>}
        </div>)}
      {confirmRemove && <div className="confirm" role="alertdialog" aria-label="Удалить персонажа">
        <strong>Удалить «{confirmRemove.name}» из кампании и убрать его токены со сцен?</strong>
        <Button onClick={() => setConfirmRemove(undefined)}>Отмена</Button>
        <Button className="danger" onClick={() => { onRemoveActor(confirmRemove); setConfirmRemove(undefined); }}>Удалить</Button>
      </div>}
      {(role === 'player' || actorGroup === 'hero') && <Button className="primary" onClick={onAddHero}><Plus size={15}/>Добавить героя</Button>}
      {(role === 'player' || actorGroup === 'npc') && <div className="sidebar-actor-actions">
        <AnchoredPopover label="Добавить существо" onOpen={() => setCreatureKind(role === 'player' ? 'companion' : undefined)}
          trigger={<><Plus size={15}/>{role === 'player' ? 'Добавить питомца' : 'Добавить NPC / монстра'}</>}>{close =>
          creatureKind ? <>
            {role === 'gm' && <Button onClick={() => setCreatureKind(undefined)}>Назад к типам</Button>}
            <Button onClick={() => { close(); onQuickCreate(creatureKind); }}>Создать с нуля</Button>
            <Button onClick={() => { close(); onQuickCreate(`${creatureKind}-srd`); }}>Из бестиария</Button>
          </> : ([['npc', 'NPC'], ['monster', 'Чудовище'], ['companion', 'Питомец или фамильяр']] as const)
            .map(([kind, label]) => <Button key={kind} onClick={() => setCreatureKind(kind)}>{label}</Button>)
        }</AnchoredPopover>
        {role === 'gm' && <Button onClick={onBooks}>Книги NPC и чудовищ</Button>}
      </div>}
    </div> : tab === 'combat'  ? <div className="activity-content combat-panel">
      {configuring && role === 'gm' ? <InitiativeEditor key={sceneId} actors={actors} sceneActorIds={sceneActorIds} battle={battle}
        onCancel={() => setConfiguring(false)} onSave={next => { onConfigure(next); setConfiguring(false); }}/>
      : battle ? <>
        <div className="combat-heading"><div className="eyebrow"><Swords size={14}/> ИНИЦИАТИВА</div><strong>Раунд {battle.round}</strong></div>
        {battle.order.map((id, i) => {
          const actor = actors.find(a => a.id === id);
          if (!actor || role === 'player' && hiddenActorIds.includes(id)) return null;
          return <div className={`combat-row ${i === battle.turn ? 'current-turn' : ''}`} key={id}><span className="mono">{battle.initiative[id] ?? actor.init}</span><span className="tiny-avatar" style={{ color: actor.color }}><Glyph name={actor.symbol} size={16}/></span><strong>{actor.name}</strong>{i === battle.turn && <ChevronRight size={16}/>}</div>;
        })}
        {role === 'gm' && sceneTokens.some(token => battle.order.includes(token.actorId ?? '') && actors.some(actor => actor.id === token.actorId && actor.kind !== 'hero')) &&
          <section className="combat-token-hp"><h3>Хиты существ на сцене</h3>
            {sceneTokens.map(token => {
              const actor = actors.find(item => item.id === token.actorId && item.kind !== 'hero' && battle.order.includes(item.id));
              if (!actor) return null;
              return <div className="sidebar-actor-card" key={token.id}><strong>{token.name}</strong>
                <PartyHealth actor={{ ...actor, name: token.name, hp: token.hp ?? actor.maxHp }} numbers onChange={delta => onTokenHp(token, actor, delta)}/>
              </div>;
            })}
          </section>}
        {role === 'gm' && <Button className="full" onClick={() => setConfiguring(true)}>Редактировать инициативу</Button>}
        {role === 'gm' && <Button className="primary full" onClick={onNext}>Следующий ход<ChevronRight size={15}/></Button>}
        {role === 'player' && battle.order[battle.turn] === heroId && <Button className="primary full" onClick={onNext}>Закончить ход</Button>}
        {role === 'gm' && <Button className="ghost full" onClick={() => setEnding(true)}>Завершить бой</Button>}
        {ending && <div className="confirm"><strong>Завершить текущий бой?</strong><Button onClick={() => setEnding(false)}>Отмена</Button><Button className="danger" onClick={() => { onEnd(); setEnding(false); }}>Завершить</Button></div>}
      </> : <><Empty><Swords size={26}/>Бой пока не начался</Empty>{role === 'gm' && <><Button className="full" onClick={() => setConfiguring(true)}>Настроить инициативу</Button><Button className="primary full" onClick={onStart}><Flag size={15}/>Начать бой</Button></>}</>}
    </div> : <>
      <div className="activity-content feed" ref={scroll}>
        {shown.length ? <><div className="feed-date">ТЕКУЩАЯ СЕССИЯ</div>{shown.map(entry => <article className={`entry entry-${entry.kind}`} key={entry.id}>
          <div className="entry-avatar">{entry.kind === 'roll' ? <Dice5 size={16}/> : entry.kind === 'event' ? <History size={16}/> : entry.author[0]}</div>
          <div className="entry-copy"><div><strong>{entry.author}</strong>{entry.secret && <EyeOff size={12} aria-label="Скрытый бросок"/>}</div><p>{entry.text}</p></div>
          {entry.value !== undefined && <output>{entry.value}</output>}
        </article>)}</> : <Empty>{tab === 'chat' ? 'Первое сообщение начнёт беседу.' : 'События партии появятся здесь.'}</Empty>}
      </div>
      {tab === 'chat' && <form className="chat-form" onSubmit={e => { e.preventDefault(); if (message.trim()) { onSend(message); setMessage(''); } }}>
        <div className="chat-caption"><span className="status-dot"/> Общий чат</div><div><input aria-label="Сообщение" value={message} maxLength={600} onChange={e => setMessage(e.target.value)} placeholder="Сообщение / 2d6+3"/><button type="submit" className="button icon-button primary" aria-label="Отправить сообщение" disabled={!message.trim()}><Send size={16}/></button></div>
      </form>}
    </>)}
    {expanded && (tab === 'chat' || tab === 'events' || tab === 'combat') && <div className="activity-secondary">
      <Button aria-pressed={tab === 'events'} onClick={() => setTab(tab === 'events' ? 'chat' : 'events')}><History size={14}/>События</Button>
      <Button aria-pressed={tab === 'combat'} onClick={() => setTab(tab === 'combat' ? 'chat' : 'combat')}><Swords size={14}/>Бой</Button>
    </div>}
  </aside>;
}

function InitiativeEditor({ actors, sceneActorIds, battle, onCancel, onSave }: {
  actors: Actor[]; sceneActorIds: string[]; battle?: Combat;
  onCancel: () => void; onSave: (participants: CombatParticipant[]) => void;
}) {
  const [included, setIncluded] = useState(() => new Set(battle?.order ?? sceneActorIds));
  const [scores, setScores] = useState<Record<string, string>>(() => Object.fromEntries(
    actors.map(actor => [actor.id, String(battle?.initiative[actor.id] ?? actor.init)]),
  ));
  const valid = included.size > 0 && [...included].every(id => scores[id]?.trim() && Number.isInteger(Number(scores[id])));
  return <form className="initiative-editor" onSubmit={event => {
    event.preventDefault();
    if (valid) onSave([...included].map(id => ({ id, initiative: Number(scores[id]) })));
  }}>
    <h2>Инициатива</h2>
    <p>Отметьте участников и задайте порядок бросками инициативы.</p>
    {actors.map(actor => <div className="initiative-entry" key={actor.id}>
      <label className="checkline"><input type="checkbox" checked={included.has(actor.id)} onChange={event => {
        const next = new Set(included);
        if (event.target.checked) next.add(actor.id);
        else next.delete(actor.id);
        setIncluded(next);
      }}/><span>{actor.name}</span></label>
      <input aria-label={`Инициатива: ${actor.name}`} type="number" step={1}
        disabled={!included.has(actor.id)} value={scores[actor.id]} onChange={event => setScores({ ...scores, [actor.id]: event.target.value })}/>
    </div>)}
    <footer><Button onClick={onCancel}>Отмена</Button>
      <Button type="submit" className="primary" disabled={!valid}>{battle ? 'Сохранить состав' : 'Начать бой'}</Button></footer>
  </form>;
}

export function RollResults({ entries, role, expanded }: { entries: Entry[]; role: Role; expanded: boolean }) {
  const seen = useRef(new Set(entries.map(entry => entry.id)));
  const [queue, setQueue] = useState<Entry[]>([]);
  const result = queue.find(entry => role === 'gm' || !entry.secret);
  useEffect(() => {
    const next = entries.filter(entry => !seen.current.has(entry.id) && entry.roll);
    for (const entry of entries) seen.current.add(entry.id);
    if (next.length) setQueue(previous => [...previous, ...next]);
  }, [entries]);
  useEffect(() => {
    if (role === 'player') setQueue(previous => previous.filter(entry => !entry.secret));
  }, [role]);
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setQueue(previous => previous.filter(entry => entry.id !== result.id)), 2600);
    return () => window.clearTimeout(timer);
  }, [result]);
  if (!result?.roll) return null;
  const { dice, sides, bonus, mode } = result.roll;
  const chosen = mode === 'advantage' ? Math.max(...dice) : Math.min(...dice);
  const critical = dice.length === 1 || mode !== 'normal' ? sides === 20 && [1, 20].includes(chosen) : false;
  return <aside className={`roll-result glass ${expanded ? '' : 'roll-result-collapsed'}`} aria-live="polite">
    {sides === 6 && dice.length === 1 ? <DiceVisual value={chosen} key={result.id}/> : <Dice5 size={19}/>}<div><strong>{result.text}</strong>
      <small>{dice.join(mode === 'normal' ? ' + ' : ' / ')}{bonus ? ` ${bonus < 0 ? '−' : '+'} ${Math.abs(bonus)}` : ''}
        {critical && ` · Натуральная ${chosen}`}{result.secret && ' · Скрытый'}</small></div>
    <output>{result.value}</output>
    <IconButton label="Закрыть результат броска" onClick={() => setQueue(previous => previous.filter(entry => entry.id !== result.id))}><X size={15}/></IconButton>
  </aside>;
}

const sides = [4, 6, 8, 10, 12, 20, 100];
export type RollPool = (groups: Record<number, number>, bonus: number, secret: boolean, formula: string) => number;
const savedPools: { groups: Record<number, number>; bonus: number; formula: string }[] = [];

export function DiceOverlay({ role, onRoll, onPool, onClose }: { role: Role; onRoll: Roll; onPool: RollPool; onClose: () => void }) {
  const [die, setDie] = useState(20);
  const [mode, setMode] = useState<Parameters<Roll>[1]>('normal');
  const [secret, setSecret] = useState(false);
  const [composer, setComposer] = useState(false);
  const [bonus, setBonus] = useState(0);
  const [groups, setGroups] = useState<Record<number, number>>({});
  const [saved, setSaved] = useState([...savedPools]);
  const [result, setResult] = useState<number>();
  function adjustDie(size: number, delta: number) {
    setGroups(current => ({ ...current, [size]: Math.min(20, Math.max(0, (current[size] ?? 0) + delta)) }));
    setResult(undefined);
  }
  const terms = Object.entries(groups).filter(([, count]) => count > 0).map(([face, count]) => `${count}d${face}`);
  const formula = terms.join(' + ') + (bonus ? ` ${bonus < 0 ? '−' : '+'} ${Math.abs(bonus)}` : '');
  return <FloatingWindow id="dice" label="Быстрый бросок" className="dice-overlay glass">
    <header><div className="segmented">
      <Button aria-pressed={!composer} onClick={() => setComposer(false)}>Быстрый</Button>
      <Button aria-pressed={composer} onClick={() => setComposer(true)}>Конструктор</Button>
    </div><IconButton label="Закрыть кубики" onClick={onClose}><X size={16}/></IconButton></header>
    {composer ? <div className="dice-list">
      {sides.map(size => <div className="dice-count" key={size}>
        <Button aria-label={`Добавить d${size}`} aria-pressed={Boolean(groups[size])} onClick={() => adjustDie(size, 1)}
          onContextMenu={event => { event.preventDefault(); adjustDie(size, -1); }}>d{size} <small>×{groups[size] ?? 0}</small></Button>
        {Boolean(groups[size]) && <IconButton label={`Убрать d${size}`} onClick={() => adjustDie(size, -1)}>−</IconButton>}
      </div>)}
    </div> : <div className="dice-list">{sides.map(size => <Button key={size} aria-pressed={size === die} onClick={() => { setDie(size); if (size !== 20) setMode('normal'); }}>d{size}</Button>)}</div>}
    <div className="form-grid">
      <label>Модификатор<input type="number" value={bonus} onChange={event => setBonus(Math.trunc(Number(event.target.value)) || 0)}/></label>
      {!composer && <select aria-label="Режим броска" value={mode} disabled={die !== 20} onChange={e => setMode(e.target.value as Parameters<Roll>[1])}><option value="normal">Обычный</option><option value="advantage">Преимущество</option><option value="disadvantage">Помеха</option></select>}
      {role === 'gm' && <label className="checkline"><input type="checkbox" checked={secret} onChange={e => setSecret(e.target.checked)}/>Скрытый</label>}
    </div>
    {composer && <>
      <p aria-label="Формула броска">{terms.length ? formula : 'Добавьте кубики'}</p>
      <div className="inline-form">
        <Button onClick={() => { setGroups({}); setBonus(0); setResult(undefined); setSecret(false); }}>Сброс</Button>
        <Button disabled={!terms.length || saved.some(item => item.formula === formula)} onClick={() => {
          savedPools.push({ groups, bonus, formula }); setSaved([...savedPools]);
        }}>Сохранить комбинацию</Button>
      </div>
      {saved.length > 0 && <select aria-label="Сохранённые комбинации" value="" onChange={event => {
        const preset = saved.find(item => item.formula === event.target.value);
        if (preset) { setGroups(preset.groups); setBonus(preset.bonus); }
      }}><option value="">Загрузить комбинацию</option>{saved.map(item => <option key={item.formula}>{item.formula}</option>)}</select>}
    </>}
    <div className="dice-submit"><Button className="primary" disabled={composer && !terms.length}
      onClick={() => setResult(composer ? onPool(groups, bonus, secret, formula) : onRoll(die, mode, secret, bonus))}>
      {composer ? 'Бросить комбинацию' : `Бросить d${die}`}
    </Button>{result !== undefined && <output aria-label="Результат броска">{result}</output>}</div>
  </FloatingWindow>;
}
