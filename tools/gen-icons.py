"""앱 아이콘 만들기 — V13 "흑녹 · 금" 테마 (A · 금 원).
   흑녹 바탕 + 놋쇠 금 원 안의 흑녹 십자가 + 양옆으로 흐려지는 울림 세 겹 + 아래 언덕 위 금색 YN.
   그라데이션 · 빛 번짐 없이 단색만. YN 글자는 마루부리(public/fonts/MaruBuri-Bold.woff2)에서 윤곽선으로 뽑아 넣어
   글꼴이 없는 기기에서도 똑같이 보입니다.

   실행:  pip install cairosvg pillow fonttools brotli   →   python3 tools/gen-icons.py
   만드는 것 (public/icons/): icon.svg · icon-favicon.svg · icon-maskable.svg · icon-apple.svg
                             icon-192.png · icon-512.png · icon-maskable-512.png · apple-touch-icon.png
                             favicon-32.png · favicon-48.png · favicon.ico
"""
import io
import os

import cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'public', 'icons')
FONT = os.path.join(ROOT, 'public', 'fonts', 'MaruBuri-Bold.woff2')

# --- V13 테마 색 (public/css/v13.css) ---
INK = '#0F1A16'      # 흑녹
HILL = '#17261F'     # 언덕 (흑녹보다 한 단계 밝게)
GOLD = '#C6A664'     # 놋쇠 금
GOLD_HI = '#E2CC97'  # 밝은 금 (YN)

# 그림은 180 × 180 좌표로 그리고, viewBox 로 원하는 크기에 맞춥니다.


def text_path(text, size, cx, baseline, tracking=0.0):
    """글자를 SVG path 로 — 가운데 정렬 · 글자 사이 tracking(px)"""
    font = TTFont(FONT)
    cmap, gs = font.getBestCmap(), font.getGlyphSet()
    upm = font['head'].unitsPerEm
    k = size / upm
    names = [cmap[ord(ch)] for ch in text]
    widths = [gs[n].width * k for n in names]
    total = sum(widths) + tracking * (len(names) - 1)
    x = cx - total / 2
    out = []
    for n, w in zip(names, widths):
        pen = SVGPathPen(gs)
        gs[n].draw(TransformPen(pen, (k, 0, 0, -k, x, baseline)))
        out.append(pen.getCommands())
        x += w + tracking
    return ' '.join(out)


def arcs(cx, cy, rings, width):
    """양옆 울림 — rings: [(반지름, 불투명도)] · 40° 위아래로 벌어진 호"""
    cos, sin = 0.766, 0.643
    out = []
    for r, op in rings:
        dx, dy = r * cos, r * sin
        out.append(f'<path d="M{cx - dx:.1f} {cy - dy:.1f} A{r} {r} 0 0 0 {cx - dx:.1f} {cy + dy:.1f}" opacity="{op}"/>')
        out.append(f'<path d="M{cx + dx:.1f} {cy - dy:.1f} A{r} {r} 0 0 1 {cx + dx:.1f} {cy + dy:.1f}" opacity="{op}"/>')
    return f'<g fill="none" stroke="{GOLD}" stroke-width="{width}" stroke-linecap="round">{"".join(out)}</g>'


def svg(rx, scale=1.0, small=False):
    """rx: 모서리 둥글기(0 = 기기가 자름) · scale: 안전 영역용 축소(언덕 · 바탕은 그대로 꽉 채움) · small: 파비콘"""
    if small:   # 아주 작은 크기 — 원 · 십자가 크게, 울림 한 겹, 글자 없음
        body = (arcs(90, 90, [(54, 1)], 9)
                + f'<circle cx="90" cy="90" r="38" fill="{GOLD}"/>'
                + f'<rect x="84" y="64" width="12" height="52" fill="{INK}"/><rect x="69" y="78" width="42" height="12" fill="{INK}"/>')
        hill = ''
    else:
        body = (arcs(90, 78, [(42, 1), (54, .6), (66, .32)], 3)
                + f'<circle cx="90" cy="78" r="30" fill="{GOLD}"/>'
                + f'<rect x="86" y="57" width="8" height="42" fill="{INK}"/><rect x="74" y="69" width="32" height="8" fill="{INK}"/>'
                + f'<path d="{text_path("YN", 20, 90, 169, 2)}" fill="{GOLD_HI}"/>')
        hill = f'<path d="M0 150 Q 90 128 180 150 L180 180 L0 180 Z" fill="{HILL}"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="512" height="512">
  <!-- V13 "흑녹 · 금": 흑녹 {INK} · 언덕 {HILL} · 금 {GOLD} · 밝은 금 {GOLD_HI} -->
  <defs><clipPath id="sh"><rect width="180" height="180" rx="{rx}"/></clipPath></defs>
  <g clip-path="url(#sh)">
    <rect width="180" height="180" fill="{INK}"/>
    {hill}
    <g transform="translate(90 90) scale({scale}) translate(-90 -90)">{body}</g>
  </g>
</svg>
'''


def png(svg_text, size):
    data = cairosvg.svg2png(bytestring=svg_text.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(data)).convert('RGBA')


def main():
    icon = svg(40)                  # 둥근 모서리 — 브라우저 · 데스크톱
    apple = svg(0)                  # 꽉 찬 사각 — iOS 가 알아서 둥글게 자름
    mask = svg(0, .84)              # 안드로이드 maskable — 그림을 안전 영역(80%) 안으로
    fav = svg(40, small=True)       # 아주 작은 크기용
    files = {'icon.svg': icon, 'icon-favicon.svg': fav, 'icon-maskable.svg': mask, 'icon-apple.svg': apple}
    for name, text in files.items():
        with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
            f.write(text)
    png(icon, 192).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
    png(icon, 512).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
    png(mask, 512).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
    png(apple, 180).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
    png(fav, 32).save(os.path.join(OUT, 'favicon-32.png'), optimize=True)
    png(fav, 48).save(os.path.join(OUT, 'favicon-48.png'), optimize=True)
    png(fav, 256).save(os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    print('icons written to', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
