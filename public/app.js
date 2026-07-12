(() => {
  const TOKEN_KEY = "sg_admin_token";
  const GW_KEY = "sg_gateway_token";
  const TAB_KEY = "sg_active_tab";

  const $ = (id) => document.getElementById(id);
  const loginView = $("login-view");
  const app = $("app");
  const initialToken = token();
  if (initialToken) {
    const tab = normalizeTab(localStorage.getItem(TAB_KEY) || "accounts");
    setActiveTab(tab, { load: false });
    showApp();
  }

  function token() {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  }

  async function api(path, opts = {}) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {},
    );
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const res = await fetch(path, { ...opts, headers });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text };
    }
    if (!res.ok) {
      const err = new Error(data.error || res.statusText);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function showApp() {
    loginView.classList.add("hidden");
    app.classList.remove("hidden");
  }

  function showLogin(msg) {
    app.classList.add("hidden");
    loginView.classList.remove("hidden");
    if (msg) {
      $("login-error").textContent = msg;
      $("login-error").classList.remove("hidden");
    } else {
      $("login-error").textContent = "";
      $("login-error").classList.add("hidden");
    }
  }

  function normalizeTab(tab) {
    return $(`tab-${tab}`) ? tab : "accounts";
  }
  function showToast(msg, type = "info") {
    let container = $("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 4300);
  }

  let providersMeta = [];

  async function boot() {
    if (!token()) return showLogin();
    const tab = normalizeTab(localStorage.getItem(TAB_KEY) || "accounts");
    try {
      setActiveTab(tab, { load: false });
      const data = await api(`/admin/api/bootstrap?tab=${encodeURIComponent(tab)}`);
      $("health-line").textContent = `providers: ${data.providers.join(", ")}`;
      providersMeta = data.providerMeta || [];
      fillProviderSelect();
      renderAccounts(data.accounts || []);
      applySettings(data.settings || {});
      if (data.keys) renderKeys(data.keys);
      if (data.stats) renderStats(data.stats);
      $("search-gateway-token").value = localStorage.getItem(GW_KEY) || "";
      showApp();
    } catch (e) {
      if (e.status === 401) sessionStorage.removeItem(TOKEN_KEY);
      showLogin(e.message || "Auth failed");
    }
  }

  function fillProviderSelect() {
    const sel = $("acc-provider");
    sel.innerHTML = "";
    for (const p of providersMeta) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label ? `${p.label} (${p.id})` : p.id;
      sel.appendChild(opt);
    }
    sel.onchange = () => {
      const p = providersMeta.find((x) => x.id === sel.value);
      $("provider-hint").textContent = p?.secretHint || "";
      $("secret-label").style.opacity = p && p.needsSecret === false ? "0.7" : "1";
    };
  }

  $("login-btn").onclick = async () => {
    const t = $("login-token").value.trim();
    sessionStorage.setItem(TOKEN_KEY, t);
    $("login-error").classList.add("hidden");
    await boot();
  };
  $("login-token").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("login-btn").click();
  });
  $("logout-btn").onclick = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin();
  };

  function setActiveTab(tab, opts = {}) {
    tab = normalizeTab(tab);
    localStorage.setItem(TAB_KEY, tab);
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    $(`tab-${tab}`).classList.remove("hidden");
    if (opts.load === false) return;
    if (tab === "stats") refreshStats();
    if (tab === "keys") refreshKeys();
  }

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.onclick = () => setActiveTab(btn.dataset.tab);
  });

  function fmtLimits(a) {
    const parts = [];
    if (a.dailyLimit != null) parts.push(`d:${a.dailyLimit}`);
    if (a.monthlyLimit != null) parts.push(`m:${a.monthlyLimit}`);
    if (a.rpmLimit != null) parts.push(`rpm:${a.rpmLimit}`);
    return parts.join(" ") || "∞";
  }

  function fmtUsage(a) {
    return `rpm:${a.rpm || 0} · d:${a.usedToday || 0} · m:${a.usedMonth || 0}`;
  }

  function supportsProviderUsage(a) {
    return a.hasSecret && ["tavily", "serpapi"].includes(a.provider);
  }


  function providerUsageHtml(a) {
    return `<div class="usage-stack">
      <span class="usage-inline" title="Gateway usage: current minute, today, this month">${fmtUsage(a)}</span>
      <span class="provider-usage muted" id="provider-usage-${a.id}">provider: ${supportsProviderUsage(a) ? "loading…" : (a.hasSecret ? "no usage API" : "n/a")}</span>
    </div>`;
  }


  function statusPill(a) {
    if (!a.enabled) return `<span class="pill warn">disabled</span>`;
    if (a.cooldownUntil && new Date(a.cooldownUntil) > new Date()) {
      return `<span class="pill warn" title="${a.cooldownUntil}">cooldown</span>`;
    }
    if (a.lastError) return `<span class="pill bad" title="${escapeHtml(a.lastError)}">error</span>`;
    if (a.lastOkAt) return `<span class="pill ok">ok</span>`;
    return `<span class="pill">idle</span>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  let accountsCache = [];

  async function refreshAccounts() {
    const data = await api("/admin/api/accounts");
    renderAccounts(data.accounts || []);
  }

  function renderAccounts(accounts) {
    accountsCache = accounts;
    const body = $("accounts-body");
    body.innerHTML = "";
    for (const a of accountsCache) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" data-toggle="${a.id}" ${a.enabled ? "checked" : ""} /></td>
        <td>
          <strong>${escapeHtml(a.name)}</strong>
          <div class="muted small">${a.hasSecret ? escapeHtml(a.secretPreview || "••••") : "no secret"}
          ${a.baseUrl ? " · " + escapeHtml(a.baseUrl) : ""}</div>
        </td>
        <td><code>${escapeHtml(a.provider)}</code></td>
        <td>${a.priority}</td>
        <td>${a.weight}</td>
        <td class="muted small">${fmtLimits(a)}</td>
        <td>${providerUsageHtml(a)}</td>
        <td>${statusPill(a)}</td>
        <td class="actions">
          <button data-test="${a.id}" class="ghost">Test</button>
          <button data-usage="${a.id}" class="ghost">Usage</button>
          <button data-edit="${a.id}" class="ghost">Edit</button>
          <button data-del="${a.id}" class="danger">Delete</button>
        </td>`;
      body.appendChild(tr);
    }

    body.querySelectorAll("[data-toggle]").forEach((el) => {
      el.onchange = async () => {
        await api(`/admin/api/accounts/${el.dataset.toggle}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: el.checked }),
        });
        await refreshAccounts();
      };
    });
    body.querySelectorAll("[data-edit]").forEach((el) => {
      el.onclick = () => openDialog(accountsCache.find((x) => x.id === el.dataset.edit));
    });
    body.querySelectorAll("[data-del]").forEach((el) => {
      el.onclick = async () => {
        if (!confirm("Delete this account?")) return;
        await api(`/admin/api/accounts/${el.dataset.del}`, { method: "DELETE" });
        await refreshAccounts();
      };
    });
    body.querySelectorAll("[data-usage]").forEach((el) => {
      el.onclick = async () => loadProviderUsage(el.dataset.usage, el);
    });
    body.querySelectorAll("[data-test]").forEach((el) => {
      el.onclick = async () => {
        el.disabled = true;
        el.textContent = "…";
        try {
          const r = await api(`/admin/api/accounts/${el.dataset.test}/test`, {
            method: "POST",
            body: "{}",
          });
          showToast(`OK (${r.ms}ms): ${r.sample?.title || ""} - ${r.sample?.url || ""}`, "success");
        } catch (e) {
          showToast(`Fail: ${e.message}`, "error");
        } finally {
          el.disabled = false;
          el.textContent = "Test";
          await refreshAccounts();
        }
      };
    });
  }

  async function loadProviderUsage(id, btn) {
    const target = $(`provider-usage-${id}`);
    if (!target) return;
    if (btn) btn.disabled = true;
    target.textContent = "provider: loading…";
    try {
      const r = await api(`/admin/api/accounts/${id}/usage`);
      const usage = r.usage || {};
      target.classList.toggle("error", !usage.available);
      target.textContent = `provider: ${usage.available ? (usage.label || "available") : (usage.error || "unavailable")}`;
    } catch (e) {
      target.classList.add("error");
      target.textContent = `provider: ${e.message}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  const dialog = $("account-dialog");
  $("add-account-btn").onclick = () => openDialog(null);
  $("cancel-dialog").onclick = () => dialog.close();

  function openDialog(account) {
    $("dialog-title").textContent = account ? "Edit account" : "Add account";
    $("acc-id").value = account?.id || "";
    $("acc-name").value = account?.name || "";
    $("acc-provider").value = account?.provider || "brave";
    $("acc-secret").value = "";
    $("acc-base").value = account?.baseUrl || "";
    $("acc-priority").value = account?.priority ?? 100;
    $("acc-weight").value = account?.weight ?? 1;
    $("acc-daily").value = account?.dailyLimit ?? "";
    $("acc-monthly").value = account?.monthlyLimit ?? "";
    $("acc-rpm").value = account?.rpmLimit ?? "";
    $("acc-modes").value = (account?.modes || []).join(",");
    $("acc-notes").value = account?.notes || "";
    $("acc-enabled").checked = account?.enabled !== false;
    $("dialog-msg").textContent = account?.hasSecret
      ? "Leave API key blank to keep existing secret."
      : "";
    dialog.showModal();
  }

  function formPayload() {
    const modes = $("acc-modes")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const num = (id) => {
      const v = $(id).value;
      return v === "" ? null : Number(v);
    };
    const payload = {
      name: $("acc-name").value.trim(),
      provider: $("acc-provider").value,
      baseUrl: $("acc-base").value.trim() || null,
      priority: Number($("acc-priority").value || 100),
      weight: Number($("acc-weight").value || 1),
      dailyLimit: num("acc-daily"),
      monthlyLimit: num("acc-monthly"),
      rpmLimit: num("acc-rpm"),
      modes,
      notes: $("acc-notes").value.trim() || null,
      enabled: $("acc-enabled").checked,
    };
    const secret = $("acc-secret").value;
    if (secret) payload.secret = secret;
    if (!$("acc-id").value && !secret && payload.provider !== "searxng") {
      throw new Error("API key required for new account");
    }
    return payload;
  }

  $("account-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = formPayload();
      const id = $("acc-id").value;
      if (id) {
        await api(`/admin/api/accounts/${id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        if (!payload.secret && payload.provider !== "searxng") {
          throw new Error("API key required");
        }
        await api("/admin/api/accounts", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      dialog.close();
      await refreshAccounts();
    } catch (err) {
      $("dialog-msg").textContent = err.message;
    }
  };

  $("test-account-btn").onclick = async () => {
    $("dialog-msg").textContent = "Testing…";
    try {
      const payload = formPayload();
      const id = $("acc-id").value;
      let r;
      if (id && !payload.secret) {
        r = await api(`/admin/api/accounts/${id}/test`, {
          method: "POST",
          body: "{}",
        });
      } else {
        r = await api("/admin/api/accounts/test", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      $("dialog-msg").textContent = `OK (${r.ms}ms): ${r.sample?.title || ""} ${r.sample?.url || ""}`;
    } catch (e) {
      $("dialog-msg").textContent = `Fail: ${e.message}`;
    }
  };

  $("run-search-btn").onclick = async () => {
    const gw = $("search-gateway-token").value.trim();
    localStorage.setItem(GW_KEY, gw);
    $("search-out").textContent = "Running…";
    try {
      const res = await fetch("/v1/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${gw}`,
        },
        body: JSON.stringify({
          query: $("search-q").value,
          limit: Number($("search-limit").value || 5),
          mode: $("search-mode").value,
        }),
      });
      const data = await res.json();
      $("search-out").textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      $("search-out").textContent = String(e);
    }
  };

  let keysCache = [];
  const keyDialog = $("key-dialog");

  function providerList(value) {
    return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
  }

  function optionalNumber(id) {
    const v = $(id).value;
    return v === "" ? null : Number(v);
  }

  function showNewKey(token) {
    $("new-key-card").classList.remove("hidden");
    $("new-key-token").textContent = token;
    $("search-gateway-token").value = token;
    localStorage.setItem(GW_KEY, token);
  }

  function keyPayload() {
    return {
      name: $("key-name").value.trim(),
      allowedProviders: providerList($("key-providers").value),
      rpmLimit: optionalNumber("key-rpm"),
      dailyLimit: optionalNumber("key-daily"),
      monthlyLimit: optionalNumber("key-monthly"),
      maxResults: optionalNumber("key-max-results"),
      notes: $("key-notes").value.trim() || null,
      enabled: $("key-enabled").checked,
    };
  }

  function fmtKeyLimits(k) {
    const parts = [];
    if (k.rpmLimit != null) parts.push(`rpm:${k.rpmLimit}`);
    if (k.dailyLimit != null) parts.push(`d:${k.dailyLimit}`);
    if (k.monthlyLimit != null) parts.push(`m:${k.monthlyLimit}`);
    if (k.maxResults != null) parts.push(`max:${k.maxResults}`);
    return parts.join(" ") || "∞";
  }

  async function refreshKeys() {
    const data = await api("/admin/api/api-keys");
    renderKeys(data.keys || []);
  }

  function renderKeys(keys) {
    keysCache = keys;
    const body = $("keys-body");
    body.innerHTML = "";
    for (const k of keysCache) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" data-key-toggle="${k.id}" ${k.enabled ? "checked" : ""} /></td>
        <td><strong>${escapeHtml(k.name)}</strong><div class="muted small">${escapeHtml(k.notes || "")}</div></td>
        <td><code>${escapeHtml(k.tokenPreview)}</code></td>
        <td class="muted small">${(k.allowedProviders || []).length ? escapeHtml(k.allowedProviders.join(", ")) : "any"}</td>
        <td class="muted small">${fmtKeyLimits(k)}</td>
        <td class="muted small">${escapeHtml(k.lastUsedAt || "never")}</td>
        <td class="actions">
          <button data-key-edit="${k.id}" class="ghost">Edit</button>
          <button data-key-reroll="${k.id}" class="ghost">Reroll</button>
          <button data-key-del="${k.id}" class="danger">Delete</button>
        </td>`;
      body.appendChild(tr);
    }

    body.querySelectorAll("[data-key-toggle]").forEach((el) => {
      el.onchange = async () => {
        await api(`/admin/api/api-keys/${el.dataset.keyToggle}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: el.checked }),
        });
        await refreshKeys();
      };
    });
    body.querySelectorAll("[data-key-edit]").forEach((el) => {
      el.onclick = () => openKeyDialog(keysCache.find((x) => x.id === el.dataset.keyEdit));
    });
    body.querySelectorAll("[data-key-reroll]").forEach((el) => {
      el.onclick = async () => {
        if (!confirm("Reroll this key? Existing clients using it will stop working.")) return;
        const r = await api(`/admin/api/api-keys/${el.dataset.keyReroll}/reroll`, { method: "POST", body: "{}" });
        showNewKey(r.token);
        await refreshKeys();
      };
    });
    body.querySelectorAll("[data-key-del]").forEach((el) => {
      el.onclick = async () => {
        if (!confirm("Delete this API key?")) return;
        await api(`/admin/api/api-keys/${el.dataset.keyDel}`, { method: "DELETE" });
        await refreshKeys();
      };
    });
  }

  function openKeyDialog(key) {
    $("key-dialog-title").textContent = key ? "Edit API key" : "Generate API key";
    $("key-id").value = key?.id || "";
    $("key-name").value = key?.name || "";
    $("key-providers").value = (key?.allowedProviders || []).join(",");
    $("key-rpm").value = key?.rpmLimit ?? "";
    $("key-daily").value = key?.dailyLimit ?? "";
    $("key-monthly").value = key?.monthlyLimit ?? "";
    $("key-max-results").value = key?.maxResults ?? "";
    $("key-notes").value = key?.notes || "";
    $("key-enabled").checked = key?.enabled !== false;
    $("key-dialog-msg").textContent = "";
    keyDialog.showModal();
  }

  $("add-key-btn").onclick = () => openKeyDialog(null);
  $("cancel-key-dialog").onclick = () => keyDialog.close();
  $("copy-key-btn").onclick = async () => {
    await navigator.clipboard.writeText($("new-key-token").textContent);
    showToast("Copied API key", "success");
  };
  $("key-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const id = $("key-id").value;
      const payload = keyPayload();
      if (!payload.name) throw new Error("name required");
      if (id) {
        await api(`/admin/api/api-keys/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        const r = await api("/admin/api/api-keys", { method: "POST", body: JSON.stringify(payload) });
        showNewKey(r.token);
      }
      keyDialog.close();
      await refreshKeys();
    } catch (err) {
      $("key-dialog-msg").textContent = err.message;
    }
  };

  async function refreshStats() {
    const s = await api("/admin/api/stats");
    renderStats(s);
  }

  function renderStats(s) {
    $("stats-summary").innerHTML = `
      <div class="stat"><div class="n">${s.today?.ok || 0}</div><div class="l">OK today</div></div>
      <div class="stat"><div class="n">${s.today?.fail || 0}</div><div class="l">Failures today</div></div>
      <div class="stat"><div class="n">${s.accounts?.length || 0}</div><div class="l">Accounts</div></div>`;
    const body = $("stats-body");
    body.innerHTML = "";
    for (const e of s.recent || []) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="muted small">${escapeHtml(e.createdAt || "")}</td>
        <td class="muted small">${escapeHtml(e.ip || "")}</td>
        <td><strong>${escapeHtml(e.query || "")}</strong></td>
        <td>${escapeHtml(e.provider)}</td>
        <td>${e.ok ? `<span class="pill ok">✓</span>` : `<span class="pill bad">✗</span>`}</td>
        <td>${e.resultCount ?? ""}</td>
        <td class="muted">${e.latencyMs ?? ""}</td>
        <td class="muted small error">${escapeHtml(e.error || "")}</td>
        <td><button class="ghost small inspect-btn">View</button></td>`;

      tr.querySelector(".inspect-btn").onclick = () => {
        $("event-ip").textContent = e.ip || "unknown";
        $("event-ua").textContent = e.userAgent || "unknown";
        $("event-query").textContent = e.query || "none";
        try {
          const parsed = typeof e.responseJson === "string" ? JSON.parse(e.responseJson) : e.responseJson;
          $("event-json").textContent = parsed ? JSON.stringify(parsed, null, 2) : (e.error || "No response data");
        } catch {
          $("event-json").textContent = e.responseJson || e.error || "No response data";
        }
        $("event-dialog").showModal();
      };
      body.appendChild(tr);
    }
  }

  function applySettings(settings) {
    $("set-default-mode").value = settings.default_mode || "auto";
    $("set-default-limit").value = settings.default_limit || 10;
    $("set-max-limit").value = settings.max_limit || 20;
  }

  async function loadSettings() {
    const s = await api("/admin/api/settings");
    applySettings(s.settings || {});
  }
  $("save-settings").onclick = async () => {
    await api("/admin/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        default_mode: $("set-default-mode").value,
        default_limit: $("set-default-limit").value,
        max_limit: $("set-max-limit").value,
      }),
    });
    $("settings-msg").textContent = "Saved.";
  };

  boot();
})();
