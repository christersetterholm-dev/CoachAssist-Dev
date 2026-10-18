// Enhetstester för taktiktavlans animationer (src/utils/boardAnimation.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAnimation, insertFrameAfter, removeFrame, moveFrame, frameAt, playbackPosition,
  trailsUpTo, easeInOut, stepDurationMs, MAX_FRAMES, NOTE_MAX_LENGTH,
  normalizePlaybackRate, nextPlaybackRate, playbackRateLabel, scaledStepMs,
  normalizeBalls, firstBallPos, MAX_BALLS,
} from '../src/utils/boardAnimation.ts';

const frame = (id, players, extra = {}) => ({
  id, players, opponents: [], footballPos: null, drawings: [], note: '', ...extra,
});

test('tavlor utan steg ger ingen animation', () => {
  assert.equal(normalizeAnimation(undefined), null);
  assert.equal(normalizeAnimation({}), null);
  assert.equal(normalizeAnimation({ frames: [] }), null);
});

test('normalizeAnimation tvättar trasiga steg och sätter standardvärden', () => {
  const a = normalizeAnimation({
    frames: [
      { id: 'a', players: [{ id: 1, x: '5', y: 10, customName: 'Nia' }, null], opponents: 'fel', footballPos: { x: 3 } },
      null,
      { note: 'x'.repeat(500) },
    ],
  });
  assert.equal(a.frames.length, 2);
  assert.equal(a.speed, 'normal');
  assert.equal(a.showTrails, true);
  assert.equal(a.current, 0);
  assert.equal(normalizeAnimation({ frames: [{}, {}], current: 7 }).current, 1, 'valt steg hålls inom stegen');
  assert.deepEqual(a.frames[0].players, [{ id: '1', x: 50, y: 10, customName: 'Nia' }]);
  assert.deepEqual(a.frames[0].opponents, []);
  assert.deepEqual(a.frames[0].footballPos, { x: 3, y: 50 });
  assert.deepEqual(a.frames[0].footballs, [{ id: 'ball-1', x: 3, y: 50 }], 'gamla steg med en boll får en bollista');
  assert.deepEqual(a.frames[1].footballs, []);
  assert.ok(a.frames[1].id, 'steg utan id får ett');
  assert.equal(a.frames[1].note.length, NOTE_MAX_LENGTH);
  const many = normalizeAnimation({ frames: Array.from({ length: 50 }, (_, i) => ({ id: `f${i}` })) });
  assert.equal(many.frames.length, MAX_FRAMES);
});

test('nytt steg kopierar föregående utan text och utan delade objekt', () => {
  const frames = [frame('a', [{ id: 'p', x: 10, y: 10 }], { note: 'Start', drawings: [{ id: 'd', type: 'arrow' }] })];
  const r = insertFrameAfter(frames, 0);
  assert.equal(r.frames.length, 2);
  assert.equal(r.index, 1);
  assert.notEqual(r.frames[1].id, 'a');
  assert.equal(r.frames[1].note, '');
  assert.deepEqual(r.frames[1].players, frames[0].players);
  r.frames[1].players[0].x = 99;
  r.frames[1].drawings[0].type = 'line';
  assert.equal(frames[0].players[0].x, 10, 'originalet ändras inte');
  assert.equal(frames[0].drawings[0].type, 'arrow');
});

test('insert stannar vid maxantalet, och sista steget kan inte tas bort', () => {
  const full = Array.from({ length: MAX_FRAMES }, (_, i) => frame(`f${i}`, []));
  assert.equal(insertFrameAfter(full, 3).frames.length, MAX_FRAMES);
  const one = [frame('a', [])];
  assert.equal(removeFrame(one, 0).frames.length, 1);
  const three = [frame('a', []), frame('b', []), frame('c', [])];
  const r = removeFrame(three, 2);
  assert.deepEqual(r.frames.map(f => f.id), ['a', 'b']);
  assert.equal(r.index, 1);
  assert.deepEqual(moveFrame(three, 0, 2).map(f => f.id), ['b', 'c', 'a']);
});

