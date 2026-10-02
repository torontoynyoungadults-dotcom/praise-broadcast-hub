/**
 * 카톡 대화에서 뽑은 지난 콘티(data/conti-history.json)를 찬양콘티 시트에 넣습니다.
 *  · 이미 그 예배(주일 날짜 · 행사)에 콘티가 한 곡이라도 있으면 건드리지 않고 건너뜁니다 — 직접 입력한 것은 그대로, 여러 번 눌러도 중복 없음.
 *  · 주일 외 행사(성탄 · 송구영신 · 특별새벽기도회 · 철야)는 '특별예배'에 같은 날짜 행사가 있으면 그것을 쓰고 없으면 만듭니다.
 */
const fs = require('fs');
const path = require('path');
const sheetsDb = require('./sheetsDb');

function load() { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'conti-history.json'), 'utf8')); }
const uid = (p, n) => p + Date.now().toString(36) + n + Math.random().toString(36).slice(2, 5);

/** dryRun 이면 쓰지 않고 계획만 돌려줍니다. 돌려주는 값: { services, songs, skipped:[…], added:{services,songs,events} } */
async function run(team, { dryRun } = {}) {
  const data = load();
  const [songs, evs] = await Promise.all([sheetsDb.readAll('찬양콘티', { fresh: true }), sheetsDb.readAll('특별예배', { fresh: true })]);
  const mineSongs = songs.filter((r) => r['팀ID'] === team);
  const mineEvs = evs.filter((r) => r['팀ID'] === team);
  const newEvents = [], newSongs = [], skipped = [];
  let n = 0, services = 0;
  for (const s of data) {
    let evId = '';
    if (s.event) {
      let ev = mineEvs.find((e) => e['날짜'] === s.date) || newEvents.find((e) => e['날짜'] === s.date);
      if (!ev) {
        ev = { 'ID': uid('S', ++n), '팀ID': team, '날짜': s.date, '이름': s.event, '등록시각': new Date().toISOString(), '예배시간': '', '리허설시간': '' };
        newEvents.push(ev);
      }
      evId = ev['ID'];
    }
    const has = mineSongs.some((r) => String(r['제목'] || '').trim() && (evId ? r['행사ID'] === evId : (!r['행사ID'] && r['날짜'] === s.date)));
    if (has) { skipped.push(s.date + (s.event ? ' ' + s.event : '') + ' — 이미 콘티가 있어 건너뜀'); continue; }
    services++;
    const seq = { '콘티': 0, '결단': 0 };
    for (const x of s.songs) {
      seq[x.kind] += 1;
      newSongs.push({
        'ID': uid('C', ++n), '팀ID': team, '날짜': s.date, '행사ID': evId, '구분': x.kind, '순서': seq[x.kind], '제목': x.title, 'Key': x.key || '',
        '유튜브': x.link || '', '송폼': x.form || '', 'BPM': '', '비고': x.note || '', '만든시각': s.posted + 'T12:00:00.000Z', '팀': '', '솔로': '',
      });
    }
  }
  if (!dryRun) {
    if (newEvents.length) await sheetsDb.appendRows('특별예배', newEvents);
    if (newSongs.length) await sheetsDb.appendRows('찬양콘티', newSongs);
  }
  return { total: data.length, services, songs: newSongs.length, events: newEvents.length, skipped };
}

module.exports = { run };
