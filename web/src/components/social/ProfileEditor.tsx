import { ImagePlus, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dialogs } from '../../lib/dialogs.ts';
import { groups } from '../../lib/groups/client.ts';
import { prepareProfileImage } from '../../lib/images.ts';
import { mediaUrl, social, type Profile } from '../../lib/social/client.ts';
import { useStore } from '../../lib/store.ts';
import { Avatar, Button, cx, DEFAULT_AVATARS, TextInput } from '../ui.tsx';
import { errorText, fieldLabel } from '../groups/common.tsx';

const BANNER_COLORS = ['#6c4dff', '#4b348e', '#74d7ff', '#14c2f0', '#1d2142', '#e23a66', '#45e283', '#ffc65c'];
// Qualquer imagem; as extensões entram porque o Windows nem sempre diz que HEIC, AVIF ou JFIF são imagens.
const ACCEPT = 'image/*,.avif,.bmp,.gif,.heic,.heif,.ico,.jfif,.jpeg,.jpg,.png,.svg,.tif,.tiff,.webp';

/**
 * Perfil da conta, com prévia antes de salvar. Aceita qualquer imagem que o app consiga abrir: o que o servidor
 * não guarda como está é convertido antes (veja lib/images.ts). GIF, WebP e PNG animados continuam animados.
 */
