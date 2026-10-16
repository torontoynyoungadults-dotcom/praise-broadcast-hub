"""앱 아이콘 만들기 — V12 테마 "Evergreen & Brass"(public/css/app.css 의 --hero-* · --accent 색)에 맞춘 그림.
   상록 여명 하늘 + 샴페인 골드 해 · 퍼지는 소리(방송) 물결 + 십자가 + 아래 호숫가 언덕 (배너 그림과 같은 느낌)

   실행:  pip install cairosvg pillow   →   python3 tools/gen-icons.py
   만드는 것 (public/icons/): icon.svg · icon-favicon.svg · icon-maskable.svg · icon-apple.svg
                             icon-192.png · icon-512.png · icon-maskable-512.png · apple-touch-icon.png
                             favicon-32.png · favicon-48.png · favicon.ico
"""
import io
import math
import os

import cairosvg
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')

# --- 테마 색 (app.css 어두운 화면 :root) ---
SKY1, SKY2, SKY3 = '#0B1A17', '#14302A', '#3E4A33'   # --hero-sky-1..3
SUN_HI, SUN, GOLD = '#F3E6C6', '#E9D3A4', '#D6B97F'  # 해 밝은 쪽 · --hero-sun · --accent
EVERGREEN = '#1F4A3F'                                 # 밝은 화면 --accent (십자가)
HILL1, HILL2 = '#10261F', '#0A1A15'                   # --hero-mtn-2 · --hero-mtn-3


def svg(rx, scale, small=False):
    """rx: 모서리 둥글기(0 = 기기가 알아서 자름) · scale: 가운데 그림 크기 · small: 파비콘(가는 바깥 물결 생략)"""
    arcs = [(138, 1), (182, .62)] + ([] if small else [(226, .3)])
    paths = []
    for r, op in arcs:

        a = math.radians(38)
        dx, dy = r * math.cos(a), r * math.sin(a)
        paths.append(f'<path d="M {256+dx:.2f} {256-dy:.2f} A {r} {r} 0 0 1 {256+dx:.2f} {256+dy:.2f}" opacity="{op}"/>')
        paths.append(f'<path d="M {256-dx:.2f} {256-dy:.2f} A {r} {r} 0 0 0 {256-dx:.2f} {256+dy:.2f}" opacity="{op}"/>')
    sw = 26 if small else 20
    hills = '' if small else f'''
    <path d="M0 446 C 96 428 176 440 256 436 S 420 424 512 440 V512 H0 Z" fill="{HILL1}"/>
    <path d="M0 474 C 120 462 250 482 380 470 S 470 466 512 472 V512 H0 Z" fill="{HILL2}"/>
    <g stroke="{SUN}" stroke-width="5" stroke-linecap="round" opacity=".42"><path d="M206 488 H306"/><path d="M228 498 H284"/></g>'''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- V12 "Evergreen &amp; Brass": 상록 여명 {SKY1} → {SKY2} → {SKY3} · 샴페인 골드 {GOLD} · 상록 {EVERGREEN} -->
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{SKY1}"/><stop offset=".58" stop-color="{SKY2}"/><stop offset="1" stop-color="{SKY3}"/>
    </linearGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="{GOLD}" stop-opacity=".42"/><stop offset=".55" stop-color="{GOLD}" stop-opacity=".12"/><stop offset="1" stop-color="{GOLD}" stop-opacity="0"/></radialGradient>
    <radialGradient id="sun" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="{SUN_HI}"/><stop offset=".6" stop-color="{SUN}"/><stop offset="1" stop-color="{GOLD}"/></radialGradient>
    <linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="sh"><rect width="512" height="512" rx="{rx}"/></clipPath>
  </defs>
  <g clip-path="url(#sh)">
    <rect width="512" height="512" fill="url(#bg)"/>
    <rect width="512" height="200" fill="url(#gl)"/>
    <g transform="translate(256 256) scale({scale}) translate(-256 -256)">
      <circle cx="256" cy="256" r="236" fill="url(#glow)"/>
      <g fill="none" stroke="{GOLD}" stroke-width="{sw}" stroke-linecap="round">
        {''.join(paths)}
      </g>
      <circle cx="256" cy="256" r="98" fill="url(#sun)"/>
      <g fill="{EVERGREEN}">
        <rect x="237" y="166" width="38" height="196" rx="10"/>
        <rect x="199" y="212" width="114" height="38" rx="10"/>
      </g>
    </g>{hills}
  </g>
</svg>
'''


def png(svg_text, size):
    data = cairosvg.svg2png(bytestring=svg_text.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(data)).convert('RGBA')


def main():
    icon = svg(112, .95)            # 둥근 모서리 — 브라우저 · 데스크톱
    full = svg(0, .84)              # 꽉 찬 사각 — 안드로이드 maskable(안전 영역 80%) · iOS(기기가 둥글게 자름)
    fav = svg(112, 1.0, small=True) # 아주 작은 크기용 — 굵은 선 · 장식 생략
    files = {'icon.svg': icon, 'icon-favicon.svg': fav, 'icon-maskable.svg': full, 'icon-apple.svg': full}
    for name, text in files.items():
        with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
            f.write(text)
    png(icon, 192).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
    png(icon, 512).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
    png(full, 512).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
    png(full, 180).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
    png(fav, 32).save(os.path.join(OUT, 'favicon-32.png'), optimize=True)
    png(fav, 48).save(os.path.join(OUT, 'favicon-48.png'), optimize=True)
    png(fav, 256).save(os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    print('icons written to', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