test('frameAt glider mellan stegen och tonar in/ut spelare', () => {
  const frames = [
    frame('a', [{ id: 'p', x: 0, y: 0 }, { id: 'ut', x: 50, y: 50 }], { footballPos: { x: 0, y: 0 }, note: 'Ett', drawings: ['pil1'] }),
    frame('b', [{ id: 'p', x: 100, y: 50 }, { id: 'in', x: 20, y: 20 }], { footballPos: { x: 100, y: 100 }, note: 'Två', drawings: ['pil2'] }),
  ];
  const start = frameAt(frames, 0, 0);
  assert.deepEqual(start.players.find(p => p.id === 'p'), { id: 'p', x: 0, y: 0, opacity: 1 });
  assert.equal(start.players.some(p => p.id === 'in'), false, 'en spelare som kommer in syns inte från början');
  assert.equal(start.note, 'Ett');
  assert.deepEqual(start.drawings, ['pil1']);

  const mid = frameAt(frames, 0, 0.5);
  const p = mid.players.find(t => t.id === 'p');
  assert.equal(p.x, 50);
  assert.equal(p.y, 25);
  assert.deepEqual(mid.footballs, [{ id: 'ball-1', x: 50, y: 50, opacity: 1 }], 'gamla steg med bara footballPos glider också');
  assert.equal(mid.players.find(t => t.id === 'in').opacity, 0.5);
  assert.equal(mid.players.find(t => t.id === 'ut').opacity, 0.5);
  assert.deepEqual(mid.drawings, ['pil1'], 'ritningarna byts först när spelarna är framme');

  const end = frameAt(frames, 0, 1);
  assert.equal(end.players.some(t => t.id === 'ut'), false);
  assert.equal(end.note, 'Två');
  assert.deepEqual(end.drawings, ['pil2']);

  const last = frameAt(frames, 1, 0);
  assert.equal(last.fromIndex, 1);
  assert.equal(last.progress, 1, 'sista steget står still');
});

test('en boll som bara finns i ett av stegen tonas in', () => {
  const frames = [frame('a', [], { footballPos: null }), frame('b', [], { footballPos: { x: 5, y: 5 } })];
  assert.deepEqual(frameAt(frames, 0, 0).footballs, []);
  const mid = frameAt(frames, 0, 0.5).footballs;
  assert.equal(mid.length, 1);
  assert.equal(mid[0].opacity, 0.5);
  assert.deepEqual(frameAt(frames, 0, 1).footballs, [{ id: 'ball-1', x: 5, y: 5, opacity: 1 }]);
});

test('flera bollar glider var för sig, och en ny boll tonas in', () => {
  const frames = [
    frame('a', [], { footballs: [{ id: 'b1', x: 0, y: 0 }, { id: 'b2', x: 50, y: 50 }] }),
    frame('b', [], { footballs: [{ id: 'b1', x: 100, y: 0 }, { id: 'b3', x: 10, y: 10 }] }),
  ];
  const mid = frameAt(frames, 0, 0.5).footballs;
  assert.deepEqual(mid.find(b => b.id === 'b1'), { id: 'b1', x: 50, y: 0, opacity: 1 });
  assert.equal(mid.find(b => b.id === 'b2').opacity, 0.5, 'bollen som försvinner tonas ut');
  assert.equal(mid.find(b => b.id === 'b3').opacity, 0.5, 'bollen som kommer till tonas in');
});

