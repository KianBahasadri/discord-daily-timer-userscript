#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_CDP_HTTP = 'http://127.0.0.1:9222';
const DEFAULT_SCRIPT_FILE = 'discord-server-title-daily-timer.user.js';

function parseArgs(argv) {
  const args = {
    file: DEFAULT_SCRIPT_FILE,
    cdpHttp: DEFAULT_CDP_HTTP,
    target: ''
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') {
      args.file = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--cdp-http') {
      args.cdpHttp = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--target') {
      args.target = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.file) throw new Error('Missing --file value');
  if (!args.cdpHttp) throw new Error('Missing --cdp-http value');
  return args;
}

function printHelp() {
  console.log('Sync local userscript into Tampermonkey editor via Chrome DevTools Protocol.');
  console.log('');
  console.log('Usage:');
  console.log('  node tm-devtools-sync.mjs [--file <path>] [--cdp-http <url>] [--target <match>]');
  console.log('');
  console.log('Options:');
  console.log(`  -f, --file       Local script path (default: ${DEFAULT_SCRIPT_FILE})`);
  console.log(`      --cdp-http   CDP HTTP endpoint (default: ${DEFAULT_CDP_HTTP})`);
  console.log('      --target     Extra URL/title match to pick a specific Tampermonkey tab');
  console.log('  -h, --help       Show this help');
  console.log('');
  console.log('Before running:');
  console.log('  1) Start Chrome with --remote-debugging-port=9222');
  console.log('  2) Open Tampermonkey script editor tab for your script');
}

