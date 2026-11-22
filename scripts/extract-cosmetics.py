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

# Full-size sheets supply the actual profile frames and nameplates. Keep their
# dark interior artwork intact: it is the backdrop, not a transparency key.
PANELS = {
    0: ((645, 174, 1160, 610), (73, 977, 758, 1109)),
    1: ((560, 215, 1208, 675), (74, 1045, 642, 1170)),
    2: ((694, 30, 1198, 544), (40, 988, 746, 1170)),
    3: ((553, 111, 1202, 488), (28, 879, 726, 1020)),
    4: ((565, 337, 1155, 697), (93, 1041, 742, 1156)),
    5: ((538, 302, 1208, 699), (96, 1066, 661, 1174)),
}
BADGES = {
    0: (789, 970, 1198, 1114), 1: (723, 1017, 1199, 1203),
    2: (780, 996, 1203, 1160), 3: (781, 866, 1189, 1011),
    4: (825, 1025, 1154, 1153), 5: (793, 1040, 1145, 1191),
}
ALTERNATE_BANNERS = {
    1: [('aurora', 'Aurora', 'Pacote de UI Light Fury com Aurora-1.png', (939, 111, 1662, 533)),
        ('luar', 'Luar', 'Painel Neon da Fúria da Luz-4.png', (19, 682, 1240, 1235))],
    2: [('tempestade', 'Tempestade elétrica', 'Kit de Perfil Felino Elétrico Neon-6.png', (35, 583, 1216, 946)),
        ('dourado', 'Energia dourada', 'Pacote Visual Gato Elétrico Neon-2.png', (958, 37, 1671, 478))],
    3: [('tempest', 'Tempest', 'Conjunto de Cosméticos do Slime Azul-3.png', (957, 72, 1672, 430)),
        ('celestial', 'Celestial', 'Cosméticos de Rimuru em Néon Celestial-8.png', (25, 622, 1231, 932))],
    4: [('espectral', 'Espectral', 'Kit Cosmético Neon de Clove-4.png', (22, 508, 1515, 996)),
        ('borboletas', 'Borboletas', 'Kit de Interface Neon da Clove-10.png', (24, 15, 1232, 437))],
    5: [('velocidade', 'Velocidade', 'Kit cosmético neon de Valorant-12.png', (38, 583, 1215, 987)),
        ('eletrica', 'Energia elétrica', 'Kit de UI Neon com Energia Elétrica-5.png', (22, 533, 1169, 921))],
}
REFERENCE_SHEETS = {
    0: [STANDALONE[0], BANNERS[0][0]],
    1: [STANDALONE[1], BANNERS[1][0], 'Pacote de UI Light Fury com Aurora-1.png', 'Painel Neon da Fúria da Luz-4.png'],
    2: [STANDALONE[2], BANNERS[2][0], 'Kit de Perfil Felino Elétrico Neon-6.png', 'Pacote Visual Gato Elétrico Neon-2.png'],
    3: [STANDALONE[3], BANNERS[3][0], 'Conjunto de Cosméticos do Slime Azul-3.png', 'Cosméticos de Rimuru em Néon Celestial-8.png'],
    4: [BANNERS[4][0], 'Kit Cosmético Neon de Clove-4.png', 'Kit de Interface Neon da Clove-10.png'],
    5: [BANNERS[5][0], 'Kit cosmético neon de Valorant-12.png', 'Kit de UI Neon com Energia Elétrica-5.png'],
}
TAGLINES = ['Asas violetas, escamas e luar.', 'Aurora, cristais e luz celestial.',
            'Raios dourados e um gato nada comum.', 'Slimes, magia e as águas de Tempest.',
            'Borboletas e energia espectral.', 'Azul elétrico em velocidade máxima.',
            'Sombras e um portal violeta.', 'Vento, gelo e céu aberto.',
            'Laranja, faíscas e explosão.', 'Precisão em tons de ouro.', 'Rosa neon em movimento.']

