import contract from '../../shared/assets/handout-contract.svg?inline';
import scroll from '../../shared/assets/handout-scroll.svg?inline';
import note from '../../shared/assets/handout-note.svg?inline';
import { useState, type FormEvent } from 'react';
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Eye, Image, Layers, EyeOff, FileText, Folder, Mail, Map, Megaphone, Pin, Plus, Search, ScrollText, Tag, Trash2 } from 'lucide-react';
import { canRead, materialKinds, uid, type Access, type Material, type Role } from '../../entities/model';
import { Back, Button, Empty, IconButton } from '../../shared/ui';

const icons = { letter: Mail, note: FileText, journal: BookOpen, lore: ScrollText };
const accessLabels = { gm: 'Только мастер', all: 'Все игроки', selected: 'Выбранные участники' };
const handoutTemplates = [
  { id: 'blank', title: 'Чистый лист', description: 'Для любой записи', image: undefined, icon: FileText, kind: 'letter', category: 'Документы' },
  { id: 'contract', title: 'Контракт', description: 'Печать и подпись', image: contract, icon: FileText, kind: 'letter', category: 'Документы' },
  { id: 'letter', title: 'Письмо', description: 'Личная или сюжетная переписка', image: undefined, icon: Mail, kind: 'letter', category: 'Документы' },
  { id: 'note', title: 'Записка', description: 'Короткая подсказка', image: note, icon: FileText, kind: 'note', category: 'Документы' },
  { id: 'map', title: 'Карта / схема', description: 'Локация, маршрут или план', image: undefined, icon: Map, kind: 'lore', category: 'Карты и схемы' },
  { id: 'illustration', title: 'Иллюстрация', description: 'Описание существа, предмета или места', image: undefined, icon: Image, kind: 'lore', category: 'Изображения' },
  { id: 'book', title: 'Страница книги', description: 'Лор, справка или выдержка', image: undefined, icon: BookOpen, kind: 'lore', category: 'Книги и записи' },
  { id: 'diary', title: 'Дневник', description: 'Личные записи и хроника', image: undefined, icon: BookOpen, kind: 'journal', category: 'Книги и записи' },
  { id: 'tag', title: 'Ярлык', description: 'Подпись к предмету или контейнеру', image: undefined, icon: Tag, kind: 'note', category: 'Метки и ярлыки' },
  { id: 'scroll', title: 'Свиток', description: 'Заклинание, загадка или запись', image: scroll, icon: ScrollText, kind: 'letter', category: 'Прочее' },
  { id: 'poster', title: 'Объявление', description: 'Розыск или публичное поручение', image: undefined, icon: Megaphone, kind: 'note', category: 'Прочее' },
] as const;
const handoutCategories = [
  { name: 'Все материалы', icon: Layers },
  { name: 'Документы', icon: FileText },
  { name: 'Карты и схемы', icon: Map },
  { name: 'Изображения', icon: Image },
  { name: 'Книги и записи', icon: BookOpen },
  { name: 'Метки и ярлыки', icon: Tag },
  { name: 'Прочее', icon: ScrollText },
] as const;
const legacyCategory: Record<Material['kind'], string> = { letter: 'Документы', note: 'Прочее', journal: 'Книги и записи', lore: 'Книги и записи' };
const chapters = [
  ['all', 'Все'], ['journal', 'Сессии'], ['lore', 'Лор'], ['letter', 'Раздатки'],
] as const;
const participants = ['Элара', 'Бранн', 'Мира'];

function recipientOptions(draft: Material, change: (next: Material) => void) {
  return <div className="inline-form">{participants.map(name => <label className="checkline" key={name}>
    <input type="checkbox" checked={draft.participants.includes(name)} onChange={event => change({
      ...draft,
      participants: event.target.checked ? [...draft.participants, name] : draft.participants.filter(person => person !== name),
    })}/>{name}
  </label>)}</div>;
}

