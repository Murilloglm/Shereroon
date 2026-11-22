import { Check, Gift, Image as ImageIcon, Layers3, Search, Sparkles } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { CATALOG, COLLECTIONS, KIND_NAMES, type CosmeticCollection, type CosmeticItem } from '../../../../shared/cosmetics.ts';
import { cosmetics, type UserCosmetics } from '../../lib/cosmetics.ts';
import { dialogs } from '../../lib/dialogs.ts';
import { groups, type Account } from '../../lib/groups/client.ts';
import { useStore } from '../../lib/store.ts';
import { ArtworkVariants, ItemPreview, MemberNamePreview } from '../cosmetics/CosmeticPreview.tsx';
import { cosmeticAssetUrl, DecoratedAvatar } from '../cosmetics/Decoration.tsx';
import { ProfilePreview } from '../cosmetics/ProfilePreview.tsx';
import { social } from '../../lib/social/client.ts';
import { errorText } from '../groups/common.tsx';
import { Button, Modal } from '../ui.tsx';
import { CollectionGiftDialog, GiftDialog } from './GiftsSettings.tsx';

const pointsText = (price: number) => price.toLocaleString('pt-BR') + ' Cosmic Points';
const collectionItems = (id: string) => CATALOG.filter((item) => item.collectionId === id);
const themeStyle = (collection: CosmeticCollection) => ({ '--collection-a': collection.colors[0], '--collection-b': collection.colors[1] }) as CSSProperties;
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function collectionEquipment(collection: CosmeticCollection, variants: Record<string, string> = {}): UserCosmetics {
  return Object.fromEntries(collectionItems(collection.id).map((item) => [item.kind, { item: item.id, variant: variants[item.id] ?? 'original' }]));
}

function CollectionPreview({ account, collection, variants }: { account: Account; collection: CosmeticCollection; variants: Record<string, string> }) {
  const avatar = useStore(social.store, (state) => state.profiles[account.id]?.avatar ?? null);
  const preview = collectionEquipment(collection, variants);
  return <div className="cn-collection-preview" data-testid="collection-preview" style={themeStyle(collection)}>
    <p className="cn-collection-eyebrow">Seu perfil</p>
    <ProfilePreview userId={account.id} name={account.displayName} avatar={avatar} look={preview} animate={false} />
    <p className="cn-collection-eyebrow mt-5">Na lista de membros</p>
    <MemberNamePreview account={account} preview={preview} />
  </div>;
}

function OriginalArtwork({ collection }: { collection: CosmeticCollection }) {
  const [selected, setSelected] = useState(0);
  const reference = collection.references[selected] ?? collection.references[0]!;
  return <div className="grid min-w-0 gap-4" data-testid="collection-originals">
    <p className="text-sm text-fog-300">Veja os detalhes das artes desta coleção.</p>
    <div className="cn-original-thumbnails" aria-label="Artes da coleção">
      {collection.references.map((entry, index) => <button type="button" key={entry.asset} onClick={() => setSelected(index)} aria-pressed={selected === index} aria-label={entry.name} title={entry.name}>
        <img src={cosmeticAssetUrl(entry.asset)} alt="" loading="lazy" decoding="async" />
      </button>)}
    </div>
    <figure className="cn-original-artwork">
      <img key={reference.asset} src={cosmeticAssetUrl(reference.asset)} alt={reference.name} decoding="async" />
      <figcaption>{reference.name}</figcaption>
    </figure>
  </div>;
}

