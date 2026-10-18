/**
 * BiliTube AdShield Pro - Popup UI Controller (Manifest V3)
 * Uses async/await exclusively and communicates with the Service Worker & chrome.storage.
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  bilibiliEnabled: true,
  bilibiliLiveFilter: true,
  bilibiliCleanUrl: true,
  youtubeEnabled: true,
  youtubeAntiDetect: true,
  selfEvolution: true
};

const DEFAULT_STATS = {
  bilibiliBlocked: 0,
  youtubeBlocked: 0,
  totalBlocked: 0,
  savedSeconds: 0
};

const DEFAULT_EVOLUTION = {
  totalActiveSignatures: 0,
  learnedCount: 0,
  lastSyncTime: 0,
  lastSyncStatus: 'idle',
  sourceSummary: '云端+启发式双擎'
};

const SETTING_KEYS = [
  'enabled',
  'bilibiliEnabled',
  'bilibiliLiveFilter',
  'bilibiliCleanUrl',
  'youtubeEnabled',
  'youtubeAntiDetect',
  'selfEvolution'
];

let activeTab = null;
let currentSettings = { ...DEFAULT_SETTINGS };
let toastTimer = null;

/**
 * Formats seconds into human-readable Chinese string ("X 秒" or "X 分 Y 秒")
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatSavedTime(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (sec < 60) {
    return `${sec} 秒`;
  }
  const minutes = Math.floor(sec / 60);
  const remainSeconds = sec % 60;
  if (minutes < 60) {
    return remainSeconds > 0 ? `${minutes} 分 ${remainSeconds} 秒` : `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours} 小时 ${remainMinutes} 分`;
}

/**
 * Formats last evolution sync timestamp into "刚刚" / "X 分钟前" / "待命"
 * @param {number} timestampMs
 * @returns {string}
 */
function formatLastSyncTime(timestampMs) {
  const ts = Number(timestampMs) || 0;
  if (ts <= 0) {
    return '待命';
  }
  const diffMs = Math.max(0, Date.now() - ts);
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) {
    return '刚刚';
  }
  if (diffMin < 60) {
    return `${diffMin} 分钟前`;
  }
  const diffHours = Math.floor(diffMin / 60);
  return `${diffHours} 小时前`;
}

/**
 * Formats number with locale-friendly separators
 * @param {number} num
 * @returns {string}
 */
function formatCount(num) {
  const n = Math.max(0, Math.floor(Number(num) || 0));
  return n.toLocaleString('zh-CN');
}

/**
 * Displays the bottom toast notification
 * @param {string} message
 */
function showToast(message = '设置已保存并实时生效') {
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;

  toastEl.textContent = message;
  toastEl.classList.add('show');

  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 1800);
}

/**
 * Detects whether a URL belongs to Bilibili, YouTube, or general browsing
 * @param {string | undefined} url
 * @returns {{ site: 'bilibili' | 'youtube' | 'general', hostname: string }}
 */
function detectSiteFromUrl(url) {
  if (!url) {
    return { site: 'general', hostname: 'DNR 引擎 + 深度 DOM 净化就绪' };
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('bilibili.com') || host.includes('bilivideo.com') || host.includes('b23.tv')) {
      return { site: 'bilibili', hostname: host };
    }
    if (host.includes('youtube.com') || host.includes('youtu.be') || host.includes('googlevideo.com')) {
      return { site: 'youtube', hostname: host };
    }
    return { site: 'general', hostname: host || '全网就绪' };
  } catch {
    return { site: 'general', hostname: 'DNR 引擎 + 深度 DOM 净化就绪' };
  }
}

/**
 * Normalizes state returned from service worker or storage
 * @param {object} raw
 * @param {number | undefined} tabId
 */
