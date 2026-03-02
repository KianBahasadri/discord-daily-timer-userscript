#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_CDP_HTTP = 'http://127.0.0.1:9222';
const DEFAULT_SCRIPT_FILE = 'discord-server-title-daily-timer.user.js';
const CDP_CONNECT_TIMEOUT_MS = 7000;
const CDP_REQUEST_TIMEOUT_MS = 12000;

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

function extractUserscriptMeta(source) {
  const nameMatch = source.match(/^\/\/\s*@name\s+(.+)$/m);
  const versionMatch = source.match(/^\/\/\s*@version\s+(.+)$/m);
  return {
    name: (nameMatch?.[1] || '').trim(),
    version: (versionMatch?.[1] || '').trim()
  };
}

class CDPSocket {
  constructor(webSocketUrl) {
    this.ws = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out opening CDP socket'));
      }, CDP_CONNECT_TIMEOUT_MS);

      const onOpen = () => {
        clearTimeout(timeout);
        cleanup();
        resolve();
      };
      const onError = (event) => {
        clearTimeout(timeout);
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
      const timeout = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}`));
      }, CDP_REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
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

function pickTargets(targets, extraMatch, expectedName) {
  const match = extraMatch.trim().toLowerCase();
  const expected = (expectedName || '').trim().toLowerCase();
  const scored = [];

  for (const t of targets) {
    if (t.type !== 'page' || !t.webSocketDebuggerUrl) continue;
    const url = (t.url || '').toLowerCase();
    const title = (t.title || '').toLowerCase();
    const id = String(t.id || '').toLowerCase();

    let score = 0;
    if (url.includes('chrome-extension://')) score += 2;
    if (url.includes('tampermonkey') || title.includes('tampermonkey')) score += 2;
    if (url.includes('dhdgffkkebhmkfjojejmpbldmpobfkfo')) score += 4;
    if (url.includes('editor')) score += 6;
    if (title.includes('editor')) score += 2;
    if (expected && (url.includes(expected) || title.includes(expected))) score += 25;
    if (match && (url.includes(match) || title.includes(match) || id.includes(match))) score += 20;

    if (score > 0) scored.push({ target: t, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.target);
}

function buildProbeExpression(expectedName) {
  const expected = JSON.stringify(expectedName || '');
  return `(() => {
    const expectedName = ${expected};
    function escapeRegExp(value) {
      const meta = '\\^$*+?.()|{}[]';
      return String(value)
        .split('')
        .map((char) => (meta.includes(char) ? '\\\\' + char : char))
        .join('');
    }
    function scoreEditorContent(value) {
      if (typeof value !== 'string') return 0;
      let score = 0;
      if (value.includes('==UserScript==')) score += 25;
      if (value.includes('==/UserScript==')) score += 10;
      if (value.includes('@match')) score += 5;
      if (value.includes('@run-at')) score += 3;
      if (expectedName) {
        const rx = new RegExp('^\\\\/\\\\/\\\\s*@name\\\\s+' + escapeRegExp(expectedName) + '\\\\s*$', 'm');
        if (rx.test(value)) score += 60;
      }
      return score;
    }

    let bestScore = 0;

    if (window.monaco && window.monaco.editor) {
      const models = window.monaco.editor.getModels();
      for (const model of models) {
        if (!model || typeof model.getValue !== 'function') continue;
        bestScore = Math.max(bestScore, scoreEditorContent(model.getValue()));
      }
    }

    const codeMirrorHosts = Array.from(document.querySelectorAll('.CodeMirror'));
    let visibleCodeMirrorWithApi = 0;
    let visibleCodeMirrorScriptEditors = 0;
    let maxVisibleCodeMirrorScore = 0;
    for (const host of codeMirrorHosts) {
      if (!(host instanceof HTMLElement)) continue;
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const cm = host.CodeMirror;
      if (!cm || typeof cm.getValue !== 'function') continue;
      visibleCodeMirrorWithApi += 1;
      const score = scoreEditorContent(cm.getValue());
      bestScore = Math.max(bestScore, score);
      maxVisibleCodeMirrorScore = Math.max(maxVisibleCodeMirrorScore, score);
      if (score >= 25) visibleCodeMirrorScriptEditors += 1;
    }

    const textareas = Array.from(document.querySelectorAll('textarea'));
    let visibleWritableTextareas = 0;
    let visibleScriptTextareas = 0;
    let maxVisibleTextareaScore = 0;
    for (const textarea of textareas) {
      if (!(textarea instanceof HTMLTextAreaElement)) continue;
      if (textarea.readOnly || textarea.disabled) continue;
      if (textarea.offsetParent === null) continue;
      visibleWritableTextareas += 1;
      const score = scoreEditorContent(textarea.value || '');
      bestScore = Math.max(bestScore, score);
      maxVisibleTextareaScore = Math.max(maxVisibleTextareaScore, score);
      if (score >= 25) visibleScriptTextareas += 1;
    }

    const monacoModels = window.monaco && window.monaco.editor ? window.monaco.editor.getModels().length : 0;
    const hasLikelyScriptEditor =
      (monacoModels > 0 && bestScore >= 25)
      || visibleCodeMirrorScriptEditors > 0
      || visibleScriptTextareas > 0;

    return {
      ok: hasLikelyScriptEditor,
      score: bestScore,
      monacoModels,
      visibleCodeMirrorWithApi,
      visibleCodeMirrorScriptEditors,
      maxVisibleCodeMirrorScore,
      visibleWritableTextareas,
      visibleScriptTextareas,
      maxVisibleTextareaScore,
      title: document.title,
      url: location.href
    };
  })()`;
}

function buildInjectExpression(base64Script, expectedName, expectedVersion) {
  const encoded = JSON.stringify(base64Script);
  const expected = JSON.stringify(expectedName || '');
  const expectedVersionLine = JSON.stringify(expectedVersion ? `@version      ${expectedVersion}` : '');
  return `(async () => {
    const nextCode = atob(${encoded});
    const expectedName = ${expected};
    const expectedVersionLine = ${expectedVersionLine};

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function escapeRegExp(value) {
      const meta = '\\^$*+?.()|{}[]';
      return String(value)
        .split('')
        .map((char) => (meta.includes(char) ? '\\\\' + char : char))
        .join('');
    }

    function scoreEditorContent(value) {
      if (typeof value !== 'string') return 0;
      let score = 0;
      if (value.includes('==UserScript==')) score += 25;
      if (value.includes('==/UserScript==')) score += 10;
      if (value.includes('@match')) score += 5;
      if (value.includes('@run-at')) score += 3;
      if (expectedName) {
        const rx = new RegExp('^\\\\/\\\\/\\\\s*@name\\\\s+' + escapeRegExp(expectedName) + '\\\\s*$', 'm');
        if (rx.test(value)) score += 60;
      }
      return score;
    }

    function normalizeCode(value) {
      return String(value).replace(/\\r\\n/g, '\\n').replace(/\\n+$/, '');
    }

    function codeMatches(actual, expected) {
      return normalizeCode(actual) === normalizeCode(expected);
    }

    function setMonacoValue(code) {
      if (!window.monaco || !window.monaco.editor) return false;
      const models = window.monaco.editor.getModels();
      if (!Array.isArray(models) || models.length === 0) return false;
      let target = null;
      let bestScore = -1;
      let largestLen = -1;
      for (const model of models) {
        if (!model || typeof model.getValue !== 'function') continue;
        if (typeof model.setValue !== 'function') continue;
        if (typeof model.isDisposed === 'function' && model.isDisposed()) continue;
        const value = model.getValue();
        const score = scoreEditorContent(value);
        const len = value.length;
        if (score > bestScore || (score === bestScore && len > largestLen)) {
          bestScore = score;
          target = model;
          largestLen = len;
        }
      }
      if (!target || typeof target.setValue !== 'function') return false;
      if (bestScore < 25) return false;
      target.setValue(code);
      if (typeof target.getValue !== 'function') return true;
      return codeMatches(target.getValue(), code);
    }

    function setCodeMirrorValue(code) {
      const hosts = Array.from(document.querySelectorAll('.CodeMirror'));
      if (!hosts.length) return false;

      let target = null;
      let bestScore = -1;
      let bestLen = -1;

      for (const host of hosts) {
        if (!(host instanceof HTMLElement)) continue;
        const rect = host.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
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
        const currentValue = cm.getValue();
        const score = scoreEditorContent(currentValue);
        const len = currentValue.length;
        if (score > bestScore || (score === bestScore && len > bestLen)) {
          bestScore = score;
          bestLen = len;
          target = cm;
        }
      }

      if (!target) return false;
      if (bestScore < 25) return false;
      target.setValue(code);
      if (typeof target.getValue !== 'function') return true;
      return codeMatches(target.getValue(), code);
    }

    function setTextareaValue(code) {
      if (window.monaco && window.monaco.editor && window.monaco.editor.getModels().length > 0) {
        return false;
      }
      if (document.querySelectorAll('.CodeMirror').length > 0) {
        return false;
      }

      const textareas = Array.from(document.querySelectorAll('textarea'));
      if (!textareas.length) return false;

      let textarea = null;
      let bestScore = -1;
      let bestLen = -1;

      for (const candidate of textareas) {
        if (!(candidate instanceof HTMLTextAreaElement)) continue;
        if (candidate.readOnly || candidate.disabled) continue;
        if (candidate.offsetParent === null) continue;
        const value = candidate.value || '';
        const score = scoreEditorContent(value);
        const len = value.length;
        if (score > bestScore || (score === bestScore && len > bestLen)) {
          bestScore = score;
          bestLen = len;
          textarea = candidate;
        }
      }

      if (!textarea) return false;
      if (bestScore < 25) return false;
      textarea.value = code;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return textarea.value === code;
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

      const clickables = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'));
      for (const el of clickables) {
        if (!(el instanceof HTMLElement)) continue;
        const label = [el.textContent, el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('value')]
          .filter(Boolean)
          .join(' ')
          .trim();
        if (!label) continue;
        if (/\bsave\b/i.test(label)) {
          el.click();
          return 'button-text';
        }
      }

      const keyEventInit = {
        key: 's',
        code: 'KeyS',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      };
      const active = document.activeElement;
      if (active) {
        active.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
        active.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));
      }
      document.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
      document.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));
      window.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
      window.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's',
        code: 'KeyS',
        metaKey: true,
        bubbles: true,
        cancelable: true
      }));

      document.dispatchEvent(new KeyboardEvent('keyup', {
        key: 's',
        code: 'KeyS',
        metaKey: true,
        bubbles: true,
        cancelable: true
      }));

      return 'keyboard';
    }

    let updated = false;
    for (let i = 0; i < 15; i += 1) {
      updated = setMonacoValue(nextCode) || setCodeMirrorValue(nextCode) || setTextareaValue(nextCode);
      if (updated) break;
      await sleep(150);
    }

    const saveMethod = updated ? triggerSave() : 'none';
    if (updated) {
      await sleep(300);
    }

    function editorContainsExpectedVersion() {
      if (!expectedVersionLine) return true;
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        for (const model of models) {
          if (!model || typeof model.getValue !== 'function') continue;
          if (model.getValue().includes(expectedVersionLine)) return true;
        }
      }
      const hosts = Array.from(document.querySelectorAll('.CodeMirror'));
      for (const host of hosts) {
        const cm = host && host.CodeMirror;
        if (!cm || typeof cm.getValue !== 'function') continue;
        if (cm.getValue().includes(expectedVersionLine)) return true;
      }
      const textareas = Array.from(document.querySelectorAll('textarea'));
      for (const textarea of textareas) {
        if (!(textarea instanceof HTMLTextAreaElement)) continue;
        if ((textarea.value || '').includes(expectedVersionLine)) return true;
      }
      return false;
    }

    const monacoModels = window.monaco && window.monaco.editor ? window.monaco.editor.getModels().length : 0;
    const codeMirrorHosts = document.querySelectorAll('.CodeMirror').length;
    const codeMirrorWithApi = Array.from(document.querySelectorAll('.CodeMirror')).filter((host) => host && host.CodeMirror && typeof host.CodeMirror.getValue === 'function').length;
    const textareas = document.querySelectorAll('textarea').length;

    return {
      ok: updated,
      saveMethod,
      title: document.title,
      url: location.href,
      diagnostics: {
        monacoModels,
        codeMirrorHosts,
        codeMirrorWithApi,
        textareas,
        expectedVersionFound: editorContainsExpectedVersion()
      }
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
  const meta = extractUserscriptMeta(source);

  const targets = await jsonGet(`${args.cdpHttp.replace(/\/$/, '')}/json/list`);
  const candidateTargets = pickTargets(targets, args.target, meta.name);
  if (!candidateTargets.length) {
    throw new Error('Could not find a Tampermonkey editor tab. Open the Tampermonkey editor and try again.');
  }

  let client = null;
  let target = null;
  const probeExpression = buildProbeExpression(meta.name);
  const probeSummaries = [];

  for (const candidate of candidateTargets) {
    const probeClient = new CDPSocket(candidate.webSocketDebuggerUrl);
    await probeClient.open();
    try {
      await probeClient.send('Page.enable');
      await probeClient.send('Runtime.enable');
      await probeClient.send('Target.activateTarget', { targetId: candidate.id });
      const probe = await runtimeEval(probeClient, probeExpression);
      probeSummaries.push({
        title: candidate.title,
        url: candidate.url,
        value: probe?.result?.value || null,
        exception: [probe?.exceptionDetails?.text, probe?.exceptionDetails?.exception?.description].filter(Boolean).join(' | ') || null
      });
      if (probe?.result?.value?.ok) {
        client = probeClient;
        target = candidate;
        break;
      }
    } finally {
      if (probeClient !== client) {
        probeClient.close();
      }
    }
  }

  if (!client || !target) {
    throw new Error(`Found Tampermonkey tabs, but none had a supported script editor loaded. Open the script editor tab and try again. Probe results: ${JSON.stringify(probeSummaries)}`);
  }

  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Target.activateTarget', { targetId: target.id });

    const checkReady = await runtimeEval(client, 'document.readyState');
    if (checkReady?.result?.value === 'loading') {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const payload = Buffer.from(source, 'utf8').toString('base64');
    const expression = buildInjectExpression(payload, meta.name, meta.version);
    const result = await runtimeEval(client, expression);
    const value = result?.result?.value || {};

    if (!value.ok) {
      const exceptionText = result?.exceptionDetails?.text || '';
      const exceptionDesc = result?.exceptionDetails?.exception?.description || result?.exceptionDetails?.exception?.value || '';
      const exception = [exceptionText, exceptionDesc].filter(Boolean).join(' | ');
      throw new Error(`Could not find a supported editor in the selected tab (Monaco/CodeMirror/textarea). Diagnostics: ${JSON.stringify(value.diagnostics || {})}${exception ? ` Exception: ${exception}` : ''}`);
    }
    if (meta.version && value?.diagnostics?.expectedVersionFound !== true) {
      throw new Error(`Sync completed but could not confirm @version ${meta.version} in editor content. Diagnostics: ${JSON.stringify(value.diagnostics || {})}`);
    }

    console.log(`Updated and saved Tampermonkey script from ${args.file}`);
    if (meta.name || meta.version) {
      console.log(`Script meta: ${meta.name || '(unknown name)'} ${meta.version ? `(v${meta.version})` : ''}`.trim());
    }
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
