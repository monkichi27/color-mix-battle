// Room rules — transport-agnostic. Runs inside the host's browser (P2P) or in Node for tests.
// const room = RoomCore.create({ code, hostId, emit(playerId, msg), onChange(), engine })
(function (root) {
  const MAX_PLAYERS = 12;
  const POINTS = [10, 7, 5, 3, 2, 1];
  const PERFECT = 97;
  const PERFECT_BONUS = 3;

  function cleanName(n) {
    n = String(n || '').trim().replace(/\s+/g, ' ').slice(0, 16);
    return n || 'ผู้เล่น';
  }

  function create(opts, saved) {
    const E = opts.engine;
    const PIGMENT_IDS = E.PIGMENTS.map(p => p.id);
    const emit = opts.emit;
    const onChange = opts.onChange || (() => {});

    const room = saved ? JSON.parse(JSON.stringify(saved)) : {
      code: opts.code,
      hostId: opts.hostId,
      players: [],
      settings: { rounds: 5, time: 60, difficulty: 'normal' },
      phase: 'lobby',
      round: 0,
      target: null,
      deadline: null,
      results: null,
    };
    // everybody starts offline after a restore; they reconnect themselves
    for (const p of room.players) p.connected = false;
    let timer = null;

    const byId = id => room.players.find(p => p.id === id);
    const online = () => room.players.filter(p => p.connected);

    function cleanCounts(c) {
      const out = {};
      if (!c || typeof c !== 'object') return out;
      for (const id of PIGMENT_IDS) {
        const v = Math.floor(Number(c[id]) || 0);
        if (v > 0) out[id] = Math.min(v, 60);
      }
      return out;
    }

    function cleanSettings(s) {
      const prev = room.settings;
      return {
        rounds: [0, 3, 5, 7, 10, 15].includes(Number(s.rounds)) ? Number(s.rounds) : prev.rounds,
        time: [0, 20, 30, 45, 60, 90, 120].includes(Number(s.time)) ? Number(s.time) : prev.time,
        difficulty: ['easy', 'normal', 'hard'].includes(s.difficulty) ? s.difficulty : prev.difficulty,
      };
    }

    function snapshot(forId) {
      const me = byId(forId);
      const showAnswer = room.phase === 'reveal' || room.phase === 'final';
      return {
        type: 'state',
        you: forId,
        code: room.code,
        hostId: room.hostId,
        phase: room.phase,
        round: room.round,
        settings: room.settings,
        target: room.target ? { rgb: room.target.rgb, recipe: showAnswer ? room.target.recipe : null } : null,
        remainingMs: room.deadline ? Math.max(0, room.deadline - Date.now()) : null,
        players: room.players.map(p => ({
          id: p.id, name: p.name, score: p.score, connected: p.connected, submitted: p.submitted, wins: p.wins,
        })),
        results: showAnswer ? room.results : null,
        myCounts: me ? me.counts : {},
        mySubmitted: me ? me.submitted : false,
      };
    }

    function broadcast() {
      for (const p of room.players) if (p.connected) emit(p.id, snapshot(p.id));
      onChange();
    }

    function armTimer() {
      clearTimeout(timer);
      if (room.phase === 'mixing' && room.deadline) {
        timer = setTimeout(reveal, Math.max(0, room.deadline - Date.now()) + 300);
      }
    }

    function startRound() {
      room.round += 1;
      room.target = E.randomRecipe(room.settings.difficulty);
      room.results = null;
      for (const p of room.players) { p.counts = {}; p.submitted = false; }
      room.phase = 'mixing';
      room.deadline = room.settings.time > 0 ? Date.now() + room.settings.time * 1000 : null;
      armTimer();
      broadcast();
    }

    function reveal() {
      if (room.phase !== 'mixing') return;
      clearTimeout(timer);
      room.deadline = null;
      const rows = room.players
        .filter(p => p.connected || Object.keys(p.counts).length)
        .map(p => {
          const rgb = E.mix(p.counts);
          const pct = rgb ? Math.round(E.similarity(rgb, room.target.rgb) * 10) / 10 : 0;
          return { id: p.id, name: p.name, counts: p.counts, rgb, pct };
        })
        .sort((a, b) => b.pct - a.pct);
      let rank = 0;
      rows.forEach((r, i) => {
        if (i === 0 || r.pct < rows[i - 1].pct) rank = i + 1;
        r.rank = rank;
        r.perfect = r.pct >= PERFECT;
        r.points = r.pct > 0 ? (POINTS[rank - 1] || 1) + (r.perfect ? PERFECT_BONUS : 0) : 0;
        const p = byId(r.id);
        p.score += r.points;
        if (rank === 1 && r.pct > 0) p.wins += 1;
        r.score = p.score;
      });
      room.results = rows;
      room.phase = 'reveal';
      broadcast();
    }

    function maybeAllSubmitted() {
      if (room.phase !== 'mixing') return;
      const live = online();
      if (live.length && live.every(p => p.submitted)) {
        clearTimeout(timer);
        timer = setTimeout(reveal, 700);
      }
    }

    function resetScores() {
      for (const p of room.players) { p.score = 0; p.wins = 0; p.counts = {}; p.submitted = false; }
      room.round = 0;
      room.results = null;
      room.target = null;
    }

    // ---- public API ----
    function attach(playerId, name) {
      let p = byId(playerId);
      if (p) {
        if (name) p.name = cleanName(name);
      } else {
        if (room.players.length >= MAX_PLAYERS) return 'ห้องเต็มแล้ว (สูงสุด 12 คน)';
        p = { id: playerId, name: cleanName(name), score: 0, wins: 0, counts: {}, submitted: false };
        room.players.push(p);
      }
      p.connected = true;
      broadcast();
      return null;
    }

    function detach(playerId) {
      const p = byId(playerId);
      if (!p) return;
      p.connected = false;
      maybeAllSubmitted();
      broadcast();
    }

    function remove(playerId) {
      room.players = room.players.filter(p => p.id !== playerId);
      maybeAllSubmitted();
      broadcast();
    }

    function handle(playerId, msg) {
      const player = byId(playerId);
      if (!player || !msg || typeof msg.type !== 'string') return;
      const isHost = room.hostId === playerId;
      switch (msg.type) {
        case 'leave':
          if (isHost) { // host leaving closes the room
            for (const p of room.players) if (p.connected && p.id !== playerId) emit(p.id, { type: 'closed' });
            clearTimeout(timer);
            room.closed = true;
            emit(playerId, { type: 'left' });
            onChange();
            return;
          }
          emit(playerId, { type: 'left' });
          remove(playerId);
          break;
        case 'rename':
          player.name = cleanName(msg.name);
          broadcast();
          break;
        case 'settings':
          if (!isHost || room.phase !== 'lobby') return;
          room.settings = cleanSettings(msg.settings || {});
          broadcast();
          break;
        case 'start':
          if (!isHost || !(room.phase === 'lobby' || room.phase === 'final')) return;
          resetScores();
          startRound();
          break;
        case 'draft':
          if (room.phase !== 'mixing' || player.submitted) return;
          player.counts = cleanCounts(msg.counts);
          onChange();
          break;
        case 'submit':
          if (room.phase !== 'mixing' || player.submitted) return;
          player.counts = cleanCounts(msg.counts);
          player.submitted = true;
          broadcast();
          maybeAllSubmitted();
          break;
        case 'unsubmit':
          if (room.phase !== 'mixing' || !player.submitted) return;
          player.submitted = false;
          armTimer();
          broadcast();
          break;
        case 'forceReveal':
          if (isHost && room.phase === 'mixing') reveal();
          break;
        case 'next':
          if (!isHost || room.phase !== 'reveal') return;
          if (room.settings.rounds > 0 && room.round >= room.settings.rounds) { room.phase = 'final'; broadcast(); }
          else startRound();
          break;
        case 'end':
          if (!isHost || room.phase === 'lobby') return;
          if (room.phase === 'mixing') reveal();
          clearTimeout(timer);
          room.phase = 'final';
          room.deadline = null;
          broadcast();
          break;
        case 'lobby':
          if (!isHost || room.phase !== 'final') return;
          resetScores();
          room.phase = 'lobby';
          broadcast();
          break;
        case 'kick':
          if (!isHost || msg.id === playerId || !byId(msg.id)) return;
          emit(msg.id, { type: 'kicked' });
          remove(msg.id);
          break;
      }
    }

    // resume a restored room: if the timer ran out while the host was away, reveal now
    if (saved) {
      if (room.phase === 'mixing' && room.deadline && room.deadline <= Date.now()) setTimeout(reveal, 1500);
      else armTimer();
    }

    return {
      attach, detach, handle,
      get code() { return room.code; },
      get closed() { return !!room.closed; },
      serialize: () => JSON.parse(JSON.stringify(room)),
      destroy: () => clearTimeout(timer),
    };
  }

  const api = { create, MAX_PLAYERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoomCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