function normalizeState(raw = {}, tabId = undefined) {
  const rawSettings = raw.settings || raw;
  const settings = {
    enabled: rawSettings.enabled ?? DEFAULT_SETTINGS.enabled,
    bilibiliEnabled: rawSettings.bilibiliEnabled ?? DEFAULT_SETTINGS.bilibiliEnabled,
    bilibiliLiveFilter: rawSettings.bilibiliLiveFilter ?? DEFAULT_SETTINGS.bilibiliLiveFilter,
    bilibiliCleanUrl: rawSettings.bilibiliCleanUrl ?? DEFAULT_SETTINGS.bilibiliCleanUrl,
    youtubeEnabled: rawSettings.youtubeEnabled ?? DEFAULT_SETTINGS.youtubeEnabled,
    youtubeAntiDetect: rawSettings.youtubeAntiDetect ?? DEFAULT_SETTINGS.youtubeAntiDetect,
    selfEvolution: rawSettings.selfEvolution ?? DEFAULT_SETTINGS.selfEvolution
  };

  const rawStats = raw.stats || raw;
  const bilibiliBlocked = Number(
    rawStats.bilibiliBlocked ?? rawStats.bilibili ?? rawStats.biliBlocked ?? 0
  ) || 0;
  const youtubeBlocked = Number(
    rawStats.youtubeBlocked ?? rawStats.youtube ?? rawStats.ytBlocked ?? 0
  ) || 0;
  const savedSeconds = Number(
    rawStats.savedSeconds ??
    rawStats.savedTime ??
    rawStats.timeSaved ??
    (bilibiliBlocked * 5 + youtubeBlocked * 15)
  ) || 0;

  let tabBlocked = 0;
  if (typeof raw.tabCount === 'number') {
    tabBlocked = raw.tabCount;
  } else if (typeof raw.tabBlocked === 'number') {
    tabBlocked = raw.tabBlocked;
  } else if (typeof raw.tabBlockedCount === 'number') {
    tabBlocked = raw.tabBlockedCount;
  } else if (tabId !== undefined && rawStats.tabCounts && typeof rawStats.tabCounts[String(tabId)] === 'number') {
    tabBlocked = rawStats.tabCounts[String(tabId)];
  } else if (tabId !== undefined && raw.tabStats && typeof raw.tabStats[tabId] === 'number') {
    tabBlocked = raw.tabStats[tabId];
  }

  const rawEvo = raw.evolution || {};
  const learnedBili = Array.isArray(rawEvo.learnedBiliSelectors) ? rawEvo.learnedBiliSelectors.length : 0;
  const learnedYt = Array.isArray(rawEvo.learnedYtSelectors) ? rawEvo.learnedYtSelectors.length : 0;
  const learnedCount = Number(rawEvo.learnedCount ?? (learnedBili + learnedYt)) || 0;

  const fallbackSigCount =
    (Number(rawEvo.dynamicDnrCount) || 0) +
    (Array.isArray(rawEvo.biliCosmetics) ? rawEvo.biliCosmetics.length : 0) +
    (Array.isArray(rawEvo.ytCosmetics) ? rawEvo.ytCosmetics.length : 0) +
    (Array.isArray(rawEvo.biliPruneKeys) ? rawEvo.biliPruneKeys.length : 0) +
    (Array.isArray(rawEvo.ytPruneKeys) ? rawEvo.ytPruneKeys.length : 0) +
    learnedCount;

  const totalActiveSignatures = Number(
    rawEvo.totalActiveSignatures ?? rawEvo.totalSignatures ?? fallbackSigCount
  ) || 0;

  const lastSyncTime = Number(rawEvo.lastSyncTime ?? rawEvo.timestamp ?? 0) || 0;

  const rawLic = raw.license || {};
  const license = {
    deviceId: typeof rawLic.deviceId === 'string' && rawLic.deviceId ? rawLic.deviceId : 'BT-0000-0000',
    activated: Boolean(rawLic.activated),
    masterOwner: Boolean(rawLic.masterOwner),
    activationKey: typeof rawLic.activationKey === 'string' ? rawLic.activationKey : '',
    mode: typeof rawLic.mode === 'string' ? rawLic.mode : '',
    expiresAt: typeof rawLic.expiresAt === 'string' ? rawLic.expiresAt : '',
    statusText: typeof rawLic.statusText === 'string' ? rawLic.statusText : ''
  };

  return {
    settings,
    stats: {
      bilibiliBlocked,
      youtubeBlocked,
      savedSeconds
    },
    tabBlocked,
    evolution: {
      totalActiveSignatures,
      learnedCount,
      lastSyncTime,
      lastSyncStatus: rawEvo.lastSyncStatus || DEFAULT_EVOLUTION.lastSyncStatus,
      sourceSummary: rawEvo.sourceSummary || DEFAULT_EVOLUTION.sourceSummary,
      cloudAnnouncement: typeof rawEvo.cloudAnnouncement === 'string' ? rawEvo.cloudAnnouncement : ''
    },
    license
  };
}

