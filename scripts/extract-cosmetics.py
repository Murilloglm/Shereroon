"""Pixel-preserving extraction of the supplied sheets; never edits the originals.

Run from the repository root with Python + Pillow. Rectangles are source pixels.
Alpha masks remove explicitly identified apertures, never all dark/black pixels.
"""
from pathlib import Path
from hashlib import sha256
import json
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'enfeites'
DEST = ROOT / 'web/public/assets/cosmetics'
GRID = 'Grade de skins sci-fi neon em português-2.png'
CONCEPT = 'Conceito Cosmic Night_ Efeitos Cósmicos de Usuário.png'
NAMES = [
    ('night-fury', 'Fúria da Noite', 'Como Treinar Seu Dragão', ['#dcafff', '#9465ff']),
    ('light-fury', 'Fúria da Luz', 'Como Treinar Seu Dragão', ['#ffffff', '#b9d7ff']),
    ('madu-kaiden', 'Madu Kaiden', 'Eleceed', ['#fff0a3', '#ffc32e']),
    ('rimuru', 'Rimuru Tempest', 'Tensei Shitara Slime', ['#b7f6ff', '#40d7ff']),
    ('clove', 'Clove', 'Valorant', ['#f4bdff', '#cb70ff']),
    ('neon', 'Neon', 'Valorant', ['#54eaff', '#fff38a']),
    ('omen', 'Omen', 'Valorant', ['#d4b1ff', '#9b71ff']),
    ('jett', 'Jett', 'Valorant', ['#e1faff', '#7ddcff']),
    ('raze', 'Raze', 'Valorant', ['#fff07e', '#ff9e31']),
    ('tejo', 'Tejo', 'Valorant', ['#fff4ba', '#e7bd51']),
    ('rush', 'Rush', 'Deadlock', ['#ffb3df', '#ff59aa']),
]
STANDALONE = {
    0: 'Imagem do ChatGPT 18 de nov. de 2026, 22_41_58.png',
    1: 'Imagem do ChatGPT 18 de nov. de 2026, 22_42_03.png',
    2: 'Imagem do ChatGPT 18 de nov. de 2026, 22_42_08.png',
    3: 'Imagem do ChatGPT 18 de nov. de 2026, 22_42_13.png',
}
BANNERS = {
    0: ('Pacote Fúria da Noite em Neon-1.png', (44, 632, 1208, 911)),
    1: ('Pacote de Avatar Dragão Luminoso-3.png', (40, 683, 1204, 969)),
    2: ('Pacote Neon do Gato Elétrico-5.png', (24, 564, 1231, 924)),
    3: ('Pacote Cósmico de Slime Azul-7.png', (45, 513, 1208, 839)),
    4: ('Pacote de Cosméticos Neon Roxo da Clove-9.png', (44, 721, 1212, 987)),
    5: ('Painel Neon_ Arsenal Elétrico Futurista-11.png', (56, 736, 1199, 1002)),
}
EFFECT_Y = [(284,343),(365,424),(446,505),(526,585),(606,665),(685,743),
            (764,823),(841,898),(919,977),(998,1055),(1078,1137)]
cache = {}
def source(name):
    if name not in cache:
        cache[name] = Image.open(SOURCE / name).convert('RGBA')
    return cache[name]

def mask_image(im, outer=None, hole=None, ellipse=None):
    # Spatial masks: dark dragon scales, agent clothing and interior art stay intact.
    mask = Image.new('L', im.size, 255 if outer is None else 0)
    d = ImageDraw.Draw(mask)
    if outer: d.polygon(outer, fill=255)
    if hole: d.polygon(hole, fill=0)
    if ellipse: d.ellipse(ellipse, fill=0)
    im.putalpha(ImageChops.multiply(im.getchannel('A'), mask))
    return im

