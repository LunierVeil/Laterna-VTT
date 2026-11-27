import { useState } from 'react';
import { Check, CircleHelp, Copy, Database, Link, Network, Shield, Users } from 'lucide-react';
import { defaultSettings, type Campaign, type DemoSettings } from '../../entities/model';
import { Button, Empty, Section } from '../../shared/ui';

const sections = ['Кампания', 'Участники', 'Подключение', 'Хранение и копии', 'Интерфейс'] as const;
export function CampaignSettings({ campaign, initial = 'Кампания', onSave, onNotify, onExit, reduceMotion, onMotion, onSettings }: {
  campaign: Campaign; initial?: typeof sections[number]; onSave: (name: string, subtitle: string) => void;
  onSettings: (settings: DemoSettings) => void;
  onNotify: (text: string) => void; onExit: () => void; reduceMotion: boolean; onMotion: (value: boolean) => void;
}) {
  const [tab, setTab] = useState(initial);
  const [name, setName] = useState(campaign.name);
  const [subtitle, setSubtitle] = useState(campaign.subtitle);
  const settings = campaign.demoSettings ?? defaultSettings;
  const { connection, connected, storage, automaticBackups, backups } = settings;
  const [invite, setInvite] = useState('');
  const [player, setPlayer] = useState('Элара');
  const [restore, setRestore] = useState('');
  const [verify, setVerify] = useState(false);
  return <>
    <div className="segmented settings-tabs">{sections.map(section => <Button aria-pressed={section === tab} key={section} onClick={() => setTab(section)}>{section}</Button>)}</div>
    {tab === 'Кампания' && <form className="editor" onSubmit={e => { e.preventDefault(); if (name.trim()) onSave(name.trim(), subtitle.trim()); }}>
      <label>Название кампании<input required value={name} maxLength={80} onChange={e => setName(e.target.value)}/></label>
      <label>Подзаголовок<input value={subtitle} maxLength={110} onChange={e => setSubtitle(e.target.value)}/></label>
      <div className="inline-form"><button className="button primary" type="submit">Сохранить настройки</button><Button onClick={onExit}>К выбору кампании</Button></div>
    </form>}
    {tab === 'Участники' && <div className="editor">
      <Section label="Участники демонстрационной партии">
        {['Мастер', 'Элара', 'Бранн', 'Мира'].map((person,i) => <div className="settings-row" key={person}><Users size={16}/><strong>{person}</strong><span className="badge">{i ? 'Игрок' : 'Мастер'}</span><span className={i < 2 ? 'green-text' : 'muted'}>{i < 2 ? 'За столом' : 'Не в сети'}</span></div>)}
      </Section>
      <Section label="Приглашения"><div className="inline-form"><select aria-label="Участник для приглашения" value={player} onChange={e => setPlayer(e.target.value)}>{['Элара','Бранн','Мира'].map(person => <option key={person}>{person}</option>)}</select>
        <Button className="primary" onClick={() => setInvite(`laterna://demo/${campaign.id}/${encodeURIComponent(player)}`)}><Link size={15}/>Создать приглашение</Button></div>
      {invite && <div className="inline-form"><input aria-label="Демонстрационная ссылка" readOnly value={invite} onFocus={e => e.target.select()}/>
        <Button onClick={async () => {
          try { await navigator.clipboard.writeText(invite); onNotify('Демонстрационная ссылка скопирована'); }
          catch { onNotify('Выделите ссылку и скопируйте её вручную'); }
        }}><Copy size={15}/>Копировать</Button></div>}</Section>
    </div>}
    {tab === 'Подключение' && <div className="editor">
      <Section label="Способ подключения"><div className="segmented">{(['LAN','Porthole'] as const).map(mode => <Button key={mode} aria-pressed={mode === connection} onClick={() => { onSettings({ ...settings, connection: mode, connected: false }); }}><Network size={15}/>{mode}</Button>)}</div></Section>
      <p className="lede">{connection === 'LAN' ? 'Локальная партия для устройств в одной сети.' : 'Сценарий удалённого подключения через Steam Porthole.'}</p>
      <label>Адрес для игроков<input readOnly value={connection === 'LAN' ? 'http://192.168.1.20:8000' : 'laterna-demo.porthole.invalid'}/></label>
      <div className="inline-form"><span className={`badge ${connected ? 'live' : ''}`}>{connected ? 'Демонстрационное подключение активно' : 'Отключено'}</span><Button className="primary" onClick={() => onSettings({ ...settings, connected: !connected })}>{connected ? 'Отключить' : 'Проверить подключение'}</Button></div>
    </div>}
    {tab === 'Хранение и копии' && <div className="editor">
      <Section label="Папка данных Laterna"><label>Режим хранения<select value={storage} onChange={e => onSettings({ ...settings, storage: e.target.value as DemoSettings['storage'] })}><option value="local">Профиль пользователя</option><option value="portable">Portable</option></select></label>
        <div className="settings-row"><Database size={16}/><code>{storage === 'local' ? '%LOCALAPPDATA%\\LaternaVTT' : './LaternaVTT-data'}</code></div></Section>
      <label className="checkline"><input type="checkbox" checked={automaticBackups} onChange={e => onSettings({ ...settings, automaticBackups: e.target.checked })}/>Автоматические резервные копии</label>
      <Section label="Резервные копии экземпляра"><div className="inline-form"><Button className="primary" onClick={() => { onSettings({ ...settings, backups: [`Ручная копия №${backups.length}`, ...backups] }); onNotify('Демонстрационная резервная копия создана'); }}>Создать копию</Button></div>
        {backups.map(backup => <div className="settings-row" key={backup}><Shield size={16}/><strong>{backup}</strong><Button onClick={() => { setRestore(backup); setVerify(false); }}>Восстановление</Button></div>)}
      </Section>
      {restore && <div className="confirm restore"><strong>Восстановление из «{restore}»</strong>
        {verify ? <><span className="green-text"><Check size={14}/> Образец прошёл проверку</span><Button className="danger" onClick={() => { setRestore(''); onNotify('Сценарий восстановления завершён'); }}>Подтвердить восстановление</Button></> : <Button onClick={() => setVerify(true)}>Проверить копию</Button>}
        <Button onClick={() => setRestore('')}>Отмена</Button></div>}
    </div>}
    {tab === 'Интерфейс' && <div className="editor"><label className="checkline"><input type="checkbox" checked={reduceMotion} onChange={e => onMotion(e.target.checked)}/>Уменьшить анимации</label>
      <label className="checkline"><input type="checkbox" checked={Boolean(settings.showAllyHp)}
        onChange={event => onSettings({ ...settings, showAllyHp: event.target.checked })}/>Игроки видят числа HP союзников</label>
      <Empty><CircleHelp size={22}/><span>V — выбор, H — рука, R — линейка, Esc — отмена размещения. Прокрутка меняет масштаб, средняя кнопка перемещает карту.</span></Empty>
    </div>}
  </>;
}
