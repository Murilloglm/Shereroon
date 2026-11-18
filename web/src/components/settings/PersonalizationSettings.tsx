import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CATALOG, itemById, KIND_NAMES, POINTS, RARITY, SLOTS, type CosmeticItem, type ItemKind } from '../../../../shared/cosmetics.ts';
import { cosmetics, type UserCosmetics } from '../../lib/cosmetics.ts';
import { dialogs } from '../../lib/dialogs.ts';
import { groups, type Account } from '../../lib/groups/client.ts';
import { social } from '../../lib/social/client.ts';
import { useStore } from '../../lib/store.ts';
import { backgroundStyle, DecoratedAvatar, nameStyle } from '../cosmetics/Decoration.tsx';
import { errorText } from '../groups/common.tsx';
import { GiftDialog, RedeemCode } from './GiftsSettings.tsx';
import { Button, cx } from '../ui.tsx';

const formatPoints = (value: number) => value.toLocaleString('pt-BR');

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
  const avatar = useStore(social.store, (state) => state.profiles[account.id]?.avatar ?? null);
  const preview: UserCosmetics = { [item.kind]: { item: item.id, variant } };
  if (item.kind === 'fundo') return <div className="h-20 w-full rounded-xl" style={backgroundStyle(preview)} aria-hidden="true" />;
  if (item.kind === 'cor-nome') {
    return (
      <p className="flex h-20 items-center justify-center text-lg font-extrabold" style={nameStyle(preview)}>
        {account.displayName}
      </p>
    );
  }
  return (
    <div className="flex h-20 items-center justify-center">
      <DecoratedAvatar userId={account.id} name={account.displayName} size={size} image={avatar} animate preview={preview} />
    </div>
  );
}

function Swatches({ item, value, onChange }: { item: CosmeticItem; value: string; onChange: (variant: string) => void }) {
  if (item.variants.length < 2) return null;
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

// --- Loja -----------------------------------------------------------------------------------------

export function ShopSettings({ account }: { account: Account }) {
  const shop = useStore(cosmetics.store, (state) => state.shop);
  const points = useStore(cosmetics.store, (state) => state.points?.points ?? null);
  const unlimited = useStore(cosmetics.store, (state) => state.points?.unlimited === true);
  const [gift, setGift] = useState<CosmeticItem | null>(null);
  const [variants, setVariants] = useState<Record<string, string>>({});
  useEffect(() => {
    void cosmetics.loadShop().catch(() => undefined);
    void cosmetics.loadPoints().catch(() => undefined);
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
      {SLOTS.map((kind) => {
        const items = (shop ?? CATALOG.map((item) => ({ ...item, owned: false }))).filter((item) => item.kind === kind);
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
    </>
  );
}

// --- Inventário -----------------------------------------------------------------------------------

export function InventorySettings({ account }: { account: Account }) {
  const inventory = useStore(cosmetics.store, (state) => state.inventory);
  const [transferItem, setTransferItem] = useState<CosmeticItem | null>(null);
  const avatar = useStore(social.store, (state) => state.profiles[account.id]?.avatar ?? null);
  useEffect(() => {
    void cosmetics.loadInventory().catch(() => undefined);
    void social.profile(account.id).catch(() => undefined);
  }, [account.id]);
  if (!inventory) return <p className="text-sm text-fog-400">Carregando…</p>;
  const owned = inventory.items.map((entry) => itemById(entry.id)).filter((item): item is CosmeticItem => Boolean(item));
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
      <Block>
        <div className="flex items-center gap-5">
          <div className="flex size-28 items-center justify-center" data-testid="inventory-preview">
            <DecoratedAvatar userId={account.id} name={account.displayName} size={80} image={avatar} animate preview={inventory.equipped} />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-extrabold" style={nameStyle(inventory.equipped)}>
              {account.displayName}
            </p>
            <p className="text-sm text-fog-400">É assim que os outros veem seu avatar na chamada e no perfil. Nas listas, a decoração aparece parada.</p>
          </div>
        </div>
      </Block>
      {owned.length === 0 && <p className="text-sm text-fog-400">Nenhum item ainda. Ganhe Cosmic Points participando e adquira na Loja.</p>}
      {SLOTS.map((kind) => {
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
                    <div className="w-24 shrink-0">
                      <ItemPreview account={account} item={item} variant={isOn ? current!.variant : item.variants[0]!.id} size={44} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{item.name}</p>
                      <p className="text-xs font-bold" style={{ color: RARITY[item.rarity].color }}>
                        {RARITY[item.rarity].name}
                      </p>
                    </div>
                    <Swatches item={item} value={isOn ? current!.variant : ''} onChange={(variant) => void equip(kind, item.id, variant)} />
                    {inventory.items.find((entry) => entry.id === item.id)?.transferable && <Button size="sm" onClick={() => setTransferItem(item)}>Transferir para amigo</Button>}
                    {isOn ? (
                      <Button size="sm" onClick={() => void equip(kind, null)} data-testid={`unequip-${item.id}`}>
                        Tirar
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
