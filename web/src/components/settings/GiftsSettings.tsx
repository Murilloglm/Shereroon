import { collectionById, type CosmeticCollection } from '../../../../shared/cosmetics.ts';
import type { CollectionQuote } from '../../lib/cosmetics.ts';
import { Gift, Package, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { itemById, KIND_NAMES, PACK_DISCOUNT, packById, type CosmeticItem, type CosmeticPack } from '../../../../shared/cosmetics.ts';
import { cosmetics, type PackGiftQuote } from '../../lib/cosmetics.ts';
import { dialogs } from '../../lib/dialogs.ts';
import { groups } from '../../lib/groups/client.ts';
import { social } from '../../lib/social/client.ts';
import { useStore } from '../../lib/store.ts';
import { errorText, selectClass } from '../groups/common.tsx';
import { Button, Modal, TextInput } from '../ui.tsx';

export function RedeemCode() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const key = useRef(crypto.randomUUID());
  return <section className="grid gap-3 rounded-2xl border border-neon-400/20 bg-ink-900/80 p-4">
    <h2 className="font-extrabold text-neon-300">Resgatar Código</h2>
    <p className="text-sm text-fog-400">Receba Cosmic Points e recompensas das promoções oficiais.</p>
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setBusy(true); setError(''); setSuccess(''); void cosmetics.redeem(code, key.current).then(({ reward }) => {
      setSuccess(reward.kind === 'points' ? `${reward.points?.toLocaleString('pt-BR')} Cosmic Points adicionados!` : `${itemById(reward.itemId ?? '')?.name ?? 'Item'} adicionado ao inventário!`);
      setCode(''); key.current = crypto.randomUUID();
    }).catch((err) => setError(errorText(err))).finally(() => setBusy(false)); }}>
      <TextInput className="min-w-40 flex-1" aria-label="Código promocional" placeholder="Ex.: Update3.1" value={code} maxLength={64} required disabled={busy} autoComplete="off" onChange={(event) => { setCode(event.target.value); key.current = crypto.randomUUID(); setSuccess(''); }} />
      <Button type="submit" variant="primary" disabled={busy || !code.trim()}>{busy ? 'Resgatando…' : 'Resgatar'}</Button>
    </form>
    {error && <p role="alert" className="text-sm text-live-300">{error}</p>}
    {success && <p role="status" className="text-sm text-ok-400">{success}</p>}
  </section>;
}

