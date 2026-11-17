// Foto de perfil e banner: aceita qualquer imagem que o app consiga abrir (PNG, JPEG, GIF, WebP, AVIF, BMP,
// ICO, SVG...). O servidor guarda só PNG, JPEG, GIF e WebP e confere o arquivo de novo; aqui o que não cabe
// nisso (outro formato, grande ou pequena demais) é convertido para WebP antes de enviar. Imagens animadas
// vão como estão, ou são recusadas com o motivo: a animação nunca some em silêncio.
import { imageInfo } from '../../../shared/image-info.ts';

export type ProfileImageKind = 'avatar' | 'banner';
type StoredMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const MB = 1024 * 1024;
/** Maior arquivo que o app tenta abrir para converter. */
const MAX_INPUT_BYTES = 40 * MB;

/** Os mesmos limites do servidor (SOCIAL_LIMITS e as dimensões conferidas no envio). `target`: lado maior ao converter. */
export const PROFILE_IMAGE_LIMITS = {
  avatar: { minWidth: 32, minHeight: 32, maxSide: 2048, bytes: 2 * MB, animatedBytes: 4 * MB, target: 1024 },
  banner: { minWidth: 300, minHeight: 100, maxSide: 4096, bytes: 6 * MB, animatedBytes: 6 * MB, target: 2400 },
} as const;

export type ImagePlan = { action: 'manter' } | { action: 'converter'; width: number; height: number } | { action: 'recusar'; reason: string };

/** Decide o que fazer com a imagem. `mime` null: formato que o servidor não guarda como está. */
export function planImage(input: { mime: StoredMime | null; bytes: number; width: number; height: number; animated: boolean }, kind: ProfileImageKind): ImagePlan {
  const limit = PROFILE_IMAGE_LIMITS[kind];
  const { width, height } = input;
  const fits = width >= limit.minWidth && height >= limit.minHeight && width <= limit.maxSide && height <= limit.maxSide;
  if (input.animated && input.mime) {
    if (input.bytes > limit.animatedBytes) {
      return { action: 'recusar', reason: `A imagem animada passa de ${limit.animatedBytes / MB} MB. Escolha uma menor ou uma imagem sem animação.` };
    }
    if (!fits) {
      return {
        action: 'recusar',
        reason:
          kind === 'avatar'
            ? 'Imagens animadas não são redimensionadas: a foto animada deve ter de 32 a 2048 pixels de lado.'
            : 'Imagens animadas não são redimensionadas: o banner animado deve ter pelo menos 300 × 100 pixels e no máximo 4096.',
      };
    }
    return { action: 'manter' };
  }
  if (input.mime && fits && input.bytes <= limit.bytes) return { action: 'manter' };
  const scale = Math.max(Math.min(1, limit.target / Math.max(width, height)), limit.minWidth / width, limit.minHeight / height);
  const next = { width: Math.round(width * scale), height: Math.round(height * scale) };
  if (next.width > limit.maxSide || next.height > limit.maxSide) {
    return {
      action: 'recusar',
      reason: kind === 'avatar' ? 'Esta imagem é estreita demais para virar foto de perfil. Recorte-a e tente de novo.' : 'Esta imagem é estreita demais para virar banner. Recorte-a e tente de novo.',
    };
  }
  return { action: 'converter', ...next };
}

export function unreadableMessage(fileName: string): string {
  const extension = /\.([a-z0-9]{1,6})$/i.exec(fileName)?.[1]?.toLowerCase();
  return `Não consegui abrir esta imagem${extension ? ` (.${extension})` : ''}. Fotos HEIC do iPhone e arquivos TIFF não abrem no app: salve a imagem como JPG ou PNG e tente de novo.`;
}

interface Decoded {
  width: number;
  height: number;
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
  close: () => void;
}

/** Abre a imagem com o decodificador do próprio navegador. SVG (que createImageBitmap não abre) vai por <img>. */
async function decode(file: File): Promise<Decoded | null> {
  try {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height, draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height), close: () => bitmap.close() };
  } catch {
    // segue para <img>
  }
  const typed = file.type || !/\.svgz?$/i.test(file.name) ? file : new Blob([file], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(typed);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // SVG sem tamanho próprio: desenha num quadrado de 512.
    const width = image.naturalWidth || 512;
    const height = image.naturalHeight || 512;
    return { width, height, draw: (context, w, h) => context.drawImage(image, 0, 0, w, h), close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** Desenha no tamanho pedido e codifica em WebP, baixando a qualidade (e depois o tamanho) até caber no limite. */
async function convert(decoded: Decoded, width: number, height: number, kind: ProfileImageKind): Promise<Blob> {
  const limit = PROFILE_IMAGE_LIMITS[kind];
  let size = { width, height };
  for (let round = 0; round < 4; round++) {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) break;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    decoded.draw(context, size.width, size.height);
    for (const quality of [0.92, 0.85, 0.75, 0.6]) {
      const blob = (await toBlob(canvas, 'image/webp', quality)) ?? null;
      // Sem codificador WebP, o navegador devolve PNG.
      const result = blob && blob.type === 'image/webp' ? blob : await toBlob(canvas, 'image/png');
      if (result && result.size <= limit.bytes) return result;
      if (result && result.type !== 'image/webp') break;
    }
    const smaller = { width: Math.round(size.width * 0.75), height: Math.round(size.height * 0.75) };
    if (smaller.width < limit.minWidth || smaller.height < limit.minHeight) break;
    size = smaller;
  }
  throw new Error(`Não consegui deixar a imagem abaixo de ${limit.bytes / MB} MB. Escolha outra imagem.`);
}

/**
 * Prepara a imagem escolhida para enviar: devolve o próprio arquivo (quando o servidor aceita como está) ou
 * uma versão convertida. Lança um Error com a mensagem para a pessoa quando não dá.
 */
export async function prepareProfileImage(file: File, kind: ProfileImageKind): Promise<File> {
  if (file.size > MAX_INPUT_BYTES) throw new Error(`A imagem passa de ${MAX_INPUT_BYTES / MB} MB. Escolha uma menor.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = imageInfo(bytes);
  const decoded = await decode(file);
  if (!decoded) throw new Error(unreadableMessage(file.name));
  try {
    const plan = planImage(
      { mime: info?.mime ?? null, bytes: bytes.length, width: info?.width ?? decoded.width, height: info?.height ?? decoded.height, animated: info?.animated ?? false },
      kind,
    );
    if (plan.action === 'recusar') throw new Error(plan.reason);
    if (plan.action === 'manter') return new File([bytes], file.name, { type: info!.mime });
    // Ao converter, vale o tamanho já girado pela orientação da foto (EXIF).
    const scale = plan.width / (info?.width ?? decoded.width);
    const blob = await convert(decoded, Math.max(1, Math.round(decoded.width * scale)), Math.max(1, Math.round(decoded.height * scale)), kind);
    const base = file.name.replace(/\.[^.]*$/, '') || 'imagem';
    return new File([blob], `${base}.${blob.type === 'image/webp' ? 'webp' : 'png'}`, { type: blob.type });
  } finally {
    decoded.close();
  }
}
