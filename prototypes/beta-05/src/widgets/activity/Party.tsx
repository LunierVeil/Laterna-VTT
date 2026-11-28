import { useState } from 'react';
import { QuickActions, type QuickActionCommands } from './QuickActions';
import { BookOpen, EyeOff, Minus, Plus } from 'lucide-react';
import type { Actor, MapObject } from '../../entities/model';
import { Button, Empty, Glyph, IconButton } from '../../shared/ui';

export function PartyHealth({ actor, numbers, onChange }: {
  actor: Pick<Actor, 'hp' | 'maxHp' | 'name'>; numbers: boolean; onChange?: (delta: number) => void;
}) {
  const ratio = Math.max(0, Math.min(1, actor.hp / actor.maxHp));
  const visible = numbers ? ratio : ratio === 0 ? 0 : ratio >= .75 ? 1 : ratio >= .4 ? .65 : ratio >= .2 ? .35 : .15;
  const state = ratio === 0 ? 'Без сознания' : ratio >= .75 ? 'В порядке' : ratio >= .4 ? 'Ранен' : 'Тяжело ранен';
  return <div className="party-health">
    {onChange && <IconButton label={`Урон −1: ${actor.name}`} disabled={actor.hp <= 0} onClick={() => onChange(-1)}><Minus size={14}/></IconButton>}
    <progress className={`health-${ratio < .4 ? 'low' : ratio < .75 ? 'mid' : 'ok'}`}
      max={1} value={visible} aria-label={numbers ? `Хиты: ${actor.name}` : state}/>
    {numbers && <output>{actor.hp} / {actor.maxHp}</output>}
    {onChange && <IconButton label={`Лечение +1: ${actor.name}`} disabled={actor.hp >= actor.maxHp} onClick={() => onChange(1)}><Plus size={14}/></IconButton>}
  </div>;
}

export function PlayerParty({ actors, heroId, showAllyNumbers, onSheet, onHp, actions, initialActions, initialEditing }: {
  actors: Actor[]; heroId: string; showAllyNumbers: boolean; onSheet: (id: string) => void; onHp: (actor: Actor, delta: number) => void;
  actions: QuickActionCommands; initialActions?: boolean; initialEditing?: boolean;
}) {
  const [expanded, setExpanded] = useState(Boolean(initialActions));
  const own = actors.find(actor => actor.id === heroId);
  if (!own) return null;
  const party = [own, ...actors.filter(actor => actor.kind === 'hero' && actor.id !== heroId)];
  return <section className="player-party" aria-label="Карточки партии">
    {party.map(actor => {
      const isOwn = actor.id === heroId;
      return <article className={`party-card glass ${isOwn ? 'party-card-own' : ''} ${isOwn && expanded ? 'party-card-expanded' : ''}`} key={actor.id}>
        <header><Glyph name={actor.symbol} size={17}/><strong>{actor.name}</strong>
          {isOwn && <IconButton label="Открыть лист из карточки партии" onClick={() => onSheet(actor.id)}><BookOpen size={16}/></IconButton>}
        </header>
        {isOwn && <small>КД {actor.ac} · {actor.progression?.className} {actor.progression?.level}</small>}
        <PartyHealth actor={actor} numbers={isOwn || showAllyNumbers} onChange={isOwn ? delta => onHp(actor, delta) : undefined}/>
        <PartyStatuses actor={actor} showSpent={isOwn}/>
        {isOwn && <Button data-guide="actions" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Действия</Button>}
        {isOwn && expanded && <QuickActions actor={actor} {...actions} initialEditing={initialEditing}/>}
      </article>;
    })}
  </section>;
}

function PartyStatuses({ actor, showSpent }: { actor: Actor; showSpent: boolean }) {
  const conditions = actor.conditions ?? [];
  if (!conditions.length && !(showSpent && (actor.bonusUsed || actor.reactionUsed))) return null;
  return <div className="party-statuses">
    {showSpent && actor.bonusUsed && <small className="party-status-spent">Бонусное действие потрачено</small>}
    {showSpent && actor.reactionUsed && <small className="party-status-spent">Реакция потрачена</small>}
    {conditions.map(condition => <small className="party-conditions" key={condition}>{condition}</small>)}
  </div>;
}

export function PartyOverview({ actors, tokens, sceneName, onSheet, onHeroHp, onTokenHp, actions, initialActor }: {
  actors: Actor[]; tokens: MapObject[]; sceneName: string; onSheet: (id: string) => void;
  onHeroHp: (actor: Actor, delta: number) => void; onTokenHp: (token: MapObject, actor: Actor, delta: number) => void;
  actions: QuickActionCommands; initialActor?: string;
}) {
  const [expanded, setExpanded] = useState(initialActor);
  function actionSection(id: string, actor: Actor) {
    return <>
      <Button aria-expanded={expanded === id} onClick={() => setExpanded(expanded === id ? undefined : id)}>Действия</Button>
      {expanded === id && <QuickActions actor={actor} {...actions}/>}
    </>;
  }
  const heroes = actors.filter(actor => actor.kind === 'hero');
  const creatures = tokens.flatMap(token => {
    const actor = actors.find(item => item.id === token.actorId);
    return actor?.kind === 'hero' ? [] : [{ token, actor }];
  });
  return <div className="activity-content party-overview">
    <section aria-labelledby="party-heroes">
      <h3 id="party-heroes">Герои кампании</h3>
      {!heroes.length && <Empty>В кампании пока нет героев.</Empty>}
      {heroes.map(actor => <article className="sidebar-actor-card" key={actor.id}>
        <Button className="scene-row" onClick={() => onSheet(actor.id)}>
          <Glyph name={actor.symbol} size={16}/>{actor.name}
        </Button>
        <small>КД {actor.ac}{actor.tempHp ? ` · Временные HP: ${actor.tempHp}` : ''}</small>
        <PartyHealth actor={actor} numbers onChange={delta => onHeroHp(actor, delta)}/>
        <PartyStatuses actor={actor} showSpent/>
        {Object.entries(actor.spellSlots ?? {}).filter(([, slot]) => slot.max > 0).map(([level, slot]) =>
          <small key={level}>Ячейки {level} круга · {slot.max - slot.current} из {slot.max} потрачено</small>)}
        {actor.progression?.resources?.map(resource =>
          <small key={resource.name}>{resource.name} · {resource.current} / {resource.max}</small>)}
        {actionSection(actor.id, actor)}
      </article>)}
    </section>
    <section aria-labelledby="party-creatures">
      <h3 id="party-creatures">Существа на сцене</h3>
      <p className="micro">{sceneName}</p>
      {!creatures.length && <Empty>На этой сцене пока нет существ.</Empty>}
      {creatures.map(({ token, actor }) => <article className="sidebar-actor-card" key={token.id}>
        {actor ? <Button className="scene-row" onClick={() => onSheet(actor.id)}>
          <Glyph name={token.symbol ?? actor.symbol} size={16}/>{token.name}
        </Button> : <strong>{token.name}</strong>}
        {token.secret && <small className="party-hidden"><EyeOff size={14}/>Скрыт от игроков</small>}
        {actor && <>
          <small>КД {actor.ac}</small>
          <PartyHealth actor={{ ...actor, name: token.name, hp: token.hp ?? actor.maxHp }} numbers
            onChange={delta => onTokenHp(token, actor, delta)}/>
          <PartyStatuses actor={actor} showSpent={false}/>
          {!!actor.resource && <small>Заряды · {actor.resource}</small>}
          {actionSection(token.id, actor)}
        </>}
      </article>)}
    </section>
  </div>;
}
