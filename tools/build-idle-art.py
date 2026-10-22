#!/usr/bin/env python3
"""镇妖塔挂机道具图集：从 environment_sprites.png（8×8，每格 128px）挑出塔内要用的道具，
裁掉透明边后按 96px 一格重新排版，输出 art/idle/props-data.js（webp 的 data URI），并把每个道具的位置写入 art/idle/props.json。
用法：python3 tools/build-idle-art.py（原图更新后重跑，再把 JSON 内容同步到 idle-art.js 的 IDLE_PROPS）。"""
import io, base64
import json, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'environment_sprites.png')
OUT = os.path.join(ROOT, 'art', 'idle')
CELL, COLS = 96, 8
# 名称: (行, 列)
PICK = {
    'chest': (6, 1), 'torch': (7, 0), 'seal': (7, 6), 'portal': (7, 7), 'shrine': (1, 7), 'altar': (7, 1),
    'skulls': (3, 2), 'bones': (1, 5), 'cage': (7, 5), 'banner': (7, 4), 'rack': (6, 7), 'pot': (6, 3),
    'sack': (6, 4), 'barrel': (6, 0), 'crate': (6, 2), 'statue': (7, 2), 'well': (7, 3), 'candles': (4, 7),
    'blood': (5, 7), 'grave': (1, 6), 'lamp': (1, 4), 'mushroom': (1, 0), 'rock': (0, 0), 'roots': (0, 7),
    'bucket': (6, 5), 'wheel': (6, 6), 'twigs': (0, 3),
    'ice1': (2, 0), 'ice2': (2, 2), 'ice3': (3, 1), 'icerock': (2, 1), 'bluefire': (3, 3), 'runestone': (3, 5),
    'icepillar': (3, 6), 'icespikes': (2, 7), 'frostbones': (2, 3), 'icecrate': (3, 4), 'icepile': (3, 7),
    'lavacrack': (4, 0), 'lavarock': (4, 1), 'skulls2': (4, 2), 'horns': (4, 3), 'obsidian': (4, 4),
    'brazier': (4, 5), 'campfire': (5, 0), 'lavatile': (5, 1), 'runeslab': (5, 2), 'bone2': (5, 3),
    'demonskull': (5, 4), 'redcrystal': (5, 5), 'debris': (5, 6), 'coal': (4, 6),
}

def main():
    src = Image.open(SRC).convert('RGBA')
    cw, ch = src.width // 8, src.height // 8
    rows = (len(PICK) + COLS - 1) // COLS
    atlas = Image.new('RGBA', (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    meta = {}
    for i, (name, (r, c)) in enumerate(PICK.items()):
        cell = src.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
        alpha = cell.split()[3].point(lambda a: 255 if a > 16 else 0)
        box = alpha.getbbox()
        cell = cell.crop(box)
        s = min((CELL - 4) / cell.width, (CELL - 4) / cell.height)
        w, h = max(1, round(cell.width * s)), max(1, round(cell.height * s))
        cell = cell.resize((w, h), Image.LANCZOS)
        x0, y0 = (i % COLS) * CELL, (i // COLS) * CELL
        x, y = x0 + (CELL - w) // 2, y0 + CELL - 2 - h
        atlas.alpha_composite(cell, (x, y))
        meta[name] = [x, y, w, h]
    os.makedirs(OUT, exist_ok=True)
    # 以 base64 data URI 写进 JS（仓库只收文本文件），镇妖塔打开时按需加载
    buf = io.BytesIO()
    atlas.save(buf, 'WEBP', quality=78, method=6)
    data = base64.b64encode(buf.getvalue()).decode('ascii')
    with open(os.path.join(OUT, 'props-data.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('// 由 tools/build-idle-art.py 生成：镇妖塔道具图集（%dx%d webp）\n' % atlas.size)
        f.write("window.IDLE_PROPS_DATA = 'data:image/webp;base64,%s';\n" % data)
    with open(os.path.join(OUT, 'props.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, separators=(',', ':'))
    print('props', atlas.size, len(meta), len(buf.getvalue()), 'bytes')

if __name__ == '__main__':
    main()
