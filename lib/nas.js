/**
 * 드라이브 — 미디어팀 NAS(Synology, QuickConnect "youngnakmedia")의 파일을 이 앱에서 보기 · 듣기.
 * ------------------------------------------------------------
 *  · 서버가 NAS 계정(NAS_USER, 기본 praise3)으로 로그인 — 비밀번호는 환경변수 NAS_PASSWORD 에만 둡니다 (코드 · 화면에 없음).
 *  · 읽기 전용: 폴더 목록 · 파일 열기(영상 · 음악 · 사진 · PDF) · 내려받기. 올리기 · 지우기는 없습니다.
 *  · 파일은 이 서버를 거쳐 그대로 흘려보냅니다(Range 지원 — 영상 · 음악 중간으로 건너뛰기 가능). 팀원 브라우저는 NAS 주소 · 비밀번호를 모릅니다.
 *
 * 환경변수
 *   NAS_PASSWORD        (필수) praise3 비밀번호
 *   NAS_USER            로그인 아이디 (기본 praise3)
 *   NAS_QUICKCONNECT_ID QuickConnect ID (기본 youngnakmedia) — 이걸로 NAS 실제 주소를 찾습니다
 *   NAS_URL             NAS 주소를 직접 지정 (예: https://youngnakmedia.synology.me:5001) — 있으면 QuickConnect 대신 이것만 씀
 *   NAS_ROOT            이 폴더 아래만 보이게 (예: /찬양팀) — 없으면 praise3 가 볼 수 있는 모든 공유 폴더
 *   NAS_INSECURE_TLS    1 이면 NAS 인증서 확인을 하지 않음 (자체 서명 인증서 · IP 주소로 접속할 때만)
 *
 * Synology File Station Web API (DSM 6.2+/7): SYNO.API.Auth v6 · SYNO.FileStation.List v2 · SYNO.FileStation.Download v2
 */
const http = require('http');
const https = require('https');

const cfg = () => ({
  user: process.env.NAS_USER || 'praise3',
  pass: process.env.NAS_PASSWORD || '',
  qcId: process.env.NAS_QUICKCONNECT_ID || 'youngnakmedia',
  url: String(process.env.NAS_URL || '').trim().replace(/\/+$/, ''),
  root: normRoot(process.env.NAS_ROOT || ''),
  insecure: /^(1|true|yes)$/i.test(String(process.env.NAS_INSECURE_TLS || '')),
});
function normRoot(r) { r = String(r || '').trim().replace(/\\/g, '/').replace(/\/+$/, ''); return r && r[0] !== '/' ? '/' + r : r; }

const userErr = (m, code) => Object.assign(new Error(m), { user: true, code });
const configured = () => !!cfg().pass;

/* ---------------------------------------------------------------- 경로 */
/** 화면에서 받은 경로를 정리 — '/공유폴더/하위/파일' 꼴, '..' 금지, NAS_ROOT 밖 금지. '' 은 맨 위 */
function cleanPath(p) {
  p = String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  if (!p || p === '/') return '';
  if (p[0] !== '/') p = '/' + p;
  if (p.split('/').some((s) => s === '..' || s === '.') || /[\0\r\n]/.test(p)) throw userErr('경로를 확인해주세요.');
  const root = cfg().root;
  if (root && p !== root && p.indexOf(root + '/') !== 0) throw userErr('볼 수 없는 폴더예요.');
  return p;
}
/** 맨 위(NAS_ROOT 가 있으면 그 폴더) */
const topPath = () => cfg().root || '';

/* ---------------------------------------------------------------- HTTP (인증서 확인을 주소마다 고를 수 있게 http/https 직접) */
function request(urlStr, o = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      method: o.method || 'GET',
      headers: Object.assign({ 'User-Agent': 'praise-broadcast-hub' }, o.headers || {}),
      rejectUnauthorized: !o.insecure,
      timeout: o.timeout || 15000,
    }, (res) => resolve(res));
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (o.body) req.write(o.body);
    req.end();
  });
}
async function json(urlStr, o) {
  const res = await request(urlStr, o);
  const chunks = [];
  for await (const c of res) { chunks.push(c); if (chunks.length > 4000) break; }
  const text = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(text); } catch (e) { throw Object.assign(new Error('not json (' + res.statusCode + ')'), { code: 'ENOTJSON' }); }
}
const form = (obj) => Object.keys(obj).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');

