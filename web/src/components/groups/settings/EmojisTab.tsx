import { ImagePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { dialogs } from '../../../lib/dialogs.ts';
import { groups, type GroupView } from '../../../lib/groups/client.ts';
import { Button, emojiUrl, IconButton, MotionSafeImage, Notice, TextInput } from '../../ui.tsx';
import { errorText, fieldLabel } from '../common.tsx';

/** Emojis próprios do grupo: PNG, GIF (animado) ou WebP, de 16 a 256 px e até 256 KB; até 50 por grupo. */
export function EmojisTab({ view }: { view: GroupView }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const emojis = view.emojis ?? [];

  const send = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await groups.uploadTo(`/api/groups/${view.group.id}/emojis?${new URLSearchParams({ name: name.trim() })}`, file, () => undefined, 'emoji' as never).done;
      setName('');
      setFile(null);
      await groups.refreshView();
      groups.notify('Emoji adicionado.');
    } catch (error) {
      await dialogs.alert({ kind: 'erro', title: 'Emoji não adicionado', message: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4" data-testid="emojis-tab">
      <Notice>Use :nome: nas mensagens e nas reações. Formatos: PNG, GIF animado ou WebP, de 16 a 256 pixels e até 256 KB. Cada grupo tem até 50.</Notice>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className={fieldLabel}>
          Nome do emoji
          <TextInput value={name} onChange={(event) => setName(event.target.value.toLowerCase())} maxLength={32} placeholder="festa" data-testid="emoji-name" />
        </label>
        <label className="flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-brand-400/60 px-3 text-sm font-bold text-brand-200 hover:bg-brand-500/10">
          <ImagePlus className="size-4" aria-hidden="true" /> {file ? file.name : 'Escolher imagem'}
          <input type="file" accept="image/png,image/gif,image/webp" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] ?? null)} data-testid="emoji-file" />
        </label>
        <Button variant="primary" disabled={busy || !file || !/^[a-z0-9_]{2,32}$/.test(name.trim())} onClick={() => void send()} data-testid="emoji-add">
          Adicionar
        </Button>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {emojis.length === 0 && <li className="text-sm text-fog-500">Nenhum emoji próprio ainda.</li>}
        {emojis.map((emoji) => (
          <li key={emoji.id} className="flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-800/40 px-2.5 py-2" data-testid="emoji-row" data-name={emoji.name}>
            <MotionSafeImage src={emojiUrl(emoji.id)} alt={`:${emoji.name}:`} className="size-8 object-contain" />
            <code className="min-w-0 flex-1 truncate text-sm">:{emoji.name}:</code>
            {emoji.animated && <span className="text-[10px] font-extrabold text-neon-300">GIF</span>}
            <IconButton
              label={`Excluir :${emoji.name}:`}
              className="size-8 hover:text-live-300"
              onClick={() =>
                void dialogs.remove({
                  title: 'Excluir o emoji?',
                  item: `:${emoji.name}:`,
                  message: 'Mensagens e reações antigas com ele passam a mostrar só o nome.',
                  action: async () => (await groups.call('DELETE', `/api/emojis/${emoji.id}`), await groups.refreshView()),
                })
              }
              data-testid="emoji-delete"
            >
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
