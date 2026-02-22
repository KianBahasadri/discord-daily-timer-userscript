// ==UserScript==
// @name         Discord Server Title + Daily Timer
// @version      1.7.0
// @description  Replace server title and show today's Discord time
// @match        https://discord.com/channels/*
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Config
  const FOCUSED_STORAGE_PREFIX = 'tm_discord_daily_focused_ms_';
  const LEGACY_FOCUSED_STORAGE_PREFIX = 'tm_discord_daily_ms_';
  const OPEN_STORAGE_PREFIX = 'tm_discord_daily_open_ms_';
  const SWITCH_STORAGE_PREFIX = 'tm_discord_daily_switches_';

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function focusedStorageKey(dateKey) {
    return FOCUSED_STORAGE_PREFIX + dateKey;
  }

  function legacyFocusedStorageKey(dateKey) {
    return LEGACY_FOCUSED_STORAGE_PREFIX + dateKey;
  }

  function openStorageKey(dateKey) {
    return OPEN_STORAGE_PREFIX + dateKey;
  }

  function switchStorageKey(dateKey) {
    return SWITCH_STORAGE_PREFIX + dateKey;
  }

  function loadFocusedMs(dateKey) {
    let raw = localStorage.getItem(focusedStorageKey(dateKey));
    if (raw === null) {
      raw = localStorage.getItem(legacyFocusedStorageKey(dateKey));
    }
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function saveFocusedMs(dateKey, ms) {
    localStorage.setItem(focusedStorageKey(dateKey), String(Math.floor(ms)));
  }

  function loadOpenMs(dateKey) {
    const raw = localStorage.getItem(openStorageKey(dateKey));
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function saveOpenMs(dateKey, ms) {
    localStorage.setItem(openStorageKey(dateKey), String(Math.floor(ms)));
  }

  function loadSwitchCount(dateKey) {
    const raw = localStorage.getItem(switchStorageKey(dateKey));
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  function saveSwitchCount(dateKey, count) {
    localStorage.setItem(switchStorageKey(dateKey), String(Math.floor(count)));
  }

  function formatHMS(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function isActive() {
    return !document.hidden && document.hasFocus();
  }

  function findTitleEl() {
    const selectors = [
      // Most stable: guild icon + title sibling in the header button
      'div[role="button"] div[class*="guildIcon_"] + div[data-text-variant]',
      // Common quick-switcher title text node
      'div[role="button"][aria-label] div[data-text-variant][class*="lineClamp1"]',
      // Broad fallback
      'div[role="button"][aria-label] div[data-text-variant]'
    ];

    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.getClientRects().length === 0) continue;
        return node;
      }
    }

    return null;
  }

  let key = todayKey();
  let focusedMs = loadFocusedMs(key);
  let openMs = loadOpenMs(key);
  let switchCount = loadSwitchCount(key);
  let lastTick = Date.now();
  let wasActive = isActive();

  function tick() {
    const now = Date.now();

    // Reset on day rollover
    const k = todayKey();
    if (k !== key) {
      key = k;
      focusedMs = loadFocusedMs(key);
      openMs = loadOpenMs(key);
      switchCount = loadSwitchCount(key);
      lastTick = now;
      wasActive = isActive();
    }

    const active = isActive();
    if (active && !wasActive) {
      switchCount += 1;
      saveSwitchCount(key, switchCount);
    }
    wasActive = active;

    const delta = now - lastTick;
    lastTick = now;
    const safeDelta = Math.min(delta, 5000);

    // Count while tab is open (focused or background)
    openMs += safeDelta;
    saveOpenMs(key, openMs);

    // Count only while focused/active
    if (active) {
      focusedMs += safeDelta;
      saveFocusedMs(key, focusedMs);
    }

    render();
  }

  function render() {
    const titleEl = findTitleEl();
    if (!titleEl) return;
    titleEl.style.fontSize = '16px';
    titleEl.style.fontVariantNumeric = 'tabular-nums';
    titleEl.style.fontFeatureSettings = '"tnum" 1';
    const gap = '\u00A0\u00A0\u00A0\u00A0\u00A0';
    const nextText = `${formatHMS(openMs)} open${gap}|${gap}${formatHMS(focusedMs)} focus${gap}|${gap}${switchCount} switches`;
    if (titleEl.textContent !== nextText) {
      titleEl.textContent = nextText;
    }
  }

  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
  }

  function boot() {
    render();

    // Keep text through React rerenders
    const observer = new MutationObserver(() => scheduleRender());
    observer.observe(document.body, { childList: true, subtree: true });

    // Live timer
    setInterval(tick, 1000);

    // Repaint immediately on focus/visibility changes
    window.addEventListener('focus', () => { tick(); });
    window.addEventListener('blur', () => { tick(); });
    document.addEventListener('visibilitychange', () => { tick(); });

    // Route changes in Discord SPA
    window.addEventListener('popstate', () => render());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
