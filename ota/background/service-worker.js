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
  savedSeconds: 0,
  tabCounts: {}
};

const DEFAULT_EVOLUTION = {
  version: '2.0.0-evo',
  lastSyncTime: 0,
  lastSyncStatus: 'idle',
  sourceSummary: '内置基线 + 本地进化快照',
  dynamicDnrCount: 0,
  biliCosmetics: [],
  ytCosmetics: [],
  biliPruneKeys: [
    'data.ad_info',
    'data.cm_info.ads',
    'data.operation_card',
    'data.cmd_dms',
    'data.elec_full_new'
  ],
  ytPruneKeys: [
    'adPlacements',
    'adSlots',
    'playerAds',
    'adBreakHeartbeatParams',
    'playerResponse.adPlacements',
    'playerResponse.adSlots',
    'playerResponse.playerAds',
    'entries.[-].command.reelWatchEndpoint.adClientParams.isAd'
  ],
  ytTextReplaces: [
    { pattern: '"adPlacements"', replacement: '"no_ads"' },
    { pattern: '"adSlots"', replacement: '"no_ads"' }
  ],
  learnedBiliSelectors: [],
  learnedYtSelectors: [],
  learnedCount: 0,
  totalActiveSignatures: 0,
  masterSyncVersion: 0,
  lastMasterSyncVersion: 0,
  cloudAnnouncement: ''
};

const DEFAULT_LICENSE = {
  deviceId: '',
  activated: false,
  masterOwner: false,
  activationKey: '',
  mode: '',
  expiresAt: '',
  statusText: '未激活',
  lastCheckedAt: 0
};

const DEFAULT_AUTH_POLICY = {
  revokedKeys: [],
  revokedDevices: [],
  announcement: ''
};

const MASTER_SECRET_SALT = 'BT_MASTER_SECRET_2026_V2_SALT#9981';
const AUTHOR_HARDWARE_ID = 'BT-6AF7-DFAE';

const AUTHOR_CLOUD_MANIFEST_URLS = [
  'https://gh-proxy.com/https://raw.githubusercontent.com/lyrics0097/bilitube-cloud-sync/main/cloud_manifest.json',
  'https://cdn.jsdelivr.net/gh/lyrics0097/bilitube-cloud-sync@main/cloud_manifest.json',
  'https://fastly.jsdelivr.net/gh/lyrics0097/bilitube-cloud-sync@main/cloud_manifest.json',
  'https://raw.githubusercontent.com/lyrics0097/bilitube-cloud-sync/main/cloud_manifest.json'
];

const AUTO_EVOLVE_ALARM = 'bilitube-auto-evolve';
const DYNAMIC_RULE_ID_START = 10001;
const MAX_DYNAMIC_RULES = 150;
const MAX_COSMETIC_SELECTORS = 250;

const UPSTREAM_FEEDS = [
  {
    name: 'uBlock Quick Fixes',
    urls: [
      'https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssets@master/filters/quick-fixes.txt',
      'https://fastly.jsdelivr.net/gh/uBlockOrigin/uAssets@master/filters/quick-fixes.txt',
      'https://gh-proxy.com/https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt'
    ]
  },
  {
    name: 'AdGuard Chinese Filter',
    urls: [
      'https://filters.adtidy.org/extension/ublock/filters/224.txt'
    ]
  },
  {
    name: 'Xinggsf Video Rules',
    urls: [
      'https://cdn.jsdelivr.net/gh/xinggsf/Adblock-Plus-Rule@master/mv.txt',
      'https://fastly.jsdelivr.net/gh/xinggsf/Adblock-Plus-Rule@master/mv.txt'
    ]
  }
];

const UNSUPPORTED_PROCEDURAL_TOKENS = [
  ':xpath',
  ':has-text',
  ':matches-css',
  ':matches-attr',
  ':matches-path',
  ':matches-property',
  ':min-text-length',
  ':style(',
  ':remove(',
  ':remove-attr(',
  ':remove-class(',
  ':upward(',
  ':-abp-',
  ':contains(',
  ':ifthen(',
  ':nth-ancestor(',
  ':watch-attr('
];

function uniqueStrings(list, limit = Infinity) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

const UNSAFE_BILI_SELECTORS = new Set([
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
]);

function isSafeBiliSelector(sel) {
  if (typeof sel !== 'string') return false;
  const trimmed = sel.trim();
  if (!trimmed || UNSAFE_BILI_SELECTORS.has(trimmed)) return false;
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
  if (!isSafeBiliSelector(sel)) return false;
  if (sel.startsWith('[prune:')) return true;
  return /ad|promo|commercial|synergy|cm|sponsor/i.test(sel);
}

function isSafeYtPruneKey(key) {
  if (typeof key !== 'string') return false;
  const lower = key.trim().toLowerCase();
  if (!lower) return false;
  if (
    lower.includes('ssapconfig') ||
    lower.includes('streamingdata') ||
    lower === 'video_id' ||
    lower.endsWith('.video_id') ||
    lower.includes('playabilitystatus') ||
    lower.includes('videodetails')
  ) {
    return false;
  }
  return true;
}

function normalizeEvolution(rawEvo) {
  const base = rawEvo && typeof rawEvo === 'object' ? rawEvo : {};
  const biliCosmetics = uniqueStrings(base.biliCosmetics, MAX_COSMETIC_SELECTORS).filter(
    isSafeBiliSelector
  );
  const ytCosmetics = uniqueStrings(base.ytCosmetics, MAX_COSMETIC_SELECTORS);
  const biliPruneKeys = uniqueStrings([
    ...DEFAULT_EVOLUTION.biliPruneKeys,
    ...(Array.isArray(base.biliPruneKeys) ? base.biliPruneKeys : [])
  ]);
  const ytPruneKeys = uniqueStrings([
    ...DEFAULT_EVOLUTION.ytPruneKeys,
    ...(Array.isArray(base.ytPruneKeys) ? base.ytPruneKeys : [])
  ]).filter(isSafeYtPruneKey);
  const ytTextReplaces = Array.isArray(base.ytTextReplaces) && base.ytTextReplaces.length > 0
    ? base.ytTextReplaces
    : [...DEFAULT_EVOLUTION.ytTextReplaces];
  const learnedBiliSelectors = uniqueStrings(base.learnedBiliSelectors, 200).filter(
    isSafeLearnedBiliSelector
  );
  const learnedYtSelectors = uniqueStrings(base.learnedYtSelectors, 200);
  const learnedCount = learnedBiliSelectors.length + learnedYtSelectors.length;
  const dynamicDnrCount = Math.max(0, Number(base.dynamicDnrCount) || 0);
  const totalActiveSignatures =
    dynamicDnrCount +
    biliCosmetics.length +
    ytCosmetics.length +
    biliPruneKeys.length +
    ytPruneKeys.length +
    learnedCount;

  return {
    ...DEFAULT_EVOLUTION,
    ...base,
    version: DEFAULT_EVOLUTION.version,
    dynamicDnrCount,
    biliCosmetics,
    ytCosmetics,
    biliPruneKeys,
    ytPruneKeys,
    ytTextReplaces,
    learnedBiliSelectors,
    learnedYtSelectors,
    learnedCount,
    totalActiveSignatures,
    masterSyncVersion: Number(base.masterSyncVersion) || 0,
    lastMasterSyncVersion: Number(base.lastMasterSyncVersion ?? base.masterSyncVersion) || 0,
    cloudAnnouncement: typeof base.cloudAnnouncement === 'string' ? base.cloudAnnouncement : ''
  };
}

