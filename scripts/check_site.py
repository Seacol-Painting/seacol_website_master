"""Offline, dependency-free checks for the static site before deployment.

Checks local links (including fragments), SEO URLs, social cards, intrinsic image
dimensions and responsive image files. External websites are deliberately not
requested: their availability must not make a correct deployment intermittent.
"""

import argparse
from functools import lru_cache
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import struct
import sys
from urllib.parse import unquote, urljoin, urlsplit
import xml.etree.ElementTree as ET


ORIGIN = "https://seacolpaintingllc.com"
SITE_HOSTS = {"seacolpaintingllc.com", "www.seacolpaintingllc.com"}
SOCIAL_FIELDS = (
    "og:title", "og:description", "og:type", "og:url", "og:image",
    "og:image:width", "og:image:height", "og:image:alt", "twitter:card",
    "twitter:title", "twitter:description", "twitter:image", "twitter:image:alt",
)


def canonical_for(filename):
    return ORIGIN + ("/" if filename == "index.html" else "/" + filename.removesuffix(".html"))


def srcset_candidates(value):
    candidates = []
    for raw in value.split(","):
        parts = raw.strip().split()
        if len(parts) != 2 or not re.fullmatch(r"(?:[1-9]\d*w|(?:\d+(?:\.\d+)?)x)", parts[1]):
            raise ValueError(f"invalid srcset candidate: {raw!r}")
        if float(parts[1][:-1]) <= 0:
            raise ValueError(f"nonpositive srcset descriptor: {parts[1]}")
        candidates.append((parts[0], parts[1]))
    if not candidates or len({descriptor for _, descriptor in candidates}) != len(candidates):
        raise ValueError("empty or duplicate srcset descriptors")
    if len({descriptor[-1] for _, descriptor in candidates}) != 1:
        raise ValueError("srcset mixes width and density descriptors")
    return candidates


