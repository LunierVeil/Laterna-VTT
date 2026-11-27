import { useState } from 'react';
import type { Actor, MapObject, SheetSpell } from '../../entities/model';
import { Button, Empty, IconButton } from '../../shared/ui';
import { ArrowDown, ArrowUp, BookOpen, EyeOff, Minus, Pin, Plus, X } from 'lucide-react';
import type { Roll } from '../../features/roster';
import { attackRows, changeHp, damageRoll, skillRows, spendSpellSlot } from '../../features/roster/gameplay';

interface Action {
  key: string; name: string; disabled?: boolean; run: () => void;
  damage?: () => void;
}

export function QuickActions({ actors, tokens, gm, onSave, onRoll, onSheet, onTokenHp, onNotify, onClose }: {
  actors: Actor[]; tokens: MapObject[]; gm: boolean;
  onSave: (actor: Actor) => void; onRoll: Roll; onSheet: (id: string) => void;
  onTokenHp: (token: MapObject, actor: Actor, delta: number) => void;
  onNotify: (message: string) => void; onClose: () => void;
}) {
  const [id, setId] = useState('');
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [spellId, setSpellId] = useState('');
  const [slotLevel, setSlotLevel] = useState(1);
  const [amount, setAmount] = useState(1);
  const sceneCreatures = tokens.flatMap(token => {
    const actor = actors.find(item => item.id === token.actorId && item.kind !== 'hero');
    return actor ? [{ token, actor }] : [];
  });
  const currentToken = gm ? sceneCreatures.find(({ token }) => token.id === id) : undefined;
  const heroes = actors.filter(actor => actor.kind === 'hero');
  const actor = currentToken?.actor ?? (gm ? heroes : actors).find(actor => actor.id === id)
    ?? (gm ? heroes[0] ?? sceneCreatures[0]?.actor : actors[0]);
  const token = currentToken?.token ?? (gm && !heroes.length ? sceneCreatures[0]?.token : undefined);
  if (!actor) return <section className="table-quick-actions glass"><Empty>Нет доступных персонажей.</Empty><Button onClick={onClose}>Закрыть</Button></section>;
  const hp = token ? token.hp ?? actor.maxHp : actor.hp;
  const spell = actor.spells?.find(item => item.id === spellId);
  const checks = skillRows(actor);
  const attacks = attackRows(actor);
  function slotsFor(spell: SheetSpell) {
    return Object.entries(actor!.spellSlots ?? {}).filter(([level, slot]) => Number(level) >= spell.level && slot.current > 0);
  }
  function modifyHp(sign: number) {
    const delta = sign * Math.max(1, Math.trunc(amount) || 1);
    if (token) onTokenHp(token, actor!, delta);
    else onSave(changeHp(actor!, delta));
  }
  const options: Action[] = [
    ...attacks.map(({id,name,damage}) => {
      const parsed = damageRoll(damage);
      return { key:'attack:'+id, name, run:()=>onRoll(20,'normal',false,Number(/[+-]\d+/.exec(name)?.[0] ?? 0),name,true),
        damage:parsed ? ()=>onRoll(parsed.sides,'normal',false,parsed.bonus,'Урон: '+name.split(' · ')[0]) : undefined };
    }),
    ...(actor.spells ?? []).filter(item=>item.equipped && item.level > 0).map(item => ({
      key:'spell:'+item.id, name:'Ячейка · '+item.name, disabled:!slotsFor(item).length,
      run:()=>{setSpellId(item.id);setSlotLevel(Number(slotsFor(item)[0]?.[0] ?? item.level));},
    })),
    ...(actor.spells ?? []).flatMap(item=>{
      if(!item.equipped || item.level!==0) return [];
      const attack=attacks.find(({name})=>name.split(' · ')[0]===item.name);
      return attack?[{key:'spell:'+item.id,name:item.name,run:()=>onRoll(20,'normal',false,Number(/[+-]\d+/.exec(attack.name)?.[0]??0),item.name,true)}]:[];
    }),
    ...checks.map(({name,bonus}) => ({key:'skill:'+name,name,run:()=>onRoll(20,'normal',false,bonus,name)})),
    ...(actor.sheetProfile?.scores ?? []).map((score,index) => {
      const name='Спасбросок · '+['СИЛ','ЛОВ','ТЕЛ','ИНТ','МДР','ХАР'][index];
      const bonus=Math.floor((score-10)/2)+(actor.sheetProfile!.saves.includes(index)?actor.sheetProfile!.proficiency:0);
      return {key:'save:'+index,name,run:()=>onRoll(20,'normal',false,bonus,name)};
    }),
    ...(['bonus','reaction'] as const).flatMap(kind => {
      const field=kind==='bonus'?'bonusUsed':'reactionUsed';
      return actor.actions[kind].split('\n').filter(Boolean).map(name=>({
        key:kind+':'+name,name:`${name} · ${actor[field] ? 0 : 1} / 1`,disabled:Boolean(actor[field]),
        run:()=>onSave({...actor,[field]:true}),
      }));
    }),
    ...(actor.progression?.resources ?? []).map((resource,index)=>({
      key:'class-resource:'+index,name:`${resource.name} · ${resource.current} / ${resource.max}`,disabled:resource.current<=0,
      run:()=>{
        const progression=actor.progression!;
        onSave({...actor,progression:{...progression,resources:progression.resources!.map((item,i)=>
          i===index?{...item,current:item.current-1}:item)}});
      },
    })),
    {key:'resource',name:`Потратить заряд · ${actor.resource}`,disabled:actor.resource<=0,run:()=>onSave({...actor,resource:actor.resource-1})},
  ];
  const pinned=(actor.quickActions ?? options.slice(0,3).map(option=>option.key)).filter(key=>options.some(option=>option.key===key));
  const choose = (next: string) => {setId(next);setSpellId('');setEditing(false);};
  function move(index: number, delta: number) {
    const next=[...pinned]; [next[index],next[index+delta]]=[next[index+delta],next[index]];
    onSave({...actor!,quickActions:next});
  }
  return <section className={`table-quick-actions glass ${gm?'gm-actions':'player-actions'}`} aria-label="Быстрые действия">
    <header><strong>{gm?'Партия и существа':actor.name}</strong>
      <IconButton label="Открыть лист персонажа" onClick={()=>onSheet(actor.id)}><BookOpen size={16}/></IconButton>
      <IconButton label="Настроить быстрые действия" aria-pressed={editing} onClick={()=>setEditing(!editing)}><Pin size={16}/></IconButton>
      <IconButton label="Закрыть быстрые действия" onClick={onClose}><X size={16}/></IconButton></header>
    {gm && <>
      <div className="gm-actors">
        {heroes.map(hero=><Button key={hero.id} aria-pressed={actor.id===hero.id && !token} onClick={()=>choose(hero.id)}>
          <span>{hero.name}</span><small>{hero.hp}/{hero.maxHp} HP · КД {hero.ac}</small></Button>)}
        {sceneCreatures.map(({token:item,actor:creature})=><Button key={item.id} aria-pressed={token?.id===item.id} onClick={()=>choose(item.id)}>
          <span>{item.secret && <EyeOff size={13} aria-label="Скрыт от игроков"/>}{item.name}</span>
          <small>{item.hp ?? creature.maxHp}/{creature.maxHp} HP · КД {creature.ac}</small></Button>)}
      </div>
      <Button aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Свернуть сводку':'Состояния и ресурсы'}</Button>
      {expanded && <div className="gm-resources">{Array.from(new Map([...heroes,...sceneCreatures.map(item=>item.actor)].map(item=>[item.id,item])).values()).map(item=><p key={item.id}>
        <strong>{item.name}</strong> · {item.conditions?.join(', ') || 'Без состояний'} · Заряды {item.resource}
        {item.progression?.resources?.map(resource=>` · ${resource.name} ${resource.current}/${resource.max}`)}
      </p>)}</div>}
    </>}
    {!gm && actors.length>1 && <select aria-label="Подконтрольный персонаж" value={actor.id} onChange={event=>choose(event.target.value)}>
      {actors.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}
    <div className="quick-health"><strong>{hp}/{actor.maxHp} HP</strong><small>КД {actor.ac}{!token && actor.tempHp ? ` · +${actor.tempHp} врем.` : ''}</small>
      <IconButton label="Нанести урон" disabled={hp <= 0 && (Boolean(token) || !actor.tempHp)} onClick={()=>modifyHp(-1)}><Minus size={15}/></IconButton>
      <input type="number" min={1} aria-label="Величина изменения HP" value={amount} onChange={event=>setAmount(Number(event.target.value))}/>
      <IconButton label="Лечение" disabled={hp>=actor.maxHp} onClick={()=>modifyHp(1)}><Plus size={15}/></IconButton>
    </div>
    {!!actor.conditions?.length && <div className="quick-conditions">{actor.conditions.join(' · ')}</div>}
    <div className="quick-games">
      {pinned.map((key,index)=>{
        const action=options.find(option=>option.key===key)!;
        return <div key={key} className="quick-action-row"><Button disabled={action.disabled} onClick={action.run}>{action.name}</Button>
          {action.damage && !editing && <Button onClick={action.damage} aria-label={`Бросить урон: ${action.name}`}>Урон</Button>}
          {editing && <>
            <IconButton label="Выше" disabled={!index} onClick={()=>move(index,-1)}><ArrowUp size={15}/></IconButton>
            <IconButton label="Ниже" disabled={index===pinned.length-1} onClick={()=>move(index,1)}><ArrowDown size={15}/></IconButton>
            <IconButton label="Открепить" onClick={()=>onSave({...actor,quickActions:pinned.filter(item=>item!==key)})}><X size={15}/></IconButton>
          </>}
        </div>;
      })}
      {!pinned.length && <Empty>Закрепите действия с помощью значка булавки.</Empty>}
    </div>
    {editing && <select aria-label="Закрепить команду" value="" onChange={event=>{
      if(event.target.value) onSave({...actor,quickActions:[...pinned,event.target.value]});
    }}><option value="">Закрепить команду…</option>{options.filter(item=>!pinned.includes(item.key)).map(item=><option key={item.key} value={item.key}>{item.name}</option>)}</select>}
    {spell && <div className="quick-spell" aria-label="Расход ячейки">
      <strong>{spell.name}</strong><small>Демо учитывает расход. Эффект на цель применяется вручную.</small>
      <select aria-label="Круг ячейки" value={slotLevel} onChange={event=>setSlotLevel(Number(event.target.value))}>
        {slotsFor(spell).map(([level,slot])=><option key={level} value={level}>{level} круг · {slot.current}/{slot.max}</option>)}
      </select>
      <Button onClick={()=>setSpellId('')}>Отмена</Button>
      <Button className="primary" onClick={()=>{
        const next=spendSpellSlot(actor, slotLevel);
        if(next){onSave(next);onNotify(`${spell.name} · потрачена ячейка ${slotLevel} круга`);}
        setSpellId('');
      }}>Потратить ячейку</Button>
    </div>}
  </section>;
}