/* ---------------------------------------------------------------- QuickConnect → 실제 주소 */
/** QuickConnect 서버에 "이 NAS 는 지금 어디 있나" 를 묻고, 시도해 볼 주소 목록을 만듭니다 (직접 연결 → 릴레이 순) */
async function quickConnectCandidates(id) {
  const ask = (host, command) => json(`https://${host}/Serv.php`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 10000,
    body: JSON.stringify([
      { version: 1, command, stop_when_error: false, stop_when_success: false, id: 'dsm_portal_https', serverID: id, is_gofile: false },
      { version: 1, command, stop_when_error: false, stop_when_success: false, id: 'dsm_portal', serverID: id, is_gofile: false },
    ]),
  });
  let res = await ask('global.quickconnect.to', 'get_server_info');
  let list = Array.isArray(res) ? res : [res];
  const sites = [].concat(...list.map((x) => (x && x.sites) || []));
  if (!list.some((x) => x && x.errno === 0) && sites.length) {       // 다른 지역 서버에 물어보라고 할 때
    res = await ask(sites[0], 'get_server_info');
    list = Array.isArray(res) ? res : [res];
  }
  const out = [];
  const add = (url, insecure) => { if (url && !out.some((c) => c.url === url)) out.push({ url, insecure: !!insecure }); };
  const ok = (v) => v && v !== 'NULL';
  let relay = null;
  list.filter((x) => x && x.errno === 0).forEach((x) => {
    const sv = x.service || {}, server = x.server || {}, sd = x.smartdns || {}, env = x.env || {};
    const isHttps = /https/.test(String(sv.pingpong_path || '')) || /https/.test(String(x.id || '')) || sv.port === 5001;
    const proto = isHttps ? 'https' : 'http';
    const port = sv.ext_port || sv.port;
    if (ok(sd.host) && port) add(`${proto}://${sd.host}:${port}`);
    if (ok(server.ddns) && port) add(`${proto}://${server.ddns}:${port}`);
    if (ok(server.fqdn) && port) add(`${proto}://${server.fqdn}:${port}`);
    if (server.external && ok(server.external.ip) && port) add(`${proto}://${server.external.ip}:${port}`, true);
    if (!relay && env.relay_region) relay = { region: env.relay_region, control: env.control_host };
  });
  if (relay) {
    try { if (relay.control) await ask(relay.control, 'request_tunnel'); } catch (e) { /* 릴레이 요청 실패해도 주소는 시도 */ }
    add(`https://${id}.${relay.region}.quickconnect.to`);
  }
  return out;
}

/** 이 주소가 DSM Web API 로 대답하는지 */
async function probe(c) {
  try {
    const d = await json(`${c.url}/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth`, { insecure: c.insecure || cfg().insecure, timeout: 7000 });
    return !!(d && d.success);
  } catch (e) { return false; }
}

const S = { base: null, insecure: false, sid: '', resolving: null, tried: [] };
async function base() {
  if (S.base) return S.base;
  if (S.resolving) return S.resolving;
  S.resolving = (async () => {
    const c = cfg();
    let cands = c.url ? [{ url: c.url, insecure: c.insecure }] : [];
    if (!cands.length) {
      try { cands = await quickConnectCandidates(c.qcId); } catch (e) { cands = []; }
      if (!cands.length) cands = [{ url: `https://${c.qcId}.quickconnect.to` }];
    }
    S.tried = cands.map((x) => x.url);
    for (const cand of cands) {
      if (await probe(cand)) { S.base = cand.url; S.insecure = !!(cand.insecure || c.insecure); return S.base; }
    }
    throw userErr('NAS 에 연결하지 못했어요. NAS 가 켜져 있는지 확인하고, 계속 안 되면 관리자가 NAS_URL(직접 주소)을 넣어 주세요.', 'NAS_UNREACHABLE');
  })();
  try { return await S.resolving; } finally { S.resolving = null; }
}
function forget() { S.base = null; S.sid = ''; }

