"""Verify every active crop and reference against the definitive source pixels."""
from pathlib import Path
from hashlib import sha256
from PIL import Image,ImageChops
import json
root=Path(__file__).resolve().parent.parent
source=root/'enfeites definitivos'
folders=sorted((root/'web/public/assets/cosmetics').iterdir())
assert len(folders)==14
report={'collections':len(folders),'images':0,'exact_rgba_crops':0,'references':0,'original_files':{},'bytes':0,'sourceDirectory':source.name,'artworkPixelsMasked':False,'displayMasks':0,'resizing':False,'recoloring':False}
for folder in folders:
    meta=json.loads((folder/'metadata.json').read_text(encoding='utf-8'))
    assert len(meta['files'])==8 and meta['exactArtwork']
    masks=root/'web/public/assets/cosmetic-masks'
    for mask_file in masks.glob(f'{folder.name}-*.png'):
        slot=mask_file.stem.removeprefix(folder.name+'-')
        asset={'avatar':'avatar-decoration.png','effect':'member-name-effect.webp','frame':'profile-frame.png'}[slot]
        original=Image.open(folder/asset).convert('RGBA')
        with Image.open(mask_file) as mask:
            if original.getchannel('A').getextrema()[0]==255:
                assert mask.size==original.size and mask.getchannel('A').getextrema()==(0,255), mask_file
            else:
                assert mask.convert('RGBA').getchannel('A').getextrema()==(255,255), mask_file
        report['displayMasks']+=1
    assert (masks/f'{folder.name}-avatar.png').is_file()
    for filename,record in meta['files'].items():
        assert record['sourceDirectory']==source.name
        original=source/record['source']
        digest=sha256(original.read_bytes()).hexdigest()
        assert digest==record['sha256']
        report['original_files'][original.name]=digest
        expected=Image.open(original).convert('RGBA').crop(record['crop'])
        actual=Image.open(folder/filename).convert('RGBA')
        assert expected.size==actual.size==tuple(record['size'])
        assert not record['processing'] and record['mask']=='original alpha'
        assert all(channel.getbbox() is None for channel in ImageChops.difference(expected,actual).split()),str(folder/filename)
        if folder.name=='madu-kaiden': assert original.name=='kayden definitivo.png'
        report['images']+=1
        report['exact_rgba_crops']+=1
        report['bytes']+=(folder/filename).stat().st_size
manifest=json.loads((root/'web/public/assets/cosmetic-references/metadata.json').read_text(encoding='utf-8'))
assert set(manifest)=={file.name for file in source.iterdir() if file.suffix.lower() in ('.png','.jpeg')}
for name,record in manifest.items():
    original=source/name
    actual=root/'web/public'/record['asset']
    assert sha256(original.read_bytes()).hexdigest()==sha256(actual.read_bytes()).hexdigest()==record['sha256']
    report['original_files'][name]=record['sha256']
    report['references']+=1
    report['bytes']+=actual.stat().st_size
out=root/'e2e/.artifacts/cosmetic-collections'
out.mkdir(parents=True,exist_ok=True)
(out/'definitive-asset-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f"Verified {report['exact_rgba_crops']} exact RGBA crops and {report['references']} byte-identical originals. Kayden uses only the definitive image.")
