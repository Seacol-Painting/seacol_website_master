# SEACOL Fine Painting — Website V1

Static, responsive website prepared for `seacolpaintingllc.com`.

## Included
- English / Spanish language switch
- Responsive premium design
- Real project photographs, optimized as WebP
- Before/after slider
- Residential and commercial services
- Estimate form that prepares a text message to (206) 573-2474
- Privacy policy
- Local business structured data

## Publish on Vercel
1. Unzip the folder.
2. Upload the folder to a new GitHub repository, or drag it into Vercel if your dashboard offers direct upload.
3. In Vercel, create a new project from the repository.
4. Framework preset: **Other**.
5. Build command: leave empty.
6. Output directory: leave empty.
7. Deploy.
8. Add `seacolpaintingllc.com` and `www.seacolpaintingllc.com` in Project Settings → Domains.

## Pending before final launch
- Replace provisional logo if a final vector logo is approved.
- Add the corporate email after Microsoft 365 is configured.
- Add contractor license and legal business details when available.
- Add testimonials and additional exterior/interior/deck project photos.
- Confirm final service wording and business hours.

## Publishing and asset recovery

Approved pull requests merged into `main` publish through the existing Vercel Git integration. The **Sync website assets** action is a manual recovery import in the opposite direction: it downloads the 12 original assets from the production website and proposes any differences in a new pull request. Run it from **Actions → Sync website assets → Run workflow** on `main` only when intentionally recovering those assets. It never pushes directly to `main` or merges its own pull request. If GitHub does not allow Actions to create pull requests, the run summary supplies a comparison link for opening the saved branch manually.

## Search and logo maintenance

`sitemap.xml`, page canonical links, and internal links use the public HTTPS domain with Vercel's extension-free routes. Update the sitemap when adding or removing a public page; `robots.txt` announces its location. Do not invent `lastmod` dates.

The existing PNG logo is retained as the source. Pages use losslessly encoded WebP derivatives at 288, 576, and 780 pixels wide, selected through `srcset` for the displayed size, plus a separate 64-pixel PNG favicon. When replacing the approved logo, regenerate these derivatives and preserve its 2:1 aspect ratio and transparency.
