/**
 * 연습 화면 실시간 동기화 (Socket.io) — 방(room) = `practice:${팀}::${날짜}`.
 * DB에 저장하지 않는 "지금 이 순간" 상태만 다룸(서버 재시작하면 사라져도 괜찮은 정보):
 *   - 지금 보고 있는 곡 순서(index) · 펼쳐 둔 악보
 *   - 메트로놈(BPM · 재생 중 여부 · 시작 시각)
 * 누군가 바꾸면 같은 방에 있는 모든 기기(리더 · 팀원 화면)에 즉시 반영됨.
 */
function defaultState() {
  return { songIdx: 0, sheetId: null, metro: { bpm: 80, running: false, startedAt: 0 } };
}

module.exports = function attachRealtime(io) {
  const rooms = new Map(); // roomId -> state

  io.on('connection', (socket) => {
    socket.on('join', (roomId) => {
      if (!roomId || typeof roomId !== 'string') return;
      socket.join(roomId);
      socket.data.room = roomId;
      if (!rooms.has(roomId)) rooms.set(roomId, defaultState());
      socket.emit('state', rooms.get(roomId));
    });

    socket.on('update', (patch) => {
      const roomId = socket.data.room;
      if (!roomId || !patch || typeof patch !== 'object') return;
      const cur = rooms.get(roomId) || defaultState();
      const next = { ...cur, ...patch, metro: { ...cur.metro, ...(patch.metro || {}) } };
      rooms.set(roomId, next);
      io.to(roomId).emit('state', next);
    });
  });
};
