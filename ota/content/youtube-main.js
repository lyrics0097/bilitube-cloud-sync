/**
 * BiliTube AdShield Pro v2.0.0 — YouTube Main World Engine (Self-Evolving Heuristic Edition)
 * Runs at document_start in MAIN world to:
 * 1. Guard HTMLMediaElement.prototype.pause against anti-adblock abnormality/enforcement pauses
 * 2. Prune top-level ad slots from ytInitialPlayerResponse / ytInitialData without breaking SPA fetch/XHR navigation
 * 3. Detect & instant-skip video ads strictly when #movie_player is in .ad-showing / .ad-interrupting state
 * 4. Defuse anti-adblock enforcement dialogs AND remove orphaned <tp-yt-iron-overlay-backdrop> so clicks are never blocked
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

  const TOP_LEVEL_AD_KEYS = [
    'adPlacements',
    'adSlots',
    'playerAds',
    'adBreakHeartbeatParams'
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
  const ENFORCEMENT_DIALOG_KEYWORDS = [
    '广告拦截器',
    'Ad blockers are not allowed',
    '允许 YouTube Ads',
    '视频播放器将被屏蔽'
  ];

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
          stack.includes('onAbnormalityDetected');

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
  // 2. Lightweight Top-Level Pruning for `ytInitialPlayerResponse` & `ytInitialData`
  //    (Never wraps window.fetch or XMLHttpRequest to preserve 100% native SPA navigation & response.url)
  // =========================================================================
  function pruneTopLevelYouTubeObject(obj) {
    if (!isActive() || !obj || typeof obj !== 'object') return 0;
    updateExpectedMainDuration(obj);

    let prunedCount = 0;
    for (const adKey of TOP_LEVEL_AD_KEYS) {
      if (adKey in obj && obj[adKey] !== undefined) {
        delete obj[adKey];
        prunedCount += 1;
      }
    }
    if (obj.playerResponse && typeof obj.playerResponse === 'object') {
      updateExpectedMainDuration(obj.playerResponse);
      for (const adKey of TOP_LEVEL_AD_KEYS) {
        if (adKey in obj.playerResponse && obj.playerResponse[adKey] !== undefined) {
          delete obj.playerResponse[adKey];
          prunedCount += 1;
        }
      }
    }
    return prunedCount;
  }

  function hookGlobalProperty(propName) {
    try {
      let currentValue = window[propName];
      if (currentValue && typeof currentValue === 'object') {
        const count = pruneTopLevelYouTubeObject(currentValue);
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
            const count = pruneTopLevelYouTubeObject(newVal);
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

  // =========================================================================
  // 3. Video Ad Detector & Instant Skipper (`handleYouTubeVideoAd`)
  // =========================================================================
  function isElementVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    return el.offsetParent !== null;
  }

  function findHeuristicSkipButtons(player) {
    if (config.selfEvolution === false) return [];
    const adModule = player.querySelector(
      '.ytp-ad-module, .ytp-ad-player-overlay, .ytp-ad-player-overlay-layout'
    );
    if (!adModule) return [];

    const found = [];
    const buttons = adModule.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      if (!(btn instanceof HTMLElement) || !isElementVisible(btn)) continue;
      const text = (btn.textContent || '').trim();
      const classStr = typeof btn.className === 'string' ? btn.className : '';
      if (HEURISTIC_SKIP_TEXT_REGEX.test(text) || HEURISTIC_SKIP_CLASS_REGEX.test(classStr)) {
        found.push(btn);
      }
    }
    return found;
  }

  function handleYouTubeVideoAd() {
    if (!isActive()) return;

    const player = document.getElementById('movie_player');
    if (!player) return;

    ensurePlayerClassObserver(player);

    const video = player.querySelector('video.html5-main-video') || player.querySelector('video');

    // Strictly require #movie_player to have .ad-showing or .ad-interrupting class
    // so residual/hidden .ytp-ad-player-overlay nodes NEVER trigger false-positive seeks on the main video
    const isAdShowing =
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting');

    if (isAdShowing) {
      if (!wasInAdState) {
        wasInAdState = true;
        if (video) {
          savedMuted = video.muted;
          savedPlaybackRate =
            video.playbackRate && video.playbackRate <= 2 ? video.playbackRate : 1.0;
        }
      }

      // 1. Click any available known skip or overlay close button
      const allSkipSelectors = [...SKIP_BUTTON_SELECTORS, ...learnedSkipSelectors];
      const skipButtons = player.querySelectorAll(allSkipSelectors.join(', '));
      let clickedSkip = false;
      for (const btn of skipButtons) {
        if (btn instanceof HTMLElement && isElementVisible(btn)) {
          try {
            btn.click();
            clickedSkip = true;
          } catch {
            // Ignore click errors
          }
        }
      }

      // 2. Click any heuristic skip buttons inside .ytp-ad-module
      const heuristicSkipButtons = findHeuristicSkipButtons(player);
      for (const btn of heuristicSkipButtons) {
        try {
          btn.click();
          clickedSkip = true;
        } catch {
          // Ignore click errors
        }
      }

      // 3. Mute ad and safely seek ONLY if the active media element is a short ad clip (<= 120s)
      //    Never seek long main videos or paused/unloaded streams!
      if (video) {
        video.muted = true;
        const now = Date.now();
        const dur = video.duration;
        const isShortAdClip =
          Number.isFinite(dur) &&
          dur > 1.0 &&
          dur <= 120 &&
          (expectedMainDuration <= 0 || Math.abs(dur - expectedMainDuration) > 5);

        if (
          !clickedSkip &&
          isShortAdClip &&
          !video.paused &&
          !video.seeking &&
          video.readyState >= 2 &&
          video.currentTime < dur - 0.3 &&
          now - lastAdSeekTimestamp > 800
        ) {
          lastAdSeekTimestamp = now;
          try {
            video.currentTime = Math.max(0, dur - 0.15);
          } catch {
            // Ignore seek restrictions
          }
        }
      }

      const now = Date.now();
      if (now - lastAdNotifyTimestamp > 1500) {
        lastAdNotifyTimestamp = now;
        notifyBlocked(1, 15, 'YouTube贴片广告秒跳');
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
  // 4. Anti-Adblock Modal & Orphaned Backdrop Defuser (`bypassEnforcementDialog`)
  // =========================================================================
  function hasVisiblePaperDialog() {
    const dialogs = document.querySelectorAll('tp-yt-paper-dialog');
    for (const d of dialogs) {
      if (!(d instanceof HTMLElement)) continue;
      if (d.offsetParent !== null && d.style.display !== 'none' && !d.hasAttribute('aria-hidden')) {
        return true;
      }
    }
    return false;
  }

  function bypassEnforcementDialog() {
    if (!isActive() || !config.youtubeAntiDetect) return;

    let removedAny = false;

    const enforcementEl = document.querySelector(
      'ytd-enforcement-message-view-model, tp-yt-paper-dialog:has(ytd-enforcement-message-view-model), yt-playability-error-supported-renderers:has(ytd-enforcement-message-view-model)'
    );
    if (enforcementEl) {
      const dialog = enforcementEl.closest('tp-yt-paper-dialog') || enforcementEl;
      try {
        if (typeof dialog.close === 'function') dialog.close();
      } catch {
        // Ignore close error
      }
      dialog.remove();
      removedAny = true;
    }

    const dialogs = document.querySelectorAll('tp-yt-paper-dialog');
    for (const dialog of dialogs) {
      if (!(dialog instanceof HTMLElement)) continue;
      const text = dialog.textContent || '';
      if (ENFORCEMENT_DIALOG_KEYWORDS.some((kw) => text.includes(kw))) {
        try {
          if (typeof dialog.close === 'function') dialog.close();
        } catch {
          // Ignore close error
        }
        dialog.remove();
        removedAny = true;
      }
    }

    // Also clean up any orphaned <tp-yt-iron-overlay-backdrop> that blocks page clicks
    // when no visible tp-yt-paper-dialog is actually open
    const backdrops = document.querySelectorAll('tp-yt-iron-overlay-backdrop');
    if (backdrops.length > 0 && (removedAny || !hasVisiblePaperDialog())) {
      for (const backdrop of backdrops) {
        if (removedAny || backdrop.hasAttribute('opened') || backdrop.classList.contains('opened')) {
          backdrop.remove();
          removedAny = true;
        }
      }
    }

    if (!removedAny) return;

    if (document.body) {
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('pointer-events');
    }
    if (document.documentElement) {
      document.documentElement.style.removeProperty('overflow');
      document.documentElement.style.removeProperty('pointer-events');
    }

    const video = document.querySelector('#movie_player video');
    if (video && video.paused && video.readyState >= 2) {
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

  window.addEventListener('yt-navigate-finish', () => {
    expectedMainDuration = 0;
    wasInAdState = false;
    scheduleChecks();
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'bilitube-isolated' || data.type !== 'CONFIG_SYNC') return;

    if (data.settings && typeof data.settings === 'object') {
      if (typeof data.settings.enabled === 'boolean') {
        config.enabled = data.settings.enabled;
      }
      if (typeof data.settings.youtubeEnabled === 'boolean') {
        config.youtubeEnabled = data.settings.youtubeEnabled;
      }
      if (typeof data.settings.youtubeAntiDetect === 'boolean') {
        config.youtubeAntiDetect = data.settings.youtubeAntiDetect;
      }
      if (typeof data.settings.selfEvolution === 'boolean') {
        config.selfEvolution = data.settings.selfEvolution;
      }
    }

    if (data.evolution && typeof data.evolution === 'object') {
      if (Array.isArray(data.evolution.ytPruneKeys)) {
        config.ytPruneKeys = data.evolution.ytPruneKeys;
      }
      if (Array.isArray(data.evolution.ytTextReplaces)) {
        config.ytTextReplaces = data.evolution.ytTextReplaces;
      }
      if (typeof data.evolution.selfEvolution === 'boolean') {
        config.selfEvolution = data.evolution.selfEvolution;
      }
    }

    if (isActive()) {
      scheduleChecks();
    }
  });
})();
