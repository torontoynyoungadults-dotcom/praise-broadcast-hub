#!/usr/bin/env python3
"""
라이브 악보 음성 콜아웃(큐) 녹음 파일 만들기 — Kokoro (오픈소스 음성 합성, 미국 영어) 로 목소리별 mp3 를 만듭니다.

  pip install kokoro-onnx soundfile numpy sherpa-onnx        (ffmpeg 필요 — rubberband 필터 포함 빌드)
  모델: https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0  (kokoro-v1.0.onnx · voices-v1.0.bin)
  python3 tools/gen-cues.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin --asr sherpa-onnx-whisper-tiny.en

결과: public/worship/cues/en/<목소리>/<큐id>-k4.mp3  +  public/worship/cues/en/manifest.json
 · 큐 목록(id · 영어 이름)은 public/worship/metro.js 의 CUES 에서 그대로 읽어 옵니다 (한 곳에서만 관리).
 · "밝고 경쾌한" 느낌 (V839): 느낌표로 끝내 억양을 올리고, 속도를 5% 높이고, 음높이를 조금 올리고(formant 유지 — 목소리 색은 그대로),
   고음 쪽을 살짝 밝게. 목소리별 값은 VOICES 에 있습니다.
 · 한 클립씩 음성 인식(whisper-tiny.en)으로 되읽어 확인합니다. 안 맞으면 CANDIDATES 의 다른 표기(예: Fur-mah-ta)로 다시 만들어 맞는 것을 고릅니다.
   끝까지 안 맞으면 가장 비슷한 것을 쓰고 마지막에 목록으로 알려줍니다.
 · 짧은 낱말(Bridge · Vamp · Break …)이 끝에서 잘리거나 씹히지 않게: 앞 무음 정리 · 끝에 숨 고르는 무음 · 부드러운 마무리 · 같은 크기로 맞춤(-1dBFS).
"""
import argparse, difflib, json, os, re, subprocess, sys, tempfile
import numpy as np
import soundfile as sf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SFX = '-k4'
# (id, 라벨, 성별, 속도, 음높이(반음))  — 미국식 영어 (Kokoro lang en-us).  음성 인식 점검 + 밝기(음높이 · 억양 폭)로 고른 목소리들
VOICES = [
    ('am_eric', 'Eric', 'm', 1.05, 1.5), ('am_liam', 'Liam', 'm', 1.05, 0.0), ('am_echo', 'Echo', 'm', 1.05, 0.0),   # V842 — 음높이 올림(rubberband)이 겹쳐 들리는 소리를 내서 그대로 둠
    ('am_fenrir', 'Fenrir', 'm', 1.05, 0.0), ('am_adam', 'Adam', 'm', 1.05, 0.0),   # V843 — 남 5 · 여 5 (Puck · Jessica · Kore 는 음성 인식 점검에서 뒤처져 뺌)
    ('am_michael', 'Michael', 'm', 1.05, 0.0), ('am_puck', 'Puck', 'm', 1.05, 0.0), ('am_santa', 'Santa', 'm', 1.05, 0.0),   # V856 — 남 8 (미국식)
    ('af_heart', 'Heart', 'f', 1.05, 0.0), ('af_bella', 'Bella', 'f', 1.05, 0.0), ('af_sarah', 'Sarah', 'f', 1.05, 0.0), ('af_sky', 'Sky', 'f', 1.05, 0.5), ('af_nova', 'Nova', 'f', 1.05, 0.0),
]
DEFAULT = 'am_eric'
# 기본 표기 순서 (영어 이름 + 느낌표 → 마침표 → 쉼표). 아래 CANDIDATES 에 있는 낱말은 그 표기를 먼저 시도
NOSHIFT = {'Bridge', 'Key Up', 'Prayer', 'Break', 'Build up', 'Tag'}   # V856 — 음높이를 올리면 발음이 뭉개지는 낱말은 올리지 않음 (Eric)
SLOW = {'Tag': 0.9, 'Prayer': 0.9, 'Four': 0.88, 'Five': 0.88, 'Eight': 0.88}   # 숫자 Four · Five(f) · Eight(모음) 도 천천히 읽어야 첫소리가 또렷함 (Eric · Sky)   # V856 — 이 낱말은 천천히 읽어야 첫 자음(T · P)이 또렷함
DEFAULT_TRY = ['{t}!', '{t}.', '{t},']
CANDIDATES = {
    'Fermata': ['ipa:fɝmˈɑɾə', 'Fur-mah-ta!', 'Fer-mah-tah!', 'Fermahta!'],     # ipa: 로 시작하면 발음기호로 직접 읽힘
    'Tag': ['ipa:tʰˈæɡ', 'Tag.', 'ipa:tˈæɡ'],                                       # V856 — "Tag" 한 단어만 (뒤에 다른 말을 붙이지 않음). tʰ = 센 T
    'Bridge': ['Bridge.', 'Bridge!', 'ipa:bɹˈɪʤ'],
    'Prayer': ['ipa:pʰɹˈɛɹ', 'Pray-er.', 'Prayer.'],
    'Half Chorus': ['Half Chorus!', 'Half. Chorus!', 'Half, chorus!'],
    'Voice only': ['Voice only!', 'Voice, only!', 'Voice. Only!'],
    'Build up': ['Build up.', 'Build-up.', 'Build up!'],
    'Pre-chorus': ['Pre chorus!', 'Pre-chorus!', 'Pre. Chorus!'],
    'Chorus': ['Chorus!', 'Core-us!', 'Chorus.'],
    'Vamp': ['Vamp!', 'ipa:vˈæmp', 'Vamp.'],
    'Hold': ['Hold!', 'Hold.', 'Hold,'],
    'Break': ['Break.', 'Break!', 'ipa:bɹˈeɪk'],
    'Alto in': ['Alto, in!', 'Alto in!', 'Alto. In!'],
    'Tenor in': ['Tenor, in!', 'Tenor in!', 'Tenor. In!'],
    'Session in': ['Session, in!', 'Session in!', 'Session. In!'],
    'Key Up': ['Key-up.', 'Key up', 'ipa:kˈi ˈʌp', 'Key up!'],
    'Die down': ['Die down!', 'Die, down!'],
    # 숫자 · Interlude — 어떤 목소리(Eric · Sky …)는 첫 자음을 흐리게 읽어서(Two → "Do") 센 자음 발음기호를 먼저 시도
    'One': ['ipa:wˈʌn', 'One!', 'One.', 'Won!'],
    'Two': ['ipa:tʰˈu', 'ipa:tʰˈuː', 'Two!', 'Two.'],
    'Four': ['ipa:fˈɔɹ', 'Four!', 'Four.', 'Fore!', 'ipa:fˈoʊɹ'],
    'Five': ['ipa:fˈaɪv', 'Five!', 'Five.', 'ipa:fˈaɪːv'],
    'Eight': ['ipa:ʔˈeɪt', 'ipa:ˈeɪt', 'Eight!', 'Eight.', 'Ate!', 'Eight, ', 'Ayt!'],
    'Interlude': ['ipa:ˈɪntɚlˌud', 'Interlude!', 'Interlude.', 'Inter-lude!'],
    'Chorus Voice only': ['Chorus, voice only!', 'Chorus. Voice only!', 'Chorus voice only!'],
    'measures': ['measures.', 'measures,', 'measures!'],     # "Interlude" · "Two" 뒤에 이어 붙는 말 — 억양을 올리지 않게 마침표 먼저
    'measure': ['measure.', 'measure,', 'measure!'],
}


