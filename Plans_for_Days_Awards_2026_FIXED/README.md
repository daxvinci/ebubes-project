# Award Night 2026

This is the real shared version of the Award Night site.

Architecture:
- Netlify hosts the website and serverless API.
- Supabase stores the shared voting data.
- No voter email is required.
- Voters choose their name and use a private password.
- Results remain unavailable until voting closes.

## Required setup
1. Create a free Supabase project.
2. Run `supabase.sql` in Supabase SQL Editor.
3. Replace `CHANGE_ME_ADMIN_PASSWORD` in the SQL with the admin password you want BEFORE running it.
4. Get the Supabase project URL and service-role key from Project Settings > API.
5. In Netlify, add environment variables:
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY
   - ADMIN_TOKEN_SECRET (make this a long random string)
6. Deploy this folder to Netlify.

Important: the service-role key must ONLY be stored as a Netlify environment variable. Never paste it into index.html.

The current starter awards are examples and can be edited/deleted from Admin.
