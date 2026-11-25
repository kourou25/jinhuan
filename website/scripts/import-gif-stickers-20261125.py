# 2026-11-25 站长需求：D:\self\claude\png 的图加入「💗」，png\东方 单独做成「东方」表情包，💗 排到表情包最前面。
#   python scripts/import-gif-stickers-20261125.py D:/self/claude/png
# 图片本体不入库（.gitignore），要单独传到服务器 /meme/static/stickers；清单、代码表、搜索词入库。可重复执行。
import json, os, sys
from PIL import Image, ImageSequence

SRC = sys.argv[1]
OUT = 'public/stickers'
# 与 heartgif_053 逐帧一致，不重复加入
SKIP = {'6407042d58f9aeca5ca0e2b0.gif'}
FIRST = 54  # 已有 heartgif_001 ~ 053


def frames_of(path):
    im = Image.open(path)
    frames, durations = [], []
    for f in ImageSequence.Iterator(im):
        frames.append(f.convert('RGBA'))
        durations.append(max(20, int(f.info.get('duration') or 100)))
    return frames, durations


def fit(size, limit):
    k = min(1, limit / max(size))
    return (max(1, round(size[0] * k)), max(1, round(size[1] * k)))


def save(frames, durations, path, limit, quality):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    size = fit(frames[0].size, limit)
    out = [f if f.size == size else f.resize(size, Image.LANCZOS) for f in frames]
    if len(out) == 1:
        out[0].save(path, 'WEBP', quality=quality, method=6)
    else:
        out[0].save(path, 'WEBP', save_all=True, append_images=out[1:], duration=durations, loop=0, quality=quality, method=4)
    return os.path.getsize(path)


def build(path, pack, name):
    frames, durations = frames_of(path)
    a = save(frames, durations, f'{OUT}/{pack}/{name}.webp', 320, 80)
    b = save(frames[:1], durations[:1], f'{OUT}/{pack}/thumbs/{name}.webp', 128, 80)
    c = save(frames, durations, f'{OUT}/{pack}/previews/{name}.webp', 96, 60)
    print(f'{pack}:{name}', len(frames), '帧', a, b, c)


heart = sorted(f for f in os.listdir(SRC) if os.path.isfile(os.path.join(SRC, f)) and f.lower().endswith(('.gif', '.png')) and f not in SKIP)
touhou_dir = os.path.join(SRC, '东方')
touhou = sorted(f for f in os.listdir(touhou_dir) if f.lower().endswith('.gif'))

heart_items, words_add = [], {}
for i, f in enumerate(heart):
    name = f'heartgif_{FIRST + i:03d}'
    build(os.path.join(SRC, f), 'heartgif', name)
    heart_items.append(name)
    words_add['heartgif:' + name] = '💗 ' + os.path.splitext(f)[0].lstrip('0123456789-').replace('_', ' ').replace('-', ' ')
touhou_items = []
for i, f in enumerate(touhou):
    name = f'touhou_{i + 1:03d}'
    build(os.path.join(touhou_dir, f), 'touhou', name)
    touhou_items.append(name)
    words_add['touhou:' + name] = '东方 ' + os.path.splitext(f)[0].replace('-', ' ')

# 053 原来缺面板动态预览
if not os.path.exists(f'{OUT}/heartgif/previews/heartgif_053.webp'):
    fr, du = frames_of(f'{OUT}/heartgif/heartgif_053.webp')
    save(fr, du, f'{OUT}/heartgif/previews/heartgif_053.webp', 96, 60)

packs = [p for p in json.load(open(f'{OUT}/packs.json', encoding='utf-8')) if p['key'] != 'touhou']
for p in packs:
    if p['key'] == 'heartgif':
        p['items'] = [n for n in p['items'] if n not in heart_items] + heart_items
lead = [p for p in packs if p['key'] in ('muscle', 'heartgif')]
rest = [p for p in packs if p['key'] not in ('muscle', 'heartgif')]
packs = lead + [{'key': 'touhou', 'label': '东方', 'ext': 'webp', 'custom': True, 'items': touhou_items}] + rest
dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
open(f'{OUT}/packs.json', 'w', encoding='utf-8', newline='').write(dump(packs))

ext = {}
for p in packs:
    ext[p['key']] = p['ext']
tokens = sorted({f"{p['key']}:{n}" for p in packs for n in p['items']})
open('src/stickers.ts', 'w', encoding='utf-8', newline='').write(
    '// 由 scripts/build_stickers.py / build_custom_stickers.py / build-nga-stickers-20261015.mjs / import-heart-gifs-20261017.mjs / import-gif-stickers-20261125.py 生成，勿手改\n'
    + f'export const STICKER_EXT: Record<string, string> = {dump(ext)}\nexport const STICKERS = new Set<string>({dump(tokens)})\n')

words = json.load(open('public/emoji-search.json', encoding='utf-8'))
words.update(words_add)
open('public/emoji-search.json', 'w', encoding='utf-8', newline='').write(dump(words))
print('heart', len(heart_items), 'touhou', len(touhou_items), 'tokens', len(tokens))
