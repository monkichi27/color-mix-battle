// node test/room-core.test.js — exercises the room rules without any network
const assert = require('assert');
const E = require('../docs/color-engine.js');
const RoomCore = require('../docs/room-core.js');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const inbox = {};
  let saved = null;
  const emit = (pid, msg) => { (inbox[pid] = inbox[pid] || []).push(msg); };
  const last = pid => inbox[pid].filter(m => m.type === 'state').pop();
  const room = RoomCore.create({ code: 'TEST', hostId: 'h', engine: E, emit, onChange: () => { saved = room && room.serialize(); } });

  room.attach('h', 'Host'); room.attach('a', 'Ann'); room.attach('b', 'Ben');
  assert.equal(last('a').players.length, 3);
  room.handle('a', { type: 'settings', settings: { rounds: 3 } });
  assert.equal(last('h').settings.rounds, 5, 'non-host cannot change settings');
  room.handle('h', { type: 'settings', settings: { rounds: 3, time: 20, difficulty: 'easy' } });
  room.handle('h', { type: 'start' });
  let s = last('a');
  assert.equal(s.phase, 'mixing'); assert.equal(s.target.recipe, null, 'recipe hidden while mixing');

  room.handle('h', { type: 'submit', counts: { red: 1, '__proto__': 3, black: 999 } });
  room.handle('a', { type: 'submit', counts: { yellow: 2 } });
  room.handle('b', { type: 'draft', counts: { white: 1 } });
  room.detach('b'); // Ben drops → everyone online has submitted
  await wait(900);
  s = last('h');
  assert.equal(s.phase, 'reveal');
  assert.ok(s.target.recipe, 'recipe revealed');
  assert.equal(s.results.length, 3, 'disconnected player with a draft still scored');
  assert.equal(s.results.find(r => r.id === 'h').counts.black, 60, 'counts are clamped');
  const top = s.results[0];
  assert.ok(top.points >= 10);

  // restore from saved state (host refresh)
  const room2 = RoomCore.create({ engine: E, emit, onChange() {} }, saved);
  room2.attach('h', 'Host');
  assert.equal(last('h').phase, 'reveal');
  assert.equal(last('h').players.find(p => p.id === 'a').connected, false, 'guests offline until they reconnect');
  room2.attach('a', 'Ann');
  assert.deepEqual(last('a').players.map(p => p.score).sort(), s.players.map(p => p.score).sort(), 'scores survive restore');

  room2.handle('h', { type: 'next' }); room2.handle('h', { type: 'forceReveal' });
  room2.handle('h', { type: 'next' }); room2.handle('h', { type: 'forceReveal' });
  room2.handle('h', { type: 'next' });
  assert.equal(last('h').phase, 'final', 'game ends after configured rounds');

  room2.handle('h', { type: 'kick', id: 'a' });
  assert.ok(inbox.a.some(m => m.type === 'kicked'));
  room2.handle('h', { type: 'leave' });
  assert.ok(inbox.h.some(m => m.type === 'left') && room2.closed);

  // timer auto-reveal (short deadline)
  const r3 = RoomCore.create({ code: 'T3', hostId: 'x', engine: E, emit }, null);
  r3.attach('x', 'X'); r3.handle('x', { type: 'settings', settings: { time: 20 } }); r3.handle('x', { type: 'start' });
  const s3 = r3.serialize(); s3.deadline = Date.now() + 100; // pretend time is almost up
  const r4 = RoomCore.create({ engine: E, emit }, s3); r4.attach('x', 'X');
  r4.handle('x', { type: 'draft', counts: { blue: 1 } });
  await wait(600);
  assert.equal(last('x').phase, 'reveal', 'auto reveal when time is up');
  r3.destroy();

  console.log('✓ room-core: all tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