def cues_from_metro():
    src = open(os.path.join(ROOT, 'public/worship/metro.js'), encoding='utf-8').read()
    block = src[src.index('var CUES = ['):src.index('var CUE_BY')]
    return [(m.group(1), m.group(2)) for m in re.finditer(r"\{\s*id:\s*'([^']+)',\s*en:\s*'([^']+)'", block)]


def nums_from_metro():
    """v8.39 — "숫자로 세기" · "콜아웃 뒤 Three·Two·One" 에 쓰는 One..Sixteen (metro.js 의 NUM_EN 배열에서 그대로 읽음, id 는 num1..num16)"""
    src = open(os.path.join(ROOT, 'public/worship/metro.js'), encoding='utf-8').read()
    m = re.search(r"var NUM_EN = \[([^\]]+)\]", src)
    words = re.findall(r"'([^']+)'", m.group(1)) if m else []
    return [('num' + str(i + 1), w) for i, w in enumerate(words)]


def brighten(a, sr, semi):
    """음높이를 조금 올리고(formant 유지) 고음을 살짝 밝게. ffmpeg rubberband 필터 사용"""
    with tempfile.TemporaryDirectory() as d:
        sf.write(d + '/i.wav', a, sr)
        af = []
        if semi: af.append('rubberband=pitch=%.5f:formant=preserved:pitchq=quality' % (2 ** (semi / 12.0)))
        af.append('highshelf=f=3500:g=3.5,equalizer=f=180:t=q:w=1:g=-1.5')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', d + '/i.wav', '-af', ','.join(af), d + '/o.wav'], check=True)
        o, sr2 = sf.read(d + '/o.wav', dtype='float32')
        return o, sr2


