"""Verify that concrete publishing regressions are rejected by the site gate."""

import base64
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from check_site import ORIGIN, SiteChecker, image_dimensions


PIXEL = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGk0AAAAASUVORK5CYII=")


class SiteGateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="seacol-site-check-")
        self.root = Path(self.temporary.name)
        for name, url in (("index.html", "/"), ("privacy.html", "/privacy")):
            (self.root / name).write_text(
                f'<!doctype html><html lang="en"><head><title>{name}</title>'
                '<meta name="description" content="A useful page description.">'
                '<meta name="viewport" content="width=device-width, initial-scale=1">'
                f'<link rel="canonical" href="{ORIGIN}{url}"></head>'
                '<body><h1 id="policy">Page</h1><a href="/privacy#policy">Privacy</a></body></html>'
            )
        (self.root / "sitemap.xml").write_text(
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            f'<url><loc>{ORIGIN}/</loc></url><url><loc>{ORIGIN}/privacy</loc></url></urlset>'
        )
        (self.root / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {ORIGIN}/sitemap.xml\n")
        (self.root / "assets").mkdir()
        (self.root / "assets/pixel.png").write_bytes(PIXEL)
        self.manifest = {"version": 1, "origin": ORIGIN, "images": [], "socialCards": []}
        self.write_manifest()

    def tearDown(self):
        image_dimensions.cache_clear()
        self.temporary.cleanup()

    def write_manifest(self):
        (self.root / "assets/responsive-manifest.json").write_text(json.dumps(self.manifest))

    def errors(self):
        return "\n".join(SiteChecker(self.root).run())

    def replace(self, filename, old, new):
        path = self.root / filename
        path.write_text(path.read_text().replace(old, new))

    def test_consistent_site_passes(self):
        self.assertEqual(self.errors(), "")

    def test_broken_local_page_or_fragment_fails(self):
        self.replace("index.html", "/privacy#policy", "/missing#policy")
        self.assertIn("missing local target", self.errors())
        self.replace("index.html", "/missing#policy", "/privacy#absent")
        self.assertIn("missing anchor", self.errors())

    def test_wrong_canonical_and_stale_sitemap_fail(self):
        self.replace("privacy.html", ORIGIN + "/privacy", ORIGIN + "/old-privacy")
        self.assertIn("canonical must be exactly", self.errors())
        self.replace("sitemap.xml", ORIGIN + "/privacy", ORIGIN + "/old-privacy")
        self.assertIn("Sitemap differs", self.errors())

    def test_responsive_descriptor_must_match_actual_file(self):
        self.replace("index.html", "</body>", '<img src="assets/pixel.png" srcset="assets/pixel.png 2w" sizes="1px" width="1" height="1" alt="Test"></body>')
        self.assertIn("width does not match 2w", self.errors())

    def test_missing_intrinsic_dimensions_fail(self):
        self.replace("index.html", "</body>", '<img src="assets/pixel.png" alt="Test"></body>')
        self.assertIn("positive width/height", self.errors())

    def test_manifest_catches_changed_originals(self):
        (self.root / "assets/responsive.png").write_bytes(PIXEL)
        digest = hashlib.sha256(PIXEL).hexdigest()
        self.manifest["images"] = [{
            "source": "assets/pixel.png", "sourceWidth": 1, "sourceHeight": 1,
            "sourceBytes": len(PIXEL), "sourceSha256": digest,
            "variants": [{"src": "assets/responsive.png", "width": 1, "height": 1, "bytes": len(PIXEL), "sha256": digest}],
        }]
        self.write_manifest()
        self.assertEqual(self.errors(), "")
        (self.root / "assets/pixel.png").write_bytes(PIXEL + b"changed")
        self.assertIn("source hash changed", self.errors())

    def test_unimplemented_api_reference_fails(self):
        (self.root / "estimate.js").write_text("fetch('/api/estimate', {method: 'POST'});")
        self.assertIn("missing local target /api/estimate", self.errors())
        (self.root / "api").mkdir()
        (self.root / "api/estimate.js").write_text("export default function handler() {}")
        self.assertEqual(self.errors(), "")


if __name__ == "__main__":
    unittest.main()
