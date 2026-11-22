"""Lossless artwork crops and separate display masks. Source images are never rewritten."""
from pathlib import Path
from avatar_centers import write_centers
from hashlib import sha256
from shutil import copy2
from PIL import Image, ImageChops, ImageDraw, ImageOps
import json

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT/'enfeites definitivos'
DEST = ROOT/'web/public/assets/cosmetics'
REFERENCES = ROOT/'web/public/assets/cosmetic-references'
GRID = 'Grade de skins sci-fi neon em português-2.png'
NAMES = [
    ('night-fury','Fúria da Noite','Como Treinar Seu Dragão',['#dcafff','#9465ff']),
    ('light-fury','Fúria da Luz','Como Treinar Seu Dragão',['#ffffff','#b9d7ff']),
    ('madu-kaiden','Kayden','Eleceed',['#80caff','#ffd26f']),
    ('rimuru','Rimuru Tempest','Tensei Shitara Slime',['#b7f6ff','#40d7ff']),
    ('clove','Clove','Valorant',['#f4bdff','#cb70ff']),
    ('neon','Neon','Valorant',['#54eaff','#fff38a']),
    ('omen','Omen','Valorant',['#d4b1ff','#9b71ff']),
    ('jett','Jett','Valorant',['#e1faff','#7ddcff']),
    ('raze','Raze','Valorant',['#fff07e','#ff9e31']),
    ('tejo','Tejo','Valorant',['#fff4ba','#e7bd51']),
    ('rush','Rush','Deadlock',['#ffb3df','#ff59aa']),
    ('barou','Barou','Blue Lock',['#fff1ed','#ff334f']),
    ('garou','Garou Cósmico','One Punch Man',['#d8baff','#578fff']),
]
FLOWER_PACK = 'hinata'
FLOWER_PORTRAIT = 'WhatsApp Image 2026-11-21 at 23.32.39.jpeg'
FLOWER_SHEET = 'WhatsApp Image 2026-11-21 at 23.32.40.jpeg'
NAMES.append((FLOWER_PACK, 'Hinata • Lírios ao Luar', 'Naruto', ['#ffd8ed','#d58ab7']))
SHEETS = {FLOWER_PACK: FLOWER_SHEET, 'madu-kaiden':'kayden definitivo.png','barou':'Barou_ Pacote Cosmetico do Rei dos Artilheiros.png','garou':'Pacote Cósmico do Garou.png'}
DETAILS = {
    FLOWER_PACK: [(91,466,449,753),(545,465,891,758),(48,850,934,1027),(57,1105,423,1208),(474,1104,925,1209)],
    'madu-kaiden': [(80,320,500,686),(616,320,1018,683),(25,704,1069,1100),(44,1178,472,1348),(518,1174,1051,1352)],
    'barou': [(93,319,479,663),(611,318,1003,665),(17,685,1079,1078),(41,1164,468,1328),(522,1142,1060,1340)],
    'garou': [(85,325,500,681),(609,321,1016,680),(25,700,1068,1092),(46,1180,464,1340),(514,1175,1054,1345)],
}
REFERENCES.mkdir(parents=True,exist_ok=True)
def save_display_mask(asset, target, low, high, clear_center=False, footer=0):
    """Soften only background connected to the exterior or empty opening. Keep enclosed dark details."""
    image = Image.open(asset).convert('RGBA')
    red, green, blue, alpha = image.split()
    target.parent.mkdir(parents=True, exist_ok=True)
    if alpha.getextrema()[0] < 255:
        # A neutral CSS mask leaves the source alpha (including soft edges) intact.
        Image.new('L', (1, 1), 255).save(target)
        return
    light = ImageChops.lighter(red, ImageChops.lighter(green, blue))
    barriers = light.point(lambda value: 255 if value >= high else 0)
    reachable = ImageOps.expand(barriers, border=1, fill=0)
    ImageDraw.floodfill(reachable, (0, 0), 128)
    center = (image.width // 2 + 1, image.height // 2 + 1)
    if clear_center and reachable.getpixel(center) == 0:
        ImageDraw.floodfill(reachable, center, 128)
    reachable = reachable.crop((1, 1, image.width+1, image.height+1)).point(lambda v: 255 if v == 128 else 0)
    ramp = light.point(lambda v: max(0, min(255, round((v-low)*255/(high-low)))))
    opacity = Image.composite(ramp, Image.new('L', image.size, 255), reachable)
    if footer:
        ImageDraw.Draw(opacity).rectangle((0, image.height-footer, image.width, image.height), fill=0)
    mask = Image.new('LA', image.size, (255, 0))
    mask.putalpha(opacity)
    mask.save(target, optimize=True)

references = {}
for index,source in enumerate([*sorted(SOURCE.glob('*.png')), SOURCE/FLOWER_PORTRAIT, SOURCE/FLOWER_SHEET]):
    asset = f'assets/cosmetic-references/definitive-{index+1:02d}{source.suffix}'
    copy2(source,ROOT/'web/public'/asset)
    references[source.name] = {'asset':asset,'name':source.stem,'source':source.name,'sourceDirectory':SOURCE.name,
        'sha256':sha256(source.read_bytes()).hexdigest(),'size':list(Image.open(source).size),'byteIdentical':True}
assert len(references)==6
for path in REFERENCES.iterdir():
    if path.is_file() and path.name not in {Path(r['asset']).name for r in references.values()} | {'metadata.json'}:
        path.unlink()
(REFERENCES/'metadata.json').write_text(json.dumps(references,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
collections=[]
for index,(slug,name,franchise,colors) in enumerate(NAMES):
    folder=DEST/slug
    folder.mkdir(parents=True,exist_ok=True)
    detailed=slug in SHEETS
    if detailed:
        source=SHEETS[slug]
        avatar,frame,banner,swatch,badge=DETAILS[slug]
        cover=(0,0,1092,272)
        effect=badge
    elif index<6:
        source=GRID
        x,right=[(6,255),(264,512),(519,766),(773,1020),(1027,1275),(1283,1531)][index]
        cover,avatar,frame,banner,swatch,badge=(x+2,8,right-2,177),(x+13,179,x+126,264),(x+10,289,right-10,342),(x+15,364,right-15,428),(x+116,451,right-16,490),(x+155,183,right-17,259)
        effect=frame
    else:
        source=GRID
        x,right=[(10,306),(315,609),(617,912),(919,1217),(1226,1524)][index-6]
        cover,avatar,frame,banner,swatch,badge=(x+2,520,right-2,671),(x+31,672,x+145,759),(x+20,779,right-20,832),(x+15,855,right-15,924),(x+128,951,right-32,995),(x+184,678,right-30,757)
        effect=frame
    original=Image.open(SOURCE/source).convert('RGBA')
    crops={'cover.webp':cover,'avatar-decoration.png':avatar,'profile-frame.png':frame,'profile-banner.webp':banner,
        'username-effect.png':swatch,'member-name-effect.webp':effect,'server-badge.png':badge,'nameplate.webp':effect}
    records={}
    for filename,bounds in crops.items():
        source_file=source
        if slug==FLOWER_PACK and filename=='cover.webp':
            source_file=FLOWER_PORTRAIT
            image=Image.open(SOURCE/source_file).convert('RGBA')
            bounds=(0,0,*image.size)
        else:
            image=original.crop(bounds)
        image.save(folder/filename,lossless=True,exact=True,method=6) if filename.endswith('.webp') else image.save(folder/filename,optimize=True)
        records[filename]={'source':source_file,'sourceDirectory':SOURCE.name,'sha256':sha256((SOURCE/source_file).read_bytes()).hexdigest(),
            'crop':list(bounds),'size':list(image.size),'alpha':list(image.getchannel('A').getextrema()),'mask':'original alpha','processing':[]}
    for path in folder.iterdir():
        if path.is_file() and path.name not in set(crops)|{'metadata.json'}: path.unlink()
    ref=references[source]
    collection={'id':slug,'name':name,'franchise':franchise,'colors':colors,'avatarScale':1.5 if detailed else 1.85,
        'resolution':'definitive-sheet' if detailed else 'definitive-grid','exactArtwork':True,'nameArtwork':detailed,
        'tagline':'Arte original do arquivo definitivo.','frameAspect':(frame[2]-frame[0])/(frame[3]-frame[1]) if detailed else None,
        'bannerAspect':(banner[2]-banner[0])/(banner[3]-banner[1]),'nameplateAsset':f'assets/cosmetics/{slug}/nameplate.webp',
        'references':[{'asset':ref['asset'],'name':ref['name']}],'banners':[]}
    if slug==FLOWER_PACK:
        portrait=references[FLOWER_PORTRAIT]
        collection['references'].append({'asset':portrait['asset'],'name':'Retrato ao luar'})
        collection['references'][0]['name']='Peças florais'
        collection['banners'].append({'id':'retrato','name':'Retrato ao luar','asset':portrait['asset']})
    (folder/'metadata.json').write_text(json.dumps({**collection,'files':records},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    masks = ROOT/'web/public/assets/cosmetic-masks'
    floral = slug == FLOWER_PACK
    low, high = (103, 139) if floral else (30, 59)
    save_display_mask(folder/'avatar-decoration.png', masks/f'{slug}-avatar.png', low, high,
                      clear_center=not detailed or floral, footer=3 if not detailed and index>=6 else 0)
    if floral:
        save_display_mask(folder/'profile-frame.png', masks/f'{slug}-frame.png', low, high, clear_center=True)
        save_display_mask(folder/'member-name-effect.webp', masks/f'{slug}-effect.png', low, high, clear_center=True)
    collections.append(collection)
types='''/** Generated exclusively from enfeites definitivos. */
export interface CollectionArtwork { id: string; name: string; asset: string; }
export interface CosmeticCollection {
  id: string; name: string; franchise: string; colors: [string,string]; avatarScale: number; resolution: string;
  exactArtwork: boolean; nameArtwork: boolean; tagline: string; frameAspect: number | null; bannerAspect: number; nameplateAsset: string;
  references: {asset:string;name:string}[]; banners: CollectionArtwork[];
}
export const COLLECTIONS: CosmeticCollection[] = '''
(ROOT/'shared/cosmetic-collections.ts').write_text(types+json.dumps(collections,ensure_ascii=False,indent=2)+';\nexport const collectionById = (id: string) => COLLECTIONS.find((collection) => collection.id === id);\n',encoding='utf-8')
write_centers(ROOT)
print(f'Extracted {len(collections)} definitive collections. No artwork pixels changed.')
