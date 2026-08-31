# Deploy → pdf.zonova-tech.com

The app needs a container host (headless Chromium + LibreOffice), so it runs on
**Render** as a Docker web service. `scripts/deploy.mjs` creates the service,
attaches `pdf.zonova-tech.com`, and (optionally) writes the GoDaddy DNS record.

## 1. Code on GitHub

Already pushed if you ran the setup. Otherwise:

```bash
git init && git add -A && git commit -m "Zenova Brochure Generator"
gh repo create zenova-brochure-generator --private --source=. --push
```

A **private** repo needs Render's GitHub app connected once:
<https://dashboard.render.com> → account menu → *GitHub* → install on the repo.
(A public repo needs nothing.)

## 2. Tokens

| Token | Where |
|---|---|
| `RENDER_API_KEY` (required) | <https://dashboard.render.com/settings/api-keys> → *Create API Key* |
| `GODADDY_KEY` / `GODADDY_SECRET` (optional) | <https://developer.godaddy.com/keys> → *Create New API Key* → **Production** |

> GoDaddy restricts DNS-write API access to accounts with 10+ domains or a paid
> plan. If the key returns `403 ACCESS_DENIED`, skip the GoDaddy vars — the script
> prints the one CNAME record for you to paste into GoDaddy's DNS UI (2 minutes).

## 3. Run

```bash
RENDER_API_KEY=rnd_xxxxxxxx \
GODADDY_KEY=xxxx GODADDY_SECRET=xxxx \
node scripts/deploy.mjs
```

It will:
1. create the Render service (Docker, Frankfurt, 2 GB) and start the first build,
2. attach `pdf.zonova-tech.com`,
3. write the GoDaddy `CNAME pdf → <app>.onrender.com` (or print it),
4. poll `https://pdf.zonova-tech.com/api/health` until it's live.

The first build takes ~8–12 min (LibreOffice). Re-running the script is safe —
it reuses the existing service, domain, and record.

## Alternative: Render Blueprint (no API key)

`render.yaml` already declares the service **and** the custom domain. In Render:
**New → Blueprint** → pick the repo → Apply. Then Render shows the DNS target;
add it as a `CNAME` on host `pdf` in GoDaddy.
