'use strict';

const path = require('node:path');
const {
  ALLOWED_EVENT_CHANNELS,
  ALLOWED_INVOKE_CHANNELS
} = require('../shared/contracts.cjs');

const APP_ORIGIN = 'app://desktop';
const PRODUCTION_ORIGIN = 'https://3aik.com';
const EXTERNAL_DESTINATIONS = Object.freeze([
  { origin: 'https://3aik.com', pathPrefix: '/' },
  { origin: 'https://github.com', pathPrefix: '/alivirgo/3aik-web2' }
]);

function parseUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isTrustedRendererUrl(value) {
  const url = parseUrl(value);
  return Boolean(
    url &&
    url.protocol === 'app:' &&
    url.hostname === 'desktop' &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  );
}

function isAllowedChatNavigation(value) {
  const url = parseUrl(value);
  return Boolean(
    url &&
    url.origin === PRODUCTION_ORIGIN &&
    url.username === '' &&
    url.password === ''
  );
}

function isAllowedExternalUrl(value) {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password) return false;

  return EXTERNAL_DESTINATIONS.some(
    ({ origin, pathPrefix }) =>
      url.origin === origin &&
      (pathPrefix === '/' || url.pathname === pathPrefix || url.pathname.startsWith(`${pathPrefix}/`))
  );
}

function normalizeAgentBaseUrl(value) {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.search || url.hash) return null;
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isLocalModelHostname(hostname) {
  const normalized = hostname.toLowerCase();
  const unwrapped = normalized.replace(/^\[|\]$/g, '');
  const isPrivateIpv6 = unwrapped.includes(':') && (
    unwrapped === '::1' ||
    unwrapped.startsWith('fe80:') ||
    unwrapped.startsWith('fc') ||
    unwrapped.startsWith('fd')
  );
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    isPrivateIpv6 ||
    isPrivateIpv4(normalized)
  );
}

function normalizeLocalModelBaseUrl(value) {
  const url = parseUrl(value);
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  if (url.search || url.hash || !isLocalModelHostname(url.hostname)) return null;
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function isAllowedPermission(permission, requestingUrl) {
  return (
    permission === 'clipboard-sanitized-write' &&
    isAllowedChatNavigation(requestingUrl)
  );
}

function isPathWithin(rootPath, candidatePath) {
  if (typeof rootPath !== 'string' || typeof candidatePath !== 'string') return false;
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveAssetPath(assetRoot, requestUrl) {
  const url = parseUrl(requestUrl);
  if (!url || !isTrustedRendererUrl(requestUrl)) {
    throw new Error('Untrusted app asset URL.');
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new Error('Malformed app asset URL.');
  }

  if (decodedPath.includes('\0')) throw new Error('Invalid app asset path.');
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const candidate = path.resolve(assetRoot, relativePath);
  if (!isPathWithin(assetRoot, candidate)) throw new Error('App asset path escaped its root.');
  return candidate;
}

function isAllowedIpcChannel(channel, direction = 'invoke') {
  const allowlist = direction === 'event' ? ALLOWED_EVENT_CHANNELS : ALLOWED_INVOKE_CHANNELS;
  return typeof channel === 'string' && allowlist.includes(channel);
}

function normalizeViewBounds(input, contentBounds) {
  if (!input || typeof input !== 'object' || !contentBounds) return null;
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(input[key]));
  if (!values.every(Number.isFinite)) return null;

  let [x, y, width, height] = values.map(Math.round);
  x = Math.max(0, Math.min(x, contentBounds.width));
  y = Math.max(0, Math.min(y, contentBounds.height));
  width = Math.max(0, Math.min(width, contentBounds.width - x));
  height = Math.max(0, Math.min(height, contentBounds.height - y));
  return { x, y, width, height };
}

function isVersionNewer(candidate, current) {
  const parse = (value) => {
    const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    return match ? match.slice(1).map(Number) : null;
  };
  const next = parse(candidate);
  const installed = parse(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] > installed[index]) return true;
    if (next[index] < installed[index]) return false;
  }
  return false;
}

module.exports = {
  APP_ORIGIN,
  PRODUCTION_ORIGIN,
  isAllowedChatNavigation,
  isAllowedExternalUrl,
  isAllowedIpcChannel,
  isAllowedPermission,
  isPathWithin,
  isTrustedRendererUrl,
  isVersionNewer,
  normalizeAgentBaseUrl,
  normalizeLocalModelBaseUrl,
  normalizeViewBounds,
  resolveAssetPath
};
