# Running and deploying

Your `main.py` talks to an OpenAI-compatible endpoint, so there is nothing in
it that needs Python on the web side. The same request now lives in
`app/api/chat/route.ts`, with two changes: it streams (`stream: true`), and
the browser holds the transcript instead of a `messages` list in memory. Keep
`main.py` for the terminal — both can use the same key.

## Run it locally

```bash
npm install
cp .env.example .env.local     # paste AVALAI_API_KEY into it
npm run dev
```

Open http://localhost:3000.

The key is read on the server only. It is never sent to the browser, which is
the reason the API call sits in a route handler rather than in the page.

## Deploy: pick Vercel

For this app, Vercel. It is one service, the build is detected automatically,
and streaming responses work on the free tier. Railway is the better choice
only if you keep Python in the loop, which you no longer need to.

```bash
npm i -g vercel
vercel          # answer the prompts, accept the detected framework
vercel env add AVALAI_API_KEY production
vercel --prod
```

Or push the folder to GitHub and import it at vercel.com/new — same result,
and you get a deploy on every push. Either way, add `AVALAI_API_KEY` under
Project → Settings → Environment Variables. A missing key shows up as a 500
from `/api/chat`, not a build failure, so check it first if the UI loads but
every message errors.

One thing to watch: Vercel runs functions in the US by default, and
api.avalai.ir is served from Iran. If requests time out in production but work
on your machine, move the function closer by adding a `vercel.json`:

```json
{ "functions": { "app/api/chat/route.ts": { "regions": ["fra1"] } } }
```

If it still fails, the endpoint is likely refusing the datacenter's IP range,
and no amount of Vercel configuration fixes that — that is the case where you
move to a host whose egress IP you control.

## When Railway instead

Railway makes sense if you want `main.py` to stay the brain — say you add
tools, local files, or Python libraries that have no JS equivalent. Then:
wrap `main.py` in a small FastAPI app with one streaming `POST /chat`
endpoint, deploy that to Railway, and change the `fetch("/api/chat")` call in
`components/chat.tsx` to point at the Railway URL. You would also need CORS
on the Python side and the key set in Railway rather than Vercel. It is two
services and two sets of environment variables for no gain today, so I would
not start there.

## Notes

- Reasoning display handles both conventions: a `reasoning_content` field in
  the stream, and `<think>` tags inside the content. If `gpt-5.6-luna` sends
  neither, the panel simply never appears and answers stream normally.
- `maxDuration = 60` in the route caps a single reply at 60 seconds on
  Vercel's free plan. Raise it if you move to a paid plan.
- Colors are variables at the top of `app/globals.css`. `--jade` is the
  accent; `--jade-bright` is kept for live states only.
