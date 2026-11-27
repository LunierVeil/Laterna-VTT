import { useRef, useState } from 'react';
import { controlsActor, emptyScene, participant, playerHeroId, uid, type Actor, type Campaign, type Combat, type CombatParticipant, type Entry, type MapObject, type Material, type Role, type Scene } from '../../entities/model';
import { demoCampaigns, demoEntries } from '../mock/demo';

export function usePrototype() {
  const [campaigns, setCampaigns] = useState(demoCampaigns);
  const [campaignId, setCampaignId] = useState('graywick');
  const [entered, setEntered] = useState(false);
  const [role, setRole] = useState<Role>('gm');
  const [entries, setEntries] = useState<Record<string, Entry[]>>({ graywick: demoEntries });
  const [battles, setBattles] = useState<Record<string, Combat | undefined>>({});
  const [undoHistory, setUndoHistory] = useState<Record<string, MapObject[][]>>({});
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<number>();

  const campaign = campaigns.find(item => item.id === campaignId) ?? campaigns[0];
  const scene = campaign.scenes.find(item => item.id === (role === 'gm' ? campaign.gmScene ?? campaign.activeScene : campaign.activeScene)) ?? campaign.scenes[0];
  const scope = `${campaign.id}/${scene.id}`;
  const battle = battles[scope];

  function notify(message: string) {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 3200);
  }

  function updateCampaign(update: (current: Campaign) => Campaign) {
    setCampaigns(items => items.map(item => item.id === campaign.id ? update(item) : item));
  }

  function createCampaign(name: string) {
    const starter = emptyScene('Первая сцена', 'Без папки', 'woods');
    const next: Campaign = {
      id: uid(), name, subtitle: 'Новая кампания', activeScene: starter.id, scenes: [starter],
      actors: [], materials: [], assets: demoCampaigns[0].assets, sceneFolders: [], materialFolders: [], assetFolders: ['Стартовый набор'],
    };
    setCampaigns(items => [...items, next]);
    setCampaignId(next.id);
    notify('Кампания создана');
  }

  function selectCampaignScene(id: string, sceneId: string) {
    setCampaigns(items => items.map(item => item.id === id && item.scenes.some(scene => scene.id === sceneId)
      ? { ...item, activeScene: sceneId, gmScene: sceneId } : item));
  }

  function openCampaign(id: string) {
    setCampaignId(id);
    setRole('gm');
    setEntered(true);
  }

  function writeScene(next: Scene, activate = false) {
    updateCampaign(item => ({
      ...item,
      gmScene: activate ? next.id : item.gmScene ?? item.activeScene,
      scenes: item.scenes.some(s => s.id === next.id)
        ? item.scenes.map(s => s.id === next.id ? next : s)
        : [...item.scenes, next],
    }));
  }

  function removeScene(id: string) {
    updateCampaign(item => {
      if (item.scenes.length < 2) return item;
      const remaining = item.scenes.filter(s => s.id !== id);
      return { ...item, scenes: remaining, gmScene: item.gmScene === id ? remaining[0].id : item.gmScene, activeScene: item.activeScene === id ? remaining[0].id : item.activeScene };
    });
    notify('Сцена удалена');
  }

  function changeObjects(objects: MapObject[]) {
    setUndoHistory(history => ({ ...history, [scope]: [...(history[scope] ?? []).slice(-19), scene.objects] }));
    writeScene({ ...scene, objects });
  }

  function undo() {
    const history = undoHistory[scope] ?? [];
    const previous = history.at(-1);
    if (!previous) return;
    setUndoHistory(items => ({ ...items, [scope]: history.slice(0, -1) }));
    writeScene({ ...scene, objects: previous });
    notify('Последнее изменение карты отменено');
  }

  function append(entry: Omit<Entry, 'id'>) {
    setEntries(current => ({ ...current, [campaign.id]: [...(current[campaign.id] ?? []), { ...entry, id: uid() }] }));
  }

  function event(text: string) { append({ author: 'Стол', kind: 'event', text }); }

  function sendChat(text: string) {
    const message = text.trim();
    const formula = /^(?:(\d{1,2})?d(4|6|8|10|12|20|100))\s*([+-]\s*\d{1,3})?$/i.exec(message);
    if (formula) {
      const count = Number(formula[1] ?? 1);
      if (count < 1 || count > 20) { notify('Можно бросить от 1 до 20 кубиков за раз'); return; }
      const sides = Number(formula[2]);
      const bonus = Number((formula[3] ?? '0').replace(/\s/g, ''));
      const dice = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
      append({ author: role === 'gm' ? 'Мастер' : participant, kind: 'roll', text: message,
        value: dice.reduce((sum, die) => sum + die, bonus), roll: { sides, dice, bonus, mode: 'normal' } });
      return;
    }
    if (message) append({ author: role === 'gm' ? 'Мастер' : participant, kind: 'chat', text: message });
  }

  function rollPool(groups: Record<number, number>, bonus: number, secret: boolean, formula: string) {
    const dice = Object.entries(groups).flatMap(([face, count]) =>
      Array.from({ length: count }, () => 1 + Math.floor(Math.random() * Number(face))));
    const value = dice.reduce((total, die) => total + die, bonus);
    append({ author: role === 'gm' ? 'Мастер' : participant, kind: 'roll', text: formula, value,
      secret: role === 'gm' && secret, roll: { sides: 0, dice, bonus, mode: 'normal' } });
    return value;
  }

  function roll(sides: number, mode: 'normal' | 'advantage' | 'disadvantage', secret: boolean, bonus = 0, label = '') {
    const die = () => 1 + Math.floor(Math.random() * sides);
    const first = die();
    const second = mode === 'normal' ? first : die();
    const value = (mode === 'advantage' ? Math.max(first, second) : Math.min(first, second)) + bonus;
    const notation = mode === 'normal' ? `1d${sides}` : `2d${sides}${mode === 'advantage' ? 'kh1' : 'kl1'} [${first}, ${second}]`;
    append({ author: role === 'gm' ? 'Мастер' : participant, kind: 'roll', text: [label, notation + (bonus ? ` + ${bonus}` : '')].filter(Boolean).join(' · '), value, roll: { sides, dice: mode === 'normal' ? [first] : [first, second], bonus, mode }, secret: role === 'gm' && secret });
    return value;
  }

  function saveMaterial(material: Material) {
    updateCampaign(item => ({
      ...item,
      materials: item.materials.some(m => m.id === material.id)
        ? item.materials.map(m => m.id === material.id ? material : m)
        : [...item.materials, material],
    }));
  }

  function showMaterial(material: Material) {
    saveMaterial({ ...material, shown: !material.shown });
    event(material.shown ? 'Временный показ материала завершён.' : 'Мастер временно открыл доступ к материалу.');
    notify(material.shown ? 'Показ завершён' : 'Материал появился в журнале игрока');
  }

  function saveActor(actor: Actor) {
    updateCampaign(item => ({
      ...item,
      actors: item.actors.some(a => a.id === actor.id) ? item.actors.map(a => a.id === actor.id ? actor : a) : [...item.actors, actor],
      scenes: item.scenes.map(s => ({ ...s, objects: s.objects.map(o => o.actorId === actor.id ? { ...o, name: actor.name } : o) })),
    }));
  }

  function removeActor(id: string) {
    if (role !== 'gm' && !controlsActor(campaign.actors.find(actor => actor.id === id), playerHeroId(campaign))) return;
    updateCampaign(current => ({
      ...current,
      actors: current.actors.filter(actor => actor.id !== id),
      scenes: current.scenes.map(item => ({ ...item, objects: item.objects.filter(object => object.actorId !== id) })),
    }));
    setUndoHistory(current => Object.fromEntries(Object.entries(current).map(([key, snapshots]) =>
      [key, key.startsWith(`${campaign.id}/`) ? snapshots.map(objects => objects.filter(object => object.actorId !== id)) : snapshots])));
    setBattles(current => Object.fromEntries(Object.entries(current).map(([key, item]) => {
      if (!item || !key.startsWith(`${campaign.id}/`) || !item.order.includes(id)) return [key, item];
      const order = item.order.filter(actorId => actorId !== id);
      const active = item.order[item.turn];
      const turn = active === id ? item.turn < order.length ? item.turn : 0 : order.indexOf(active);
      return [key, order.length ? { ...item, order, turn } : undefined];
    })));
    notify('Персонаж удалён из кампании');
  }

  function configureCombat(participants: CombatParticipant[]) {
    if (role !== 'gm') return;
    const roster = new Set(campaign.actors.map(actor => actor.id));
    const eligible = new Map(participants.filter(item => roster.has(item.id) && Number.isInteger(item.initiative))
      .map(item => [item.id, item.initiative]));
    if (!eligible.size) { notify('Выберите хотя бы одного участника боя'); return; }
    const order = [...eligible.keys()].sort((a, b) => (eligible.get(b) ?? 0) - (eligible.get(a) ?? 0));
    const initiative = Object.fromEntries(eligible);
    setBattles(items => {
      const current = items[scope];
      const previousOrder = current ? [...current.order.slice(current.turn), ...current.order.slice(0, current.turn)] : [];
      const active = previousOrder.find(id => eligible.has(id));
      return { ...items, [scope]: { order, initiative, turn: active ? order.indexOf(active) : 0, round: current?.round ?? 1 } };
    });
    if (!battle) event('Бой начался. Раунд 1.');
  }

  function startCombat() {
    const present = new Set(scene.objects.flatMap(object => object.actorId ? [object.actorId] : []));
    const participants = campaign.actors.filter(actor => present.has(actor.id));
    if (!participants.length) { notify('Добавьте персонажа или существо на сцену'); return; }
    configureCombat(participants.map(actor => ({ id: actor.id, initiative: actor.init })));
  }

  function nextTurn() {
    if (!battle || (role === 'player' && battle.order[battle.turn] !== playerHeroId(campaign))) return;
    const turn = (battle.turn + 1) % battle.order.length;
    const round = battle.round + (turn === 0 ? 1 : 0);
    setBattles(items => ({ ...items, [scope]: { ...battle, turn, round } }));
    const incoming = campaign.actors.find(actor => actor.id === battle.order[turn]);
    if (incoming?.bonusUsed || incoming?.reactionUsed) {
      saveActor({ ...incoming, bonusUsed: false, reactionUsed: false });
    }
    if (turn === 0) event(`Начался раунд ${round}.`);
  }

  function endCombat() {
    if (role !== 'gm') return;
    setBattles(items => ({ ...items, [scope]: undefined }));
    event('Бой завершён.');
  }

  return {
    campaigns, campaign, scene, entered, setEntered, role, setRole, campaignId, setCampaignId,
    notice, notify, openCampaign, selectCampaignScene, createCampaign, updateCampaign, writeScene, removeScene,
    changeObjects, undo, canUndo: Boolean(undoHistory[scope]?.length),
    entries: (entries[campaign.id] ?? []).filter(entry => role === 'gm' || !entry.secret),
    sendChat, roll, rollPool, event, saveMaterial, showMaterial, saveActor, removeActor, battle, startCombat, configureCombat, nextTurn, endCombat,
  };
}
