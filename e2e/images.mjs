// Imagens de teste geradas na hora (sem arquivos binários no repositório): PNG e BMP de uma cor só.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { root } from './harness.mjs';

function save(name, bytes) {
  const folder = resolve(root, 'e2e/.artifacts');
  mkdirSync(folder, { recursive: true });
  const file = resolve(folder, name);
  writeFileSync(file, bytes);
  return file;
}

/** PNG RGBA de uma cor só. */
export function pngFile(name, width, height, rgba = [108, 77, 255, 255]) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(rgba, y * (width * 4 + 1) + 1 + x * 4);
  return save(name, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/** BMP de 24 bits de uma cor só: um formato que o servidor não guarda, então o app precisa converter. */
export function bmpFile(name, width, height, rgb = [40, 200, 120]) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([rgb[2], rgb[1], rgb[0]], y * rowSize + x * 3);
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixels.length, 34);
  return save(name, Buffer.concat([header, pixels]));
}

/** A imagem de verdade apareceu? (carregou, com largura real; um ícone de imagem quebrada não conta.) */
export const imageShows = (locator) => locator.evaluate((image) => image.complete && image.naturalWidth > 0);