def polish(a, sr):
    a = np.asarray(a, dtype=np.float32)
    thr = 10 ** (-45 / 20) * max(1e-6, float(np.max(np.abs(a))))
    idx = np.where(np.abs(a) > thr)[0]
    if len(idx): a = a[max(0, idx[0] - int(0.02 * sr)): idx[-1] + int(0.06 * sr)]
    f = int(0.012 * sr)
    if len(a) > f: a[-f:] *= np.linspace(1, 0, f, dtype=np.float32)
    a = np.concatenate([np.zeros(int(0.01 * sr), np.float32), a, np.zeros(int(0.14 * sr), np.float32)])
    a = np.tanh(a * 1.25 / max(1e-6, float(np.max(np.abs(a)))) * 1.0) / np.tanh(1.25)
    a = a / max(1e-6, float(np.max(np.abs(a)))) * (10 ** (-1 / 20))
    return a


class Asr:
    def __init__(self, d):
        import sherpa_onnx
        # 폴더 안 모델 이름을 찾아 씀 — tiny.en 외에 더 정확한 base.en 도 됨 (sherpa-onnx-whisper-base.en)
        pre = next((f[:-len('-encoder.int8.onnx')] for f in sorted(os.listdir(d)) if f.endswith('-encoder.int8.onnx')), 'tiny.en')
        self.rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=d + '/' + pre + '-encoder.int8.onnx', decoder=d + '/' + pre + '-decoder.int8.onnx', tokens=d + '/' + pre + '-tokens.txt', num_threads=4, language='en', task='transcribe')

    def text(self, a, sr):
        if sr != 16000:
            import scipy.signal as ss
            a = ss.resample_poly(a, 16000, sr).astype(np.float32); sr = 16000
        a = np.concatenate([np.zeros(8000, np.float32), a.astype(np.float32), np.zeros(8000, np.float32)])
        s = self.rec.create_stream(); s.accept_waveform(sr, a); self.rec.decode_stream(s)
        return s.result.text


NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen']


def norm(t):
    t = re.sub(r'\bverse\b', 'v', str(t).lower())
    t = re.sub(r'\b(\d{1,2})\b', lambda m: NUMW[int(m.group(1))] if int(m.group(1)) < len(NUMW) else m.group(1), t) if not re.search(r'\bv\s*\d', t) else t    # 음성 인식이 "2" 로 적어도 "two" 와 같게 (V1 · V2 는 그대로)
    return re.sub(r'[^a-z0-9]', '', t)


