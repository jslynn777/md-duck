"""Refresh the self-hosted Noto Serif SC subset after editing public site copy.
Run manually with Python 3; normal builds have no network/font-service dependency.
The font and SIL OFL license are committed with the website assets.
"""
from pathlib import Path
import hashlib
import re
import urllib.parse
import urllib.request

root = Path(__file__).resolve().parents[1]
public = root / 'public/fonts'
public.mkdir(parents=True, exist_ok=True)
text = ''.join(path.read_text() for path in (root / 'src').rglob('*')
               if path.suffix in ('.astro', '.md', '.ts'))
characters = ''.join(sorted(set(c for c in text if '\u4e00' <= c <= '\u9fff')))
characters += ''.join(chr(i) for i in range(32, 127)) + '，。！？、：；“”‘’（）—·'
url = 'https://fonts.googleapis.com/css2?' + urllib.parse.urlencode({
    'family': 'Noto Serif SC:wght@400..700', 'display': 'swap', 'text': characters,
})
request = urllib.request.Request(url, headers={
    'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36',
})
css = urllib.request.urlopen(request, timeout=30).read().decode()
font_urls = re.findall(r'url\((https://fonts\.gstatic\.com/[^)]+)\)', css)
if len(set(font_urls)) != 1:
    raise RuntimeError('Expected one variable subset font from Google Fonts')
font = urllib.request.urlopen(font_urls[0], timeout=30).read()
if font[:4] != b'wOF2':
    raise RuntimeError('Expected WOFF2 font')
name = 'editorial-serif-' + hashlib.sha256(font).hexdigest()[:12] + '.woff2'
(public / name).write_bytes(font)
css = css.replace("'Noto Serif SC'", "'MD Editorial'").replace(font_urls[0], '/fonts/' + name)
(root / 'src/styles/fonts.css').write_text('/* Noto Serif SC, SIL OFL 1.1. Self-hosted; see /fonts/OFL.txt. */\n' + css)
license_url = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/OFL.txt'
license_text = urllib.request.urlopen(license_url, timeout=30).read().decode()
if 'SIL OPEN FONT LICENSE' not in license_text:
    raise RuntimeError('Unexpected license response')
(public / 'OFL.txt').write_text(license_text)
(public / 'README.txt').write_text('Noto Serif SC by the Noto Project Authors.\nSource: https://fonts.google.com/noto/specimen/Noto+Serif+SC\nLicense: SIL Open Font License 1.1 (OFL.txt).\nPublic-copy subset, variable weights 400–700, served by this website.\nRefresh: python3 website/scripts/prepare-editorial-font.py\n')
print({'font': name, 'bytes': len(font), 'characters': len(characters)})
