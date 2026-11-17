/**
 * Lê o cabeçalho de uma imagem para saber o formato REAL (não o que o navegador disse), as dimensões e se
 * ela é animada. Só os formatos aceitos para foto de perfil, banner e emojis: PNG, JPEG, GIF e WebP.
 */
export interface ImageInfo {
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  width: number;
  height: number;
  animated: boolean;
}

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 16) return null;
  // PNG: assinatura + IHDR. Animado se tiver o pedaço acTL (APNG) antes dos dados.
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') {
    if (ascii(bytes, 12, 4) !== 'IHDR') return null;
    let animated = false;
    for (let at = 8; at + 8 <= bytes.length; ) {
      const length = u32be(bytes, at);
      const type = ascii(bytes, at + 4, 4);
      if (type === 'acTL') animated = true;
      if (type === 'IDAT' || type === 'IEND') break;
      at += 12 + length;
    }
    return { mime: 'image/png', width: u32be(bytes, 16), height: u32be(bytes, 20), animated };
  }
  // GIF: tela lógica no cabeçalho; animado se houver mais de um quadro.
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    return { mime: 'image/gif', width: u16le(bytes, 6), height: u16le(bytes, 8), animated: gifFrames(bytes) > 1 };
  }
  // JPEG: procura o marcador de início de quadro (SOF0..SOF15, menos DHT/JPG/DAC).
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let at = 2; at + 9 < bytes.length; ) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      const length = u16be(bytes, at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', width: u16be(bytes, at + 7), height: u16be(bytes, at + 5), animated: false };
      }
      at += 2 + length;
    }
    return null;
  }
  // WebP: RIFF....WEBP com VP8 (com perdas), VP8L (sem perdas) ou VP8X (estendido, pode ser animado).
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X' && bytes.length >= 30) {
      return { mime: 'image/webp', width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1, animated: (bytes[20]! & 0x02) !== 0 };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      return { mime: 'image/webp', width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff, animated: false };
    }
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, animated: false };
    }
  }
  return null;
}

/** Conta os quadros de um GIF (para no segundo: basta saber se é animado). */
function gifFrames(bytes: Uint8Array): number {
  let at = 13;
  const flags = bytes[10]!;
  if (flags & 0x80) at += 3 * (1 << ((flags & 0x07) + 1));
  let frames = 0;
  while (at < bytes.length) {
    const block = bytes[at]!;
    if (block === 0x3b) break;
    if (block === 0x21) {
      at += 2;
      while (at < bytes.length && bytes[at]! > 0) at += bytes[at]! + 1;
      at += 1;
    } else if (block === 0x2c) {
      frames += 1;
      if (frames > 1) return frames;
      const local = bytes[at + 9]!;
      at += 10;
      if (local & 0x80) at += 3 * (1 << ((local & 0x07) + 1));
      at += 1;
      while (at < bytes.length && bytes[at]! > 0) at += bytes[at]! + 1;
      at += 1;
    } else {
      break;
    }
  }
  return frames;
}
