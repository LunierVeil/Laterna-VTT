import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diceFormula, displayDice, DICE_SIDES, MAX_MENU_DICE} from '../src/ui/diceDisplay.ts';

test('dice menu formulas use all seven server dice and signed modifiers',()=>{
  assert.equal(MAX_MENU_DICE,100);
  for(const s of DICE_SIDES){assert.equal(diceFormula(s,2,-3),`2d${s}-3`);assert.equal(diceFormula(s,1,5),`1d${s}+5`);}
  assert.equal(diceFormula(20,1,0),'1d20+0');
});
test('visual dice preserve individual server values, duplicate kept rolls and negative terms',()=>{
  const roll={formula:'4d6kh3-1d4+3',total:9,terms:[
    {text:'4d6kh3',sign:1,kind:'dice' as const,rolls:[2,6,1,1],kept:[6,2,1],value:9},
    {text:'1d4',sign:-1,kind:'dice' as const,rolls:[3],kept:[3],value:3},
    {text:'3',sign:1,kind:'flat' as const,rolls:[],kept:[],value:3}
  ]};
  const v=displayDice(roll);assert.deepEqual(v.dice.map(d=>d.value),[2,6,1,1,3]);
  assert.deepEqual(v.dice.map(d=>d.dropped),[false,false,false,true,false]);assert.equal(v.dice[4].negative,true);
  assert.equal(roll.total,9);
});
test('large rolls cap sprites, not the server result or history',()=>{
  const roll={formula:'100d100',total:10000,terms:[{text:'100d100',sign:1,kind:'dice' as const,rolls:Array(100).fill(100),kept:Array(100).fill(100),value:10000}]};
  const v=displayDice(roll);assert.equal(v.dice.length,12);assert.equal(v.remaining,88);assert.equal(roll.terms[0].rolls.length,100);
});
