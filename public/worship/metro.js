/**
 * 메트로놈 + 박자에 맞춘 음성 큐 (Web Audio)
 * ------------------------------------------------------------
 * ▣ 박자가 흔들리지 않는 이유
 *    클릭은 "지금 소리 내기"가 아니라 오디오 시계(AudioContext.currentTime)에 미리 예약합니다.
 *    타이머는 25ms 마다 깨어나 앞으로 120ms 안에 올 박자만 예약하는 일만 합니다 (표준 lookahead 방식).
 *    그래서 화면이 잠깐 멈추거나 음성 합성이 돌아가도 박자 간격은 오디오 하드웨어가 지킵니다.
 *    음성 큐는 소리를 "만드는" 것이 아니라 정해진 박자에 맞춰 시작 시각만 맞추므로 클릭 예약을 건드리지 않습니다.
 * ▣ 큐를 박자에 맞추는 법
 *    음성은 시작 명령을 내린 뒤 실제로 소리가 나기까지 시간이 걸립니다 (기기마다 100~500ms).
 *    이 지연을 onstart 로 측정해 두었다가 그만큼 일찍 시작해 "단어가 박자 위에 떨어지게" 합니다.
 *      · 'downbeat' 다음 마디 첫 박에 단어가 떨어지게        · 'lead' 다음 마디 첫 박 N박 전에 안내를 시작 (기본 2박)
 *      · 'now'      가장 가까운 박에
 * 이 파일은 브라우저와 Node(시험) 양쪽에서 쓰고, 시계 · 소리 부분은 주입받아 시험할 수 있게 나누어 두었습니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YNMetro = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 음성 큐 — 영어(기본) · 한국어 */
  var CUES = [
    { id: 'v1', en: 'Verse 1', ko: '1절', g: 'sec' }, { id: 'v2', en: 'Verse 2', ko: '2절', g: 'sec' }, { id: 'v3', en: 'Verse 3', ko: '3절', g: 'sec' }, { id: 'v4', en: 'Verse 4', ko: '4절', g: 'sec' },
    { id: 'c', en: 'Chorus', ko: '후렴', g: 'sec' }, { id: 'pc', en: 'Pre-chorus', ko: '프리코러스', g: 'sec' }, { id: 'b', en: 'Bridge', ko: '브릿지', g: 'sec' },
    { id: 'intro', en: 'Intro', ko: '인트로', g: 'sec' }, { id: 'itld', en: 'Interlude', ko: '간주', g: 'sec' }, { id: 'vamp', en: 'Vamp', ko: '뱀프', g: 'sec' },
    { id: 'end', en: 'Ending', ko: '엔딩', g: 'sec' },
    { id: 'voice', en: 'Voice', ko: '보이스', g: 'dyn' }, { id: 'break', en: 'Break', ko: '브레이크', g: 'dyn' }, { id: 'die', en: 'Die down', ko: '작게', g: 'dyn' },
    { id: 'ferm', en: 'Fermata', ko: '늘임표', g: 'dyn' }, { id: 'solo', en: 'Solo', ko: '솔로', g: 'dyn' },
    { id: 'repc', en: 'Repeat Chorus', ko: '코러스 반복', g: 'rep' }, { id: 'halfc', en: 'Half Chorus', ko: '코러스 반', g: 'rep' },
    { id: 'tag', en: 'Tag', ko: '끝 소절 반복', g: 'rep' }, { id: 'lastl', en: 'Last line again', ko: '마지막 줄 한 번 더', g: 'rep' },
    { id: 'once', en: 'One more time', ko: '한 번 더', g: 'rep' }, { id: 'onebar', en: 'One more bar', ko: '한마디 더', g: 'rep' },
    { id: 'sess', en: 'Session in', ko: '세션 인', g: 'in' }, { id: 'alto', en: 'Alto in', ko: '알토 인', g: 'in' }, { id: 'tenor', en: 'Tenor in', ko: '테너 인', g: 'in' },
    { id: 'keyup', en: 'Key Up', ko: '키 업', g: 'rep' }, { id: 'prayer', en: 'Prayer', ko: '기도', g: 'rep' },
    { id: 'vonly', en: 'Voice only', ko: '보이스만', g: 'dyn' }, { id: 'drums', en: 'Drums only', ko: '드럼만', g: 'dyn' }, { id: 'build', en: 'Build up', ko: '빌드 업', g: 'dyn' },
    { id: 'lastc', en: 'Last Chorus', ko: '마지막 후렴', g: 'rep' }, { id: 'bigend', en: 'Big ending', ko: '크게 마무리', g: 'dyn' }, { id: 'slow', en: 'Slow down', ko: '느리게', g: 'dyn' }, { id: 'hold', en: 'Hold', ko: '멈춰 끌기', g: 'dyn' },      // V836 — 콜아웃 확장 창용      // v8.34 — Step 2.11 — 배열 끝에 추가 (기존 큐의 소리 번호는 그대로)
    { id: 'c2', en: 'Chorus 2', ko: '후렴 2', g: 'sec' }, { id: 'c3', en: 'Chorus 3', ko: '후렴 3', g: 'sec' }, { id: 'pc2', en: 'Pre-chorus 2', ko: '프리코러스 2', g: 'sec' },   // V842 — C2 는 "Chorus 2"
    { id: 'b2', en: 'Bridge 2', ko: '브릿지 2', g: 'sec' }, { id: 'inst', en: 'Instrumental', ko: '연주', g: 'sec' },
    { id: 'cvoice', en: 'Chorus Voice only', ko: '후렴 보컬만', g: 'sec' }   // 송폼 C(Voice) — 악기 없이 목소리로만 부르는 후렴
  ];
  var CUE_BY = {};
  CUES.forEach(function (c) { CUE_BY[c.id] = c; });

  /* v8.39 — 숫자로 세기(1·2·3·4) · 콜아웃 뒤 카운트다운(Three·Two·One) 에 쓰는 숫자 말 — CUES 와는 별도(패널에 버튼으로 뜨지 않음) */
  var NUM_EN = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen'];
  /* 콜아웃에 덧붙이는 낱말 — "Interlude" + "Two" + "measures" 처럼 이어서 부를 때 (패널에 버튼으로 뜨지 않음, tools/gen-cues.py 가 녹음) */
  var WORD_EN = [{ id: 'meas', en: 'measures' }, { id: 'meas1', en: 'measure' }];
  var MEAS_RE = /~m(\d{1,2})$/;                    // 큐 id 뒤 "~m2" = 2마디 (예: 'itld~m2' → "Interlude 2 measures")
  var NUM_KO = ['하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '열하나', '열둘', '열셋', '열넷', '열다섯', '열여섯'];

  var LIMITS = { minBpm: 30, maxBpm: 300, minPitch: -12, maxPitch: 12, maxGain: 6 };
  /** 박마다 ">" 강세 표시 — 기본은 마디 첫 박만 (사용자가 원 모양 박을 눌러 바꿉니다) */
  function defaultMarks(num, first) { var a = []; for (var i = 0; i < num; i++) a.push(i === 0 && first !== false ? 1 : 0); return a; }
  function clamp(v, lo, hi) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; }

  /* ============================================================
     남성 음성 고르기 — window.speechSynthesis 의 음성 목록에서 남성 음성을 찾습니다
     ============================================================ */
  var MALE_RE = /\b(male|man|andrew|davis|jason|tony|jacob|bruce|guy|daniel|alex|fred|tom|aaron|arthur|oliver|rishi|gordon|lee|reed|evan|nathan|ralph|albert|bruce|junior|david|mark|george|guy|james|richard|ryan|mike|paul|liam|eric|brian|christopher|roger|steffan|thomas|rocko|eddy|grandpa|injoon|in-joon|minsu|jinho|seongmin|hyunsu|junho|jun-?ho|seojun|bongjin|gijun)\b|남성|남자|인준|민수|진호|현수/i;
  var FEMALE_RE = /\b(female|woman|samantha|victoria|karen|moira|tessa|fiona|zira|susan|hazel|jenny|aria|yuna|sun-?hi|heami|sora|kyoko|kanya|sara|allison|ava|joanna|kendra|kimberly|salli|ivy|emma|amy|nicky|catherine|serena|shelley|sandy|flo|grandma|kathy|princess|bella|zoe|mei-?jia|ting-?ting|sin-?ji|seoyeon|jimin|sunhi)\b|google\s*한국어|여성|여자|유나|선희|혜미/i;
  /** V838 — 직접 입력한 글에 한글이 있으면 한국어 음성으로, 아니면 영어 음성으로 (큐 언어 설정과 상관없이 글자 그대로) */
  function langOfText(t) { return /[\u3131-\u318e\uac00-\ud7a3]/.test(String(t == null ? '' : t)) ? 'ko' : 'en'; }
  function isMaleVoice(v) { var n = String((v && v.name) || ''); return !!n && MALE_RE.test(n) && !FEMALE_RE.test(n); }
  function isFemaleVoice(v) { return FEMALE_RE.test(String((v && v.name) || '')); }
  /**
   * voices 목록에서 언어(en · ko)에 맞는 음성을 고릅니다.
   * gender 'male'(기본): 남성 이름의 음성 → 없으면 (여성 이름이 아닌 것 → 그래도 없으면) 아무거나. 기기 안 음성 우선.
   * gender 'female': 여성 음성 우선. 'any': 성별 상관없음.
   */
  /* 기계음처럼 들리는 옛 음성 · 효과음 음성 — 다른 선택지가 있으면 고르지 않습니다 */
  var ROBOT_RE = /\b(fred|albert|junior|ralph|kathy|bad news|good news|bahh|bells|boing|bubbles|cellos|deranged|hysterical|organ|superstar|trinoids|whisper|wobble|zarvox|jester|espeak|compact|eddy|reed|rocko|sandy|shelley|flo|grandma|grandpa|bruce|princess)\b/i;
  /** 자연스러움 점수 — 신경망(Natural · Neural · Online) · 고음질(Premium · Enhanced · Siri) 음성이 높고, 기기 안 음성 · 기본 음성이 조금 유리 */
  function voiceScore(v) {
    var n = String((v && v.name) || ''), sc = 0;
    if (/natural|neural|online/i.test(n)) sc += 14;
    if (/premium|enhanced|siri|studio|wavenet/i.test(n)) sc += 8;
    if (ROBOT_RE.test(n)) sc -= 20;
    if (v && v.localService) sc += 3;
    if (v && v.default) sc += 1;
    if (/^en[-_]?us/i.test(String((v && v.lang) || ''))) sc += 5;           // 미국식 영어를 영국식보다 우선 (예전에는 영국식 Daniel 이 먼저 뽑혀 영국 억양으로 들렸음)
    return sc;
  }
  function pickVoiceFrom(voices, lang, gender) {
    var want = lang === 'ko' ? 'ko' : 'en';
    var list = (voices || []).filter(function (v) { return String(v.lang || '').toLowerCase().replace('_', '-').indexOf(want) === 0; });
    var best = function (a) { var top = null, ts = -1e9; a.forEach(function (v) { var sc = voiceScore(v); if (sc > ts) { top = v; ts = sc; } }); return top; };   // 점수가 같으면 목록에서 먼저 나온 것
    if (gender === 'male') {
      var m = list.filter(isMaleVoice); if (m.length) return best(m);
      var u = list.filter(function (v) { return !isFemaleVoice(v); }); if (u.length) return best(u);
    } else if (gender === 'female') {
      var f = list.filter(isFemaleVoice); if (f.length) return best(f);
    }
    return best(list);
  }
  /**
   * 여러 목소리 돌려쓰기 (gender 'mix') — 미국 영어(en-US) 남 · 여 음성을 자연스러운 순서로 최대 6개 골라, 콜아웃마다 바꿔 가며 씁니다.
   * 직전에 쓴 음성은 피하고(후보가 둘 이상일 때), 기계음 음성은 다른 선택지가 있으면 쓰지 않습니다. 한국어는 그대로 한 명.
   * rnd 는 시험용으로 바꿀 수 있는 난수 (0 ≤ r < 1).
   */
  function mixPool(voices, lang) {
    var want = lang === 'ko' ? 'ko' : 'en';
    var all = (voices || []).filter(function (v) { return String(v.lang || '').toLowerCase().replace('_', '-').indexOf(want) === 0; });
    if (want === 'en') { var us = all.filter(function (v) { return /^en-us/i.test(String(v.lang || '').replace('_', '-')); }); if (us.length) all = us; }
    var good = all.filter(function (v) { return !ROBOT_RE.test(String(v.name || '')); }); if (good.length) all = good;
    var seen = {}, uniq = [];
    all.slice().sort(function (a, b) { return voiceScore(b) - voiceScore(a); }).forEach(function (v) { if (!seen[v.name]) { seen[v.name] = 1; uniq.push(v); } });
    return want === 'ko' ? uniq.slice(0, 1) : uniq.slice(0, 6);
  }
  function pickVoiceMix(voices, lang, lastName, rnd) {
    var pool = mixPool(voices, lang); if (!pool.length) return null;
    var c = pool.length > 1 ? pool.filter(function (v) { return v.name !== lastName; }) : pool;
    return c[Math.floor((typeof rnd === 'number' ? rnd : Math.random()) * c.length) % c.length];
  }
  /** 남성 음성을 못 찾았을 때 낮은 목소리로 들리게 하는 음높이 (0.1 ~ 2, 기본 1) */
  var MALE_FALLBACK_PITCH = 0.82;      // 너무 낮추면 오히려 기계음처럼 들려서 살짝만

  /* ============================================================
     Sched — 시간만 다루는 순수한 부분 (소리 없음 · 브라우저 없음)
     ============================================================ */
  function Sched(opt) {
    opt = opt || {};
    this.now = opt.now;                              // () → 초 (오디오 시계)
    this.lookahead = opt.lookahead || 0.12;
    this.bpm = clamp(opt.bpm || 72, LIMITS.minBpm, LIMITS.maxBpm);
    this.num = Math.round(clamp(opt.num || 4, 1, 16));
    this.den = opt.den === 8 ? 8 : 4;
    this.marks = defaultMarks(this.num, opt.first);
    this.running = false;
    this.nextTime = 0;
    this.beat = 0;                                   // 다음에 예약할 박 (0 = 마디 첫 박, 아래 "원래 박" — 소리 간격은 항상 이것으로 계산)
    this.bar = 0;
    this.count = 0;                                  // 시작부터 센 박 번호
    this.countInBars = 0;
    this.phase = 0;                                  // v8.39 — "1박 다시 맞추기": 어느 원래 박을 "1박"으로 보여줄지 (소리 간격은 안 건드리고 표시만 밉니다)
  }
  Sched.prototype.interval = function () { return 60 / this.bpm; };
  /** 원래 박(raw) → 사용자가 다시 맞춘 "표시 박" (0 = 지금 "1박"이라고 정한 박) */
  Sched.prototype.effBeat = function (raw) {
    var n = this.num, p = this.phase || 0;
    return ((raw - p) % n + n) % n;
  };
  /**
   * v8.39 — "1박 다시 맞추기": 지금(=부르는 순간)과 가장 가까운 원래 박을 찾아 그 박을 새 "1박"으로 정합니다.
   * 딸깍 소리의 시각 · 간격은 전혀 건드리지 않고, 어느 박을 "1박"이라 부를지(표시 · 강세 · 음성 큐 기준)만 옮깁니다.
   */
  Sched.prototype.markNow = function () {
    if (!this.running) return null;
    var itv = this.interval(), k = Math.round((this.now() - this.nextTime) / itv);
    var raw = ((this.beat + k) % this.num + this.num) % this.num;
    this.phase = raw;
    return this.effBeat(raw);                        // 항상 0 (방금 그 박이 이제 "1박")
  };
  Sched.prototype.start = function (countInBars, delay) {
    this.running = true;
    this.beat = 0; this.bar = 0; this.count = 0; this.phase = 0;
    this.countInBars = Math.max(0, Math.round(countInBars || 0));
    this.nextTime = this.now() + (delay == null ? 0.06 : delay);
  };
  /** V842 — "누르는 순간이 1박": 박자를 멈추지 않고, 지금(+delay)을 새 마디의 첫 박으로 다시 시작합니다 (간격은 그대로) */
  Sched.prototype.restartNow = function (delay) {
    this.running = true; this.beat = 0; this.phase = 0; this.countInBars = 0;
    this.nextTime = this.now() + (delay == null ? 0.03 : delay);
    return this.nextTime;
  };
  Sched.prototype.stop = function () { this.running = false; };
  /**
   * 강세 — 2: ">" 표시한 박 (기본은 마디 첫 박 · 더 높고 크게) · 1: 겹박자(6/8 등)의 3박 묶음 첫 박 · 0: 나머지
   * 어느 박에 ">" 를 붙일지는 marks 배열이 정합니다 (setMark / toggleMark).
   */
  Sched.prototype.accent = function (beat) {
    var eb = this.effBeat(beat);                      // v8.39 — 강세는 "표시 박" 기준(다시 맞춘 1박에 맞춰 ">" 가 따라옵니다)
    if (this.marks[eb] === 3) return 0;               // V859 — 3 = 이 박은 소리 끔 (muted 로 따로 확인)
    if (this.marks[eb]) return 2;
    if (eb !== 0 && this.den === 8 && this.num % 3 === 0 && eb % 3 === 0) return 1;
    return 0;
  };
  /** V859 — 이 박을 소리 없이 (박 동그라미를 눌러 고름: 보통 → ">" 강세 → 끔 → 보통) */
  Sched.prototype.muted = function (beat) { return this.marks[this.effBeat(beat)] === 3; };
  Sched.prototype.setMark = function (i, on) {
    i = Math.round(Number(i));
    if (!(i >= 0 && i < this.num)) return false;
    this.marks[i] = on ? 1 : 0; return true;
  };
  Sched.prototype.toggleMark = function (i) {
    i = Math.round(Number(i));
    if (!(i >= 0 && i < this.num)) return null;
    var v = this.marks[i];
    this.marks[i] = v === 3 ? 0 : v ? 3 : 1;          // V859 — 보통 → 강세 → 끔 → 보통
    return this.marks[i] === 3 ? 'mute' : !!this.marks[i];
  };
  /** 통째로 바꾸기 (다른 기기에서 받은 강세) — 박 수에 맞게 자르거나 채웁니다 */
  Sched.prototype.setMarks = function (arr) {
    if (!Array.isArray(arr)) return false;
    var a = [];
    for (var i = 0; i < this.num; i++) a.push(arr[i] === 3 ? 3 : arr[i] ? 1 : 0);      // V859 — 3 = 끈 박
    this.marks = a; return true;
  };
  /**
   * 정해진 시각(앵커 = 어떤 마디의 첫 박이 울려야 하는 오디오 시계 시각)에 맞춰 시작합니다.
   * 앵커가 아직 오지 않았으면 그 시각에 첫 박부터, 이미 지났으면 박 위치(위상)를 그대로 유지한 채 다음 박부터 이어 갑니다.
   * 여러 기기가 같은 앵커(서버 시각 기준)를 쓰면 각자 오디오를 내면서도 박이 겹칩니다.
   */
  Sched.prototype.startAt = function (anchor, countInBars) {
    var itv = this.interval(), now = this.now(), k = 0;
    this.running = true; this.phase = 0;
    this.countInBars = Math.max(0, Math.round(countInBars || 0));
    if (anchor < now + 0.02) k = Math.ceil((now + 0.02 - anchor) / itv);
    this.count = k; this.beat = k % this.num; this.bar = Math.floor(k / this.num);
    this.nextTime = anchor + k * itv;
    return { skipped: k, nextTime: this.nextTime };
  };
  /**
   * 앞으로 lookahead 안에 올 박을 모두 예약 목록으로 돌려줍니다.
   * 타이머가 늦게 깨어나도(최대 lookahead 만큼) 박은 하나도 빠지지 않고, 시각은 항상 시작 시각 + n × 간격 입니다.
   */
  Sched.prototype.tick = function () {
    var out = [];
    if (!this.running) return out;
    var until = this.now() + this.lookahead;
    var guard = 0;
    while (this.nextTime < until && guard++ < 64) {
      out.push({ time: this.nextTime, beat: this.effBeat(this.beat), bar: this.bar, count: this.count, accent: this.accent(this.beat), mute: this.muted(this.beat),
        countIn: this.bar < this.countInBars });
      this.nextTime += this.interval();               // 템포를 바꿔도 이미 정해진 박은 그대로, 다음 박부터 새 간격
      this.count++; this.beat++;
      if (this.beat >= this.num) { this.beat = 0; this.bar++; }
    }
    return out;
  };
  Sched.prototype.setBpm = function (b) { this.bpm = clamp(b, LIMITS.minBpm, LIMITS.maxBpm); };
  Sched.prototype.setSig = function (num, den) {
    var same = Math.round(clamp(num, 1, 16)) === this.num && (den === 8 ? 8 : 4) === this.den;
    var first = this.marks[0] ? true : false;
    this.num = Math.round(clamp(num, 1, 16)); this.den = den === 8 ? 8 : 4;
    if (!same) this.marks = defaultMarks(this.num, first);          // 박자를 바꾸면 강세는 기본(첫 박)으로
    this.phase = 0;                                                 // 박자가 바뀌면 "1박 다시 맞추기"도 초기화
    if (this.beat >= this.num) { this.beat = 0; this.bar++; }
  };

  /**
   * 큐를 언제 말할지 정합니다.
   *   speakAt : 음성 "시작 명령"을 내릴 시각 (= 단어가 박 위에 떨어지도록 지연만큼 앞당김)
   *   landAt  : 단어가 실제로 들릴 시각 (박의 시각)
   *   mode    : 'downbeat' | 'lead' | 'now'
   * 이미 늦었으면(명령을 내릴 시각이 지났으면) 다음 기회로 미룹니다 — 박자를 억지로 따라가지 않습니다.
   */
  Sched.prototype.planCue = function (mode, o) {
    o = o || {};
    var lat = o.latency == null ? 0.18 : o.latency, margin = o.margin == null ? 0.03 : o.margin;
    var lead = Math.round(clamp(o.leadBeats == null ? 2 : o.leadBeats, 1, 8));
    var itv = this.interval(), t0 = this.nextTime, n = this.num, now = this.now();
    if (!this.running) return { ok: false, reason: 'stopped' };
    // k: 아직 예약 전인 박 중 k 번째 (0 = 다음 박) — 이미 예약된 박은 소리가 나갔거나 곧 나갑니다
    var effNow = this.effBeat(this.beat);                 // v8.39 — "다음 첫 박"은 다시 맞춘 1박 기준
    var toDown = (n - effNow) % n;                        // 다음(표시) 첫 박까지 남은 박 수
    var k;
    if (mode === 'now') k = 0;
    else if (mode === 'lead') k = toDown - lead;
    else k = toDown;
    var guard = 0;
    while (guard++ < 64) {
      if (k >= 0 && (t0 + k * itv) - lat >= now + margin) break;
      k += (mode === 'now') ? 1 : n;
    }
    var landAt = t0 + k * itv;
    var beatIdxRaw = (this.beat + k) % n;
    var targetDown = k + ((n - beatIdxRaw) % n);
    return { ok: true, mode: mode, k: k, landAt: landAt, speakAt: landAt - lat, downbeatAt: t0 + targetDown * itv, beat: this.effBeat(beatIdxRaw),
      bar: this.bar + Math.floor((this.beat + k) / n) };
  };

  /** 탭 템포 — 마지막 탭들의 평균 간격 (2.5초 넘게 쉬면 새로 시작) */
  function TapTempo() { this.t = []; }
  TapTempo.prototype.tap = function (nowMs) {
    if (this.t.length && nowMs - this.t[this.t.length - 1] > 2500) this.t = [];
    this.t.push(nowMs);
    if (this.t.length > 6) this.t.shift();
    if (this.t.length < 2) return null;
    var span = this.t[this.t.length - 1] - this.t[0];
    return Math.round(clamp(60000 / (span / (this.t.length - 1)), LIMITS.minBpm, LIMITS.maxBpm));
  };
  TapTempo.prototype.reset = function () { this.t = []; };

  /* ============================================================
     Metronome — 소리 · 음성 · 타이머 (브라우저)
     ============================================================ */
  function store(key, val) {
    try {
      if (typeof localStorage === 'undefined') return null;
      if (val === undefined) { var v = localStorage.getItem('yn.metro.' + key); return v == null ? null : JSON.parse(v); }
      localStorage.setItem('yn.metro.' + key, JSON.stringify(val));
    } catch (e) { /* 저장이 막힌 브라우저 — 기억만 못 할 뿐입니다 */ }
    return null;
  }

  /** 소리가 안 나는 이유가 코드가 아니라 기기 설정일 때가 많아서, 한국어로 안내합니다 */
  var HELP = {
    noAudio: '이 브라우저는 소리 재생(Web Audio)을 지원하지 않습니다. 최신 Safari · Chrome 으로 열어주세요.',
    blocked: '브라우저가 소리를 막고 있습니다. 화면을 한 번 누른 뒤 다시 시작해주세요. (아이폰은 무음 스위치도 확인해주세요)',
    noSpeech: '이 기기는 음성 안내를 지원하지 않아 "삐" 소리 패턴으로 대신 알려드립니다.'
  };

  /* ============================================================
     무음(진동) 모드에서도 소리 내기
     ------------------------------------------------------------
     아이폰 · 아이패드는 무음 스위치가 켜져 있으면 Web Audio 를 "벨소리 채널"로 보내 소리를 죽입니다.
     해결은 두 가지를 함께 씁니다 (기기 · iOS 버전마다 통하는 쪽이 달라서).
       ① navigator.audioSession.type = 'playback'  — Safari 16.4+ 가 지원하는 공식 방법 ("미디어 재생" 채널로 분류)
       ② 소리 없는 <audio> 를 반복 재생 — 예전 iOS 는 <audio> 가 재생 중이면 Web Audio 도 미디어 채널로 나갑니다
     반드시 사용자가 화면을 누른 순간(시작 버튼 · 큐 버튼)에 시작해야 하고, 메트로놈을 멈추면 함께 멈춥니다 (배터리).
     Mac · 안드로이드 · 컴퓨터에는 무음 스위치가 없어 ①② 는 조용히 아무 일도 하지 않습니다.
     ============================================================ */
  var silentUrl = null;
  /** 1초 길이의 소리 없는 WAV (16bit · 8kHz · 진폭 0) — 파일 없이 코드로 만들어 Blob 주소로 씁니다 */
  function silentWavUrl() {
    if (silentUrl) return silentUrl;
    try {
      var rate = 8000, n = rate, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
      var w = function (o, str) { for (var i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    } catch (e) { silentUrl = null; }
    return silentUrl;
  }
  var Media = {
    el: null, on: false,
    /** 사용자가 누른 순간에 부르세요. 이미 켜져 있으면 아무 일도 하지 않습니다 */
    start: function () {
      if (typeof window === 'undefined' || typeof document === 'undefined') return false;
      try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { /* 지원하지 않는 브라우저 */ }
      try {
        if (!Media.el) {
          var url = silentWavUrl(); if (!url) return false;
          var a = document.createElement('audio');
          a.src = url; a.loop = true; a.preload = 'auto'; a.setAttribute('playsinline', ''); a.setAttribute('aria-hidden', 'true'); a.volume = 0.01; a.style.display = 'none';
          Media.el = a;
        }
        Media.on = true;
        var pr = Media.el.play(); if (pr && pr.catch) pr.catch(function () { Media.on = false; });
      } catch (e) { Media.on = false; }
      try {
        if (navigator.mediaSession) {                                       // 잠금 화면 · 제어 센터에 "재생 중"으로 보여 백그라운드에서도 소리가 이어지게 합니다
          if (typeof MediaMetadata !== 'undefined' && !Media.meta) { Media.meta = true; navigator.mediaSession.metadata = new MediaMetadata({ title: '메트로놈', artist: '세션 / 연습' }); }
          navigator.mediaSession.playbackState = 'playing';
        }
      } catch (e) { /* 무시 */ }
      return true;
    },
    /** v6.9 — 라이브 악보를 열어 둔 동안은 소리 없는 재생을 계속 켜 둡니다 (hold). 멈췄다 켜는 사이에 무음 스위치가 음성을 죽이던 틈과, 사용자가 누르지 않은 원격 큐(콜아웃)가 무음이 되던 문제를 막습니다. */
    hold: false,
    setHold: function (on) {
      Media.hold = !!on;
      if (on) { if (!Media.el || Media.el.paused) Media.start(); return !!(Media.el && !Media.el.paused); }
      Media.stop(true); return false;
    },
    stop: function (force) {
      if (Media.hold && !force) return;                                   // 유지 중이면 멈추지 않음
      Media.on = false;
      try { if (Media.el) Media.el.pause(); } catch (e) { /* 무시 */ }
      try { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'none'; } catch (e) { /* 무시 */ }
    },
    release: function () {
      Media.hold = false; Media.stop(true);
      try { if (Media.el) { Media.el.removeAttribute('src'); Media.el.load(); } } catch (e) { /* 무시 */ }
      Media.el = null;
      if (silentUrl) { try { URL.revokeObjectURL(silentUrl); } catch (e) { /* 무시 */ } silentUrl = null; }
    }
  };

  /** V836 — 음성 선택값: 'mix'(기본 · 녹음 남성) · 'male' · 'female'(기기 여성 음성) · 'any' · 'live'(기기 음성 실시간 합성) · 'v:<녹음 목소리 id>' · 'rot:m'(남성 번갈아) · 'rot:mf'(남녀 번갈아) */
  function parseSel(v) {
    v = typeof v === 'string' ? v : '';
    if (/^v:[a-z0-9_]+$/.test(v) || v === 'rot:m' || v === 'rot:mf' || v === 'live' || v === 'female' || v === 'any' || v === 'male') return v;
    return 'mix';
  }
  function legacyGender(sel) {
    if (/^v:a?f_/.test(sel) || sel === 'female') return 'female';
    if (sel === 'any') return 'any';
    if (sel === 'rot:mf' || sel === 'mix') return 'mix';
    return 'male';
  }

  function create(opt) {
    opt = opt || {};
    var AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
    var ctx = null, worker = null, timer = null, raf = 0, destroyed = false;
    var sched = new Sched({ now: function () { return ctx ? ctx.currentTime : 0; }, bpm: opt.bpm || 72, num: opt.num || 4, den: opt.den || 4 });
    var tapper = new TapTempo();
    var q = [];                       // 화면에 보여줄 박 (소리가 나는 때에 맞춰 깜빡임)
    var pending = [];                 // 예약해 둔 큐 {plan, cue, timeout}
    /* v8.39 — 숫자로 세기 */
    var pendingCount = false, countRemain = 0;             // 버튼: 다음 마디(1박부터)를 딸깍 대신 숫자로
    var countdownArmed = false, countdownActive = false, countdownAt = 0;   // V856 — countdownAt: 콜아웃이 떨어지는 1박의 오디오 시각 (그 마디에서만 셈)   // 옵션: 콜아웃이 떨어진 마디의 마지막 3박에서 Three·Two·One (딸깍과 함께)
    var S = {
      click: store('vol'), voice: store('voice'), pitch: store('pitch'), flash: store('flash'), flashall: store('flashall'), mode: store('mode'), lead: store('lead'), lang: store('lang'), gender: store('gender'), lat: store('lat'), sound: store('sound'), first: store('first'), speak: store('speak'), countdown: store('countdown'), cdskip: store('cdskip'), cdreset: store('cdreset')
    , sub: store('sub'), countall: store('countall') };
    var cfg = {
      click: S.click == null ? 0.62 : clamp(S.click, 0, 1), voice: S.voice == null ? 1 : clamp(S.voice, 0, 2), mode: S.mode || 'lead', lead: S.lead || 2,
      lang: S.lang || 'en', voiceSel: parseSel(S.gender), gender: legacyGender(parseSel(S.gender)), lat: S.lat == null ? 180 : S.lat, sound: S.sound || 'wood',
      speak: S.speak !== false,                                  // 음성 콜아웃(TTS) 켬(기본)/끔 — 끄면 큐 이름을 소리로 말하지 않습니다 (Step 2.15)
      first: S.first === true,                                   // 첫 박 강세 (기본 끔 — 4박이 모두 같은 소리) — 켜면 첫 박만 더 높고 크게
      pitch: S.pitch == null ? 0 : clamp(S.pitch, LIMITS.minPitch, LIMITS.maxPitch),   // 딸깍 음높이 (반음 단위, -12 ~ +12)
      flash: S.flash === true,                                   // 화면 전체 깜빡임 (켬/끔)
      flashAll: S.flashall !== false,                            // 켬(기본)이면 모든 박마다, 끄면 첫 박에만 (Step 2.11)
      countdown: S.countdown === true,                           // v8.39 — 콜아웃 뒤 "Three·Two·One" 세어주기 (기본 끔)
      cdReset: S.cdreset !== false,                              // V856 — 3·2·1 켜고 콜아웃을 누르면: 켬(기본) = 바로 다음 박이 새 1박 · 끔 = 박은 그대로 두고 다음 마디 첫 박에 콜아웃
      cdSkip: S.cdskip !== false,                                // V842 — 반복 · 다이내믹 콜아웃에는 Three·Two·One 을 하지 않음 (기본 켬)
      sub: S.sub === 2 ? 2 : 1,                                  // V848 — 2박으로 쪼개기: 4/4 면 한 마디에 8번 (엇박은 작게 · 화면 깜빡임은 4번만)
      countAll: S.countall === true                              // V848 — 딸깍 대신 1 · 2 · 3 · 4 숫자로 세기 (계속)
    };
    sched.setMark(0, cfg.first);
    var voices = [], speechOk = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
    var notify = function (kind, data) { if (opt.onEvent) { try { opt.onEvent(kind, data); } catch (e) { if (typeof console !== 'undefined') console.error(e); } } };

    function loadVoices() {
      if (!speechOk) return;
      var had = voices.length; try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
      if (voices.length !== had && had >= 0 && typeof emitState === 'function' && !destroyed) { try { emitState(); } catch (e) { /* 무시 */ } }
    }
    if (speechOk) {
      loadVoices();
      try { window.speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) { /* 옛 브라우저 */ }
    }
    /** 이름으로 보는 남성 · 여성 음성 (브라우저는 성별 정보를 주지 않아서 이름으로 가려냅니다) */
    var lastMixName = '';
    function koGender() { return cfg.gender === 'female' ? 'female' : 'male'; }                // V838 — 한국어는 남성 음성이 기본 (여성을 골랐을 때만 여성)
    function pickVoice(lang, rotate) {
      if (lang === 'ko') return pickVoiceFrom(voices, 'ko', koGender());
      if (cfg.gender === 'mix') { var mv = pickVoiceMix(voices, lang, rotate ? lastMixName : '', rotate ? undefined : 0); if (mv && rotate) lastMixName = mv.name; return mv; }
      return pickVoiceFrom(voices, lang, cfg.gender);
    }
    function currentVoice(lang) { var v = pickVoice(lang || cfg.lang); return v ? { name: v.name, lang: v.lang, male: isMaleVoice(v), local: !!v.localService } : null; }
    /**
     * 딸깍 소리는 전용 볼륨(master)과 리미터를 거쳐 나갑니다.
     * 볼륨 막대(0~1)가 기본 크기의 0 ~ 5 배 (LIMITS.maxGain) 이고, 리미터가 소리가 찢어지는 것을 막습니다.
     */
    var master = null, limiter = null;
    function gainOf() {                                                     // V836 — 막대 가운데(0.5)가 기본 크기(×1), 오른쪽 끝이 ×maxGain. 왼쪽 절반은 부드럽게 줄어 0 에서 무음
      var s = clamp(cfg.click, 0, 1); if (s < 0.01) return 0;
      return s <= 0.5 ? Math.pow(s / 0.5, 2) : Math.pow(LIMITS.maxGain, (s - 0.5) * 2);
    }
    /** 막대를 오른쪽으로 밀수록 딸깍을 "더 길게 · 더 단단하게" 만듭니다 (0 ~ 1).
     *  소리가 찢어지지 않게 막는 리미터 때문에 순간 크기는 이미 천장에 닿아 있어서, 크기를 더 키워 봐야 들리는 크기가 안 변했습니다 — 소리가 머무는 시간을 늘려야 실제로 커집니다. */
    function loudL() { return clamp((clamp(cfg.click, 0, 1) - 0.4) / 0.6, 0, 1); }
    function ensureCtx() {
      if (ctx) return ctx;
      if (!AC) throw new Error(HELP.noAudio);
      Media.start();
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
      try { ctx.onstatechange = onCtxState; } catch (e) { /* 무시 */ }
      try {
        master = ctx.createGain(); master.gain.value = gainOf();
        if (ctx.createWaveShaper) {
          // v8.34 — 찢어짐 방지는 지연이 없는 소프트 클립(tanh)으로. (DynamicsCompressor 는 구조상 약 6ms 를 미리 보고 있어서 딸깍이 그만큼 늦게 나왔습니다)
          limiter = ctx.createWaveShaper();
          var n = 2048, cv = new Float32Array(n);
          for (var i = 0; i < n; i++) { var x = i * 2 / (n - 1) - 1; cv[i] = Math.tanh(x * 1.5) / Math.tanh(1.5); }
          limiter.curve = cv; limiter.oversample = 'none';
          master.connect(limiter); limiter.connect(ctx.destination);
        } else master.connect(ctx.destination);
      } catch (e) { master = null; limiter = null; }
      return ctx;
    }
    /** 전화 · 알림 · 화면 잠금으로 오디오가 멈춘("suspended" · iOS 는 "interrupted") 뒤 다시 살립니다 — 메트로놈이 돌고 있을 때만 */
    function wake() {
      if (destroyed || !ctx || !sched.running) return;
      Media.start();
      if (ctx.state !== 'running' && ctx.resume) { try { var r = ctx.resume(); if (r && r.catch) r.catch(function () { /* 사용자가 다시 눌러야 하는 경우 */ }); } catch (e) { /* 무시 */ } }
    }
    function onCtxState() { if (ctx && ctx.state !== 'running' && sched.running) wake(); }
    function onVisible() { if (typeof document !== 'undefined' && document.visibilityState === 'visible') wake(); }
    if (typeof document !== 'undefined' && document.addEventListener) { document.addEventListener('visibilitychange', onVisible); if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('pageshow', onVisible); }
    function applyGain() {
      if (master && ctx) { try { master.gain.setTargetAtTime(gainOf(), ctx.currentTime, 0.01); } catch (e) { master.gain.value = gainOf(); } }
    }
    function pitchMul() { return Math.pow(2, clamp(cfg.pitch, LIMITS.minPitch, LIMITS.maxPitch) / 12); }

    /* ---------- 소리 ---------- */
    var SOUNDS = { wood: [1500, 1150, 880, 'square'], beep: [1320, 990, 780, 'sine'], click: [2200, 1700, 1300, 'triangle'] };
    /** 딸깍 말고 다른 소리들 — 모두 오디오 시계에 예약하는 짧은 합성음 (파일 없음) */
    var noiseBuf = null;
    function noise() {
      if (noiseBuf) return noiseBuf;
      var n = Math.round(ctx.sampleRate * 0.12), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return (noiseBuf = b);
    }
    /* V842 — 딸깍 소리는 "회차" 버스를 지나갑니다. 1박을 다시 맞출 때(누르는 순간 = 1박) 이미 예약해 둔 옛 딸깍을 이 버스째 꺼서
       엇박으로 한 번 더 울리는 일이 없게 합니다. clickMul 은 숫자로 셀 때 딸깍을 작게 깔아 주는 배율 */
    var clickBus = null, clickMul = 1;
    function cbus() {
      if (!clickBus) { clickBus = ctx.createGain(); clickBus.gain.value = 1; clickBus.connect(master || ctx.destination); }
      return clickBus;
    }
    function cutScheduled() {
      if (clickBus) { try { clickBus.gain.cancelScheduledValues(ctx.currentTime); clickBus.gain.setValueAtTime(0, ctx.currentTime); var old = clickBus; setTimeout(function () { try { old.disconnect(); } catch (e) {} }, 800); } catch (e) {} clickBus = null; }
      numSrcs.forEach(function (x) { try { if (x.t > ctx.currentTime) x.src.stop(); } catch (e) {} }); numSrcs = [];
    }
    var numSrcs = [], COUNT_CLICK = 0.38;
    function tone(time, type, f0, f1, peak, dur, extra) {
      peak = peak * clickMul;
      dur = dur * (1 + 1.6 * loudL());
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, time); if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, time + dur * 0.8);
      g.gain.setValueAtTime(0.0001, time); g.gain.linearRampToValueAtTime(peak, time + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(g); g.connect(cbus());
      o.onended = function () { o.onended = null; try { o.disconnect(); g.disconnect(); } catch (e) { /* 이미 끊김 */ } };
      o.start(time); o.stop(time + dur + 0.02);
    }
    function special(time, accent, countIn, kind) {
      var up = countIn ? 1.4 : accent === 2 ? 1.25 : accent === 1 ? 1.12 : 1, pk = (accent === 2 ? 0.9 : accent === 1 ? 0.75 : 0.6), pm = pitchMul();
      if (kind === 'cowbell') { tone(time, 'square', 540 * up * pm, 0, pk * 0.5, 0.16); tone(time, 'square', 810 * up * pm, 0, pk * 0.5, 0.16); return; }
      if (kind === 'drum') { tone(time, 'sine', 190 * up * pm, 55 * pm, Math.min(1, pk * 1.4), 0.13); return; }
      if (kind === 'soft') { tone(time, 'sine', 880 * up * pm, 0, pk * 0.9, 0.1); return; }
      if (kind === 'stick') { tone(time, 'square', 3000 * up * pm, 0, pk * 0.45, 0.025); tone(time, 'triangle', 1800 * up * pm, 0, pk * 0.6, 0.04); return; }
      if (kind === 'hihat') {
        var src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
        src.buffer = noise(); hp.type = 'highpass'; hp.frequency.value = 6500 * pm;
        g.gain.setValueAtTime(0.0001, time); g.gain.linearRampToValueAtTime(pk * 0.9 * clickMul, time + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, time + (accent === 2 ? 0.07 : 0.04) * (1 + 0.5 * loudL()));
        src.connect(hp); hp.connect(g); g.connect(cbus());
        src.onended = function () { src.onended = null; try { src.disconnect(); hp.disconnect(); g.disconnect(); } catch (e) { /* 이미 끊김 */ } };
        src.start(time); src.stop(time + 0.1);
      }
    }
    var EXTRA = { cowbell: 1, drum: 1, soft: 1, stick: 1, hihat: 1 };
    function click(time, accent, countIn) {
      if (EXTRA[cfg.sound]) return special(time, accent, countIn, cfg.sound);
      var s = SOUNDS[cfg.sound] || SOUNDS.wood;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = s[3]; o.frequency.setValueAtTime((countIn ? 1000 : (accent === 2 ? s[0] : accent === 1 ? s[1] : s[2])) * pitchMul(), time);
      var peak = (accent === 2 ? 0.9 : accent === 1 ? 0.75 : 0.6) * clickMul;               // 강세 박이 더 크게 (전체 크기는 master 볼륨)
      var L = loudL(), hold = 0.075 * L, dec = 0.055 + 0.06 * L;               // V836 — 볼륨을 높일수록 소리가 머무는 시간을 늘려 실제로 더 크게 들리게
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + 0.002);
      if (hold > 0.004) g.gain.setValueAtTime(peak, time + 0.002 + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.002 + hold + dec);
      o.connect(g); g.connect(cbus());
      o.onended = function () { o.onended = null; try { o.disconnect(); g.disconnect(); } catch (e) { /* 이미 끊김 */ } };   // 다 울린 소리 노드는 바로 끊어 메모리에 쌓이지 않게
      o.start(time); o.stop(time + 0.02 + hold + dec + 0.01);
    }
    /** V848 — 2박으로 쪼갤 때의 엇박: 평소 딸깍보다 작고 살짝 높게 */
    function subClick(time) {
      var keep = clickMul; clickMul = keep * 0.5;
      try { click(time, 0, false); } finally { clickMul = keep; }
    }
    /** v8.34 — 소리 없는 딸깍을 한 번 흘려 오디오 경로 · 노드 생성을 미리 데워 둡니다 (첫 딸깍이 늦던 것) */
    var warmed = false;
    function warmClick() {
      if (warmed || !ctx || !master) return; warmed = true;
      try {
        var buf = ctx.createBuffer(1, 256, ctx.sampleRate), src = ctx.createBufferSource(), g = ctx.createGain();
        g.gain.value = 0.00001; src.buffer = buf; src.connect(g); g.connect(master);
        src.onended = function () { src.onended = null; try { src.disconnect(); g.disconnect(); } catch (e) { /* 이미 끊김 */ } };
        src.start(ctx.currentTime);
      } catch (e) { /* 무시 */ }
    }
    /** 음성을 쓸 수 없을 때의 대체 — 종류마다 다른 "삐" 패턴 (오디오 시계에 예약하므로 박에 정확히 맞습니다) */
    var EAR = { sec: [660, 660], dyn: [880], in: [523, 784], rep: [784, 659, 784] };
    function earcon(time, group, idx) {
      var seq = (EAR[group] || EAR.sec).slice();
      if (group === 'sec') { seq = []; for (var i = 0; i < Math.min(4, (idx || 0) + 1); i++) seq.push(660); }
      seq.forEach(function (f, i) {
        var t = time + i * 0.11, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * cfg.voice, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g); g.connect(ctx.destination);
        o.onended = function () { o.onended = null; try { o.disconnect(); g.disconnect(); } catch (e) { /* 이미 끊김 */ } };
        o.start(t); o.stop(t + 0.1);
      });
    }

    /* ---------- 음성 ---------- */
    var latEma = cfg.lat;
    /**
     * 음성 직전에 오디오 경로를 "미디어 재생 중"으로 만듭니다 (무음 스위치 우회, 딸깍 소리와 같은 채널).
     *   ① audioSession = 'playback' + 소리 없는 <audio> 반복 재생 (Media.start)
     *   ② AudioContext 를 깨우고(resume) 0.05초짜리 무음 버퍼를 흘려 iOS 가 "지금 오디오가 재생 중"으로 인식하게 합니다
     * make=true 는 사용자가 방금 누른 순간(큐 버튼)에만 — 그때는 AudioContext 가 없어도 새로 만듭니다.
     * 예약된 큐(setTimeout)는 이미 만들어진 AudioContext 만 깨웁니다.
     */
    function routeAudio(make) {
      try { Media.start(); } catch (e) { /* 무시 */ }
      try {
        if (!ctx && make && AC) ensureCtx();
        if (!ctx) return false;
        if (ctx.state !== 'running' && ctx.resume) { var r = ctx.resume(); if (r && r.catch) r.catch(function () { /* 사용자가 다시 눌러야 하는 경우 */ }); }
        var buf = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate * 0.05)), ctx.sampleRate);   // 0.05초 무음
        var src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
        src.onended = function () { src.onended = null; try { src.disconnect(); } catch (e) { /* 이미 끊김 */ } };
        src.start(0);
        return true;
      } catch (e) { return false; }
    }
    /* ---------- v7.4 — 녹음된 콜아웃 소리 (iPad 에서 음성 합성이 들쭉날쭉 · 무음 모드에서 안 들리던 문제의 근본 해결) ----------
       왜 들쭉날쭉했나: 브라우저 "음성 합성(TTS)" 은 기기 안의 별도 엔진이라 ① 타이머로 부르면 iOS 가 조용히 무시하거나 ② 앞 음성이 대기열에 걸려 다음이 안 나오거나
       ③ 무음 스위치를 따라가서(딸깍 소리와 다른 길) 안 들렸습니다. 이제 미리 녹음해 둔 짧은 소리(/worship/cues/en/*.mp3)를 딸깍 소리와 똑같이 "오디오 시계"에 예약해 재생합니다.
       → 소리 나는 시각이 박에 정확히 맞고(지연 보정 불필요), 딸깍 소리가 나는 한 항상 나며, 무음 모드 · 원격 큐(손 안 댄 화면) · 오프라인에서도 같습니다.
       영어 큐 + 남성/섞기 음성일 때 쓰고, 파일이 아직 안 불러졌거나 한국어 · 여성 · 직접 쓴 큐는 예전처럼 음성 합성으로 합니다. */
    var clips = {}, clipState = '', voiceBus = null, clipBase = opt.clipBase || '/worship/cues/';
    var clipMan = null, clipVoices = {}, clipDefault = 'am_eric', vLoad = {}, lastClipVoice = '';     // V836 — 목소리별 녹음 (clips[목소리][큐 id] = 소리)
    function decoderCtx() {
      if (ctx) return ctx;
      try { var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext; return OC ? new OC(1, 1, 44100) : null; } catch (e) { return null; }
    }
    function decodeBuf(ab) {
      return new Promise(function (resolve, reject) {
        var dc = decoderCtx(); if (!dc) { reject(new Error('no decoder')); return; }
        try { var p = dc.decodeAudioData(ab, resolve, reject); if (p && p.then) p.then(resolve, reject); } catch (e) { reject(e); }
      });
    }
    /** 한 목소리의 녹음을 모두 불러옵니다 (이미 불러왔거나 받는 중이면 그대로). 끝나면 상태를 알립니다. */
    function loadVoiceClips(vid) {
      if (!clipMan || !vid || vLoad[vid]) return vLoad[vid] || null;
      var base = clipBase + 'en/' + (clipMan.voices ? vid + '/' : ''), ids = Object.keys(clipMan.clips || {}); clips[vid] = clips[vid] || {};
      vLoad[vid] = Promise.all(ids.map(function (id) {
        return fetch(base + id + (clipMan.sfx || '') + '.mp3').then(function (r) { if (!r.ok) throw new Error(id); return r.arrayBuffer(); }).then(decodeBuf)
          .then(function (b) { clips[vid][id] = b; }).catch(function () { /* 이 큐만 (다른 목소리 · 음성 합성으로) */ });
      })).then(function () { if (vid === clipDefault && Object.keys(clips[vid]).length) clipState = 'ready'; if (!destroyed) emitState(); });
      return vLoad[vid];
    }
    /** 지금 선택에 필요한 목소리를 불러옵니다 (선택이 바뀔 때마다 · 시작할 때) */
    function wantVoices() {
      if (!clipMan) return;
      var sel = cfg.voiceSel, list = [clipDefault];
      if (/^v:/.test(sel)) list.push(sel.slice(2));
      else if (sel === 'rot:m' || sel === 'rot:mf') Object.keys(clipVoices).forEach(function (v) { if (sel === 'rot:mf' || clipVoices[v].g !== 'f') list.push(v); });
      list.forEach(function (v) { if (clipVoices[v] || v === clipDefault) loadVoiceClips(v); });
    }
    function loadClips() {
      if (clipState || destroyed || typeof fetch !== 'function' || !AC) return;
      if (typeof window !== 'undefined' && window.__YN_NO_CLIPS) { clipState = 'off'; return; }      // 시험용 — 음성 합성 경로만 시험할 때
      clipState = 'loading';
      fetch(clipBase + 'en/manifest.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('manifest'); return r.json(); }).then(function (man) {
        clipMan = man; clipVoices = man.voices || {}; clipDefault = man['default'] || 'am_eric';
        if (!man.voices) clipVoices = {};
        if (!destroyed) emitState();          // V856 — 목소리 목록을 소리 파일이 다 받아지기 전에 바로 채움
        wantVoices();
        return vLoad[clipDefault];
      }).then(function () { clipState = clips[clipDefault] && Object.keys(clips[clipDefault]).length ? 'ready' : 'fail'; if (!destroyed) emitState(); }).catch(function () { clipState = 'fail'; });
    }
    /** 이 큐를 녹음된 소리로 낼 수 있으면 그 소리 (선택한 목소리 → 아직 못 불러왔거나 없으면 기본 목소리) */
    function clipVoiceFor() {
      var sel = cfg.voiceSel;
      if (sel === 'live' || sel === 'any' || sel === 'female') return '';              // 기기 음성(실시간 합성)을 고른 경우
      if (/^v:/.test(sel)) return sel.slice(2);
      if (sel === 'rot:m' || sel === 'rot:mf') {
        var ids = Object.keys(clipVoices).filter(function (v) { return clips[v] && Object.keys(clips[v]).length && (sel === 'rot:mf' || clipVoices[v].g !== 'f'); });
        if (!ids.length) return clipDefault;
        var c = ids.length > 1 ? ids.filter(function (v) { return v !== lastClipVoice; }) : ids;
        return (lastClipVoice = c[Math.floor(Math.random() * c.length) % c.length]);
      }
      return clipDefault;
    }
    function clipFor(c) {
      if (cfg.lang !== 'en' || !c || !c.id || c.id === 'custom') return null;
      var vid = clipVoiceFor(); if (!vid) return null;
      if (c.meas) {                                               // 이 큐 + 숫자 + measures — 한 목소리로 셋 다 있을 때만 (하나라도 없으면 음성 합성으로 문장 전체)
        var ids = [c.id, 'num' + c.meas, c.meas === 1 ? 'meas1' : 'meas'];
        var pickV = function (v) { var a = ids.map(function (id) { return clips[v] && clips[v][id]; }); return a.every(Boolean) ? a : null; };
        var seq = pickV(vid) || (vid !== clipDefault ? (wantVoices(), pickV(clipDefault)) : null);
        if (!seq) return null;
        return { seq: seq, duration: seq.reduce(function (t, x) { return t + Math.max(0.2, x.duration - SEQ_GAP); }, 0) };
      }
      var b = clips[vid] && clips[vid][c.id];
      if (!b && vid !== clipDefault) { wantVoices(); b = clips[clipDefault] && clips[clipDefault][c.id]; }
      return b || null;
    }
    var SEQ_GAP = 0.12;                                           // 녹음 끝의 숨 고르는 무음(0.14초) 일부를 겹쳐서 낱말 사이가 뜨지 않게
    function bus() {
      if (!voiceBus) { voiceBus = ctx.createGain(); voiceBus.gain.value = clamp(cfg.voice, 0, 2); voiceBus.connect(limiter || ctx.destination); }
      return voiceBus;
    }
    function applyVoiceGain() { if (voiceBus && ctx) { try { voiceBus.gain.setTargetAtTime(clamp(cfg.voice, 0, 2), ctx.currentTime, 0.01); } catch (e) { voiceBus.gain.value = clamp(cfg.voice, 0, 2); } } }
    /** 녹음 소리를 오디오 시계 when 에 시작하도록 예약 (딸깍 소리와 같은 길) */
    function playClip(buf, when) {
      if (buf && buf.seq) {                                       // 여러 조각을 이어서 — 첫 조각의 소스를 돌려줌 (멈추기는 cancelCues 가 첫 조각만, 나머지는 짧아서 그대로)
        var t = Math.max(when, ctx.currentTime), first = null;
        buf.seq.forEach(function (b) { var s0 = playClip(b, t); if (!first) first = s0; t += Math.max(0.2, b.duration - SEQ_GAP); });
        return first;
      }
      try {
        var src = ctx.createBufferSource(); src.buffer = buf; src.connect(bus());
        src.onended = function () { src.onended = null; try { src.disconnect(); } catch (e) { /* 이미 끊김 */ } };
        src.start(Math.max(when, ctx.currentTime));
        return src;
      } catch (e) { return null; }
    }
    if (typeof window !== 'undefined' && typeof setTimeout === 'function') setTimeout(function () { try { loadClips(); } catch (e) { /* 음성 합성으로 */ } }, 0);

    var speakKeep = [];
    function speak(text, lang, calibrate, fromGesture, rate) {
      if (!speechOk) return false;
      try {
        routeAudio(!!fromGesture);                       // 무음 스위치가 켜져 있어도 들리게 — speak() 바로 앞에서, 같은 동작 안에서
        var u = new SpeechSynthesisUtterance(text);
        u.lang = lang === 'ko' ? 'ko-KR' : 'en-US';
        var v = pickVoice(lang, true); if (v) u.voice = v;
        u.pitch = (lang === 'ko' ? koGender() === 'male' : cfg.gender === 'male') && !(v && isMaleVoice(v)) ? MALE_FALLBACK_PITCH : 1;        // 남성 음성이 없으면 낮은 음높이로 대신
        // v8.39: rate 를 직접 넘기면(박자에 맞춰 세는 말) 그걸 쓰고, 아니면 평소 기본값 — 빠른 합성음처럼 들리지 않게. 짧은 한 낱말은 끝소리가 씹히지 않게 더 천천히
        u.rate = rate > 0 ? rate : ((lang !== 'ko' && !calibrate && /^\S+$/.test(String(text).trim())) ? 0.86 : 0.95);
        u.volume = calibrate ? 0 : Math.min(1, Math.max(0, cfg.voice));   // 지연 재기(calibrate)는 소리 없이, 평소에는 음성 볼륨 (0~1)
        var t0 = performance.now();
        u.onstart = function () {
          var m = performance.now() - t0;
          if (m > 20 && m < 900) {              // 이상한 값(첫 로딩 등)은 버리고, 나머지는 평균으로 다듬습니다
            latEma = latEma * 0.6 + m * 0.4;
            cfg.lat = Math.round(latEma); store('lat', cfg.lat);
            notify('latency', { ms: cfg.lat, measured: Math.round(m) });
          }
        };
        u.onerror = function (e) { notify('speechError', { error: e && e.error }); };
        speakKeep.push(u); if (speakKeep.length > 6) speakKeep.shift();               // 말하는 도중 지워지지 않게 붙들어 둠 (사파리 · 크롬이 끝나기 전에 치워 소리가 끊기는 문제)
        try { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); } catch (e) { /* 무시 */ }
        window.speechSynthesis.speak(u);
        return true;
      } catch (e) { return false; }
    }
    /** 처음 한 번 — 소리 없는 음성을 돌려 지연을 재고 (아이폰은 사용자가 누른 순간에만 허용) */
    function warmup() { if (speechOk && !cfg.warmed) { cfg.warmed = true; speak(' ', cfg.lang, true); } }

    /* ---------- v8.39 — 박에 맞춰 숫자 말하기 (숫자로 세기 · 콜아웃 뒤 카운트다운이 함께 씁니다) ----------
       다른 녹음 큐와 같은 자리(clips[id])에 "num1" · "num2" … 를 넣어 두면(매니페스트 + 파일) 그대로 녹음 음성을 씁니다.
       아직 없으면(지금 이 앱에는 없음) 음성 합성으로 대신하고, 그마저 없는 기기는 평소 딸깍으로 대신합니다 — 박이 비는 일은 없습니다. */
    function numText(n) { var a = cfg.lang === 'ko' ? NUM_KO : NUM_EN; return a[n - 1] || String(n); }
    /** clipFor() 와 같은 방식(선택한 목소리 → 없으면 기본 목소리)으로 "num1" · "num2" … 녹음을 찾습니다 */
    function numClip(n) {
      if (cfg.lang !== 'en') return null;
      var vid = clipVoiceFor(); if (!vid) return null;
      var id = 'num' + n, b = clips[vid] && clips[vid][id];
      if (!b && vid !== clipDefault) { wantVoices(); b = clips[clipDefault] && clips[clipDefault][id]; }
      return b || null;
    }
    /** 오디오 시계 e.time 에 딱 맞춰 숫자 n 을 들려줍니다(녹음 소리는 그 자리에, 합성 음성은 들리는 시각이 박에 오도록 미리 시작) */
    function speakCountBeat(e, n) {
      var clip = numClip(n);
      if (clip) { var src = playClip(clip, e.time); if (src) { numSrcs.push({ src: src, t: e.time }); if (numSrcs.length > 24) numSrcs.shift(); } return; }
      if (!speechOk) { click(e.time, e.accent, e.countIn); return; }         // 대신할 소리가 전혀 없으면 평소 딸깍으로 — 박을 비우지 않음
      var itv = sched.interval(), rate = clamp(0.55 / itv, 0.9, 2.5);         // 박자가 빠르면(간격이 짧으면) 더 빨리 말합니다
      var lat = cfg.lat / 1000, wait = Math.max(0, (e.time - lat - ctx.currentTime) * 1000);
      var text = numText(n);
      setTimeout(function () { speak(text, cfg.lang, false, false, rate); }, wait);
    }

    /* ---------- 타이머 (25ms 마다 깨어나 예약만 합니다) ---------- */
    var lastWake = 0;
    function pump() {
      if (!ctx || destroyed) return;
      if (ctx.state !== 'running') { var tn = Date.now(); if (tn - lastWake > 1500) { lastWake = tn; wake(); } }      // 오디오가 끊겼으면 (전화 · 알림 등) 1.5초마다 다시 살려 봅니다
      var ev = sched.tick();
      for (var i = 0; i < ev.length; i++) {
        var e = ev[i], n = sched.num;
        /* v8.39 — 옵션: 콜아웃이 떨어진 마디 끝 3박에서 Three·Two·One */
        var cdN = 0;
        if (countdownArmed && e.beat === 0 && e.time >= countdownAt - 0.002) { countdownArmed = false; countdownActive = true; }
        else if (countdownActive) {
          if (n >= 4 && e.beat === n - 3) cdN = 3;
          else if (n >= 4 && e.beat === n - 2) cdN = 2;
          else if (n >= 4 && e.beat === n - 1) cdN = 1;
          else if (e.beat === 0) countdownActive = false;      // 다음 마디 시작 = 등장 — 평소처럼
        }
        /* v8.39 — "숫자로 세기" 버튼: 다음 마디 첫 박부터 한 마디를 딸깍 대신 One·Two·Three·Four (V843 목소리만) */
        if (pendingCount && e.beat === 0) { pendingCount = false; countRemain = n; }
        if (countRemain > 0) { speakCountBeat(e, e.beat + 1); countRemain--; }
        else if (cdN) { if (!cfg.countAll) click(e.time, e.accent, e.countIn); speakCountBeat(e, cdN); }
        else if (cfg.countAll) speakCountBeat(e, e.beat + 1);                        // V848 — 늘 숫자로 (딸깍 대신)
        else if (!(e.mute && !e.countIn)) click(e.time, e.accent, e.countIn);          // V859 — 끈 박은 딸깍 없음 (예비 박은 그대로)
        if (cfg.sub === 2) subClick(e.time + sched.interval() / 2);                  // V848 — 엇박 (화면 깜빡임 · 박 표시는 하지 않음)
        q.push(e);
      }
    }
    function startTimer() {
      stopTimer();
      try {
        var src = 'var t=null;onmessage=function(e){if(e.data==="start"){clearInterval(t);t=setInterval(function(){postMessage(0)},25)}else if(e.data==="stop"){clearInterval(t);t=null}}';
        var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        worker = new Worker(url);
        worker.onmessage = pump;
        worker.postMessage('start');
        URL.revokeObjectURL(url);
      } catch (e) {
        worker = null;                          // Worker 를 못 쓰면 일반 타이머 (백그라운드 탭에서는 덜 정확할 수 있음)
        timer = setInterval(pump, 25);
      }
    }
    function stopTimer() {
      if (worker) { try { worker.postMessage('stop'); worker.terminate(); } catch (e) { /* 이미 끝남 */ } worker = null; }
      if (timer) { clearInterval(timer); timer = null; }
    }
    function frame() {
      raf = 0;
      if (!ctx || destroyed) return;
      // 스피커에서 실제로 들리는 시각에 맞춰 화면을 깜빡입니다
      var heard = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
      while (q.length && q[0].time <= heard) {
        var e = q.shift();
        if (opt.onBeat) { try { opt.onBeat(e); } catch (x) { /* 화면 오류가 박자에 영향을 주지 않게 */ } }
      }
      if (sched.running || q.length) raf = requestAnimationFrame(frame);
    }

    function state() {
      cfg.first = sched.marks[0] === 1 || sched.marks[0] === 2;
      return { running: sched.running, bpm: sched.bpm, num: sched.num, den: sched.den, marks: sched.marks.slice(), gain: gainOf(), pitch: cfg.pitch, flash: cfg.flash, cfg: cfg, speech: speechOk, audio: !!AC, media: Media.on,
        pending: pending.map(function (p) { return { label: p.text, landAt: p.plan.landAt, speakAt: p.plan.speakAt }; }) };
    }
    function emitState() { notify('state', state()); }

    /**
     * 시작 — 지연을 최소로:
     *   · 오디오가 이미 깨어 있으면(미리 준비됨) 기다림 없이 그 자리에서 첫 박을 예약합니다 (첫 박 = 지금 + 5ms, 예전엔 80ms 뒤).
     *   · 처음 한 번만 resume 이 끝나길 기다립니다 (화면을 처음 누를 때 prime 이 미리 깨워 두므로 보통 해당 없음).
     */
    var starting = false;                                   // V842 — 소리 장치를 깨우는 중(시작을 눌렀지만 첫 박 전)
    function start(countInBars) {
      var c;
      try { c = ensureCtx(); } catch (e) { notify('error', { message: e.message }); return { ok: false, error: e.message }; }
      var go = function (delay) {
        starting = false;
        if (destroyed) return;
        if (c.state !== 'running') { notify('error', { message: HELP.blocked }); return; }
        sched.start(countInBars || 0, delay);
        pump(); startTimer();
        if (!raf) raf = requestAnimationFrame(frame);
        emitState();
        warmup();                                                       // 음성 합성 예열은 첫 박을 예약한 뒤에 (박을 늦추지 않게)
      };
      Media.start(); starting = true;
      if (c.state === 'running') go(0.005);
      else {
        var r = c.resume ? c.resume() : null;
        if (r && r.then) r.then(function () { go(0.02); }, function () { notify('error', { message: HELP.blocked }); }); else go(0.02);
      }
      if (!speechOk) notify('info', { message: HELP.noSpeech });
      return { ok: true };
    }
    /**
     * 정해진 시각에 맞춰 시작 (여러 기기 동기용).
     *   inMs : 앵커(마디 첫 박)까지 남은 시간(ms). 음수면 이미 지난 앵커 — 박 위치를 유지한 채 다음 박부터 이어 갑니다.
     * 소리는 이 기기의 오디오 시계에서 이 기기가 직접 냅니다 (소리를 주고받지 않습니다).
     */
    function startIn(inMs, countInBars) {
      var c;
      try { c = ensureCtx(); } catch (e) { notify('error', { message: e.message }); return { ok: false, error: e.message }; }
      inMs = Number(inMs); if (!isFinite(inMs)) inMs = 0;
      var go = function () {
        if (destroyed) return;
        if (c.state !== 'running') { notify('error', { message: HELP.blocked }); return; }
        warmup();
        // resume 가 끝난 시점에서 다시 계산하면 그 사이 지난 시간이 반영됩니다 — 기준은 호출 시각
        var anchor = c.currentTime + (inMs - (Date.now() - t0)) / 1000;
        sched.startAt(anchor, countInBars || 0);
        pump(); startTimer();
        if (!raf) raf = requestAnimationFrame(frame);
        emitState();
      };
      var t0 = Date.now();
      Media.start();
      var r = c.resume ? c.resume() : null;
      if (r && r.then) r.then(go, function () { notify('error', { message: HELP.blocked }); }); else go();
      if (!speechOk) notify('info', { message: HELP.noSpeech });
      return { ok: true };
    }
    /** V842 — 누르는 순간을 새 1박으로: 돌고 있으면 그 자리에서 다시 맞추고(옛 예약 딸깍은 끔), 멈춰 있으면 바로 시작. 1박의 오디오 시각을 돌려줌 */
    /** V843 — 이미 예약해 둔 박은 그대로 두고, 그 바로 다음 박(아직 예약 전)을 새 "1박"으로 — 그 박의 오디오 시각을 돌려줌 */
    function nextAsOne() { sched.phase = sched.beat; emitState(); return sched.nextTime; }
    function downbeatNow(prep) {
      if (!ctx || !sched.running) { var r = start(0); if (r && r.ok === false) return null; return null; }
      cutScheduled(); q.length = 0;
      countdownArmed = false; countdownActive = false; pendingCount = false; countRemain = 0;
      if (prep) prep();                                     // 새 1박을 예약하기 전에 (숫자로 세기 · 카운트다운 준비)
      var t = sched.restartNow(0.03);
      pump(); emitState();
      return t;
    }
    function stop() {
      sched.stop(); stopTimer(); q.length = 0;
      pending.forEach(function (p) { clearTimeout(p.timeout); });
      pending = [];
      pendingCount = false; countRemain = 0; countdownArmed = false; countdownActive = false;      // v8.39
      if (speechOk) { try { window.speechSynthesis.cancel(); } catch (e) { /* 무시 */ } }
      Media.stop();
      emitState();
    }

    /* ---------- 큐 ---------- */
    function resolveCue(c) {
      if (typeof c === 'string') {
        var mm = MEAS_RE.exec(c), base = mm ? c.slice(0, mm.index) : c, n = mm ? +mm[1] : 0;
        if (n && CUE_BY[base]) {                                  // "Interlude 2 measures" — 녹음은 이 큐 + 숫자 + measures 를 이어서
          return { id: base, en: CUE_BY[base].en + ' ' + n + (n === 1 ? ' measure' : ' measures'), ko: CUE_BY[base].ko + ' ' + n + '마디', g: CUE_BY[base].g, meas: n };
        }
        if (CUE_BY[c]) return { id: c, en: CUE_BY[c].en, ko: CUE_BY[c].ko, g: CUE_BY[c].g };
        return { id: 'custom', en: c, ko: c, g: 'sec' };
      }
      return { id: c.id || 'custom', en: c.en || c.label || '', ko: c.ko || c.label || c.en || '', g: c.g || 'sec' };
    }
    /**
     * 큐를 예약합니다. 박자가 돌고 있으면 박에 맞춰, 멈춰 있으면 바로 안내합니다.
     * 반환 { ok, plan, text } — plan.landAt 은 오디오 시계 기준 (남은 시간 = landAt - ctx.currentTime)
     */
    function cue(c, mode) {
      c = resolveCue(c);
      var cl = c.id === 'custom' ? langOfText(c.en) : cfg.lang;                    // V838 — 직접 입력한 글: 한글이면 한국어 · 아니면 영어 (정해진 큐는 큐 언어 설정대로)
      var text = cl === 'ko' ? c.ko : c.en;
      if (!text) return { ok: false, error: '큐 이름이 비어 있습니다.' };
      if (cfg.speak === false) {                                 // 음성 콜아웃을 꺼 둔 상태 — 소리 없이 이름만 알려줍니다 (화면 안내는 그대로)
        notify('cue', { status: 'spoken', text: text, muted: true });
        return { ok: true, muted: true, text: text };
      }
      /* v8.39 — "콜아웃 뒤 Three·Two·One" 옵션이 켜져 있으면, 이 큐는 항상 (다음) 마디 첫 박에 떨어지게 해서
         그 마디의 마지막 3박을 카운트다운에 내어줍니다 (사용자가 고른 "큐 타이밍"보다 우선) */
      var useCountdown = !!cfg.countdown && !!ctx && sched.running && !(cfg.cdSkip && (c.g === 'rep' || c.g === 'dyn'));   // V842 — 반복 · 다이내믹은 세지 않음(옵션)
      if (useCountdown) {                                         // V843 — 이미 예약된 박은 그대로, 그 바로 다음 박이 새 1박: 콜아웃이 그 1박에, 그 마디 끝 3박에서 Three·Two·One
        var clipD = cfg.sound !== 'mute' && AC ? clipFor(c) : null;
        var t1;
        if (cfg.cdReset) t1 = nextAsOne();                         // 바로 다음 박을 새 1박으로
        else {                                                    // V856 — 박은 그대로: 다음 마디 첫 박(너무 가까우면 그다음 마디)에 콜아웃
          var pl = sched.planCue('downbeat', { latency: clipD ? 0 : cfg.lat / 1000, leadBeats: cfg.lead });
          if (!pl.ok) return { ok: false, error: '박자가 멈춰 있습니다.' };
          t1 = pl.landAt;
        }
        countdownArmed = true; countdownActive = false; countdownAt = t1;
        if (clipD) playClip(clipD, t1);
        else if (speechOk && cfg.sound !== 'mute') { var w1 = Math.max(0, (t1 - cfg.lat / 1000 - ctx.currentTime) * 1000); setTimeout(function () { speak(text, cl); }, w1); }
        notify('cue', { status: 'spoken', text: text, downbeat: true });
        return { ok: true, text: text, downbeat: true, landAt: t1, reset: !!cfg.cdReset };
      }
      if (sched.running && ctx && !mode) {                        // V843 — 카운트다운이 아니면 박과 상관없이 누르는 즉시 (메트로놈은 그대로 BPM 대로 흐름)
        var clipN = cfg.sound !== 'mute' && AC ? clipFor(c) : null;
        if (clipN) playClip(clipN, ctx.currentTime + 0.01);
        else if (speechOk && cfg.sound !== 'mute') speak(text, cl, false, true);
        else earcon(ctx.currentTime + 0.01, c.g, 0);
        notify('cue', { status: 'spoken', text: text, immediate: true });
        return { ok: true, immediate: true, text: text };
      }
      var clip = cfg.sound !== 'mute' && AC ? clipFor(c) : null;        // v7.4 — 녹음 소리가 있으면 그것으로 (없으면 아래 음성 합성)
      var useSpeech = !clip && speechOk && cfg.sound !== 'mute';
      if (!ctx || !sched.running) {                              // 멈춰 있을 때 — 시험 삼아 바로 들려줍니다
        Media.start(); if (!sched.running) setTimeout(function () { if (!sched.running) Media.stop(); }, 4000 + (clip ? Math.round(clip.duration * 1000) : 0));   // 무음 모드에서도 음성이 들리게 잠깐만 미디어 채널로
        if (clip) {
          try { routeAudio(true); ensureCtx(); if (ctx.state !== 'running' && ctx.resume) ctx.resume(); playClip(clip, ctx.currentTime + 0.03); }
          catch (e) { if (speechOk) speak(text, cl, false, true); }
        }
        else if (useSpeech) speak(text, cl, false, true);     // 사용자가 누른 바로 그 순간 — 오디오 경로를 열고 곧바로 말합니다
        else if (ctx || AC) { try { ensureCtx(); ctx.resume(); earcon(ctx.currentTime + 0.02, c.g, 0); } catch (e) { return { ok: false, error: HELP.noAudio }; } }
        notify('cue', { status: 'spoken', text: text, immediate: true });
        return { ok: true, immediate: true, text: text };
      }
      var plan = sched.planCue(mode, { latency: useSpeech ? cfg.lat / 1000 : 0, leadBeats: cfg.lead });
      if (!plan.ok) return { ok: false, error: '박자가 멈춰 있습니다.' };
      if (useCountdown) { countdownArmed = true; countdownActive = false; countdownAt = plan.landAt; }      // v8.39 — 이 마디의 마지막 3박에서 Three·Two·One
      var item = { plan: plan, text: text, cue: c, timeout: 0, src: null };
      if (clip) {
        item.src = playClip(clip, plan.landAt);                // 오디오 시계에 예약 — 타이머를 거치지 않아 놓치지 않고 박에 정확히 맞습니다
        if (!item.src && speechOk) { useSpeech = true; }
        else item.timeout = setTimeout(function () {
          pending = pending.filter(function (p) { return p !== item; });
          notify('cue', { status: 'spoken', text: text, plan: plan });
        }, Math.max(0, (plan.landAt - ctx.currentTime) * 1000));
      }
      if (clip && item.src) { /* 위에서 예약 끝 */ }
      else if (useSpeech) {
        var wait = Math.max(0, (plan.speakAt - ctx.currentTime) * 1000);
        item.timeout = setTimeout(function () {
          speak(text, cl);
          pending = pending.filter(function (p) { return p !== item; });
          notify('cue', { status: 'spoken', text: text, plan: plan });
        }, wait);
      } else {
        earcon(plan.landAt, c.g, Math.max(0, CUES.indexOf(CUE_BY[c.id]) % 4));
        item.timeout = setTimeout(function () {
          pending = pending.filter(function (p) { return p !== item; });
          notify('cue', { status: 'spoken', text: text, plan: plan });
        }, Math.max(0, (plan.landAt - ctx.currentTime) * 1000));
      }
      pending.push(item);
      notify('cue', { status: 'planned', text: text, plan: plan });
      return { ok: true, plan: plan, text: text };
    }
    function cancelCues() { pending.forEach(function (p) { clearTimeout(p.timeout); if (p.src) { try { p.src.stop(); } catch (e) { /* 이미 끝남 */ } } }); pending = []; if (speechOk) { try { window.speechSynthesis.cancel(); } catch (e) { /* 무시 */ } } emitState(); }

    function setSel(g) { var sel = parseSel(g); cfg.voiceSel = sel; cfg.gender = legacyGender(sel); store('gender', sel); wantVoices(); emitState(); }
    function set(k, v) { cfg[k] = v; store(k === 'click' ? 'vol' : k, v); emitState(); }
    return {
      start: start, stop: stop, toggle: function (n) { return sched.running ? (stop(), { ok: true }) : start(n); },
      cue: cue, cancelCues: cancelCues,
      setSpeak: function (on) { cfg.speak = !!on; store('speak', cfg.speak); if (!on) cancelCues(); else emitState(); },
      setBpm: function (b) { sched.setBpm(b); emitState(); }, setSig: function (n, d) { sched.setSig(n, d); cfg.first = sched.marks[0] === 1 || sched.marks[0] === 2; emitState(); },
      setClickVolume: function (v) { set('click', clamp(v, 0, 1)); applyGain(); },
      setPitch: function (st) { set('pitch', Math.round(clamp(st, LIMITS.minPitch, LIMITS.maxPitch) * 2) / 2); },
      setFlash: function (on) { set('flash', !!on); }, setFlashAll: function (on) { cfg.flashAll = !!on; store('flashall', !!on); emitState(); },
      /** 박 ">" 강세 — 원을 눌러 켜고 끕니다 (높은 음 · 더 크게) */
      toggleMark: function (i) { var r = sched.toggleMark(i); if (r === null) return null; cfg.first = sched.marks[0] === 1 || sched.marks[0] === 2; store('first', cfg.first); emitState(); return r; },
      setMarks: function (arr) { var r = sched.setMarks(arr); if (r) { cfg.first = sched.marks[0] === 1 || sched.marks[0] === 2; store('first', cfg.first); emitState(); } return r; },
      startIn: startIn,
      /** 사용자가 화면을 누른 순간에 소리 장치를 미리 깨워 둡니다 (아이폰 · 크롬은 눌러야 소리가 나옵니다) — 원격 시작에 필요 */
      hold: function (on) { try { return Media.setHold(on); } catch (e) { return false; } },
      prime: function () { try { var c = ensureCtx(); if (c.resume && c.state !== 'running') c.resume(); warmClick(); return true; } catch (e) { return false; } },
      /** 오디오가 깨어 있어 누르는 즉시 시작할 수 있는지 */
      ready: function () { return !!(ctx && ctx.state === 'running'); }, setVoiceVolume: function (v) { set('voice', clamp(v, 0, 2)); applyVoiceGain(); },
      setMode: function (m) { set('mode', ['downbeat', 'lead', 'now'].indexOf(m) === -1 ? 'lead' : m); },
      setLead: function (n) { set('lead', Math.round(clamp(n, 1, 8))); }, setLang: function (l) { set('lang', l === 'ko' ? 'ko' : 'en'); },
      clipsReady: function () { return clipState === 'ready'; },
      /** v8.39 — "1박 다시 맞추기": 지금 박을 새 1박으로 (소리 간격은 그대로, 표시 · 강세 · 큐 기준만 이동) */
      markNow: function () { var r = sched.markNow(); if (r != null) emitState(); return r; },
      /** v8.39 — "숫자로 세기" 버튼: 다음 마디를 딸깍 대신 One·Two·Three·Four 로 (실제 박자 그대로, 녹음/합성 음성) */
      countNow: function () {                       // V843 — 누르면 그 바로 다음 박이 1박: One · Two · Three · Four (그 마디는 딸깍 없이 목소리만). 멈춰 있으면 시작하면서 셈
        if (starting) { pendingCount = true; return { ok: true, started: true }; }
        if (!ctx || !sched.running) { var r0 = start(0); if (r0 && r0.ok === false) return r0; pendingCount = true; return { ok: true, started: true }; }
        nextAsOne(); countRemain = 0; pendingCount = true; return { ok: true };
      },
      downbeatNow: function () { return downbeatNow(); },
      setCountdownReset: function (on) { cfg.cdReset = !!on; store('cdreset', cfg.cdReset); emitState(); },
      setCountdownSkip: function (on) { cfg.cdSkip = !!on; store('cdskip', cfg.cdSkip); emitState(); },
      /** v8.39 — 콜아웃 뒤 Three·Two·One 옵션 켬/끔 */
      setCountdown: function (on) { set('countdown', !!on); },
      /** V848 — 2박으로 쪼개기 (1 또는 2) · 숫자로 세기(딸깍 대신, 계속) */
      setSub: function (n) { cfg.sub = +n === 2 ? 2 : 1; store('sub', cfg.sub); emitState(); },
      setCountAll: function (on) { cfg.countAll = !!on; store('countall', cfg.countAll); emitState(); },
      /** V836 — 고를 수 있는 녹음 목소리 [{ id, label, g }] (불러오기 전에는 빈 목록) */
      clipVoices: function () { return Object.keys(clipVoices).map(function (v) { return { id: v, label: clipVoices[v].label || v, g: clipVoices[v].g || 'm' }; }); },
      clipDefault: function () { return clipDefault; },
      setLatency: function (ms) { latEma = clamp(ms, 0, 900); set('lat', Math.round(latEma)); }, setSound: function (s) { set('sound', s); }, setFirstAccent: function (on) { sched.setMark(0, !!on); set('first', !!on); },
      tap: function () { var b = tapper.tap(Date.now()); if (b) { sched.setBpm(b); emitState(); } return b; },
      setGender: setSel, setVoice: setSel, voiceInfo: currentVoice, voiceNames: function (lang) { return mixPool(voices, lang || cfg.lang).map(function (v) { return v.name; }); }, refreshVoices: loadVoices,
      state: state, sched: sched, ctx: function () { return ctx; }, help: HELP,
      destroy: function () {
        destroyed = true; stop();
        if (raf) cancelAnimationFrame(raf);
        if (typeof document !== 'undefined' && document.removeEventListener) { document.removeEventListener('visibilitychange', onVisible); if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('pageshow', onVisible); }
        Media.release();
        try { if (ctx) ctx.onstatechange = null; if (master) master.disconnect(); if (limiter) limiter.disconnect(); } catch (e) { /* 무시 */ }
        if (ctx && ctx.close) { try { ctx.close(); } catch (e) { /* 무시 */ } }
        if (speechOk) { try { window.speechSynthesis.removeEventListener('voiceschanged', loadVoices); } catch (e) { /* 무시 */ } }
      }
    };
  }

  return { langOfText: langOfText, CUES: CUES, CUE_BY: CUE_BY, WORD_EN: WORD_EN, defaultMarks: defaultMarks, Sched: Sched, TapTempo: TapTempo, create: create, HELP: HELP, LIMITS: LIMITS, pickVoiceFrom: pickVoiceFrom, pickVoiceMix: pickVoiceMix, mixPool: mixPool, voiceScore: voiceScore, isMaleVoice: isMaleVoice, MALE_FALLBACK_PITCH: MALE_FALLBACK_PITCH, Media: Media };
}));
