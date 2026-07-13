const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const appJs = fs.readFileSync('public/app.js', 'utf8');

function getElementHtml(id) {
  const marker = `id="${id}"`;
  const index = html.indexOf(marker);
  assert.notEqual(index, -1, `#${id} is missing`);
  const tagStart = html.lastIndexOf('<', index);
  const tagEnd = html.indexOf('>', index);
  return html.slice(tagStart, tagEnd + 1);
}

function makeClassList(element) {
  return {
    add(...names) {
      for (const name of names) element.classes.add(name);
      element.hidden = element.classes.has('hidden');
    },
    remove(...names) {
      for (const name of names) element.classes.delete(name);
      element.hidden = element.classes.has('hidden');
    },
    contains(name) {
      return element.classes.has(name);
    },
  };
}

function makeElement(id) {
  const element = {
    id,
    value: '',
    textContent: '',
    hidden: false,
    classes: new Set(),
    style: {},
    dataset: {},
    children: [],
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    remove() { this.removed = true; },
    setAttribute(name, value) { this[name] = value; },
    select() { this.selected = true; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    focus() { this.focused = true; },
    close() { this.open = false; },
    showModal() { this.open = true; },
    addEventListener(type, handler) { this[`on${type}`] = handler; },
    querySelectorAll() { return []; },
  };
  element.classList = makeClassList(element);
  return element;
}

function createHarness() {
  const ids = [
    'login-view', 'app', 'login-error', 'toast-container', 'acc-provider', 'provider-hint', 'secret-label',
    'login-btn', 'login-token', 'logout-btn', 'health-line', 'tab-accounts', 'accounts-body',
    'search-gateway-token', 'run-search-btn', 'search-out', 'search-q', 'search-limit', 'search-mode',
    'keys-body', 'new-key-token', 'copy-key-buffer', 'new-key-dialog', 'copy-key-btn', 'dismiss-new-key-dialog',
    'add-key-btn', 'cancel-key-dialog', 'key-form', 'key-dialog', 'key-dialog-title', 'key-id', 'key-name',
    'key-providers', 'key-rpm', 'key-daily', 'key-monthly', 'key-max-results', 'key-notes', 'key-enabled',
    'key-dialog-msg', 'event-dialog', 'event-detail', 'dismiss-event-dialog', 'stats-summary', 'events-body',
    'refresh-stats', 'set-default-mode', 'set-default-limit', 'set-max-limit', 'save-settings', 'settings-msg',
    'test-account-btn', 'dialog-msg', 'acc-id', 'account-form', 'account-dialog', 'add-account-btn',
    'cancel-dialog', 'dialog-title', 'acc-name', 'acc-provider', 'acc-secret', 'acc-base-url', 'acc-priority',
    'acc-weight', 'acc-monthly', 'acc-daily', 'acc-rpm', 'acc-enabled', 'acc-modes', 'format-select',
    'reroll-key-dialog', 'cancel-reroll-key', 'confirm-reroll-key', 'reroll-key-msg'
  ];
  const elements = new Map(ids.map((id) => [id, makeElement(id)]));
  elements.get('search-out').classes.add('code-block');
  elements.get('search-out').hidden = false;
  elements.get('app').classes.add('hidden');
  elements.get('login-view').classes.add('hidden');
  elements.get('search-limit').value = '5';
  elements.get('search-mode').value = 'auto';

  const document = {
    body: makeElement('body'),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    createElement(tag) {
      const el = makeElement(tag);
      el.tagName = tag.toUpperCase();
      return el;
    },
    querySelectorAll() { return []; },
    execCommand(command) {
      document.lastExecCommand = command;
      return true;
    },
  };

  const context = {
    document,
    window: { isSecureContext: false },
    navigator: {},
    sessionStorage: { getItem: () => '', setItem() {}, removeItem() {} },
    localStorage: { getItem: () => '', setItem() {} },
    fetch: async () => ({ ok: true, text: async () => '{"ok":true,"results":[{"title":"result"}]}' }),
    setTimeout() {},
    confirm() { throw new Error('window.confirm should not be used'); },
  };
  context.globalThis = context;
  vm.runInNewContext(appJs, context, { filename: 'public/app.js' });
  return { context, elements, document };
}

function click(element) {
  assert.equal(typeof element.onclick, 'function', `${element.id} needs click handler`);
  return element.onclick({ preventDefault() {} });
}

(async () => {
  const searchOutTag = getElementHtml('search-out');
  assert.match(searchOutTag, /\bhidden\b/, 'test search output must be hidden before a search runs');

  assert.match(html, /id="reroll-key-dialog"/, 'reroll confirmation must use an in-page dialog');
  assert.doesNotMatch(appJs, /confirm\("Reroll this key\?/, 'reroll must not use browser confirm()');

  const keyTokenTag = getElementHtml('new-key-token');
  assert.doesNotMatch(keyTokenTag, /^<textarea\b/i, 'copy modal token must not be a textarea');
  assert.match(appJs, /currentNewKeyToken \|\| tokenEl\.textContent/, 'copy handler must copy the stored/rendered token text');
  assert.doesNotMatch(appJs, /copyText\(key, tokenEl\)/, 'copy fallback must not select the visible token box');
  assert.match(html, /id="new-key-token" class="key-secret-token"><\/code>/, 'copy modal token should render as styled text');
  assert.match(html, /id="copy-key-buffer"/, 'copy modal must include an in-dialog hidden copy buffer');
  assert.match(appJs, /copyText\(key, \$\("copy-key-buffer"\)\)/, 'copy fallback must select the in-dialog copy buffer');
  assert.ok(appJs.indexOf('if (fallbackTarget)') < appJs.indexOf('navigator.clipboard'), 'copy handler must try the in-dialog fallback before navigator.clipboard');
  assert.match(html, /id="confirm-reroll-key" class="danger-solid"/, 'reroll confirm button should use solid danger styling');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /\.danger-solid[\s\S]*background:\s*var\(--bad\)/, 'solid danger button should have red fill');
  assert.match(html, /id="reroll-key-name"/, 'reroll confirmation must include the key name');
  assert.match(appJs, /reroll-key-name"\)\.textContent\s*=\s*key\?\.name/, 'reroll handler must show the selected key name');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /--modal-inline-size:\s*32\.5rem/, 'compact modal width should be a named design token');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /\.key-flow-modal[\s\S]*inline-size:\s*min\(var\(--modal-inline-size\), calc\(100vw - 24px\)\)/, 'key flow modal containers should use logical compact sizing');
  assert.match(html, /<dialog id="reroll-key-dialog" class="key-flow-modal">/, 'reroll modal should use shared key-flow modal sizing');
  assert.match(html, /<dialog id="new-key-dialog" class="key-flow-modal">/, 'copy modal should use shared key-flow modal sizing');
  assert.match(html, /class="card dialog-card key-flow-dialog reroll-key-card"/, 'reroll modal should use shared key-flow card styling');
  assert.match(html, /class="card dialog-card key-flow-dialog key-secret-dialog"/, 'copy modal should use shared key-flow card styling');
  assert.match(html, /id="cancel-reroll-key" class="modal-secondary"/, 'reroll cancel should use shared secondary modal button styling');
  assert.match(html, /id="dismiss-new-key-dialog" class="modal-secondary"/, 'copy done should use shared secondary modal button styling');
  assert.doesNotMatch(fs.readFileSync('public/styles.css', 'utf8'), /\.key-flow-actions button[\s\S]*min-width/, 'key flow primary and danger buttons should keep their normal button sizing');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /\.key-flow-actions[\s\S]*display:\s*grid[\s\S]*grid-auto-columns:\s*1fr/, 'key flow actions should use equal grid columns so only shorter secondary buttons grow to match their partner');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /\.key-flow-actions \.modal-secondary[\s\S]*font-weight:\s*600/, 'key flow secondary buttons should match the action button text weight');
  assert.match(html, /<title>OmniSearch<\/title>/, 'browser title should use the OmniSearch app name');
  assert.match(html, /<h1>OmniSearch<\/h1>/, 'login card should use the OmniSearch app name');
  assert.match(html, /<strong>OmniSearch<\/strong>/, 'topbar brand should use the OmniSearch app name');
  assert.doesNotMatch(html, /Omnisearch/, 'old casing should not remain in visible HTML');
  assert.doesNotMatch(html, /Search Gateway/, 'old product name should not remain in visible HTML');
  assert.match(html, /src="\/omnisearch-logo\.jpg"/, 'topbar should use the generated OmniSearch logo asset');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /--display-font:/, 'login title should use a dedicated display font token');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /\.login-card h1\s*\{[\s\S]*font-family:\s*var\(--display-font\)/, 'login title should use the display face');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /box-shadow:\s*0 0 10px rgba\(91,157,255,\.14\)/, 'logo glow should be softened');
  assert.match(html, /id="stats-filters"/, 'usage page should expose filter controls');
  for (const id of ['stats-from', 'stats-to', 'stats-api-key', 'stats-provider', 'stats-ip-app', 'stats-status', 'stats-query', 'clear-stats-filters']) {
    assert.match(html, new RegExp(`id="${id}"`), `usage filter control ${id} is missing`);
  }
  assert.match(appJs, /function statsFilterParams\(\)/, 'usage page should build stats filter query params');
  assert.match(appJs, /api\(`\/admin\/api\/stats\?\$\{statsFilterParams\(\)\}`\)/, 'usage refresh should send filters to admin stats endpoint');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /\.login-wrap\s*\{[\s\S]*min-block-size:\s*100dvh/, 'login card should be centered against the viewport');
  assert.doesNotMatch(appJs, /providers:\s*\$\{data\.providers\.join/, 'topbar must not render the provider list string');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*\.topbar\s*\{[\s\S]*flex-wrap:\s*nowrap/, 'mobile topbar should keep logo, title, and menu inline');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*\.mobile-menu-btn\s*\{[\s\S]*margin-left:\s*auto/, 'mobile menu button should be justified right');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1" \/>/, 'mobile browsers must render at device width');
  assert.match(html, /<meta name="theme-color" content="#0b0f14" \/>/, 'mobile browser chrome should receive the dark app color');
  assert.match(html, /<meta name="color-scheme" content="dark" \/>/, 'browser controls should prefer dark color scheme');
  assert.match(html, /id="mobile-menu-btn"/, 'mobile navigation should have a menu button');
  assert.match(html, /id="mobile-nav-backdrop"/, 'mobile navigation should have a drawer backdrop');
  assert.match(appJs, /function closeMobileNav\(\)/, 'mobile drawer should have a close path');
  assert.match(appJs, /mobile-menu-open/, 'mobile drawer should toggle a body state');
  assert.match(appJs, /\$\("logout-btn"\)\.onclick = \(\) => \{[\s\S]*closeMobileNav\(\)[\s\S]*showLogin\(\)/, 'logout should close the mobile drawer before returning to login');
  assert.doesNotMatch(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*\.tabs[\s\S]*overflow-x:\s*auto/, 'mobile navigation must not be horizontally scrollable');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*\.tabs[\s\S]*position:\s*fixed/, 'mobile navigation should be a fixed slide-out drawer');
  assert.doesNotMatch(fs.readFileSync('public/styles.css', 'utf8'), /\.tabs\s*\{[^}]*transform:\s*translateX\(100%\)/, 'closed mobile drawer must not expand page width off-canvas');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*\.tabs\s*\{[\s\S]*block-size:\s*100dvh/, 'mobile drawer should span the viewport so logout is not covered by the backdrop');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /clip-path:\s*inset\(0 0 0 100%\)/, 'closed mobile drawer should be clipped inside the viewport');
  assert.doesNotMatch(fs.readFileSync('public/styles.css', 'utf8'), /radial-gradient\(/, 'app pages should not have a broad page-level glow behind short forms');
  assert.match(html, /href="\/styles\.css\?v=27"/, 'HTML should bust cached mobile CSS after corrected login flex alignment changes');
  assert.match(html, /src="\/app\.js\?v=25"/, 'HTML should bust cached app JS after usage key label changes');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*#account-dialog\[open\][\s\S]*overflow-x:\s*hidden/, 'account dialog must not create horizontal scrolling on mobile');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*\.filter-grid > label\s*\{[\s\S]*min-width:\s*0/, 'usage filter labels must be allowed to shrink inside the mobile card');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*input, select, textarea\s*\{[\s\S]*max-width:\s*100%/, 'mobile form controls must stay contained by their cards');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /--control-block-size:\s*40px/, 'form controls should share one explicit height token');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /input, select, textarea\s*\{[\s\S]*block-size:\s*var\(--control-block-size\)/, 'all form controls should use the shared fixed control height');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /\.login-card\s*\{[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/, 'login card should be a column flex container so button alignment applies');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /#login-btn\s*\{[\s\S]*align-self:\s*flex-end/, 'login Enter button should align to the right edge of the form');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*#stats-from,\s*#stats-to\s*\{[\s\S]*appearance:\s*none[\s\S]*inline-size:\s*100%[\s\S]*min-inline-size:\s*0/, 'mobile date filters should keep the constrained box model without a one-off height');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*\.panel-head > button\s*\{[\s\S]*flex:\s*0 0 auto[\s\S]*width:\s*auto/, 'mobile panel header actions should keep intrinsic width');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /#tab-search > \.form-grid,\s*#tab-settings > \.form-grid\s*\{[\s\S]*background:\s*rgba\(18,24,33,\.85\)[\s\S]*box-shadow:\s*none/, 'test search and settings forms should use the flat panel surface');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*\.event-mobile-card \.mobile-fields\s*\{[\s\S]*grid-template-columns:\s*1fr/, 'usage event mobile cards should give event text fields the full card width');
  assert.doesNotMatch(html, /Managed API key \(for \/v1\/search\)/, 'admin test search UI must not ask for a managed API key');
  assert.match(appJs, /api\("\/admin\/api\/search-test"/, 'test search should use an admin-authenticated endpoint');
  assert.doesNotMatch(appJs, /fetch\("\/v1\/search"/, 'admin UI test search must not call the public managed-key endpoint directly');
  assert.match(html, /id="accounts-cards" class="mobile-list"/, 'accounts must have a mobile card list');
  assert.match(html, /id="keys-cards" class="mobile-list"/, 'API keys must have a mobile card list');
  assert.match(html, /id="stats-cards" class="mobile-list"/, 'usage events must have a mobile card list');
  assert.match(appJs, /\$\("accounts-cards"\)/, 'accounts renderer must populate mobile cards');
  assert.match(appJs, /\$\("keys-cards"\)/, 'keys renderer must populate mobile cards');
  assert.match(appJs, /\$\("stats-cards"\)/, 'stats renderer must populate mobile cards');
  assert.match(appJs, /function openEventDetail\(e\)/, 'usage mobile cards must share the event detail action');
  assert.match(appJs, /function formatIpApp\(e\)/, 'usage events should share IP/App display formatting');
  assert.match(appJs, /formatIpApp\(e\)/, 'usage stats renderer should include both IP and user-agent when available');
  assert.match(appJs, /function formatApiKeyLabel\(e\)/, 'usage events should share API-key label formatting');
  assert.match(appJs, /formatApiKeyLabel\(e\)/, 'usage stats rows should include key preview when present');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /\.mobile-list\s*\{\s*display:\s*none/, 'mobile card lists should be hidden on desktop');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*#tab-accounts \.table-wrap[\s\S]*display:\s*none/, 'account table must be hidden on mobile');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*#tab-keys \.table-wrap[\s\S]*display:\s*none/, 'key table must be hidden on mobile');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*#tab-stats \.table-wrap[\s\S]*display:\s*none/, 'usage event table must be hidden on mobile');
  assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@media \(max-width:\s*720px\)[\s\S]*\.mobile-list[\s\S]*display:\s*grid/, 'mobile card lists must render on mobile');

  const { elements, document } = createHarness();
  elements.get('new-key-token').textContent = 'sgk_actual_secret';
  await click(elements.get('copy-key-btn'));
  assert.equal(elements.get('copy-key-buffer').value, 'sgk_actual_secret', 'copy buffer must receive the API key token');
  assert.equal(elements.get('copy-key-buffer').selected, true, 'copy fallback must select the in-dialog copy buffer');
  assert.equal(elements.get('copy-key-buffer').selectionStart, 0, 'copy buffer selection should start at beginning of token');
  assert.equal(elements.get('copy-key-buffer').selectionEnd, 'sgk_actual_secret'.length, 'copy buffer selection should cover the full token');
  assert.equal(document.body.children.length, 0, 'copy fallback must not append selection targets outside the modal');

  console.log('ui regressions ok');
})();
