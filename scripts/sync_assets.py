"""Manually import the original production assets for a reviewed GitHub PR.

Normal publishing is GitHub -> Vercel. This reverse import is only for recovering
the original asset set from production, never for automatic deployment syncing.
"""

from pathlib import Path
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


BASE_URL = "https://seacolpaintingllc.com/assets"
ALLOWED_HOSTS = {"seacolpaintingllc.com", "www.seacolpaintingllc.com"}
MAX_BYTES = 10 * 1024 * 1024
ASSETS = (
    "after-kitchen.webp",
    "before-kitchen.webp",
    "builtins.webp",
    "commercial-after.webp",
    "commercial-before.webp",
    "commercial-studio.webp",
    "favicon.png",
    "hero-kitchen.webp",
    "logo-mark.png",
    "navy-vanity.webp",
    "spray-process.webp",
    "two-tone-kitchen.webp",
)


def validate_asset(name, data, content_type):
    """Reject error pages, mismatched formats, oversized and truncated files."""
    if not data or len(data) > MAX_BYTES:
        raise ValueError(f"{name}: empty or larger than the 10 MiB limit")
    if name.endswith(".png"):
        valid = (
            content_type == "image/png"
            and data.startswith(b"\x89PNG\r\n\x1a\n")
            and data[12:16] == b"IHDR"
            and data.endswith(b"\x00\x00\x00\x00IEND\xaeB`\x82")
        )
    else:
        valid = (
            content_type == "image/webp"
            and data[:4] == b"RIFF"
            and data[8:12] == b"WEBP"
            and int.from_bytes(data[4:8], "little") + 8 == len(data)
        )
    if not valid:
        raise ValueError(f"{name}: invalid or truncated image (type {content_type})")


def fetch_asset(name):
    request = Request(f"{BASE_URL}/{name}", headers={"User-Agent": "SEACOL-asset-import/1.0"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                final_url = urlsplit(response.geturl())
                if final_url.scheme != "https" or final_url.netloc not in ALLOWED_HOSTS:
                    raise ValueError(f"{name}: unexpected download origin")
                if response.status != 200:
                    raise ValueError(f"{name}: unexpected HTTP status {response.status}")
                data = response.read(MAX_BYTES + 1)
                validate_asset(name, data, response.headers.get_content_type())
                return data
        except (URLError, TimeoutError) as exc:
            if attempt == 2:
                raise RuntimeError(f"{name}: download failed after 3 attempts") from exc
            time.sleep(attempt + 1)


def sync_assets(root):
    # Complete every download and validation before changing any existing file.
    downloaded = {name: fetch_asset(name) for name in ASSETS}
    assets_dir = Path(root) / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    changed = []
    for name, data in downloaded.items():
        destination = assets_dir / name
        if destination.is_file() and destination.read_bytes() == data:
            continue
        destination.write_bytes(data)
        changed.append(name)
    return changed


if __name__ == "__main__":
    changed = sync_assets(Path(__file__).resolve().parent.parent)
    print(f"Validated {len(ASSETS)} production assets; {len(changed)} files changed.")
    for name in changed:
        print(f"  assets/{name}")