/* ---------------------------------------------------------------- 로그인 · API */
async function login() {
  const c = cfg();
  if (!c.pass) throw userErr('NAS 비밀번호(NAS_PASSWORD)가 아직 설정되지 않았어요. 관리자에게 알려주세요.', 'NAS_NOT_CONFIGURED');
  const b = await base();
  const d = await json(`${b}/webapi/entry.cgi`, {
    method: 'POST', insecure: S.insecure, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ api: 'SYNO.API.Auth', version: 6, method: 'login', account: c.user, passwd: c.pass, session: 'FileStation', format: 'sid' }),
  });
  if (!d || !d.success || !d.data || !d.data.sid) {
    const code = d && d.error && d.error.code;
    if (code === 400 || code === 401 || code === 402) throw userErr('NAS 아이디나 비밀번호가 맞지 않아요. 관리자에게 알려주세요.', 'NAS_AUTH');
    if (code === 403 || code === 404 || code === 406) throw userErr('이 NAS 계정은 2단계 인증이 켜져 있어서 앱이 로그인할 수 없어요.', 'NAS_OTP');
    if (code === 407) throw userErr('NAS 가 이 서버의 접속을 막았어요 (로그인 실패가 많아 차단). NAS 관리자 화면에서 차단을 풀어 주세요.', 'NAS_BLOCKED');
    throw userErr('NAS 로그인에 실패했어요. (' + (code || '?') + ')', 'NAS_LOGIN');
  }
  S.sid = d.data.sid;
  return S.sid;
}

const SESSION_CODES = [105, 106, 107, 119];
/** File Station API 한 번 — 세션이 끊겼으면 다시 로그인해서 한 번 더 */
async function api(params, again) {
  try {
    if (!S.sid) await login();
    const d = await json(`${S.base}/webapi/entry.cgi?${form(Object.assign({}, params, { _sid: S.sid }))}`, { insecure: S.insecure });
    if (d && d.success) return d.data || {};
    const code = d && d.error && d.error.code;
    if (!again && SESSION_CODES.includes(code)) { S.sid = ''; return api(params, true); }
    if (code === 408) throw userErr('파일이나 폴더를 찾지 못했어요.', 'NAS_NOT_FOUND');
    if (code === 407 || code === 105) throw userErr('이 폴더를 볼 권한이 없어요.', 'NAS_PERM');
    throw userErr('NAS 에서 목록을 받지 못했어요. (' + (code || '?') + ')', 'NAS_API');
  } catch (e) {
    if (!e.user && !again) { forget(); return api(params, true); }      // 주소가 바뀌었을 수 있음 → 다시 찾기
    if (!e.user) throw userErr('NAS 와 연결이 끊겼어요. 잠시 뒤에 다시 시도해주세요.', 'NAS_NET');
    throw e;
  }
}

/* ---------------------------------------------------------------- 목록 */
const HIDE = (name) => /^(#recycle|@eaDir|#snapshot|\.)/i.test(name) || name === 'Thumbs.db' || name === '.DS_Store';
function item(f, isShare) {
  const add = f.additional || {};
  const t = add.time || {};
  return {
    name: String(f.name || ''), path: String(f.path || ''), dir: !!(isShare || f.isdir),
    size: Number(add.size) || 0, mtime: Number(t.mtime) || 0,
  };
}
/** 폴더 안 목록 — path 가 '' 이면 공유 폴더들 (NAS_ROOT 가 있으면 그 폴더) */
async function list(p) {
  p = cleanPath(p);
  if (!p) p = topPath();
  if (!p) {
    const d = await api({ api: 'SYNO.FileStation.List', version: 2, method: 'list_share', additional: '["time"]', sort_by: 'name', limit: 1000 });
    return { path: '', items: (d.shares || []).map((s) => item(s, true)).filter((x) => !HIDE(x.name)), total: d.total || 0 };
  }
  const d = await api({ api: 'SYNO.FileStation.List', version: 2, method: 'list', folder_path: p, additional: '["size","time"]', sort_by: 'name', limit: 2000 });
  const items = (d.files || []).map((f) => item(f)).filter((x) => !HIDE(x.name));
  items.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'ko', { numeric: true }) : a.dir ? -1 : 1));
  return { path: p, items, total: d.total || items.length };
}

