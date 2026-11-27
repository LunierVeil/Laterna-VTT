import type { ReviewCase } from '../../pages/review/Review';
import type { Campaign, DecalPattern, Entry, MapObject } from '../../entities/model';
import { decalNames } from '../../shared/map-art/DecalMark';

export function reviewCampaigns(review: ReviewCase | undefined, campaigns: Campaign[]) {
  const sheets = review === 'overflow-sheet' || review === 'hp-hud';
  const quickActions = review?.startsWith('quick-actions');
  if (!sheets && review !== 'decal-patterns' && !quickActions) return campaigns;
  return campaigns.map(campaign => {
    if (campaign.id !== 'graywick') return campaign;
    if (quickActions) return { ...campaign, actors: campaign.actors.map(actor => {
      if (actor.id !== 'elara') return actor;
      if (review === 'quick-actions-empty') return { ...actor, quickActions: [], resource: 0 };
      return { ...actor,
        quickActions: ['attack:Длинный лук · +5 к атаке', 'spell:cure-wounds', 'skill:Внимательность', 'save:1', 'bonus:Метка охотника', 'resource'],
        spells: [{id:'cure-wounds',name:'Лечение ран',level:1,prepared:true,equipped:true,
          description:'Элара восстанавливает хиты союзника касанием.'}],
        spellSlots: {1:{current:2,max:3}},
      };
    }) };
    if (review === 'decal-patterns') {
      const decals: MapObject[] = (Object.keys(decalNames) as DecalPattern['kind'][]).map((kind, i) => ({
        kind:'prop', id:'review-decal-' + kind, name:decalNames[kind], x:280 + i*125, y:485,
        decal:{kind, size:108, rotation:i*19, variant:i+3},
      }));
      return {...campaign, scenes:campaign.scenes.map(scene => scene.id === 'abbey'
        ? {...scene, objects:[...scene.objects, ...decals]} : scene)};
    }
    return {...campaign, actors:campaign.actors.map(actor => actor.id === 'elara' ? {
      ...actor, ...(review === 'overflow-sheet' && { name:'Элара Вейл, хранительница переправы и последняя следопытка Семи Фонарей' }), tempHp:3,
      items: [actor.items, ...Array.from({length:22}, (_,i) => 'Полевой припас для дальней экспедиции ' + (i+1))].join('\n'),
      notes: actor.notes + '\n\nНестандартная карточка · памятка о печати ордена',
      spells: Array.from({length:16}, (_,i) => ({
        id:'review-spell-' + i, name:'Демонстрационное заклинание странников Семи Фонарей ' + (i+1), level:i%3,
        description:'Заметки проводницы о ритуале в аббатстве.', equipped:i<2, prepared:i<4,
      })),
    } : actor)};
  });
}

type Sample = NonNullable<Entry['roll']> & { label: string; secret?: boolean };
export function sampleRolls(id: string): Sample[] {
  const normal = (sides: number, dice: number[], label = 'Бросок d' + sides, bonus = 0): Sample =>
    ({sides, dice, label, bonus, mode:'normal'});
  const samples: Record<string, Sample[]> = {
    advantage:[{...normal(20,[7,18],'Атака с преимуществом',3), mode:'advantage',critical:true}],
    disadvantage:[{...normal(20,[16,3],'Атака с помехой',-1), mode:'disadvantage',critical:true}],
    'critical-1':[{...normal(20,[1],'Атака · критический промах',4),critical:true}],
    'critical-20':[{...normal(20,[20],'Атака · критическое попадание',4),critical:true}],
    secret:[{...normal(20,[14],'Скрытая проверка',2),secret:true}],
    mixed:[{...normal(0,[2,4,11],'1d4 + 1d6 + 1d12 − 2',-2),faces:[4,6,12]}],
    queue:[normal(4,[3]),normal(12,[8]),normal(100,[76])],
  };
  const sides = Number(id.slice(1));
  return samples[id] ?? ([4,6,8,10,12,20,100].includes(sides) ? [normal(sides,[Math.round(sides*.7)],undefined,2)] : []);
}
