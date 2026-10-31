#!/usr/bin/env python3
"""Apply generated photo derivatives without reformatting page content.

    python3 scripts/apply_responsive_photos.py --pages gallery*.html
    python3 scripts/apply_responsive_photos.py --pages index.html

The manifest includes all pages even when only selected pages are edited. Run
optimize_photos.cjs first when a source photograph changes. The sizes expressions
follow the existing grid/container breakpoints in the site's CSS.
"""
import argparse
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'assets/responsive-manifest.json'
MOBILE = '(max-width: 380px) calc(100vw - 32px), (max-width: 716px) calc(100vw - 36px), (max-width: 850px) 680px'
FULL = MOBILE + ', (max-width: 1220px) calc(100vw - 40px), 1180px'
SIZES = {
    # The panoramic photograph covers a tall mobile hero; its effective width
    # is much larger than the viewport. Keep the 1440 px source for that crop.
    'hero': '(max-width: 850px) 1440px, 100vw',
    'full-width': FULL,
    'gallery-comparison': MOBILE + ', (max-width: 980px) calc(100vw - 40px), (max-width: 1220px) calc(50vw - 34px), 576px',
    'gallery-comparison-wide': MOBILE + ', (max-width: 980px) calc(100vw - 40px), 900px',
    'gallery-hub': MOBILE + ', (max-width: 980px) calc(50vw - 20px), (max-width: 1220px) calc(23.75vw - 15.2px), 275px',
    'gallery-photo-grid': '(max-width: 380px) calc(100vw - 32px), (max-width: 700px) calc(100vw - 36px), (max-width: 716px) calc(50vw - 29px), (max-width: 850px) 329px, (max-width: 1220px) calc(50vw - 35px), 575px',
    'gallery-process': MOBILE + ', (max-width: 1093px) calc(33.3333vw - 25.3333px), (max-width: 1220px) calc(25vw - 23.5px), 281.5px',
    'home-about': MOBILE + ', (max-width: 1344px) calc(54.5455vw - 61.0909px), 672px',
    'home-service': '(max-width: 380px) calc(100vw - 32px), (max-width: 716px) calc(50vw - 24px), (max-width: 850px) 334px, (max-width: 1220px) calc(33.3333vw - 24px), 383px',
    'home-transformation': MOBILE + ', (max-width: 980px) calc(50vw - 32px), (max-width: 1220px) calc(33.3333vw - 29.3333px), 378px',
    'home-gallery-half': MOBILE + ', (max-width: 1220px) calc(50vw - 31px), 579px',
    'home-process': MOBILE + ', (max-width: 1220px) calc(47.619vw - 45.714px), 536px',
    'home-commercial': '(max-width: 380px) calc(100vw - 72px), (max-width: 716px) calc(100vw - 76px), (max-width: 850px) 640px, (max-width: 1220px) calc(60vw - 111.6px), 621px',
}
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}


class Images(HTMLParser):
    def __init__(self, text, page, entries, reverse):
        super().__init__(convert_charrefs=False)
        self.stack = []
        self.records = []
        self.page = page
        self.entries = entries
        self.reverse = reverse
        self.offsets = [0]
        for line in text.splitlines(keepends=True):
            self.offsets.append(self.offsets[-1] + len(line))
        self.ba_count = len(re.findall(r'<article\b[^>]*class="ba-project"', text))
        self.ba_seen = 0
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set(attrs.get('class', '').split())
        if tag == 'img':
            source = self.reverse.get(attrs.get('src'), attrs.get('src'))
            if source not in self.entries:
                return
            parent_classes = set().union(*(item['classes'] for item in self.stack))
            role = self.role(classes, parent_classes)
            entry = self.entries[source]
            fallback = entry['variants'][-1]
            item = {
                'source': source, 'role': role, 'sizes': SIZES[role],
                'src': fallback['src'], 'width': fallback['width'], 'height': fallback['height'],
                'srcset': ', '.join(f"{v['src']} {v['width']}w" for v in entry['variants']),
                'loading': 'eager' if role == 'hero' else 'lazy', 'decoding': 'async',
            }
            if role == 'hero':
                item['fetchpriority'] = 'high'
            line, column = self.getpos()
            self.records.append((self.offsets[line - 1] + column, self.get_starttag_text(), item))
        elif tag not in VOID:
            if 'ba-project' in classes:
                self.ba_seen += 1
            self.stack.append({'tag': tag, 'classes': classes, 'ba_ordinal': self.ba_seen})

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i]['tag'] == tag:
                self.stack = self.stack[:i]
                break

    def role(self, classes, parents):
        if 'hero-image' in classes:
            return 'hero'
        if self.page.startswith('gallery'):
            if 'gallery-hub-card' in parents:
                return 'gallery-hub'
            if 'project-photo-grid' in parents:
                return 'gallery-photo-grid'
            if 'process-masonry' in parents:
                return 'gallery-process'
            if 'comparison' in parents:
                article = next((item for item in reversed(self.stack) if 'ba-project' in item['classes']), None)
                if article and self.ba_count % 2 and article['ba_ordinal'] == self.ba_count:
                    return 'gallery-comparison-wide'
                return 'gallery-comparison'
        if 'about-photo' in parents:
            return 'home-about'
        if 'service-background' in classes:
            return 'home-service'
        if 'transformation-grid' in parents:
            return 'home-transformation'
        if 'gallery' in parents:
            return 'full-width' if 'wide' in parents else 'home-gallery-half'
        if 'process-photo' in parents:
            return 'home-process'
        if 'mini-before-after' in parents:
            return 'home-commercial'
        return 'full-width'


