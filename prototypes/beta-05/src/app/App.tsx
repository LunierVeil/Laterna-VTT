import { readReview, ReviewIndex } from '../pages/review/Review';
import { Check } from 'lucide-react';
import { Campaigns } from '../pages/campaigns/Campaigns';
import { Table } from '../pages/table/Table';
import { srdActors } from './mock/demo';
import { usePrototype } from './model/usePrototype';

export function App() {
  const route = readReview();
  const review = route === '1' ? undefined : route;
  const demo = usePrototype(review, new URLSearchParams(location.search).get('play') === '1');
  if (route === '1') return <ReviewIndex/>;
  return <>
    {demo.entered ? <Table key={demo.campaign.id} campaign={demo.campaign} scene={demo.scene} role={demo.role} setRole={demo.setRole}
      entries={demo.entries} battle={demo.battle} srd={srdActors} canUndo={demo.canUndo}
      commands={demo} review={review} onExit={() => demo.setEntered(false)}/>
      : <Campaigns campaigns={demo.campaigns} selected={demo.campaignId} onSelect={demo.setCampaignId} onOpen={demo.openCampaign} onCreate={demo.createCampaign} onScene={demo.selectCampaignScene}/>}
    <div className="notice-region" aria-live="polite">{demo.notice && <div className="notice"><Check size={18}/>{demo.notice}</div>}</div>
  </>;
}
