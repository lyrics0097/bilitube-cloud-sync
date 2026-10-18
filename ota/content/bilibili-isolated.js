/**
 * BiliTube AdShield Pro v2.0.0 — Bilibili Isolated World Content Script (Self-Evolving Heuristic Edition)
 * Syncs extension settings & evolution state with DOM dataset attributes, dynamic evolved CSS,
 * and MAIN world script; performs zero-day semantic heuristic DOM scanning via rAF.
 */
(() => {
  'use strict';

  if (window.__bilitubeBiliIsolatedLoaded) return;
  window.__bilitubeBiliIsolatedLoaded = true;

  const DEFAULT_SETTINGS = {
    enabled: true,
    bilibiliEnabled: true,
    bilibiliLiveFilter: true,
    bilibiliCleanUrl: true,
    selfEvolution: true
  };

  const DEFAULT_EVOLUTION = {
    biliCosmetics: [],
    learnedBiliSelectors: [],
    biliPruneKeys: []
  };

  let currentSettings = { ...DEFAULT_SETTINGS };
  let evolutionState = { ...DEFAULT_EVOLUTION };
  let rafScheduled = false;
  const reportedBiliSelectors = new Set();

  const AD_INDICATOR_SELECTORS = [
    '.bili-video-card__info--ad',
    '.bili-video-card__info--creative-ad',
    'a[href*="cm.bilibili.com"]',
    '#right-bottom-banner',
    '.video-page-special-card-small',
    '.video-page-special-card',
    '.video-page-game-card-small',
    '.bpx-player-cmd-dm-wrap',
    '.floor-single-card',
    '.ad-report',
    '.ad-floor-exp',
    '.eva-banner',
    '.slide-ad'
  ];

  const LIVE_INDICATOR_SELECTORS = [
    '.bili-live-card',
    '.bili-video-card__stats--live',
    '.live-sidebar-shopping-cart',
    '.shopping-cart-module',
    '.shop-popover'
  ];

  const PROMO_NAV_KEYWORDS = ['会员购', '游戏中心', '漫画'];

  const HEURISTIC_AD_HREF_PATTERNS = [
    'cm.bilibili.com',
    'game.bilibili.com',
    'mall.bilibili.com',
    'show.bilibili.com',
    'bilibili.com/blackboard/activity-'
  ];

  const HEURISTIC_BADGE_TEXTS = ['广告', '推广', '商业推广', '创作推广', '赞助'];

  const GENERIC_CLASS_IGNORE = new Set([
    'bili-video-card',
    'bili-feed-card',
    'feed-card',
    'clearfix',
    'active',
    'hidden',
    'show',
    'flex',
    'item',
    'icon',
    'text',
    'info',
    'span',
    'link',
    'card'
  ]);

  function isBiliActive() {
    return Boolean(currentSettings.enabled && currentSettings.bilibiliEnabled);
  }

  function applyDatasetFlags() {
    const root = document.documentElement;
    if (!root) return;
    root.dataset.bilitubeEnabled = isBiliActive() ? 'true' : 'false';
    root.dataset.bilitubeLive = currentSettings.bilibiliLiveFilter ? 'true' : 'false';
  }

  const SAFE_CORE_BILI_SELECTOR_BLOCKLIST = [
    '.bili-video-card__stats--text',
    '.bili-video-card__stats',
    '.bili-video-card__stats--item',
    '.bili-video-card__stats--left',
    '.bili-video-card__stats--icon',
    '.bili-video-card__stats--duration',
    '.bili-video-card__wrap',
    '.bili-video-card__image',
    '.bili-video-card__cover',
    '.bili-video-card__mask',
    '.bili-video-card__title',
    '.bili-video-card__subtitle',
    '.bili-video-card__info',
    '.bili-video-card__info--right',
    '.bili-video-card__info--bottom',
    '.bili-video-card__info--owner',
    '.bili-video-card__info--author',
    '.bili-video-card__info--date',
    '.bili-video-card__info--tit',
    '.bili-video-card__info--icon-text',
    '.bili-video-card.is-rcmd',
    '.is-rcmd',
    '.bili-video-card',
    '.bili-feed-card',
    '.feed-card',
    '.badge-text',
    '.badge'
  ];

  function isSafeBiliCosmeticSelector(sel) {
    if (!sel || typeof sel !== 'string') return false;
    const trimmed = sel.trim();
    if (!trimmed) return false;
    if (SAFE_CORE_BILI_SELECTOR_BLOCKLIST.includes(trimmed)) return false;
    if (
      /^(\.?bili-video-card__(stats|wrap|image|cover|mask|title|subtitle|info--(right|bottom|owner|author|date|tit|icon-text|no-interest)))$/i.test(
        trimmed
      )
    ) {
      return false;
    }
    return true;
  }

  function isSafeLearnedBiliSelector(sel) {
    if (!isSafeBiliCosmeticSelector(sel)) return false;
    return /ad|promo|commercial|synergy|cm|sponsor/i.test(sel);
  }

  /**
   * Dynamic Evolved CSS Injection (`applyEvolvedStyles()`)
   * Combines upstream biliCosmetics & locally learnedBiliSelectors,
   * validates every selector inside a DocumentFragment try/catch,
   * and chunks rules into groups of 25 under html:not([data-bilitube-enabled="false"]).
   */
  function applyEvolvedStyles() {
    const targetParent = document.head || document.documentElement;
    if (!targetParent) return;

    let styleEl = document.getElementById('bilitube-evolved-css');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'bilitube-evolved-css';
      targetParent.appendChild(styleEl);
    }

    const combined = [
      ...(Array.isArray(evolutionState.biliCosmetics) ? evolutionState.biliCosmetics : []),
      ...(Array.isArray(evolutionState.learnedBiliSelectors)
        ? evolutionState.learnedBiliSelectors
        : [])
    ];

    const frag = document.createDocumentFragment();
    const validSelectors = [];
    const seen = new Set();

    for (const rawSel of combined) {
      if (typeof rawSel !== 'string') continue;
      const sel = rawSel.trim();
      if (!sel || seen.has(sel) || !isSafeBiliCosmeticSelector(sel)) continue;
      try {
        frag.querySelector(sel);
        seen.add(sel);
        validSelectors.push(sel);
      } catch {
        // Malformed selector skipped safely
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
        `html:not([data-bilitube-enabled="false"]) :is(${chunk.join(', ')}) { display: none !important; }`
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
            biliPruneKeys: Array.isArray(evolutionState.biliPruneKeys)
              ? evolutionState.biliPruneKeys
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

  async function recordBlockedAd(count, savedSeconds = 0, reason = 'B站DOM广告隐藏') {
    const safeCount = Number(count) || 0;
    if (safeCount <= 0) return;
    try {
      await chrome.runtime.sendMessage({
        type: 'RECORD_BLOCK',
        site: 'bilibili',
        count: safeCount,
        savedSeconds: Number(savedSeconds) || 0,
        reason
      });
    } catch {
      // Extension context may be invalidated or service worker waking up
    }
  }

  async function reportLearnedHeuristic(selector, reason = 'B站新型推广标签特征') {
    if (!selector || typeof selector !== 'string') return;
    const trimmed = selector.trim();
    if (
      !trimmed ||
      !isSafeBiliCosmeticSelector(trimmed) ||
      reportedBiliSelectors.has(trimmed) ||
      AD_INDICATOR_SELECTORS.includes(trimmed) ||
      (Array.isArray(evolutionState.learnedBiliSelectors) &&
        evolutionState.learnedBiliSelectors.includes(trimmed))
    ) {
      return;
    }
    reportedBiliSelectors.add(trimmed);
    try {
      await chrome.runtime.sendMessage({
        type: 'REPORT_LEARNED_HEURISTIC',
        site: 'bilibili',
        selector: trimmed,
        reason
      });
    } catch {
      // Ignore transient runtime messaging errors
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
      bilibiliEnabled:
        typeof base.bilibiliEnabled === 'boolean'
          ? base.bilibiliEnabled
          : DEFAULT_SETTINGS.bilibiliEnabled,
      bilibiliLiveFilter:
        typeof base.bilibiliLiveFilter === 'boolean'
          ? base.bilibiliLiveFilter
          : DEFAULT_SETTINGS.bilibiliLiveFilter,
      bilibiliCleanUrl:
        typeof base.bilibiliCleanUrl === 'boolean'
          ? base.bilibiliCleanUrl
          : DEFAULT_SETTINGS.bilibiliCleanUrl,
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
      biliCosmetics: Array.isArray(raw.biliCosmetics)
        ? raw.biliCosmetics.filter(isSafeBiliCosmeticSelector)
        : [],
      learnedBiliSelectors: Array.isArray(raw.learnedBiliSelectors)
        ? raw.learnedBiliSelectors.filter(isSafeLearnedBiliSelector)
        : [],
      biliPruneKeys: Array.isArray(raw.biliPruneKeys) ? raw.biliPruneKeys : []
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

  function findCardContainer(el) {
    if (!el || typeof el.closest !== 'function') return el;
    // Check .feed-card FIRST so SSR outer grid wrapper is collapsed instead of leaving an empty shell
    return (
      el.closest('.feed-card') ||
      el.closest('.bili-feed-card') ||
      el.closest('.floor-single-card') ||
      el.closest('.bili-video-card') ||
      el.closest('.video-page-special-card-small') ||
      el.closest('[class*="feed-card"]') ||
      el.closest('[class*="video-card"]') ||
      el
    );
  }

  function hideElementOnce(target) {
    if (!target || !(target instanceof HTMLElement)) return false;
    if (target.dataset.bilitubeHidden === '1') return false;
    target.dataset.bilitubeHidden = '1';
    target.style.setProperty('display', 'none', 'important');
    return true;
  }

  function extractSpecificBadgeSelector(badgeEl) {
    if (!badgeEl || !(badgeEl instanceof HTMLElement) || !badgeEl.classList) return null;
    for (const cls of Array.from(badgeEl.classList)) {
      const clean = cls.trim();
      if (!clean || clean.length < 4 || GENERIC_CLASS_IGNORE.has(clean)) continue;
      // Only learn classes that explicitly carry ad/promo/commercial/synergy semantics
      if (!/ad|promo|commercial|synergy|cm|sponsor/i.test(clean)) continue;
      if (/^[a-zA-Z0-9_-]+$/.test(clean)) {
        const sel = `.${CSS.escape(clean)}`;
        if (isSafeLearnedBiliSelector(sel) && !AD_INDICATOR_SELECTORS.includes(sel)) {
          return sel;
        }
      }
    }
    return null;
  }

  const PLAYER_MUTATION_IGNORE_SELECTOR =
    '.bpx-player-container, .bpx-player-row-dm-wrap, .bpx-player-dm-wrap, .bpx-player-control-wrap, .bpx-player-subtitle-wrap, .bpx-player-sending-bar, #danmukuBox';

  let scanTimer = null;

  /**
   * Zero-Day Semantic Heuristic DOM Scanner (Class-Mutation Immune & Zero-Reflow)
   * Scans feed cards for commercial target links or semantic promotion badges
   * without calling getBoundingClientRect() or getComputedStyle().
   */
  function runHeuristicFeedCardScan() {
    let heuristicHiddenCount = 0;
    const cards = document.querySelectorAll(
      '.feed-card, .bili-feed-card, .bili-video-card, [class*="feed-card"], [class*="video-card"]'
    );

    for (const card of cards) {
      if (
        !(card instanceof HTMLElement) ||
        card.dataset.bilitubeHidden === '1' ||
        card.dataset.bilitubeScanned === '1'
      ) {
        continue;
      }
      const outerCard = findCardContainer(card);
      if (outerCard instanceof HTMLElement && outerCard.dataset.bilitubeHidden === '1') continue;

      let matchedHeuristic = false;
      let matchedBadgeEl = null;

      // 1. Check if the card is a Bilibili anti-adblock gray placeholder box ("该内容被AdGuard/AdBlock类插件屏蔽")
      const fullCardText = card.textContent || '';
      if (
        fullCardText.includes('AdBlock类插件屏蔽') ||
        fullCardText.includes('该内容被AdGuard') ||
        fullCardText.includes('恢复正常内容展示')
      ) {
        matchedHeuristic = true;
      }

      // 2. Check if the card contains any <a> with commercial/promo href
      if (!matchedHeuristic) {
        const links = card.querySelectorAll('a[href]');
        for (const link of links) {
          const href = link.getAttribute('href') || link.href || '';
          if (HEURISTIC_AD_HREF_PATTERNS.some((pattern) => href.includes(pattern))) {
            matchedHeuristic = true;
            break;
          }
        }
      }

      // 3. Check if the card contains any leaf badge/tag element with exact ad/promo text (zero-reflow)
      if (!matchedHeuristic) {
        const badgeCandidates = card.querySelectorAll('span, div, i, em');
        for (const candidate of badgeCandidates) {
          if (!(candidate instanceof HTMLElement)) continue;
          if (candidate.children.length > 0) continue;
          const text = (candidate.textContent || '').trim();
          if (!text || text.length > 6 || !HEURISTIC_BADGE_TEXTS.includes(text)) continue;

          matchedHeuristic = true;
          matchedBadgeEl = candidate;
          break;
        }
      }

      if (matchedHeuristic) {
        const targetToHide = outerCard instanceof HTMLElement ? outerCard : card;
        if (hideElementOnce(targetToHide)) {
          card.dataset.bilitubeHidden = '1';
          heuristicHiddenCount += 1;

          if (matchedBadgeEl) {
            const learnedSelector = extractSpecificBadgeSelector(matchedBadgeEl);
            if (learnedSelector) {
              void reportLearnedHeuristic(learnedSelector, 'B站新型推广标签特征');
            }
          }
        }
      } else if (
        card.querySelector('.bili-video-card__info--tit, .bili-video-card__wrap, .card-box')
      ) {
        // Mark hydrated clean cards so they are not re-scanned on subsequent mutations
        card.dataset.bilitubeScanned = '1';
      }
    }

    if (heuristicHiddenCount > 0) {
      void recordBlockedAd(
        heuristicHiddenCount,
        heuristicHiddenCount * 4,
        'B站启发式自进化拦截'
      );
    }
  }

  let autoTopUpCount = 0;
  let lastAutoTopUpTs = 0;

  function ensureHomepageFeedFilled() {
    if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') return;
    if (autoTopUpCount >= 3) return;
    const container = document.querySelector(
      '.container.is-version8, .recommended-container_floor-aside .container'
    );
    if (!container) return;

    const visibleVideoCards = container.querySelectorAll('.bili-video-card__wrap');
    let visibleCount = 0;
    for (const wrap of visibleVideoCards) {
      const card = findCardContainer(wrap);
      if (
        card instanceof HTMLElement &&
        card.dataset.bilitubeHidden !== '1' &&
        !card.hidden
      ) {
        visibleCount += 1;
      }
    }

    const now = Date.now();
    if (visibleCount > 0 && visibleCount < 12 && now - lastAutoTopUpTs > 900) {
      lastAutoTopUpTs = now;
      autoTopUpCount += 1;
      window.dispatchEvent(new Event('scroll'));
    }
  }

  function performDomScan() {
    rafScheduled = false;
    scanTimer = null;
    if (!isBiliActive()) return;

    if (document.documentElement && !document.documentElement.dataset.bilitubeEnabled) {
      applyDatasetFlags();
    }
    const existingStyle = document.getElementById('bilitube-evolved-css');
    if (
      !existingStyle ||
      (!existingStyle.textContent &&
        ((evolutionState.biliCosmetics && evolutionState.biliCosmetics.length > 0) ||
          (evolutionState.learnedBiliSelectors && evolutionState.learnedBiliSelectors.length > 0)))
    ) {
      applyEvolvedStyles();
    }

    let newlyHiddenCount = 0;

    const activeSelectors = [...AD_INDICATOR_SELECTORS];
    if (currentSettings.bilibiliLiveFilter) {
      activeSelectors.push(...LIVE_INDICATOR_SELECTORS);
    }

    const matchedElements = document.querySelectorAll(activeSelectors.join(', '));
    for (const el of matchedElements) {
      const container = findCardContainer(el);
      if (hideElementOnce(container)) {
        newlyHiddenCount += 1;
      }
    }

    // Only run hollow-card offsetParent layout checks on Bilibili homepage to avoid
    // synchronous layout reflows during video playback on /video/ watch pages.
    const isHomepage =
      window.location.pathname === '/' || window.location.pathname === '/index.html';

    if (isHomepage) {
      // Collapse any .feed-card / .bili-feed-card whose inner .bili-video-card or .bili-video-card__wrap
      // was hidden by CSS/uBlock Origin (which otherwise exposes "该内容被AdGuard/AdBlock类插件屏蔽")
      const feedCards = document.querySelectorAll('.feed-card, .bili-feed-card');
      for (const fc of feedCards) {
        if (
          !(fc instanceof HTMLElement) ||
          fc.dataset.bilitubeHidden === '1' ||
          fc.dataset.bilitubeHollowChecked === '1'
        ) {
          continue;
        }
        if (fc.offsetParent === null) continue;
        const vcard = fc.querySelector('.bili-video-card');
        const wrap = fc.querySelector('.bili-video-card__wrap');
        if (
          !vcard ||
          !wrap ||
          !(vcard instanceof HTMLElement) ||
          !(wrap instanceof HTMLElement) ||
          vcard.offsetParent === null ||
          wrap.offsetParent === null
        ) {
          const outer = fc.closest('.feed-card') || fc;
          if (hideElementOnce(outer)) {
            fc.dataset.bilitubeHidden = '1';
            newlyHiddenCount += 1;
          }
        } else {
          fc.dataset.bilitubeHollowChecked = '1';
        }
      }

      // Also collapse standalone .container > .bili-video-card skeleton placeholders
      const standaloneCards = document.querySelectorAll('.container > .bili-video-card');
      for (const sc of standaloneCards) {
        if (
          !(sc instanceof HTMLElement) ||
          sc.dataset.bilitubeHidden === '1' ||
          sc.dataset.bilitubeHollowChecked === '1'
        ) {
          continue;
        }
        const wrap = sc.querySelector('.bili-video-card__wrap');
        if (!wrap || !(wrap instanceof HTMLElement) || wrap.offsetParent === null) {
          if (hideElementOnce(sc)) {
            newlyHiddenCount += 1;
          }
        } else {
          sc.dataset.bilitubeHollowChecked = '1';
        }
      }
    }

    // Check top navbar popover promo entries (会员购 / 游戏中心 / 漫画)
    const navWraps = document.querySelectorAll('.v-popover-wrap, .right-entry-item');
    for (const wrap of navWraps) {
      if (
        !(wrap instanceof HTMLElement) ||
        wrap.dataset.bilitubeHidden === '1' ||
        wrap.dataset.bilitubeNavChecked === '1'
      ) {
        continue;
      }
      wrap.dataset.bilitubeNavChecked = '1';
      const link = wrap.querySelector(
        'a[href*="show.bilibili.com"], a[href*="game.bilibili.com"], a[href*="manga.bilibili.com"]'
      );
      const text = (wrap.textContent || '').trim();
      if (link && PROMO_NAV_KEYWORDS.some((kw) => text.includes(kw))) {
        if (hideElementOnce(wrap)) {
          newlyHiddenCount += 1;
        }
      }
    }

    if (newlyHiddenCount > 0) {
      void recordBlockedAd(newlyHiddenCount, newlyHiddenCount * 3, 'B站DOM广告卡片移除');
    }

    // Zero-Day Semantic Heuristic DOM Scanner when selfEvolution is active
    if (currentSettings.selfEvolution !== false) {
      runHeuristicFeedCardScan();
    }

    // Ensure homepage grid immediately tops up if initial ad/live cards were removed
    ensureHomepageFeedFilled();
  }

  function scheduleDomScan() {
    if (rafScheduled || scanTimer !== null || !isBiliActive()) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (!rafScheduled && isBiliActive()) {
        rafScheduled = true;
        requestAnimationFrame(performDomScan);
      }
    }, 220);
  }

  // Apply default dataset flags immediately at document_start
  applyDatasetFlags();
  applyEvolvedStyles();
  postConfigToMain();
  void loadSettingsAndEvolution();

  // Listen for MAIN world AD_BLOCKED notifications
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'bilitube-main') return;
    if (data.type === 'AD_BLOCKED') {
      void recordBlockedAd(data.count, data.savedSeconds, data.reason);
    } else if (data.type === 'HEURISTIC_LEARNED' && data.selector) {
      void reportLearnedHeuristic(data.selector, data.reason || 'B站启发式自进化特征');
    }
  });

  // Listen for runtime messages from popup / service worker
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message?.type === 'PING') {
        sendResponse({ ok: true, pong: true });
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

  // Keep in sync with storage changes (settings & evolution)
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

  // Throttled MutationObserver ignoring video player danmaku & control bar mutations
  const observer = new MutationObserver((mutations) => {
    if (rafScheduled || scanTimer !== null || !isBiliActive()) return;
    let relevant = false;
    for (const m of mutations) {
      if (!m.addedNodes || m.addedNodes.length === 0) continue;
      if (
        m.target instanceof Element &&
        m.target.closest(PLAYER_MUTATION_IGNORE_SELECTOR)
      ) {
        continue;
      }
      relevant = true;
      break;
    }
    if (relevant) {
      scheduleDomScan();
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