export function Materials({ materials, folders, role, initialId, openBook, onSave, onShow, onDelete, onFolder }: {
  materials: Material[]; folders: string[]; role: Role; initialId?: string; openBook: boolean;
  onSave: (material: Material) => void; onShow: (material: Material) => void;
  onDelete: (id: string) => void; onFolder: (name: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [activeFolder, setActiveFolder] = useState('');
  const [preview, setPreview] = useState(false);
  const [view, setView] = useState<'journal' | 'book'>(openBook ? 'book' : 'journal');
  const [section, setSection] = useState<'home' | 'library' | 'handouts'>(initialId || openBook ? 'library' : 'home');
  const [audienceBefore, setAudienceBefore] = useState<Pick<Material, 'access' | 'participants'>>();
  const [chapter, setChapter] = useState('all');
  const [category, setCategory] = useState<typeof handoutCategories[number]['name']>('Документы');
  const [id, setId] = useState(initialId ?? '');
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState<Material>();
  const [newFolder, setNewFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const gm = role === 'gm' && !preview;
  const visible = materials.filter(material => canRead(material, gm ? 'gm' : 'player'));

  const normalized = search.trim().toLowerCase();
  const filtered = visible.filter(item =>
    (view !== 'book' || chapter === 'all' || item.kind === chapter) &&
    (!activeFolder || item.folder === activeFolder) &&
    `${item.name} ${item.pages.join(' ')}`.toLowerCase().includes(normalized));
  const active = visible.find(item => item.id === id) ?? (view === 'book' ? filtered[0] : undefined);
  const activePage = active && active.id === id ? page : 0;
  const template = handoutTemplates.find(item => item.id === draft?.template);

  function begin(kind: Material['kind'] = 'letter', preset?: Material['template']) {
    setAudienceBefore(undefined);
    setDraft({ id: uid(), name: '', kind, template: preset, folder: activeFolder || folders[0] || 'Без папки', pages: [''], access: 'gm', participants: [], pinned: false, shown: false });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft?.name.trim() || !draft.pages.every(text => text.trim())) return;
    if (draft.access === 'selected' && !draft.participants.length) return;
    onSave({ ...draft, name: draft.name.trim() });
    setId(draft.id);
    if (section === 'handouts') setSection('library');
    setPage(0);
    setDraft(undefined);
  }
  if (section === 'home') return <section className="materials-views" aria-label="Представления материалов">
    <h3>Одна база материалов · несколько представлений</h3>
    <Button className="material-view selected" onClick={() => { setView('journal'); setSection('library'); }}><ScrollText size={18}/><span><strong>Журнал</strong><small>Хронология и ссылки</small></span></Button>
    <Button className="material-view" onClick={() => { setView('book'); setSection('library'); setActiveFolder(''); }}><BookOpen size={18}/><span><strong>Книга</strong><small>Чтение больших записей</small></span></Button>
    <Button className="material-view" onClick={() => { setView('journal'); setSection('handouts'); }}><FileText size={18}/><span><strong>Раздатки</strong><small>Материалы с ограничением получателей</small></span></Button>
  </section>;
  if (!draft && section === 'handouts') {
    const presets = category === 'Все материалы' ? handoutTemplates : handoutTemplates.filter(item => item.category === category);
    const handouts = visible.filter(item => category === 'Все материалы' ||
      (handoutTemplates.find(preset => preset.id === item.template)?.category ?? legacyCategory[item.kind]) === category);
    return <section className="handouts-workspace" aria-label="Раздаточные материалы">
      <nav aria-label="Библиотека раздаток">
        <Back onClick={() => setSection('home')}>Представления</Back>
        <h3>Библиотека</h3>
        {handoutCategories.map(({ name, icon: Icon }) => <Button key={name} aria-pressed={category === name}
          onClick={() => setCategory(name)}><Icon size={16}/>{name}</Button>)}
        <Button onClick={() => { setSection('library'); setView('journal'); }}>Журнал кампании</Button>
      </nav>
      <div className="handouts-main">
        <h2>{gm ? 'Выберите шаблон' : category}</h2>
        {gm && <div className="handout-templates">
          {presets.map(preset => <Button key={preset.id} className="handout-template" onClick={() => begin(preset.kind, preset.id)}>
            <span className={`handout-sample handout-sample-${preset.id}`} aria-hidden="true" style={preset.image ? { backgroundImage: `url("${preset.image}")` } : undefined}>
              <preset.icon size={23}/><b></b><b></b><b></b>
            </span>
            <span><strong>{preset.title}</strong><small>{preset.description}</small></span>
          </Button>)}
        </div>}
        {gm && handouts.length > 0 && <h3 className="handouts-saved">Сохранённые материалы</h3>}
        {handouts.map(item => <Button className="document-row" key={item.id} onClick={() => {
          setId(item.id); setPage(0); setSection('library'); setView('journal');
        }}><FileText size={16}/>{item.name}</Button>)}
        {!gm && handouts.length === 0 && <Empty>Здесь пока нет доступных материалов.</Empty>}
      </div>
      {gm && <aside><h3>Свойства материала</h3><p>Шаблон меняет оформление. Получателей можно выбрать в редакторе.</p>
        <Button className="selected" onClick={() => begin('letter', 'blank')}>Новый материал</Button>
      </aside>}
    </section>;
  }
  if (draft) return <form onSubmit={save} className={`editor ${section === 'handouts' ? 'handout-editor' : ''}`}>
    {template && <div className="handout-editor-preview">
      {template.image ? <img src={template.image} alt=""/> : <span className={`handout-paper-icon handout-paper-${template.id}`} aria-hidden="true"><template.icon size={26}/></span>}<div><h3>Редактор · {template.title}</h3><p>{draft.name || template.description}</p></div>
    </div>}
    <Back onClick={() => { setDraft(undefined); setAudienceBefore(undefined); }}>К материалам</Back>
    <div className="form-grid">
      <label>Название материала<input required maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Например, письмо у северных ворот"/></label>
      <label>Тип материала<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Material['kind'] })}>{Object.entries(materialKinds).map(([kind,label]) => <option value={kind} key={kind}>{label}</option>)}</select></label>
      <label>Папка<select value={draft.folder} onChange={e => setDraft({ ...draft, folder: e.target.value })}>{['Без папки', ...folders].map(folder => <option key={folder}>{folder}</option>)}</select></label>
      {section !== 'handouts' && <label>Доступ<select aria-label="Доступ" value={draft.access} onChange={e => setDraft({ ...draft, access: e.target.value as Access })}>{Object.entries(accessLabels).map(([access,label]) => <option value={access} key={access}>{label}</option>)}</select></label>}
    </div>
    {section === 'handouts' && <div className="handout-audience">
      <strong>Получатели</strong><span>{accessLabels[draft.access]}</span>
      <Button className="selected" aria-expanded={Boolean(audienceBefore)} onClick={() => setAudienceBefore({ access: draft.access, participants: draft.participants })}>Выбрать получателей</Button>
    </div>}
    {section !== 'handouts' && draft.access === 'selected' && recipientOptions(draft, setDraft)}
    {section === 'handouts' && audienceBefore && <div className="handout-audience-layer">
      <section className="handout-audience-dialog" role="dialog" aria-labelledby="handout-audience-title">
        <span className="prototype-status">Получатели материала</span>
        <h2 id="handout-audience-title">Кому доступен материал?</h2>
        <fieldset className="handout-recipient-options">
          <legend>Доступ</legend>
          {Object.entries(accessLabels).map(([access, label]) => <label className="checkline" key={access}>
            <input autoFocus={draft.access === access} type="radio" name="handout-access" checked={draft.access === access}
              onChange={() => setDraft({ ...draft, access: access as Access })}/>{label}
          </label>)}
        </fieldset>
        {draft.access === 'selected' && recipientOptions(draft, setDraft)}
        <footer>
          <Button onClick={() => { setDraft({ ...draft, ...audienceBefore }); setAudienceBefore(undefined); }}>Отмена</Button>
          <Button className="selected" disabled={draft.access === 'selected' && !draft.participants.length}
            onClick={() => setAudienceBefore(undefined)}>Готово</Button>
        </footer>
      </section>
    </div>}
    {draft.pages.map((text, index) => <label key={index}>Текст страницы {index + 1}
      <textarea className={draft.template ? `handout-ink handout-ink-${draft.template}` : undefined} required rows={4} maxLength={2600} value={text} onChange={e => setDraft({ ...draft, pages: draft.pages.map((value, i) => index === i ? e.target.value : value) })}/>
      {draft.pages.length > 1 && <Button className="ghost" onClick={() => setDraft({ ...draft, pages: draft.pages.filter((_, i) => i !== index) })}>Убрать страницу {index + 1}</Button>}
    </label>)}
    <div className="inline-form"><Button onClick={() => setDraft({ ...draft, pages: [...draft.pages, ''] })}><Plus size={15}/>Страница</Button><button type="submit" className="button primary" disabled={draft.access === 'selected' && !draft.participants.length}>Сохранить материал</button></div>
  </form>;
  const tools = <>
    <div className="dialog-tools material-tools">
      <IconButton label="Представления" onClick={() => { setSection('home'); setPreview(false); setId(''); setPage(0); }}><ArrowLeft size={17}/></IconButton>
      <div className="segmented" aria-label="Представление материалов"><Button aria-pressed={view === 'journal'} onClick={() => { setSection('library'); setView('journal'); }}><ScrollText size={15}/>Журнал</Button><Button aria-pressed={view === 'book'} onClick={() => { setSection('library'); setView('book'); setActiveFolder(''); }}><BookOpen size={15}/>Книга</Button></div>
      {role === 'gm' && <IconButton label="Предпросмотр игрока" aria-pressed={preview} onClick={() => { setPreview(value => !value); setDeleting(false); }}><Eye size={17}/></IconButton>}
      {gm && <IconButton label="Папка" onClick={() => setNewFolder(value => !value)}><Folder size={17}/></IconButton>}
      {gm && <IconButton className="primary" label="Новый материал" onClick={() => begin()}><Plus size={17}/></IconButton>}
    </div>
    {newFolder && gm && <form className="inline-form" onSubmit={event => { event.preventDefault(); if (folderName.trim()) { onFolder(folderName.trim()); setFolderName(''); setNewFolder(false); } }}>
      <input placeholder="Название папки" aria-label="Название папки" value={folderName} onChange={e => setFolderName(e.target.value)} required maxLength={55}/><button className="button" type="submit">Создать папку</button>
    </form>}
  </>;
  return <>
    {view !== 'book' && tools}
    <div className={view === 'book' ? 'chronicle-spread' : 'document-layout'}>
      <div className="document-index">
        {view === 'book' && <div className="chronicle-tools">{tools}</div>}
        {view === 'book' && <><div className="chronicle-overline">Глава / Каталог</div><h2>Хроники кампании</h2></>}
        <div className="search-input"><Search size={15}/><input type="search" placeholder="Поиск материалов…" aria-label="Поиск материалов" value={search} onChange={e => setSearch(e.target.value)}/></div>
        {view === 'book' ? <div className="chronicle-chapters" aria-label="Главы книги">{chapters.map(([key, label]) =>
          <Button key={key} aria-pressed={chapter === key} onClick={() => { setChapter(key); setId(''); setPage(0); setDeleting(false); }}>{label}</Button>)}</div>
        : <select aria-label="Папка материалов" value={activeFolder} onChange={e => setActiveFolder(e.target.value)}><option value="">Все папки</option>{(gm ? ['Без папки', ...folders] : [...new Set(visible.map(item => item.folder))]).map(folder => <option key={folder}>{folder}</option>)}</select>}
        {filtered.map(material => {
          const Icon = icons[material.kind];
          return <Button key={material.id} className="document-row" aria-pressed={material.id === active?.id} onClick={() => { setId(material.id); setPage(0); setDeleting(false); }}><Icon size={18}/><span><strong>{material.name}</strong><small>{materialKinds[material.kind]} · {material.folder}</small></span>{material.pinned && gm && <Pin size={12}/>}</Button>;
        })}
        {!filtered.length && <Empty>{search ? 'По этому запросу материалов нет.' : 'В этой папке пока нет доступных материалов.'}</Empty>}
      </div>
      <div className="document-reader">
        {active ? <>
          {gm && <div className="document-actions">
            <span className="badge">{active.shown ? 'Идёт временный показ' : accessLabels[active.access]}</span>
            <Button onClick={() => setDraft(active)}>Редактировать</Button>
            <IconButton label={active.pinned ? 'Открепить от ширмы' : 'Закрепить на ширме'} aria-pressed={active.pinned} onClick={() => onSave({ ...active, pinned: !active.pinned })}><Pin size={15}/></IconButton>
            <Button onClick={() => onShow(active)}>{active.shown ? <EyeOff size={15}/> : <Eye size={15}/>} {active.shown ? 'Завершить показ' : 'Показать игрокам'}</Button>
            <IconButton label="Удалить материал" onClick={() => setDeleting(true)}><Trash2 size={15}/></IconButton>
          </div>}
          {gm && deleting && <div className="confirm"><strong>Удалить «{active.name}»?</strong><Button onClick={() => setDeleting(false)}>Отмена</Button><Button className="danger" onClick={() => { onDelete(active.id); setId(''); setDeleting(false); }}>Удалить</Button></div>}
          <article className={view === 'book' ? 'chronicle-entry' : `paper ${active.kind === 'letter' ? 'paper-letter' : ''} ${active.template ? `paper-template-${active.template}` : ''}`}>
            {view === 'book' && <div className="chronicle-overline">Страница / Подробности</div>}
            {view !== 'book' && <div className="paper-mark">{active.kind === 'letter' ? <Mail size={24} strokeWidth={1.2}/> : <BookOpen size={24} strokeWidth={1.2}/>}</div>}
            <div className="eyebrow">{materialKinds[active.kind]}</div>
            <h3>{active.name}</h3>
            {view !== 'book' && active.template && active.template !== 'blank' && <span className="paper-template-label">{handoutTemplates.find(preset => preset.id === active.template)?.title}</span>}
            <div className={view === 'book' ? 'chronicle-preview' : undefined}>
              {view === 'book' && <div className="chronicle-page-mark" aria-hidden="true"><BookOpen size={36}/><span>Страница хроник</span></div>}
              <div className={`paper-copy ${active.template ? `handout-written handout-ink-${active.template}` : ''}`}>{active.pages[activePage] ?? active.pages[0]}</div>
            </div>
            <footer><IconButton label="Предыдущая страница" disabled={activePage === 0} onClick={() => { setId(active.id); setPage(activePage - 1); }}><ChevronLeft size={17}/></IconButton><span>{activePage + 1} / {active.pages.length}</span><IconButton label="Следующая страница" disabled={activePage >= active.pages.length - 1} onClick={() => { setId(active.id); setPage(activePage + 1); }}><ChevronRight size={17}/></IconButton></footer>
          </article>
        </> : <Empty><BookOpen size={29} strokeWidth={1.2}/><strong>Выберите материал</strong><span>{gm ? 'Здесь откроется письмо, заметка или глава журнала.' : 'Здесь появятся материалы, которыми поделился мастер.'}</span></Empty>}
      </div>
    </div>
  </>;
}