export function ProfileEditor({ userId }: { userId: string }) {
  const saved = useStore(social.store, (state) => state.profiles[userId]);
  const [draft, setDraft] = useState<Partial<Profile> | null>(null);
  const [preview, setPreview] = useState<{ kind: 'avatar' | 'banner'; url: string; file: File } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void social.profile(userId, true).catch(() => undefined);
  }, [userId]);
  useEffect(() => {
    if (saved && !draft) setDraft({ displayName: saved.displayName, bio: saved.bio ?? '', status: saved.status ?? '', avatar: saved.avatar, banner: saved.banner });
  }, [saved, draft]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  if (!saved || !draft) return <p className="text-sm text-fog-400">Carregando o perfil…</p>;
  const set = (patch: Partial<Profile>) => setDraft((current) => ({ ...current, ...patch }));
  const dirty = (['displayName', 'bio', 'status', 'avatar', 'banner'] as const).some((key) => (draft[key] ?? null) !== ((key === 'bio' || key === 'status' ? (saved[key] ?? '') : saved[key]) ?? null));

  const pick = async (kind: 'avatar' | 'banner', file: File | undefined) => {
    if (!file) return;
    let ready: File;
    try {
      ready = await prepareProfileImage(file, kind);
    } catch (error) {
      await dialogs.alert({ kind: 'aviso', title: 'Imagem não aceita', message: error instanceof Error ? error.message : 'Não foi possível ler esta imagem.' });
      return;
    }
    setPreview({ kind, url: URL.createObjectURL(ready), file: ready });
  };

  const upload = async () => {
    if (!preview) return;
    setProgress(0);
    try {
      const profile = await social.uploadMedia(preview.kind, preview.file, setProgress).done;
      set({ [preview.kind]: profile[preview.kind] });
      setPreview(null);
      groups.notify(preview.kind === 'avatar' ? 'Foto de perfil atualizada.' : 'Banner atualizado.');
    } catch (error) {
      await dialogs.alert({ kind: 'erro', title: 'Não foi possível enviar', message: errorText(error) });
    } finally {
      setProgress(null);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const profile = await social.updateProfile({
        displayName: draft.displayName,
        bio: draft.bio,
        status: draft.status,
        avatar: draft.avatar?.startsWith('arquivo:') ? undefined : draft.avatar,
        banner: draft.banner?.startsWith('arquivo:') ? undefined : draft.banner,
      });
      setDraft({ displayName: profile.displayName, bio: profile.bio ?? '', status: profile.status ?? '', avatar: profile.avatar, banner: profile.banner });
      groups.notify('Perfil salvo.');
    } catch (error) {
      await dialogs.alert({ kind: 'erro', title: 'Não foi possível salvar', message: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const bannerColor = draft.banner?.startsWith('cor:') ? draft.banner.slice(4) : null;
  const bannerImage = preview?.kind === 'banner' ? preview.url : mediaUrl(draft.banner);
  const avatarPreview = preview?.kind === 'avatar' ? preview.url : null;

  return (
    <div className="grid gap-4" data-testid="profile-editor">
      {/* Prévia do cartão como os outros vão ver. */}
      <div className="overflow-hidden rounded-2xl border border-brand-400/40 bg-ink-900" data-testid="profile-preview">
        <div className="h-20" style={{ background: bannerImage ? `center / cover no-repeat url("${bannerImage}")` : (bannerColor ?? 'linear-gradient(120deg, #4b348e, #6c4dff 55%, #74d7ff)') }} />
        <div className="flex items-end gap-3 px-4 pb-3">
          <div className="-mt-8 rounded-full border-4 border-ink-900">
            {avatarPreview ? <img src={avatarPreview} alt="" className="size-16 rounded-full object-cover" /> : <Avatar id={userId} name={draft.displayName || saved.displayName} size={64} image={draft.avatar} />}
          </div>
          <div className="min-w-0 pb-1">
            <p className="truncate font-extrabold">{draft.displayName || saved.displayName}</p>
            {draft.status && <p className="truncate text-xs text-fog-300">{draft.status}</p>}
          </div>
        </div>
        {draft.bio && <p className="px-4 pb-3 text-sm whitespace-pre-line text-fog-300">{draft.bio}</p>}
      </div>

      {preview && (
        <div className="flex items-center gap-3 rounded-xl border border-neon-400/40 bg-neon-500/10 p-3" data-testid="profile-upload-preview">
          <p className="min-w-0 flex-1 text-sm">
            Prévia {preview.kind === 'avatar' ? 'da foto' : 'do banner'}: <b className="break-all">{preview.file.name}</b>
          </p>
          <Button size="sm" onClick={() => setPreview(null)} disabled={progress !== null}>Descartar</Button>
          <Button size="sm" variant="primary" onClick={() => void upload()} disabled={progress !== null} data-testid="profile-upload-confirm">
            {progress !== null ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> {Math.round(progress * 100)}%</> : 'Usar esta imagem'}
          </Button>
        </div>
      )}

      <div>
        <p className={fieldLabel}>Foto de perfil</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {DEFAULT_AVATARS.map((_, index) => (
            <button key={index} type="button" onClick={() => set({ avatar: `padrao:${index}` })} aria-label={`Avatar padrão ${index + 1}`} aria-pressed={draft.avatar === `padrao:${index}`} className={cx('rounded-full p-0.5', draft.avatar === `padrao:${index}` ? 'ring-2 ring-neon-400' : 'hover:ring-1 hover:ring-ink-500')} data-testid="profile-default-avatar">
              <Avatar id={userId} name={draft.displayName || saved.displayName} size={36} image={`padrao:${index}`} />
            </button>
          ))}
          <button type="button" onClick={() => set({ avatar: null })} className={cx('rounded-full p-0.5', !draft.avatar ? 'ring-2 ring-neon-400' : 'hover:ring-1 hover:ring-ink-500')} aria-label="Usar as iniciais" aria-pressed={!draft.avatar}>
            <Avatar id={userId} name={draft.displayName || saved.displayName} size={36} />
          </button>
          <label className="flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-brand-400/60 px-3 text-sm font-bold text-brand-200 hover:bg-brand-500/10">
            <ImagePlus className="size-4" aria-hidden="true" /> Enviar imagem
            <input type="file" accept={ACCEPT} className="sr-only" onChange={(event) => (void pick('avatar', event.target.files?.[0]), (event.target.value = ''))} data-testid="profile-avatar-file" />
          </label>
        </div>
      </div>

      <div>
        <p className={fieldLabel}>Banner</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {BANNER_COLORS.map((color) => (
            <button key={color} type="button" onClick={() => set({ banner: `cor:${color}` })} aria-label={`Banner da cor ${color}`} aria-pressed={draft.banner === `cor:${color}`} className={cx('size-8 rounded-lg', draft.banner === `cor:${color}` ? 'ring-2 ring-neon-400 ring-offset-2 ring-offset-ink-850' : '')} style={{ background: color }} />
          ))}
          <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-brand-400/60 px-3 text-sm font-bold text-brand-200 hover:bg-brand-500/10">
            <ImagePlus className="size-4" aria-hidden="true" /> Enviar imagem ou GIF
            <input type="file" accept={ACCEPT} className="sr-only" onChange={(event) => (void pick('banner', event.target.files?.[0]), (event.target.value = ''))} data-testid="profile-banner-file" />
          </label>
        </div>
      </div>

      <label className={fieldLabel}>
        Nome que aparece para os outros
        <TextInput value={draft.displayName ?? ''} maxLength={32} onChange={(event) => set({ displayName: event.target.value })} data-testid="profile-display-name" />
      </label>
      <label className={fieldLabel}>
        Status
        <TextInput value={draft.status ?? ''} maxLength={60} placeholder="Ex.: jogando, estudando, de volta às 20h" onChange={(event) => set({ status: event.target.value })} data-testid="profile-status-input" />
      </label>
      <label className={fieldLabel}>
        Sobre você <span className="font-normal text-fog-500">(pode ficar vazio • {(draft.bio ?? '').length}/190)</span>
        <textarea value={draft.bio ?? ''} maxLength={190} rows={3} onChange={(event) => set({ bio: event.target.value })} className="resize-none rounded-xl border border-ink-600 bg-ink-850 px-3 py-2 text-[15px] outline-none focus:border-neon-400" data-testid="profile-bio-input" />
      </label>
      <div className="flex gap-2">
        <Button variant="primary" disabled={busy || !dirty || !(draft.displayName ?? '').trim()} onClick={() => void save()} data-testid="profile-save">
          {busy ? 'Salvando…' : 'Salvar perfil'}
        </Button>
        {dirty && <Button onClick={() => setDraft(null)}>Desfazer mudanças</Button>}
      </div>
    </div>
  );
}
