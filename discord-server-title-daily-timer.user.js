// ==UserScript==
// @name         Discord Server Title + Daily Timer
// @version      1.11.0
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
  const SETTINGS_STORAGE_KEY = 'tm_discord_daily_settings_v1';
  const HISTORY_STORAGE_KEY = 'tm_discord_daily_history_v1';
  const DEFAULT_FONT_SIZE = 16;
  const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function dateKeyDaysAgo(daysAgo) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function parseDateKey(dateKey) {
    const [y, m, d] = dateKey.split('-').map((part) => Number(part));
    return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
  }

  function usageDayLabel(daysAgo, dateKey) {
    if (daysAgo === 0) return 'Today';
    if (daysAgo === 1) return 'Yesterday';
    const d = parseDateKey(dateKey);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function isDateKey(dateKey) {
    return /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
  }

  function isDarkSystemTheme() {
    return window.matchMedia(SYSTEM_THEME_QUERY).matches;
  }

  function applyThemeVariables(targetEl) {
    if (!(targetEl instanceof HTMLElement)) return;
    const dark = isDarkSystemTheme();
    const vars = dark
      ? {
          '--background-floating': '#2b2d31',
          '--background-secondary-alt': '#232428',
          '--background-tertiary': '#1e1f22',
          '--background-modifier-accent': 'rgba(255,255,255,0.12)',
          '--text-normal': '#f2f3f5',
          '--header-primary': '#f2f3f5',
          '--interactive-text-active': '#ffffff',
          '--interactive-normal': '#b5bac1',
          '--interactive-active': '#ffffff',
          '--text-muted': '#b5bac1',
          '--brand-500': '#5865f2'
        }
      : {
          '--background-floating': '#ffffff',
          '--background-secondary-alt': '#f2f4f8',
          '--background-tertiary': '#ffffff',
          '--background-modifier-accent': 'rgba(15,23,42,0.18)',
          '--text-normal': '#111827',
          '--header-primary': '#111827',
          '--interactive-text-active': '#0f172a',
          '--interactive-normal': '#4b5563',
          '--interactive-active': '#111827',
          '--text-muted': '#6b7280',
          '--brand-500': '#2563eb'
        };

    for (const [key, value] of Object.entries(vars)) {
      targetEl.style.setProperty(key, value);
    }
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

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return { days: {} };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.days || typeof parsed.days !== 'object') {
        return { days: {} };
      }
      const days = {};
      for (const [dateKey, value] of Object.entries(parsed.days)) {
        if (!isDateKey(dateKey)) continue;
        const openMs = Number(value && value.openMs);
        const focusedMs = Number(value && value.focusedMs);
        const switches = Number(value && value.switches);
        days[dateKey] = {
          openMs: Number.isFinite(openMs) && openMs >= 0 ? Math.floor(openMs) : 0,
          focusedMs: Number.isFinite(focusedMs) && focusedMs >= 0 ? Math.floor(focusedMs) : 0,
          switches: Number.isFinite(switches) && switches >= 0 ? Math.floor(switches) : 0
        };
      }
      return { days };
    } catch (_) {
      return { days: {} };
    }
  }

  function saveHistory() {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  }

  function dateKeyFromStorageKey(storageKey, prefix) {
    if (!storageKey.startsWith(prefix)) return null;
    const dateKey = storageKey.slice(prefix.length);
    return isDateKey(dateKey) ? dateKey : null;
  }

  function collectKnownDateKeysFromStorage() {
    const keys = new Set(Object.keys(history.days || {}));
    for (let i = 0; i < localStorage.length; i += 1) {
      const storageKey = localStorage.key(i);
      if (!storageKey) continue;
      const dateKey =
        dateKeyFromStorageKey(storageKey, FOCUSED_STORAGE_PREFIX)
        || dateKeyFromStorageKey(storageKey, LEGACY_FOCUSED_STORAGE_PREFIX)
        || dateKeyFromStorageKey(storageKey, OPEN_STORAGE_PREFIX)
        || dateKeyFromStorageKey(storageKey, SWITCH_STORAGE_PREFIX);
      if (dateKey) keys.add(dateKey);
    }
    return keys;
  }

  function upsertHistoryDay(dateKey, openMsValue, focusedMsValue, switchesValue) {
    const next = {
      openMs: Math.max(0, Math.floor(openMsValue)),
      focusedMs: Math.max(0, Math.floor(focusedMsValue)),
      switches: Math.max(0, Math.floor(switchesValue))
    };
    const prev = history.days[dateKey];
    if (
      prev
      && prev.openMs === next.openMs
      && prev.focusedMs === next.focusedMs
      && prev.switches === next.switches
    ) {
      return false;
    }
    history.days[dateKey] = next;
    return true;
  }

  function syncHistoryFromLegacyStorage() {
    let changed = false;
    const dateKeys = collectKnownDateKeysFromStorage();
    for (const dateKey of dateKeys) {
      const nextOpenMs = loadOpenMs(dateKey);
      const nextFocusedMs = loadFocusedMs(dateKey);
      const nextSwitches = loadSwitchCount(dateKey);
      changed = upsertHistoryDay(dateKey, nextOpenMs, nextFocusedMs, nextSwitches) || changed;
    }
    if (changed) saveHistory();
  }

  function recordCurrentDayHistory() {
    if (upsertHistoryDay(key, openMs, focusedMs, switchCount)) {
      saveHistory();
    }
  }

  function allHistoryEntries() {
    return Object.entries(history.days)
      .map(([dateKey, values]) => ({ dateKey, ...values }))
      .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
  }

  function averageEntries(entries) {
    if (!entries.length) {
      return { openMs: 0, focusedMs: 0, switches: 0, days: 0 };
    }
    let openTotal = 0;
    let focusedTotal = 0;
    let switchesTotal = 0;
    for (const entry of entries) {
      openTotal += entry.openMs;
      focusedTotal += entry.focusedMs;
      switchesTotal += entry.switches;
    }
    return {
      openMs: Math.floor(openTotal / entries.length),
      focusedMs: Math.floor(focusedTotal / entries.length),
      switches: Math.floor(switchesTotal / entries.length),
      days: entries.length
    };
  }

  function downloadHistoryCsv() {
    const rows = allHistoryEntries().sort((a, b) => (a.dateKey > b.dateKey ? 1 : -1));
    const lines = [
      'date,open_ms,focused_ms,switches,open_hms,focused_hms'
    ];
    for (const row of rows) {
      lines.push([
        row.dateKey,
        row.openMs,
        row.focusedMs,
        row.switches,
        formatHMS(row.openMs),
        formatHMS(row.focusedMs)
      ].join(','));
    }
    const csv = `${lines.join('\n')}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `discord-usage-export-${todayKey()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function clampFontSize(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_FONT_SIZE;
    return Math.min(40, Math.max(10, Math.round(n)));
  }

  function loadSettings() {
    let parsed = {};
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (_) {
      parsed = {};
    }
    return {
      showOpen: parsed.showOpen !== false,
      showFocus: parsed.showFocus !== false,
      showSwitches: parsed.showSwitches !== false,
      fontSize: clampFontSize(parsed.fontSize)
    };
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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

  function setGuildIconHidden(hidden) {
    const icon = document.querySelector('div[role="button"] div[class*="guildIcon_"]');
    if (!(icon instanceof HTMLElement)) return;
    if (hidden) {
      if (!icon.hasAttribute('data-tm-icon-hidden')) {
        icon.setAttribute('data-tm-icon-hidden', '1');
        icon.setAttribute('data-tm-prev-display', icon.style.display || '');
      }
      icon.style.display = 'none';
      return;
    }
    if (icon.hasAttribute('data-tm-icon-hidden')) {
      icon.style.display = icon.getAttribute('data-tm-prev-display') || '';
      icon.removeAttribute('data-tm-prev-display');
      icon.removeAttribute('data-tm-icon-hidden');
    }
  }

  function restoreNativeTitle(titleEl) {
    if (!(titleEl instanceof HTMLElement)) return;
    if (titleEl.getAttribute('data-tm-overridden') === '1') {
      titleEl.textContent = titleEl.getAttribute('data-tm-original-text') || titleEl.textContent;
      const originalFontSize = titleEl.getAttribute('data-tm-original-font-size');
      titleEl.style.fontSize = originalFontSize === null ? '' : originalFontSize;
      titleEl.style.fontVariantNumeric = '';
      titleEl.style.fontFeatureSettings = '';
      titleEl.removeAttribute('data-tm-overridden');
      titleEl.removeAttribute('data-tm-original-text');
      titleEl.removeAttribute('data-tm-original-font-size');
    }
  }

  function applyCustomTitle(titleEl, text) {
    if (!(titleEl instanceof HTMLElement)) return;
    if (titleEl.getAttribute('data-tm-overridden') !== '1') {
      titleEl.setAttribute('data-tm-overridden', '1');
      titleEl.setAttribute('data-tm-original-text', titleEl.textContent || '');
      titleEl.setAttribute('data-tm-original-font-size', titleEl.style.fontSize || '');
    }
    titleEl.style.fontSize = `${settings.fontSize}px`;
    titleEl.style.fontVariantNumeric = 'tabular-nums';
    titleEl.style.fontFeatureSettings = '"tnum" 1';
    if (titleEl.textContent !== text) {
      titleEl.textContent = text;
    }
  }

  let settings = loadSettings();
  let history = loadHistory();
  let popupEl = null;
  let popupAnchorEl = null;
  let activePopupTab = 'settings';
  let isRefreshingPopupTheme = false;
  let refreshPopupUsage = null;
  let tooltipEl = null;
  let tooltipAnchorEl = null;
  let tooltipShowTimer = 0;

  function positionTooltip() {
    if (!(tooltipEl instanceof HTMLElement) || !(tooltipAnchorEl instanceof HTMLElement)) return;
    const rect = tooltipAnchorEl.getBoundingClientRect();
    const margin = 8;
    const maxLeft = window.innerWidth - tooltipEl.offsetWidth - margin;
    const nextLeft = Math.max(margin, Math.min(maxLeft, rect.left + (rect.width / 2) - (tooltipEl.offsetWidth / 2)));
    let nextTop = rect.top - tooltipEl.offsetHeight - margin;
    if (nextTop < margin) {
      nextTop = rect.bottom + margin;
      tooltipEl.setAttribute('data-tm-placement', 'bottom');
    } else {
      tooltipEl.setAttribute('data-tm-placement', 'top');
    }
    tooltipEl.style.left = `${Math.round(nextLeft)}px`;
    tooltipEl.style.top = `${Math.round(nextTop)}px`;
  }

  function hideTooltip() {
    if (tooltipShowTimer) {
      clearTimeout(tooltipShowTimer);
      tooltipShowTimer = 0;
    }
    if (tooltipEl instanceof HTMLElement) {
      tooltipEl.remove();
    }
    tooltipEl = null;
    tooltipAnchorEl = null;
  }

  function showTooltip(anchorEl, text) {
    hideTooltip();
    tooltipAnchorEl = anchorEl;

    const el = document.createElement('div');
    el.setAttribute('data-tm-tooltip', '1');
    el.setAttribute('role', 'tooltip');
    el.style.position = 'fixed';
    el.style.zIndex = '10001';
    el.style.pointerEvents = 'none';
    el.style.background = 'var(--background-floating, #111214)';
    el.style.color = 'var(--text-normal, #f2f3f5)';
    el.style.border = '1px solid var(--background-modifier-accent, rgba(255,255,255,0.12))';
    el.style.borderRadius = '6px';
    el.style.padding = '6px 8px';
    el.style.fontFamily = 'var(--font-primary, "gg sans", "Noto Sans", sans-serif)';
    el.style.fontSize = '12px';
    el.style.fontWeight = '500';
    el.style.lineHeight = '1';
    el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
    el.style.opacity = '0';
    el.style.transform = 'translateY(2px)';
    el.style.transition = 'opacity 120ms ease, transform 120ms ease';
    applyThemeVariables(el);

    const textEl = document.createElement('div');
    textEl.textContent = text;
    el.appendChild(textEl);

    const arrow = document.createElement('div');
    arrow.setAttribute('data-tm-tooltip-arrow', '1');
    arrow.style.position = 'absolute';
    arrow.style.width = '8px';
    arrow.style.height = '8px';
    arrow.style.background = 'var(--background-floating, #111214)';
    arrow.style.borderLeft = '1px solid var(--background-modifier-accent, rgba(255,255,255,0.12))';
    arrow.style.borderTop = '1px solid var(--background-modifier-accent, rgba(255,255,255,0.12))';
    arrow.style.transform = 'rotate(45deg)';
    el.appendChild(arrow);

    tooltipEl = el;
    document.body.appendChild(el);
    positionTooltip();

    const placement = el.getAttribute('data-tm-placement');
    if (placement === 'bottom') {
      arrow.style.top = '-5px';
      arrow.style.left = 'calc(50% - 4px)';
    } else {
      arrow.style.bottom = '-5px';
      arrow.style.left = 'calc(50% - 4px)';
      arrow.style.transform = 'rotate(225deg)';
    }

    requestAnimationFrame(() => {
      if (!(tooltipEl instanceof HTMLElement)) return;
      tooltipEl.style.opacity = '1';
      tooltipEl.style.transform = 'translateY(0)';
    });
  }

  function scheduleTooltip(anchorEl, text) {
    if (tooltipShowTimer) clearTimeout(tooltipShowTimer);
    tooltipShowTimer = setTimeout(() => {
      tooltipShowTimer = 0;
      showTooltip(anchorEl, text);
    }, 350);
  }

  function positionPopup() {
    if (!(popupEl instanceof HTMLElement) || !(popupAnchorEl instanceof HTMLElement)) return;
    const rect = popupAnchorEl.getBoundingClientRect();
    const margin = 8;
    const verticalOffset = 6;
    const maxLeft = window.innerWidth - popupEl.offsetWidth - margin;
    const nextLeft = Math.max(margin, Math.min(maxLeft, rect.right - popupEl.offsetWidth));
    popupEl.style.top = `${Math.round(rect.bottom + margin - verticalOffset)}px`;
    popupEl.style.left = `${Math.round(nextLeft)}px`;
  }

  function closePopup() {
    if (!(popupEl instanceof HTMLElement)) return;
    popupEl.remove();
    popupEl = null;
    refreshPopupUsage = null;
    if (popupAnchorEl instanceof HTMLElement) {
      popupAnchorEl.setAttribute('aria-expanded', 'false');
    }
    popupAnchorEl = null;
  }

  function buildPopup(anchorEl) {
    const panel = document.createElement('div');
    panel.setAttribute('data-tm-popup', '1');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Daily Timer Settings');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('tabindex', '-1');
    panel.style.position = 'fixed';
    panel.style.zIndex = '10000';
    panel.style.width = '320px';
    panel.style.background = 'var(--background-floating, #2b2d31)';
    panel.style.border = '1px solid var(--background-modifier-accent, rgba(255,255,255,0.12))';
    panel.style.borderRadius = '10px';
    panel.style.boxShadow = '0 12px 28px rgba(0, 0, 0, 0.42)';
    panel.style.overflow = 'hidden';
    panel.style.color = 'var(--header-primary, #f2f3f5)';
    panel.style.fontFamily = 'var(--font-primary, "gg sans", "Noto Sans", sans-serif)';
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(-3px)';
    panel.style.transition = 'opacity 120ms ease, transform 120ms ease';
    applyThemeVariables(panel);

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'center';
    header.style.position = 'relative';
    header.style.padding = '10px 12px';
    header.style.borderBottom = '1px solid var(--background-modifier-accent, rgba(255,255,255,0.08))';

    const title = document.createElement('h1');
    title.textContent = 'Discord Usage Timer';
    title.style.margin = '0';
    title.style.fontSize = '16px';
    title.style.lineHeight = '20px';
    title.style.fontWeight = '600';
    title.style.color = 'var(--interactive-text-active, #ffffff)';
    title.style.textAlign = 'center';

    const githubLink = document.createElement('a');
    githubLink.href = 'https://github.com/KianBahasadri/discord-daily-timer-userscript/tree/main';
    githubLink.target = '_blank';
    githubLink.rel = 'noreferrer noopener';
    githubLink.setAttribute('aria-label', 'Open GitHub repository');
    githubLink.style.marginLeft = 'auto';
    githubLink.style.display = 'inline-flex';
    githubLink.style.position = 'absolute';
    githubLink.style.right = '12px';
    githubLink.style.alignItems = 'center';
    githubLink.style.justifyContent = 'center';
    githubLink.style.color = 'var(--interactive-normal, #b5bac1)';
    githubLink.style.textDecoration = 'none';
    githubLink.innerHTML = '<svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path></svg>';

    header.appendChild(title);
    header.appendChild(githubLink);
    panel.appendChild(header);

    const tabs = document.createElement('div');
    tabs.style.display = 'grid';
    tabs.style.gridTemplateColumns = '1fr 1fr';
    tabs.style.borderBottom = '1px solid var(--background-modifier-accent, rgba(255,255,255,0.08))';
    panel.appendChild(tabs);

    const tabSettings = document.createElement('button');
    tabSettings.setAttribute('data-tm-tab', 'settings');
    tabSettings.type = 'button';
    tabSettings.textContent = 'Settings';
    tabSettings.style.border = '0';
    tabSettings.style.background = 'transparent';
    tabSettings.style.color = 'var(--interactive-normal, #b5bac1)';
    tabSettings.style.padding = '10px 8px';
    tabSettings.style.fontSize = '13px';
    tabSettings.style.fontWeight = '700';
    tabSettings.style.cursor = 'pointer';

    const tabUsage = document.createElement('button');
    tabUsage.setAttribute('data-tm-tab', 'usage');
    tabUsage.type = 'button';
    tabUsage.textContent = 'Usage';
    tabUsage.style.border = '0';
    tabUsage.style.background = 'transparent';
    tabUsage.style.color = 'var(--interactive-normal, #b5bac1)';
    tabUsage.style.padding = '10px 8px';
    tabUsage.style.fontSize = '13px';
    tabUsage.style.fontWeight = '700';
    tabUsage.style.cursor = 'pointer';

    tabs.appendChild(tabSettings);
    tabs.appendChild(tabUsage);

    const content = document.createElement('div');
    content.style.padding = '10px 12px 12px';
    panel.appendChild(content);

    const settingsPanel = document.createElement('div');
    settingsPanel.style.display = 'flex';
    settingsPanel.style.flexDirection = 'column';
    settingsPanel.style.gap = '6px';
    content.appendChild(settingsPanel);

    const usagePanel = document.createElement('div');
    usagePanel.style.display = 'none';
    usagePanel.style.flexDirection = 'column';
    usagePanel.style.gap = '8px';
    content.appendChild(usagePanel);

    const makeToggle = (labelText, settingKey) => {
      const row = document.createElement('label');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.padding = '4px 0';
      row.style.fontSize = '17px';
      row.style.lineHeight = '22px';
      row.style.cursor = 'pointer';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(settings[settingKey]);
      input.style.width = '14px';
      input.style.height = '14px';
      input.style.accentColor = 'var(--brand-500, #5865f2)';
      input.addEventListener('change', () => {
        settings[settingKey] = input.checked;
        saveSettings();
        render();
      });

      const text = document.createElement('span');
      text.textContent = labelText;

      row.appendChild(input);
      row.appendChild(text);
      return row;
    };

    settingsPanel.appendChild(makeToggle('Open timer', 'showOpen'));
    settingsPanel.appendChild(makeToggle('Focus timer', 'showFocus'));
    settingsPanel.appendChild(makeToggle('Switches count', 'showSwitches'));

    const sizeLabel = document.createElement('div');
    sizeLabel.textContent = 'Font size';
    sizeLabel.style.fontSize = '12px';
    sizeLabel.style.marginTop = '8px';
    sizeLabel.style.marginBottom = '2px';
    sizeLabel.style.color = 'var(--text-muted, #b5bac1)';
    sizeLabel.style.textTransform = 'uppercase';
    sizeLabel.style.letterSpacing = '0.02em';
    sizeLabel.style.fontWeight = '700';
    settingsPanel.appendChild(sizeLabel);

    const sizeRow = document.createElement('div');
    sizeRow.style.display = 'flex';
    sizeRow.style.alignItems = 'center';
    sizeRow.style.gap = '8px';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '10';
    slider.max = '40';
    slider.value = String(settings.fontSize);
    slider.style.flex = '1';
    slider.style.accentColor = 'var(--brand-500, #5865f2)';

    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.min = '10';
    numberInput.max = '40';
    numberInput.value = String(settings.fontSize);
    numberInput.style.width = '56px';
    numberInput.style.background = 'var(--background-tertiary, #1e1f22)';
    numberInput.style.color = 'var(--header-primary, #f2f3f5)';
    numberInput.style.border = '1px solid var(--background-modifier-accent, rgba(255,255,255,0.12))';
    numberInput.style.borderRadius = '4px';
    numberInput.style.padding = '4px';
    numberInput.style.fontSize = '12px';
    numberInput.style.fontWeight = '600';

    const syncFontSize = (value) => {
      if (value === '') return;
      const next = clampFontSize(value);
      settings.fontSize = next;
      slider.value = String(next);
      numberInput.value = String(next);
      saveSettings();
      render();
    };

    slider.addEventListener('input', () => syncFontSize(slider.value));
    numberInput.addEventListener('input', () => syncFontSize(numberInput.value));
    numberInput.addEventListener('change', () => syncFontSize(numberInput.value));

    sizeRow.appendChild(slider);
    sizeRow.appendChild(numberInput);
    settingsPanel.appendChild(sizeRow);

    const usageRows = document.createElement('div');
    usageRows.style.display = 'flex';
    usageRows.style.flexDirection = 'column';
    usageRows.style.gap = '8px';
    usagePanel.appendChild(usageRows);

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = 'Export CSV';
    exportButton.style.marginTop = '2px';
    exportButton.style.border = '1px solid var(--background-modifier-accent, rgba(255,255,255,0.14))';
    exportButton.style.borderRadius = '7px';
    exportButton.style.padding = '8px 10px';
    exportButton.style.fontSize = '12px';
    exportButton.style.fontWeight = '700';
    exportButton.style.cursor = 'pointer';
    exportButton.style.background = 'var(--background-secondary-alt, #232428)';
    exportButton.style.color = 'var(--header-primary, #f2f3f5)';
    exportButton.addEventListener('click', downloadHistoryCsv);
    usagePanel.appendChild(exportButton);

    function appendUsageCard(container, titleText, subtitleText, values) {
      const card = document.createElement('div');
      card.style.border = '1px solid var(--background-modifier-accent, rgba(255,255,255,0.1))';
      card.style.borderRadius = '8px';
      card.style.padding = '8px 9px';
      card.style.background = 'var(--background-secondary-alt, #232428)';

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.justifyContent = 'space-between';
      top.style.alignItems = 'center';
      top.style.marginBottom = '4px';

      const title = document.createElement('div');
      title.textContent = titleText;
      title.style.fontSize = '13px';
      title.style.fontWeight = '700';
      title.style.color = 'var(--header-primary, #f2f3f5)';

      const subtitle = document.createElement('div');
      subtitle.textContent = subtitleText;
      subtitle.style.fontSize = '11px';
      subtitle.style.fontWeight = '600';
      subtitle.style.color = 'var(--text-muted, #aeb3ba)';

      top.appendChild(title);
      top.appendChild(subtitle);
      card.appendChild(top);

      const stats = document.createElement('div');
      stats.style.display = 'grid';
      stats.style.gridTemplateColumns = '1fr 1fr 1fr';
      stats.style.gap = '8px';

      const openCell = document.createElement('div');
      openCell.style.display = 'flex';
      openCell.style.flexDirection = 'column';
      openCell.style.rowGap = '2px';
      const openLabel = document.createElement('span');
      openLabel.textContent = 'Open';
      openLabel.style.fontSize = '11px';
      openLabel.style.color = 'var(--text-muted, #aeb3ba)';
      const openValue = document.createElement('span');
      openValue.textContent = formatHMS(values.openMs);
      openValue.style.fontSize = '12px';
      openValue.style.fontWeight = '700';
      openCell.appendChild(openLabel);
      openCell.appendChild(openValue);

      const focusCell = document.createElement('div');
      focusCell.style.display = 'flex';
      focusCell.style.flexDirection = 'column';
      focusCell.style.rowGap = '2px';
      const focusLabel = document.createElement('span');
      focusLabel.textContent = 'Focus';
      focusLabel.style.fontSize = '11px';
      focusLabel.style.color = 'var(--text-muted, #aeb3ba)';
      const focusValue = document.createElement('span');
      focusValue.textContent = formatHMS(values.focusedMs);
      focusValue.style.fontSize = '12px';
      focusValue.style.fontWeight = '700';
      focusCell.appendChild(focusLabel);
      focusCell.appendChild(focusValue);

      const switchesCell = document.createElement('div');
      switchesCell.style.display = 'flex';
      switchesCell.style.flexDirection = 'column';
      switchesCell.style.rowGap = '2px';
      const switchesLabel = document.createElement('span');
      switchesLabel.textContent = 'Switches';
      switchesLabel.style.fontSize = '11px';
      switchesLabel.style.color = 'var(--text-muted, #aeb3ba)';
      const switchesValue = document.createElement('span');
      switchesValue.textContent = String(values.switches);
      switchesValue.style.fontSize = '12px';
      switchesValue.style.fontWeight = '700';
      switchesCell.appendChild(switchesLabel);
      switchesCell.appendChild(switchesValue);

      stats.appendChild(openCell);
      stats.appendChild(focusCell);
      stats.appendChild(switchesCell);
      card.appendChild(stats);
      container.appendChild(card);
    }

    function renderUsageRows() {
      usageRows.replaceChildren();

      const yesterdayKey = dateKeyDaysAgo(1);
      const yesterday = history.days[yesterdayKey] || { openMs: 0, focusedMs: 0, switches: 0 };
      appendUsageCard(usageRows, 'Yesterday', yesterdayKey, yesterday);

      const weeklyDateKeys = new Set();
      for (let i = 0; i < 7; i += 1) {
        weeklyDateKeys.add(dateKeyDaysAgo(i));
      }
      const weeklyEntries = allHistoryEntries().filter((entry) => weeklyDateKeys.has(entry.dateKey));
      const weeklyAverage = averageEntries(weeklyEntries);
      appendUsageCard(
        usageRows,
        'Weekly average',
        weeklyAverage.days ? `${weeklyAverage.days} day${weeklyAverage.days === 1 ? '' : 's'}` : 'No data',
        weeklyAverage
      );

      const allEntries = allHistoryEntries();
      const allTimeAverage = averageEntries(allEntries);
      appendUsageCard(
        usageRows,
        'All-time average',
        allTimeAverage.days ? `${allTimeAverage.days} day${allTimeAverage.days === 1 ? '' : 's'}` : 'No data',
        allTimeAverage
      );
    }

    function setActiveTab(tab) {
      const settingsActive = tab === 'settings';
      activePopupTab = settingsActive ? 'settings' : 'usage';
      settingsPanel.style.display = settingsActive ? 'flex' : 'none';
      usagePanel.style.display = settingsActive ? 'none' : 'flex';

      tabSettings.style.color = settingsActive
        ? 'var(--interactive-active, #ffffff)'
        : 'var(--interactive-normal, #b5bac1)';
      tabUsage.style.color = settingsActive
        ? 'var(--interactive-normal, #b5bac1)'
        : 'var(--interactive-active, #ffffff)';
      tabSettings.style.boxShadow = settingsActive
        ? 'inset 0 -2px 0 var(--brand-500, #5865f2)'
        : 'none';
      tabUsage.style.boxShadow = settingsActive
        ? 'none'
        : 'inset 0 -2px 0 var(--brand-500, #5865f2)';

      if (!settingsActive) {
        renderUsageRows();
      }
    }

    tabSettings.addEventListener('click', () => setActiveTab('settings'));
    tabUsage.addEventListener('click', () => setActiveTab('usage'));

    refreshPopupUsage = renderUsageRows;
    setActiveTab('settings');

    const onPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel.contains(target)) return;
      if (anchorEl.contains(target)) return;
      closePopup();
    };

    const onEsc = (event) => {
      if (event.key === 'Escape') {
        closePopup();
      }
    };

    const onViewportChange = () => {
      positionPopup();
    };

    const originalClosePopup = closePopup;
    closePopup = function closeAndCleanup() {
      if (!(popupEl instanceof HTMLElement)) return;
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onEsc, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      originalClosePopup();
      closePopup = originalClosePopup;
    };

    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onEsc, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);

    requestAnimationFrame(() => {
      panel.style.opacity = '1';
      panel.style.transform = 'translateY(0)';
      panel.focus();
    });

    return panel;
  }

  function refreshPopupForThemeChange() {
    if (isRefreshingPopupTheme) return;
    if (!(popupEl instanceof HTMLElement) || !(popupAnchorEl instanceof HTMLElement)) return;
    if (!document.body.contains(popupAnchorEl)) return;

    isRefreshingPopupTheme = true;
    try {
      const anchor = popupAnchorEl;
      const tab = activePopupTab;
      closePopup();

      popupAnchorEl = anchor;
      popupEl = buildPopup(anchor);
      document.body.appendChild(popupEl);
      anchor.setAttribute('aria-expanded', 'true');
      positionPopup();

      if (tab === 'usage') {
        const usageTab = popupEl.querySelector('[data-tm-tab="usage"]');
        if (usageTab instanceof HTMLElement) {
          usageTab.click();
        }
      }
    } finally {
      isRefreshingPopupTheme = false;
    }
  }

  function togglePopup(anchorEl) {
    hideTooltip();
    if (popupEl instanceof HTMLElement) {
      closePopup();
      return;
    }
    popupAnchorEl = anchorEl;
    popupEl = buildPopup(anchorEl);
    document.body.appendChild(popupEl);
    anchorEl.setAttribute('aria-expanded', 'true');
    positionPopup();
  }

  function ensureGearButton() {
    const trailing = document.querySelector('div[class*="trailing_"]');
    if (!(trailing instanceof HTMLElement)) return;

    const existing = trailing.querySelector('[data-tm-gear="1"]');
    if (existing instanceof HTMLElement) {
      if (existing.getAttribute('data-tm-icon') === 'clock' && existing.querySelector('svg')) return;
      existing.remove();
    }

    const inboxButton = trailing.querySelector('[aria-label="Inbox"][role="button"], [aria-label="Inbox"]');
    if (!(inboxButton instanceof HTMLElement)) return;

    const helpButton = trailing.querySelector('[aria-label="Help"][role="button"], [aria-label="Help"]');

    const gearButton = document.createElement('div');
    gearButton.setAttribute('data-tm-gear', '1');
    gearButton.setAttribute('data-tm-icon', 'clock');
    gearButton.setAttribute('role', 'button');
    gearButton.setAttribute('tabindex', '0');
    gearButton.setAttribute('aria-label', 'Daily Timer');
    gearButton.setAttribute('aria-haspopup', 'dialog');
    gearButton.setAttribute('aria-expanded', 'false');
    gearButton.className = helpButton instanceof HTMLElement ? helpButton.className : inboxButton.className;
    gearButton.style.display = 'inline-flex';
    gearButton.style.alignItems = 'center';
    gearButton.style.justifyContent = 'center';
    gearButton.style.cursor = 'pointer';
    gearButton.style.marginRight = '0';
    gearButton.innerHTML = '<svg x="0" y="0" class="icon__9293f" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 4.5a1 1 0 1 0-2 0V12c0 .27.11.52.3.7l3 3a1 1 0 1 0 1.4-1.4L13 11.58V6.5Z" clip-rule="evenodd"></path></svg>';
    gearButton.addEventListener('click', () => togglePopup(gearButton));
    gearButton.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        togglePopup(gearButton);
      }
    });
    gearButton.addEventListener('mouseenter', () => scheduleTooltip(gearButton, 'Daily Timer'));
    gearButton.addEventListener('mouseleave', hideTooltip);
    gearButton.addEventListener('focus', () => scheduleTooltip(gearButton, 'Daily Timer'));
    gearButton.addEventListener('blur', hideTooltip);

    trailing.insertBefore(gearButton, inboxButton);
  }

  let key = todayKey();
  let focusedMs = loadFocusedMs(key);
  let openMs = loadOpenMs(key);
  let switchCount = loadSwitchCount(key);
  let lastTick = Date.now();
  let wasActive = isActive();

  syncHistoryFromLegacyStorage();
  recordCurrentDayHistory();

  function tick() {
    const now = Date.now();

    // Reset on day rollover
    const k = todayKey();
    if (k !== key) {
      recordCurrentDayHistory();
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

    recordCurrentDayHistory();

    render();
  }

  function render() {
    ensureGearButton();
    if (tooltipAnchorEl instanceof HTMLElement && !document.body.contains(tooltipAnchorEl)) {
      hideTooltip();
    }
    if (popupAnchorEl instanceof HTMLElement && !document.body.contains(popupAnchorEl)) {
      closePopup();
    }
    if (typeof refreshPopupUsage === 'function') {
      refreshPopupUsage();
    }

    const titleEl = findTitleEl();
    if (!titleEl) return;
    const gap = '\u00A0\u00A0\u00A0\u00A0\u00A0';
    const parts = [];
    if (settings.showOpen) parts.push(`${formatHMS(openMs)} open`);
    if (settings.showFocus) parts.push(`${formatHMS(focusedMs)} focus`);
    if (settings.showSwitches) parts.push(`${switchCount} switches`);
    if (parts.length === 0) {
      setGuildIconHidden(false);
      restoreNativeTitle(titleEl);
      return;
    }
    setGuildIconHidden(true);
    const nextText = parts.join(`${gap}|${gap}`);
    applyCustomTitle(titleEl, nextText);
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

    const systemTheme = window.matchMedia(SYSTEM_THEME_QUERY);
    const handleThemeChange = () => {
      refreshPopupForThemeChange();
      scheduleRender();
    };
    systemTheme.addEventListener('change', handleThemeChange);

    const rootThemeObserver = new MutationObserver(() => {
      handleThemeChange();
    });
    rootThemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
