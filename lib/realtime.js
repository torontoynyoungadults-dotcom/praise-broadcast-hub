/**
 * 연습 화면 실시간 동기화 (Socket.io) — 방(room) = `practice:${팀}::${날짜}`.
 * DB에 저장하지 않는 "지금 이 순간" 상태만 다룸(서버 재시작하면 사라져도 괜찮은 정보):
 *   - 지금 보고 있는 곡 순서(index) · 펼쳐 둔 악보 · 악보 쪽(page)
 *   - 메트로놈(BPM · 재생 중 여부 · 시작 시각)
 * 누군가 "페이지 컨트롤"을 하면 그 상태가 방 전체에 즉시 반영됨(받는 쪽은 "따라가기"가 켜져 있을 때만 적용).
 * 그 외에 이 방에서 오가는 것:
 *   - 접속자 명단("함께" 탭) — join 할 때 이름을 같이 보냄
 *   - 큐(음성 안내) — "Repeat Chorus" 같은 버튼을 누르면 방 전체에 알림
 *   - 필기 획 — 한 획을 다 그리면(pointerup) 방 전체에 즉시 중계(저장은 별도 HTTP로)
 */
function defaultState() {
  return { songIdx: 0, sheetId: null, page: 1, metro: { bpm: 80, running: false, startedAt: 0 } };
}

module.exports = function attachRealtime(io) {
  const rooms = new Map(); // roomId -> state
  const roster = new Map(); // roomId -> Map(socketId -> name)

  function rosterList(roomId) {
    const m = roster.get(roomId);
    return m ? Array.from(m.values()) : [];
  }

  io.on('connection', (socket) => {
    socket.on('join', (payload) => {
      const roomId = typeof payload === 'string' ? payload : (payload && payload.room);
      const name = (payload && typeof payload === 'object' && payload.name) ? String(payload.name).slice(0, 40) : '';
      if (!roomId || typeof roomId !== 'string') return;
      socket.join(roomId);
      socket.data.room = roomId;
      socket.data.name = name;
      if (!rooms.has(roomId)) rooms.set(roomId, defaultState());
      if (!roster.has(roomId)) roster.set(roomId, new Map());
      roster.get(roomId).set(socket.id, name || '(이름 없음)');
      socket.emit('state', rooms.get(roomId));
      io.to(roomId).emit('roster', rosterList(roomId));
    });

    socket.on('update', (patch) => {
      const roomId = socket.data.room;
      if (!roomId || !patch || typeof patch !== 'object') return;
      const cur = rooms.get(roomId) || defaultState();
      const next = { ...cur, ...patch, metro: { ...cur.metro, ...(patch.metro || {}) } };
      rooms.set(roomId, next);
      io.to(roomId).emit('state', next);
    });

    /** 큐(음성 안내) 중계 — 저장하지 않고 그냥 지금 접속한 사람들에게만 전달 */
    socket.on('cue', (text) => {
      const roomId = socket.data.room;
      if (!roomId || !text) return;
      io.to(roomId).emit('cue', { text: String(text).slice(0, 60), by: socket.data.name || '', at: Date.now() });
    });

    /** 필기 한 획(완성된 stroke) 중계 — 그 순간 같이 보고 있는 사람에게만, 저장은 클라이언트가 별도 HTTP로 */
    socket.on('anno:stroke', (payload) => {
      const roomId = socket.data.room;
      if (!roomId || !payload) return;
      socket.to(roomId).emit('anno:stroke', payload);
    });

    socket.on('disconnect', () => {
      const roomId = socket.data.room;
      if (!roomId) return;
      const m = roster.get(roomId);
      if (m) { m.delete(socket.id); io.to(roomId).emit('roster', rosterList(roomId)); }
    });
  });
};
