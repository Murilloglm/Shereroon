"""Verify every active crop and reference against the definitive source pixels."""
from pathlib import Path
from hashlib import sha256
from PIL import Image,ImageChops
import json
root=Path(__file__).resolve().parent.parent
source=root/'enfeites definitivos'
folders=sorted((root/'web/public/assets/cosmetics').iterdir())
assert len(folders)==13
report={'collections':13,'images':0,'exact_rgba_crops':0,'references':0,'original_files':{},'bytes':0,'sourceDirectory':source.name,'masks':False,'resizing':False,'recoloring':False}
for folder in folders:
    meta=json.loads((folder/'metadata.json').read_text(encoding='utf-8'))
    assert len(meta['files'])==8 and meta['exactArtwork']
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
assert len(manifest)==len(list(source.glob('*.png')))==4
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
print(f"Verified {report['exact_rgba_crops']} exact RGBA crops and 4 byte-identical originals. Kayden uses only the definitive image.")
