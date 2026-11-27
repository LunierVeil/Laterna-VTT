import { X, BookOpen, Feather, Play, Plus, Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Actor } from '../../entities/model';
import { Button, Empty, Glyph, IconButton } from '../../shared/ui';

export const npcChapters = ['Все', 'Союзники', 'Нейтральные', 'Враги'] as const;

export function NpcBook({ actors, tools, onClose, onCreate, onEdit, onSheet, onPlace }: {
  tools: ReactNode; onClose: () => void; actors: Actor[]; onCreate: () => void; onEdit: (actor: Actor) => void;
  onSheet: (actor: Actor) => void; onPlace: (actor: Actor) => void;
}) {
  const [chapter, setChapter] = useState<typeof npcChapters[number]>('Все');
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<string>();
  const search = query.trim().toLocaleLowerCase('ru');
  const matches = actors.filter(actor => actor.kind === 'npc' &&
    (chapter === 'Все' || (actor.npcProfile?.chapter ?? 'Нейтральные') === chapter) &&
    `${actor.name} ${actor.title}`.toLocaleLowerCase('ru').includes(search))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const active = matches.find(actor => actor.id === selection) ?? matches[0];

  return <section className="chronicle-spread bestiary-spread npc-spread" aria-label="Книга NPC">
    <div className="document-index">
      <div className="chronicle-tools">{tools}</div>
      <h2>Книга NPC</h2>
      <p className="chronicle-overline">Реестр жителей · PROPOSED</p>
      <div className="search-input"><Search size={16}/><input type="search" aria-label="Поиск NPC"
        placeholder="Поиск по названию…" value={query} onChange={event => setQuery(event.target.value)}/></div>
      <div className="chronicle-chapters" aria-label="Главы книги NPC">
        {npcChapters.map(name => <Button key={name} aria-pressed={chapter === name} onClick={() => setChapter(name)}>{name}</Button>)}
      </div>
      {matches.map(actor => <Button key={actor.id} className="document-row" aria-pressed={active?.id === actor.id}
        onClick={() => setSelection(actor.id)}>
        <Glyph name={actor.symbol} size={22}/><span><strong>{actor.name}</strong><small>{actor.title}</small></span>
      </Button>)}
      {!matches.length && <Empty>В этой главе нет подходящих NPC.</Empty>}
    </div>
    <div className="document-reader">
      <IconButton className="creature-book-close" label="Закрыть окно" onClick={onClose}><X size={18}/></IconButton>
      {active ? <article className="chronicle-entry">
        <div className="chronicle-overline">Страница / Подробности</div>
        <h3>{active.name}</h3>
        <p className="chronicle-overline">{active.npcProfile?.chapter ?? 'Нейтральные'} · {active.title || 'NPC'}</p>
        <div className="chronicle-preview">
          <div className="chronicle-page-mark" aria-hidden="true"><Glyph name={active.symbol} size={50}/><span>Портрет персонажа</span></div>
          <div className="paper-copy">
            <strong>{active.title || 'Роль не указана'}</strong>
            {active.npcProfile?.appearance && <p>Внешность: {active.npcProfile.appearance}</p>}
            {active.npcProfile?.personality && <p>Характер: {active.npcProfile.personality}</p>}
          </div>
        </div>
        {active.npcProfile?.biography && <p className="npc-book-note"><strong>Биография</strong> · {active.npcProfile.biography}</p>}
        {active.notes && <p className="npc-book-note"><strong>Заметка мастера</strong> · {active.notes}</p>}
        <div className="document-actions">
          <Button onClick={onCreate}><Plus size={16}/>Добавить NPC</Button>
          <Button onClick={() => onEdit(active)}><Feather size={16}/>Редактировать</Button>
          <Button onClick={() => onSheet(active)}><BookOpen size={16}/>Лист</Button>
          <Button onClick={() => onPlace(active)}><Play size={16}/>На сцену</Button>
        </div>
      </article> : <><Empty>Выберите NPC в каталоге.</Empty><Button onClick={onCreate}><Plus size={16}/>Добавить NPC</Button></>}
    </div>
  </section>;
}
