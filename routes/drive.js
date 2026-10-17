/**
 * 드라이브 — 미디어팀 NAS(Synology) 의 파일을 앱 안에서 둘러보고 바로 열기 (영상 · 음악 · 사진 · PDF).
 *   GET /drive?p=/공유폴더/하위      폴더 목록 (서버가 그림 — 폴더를 누르면 그 폴더로)
 *   GET /drive/file?p=/…/파일[&dl=1]  파일 열기 (Range 지원 — 영상 · 음악 건너뛰기) · dl=1 이면 내려받기
 * 로그인한 팀원만 (객원 멤버는 닫힘 — lib/guestGate.js). 읽기 전용. NAS 연결 · 로그인은 lib/nas.js.
 */
const express = require('express');
const pageShell = require('../lib/pageShell');
const teamContext = require('../lib/teamContext');
const spa = require('../lib/spa');
const ui = require('../lib/uiIcons');
const nas = require('../lib/nas');

const router = express.Router();
const esc = pageShell.esc;
const DRIVE_JS_V = pageShell.assetVersion('js/drive.js');

async function requireMember(req, res, next) {
  if (!req.session) return res.redirect('/');
  const ctx = await teamContext.resolve(req);
  if (!ctx) return res.redirect('/logout');
  req.ctx = ctx;
  next();
}

function fmtSize(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + ' ' + u[i];
}
function fmtDate(sec) {
  if (!sec) return '';
  return new Date(sec * 1000).toLocaleDateString('sv-SE', { timeZone: 'America/Toronto' });      // 2026-10-17
}
const ICON = { video: 'play', audio: 'headphones', image: 'image', pdf: 'link', '': 'download' };
const KIND_LABEL = { video: '영상', audio: '음악', image: '사진', pdf: 'PDF' };
const href = (p) => '/drive' + (p ? '?p=' + encodeURIComponent(p) : '');
const fileHref = (p, dl) => '/drive/file?p=' + encodeURIComponent(p) + (dl ? '&dl=1' : '');

/** 맨 위 → 지금 폴더까지 길 (드라이브 / 공유폴더 / 하위 …) */
function crumbs(p) {
  const top = nas.topPath();
  const parts = p ? p.split('/').filter(Boolean) : [];
  const topParts = top ? top.split('/').filter(Boolean).length : 0;
  const out = [`<a href="${href('')}">드라이브</a>`];
  let acc = '';
  parts.forEach((seg, i) => {
    acc += '/' + seg;
    if (i < topParts - 1) return;                                        // NAS_ROOT 위쪽은 숨김
    if (i === topParts - 1 && topParts) return;                          // NAS_ROOT 자체 = "드라이브"
    out.push(i === parts.length - 1 ? `<b>${esc(seg)}</b>` : `<a href="${href(acc)}">${esc(seg)}</a>`);
  });
  return `<nav class="dv-crumbs" aria-label="폴더 위치">${out.join('<span class="dv-sep">/</span>')}</nav>`;
}

function row(x) {
  if (x.dir) {
    return `<a class="dv-row dir" href="${href(x.path)}" data-name="${esc(x.name.toLowerCase())}">
      <span class="dv-ic">${ui.icon('folder')}</span><span class="dv-main"><span class="dv-name">${esc(x.name)}</span>${x.mtime ? `<span class="dv-sub">${esc(fmtDate(x.mtime))}</span>` : ''}</span><span class="dv-go">›</span></a>`;
  }
  const kind = nas.kindOf(x.name);
  const sub = [KIND_LABEL[kind] || (nas.extOf(x.name) || '파일').toUpperCase(), fmtSize(x.size), fmtDate(x.mtime)].filter(Boolean).join(' · ');
  const open = kind
    ? `<a class="dv-row file" href="${fileHref(x.path)}" target="_blank" rel="noopener" data-dv-open="${esc(kind)}" data-dv-src="${esc(fileHref(x.path))}" data-dv-dl="${esc(fileHref(x.path, true))}" data-dv-title="${esc(x.name)}" data-name="${esc(x.name.toLowerCase())}">`
    : `<a class="dv-row file" href="${esc(fileHref(x.path, true))}" data-name="${esc(x.name.toLowerCase())}">`;
  return `${open}<span class="dv-ic k-${esc(kind || 'other')}">${ui.icon(ICON[kind])}</span><span class="dv-main"><span class="dv-name">${esc(x.name)}</span><span class="dv-sub">${esc(sub)}</span></span>${kind ? `<span class="dv-play">${kind === 'video' || kind === 'audio' ? '재생' : '열기'}</span>` : '<span class="dv-play">받기</span>'}</a>`;
}

