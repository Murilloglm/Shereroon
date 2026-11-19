import { useEffect, useState } from 'react';
import { CATALOG, COLLECTIONS, KIND_NAMES, type CosmeticCollection, type CosmeticItem } from '../../../../shared/cosmetics.ts';
import { cosmetics, type UserCosmetics } from '../../lib/cosmetics.ts';
import { dialogs } from '../../lib/dialogs.ts';
import { groups, type Account } from '../../lib/groups/client.ts';
import { useStore } from '../../lib/store.ts';
import { ItemPreview, MemberNamePreview } from '../cosmetics/CosmeticPreview.tsx';
import { backgroundStyle, cosmeticAssetUrl, DecoratedAvatar, nameStyle, ProfileNameplate } from '../cosmetics/Decoration.tsx';
import { social } from '../../lib/social/client.ts';
import { errorText } from '../groups/common.tsx';
import { Button, Modal } from '../ui.tsx';
import { CollectionGiftDialog, GiftDialog } from './GiftsSettings.tsx';

const pointsText = (price: number) => `${price.toLocaleString('pt-BR')} Cosmic Points`;

function CollectionPreview({ account, collection }: { account: Account; collection: CosmeticCollection }) {
  const avatar = useStore(social.store, (state) => state.profiles[account.id]?.avatar ?? null);
  const preview: UserCosmetics = Object.fromEntries(CATALOG.filter((item) => item.collectionId === collection.id).map((item) => [item.kind, { item: item.id, variant: 'original' }]));
  return <div className="overflow-hidden rounded-xl bg-ink-950" data-testid="collection-preview">
    <div className="h-28" style={backgroundStyle(preview)} />
    <div className="grid gap-4 px-5 pt-5 pb-4">
      <div className="flex justify-center py-3"><DecoratedAvatar userId={account.id} name={account.displayName} image={avatar} size={64} preview={preview} /></div>
      <ProfileNameplate preview={preview}><p className="truncate text-center font-extrabold" style={nameStyle(preview)}>{account.displayName}</p></ProfileNameplate>
      <MemberNamePreview account={account} preview={preview} />
    </div>
  </div>;
}