# Each complete original is available for comparison in the app. The four
# transparent avatars keep their native resolution in the actual decoration too.
reference_assets = {}
reference_dest = ROOT / 'web/public/assets/cosmetic-references'
reference_dest.mkdir(parents=True, exist_ok=True)
for index, path in enumerate(sorted(SOURCE.glob('*.png'))):
    filename = f'reference-{index + 1:02d}.webp'
    original = Image.open(path).convert('RGBA')
    original.save(reference_dest / filename, lossless=True, exact=True, method=6)
    reference_assets[path.name] = {'asset': f'assets/cosmetic-references/{filename}',
        'name': path.stem, 'source': path.name, 'sha256': sha256(path.read_bytes()).hexdigest(), 'size': list(original.size)}
(reference_dest / 'metadata.json').write_text(json.dumps(reference_assets, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
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
        # Lossless WebP and PNG retain source RGB and real alpha. No upscaling.
        im.save(folder / filename, lossless=True, exact=True, method=6) if filename.endswith('.webp') else im.save(folder / filename, optimize=True)
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

    frame_aspect = None
    # The old horizontal frame is retained as the nameplate for overview-only
    # collections. Detailed collections use both pieces from the large sheet.
    if i in PANELS:
        src, banner_rect = BANNERS[i]
        panel_rect, nameplate_rect = PANELS[i]
        panel = save('profile-frame.png', src, panel_rect)
        frame_aspect = round(panel.width / panel.height, 6)
        if i == 2:
            save('nameplate.webp', 'Pacote Visual Gato Elétrico Neon-2.png', (532, 451, 1325, 648))
        else:
            save('nameplate.webp', src, nameplate_rect)
        save('server-badge.png', src, BADGES[i])
        # The profile panorama is the cover too, so the shop no longer enlarges
        # the tiny overview crops or clips the character's face.
        save('cover.webp', src, banner_rect)
    else:
        save('nameplate.webp', GRID, frame)

    banners = []
    for variant_id, variant_name, src, rect in ALTERNATE_BANNERS.get(i, []):
        filename = f'profile-banner-{variant_id}.webp'
        save(filename, src, rect)
        banners.append({'id': variant_id, 'name': variant_name, 'asset': f'assets/cosmetics/{slug}/{filename}'})
    references = [reference_assets[src] for src in REFERENCE_SHEETS.get(i, [GRID])]
    references += [reference_assets[CONCEPT]]
    metadata = {'id':slug,'name':name,'franchise':franchise,'colors':colors,'avatarScale':avatar_scale,
                'resolution': 'sheet' if i < 6 else 'overview-only',
                'tagline': TAGLINES[i], 'frameAspect': frame_aspect,
                'nameplateAsset': f'assets/cosmetics/{slug}/nameplate.webp',
                'references': [{k: ref[k] for k in ['asset', 'name']} for ref in references], 'banners': banners,
                'notes': ['Máscaras espaciais preservam áreas pretas decorativas.', 'Painéis, fundos e faixas são recortes exatos, sem redesenho ou ampliação.', 'Cor do nome usa o gradiente da referência; a amostra Aa não é sobreposta ao nick.'] +
                         (['Avatar, moldura, banner e capa disponíveis somente na grade; enviar elementos separados em alta resolução para maior definição.'] if i>=6 else []),
                'files':records}
    (folder/'metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    collections.append({k:metadata[k] for k in ['id','name','franchise','colors','avatarScale','resolution','tagline','frameAspect','nameplateAsset','references','banners']})

# Types live with the generated data; no runtime dependency on the extraction tool.
ts = '/** Generated by scripts/extract-cosmetics.py from the supplied original artwork. */\n'
ts += '''export interface CollectionArtwork { id: string; name: string; asset: string; }
export interface CosmeticCollection {
  id: string; name: string; franchise: string; colors: [string, string]; avatarScale: number; resolution: string;
  tagline: string; frameAspect: number | null; nameplateAsset: string;
  references: { asset: string; name: string }[]; banners: CollectionArtwork[];
}

'''
ts += 'export const COLLECTIONS: CosmeticCollection[] = '+json.dumps(collections,ensure_ascii=False,indent=2)+';\n'
ts += '\nexport const collectionById = (id: string) => COLLECTIONS.find((collection) => collection.id === id);\n'
(ROOT/'shared/cosmetic-collections.ts').write_text(ts,encoding='utf-8')
print(f'Extracted {len(collections)} collections to {DEST}; originals unchanged.')
