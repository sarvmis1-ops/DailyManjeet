# LifeOS — Study Edition

A personal study and life organiser that runs in the browser: tasks, spaced-repetition learning,
syllabus, notes and gallery, money, health, habits and alarms, plus one-to-one and group chat with file sharing.
Plain HTML, CSS and JavaScript with no build step. Data lives in Supabase.

## Files

```
index.html          the app
css/style.css       iOS-style theme (light and dark)
js/config.js        Supabase project URL and public anon key
js/db.js            data layer and sign-in
js/chat-core.js     chat helpers
js/chat-api.js      chat calls to Supabase
js/chat-ui.js       chat screens and realtime
js/app.js           the rest of the app
supabase/*.sql      database setup (run in the Supabase SQL Editor, not served by the app)
.nojekyll           tells GitHub Pages to serve the files as they are
```

## Database setup (once)

In Supabase Dashboard → SQL Editor, run these in order:

1. `supabase/schema.sql`: app tables and the file bucket
2. `supabase/fix_grants.sql`: table permissions for signed-in users
3. `supabase/chat.sql`: chat tables, functions and the chat file bucket
4. `supabase/seed.sql` (optional): sample data. Put your login email in it first.

## Host on GitHub Pages

1. Create a GitHub repository and upload the contents of this folder, with `index.html` at the top level.
2. Go to repository **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, then save.
3. Your app will be at `https://<your-username>.github.io/<repo-name>/` after a minute or two.
4. In Supabase, go to **Authentication → URL Configuration**:
   - set **Site URL** to that address
   - add it under **Redirect URLs**

   This makes sign-up confirmation emails open your app.

## Security note

`js/config.js` contains the Supabase **anon** key. It is meant to be public, and Row Level Security
limits every user to their own data and to the chats they are a member of.
Never put the `service_role` key in any of these files.
