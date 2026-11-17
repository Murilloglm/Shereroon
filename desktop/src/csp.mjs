// Política de segurança da página do aplicativo. O código só vem de dentro do app; para fora, só conexões de
// dados (o backend e o SFU por HTTPS/WSS e, nesta máquina, o backend local e o componente de áudio).
// Imagens também podem vir do backend configurado: fotos de perfil, banners e emojis do grupo são servidos por
// ele. Nenhuma outra origem de imagem é aceita.

/** Origem (protocolo, host e porta) de um endereço http(s), ou null. */
function originOf(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(apiUrl) {
  const api = originOf(apiUrl);
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${api ? ` ${api}` : ''}`,
    "media-src 'self' blob: mediastream:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self' https: wss: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
