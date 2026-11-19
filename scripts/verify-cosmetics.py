"""Checks provenance, real alpha, dimensions and lossless member artwork."""
from pathlib import Path
from hashlib import sha256
from PIL import Image, ImageChops
import json

root = Path(__file__).resolve().parent.parent
folders = sorted((root/'web/public/assets/cosmetics').iterdir())
assert len(folders) == 11
report = {'collections': 11, 'images': 0, 'member_effects_pixel_identical': 0, 'original_files': {}, 'bytes': 0}
for folder in folders:
    meta = json.loads((folder/'metadata.json').read_text(encoding='utf-8'))
    assert len(meta['files']) == 7
    for filename, record in meta['files'].items():
        source = root/'enfeites'/record['source']
        digest = sha256(source.read_bytes()).hexdigest()
        assert digest == record['sha256'], f'Original changed: {source.name}'
        report['original_files'][source.name] = digest
        file = folder/filename
        actual = Image.open(file).convert('RGBA')
        assert list(actual.size) == record['size']
        if filename in ['avatar-decoration.png','profile-frame.png']:
            assert actual.getchannel('A').getextrema() == (0,255), f'Missing alpha: {file}'
        if filename == 'member-name-effect.webp':
            expected = Image.open(source).convert('RGB').crop(record['crop'])
            assert ImageChops.difference(expected, actual.convert('RGB')).getbbox() is None, f'Artwork changed: {file}'
            report['member_effects_pixel_identical'] += 1
        report['images'] += 1
        report['bytes'] += file.stat().st_size

out = root/'e2e/.artifacts/cosmetic-collections'
out.mkdir(parents=True, exist_ok=True)
(out/'asset-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f"Verified {report['images']} images from {len(report['original_files'])} intact originals; all 11 member effects pixel-identical; {report['bytes']:,} bytes.")
