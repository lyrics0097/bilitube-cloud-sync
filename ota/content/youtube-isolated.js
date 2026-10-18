/**
 * BiliTube AdShield Pro v2.0.0 — YouTube Isolated World Content Script (Self-Evolving Heuristic Edition)
 * Syncs extension settings & evolution state with DOM dataset attributes, dynamic evolved CSS,
 * and MAIN world script; relays AD_BLOCKED and HEURISTIC_LEARNED events to the service worker.
 */
(() => {
  'use strict';

  if (window.__bilitubeYtIsolatedLoaded) return;
  window.__bilitubeYtIsolatedLoaded = true;

  const DEFAULT_SETTINGS = {
    enabled: true,
    youtubeEnabled: true,
    youtubeAntiDetect: true,
    selfEvolution: true
  };

  const DEFAULT_EVOLUTION = {
    ytCosmetics: [],
    learnedYtSelectors: [],
    ytPruneKeys: [],
    ytTextReplaces: []
  };

  let currentSettings = { ...DEFAULT_SETTINGS };
  let evolutionState = { ...DEFAULT_EVOLUTION };
  let rafScheduled = false;
  const reportedYtSelectors = new Set();

  const YT_FEED_AD_SELECTORS = [
    'ytd-ad-slot-renderer',
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-video-renderer',
    'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer',
    'ytd-masthead-ad-v3-renderer'
  ];

  function isYtActive() {
    return Boolean(currentSettings.enabled && currentSettings.youtubeEnabled);
  }

  function applyDatasetFlags() {
    const root = document.documentElement;
    if (!root) return;
    root.dataset.bilitubeYtEnabled = isYtActive() ? 'true' : 'false';
  }

  /**
   * Dynamic Evolved CSS Injection (`applyEvolvedStyles()`)
   * Creates or updates <style id="bilitube-yt-evolved-css">, validates each selector
   * from ytCosmetics and learnedYtSelectors via DocumentFragment.querySelector in try/catch,
   * and scopes rules under html:not([data-bilitube-yt-enabled="false"]).
   */
  function applyEvolvedStyles() {
    const targetParent = document.head || document.documentElement;
    if (!targetParent) return;

    let styleEl = document.getElementById('bilitube-yt-evolved-css');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'bilitube-yt-evolved-css';
      targetParent.appendChild(styleEl);
    }

    const combined = [
      ...(Array.isArray(evolutionState.ytCosmetics) ? evolutionState.ytCosmetics : []),
      ...(Array.isArray(evolutionState.learnedYtSelectors)
        ? evolutionState.learnedYtSelectors
        : [])
    ];

    const frag = document.createDocumentFragment();
    const validSelectors = [];
    const seen = new Set();

    for (const rawSel of combined) {
      if (typeof rawSel !== 'string') continue;
      const sel = rawSel.trim();
      if (!sel || seen.has(sel)) continue;
      try {
        frag.querySelector(sel);
        seen.add(sel);
        validSelectors.push(sel);
      } catch {
        // Ignore invalid CSS selector
      }
    }

    if (validSelectors.length === 0) {
      if (styleEl.textContent !== '') {
        styleEl.textContent = '';
      }
      return;
    }

    const chunks = [];
    const CHUNK_SIZE = 25;
    for (let i = 0; i < validSelectors.length; i += CHUNK_SIZE) {
      const chunk = validSelectors.slice(i, i + CHUNK_SIZE);
      chunks.push(
        `html:not([data-bilitube-yt-enabled="false"]) :is(${chunk.join(', ')}) { display: none !important; }`
      );
    }

    const nextCss = chunks.join('\n');
    if (styleEl.textContent !== nextCss) {
      styleEl.textContent = nextCss;
    }
  }

  function postConfigToMain() {
    try {
      window.postMessage(
        {
          source: 'bilitube-isolated',
          type: 'CONFIG_SYNC',
          settings: currentSettings,
          evolution: {
            ytPruneKeys: Array.isArray(evolutionState.ytPruneKeys)
              ? evolutionState.ytPruneKeys
              : [],
            ytTextReplaces: Array.isArray(evolutionState.ytTextReplaces)
              ? evolutionState.ytTextReplaces
              : [],
            selfEvolution: currentSettings.selfEvolution !== false
          }
        },
        '*'
      );
    } catch {
      // Ignore postMessage errors
    }
  }

  async function recordBlockedAd(count, savedSeconds = 0, reason = 'YouTube广告拦截') {
    const safeCount = Number(count) || 0;
    if (safeCount <= 0) return;
    try {
      await chrome.runtime.sendMessage({
        type: 'RECORD_BLOCK',
        site: 'youtube',
        count: safeCount,
        savedSeconds: Number(savedSeconds) || 0,
        reason
      });
    } catch {
      // Ignore transient service worker wake errors
    }
  }

  async function reportLearnedHeuristic(selector, reason = 'YouTube新型广告特征') {
    if (!selector || typeof selector !== 'string') return;
    const trimmed = selector.trim();
    if (
      !trimmed ||
      reportedYtSelectors.has(trimmed) ||
      (Array.isArray(evolutionState.learnedYtSelectors) &&
        evolutionState.learnedYtSelectors.includes(trimmed))
    ) {
      return;
    }
    reportedYtSelectors.add(trimmed);
    try {
      await chrome.runtime.sendMessage({
        type: 'REPORT_LEARNED_HEURISTIC',
        site: 'youtube',
        selector: trimmed,
        reason
      });
    } catch {
      // Ignore transient messaging errors
    }
  }

  function normalizeStoredSettings(stored) {
    if (!stored || typeof stored !== 'object') return { ...DEFAULT_SETTINGS };
    const base =
      stored.settings && typeof stored.settings === 'object'
        ? { ...stored, ...stored.settings }
        : stored;
    return {
      enabled: typeof base.enabled === 'boolean' ? base.enabled : DEFAULT_SETTINGS.enabled,
      youtubeEnabled:
        typeof base.youtubeEnabled === 'boolean'
          ? base.youtubeEnabled
          : DEFAULT_SETTINGS.youtubeEnabled,
      youtubeAntiDetect:
        typeof base.youtubeAntiDetect === 'boolean'
          ? base.youtubeAntiDetect
          : DEFAULT_SETTINGS.youtubeAntiDetect,
      selfEvolution:
        typeof base.selfEvolution === 'boolean'
          ? base.selfEvolution
          : DEFAULT_SETTINGS.selfEvolution
    };
  }

  function normalizeEvolutionState(stored) {
    if (!stored || typeof stored !== 'object') return { ...DEFAULT_EVOLUTION };
    const raw =
      stored.evolution && typeof stored.evolution === 'object' ? stored.evolution : stored;
    return {
      ytCosmetics: Array.isArray(raw.ytCosmetics) ? raw.ytCosmetics : [],
      learnedYtSelectors: Array.isArray(raw.learnedYtSelectors) ? raw.learnedYtSelectors : [],
      ytPruneKeys: Array.isArray(raw.ytPruneKeys) ? raw.ytPruneKeys : [],
      ytTextReplaces: Array.isArray(raw.ytTextReplaces) ? raw.ytTextReplaces : []
    };
  }

  async function loadSettingsAndEvolution() {
    try {
      const stored = await chrome.storage.local.get(['settings', 'evolution']);
      currentSettings = normalizeStoredSettings(stored);
      evolutionState = normalizeEvolutionState(stored);
      applyDatasetFlags();
      applyEvolvedStyles();
      postConfigToMain();
      scheduleDomScan();
    } catch {
      applyDatasetFlags();
      applyEvolvedStyles();
      postConfigToMain();
    }
  }

  function performDomScan() {
    rafScheduled = false;
    if (!isYtActive()) return;

    if (document.documentElement && !document.documentElement.dataset.bilitubeYtEnabled) {
      applyDatasetFlags();
    }
    const existingStyle = document.getElementById('bilitube-yt-evolved-css');
    if (
      !existingStyle ||
      (!existingStyle.textContent &&
        ((evolutionState.ytCosmetics && evolutionState.ytCosmetics.length > 0) ||
          (evolutionState.learnedYtSelectors && evolutionState.learnedYtSelectors.length > 0)))
    ) {
      applyEvolvedStyles();
    }

    let newlyHidden = 0;
    const adNodes = document.querySelectorAll(YT_FEED_AD_SELECTORS.join(', '));

    for (const node of adNodes) {
      if (!(node instanceof HTMLElement)) continue;
      const container = node.closest('ytd-rich-item-renderer') || node;
      if (container instanceof HTMLElement && container.dataset.bilitubeHidden !== '1') {
        container.dataset.bilitubeHidden = '1';
        container.style.setProperty('display', 'none', 'important');
        newlyHidden += 1;
      }
      if (node.dataset.bilitubeHidden !== '1') {
        node.dataset.bilitubeHidden = '1';
        node.style.setProperty('display', 'none', 'important');
      }
    }

    if (newlyHidden > 0) {
      void recordBlockedAd(newlyHidden, newlyHidden * 5, 'YouTube信息流广告隐藏');
    }
  }

  let scanTimer = null;

  function scheduleDomScan() {
    if (rafScheduled || scanTimer !== null || !isYtActive()) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      rafScheduled = true;
      requestAnimationFrame(performDomScan);
    }, 220);
  }

  // Apply initial dataset flags immediately at document_start
  applyDatasetFlags();
  applyEvolvedStyles();
  postConfigToMain();
  void loadSettingsAndEvolution();

  // Relay AD_BLOCKED and HEURISTIC_LEARNED messages from youtube-main.js to service worker
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'bilitube-main') return;
    if (data.type === 'AD_BLOCKED') {
      void recordBlockedAd(data.count, data.savedSeconds, data.reason);
    } else if (data.type === 'HEURISTIC_LEARNED' && data.selector) {
      void reportLearnedHeuristic(data.selector, data.reason || 'YouTube新型跳过按钮特征');
    }
  });

  // Listen for runtime updates from popup / service worker
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message?.type === 'PING') {
        sendResponse({ ok: true, site: 'youtube' });
        return;
      }
      if (message?.type === 'SETTINGS_UPDATED' || message?.type === 'CONFIG_UPDATED') {
        currentSettings = normalizeStoredSettings(message.settings || message);
        applyDatasetFlags();
        applyEvolvedStyles();
        postConfigToMain();
        scheduleDomScan();
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === 'EVOLUTION_UPDATED') {
        if (message.evolution && typeof message.evolution === 'object') {
          evolutionState = normalizeEvolutionState({ evolution: message.evolution });
        } else {
          const stored = await chrome.storage.local.get(['settings', 'evolution']);
          currentSettings = normalizeStoredSettings(stored);
          evolutionState = normalizeEvolutionState(stored);
        }
        applyDatasetFlags();
        applyEvolvedStyles();
        postConfigToMain();
        scheduleDomScan();
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false });
    })();
    return true;
  });

  // Listen for storage updates (settings & evolution)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!changes.settings && !changes.evolution) return;
    (async () => {
      const stored = await chrome.storage.local.get(['settings', 'evolution']);
      currentSettings = normalizeStoredSettings(stored);
      evolutionState = normalizeEvolutionState(stored);
      applyDatasetFlags();
      applyEvolvedStyles();
      postConfigToMain();
      scheduleDomScan();
    })();
  });

  const YT_PLAYER_IGNORE_SELECTOR =
    '#movie_player, .html5-video-player, .ytp-progress-bar-container, .ytp-chrome-bottom';

  const observer = new MutationObserver((mutations) => {
    if (rafScheduled || scanTimer !== null || !isYtActive()) return;
    for (const m of mutations) {
      if (!m.addedNodes || m.addedNodes.length === 0) continue;
      if (m.target instanceof Element && m.target.closest(YT_PLAYER_IGNORE_SELECTOR)) {
        continue;
      }
      scheduleDomScan();
      break;
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => {
        applyDatasetFlags();
        applyEvolvedStyles();
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
        scheduleDomScan();
      },
      { once: true }
    );
  }
})();
