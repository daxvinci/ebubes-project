# Award Night 2026

One folder that runs on BOTH Netlify and Vercel. All the server logic lives in `lib/core.js`;
`netlify/functions/api.js` and `api/index.js` are tiny wrappers around it.

## Files
- `index.html`  the whole website
- `lib/core.js`  server logic (voting, admin, results)
- `api/index.js` + `vercel.json`  Vercel entry point
- `netlify/functions/api.js` + `netlify.toml`  Netlify entry point
- `supabase.sql`  database setup (run once in Supabase, SQL Editor)

## Environment variables (same on Netlify and Vercel)
- `SUPABASE_URL`  e.g. https://abcdefghij.supabase.co  (no /rest/v1)
- `SUPABASE_SERVICE_ROLE_KEY`  the secret / service_role key. Never put it in index.html.
- `ADMIN_TOKEN_SECRET`  any long random string

Both hosts can use the SAME Supabase project, so votes are shared.
