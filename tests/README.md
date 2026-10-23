# Registration portal tests

Browser tests run the real `register/index.html` in Chromium (Playwright). Every Supabase Edge Function call is
mocked in the test and any other off-box request is aborted, so nothing here can reach the production project.

    npm install
    npm test

Set `CHROMIUM_PATH` to a Chromium binary if Playwright's own download is not available.

`regression-d14-d16.test.cjs` pins today's DUPR 14 / DUPR 16 behaviour. It was written against the unmodified page.