class CDPSocket {
  constructor(webSocketUrl) {
    this.ws = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (event) => {
        cleanup();
        reject(new Error(`Failed to open CDP socket: ${event?.message || 'unknown error'}`));
      };
      const cleanup = () => {
        this.ws.removeEventListener('open', onOpen);
        this.ws.removeEventListener('error', onError);
      };
      this.ws.addEventListener('open', onOpen, { once: true });
      this.ws.addEventListener('error', onError, { once: true });
    });

    this.ws.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data));
      if (typeof payload.id === 'number' && this.pending.has(payload.id)) {
        const { resolve, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) {
          reject(new Error(payload.error.message || 'Unknown CDP error'));
        } else {
          resolve(payload.result || {});
        }
      }
    });

    this.ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error('CDP socket closed'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

async function jsonGet(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  return response.json();
}

function pickTarget(targets, extraMatch) {
  const match = extraMatch.trim().toLowerCase();
  const scored = [];

  for (const t of targets) {
    if (t.type !== 'page' || !t.webSocketDebuggerUrl) continue;
    const url = (t.url || '').toLowerCase();
    const title = (t.title || '').toLowerCase();

    let score = 0;
    if (url.includes('chrome-extension://')) score += 2;
    if (url.includes('tampermonkey') || title.includes('tampermonkey')) score += 2;
    if (url.includes('dhdgffkkebhmkfjojejmpbldmpobfkfo')) score += 4;
    if (url.includes('editor')) score += 6;
    if (title.includes('editor')) score += 2;
    if (match && (url.includes(match) || title.includes(match))) score += 20;

    if (score > 0) scored.push({ target: t, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].target : null;
}

function buildInjectExpression(base64Script) {
  const encoded = JSON.stringify(base64Script);
  return `(() => {
    const nextCode = atob(${encoded});

    function setMonacoValue(code) {
      if (!window.monaco || !window.monaco.editor) return false;
      const models = window.monaco.editor.getModels();
      if (!Array.isArray(models) || models.length === 0) return false;
      let target = models[0];
      let largestLen = typeof target.getValue === 'function' ? target.getValue().length : 0;
      for (const model of models) {
        if (!model || typeof model.getValue !== 'function') continue;
        const len = model.getValue().length;
        if (len > largestLen) {
          largestLen = len;
          target = model;
        }
      }
      if (!target || typeof target.setValue !== 'function') return false;
      target.setValue(code);
      return true;
    }

    function setCodeMirrorValue(code) {
      const hosts = Array.from(document.querySelectorAll('.CodeMirror'));
      if (!hosts.length) return false;

      let target = null;
      let largestLen = -1;

      for (const host of hosts) {
        const cm = host && host.CodeMirror;
        if (!cm || typeof cm.getValue !== 'function' || typeof cm.setValue !== 'function') continue;
        let isReadOnly = false;
        if (typeof cm.getOption === 'function') {
          try {
            isReadOnly = Boolean(cm.getOption('readOnly'));
          } catch (_) {
            isReadOnly = false;
          }
        }
        if (isReadOnly) continue;
        const len = cm.getValue().length;
        if (len > largestLen) {
          largestLen = len;
          target = cm;
        }
      }

      if (!target) return false;
      target.setValue(code);
      return true;
    }

    function setTextareaValue(code) {
      const textareas = Array.from(document.querySelectorAll('textarea'));
      if (textareas.length !== 1) return false;
      const textarea = textareas[0];
      if (!(textarea instanceof HTMLTextAreaElement)) return false;
      if (textarea.readOnly || textarea.disabled) return false;
      if (textarea.offsetParent === null) return false;
      textarea.value = code;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    function triggerSave() {
      const selectors = [
        '#input_c2F2ZV9idXR0b25fMmZlZDUzOTctNDg4NC00N2NhLWEzMmItYzExNjE5NmFkZjY0_bu',
        '#input_c2F2ZV91cGRhdGVfYnV0dG9uXzJmZWQ1Mzk3LTQ4ODQtNDdjYS1hMzJiLWMxMTYxOTZhZGY2NA_bu',
        '[title*="Save"]',
        '[aria-label*="Save"]',
        '.save',
        '#save',
        '.script-save'
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el instanceof HTMLElement) {
          el.click();
          return 'button';
        }
      }

      const keyEventInit = {
        key: 's',
        code: 'KeyS',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      };
      document.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's',
        code: 'KeyS',
        metaKey: true,
        bubbles: true,
        cancelable: true
      }));

      return 'keyboard';
    }

    const updated = setMonacoValue(nextCode) || setCodeMirrorValue(nextCode) || setTextareaValue(nextCode);
    const saveMethod = updated ? triggerSave() : 'none';

    return {
      ok: updated,
      saveMethod,
      title: document.title,
      url: location.href
    };
  })()`;
}

async function runtimeEval(client, expression) {
  return client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const absFile = path.resolve(process.cwd(), args.file);
  const source = await readFile(absFile, 'utf8');

  const targets = await jsonGet(`${args.cdpHttp.replace(/\/$/, '')}/json/list`);
  const target = pickTarget(targets, args.target);
  if (!target) {
    throw new Error('Could not find a Tampermonkey editor tab. Open the Tampermonkey editor and try again.');
  }

  const client = new CDPSocket(target.webSocketDebuggerUrl);
  await client.open();

  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Target.activateTarget', { targetId: target.id });

    const checkReady = await runtimeEval(client, 'document.readyState');
    if (checkReady?.result?.value === 'loading') {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const payload = Buffer.from(source, 'utf8').toString('base64');
    const expression = buildInjectExpression(payload);
    const result = await runtimeEval(client, expression);
    const value = result?.result?.value || {};

    if (!value.ok) {
      throw new Error('Could not find a supported editor in the selected tab (Monaco/CodeMirror/textarea).');
    }

    console.log(`Updated and saved Tampermonkey script from ${args.file}`);
    console.log(`Target tab: ${value.title || target.title}`);
    console.log(`Target URL: ${value.url || target.url}`);
    console.log(`Save strategy: ${value.saveMethod}`);
  } finally {
    client.close();
  }
}

run().catch((error) => {
  console.error(`tm-devtools-sync failed: ${error.message}`);
  process.exit(1);
});
