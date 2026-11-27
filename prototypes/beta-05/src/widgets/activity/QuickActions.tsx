import { useState } from 'react';
import type { Actor } from '../../entities/model';
import { Button, Empty, IconButton } from '../../shared/ui';
import { ArrowDown, ArrowUp, Pin, X } from 'lucide-react';
import type { Roll, SheetTab } from '../../features/roster';

export function QuickActions({ actors, onSave, onRoll, onSheet, onClose }: {
  actors: Actor[]; onSave: (actor: Actor) => void; onRoll: Roll; onSheet: (id: string, tab: SheetTab, recordId?: string) => void; onClose: () => void;
}) {
  const [id, setId] = useState('');
  const [editing, setEditing] = useState(false);
  const actor = actors.find(a => a.id === id) ?? actors[0];
  if (!actor) return <section className="table-quick-actions glass"><Empty>Нет доступных персонажей.</Empty><Button onClick={onClose}>Закрыть</Button></section>;
  const attacks = actor.equipment?.length ? actor.equipment.filter(item => item.equipped && item.quantity && item.attack)
    .map(item => ({ id: item.id, name: item.attack! })) : actor.actions.attack.split('\n').filter(Boolean).map(name => ({id:name,name}));
  const options = [
    ...attacks.map(({id,name}) => ({key:'attack:'+id, name, run:() => onRoll(20,'normal',false,Number(/[+-]\d+/.exec(name)?.[0] ?? 0),name,true)})),
    ...(actor.spells ?? []).filter(spell => spell.equipped).map(spell => ({key:'spell:'+spell.id,name:spell.name + (spell.level ? ` · ячейки ${actor.spellSlots?.[spell.level]?.current ?? 0} / ${actor.spellSlots?.[spell.level]?.max ?? 0}` : ' · заговор'),run:()=>onSheet(actor.id, 'Заклинания', spell.id)})),
    ...(actor.progression?.features ?? []).map(name => ({key:'feature:'+name,name,run:()=>onSheet(actor.id, 'Умения')})),
    ...(['bonus', 'reaction'] as const).flatMap(kind => {
      const field = kind === 'bonus' ? 'bonusUsed' : 'reactionUsed';
      return actor.actions[kind].split('\n').filter(Boolean).map(name => ({
        key:kind + ':' + name, name:`${name} · ${actor[field] ? 0 : 1} / 1`, disabled:Boolean(actor[field]),
        run:()=>onSave({...actor, [field]:true}),
      }));
    }),
    ...(actor.progression?.resources ?? []).map((resource, index) => ({
      key:'class-resource:'+index, name:`${resource.name} · ${resource.current} / ${resource.max}`, disabled:resource.current <= 0,
      run:()=> {
        const progression = actor.progression!;
        const resources = progression.resources!.map((item, i) => i === index ? {...item,current:item.current-1} : item);
        onSave({...actor, progression:{...progression, resources}});
      },
    })),
    {key:'resource',name:`Потратить заряд · ${actor.resource}`,disabled:actor.resource<=0,run:()=>onSave({...actor,resource:actor.resource-1})},
  ];
  const pinned = (actor.quickActions ?? options.slice(0,3).map(option => option.key)).filter(key => options.some(option=>option.key===key));
  function move(index: number, delta: number) {
    const next=[...pinned]; [next[index],next[index+delta]]=[next[index+delta],next[index]];
    onSave({...actor!,quickActions:next});
  }
  return <section className="table-quick-actions glass" aria-label="Быстрые действия">
    <header><strong>Быстрые действия</strong><IconButton label="Закрыть быстрые действия" onClick={onClose}><X size={16}/></IconButton></header>
    <select aria-label="Персонаж для быстрых действий" value={actor.id} onChange={event=>setId(event.target.value)}>
      {actors.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    <Button aria-pressed={editing} onClick={()=>setEditing(!editing)}><Pin size={15}/>{editing?'Готово':'Настроить'}</Button>
    {editing && options.filter(option=>!pinned.includes(option.key)).map(option=><Button key={option.key} onClick={()=>onSave({...actor,quickActions:[...pinned,option.key]})}>Закрепить · {option.name}</Button>)}
    {pinned.map((key,index)=>{
      const action=options.find(option=>option.key===key)!;
      return <div key={key} className="quick-action-row"><Button disabled={'disabled' in action && Boolean(action.disabled)} onClick={action.run}>{action.name}</Button>
        {editing && <>
          <IconButton label="Выше" disabled={!index} onClick={()=>move(index,-1)}><ArrowUp size={15}/></IconButton>
          <IconButton label="Ниже" disabled={index===pinned.length-1} onClick={()=>move(index,1)}><ArrowDown size={15}/></IconButton>
          <IconButton label="Открепить" onClick={()=>onSave({...actor,quickActions:pinned.filter(item=>item!==key)})}><X size={15}/></IconButton>
        </>}
      </div>;
    })}
    {!pinned.length && <Empty>Закрепите атаки, магию, умения или заряды.</Empty>}
  </section>;
}
