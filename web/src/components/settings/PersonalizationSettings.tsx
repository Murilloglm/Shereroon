import { Check, Eye, Gift, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CATALOG, itemById, KIND_NAMES, PACK_DISCOUNT, PACKS, POINTS, RARITY, SLOTS, PACK_SLOTS, type CosmeticItem, type CosmeticPack, type PackItemKind, type ItemKind } from '../../../../shared/cosmetics.ts';
import { cosmetics, type ShopItem, type ShopPack, type UserCosmetics } from '../../lib/cosmetics.ts';
import { dialogs } from '../../lib/dialogs.ts';
import { groups, type Account } from '../../lib/groups/client.ts';
import { social } from '../../lib/social/client.ts';
import { useStore } from '../../lib/store.ts';
import { Adornment, DecoratedAvatar, nameStyle } from '../cosmetics/Decoration.tsx';
import { ProfilePreview } from '../cosmetics/ProfilePreview.tsx';
import { errorText } from '../groups/common.tsx';
import { GiftDialog, PackGiftDialog, RedeemCode } from './GiftsSettings.tsx';
import { Button, cx, Toggle } from '../ui.tsx';
import { ArtworkVariants, ItemPreview as CollectionItemPreview, MemberNamePreview } from '../cosmetics/CosmeticPreview.tsx';
import { appearance, setAppearance } from '../../lib/appearance.ts';
import { CollectionsShop } from './CollectionsShop.tsx';

const formatPoints = (value: number) => value.toLocaleString('pt-BR');
const NO_COSMETICS: UserCosmetics = {};

function Block({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-2xl bg-ink-900/60 p-4">
      {title && <h2 className="text-sm font-extrabold">{title}</h2>}
      {children}
    </section>
  );
}

function Price({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-extrabold text-warn-400">
      <Sparkles className="size-3.5" aria-hidden="true" />
      {formatPoints(value)}
    </span>
  );
}

/** Como o item fica: no próprio avatar (decoração e moldura), no topo do perfil (fundo) ou no nome (cor do nome). */
function ItemPreview({ account, item, variant, size = 64 }: { account: Account; item: CosmeticItem; variant: string; size?: number }) {
  return <CollectionItemPreview account={account} item={item} variant={variant} size={size} />;
}

function Swatches({ item, value, onChange }: { item: CosmeticItem; value: string; onChange: (variant: string) => void }) {
  if (item.variants.length < 2) return null;
  if (item.variants.some((variant) => variant.asset)) return <ArtworkVariants item={item} value={value} onChange={onChange} />;
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label={`Cores de ${item.name}`}>
      {item.variants.map((variant) => (
        <button
          key={variant.id}
          type="button"
          role="radio"
          aria-checked={value === variant.id}
          aria-label={variant.name}
          title={variant.name}
          onClick={() => onChange(variant.id)}
          className={cx('size-5 rounded-full ring-offset-2 ring-offset-ink-900 transition-shadow', value === variant.id ? 'ring-2 ring-fog-100' : 'ring-1 ring-white/10')}
          style={{ background: `linear-gradient(135deg, ${variant.colors[0]}, ${variant.colors[1]})` }}
          data-testid={`variant-${item.id}-${variant.id}`}
        />
      ))}
    </div>
  );
}

// --- Cosmic Points --------------------------------------------------------------------------------

