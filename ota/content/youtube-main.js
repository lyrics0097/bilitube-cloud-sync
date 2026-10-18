/**
 * BiliTube AdShield Pro v2.0.0 — YouTube Main World Engine (Self-Evolving Heuristic Edition)
 * Runs at document_start in MAIN world to:
 * 1. Guard HTMLMediaElement.prototype.pause against anti-adblock abnormality/enforcement pauses
 * 2. Perform response text stream replacements (ytTextReplaces) & dynamic key pruning (ytPruneKeys)
 * 3. Detect & instant-skip video ads via both known selectors and Zero-Day Heuristics
 * 4. Defuse anti-adblock enforcement dialogs (including heuristic text inspection) and resume playback
 */
(() => {
  'use strict';

  if (window.__bilitubeYtMainLoaded) return;
  window.__bilitubeYtMainLoaded = true;

  const config = {
    enabled: true,
    youtubeEnabled: true,
    youtubeAntiDetect: true,
    selfEvolution: true,
    ytPruneKeys: [],
    ytTextReplaces: []
  };

  const YT_API_PATTERNS = [
    '/youtubei/v1/player',
    '/youtubei/v1/next',
    '/youtubei/v1/browse',
    '/youtubei/v1/search'
  ];

  const TOP_LEVEL_AD_KEYS = [
    'adPlacements',
    'adSlots',
    'playerAds',
    'adBreakHeartbeatParams'
  ];

  const RENDERER_AD_KEYS = [
    'adSlotRenderer',
    'promotedSparklesWebRenderer',
    'inFeedAdLayoutRenderer',
    'mastheadAdRenderer',
    'statementBannerRenderer',
    'brandVideoShelfRenderer',
    'bannerPromoRenderer',
    'actionCompanionAdRenderer',
    'promotedVideoRenderer',
    'compactPromotedVideoRenderer'
  ];

  const SKIP_BUTTON_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-overlay-close-button'
  ];

  const HEURISTIC_SKIP_TEXT_REGEX = /^(跳过广告|Skip\s*Ads?)$/i;
  const HEURISTIC_SKIP_CLASS_REGEX = /skip.*ad|ad.*skip/i;
  const HEURISTIC_AD_BADGE_TEXTS = ['赞助商广告', 'Sponsored', 'Ad ·'];
  const ENFORCEMENT_DIALOG_KEYWORDS = [
    '广告拦截器',
    'Ad blockers are not allowed',
    '允许 YouTube Ads',
    '视频播放器将被屏蔽'
  ];

  // Media stream & timing keys that must NEVER be recursively traversed or mutated
  const SAFE_MEDIA_KEYS_SKIP = new Set([
    'streamingData',
    'storyboards',
    'captions',
    'microformat',
    'playbackTracking',
    'attestation',
    'videoDetails',
    'annotations',
    'endscreen'
  ]);

  let wasInAdState = false;
  let savedMuted = false;
  let savedPlaybackRate = 1.0;
  let lastAdNotifyTimestamp = 0;
  let lastAdSeekTimestamp = 0;
  let checkRafScheduled = false;
  let dialogCheckTimer = null;
  let expectedMainDuration = 0;
  let observedMoviePlayer = null;
  const learnedSkipSelectors = new Set();

  function isActive() {
    return Boolean(config.enabled && config.youtubeEnabled);
  }

  function notifyBlocked(count, savedSeconds = 0, reason = '') {
    const safeCount = Number(count) || 0;
    if (safeCount <= 0) return;
    try {
      window.postMessage(
        {
          source: 'bilitube-main',
          type: 'AD_BLOCKED',
          site: 'youtube',
          count: safeCount,
          savedSeconds: Number(savedSeconds) || 0,
          reason: String(reason || 'YouTube广告拦截')
        },
        '*'
      );
    } catch {
      // Ignore cross-window messaging errors
    }
  }

  function notifyHeuristicLearned(selector, reason = 'YouTube新型跳过按钮特征') {
    if (!selector || typeof selector !== 'string') return;
    const trimmed = selector.trim();
    if (!trimmed || learnedSkipSelectors.has(trimmed) || SKIP_BUTTON_SELECTORS.includes(trimmed)) {
      return;
    }
    learnedSkipSelectors.add(trimmed);
    try {
      window.postMessage(
        {
          source: 'bilitube-main',
          type: 'HEURISTIC_LEARNED',
          site: 'youtube',
          selector: trimmed,
          reason
        },
        '*'
      );
    } catch {
      // Ignore cross-window messaging errors
    }
  }

  function updateExpectedMainDuration(payload) {
    if (!payload || typeof payload !== 'object') return;
    const rawLen =
      payload.videoDetails?.lengthSeconds ??
      payload.playerResponse?.videoDetails?.lengthSeconds;
    const parsed = Number(rawLen);
    if (Number.isFinite(parsed) && parsed > 0) {
      expectedMainDuration = parsed;
    }
  }

  // =========================================================================
  // 1. Anti-Adblock `HTMLMediaElement.prototype.pause` Guard
  // =========================================================================
  const originalMediaPause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function (...args) {
    if (isActive() && config.youtubeAntiDetect) {
      try {
        const hasEnforcementModal = Boolean(
          document.querySelector('ytd-enforcement-message-view-model')
        );
        const stack = String(new Error().stack || '');
        const isEnforcementPause =
          hasEnforcementModal ||
          stack.includes('onAbnormalityDetected') ||
          stack.includes('enforcement');

        if (isEnforcementPause) {
          scheduleChecks();
          return undefined;
        }
      } catch {
        // Proceed to normal pause on error
      }
    }
    return originalMediaPause.apply(this, args);
  };

  // =========================================================================
  // 2. JSON Pruning Engine, Text Stream Replacement & JSON.stringify Hook
  // =========================================================================
  const originalJsonStringify = JSON.stringify;
  JSON.stringify = function (value, replacer, space) {
    if (
      isActive() &&
      config.youtubeAntiDetect &&
      value &&
      typeof value === 'object' &&
      'attestationRequest' in value &&
      value.context &&
      typeof value.context === 'object'
    ) {
      try {
        if (value.playbackContext?.contentPlaybackContext) {
          value.playbackContext.contentPlaybackContext.vis = 0;
        }
      } catch {
        // Ignore read-only request fields
      }
    }
    return originalJsonStringify.call(this, value, replacer, space);
  };

  function isAdItemObject(item) {
    if (!item || typeof item !== 'object') return false;
    for (const key of RENDERER_AD_KEYS) {
      if (key in item) return true;
    }
    if (Array.isArray(config.ytPruneKeys)) {
      for (const dynKey of config.ytPruneKeys) {
        if (typeof dynKey === 'string' && !dynKey.includes('.') && dynKey in item) return true;
      }
    }
    if (item.richItemRenderer?.content) {
      for (const key of RENDERER_AD_KEYS) {
        if (key in item.richItemRenderer.content) return true;
      }
      if (Array.isArray(config.ytPruneKeys)) {
        for (const dynKey of config.ytPruneKeys) {
          if (
            typeof dynKey === 'string' &&
            !dynKey.includes('.') &&
            dynKey in item.richItemRenderer.content
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function pruneByDotPath(obj, dotPath) {
    if (!obj || typeof obj !== 'object' || typeof dotPath !== 'string' || !dotPath.includes('.')) {
      return 0;
    }
    if (dotPath.includes('ssapConfig') || dotPath.includes('streamingData')) {
      return 0;
    }
    const parts = dotPath
      .split('.')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length < 2) return 0;

    let current = obj;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!current || typeof current !== 'object') return 0;
      current = current[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (current && typeof current === 'object' && last in current && current[last] !== undefined) {
      const val = current[last];
      delete current[last];
      return Array.isArray(val) ? Math.max(1, val.length) : 1;
    }
    return 0;
  }

  function pruneYouTubePayload(obj, seen = new WeakSet(), isRoot = true) {
    if (!isActive() || !obj || typeof obj !== 'object') return 0;
    if (seen.has(obj)) return 0;
    seen.add(obj);

    if (isRoot) {
      updateExpectedMainDuration(obj);
    }

    let prunedCount = 0;

    const activeTopKeys = [...TOP_LEVEL_AD_KEYS];
    if (Array.isArray(config.ytPruneKeys)) {
      for (const customKey of config.ytPruneKeys) {
        if (typeof customKey !== 'string' || !customKey.trim()) continue;
        if (customKey.includes('ssapConfig') || customKey.includes('streamingData')) continue;
        if (customKey.includes('.')) {
          if (isRoot) {
            prunedCount += pruneByDotPath(obj, customKey);
          }
        } else if (!activeTopKeys.includes(customKey)) {
          activeTopKeys.push(customKey);
        }
      }
    }

    for (const adKey of activeTopKeys) {
      if (adKey in obj && obj[adKey] !== undefined) {
        const val = obj[adKey];
        prunedCount += Array.isArray(val) ? Math.max(1, val.length) : 1;
        delete obj[adKey];
      }
    }

    if (obj.playerResponse && typeof obj.playerResponse === 'object') {
      prunedCount += pruneYouTubePayload(obj.playerResponse, seen, true);
    }

    for (const key of Object.keys(obj)) {
      if (SAFE_MEDIA_KEYS_SKIP.has(key) || key === 'playerResponse') continue;
      const val = obj[key];
      if (!val || typeof val !== 'object') continue;

      if (Array.isArray(val)) {
        const before = val.length;
        const filtered = val.filter((entry) => !isAdItemObject(entry));
        if (filtered.length !== before) {
          prunedCount += before - filtered.length;
          obj[key] = filtered;
        }
        for (const item of obj[key]) {
          if (item && typeof item === 'object') {
            prunedCount += pruneYouTubePayload(item, seen, false);
          }
        }
      } else {
        prunedCount += pruneYouTubePayload(val, seen, false);
      }
    }

    return prunedCount;
  }

  /**
   * Applies ytTextReplaces rules on raw JSON text for /youtubei/v1/player and /youtubei/v1/next
   */
  function applyResponseTextReplaces(urlStr, rawText) {
    if (
      !rawText ||
      typeof rawText !== 'string' ||
      (!urlStr.includes('/youtubei/v1/player') && !urlStr.includes('/youtubei/v1/next'))
    ) {
      return { text: rawText, replacedCount: 0 };
    }

    let text = rawText;
    let replacedCount = 0;

    const rules = Array.isArray(config.ytTextReplaces) ? config.ytTextReplaces : [];
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object') continue;
      const findStr = rule.find ?? rule.pattern ?? rule.from;
      const replaceStr = rule.replace ?? rule.replacement ?? rule.to ?? '';
      if (typeof findStr === 'string' && findStr.length > 0 && text.includes(findStr)) {
        text = text.split(findStr).join(String(replaceStr));
        replacedCount += 1;
      }
    }

    return { text, replacedCount };
  }

  function hookGlobalProperty(propName) {
    try {
      let currentValue = window[propName];
      if (currentValue && typeof currentValue === 'object') {
        const count = pruneYouTubePayload(currentValue);
        if (count > 0) notifyBlocked(count, count * 15, `YouTube ${propName} 净化`);
      }

      Object.defineProperty(window, propName, {
        configurable: true,
        enumerable: true,
        get() {
          return currentValue;
        },
        set(newVal) {
          if (isActive() && newVal && typeof newVal === 'object') {
            const count = pruneYouTubePayload(newVal);
            if (count > 0) notifyBlocked(count, count * 15, `YouTube ${propName} 净化`);
          }
          currentValue = newVal;
        }
      });
    } catch {
      // Property might already be locked by another extension
    }
  }

  hookGlobalProperty('ytInitialPlayerResponse');
  hookGlobalProperty('ytInitialData');

  function matchesYouTubeApi(urlStr) {
    if (typeof urlStr !== 'string') return false;
    return YT_API_PATTERNS.some((pattern) => urlStr.includes(pattern));
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    if (!isActive()) return response;

    try {
      const requestInfo = args[0];
      const urlStr =
        typeof requestInfo === 'string'
          ? requestInfo
          : requestInfo?.url || response?.url || '';

      if (!matchesYouTubeApi(urlStr)) return response;

      const cloned = response.clone();
      const rawText = await cloned.text();
      if (!rawText) return response;

      const { text: replacedText, replacedCount } = applyResponseTextReplaces(urlStr, rawText);
      const data = JSON.parse(replacedText);
      const prunedCount = pruneYouTubePayload(data);
      const totalCount = prunedCount + replacedCount;

      if (!totalCount) return response;

      notifyBlocked(totalCount, totalCount * 15, 'YouTube API 载荷净化');

      const cleanHeaders = new Headers(response.headers);
      cleanHeaders.delete('content-length');
      cleanHeaders.delete('content-encoding');

      return new Response(originalJsonStringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers: cleanHeaders
      });
    } catch {
      return response;
    }
  };

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  function attachYtXhrInterceptor(xhr) {
    if (xhr.__bilitubeYtXhrHooked) return;
    xhr.__bilitubeYtXhrHooked = true;
    xhr.addEventListener('readystatechange', function () {
      if (this.readyState !== 4 || !isActive() || !matchesYouTubeApi(this.__bilitubeYtUrl)) return;
      try {
        const rType = this.responseType;
        if (rType === '' || rType === 'text') {
          const rawText = this.responseText;
          if (!rawText) return;
          const { text: replacedText, replacedCount } = applyResponseTextReplaces(
            this.__bilitubeYtUrl,
            rawText
          );
          const parsed = JSON.parse(replacedText);
          const prunedCount = pruneYouTubePayload(parsed);
          const totalCount = prunedCount + replacedCount;
          if (!totalCount) return;
          notifyBlocked(totalCount, totalCount * 15, 'YouTube XHR 载荷净化');
          const serialized = originalJsonStringify(parsed);
          Object.defineProperty(this, 'responseText', {
            configurable: true,
            get: () => serialized
          });
          Object.defineProperty(this, 'response', {
            configurable: true,
            get: () => serialized
          });
        } else if (rType === 'json' && this.response && typeof this.response === 'object') {
          const count = pruneYouTubePayload(this.response);
          if (count > 0) {
            notifyBlocked(count, count * 15, 'YouTube XHR 载荷净化');
          }
        }
      } catch {
        // Ignore non-JSON XHR responses
      }
    });
  }

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      this.__bilitubeYtUrl = typeof url === 'string' ? url : String(url || '');
      if (matchesYouTubeApi(this.__bilitubeYtUrl)) {
        attachYtXhrInterceptor(this);
      }
    } catch {
      this.__bilitubeYtUrl = '';
    }
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (isActive() && matchesYouTubeApi(this.__bilitubeYtUrl)) {
      attachYtXhrInterceptor(this);
    }
    return originalXhrSend.apply(this, args);
  };

  // =========================================================================
  // 3. Zero-Day Heuristic Video Ad & Skip Button Detector (`handleYouTubeVideoAd`)
  // =========================================================================
  function isElementVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    return el.offsetParent !== null;
  }

  function detectZeroDayAdAndSkipButtons(player) {
    if (config.selfEvolution === false) {
      return { isHeuristicAd: false, heuristicSkipButtons: [] };
    }

    // Only scan inside .ytp-ad-module or when ad overlay containers exist
    // so normal video playback (and SponsorBlock skip buttons) are never misidentified as ads
    const adModule = player.querySelector(
      '.ytp-ad-module, .ytp-ad-player-overlay, .ytp-ad-player-overlay-layout'
    );
    if (!adModule || adModule.children.length === 0) {
      return { isHeuristicAd: false, heuristicSkipButtons: [] };
    }

    let isHeuristicAd = false;
    const heuristicSkipButtons = [];

    const buttons = adModule.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      if (!(btn instanceof HTMLElement) || !isElementVisible(btn)) continue;
      const text = (btn.textContent || '').trim();
      const classStr = typeof btn.className === 'string' ? btn.className : '';

      const matchesSkipText = HEURISTIC_SKIP_TEXT_REGEX.test(text);
      const matchesSkipClass = HEURISTIC_SKIP_CLASS_REGEX.test(classStr);

      if (matchesSkipText || matchesSkipClass) {
        isHeuristicAd = true;
        heuristicSkipButtons.push(btn);

        if (btn.classList && btn.classList.length > 0) {
          for (const cls of Array.from(btn.classList)) {
            if (!cls || cls.length < 4) continue;
            const candidateSelector = `.${CSS.escape(cls)}`;
            if (
              !SKIP_BUTTON_SELECTORS.includes(candidateSelector) &&
              (HEURISTIC_SKIP_CLASS_REGEX.test(cls) || matchesSkipText)
            ) {
              notifyHeuristicLearned(candidateSelector, 'YouTube新型跳过按钮特征');
            }
          }
        }
      }
    }

    if (!isHeuristicAd) {
      const badges = adModule.querySelectorAll('span, div');
      for (const badge of badges) {
        if (!(badge instanceof HTMLElement) || badge.children.length > 0) continue;
        const text = (badge.textContent || '').trim();
        if (!text) continue;
        if (
          HEURISTIC_AD_BADGE_TEXTS.some((kw) => text === kw || text.startsWith(kw)) &&
          isElementVisible(badge)
        ) {
          isHeuristicAd = true;
          break;
        }
      }
    }

    return { isHeuristicAd, heuristicSkipButtons };
  }

  function handleYouTubeVideoAd() {
    if (!isActive()) return;

    const player = document.getElementById('movie_player');
    if (!player) return;

    ensurePlayerClassObserver(player);

    const video = player.querySelector('video.html5-main-video') || player.querySelector('video');
    const isKnownAdShowing =
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting') ||
      Boolean(player.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout'));

    const { isHeuristicAd, heuristicSkipButtons } = detectZeroDayAdAndSkipButtons(player);
    const isAdShowing = isKnownAdShowing || isHeuristicAd;

    if (isAdShowing) {
      if (!wasInAdState) {
        wasInAdState = true;
        if (video) {
          savedMuted = video.muted;
          savedPlaybackRate =
            video.playbackRate && video.playbackRate <= 2 ? video.playbackRate : 1.0;
        }
      }

      // 1. Click any available known skip or overlay close button first
      const allSkipSelectors = [...SKIP_BUTTON_SELECTORS, ...learnedSkipSelectors];
      const skipButtons = player.querySelectorAll(allSkipSelectors.join(', '));
      let clickedSkip = false;
      for (const btn of skipButtons) {
        if (btn instanceof HTMLElement) {
          try {
            btn.click();
            clickedSkip = true;
          } catch {
            // Ignore click errors
          }
        }
      }

      // 2. Click any zero-day heuristic skip buttons discovered
      for (const btn of heuristicSkipButtons) {
        try {
          btn.click();
          clickedSkip = true;
        } catch {
          // Ignore click errors
        }
      }

      // 3. Trigger YouTube's internal player API ad-finish hooks if available
      try {
        if (typeof player.finishAd === 'function') {
          player.finishAd();
          clickedSkip = true;
        } else if (typeof player.skipAd === 'function') {
          player.skipAd();
          clickedSkip = true;
        }
      } catch {
        // Ignore player internal API errors
      }

      // 4. Gently mute and seek once per ad clip (avoiding 16x rate or repeated seek storms that cause MSE audio-video desync)
      if (video) {
        video.muted = true;
        const now = Date.now();
        if (
          !clickedSkip &&
          !video.seeking &&
          Number.isFinite(video.duration) &&
          video.duration > 0.5 &&
          video.currentTime < video.duration - 0.3 &&
          now - lastAdSeekTimestamp > 600
        ) {
          lastAdSeekTimestamp = now;
          try {
            video.currentTime = Math.max(0, video.duration - 0.15);
          } catch {
            // Ignore seek restrictions
          }
        }
      }

      const now = Date.now();
      if (now - lastAdNotifyTimestamp > 1500) {
        lastAdNotifyTimestamp = now;
        notifyBlocked(
          1,
          15,
          isHeuristicAd && !isKnownAdShowing ? 'YouTube启发式贴片广告秒跳' : 'YouTube贴片广告秒跳'
        );
      }
    } else if (wasInAdState) {
      wasInAdState = false;
      if (video) {
        video.muted = savedMuted;
        if (Math.abs(video.playbackRate - (savedPlaybackRate || 1.0)) > 0.01) {
          try {
            video.playbackRate = savedPlaybackRate || 1.0;
          } catch {
            video.playbackRate = 1.0;
          }
        }
      }
    }
  }

  // =========================================================================
  // 4. Zero-Day Anti-Adblock Modal Heuristic Defuser (`bypassEnforcementDialog`)
  // =========================================================================
  function bypassEnforcementDialog() {
    if (!isActive() || !config.youtubeAntiDetect) return;

    let removedAny = false;

    const enforcementEl = document.querySelector(
      'ytd-enforcement-message-view-model, tp-yt-paper-dialog:has(ytd-enforcement-message-view-model), yt-playability-error-supported-renderers:has(ytd-enforcement-message-view-model)'
    );
    if (enforcementEl) {
      const dialog = enforcementEl.closest('tp-yt-paper-dialog') || enforcementEl;
      dialog.remove();
      removedAny = true;
    }

    // Zero-Day Heuristic inspection of open tp-yt-paper-dialog elements
    const dialogs = document.querySelectorAll('tp-yt-paper-dialog');
    for (const dialog of dialogs) {
      if (!(dialog instanceof HTMLElement)) continue;
      const text = dialog.textContent || '';
      if (ENFORCEMENT_DIALOG_KEYWORDS.some((kw) => text.includes(kw))) {
        dialog.remove();
        removedAny = true;
      }
    }

    if (!removedAny) return;

    const backdrops = document.querySelectorAll('tp-yt-iron-overlay-backdrop');
    for (const backdrop of backdrops) {
      backdrop.remove();
    }

    if (document.body) {
      document.body.style.removeProperty('overflow');
    }
    if (document.documentElement) {
      document.documentElement.style.removeProperty('overflow');
    }

    const video = document.querySelector('#movie_player video');
    if (video && video.paused) {
      (async () => {
        try {
          await video.play();
        } catch {
          // Autoplay may require user interaction
        }
      })();
    }

    notifyBlocked(1, 10, 'YouTube反屏蔽弹窗解除');
  }

  function runPlayerAndDialogChecks() {
    checkRafScheduled = false;
    dialogCheckTimer = null;
    if (!isActive()) return;
    handleYouTubeVideoAd();
    bypassEnforcementDialog();
  }

  function scheduleChecks() {
    if (checkRafScheduled || !isActive()) return;
    checkRafScheduled = true;
    requestAnimationFrame(runPlayerAndDialogChecks);
  }

  function scheduleThrottledChecks() {
    if (checkRafScheduled || dialogCheckTimer !== null || !isActive()) return;
    dialogCheckTimer = setTimeout(() => {
      dialogCheckTimer = null;
      scheduleChecks();
    }, 300);
  }

  // Dedicated lightweight observer only for #movie_player class changes (ad-showing / ad-interrupting)
  const playerClassObserver = new MutationObserver(() => {
    scheduleChecks();
  });

  function ensurePlayerClassObserver(player) {
    if (!player || observedMoviePlayer === player) return;
    observedMoviePlayer = player;
    playerClassObserver.disconnect();
    playerClassObserver.observe(player, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  const observer = new MutationObserver((mutations) => {
    if (checkRafScheduled || dialogCheckTimer !== null || !isActive()) return;
    let shouldSchedule = false;
    for (const m of mutations) {
      if (!m.addedNodes || m.addedNodes.length === 0) continue;
      if (
        m.target instanceof Element &&
        m.target.closest('.ytp-chrome-bottom, .ytp-caption-window-container')
      ) {
        continue;
      }
      shouldSchedule = true;
      break;
    }
    if (shouldSchedule) {
      scheduleThrottledChecks();
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
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
        scheduleChecks();
      },
      { once: true }
    );
  }

  // Listen to video loadedmetadata & timeupdate only when an ad is actually showing
  document.addEventListener(
    'loadedmetadata',
    (e) => {
      if (e.target instanceof HTMLVideoElement) scheduleChecks();
    },
    true
  );

  document.addEventListener(
    'timeupdate',
    (e) => {
      if (e.target instanceof HTMLVideoElement) {
        const player = document.getElementById('movie_player');
        if (
          player &&
          (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))
        ) {
          scheduleChecks();
        }
      }
    },
    true
  );

  // =========================================================================
  // 5. Listen for Configuration & Evolution Sync from Isolated World
  // =========================================================================
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'bilitube-isolated' || msg.type !== 'CONFIG_SYNC') return;

    const settings = msg.settings;
    if (settings && typeof settings === 'object') {
      if (typeof settings.enabled === 'boolean') config.enabled = settings.enabled;
      if (typeof settings.youtubeEnabled === 'boolean') {
        config.youtubeEnabled = settings.youtubeEnabled;
      }
      if (typeof settings.youtubeAntiDetect === 'boolean') {
        config.youtubeAntiDetect = settings.youtubeAntiDetect;
      }
      if (typeof settings.selfEvolution === 'boolean') {
        config.selfEvolution = settings.selfEvolution;
      }
    }

    const evolution = msg.evolution;
    if (evolution && typeof evolution === 'object') {
      if (Array.isArray(evolution.ytPruneKeys)) {
        config.ytPruneKeys = evolution.ytPruneKeys;
      }
      if (Array.isArray(evolution.ytTextReplaces)) {
        config.ytTextReplaces = evolution.ytTextReplaces;
      }
      if (typeof evolution.selfEvolution === 'boolean') {
        config.selfEvolution = evolution.selfEvolution;
      }
    }

    scheduleChecks();
  });
})();
