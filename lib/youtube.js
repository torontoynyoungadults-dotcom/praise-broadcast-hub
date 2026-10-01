/**
 * 유튜브 검색 · 영상 정보 — 예배콘티 곡 입력칸 밑에 검색 결과를 펼쳐 보여주려고 서버가 대신 찾아줍니다.
 *   1순위: 서버 환경변수 YOUTUBE_API_KEY (YouTube Data API v3 — 청년부 앱 worshipYoutubeSearch 와 같은 방식)
 *   2순위: 열쇠가 없으면 유튜브 검색 결과 페이지에서 영상 목록만 읽어옴 (열쇠 없이도 동작 · 구조가 바뀌면 실패할 수 있음)
 *   둘 다 안 되면 { ok:false, msg, openUrl } — 화면이 "유튜브에서 직접 찾기" 링크를 보여줍니다.
 * 같은 검색은 6시간 동안 다시 부르지 않습니다.
 */
const CACHE = new Map();                       // 키 → { at, v }
const TTL = 6 * 3600 * 1000, CACHE_MAX = 300;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function cleanQ(q) { return String(q == null ? '' : q).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100); }
function decode(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));
}
const VID_RE = /^[A-Za-z0-9_-]{11}$/;
/** 주소(또는 영상 번호)에서 영상 ID — 아니면 '' */
function idOf(link) {
  const s = String(link || '').trim();
  if (VID_RE.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}
function secs(txt) {                           // "4:32" · "1:02:03" → 초
  const p = String(txt || '').split(':').map(Number);
  if (!p.length || p.some((n) => !Number.isFinite(n))) return 0;
  return p.reduce((a, n) => a * 60 + n, 0);
}
function viewsOf(txt) {                        // "조회수 1,234회" · "1.2M views" → 숫자
  const s = String(txt || '').replace(/,/g, '');
  const m = s.match(/([\d.]+)\s*(만|천|억|[KMB])?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]); if (!Number.isFinite(n)) return 0;
  const u = (m[2] || '').toUpperCase();
  return Math.round(n * ({ '만': 1e4, '천': 1e3, '억': 1e8, K: 1e3, M: 1e6, B: 1e9 }[u] || 1));
}

/** 유튜브 검색 결과 페이지(HTML) 안의 ytInitialData 에서 영상 목록 읽기 — 순수 함수 (시험용으로 따로 내보냄) */
function parseResultsHtml(html) {
  const m = String(html || '').match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) || String(html || '').match(/ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/);
  if (!m) return [];
  let data; try { data = JSON.parse(m[1]); } catch (e) { return []; }
  const out = [];
  (function walk(n, depth) {
    if (!n || typeof n !== 'object' || depth > 14 || out.length >= 20) return;
    if (Array.isArray(n)) { n.forEach((x) => walk(x, depth + 1)); return; }
    if (n.videoRenderer && n.videoRenderer.videoId) {
      const v = n.videoRenderer, run = (x) => (x && (x.simpleText || (x.runs || []).map((r) => r.text).join(''))) || '';
      const id = String(v.videoId);
      if (VID_RE.test(id) && !out.some((o) => o.id === id)) {
        out.push({ id, title: run(v.title), channel: run(v.ownerText || v.longBylineText), at: '', ago: run(v.publishedTimeText),
          thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg', dur: secs(run(v.lengthText)), views: viewsOf(run(v.viewCountText)) });
      }
      return;
    }
    Object.keys(n).forEach((k) => walk(n[k], depth + 1));
  })(data, 0);
  return out;
}

async function timedFetch(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 8000);
  try { return await fetch(url, Object.assign({}, opts, { signal: ctl.signal })); } finally { clearTimeout(t); }
}