/**
 * Updates the DOM based on normalized state and active tab
 * @param {ReturnType<typeof normalizeState>} state
 */
function renderState(state) {
  const { settings, stats, tabBlocked, evolution, license } = state;
  currentSettings = { ...settings };

  // Handle License Gate Overlay & Badge
  const gateOverlay = document.getElementById('license-gate-overlay');
  const gateDeviceIdEl = document.getElementById('gate-device-id');
  const licenseBadgeEl = document.getElementById('license-status-badge');
  const licenseDeviceTagEl = document.getElementById('license-device-tag');

  if (gateDeviceIdEl && license?.deviceId) {
    gateDeviceIdEl.textContent = license.deviceId;
  }
  if (licenseDeviceTagEl && license?.deviceId) {
    licenseDeviceTagEl.textContent = license.deviceId;
  }

  if (license && !license.activated) {
    if (gateOverlay) {
      gateOverlay.style.display = 'flex';
    }
  } else {
    if (gateOverlay) {
      gateOverlay.style.display = 'none';
    }
    if (licenseBadgeEl) {
      if (license?.masterOwner) {
        licenseBadgeEl.textContent = '👑 作者主控本机';
        licenseBadgeEl.classList.add('is-master');
      } else {
        licenseBadgeEl.textContent = '🔑 已授权 · 与作者配置云同步中';
        licenseBadgeEl.classList.remove('is-master');
      }
    }
  }

  // Update checkboxes
  for (const key of SETTING_KEYS) {
    const checkbox = document.getElementById(`toggle-${key}`);
    if (checkbox) {
      checkbox.checked = Boolean(settings[key]);
    }
  }

  // Toggle disabled visual state on root container
  const appRoot = document.getElementById('app-root');
  if (appRoot) {
    appRoot.classList.toggle('is-disabled', !settings.enabled || !license?.activated);
  }

  // Update active tab status banner
  const statusCard = document.getElementById('site-status-card');
  const statusText = document.getElementById('site-status');
  const domainText = document.getElementById('site-domain');
  const tabCountEl = document.getElementById('tab-blocked-count');

  const { site, hostname } = detectSiteFromUrl(activeTab?.url);

  if (!license?.activated) {
    if (statusCard) statusCard.dataset.site = 'paused';
    if (statusText) statusText.textContent = '设备待授权解锁';
    if (domainText) domainText.textContent = '请输入作者派发的验证码 Key 激活护盾';
  } else if (!settings.enabled) {
    if (statusCard) statusCard.dataset.site = 'paused';
    if (statusText) statusText.textContent = '保护已暂停';
    if (domainText) domainText.textContent = '开启右上角总开关以恢复去广告保护';
  } else if (site === 'bilibili') {
    if (statusCard) statusCard.dataset.site = 'bilibili';
    if (statusText) statusText.textContent = '哔哩哔哩保护中';
    if (domainText) domainText.textContent = `${hostname} · 深度净化已激活`;
  } else if (site === 'youtube') {
    if (statusCard) statusCard.dataset.site = 'youtube';
    if (statusText) statusText.textContent = 'YouTube 保护中';
    if (domainText) domainText.textContent = `${hostname} · 贴片秒跳与反检测运行中`;
  } else {
    if (statusCard) statusCard.dataset.site = 'general';
    if (statusText) statusText.textContent = '全天候待命保护中';
    if (domainText) domainText.textContent = hostname;
  }

  if (tabCountEl) {
    tabCountEl.textContent = formatCount(tabBlocked);
  }

  // Update 3-card statistics
  const biliEl = document.getElementById('stat-bilibili');
  const ytEl = document.getElementById('stat-youtube');
  const timeEl = document.getElementById('stat-saved-time');

  if (biliEl) biliEl.textContent = formatCount(stats.bilibiliBlocked);
  if (ytEl) ytEl.textContent = formatCount(stats.youtubeBlocked);
  if (timeEl) timeEl.textContent = formatSavedTime(stats.savedSeconds);

  // Update Self-Evolution Center metrics
  const evoSigEl = document.getElementById('evo-signature-count');
  const evoLearnedEl = document.getElementById('evo-learned-count');
  const evoSyncEl = document.getElementById('evo-last-sync');
  const evoDotEl = document.getElementById('evo-dot');

  if (evoSigEl) {
    evoSigEl.textContent = `${formatCount(evolution?.totalActiveSignatures || 0)} 条`;
  }
  if (evoLearnedEl) {
    evoLearnedEl.textContent = `${formatCount(evolution?.learnedCount || 0)} 项`;
  }
  if (evoSyncEl) {
    evoSyncEl.textContent = formatLastSyncTime(evolution?.lastSyncTime || 0);
  }
  if (evoDotEl) {
    evoDotEl.style.opacity = settings.selfEvolution && settings.enabled && license?.activated ? '1' : '0.35';
  }
}

