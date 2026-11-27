import { X, BookOpen, CopyPlus, Feather, PawPrint, Play, Search, Skull, Sparkles, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { actionLabels, type Actor } from '../../entities/model';
import { Button, Empty, Glyph, IconButton } from '../../shared/ui';

const chapters = [
  { name: 'Все', icon: BookOpen },
  { name: 'Нежить', icon: Skull },
  { name: 'Звери', icon: PawPrint },
  { name: 'Драконы', icon: Sparkles },
  { name: 'Гуманоиды', icon: Users },
];
const categories: Record<string, string> = { 'Нежить': 'Нежить', 'Зверь': 'Звери', 'Дракон': 'Драконы', 'Гуманоид': 'Гуманоиды' };

export function Bestiary({ creatures, tools, onClose, onCopy, onCustom, onPlace, picking }: {
  tools: ReactNode; picking?: boolean; onClose: () => void; creatures: Actor[]; onCopy: (actor: Actor) => void; onCustom: (actor: Actor) => void; onPlace: (actor: Actor) => void;
}) {
  const [chapter, setChapter] = useState('Все');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<string>();
  const matches = creatures.filter(actor => (
    chapter === 'Все' || categories[actor.srdProfile?.category ?? actor.title.split(' · ')[0]] === chapter
  ) && `${actor.name} ${actor.title}`.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const selected = matches.find(creature => creature.id === selection) ?? matches[0];

  return <section className="chronicle-spread bestiary-spread" aria-label="Книга чудовищ">
    <div className="document-index">
      <div className="chronicle-tools">{tools}</div>
      <h2>Книга чудовищ</h2>
      <div className="search-input"><Search size={16}/><input type="search" aria-label="Поиск существ"
        placeholder="Поиск по названию…" value={search} onChange={event => setSearch(event.target.value)}/></div>
      <div className="chronicle-chapters" aria-label="Главы бестиария">
        {chapters.map(({ name, icon: Icon }) => <Button key={name} aria-pressed={chapter === name}
          onClick={() => setChapter(name)}><Icon size={15}/>{name}</Button>)}
      </div>
      {matches.map(creature => <Button key={creature.id} className="document-row"
        aria-pressed={creature.id === selected?.id} onClick={() => setSelection(creature.id)}>
        <Glyph name={creature.symbol} size={22}/>
        <span><strong>{creature.name}</strong><small>{creature.title}</small></span>
      </Button>)}
      {!matches.length && <Empty>В этой главе пока нет подходящих существ.</Empty>}
      <small className="bestiary-attribution">Найдено: {matches.length} из {creatures.length} · SRD 5.1 · CC BY 4.0</small>
      <details className="bestiary-attribution"><summary>Источник и лицензия</summary>
        This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at{' '}
        <a href="https://dnd.wizards.com/resources/systems-reference-document">dnd.wizards.com/resources/systems-reference-document</a>.
        The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/legalcode">creativecommons.org/licenses/by/4.0/legalcode</a>.
        <p>Адаптация для Laterna: русские названия, сокращённые карточки и инициативы по модификатору Ловкости.</p>
      </details>
    </div>
    <div className="document-reader">
      <IconButton className="creature-book-close" label="Закрыть окно" onClick={onClose}><X size={18}/></IconButton>
      {selected ? <article className="chronicle-entry">
        <div className="chronicle-overline">Страница / Подробности</div>
        <h3>{selected.name}</h3>
        <p className="chronicle-overline">{selected.title}</p>
        <div className="chronicle-preview">
          <div className="chronicle-page-mark" aria-hidden="true"><Glyph name={selected.symbol} size={55}/></div>
          <dl className="bestiary-stats">
            <div><dt>КД</dt><dd>{selected.ac}</dd></div>
            <div><dt>Хиты</dt><dd>{selected.maxHp}</dd></div>
            <div><dt>Инициатива</dt><dd>{selected.init}</dd></div>
            {selected.srdProfile && <><div><dt>Скорость</dt><dd>{selected.srdProfile.speed} фт.</dd></div>
              <div><dt>Размер</dt><dd>{selected.srdProfile.size}</dd></div></>}
          </dl>
        </div>
        <div className="bestiary-actions">{Object.entries(selected.actions).filter(([, value]) => value.trim())
          .map(([key, value]) => <section key={key}><h4>{actionLabels[key as keyof Actor['actions']]}</h4><p>{value}</p></section>)}</div>
        {selected.srdProfile && <p className="bestiary-attribution"><a
          href={`https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf#page=${selected.srdProfile.page}`}
          target="_blank" rel="noreferrer">Полная карточка SRD 5.1 · стр. {selected.srdProfile.page}</a></p>}
        <div className="document-actions">
          {!picking && <Button onClick={() => onCopy(selected)}><CopyPlus size={16}/>В кампанию</Button>}
          <Button onClick={() => onCustom(selected)}><Feather size={16}/>{picking ? 'Выбрать и редактировать' : 'Своя версия'}</Button>
          {!picking && <Button onClick={() => onPlace(selected)}><Play size={16}/>На сцену</Button>}
        </div>
      </article> : <Empty>Выберите существо в каталоге.</Empty>}
    </div>
  </section>;
}