export function PointsSettings() {
  const info = useStore(cosmetics.store, (state) => state.points);
  useEffect(() => {
    void cosmetics.loadPoints().catch(() => undefined);
  }, []);
  if (!info) return <p className="text-sm text-fog-400">Carregando…</p>;
  return (
    <>
      <Block>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-warn-400/15 text-warn-400">
            <Sparkles className="size-7" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-3xl font-extrabold" data-testid="points-balance" data-value={info.points}>
              {info.unlimited ? '∞' : formatPoints(info.points)} <span className="text-base font-bold text-fog-400">Cosmic Points</span>
            </p>
            <p className="text-sm text-fog-400" data-testid="points-today">
              Hoje: {formatPoints(info.earnedToday)} de {formatPoints(POINTS.dailyCap)} possíveis
            </p>
          </div>
        </div>
        <p className="text-[13px] leading-snug text-fog-500">Os Cosmic Points são gratuitos e só servem para itens cosméticos. Não envolvem dinheiro, apostas nem viram valores.</p>
      </Block>
      <Block title="Como ganhar">
        <ul className="grid gap-1.5 text-sm text-fog-300">
          <li>
            • Estar numa chamada com outra pessoa, usando o aplicativo: <b className="text-fog-100">{POINTS.voicePointsPerBlock}</b> a cada {POINTS.voiceBlockMinutes} min (até {POINTS.voiceDailyCap} por dia). Parado por mais de {POINTS.idleAfterMinutes} min não conta.
          </li>
          <li>
            • Primeira mensagem do dia num grupo: <b className="text-fog-100">{POINTS.dailyMessage}</b>
          </li>
          <li>
            • Primeira vez no dia: <b className="text-fog-100">{POINTS.dailyLogin}</b>
          </li>
        </ul>
      </Block>
      <Block title="Histórico">
        {info.history.length === 0 && <p className="text-sm text-fog-400">Nada ainda.</p>}
        <ul className="grid gap-1" data-testid="points-history">
          {info.history.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex items-center gap-3 text-sm">
              <span className={cx('w-16 shrink-0 text-right font-extrabold tabular-nums', entry.delta > 0 ? 'text-ok-400' : 'text-live-300')}>
                {entry.delta > 0 ? '+' : ''}
                {formatPoints(entry.delta)}
              </span>
              <span className="min-w-0 flex-1 truncate text-fog-300">{entry.reason === 'compra' ? `Compra: ${entry.detail}` : entry.detail}</span>
              <span className="shrink-0 text-xs text-fog-500">{new Date(entry.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            </li>
          ))}
        </ul>
      </Block>
    </>
  );
}

// --- Pacotes ---------------------------------------------------------------------------------------

/** O visual completo de um pacote (cada peça na cor original). */
export const packLook = (pack: CosmeticPack): UserCosmetics => Object.fromEntries(PACK_SLOTS.map((kind) => [kind, { item: pack.items[kind], variant: 'original' }]));

function Palette({ pack }: { pack: CosmeticPack }) {
  return (
    <span className="flex gap-1" aria-label={`Paleta de ${pack.name}`}>
      {Object.values(pack.palette).map((color) => (
        <span key={color} className="size-3.5 rounded-full ring-1 ring-white/15" style={{ background: color }} title={color} />
      ))}
    </span>
  );
}

/**
 * Um pacote na loja: prévia do pacote inteiro (ou de uma peça combinada com o que a pessoa já usa), as 5 peças com
 * compra avulsa e a compra de tudo o que falta com desconto.
 */