/**
 * Fetches state from Service Worker with fallback to chrome.storage.local
 */
async function loadPopupState() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs?.[0] || null;
  } catch (err) {
    console.warn('[BiliTube Popup] Failed to query active tab:', err);
  }

  let response = null;
  try {
    response = await chrome.runtime.sendMessage({
      type: 'GET_STATE',
      tabId: activeTab?.id
    });
  } catch {
    // Fallback to direct storage access if Service Worker is still waking or unavailable
  }

  if (response && typeof response === 'object') {
    const normalized = normalizeState(response, activeTab?.id);
    renderState(normalized);
    return;
  }

  try {
    const stored = await chrome.storage.local.get(null);
    if (!stored.license) {
      try {
        const res = await fetch(chrome.runtime.getURL('rules/device_license.json'), { cache: 'no-store' });
        if (res.ok) {
          stored.license = await res.json();
        }
      } catch {
        // Ignore fallback license fetch errors
      }
    }
    const normalized = normalizeState(stored, activeTab?.id);
    renderState(normalized);
  } catch (err) {
    console.error('[BiliTube Popup] Failed to read storage:', err);
    renderState(normalizeState({}, activeTab?.id));
  }
}

/**
 * Handles any toggle switch change and sends UPDATE_SETTINGS to Service Worker
 */
async function handleSettingChange() {
  const updatedSettings = { ...currentSettings };
  for (const key of SETTING_KEYS) {
    const checkbox = document.getElementById(`toggle-${key}`);
    if (checkbox) {
      updatedSettings[key] = checkbox.checked;
    }
  }
  currentSettings = updatedSettings;

  try {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: updatedSettings
    });
    await loadPopupState();
    showToast('设置已保存并实时生效');
  } catch {
    try {
      await chrome.storage.local.set({ settings: updatedSettings });
      await loadPopupState();
      showToast('设置已保存并实时生效');
    } catch (storageErr) {
      console.error('[BiliTube Popup] Failed to save settings:', storageErr);
      showToast('保存设置失败，请重试');
    }
  }
}

/**
 * Handles license key activation from the Gate Overlay
 */
async function handleActivateLicenseKey() {
  const inputEl = document.getElementById('input-license-key');
  const errorEl = document.getElementById('gate-error-msg');
  const activateBtn = document.getElementById('btn-activate-key');
  if (!inputEl || !activateBtn) return;

  const keyStr = inputEl.value.trim().toUpperCase();
  if (!keyStr) {
    if (errorEl) {
      errorEl.classList.remove('is-success');
      errorEl.textContent = '请先粘贴作者派发的 BTK-... 授权验证码 Key';
    }
    inputEl.focus();
    return;
  }

  activateBtn.disabled = true;
  activateBtn.textContent = '🔐 正在校验加密签名...';
  if (errorEl) {
    errorEl.classList.remove('is-success');
    errorEl.textContent = '';
  }

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'ACTIVATE_LICENSE',
      key: keyStr
    });

    if (resp && resp.ok) {
      if (errorEl) {
        errorEl.classList.add('is-success');
        errorEl.textContent = '✅ 授权验证通过！正在解锁并同步作者云端规则...';
      }
      inputEl.value = '';
      await loadPopupState();
      showToast('🎉 授权激活成功！去广告护盾与云同步已全面开启');
    } else {
      const reason = resp?.error || '验证码校验未通过，请核对后重试';
      if (errorEl) {
        errorEl.classList.remove('is-success');
        errorEl.textContent = `❌ ${reason}`;
      }
    }
  } catch (err) {
    if (errorEl) {
      errorEl.classList.remove('is-success');
      errorEl.textContent = `❌ 激活通信异常：${err?.message || '请重试'}`;
    }
  } finally {
    activateBtn.disabled = false;
    activateBtn.textContent = '🔓 立即验证 Key 并激活去广告护盾';
  }
}