export function GiftDialog({ item, transfer = false, onClose }: { item: CosmeticItem; transfer?: boolean; onClose: () => void }) {
  const friends = useStore(social.store, (state) => state.friends)?.filter((friend) => friend.state === 'amigos');
  const unlimited = useStore(cosmetics.store, (state) => state.points?.unlimited === true);
  const [recipientId, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  useEffect(() => { void social.loadFriends().catch((err) => setError(errorText(err))); }, []);
  return <Modal title={transfer ? 'Transferir decoração' : 'Presentear um amigo'} onClose={busy ? () => undefined : onClose}>
    <form className="grid gap-4" onSubmit={(event) => {
      event.preventDefault(); setError('');
      const recipient = friends?.find((friend) => friend.user.id === recipientId);
      if (!recipient) return;
      setBusy(true);
      void dialogs.confirm({ title: transfer ? 'Confirmar transferência?' : 'Confirmar presente?', message: <div className="grid gap-2"><p><strong>{item.name}</strong> para <strong>{recipient.user.displayName}</strong> (@{recipient.user.username}).</p><p>{transfer ? 'O item sairá do seu inventário e será desequipado.' : unlimited ? 'Aquisição administrativa sem débito. O item de teste não poderá ser transferido.' : `Custo: ${item.price.toLocaleString('pt-BR')} Cosmic Points.`}</p>{message && <p className="whitespace-pre-wrap text-fog-400">Mensagem: {message}</p>}</div>, confirmLabel: transfer ? 'Transferir item' : 'Enviar presente', action: () => cosmetics.gift({ recipientId, itemId: item.id, message, kind: transfer ? 'transfer' : 'purchase', expectedPrice: item.price, requestId: key.current }) }).then((sent) => {
        if (sent) { groups.notify(`Presente enviado para ${recipient.user.displayName}.`); onClose(); }
      }).catch((err) => setError(errorText(err))).finally(() => setBusy(false));
    }}>
      <div className="flex items-center gap-3 rounded-xl bg-brand-500/10 p-3"><Gift className="size-6 text-neon-300" /><div><p className="font-bold">{item.name}</p><p className="text-sm text-fog-400">{transfer ? 'Transferência do seu inventário' : `${item.price.toLocaleString('pt-BR')} Cosmic Points`}</p></div></div>
      <label className="grid gap-1.5 text-sm font-bold">Destinatário<select aria-label="Amigo destinatário" value={recipientId} onChange={(event) => { setRecipient(event.target.value); key.current = crypto.randomUUID(); }} className={selectClass} required disabled={busy}>
        <option value="">Escolha um amigo</option>{friends?.map((friend) => <option key={friend.user.id} value={friend.user.id}>{friend.user.displayName} (@{friend.user.username})</option>)}
      </select></label>
      {friends?.length === 0 && <p className="text-sm text-fog-400">Adicione um amigo antes de enviar presentes.</p>}
      <label className="grid gap-1.5 text-sm font-bold">Mensagem (opcional)<textarea aria-label="Mensagem do presente" value={message} maxLength={300} disabled={busy} onChange={(event) => { setMessage(event.target.value); key.current = crypto.randomUUID(); }} className="min-h-24 rounded-xl bg-ink-950 p-3 text-sm outline-none focus:ring-1 focus:ring-brand-400" placeholder="Uma mensagem para acompanhar seu presente…" /></label>
      {error && <p role="alert" className="text-sm text-live-300">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy || !recipientId}><Send className="size-4" />Revisar {transfer ? 'transferência' : 'presente'}</Button>
    </form>
  </Modal>;
}

/**
 * Presentear um pacote: escolhido o amigo, o servidor diz quais peças ele ainda não tem e quanto custam juntas (com o
 * desconto do pacote). O amigo recebe só essas peças; quem envia confirma o preço antes.
 */
export function PackGiftDialog({ pack, onClose }: { pack: CosmeticPack; onClose: () => void }) {
  const friends = useStore(social.store, (state) => state.friends)?.filter((friend) => friend.state === 'amigos');
  const points = useStore(cosmetics.store, (state) => state.points?.points ?? 0);
  const unlimited = useStore(cosmetics.store, (state) => state.points?.unlimited === true);
  const [recipientId, setRecipient] = useState('');
  const [quote, setQuote] = useState<PackGiftQuote | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  useEffect(() => { void social.loadFriends().catch((err) => setError(errorText(err))); }, []);
  useEffect(() => {
    setQuote(null);
    if (!recipientId) return;
    let current = true;
    void cosmetics.packGiftQuote(pack.id, recipientId).then((next) => { if (current) setQuote(next); }).catch((err) => { if (current) setError(errorText(err)); });
    return () => { current = false; };
  }, [pack.id, recipientId]);
  const recipient = friends?.find((friend) => friend.user.id === recipientId);
  const pieces = (quote?.missing ?? []).map((id) => itemById(id)).filter((item): item is CosmeticItem => Boolean(item));
  const has = Object.values(pack.items).filter((id) => quote && !quote.missing.includes(id)).map((id) => itemById(id)?.name ?? id);
  const short = quote && !unlimited && points < quote.price ? quote.price - points : 0;
  const ready = Boolean(recipient && quote && quote.active && quote.missing.length > 0 && !short);
  return <Modal title={`Presentear o pacote ${pack.name}`} onClose={busy ? () => undefined : onClose}>
    <form className="grid gap-4" data-testid="pack-gift-dialog" onSubmit={(event) => {
      event.preventDefault(); setError('');
      if (!recipient || !quote || !ready) return;
      setBusy(true);
      void dialogs.confirm({
        title: 'Confirmar presente?',
        message: <div className="grid gap-2"><p>Pacote <strong>{pack.name}</strong> para <strong>{recipient.user.displayName}</strong> (@{recipient.user.username}): {pieces.length} {pieces.length === 1 ? 'peça' : 'peças'}.</p><p>{unlimited ? 'Aquisição administrativa sem débito. Os itens de teste não poderão ser transferidos.' : `Custo: ${quote.price.toLocaleString('pt-BR')} Cosmic Points.`}</p>{message && <p className="whitespace-pre-wrap text-fog-400">Mensagem: {message}</p>}</div>,
        confirmLabel: 'Enviar presente',
        action: () => cosmetics.giftPack({ recipientId, packId: pack.id, message, expectedPrice: quote.price, requestId: key.current }),
      }).then((sent) => {
        if (sent) { groups.notify(`Pacote ${pack.name} enviado para ${recipient.user.displayName}.`); onClose(); }
      }).catch((err) => setError(errorText(err))).finally(() => setBusy(false));
    }}>
      <div className="flex items-center gap-3 rounded-xl bg-brand-500/10 p-3"><Package className="size-6 text-neon-300" /><div><p className="font-bold">{pack.name}</p><p className="text-sm text-fog-400">Decoração, moldura, fundo, cor do nome e enfeite no nome</p></div></div>
      <label className="grid gap-1.5 text-sm font-bold">Destinatário<select aria-label="Amigo destinatário" value={recipientId} onChange={(event) => { setRecipient(event.target.value); setError(''); key.current = crypto.randomUUID(); }} className={selectClass} required disabled={busy} data-testid="pack-gift-recipient">
        <option value="">Escolha um amigo</option>{friends?.map((friend) => <option key={friend.user.id} value={friend.user.id}>{friend.user.displayName} (@{friend.user.username})</option>)}
      </select></label>
      {friends?.length === 0 && <p className="text-sm text-fog-400">Adicione um amigo antes de enviar presentes.</p>}
      {recipientId && !quote && !error && <p className="text-sm text-fog-400">Vendo o que seu amigo já tem…</p>}
      {quote && (
        <div className="grid gap-2 rounded-xl bg-ink-950/60 p-3 text-sm" data-testid="pack-gift-quote" data-price={quote.price}>
          {quote.missing.length === 0 ? (
            <p className="font-bold text-ok-400">Seu amigo já tem todas as peças deste pacote.</p>
          ) : (
            <>
              <p className="font-bold">Seu amigo vai receber:</p>
              <ul className="grid gap-0.5 text-fog-300">{pieces.map((item) => <li key={item.id}>• {item.name} <span className="text-fog-500">({KIND_NAMES[item.kind]})</span></li>)}</ul>
              {has.length > 0 && <p className="text-xs text-fog-500">Ele já tem: {has.join(', ')}. Essas peças ficam de fora e não são cobradas.</p>}
              <p className="font-bold text-warn-400">{quote.price.toLocaleString('pt-BR')} Cosmic Points{pieces.length >= 2 ? ` (${Math.round(PACK_DISCOUNT * 100)}% de desconto)` : ''}</p>
              {!quote.active && <p className="text-live-300">Uma peça deste pacote está fora da loja no momento.</p>}
              {short > 0 && <p className="text-live-300">Faltam {short.toLocaleString('pt-BR')} Cosmic Points.</p>}
            </>
          )}
        </div>
      )}
      <label className="grid gap-1.5 text-sm font-bold">Mensagem (opcional)<textarea aria-label="Mensagem do presente" value={message} maxLength={300} disabled={busy} onChange={(event) => { setMessage(event.target.value); key.current = crypto.randomUUID(); }} className="min-h-24 rounded-xl bg-ink-950 p-3 text-sm outline-none focus:ring-1 focus:ring-brand-400" placeholder="Uma mensagem para acompanhar seu presente…" /></label>
      {error && <p role="alert" className="text-sm text-live-300">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy || !ready} data-testid="pack-gift-review"><Send className="size-4" />Revisar presente</Button>
    </form>
  </Modal>;
}

/** Nome do que veio no presente: o item, ou o pacote com as peças entregues. */
function giftTitle(gift: { itemId: string; packId?: string | null; items?: string[] }): string {
  const pack = gift.packId ? packById(gift.packId) : undefined;
  if (pack) return `Pacote ${pack.name}`;
  return itemById(gift.itemId)?.name ?? collectionById(gift.itemId.replace(/^collection:/, ''))?.name ?? gift.itemId;
}

export function CollectionGiftDialog({ collection, onClose }: { collection: CosmeticCollection; onClose: () => void }) {
  const friends = useStore(social.store, (state) => state.friends)?.filter((friend) => friend.state === 'amigos');
  const unlimited = useStore(cosmetics.store, (state) => state.points?.unlimited === true);
  const [recipientId, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [quote, setQuote] = useState<CollectionQuote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  useEffect(() => { void social.loadFriends().catch((err) => setError(errorText(err))); }, []);
  useEffect(() => {
    let active = true;
    setQuote(null); setError('');
    if (recipientId) void cosmetics.quoteCollection(collection.id, recipientId).then((value) => { if (active) setQuote(value); }).catch((err) => { if (active) setError(errorText(err)); });
    return () => { active = false; };
  }, [recipientId, collection.id]);
  return <Modal title={`Presentear ${collection.name}`} onClose={busy ? () => undefined : onClose}>
    <form className="grid gap-4" onSubmit={(event) => {
      event.preventDefault();
      const recipient = friends?.find((friend) => friend.user.id === recipientId);
      if (!recipient || !quote) return;
      setBusy(true); setError('');
      void dialogs.confirm({ title: 'Confirmar presente da coleção?', message: <div className="grid gap-2"><p>{collection.name} para {recipient.user.displayName}.</p><p>{quote.itemIds.length} itens novos, equipáveis separadamente.</p><p>{unlimited ? 'Aquisição administrativa sem débito; itens de teste não transferíveis.' : `${quote.price.toLocaleString('pt-BR')} Cosmic Points.`}</p>{message && <p>{message}</p>}</div>, confirmLabel: 'Enviar presente', action: () => cosmetics.giftCollection(quote, { recipientId, message, requestId: key.current }) }).then((sent) => {
        if (sent) { groups.notify(`Coleção enviada para ${recipient.user.displayName}.`); onClose(); }
      }).catch((err) => setError(errorText(err))).finally(() => setBusy(false));
    }}>
      <label className="grid gap-1.5 text-sm font-bold">Destinatário<select aria-label="Amigo destinatário" className={selectClass} value={recipientId} disabled={busy} required onChange={(event) => { setRecipient(event.target.value); key.current = crypto.randomUUID(); }}>
        <option value="">Escolha um amigo</option>{friends?.map((friend) => <option key={friend.user.id} value={friend.user.id}>{friend.user.displayName} (@{friend.user.username})</option>)}
      </select></label>
      {friends?.length === 0 && <p className="text-sm text-fog-400">Adicione um amigo antes de enviar presentes.</p>}
      {quote && <p className="text-sm text-fog-300">{quote.ownedIds.length}/5 itens já adquiridos pelo destinatário. {quote.itemIds.length ? `Presente: ${quote.itemIds.length} itens por ${quote.price.toLocaleString('pt-BR')} Cosmic Points.` : 'Ele já tem a coleção completa.'}</p>}
      <label className="grid gap-1.5 text-sm font-bold">Mensagem (opcional)<textarea className="min-h-24 rounded-xl bg-ink-950 p-3 text-sm" aria-label="Mensagem do presente" maxLength={300} value={message} disabled={busy} onChange={(event) => { setMessage(event.target.value); key.current = crypto.randomUUID(); }} /></label>
      {error && <p role="alert" className="text-sm text-live-300">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy || !quote?.itemIds.length || !quote.available}>Revisar presente</Button>
    </form>
  </Modal>;
}

export function GiftsSettings() {
  const gifts = useStore(cosmetics.store, (state) => state.gifts);
  const hasMore = useStore(cosmetics.store, (state) => state.giftsHasMore);
  const page = useStore(cosmetics.store, (state) => state.giftsPage);
  const [busy, setBusy] = useState(false);
  const me = useStore(groups.store, (state) => state.account?.id);
  const [error, setError] = useState('');
  useEffect(() => { void cosmetics.loadGifts().catch((err) => setError(errorText(err))); }, []);
  return <>
    <p className="text-sm text-fog-400">Compre presentes pela Loja Cosmic: itens avulsos ou pacotes inteiros ("Presentear pacote"). Itens transferíveis podem ser enviados pelo seu inventário.</p>
    {error && <p role="alert" className="text-sm text-live-300">{error}</p>}
    {!gifts && <p className="text-sm text-fog-400">Carregando presentes…</p>}
    {['recebidos', 'enviados'].map((direction) => {
      const items = gifts?.filter((gift) => direction === 'recebidos' ? gift.recipientId === me : gift.senderId === me);
      return <section key={direction} className="grid gap-3 rounded-2xl bg-ink-900/70 p-4"><h2 className="font-extrabold text-neon-300">Presentes {direction}</h2>
        {items?.length === 0 && <p className="text-sm text-fog-400">Nenhum presente {direction === 'recebidos' ? 'recebido' : 'enviado'} ainda.</p>}
        {items?.map((gift) => <article key={gift.id} className="grid gap-2 rounded-xl border border-brand-500/15 bg-ink-950/60 p-3"><div className="flex items-center gap-2"><Gift className="size-5 text-neon-300" /><p className="flex-1 font-bold" data-testid="gift-title">{giftTitle(gift)}</p>{gift.unread && <span className="rounded-full bg-brand-500/30 px-2 py-0.5 text-xs text-neon-300">Novo</span>}</div>{gift.packId && gift.items && gift.items.length > 0 && <p className="text-sm text-fog-300">{gift.items.map((id) => itemById(id)?.name ?? id).join(' · ')}</p>}<p className="text-sm text-fog-400">{direction === 'recebidos' ? `De @${gift.senderName}` : `Para @${gift.recipientName}`} · {gift.kind === 'transfer' ? 'Transferência' : `${gift.price.toLocaleString('pt-BR')} Cosmic Points`}</p>{gift.message && <p className="whitespace-pre-wrap rounded-lg bg-white/5 p-2 text-sm text-fog-200">{gift.message}</p>}<p className="text-xs text-fog-500">{new Date(gift.at).toLocaleString('pt-BR')}</p>{gift.unread && <Button size="sm" onClick={() => { void groups.call('POST', `/api/me/gifts/${gift.id}/read`, {}).then(() => cosmetics.loadGifts()).catch((err) => setError(errorText(err))); }}>Marcar como lido</Button>}</article>)}
      </section>;
    })}
    {hasMore && <Button disabled={busy} onClick={() => { setBusy(true); void cosmetics.loadGifts(page + 1).catch((err) => setError(errorText(err))).finally(() => setBusy(false)); }}>{busy ? 'Carregando…' : 'Carregar presentes anteriores'}</Button>}
  </>;
}
