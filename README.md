# Pinterest SEO Content Generator — Vercel Edition

Paste any blog article URL and get a complete Pinterest SEO package:

- **Board Name** and **Board Description** (SEO-optimised)
- **Pin Title** — new and curiosity-driven, never a copy of the article title
- **Pin Description** — strictly under 500 characters, with a call to action and hashtags
- **Keywords** in 4 categories: Primary, Secondary, Long-Tail, Trending
- Pinterest Ideas / Search pages linked as research sources

> ⚠️ **Honesty note:** keywords are **AI-generated estimates** based on the article and
> Pinterest-style search patterns. They are **not** verified Pinterest search-volume data,
> and the tool never claims they are. Some publishers block automated reading
> (paywalls, HTTP 402/403) — for those, the tool shows an honest
> "couldn't read that page" error instead of inventing content.

---

## How it works

| Piece | What it does |
|---|---|
| `app/page.js` | The single-page UI (URL input, 4 result cards with Copy buttons, Copy All, New Variation, keyword categories, history). |
| `app/api/generate/route.js` | Server API route. Validates the URL, rate-limits, and returns the package. |
| `lib/engine.js` | Fetches the article server-side, extracts its title/headings/text (cheerio), analyses topic, subtopics, search intent and keywords, then generates the 4 results. |

History is saved in the visitor's **browser localStorage only** — there is no database
and no login, and one visitor cannot see another visitor's history.

### Two generation modes

1. **Heuristic mode (default, free, no setup)** — if no API key is set, a built-in
   deterministic generator builds the package from the article's own extracted
   keywords and headings. It works out of the box.
2. **AI mode (optional, better quality)** — set `OPENAI_API_KEY` (see below) and the
   server calls the OpenAI API for higher-quality, more natural wording. If the
   OpenAI call ever fails, the tool automatically falls back to heuristic mode.
   `OPENAI_MODEL` chooses the model (default `gpt-4o-mini`).

---

## Run it locally first (recommended)

Prerequisites: [Node.js](https://nodejs.org) 18.18 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000, paste an article URL, click **Generate**.

Optional AI mode locally: copy `.env.example` to `.env.local`, fill in
`OPENAI_API_KEY`, and restart `npm run dev`.

---

## Deploy to Vercel (step by step)

Prerequisites: a free **GitHub** account and a free **Vercel** account
(sign up at https://vercel.com with your GitHub account).

1. **Put the project on GitHub**
   - Create a new repository on GitHub (e.g. `pinterest-seo-generator`).
   - Upload all files in this folder to it — you can use GitHub's web upload
     ("uploading an existing file") or git:
     ```bash
     git init && git add . && git commit -m "Pinterest SEO Generator"
     git branch -M main
     git remote add origin https://github.com/YOUR-USERNAME/pinterest-seo-generator.git
     git push -u origin main
     ```
   - Do **not** upload `node_modules` or `.next` (they are in `.gitignore`).
2. **Import it in Vercel**
   - In Vercel: **Add New → Project → Import** your GitHub repository.
   - Framework Preset will auto-detect **Next.js**. Leave the defaults.
3. **Set environment variables** (only if you want AI mode)
   - In the import screen (or later under Project → Settings → Environment Variables):
     - `OPENAI_API_KEY` = your OpenAI API key *(optional — skip for free heuristic mode)*
     - `OPENAI_MODEL` = `gpt-4o-mini` *(optional)*
   - Never commit a real key to GitHub. Keys belong only in Vercel's settings.
4. **Deploy** — click **Deploy**. Vercel builds the app and gives you a live
   address like `https://pinterest-seo-generator.vercel.app`. Done — share that link.

Every later push to GitHub re-deploys automatically.

### Add your own domain

1. Buy a domain (any registrar), e.g. you want `tool.yourwebsite.com`.
2. In Vercel: Project → **Settings → Domains → Add** → enter `tool.yourwebsite.com`.
3. Vercel shows a DNS record (usually a CNAME to `cname.vercel-dns.com`) — add that
   record at your registrar / DNS host.
4. Wait for DNS to propagate; HTTPS/SSL is issued automatically and free.

---

## Costs (honest summary)

- **Vercel hosting:** the free (Hobby) tier is enough to start. It includes a
  generous build/bandwidth allowance; you only need a paid plan if traffic grows a lot.
- **Domain:** optional — only if you want your own address.
- **OpenAI API (only in AI mode):** this is the real running cost. Every Generate
  click makes one API call from **your** account, so usage is billed to you per
  generation. Using `gpt-4o-mini` keeps each generation very cheap, but set a
  monthly spending limit in your OpenAI billing settings, and keep the built-in
  rate limit on (below).
- **Heuristic mode costs nothing** beyond hosting.

## Abuse protection

- The API route has a simple **in-memory rate limit: 10 generations per hour per
  IP**, with a clear error message when it is hit.
- **Serverless limitation:** that counter lives in one function instance's memory.
  On Vercel, instances are ephemeral and not shared, so it is a best-effort brake,
  not a hard global limit. If the tool gets heavy public traffic, upgrade to a
  shared store (e.g. Upstash Redis rate limiting) or Vercel Firewall rules.
- **Cloudflare Turnstile** (CAPTCHA) hooks are noted in `.env.example` but are
  disabled by default. Add them later only if bots become a real problem.
- Your `OPENAI_API_KEY` is used **only on the server** and is never sent to visitors.

## Project structure

```
app/
  layout.js            Page shell + metadata
  globals.css          Styles (mobile-friendly)
  page.js              UI: input, results, keywords, history (client component)
  api/generate/route.js  POST /api/generate — validation + rate limit
lib/
  engine.js            Fetch/extract, keyword analysis, heuristic + OpenAI generation
.env.example           Copy to .env.local for local AI mode
vercel.json            Vercel framework hint
```

## Troubleshooting

- **"Couldn't read that page"** — the publisher blocks automated reading or the
  page is paywalled. This is expected for some sites (e.g. Allrecipes). Try another URL.
- **Changed the env vars but nothing changed** — redeploy the project in Vercel
  after editing environment variables.
- **Rate limit message on your own testing** — the limit is per hour per IP; wait,
  or restart your local dev server.
