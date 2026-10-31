"""Regression checks for safe imports; no external service or credentials needed."""

import base64
from email.message import Message
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import sync_assets


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGk0AAAAASUVORK5CYII="
)
WEBP = base64.b64decode("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")


class Response:
    status = 200

    def __init__(self, data=PNG, content_type="image/png", url="https://www.seacolpaintingllc.com/assets/favicon.png"):
        self.data = data
        self.url = url
        self.headers = Message()
        self.headers["Content-Type"] = content_type

    def geturl(self):
        return self.url

    def read(self, limit):
        return self.data[:limit]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class AssetImportTests(unittest.TestCase):
    def test_valid_formats_and_canonical_redirect(self):
        sync_assets.validate_asset("favicon.png", PNG, "image/png")
        sync_assets.validate_asset("hero-kitchen.webp", WEBP, "image/webp")
        with patch.object(sync_assets, "urlopen", return_value=Response()):
            self.assertEqual(sync_assets.fetch_asset("favicon.png"), PNG)

    def test_html_mismatched_type_and_truncated_images_are_rejected(self):
        for name, data, content_type in (
            ("favicon.png", b"<html>Error</html>", "text/html"),
            ("favicon.png", PNG, "text/html"),
            ("favicon.png", PNG[:-5], "image/png"),
            ("hero-kitchen.webp", WEBP[:-1], "image/webp"),
        ):
            with self.subTest(name=name, content_type=content_type), self.assertRaises(ValueError):
                sync_assets.validate_asset(name, data, content_type)

    def test_external_or_insecure_redirect_is_rejected(self):
        for url in ("https://example.com/image.png", "http://seacolpaintingllc.com/assets/favicon.png"):
            with self.subTest(url=url), patch.object(sync_assets, "urlopen", return_value=Response(url=url)):
                with self.assertRaisesRegex(ValueError, "origin"):
                    sync_assets.fetch_asset("favicon.png")

    def test_network_failures_retry_but_remain_failures(self):
        with patch.object(sync_assets, "urlopen", side_effect=URLError("unavailable")) as fetch, patch.object(sync_assets.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "3 attempts"):
                sync_assets.fetch_asset("favicon.png")
            self.assertEqual(fetch.call_count, 3)

    def test_partial_download_failure_does_not_change_existing_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            original = root / "assets" / sync_assets.ASSETS[0]
            original.write_bytes(b"original")
            with patch.object(sync_assets, "fetch_asset", side_effect=[WEBP, RuntimeError("download failed")]):
                with self.assertRaises(RuntimeError):
                    sync_assets.sync_assets(root)
            self.assertEqual(original.read_bytes(), b"original")
            self.assertEqual(list((root / "assets").iterdir()), [original])

    def test_import_is_idempotent_and_preserves_unlisted_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            extra = root / "assets" / "new-logo.webp"
            extra.write_bytes(b"keep this")
            def download(name):
                return PNG if name.endswith(".png") else WEBP
            with patch.object(sync_assets, "fetch_asset", side_effect=download):
                self.assertEqual(sync_assets.sync_assets(root), list(sync_assets.ASSETS))
                self.assertEqual(sync_assets.sync_assets(root), [])
            self.assertEqual(extra.read_bytes(), b"keep this")


if __name__ == "__main__":
    unittest.main()
