# Website security maintenance

Run before publishing:

```sh
python3 tests/security-policy.py
node tests/interaction-regressions.cjs
git diff --check
```

Security headers live in `vercel.json`. Scripts are limited to this origin and
the exact SHA-256 hash of the homepage JSON-LD. Update that hash when changing
the structured data. Inline event handlers and JavaScript evaluation are blocked.
Inline CSS is allowed because existing comparison ratios and interactive slider
styles depend on it. Test the home page, galleries, mobile menu and estimate form
in a browser after changing policy.

The estimate form sends JSON to the same-origin `/api/estimate` endpoint. A
successful receipt confirms private storage; optional owner email notifications
run afterward. Email/SMS links remain as fallbacks. `form-action 'none'` blocks
native form submission, while the CSP permits the same-origin JavaScript request.
Review the API's validation, origin restrictions and private storage when changing
the form.

Project photographs carry same-origin CORP and a restricted CORS origin. These
reduce third-party browser embedding, not downloading, screenshots or rehosting.
Social sharing images remain outside this rule. Original photographs are retained;
the build generates optimized derivatives.

Secrets, private keys, backup archives and local deployment state must stay out
of Git. Test files and maintenance scripts are available during the build but are
excluded from the public `dist` output. Server code, configuration and environment
files must never enter that static output. Never store master advertising artwork
or private client records in the public website directory.

Keep account recovery codes offline. Review repository access, deployment tokens,
domain ownership and recovery email periodically. Require strong authentication
on GitHub, Vercel, the domain account and the recovery mailbox. Account, domain,
mail authentication and branch protections are separate controls; HTTP headers
do not configure or replace them.

Recovery: retain a known-good commit, revert the faulty change with a new commit,
and verify the production deployment. A recovery branch in the same repository
is not an independent backup; maintain a private offline copy separately.