/* ---------------------------------------------------------------- 파일 흘려보내기 */
const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', mts: 'video/mp2t', ts: 'video/mp2t',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wma: 'audio/x-ms-wma', aif: 'audio/aiff', aiff: 'audio/aiff',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', bmp: 'image/bmp', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8',
};
const extOf = (name) => { const m = String(name || '').match(/\.([A-Za-z0-9]+)$/); return m ? m[1].toLowerCase() : ''; };
const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';
/** 화면에서 열기 방식 — video | audio | image | pdf | '' (내려받기만) */
function kindOf(name) {
  const e = extOf(name);
  if (/^(mp4|m4v|mov|webm|mkv|avi|wmv|mts|ts)$/.test(e)) return 'video';
  if (/^(mp3|m4a|aac|wav|flac|ogg|oga|opus|wma|aif|aiff)$/.test(e)) return 'audio';
  if (/^(jpe?g|png|gif|webp|heic|bmp)$/.test(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  return '';
}

/**
 * NAS 파일을 res 로 그대로 흘려보냅니다. range = 브라우저가 보낸 Range 헤더(영상 건너뛰기).
 * download=true 면 "내려받기", 아니면 브라우저 안에서 열기.
 */
async function stream(p, res, range, download, again) {
  p = cleanPath(p);
  if (!p) throw userErr('파일을 골라주세요.');
  if (!S.sid) await login();
  const url = `${S.base}/webapi/entry.cgi?${form({ api: 'SYNO.FileStation.Download', version: 2, method: 'download', path: JSON.stringify([p]), mode: 'open', _sid: S.sid })}`;
  let up;
  try { up = await request(url, { insecure: S.insecure, headers: range ? { Range: range } : {}, timeout: 30000 }); } catch (e) {
    if (!again) { forget(); return stream(p, res, range, download, true); }
    throw userErr('NAS 와 연결이 끊겼어요. 잠시 뒤에 다시 시도해주세요.', 'NAS_NET');
  }
  const ct = String(up.headers['content-type'] || '');
  if (/json/.test(ct) || up.statusCode >= 400) {                       // 파일 대신 오류(JSON)가 옴 — 세션 끊김 등
    const chunks = []; for await (const c of up) chunks.push(c);
    let code; try { code = JSON.parse(Buffer.concat(chunks).toString('utf8')).error.code; } catch (e) { code = up.statusCode; }
    if (!again && (SESSION_CODES.includes(code) || up.statusCode === 401 || up.statusCode === 403)) { S.sid = ''; return stream(p, res, range, download, true); }
    if (up.statusCode === 416) { res.status(416).end(); return; }
    throw userErr(code === 408 ? '파일을 찾지 못했어요.' : '파일을 열지 못했어요. (' + code + ')', 'NAS_FILE');
  }
  const name = p.split('/').pop();
  res.status(up.statusCode === 206 ? 206 : 200);
  res.set('Content-Type', mimeOf(name));
  ['content-length', 'content-range', 'last-modified', 'etag'].forEach((h) => { if (up.headers[h]) res.set(h, up.headers[h]); });
  res.set('Accept-Ranges', 'bytes');
  res.set('Cache-Control', 'private, max-age=600');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.on('close', () => up.destroy());
  up.pipe(res);
}

/** 관리자 확인용 — 지금 상태 (비밀번호는 내보내지 않음) */
function status() {
  const c = cfg();
  return { configured: !!c.pass, user: c.user, quickConnectId: c.url ? '' : c.qcId, url: c.url || '', root: c.root, connectedTo: S.base || '', tried: S.tried.slice() };
}

module.exports = { list, stream, cleanPath, kindOf, mimeOf, extOf, configured, status, topPath, _quickConnectCandidates: quickConnectCandidates, _reset: () => { forget(); S.tried = []; } };
