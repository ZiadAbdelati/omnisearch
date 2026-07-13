(() => {
  const TOKEN_KEY = "sg_admin_token";
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

  async function copyText(text, fallbackTarget) {
    if (!text) throw new Error("No API key to copy");

    if (fallbackTarget) {
      fallbackTarget.value = text;
      fallbackTarget.setAttribute("readonly", "");
      fallbackTarget.focus();
      fallbackTarget.select();
      fallbackTarget.setSelectionRange(0, fallbackTarget.value.length);
      if (document.execCommand("copy")) return;
    }

    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Fall through: browser permission policy can reject clipboard access.
      }
    }

    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.cssText = "position:fixed;left:-1000px;top:0;width:1px;height:1px;opacity:0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("Browser blocked clipboard access");
  }

  let providersMeta = [];
  let statsFilterOptions = { providers: [], apiKeys: [] };

  async function boot() {
    if (!token()) return showLogin();
    const tab = normalizeTab(localStorage.getItem(TAB_KEY) || "accounts");
    try {
      setActiveTab(tab, { load: false });
      const data = await api(`/admin/api/bootstrap?tab=${encodeURIComponent(tab)}`);
      $("health-line").textContent = "Admin console";
      providersMeta = data.providerMeta || [];
      fillProviderSelect();
      renderAccounts(data.accounts || []);
      applySettings(data.settings || {});
      if (data.keys) renderKeys(data.keys);
      if (data.stats) renderStats(data.stats);
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
    closeMobileNav();
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

  const mobileMenuBtn = $("mobile-menu-btn");
  const mobileNavBackdrop = $("mobile-nav-backdrop");

  function openMobileNav() {
    document.body.classList.add("mobile-menu-open");
    mobileMenuBtn.setAttribute("aria-expanded", "true");
    mobileNavBackdrop.hidden = false;
  }

  function closeMobileNav() {
    document.body.classList.remove("mobile-menu-open");
    mobileMenuBtn.setAttribute("aria-expanded", "false");
    mobileNavBackdrop.hidden = true;
  }

  mobileMenuBtn.onclick = () => {
    if (document.body.classList.contains("mobile-menu-open")) closeMobileNav();
    else openMobileNav();
  };
  mobileNavBackdrop.onclick = closeMobileNav;

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.onclick = () => {
      setActiveTab(btn.dataset.tab);
      closeMobileNav();
    };
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
    return a.hasSecret && ["brave", "tavily", "serpapi"].includes(a.provider);
  }


  function providerUsageHtml(a) {
    return `<div class="usage-stack">
      <span class="usage-inline" title="Gateway usage: current minute, today, this month">${fmtUsage(a)}</span>
      <span class="provider-usage muted" data-provider-usage="${escapeHtml(a.id)}">provider: ${supportsProviderUsage(a) ? "loading…" : (a.hasSecret ? "no usage API" : "n/a")}</span>
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
    const cards = $("accounts-cards");
    body.innerHTML = "";
    cards.innerHTML = "";
    for (const a of accountsCache) {
      const secretMeta = a.hasSecret ? escapeHtml(a.secretPreview || "••••") : "no secret";
      const baseUrl = a.baseUrl ? escapeHtml(a.baseUrl) : "";
      const status = statusPill(a);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" data-toggle="${a.id}" ${a.enabled ? "checked" : ""} /></td>
        <td>
          <strong>${escapeHtml(a.name)}</strong>
          <div class="account-meta muted small">${secretMeta}
          ${baseUrl ? " · " + baseUrl : ""}</div>
        </td>
        <td><code>${escapeHtml(a.provider)}</code></td>
        <td>${a.priority}</td>
        <td>${a.weight}</td>
        <td class="muted small">${fmtLimits(a)}</td>
        <td>${providerUsageHtml(a)}</td>
        <td>${status}</td>
        <td class="actions">
          <button data-test="${a.id}" class="ghost">Test</button>
          <button data-usage="${a.id}" class="ghost">Usage</button>
          <button data-edit="${a.id}" class="ghost">Edit</button>
          <button data-del="${a.id}" class="danger">Delete</button>
        </td>`;
      body.appendChild(tr);

      const card = document.createElement("article");
      card.className = "mobile-card account-mobile-card";
      card.innerHTML = `
        <div class="mobile-card-head">
          <div class="mobile-card-title-wrap">
            <div class="mobile-title">${escapeHtml(a.name)}</div>
            <div class="mobile-subtitle"><code>${escapeHtml(a.provider)}</code> · ${secretMeta}</div>
          </div>
          ${status}
        </div>
        ${baseUrl ? `<div class="mobile-url muted small">${baseUrl}</div>` : ""}
        <div class="mobile-fields">
          <div class="mobile-field"><span>Enabled</span><label class="mobile-check"><input type="checkbox" data-toggle="${a.id}" ${a.enabled ? "checked" : ""} /> ${a.enabled ? "On" : "Off"}</label></div>
          <div class="mobile-field"><span>Priority</span><strong>${a.priority}</strong></div>
          <div class="mobile-field"><span>Weight</span><strong>${a.weight}</strong></div>
          <div class="mobile-field"><span>Limits</span><strong>${fmtLimits(a)}</strong></div>
        </div>
        <div class="mobile-usage">${providerUsageHtml(a)}</div>
        <div class="mobile-actions actions">
          <button data-test="${a.id}" class="ghost">Test</button>
          <button data-usage="${a.id}" class="ghost">Usage</button>
          <button data-edit="${a.id}" class="ghost">Edit</button>
          <button data-del="${a.id}" class="danger">Delete</button>
        </div>`;
      cards.appendChild(card);
    }

    bindAccountActions(body);
    bindAccountActions(cards);

    function bindAccountActions(root) {
      root.querySelectorAll("[data-toggle]").forEach((el) => {
        el.onchange = async () => {
          await api(`/admin/api/accounts/${el.dataset.toggle}`, {
            method: "PATCH",
            body: JSON.stringify({ enabled: el.checked }),
          });
          await refreshAccounts();
        };
      });
      root.querySelectorAll("[data-edit]").forEach((el) => {
        el.onclick = () => openDialog(accountsCache.find((x) => x.id === el.dataset.edit));
      });
      root.querySelectorAll("[data-del]").forEach((el) => {
        el.onclick = async () => {
          if (!confirm("Delete this account?")) return;
          await api(`/admin/api/accounts/${el.dataset.del}`, { method: "DELETE" });
          await refreshAccounts();
        };
      });
      root.querySelectorAll("[data-usage]").forEach((el) => {
        el.onclick = async () => loadProviderUsage(el.dataset.usage, el);
      });
      root.querySelectorAll("[data-test]").forEach((el) => {
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
  }

  async function loadProviderUsage(id, btn) {
    const targets = Array.from(document.querySelectorAll(".provider-usage"))
      .filter((el) => el.dataset.providerUsage === id);
    if (!targets.length) return;
    if (btn) btn.disabled = true;
    targets.forEach((target) => {
      target.classList.remove("error");
      target.textContent = "provider: loading…";
    });
    try {
      const r = await api(`/admin/api/accounts/${id}/usage`);
      const usage = r.usage || {};
      targets.forEach((target) => {
        target.classList.toggle("error", !usage.available);
        target.textContent = `provider: ${usage.available ? (usage.label || "available") : (usage.error || "unavailable")}`;
      });
    } catch (e) {
      targets.forEach((target) => {
        target.classList.add("error");
        target.textContent = `provider: ${e.message}`;
      });
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
    const out = $("search-out");
    out.classList.remove("hidden");
    out.textContent = "Running…";
    try {
      const data = await api("/admin/api/search-test", {
        method: "POST",
        body: JSON.stringify({
          query: $("search-q").value,
          limit: Number($("search-limit").value || 5),
          mode: $("search-mode").value,
        }),
      });
      out.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      out.textContent = String(e);
    }
  };

  let keysCache = [];
  let currentNewKeyToken = "";
  let pendingRerollKeyId = "";
  const keyDialog = $("key-dialog");

  function providerList(value) {
    return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
  }

  function optionalNumber(id) {
    const v = $(id).value;
    return v === "" ? null : Number(v);
  }

  function showNewKey(token) {
    currentNewKeyToken = token;
    $("new-key-token").textContent = token;
    $("new-key-dialog").showModal();
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
    const cards = $("keys-cards");
    body.innerHTML = "";
    cards.innerHTML = "";
    for (const k of keysCache) {
      const providers = (k.allowedProviders || []).length ? escapeHtml(k.allowedProviders.join(", ")) : "any";
      const notes = escapeHtml(k.notes || "");
      const limits = fmtKeyLimits(k);
      const lastUsed = escapeHtml(k.lastUsedAt || "never");
      const status = k.enabled ? `<span class="pill ok">enabled</span>` : `<span class="pill warn">disabled</span>`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" data-key-toggle="${k.id}" ${k.enabled ? "checked" : ""} /></td>
        <td><strong>${escapeHtml(k.name)}</strong><div class="muted small">${notes}</div></td>
        <td><code>${escapeHtml(k.tokenPreview)}</code></td>
        <td class="muted small">${providers}</td>
        <td class="muted small">${limits}</td>
        <td class="muted small">${lastUsed}</td>
        <td class="actions">
          <button data-key-edit="${k.id}" class="ghost">Edit</button>
          <button data-key-reroll="${k.id}" class="ghost">Reroll</button>
          <button data-key-del="${k.id}" class="danger">Delete</button>
        </td>`;
      body.appendChild(tr);

      const card = document.createElement("article");
      card.className = "mobile-card key-mobile-card";
      card.innerHTML = `
        <div class="mobile-card-head">
          <div class="mobile-card-title-wrap">
            <div class="mobile-title">${escapeHtml(k.name)}</div>
            ${notes ? `<div class="mobile-subtitle">${notes}</div>` : ""}
          </div>
          ${status}
        </div>
        <div class="mobile-fields">
          <div class="mobile-field mobile-field-wide"><span>Key</span><strong><code>${escapeHtml(k.tokenPreview)}</code></strong></div>
          <div class="mobile-field"><span>Enabled</span><label class="mobile-check"><input type="checkbox" data-key-toggle="${k.id}" ${k.enabled ? "checked" : ""} /> ${k.enabled ? "On" : "Off"}</label></div>
          <div class="mobile-field"><span>Providers</span><strong>${providers}</strong></div>
          <div class="mobile-field"><span>Limits</span><strong>${limits}</strong></div>
          <div class="mobile-field"><span>Last used</span><strong>${lastUsed}</strong></div>
        </div>
        <div class="mobile-actions actions">
          <button data-key-edit="${k.id}" class="ghost">Edit</button>
          <button data-key-reroll="${k.id}" class="ghost">Reroll</button>
          <button data-key-del="${k.id}" class="danger">Delete</button>
        </div>`;
      cards.appendChild(card);
    }

    bindKeyActions(body);
    bindKeyActions(cards);

    function bindKeyActions(root) {
      root.querySelectorAll("[data-key-toggle]").forEach((el) => {
        el.onchange = async () => {
          await api(`/admin/api/api-keys/${el.dataset.keyToggle}`, {
            method: "PATCH",
            body: JSON.stringify({ enabled: el.checked }),
          });
          await refreshKeys();
        };
      });
      root.querySelectorAll("[data-key-edit]").forEach((el) => {
        el.onclick = () => openKeyDialog(keysCache.find((x) => x.id === el.dataset.keyEdit));
      });
      root.querySelectorAll("[data-key-reroll]").forEach((el) => {
        el.onclick = () => {
          const key = keysCache.find((x) => x.id === el.dataset.keyReroll);
          pendingRerollKeyId = el.dataset.keyReroll;
          $("reroll-key-name").textContent = key?.name || "this key";
          $("reroll-key-msg").textContent = "";
          $("reroll-key-dialog").showModal();
        };
      });
      root.querySelectorAll("[data-key-del]").forEach((el) => {
        el.onclick = async () => {
          if (!confirm("Delete this API key?")) return;
          await api(`/admin/api/api-keys/${el.dataset.keyDel}`, { method: "DELETE" });
          await refreshKeys();
        };
      });
    }
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
  $("dismiss-new-key-dialog").onclick = () => $("new-key-dialog").close();
  $("cancel-reroll-key").onclick = () => $("reroll-key-dialog").close();
  $("confirm-reroll-key").onclick = async () => {
    if (!pendingRerollKeyId) return;
    try {
      $("reroll-key-msg").textContent = "Rerolling…";
      const r = await api(`/admin/api/api-keys/${pendingRerollKeyId}/reroll`, { method: "POST", body: "{}" });
      pendingRerollKeyId = "";
      $("reroll-key-dialog").close();
      showNewKey(r.token);
      await refreshKeys();
    } catch (error) {
      $("reroll-key-msg").textContent = `Fail: ${error.message}`;
    }
  };
  $("copy-key-btn").onclick = async () => {
    const tokenEl = $("new-key-token");
    const key = currentNewKeyToken || tokenEl.textContent;
    try {
      await copyText(key, $("copy-key-buffer"));
      showToast("Copied API key", "success");
    } catch (error) {
      showToast(`Could not copy API key: ${error.message}`, "error");
    }
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

  function statsFilterParams() {
    const params = new URLSearchParams();
    const fields = [
      ["from", $("stats-from").value],
      ["to", $("stats-to").value],
      ["apiKeyId", $("stats-api-key").value],
      ["provider", $("stats-provider").value],
      ["ipOrApp", $("stats-ip-app").value.trim()],
      ["status", $("stats-status").value],
      ["query", $("stats-query").value.trim()],
    ];
    for (const [key, value] of fields) {
      if (value && value !== "all") params.set(key, value);
    }
    return params.toString();
  }

  async function refreshStats() {
    const s = await api(`/admin/api/stats?${statsFilterParams()}`);
    renderStats(s);
  }

  function openEventDetail(e) {
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
  }

  function formatIpApp(e) {
    const ip = e.ip || "";
    const userAgent = e.userAgent || "";
    if (ip && userAgent) return `${ip} · ${userAgent}`;
    return ip || userAgent || "";
  }

  function formatApiKeyLabel(e) {
    const name = e.apiKeyName || "";
    const preview = e.apiKeyPreview || "";
    if (name && preview) return `${name} (${preview})`;
    return name || preview || "";
  }

  function fillStatsFilters(options = {}) {
    statsFilterOptions = options;
    const apiKeySelect = $("stats-api-key");
    const providerSelect = $("stats-provider");
    const selectedKey = apiKeySelect.value;
    const selectedProvider = providerSelect.value;

    apiKeySelect.innerHTML = '<option value="">Any key</option>';
    for (const key of options.apiKeys || []) {
      const opt = document.createElement("option");
      opt.value = key.id;
      opt.textContent = key.tokenPreview ? `${key.name} (${key.tokenPreview})` : key.name;
      apiKeySelect.appendChild(opt);
    }
    apiKeySelect.value = selectedKey;

    providerSelect.innerHTML = '<option value="">Any provider</option>';
    for (const provider of options.providers || []) {
      const opt = document.createElement("option");
      opt.value = provider;
      opt.textContent = provider;
      providerSelect.appendChild(opt);
    }
    providerSelect.value = selectedProvider;
  }

  function clearStatsFilters() {
    for (const id of ["stats-from", "stats-to", "stats-api-key", "stats-provider", "stats-ip-app", "stats-query"]) {
      $(id).value = "";
    }
    $("stats-status").value = "all";
  }

  for (const id of ["stats-from", "stats-to", "stats-api-key", "stats-provider", "stats-status"]) {
    $(id).addEventListener("change", refreshStats);
  }
  for (const id of ["stats-ip-app", "stats-query"]) {
    $(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter") refreshStats();
    });
  }
  $("refresh-stats").onclick = refreshStats;
  $("clear-stats-filters").onclick = async () => {
    clearStatsFilters();
    await refreshStats();
  };

  function renderStats(s) {
    fillStatsFilters(s.filterOptions || statsFilterOptions);
    $("stats-summary").innerHTML = `
      <div class="stat"><div class="n">${s.today?.ok || 0}</div><div class="l">Succeeded</div></div>
      <div class="stat"><div class="n">${s.today?.fail || 0}</div><div class="l">Failed</div></div>
      <div class="stat"><div class="n">${s.accounts?.length || 0}</div><div class="l">Accounts</div></div>`;
    const body = $("stats-body");
    const cards = $("stats-cards");
    body.innerHTML = "";
    cards.innerHTML = "";
    for (const e of s.recent || []) {
      const ok = e.ok ? `<span class="pill ok">✓</span>` : `<span class="pill bad">✗</span>`;
      const createdAt = escapeHtml(e.createdAt || "");
      const ipApp = escapeHtml(formatIpApp(e));
      const apiKey = escapeHtml(formatApiKeyLabel(e));
      const query = escapeHtml(e.query || "");
      const provider = escapeHtml(e.provider || "");
      const resultCount = e.resultCount ?? "";
      const latency = e.latencyMs ?? "";
      const error = escapeHtml(e.error || "");

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="muted small">${createdAt}</td>
        <td class="muted small">${ipApp || "—"}</td>
        <td class="muted small">${apiKey || "—"}</td>
        <td><strong>${query}</strong></td>
        <td>${provider}</td>
        <td>${ok}</td>
        <td>${resultCount}</td>
        <td class="muted">${latency}</td>
        <td class="muted small error">${error}</td>
        <td><button class="ghost small inspect-btn">View</button></td>`;
      tr.querySelector(".inspect-btn").onclick = () => openEventDetail(e);
      body.appendChild(tr);

      const card = document.createElement("article");
      card.className = "mobile-card event-mobile-card";
      card.innerHTML = `
        <div class="mobile-card-head">
          <div class="mobile-card-title-wrap">
            <div class="mobile-title">${query || "No query"}</div>
            <div class="mobile-subtitle">${createdAt || "unknown time"}</div>
          </div>
          ${ok}
        </div>
        <div class="mobile-fields">
          <div class="mobile-field"><span>Provider</span><strong>${provider || "—"}</strong></div>
          <div class="mobile-field"><span>API key</span><strong>${apiKey || "unknown"}</strong></div>
          <div class="mobile-field"><span>Results</span><strong>${resultCount}</strong></div>
          <div class="mobile-field"><span>Latency</span><strong>${latency}${latency === "" ? "" : "ms"}</strong></div>
          <div class="mobile-field"><span>IP / App</span><strong>${ipApp || "unknown"}</strong></div>
          ${error ? `<div class="mobile-field mobile-field-wide error"><span>Error</span><strong>${error}</strong></div>` : ""}
        </div>
        <div class="mobile-actions actions">
          <button class="ghost" data-event-view>View details</button>
        </div>`;
      card.querySelector("[data-event-view]").onclick = () => openEventDetail(e);
      cards.appendChild(card);
    }
  }

  $("close-event-dialog").onclick = () => $("event-dialog").close();

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