export function CollectionsShop({ account }: { account: Account }) {
  const shop = useStore(cosmetics.store, (state) => state.shop);
  const inventory = useStore(cosmetics.store, (state) => state.inventory);
  const points = useStore(cosmetics.store, (state) => state.points);
  const avatar = useStore(social.store, (state) => state.profiles[account.id]?.avatar ?? null);
  const [selected, setSelected] = useState<CosmeticCollection | null>(null);
  const [detailTab, setDetailTab] = useState<'items' | 'originals'>('items');
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Todas');
  const [giftCollection, setGiftCollection] = useState<CosmeticCollection | null>(null);
  const [giftItem, setGiftItem] = useState<CosmeticItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => { void cosmetics.loadInventory().catch(() => undefined); }, []);
  const listedItem = (base: CosmeticItem) => shop?.find((entry) => entry.id === base.id) ??
    (inventory?.items.some((entry) => entry.id === base.id) ? { ...base, owned: true, active: false } : undefined);

  const openCollection = (collection: CosmeticCollection) => {
    setVariants(Object.fromEntries(Object.entries(inventory?.equipped ?? {}).map(([, entry]) => [entry.item, entry.variant])));
    setDetailTab('items'); setSelected(collection); setFailure(null);
  };
  const buyCollection = async (collection: CosmeticCollection) => {
    if (busy) return;
    setBusy(true);
    try {
      const quote = await cosmetics.quoteCollection(collection.id);
      await dialogs.confirm({ title: 'Adquirir ' + collection.name + '?',
        message: <div className="grid gap-2"><p>{quote.itemIds.length} itens para equipar separadamente.</p><p>{points?.unlimited ? 'Aquisição administrativa sem débito.' : pointsText(quote.price)}</p>{quote.ownedIds.length > 0 && <p>Você já tem {quote.ownedIds.length} de 5 itens. O preço inclui somente os que faltam.</p>}</div>,
        confirmLabel: 'Adquirir coleção', action: () => cosmetics.buyCollection(quote) });
    } catch (error) {
      await dialogs.alert({ kind: 'erro', title: 'Não foi possível adquirir a coleção', message: errorText(error) });
    } finally { setBusy(false); void cosmetics.loadShop().catch(() => undefined); }
  };
  const buyItem = async (item: CosmeticItem) => {
    setBusy(true);
    try {
      await dialogs.confirm({ title: 'Adquirir ' + item.name + '?', message: points?.unlimited ? 'Aquisição administrativa sem débito.' : pointsText(item.price), confirmLabel: 'Adquirir', action: () => cosmetics.buy(item.id, item.price) });
    } catch (error) {
      await dialogs.alert({ kind: 'erro', title: 'Não foi possível adquirir o item', message: errorText(error) });
    } finally { setBusy(false); }
  };
  const equip = async (item: CosmeticItem, on: boolean) => {
    setBusy(true);
    try { await cosmetics.equip(item.kind, on ? null : item.id, variants[item.id] ?? 'original'); }
    catch (error) { await dialogs.alert({ kind: 'erro', title: 'Não foi possível equipar', message: errorText(error) }); }
    finally { setBusy(false); }
  };
  const equipCollection = async (collection: CosmeticCollection) => {
    setBusy(true); setFailure(null);
    try {
      for (const item of collectionItems(collection.id)) {
        if (listedItem(item)?.owned) await cosmetics.equip(item.kind, item.id, variants[item.id] ?? 'original');
      }
      groups.notify('Coleção ' + collection.name + ' equipada.');
    } catch (error) { setFailure('Não foi possível equipar todos os itens. ' + errorText(error)); }
    finally { setBusy(false); }
  };
  const categories = ['Todas', 'Dragões', 'Anime', 'Valorant', 'Deadlock'];
  const visible = COLLECTIONS.filter((collection) => {
    const category = collection.franchise === 'Como Treinar Seu Dragão' ? 'Dragões' : ['Eleceed', 'Tensei Shitara Slime','Blue Lock','One Punch Man'].includes(collection.franchise) ? 'Anime' : collection.franchise;
    return (filter === 'Todas' || filter === category) && normalize(collection.name + ' ' + collection.franchise).includes(normalize(query.trim()));
  });
  const selectedItems = selected ? collectionItems(selected.id) : [];
  const ownsSelected = selectedItems.length > 0 && selectedItems.every((item) => listedItem(item)?.owned);

  return <section className="cn-collections" aria-label="Coleções cosméticas">
    <header className="cn-collections-intro">
      <div><p className="cn-collection-eyebrow"><Layers3 className="size-4" aria-hidden="true" /> Cosmic Night · Coleções</p>
        <h2>Seu universo. Seu estilo.</h2><p>Avatar, moldura, fundo e nome. Escolha um pacote completo ou combine suas peças favoritas.</p></div>
      <span className="cn-collections-count"><Sparkles aria-hidden="true" />{COLLECTIONS.length} coleções<span>{COLLECTIONS.length * 5} itens para combinar</span></span>
    </header>
    <div className="cn-collection-toolbar">
      <div className="cn-collection-filters" aria-label="Filtrar coleções">{categories.map((category) => <button type="button" key={category} onClick={() => setFilter(category)} aria-pressed={filter === category}>{category}</button>)}</div>
      <label className="cn-collection-search"><Search className="size-4" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar coleção" aria-label="Buscar coleção" /></label>
    </div>
    {!shop ? <p className="text-sm text-fog-400">Carregando coleções…</p> : <div className="cn-collection-grid">
      {visible.map((collection) => {
        const items = collectionItems(collection.id).map(listedItem);
        const owned = items.filter((item) => item?.owned).length;
        const available = items.every((item) => item && (item.owned || item.active !== false));
        const price = items.reduce((sum, item) => sum + (item && !item.owned ? item.price : 0), 0);
        const affordable = points?.unlimited || (points?.points ?? 0) >= price;
        const preview = collectionEquipment(collection);
        return <article key={collection.id} className="cn-collection-card" style={themeStyle(collection)} data-testid="collection-card" data-collection={collection.id}>
          <div className="cn-collection-cover"><img src={cosmeticAssetUrl('assets/cosmetics/' + collection.id + '/cover.webp')} alt={'Arte de ' + collection.name} loading="lazy" decoding="async" /></div>
          <div className="cn-collection-card-body">
            <div className="cn-collection-card-title"><div className="cn-collection-avatar"><DecoratedAvatar userId={account.id} name={account.displayName} image={avatar} size={44} preview={preview} /></div>
              <div className="min-w-0"><p className="cn-collection-franchise">{collection.franchise}</p><h3>{collection.name}</h3><p className="text-sm text-fog-400">{collection.tagline}</p></div></div>
            <div className="cn-collection-card-sample"><MemberNamePreview account={account} preview={preview} /></div>
            <ul className="cn-collection-pieces" aria-label="Itens incluídos">{collectionItems(collection.id).map((item) => <li key={item.id} title={KIND_NAMES[item.kind] + (listedItem(item)?.owned ? ' · Já é seu' : '')}>
              {listedItem(item)?.owned && <Check className="size-3" aria-hidden="true" />}{item.kind === 'decoracao' ? 'Avatar' : item.kind === 'fundo' ? 'Fundo' : item.kind === 'moldura' ? 'Moldura' : item.kind === 'cor-nome' ? 'Cor' : 'Efeito'}</li>)}</ul>
            <div className="cn-collection-price"><p>{owned === 5 ? <><Check className="size-4" aria-hidden="true" /> Coleção adquirida</> : !available ? 'Indisponível' : <><Sparkles className="size-4" aria-hidden="true" />{pointsText(price)}</>}</p><span>{owned}/5 adquiridos</span></div>
            <Button size="sm" onClick={() => openCollection(collection)} data-testid={'preview-' + collection.id}>Pré-visualizar e equipar itens</Button>
            {owned < 5 && <Button size="sm" variant="primary" disabled={busy || !available || !affordable} onClick={() => void buyCollection(collection)} data-testid={'buy-collection-' + collection.id}>{!available ? 'Indisponível' : !affordable ? 'Saldo insuficiente' : owned ? 'Adquirir itens restantes' : 'Adquirir coleção'}</Button>}
            <Button size="sm" variant="quiet" onClick={() => setGiftCollection(collection)}><Gift className="size-4" aria-hidden="true" />Presentear coleção</Button>
          </div>
        </article>;
      })}
    </div>}
    {shop && visible.length === 0 && <p className="cn-collection-empty">Nenhuma coleção encontrada. Tente outro nome ou categoria.</p>}
    {selected && <Modal title={selected.name} onClose={() => setSelected(null)} wide>
      <div style={themeStyle(selected)} className="min-w-0">
        <div className="cn-collection-detail-heading"><p>{selected.franchise} · 5 itens independentes</p><span>{selected.tagline}</span></div>
        <div className="cn-collection-tabs" role="tablist" aria-label="Visualização da coleção">
          <button type="button" role="tab" id="collection-preview-tab" aria-controls="collection-preview-panel" aria-selected={detailTab === 'items'} onClick={() => setDetailTab('items')}><Layers3 className="size-4" aria-hidden="true" />Experimentar pacote</button>
          <button type="button" role="tab" id="collection-artwork-tab" aria-controls="collection-artwork-panel" aria-selected={detailTab === 'originals'} onClick={() => setDetailTab('originals')}><ImageIcon className="size-4" aria-hidden="true" />Artes originais</button>
        </div>
        {detailTab === 'originals' ? <div id="collection-artwork-panel" role="tabpanel" aria-labelledby="collection-artwork-tab"><OriginalArtwork key={selected.id} collection={selected} /></div>
          : <div id="collection-preview-panel" role="tabpanel" aria-labelledby="collection-preview-tab" className="cn-collection-detail">
            <aside className="cn-collection-detail-preview"><CollectionPreview account={account} collection={selected} variants={variants} />
              {ownsSelected && <Button variant="primary" disabled={busy} onClick={() => void equipCollection(selected)} data-testid="equip-collection">Usar coleção completa</Button>}
              {failure && <p className="text-sm text-live-300" role="alert">{failure}</p>}
              {selected.resolution === 'overview-only' && <p className="mt-3 text-sm text-fog-400">As artes desta coleção estão disponíveis em resolução reduzida.</p>}
            </aside>
            <div className="grid min-w-0 content-start gap-3">{selectedItems.map((base) => {
              const item = listedItem(base);
              const variant = variants[base.id] ?? 'original';
              const equipped = inventory?.equipped[base.kind];
              const on = equipped?.item === base.id && equipped.variant === variant;
              return <article key={base.id} className="cn-collection-item" data-testid="collection-item" data-item={base.id}>
                <div className="flex items-center justify-between gap-2"><h3>{KIND_NAMES[base.kind]}</h3>{on && <span className="cn-item-equipped"><Check className="size-3" aria-hidden="true" />Em uso</span>}</div>
                <div className="cn-collection-item-art"><ItemPreview account={account} item={item ?? base} variant={variant} /></div>
                <ArtworkVariants item={item ?? base} value={variant} onChange={(value) => setVariants((current) => ({ ...current, [base.id]: value }))} />
                <div className="cn-collection-item-actions"><span>{item?.owned ? on ? 'Selecionado' : 'Já é seu' : item ? pointsText(item.price) : 'Indisponível'}</span>
                  {item?.owned ? <Button size="sm" disabled={busy} variant={on ? 'quiet' : 'primary'} onClick={() => void equip(item, on)} data-testid={(on ? 'unequip-' : 'equip-') + base.id}>{on ? 'Desequipar' : equipped?.item === base.id ? 'Aplicar estilo' : 'Equipar'}</Button>
                    : <Button size="sm" disabled={!item || item.active === false || busy || (!points?.unlimited && (points?.points ?? 0) < item.price)} onClick={() => item && void buyItem(item)} data-testid={'shop-buy-' + base.id}>Adquirir item</Button>}
                </div>
                {item && item.active !== false && <Button size="sm" variant="quiet" onClick={() => { setSelected(null); setGiftItem(item); }}><Gift className="size-4" aria-hidden="true" />Presentear item</Button>}
              </article>;
            })}</div>
          </div>}
      </div>
    </Modal>}
    {giftCollection && <CollectionGiftDialog collection={giftCollection} onClose={() => setGiftCollection(null)} />}
    {giftItem && <GiftDialog item={giftItem} onClose={() => setGiftItem(null)} />}
  </section>;
}