test('normalizeBalls läser både nya och gamla tavlor', () => {
  assert.deepEqual(normalizeBalls({ footballPos: { x: 1, y: 2 } }), [{ id: 'ball-1', x: 1, y: 2 }]);
  assert.deepEqual(normalizeBalls({ footballPos: null }), []);
  assert.deepEqual(normalizeBalls({}), []);
  assert.deepEqual(normalizeBalls({ footballs: [], footballPos: { x: 1, y: 2 } }), [], 'en tom bollista vinner över footballPos');
  assert.deepEqual(normalizeBalls({ footballs: [{ x: 3, y: 4 }, null, { id: 7, x: 'x', y: 1 }] }), [{ id: 'ball-1', x: 3, y: 4 }, { id: '7', x: 50, y: 1 }]);
  assert.equal(normalizeBalls({ footballs: Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, x: 1, y: 1 })) }).length, MAX_BALLS);
  assert.deepEqual(firstBallPos([{ id: 'a', x: 4, y: 5 }]), { x: 4, y: 5 });
  assert.equal(firstBallPos([]), null);
});

test('playbackPosition räknar steg och slut', () => {
  assert.deepEqual(playbackPosition(3, 0, 0, 1000), { fromIndex: 0, progress: 0, done: false });
  assert.deepEqual(playbackPosition(3, 0, 1500, 1000), { fromIndex: 1, progress: 0.5, done: false });
  assert.deepEqual(playbackPosition(3, 1, 500, 1000), { fromIndex: 1, progress: 0.5, done: false });
  assert.equal(playbackPosition(3, 0, 2000, 1000).done, true);
  assert.equal(playbackPosition(3, 2, 0, 1000).done, true, 'start på sista steget = klart direkt');
  assert.equal(playbackPosition(1, 0, 0, 1000).done, true);
});

test('spåren följer spelarna som har rört sig', () => {
  const frames = [
    frame('a', [{ id: 'p', x: 0, y: 0 }, { id: 'still', x: 5, y: 5 }]),
    frame('b', [{ id: 'p', x: 10, y: 0 }, { id: 'still', x: 5, y: 5 }]),
    frame('c', [{ id: 'p', x: 10, y: 10 }, { id: 'still', x: 5, y: 5 }]),
  ];
  const t = trailsUpTo(frames, 'players', 1, 0.5);
  assert.equal(t.has('still'), false);
  assert.deepEqual(t.get('p'), [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]);
  assert.equal(trailsUpTo([frames[0]], 'players', 0, 0).size, 0);
});

test('mjukningen och hastigheterna', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
  assert.equal(stepDurationMs(), 1500);
  assert.equal(stepDurationMs('slow'), 2500);
  assert.equal(stepDurationMs('fast'), 900);
});

test('uppspelningstempot skalar tiden per steg', () => {
  assert.equal(scaledStepMs('normal', 1), 1500);
  assert.equal(scaledStepMs('normal', 0.5), 3000, 'halvfart tar dubbelt så lång tid');
  assert.equal(scaledStepMs('normal', 0.25), 6000);
  assert.equal(scaledStepMs('normal', 1.5), 1000);
  assert.equal(scaledStepMs('slow', 0.5), 5000);
  assert.equal(scaledStepMs(undefined, 7), 1500, 'okänt tempo blir 1×');
  // Efter 3 s i halvfart har man bara kommit ett steg (som 1,5 s i normalfart).
  assert.deepEqual(playbackPosition(3, 0, 3000, scaledStepMs('normal', 0.5)), { fromIndex: 1, progress: 0, done: false });
});

test('tempoknappen går runt och tål konstiga sparade värden', () => {
  assert.equal(normalizePlaybackRate('0.5'), 0.5);
  assert.equal(normalizePlaybackRate(null), 1);
  assert.equal(normalizePlaybackRate('abc'), 1);
  assert.equal(nextPlaybackRate(0.25), 0.5);
  assert.equal(nextPlaybackRate(1), 1.5);
  assert.equal(nextPlaybackRate(1.5), 0.25);
  assert.equal(playbackRateLabel(0.25), '0,25×');
  assert.equal(playbackRateLabel(1), '1×');
  assert.equal(playbackRateLabel(1.5), '1,5×');
});
