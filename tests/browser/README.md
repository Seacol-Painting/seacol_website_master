# Gallery estimate browser regressions

Run the existing offline gate with `npm run check` and create the production output with `npm run build`.
The new Node tests are included automatically by that gate.

For the browser suite, serve a **local test copy** of `dist/`, copying the two
`estimate-mobile.*` files beside one another into its `__qa__/` directory. Open
`/__qa__/estimate-mobile.html` and press **Run automated browser tests**.
Never copy `__qa__/` into a production build; `scripts/build-site.cjs` already
excludes `tests/` from the deployable output.

The suite uses real same-origin page documents in iframes sized 320×568,
390×844, 412×915 and 844×390. It checks all nine galleries, both explicit exterior
choices, usable control bounds, horizontal overflow, form preselection, manual
edits, invalid/duplicate URL keys, synthetic failed submissions, idempotent
retries, successful receipts, resets and Color Chart query preservation.
Submissions are intercepted inside the iframe; no customer request or email is sent.

On a local combination with PR #19, open
`/__qa__/estimate-mobile.html?colorChart=1` to additionally require the actual
Color Chart notes to populate `Project details`. Without PR #19, those notes
must remain unimported, matching current main behavior.

The page reports a machine-readable result on `#summary` as `data-passed` and
`data-failed`. A complete run contains 52 cases. These are responsive viewport
tests, not physical Android/iOS, native picker, virtual keyboard or touch-device
certification. Test those separately before claiming device coverage.
