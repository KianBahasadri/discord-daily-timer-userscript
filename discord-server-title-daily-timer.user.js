// ==UserScript==
// @name         Discord Server Title + Daily Timer
// @version      1.9.0
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
  const DEFAULT_FONT_SIZE = 16;

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
  let popupEl = null;
  let popupAnchorEl = null;
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

    const body = document.createElement('div');
    body.style.padding = '10px 12px 12px';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '6px';
    panel.appendChild(body);

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

    body.appendChild(makeToggle('Open timer', 'showOpen'));
    body.appendChild(makeToggle('Focus timer', 'showFocus'));
    body.appendChild(makeToggle('Switches count', 'showSwitches'));

    const sizeLabel = document.createElement('div');
    sizeLabel.textContent = 'Font size';
    sizeLabel.style.fontSize = '12px';
    sizeLabel.style.marginTop = '8px';
    sizeLabel.style.marginBottom = '2px';
    sizeLabel.style.color = 'var(--text-muted, #b5bac1)';
    sizeLabel.style.textTransform = 'uppercase';
    sizeLabel.style.letterSpacing = '0.02em';
    sizeLabel.style.fontWeight = '700';
    body.appendChild(sizeLabel);

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
    body.appendChild(sizeRow);

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
    ensureGearButton();
    if (tooltipAnchorEl instanceof HTMLElement && !document.body.contains(tooltipAnchorEl)) {
      hideTooltip();
    }
    if (popupAnchorEl instanceof HTMLElement && !document.body.contains(popupAnchorEl)) {
      closePopup();
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