async function computeKeySignature(mode, target, expiry, nonce) {
  const rawString = `${MASTER_SECRET_SALT}:${mode}:${target}:${expiry}:${nonce}:END_BT_SIG`;
  const data = new TextEncoder().encode(rawString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return hexHash.slice(0, 12);
}

function getTodayYmd() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function cleanDeviceTarget(deviceId) {
  return String(deviceId || '')
    .replace(/^BT-/i, '')
    .replace(/-/g, '')
    .toUpperCase();
}

function generateRandomDeviceId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `BT-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

async function verifyActivationKey(keyStr, currentDeviceId, authPolicy = DEFAULT_AUTH_POLICY) {
  const normalizedKey = String(keyStr || '').trim().toUpperCase();
  if (!normalizedKey) {
    return { valid: false, reason: '验证码格式不正确，应为 BTK-xxxx 格式' };
  }

  const parts = normalizedKey.split('-');
  if (parts.length !== 6 || parts[0] !== 'BTK') {
    return { valid: false, reason: '验证码格式不正确，应为 BTK-xxxx 格式' };
  }

  const [, mode, target, expiry, nonce, sig] = parts;
  if (mode !== 'DEV' && mode !== 'ANY') {
    return { valid: false, reason: '验证码格式不正确，应为 BTK-xxxx 格式' };
  }
  if (
    !/^[0-9A-Z]{8}$/.test(target) ||
    !/^\d{8}$/.test(expiry) ||
    !/^[0-9A-F]{4}$/.test(nonce) ||
    !/^[0-9A-F]{12}$/.test(sig)
  ) {
    return { valid: false, reason: '验证码格式不正确，应为 BTK-xxxx 格式' };
  }

  const expectedSig = await computeKeySignature(mode, target, expiry, nonce);
  if (sig !== expectedSig) {
    return { valid: false, reason: '验证码签名校验失败，请联系作者获取有效 Key' };
  }

  if (mode === 'DEV') {
    const cleanDeviceId = cleanDeviceTarget(currentDeviceId);
    if (target !== cleanDeviceId) {
      return {
        valid: false,
        reason: `该验证码已绑定其他电脑，无法在本机（${currentDeviceId}）使用！请将本机机器码发给作者`
      };
    }
  }

  const todayYmd = getTodayYmd();
  if (Number(expiry) < Number(todayYmd)) {
    return {
      valid: false,
      reason: `该验证码已于 ${expiry} 过期，请联系作者续期`
    };
  }

  const revokedKeys = Array.isArray(authPolicy?.revokedKeys)
    ? authPolicy.revokedKeys.map((k) => String(k || '').trim().toUpperCase())
    : [];
  const revokedDevices = Array.isArray(authPolicy?.revokedDevices)
    ? authPolicy.revokedDevices.map((d) => String(d || '').trim().toUpperCase())
    : [];
  const normDev = String(currentDeviceId || '').trim().toUpperCase();

  if (
    revokedKeys.includes(normalizedKey) ||
    revokedKeys.includes(nonce) ||
    (normDev && revokedDevices.includes(normDev))
  ) {
    return {
      valid: false,
      reason: '该授权已被作者远程停用/吊销'
    };
  }

  return {
    valid: true,
    key: normalizedKey,
    mode,
    target,
    expiry,
    nonce
  };
}

async function loadDeviceLicenseFile() {
  try {
    const url = chrome.runtime.getURL('rules/device_license.json');
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function isValidHardwareDeviceId(id) {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim().toUpperCase();
  if (!trimmed.startsWith('BT-') || trimmed.includes('UNBOUND')) return false;
  return cleanDeviceTarget(trimmed).length === 8;
}

function getEffectiveSettings(settings, license) {
  if (!license || !license.activated) {
    return {
      ...settings,
      enabled: false,
      bilibiliEnabled: false,
      youtubeEnabled: false
    };
  }
  return settings;
}

async function loadAndVerifyLicense(overrideAuthPolicy = null) {
  const [fileLic, storageData] = await Promise.all([
    loadDeviceLicenseFile(),
    chrome.storage.local.get(['license', 'authPolicy'])
  ]);

  const storedLic = storageData.license && typeof storageData.license === 'object'
    ? storageData.license
    : {};
  const cloudAuthPolicy = overrideAuthPolicy || storageData.authPolicy || DEFAULT_AUTH_POLICY;

  let deviceId = '';
  if (fileLic && isValidHardwareDeviceId(fileLic.deviceId)) {
    deviceId = fileLic.deviceId.trim().toUpperCase();
  } else if (isValidHardwareDeviceId(storedLic.deviceId)) {
    deviceId = storedLic.deviceId.trim().toUpperCase();
  } else {
    deviceId = generateRandomDeviceId();
  }

  let verified = null;
  let candidateKey = '';
  let failReason = '未激活';

  if (typeof storedLic.activationKey === 'string' && storedLic.activationKey.trim()) {
    const res = await verifyActivationKey(storedLic.activationKey, deviceId, cloudAuthPolicy);
    if (res.valid) {
      verified = res;
      candidateKey = res.key;
    } else {
      failReason = res.reason;
    }
  }

  if (!verified && fileLic && fileLic.activated && typeof fileLic.activationKey === 'string' && fileLic.activationKey.trim()) {
    const res = await verifyActivationKey(fileLic.activationKey, deviceId, cloudAuthPolicy);
    if (res.valid) {
      verified = res;
      candidateKey = res.key;
    } else {
      failReason = res.reason;
    }
  }

  const isValid = Boolean(verified && verified.valid);
  const masterOwner = Boolean(isValid && fileLic?.masterOwner && deviceId === AUTHOR_HARDWARE_ID);

  const nextLicense = {
    deviceId,
    activated: isValid,
    masterOwner,
    activationKey: isValid ? candidateKey : '',
    expiresAt: isValid ? verified.expiry : '',
    mode: isValid ? verified.mode : '',
    statusText: isValid ? (masterOwner ? '作者主控本机' : '已授权 · 与作者配置云同步中') : failReason,
    lastCheckedAt: Date.now()
  };

  await chrome.storage.local.set({ license: nextLicense });
  return nextLicense;
}

async function getStoredData(verifyLicenseNow = false) {
  const data = await chrome.storage.local.get(['settings', 'stats', 'evolution', 'license', 'authPolicy']);
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const rawStats = data.stats || {};
  const stats = {
    ...DEFAULT_STATS,
    ...rawStats,
    tabCounts: { ...(rawStats.tabCounts || {}) }
  };
  const evolution = normalizeEvolution(data.evolution);
  const authPolicy = data.authPolicy && typeof data.authPolicy === 'object'
    ? { ...DEFAULT_AUTH_POLICY, ...data.authPolicy }
    : { ...DEFAULT_AUTH_POLICY };

  let license = data.license && typeof data.license === 'object' && isValidHardwareDeviceId(data.license.deviceId)
    ? { ...DEFAULT_LICENSE, ...data.license }
    : null;

  if (!license || verifyLicenseNow) {
    license = await loadAndVerifyLicense(authPolicy);
  }

  return { settings, stats, evolution, license, authPolicy };
}

async function syncRulesets(settings, license = null) {
  let activeLicense = license;
  if (!activeLicense) {
    const stored = await chrome.storage.local.get(['license']);
    activeLicense = stored.license || (await loadAndVerifyLicense());
  }

  const effective = getEffectiveSettings(settings, activeLicense);
  const enableRulesetIds = [];
  const disableRulesetIds = [];

  if (effective.enabled && effective.bilibiliEnabled) {
    enableRulesetIds.push('bilibili_rules');
  } else {
    disableRulesetIds.push('bilibili_rules');
  }

  if (effective.enabled && effective.youtubeEnabled) {
    enableRulesetIds.push('youtube_rules');
  } else {
    disableRulesetIds.push('youtube_rules');
  }

  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds,
      disableRulesetIds
    });
    if (typeof chrome.declarativeNetRequest.updateStaticRules === 'function') {
      await chrome.declarativeNetRequest.updateStaticRules({
        rulesetId: 'bilibili_rules',
        enableRuleIds: effective.enabled && effective.bilibiliCleanUrl ? [7] : [],
        disableRuleIds: effective.enabled && effective.bilibiliCleanUrl ? [] : [7]
      });
    }
    if (!effective.enabled || !effective.selfEvolution) {
      const existingDynamic = await chrome.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = existingDynamic
        .map((r) => r.id)
        .filter((id) => id >= DYNAMIC_RULE_ID_START);
      if (removeRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds,
          addRules: []
        });
      }
    }
  } catch (err) {
    console.warn('[BiliTube AdShield] Failed to update rulesets:', err);
  }
}

function getBadgeColorForSite(site) {
  if (site === 'bilibili') return '#FB7299';
  if (site === 'youtube') return '#FF0033';
  return '#10B981';
}

function detectSiteFromUrl(url) {
  if (!url) return 'default';
  if (url.includes('bilibili.com')) return 'bilibili';
  if (url.includes('youtube.com') || url.includes('youtube-nocookie.com')) return 'youtube';
  return 'default';
}

async function updateGlobalLicenseBadge(activated) {
  try {
    if (!activated) {
      await chrome.action.setBadgeText({ text: 'LOCK' });
      await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // Ignore action badge errors
  }
}

async function updateTabBadge(tabId, count, site, enabled = true, activated = true) {
  if (typeof tabId !== 'number' || tabId < 0) return;
  try {
    if (!activated) {
      await chrome.action.setBadgeText({ tabId, text: 'LOCK' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#EF4444' });
      return;
    }
    if (!enabled) {
      await chrome.action.setBadgeText({ tabId, text: 'OFF' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#64748B' });
      return;
    }
    const text = count > 0 ? (count > 999 ? '999+' : String(count)) : '';
    await chrome.action.setBadgeText({ tabId, text });
    if (count > 0) {
      await chrome.action.setBadgeBackgroundColor({
        tabId,
        color: getBadgeColorForSite(site)
      });
    }
  } catch {
    // Tab may have been closed before badge update completed
  }
}

async function enforceLicenseState(license, settings, stats, evolution) {
  await updateGlobalLicenseBadge(license.activated);
  await syncRulesets(settings, license);
  const effectiveSettings = getEffectiveSettings(settings, license);

  try {
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (typeof tab.id !== 'number') continue;
      const site = detectSiteFromUrl(tab.url);
      const tabCount = stats?.tabCounts?.[String(tab.id)] || 0;
      await updateTabBadge(tab.id, tabCount, site, settings.enabled, license.activated);
      if (site === 'bilibili' || site === 'youtube') {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'SETTINGS_UPDATED',
            settings: effectiveSettings,
            evolution
          });
        } catch {
          // Content script may not be ready in tab
        }
      }
    }
  } catch {
    // Ignore tab query errors
  }
}

async function fetchTextWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAuthorCloudManifest(timeoutMs = 6000) {
  const cacheBuster = Math.floor(Date.now() / 60000);
  for (const baseUrl of AUTHOR_CLOUD_MANIFEST_URLS) {
    try {
      const sep = baseUrl.includes('?') ? '&' : '?';
      const text = await fetchTextWithTimeout(`${baseUrl}${sep}t=${cacheBuster}`, timeoutMs);
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        return { ok: true, url: baseUrl, manifest: parsed };
      }
    } catch {
      // Try next mirror
    }
  }
  return { ok: false, url: '', manifest: null };
}

async function fetchFeedWithFallback(feed, timeoutMs = 8000) {
  for (const url of feed.urls) {
    try {
      const text = await fetchTextWithTimeout(url, timeoutMs);
      if (typeof text === 'string' && text.trim().length > 30) {
        return { ok: true, name: feed.name, url, text };
      }
    } catch {
      // Try next mirror URL
    }
  }
  return { ok: false, name: feed.name, url: '', text: '' };
}

async function loadLocalSnapshot() {
  try {
    const snapshotUrl = chrome.runtime.getURL('rules/evolved_snapshot.json');
    const response = await fetch(snapshotUrl, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function isValidCssSelector(selector) {
  if (!selector || typeof selector !== 'string') return false;
  const trimmed = selector.trim();
  if (!trimmed || trimmed.length > 260) return false;
  if (trimmed.startsWith('+js(') || trimmed.startsWith('^')) return false;

  const lower = trimmed.toLowerCase();
  for (const token of UNSUPPORTED_PROCEDURAL_TOKENS) {
    if (lower.includes(token)) return false;
  }

  let parenDepth = 0;
  let bracketDepth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    if (parenDepth < 0 || bracketDepth < 0) return false;
  }
  return parenDepth === 0 && bracketDepth === 0;
}

function classifyDomainList(domainStr) {
  if (!domainStr || typeof domainStr !== 'string') {
    return { isBili: false, isYt: false };
  }
  const parts = domainStr
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  let isBili = false;
  let isYt = false;
  for (const part of parts) {
    if (part.startsWith('~')) continue;
    if (
      part === 'bilibili.com' ||
      part.endsWith('.bilibili.com') ||
      part === 'bilivideo.com' ||
      part.endsWith('.bilivideo.com')
    ) {
      isBili = true;
    }
    if (
      part === 'youtube.com' ||
      part.endsWith('.youtube.com') ||
      part === 'youtube-nocookie.com' ||
      part.endsWith('.youtube-nocookie.com')
    ) {
      isYt = true;
    }
  }
  return { isBili, isYt };
}

function parseScriptletPruneLine(domainPart, scriptletBody, biliPruneSet, ytPruneSet) {
  const { isBili, isYt } = classifyDomainList(domainPart);
  if (!isBili && !isYt) return;

  const inner = scriptletBody.endsWith(')')
    ? scriptletBody.slice(0, -1)
    : scriptletBody;
  const args = inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
  if (args.length < 2) return;

  const scriptletName = args[0].toLowerCase();
  if (
    !scriptletName.includes('json-prune') &&
    scriptletName !== 'trusted-prune-inbound-object'
  ) {
    return;
  }

  const rawPaths = args[1]
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 120 && !/[()*?^$|\\]/.test(s));

  for (const keyPath of rawPaths) {
    if (isBili) biliPruneSet.add(keyPath);
    if (isYt && isSafeYtPruneKey(keyPath)) ytPruneSet.add(keyPath);
  }
}

function isAsciiOnly(str) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 127) return false;
  }
  return true;
}

const DNR_RESOURCE_TYPE_MAP = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'sub_frame',
  frame: 'sub_frame',
  sub_frame: 'sub_frame',
  media: 'media',
  ping: 'ping',
  beacon: 'ping',
  font: 'font',
  websocket: 'websocket',
  other: 'other'
};

const ALL_SAFE_RESOURCE_TYPES = [
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'other'
];

function compileNetworkRuleToDnr(line) {
  if (!line.startsWith('||') || line.startsWith('@@@') || line.startsWith('@@')) {
    return null;
  }
  if (!isAsciiOnly(line)) return null;

  let patternPart = line;
  let optionsPart = '';
  const dollarIdx = line.indexOf('$');
  if (dollarIdx !== -1) {
    patternPart = line.slice(0, dollarIdx).trim();
    optionsPart = line.slice(dollarIdx + 1).trim();
  }

  if (patternPart.length < 6 || patternPart.length > 220) return null;
  if (patternPart.startsWith('/') && patternPart.endsWith('/')) return null;

  const lowerPattern = patternPart.toLowerCase();

  // Never block googlevideo.com streams or core Bilibili video/feed/playback/danmaku/banner endpoints
  if (lowerPattern.includes('googlevideo.com')) return null;
  if (
    lowerPattern.includes('playurl') ||
    lowerPattern.includes('videoplayback') ||
    lowerPattern.includes('/bfs/archive/') ||
    lowerPattern.includes('/bfs/face/') ||
    lowerPattern.includes('/bfs/seed/jinkela/short/config') ||
    lowerPattern.includes('/x/player/') ||
    lowerPattern.includes('/x/v2/dm/') ||
    lowerPattern.includes('res/locs') ||
    lowerPattern.includes('special/recommend') ||
    lowerPattern.includes('/x/web-interface/nav') ||
    lowerPattern.includes('/x/web-interface/view') ||
    lowerPattern.includes('/x/web-interface/wbi/index/top/feed') ||
    lowerPattern.includes('/x/web-interface/index/top/feed')
  ) {
    return null;
  }

  const isTargetPattern =
    lowerPattern.includes('bilibili.com') ||
    lowerPattern.includes('bilivideo.com') ||
    lowerPattern.includes('biliapi.net') ||
    lowerPattern.includes('hdslb.com') ||
    lowerPattern.includes('youtube.com') ||
    lowerPattern.includes('doubleclick.net') ||
    lowerPattern.includes('googlesyndication.com') ||
    lowerPattern.includes('googleadservices.com');

  const isAdLikePath =
    lowerPattern.includes('cm.bilibili.com') ||
    lowerPattern.includes('data.bilibili.com') ||
    lowerPattern.includes('log-reporter') ||
    lowerPattern.includes('/cm/') ||
    lowerPattern.includes('ad') ||
    lowerPattern.includes('pagead') ||
    lowerPattern.includes('ptracking') ||
    lowerPattern.includes(' doubleclick') ||
    lowerPattern.includes('doubleclick.net') ||
    lowerPattern.includes('googlesyndication.com') ||
    lowerPattern.includes('googleadservices.com') ||
    lowerPattern.includes('log') ||
    lowerPattern.includes('track') ||
    lowerPattern.includes('stat');

  const initiatorDomains = [];
  const resourceTypes = [];
  let domainType = null;

  if (optionsPart) {
    const opts = optionsPart.split(',').map((o) => o.trim()).filter(Boolean);
    for (const opt of opts) {
      const lowerOpt = opt.toLowerCase();
      if (
        lowerOpt.startsWith('redirect') ||
        lowerOpt.startsWith('removeparam') ||
        lowerOpt.startsWith('csp') ||
        lowerOpt.startsWith('replace') ||
        lowerOpt.startsWith('rewrite') ||
        lowerOpt.startsWith('header') ||
        lowerOpt.startsWith('method') ||
        lowerOpt.startsWith('to=') ||
        lowerOpt.startsWith('denyallow=') ||
        lowerOpt === 'badfilter' ||
        lowerOpt === 'Important' ||
        lowerOpt === 'popunder' ||
        lowerOpt === 'popup' ||
        lowerOpt === 'document' ||
        lowerOpt === ' doc' ||
        lowerOpt === 'generichide' ||
        lowerOpt === 'elemhide' ||
        lowerOpt === 'specifichide' ||
        lowerOpt === 'all'
      ) {
        if (lowerOpt === 'important' || lowerOpt === '1p' || lowerOpt === '3p') {
          if (lowerOpt === '3p') domainType = 'thirdParty';
          if (lowerOpt === '1p') domainType = 'firstParty';
          continue;
        }
        return null;
      }

      if (lowerOpt === 'third-party' || lowerOpt === '3p') {
        domainType = 'thirdParty';
        continue;
      }
      if (lowerOpt === '~third-party' || lowerOpt === 'first-party' || lowerOpt === '1p') {
        domainType = 'firstParty';
        continue;
      }
      if (lowerOpt === 'important' || lowerOpt === 'match-case') {
        continue;
      }

      if (lowerOpt.startsWith('domain=') || lowerOpt.startsWith('from=')) {
        const domListStr = lowerOpt.slice(lowerOpt.indexOf('=') + 1);
        const doms = domListStr.split('|').map((d) => d.trim()).filter(Boolean);
        for (const d of doms) {
          if (d.startsWith('~')) continue;
          if (
            d.includes('bilibili.com') ||
            d.includes('bilivideo.com') ||
            d.includes('hdslb.com') ||
            d.includes('biliapi.net') ||
            d.includes('youtube.com')
          ) {
            initiatorDomains.push(d);
          }
        }
        continue;
      }

      if (lowerOpt.startsWith('~')) {
        // Skip rules with negated resource types to avoid over-blocking
        return null;
      }

      if (DNR_RESOURCE_TYPE_MAP[lowerOpt]) {
        const mapped = DNR_RESOURCE_TYPE_MAP[lowerOpt];
        if (!resourceTypes.includes(mapped)) {
          resourceTypes.push(mapped);
        }
        continue;
      }

      // Unknown option -> skip rule for safety
      return null;
    }
  }

  if (!isTargetPattern && initiatorDomains.length === 0) {
    return null;
  }
  if (!isAdLikePath) {
    return null;
  }

  const condition = {
    urlFilter: patternPart,
    resourceTypes: resourceTypes.length > 0 ? resourceTypes : ALL_SAFE_RESOURCE_TYPES
  };

  if (initiatorDomains.length > 0) {
    condition.initiatorDomains = [...new Set(initiatorDomains)];
  } else {
    condition.initiatorDomains = ['bilibili.com', 'youtube.com'];
  }

  if (domainType) {
    condition.domainType = domainType;
  }

  return {
    urlFilterKey: `${patternPart}|${(condition.initiatorDomains || []).join(',')}`,
    condition
  };
}

function parseFilterText(
  text,
  biliCosmeticsSet,
  ytCosmeticsSet,
  biliPruneSet,
  ytPruneSet,
  compiledNetworkMap
) {
  if (!text || typeof text !== 'string') return;
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    if (line.startsWith('#') && !line.startsWith('##')) continue;

    // 1. Scriptlet JSON-prune rules
    const jsIdx = line.indexOf('##+js(');
    if (jsIdx > 0 && !line.includes('#@#+js(')) {
      const domainPart = line.slice(0, jsIdx).trim();
      const scriptletBody = line.slice(jsIdx + 6).trim();
      parseScriptletPruneLine(domainPart, scriptletBody, biliPruneSet, ytPruneSet);
      continue;
    }

    // 2. Cosmetic rules (##)
    const cosIdx = line.indexOf('##');
    if (cosIdx > 0) {
      if (
        line.includes('#@#') ||
        line.includes('#?#') ||
        line.includes('#$#') ||
        line.includes('#%#')
      ) {
        continue;
      }
      const domainPart = line.slice(0, cosIdx).trim();
      const selector = line.slice(cosIdx + 2).trim();
      const { isBili, isYt } = classifyDomainList(domainPart);
      if ((!isBili && !isYt) || !isValidCssSelector(selector)) {
        continue;
      }
      if (isBili && isSafeBiliSelector(selector) && biliCosmeticsSet.size < MAX_COSMETIC_SELECTORS) {
        biliCosmeticsSet.add(selector);
      }
      if (isYt && ytCosmeticsSet.size < MAX_COSMETIC_SELECTORS) {
        ytCosmeticsSet.add(selector);
      }
      continue;
    }

    // 3. Network rules (||domain...)
    if (line.startsWith('||') && compiledNetworkMap.size < MAX_DYNAMIC_RULES) {
      const compiled = compileNetworkRuleToDnr(line);
      if (compiled && !compiledNetworkMap.has(compiled.urlFilterKey)) {
        compiledNetworkMap.set(compiled.urlFilterKey, compiled.condition);
      }
    }
  }
}

async function applyCompiledDynamicRules(conditions, settings) {
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existingRules
      .map((r) => r.id)
      .filter((id) => id >= DYNAMIC_RULE_ID_START);

    if (!settings.enabled || !settings.selfEvolution) {
      if (removeRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds,
          addRules: []
        });
      }
      return 0;
    }

    const addRules = conditions.slice(0, MAX_DYNAMIC_RULES).map((condition, idx) => ({
      id: DYNAMIC_RULE_ID_START + idx,
      priority: 2,
      action: { type: 'block' },
      condition
    }));

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules
    });
    return addRules.length;
  } catch (err) {
    console.warn('[BiliTube AdShield] Dynamic DNR update failed, trying safe subset:', err);
    return 0;
  }
}

async function broadcastEvolutionToTabs(evolution, settings, license = null) {
  let activeLicense = license;
  if (!activeLicense) {
    const stored = await chrome.storage.local.get(['license']);
    activeLicense = stored.license || (await loadAndVerifyLicense());
  }
  const effectiveSettings = getEffectiveSettings(settings, activeLicense);
  try {
    const openTabs = await chrome.tabs.query({
      url: [
        '*://*.bilibili.com/*',
        '*://*.youtube.com/*',
        '*://*.youtube-nocookie.com/*'
      ]
    });
    for (const tab of openTabs) {
      if (typeof tab.id !== 'number') continue;
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'EVOLUTION_UPDATED',
          evolution,
          settings: effectiveSettings
        });
      } catch {
        // Content script may not be ready in some tabs yet
      }
    }
  } catch {
    // Ignore tab query errors
  }
}

function ingestSnapshotObject(
  snapshot,
  biliCosmeticsSet,
  ytCosmeticsSet,
  biliPruneSet,
  ytPruneSet,
  compiledNetworkMap
) {
  if (!snapshot || typeof snapshot !== 'object') return null;

  const snapBiliCos = snapshot.biliCosmetics || snapshot.bilibiliCosmetics || snapshot.biliSelectors || [];
  for (const sel of snapBiliCos) {
    if (isValidCssSelector(sel) && isSafeBiliSelector(sel) && biliCosmeticsSet.size < MAX_COSMETIC_SELECTORS) {
      biliCosmeticsSet.add(sel.trim());
    }
  }

  const snapYtCos = snapshot.ytCosmetics || snapshot.youtubeCosmetics || snapshot.ytSelectors || [];
  for (const sel of snapYtCos) {
    if (isValidCssSelector(sel) && ytCosmeticsSet.size < MAX_COSMETIC_SELECTORS) {
      ytCosmeticsSet.add(sel.trim());
    }
  }

  const snapBiliPrune = snapshot.biliPruneKeys || snapshot.bilibiliPruneKeys || [];
  for (const key of snapBiliPrune) {
    if (typeof key === 'string' && key.trim()) biliPruneSet.add(key.trim());
  }

  const snapYtPrune = snapshot.ytPruneKeys || snapshot.youtubePruneKeys || [];
  for (const key of snapYtPrune) {
    if (typeof key === 'string' && key.trim() && isSafeYtPruneKey(key.trim())) {
      ytPruneSet.add(key.trim());
    }
  }

  const snapNetwork = snapshot.dnrRules || snapshot.dynamicRules || snapshot.networkRules || [];
  for (const item of snapNetwork) {
    if (compiledNetworkMap.size >= MAX_DYNAMIC_RULES) break;
    if (typeof item === 'string') {
      const compiled = compileNetworkRuleToDnr(item.trim());
      if (compiled && !compiledNetworkMap.has(compiled.urlFilterKey)) {
        compiledNetworkMap.set(compiled.urlFilterKey, compiled.condition);
      }
    } else if (item && typeof item === 'object') {
      const cond = item.condition && typeof item.condition === 'object' ? item.condition : item;
      if (cond && typeof cond.urlFilter === 'string' && cond.urlFilter.trim()) {
        const uf = cond.urlFilter.toLowerCase();
        if (
          uf.includes('index/top/feed') ||
          uf.includes('res/locs') ||
          uf.includes('/x/v2/dm/') ||
          uf.includes('short/config') ||
          uf.includes('special/recommend')
        ) {
          continue;
        }
        const key = `${cond.urlFilter}|${(cond.initiatorDomains || []).join(',')}`;
        if (!compiledNetworkMap.has(key)) {
          compiledNetworkMap.set(key, cond);
        }
      }
    }
  }

  if (Array.isArray(snapshot.rawFilterLines)) {
    parseFilterText(
      snapshot.rawFilterLines.join('\n'),
      biliCosmeticsSet,
      ytCosmeticsSet,
      biliPruneSet,
      ytPruneSet,
      compiledNetworkMap
    );
  }

  return Array.isArray(snapshot.ytTextReplaces) && snapshot.ytTextReplaces.length > 0
    ? snapshot.ytTextReplaces
    : null;
}

async function runSelfEvolutionSync(reason = 'auto') {
  let { settings, stats, evolution: currentEvo, license } = await getStoredData(true);

  const biliCosmeticsSet = new Set((currentEvo.biliCosmetics || []).filter(isSafeBiliSelector));
  const ytCosmeticsSet = new Set(currentEvo.ytCosmetics || []);
  const biliPruneSet = new Set([
    ...DEFAULT_EVOLUTION.biliPruneKeys,
    ...(currentEvo.biliPruneKeys || [])
  ]);
  const ytPruneSet = new Set([
    ...DEFAULT_EVOLUTION.ytPruneKeys,
    ...(currentEvo.ytPruneKeys || [])
  ]);
  let ytTextReplaces = Array.isArray(currentEvo.ytTextReplaces) && currentEvo.ytTextReplaces.length > 0
    ? [...currentEvo.ytTextReplaces]
    : [...DEFAULT_EVOLUTION.ytTextReplaces];
  const compiledNetworkMap = new Map();
  const activeSources = [];
  let liveSuccessCount = 0;

  let masterSyncVersion = Number(currentEvo.masterSyncVersion) || 0;
  let lastMasterSyncVersion = Number(currentEvo.lastMasterSyncVersion ?? currentEvo.masterSyncVersion) || 0;
  let cloudAnnouncement = typeof currentEvo.cloudAnnouncement === 'string' ? currentEvo.cloudAnnouncement : '';

  // 0. Fetch Author Cloud Hub (lyrics0097/bilitube-cloud-sync) first with 6s timeout
  const cloudRes = await fetchAuthorCloudManifest(6000);
  if (cloudRes.ok && cloudRes.manifest) {
    const cloudManifest = cloudRes.manifest;
    liveSuccessCount++;
    activeSources.push('作者云端中枢');

    if (cloudManifest.authPolicy && typeof cloudManifest.authPolicy === 'object') {
      const nextAuthPolicy = {
        revokedKeys: Array.isArray(cloudManifest.authPolicy.revokedKeys)
          ? cloudManifest.authPolicy.revokedKeys
          : [],
        revokedDevices: Array.isArray(cloudManifest.authPolicy.revokedDevices)
          ? cloudManifest.authPolicy.revokedDevices
          : [],
        announcement: typeof cloudManifest.authPolicy.announcement === 'string'
          ? cloudManifest.authPolicy.announcement
          : ''
      };
      cloudAnnouncement = nextAuthPolicy.announcement;
      await chrome.storage.local.set({ authPolicy: nextAuthPolicy });

      const wasActivated = license.activated;
      license = await loadAndVerifyLicense(nextAuthPolicy);
      if (wasActivated && !license.activated) {
        await enforceLicenseState(license, settings, stats, currentEvo);
      }
    }

    const incomingSyncVer = Number(cloudManifest.syncVersion) || 0;
    if (incomingSyncVer > 0) {
      masterSyncVersion = incomingSyncVer;
    }

    if (
      cloudManifest.masterSettings &&
      typeof cloudManifest.masterSettings === 'object' &&
      ((incomingSyncVer > lastMasterSyncVersion && !license.masterOwner) ||
        (reason === 'manual' && !license.masterOwner) ||
        (reason === 'activation' && !license.masterOwner))
    ) {
      const mergedSettings = { ...settings };
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (typeof cloudManifest.masterSettings[key] === 'boolean') {
          mergedSettings[key] = cloudManifest.masterSettings[key];
        }
      }
      settings = mergedSettings;
      lastMasterSyncVersion = incomingSyncVer || lastMasterSyncVersion;
      await chrome.storage.local.set({ settings });
      await enforceLicenseState(license, settings, stats, currentEvo);
    } else if (incomingSyncVer > lastMasterSyncVersion) {
      lastMasterSyncVersion = incomingSyncVer;
    }

    if (cloudManifest.evolutionSnapshot && typeof cloudManifest.evolutionSnapshot === 'object') {
      const cloudReplaces = ingestSnapshotObject(
        cloudManifest.evolutionSnapshot,
        biliCosmeticsSet,
        ytCosmeticsSet,
        biliPruneSet,
        ytPruneSet,
        compiledNetworkMap
      );
      if (cloudReplaces) {
        ytTextReplaces = cloudReplaces;
      }
    }
  }

  // 1. Load local rules/evolved_snapshot.json as baseline seed
  const snapshot = await loadLocalSnapshot();
  if (snapshot) {
    activeSources.push('本地快照');
    const snapReplaces = ingestSnapshotObject(
      snapshot,
      biliCosmeticsSet,
      ytCosmeticsSet,
      biliPruneSet,
      ytPruneSet,
      compiledNetworkMap
    );
    if (snapReplaces && (!cloudRes.ok || !cloudRes.manifest?.evolutionSnapshot?.ytTextReplaces)) {
      ytTextReplaces = snapReplaces;
    }
  }

  // 2. Fetch live upstream filter feeds with 8-second timeout
  const feedResults = await Promise.all(
    UPSTREAM_FEEDS.map((feed) => fetchFeedWithFallback(feed, 8000))
  );

  for (const res of feedResults) {
    if (res.ok && res.text) {
      liveSuccessCount++;
      activeSources.push(res.name);
      parseFilterText(
        res.text,
        biliCosmeticsSet,
        ytCosmeticsSet,
        biliPruneSet,
        ytPruneSet,
        compiledNetworkMap
      );
    }
  }

  // 3. Apply compiled dynamic DNR rules (respecting license activation state)
  const effectiveSettings = getEffectiveSettings(settings, license);
  const conditions = Array.from(compiledNetworkMap.values());
  const dynamicDnrCount = await applyCompiledDynamicRules(conditions, effectiveSettings);

  const biliCosmetics = Array.from(biliCosmeticsSet).slice(0, MAX_COSMETIC_SELECTORS);
  const ytCosmetics = Array.from(ytCosmeticsSet).slice(0, MAX_COSMETIC_SELECTORS);
  const biliPruneKeys = Array.from(biliPruneSet);
  const ytPruneKeys = Array.from(ytPruneSet);
  const learnedBiliSelectors = uniqueStrings(currentEvo.learnedBiliSelectors, 200);
  const learnedYtSelectors = uniqueStrings(currentEvo.learnedYtSelectors, 200);
  const learnedCount = learnedBiliSelectors.length + learnedYtSelectors.length;
  const totalActiveSignatures =
    dynamicDnrCount +
    biliCosmetics.length +
    ytCosmetics.length +
    biliPruneKeys.length +
    ytPruneKeys.length +
    learnedCount;

  const nextEvolution = normalizeEvolution({
    ...currentEvo,
    version: DEFAULT_EVOLUTION.version,
    lastSyncTime: Date.now(),
    lastSyncStatus: liveSuccessCount > 0 ? 'synced' : (snapshot ? 'snapshot-fallback' : 'offline-baseline'),
    lastSyncReason: reason,
    sourceSummary: activeSources.length > 0
      ? activeSources.join(' + ')
      : DEFAULT_EVOLUTION.sourceSummary,
    dynamicDnrCount,
    biliCosmetics,
    ytCosmetics,
    biliPruneKeys,
    ytPruneKeys,
    ytTextReplaces,
    learnedBiliSelectors,
    learnedYtSelectors,
    learnedCount,
    totalActiveSignatures,
    masterSyncVersion,
    lastMasterSyncVersion,
    cloudAnnouncement
  });

  await chrome.storage.local.set({ evolution: nextEvolution });
  await broadcastEvolutionToTabs(nextEvolution, settings, license);
  return nextEvolution;
}

async function ensureEvolutionAlarm() {
  try {
    await chrome.alarms.create(AUTO_EVOLVE_ALARM, {
      periodInMinutes: 60
    });
  } catch (err) {
    console.warn('[BiliTube AdShield] Failed to schedule alarm:', err);
  }
}

// Immediately verify license and enforce state when service worker wakes up
(async () => {
  try {
    const { settings, stats, evolution, license } = await getStoredData(true);
    await enforceLicenseState(license, settings, stats, evolution);
  } catch {
    // Ignore early wake errors
  }
})();

chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    const { settings, stats, evolution, license } = await getStoredData(true);
    await chrome.storage.local.set({ settings, stats, evolution, license });
    await enforceLicenseState(license, settings, stats, evolution);
    await ensureEvolutionAlarm();
    await runSelfEvolutionSync('startup');
  })();
});

chrome.runtime.onStartup.addListener(() => {
  (async () => {
    const { settings, stats, evolution, license } = await getStoredData(true);
    await enforceLicenseState(license, settings, stats, evolution);
    await ensureEvolutionAlarm();
    await runSelfEvolutionSync('startup');
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== AUTO_EVOLVE_ALARM) return;
  (async () => {
    const { settings } = await getStoredData(true);
    if (settings.enabled && settings.selfEvolution) {
      await runSelfEvolutionSync('alarm');
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  (async () => {
    const { stats } = await getStoredData();
    const key = String(tabId);
    if (key in stats.tabCounts) {
      delete stats.tabCounts[key];
      await chrome.storage.local.set({ stats });
    }
  })();
});

async function ensureContentScriptsInjected(tabId, site, settings) {
  if (typeof tabId !== 'number' || tabId < 0 || !settings.enabled) return;
  try {
    const pingResp = await chrome.tabs.sendMessage(tabId, { type: 'PING' }).catch(() => null);
    if (pingResp && pingResp.ok) {
      return;
    }
    if (site === 'youtube' && settings.youtubeEnabled) {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content/youtube.css']
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/youtube-main.js'],
        world: 'MAIN',
        injectImmediately: true
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/youtube-isolated.js'],
        injectImmediately: true
      });
    } else if (site === 'bilibili' && settings.bilibiliEnabled) {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content/bilibili.css']
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/bilibili-main.js'],
        world: 'MAIN',
        injectImmediately: true
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/bilibili-isolated.js'],
        injectImmediately: true
      });
    }
  } catch {
    // Tab may still be committing navigation or closed
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return;
  (async () => {
    const { settings, stats, license } = await getStoredData();
    const site = detectSiteFromUrl(tab?.url || changeInfo.url);
    stats.tabCounts[String(tabId)] = 0;
    await chrome.storage.local.set({ stats });
    await updateTabBadge(tabId, 0, site, settings.enabled, license.activated);
  })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (!message || typeof message.type !== 'string') {
        sendResponse({ ok: false, error: 'Invalid message format' });
        return;
      }

      if (message.type === 'RECORD_BLOCK') {
        const { settings, stats, license } = await getStoredData();
        if (!license.activated) {
          const tabId = sender?.tab?.id ?? message.tabId;
          if (typeof tabId === 'number') {
            await updateTabBadge(tabId, 0, 'default', false, false);
          }
          sendResponse({ ok: false, locked: true, stats, tabCount: 0 });
          return;
        }

        const count = Math.max(1, Number(message.count) || 1);
        const site = message.site === 'youtube' ? 'youtube' : 'bilibili';
        const savedSeconds = Number(message.savedSeconds) > 0
          ? Number(message.savedSeconds)
          : (site === 'youtube' ? count * 15 : count * 5);

        if (site === 'bilibili') {
          stats.bilibiliBlocked += count;
        } else {
          stats.youtubeBlocked += count;
        }
        stats.totalBlocked = stats.bilibiliBlocked + stats.youtubeBlocked;
        stats.savedSeconds += savedSeconds;

        const tabId = sender?.tab?.id ?? message.tabId;
        let tabCount = 0;
        if (typeof tabId === 'number') {
          const key = String(tabId);
          tabCount = (stats.tabCounts[key] || 0) + count;
          stats.tabCounts[key] = tabCount;
          await updateTabBadge(tabId, tabCount, site, settings.enabled, license.activated);
        }

        await chrome.storage.local.set({ stats });
        sendResponse({ ok: true, stats, tabCount });
        return;
      }

      if (message.type === 'GET_STATE') {
        const prevStored = await chrome.storage.local.get(['license']);
        const wasActivated = Boolean(prevStored.license?.activated);
        const { settings, stats, evolution, license } = await getStoredData(true);

        if (!wasActivated && license.activated) {
          await enforceLicenseState(license, settings, stats, evolution);
          void runSelfEvolutionSync('activation');
        } else if (wasActivated && !license.activated) {
          await enforceLicenseState(license, settings, stats, evolution);
        }

        let targetTabId = message.tabId ?? sender?.tab?.id;
        if (typeof targetTabId !== 'number') {
          const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTabs.length > 0) {
            targetTabId = activeTabs[0].id;
          }
        }
        const tabCount = typeof targetTabId === 'number'
          ? (stats.tabCounts[String(targetTabId)] || 0)
          : 0;
        sendResponse({ ok: true, settings, stats, tabCount, evolution, license });
        return;
      }

      if (message.type === 'ACTIVATE_LICENSE') {
        const { settings, stats, evolution, license: currentLicense, authPolicy } = await getStoredData(true);
        const inputKey = String(message.key || '').trim();
        const verifyRes = await verifyActivationKey(inputKey, currentLicense.deviceId, authPolicy);

        if (!verifyRes.valid) {
          const failedLicense = {
            ...currentLicense,
            activated: false,
            statusText: verifyRes.reason,
            lastCheckedAt: Date.now()
          };
          await chrome.storage.local.set({ license: failedLicense });
          await enforceLicenseState(failedLicense, settings, stats, evolution);
          sendResponse({ ok: false, error: verifyRes.reason, license: failedLicense });
          return;
        }

        const fileLic = await loadDeviceLicenseFile();
        const masterOwner = Boolean(
          fileLic?.masterOwner && currentLicense.deviceId === AUTHOR_HARDWARE_ID
        );

        const activatedLicense = {
          deviceId: currentLicense.deviceId,
          activated: true,
          masterOwner,
          activationKey: verifyRes.key,
          expiresAt: verifyRes.expiry,
          mode: verifyRes.mode,
          statusText: masterOwner ? '作者主控本机' : '已授权 · 与作者配置云同步中',
          lastCheckedAt: Date.now()
        };

        await chrome.storage.local.set({ license: activatedLicense });
        await enforceLicenseState(activatedLicense, settings, stats, evolution);
        void runSelfEvolutionSync('activation');

        sendResponse({ ok: true, license: activatedLicense });
        return;
      }

      if (message.type === 'TRIGGER_EVOLUTION') {
        const evolution = await runSelfEvolutionSync('manual');
        const { settings, license } = await getStoredData();
        sendResponse({ ok: true, evolution, settings, license });
        return;
      }

      if (message.type === 'REPORT_LEARNED_HEURISTIC') {
        const { settings, evolution, license } = await getStoredData();
        if (!license.activated) {
          sendResponse({ ok: false, locked: true, evolution });
          return;
        }
        const site = message.site === 'youtube' ? 'youtube' : 'bilibili';
        const selector = typeof message.selector === 'string' ? message.selector.trim() : '';
        const pruneKey = typeof message.pruneKey === 'string' ? message.pruneKey.trim() : '';

        let updated = false;
        if (selector && isValidCssSelector(selector)) {
          if (site === 'bilibili') {
            if (
              isSafeLearnedBiliSelector(selector) &&
              !evolution.learnedBiliSelectors.includes(selector)
            ) {
              evolution.learnedBiliSelectors.push(selector);
              updated = true;
            }
          } else {
            if (!evolution.learnedYtSelectors.includes(selector)) {
              evolution.learnedYtSelectors.push(selector);
              updated = true;
            }
          }
        }

        if (pruneKey && pruneKey.length <= 120) {
          if (site === 'bilibili') {
            if (!evolution.biliPruneKeys.includes(pruneKey)) {
              evolution.biliPruneKeys.push(pruneKey);
              updated = true;
            }
            if (!evolution.learnedBiliSelectors.includes(`[prune:${pruneKey}]`)) {
              evolution.learnedBiliSelectors.push(`[prune:${pruneKey}]`);
              updated = true;
            }
          } else if (isSafeYtPruneKey(pruneKey)) {
            if (!evolution.ytPruneKeys.includes(pruneKey)) {
              evolution.ytPruneKeys.push(pruneKey);
              updated = true;
            }
            if (!evolution.learnedYtSelectors.includes(`[prune:${pruneKey}]`)) {
              evolution.learnedYtSelectors.push(`[prune:${pruneKey}]`);
              updated = true;
            }
          }
        }

        const nextEvolution = normalizeEvolution(evolution);
        if (updated) {
          await chrome.storage.local.set({ evolution: nextEvolution });
          await broadcastEvolutionToTabs(nextEvolution, settings, license);
        }

        sendResponse({ ok: true, evolution: nextEvolution });
        return;
      }

      if (message.type === 'UPDATE_SETTINGS') {
        const { settings: currentSettings, stats, evolution, license } = await getStoredData(true);
        const incoming = message.settings && typeof message.settings === 'object'
          ? message.settings
          : message;

        const nextSettings = { ...currentSettings };
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          if (typeof incoming[key] === 'boolean') {
            nextSettings[key] = incoming[key];
          }
        }

        await chrome.storage.local.set({ settings: nextSettings });

        if (
          nextSettings.enabled !== currentSettings.enabled ||
          nextSettings.bilibiliEnabled !== currentSettings.bilibiliEnabled ||
          nextSettings.bilibiliCleanUrl !== currentSettings.bilibiliCleanUrl ||
          nextSettings.youtubeEnabled !== currentSettings.youtubeEnabled ||
          nextSettings.selfEvolution !== currentSettings.selfEvolution
        ) {
          await syncRulesets(nextSettings, license);
          if (license.activated && nextSettings.enabled && nextSettings.selfEvolution && !currentSettings.selfEvolution) {
            await runSelfEvolutionSync('settings-enabled');
          }
        }

        const effectiveSettings = getEffectiveSettings(nextSettings, license);
        const openTabs = await chrome.tabs.query({
          url: [
            '*://*.bilibili.com/*',
            '*://*.youtube.com/*',
            '*://*.youtube-nocookie.com/*'
          ]
        });

        for (const tab of openTabs) {
          if (typeof tab.id !== 'number') continue;
          const site = detectSiteFromUrl(tab.url);
          const tabCount = stats.tabCounts[String(tab.id)] || 0;
          await updateTabBadge(tab.id, tabCount, site, nextSettings.enabled, license.activated);
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'SETTINGS_UPDATED',
              settings: effectiveSettings,
              evolution
            });
          } catch {
            // Content script may not be injected in some tabs yet
          }
        }

        sendResponse({ ok: true, settings: nextSettings, evolution, license });
        return;
      }

      if (message.type === 'RESET_STATS') {
        const { settings, license } = await getStoredData();
        const resetStats = {
          ...DEFAULT_STATS,
          tabCounts: {}
        };
        await chrome.storage.local.set({ stats: resetStats });

        const allTabs = await chrome.tabs.query({});
        for (const tab of allTabs) {
          if (typeof tab.id === 'number') {
            const site = detectSiteFromUrl(tab.url);
            await updateTabBadge(tab.id, 0, site, settings.enabled, license.activated);
          }
        }

        sendResponse({ ok: true, stats: resetStats, tabCount: 0 });
        return;
      }

      sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
    }
  })();
  return true;
});
