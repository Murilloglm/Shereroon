import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { imageInfo } from '../src/image-info.ts';

function png(width: number, height: number, animated = false): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      ...(animated ? [chunk('acTL', Buffer.alloc(8))] : []),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** GIF de `frames` quadros (cada um com um bloco de imagem mínimo). */
function gif(width: number, height: number, frames: number): Uint8Array {
  const header = Buffer.from('GIF89a', 'ascii');
  const screen = Buffer.from([width & 0xff, width >> 8, height & 0xff, height >> 8, 0x00, 0, 0]);
  const frame = Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0, 0, 0, 0, width & 0xff, width >> 8, height & 0xff, height >> 8, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00]);
  return new Uint8Array(Buffer.concat([header, screen, ...Array.from({ length: frames }, () => frame), Buffer.from([0x3b])]));
}

const JPEG_1X1 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const WEBP_1X1 = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

describe('leitura do cabeçalho das imagens', () => {
  it('PNG: dimensões e animação (APNG)', () => {
    expect(imageInfo(png(320, 180))).toEqual({ mime: 'image/png', width: 320, height: 180, animated: false });
    expect(imageInfo(png(64, 64, true))?.animated).toBe(true);
  });

  it('GIF: estático e animado', () => {
    expect(imageInfo(gif(10, 12, 1))).toEqual({ mime: 'image/gif', width: 10, height: 12, animated: false });
    expect(imageInfo(gif(10, 12, 3))).toEqual({ mime: 'image/gif', width: 10, height: 12, animated: true });
  });

  it('JPEG e WebP', () => {
    expect(imageInfo(new Uint8Array(Buffer.from(JPEG_1X1, 'base64')))).toEqual({ mime: 'image/jpeg', width: 1, height: 1, animated: false });
    expect(imageInfo(new Uint8Array(Buffer.from(WEBP_1X1, 'base64')))).toEqual({ mime: 'image/webp', width: 1, height: 1, animated: false });
  });

  it('o que não é imagem (ou é outro formato com o nome trocado) é recusado', () => {
    expect(imageInfo(new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')))).toBeNull();
    expect(imageInfo(new Uint8Array(Buffer.from('MZ\x90\x00 programa do Windows com nome de foto.png')))).toBeNull();
    expect(imageInfo(new Uint8Array(4))).toBeNull();
  });
});
