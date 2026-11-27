import { useState } from 'react';
import { BookOpen, Plus, X } from 'lucide-react';
import { uid, type Actor, type SheetSpell } from '../../entities/model';
import { Button, Empty, IconButton } from '../../shared/ui';
import { actorSpells, catalog, srdSpellSource } from './spellCatalog';

const classes: Record<string, string> = {
  wizard:'Волшебник', sorcerer:'Чародей', cleric:'Жрец', druid:'Друид', bard:'Бард',
  ranger:'Следопыт', paladin:'Паладин', warlock:'Колдун',
};
const purposes = ['Урон','Лечение','Защита','Контроль','Усиление','Ослабление','Призыв','Вспомогательная магия'];
const purposeById: Record<string, string[]> = {
  'fire-bolt':['Урон'], light:['Вспомогательная магия'], guidance:['Усиление','Вспомогательная магия'],
  'cure-wounds':['Лечение'], goodberry:['Лечение','Вспомогательная магия'], 'hunters-mark':['Урон','Усиление'],
  shield:['Защита'], 'magic-missile':['Урон'], bless:['Усиление'], 'pass-without-trace':['Усиление','Вспомогательная магия'],
  'lesser-restoration':['Лечение'], darkvision:['Усиление','Вспомогательная магия'], 'misty-step':['Вспомогательная магия'], fireball:['Урон'],
};
type Entry = { spell: SheetSpell; classes: string[]; purposes: string[] };
const srd: Entry[] = catalog.map(spell => ({ spell, classes: spell.classes.map(name => classes[name] ?? name), purposes: purposeById[spell.id] ?? [] }));
const samples: Entry[] = [
  {spell:{id:'shade-vines',name:'Сумеречные путы',level:1,school:'Вызов',casting:'1 действие',range:'30 фт.',components:'В, С',duration:'1 раунд',prepared:false,description:'Тени обвивают ноги цели и на короткое время мешают ей двигаться.'},classes:['Друид'],purposes:['Контроль','Ослабление']},
  {spell:{id:'ember-friend',name:'Искра-проводник',level:1,school:'Вызов',casting:'1 действие',range:'15 фт.',components:'В, С, М',duration:'10 минут',prepared:false,description:'Появляется крошечный огненный дух. Он освещает путь и может указать направление движения.'},classes:['Волшебник','Колдун'],purposes:['Призыв','Вспомогательная магия']},
];
const levelName = (level: number) => level ? `${level} круг` : 'Заговор';

