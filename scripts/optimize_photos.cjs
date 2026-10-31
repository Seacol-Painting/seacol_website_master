#!/usr/bin/env node
// Rebuild responsive derivatives from the original project photographs.
// Uses the project's pinned sharp dependency. The runtime package is a fallback
// for this workspace only, never a prerequisite for CI or Vercel.
// This command writes assets and the manifest only. Apply HTML separately with
// python3 scripts/apply_responsive_photos.py --pages gallery*.html
// After intentionally changing/adding a source photograph, refresh its baseline
// with --refresh-sources, apply the new HTML references, and review the diff.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
let sharpPath;
try { sharpPath = require.resolve('sharp'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
  sharpPath = require.resolve('sharp', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES] });
}
const sharp = require(sharpPath);
// Four explicit image jobs below bound memory/CPU use in shared build machines.
sharp.concurrency(1);

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://seacolpaintingllc.com';
const MANIFEST = path.join(ROOT, 'assets/responsive-manifest.json');
const WIDTHS = [480, 960, 1440];
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const decode = (text) => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const socialSources = {
  'gallery.html': ['assets/projects/cabinets-two-tone-kitchen.jpg', 'Two-tone kitchen cabinetry finished by SEACOL'],
  'gallery-cabinets.html': ['assets/library-v2/kitchen-a-after.svg', 'White kitchen cabinets after SEACOL refinishing'],
  'gallery-interiors.html': ['assets/library-v2/wainscot-office-after.svg', 'Interior walls and white wainscoting after SEACOL painting'],
  'gallery-exteriors.html': ['assets/projects/exterior-issaquah-siding.jpg', 'Exterior siding project in Issaquah by SEACOL'],
  'gallery-custom.html': ['assets/library-v2/home-slat-wall.svg', 'Geometric feature wall finished by SEACOL'],
  'gallery-commercial.html': ['assets/library-v2/gym-after.svg', 'Commercial gym interior after SEACOL painting'],
  'gallery-process.html': ['assets/projects/floor-protection-original.jpg', 'Floor protection and preparation before painting'],
  'gallery-woodwork.html': ['assets/projects/woodwork-media-shelving.jpg', 'Media shelving and architectural woodwork by SEACOL'],
  'gallery-repairs.html': ['assets/projects/repairs-skimcoat.jpg', 'Skim coating and a protected work area before painting'],
};