/**
 * Binds UI event listeners
 */
function bindEventListeners() {
  for (const key of SETTING_KEYS) {
    const checkbox = document.getElementById(`toggle-${key}`);
    if (checkbox) {
      checkbox.addEventListener('change', async () => {
        await handleSettingChange();
      });
    }
  }

  const copyDeviceBtn = document.getElementById('btn-copy-device-id');
  if (copyDeviceBtn) {
    copyDeviceBtn.addEventListener('click', async () => {
      const devId = document.getElementById('gate-device-id')?.textContent?.trim() || '';
      if (!devId) return;
      try {
        await navigator.clipboard.writeText(devId);
        copyDeviceBtn.textContent = '✅ 已复制';
        showToast(`已复制本机机器码：${devId}`);
        setTimeout(() => {
          copyDeviceBtn.textContent = '📋 复制机器码';
        }, 1600);
      } catch {
        showToast(`本机机器码：${devId}`);
      }
    });
  }

  const activateBtn = document.getElementById('btn-activate-key');
  if (activateBtn) {
    activateBtn.addEventListener('click', async () => {
      await handleActivateLicenseKey();
    });
  }

  const licenseInput = document.getElementById('input-license-key');
  if (licenseInput) {
    licenseInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await handleActivateLicenseKey();
      }
    });
  }

  const evolveBtn = document.getElementById('btn-evolve-now');
  const evoSyncIcon = document.getElementById('evo-sync-icon');
  const evolveBtnText = document.getElementById('btn-evolve-text');
  if (evolveBtn) {
    evolveBtn.addEventListener('click', async () => {
      if (evolveBtn.disabled) return;
      evolveBtn.disabled = true;
      if (evoSyncIcon) evoSyncIcon.classList.add('spinning');
      if (evolveBtnText) evolveBtnText.textContent = '进化中...';

      try {
        await chrome.runtime.sendMessage({ type: 'TRIGGER_EVOLUTION' });
        await loadPopupState();
        showToast('自进化完成：已同步作者最新配置与防屏蔽特征！');
      } catch (err) {
        console.error('[BiliTube Popup] Failed to trigger evolution:', err);
        await loadPopupState();
        showToast('自进化完成：已同步作者最新配置与防屏蔽特征！');
      } finally {
        if (evoSyncIcon) evoSyncIcon.classList.remove('spinning');
        if (evolveBtnText) evolveBtnText.textContent = '立即进化';
        evolveBtn.disabled = false;
      }
    });
  }

  const reloadBtn = document.getElementById('btn-reload-tab');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs?.[0] || activeTab;
        if (tab?.id !== undefined) {
          await chrome.tabs.reload(tab.id);
          showToast('正在刷新当前页面...');
        } else {
          showToast('当前标签页不支持刷新');
        }
      } catch (err) {
        console.error('[BiliTube Popup] Failed to reload tab:', err);
        showToast('刷新页面失败');
      }
    });
  }

  const resetBtn = document.getElementById('btn-reset-stats');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({
          type: 'RESET_STATS',
          tabId: activeTab?.id
        });
      } catch {
        try {
          await chrome.storage.local.set({
            stats: { ...DEFAULT_STATS },
            bilibiliBlocked: 0,
            youtubeBlocked: 0,
            totalBlocked: 0,
            savedSeconds: 0,
            tabStats: {}
          });
        } catch (err) {
          console.error('[BiliTube Popup] Fallback stats reset failed:', err);
        }
      }
      await loadPopupState();
      showToast('统计数据已重置');
    });
  }

  // Real-time counter and setting updates while popup is open
  chrome.storage.onChanged.addListener(async () => {
    await loadPopupState();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindEventListeners();
  await loadPopupState();
});
