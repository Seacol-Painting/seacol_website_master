"""Check the deployed policy against actual page resources before publishing."""
import base64
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
config = json.loads((ROOT / 'vercel.json').read_text())
headers = {h['key'].lower(): h['value'] for h in config['headers'][0]['headers']}
policy = dict((s.strip().split(' ', 1) + [''])[:2]
              for s in headers['content-security-policy'].split(';'))
assert "'unsafe-inline'" not in policy['script-src']
assert "'unsafe-eval'" not in policy['script-src']
assert policy['frame-ancestors'] == "'none'"
assert policy['object-src'] == "'none'"
assert policy['base-uri'] == "'none'"
assert policy['form-action'] == "'none'"
assert headers['x-content-type-options'] == 'nosniff'
assert headers['x-frame-options'] == 'DENY'


class Resources(HTMLParser):
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        assert not any(k.startswith('on') for k in attrs), 'Inline event handler'
        resource = attrs.get('src')
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            resource = attrs.get('href')
        if resource:
            assert not urlsplit(resource).scheme and not resource.startswith('//'), resource
            assert (ROOT / resource.split('?')[0]).is_file(), resource


pages = list(ROOT.glob('*.html'))
for page in pages:
    html = page.read_text()
    Resources().feed(html)
    for body in re.findall(r'<script\b[^>]*>([\s\S]*?)</script>', html):
        if body.strip():
            digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
            assert f"'sha256-{digest}'" in policy['script-src'], page.name

for css in ROOT.glob('*.css'):
    assert not re.search(r'@import|url\(\s*[\"\']?(?:https?:|//)', css.read_text()), css.name

photo_headers = {h['key']: h['value'] for h in config['headers'][1]['headers']}
assert config['headers'][1]['source'] == '/assets/projects/(.*)'
assert photo_headers['Cross-Origin-Resource-Policy'] == 'same-origin'
assert photo_headers['Access-Control-Allow-Origin'] == 'https://seacolpaintingllc.com'
print(f'PASS: CSP permits all resources and inline data hashes across {len(pages)} pages; framing, script and photo policies are restricted.')
