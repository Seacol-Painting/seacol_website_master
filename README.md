# SEACOL PAINTING LLC website

Production: https://seacolpaintingllc.com/
Repository: https://github.com/Seacol-Painting/seacol_website_master
Vercel project: `seacol_website_v1` in `seacol-painting-llc`.

Static English pages, responsive project photographs, before/after comparisons and a native Vercel Function for private estimate requests.

## Development and publication

Use Node.js 24 and Python 3. Install the locked dependencies with `npm ci`, then run `npm run build`.

The build generates photograph variants, checks the website, runs automated tests, and creates `dist` only after those checks pass. Vercel uses the build/output settings in `vercel.json`. GitHub Actions runs the same build on every pull request and push to `main`, including merge queues. An error prevents the new version from publishing. Server modules, tests, maintenance scripts, configuration and environment files stay outside the static output.

Open a pull request for changes. Existing repository protection requires a PR for `main`. Merging a reviewed, passing revision into `main` publishes through the Vercel Git integration. Check deployment status before calling a release complete; an older successful deployment stays live if the new build fails.

```sh
npm ci
npm run check
npm run build
node tests/estimate-frontend.test.cjs
node tests/analytics.test.cjs
```

## Estimate requests and the private inbox

The form submits JSON to `/api/estimate`. Success means the request was stored privately. The visitor sees a welcoming confirmation and does not need an email app. Request references stay in the private records and owner notifications rather than the customer-facing message. An interrupted connection preserves their entries and reuses the same ID when retrying the same request. Email/text links remain as a fallback.

Requests are stored in the private Vercel Blob store **seacol-website-inbox** (`store_ERBXwMNbaDaLdkNk`). In the Vercel project, open **Storage**, select this store, and inspect the **estimates** folder. Only authorized account members can read these records. There is no public endpoint for listing or downloading requests. Preview verification records are separated under `preview/estimates/`; production records remain under `estimates/`. Preview requests never send owner email notifications.

The inbox is the source of truth. Analytics conversions can be absent when visitors opt out, block analytics or lose a connection. A provider's email acceptance also does not prove delivery to an inbox.

Required server environment variables:

- `BLOB_READ_WRITE_TOKEN`: supplied by the connected private Blob store.
- `ESTIMATE_RATE_LIMIT_SECRET`: a random server-only secret of at least 32 characters. Never expose it in browser code or Git.

The endpoint validates bounded input, origin and content type, rejects a honeypot, uses distributed rate limiting, and prevents repeated IDs from creating duplicate requests. Records do not contain raw network addresses. Expired rate-limit records stop counting; Blob does not automatically delete them. Maintenance must remove only expired control records, never customer estimates as part of rate-limit cleanup.

Keep customer records only for actual follow-up and recordkeeping needs. Authorized administrators can handle access, correction or deletion requests through the private store. Do not change the store to public.

### Production email notifications

New production estimate requests notify `info@seacolpaintingllc.com` through Resend, using `requests@seacolpaintingllc.com` as the sender and the customer's email as reply-to. Preview and development never send owner notifications.

Required Production server environment variables:

- `RESEND_API_KEY`: a Resend key with Sending access restricted to `seacolpaintingllc.com`.
- `ESTIMATE_NOTIFICATION_FROM`: `requests@seacolpaintingllc.com`.

Notifications run only after the request is saved privately. Repeating an identical submission ID and payload returns the existing receipt without sending another notification. The provider idempotency key is `seacol-estimate/<submissionId>`.

An email failure never discards a saved request. Private notification metadata is stored at `notifications/<submissionId>.json`. An `accepted` status confirms provider acceptance. Resend's `delivered` event confirms acceptance by the recipient's mail server, not necessarily placement in the primary inbox; verify actual receipt in the owner's mailbox. Automatic email retries are not enabled. Review failures through Resend and follow up from the private inbox.

After changing email configuration, verify one synthetic production submission, its saved notification status, and receipt by the owner. Repeat the same submission ID and payload to confirm no second notification is sent.

## Analytics

Vercel Web Analytics is enabled on the existing project. `analytics.js` loads the first-party collector only on the exact HTTPS production domain and when Do Not Track and Global Privacy Control are absent. Previews are excluded.

Dashboard: https://vercel.com/seacol-painting-llc/seacol_website_v1/analytics

| Event | Meaning |
| --- | --- |
| Native pageview | A public page opened |
| `gallery_view` | A gallery opened |
| `section_view` | A section entered the viewing area, once per section/page session |
| `comparison_interaction` | A before/after control was moved |
| `estimate_cta_click` | An estimate link was clicked |
| `estimate_form_start` | A visitor started editing the form |
| `estimate_submitted` | The browser received confirmation of a newly stored request |
| `call_click`, `sms_click`, `email_click` | A contact link was clicked |

A contact click does not prove a call or message, and a request does not prove a sale. The collector receives fixed categories and page paths, not names, emails, phone numbers, project descriptions, references or link bodies. Query strings/fragments are removed. External referrers with potentially sensitive paths/query data suppress collection. Session storage only suppresses repeated section events and contains no visitor ID or contact data. No advertising tracker is included.

Analytics uses the existing Vercel plan's usage pricing; no Plus upgrade is required. Current pricing: https://vercel.com/docs/analytics/limits-and-pricing

## Photograph and social card maintenance

The 163 original photographs remain the source of truth. `scripts/optimize_photos.cjs` generates 474 proportional WebP variants and nine 1200 × 630 gallery social cards. These generated assets are excluded from Git and recreated in every build with pinned Sharp. They are included in `dist` and published normally. Source hashes, dimensions, page usage and size estimates live in `assets/responsive-manifest.json`.

Builds fail if an original unexpectedly changes. To deliberately update a source, review the replacement, run `node scripts/optimize_photos.cjs --refresh-sources`, then `python3 scripts/apply_responsive_photos.py --pages index.html gallery*.html`. Inspect the result, run the build, and commit the updated manifest and page references. Preserve aspect ratios and avoid enlarging small originals. SVG photograph wrappers embed WebP bytes; extract those instead of rasterizing as artwork.

Gallery cards are in `assets/social/`, outside the same-origin restriction on project photographs. Each gallery has its own Open Graph and Twitter image/title/description. Sharing platforms can retain old previews until they fetch the page again.

## Search and logo maintenance

The sitemap, canonical links and internal links use the HTTPS production domain with extension-free routes. The sitemap lists 11 public pages and is announced in `robots.txt`. Update it when adding/removing pages; do not invent `lastmod` dates.

A public sitemap does not confirm indexing. In the owner's Search Console account, select or verify the correct property, submit `https://seacolpaintingllc.com/sitemap.xml`, inspect **Pages**, and review **Performance → Pages** for URLs with impressions/clicks. Use URL Inspection for specific galleries and canonical selection. Google login is required. Public `site:` searches are incomplete and cannot establish an exact indexed-page count.

The original PNG logo is retained. Pages use lossless WebP variants at 288, 576 and 780 pixels plus a 64-pixel favicon. Preserve its 2:1 aspect ratio and transparency.

## Asset recovery

**Sync website assets** is a manual recovery import in the opposite direction from publication: it downloads the 12 original assets from production and proposes differences in a PR. Run it through **Actions → Sync website assets → Run workflow** on `main` only when intentionally recovering assets. It never pushes directly to `main` or merges its PR. If GitHub disallows automated PR creation, the run summary gives a comparison link for the saved branch. Review recovered photograph changes and refresh the manifest intentionally before merging.