function PackCard({ account, avatar, pack, info, items, points, unlimited, equipped, onBuyItem, onGift, onGiftPack }: {
  account: Account;
  avatar: string | null;
  pack: CosmeticPack;
  info: ShopPack | undefined;
  items: ShopItem[];
  points: number;
  unlimited: boolean;
  equipped: UserCosmetics;
  onBuyItem: (item: CosmeticItem) => void;
  onGift: (item: CosmeticItem) => void;
  onGiftPack: (pack: CosmeticPack) => void;
}) {
  const [focus, setFocus] = useState<PackItemKind | null>(null);
  const look = focus ? { ...equipped, [focus]: { item: pack.items[focus], variant: 'original' } } : packLook(pack);
  const missing = info?.missing.length ?? PACK_SLOTS.length;
  const price = info?.price ?? 0;
  const short = !unlimited && points < price ? price - points : 0;
  /** Quanto custariam, somadas, as peças que faltam compradas uma a uma. */
  const separate = (info?.missing ?? []).reduce((sum, id) => sum + (items.find((item) => item.id === id)?.price ?? itemById(id)?.price ?? 0), 0);
  const buyPack = () =>
    void dialogs.confirm({
      title: `Adquirir o pacote ${pack.name}?`,
      message: unlimited
        ? 'Aquisição administrativa sem débito de pontos.'
        : `Leva ${missing} ${missing === 1 ? 'peça' : 'peças'} por ${formatPoints(price)} Cosmic Points${missing >= 2 ? ` (${Math.round(PACK_DISCOUNT * 100)}% de desconto)` : ''}. Cada peça pode ser equipada separada, e "Usar pacote completo" equipa tudo de uma vez.`,
      confirmLabel: 'Adquirir pacote',
      action: async () => {
        try {
          await cosmetics.buyPack(pack.id, price);
          groups.notify(`Pacote ${pack.name} adquirido. Use em Decorações e inventário.`);
        } catch (error) {
          await dialogs.alert({ kind: 'erro', title: 'Não foi possível adquirir', message: errorText(error) });
        }
      },
    });

  return (
    <article className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-xl bg-ink-850/80 p-3" data-testid="shop-pack" data-pack={pack.id}>
      <header className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-extrabold">{pack.name}</p>
          <p className="flex items-center gap-2 text-xs font-bold" style={{ color: RARITY[pack.rarity].color }}>
            {RARITY[pack.rarity].name} · pacote com 5 peças <Palette pack={pack} />
          </p>
        </div>
        {info && missing > 0 && (
          <span className="text-right text-sm">
            {missing >= 2 && <span className="mr-1.5 text-xs text-fog-500 line-through">{formatPoints(separate)}</span>}
            <Price value={price} />
          </span>
        )}
      </header>
      <p className="text-[13px] leading-snug text-fog-400">{pack.description}</p>
      <ProfilePreview userId={account.id} name={account.displayName} avatar={avatar} look={look} testId="pack-preview" />
      <p className="text-xs text-fog-500" data-testid="pack-preview-mode">
        {focus ? `Prévia: ${KIND_NAMES[focus]} com o que você já usa.` : 'Prévia: o pacote completo.'}
        {focus && (
          <button type="button" className="ml-2 font-bold text-neon-300 hover:underline" onClick={() => setFocus(null)}>
            Ver pacote completo
          </button>
        )}
      </p>
      <ul className="grid gap-1">
        {PACK_SLOTS.map((kind) => {
          const item = items.find((entry) => entry.id === pack.items[kind]) ?? { ...itemById(pack.items[kind])!, owned: false };
          const needs = !unlimited && points < item.price ? item.price - points : 0;
          return (
            <li key={kind} className={cx('flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5', focus === kind ? 'bg-brand-500/15' : 'bg-ink-900/50')} data-testid="pack-piece" data-item={item.id}>
              <button type="button" aria-pressed={focus === kind} title="Prévia desta peça com o que você já usa" onClick={() => setFocus(focus === kind ? null : kind)} className="rounded-md p-1 text-fog-400 hover:bg-white/5 hover:text-fog-100" data-testid={`pack-focus-${item.id}`}>
                <Eye className="size-4" aria-hidden="true" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{item.name}</p>
                <p className="truncate text-xs text-fog-500">
                  {KIND_NAMES[kind]}
                  {item.animated ? ' · animado' : ''}
                </p>
              </div>
              {item.owned ? (
                <span className="flex items-center gap-1 text-xs font-bold text-ok-400">
                  <Check className="size-3.5" aria-hidden="true" /> Seu
                </span>
              ) : (
                <>
                  <Price value={item.price} />
                  <Button size="sm" disabled={needs > 0 || item.active === false} title={needs > 0 ? `Faltam ${formatPoints(needs)} Cosmic Points` : undefined} onClick={() => onBuyItem(item)} data-testid={`shop-buy-${item.id}`}>
                    Adquirir
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => onGift(item)} title="Presentear um amigo">
                    Presentear
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {info && missing === 0 ? (
          <p className="flex-1 text-sm font-bold text-ok-400">Pacote completo. Use em Decorações e inventário.</p>
        ) : (
          <Button className="flex-1" variant="primary" disabled={!info || !info.active || short > 0} title={short > 0 ? `Faltam ${formatPoints(short)} Cosmic Points` : undefined} onClick={buyPack} data-testid={`shop-buy-pack-${pack.id}`}>
            {!info?.active && info ? 'Indisponível no momento' : short > 0 ? `Faltam ${formatPoints(short)} para o pacote` : `Adquirir pacote${missing >= 2 ? ` (−${Math.round(PACK_DISCOUNT * 100)}%)` : ''}`}
          </Button>
        )}
        <Button disabled={info?.active === false} onClick={() => onGiftPack(pack)} title="O amigo recebe as peças que ainda não tem, com o desconto do pacote" data-testid={`shop-gift-pack-${pack.id}`}>
          <Gift className="size-4" aria-hidden="true" />
          Presentear pacote
        </Button>
      </div>
      <details className="text-[13px] text-fog-400">
        <summary className="cursor-pointer font-semibold text-fog-300">Regras visuais do tema</summary>
        <ul className="mt-1 grid gap-0.5">
          {pack.rules.map((rule) => (
            <li key={rule}>• {rule}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

// --- Loja -----------------------------------------------------------------------------------------

export function ShopSettings({ account }: { account: Account }) {
  const shop = useStore(cosmetics.store, (state) => state.shop);
  const points = useStore(cosmetics.store, (state) => state.points?.points ?? null);
  const unlimited = useStore(cosmetics.store, (state) => state.points?.unlimited === true);
  const packs = useStore(cosmetics.store, (state) => state.packs);
  const equipped = useStore(cosmetics.store, (state) => state.inventory?.equipped ?? NO_COSMETICS);
  const avatar = useStore(social.store, (state) => state.profiles[account.id]?.avatar ?? null);
  const [gift, setGift] = useState<CosmeticItem | null>(null);
  const [giftPack, setGiftPack] = useState<CosmeticPack | null>(null);
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<'itens' | 'colecoes'>('itens');
  useEffect(() => {
    void cosmetics.loadShop().catch(() => undefined);
    void cosmetics.loadPoints().catch(() => undefined);
    void cosmetics.loadInventory().catch(() => undefined);
    void social.profile(account.id).catch(() => undefined);
  }, [account.id]);

  const buy = (item: CosmeticItem) =>
    void dialogs.confirm({
      title: `Adquirir ${item.name}?`,
      message: unlimited ? 'Aquisição administrativa sem débito de pontos. O item de teste não permite transferência.' : `Custa ${formatPoints(item.price)} Cosmic Points. Depois é só equipar em Decorações e inventário.`,
      confirmLabel: 'Adquirir',
      action: async () => {
        try {
          await cosmetics.buy(item.id, item.price);
          groups.notify(`${item.name} adquirido. Equipe em Decorações e inventário.`);
        } catch (error) {
          await dialogs.alert({ kind: 'erro', title: 'Não foi possível adquirir', message: errorText(error) });
        }
      },
    });

  return (
    <>
      <p className="text-sm text-fog-300" data-testid="shop-balance">
        Saldo: {unlimited ? <span className="font-extrabold text-neon-300">∞ Cosmic Points</span> : <><Price value={points ?? 0} /> Cosmic Points</>}
      </p>
      <RedeemCode />
      {gift && <GiftDialog item={gift} onClose={() => setGift(null)} />}
      <div role="tablist" aria-label="Categorias da loja" className="flex gap-2">
        <Button role="tab" aria-selected={category === 'itens'} onClick={() => setCategory('itens')}>Itens</Button>
        <Button role="tab" aria-selected={category === 'colecoes'} onClick={() => setCategory('colecoes')} data-testid="shop-collections">Coleções</Button>
      </div>
      {category === 'colecoes' ? <CollectionsShop account={account} /> : <>
      {giftPack && <PackGiftDialog pack={giftPack} onClose={() => setGiftPack(null)} />}
      <Block title="Pacotes">
        <p className="text-[13px] leading-snug text-fog-400">
          Cada pacote tem decoração, moldura, fundo, cor do nome e enfeite no nome, com o mesmo tema. Leve tudo com desconto ou só as peças que quiser: cada uma é equipada separada e combina com as de outros pacotes.
        </p>
        <div className="grid gap-3">
          {PACKS.map((pack) => (
            <PackCard
              key={pack.id}
              account={account}
              avatar={avatar}
              pack={pack}
              info={packs?.find((entry) => entry.id === pack.id)}
              items={shop ?? []}
              points={points ?? 0}
              unlimited={unlimited}
              equipped={equipped}
              onBuyItem={buy}
              onGift={setGift}
              onGiftPack={setGiftPack}
            />
          ))}
        </div>
      </Block>
      {SLOTS.filter((kind) => kind !== 'efeito-nome').map((kind) => {
        // Peças de pacote ficam nos cartões de pacote; aqui, só os itens avulsos.
        const items = (shop ?? CATALOG.map((item) => ({ ...item, owned: false }))).filter((item) => item.kind === kind && !item.pack && !item.collectionId);
        if (items.length === 0) return null;
        return (
          <Block key={kind} title={KIND_NAMES[kind]}>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((item) => {
                const variant = variants[item.id] ?? item.variants[0]!.id;
                const missing = !unlimited && (points ?? 0) < item.price ? item.price - (points ?? 0) : 0;
                return (
                  <article key={item.id} className="grid gap-2 rounded-xl bg-ink-850/80 p-3" data-testid="shop-item" data-item={item.id}>
                    <ItemPreview account={account} item={item} variant={variant} />
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold">{item.name}</p>
                        <p className="text-xs font-bold" style={{ color: RARITY[item.rarity].color }}>
                          {RARITY[item.rarity].name}
                          {item.animated ? ' · animado' : ''}
                          {item.reactsToVoice ? ' · reage à voz' : ''}
                        </p>
                      </div>
                      <Price value={item.price} />
                    </div>
                    <p className="text-[13px] leading-snug text-fog-400">{item.description}</p>
                    <div className="flex items-center justify-between gap-2">
                      <Swatches item={item} value={variant} onChange={(next) => setVariants((current) => ({ ...current, [item.id]: next }))} />
                      {item.owned ? (
                        <span className="text-sm font-bold text-ok-400">Já é seu</span>
                      ) : (
                        <Button size="sm" variant="primary" disabled={missing > 0} title={missing > 0 ? `Faltam ${formatPoints(missing)} Cosmic Points` : undefined} onClick={() => buy(item)} data-testid={`shop-buy-${item.id}`}>
                          {missing > 0 ? `Faltam ${formatPoints(missing)}` : 'Adquirir'}
                        </Button>
                      )}
                    </div>
                    <Button size="sm" variant="quiet" onClick={() => setGift(item)}>Presentear um amigo</Button>
                  </article>
                );
              })}
            </div>
          </Block>
        );
      })}
      </>}
    </>
  );
}

// --- Inventário -----------------------------------------------------------------------------------

export function InventorySettings({ account, filter }: { account: Account; filter?: ItemKind }) {
  const inventory = useStore(cosmetics.store, (state) => state.inventory);
  const animations = useStore(appearance, (state) => state.cosmeticAnimations);
  const [transferItem, setTransferItem] = useState<CosmeticItem | null>(null);
  const avatar = useStore(social.store, (state) => state.profiles[account.id]?.avatar ?? null);
  useEffect(() => {
    void cosmetics.loadInventory().catch(() => undefined);
    void social.profile(account.id).catch(() => undefined);
  }, [account.id]);
  if (!inventory) return <p className="text-sm text-fog-400">Carregando…</p>;
  const owned = inventory.items.map((entry) => itemById(entry.id)).filter((item): item is CosmeticItem => Boolean(item) && (!filter || item!.kind === filter));
  const equip = async (slot: ItemKind, itemId: string | null, variant?: string) => {
    try {
      await cosmetics.equip(slot, itemId, variant);
    } catch (error) {
      await dialogs.alert({ kind: 'erro', title: 'Não foi possível equipar', message: errorText(error) });
    }
  };
  return (
    <>
      {transferItem && <GiftDialog item={transferItem} transfer onClose={() => setTransferItem(null)} />}
      {filter === 'efeito-nome' && <Block title="Efeitos de Nome do Servidor">
        <MemberNamePreview account={account} preview={inventory.equipped} />
        <label className="flex items-center justify-between gap-3 text-sm"><span>Animar decorações e efeitos de nome neste aparelho</span><Toggle label="Animar decorações e efeitos de nome" on={animations} onChange={(on) => setAppearance({ cosmeticAnimations: on })} /></label>
        <p className="text-xs text-fog-400">O movimento reduzido do sistema também é respeitado. Sua escolha fica salva neste aparelho.</p>
      </Block>}
      {!filter &&
      <Block>
        <div className="flex items-center gap-5">
          <div className="flex size-28 items-center justify-center" data-testid="inventory-preview">
            <DecoratedAvatar userId={account.id} name={account.displayName} size={80} image={avatar} animate preview={inventory.equipped} />
          </div>
          <div className="min-w-0">
            <p className="flex items-center text-lg font-extrabold" data-testid="inventory-name">
              <span style={nameStyle(inventory.equipped)}>{account.displayName}</span>
              {inventory.equipped.enfeite && <Adornment equipped={inventory.equipped.enfeite} animate force />}
            </p>
            <p className="text-sm text-fog-400">Sua decoração acompanha a foto no perfil, nas chamadas e nas listas.</p>
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm"><span>Animar decorações e efeitos de nome neste aparelho</span><Toggle label="Animar decorações e efeitos de nome" on={animations} onChange={(on) => setAppearance({ cosmeticAnimations: on })} /></label>
      </Block>}
      {owned.length === 0 && <p className="text-sm text-fog-400">Nenhum item ainda. Ganhe Cosmic Points participando e adquira na Loja.</p>}
      {!filter && PACKS.some((pack) => owned.some((item) => item.pack === pack.id)) && (
        <Block title="Pacotes">
          <ul className="grid gap-2">
            {PACKS.filter((pack) => owned.some((item) => item.pack === pack.id)).map((pack) => {
              const have = owned.filter((item) => item.pack === pack.id).length;
              const wearing = PACK_SLOTS.every((kind) => !owned.some((item) => item.id === pack.items[kind]) || inventory.equipped[kind]?.item === pack.items[kind]);
              return (
                <li key={pack.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-850/60 p-2" data-testid="inventory-pack" data-pack={pack.id}>
                  <Palette pack={pack} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{pack.name}</p>
                    <p className="text-xs text-fog-500">
                      {have} de {PACK_SLOTS.length} peças
                    </p>
                  </div>
                  {wearing ? (
                    <span className="text-sm font-bold text-ok-400">Em uso</span>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => void cosmetics.equipPack(pack.id).catch((error: unknown) => dialogs.alert({ kind: 'erro', title: 'Não foi possível usar o pacote', message: errorText(error) }))} data-testid={`equip-pack-${pack.id}`}>
                      Usar pacote completo
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Block>
      )}
      {SLOTS.filter((kind) => !filter || kind === filter).map((kind) => {
        const items = owned.filter((item) => item.kind === kind);
        if (items.length === 0) return null;
        const current = inventory.equipped[kind];
        return (
          <Block key={kind} title={KIND_NAMES[kind]}>
            <ul className="grid gap-2">
              {items.map((item) => {
                const isOn = current?.item === item.id;
                return (
                  <li key={item.id} className={cx('flex flex-wrap items-center gap-3 rounded-xl p-2', isOn ? 'bg-brand-500/15' : 'bg-ink-850/60')} data-testid="inventory-item" data-item={item.id} data-equipped={isOn}>
                    <div className={cx('shrink-0', kind === 'efeito-nome' ? 'w-full sm:w-64' : 'w-24')}>
                      <ItemPreview account={account} item={item} variant={isOn ? current!.variant : item.variants[0]!.id} size={44} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{item.name}</p>
                      {isOn && item.collectionId && <p className="text-xs font-bold text-ok-400">Selecionado</p>}
                      <p className="text-xs font-bold" style={{ color: RARITY[item.rarity].color }}>
                        {RARITY[item.rarity].name}
                      </p>
                    </div>
                    <Swatches item={item} value={isOn ? current!.variant : ''} onChange={(variant) => void equip(kind, item.id, variant)} />
                    {inventory.items.find((entry) => entry.id === item.id)?.transferable && <Button size="sm" onClick={() => setTransferItem(item)}>Transferir para amigo</Button>}
                    {isOn ? (
                      <Button size="sm" onClick={() => void equip(kind, null)} data-testid={`unequip-${item.id}`}>
                        {kind === 'efeito-nome' || item.collectionId ? 'Desequipar' : 'Tirar'}
                      </Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => void equip(kind, item.id, item.variants[0]!.id)} data-testid={`equip-${item.id}`}>
                        Equipar
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Block>
        );
      })}
    </>
  );
}
