import { useState } from 'react';
import { ArrowRight, Layers3, LockKeyhole, Plus, Users } from 'lucide-react';
import type { Campaign } from '../../entities/model';
import { MapThumbnail } from '../../shared/map-art';
import { Button, Dialog, Lantern } from '../../shared/ui';

export function Campaigns({ campaigns, selected, onSelect, onOpen, onCreate, onScene }: {
  campaigns: Campaign[]; selected: string; onSelect: (id: string) => void; onOpen: (id: string) => void; onCreate: (name: string) => void; onScene: (campaignId: string, sceneId: string) => void;
}) {
  const [create, setCreate] = useState(false);
  const [name, setName] = useState('');
  const campaign = campaigns.find(item => item.id === selected) ?? campaigns[0];
  return <main className="campaign-page">
    <div className="campaign-backdrop"><MapThumbnail art="abbey"/></div>
    <header className="entry-header"><div className="brand"><Lantern size={52} full/><div><strong>Laterna</strong><span>VIRTUAL TABLETOP</span></div></div><div className="badge"><span className="status-dot"/> BETA 0.5 · ПРОТОТИП</div></header>
    <div className="campaign-main">
      <div className="campaign-intro">
        <div className="eyebrow"><span className="ornament"/> КОМНАТА КАМПАНИЙ</div>
        <h1>Ваши кампании</h1>
        <p>Выберите историю и откройте стол. В демонстрационной партии можно подготовить сцену и посмотреть на неё глазами игрока.</p>
      </div>
      <div className="campaign-list">
        {campaigns.map(item => <button type="button" className="campaign-card" aria-pressed={item.id === campaign.id} key={item.id} onClick={() => onSelect(item.id)} onDoubleClick={() => onOpen(item.id)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onOpen(item.id); } }}>
          <div className="campaign-cover"><MapThumbnail art={item.scenes.find(scene => scene.id === item.activeScene)?.art ?? 'woods'}/><span className={`badge ${item.id === campaign.id ? 'live' : ''}`}>{item.id === campaign.id ? 'Выбрана' : 'Кампания'}</span></div>
          <div className="campaign-card-copy"><span className="eyebrow">{item.subtitle}</span><h2>{item.name}</h2>
            <div className="inline-form micro"><span><Layers3 size={14}/> Сцены · {item.scenes.length}</span><span><Users size={14}/> Герои · {item.actors.filter(a => a.kind === 'hero').length}</span></div></div>
        </button>)}
        <button type="button" className="campaign-create" onClick={() => setCreate(true)}><Plus size={25}/><strong>Новая кампания</strong></button>
      </div>
      <section className="campaign-overview" aria-label="Сводка выбранной кампании">
        <header className="campaign-overview-header">
          <div><p className="micro">Кампания · вы ГМ</p><h2>{campaign.name}</h2></div>
          <Button className="primary" onClick={() => onOpen(campaign.id)}>Открыть игровой стол<ArrowRight size={18}/></Button>
        </header>
        <div className="campaign-overview-grid">
          <section><h3>Сцены</h3><div className="campaign-scene-list">
            {campaign.scenes.map(scene => <div className="campaign-scene-row" key={scene.id}>
              <Layers3 size={16}/><strong>{scene.name}</strong>
              {scene.id === campaign.activeScene ? <span className="badge live">Видят игроки</span>
                : <Button onClick={() => onScene(campaign.id, scene.id)}>Показать игрокам</Button>}
            </div>)}
          </div></section>
          <section><h3>Партия</h3><div className="campaign-scene-list">
            {campaign.actors.filter(actor => actor.kind === 'hero').map(actor =>
              <div className="campaign-scene-row" key={actor.id}><Users size={16}/><strong>{actor.name}</strong>
                <small>{actor.progression && `${actor.progression.className} ${actor.progression.level}`}</small></div>)}
            {!campaign.actors.some(actor => actor.kind === 'hero') && <p className="micro">Героев пока нет.</p>}
          </div></section>
        </div>
        <p className="micro"><LockKeyhole size={14}/> Состояние хранится в текущей вкладке</p>
      </section>
    </div>
    {create && <Dialog title="Новая кампания" eyebrow="КОМНАТА КАМПАНИЙ" onClose={() => setCreate(false)}>
      <form className="editor" onSubmit={e => { e.preventDefault(); if (name.trim()) { onCreate(name.trim()); setName(''); setCreate(false); } }}><label>Название кампании<input required maxLength={80} value={name} onChange={e => setName(e.target.value)}/></label><button type="submit" className="button primary">Создать кампанию</button></form>
    </Dialog>}
  </main>;
}
