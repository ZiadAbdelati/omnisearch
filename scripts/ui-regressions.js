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
