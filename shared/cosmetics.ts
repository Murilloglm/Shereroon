/**
 * Catálogo de itens cosméticos e regras dos Cosmic Points. Usado pelo servidor (preços, posse, regras) e pela
 * interface (nomes, raridade, como desenhar). Para lançar um item novo basta acrescentá-lo aqui e, se for uma
 * decoração com desenho novo, o desenho em web/src/components/cosmetics: a loja e o inventário são genéricos.
 *
 * Todos os desenhos são originais do Cosmic Night. Os Cosmic Points são gratuitos, ganhos por participação, sem
 * dinheiro real, sem apostas e sem conversão em valores.
 */

export type ItemKind = 'decoracao' | 'moldura' | 'fundo' | 'cor-nome';
export type Rarity = 'comum' | 'rara' | 'epica' | 'lendaria';

export interface CosmeticVariant {
  id: string;
  name: string;
  /** Cores principais da variação (o desenho usa como quiser). */
  colors: [string, string];
}

export interface CosmeticItem {
  id: string;
  kind: ItemKind;
  name: string;
  description: string;
  price: number;
  rarity: Rarity;
  /** Tem versão animada (sempre há uma versão parada, usada quando as animações estão reduzidas). */
  animated: boolean;
  /** Reage quando a pessoa fala. */
  reactsToVoice: boolean;
  variants: CosmeticVariant[];
}

export const KIND_NAMES: Record<ItemKind, string> = {
  decoracao: 'Decoração de avatar',
  moldura: 'Moldura',
  fundo: 'Fundo de perfil',
  'cor-nome': 'Cor do nome',
};

export const RARITY: Record<Rarity, { name: string; color: string }> = {
  comum: { name: 'Comum', color: '#9aa3c7' },
  rara: { name: 'Rara', color: '#3fdcff' },
  epica: { name: 'Épica', color: '#b79dff' },
  lendaria: { name: 'Lendária', color: '#ffc65c' },
};

const NEON: CosmeticVariant = { id: 'neon', name: 'Neon', colors: ['#3fdcff', '#7c4dff'] };
const VIOLETA: CosmeticVariant = { id: 'violeta', name: 'Violeta', colors: ['#b79dff', '#6536e8'] };
const ROSA: CosmeticVariant = { id: 'rosa', name: 'Rosa', colors: ['#ff8aa6', '#b82650'] };
const OURO: CosmeticVariant = { id: 'ouro', name: 'Ouro', colors: ['#ffd98a', '#c98a1a'] };
const MENTA: CosmeticVariant = { id: 'menta', name: 'Menta', colors: ['#7ff0c0', '#14a37a'] };

export const CATALOG: CosmeticItem[] = [
  { id: 'anel-aurora', kind: 'decoracao', name: 'Anel Aurora', description: 'Um anel de luz que gira devagar em volta do avatar.', price: 150, rarity: 'comum', animated: true, reactsToVoice: true, variants: [NEON, VIOLETA, ROSA, MENTA] },
  { id: 'orbita-estelar', kind: 'decoracao', name: 'Órbita Estelar', description: 'Estrelas pequenas em órbita, que brilham mais quando você fala.', price: 300, rarity: 'rara', animated: true, reactsToVoice: true, variants: [NEON, OURO] },
  { id: 'luas-gemeas', kind: 'decoracao', name: 'Luas Gêmeas', description: 'Duas luas crescentes que se perseguem em volta do avatar.', price: 350, rarity: 'rara', animated: true, reactsToVoice: false, variants: [VIOLETA, OURO] },
  { id: 'poeira-cosmica', kind: 'decoracao', name: 'Poeira Cósmica', description: 'Partículas de luz flutuando em volta, como poeira de nebulosa.', price: 400, rarity: 'rara', animated: true, reactsToVoice: true, variants: [NEON, ROSA] },
  { id: 'planeta-aneis', kind: 'decoracao', name: 'Planeta de Anéis', description: 'Um pequeno planeta com anéis no canto do avatar.', price: 600, rarity: 'epica', animated: true, reactsToVoice: false, variants: [VIOLETA, MENTA, OURO] },
  { id: 'asas-nebulosa', kind: 'decoracao', name: 'Asas de Nebulosa', description: 'Asas estilizadas de luz atrás do avatar, que se abrem quando você fala.', price: 700, rarity: 'epica', animated: true, reactsToVoice: true, variants: [NEON, ROSA] },
  { id: 'tempestade', kind: 'decoracao', name: 'Tempestade', description: 'Raios curtos que estalam em volta do avatar.', price: 650, rarity: 'epica', animated: true, reactsToVoice: true, variants: [NEON, OURO] },
  { id: 'chama-solar', kind: 'decoracao', name: 'Chama Solar', description: 'Uma coroa de fogo que dança em volta do avatar.', price: 900, rarity: 'lendaria', animated: true, reactsToVoice: true, variants: [OURO, ROSA] },
  { id: 'cristal-gelo', kind: 'decoracao', name: 'Cristal de Gelo', description: 'Cristais de gelo que cintilam em volta do avatar.', price: 900, rarity: 'lendaria', animated: true, reactsToVoice: false, variants: [NEON, VIOLETA] },
  { id: 'guardiao-cosmico', kind: 'decoracao', name: 'Guardião Cósmico', description: 'Uma criatura de luz original do Cosmic Night que dá a volta no avatar.', price: 1200, rarity: 'lendaria', animated: true, reactsToVoice: true, variants: [VIOLETA, NEON] },
  { id: 'moldura-neon', kind: 'moldura', name: 'Moldura Neon', description: 'Contorno em gradiente em volta do avatar.', price: 120, rarity: 'comum', animated: false, reactsToVoice: false, variants: [NEON, ROSA, OURO] },
  { id: 'fundo-nebulosa', kind: 'fundo', name: 'Nebulosa', description: 'Fundo de perfil com uma nebulosa roxa e azul.', price: 200, rarity: 'comum', animated: false, reactsToVoice: false, variants: [VIOLETA, NEON] },
  { id: 'fundo-aurora', kind: 'fundo', name: 'Aurora', description: 'Fundo de perfil com faixas de aurora.', price: 350, rarity: 'rara', animated: true, reactsToVoice: false, variants: [MENTA, ROSA] },
  { id: 'nome-aurora', kind: 'cor-nome', name: 'Nome Aurora', description: 'Seu nome em gradiente nas mensagens e na lista de membros.', price: 250, rarity: 'rara', animated: false, reactsToVoice: false, variants: [NEON, ROSA, OURO] },
];

export const SLOTS: ItemKind[] = ['decoracao', 'moldura', 'fundo', 'cor-nome'];

export const itemById = (id: string): CosmeticItem | undefined => CATALOG.find((item) => item.id === id);

/** Item equipado: id do item e da variação de cor. */
export interface Equipped {
  item: string;
  variant: string;
}

/** Regras dos Cosmic Points (o servidor é quem aplica; a interface só mostra). */
export const POINTS = {
  /** Chamada com pelo menos mais uma pessoa, usando o aplicativo de verdade: pontos a cada bloco de minutos. */
  voiceBlockMinutes: 5,
  voicePointsPerBlock: 3,
  /** Sem mexer no aplicativo (teclado, mouse, falar) por mais que isso, a chamada não conta. */
  idleAfterMinutes: 10,
  voiceDailyCap: 90,
  /** Primeira mensagem do dia em um grupo. */
  dailyMessage: 10,
  /** Primeira vez no dia. */
  dailyLogin: 5,
  /** Teto diário de tudo o que é ganho (as compras não contam). */
  dailyCap: 150,
} as const;