@lru_cache(maxsize=None)
def image_dimensions(path):
    """Read PNG, WebP, JPEG or SVG dimensions without decoding image pixels."""
    data = Path(path).read_bytes()
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        offset = 12
        while offset + 8 <= len(data):
            kind = data[offset:offset + 4]
            size = int.from_bytes(data[offset + 4:offset + 8], "little")
            chunk = data[offset + 8:offset + 8 + size]
            if kind == b"VP8X" and len(chunk) >= 10:
                return 1 + int.from_bytes(chunk[4:7], "little"), 1 + int.from_bytes(chunk[7:10], "little")
            if kind == b"VP8L" and len(chunk) >= 5 and chunk[0] == 0x2f:
                bits = int.from_bytes(chunk[1:5], "little")
                return (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1
            if kind == b"VP8 " and len(chunk) >= 10 and chunk[3:6] == b"\x9d\x01\x2a":
                return int.from_bytes(chunk[6:8], "little") & 0x3fff, int.from_bytes(chunk[8:10], "little") & 0x3fff
            offset += 8 + size + (size % 2)
    if data.startswith(b"\xff\xd8"):
        offset = 2
        while offset < len(data):
            if data[offset] != 0xff:
                offset += 1
                continue
            while offset < len(data) and data[offset] == 0xff:
                offset += 1
            if offset >= len(data):
                break
            marker = data[offset]
            offset += 1
            if marker in (0x00, 0x01, 0xd8, 0xd9) or 0xd0 <= marker <= 0xd7:
                continue
            if offset + 2 > len(data):
                break
            size = int.from_bytes(data[offset:offset + 2], "big")
            if size < 2:
                break
            if marker in {0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf}:
                height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
                return width, height
            offset += size
    if Path(path).suffix.lower() == ".svg":
        svg = ET.fromstring(data)
        width, height = svg.get("width", ""), svg.get("height", "")
        if re.fullmatch(r"\d+(?:\.\d+)?(?:px)?", width) and re.fullmatch(r"\d+(?:\.\d+)?(?:px)?", height):
            return round(float(width.removesuffix("px"))), round(float(height.removesuffix("px")))
        viewbox = svg.get("viewBox", "").replace(",", " ").split()
        if len(viewbox) == 4:
            return round(float(viewbox[2])), round(float(viewbox[3]))
    raise ValueError(f"unsupported or invalid image: {path}")


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path = path
        self.ids = set()
        self.duplicate_ids = set()
        self.references = []
        self.images = []
        self.sources = []
        self.metadata = {}
        self.canonicals = []
        self.title = ""
        self.in_title = False
        self.h1_count = 0
        self.lang = ""
        self.feed(path.read_text(encoding="utf-8"))

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            if attrs["id"] in self.ids:
                self.duplicate_ids.add(attrs["id"])
            self.ids.add(attrs["id"])
        if tag == "html":
            self.lang = attrs.get("lang", "")
        if tag == "title":
            self.in_title = True
        if tag == "h1":
            self.h1_count += 1
        if tag == "meta":
            self.metadata[attrs.get("name", attrs.get("property", ""))] = attrs.get("content", "")
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonicals.append(attrs.get("href", ""))
        for attribute in ("href", "src", "poster"):
            if attrs.get(attribute):
                self.references.append((tag, attribute, attrs[attribute]))
        if tag == "img":
            self.images.append(attrs)
        if tag == "source" and attrs.get("srcset"):
            self.sources.append(attrs)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data


class SiteChecker:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.errors = []
        self.pages = {path.name: Page(path) for path in sorted(self.root.glob("*.html"))}
        self.variants = {}
        self.originals = {}
        self.checked_references = 0

    def require(self, condition, message):
        if not condition and message not in self.errors:
            self.errors.append(message)
        return bool(condition)

    def local_target(self, raw, filename, *, fragments=True):
        parsed = urlsplit(urljoin(canonical_for(filename), raw))
        if parsed.scheme in {"mailto", "tel", "sms", "data"}:
            return None
        if parsed.scheme not in {"https", "http"}:
            self.require(False, f"{filename}: unsupported URL {raw!r}")
            return None
        if parsed.netloc not in SITE_HOSTS:
            return None
        relative = unquote(parsed.path).lstrip("/") or "index.html"
        target = (self.root / relative).resolve()
        if not self.require(target.is_relative_to(self.root), f"{filename}: URL escapes the site root: {raw}"):
            return None
        if not target.is_file() and not target.suffix:
            alternatives = [target.with_suffix(".html"), target / "index.html"]
            if relative.startswith("api/"):
                alternatives += [target.with_suffix(suffix) for suffix in (".js", ".mjs", ".ts")]
            target = next((candidate for candidate in alternatives if candidate.is_file()), target)
        if not self.require(target.is_file(), f"{filename}: missing local target {raw}"):
            return None
        self.checked_references += 1
        if fragments and parsed.fragment and target.name in self.pages:
            self.require(unquote(parsed.fragment) in self.pages[target.name].ids,
                         f"{filename}: missing anchor in {raw}")
        return target

    def dimensions(self, path, label):
        try:
            return image_dimensions(path)
        except (OSError, ValueError, struct.error, ET.ParseError) as exc:
            self.require(False, f"{label}: cannot read image dimensions ({exc})")
            return None

    def check_manifest(self):
        path = self.root / "assets/responsive-manifest.json"
        if not self.require(path.is_file(), "Missing assets/responsive-manifest.json"):
            return
        try:
            manifest = json.loads(path.read_text())
            self.require(manifest.get("version") == 1, "Unsupported responsive manifest version")
            self.require(manifest.get("origin") == ORIGIN, "Responsive manifest origin differs from canonical origin")
            for item in manifest["images"]:
                source = self.root / item["source"]
                self.originals[item["source"]] = item
                if not self.require(source.is_file(), f"Manifest source missing: {item['source']}"):
                    continue
                original = source.read_bytes()
                self.require(len(original) == item["sourceBytes"], f"Manifest source size changed: {item['source']}")
                self.require(hashlib.sha256(original).hexdigest() == item["sourceSha256"], f"Manifest source hash changed: {item['source']}")
                self.require(self.dimensions(source, item["source"]) == (item["sourceWidth"], item["sourceHeight"]), f"Manifest source dimensions differ: {item['source']}")
                widths = []
                for variant in item["variants"]:
                    name = variant["src"]
                    target = self.local_target(name, "index.html", fragments=False)
                    if target is None:
                        continue
                    self.variants[name] = item["source"]
                    actual = target.read_bytes()
                    self.require(len(actual) == variant["bytes"], f"Manifest variant size differs: {name}")
                    self.require(hashlib.sha256(actual).hexdigest() == variant["sha256"], f"Manifest variant hash differs: {name}")
                    dimensions = self.dimensions(target, name)
                    self.require(dimensions == (variant["width"], variant["height"]), f"Manifest variant dimensions differ: {name}")
                    self.require(0 < variant["width"] <= item["sourceWidth"], f"Manifest variant is upscaled: {name}")
                    expected_height = item["sourceHeight"] * variant["width"] / item["sourceWidth"]
                    self.require(abs(variant["height"] - expected_height) <= 1, f"Manifest variant changes the original aspect ratio: {name}")
                    widths.append(variant["width"])
                self.require(bool(widths) and min(widths) <= 480, f"Manifest lacks a mobile variant: {item['source']}")
                self.require(len(widths) == len(set(widths)), f"Manifest has duplicate widths: {item['source']}")
            for card in manifest.get("socialCards", []):
                target = self.local_target(card["src"], card["page"], fragments=False)
                if target:
                    self.require(target.stat().st_size == card["bytes"], f"Social card size differs: {card['src']}")
                    self.require(self.dimensions(target, card["src"]) == (1200, 630), f"Social card must be 1200x630: {card['src']}")
        except (KeyError, TypeError, ValueError, OSError) as exc:
            self.require(False, f"Invalid responsive manifest: {exc}")

    def check_srcset(self, attrs, filename):
        if not attrs.get("srcset"):
            return
        try:
            candidates = srcset_candidates(attrs["srcset"])
        except ValueError as exc:
            self.require(False, f"{filename}: {exc}")
            return
        if candidates[0][1].endswith("w"):
            self.require(bool(attrs.get("sizes")), f"{filename}: width srcset needs sizes: {attrs.get('src', '')}")
        source = self.variants.get(attrs.get("src", ""))
        for url, descriptor in candidates:
            target = self.local_target(url, filename, fragments=False)
            if target is None:
                continue
            dimensions = self.dimensions(target, f"{filename}: {url}")
            if dimensions and descriptor.endswith("w"):
                self.require(dimensions[0] == int(descriptor[:-1]), f"{filename}: {url} width does not match {descriptor}")
            if source:
                self.require(self.variants.get(url) == source, f"{filename}: srcset mixes photographs: {url}")

    def check_page(self, filename, page):
        expected = canonical_for(filename)
        self.require(page.canonicals == [expected], f"{filename}: canonical must be exactly {expected}")
        self.require(bool(page.title.strip()), f"{filename}: missing page title")
        self.require(bool(page.metadata.get("description", "").strip()), f"{filename}: missing meta description")
        self.require(bool(page.lang), f"{filename}: missing html lang")
        self.require("width=device-width" in page.metadata.get("viewport", ""), f"{filename}: missing responsive viewport")
        self.require(page.h1_count == 1, f"{filename}: expected one h1, found {page.h1_count}")
        self.require(not page.duplicate_ids, f"{filename}: duplicate ids {sorted(page.duplicate_ids)}")
        for _, _, raw in page.references:
            self.local_target(raw, filename)
        for attrs in page.images:
            src = attrs.get("src", "")
            self.require("alt" in attrs, f"{filename}: image lacks alt: {src}")
            target = self.local_target(src, filename, fragments=False) if src else None
            if target:
                actual = self.dimensions(target, f"{filename}: {src}")
                try:
                    width, height = int(attrs.get("width", "0")), int(attrs.get("height", "0"))
                except ValueError:
                    width = height = 0
                if self.require(width > 0 and height > 0, f"{filename}: image needs positive width/height: {src}") and actual:
                    # Rounding to whole pixels in responsive variants can differ by one pixel.
                    self.require(abs(width / height - actual[0] / actual[1]) <= max(0.01, 2 / actual[1]), f"{filename}: image aspect ratio differs from file: {src}")
                if actual and actual[0] > 480 and target.suffix.lower() != ".svg":
                    self.require(bool(attrs.get("srcset")), f"{filename}: large image lacks responsive srcset: {src}")
                self.require(src not in self.originals, f"{filename}: original photograph still served instead of responsive variants: {src}")
            self.check_srcset(attrs, filename)
        for attrs in page.sources:
            self.check_srcset(attrs, filename)
        if filename.startswith("gallery"):
            for field in SOCIAL_FIELDS:
                self.require(bool(page.metadata.get(field)), f"{filename}: missing social metadata {field}")
            self.require(page.metadata.get("og:url") == expected, f"{filename}: og:url differs from canonical")
            self.require(page.metadata.get("twitter:card") == "summary_large_image", f"{filename}: Twitter card must use summary_large_image")
            self.require(page.metadata.get("twitter:image") == page.metadata.get("og:image"), f"{filename}: social image URLs differ")
            social = page.metadata.get("og:image", "")
            self.require(social.startswith(ORIGIN + "/"), f"{filename}: social image must use an absolute production URL")
            target = self.local_target(social, filename, fragments=False) if social else None
            if target:
                actual = self.dimensions(target, social)
                self.require(actual == (1200, 630), f"{filename}: social image must be 1200x630")
                self.require((page.metadata.get("og:image:width"), page.metadata.get("og:image:height")) == ("1200", "630"), f"{filename}: social image dimensions metadata differs")

    def check_sitemap(self):
        try:
            document = ET.parse(self.root / "sitemap.xml")
            locations = [node.text for node in document.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
            expected = {canonical_for(name) for name, page in self.pages.items() if "noindex" not in page.metadata.get("robots", "").lower()}
            self.require(len(locations) == len(set(locations)), "Sitemap contains duplicate URLs")
            self.require(set(locations) == expected, f"Sitemap differs from indexable pages; missing={sorted(expected - set(locations))}, extra={sorted(set(locations) - expected)}")
            for url in locations:
                self.local_target(url, "index.html", fragments=False)
        except (OSError, ET.ParseError) as exc:
            self.require(False, f"Cannot read sitemap.xml: {exc}")
        try:
            robots = (self.root / "robots.txt").read_text()
            self.require(re.search(r"(?im)^Sitemap:\s*" + re.escape(ORIGIN + "/sitemap.xml") + r"\s*$", robots), "robots.txt does not declare the canonical sitemap")
            self.require(not re.search(r"(?im)^Disallow:\s*/\s*$", robots), "robots.txt blocks the entire public site")
        except OSError as exc:
            self.require(False, f"Cannot read robots.txt: {exc}")

    def run(self):
        self.require("index.html" in self.pages, "Missing index.html")
        self.check_manifest()
        for filename, page in self.pages.items():
            self.check_page(filename, page)
        self.check_sitemap()
        for css in self.root.glob("*.css"):
            for raw in re.findall(r"url\(\s*['\"]?([^)'\"]+)['\"]?\s*\)", css.read_text()):
                self.local_target(raw.strip(), css.name, fragments=False)
        for script in self.root.glob("*.js"):
            for endpoint in set(re.findall(r"['\"](/api/[a-zA-Z0-9_/-]+)['\"]", script.read_text())):
                self.local_target(endpoint, script.name, fragments=False)
        return self.errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    checker = SiteChecker(args.root)
    errors = checker.run()
    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        print(f"Site validation failed with {len(errors)} issue(s).", file=sys.stderr)
        return 1
    print(f"PASS: {len(checker.pages)} pages, {checker.checked_references} local references, sitemap, canonical URLs, social cards and responsive images.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