def words_from_metro():
    """콜아웃에 덧붙이는 낱말 (예: "measures") — metro.js 의 WORD_EN 에서 그대로 읽음"""
    src = open(os.path.join(ROOT, 'public/worship/metro.js'), encoding='utf-8').read()
    i = src.find('var WORD_EN = [')
    if i < 0: return []
    block = src[i:src.index('];', i)]
    return [(m.group(1), m.group(2)) for m in re.finditer(r"\{\s*id:\s*'([^']+)',\s*en:\s*'([^']+)'", block)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='kokoro-v1.0.onnx'); ap.add_argument('--voices', default='voices-v1.0.bin')
    ap.add_argument('--asr', default='', help='음성 인식 모델 폴더 (sherpa-onnx-whisper-tiny.en). 없으면 점검 없이 첫 표기를 씀')
    ap.add_argument('--ids', default='', help='쉼표로 구분한 큐 id 만 다시 만들기 (예: num1,num2 — 비우면 전부)')
    ap.add_argument('--only', default='', help='쉼표로 구분한 목소리 id 만 (예: am_eric)')
    ap.add_argument('--out', default=os.path.join(ROOT, 'public/worship/cues/en'))
    args = ap.parse_args()
    from kokoro_onnx import Kokoro
    k = Kokoro(args.model, args.voices)
    asr = Asr(args.asr) if args.asr else None
    cues = cues_from_metro() + nums_from_metro() + words_from_metro()
    want_ids = set(x for x in args.ids.split(',') if x)
    if want_ids: cues = [c for c in cues if c[0] in want_ids]
    only = set(x for x in args.only.split(',') if x)
    man_path = os.path.join(args.out, 'manifest.json')
    # 매니페스트는 지우지 않고 이어서 고칩니다 — --ids 로 몇 개만 다시 만들 때 나머지 큐의 기록이 지워지지 않게.
    man = json.load(open(man_path, encoding='utf-8')) if os.path.exists(man_path) else {'clips': {}}
    man.update({'v': 4, 'sfx': SFX, 'lang': 'en', 'default': DEFAULT, 'engine': 'kokoro-v1.0'}); man.pop('speed', None)
    man['voices'] = {v: {'label': lab, 'g': g} for v, lab, g, _, _ in VOICES}
    misses = []
    for vid, lab, g, speed, semi in VOICES:
        if only and vid not in only: continue
        d = os.path.join(args.out, vid); os.makedirs(d, exist_ok=True)
        for cid, en in cues:
            tries = CANDIDATES.get(en) or [t.format(t=en) for t in DEFAULT_TRY]
            best = None
            for txt in tries:
                for fxs in ((0.0,) if en in NOSHIFT else (semi, semi / 2.0, 0.0)):          # 음높이를 올리면 첫 자음이 흐려지는 낱말은 덜 올리거나 그대로 (또렷함이 먼저)
                    if txt.startswith('ipa:'): a, sr = k.create(txt[4:], voice=vid, speed=SLOW.get(en, speed), lang='en-us', is_phonemes=True)
                    else: a, sr = k.create(txt, voice=vid, speed=SLOW.get(en, speed), lang='en-us')
                    a, sr = brighten(a, sr, fxs)
                    if not asr: best = (1, txt, a, sr); break
                    heard = asr.text(a, sr); sc = difflib.SequenceMatcher(None, norm(heard), norm(en)).ratio()
                    if sc >= 0.9: sc = 1.0                  # 'One more times' 처럼 끝 한 글자 차이는 같은 것으로 (음성 인식 오차)
                    if best is None or sc > best[0]: best = (sc, txt, a, sr, heard)
                    if sc == 1.0 or not semi: break
                if best[0] == 1.0: break
            sc, txt, a, sr = best[:4]
            if sc < 1.0: misses.append((vid, cid, en, txt, best[4], round(sc, 2)))
            a = polish(a, sr)
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as t: tmp = t.name
            sf.write(tmp, a, sr)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '80k', os.path.join(d, cid + SFX + '.mp3')], check=True)
            os.unlink(tmp)
            if vid == DEFAULT: man['clips'][cid] = {'t': en, 'd': round(len(a) / sr, 4)}
            print(vid, cid, round(len(a) / sr, 2), txt, '' if sc == 1.0 else '  ?? ' + str(best[4]), flush=True)
    if not only or DEFAULT in only:
        json.dump(man, open(man_path, 'w', encoding='utf-8'), ensure_ascii=False)
        print('manifest.json 저장')
    print('음성 인식이 다르게 들은 클립:', len(misses))
    for m in misses: print('  ', m)


if __name__ == '__main__':
    main()
