// Links que abrem o aplicativo (cosmicnight://...). Só convites são aceitos, com o código no formato exato;
// qualquer outra coisa é ignorada. O destino nunca vira um endereço carregado na janela: ele é entregue à
// interface, que abre a tela do convite dentro do próprio aplicativo.

export const DEEP_SCHEME = 'cosmicnight';
const CODE = /^[A-Za-z0-9_-]{8,40}$/;

/** cosmicnight://convite/<código> → { kind: 'convite', code }. Qualquer outra forma → null. */
export function parseDeepLink(value) {
  if (typeof value !== 'string' || value.length > 200) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== `${DEEP_SCHEME}:` || url.username || url.password || url.search || url.hash) return null;
  const parts = [url.hostname, ...url.pathname.split('/')].filter(Boolean);
  if (parts.length !== 2 || parts[0] !== 'convite' || !CODE.test(parts[1])) return null;
  return { kind: 'convite', code: parts[1] };
}

/** O Windows passa o link como argumento ao abrir o aplicativo (ou à segunda instância). */
export function linkFromArgv(argv) {
  for (const arg of Array.isArray(argv) ? argv : []) {
    const link = parseDeepLink(arg);
    if (link) return link;
  }
  return null;
}
