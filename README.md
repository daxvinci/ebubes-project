# Award Night 2026

One folder that runs on BOTH Netlify and Vercel. All server logic lives in `lib/core.js`;
`netlify/functions/api.js` and `api/index.js` are tiny wrappers around it.

## Files
- `index.html`  the whole website (voting, admin, results panel, awards night presentation)
- `lib/core.js`  server logic
- `api/index.js` + `vercel.json`  Vercel entry point
- `netlify/functions/api.js` + `netlify.toml`  Netlify entry point
- `supabase.sql`  full database setup for a NEW database
- `migration_sex_and_audience.sql`  one-time update for a database you already set up

## Environment variables (same on Netlify and Vercel)
- `SUPABASE_URL`  e.g. https://abcdefghij.supabase.co  (no /rest/v1)
- `SUPABASE_SERVICE_ROLE_KEY`  the secret / service_role key. Never put it in index.html.
- `ADMIN_TOKEN_SECRET`  any long random string
