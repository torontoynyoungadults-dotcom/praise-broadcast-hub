/**
 * 코드 기호 읽기 시험 — 텐션 · ♭ ♯ · 악보 글꼴 기호 · 위첨자 · OCR 오타 · 리듬 사선 줄 (harmony-core.js) + 기타 운지 · 음 이름 (chord-view.js)
 *   node scripts/test-chord-parse.js
 */
const path = require('path');
const HC = require(path.join(__dirname, '../public/worship/harmony-core.js'));
const CV = require(path.join(__dirname, '../public/worship/chord-view.js'));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const chords = `C Cm C7 Cmaj7 CM7 CΔ7 Cm7b5 Cø7 Cdim7 C°7 Caug C+7 Csus4 Csus2 C7sus4 C9sus4 C2 C5 C6 C6/9 C9 Cm9 Cmaj9 C11 C13 Cadd9 Cm(add9)
  C7b9 C7#9 C7(b9,#11) C7alt C7#5 C7-9 Cmaj7#11 CmM7 Cm(maj7) C9(#11) C13(b9) C/E Cm7/Bb F#m7 Bbmaj7 Ebm7b5 Abadd9 Db/F C#7(b9) Bm7(-5)
  C♯m7 B♭maj7 Cma7 CSUS4 CADD9 CMAJ7 C⁷ Cmaj⁷ F#ᵐ⁷ C7/9 C7/#11 Co7 C7♭9 Cm7♭5 C7♯9 C(♯11) B Fm Emaj7`.split(/\s+/).filter(Boolean);
chords.forEach((c) => ok(!!HC.parseChord(c), '코드로 읽음: ' + c));
ok(HC.parseChord('Cma7').seventh === 'maj7', 'Cma7 = Cmaj7');
ok(HC.parseChord('Co7').triad === 'dim', 'Co7 = C°7');
ok(HC.parseChord('C7/9').bass === null && HC.parseChord('C7/9').iv.some((e) => e.d === '9'), 'C7/9 = C7(9) (슬래시 베이스 아님)');
ok(HC.parseChord('Bm7').root === 10, '악보 글꼴 ♭(SMuFL) → B♭m7');

[['F$m7', 'F#m7'], ['FHm', 'F#m'], ['Arn7', 'Am7'], ['Bh', 'Bb'], ['D/F$', 'D/F#'], ['C1E', 'C/E']].forEach(([a, b]) => ok(HC.classifyToken(a, true).core === b, 'OCR 고침 ' + a + ' → ' + b, HC.classifyToken(a, true).core));

const row = (arr) => arr.map(([text, x0, x1, y0 = 100, y1 = 112]) => ({ text, x0, x1, y0, y1 }));
const names = (r) => HC.chordsFromTokens(r).map((c) => c.text).join(' ');
ok(names(row([['C', 0, 8], ['/', 20, 24], ['/', 30, 34], ['|', 40, 41], ['G', 50, 58], ['/', 70, 74]])) === 'C G', '리듬 사선(/) 이 있는 줄도 코드 줄');
ok(names(row([['B', 0, 8], ['', 8, 12], ['m7', 12, 24]])) === 'Bm7', '조각난 ♭ 글자 붙이기');
ok(names(row([['Way', 0, 20], ['maker', 25, 60], ['A', 65, 70]])) === '', '가사 줄의 "A" 는 코드 아님');

const sp = CV.spell('C', HC.voiceChord(HC.parseChord('C7(b9,#11)'), 0, false).degs, null, false);
ok(sp[10] === 'Bb' && sp[1] === 'Db' && sp[6] === 'F#', '음 이름은 도수대로 (C7 의 7음 = B♭)', sp);

const g = (n) => { const c = HC.parseChord(n); return CV.guitar(c.pcs, c.bass != null ? c.bass : c.root, [c.root].concat(c.core)).list.map((v) => v.f.map((x) => (x < 0 ? 'x' : x)).join('')); };
[['C', 'x32010'], ['G', '320003'], ['D', 'xx0232'], ['F', '133211'], ['Bm', 'x24432'], ['D/F#', '200232'], ['Am7', 'x02010']].forEach(([n, want]) => ok(g(n)[0] === want, '기타 ' + n + ' = ' + want, g(n)));

console.log(fail ? `✗ ${fail} 실패 · 통과 ${pass}` : `✓ 모두 통과 (통과 ${pass})`);
process.exit(fail ? 1 : 0);