async function inputFor(source) {
  const original = await fs.readFile(path.join(ROOT, source));
  let input = original;
  let kind = 'raster';
  if (source.endsWith('.svg')) {
    const svg = original.toString('utf8');
    const image = svg.match(/<image\b[^>]*\b(?:xlink:)?href="data:image\/webp;base64,([^"]+)"[^>]*\/?\s*>/);
    const root = svg.match(/<svg\b([^>]*)>/);
    const width = Number(root?.[1].match(/\bwidth="(\d+)"/)?.[1]);
    const height = Number(root?.[1].match(/\bheight="(\d+)"/)?.[1]);
    // These wrappers contain one full-frame WebP, with no paths, filters, text,
    // transforms, clipping, or external references. Fail instead of guessing if
    // an SVG is later replaced by a composition that needs rendering.
    if (!image || !width || !height || /<(?:path|g|rect|text|filter|clipPath|mask|use)\b|\btransform=/.test(svg)
        || (svg.match(/<image\b/g) || []).length !== 1) {
      throw new Error(`Unsupported SVG composition: ${source}`);
    }
    input = Buffer.from(image[1], 'base64');
    const embedded = await sharp(input).metadata();
    if (embedded.width !== width || embedded.height !== height) {
      throw new Error(`SVG wrapper and embedded photograph have different geometry: ${source}`);
    }
    kind = 'embedded-webp';
  }
  const metadata = await sharp(input).metadata();
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  return {
    original, input, kind, metadata,
    width: rotated ? metadata.height : metadata.width,
    height: rotated ? metadata.width : metadata.height,
  };
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.includes('--help')) {
    console.log('Usage: node scripts/optimize_photos.cjs [--refresh-sources]\n'
      + 'Default: verify tracked original hashes, rebuild ignored image outputs, update output checksums only.\n'
      + '--refresh-sources: explicitly accept changed/new originals before applying and reviewing HTML updates.');
    return;
  }
  if (arguments_.some((arg) => arg !== '--refresh-sources')) throw new Error('Unknown option; use --help.');
  const refreshSources = arguments_.includes('--refresh-sources');
  let previous = { images: [], pages: {} };
  try { previous = JSON.parse(await fs.readFile(MANIFEST, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!refreshSources) throw new Error('Missing tracked photo manifest; restore it before building.');
  }
  if (previous.version !== undefined && previous.version !== 1) throw new Error('Unsupported photo manifest version.');
  const reverse = new Map(previous.images.flatMap((entry) => entry.variants.map((v) => [v.src, entry.source])));
  const sources = new Map();
  const pageHTML = new Map();
  for (const page of (await fs.readdir(ROOT)).filter((name) => name.endsWith('.html')).sort()) {
    const html = await fs.readFile(path.join(ROOT, page), 'utf8');
    pageHTML.set(page, html);
    for (const match of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g)) {
      const source = reverse.get(match[1]) || match[1];
      if (!source.startsWith('assets/') || source.startsWith('assets/seacol-')) continue;
      if (source.includes('..') || source.includes('?') || source.startsWith('assets/projects/responsive/')) {
        throw new Error(`Unrecognized image source: ${source}`);
      }
      if (!sources.has(source)) sources.set(source, new Set());
      sources.get(source).add(page);
    }
  }
  for (const [page, [source]] of Object.entries(socialSources)) {
    if (!sources.has(source)) sources.set(source, new Set());
    sources.get(source).add(page);
  }
  // Check all original inputs before writing any derivative. Regeneration must
  // not silently bless an accidental change to a published project photograph.
  const baseline = new Map(previous.images.map((entry) => [entry.source, entry]));
  const inputs = new Map();
  for (const source of [...sources.keys()].sort()) {
    const data = await inputFor(source);
    const expected = baseline.get(source);
    if (!refreshSources && (!expected || expected.sourceSha256 !== hash(data.original)
        || expected.sourceBytes !== data.original.length || expected.sourceWidth !== data.width
        || expected.sourceHeight !== data.height)) {
      throw new Error(`Original photograph differs from the tracked manifest: ${source}. Review it before using --refresh-sources.`);
    }
    inputs.set(source, data);
  }
  await fs.mkdir(path.join(ROOT, 'assets/projects/responsive'), { recursive: true });
  await fs.mkdir(path.join(ROOT, 'assets/social'), { recursive: true });
  const images = [];
  const queue = [...sources.keys()].sort();
  async function worker() {
    while (queue.length) {
      const source = queue.shift();
      const data = inputs.get(source);
      const sourceHash = hash(data.original);
      const suffix = hash(Buffer.from(`${source}:${sourceHash}`)).slice(0, 10);
      const stem = path.basename(source, path.extname(source));
      const widths = [...new Set([...WIDTHS.filter((w) => w <= data.width), Math.min(data.width, 1440)])].sort((a, b) => a - b);
      const variants = [];
      for (const width of widths) {
        const src = `assets/projects/responsive/${stem}-${suffix}-${width}.webp`;
        // Preserve native WebP bytes instead of introducing another lossy encode.
        const copyNative = width === data.width && data.metadata.format === 'webp'
          && !data.metadata.orientation && !data.metadata.icc;
        let bytes = copyNative ? data.input : null;
        let quality = null;
        if (!copyNative) {
          // Keep photographic detail while avoiding a derivative heavier than
          // its same-size JPEG source. Tall/high-detail photos may exceed the
          // soft budget; never keep lowering quality to force a tiny file.
          const budget = Math.min(width <= 480 ? 80000 : width <= 960 ? 180000 : 280000,
            width === data.width ? data.original.length : Infinity);
          for (quality of [86, 84, 82]) {
            bytes = await sharp(data.input).rotate()
              .resize({ width, withoutEnlargement: true })
              .webp({ quality, effort: 5, smartSubsample: true }).toBuffer();
            if (bytes.length <= budget) break;
          }
        }
        const metadata = await sharp(bytes).metadata();
        await fs.writeFile(path.join(ROOT, src), bytes);
        variants.push({ src, width: metadata.width, height: metadata.height, bytes: bytes.length, sha256: hash(bytes),
          encoding: copyNative ? 'original-webp' : 'webp', quality });
      }
      images.push({ source, sourceWidth: data.width, sourceHeight: data.height,
        sourceBytes: data.original.length, sourceSha256: sourceHash, kind: data.kind,
        pages: [...sources.get(source)].sort(), variants });
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  images.sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
  const socialCards = [];
  for (const [page, [source, alt]] of Object.entries(socialSources)) {
    const { input } = inputs.get(source);
    // Contain the complete photograph on a navy canvas; do not crop a project.
    const bytes = await sharp(input).rotate()
      .resize({ width: 1200, height: 630, fit: 'contain', withoutEnlargement: true, background: '#081a2b' })
      .flatten({ background: '#081a2b' })
      .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
    const metadata = await sharp(bytes).metadata();
    if (metadata.width !== 1200 || metadata.height !== 630) throw new Error(`Unexpected social canvas: ${page}`);
    const src = `assets/social/${page.replace('.html', '')}.jpg`;
    await fs.writeFile(path.join(ROOT, src), bytes);
    const html = pageHTML.get(page);
    socialCards.push({ page, source, src, width: 1200, height: 630, bytes: bytes.length,
      sha256: hash(bytes), title: decode(html.match(/<title>([^<]+)<\/title>/)[1]),
      description: decode(html.match(/<meta name="description" content="([^"]+)"/)[1]),
      alt, url: `${ORIGIN}/${page.replace('.html', '')}` });
  }
  // Keep page plans, estimates, and any reviewed metadata. Recalculate byte
  // totals from the actual encoder output; libvips binaries can differ by OS.
  const pages = structuredClone(previous.pages || {});
  const generated = new Map(images.map((entry) => [entry.source, entry]));
  for (const page of Object.values(pages)) {
    const items = page.images || [];
    const unique = new Set(items.map((item) => item.source));
    if ([...unique].some((source) => !generated.has(source))) {
      throw new Error('Page image plan references a removed source; refresh the plan before building.');
    }
    page.originalUniquePhotoBytes = [...unique].reduce((sum, source) => sum + generated.get(source).sourceBytes, 0);
    for (const dpr of [1, 2]) {
      const selected = new Map();
      for (const item of items) {
        const cssWidth = { hero: 390, 'home-service': 171, 'home-commercial': 314 }[item.role] || 354;
        const variants = generated.get(item.source).variants;
        const chosen = variants.find((v) => v.width >= cssWidth * dpr) || variants.at(-1);
        selected.set(chosen.src, chosen.bytes);
      }
      page[`mobile${dpr}xPhotoBytes`] = [...selected.values()].reduce((sum, bytes) => sum + bytes, 0);
    }
  }
  const next = { ...previous, version: 1, origin: ORIGIN, widths: WIDTHS,
    encoding: { format: 'webp', quality: [86, 84, 82], effort: 5, resize: 'proportional-no-upscale', nativeWebp: 'copied' },
    images, pages, socialCards };
  // Preserve the exact tracked manifest bytes when nothing changed. This makes
  // repeat builds clean even if a maintainer formatted its JSON with Python.
  if (!isDeepStrictEqual(previous, next)) await fs.writeFile(MANIFEST, JSON.stringify(next, null, 2) + '\n');
  console.log(`Generated ${images.length} photograph families, ${images.reduce((n, i) => n + i.variants.length, 0)} WebP variants, and ${socialCards.length} social cards.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
