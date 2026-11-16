import { isIP } from 'node:net';

export function publicHttpsUrl(value, label) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { /* mensagem abaixo */ }
  const host = url?.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '') || '';
  const ip = isIP(host);
  const octets = ip === 4 ? host.split('.').map(Number) : [];
  const privateV4 = ip === 4 && (
    [0, 10, 127].includes(octets[0]) || octets[0] >= 224 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 198 && [18, 19].includes(octets[1]))
  );
  const privateV6 = ip === 6 && (/^(::|::1)$|^f[cd]|^fe[89ab]|^ff/i.test(host) || host.includes('::ffff:'));
  const localName = host === 'localhost' || /\.(localhost|local|localdomain|internal)$/.test(host) || (!ip && !host.includes('.'));
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.href.includes('?') || url.href.includes('#') || localName || privateV4 || privateV6) {
    throw new Error(`${label} precisa ser uma URL HTTPS pública, sem credenciais, consulta ou fragmento.`);
  }
  return url.toString().replace(/\/+$/, '');
}

function localUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().replace(/\/+$/, '') : '';
  } catch { return ''; }
}

export function connectionConfig({ apiUrl, siteUrl }, { local = false } = {}) {
  if (local) {
    return { connectionMode: 'local', apiUrl: localUrl(apiUrl) || 'http://localhost:8787', siteUrl: localUrl(siteUrl) };
  }
  return {
    connectionMode: 'cloud',
    apiUrl: publicHttpsUrl(apiUrl, 'SHAREROOM_API_URL'),
    siteUrl: publicHttpsUrl(siteUrl, 'SHAREROOM_SITE_URL'),
  };
}

export function runtimeConnection(file, env, packaged) {
  return connectionConfig({
    apiUrl: env.SHAREROOM_API_URL ?? file.apiUrl,
    siteUrl: env.SHAREROOM_SITE_URL ?? file.siteUrl,
  }, { local: file.connectionMode === 'local' || (!packaged && file.connectionMode !== 'cloud') });
}
