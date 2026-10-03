/**
 * 메인스테이지 컨트롤 (Step: MIDI 로 MainStage 페이더 · 패치 전환)
 * ----------------------------------------------------------------
 * MainStage 는 네트워크로 조작할 방법이 없고 MIDI 로만 외부 조작을 받습니다. 그래서 이 모듈은
 * Web MIDI API(Chrome · Edge 전용 — Safari 는 지원하지 않습니다)로 같은 맥 안의 가상 MIDI 포트
 * (오디오 MIDI 설정의 IAC 드라이버 등)에 Control Change(페이더) · Program Change(패치 전환)
 * 메시지를 보냅니다. MainStage 쪽에서 그 포트를 MIDI Learn(⌘L)으로 자기 컨트롤에 외워두면,
 * 이 화면의 슬라이더 · 버튼이 그대로 그 컨트롤을 움직입니다.
 *
 * 서버에는 아무것도 보내지 않습니다 — MIDI 는 이 메모리와 설정을 가진 기기(그 맥)에서만 의미가
 * 있으므로, 설정(켜짐 여부 · 고른 출력 · 페이더/패치 목록)은 이 브라우저의 localStorage 에만
 * 저장됩니다(팀 전체·서버 동기화 없음). practice-panels.js 의 "메인스테이지" 탭이 이 모듈을 씁니다.
 */
(function (root) {
  'use strict';
  var KEY = 'yn.pv.mainstage';

  function uid() { return Math.random().toString(36).slice(2, 9); }
  function clamp(v, lo, hi) { v = +v; if (!(v >= lo)) v = lo; if (v > hi) v = hi; return v; }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  function defaults() { return { on: false, outputId: '', channel: 1, faders: [], patches: [] }; }

  function load() {
    var d = defaults();
    try {
      var raw = root.localStorage.getItem(KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (!o || typeof o !== 'object') return d;
      d.on = !!o.on; d.outputId = String(o.outputId || ''); d.channel = clamp(o.channel || 1, 1, 16);
      d.faders = Array.isArray(o.faders) ? o.faders.map(function (f) {
        return { id: String(f.id || uid()), name: String(f.name || '페이더').slice(0, 24), cc: clamp(f.cc, 0, 127), value: clamp(f.value, 0, 127) };
      }) : [];
      d.patches = Array.isArray(o.patches) ? o.patches.map(function (p) {
        return { id: String(p.id || uid()), name: String(p.name || '패치').slice(0, 24), pc: clamp(p.pc, 0, 127) };
      }) : [];
    } catch (e) { /* 저장값을 못 읽어도 기본값으로 계속 */ }
    return d;
  }
  function save(cfg) { try { root.localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* 저장이 막혀도 이번 화면에서는 그대로 동작 */ } }

  function create() {
    var cfg = load(), access = null, output = null, connecting = null, listeners = [];
    function emit(kind, d) { listeners.forEach(function (fn) { try { fn(kind, d); } catch (e) {} }); }
    function supported() { return !!(root.navigator && root.navigator.requestMIDIAccess); }
    function outputs() { var list = []; if (access) access.outputs.forEach(function (o) { list.push(o); }); return list; }

    function pickOutput() {
      var list = outputs();
      output = (cfg.outputId && find(list, cfg.outputId)) || null;
      if (!output) {
        var iac = null;
        for (var i = 0; i < list.length; i++) if (/iac/i.test(list[i].name || '')) { iac = list[i]; break; }
        output = iac || list[0] || null;
        if (output) { cfg.outputId = output.id; save(cfg); }
      }
      emit('output', output);
      return output;
    }
    function connect() {
      if (!supported()) return Promise.reject(new Error('이 브라우저는 MIDI 전송을 지원하지 않습니다 — Chrome 에서 열어주세요 (Safari 는 지원하지 않습니다).'));
      if (access) { pickOutput(); return Promise.resolve(output); }
      if (connecting) return connecting;
      connecting = root.navigator.requestMIDIAccess({ sysex: false }).then(function (a) {
        access = a; connecting = null;
        a.onstatechange = function () { emit('devices', outputs()); pickOutput(); };
        emit('devices', outputs());
        return pickOutput();
      }, function (e) { connecting = null; throw e; });
      return connecting;
    }
    function ensure() { return output ? Promise.resolve(output) : connect(); }
    function send(bytes) {
      ensure().then(function (o) {
        if (!o) { emit('error', '연결된 MIDI 출력이 없습니다 — 오디오 MIDI 설정에서 IAC 드라이버가 켜져 있는지 확인하세요.'); return; }
        try { o.send(bytes); } catch (e) { emit('error', e.message || String(e)); }
      }, function (e) { emit('error', (e && e.message) || String(e)); });
    }
    function sendCC(cc, value) { send([0xB0 | (clamp(cfg.channel, 1, 16) - 1), clamp(cc, 0, 127), clamp(value, 0, 127)]); }
    function sendPC(pc) { send([0xC0 | (clamp(cfg.channel, 1, 16) - 1), clamp(pc, 0, 127)]); }

    return {
      cfg: cfg,
      supported: supported,
      outputs: outputs,
      setOn: function (v) {
        cfg.on = !!v; save(cfg);
        if (cfg.on) connect().catch(function (e) { emit('error', (e && e.message) || String(e)); });
        emit('on', cfg.on);
      },
      selectOutput: function (id) { cfg.outputId = id; save(cfg); pickOutput(); },
      setChannel: function (n) { cfg.channel = clamp(n, 1, 16); save(cfg); },

      addFader: function () { var f = { id: uid(), name: '페이더 ' + (cfg.faders.length + 1), cc: 20 + cfg.faders.length, value: 100 }; cfg.faders.push(f); save(cfg); return f; },
      removeFader: function (id) { cfg.faders = cfg.faders.filter(function (f) { return f.id !== id; }); save(cfg); },
      renameFader: function (id, name) { var f = find(cfg.faders, id); if (f) { f.name = String(name || '').slice(0, 24); save(cfg); } },
      setFaderCc: function (id, cc) { var f = find(cfg.faders, id); if (f) { f.cc = clamp(cc, 0, 127); save(cfg); } },
      setFaderValue: function (id, v) { var f = find(cfg.faders, id); if (!f) return; f.value = clamp(v, 0, 127); save(cfg); sendCC(f.cc, f.value); },

      addPatch: function () { var p = { id: uid(), name: '패치 ' + (cfg.patches.length + 1), pc: cfg.patches.length }; cfg.patches.push(p); save(cfg); return p; },
      removePatch: function (id) { cfg.patches = cfg.patches.filter(function (p) { return p.id !== id; }); save(cfg); },
      renamePatch: function (id, name) { var p = find(cfg.patches, id); if (p) { p.name = String(name || '').slice(0, 24); save(cfg); } },
      setPatchPc: function (id, pc) { var p = find(cfg.patches, id); if (p) { p.pc = clamp(pc, 0, 127); save(cfg); } },
      firePatch: function (id) { var p = find(cfg.patches, id); if (p) sendPC(p.pc); },

      /** kind: 'devices' · 'output' · 'on' · 'error' */
      on: function (fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
    };
  }

  root.YNMainStage = { create: create };
}(typeof self !== 'undefined' ? self : this));