router.get('/drive', requireMember, async (req, res) => {
  const ctx = req.ctx;
  const team = ctx.current || '';
  const hero = pageShell.hero({ eyebrow: `${team ? team + ' · ' : ''}드라이브`, title: '드라이브', sub: '미디어팀 NAS — 영상 · 음원 · 사진' });
  let body;
  try {
    const d = await nas.list(req.query.p);
    const parent = d.path && d.path !== nas.topPath() ? d.path.split('/').slice(0, -1).join('/') : null;
    const nFiles = d.items.filter((x) => !x.dir).length, nDirs = d.items.length - nFiles;
    body = `<div class="ph-card dv-card">
      ${crumbs(d.path)}
      <div class="dv-tools">
        ${parent !== null ? `<a class="ph-btn dv-up" href="${href(parent === nas.topPath() ? '' : parent)}">← 위로</a>` : ''}
        <input type="search" class="dv-filter" placeholder="이 폴더에서 이름 찾기" aria-label="이 폴더에서 이름 찾기" autocomplete="off">
      </div>
      <p class="ph-sub dv-count">${d.path ? `폴더 ${nDirs} · 파일 ${nFiles}` : `공유 폴더 ${nDirs}`}${d.total > d.items.length + 50 ? ' · 일부만 보여요' : ''}</p>
      <div class="dv-list">${d.items.map(row).join('') || '<p class="ph-sub">빈 폴더예요.</p>'}</div>
      <p class="ph-sub dv-none" hidden>찾는 이름이 없어요.</p>
    </div>`;
  } catch (e) {
    if (!e.user) console.error('[드라이브]', e);
    const st = nas.status();
    body = `<div class="ph-card"><h2 class="ph-h2">드라이브를 열지 못했어요</h2><p class="ph-sub">${esc(e.user ? e.message : '잠시 뒤에 다시 시도해주세요.')}</p>
      <a class="ph-btn" href="${href('')}">다시 시도</a>
      ${ctx.isAdmin ? `<details class="dv-admin"><summary>관리자용 연결 정보</summary><ul>
        <li>아이디: ${esc(st.user)} · 비밀번호(NAS_PASSWORD): ${st.configured ? '설정됨' : '<b>없음</b>'}</li>
        <li>${st.url ? `직접 주소(NAS_URL): ${esc(st.url)}` : `QuickConnect ID: ${esc(st.quickConnectId)}`}${st.root ? ` · 보이는 폴더(NAS_ROOT): ${esc(st.root)}` : ''}</li>
        ${st.tried.length ? `<li>시도한 주소: ${st.tried.map(esc).join(', ')}</li>` : ''}
        <li>QuickConnect 로 안 되면 NAS 의 외부 주소(DDNS, 예: https://youngnakmedia.synology.me:5001)를 Render 환경변수 NAS_URL 에 넣어 주세요.</li>
      </ul></details>` : ''}</div>`;
  }
  const content = `${pageShell.hubNav('drive', team)}${hero}${body}`;
  await spa.send(req, res, content, { title: '드라이브', scripts: `<script src="/js/drive.js?v=${DRIVE_JS_V}" defer></script>` });
});

router.get('/drive/file', requireMember, async (req, res) => {
  try {
    await nas.stream(req.query.p, res, req.get('range') || '', req.query.dl === '1');
  } catch (e) {
    if (!e.user) console.error('[드라이브 파일]', e);
    if (!res.headersSent) res.status(e.code === 'NAS_NOT_FOUND' || e.code === 'NAS_FILE' ? 404 : 502).type('text').send(e.user ? e.message : '파일을 열지 못했어요.');
    else res.destroy();
  }
});

module.exports = router;
