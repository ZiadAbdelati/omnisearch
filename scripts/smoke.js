#!/usr/bin/env node
const base = process.env.SMOKE_BASE || "http://127.0.0.1:8787";
const admin = process.env.ADMIN_TOKEN || "change-me-admin-token";
let gw = process.env.GATEWAY_API_TOKEN || "";

async function main() {
  const h = await fetch(`${base}/healthz`);
  if (!h.ok) throw new Error("healthz failed");
  console.log("healthz ok");

  const accounts = await fetch(`${base}/admin/api/accounts`, {
    headers: { Authorization: `Bearer ${admin}` },
  }).then((r) => r.json());
  console.log("accounts", accounts.accounts?.length);

  const keyList = await fetch(`${base}/admin/api/api-keys`, {
    headers: { Authorization: `Bearer ${admin}` },
  }).then((r) => r.json());
  console.log("api keys", keyList.keys?.length);
  if (!gw) {
    const created = await fetch(`${base}/admin/api/api-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${admin}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "smoke-test", allowedProviders: ["searxng", "brave", "tavily"], rpmLimit: 30 }),
    }).then((r) => r.json());
    gw = created.token;
    console.log("api key created", created.key?.tokenPreview);
  }

  // Prefer searxng if present
  const searx = (accounts.accounts || []).find((a) => a.provider === "searxng");
  if (searx) {
    const t = await fetch(`${base}/admin/api/accounts/${searx.id}/test`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${admin}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const tj = await t.json();
    console.log("searxng test", t.status, tj.ok || tj.error);
  }

  const s = await fetch(`${base}/v1/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gw}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "example domain", limit: 3, mode: "cheap" }),
  });
  const sj = await s.json();
  console.log("search", s.status, sj.provider, sj.results?.length, sj.error || "");
  if (!s.ok) process.exit(1);
  console.log("smoke ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
