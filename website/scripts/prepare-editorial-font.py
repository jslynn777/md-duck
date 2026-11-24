"""Refresh the self-hosted Noto Serif SC subsets after editing public copy.

Run manually with Python 3.
Normal builds have no network or font-service dependency. Google Fonts supplies
separate CJK and Latin/punctuation subsets to keep its text requests bounded.
Only validated, complete subsets replace fonts.css; prior font URLs are retained.
"""
from pathlib import Path
import hashlib
import json
import re
import struct
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public/fonts'
USER_AGENT = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
              'AppleWebKit/537.36 (KHTML, like Gecko) '
              'Chrome/132.0.0.0 Safari/537.36')


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=45) as response:
        if response.status != 200:
            raise RuntimeError(f'Unexpected HTTP status: {response.status}')
        return response.read()


def css_codepoints(css):
    ranges = re.search(r'unicode-range\s*:\s*([^;]+);', css)
    if not ranges:
        raise RuntimeError('Expected an explicit Unicode range for the subset')
    result = set()
    for part in ranges.group(1).split(','):
        match = re.fullmatch(r'\s*U\+([0-9a-f]+)(?:-([0-9a-f]+))?\s*', part, re.I)
        if not match:
            raise RuntimeError(f'Unsupported Unicode range: {part}')
        first, last = int(match[1], 16), int(match[2] or match[1], 16)
        if last < first or last > 0x10ffff:
            raise RuntimeError('Invalid Unicode range')
        result.update(range(first, last + 1))
    return result


def validate_woff2(data):
    if len(data) < 48 or data[:4] != b'wOF2':
        raise RuntimeError('Expected WOFF2 font')
    if struct.unpack_from('>I', data, 8)[0] != len(data):
        raise RuntimeError('Incomplete WOFF2 font')


def subset(label, characters):
    url = 'https://fonts.googleapis.com/css2?' + urllib.parse.urlencode({
        'family': 'Noto Serif SC:wght@400..700', 'display': 'swap', 'text': characters,
    })
    css = fetch(url).decode('utf-8')
    urls = set(re.findall(r'url\((https://fonts\.gstatic\.com/[^)]+)\)', css))
    if len(urls) != 1 or css.count('@font-face') != 1:
        raise RuntimeError(f'{label}: expected one bounded subset, got {len(urls)} font URLs')
    if not re.search(r'font-weight:\s*400\s+700\s*;', css):
        raise RuntimeError(f'{label}: variable weight range changed')
    requested = {ord(char) for char in characters}
    if requested - css_codepoints(css):
        raise RuntimeError(f'{label}: CSS does not cover every requested character')
    font_url = urls.pop()
    font = fetch(font_url)
    validate_woff2(font)
    name = 'editorial-serif-' + hashlib.sha256(font).hexdigest()[:12] + '.woff2'
    local_css = css.replace("'Noto Serif SC'", "'MD Editorial'").replace(font_url, '/fonts/' + name)
    return {'label': label, 'name': name, 'font': font, 'css': local_css,
            'characters': len(requested), 'codepoints': requested}


def main():
    text = ''.join(path.read_text(encoding='utf-8') for path in (ROOT / 'src').rglob('*')
                   if path.suffix in ('.astro', '.md', '.ts'))
    chinese = ''.join(sorted(set(c for c in text if '\u4e00' <= c <= '\u9fff')))
    latin = ''.join(chr(i) for i in range(32, 127)) + '，。！？、：；“”‘’（）—·'
    if not chinese:
        raise RuntimeError('No Chinese website copy found')
    # Long mixed-script text requests can return Google's full 101-face font.
    # Separate scripts keep the requests short and the declarations disjoint.
    fonts = [subset('Chinese', chinese), subset('Latin and punctuation', latin)]
    if fonts[0]['codepoints'] & fonts[1]['codepoints']:
        raise RuntimeError('Subset ranges overlap')
    license_text = fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/OFL.txt').decode('utf-8')
    if 'SIL OPEN FONT LICENSE' not in license_text:
        raise RuntimeError('Unexpected license response')
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for item in fonts:
        (PUBLIC / item['name']).write_bytes(item['font'])
    css = '/* Noto Serif SC, SIL OFL 1.1. Self-hosted; see /fonts/OFL.txt. */\n'
    css += '\n'.join(item['css'] for item in fonts)
    (ROOT / 'src/styles/fonts.css').write_text(css, encoding='utf-8')
    (PUBLIC / 'OFL.txt').write_text(license_text, encoding='utf-8')
    (PUBLIC / 'README.txt').write_text(
        'Noto Serif SC by the Noto Project Authors.\n'
        'Source: https://fonts.google.com/noto/specimen/Noto+Serif+SC\n'
        'License: SIL Open Font License 1.1 (OFL.txt).\n'
        'Official Google Fonts public-copy subsets, variable weights 400–700.\n'
        'Chinese and Latin/punctuation subsets use separate unicode ranges.\n'
        'All fonts are self-hosted; page loads make no font-service requests.\n'
        'Old hashed font files are retained for existing published URLs.\n'
        'Refresh: python3 website/scripts/prepare-editorial-font.py\n'
        'Refresh validates WOFF2 headers/length, variable CSS weights and\n'
        'the official CSS Unicode coverage for every requested character.\n', encoding='utf-8')
    print(json.dumps({'fonts': [{'label': f['label'], 'font': f['name'], 'bytes': len(f['font']),
                               'characters': f['characters']} for f in fonts],
                      'all_requested_css_ranges_verified': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