export function CollectionsShop({ account }: { account: Account }) {
  const shop = useStore(cosmetics.store, (state) => state.shop);
  const inventory = useStore(cosmetics.store, (state) => state.inventory);
  const points = useStore(cosmetics.store, (state) => state.points);
  const [selected, setSelected] = useState<CosmeticCollection | null>(null);
  const [giftCollection, setGiftCollection] = useState<CosmeticCollection | null>(null);
  const [giftItem, setGiftItem] = useState<CosmeticItem | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void cosmetics.loadInventory().catch(() => undefined); }, []);
  const listedItem = (base: CosmeticItem) => shop?.find((entry) => entry.id === base.id) ??
    (inventory?.items.some((entry) => entry.id === base.id) ? { ...base, owned: true, active: false } : undefined);

  const buyCollection = async (collection: CosmeticCollection) => {
    setBusy(true);
    try {
      const quote = await cosmetics.quoteCollection(collection.id);
      await dialogs.confirm({ title: `Adquirir ${collection.name}?`,
        message: <div className="grid gap-2"><p>{quote.itemIds.length} itens para equipar separadamente.</p><p>{points?.unlimited ? 'Aquisição administrativa sem débito.' : pointsText(quote.price)}</p>{quote.ownedIds.length > 0 && <p>Você já tem {quote.ownedIds.length} de 5 itens. O preço inclui somente os que faltam.</p>}</div>,
        confirmLabel: 'Adquirir coleção', action: () => cosmetics.buyCollection(quote) });
    } catch (error) {
      await dialogs.alert({ kind: 'erro', title: 'Não foi possível adquirir a coleção', message: errorText(error) });
    } finally { setBusy(false); void cosmetics.loadShop().catch(() => undefined); }
  };
  const buyItem = async (item: CosmeticItem) => {
    await dialogs.confirm({ title: `Adquirir ${item.name}?`, message: points?.unlimited ? 'Aquisição administrativa sem débito.' : pointsText(item.price), confirmLabel: 'Adquirir', action: () => cosmetics.buy(item.id, item.price) });
  };
  const equip = async (item: CosmeticItem, on: boolean) => {
    setBusy(true);
    try { await cosmetics.equip(item.kind, on ? null : item.id, 'original'); }
    catch (error) { await dialogs.alert({ kind: 'erro', title: 'Não foi possível equipar', message: errorText(error) }); }
    finally { setBusy(false); }
  };

  return <section className="grid gap-4" aria-label="Coleções cosméticas">
    <p className="text-sm text-fog-400">Cada coleção inclui cinco itens. Combine peças de coleções diferentes e equipe cada uma separadamente.</p>
    {!shop ? <p className="text-sm text-fog-400">Carregando coleções…</p> : <div className="grid gap-4 sm:grid-cols-2">
      {COLLECTIONS.map((collection) => {
        const items = CATALOG.filter((item) => item.collectionId === collection.id).map(listedItem);
        const owned = items.filter((item) => item?.owned).length;
        const available = items.every(Boolean);
        const price = items.reduce((sum, item) => sum + (item && !item.owned ? item.price : 0), 0);
        const affordable = points?.unlimited || (points?.points ?? 0) >= price;
        return <article key={collection.id} className="grid content-start gap-3 overflow-hidden rounded-2xl border border-brand-500/20 bg-ink-900/70 pb-4" data-testid="collection-card" data-collection={collection.id}>
          <img src={cosmeticAssetUrl(`assets/cosmetics/${collection.id}/cover.webp`)} alt={`Arte de ${collection.name}`} className="aspect-[2/1] w-full object-cover" loading="lazy" decoding="async" />
          <div className="grid gap-3 px-4">
            <div><h2 className="font-extrabold">{collection.name}</h2><p className="text-xs text-fog-400">{collection.franchise}</p></div>
            <ul className="grid gap-1 text-xs text-fog-300">{CATALOG.filter((item) => item.collectionId === collection.id).map((item) => <li key={item.id}>{KIND_NAMES[item.kind]}{listedItem(item)?.owned ? ' · Já é seu' : ''}</li>)}</ul>
            <p className="text-sm font-bold text-warn-400">{owned === 5 ? 'Coleção adquirida' : pointsText(price)} <span className="text-xs text-fog-400">· {owned}/5 adquiridos</span></p>
            <Button size="sm" onClick={() => setSelected(collection)} data-testid={`preview-${collection.id}`}>Pré-visualizar e equipar itens</Button>
            {owned < 5 && <Button size="sm" variant="primary" disabled={busy || !available || !affordable} onClick={() => void buyCollection(collection)} data-testid={`buy-collection-${collection.id}`}>{!available ? 'Indisponível' : !affordable ? 'Saldo insuficiente' : owned ? 'Adquirir itens restantes' : 'Adquirir coleção'}</Button>}
            <Button size="sm" variant="quiet" onClick={() => setGiftCollection(collection)}>Presentear coleção</Button>
          </div>
        </article>;
      })}
    </div>}
    {selected && <Modal title={selected.name} onClose={() => setSelected(null)}>
      <div className="grid gap-4">
        <CollectionPreview account={account} collection={selected} />
        {selected.resolution === 'overview-only' && <p className="text-xs text-fog-400">As artes desta coleção estão disponíveis em resolução reduzida.</p>}
        {CATALOG.filter((item) => item.collectionId === selected.id).map((base) => {
          const item = listedItem(base);
          const on = inventory?.equipped[base.kind]?.item === base.id;
          return <article key={base.id} className="grid gap-2 rounded-xl bg-ink-850 p-3" data-testid="collection-item" data-item={base.id}>
            <h3 className="text-sm font-bold">{KIND_NAMES[base.kind]}</h3>
            <ItemPreview account={account} item={item ?? base} variant="original" />
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-sm text-fog-400">{item?.owned ? on ? 'Selecionado' : 'Já é seu' : item ? pointsText(item.price) : 'Indisponível'}</span>
              {item?.owned ? <Button size="sm" disabled={busy} variant={on ? 'quiet' : 'primary'} onClick={() => void equip(item, on)} data-testid={`${on ? 'unequip' : 'equip'}-${base.id}`}>{on ? 'Desequipar' : 'Equipar'}</Button> : <Button size="sm" disabled={!item || busy || (!points?.unlimited && (points?.points ?? 0) < item.price)} onClick={() => item && void buyItem(item)} data-testid={`shop-buy-${base.id}`}>Adquirir item</Button>}
              {item && item.active !== false && <Button size="sm" variant="quiet" onClick={() => { setSelected(null); setGiftItem(item); }}>Presentear item</Button>}
            </div>
          </article>;
        })}
      </div>
    </Modal>}
    {giftCollection && <CollectionGiftDialog collection={giftCollection} onClose={() => setGiftCollection(null)} />}
    {giftItem && <GiftDialog item={giftItem} onClose={() => setGiftItem(null)} />}
  </section>;
}