def set_attributes(tag, attributes):
    for key, value in attributes.items():
        encoded = html.escape(str(value), quote=True)
        pattern = re.compile(r'\s' + re.escape(key) + r'\s*=\s*([\"\']).*?\1', re.S)
        if pattern.search(tag):
            tag = pattern.sub(lambda _: f' {key}="{encoded}"', tag, count=1)
        else:
            tag = re.sub(r'\s*/?>$', lambda end: f' {key}="{encoded}"' + end.group(), tag, count=1)
    return tag


def social_meta(card, origin):
    image_url = origin + '/' + card['src']
    values = [
        ('property', 'og:site_name', 'SEACOL PAINTING LLC'),
        ('property', 'og:title', card['title']),
        ('property', 'og:description', card['description']),
        ('property', 'og:url', card['url']),
        ('property', 'og:type', 'website'),
        ('property', 'og:image', image_url),
        ('property', 'og:image:type', 'image/jpeg'),
        ('property', 'og:image:width', '1200'),
        ('property', 'og:image:height', '630'),
        ('property', 'og:image:alt', card['alt']),
        ('name', 'twitter:card', 'summary_large_image'),
        ('name', 'twitter:title', card['title']),
        ('name', 'twitter:description', card['description']),
        ('name', 'twitter:image', image_url),
        ('name', 'twitter:image:alt', card['alt']),
    ]
    return '\n'.join(f'  <meta {kind}="{name}" content="{html.escape(value, quote=True)}" />' for kind, name, value in values)


def stats(records, entries):
    sources = {item['source'] for _, _, item in records}
    result = {'originalUniquePhotoBytes': sum(entries[src]['sourceBytes'] for src in sources)}
    for dpr in (1, 2):
        selected = {}
        for _, _, item in records:
            # Model a 390 px viewport with the existing CSS. This is a transfer
            # estimate for a full-page visit, not a measured load-time claim.
            css_width = {'hero': 1440, 'home-service': 171, 'home-commercial': 314}.get(item['role'], 354)
            variants = entries[item['source']]['variants']
            chosen = next((v for v in variants if v['width'] >= css_width * dpr), variants[-1])
            selected[chosen['src']] = chosen['bytes']
        result[f'mobile{dpr}xPhotoBytes'] = sum(selected.values())
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pages', nargs='*', help='Specific HTML filenames; defaults to the nine gallery pages.')
    parser.add_argument('--plan-only', action='store_true', help='Update the manifest without editing HTML.')
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    entries = {image['source']: image for image in manifest['images']}
    reverse = {v['src']: image['source'] for image in manifest['images'] for v in image['variants']}
    cards = {card['page']: card for card in manifest['socialCards']}
    selected = set(args.pages if args.pages is not None else cards)
    if any(Path(name).name != name or not name.endswith('.html') for name in selected):
        parser.error('--pages accepts HTML filenames in the website root only')
    manifest['pages'] = {}
    for page in sorted(ROOT.glob('*.html')):
        text = page.read_text()
        images = Images(text, page.name, entries, reverse)
        manifest['pages'][page.name] = {'images': [item for _, _, item in images.records], **stats(images.records, entries)}
        if page.name not in selected or args.plan_only:
            continue
        for offset, tag, item in reversed(images.records):
            attributes = {k: v for k, v in item.items() if k not in {'source', 'role'}}
            text = text[:offset] + set_attributes(tag, attributes) + text[offset + len(tag):]
        if page.name in cards:
            text = re.sub(r'^[ \t]*<meta\s+(?:property|name)="(?:og:|twitter:)[^>]*>\s*\n?', '', text, flags=re.M)
            description = re.search(r'<meta name="description"[^>]*>', text)
            if not description:
                raise ValueError(f'Missing description: {page.name}')
            end = description.end()
            text = text[:end] + '\n' + social_meta(cards[page.name], manifest['origin']) + text[end:]
        page.write_text(text)
        print(f'Updated {page.name}: {len(images.records)} photographs')
    manifest['estimate'] = {'viewportWidth': 390, 'devicePixelRatios': [1, 2],
                            'basis': 'Unique photograph URLs over a full-page visit; excludes logos, HTML, CSS, JS, and social cards; not measured loading time.'}
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
