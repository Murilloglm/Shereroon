/** Formatação pt-BR. Valor ausente vira travessão — nunca um número inventado. */
const DASH = '—';

const decimal = (digits: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const one = decimal(1);
const zero = decimal(0);

export function formatBitrate(kbps: number | null | undefined): string {
  if (kbps == null) return DASH;
  return kbps >= 1000 ? `${one.format(kbps / 1000)} Mbps` : `${zero.format(kbps)} kbps`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return DASH;
  return `${zero.format(ms)} ms`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return DASH;
  return `${one.format(value)} %`;
}

export function formatFps(fps: number | null | undefined): string {
  if (fps == null) return DASH;
  return `${zero.format(fps)} FPS`;
}

export function formatSize(width: number | null | undefined, height: number | null | undefined): string {
  if (width == null || height == null) return DASH;
  return `${width}×${height}`;
}

/** "1080p" a partir da altura real do quadro. */
export function formatHeight(height: number | null | undefined): string {
  return height == null ? DASH : `${height}p`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(parts[0] ?? '')[0] ?? '?';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Cor estável por pessoa, sempre dentro da paleta fria do tema. */
export function hueFor(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return 205 + (hash % 130);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Sem permissão de área de transferência (ou página não segura): cai no método antigo.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  }
}
