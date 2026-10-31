// Enhetstester för lagens ordning i poängräkningen (src/utils/teamOrder.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTeamOrder, sameTeams, sortedTeamIds } from '../src/utils/teamOrder.ts';

const teams = [{ id: 'a', score: 2 }, { id: 'b', score: 5 }, { id: 'c', score: 2 }];

test('sorteras efter poäng, lika poäng behåller ordningen', () => {
  assert.deepEqual(sortedTeamIds(teams), ['b', 'a', 'c']);
});

test('visad ordning gäller tills den byts, även om poängen ändrats', () => {
  const order = ['b', 'a', 'c'];
  const afterTap = [{ id: 'a', score: 2 }, { id: 'b', score: 5 }, { id: 'c', score: 9 }];
  assert.deepEqual(applyTeamOrder(afterTap, order).map(t => t.id), ['b', 'a', 'c']);
  assert.deepEqual(sortedTeamIds(afterTap), ['c', 'b', 'a']);
});

test('nytt lag hamnar sist och räknas som ändrade lag', () => {
  const withNew = [...teams, { id: 'd', score: 0 }];
  assert.equal(sameTeams(['b', 'a', 'c'], withNew), false);
  assert.equal(sameTeams(['c', 'a', 'b'], teams), true);
  assert.deepEqual(applyTeamOrder(withNew, ['b', 'a', 'c']).map(t => t.id), ['b', 'a', 'c', 'd']);
});