export function GlobalSpellbook({ actors, targets, onSave, onClose }: {
  actors: Actor[]; targets: Actor[]; onSave: (actor: Actor) => void; onClose: () => void;
}) {
  const [source,setSource] = useState<'srd'|'homebrew'>('srd');
  const [query,setQuery] = useState('');
  const [klass,setKlass] = useState('');
  const [level,setLevel] = useState('');
  const [school,setSchool] = useState('');
  const [purpose,setPurpose] = useState('');
  const [selection,setSelection] = useState('');
  const [targetId,setTargetId] = useState('');
  const [feedback,setFeedback] = useState('');
  const srdNames = new Set(srd.map(entry => entry.spell.name));
  const homebrew = [...samples];
  for (const actor of actors) for (const spell of actor.spells ?? []) {
    if (srdNames.has(spell.name) || homebrew.some(entry => entry.spell.name === spell.name)) continue;
    homebrew.push({ spell, classes: actor.progression?.className ? [actor.progression.className] : [], purposes: [] });
  }
  const entries = source === 'srd' ? srd : homebrew;
  const visible = entries.filter(({spell,classes,purposes}) => spell.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')) &&
    (!klass || classes.includes(klass)) && (!level || spell.level === Number(level)) &&
    (!school || spell.school === school) && (!purpose || purposes.includes(purpose)));
  const current = visible.find(entry => entry.spell.id === selection) ?? visible[0];
  const target = targets.find(actor => actor.id === targetId) ?? targets[0];
  const known = target ? actorSpells(target) : [];
  function copy() {
    if (!target || !current || known.some(spell => spell.name === current.spell.name)) return;
    const next = [...known,{...current.spell,id:uid(),prepared:false,equipped:false}];
    onSave({...target,spells:next,actions:{...target.actions,spells:next.map(spell=>spell.name).join('\n')}});
    setFeedback(`«${current.spell.name}» добавлено в лист · ${target.name}`);
  }
  return <section className="chronicle-spread grimoire" aria-label="Книга заклинаний">
    <div className="document-index">
      <h2><BookOpen size={20}/> Книга заклинаний</h2>
      <div className="segmented">{(['srd','homebrew'] as const).map(value => <Button key={value} aria-pressed={source===value} onClick={() => {
        setSource(value); setKlass(''); setLevel(''); setSchool(''); setPurpose(''); setSelection(''); setFeedback('');
      }}>{value==='srd'?'SRD 5.1':'Homebrew'}</Button>)}</div>
      <input type="search" aria-label="Поиск в книге заклинаний" placeholder="Поиск по названию…" value={query} onChange={event=>setQuery(event.target.value)}/>
      <div className="form-grid">
        <label>Класс<select value={klass} onChange={e=>setKlass(e.target.value)}><option value="">Все</option>
          {[...new Set(entries.flatMap(entry=>entry.classes))].sort().map(value=><option key={value}>{value}</option>)}</select></label>
        <label>Круг<select value={level} onChange={e=>setLevel(e.target.value)}><option value="">Все</option>
          {Array.from({length:10},(_,value)=><option key={value} value={value}>{levelName(value)}</option>)}</select></label>
        <label>Школа<select value={school} onChange={e=>setSchool(e.target.value)}><option value="">Все</option>
          {[...new Set(entries.flatMap(entry=>entry.spell.school || []))].sort().map(value=><option key={value}>{value}</option>)}</select></label>
        <label>Назначение<select value={purpose} onChange={e=>setPurpose(e.target.value)}><option value="">Все</option>
          {purposes.map(value=><option key={value}>{value}</option>)}</select></label>
      </div>
      <div className="grimoire-index">{visible.map(entry=><Button className="document-row" key={entry.spell.id} aria-pressed={entry===current}
        onClick={()=>{setSelection(entry.spell.id);setFeedback('');}}><span><strong>{entry.spell.name}</strong><small>{levelName(entry.spell.level)} · {entry.spell.school || 'Без школы'}</small></span></Button>)}</div>
      {!visible.length && <Empty>Заклинания по этим фильтрам не найдены.</Empty>}
      {source==='srd' && <small><a href={srdSpellSource} target="_blank" rel="noreferrer">SRD 5.1 · Wizards of the Coast LLC · CC BY 4.0</a></small>}
    </div>
    <div className="document-reader">
      <IconButton className="grimoire-close" label="Закрыть окно" onClick={onClose}><X size={17}/></IconButton>
      {current && <article>
        <p className="sheet-subtitle">{levelName(current.spell.level)} · {current.spell.school || 'Без школы'}</p>
        <h3>{current.spell.name}</h3>
        <div className="grimoire-tags">{current.purposes.map(value=><span className="badge" key={value}>{value}</span>)}</div>
        <dl className="sheet-record-fields">{[
          ['Классы',current.classes.join(', ')],['Время накладывания',current.spell.casting],['Дальность',current.spell.range],
          ['Компоненты',current.spell.components],['Длительность',current.spell.duration],
        ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'—'}</dd></div>)}</dl>
        <p className="paper-copy">{current.spell.description || 'Описание не задано.'}</p>
        {target ? <div className="inline-form">
          <label>Добавить в лист<select value={target.id} onChange={e=>{setTargetId(e.target.value);setFeedback('');}}>
            {targets.map(actor=><option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
          <Button className="primary" disabled={known.some(spell=>spell.name===current.spell.name)} onClick={copy}><Plus size={15}/>
            {known.some(spell=>spell.name===current.spell.name)?'Уже в листе':'Добавить заклинание'}</Button>
        </div> : <p>Нет доступных листов.</p>}
        {feedback && <p role="status">{feedback}</p>}
      </article>}
    </div>
  </section>;
}