async function viaApi(q, pageToken, key) {
  const pt = String(pageToken || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&videoEmbeddable=true&safeSearch=moderate&relevanceLanguage=ko' +
    '&q=' + encodeURIComponent(q) + (pt ? '&pageToken=' + pt : '') + '&key=' + encodeURIComponent(key);
  const r = await timedFetch(url, {}, 8000);
  if (!r.ok) { const e = new Error('api ' + r.status); e.status = r.status; throw e; }
  const data = await r.json();
  const items = (data.items || []).filter((it) => it && it.id && it.id.videoId).map((it) => {
    const sn = it.snippet || {}, th = sn.thumbnails || {};
    return { id: String(it.id.videoId), title: decode(sn.title), channel: decode(sn.channelTitle), at: String(sn.publishedAt || '').slice(0, 10),
      thumb: String((th.medium || th.default || {}).url || ('https://i.ytimg.com/vi/' + it.id.videoId + '/mqdefault.jpg')), dur: 0, views: 0 };
  });
  if (items.length) {                          // 길이 · 조회수 (라이브 · 풀버전 · 짧은 영상을 가려내는 데 도움) — 실패해도 결과는 그대로
    try {
      const vr = await timedFetch('https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=' + items.map((x) => x.id).join(',') + '&key=' + encodeURIComponent(key), {}, 6000);
      if (vr.ok) {
        const by = {}; ((await vr.json()).items || []).forEach((v) => { by[v.id] = v; });
        items.forEach((x) => {
          const v = by[x.id]; if (!v) return;
          const d = String((v.contentDetails || {}).duration || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
          if (d) x.dur = (Number(d[1] || 0) * 3600) + (Number(d[2] || 0) * 60) + Number(d[3] || 0);
          x.views = Number((v.statistics || {}).viewCount) || 0;
        });
      }
    } catch (e) { /* 덤 */ }
  }
  return { items, next: String(data.nextPageToken || '') };
}

async function viaPage(q) {
  const r = await timedFetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&hl=ko&gl=KR', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
  }, 9000);
  if (!r.ok) throw new Error('page ' + r.status);
  const items = parseResultsHtml(await r.text());
  if (!items.length) throw new Error('page-empty');
  return { items, next: '' };
}

/** 검색 — { ok, items:[{id,title,channel,at,thumb,dur,views}], next, openUrl, via } 또는 { ok:false, msg, openUrl } */
async function search(query, pageToken) {
  const q = cleanQ(query);
  const openUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
  if (!q) return { ok: false, msg: '검색어를 입력해주세요.', openUrl: 'https://www.youtube.com/' };
  const ck = q + '|' + String(pageToken || '');
  const hit = CACHE.get(ck);
  if (hit && Date.now() - hit.at < TTL) return Object.assign({}, hit.v, { cached: true });
  const key = String(process.env.YOUTUBE_API_KEY || '').trim();
  let res = null, why = '';
  if (key) {
    try { res = Object.assign(await viaApi(q, pageToken, key), { via: 'api' }); }
    catch (e) { why = e && e.status === 403 ? '유튜브 검색 한도를 넘었거나 열쇠 권한이 없습니다.' : '유튜브 검색 서비스에 연결하지 못했습니다.'; }
  }
  if (!res && !pageToken) {                    // 열쇠가 없거나 막힌 때 — 검색 페이지에서 읽기 (첫 페이지만)
    try { res = Object.assign(await viaPage(q), { via: 'page' }); }
    catch (e) { why = why || '유튜브에서 목록을 읽어오지 못했습니다.'; }
  }
  if (!res) return { ok: false, msg: why + ' 아래 링크로 유튜브에서 찾은 뒤 주소를 붙여 넣어 주세요.', openUrl };
  const out = { ok: true, items: res.items, next: res.next || '', q, openUrl, via: res.via };
  if (out.items.length) { CACHE.set(ck, { at: Date.now(), v: out }); while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value); }
  return out;
}

/** 붙여 넣은 주소의 영상 제목 · 채널 (열쇠 없이 되는 oEmbed) — 못 읽으면 null */
async function info(link) {
  const id = idOf(link);
  if (!id) return null;
  const ck = 'info|' + id, hit = CACHE.get(ck);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  try {
    const r = await timedFetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { headers: { 'User-Agent': UA } }, 6000);
    if (!r.ok) return null;
    const d = await r.json();
    const v = { id, title: decode(d.title), channel: decode(d.author_name), thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' };
    CACHE.set(ck, { at: Date.now(), v });
    return v;
  } catch (e) { return null; }
}

module.exports = { search, info, idOf, parseResultsHtml, cleanQ, _cache: CACHE };
