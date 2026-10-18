/**
 * BiliTube AdShield Pro v2.0.0 — Bilibili Main World Interceptor (Self-Evolving Heuristic Edition)
 * Runs at document_start in MAIN world to sanitize fetch/XHR JSON payloads,
 * dynamically prune evolved key paths, detect heuristic JSON ad anomalies,
 * clean window.__INITIAL_STATE__, URL tracking parameters, and player command danmaku ads.
 */
(() => {
  'use strict';

  if (window.__bilitubeBiliMainLoaded) return;
  window.__bilitubeBiliMainLoaded = true;

  const config = {
    enabled: true,
    bilibiliEnabled: true,
    bilibiliLiveFilter: true,
    bilibiliCleanUrl: true,
    selfEvolution: true,
    biliPruneKeys: []
  };

  const TRACKING_PARAMS = [
    'spm_id_from',
    'from_spmid',
    'vd_source',
    'from_source',
    'share_source',
    'share_medium',
    'share_session_id',
    'share_tag',
    'unique_k',
    'tdsourcetag'
  ];

  const BILI_API_PATTERNS = [
    '/x/web-interface/wbi/index/top/feed/rcmd',
    '/x/web-interface/index/top/feed/rcmd',
    '/x/web-interface/archive/related',
    '/x/web-interface/wbi/playpage',
    '/x/player/wbi/v2',
    '/x/web-interface/view'
  ];

  const HEURISTIC_AD_KEY_REGEX = /^(ad_cb|cm_mark|is_ad$|commercial_|promote_)/i;
  const HEURISTIC_BADGE_VALUES = new Set(['广告', '推广', '创作推广', '商业推广', '赞助']);

  function hasNonEmptyAdObject(val) {
    if (!val || typeof val !== 'object') return false;
    const keys = Object.keys(val);
    if (keys.length === 0) return false;
    return Boolean(
      val.creative_id ||
        val.ad_cb ||
        val.card_type ||
        val.is_ad ||
        val.cm_mark ||
        val.source_content ||
        val.ad_content
    );
  }

  function isActive() {
    return Boolean(config.enabled && config.bilibiliEnabled);
  }

  function notifyBlocked(count, savedSeconds = 0, reason = '') {
    const safeCount = Number(count) || 0;
    if (safeCount <= 0) return;
    try {
      window.postMessage(
        {
          source: 'bilitube-main',
          type: 'AD_BLOCKED',
          site: 'bilibili',
          count: safeCount,
          savedSeconds: Number(savedSeconds) || 0,
          reason: String(reason || 'B站广告拦截')
        },
        '*'
      );
    } catch {
      // Ignore cross-window messaging errors
    }
  }

  // =========================================================================
  // 1. URL Tracking Parameter Cleaner
  // =========================================================================
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  function stripTrackingFromUrlString(rawUrl) {
    if (!isActive() || !config.bilibiliCleanUrl || !rawUrl) return rawUrl;
    try {
      const parsed = new URL(String(rawUrl), window.location.origin);
      let modified = false;
      for (const param of TRACKING_PARAMS) {
        if (parsed.searchParams.has(param)) {
          parsed.searchParams.delete(param);
          modified = true;
        }
      }
      if (!modified) return rawUrl;
      return parsed.origin === window.location.origin
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`
        : parsed.toString();
    } catch {
      return rawUrl;
    }
  }

  function cleanCurrentUrl() {
    if (!isActive() || !config.bilibiliCleanUrl) return;
    try {
      const current = window.location.href;
      const cleaned = stripTrackingFromUrlString(current);
      if (
        cleaned &&
        cleaned !== current &&
        cleaned !== `${window.location.pathname}${window.location.search}${window.location.hash}`
      ) {
        originalReplaceState.call(history, history.state, '', cleaned);
      }
    } catch {
      // Ignore security errors on restricted URLs
    }
  }

  history.pushState = function (state, unused, url) {
    const cleanedUrl = url ? stripTrackingFromUrlString(url) : url;
    return originalPushState.call(this, state, unused, cleanedUrl);
  };

  history.replaceState = function (state, unused, url) {
    const cleanedUrl = url ? stripTrackingFromUrlString(url) : url;
    return originalReplaceState.call(this, state, unused, cleanedUrl);
  };

  cleanCurrentUrl();

  // =========================================================================
  // 2. Dynamic Path Pruner & Heuristic JSON Anomaly Detector
  // =========================================================================
  /**
   * Dynamic Path Pruner (`pruneByKeyPaths(obj, keyPaths)`)
   * Supports dot-separated paths like 'data.cm_info.ads', 'data.ad_info', 'data.operation_card',
   * deleting matching properties from API responses automatically.
   */
  function pruneByKeyPaths(obj, keyPaths) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(keyPaths) || keyPaths.length === 0) {
      return 0;
    }

    let pruned = 0;

    for (const rawPath of keyPaths) {
      if (typeof rawPath !== 'string' || !rawPath.trim()) continue;
      const segments = rawPath
        .trim()
        .split('.')
        .map((s) => s.trim())
        .filter(Boolean);
      if (segments.length === 0) continue;

      let current = obj;
      for (let i = 0; i < segments.length - 1; i += 1) {
        if (!current || typeof current !== 'object') {
          current = null;
          break;
        }
        current = current[segments[i]];
      }

      const lastKey = segments[segments.length - 1];
      if (current && typeof current === 'object' && lastKey in current && current[lastKey] !== undefined) {
        const targetVal = current[lastKey];
        if (Array.isArray(targetVal)) {
          if (targetVal.length > 0) {
            pruned += targetVal.length;
            current[lastKey] = [];
          } else {
            delete current[lastKey];
          }
        } else if (targetVal) {
          pruned += 1;
          delete current[lastKey];
        } else {
          delete current[lastKey];
        }
      }
    }

    return pruned;
  }

  function isAdUrl(str) {
    if (typeof str !== 'string' || !str) return false;
    return (
      str.includes('cm.bilibili.com') ||
      str.includes('game.bilibili.com') ||
      str.includes('mall.bilibili.com') ||
      str.includes('bilibili.com/blackboard/activity-')
    );
  }

  function shouldRemoveBiliItem(item, statsTracker = null) {
    if (!item || typeof item !== 'object') return false;

    // Known explicit ad markers (note: item.is_ad_loc is true on normal videos in ad-eligible slots, so never filter on is_ad_loc alone!)
    if (
      hasNonEmptyAdObject(item.ad_info) ||
      Boolean(item.ad_cb) ||
      hasNonEmptyAdObject(item.business_info)
    ) {
      return true;
    }
    if (item.is_ad === true) return true;
    if (item.goto === 'ad' || item.goto === 'banner' || item.goto === 'special_s') return true;

    if (typeof item.card_type === 'string') {
      const cardType = item.card_type.toLowerCase();
      if (cardType.includes('ad') || cardType.includes('cm')) return true;
    }

    if (isAdUrl(item.uri) || isAdUrl(item.param) || isAdUrl(item.jump_url)) {
      return true;
    }

    if (config.bilibiliLiveFilter) {
      if (
        item.bili_live_card ||
        item.goto === 'live' ||
        (item.card_type === 'small_cover_v9' && item.room_info)
      ) {
        return true;
      }
    }

    // Heuristic JSON Anomaly Detector when selfEvolution is active
    if (config.selfEvolution !== false) {
      let heuristicMatched = false;

      for (const key of Object.keys(item)) {
        if (key === 'is_ad_loc' || key === 'ad_idx') continue;
        if (HEURISTIC_AD_KEY_REGEX.test(key)) {
          const val = item[key];
          if (typeof val === 'object' ? hasNonEmptyAdObject(val) : Boolean(val)) {
            heuristicMatched = true;
            break;
          }
        }
      }

      if (!heuristicMatched) {
        const rcmdContent =
          typeof item.rcmd_reason?.content === 'string'
            ? item.rcmd_reason.content.trim()
            : typeof item.rcmd_reason === 'string'
              ? item.rcmd_reason.trim()
              : '';
        const badgeText =
          typeof item.badge === 'string'
            ? item.badge.trim()
            : typeof item.badge?.text === 'string'
              ? item.badge.text.trim()
              : '';

        if (HEURISTIC_BADGE_VALUES.has(rcmdContent) || HEURISTIC_BADGE_VALUES.has(badgeText)) {
          heuristicMatched = true;
        }
      }

      if (heuristicMatched) {
        if (statsTracker && typeof statsTracker === 'object') {
          statsTracker.heuristicCount = (statsTracker.heuristicCount || 0) + 1;
        } else {
          notifyBlocked(1, 5, 'B站API自进化特征过滤');
        }
        return true;
      }
    }

    return false;
  }

  function matchesTargetApi(urlStr) {
    if (typeof urlStr !== 'string') return false;
    return BILI_API_PATTERNS.some((pattern) => urlStr.includes(pattern));
  }

  function sanitizeBilibiliJson(urlStr, payload) {
    if (!isActive() || !payload || typeof payload !== 'object') return payload;

    let removedCount = 0;
    const statsTracker = { heuristicCount: 0 };

    // 1. Apply Dynamic Path Pruner from evolution config
    if (Array.isArray(config.biliPruneKeys) && config.biliPruneKeys.length > 0) {
      removedCount += pruneByKeyPaths(payload, config.biliPruneKeys);
    }

    const data = payload.data;

    if (data && typeof data === 'object') {
      // Homepage recommendation feed items
      if (Array.isArray(data.item)) {
        const before = data.item.length;
        data.item = data.item.filter((entry) => !shouldRemoveBiliItem(entry, statsTracker));
        removedCount += before - data.item.length;
      }

      // Related video recommendations
      if (Array.isArray(data.related)) {
        const before = data.related.length;
        data.related = data.related.filter((entry) => !shouldRemoveBiliItem(entry, statsTracker));
        removedCount += before - data.related.length;
      }

      // Direct array data (some /x/web-interface/archive/related endpoints)
      if (Array.isArray(data)) {
        const before = data.length;
        payload.data = data.filter((entry) => !shouldRemoveBiliItem(entry, statsTracker));
        removedCount += before - payload.data.length;
      }

      // Player v2 & playpage ad overlays / command danmaku ads
      if (
        urlStr.includes('/x/player/wbi/v2') ||
        urlStr.includes('/playpage') ||
        urlStr.includes('/view')
      ) {
        if (Array.isArray(data.operation_card) && data.operation_card.length > 0) {
          removedCount += data.operation_card.length;
          data.operation_card = [];
        }
        if (Array.isArray(data.cmd_dms) && data.cmd_dms.length > 0) {
          removedCount += data.cmd_dms.length;
          data.cmd_dms = [];
        }
        if (data.bgm_info) {
          delete data.bgm_info;
        }
        if (data.elec_full_new || data.elec) {
          delete data.elec_full_new;
          delete data.elec;
        }
      }
    }

    if (statsTracker.heuristicCount > 0) {
      notifyBlocked(
        statsTracker.heuristicCount,
        statsTracker.heuristicCount * 5,
        'B站API自进化特征过滤'
      );
    }

    const standardCount = removedCount - statsTracker.heuristicCount;
    if (standardCount > 0) {
      notifyBlocked(standardCount, standardCount * 5, 'B站接口过滤');
    }

    return { payload, removedCount };
  }

  // =========================================================================
  // 3. Hook window.fetch & XMLHttpRequest
  // =========================================================================
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

      if (!matchesTargetApi(urlStr)) return response;

      const cloned = response.clone();
      const rawText = await cloned.text();
      if (!rawText) return response;

      const json = JSON.parse(rawText);
      const { payload: sanitized, removedCount } = sanitizeBilibiliJson(urlStr, json);
      if (!removedCount) return response;

      const cleanHeaders = new Headers(response.headers);
      cleanHeaders.delete('content-length');
      cleanHeaders.delete('content-encoding');

      return new Response(JSON.stringify(sanitized), {
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

  function attachBiliXhrInterceptor(xhr) {
    if (xhr.__bilitubeXhrHooked) return;
    xhr.__bilitubeXhrHooked = true;
    xhr.addEventListener(
      'readystatechange',
      function () {
        if (this.readyState !== 4 || !isActive() || !matchesTargetApi(this.__bilitubeUrl)) return;
        try {
          const responseType = this.responseType;
          if (responseType === '' || responseType === 'text') {
            const rawText = this.responseText;
            if (!rawText) return;
            const parsed = JSON.parse(rawText);
            const { payload: sanitized, removedCount } = sanitizeBilibiliJson(
              this.__bilitubeUrl,
              parsed
            );
            if (!removedCount) return;
            const serialized = JSON.stringify(sanitized);
            Object.defineProperty(this, 'responseText', {
              configurable: true,
              get: () => serialized
            });
            Object.defineProperty(this, 'response', {
              configurable: true,
              get: () => serialized
            });
          } else if (
            responseType === 'json' &&
            this.response &&
            typeof this.response === 'object'
          ) {
            const { payload: sanitized, removedCount } = sanitizeBilibiliJson(
              this.__bilitubeUrl,
              this.response
            );
            if (!removedCount) return;
            Object.defineProperty(this, 'response', {
              configurable: true,
              get: () => sanitized
            });
          }
        } catch {
          // Leave original XHR response untouched on parse error
        }
      },
      { once: false }
    );
  }

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      this.__bilitubeUrl = typeof url === 'string' ? url : String(url || '');
      if (matchesTargetApi(this.__bilitubeUrl)) {
        attachBiliXhrInterceptor(this);
      }
    } catch {
      this.__bilitubeUrl = '';
    }
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (isActive() && matchesTargetApi(this.__bilitubeUrl)) {
      attachBiliXhrInterceptor(this);
    }
    return originalXhrSend.apply(this, args);
  };

  // =========================================================================
  // 4. Initial State Cleanup (window.__INITIAL_STATE__)
  // =========================================================================
  function sanitizeInitialState(state) {
    if (!isActive() || !state || typeof state !== 'object') return state;
    let removedCount = 0;
    const statsTracker = { heuristicCount: 0 };

    try {
      if (Array.isArray(config.biliPruneKeys) && config.biliPruneKeys.length > 0) {
        removedCount += pruneByKeyPaths(state, config.biliPruneKeys);
      }
      if (state.adData && typeof state.adData === 'object') {
        const keys = Object.keys(state.adData);
        if (keys.length > 0) {
          removedCount += 1;
          state.adData = {};
        }
      }
      if (state.elecFullNew) {
        delete state.elecFullNew;
      }
      if (Array.isArray(state.related)) {
        const before = state.related.length;
        state.related = state.related.filter((item) => !shouldRemoveBiliItem(item, statsTracker));
        removedCount += before - state.related.length;
      }
      if (state.recommendData && Array.isArray(state.recommendData.item)) {
        const before = state.recommendData.item.length;
        state.recommendData.item = state.recommendData.item.filter(
          (item) => !shouldRemoveBiliItem(item, statsTracker)
        );
        removedCount += before - state.recommendData.item.length;
      }
    } catch {
      // Ignore read-only properties
    }

    if (statsTracker.heuristicCount > 0) {
      notifyBlocked(
        statsTracker.heuristicCount,
        statsTracker.heuristicCount * 5,
        'B站API自进化特征过滤'
      );
    }

    const standardCount = removedCount - statsTracker.heuristicCount;
    if (standardCount > 0) {
      notifyBlocked(standardCount, standardCount * 5, 'B站首屏状态净化');
    }
    return state;
  }

  try {
    let internalInitialState = window.__INITIAL_STATE__;
    if (internalInitialState) {
      sanitizeInitialState(internalInitialState);
    }
    Object.defineProperty(window, '__INITIAL_STATE__', {
      configurable: true,
      enumerable: true,
      get() {
        return internalInitialState;
      },
      set(newVal) {
        internalInitialState = sanitizeInitialState(newVal);
      }
    });
  } catch {
    // Fallback if property is already non-configurable
  }

  // =========================================================================
  // 5. Video Player Guard (Command Danmaku, Ending Ads & Popup Overlays)
  // =========================================================================
  const PLAYER_AD_SELECTORS = [
    '.bpx-player-cmd-dm-wrap',
    '.bpx-player-ending-related .ad',
    '.bpx-player-popup-banner',
    '.bpx-player-link-box',
    '.bilibili-player-video-popup'
  ];

  const PLAYER_IGNORE_MUTATION_SELECTOR =
    '.bpx-player-row-dm-wrap, .bpx-player-dm-wrap, .bpx-player-control-wrap, .bpx-player-subtitle-wrap, .bpx-player-sending-bar, #danmukuBox';

  let playerCleanupTimer = null;

  function cleanPlayerOverlays() {
    playerCleanupTimer = null;
    if (!isActive()) return;

    let count = 0;
    const selectorQuery = PLAYER_AD_SELECTORS.join(', ');
    const nodes = document.querySelectorAll(selectorQuery);

    for (const node of nodes) {
      if (node.dataset.bilitubeCleaned === '1') continue;
      if (node.classList.contains('bpx-player-cmd-dm-wrap')) {
        if (node.children.length > 0) {
          node.replaceChildren();
          node.dataset.bilitubeCleaned = '1';
          count += 1;
        }
      } else {
        node.dataset.bilitubeCleaned = '1';
        node.style.setProperty('display', 'none', 'important');
        count += 1;
      }
    }

    if (count > 0) {
      notifyBlocked(count, count * 3, 'B站播放器浮层拦截');
    }
  }

  // =========================================================================
  // 5B. Bilibili PlaybackRate Guardian (防跳过内置恰饭广告后误变 1.5x/2.0x 倍速护盾)
  //     Zero-AV-Desync Edition: Never invokes native SetRate if rate is already
  //     aligned, never touches playbackRate during MSE seeking, and allows
  //     player micro-rate adjustments (±0.08x) for audio-video clock sync.
  // =========================================================================
  let userExplicitPlaybackRate = 1.0;
  let lastTrustedSpeedMenuClickTs = 0;
  let isRightArrowHeld = false;
  let rightArrowDownCount = 0;

  function cleanStoredBpxPlaybackRate(targetRate = 1.0) {
    for (const storeName of ['sessionStorage', 'localStorage']) {
      try {
        const store = window[storeName];
        if (!store) continue;
        const raw = store.getItem('bpx_player_profile');
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          let changed = false;
          if (parsed.media && typeof parsed.media === 'object' && 'playbackrate' in parsed.media) {
            if (Number(parsed.media.playbackrate) !== targetRate) {
              parsed.media.playbackrate = targetRate;
              changed = true;
            }
          }
          if ('playbackrate' in parsed && Number(parsed.playbackrate) !== targetRate) {
            parsed.playbackrate = targetRate;
            changed = true;
          }
          if (changed) {
            store.setItem('bpx_player_profile', JSON.stringify(parsed));
          }
        }
      } catch {
        // Ignore storage parse/access errors
      }
    }
  }

  cleanStoredBpxPlaybackRate(1.0);

  const nativePlaybackRateDesc = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'playbackRate'
  );

  function setNativeVideoRateIfChanged(video, rate) {
    if (!video || !(video instanceof HTMLMediaElement) || video.seeking) return;
    try {
      if (
        nativePlaybackRateDesc &&
        typeof nativePlaybackRateDesc.get === 'function' &&
        typeof nativePlaybackRateDesc.set === 'function'
      ) {
        const current = nativePlaybackRateDesc.get.call(video);
        if (Math.abs(current - rate) > 0.01) {
          nativePlaybackRateDesc.set.call(video, rate);
        }
      } else if (Math.abs(video.playbackRate - rate) > 0.01) {
        video.playbackRate = rate;
      }
    } catch {
      // Ignore setter errors
    }
  }

  function syncBpxSpeedUi(rate) {
    try {
      const resultEl = document.querySelector('.bpx-player-ctrl-playbackrate-result');
      if (resultEl) {
        const expectedText = Math.abs(rate - 1.0) < 0.01 ? '倍速' : `${rate}x`;
        if (resultEl.textContent && resultEl.textContent.trim() !== expectedText) {
          resultEl.textContent = expectedText;
        }
      }
      const menuItems = document.querySelectorAll('.bpx-player-ctrl-playbackrate-menu-item');
      for (const item of menuItems) {
        const itemVal = parseFloat(item.getAttribute('data-value') || '');
        if (!Number.isFinite(itemVal)) continue;
        if (Math.abs(itemVal - rate) < 0.01) {
          item.classList.add('bpx-state-active');
        } else {
          item.classList.remove('bpx-state-active');
        }
      }
    } catch {
      // Ignore UI sync errors
    }
  }

  function isUserSpeedChangeAllowed(newRate) {
    if (!isActive()) return true;
    // Allow exact match or small MSE/live player clock sync micro-adjustments (±0.08x)
    if (Math.abs(newRate - userExplicitPlaybackRate) <= 0.08) return true;
    if (isRightArrowHeld && newRate >= 2.0) return true;
    if (Date.now() - lastTrustedSpeedMenuClickTs <= 1200) return true;
    return false;
  }

  function enforceBiliPlaybackRate() {
    if (!isActive() || isRightArrowHeld) return;
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      if (video.seeking) continue;
      if (Math.abs(video.playbackRate - userExplicitPlaybackRate) > 0.08) {
        setNativeVideoRateIfChanged(video, userExplicitPlaybackRate);
        setTimeout(() => {
          cleanStoredBpxPlaybackRate(userExplicitPlaybackRate);
          syncBpxSpeedUi(userExplicitPlaybackRate);
        }, 0);
      }
    }
  }

  if (
    nativePlaybackRateDesc &&
    typeof nativePlaybackRateDesc.get === 'function' &&
    typeof nativePlaybackRateDesc.set === 'function'
  ) {
    try {
      Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
        configurable: true,
        enumerable: true,
        get() {
          return nativePlaybackRateDesc.get.call(this);
        },
        set(val) {
          const numRate = Number(val);
          if (!Number.isFinite(numRate) || numRate <= 0) return;
          const currentRate = nativePlaybackRateDesc.get.call(this);

          if (isUserSpeedChangeAllowed(numRate)) {
            if (Date.now() - lastTrustedSpeedMenuClickTs <= 1200 && !isRightArrowHeld) {
              userExplicitPlaybackRate = numRate;
            }
            // Only invoke native C++ SetRate if rate actually differs, avoiding WSOLA audio resampler resets
            if (Math.abs(currentRate - numRate) > 0.002) {
              nativePlaybackRateDesc.set.call(this, numRate);
            }
          } else {
            // Block unauthorized external rate jump without poking SetRate if already at userExplicitPlaybackRate
            if (!this.seeking && Math.abs(currentRate - userExplicitPlaybackRate) > 0.02) {
              nativePlaybackRateDesc.set.call(this, userExplicitPlaybackRate);
            }
            if (!this.__bilitubeRateRejectTimer) {
              this.__bilitubeRateRejectTimer = setTimeout(() => {
                this.__bilitubeRateRejectTimer = null;
                cleanStoredBpxPlaybackRate(userExplicitPlaybackRate);
                syncBpxSpeedUi(userExplicitPlaybackRate);
                try {
                  this.dispatchEvent(new Event('ratechange'));
                } catch {
                  // Ignore dispatch errors
                }
              }, 25);
            }
          }
        }
      });
    } catch {
      // Fallback to event listeners if property redefinition is blocked
    }
  }

  function handleSpeedMenuPointer(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const menuItem = event.target.closest(
      '.bpx-player-ctrl-playbackrate-menu-item, .squirtle-speed-select-list li, .bilibili-player-video-btn-speed-menu-list'
    );
    if (!menuItem) return;
    const rawVal =
      menuItem.getAttribute('data-value') ||
      (menuItem.textContent || '').replace(/[^\d.]/g, '');
    const parsedRate = parseFloat(rawVal);
    if (Number.isFinite(parsedRate) && parsedRate >= 0.25 && parsedRate <= 5.0) {
      userExplicitPlaybackRate = parsedRate;
      lastTrustedSpeedMenuClickTs = Date.now();
    }
  }

  window.addEventListener('pointerdown', handleSpeedMenuPointer, true);
  window.addEventListener('mousedown', handleSpeedMenuPointer, true);
  window.addEventListener('click', handleSpeedMenuPointer, true);

  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.isTrusted) return;
      if (event.key === 'ArrowRight') {
        rightArrowDownCount += 1;
        isRightArrowHeld = true;
      }
    },
    true
  );

  window.addEventListener(
    'keyup',
    (event) => {
      if (event.key === 'ArrowRight') {
        rightArrowDownCount = 0;
        if (isRightArrowHeld) {
          isRightArrowHeld = false;
          requestAnimationFrame(enforceBiliPlaybackRate);
        }
      }
    },
    true
  );

  window.addEventListener('blur', () => {
    rightArrowDownCount = 0;
    if (isRightArrowHeld) {
      isRightArrowHeld = false;
      requestAnimationFrame(enforceBiliPlaybackRate);
    }
  });

  // Listen to ratechange when not seeking, and check once after seeked ONLY if rate drifted > 0.08x
  // (100% no-op on normal 1.0x seeks so MSE keyframe & WSOLA audio resampler are never disturbed)
  function checkAndRestoreVideoRate(video) {
    if (!(video instanceof HTMLMediaElement) || video.seeking) return;
    if (!isRightArrowHeld && Date.now() - lastTrustedSpeedMenuClickTs > 1200) {
      if (Math.abs(video.playbackRate - userExplicitPlaybackRate) > 0.08) {
        setNativeVideoRateIfChanged(video, userExplicitPlaybackRate);
        setTimeout(() => {
          cleanStoredBpxPlaybackRate(userExplicitPlaybackRate);
          syncBpxSpeedUi(userExplicitPlaybackRate);
        }, 0);
      }
    }
  }

  window.addEventListener(
    'ratechange',
    (event) => {
      checkAndRestoreVideoRate(event.target);
    },
    true
  );

  window.addEventListener(
    'seeked',
    (event) => {
      checkAndRestoreVideoRate(event.target);
    },
    true
  );

  function schedulePlayerCleanup() {
    if (playerCleanupTimer !== null || !isActive()) return;
    playerCleanupTimer = setTimeout(() => {
      requestAnimationFrame(cleanPlayerOverlays);
    }, 450);
  }

  const observer = new MutationObserver((mutations) => {
    if (playerCleanupTimer !== null || !isActive()) return;
    let shouldCheck = false;
    for (const m of mutations) {
      if (!m.addedNodes || m.addedNodes.length === 0) continue;
      if (
        m.target instanceof Element &&
        m.target.closest(PLAYER_IGNORE_MUTATION_SELECTOR)
      ) {
        continue;
      }
      shouldCheck = true;
      break;
    }
    if (shouldCheck) {
      schedulePlayerCleanup();
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
        schedulePlayerCleanup();
      },
      { once: true }
    );
  }

  // =========================================================================
  // 6. Listen for Configuration & Evolution Sync from Isolated Content Script
  // =========================================================================
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'bilitube-isolated' || msg.type !== 'CONFIG_SYNC') return;

    const settings = msg.settings;
    if (settings && typeof settings === 'object') {
      if (typeof settings.enabled === 'boolean') config.enabled = settings.enabled;
      if (typeof settings.bilibiliEnabled === 'boolean') {
        config.bilibiliEnabled = settings.bilibiliEnabled;
      }
      if (typeof settings.bilibiliLiveFilter === 'boolean') {
        config.bilibiliLiveFilter = settings.bilibiliLiveFilter;
      }
      if (typeof settings.bilibiliCleanUrl === 'boolean') {
        config.bilibiliCleanUrl = settings.bilibiliCleanUrl;
      }
      if (typeof settings.selfEvolution === 'boolean') {
        config.selfEvolution = settings.selfEvolution;
      }
    }

    const evolution = msg.evolution;
    if (evolution && typeof evolution === 'object') {
      if (Array.isArray(evolution.biliPruneKeys)) {
        config.biliPruneKeys = evolution.biliPruneKeys;
      }
      if (typeof evolution.selfEvolution === 'boolean') {
        config.selfEvolution = evolution.selfEvolution;
      }
    }

    cleanCurrentUrl();
    schedulePlayerCleanup();
  });
})();
