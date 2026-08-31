#!/usr/bin/env node
/**
 * One-shot deploy: Render (Docker web service) + GoDaddy DNS for a subdomain.
 *
 *   RENDER_API_KEY=rnd_xxx \
 *   GODADDY_KEY=xxx GODADDY_SECRET=xxx \
 *   node scripts/deploy.mjs
 *
 * Env (all optional unless noted):
 *   RENDER_API_KEY   (required)  dashboard.render.com/settings/api-keys
 *   GITHUB_REPO      https URL of the repo; auto-detected from `git remote` if unset
 *   BRANCH           default: main
 *   DOMAIN           default: zonova-tech.com
 *   SUBDOMAIN        default: pdf         -> pdf.zonova-tech.com
 *   RENDER_PLAN      default: standard    (2 GB — needed for Chromium + LibreOffice)
 *   RENDER_REGION    default: frankfurt
 *   SERVICE_NAME     default: zenova-brochure-generator
 *   GODADDY_KEY / GODADDY_SECRET   if set, the CNAME is written automatically;
 *                                  otherwise the record to add is printed.
 *   GODADDY_ENV      "prod" (default) or "ote" for GoDaddy's test API
 *
 * Safe to re-run: an existing service / domain / DNS record is reused, not duplicated.
 */

import { execSync } from "node:child_process";

const cfg = {
  renderKey: process.env.RENDER_API_KEY,
  repo: process.env.GITHUB_REPO || detectRepo(),
  branch: process.env.BRANCH || "main",
  domain: process.env.DOMAIN || "zonova-tech.com",
  sub: process.env.SUBDOMAIN || "pdf",
  plan: process.env.RENDER_PLAN || "standard",
  region: process.env.RENDER_REGION || "frankfurt",
  name: process.env.SERVICE_NAME || "zenova-brochure-generator",
  gdKey: process.env.GODADDY_KEY,
  gdSecret: process.env.GODADDY_SECRET,
  gdBase:
    (process.env.GODADDY_ENV || "prod") === "ote"
      ? "https://api.ote-godaddy.com"
      : "https://api.godaddy.com",
};
const fqdn = `${cfg.sub}.${cfg.domain}`;

function detectRepo() {
  try {
    const url = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
    // git@github.com:owner/repo.git  ->  https://github.com/owner/repo
    const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
    return m ? `https://github.com/${m[1]}` : url;
  } catch {
    return undefined;
  }
}

const log = (...a) => console.log("•", ...a);
const die = (msg) => {
  console.error("\n✗ " + msg);
  process.exit(1);
};

async function render(path, init = {}) {
  const res = await fetch(`https://api.render.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.renderKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`Render ${init.method || "GET"} ${path} → ${res.status}\n${text}`);
  }
  return body;
}

async function godaddy(path, init = {}) {
  const res = await fetch(`${cfg.gdBase}/v1${path}`, {
    ...init,
    headers: {
      Authorization: `sso-key ${cfg.gdKey}:${cfg.gdSecret}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GoDaddy ${init.method || "GET"} ${path} → ${res.status}\n${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (!cfg.renderKey) die("RENDER_API_KEY is required (dashboard.render.com/settings/api-keys).");
  if (!cfg.repo || !/github\.com/.test(cfg.repo))
    die("Could not determine the GitHub repo. Set GITHUB_REPO=https://github.com/you/repo");

  console.log(`\nDeploying ${cfg.repo} → Render → https://${fqdn}\n`);

  // 1. Owner ------------------------------------------------------------------
  const owners = await render("/owners?limit=50");
  if (!owners?.length) die("No Render owners visible to this API key.");
  const owner = owners[0].owner;
  log(`Render account: ${owner.name} (${owner.type}, ${owner.id})`);

  // 2. Service (create or reuse) -------------------------------------------
  const existing = (await render(`/services?name=${encodeURIComponent(cfg.name)}&limit=20`))
    .map((s) => s.service)
    .find((s) => s.name === cfg.name);

  let service = existing;
  if (service) {
    log(`Reusing existing service ${service.id}`);
  } else {
    log("Creating web service (Docker)…");
    const created = await render("/services", {
      method: "POST",
      body: JSON.stringify({
        type: "web_service",
        name: cfg.name,
        ownerId: owner.id,
        repo: cfg.repo,
        branch: cfg.branch,
        autoDeploy: "yes",
        serviceDetails: {
          runtime: "docker",
          plan: cfg.plan,
          region: cfg.region,
          healthCheckPath: "/api/health",
          envSpecificDetails: { dockerfilePath: "./Dockerfile", dockerContext: "." },
        },
      }),
    });
    service = created.service ?? created;
    log(`Created service ${service.id} — first build started (Docker + LibreOffice ≈ 8–12 min)`);
  }

  const onrenderHost = (service.serviceDetails?.url || "").replace(/^https?:\/\//, "");
  if (!onrenderHost) die("Render did not return the service URL yet — re-run in a minute.");
  log(`Service host: ${onrenderHost}`);

  // 3. Custom domain --------------------------------------------------------
  const domains = await render(`/services/${service.id}/custom-domains`);
  let domain = (domains || []).find((d) => d.name === fqdn);
  if (!domain) {
    log(`Attaching custom domain ${fqdn}…`);
    domain = await render(`/services/${service.id}/custom-domains`, {
      method: "POST",
      body: JSON.stringify({ name: fqdn }),
    });
  } else {
    log(`Custom domain already attached (${domain.verificationStatus || "pending"})`);
  }

  // 4. DNS ----------------------------------------------------------------
  if (cfg.gdKey && cfg.gdSecret) {
    log(`Writing GoDaddy CNAME ${cfg.sub}.${cfg.domain} → ${onrenderHost}`);
    await godaddy(`/domains/${cfg.domain}/records/CNAME/${cfg.sub}`, {
      method: "PUT",
      body: JSON.stringify([{ data: onrenderHost, ttl: 600 }]),
    });
    log("DNS record written.");
  } else {
    console.log(
      `\n  → Add this record in GoDaddy DNS for ${cfg.domain}:\n` +
        `      Type   CNAME\n` +
        `      Name   ${cfg.sub}\n` +
        `      Value  ${onrenderHost}\n` +
        `      TTL    600\n`,
    );
  }

  // 5. Verify domain on Render + wait for the app -------------------------
  log("Asking Render to verify the domain…");
  try {
    await render(`/services/${service.id}/custom-domains/${domain.id}/verify`, { method: "POST" });
  } catch {
    log("verify call not ready yet (fine, Render retries automatically)");
  }

  log("Waiting for DNS + TLS + first deploy (polling https://" + fqdn + "/api/health)…");
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20000));
    try {
      const res = await fetch(`https://${fqdn}/api/health`, { redirect: "manual" });
      if (res.ok) {
        console.log(`\n✓ Live: https://${fqdn}\n`);
        return;
      }
      process.stdout.write(`  …${res.status}`);
    } catch {
      process.stdout.write("  …dns/tls");
    }
  }
  console.log(
    `\n! Not answering yet — the first Docker build is slow. Check the deploy log at` +
      ` https://dashboard.render.com and retry https://${fqdn}/api/health in a few minutes.`,
  );
}

main().catch((e) => die(e.message));
