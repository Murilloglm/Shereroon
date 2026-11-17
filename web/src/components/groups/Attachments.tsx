import { Download, File as FileIcon, FileArchive, FileAudio, FileText, FileVideo, Play, X } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { groups, type Attachment } from '../../lib/groups/client.ts';
import { cx, IconButton, MotionSafeImage } from '../ui.tsx';
import { errorText } from './common.tsx';

export type FileKind = 'imagem' | 'video' | 'audio' | 'arquivo';

/** De onde vêm os arquivos: do chat dos grupos (padrão) ou das mensagens privadas. */
export type FileSource = (fileId: string) => Promise<string>;
const SourceContext = createContext<FileSource>((fileId) => groups.fileUrl(fileId));
export const FileSourceProvider = SourceContext.Provider;

const IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const VIDEOS = new Set(['video/mp4', 'video/webm']);
const AUDIOS = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4']);

/** Só o que o servidor entrega com o tipo real é mostrado dentro da conversa; o resto vira cartão de download. */
export function kindOf(mime: string): FileKind {
  return IMAGES.has(mime) ? 'imagem' : VIDEOS.has(mime) ? 'video' : AUDIOS.has(mime) ? 'audio' : 'arquivo';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

/** Baixa o arquivo (com a sessão da conta) e entrega ao navegador para salvar com o nome original. */
export async function saveFile(file: Pick<Attachment, 'id' | 'name'>, source: FileSource = (fileId) => groups.fileUrl(fileId)): Promise<void> {
  try {
    const link = document.createElement('a');
    link.href = await source(file.id);
    link.download = file.name;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  } catch (error) {
    groups.notify(errorText(error, 'Não foi possível baixar o arquivo.'));
  }
}

function useFileUrl(fileId: string, enabled: boolean): { url: string | null; failed: boolean } {
  const source = useContext(SourceContext);
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    source(fileId).then(
      (url) => alive && setState({ url, failed: false }),
      () => alive && setState({ url: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [fileId, enabled, source]);
  return state;
}

function FileCard({ file, icon }: { file: Attachment; icon?: 'video' | 'audio' }) {
  const source = useContext(SourceContext);
  const lower = file.name.toLowerCase();
  const Icon =
    icon === 'video' ? FileVideo : icon === 'audio' ? FileAudio : /\.(zip|rar|7z|tar|gz)$/.test(lower) ? FileArchive : /\.(txt|md|pdf|docx?|odt|rtf|csv|xlsx?|pptx?)$/.test(lower) ? FileText : FileIcon;
  return (
    <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-ink-600/80 bg-ink-800/80 p-2.5" data-testid="attachment-file" data-name={file.name}>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-fog-100">{file.name}</p>
        <p className="text-xs text-fog-500">{formatBytes(file.size)}</p>
      </div>
      <IconButton label={`Baixar ${file.name}`} className="border border-ink-600 bg-ink-750" onClick={() => void saveFile(file, source)} data-testid="attachment-download">
        <Download className="size-4.5" />
      </IconButton>
    </div>
  );
}

function ImageAttachment({ file, onOpen }: { file: Attachment; onOpen: (url: string) => void }) {
  const { url, failed } = useFileUrl(file.id, true);
  // Reserva o espaço antes de a imagem chegar, para a conversa não pular.
  const ratio = file.width && file.height ? file.width / file.height : 16 / 9;
  // Imagem minúscula (um ícone, um pixel) ainda precisa de um tamanho que dê para clicar.
  const width = Math.max(72, Math.round(Math.min(420, file.width ?? 420, 320 * ratio)));
  if (failed) return <FileCard file={file} />;
  return (
    <button
      type="button"
      className="relative block max-w-full overflow-hidden rounded-xl border border-ink-600/80 bg-ink-800 transition-shadow hover:shadow-glow"
      style={{ width, aspectRatio: String(ratio) }}
      onClick={() => url && onOpen(url)}
      aria-label={`Abrir a imagem ${file.name}`}
      data-testid="attachment-image"
      data-loaded={url !== null}
    >
      {url ? <MotionSafeImage src={url} alt={file.name} className="size-full object-cover" /> : <span className="block size-full animate-pulse bg-ink-750" />}
      {url && file.mime === 'image/gif' && <span className="absolute right-1.5 bottom-1.5 rounded bg-ink-950/80 px-1.5 text-[10px] font-extrabold text-white">GIF</span>}
    </button>
  );
}

/** Vídeo e áudio só são baixados quando a pessoa pede para tocar. */
function MediaAttachment({ file, kind }: { file: Attachment; kind: 'video' | 'audio' }) {
  const source = useContext(SourceContext);
  const [wanted, setWanted] = useState(false);
  const { url, failed } = useFileUrl(file.id, wanted);
  if (failed) return <FileCard file={file} icon={kind} />;
  if (url) {
    return kind === 'video' ? (
      <video src={url} controls autoPlay className="max-h-80 max-w-full rounded-xl border border-ink-600/80 bg-black" data-testid="attachment-video" />
    ) : (
      <audio src={url} controls autoPlay className="w-full max-w-md" data-testid="attachment-audio" />
    );
  }
  return (
    <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-ink-600/80 bg-ink-800/80 p-2.5" data-testid="attachment-media" data-name={file.name}>
      <button
        type="button"
        onClick={() => setWanted(true)}
        disabled={wanted}
        aria-label={`Tocar ${file.name}`}
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-brand-500 to-brand-700 text-on-accent shadow-glow disabled:opacity-60"
      >
        <Play className={cx('size-5', wanted && 'animate-pulse')} aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-fog-100">{file.name}</p>
        <p className="text-xs text-fog-500">
          {kind === 'video' ? 'Vídeo' : 'Áudio'} • {formatBytes(file.size)}
        </p>
      </div>
      <IconButton label={`Baixar ${file.name}`} className="border border-ink-600 bg-ink-750" onClick={() => void saveFile(file, source)}>
        <Download className="size-4.5" />
      </IconButton>
    </div>
  );
}

/** Os anexos de uma mensagem: imagens em miniatura (clicar amplia), vídeo e áudio com player, o resto para baixar. */
export function Attachments({ files }: { files: Attachment[] }) {
  const source = useContext(SourceContext);
  const [open, setOpen] = useState<{ file: Attachment; url: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (files.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-start gap-2" data-testid="attachments">
      {files.map((file) => {
        const kind = kindOf(file.mime);
        if (kind === 'imagem') return <ImageAttachment key={file.id} file={file} onOpen={(url) => setOpen({ file, url })} />;
        if (kind === 'arquivo') return <FileCard key={file.id} file={file} />;
        return <MediaAttachment key={file.id} file={file} kind={kind} />;
      })}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={open.file.name}
          className="fixed inset-0 z-50 flex animate-fade flex-col items-center justify-center gap-3 bg-ink-950/90 p-4 backdrop-blur-sm"
          onPointerDown={(event) => event.target === event.currentTarget && setOpen(null)}
          data-testid="lightbox"
        >
          <img src={open.url} alt={open.file.name} className="max-h-[82dvh] max-w-full rounded-xl object-contain shadow-panel" />
          <div className="flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-850 px-3 py-1.5">
            <span className="max-w-[50vw] truncate text-sm font-semibold">{open.file.name}</span>
            <span className="text-xs text-fog-500">{formatBytes(open.file.size)}</span>
            <IconButton label="Baixar" onClick={() => void saveFile(open.file, source)}>
              <Download className="size-4.5" />
            </IconButton>
            <IconButton label="Fechar" onClick={() => setOpen(null)}>
              <X className="size-4.5" />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}