collections = []
for i, (slug, name, franchise, colors) in enumerate(NAMES):
    folder = DEST / slug
    folder.mkdir(parents=True, exist_ok=True)
    records = {}
    def save(filename, src, rect=None, **masks):
        original = source(src)
        rect = rect or (0, 0, original.width, original.height)
        im = original.crop(rect)
        if masks: im = mask_image(im, **masks)
        processing = []
        if filename == 'avatar-decoration.png' and max(im.size) > 512:
            im.thumbnail((512, 512), Image.Resampling.LANCZOS)
            processing.append('Lanczos downsample to max 512px (no upscaling)')
        # Lossless WebP and PNG retain source RGB and real alpha. No upscaling.
        im.save(folder / filename, lossless=True, method=6) if filename.endswith('.webp') else im.save(folder / filename, optimize=True)
        records[filename] = {'source': src, 'sha256': sha256((SOURCE/src).read_bytes()).hexdigest(),
                             'crop': list(rect), 'size': list(im.size), 'alpha': list(im.getchannel('A').getextrema()),
                             'mask': masks or 'original alpha', 'processing': processing}
        return im

    if i < 6:
        x, right = [(6,255),(264,512),(519,766),(773,1020),(1027,1275),(1283,1531)][i]
        cover = (x+2, 8, right-2, 128)
        avatar = (x+13, 179, x+126, 264)
        frame = (x+10, 289, right-10, 342)
        banner = (x+15, 364, right-15, 428)
        swatch = (x+125, 455, right-19, 487)
        badge = (x+155, 183, right-17, 259)
    else:
        x, right = [(10,306),(315,609),(617,912),(919,1217),(1226,1524)][i-6]
        cover = (x+2, 520, right-2, 630)
        avatar = (x+31, 672, x+145, 759)
        frame = (x+20, 779, right-20, 832)
        banner = (x+15, 855, right-15, 924)
        swatch = (x+135, 956, right-38, 993)
        badge = (x+184, 678, right-30, 757)

    save('cover.webp', GRID, cover)
    avatar_scale = 1.45
    if i in STANDALONE:
        save('avatar-decoration.png', STANDALONE[i])
        avatar_scale = [1.52, 1.60, 1.64, 1.55][i]
    elif i == 4:
        save('avatar-decoration.png', 'Pacote de Cosméticos Neon Roxo da Clove-9.png', (90,326,510,704),
             outer=[(15,80),(90,30),(220,0),(310,38),(395,45),(420,180),(394,288),(230,378),(100,367),(10,290),(0,163)],
             ellipse=(94,93,322,293))
        avatar_scale = 1.80
    elif i == 5:
        save('avatar-decoration.png', 'Painel Neon_ Arsenal Elétrico Futurista-11.png', (40,287,504,710),
             outer=[(0,195),(40,86),(180,0),(340,23),(430,91),(464,220),(427,339),(296,423),(125,406),(40,313)],
             ellipse=(105,82,393,352))
        avatar_scale = 1.56
    else:
        w, h = avatar[2]-avatar[0], avatar[3]-avatar[1]
        # Ring aperture and outside ellipse only; never use a color key on the artwork.
        im = source(GRID).crop(avatar)
        m = Image.new('L', im.size, 0); d = ImageDraw.Draw(m)
        d.ellipse((3,0,w-3,h-1), fill=255); d.ellipse((24,18,w-26,h-18),fill=0)
        im.putalpha(m); im.save(folder/'avatar-decoration.png',optimize=True)
        records['avatar-decoration.png'] = {'source': GRID,'sha256': sha256((SOURCE/GRID).read_bytes()).hexdigest(), 'crop':list(avatar),'size':list(im.size),'alpha':[0,255], 'mask':'explicit ring aperture and outer ellipse'}
        avatar_scale = 1.85

    w, h = frame[2]-frame[0], frame[3]-frame[1]
    save('profile-frame.png', GRID, frame,
         outer=[(0,8),(12,2),(w-12,2),(w-1,8),(w-1,h-8),(w-12,h-2),(12,h-2),(0,h-8)],
         hole=[(19,18),(w*.43,18),(w*.5,28),(w*.57,18),(w-19,18),(w-16,h-18),(w-25,h-13),(23,h-13),(16,h-19)])
    if i in BANNERS:
        src, rect = BANNERS[i]; save('profile-banner.webp',src,rect)
    else: save('profile-banner.webp',GRID,banner)
    save('username-effect.png',GRID,swatch)
    y1,y2 = EFFECT_Y[i]
    effect = save('member-name-effect.webp',CONCEPT,(783,y1,1093,y2))
    save('server-badge.png',GRID,badge)
    metadata = {'id':slug,'name':name,'franchise':franchise,'colors':colors,'avatarScale':avatar_scale,
                'resolution': 'sheet' if i < 6 else 'overview-only',
                'notes': ['Máscaras espaciais preservam áreas pretas decorativas.', 'Cor do nome usa o gradiente da referência; a amostra Aa não é sobreposta ao nick.'] +
                         (['Avatar, moldura, banner e capa disponíveis somente na grade; enviar elementos separados em alta resolução para maior definição.'] if i>=6 else []),
                'files':records}
    (folder/'metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    collections.append({k:metadata[k] for k in ['id','name','franchise','colors','avatarScale','resolution']})

# Types live with the generated data; no runtime dependency on the extraction tool.
ts = '/** Generated by scripts/extract-cosmetics.py from the supplied original artwork. */\n'
ts += 'export interface CosmeticCollection {\n  id: string; name: string; franchise: string; colors: [string, string]; avatarScale: number; resolution: string;\n}\n\n'
ts += 'export const COLLECTIONS: CosmeticCollection[] = '+json.dumps(collections,ensure_ascii=False,indent=2)+';\n'
ts += '\nexport const collectionById = (id: string) => COLLECTIONS.find((collection) => collection.id === id);\n'
(ROOT/'shared/cosmetic-collections.ts').write_text(ts,encoding='utf-8')
print(f'Extracted {len(collections)} collections to {DEST}; originals unchanged.')
