import { COLLECTIONS } from './cosmetic-collections.ts';
export { COLLECTIONS, collectionById, type CosmeticCollection } from './cosmetic-collections.ts';

/**
 * Catálogo de itens cosméticos e regras dos Cosmic Points. Usado pelo servidor (preços, posse, regras) e pela
 * interface (nomes, raridade, como desenhar). Para lançar um item novo basta acrescentá-lo aqui e, se for uma
 * decoração com desenho novo, o desenho em web/src/components/cosmetics: a loja e o inventário são genéricos.
 *
 * As coleções usam recortes das referências fornecidas em enfeites/, com procedência em metadata.json.
 * Os Cosmic Points são gratuitos, ganhos por participação, sem dinheiro real ou conversão em valores.
 */

export type ItemKind = 'decoracao' | 'moldura' | 'fundo' | 'cor-nome' | 'enfeite' | 'efeito-nome';
export type Rarity = 'comum' | 'rara' | 'epica' | 'lendaria';

export interface CosmeticVariant {
  id: string;
  name: string;
  /** Cores principais da variação (o desenho usa como quiser). */
  colors: [string, string];
  /** Alternate artwork from an original sheet. */
  asset?: string;
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
  /** Pacote a que o item pertence (os desenhos e a paleta vêm do pacote). */
  pack?: string;
  collectionId?: string;
  asset?: string;
  avatarScale?: number;
  frameAspect?: number;
  nameplateAsset?: string;
}

export const KIND_NAMES: Record<ItemKind, string> = {
  decoracao: 'Decoração de avatar',
  moldura: 'Moldura',
  fundo: 'Fundo de perfil',
  'cor-nome': 'Cor do nome',
  enfeite: 'Enfeite no nome do servidor',
  'efeito-nome': 'Efeitos de Nome do Servidor',
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

export type PackItemKind = Exclude<ItemKind, 'efeito-nome'>;
export type CollectionItemKind = Exclude<ItemKind, 'enfeite'>;
export const PACK_SLOTS: PackItemKind[] = ['decoracao', 'moldura', 'fundo', 'cor-nome', 'enfeite'];
export const COLLECTION_SLOTS: CollectionItemKind[] = ['decoracao', 'moldura', 'fundo', 'cor-nome', 'efeito-nome'];
export const SLOTS: ItemKind[] = [...PACK_SLOTS, 'efeito-nome'];

// --- Pacotes -----------------------------------------------------------------------------------------
//
// Um pacote é uma coleção de 5 itens comuns do catálogo, um por categoria, com o mesmo tema. Cada item é comprado,
// presenteado e equipado sozinho como qualquer outro; o pacote só agrupa (prévia conjunta, compra de tudo com
// desconto, "usar o pacote completo"). Assim dá para usar o pacote inteiro ou misturar peças de vários.
//
// Os desenhos ficam em web/src/components/cosmetics/packs.tsx (um por pacote e categoria) e são originais do
// Cosmic Night: temas como "dragão da noite" ou "gato elétrico", sem personagens, logotipos ou artes de terceiros.

export interface PackPalette {
  /** Fundo escuro (ou claro, nos pacotes claros) do tema. */
  base: string;
  /** Brilho principal. */
  glow: string;
  /** Cor de destaque. */
  accent: string;
  /** Tom de contorno e sombra. */
  ink: string;
}

export interface CosmeticPack {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  palette: PackPalette;
  /** Regras visuais do tema: o que toda peça nova do pacote deve seguir. */
  rules: string[];
  /** O item de cada categoria. */
  items: Record<PackItemKind, string>;
}

/** Desconto ao levar de uma vez dois ou mais itens que faltam de um pacote. */
export const PACK_DISCOUNT = 0.25;

/** Preço de cada categoria, conforme a raridade do pacote. */
const PACK_PRICES: Record<Rarity, Record<PackItemKind, number>> = {
  comum: { decoracao: 250, moldura: 120, fundo: 150, 'cor-nome': 120, enfeite: 150 },
  rara: { decoracao: 400, moldura: 200, fundo: 250, 'cor-nome': 200, enfeite: 250 },
  epica: { decoracao: 600, moldura: 300, fundo: 350, 'cor-nome': 300, enfeite: 350 },
  lendaria: { decoracao: 900, moldura: 400, fundo: 450, 'cor-nome': 400, enfeite: 450 },
};

/** Itens animados em cada categoria (o fundo e a cor do nome são parados, para não pesar). */
const PACK_ANIMATED: Record<PackItemKind, boolean> = { decoracao: true, moldura: false, fundo: false, 'cor-nome': false, enfeite: true };

interface PackSpec extends Omit<CosmeticPack, 'items'> {
  pieces: Record<PackItemKind, { name: string; description: string }>;
}

const PACK_SPECS: PackSpec[] = [
  {
    id: 'asa-meia-noite',
    name: 'Asa da Meia-Noite',
    description: 'Um dragão de escamas escuras que voa sob a lua, com brilho roxo-azulado.',
    rarity: 'lendaria',
    palette: { base: '#0b0820', glow: '#8b5cff', accent: '#4cc3ff', ink: '#1d1446' },
    rules: ['Escuro como base; o brilho roxo-azulado fica só nas bordas e nos olhos.', 'Asas membranosas, escamas e garras; nenhum rosto de personagem conhecido.', 'Lua cheia e estrelas como única luz do fundo.'],
    pieces: {
      decoracao: { name: 'Dragão da Meia-Noite', description: 'Um dragão envolve o avatar e bate as asas devagar.' },
      moldura: { name: 'Escamas Noturnas', description: 'Contorno de escamas com reflexos roxos e azuis.' },
      fundo: { name: 'Lua sobre as Nuvens', description: 'Lua cheia, nuvens noturnas e estrelas.' },
      'cor-nome': { name: 'Brilho Noturno', description: 'Nome em roxo que termina em azul elétrico.' },
      enfeite: { name: 'Asinhas da Meia-Noite', description: 'Um par de asas pequenas ao lado do nick.' },
    },
  },
  {
    id: 'asa-aurora',
    name: 'Asa da Aurora',
    description: 'Um dragão de luz, branco e azul suave, com brilho delicado de aurora.',
    rarity: 'lendaria',
    palette: { base: '#e9f1ff', glow: '#8fd3ff', accent: '#ffffff', ink: '#6f7fc8' },
    rules: ['Claro como base: branco, azul bebê e lilás bem suaves.', 'Penas, nuvens e estrelas de quatro pontas; brilho delicado, nunca neon forte.', 'Contornos finos em azul-lavanda para não sumir em temas claros.'],
    pieces: {
      decoracao: { name: 'Dragão da Aurora', description: 'Um dragão de luz dá a volta no avatar entre penas e brilhos.' },
      moldura: { name: 'Penas de Luz', description: 'Contorno branco perolado com reflexo azul.' },
      fundo: { name: 'Céu de Aurora', description: 'Faixas de aurora suave sobre nuvens claras.' },
      'cor-nome': { name: 'Luz Suave', description: 'Nome em azul claro e lavanda.' },
      enfeite: { name: 'Estrela da Aurora', description: 'Uma estrela de quatro pontas que cintila ao lado do nick.' },
    },
  },
  {
    id: 'gato-trovao',
    name: 'Gato Trovão',
    description: 'Um gato rabugento e elétrico: amarelo, laranja, raios e muito humor.',
    rarity: 'epica',
    palette: { base: '#1a1203', glow: '#ffd23f', accent: '#ff8a1f', ink: '#5a3606' },
    rules: ['Amarelo e laranja com raios curtos; fundo quase preto.', 'Orelhas, patinhas e rabo listrado; expressão de tédio cômico.', 'Os raios piscam rápido, mas nunca cobrem o avatar.'],
    pieces: {
      decoracao: { name: 'Gato Elétrico', description: 'Orelhas de gato, rabo listrado e raios estalando em volta do avatar.' },
      moldura: { name: 'Faísca de Gato', description: 'Contorno amarelo e laranja com uma patinha.' },
      fundo: { name: 'Cochilo Elétrico', description: 'Raios cruzando um céu escuro com patinhas.' },
      'cor-nome': { name: 'Nome Faísca', description: 'Nome em amarelo elétrico e laranja.' },
      enfeite: { name: 'Gato Rabugento', description: 'Uma carinha de gato entediado soltando faíscas.' },
    },
  },
  {
    id: 'slime-celeste',
    name: 'Slime Celeste',
    description: 'Um slime azul brincalhão, cheio de magia e com uma aura suave.',
    rarity: 'epica',
    palette: { base: '#061a33', glow: '#4fc3ff', accent: '#b6f3ff', ink: '#0d3b6e' },
    rules: ['Azuis translúcidos, como gelatina; brilhos redondos.', 'Gotas, bolhas e runas simples; formas sempre arredondadas.', 'Aura que pulsa devagar, sem flashes.'],
    pieces: {
      decoracao: { name: 'Aura de Slime', description: 'Gotas e bolhas mágicas flutuam numa aura azul em volta do avatar.' },
      moldura: { name: 'Gotas Mágicas', description: 'Contorno azul translúcido com gotinhas.' },
      fundo: { name: 'Lago Arcano', description: 'Um lago azul com bolhas e runas.' },
      'cor-nome': { name: 'Azul Gelatina', description: 'Nome em azul celeste translúcido.' },
      enfeite: { name: 'Slimezinho', description: 'Um slime pequeno e sorridente que balança ao lado do nick.' },
    },
  },
  {
    id: 'nevoa-eterea',
    name: 'Névoa Etérea',
    description: 'Roxo espiritual: névoa, borboletas de luz e energia sombria.',
    rarity: 'epica',
    palette: { base: '#160a26', glow: '#c06bff', accent: '#ff7ad9', ink: '#3a1660' },
    rules: ['Roxo e magenta sobre fundo quase preto.', 'Borboletas de luz e névoa que sobe; nada de símbolos de terceiros.', 'Movimento lento e flutuante.'],
    pieces: {
      decoracao: { name: 'Borboletas Espirituais', description: 'Borboletas de luz voam em volta do avatar, entre a névoa.' },
      moldura: { name: 'Véu Etéreo', description: 'Contorno roxo que se desfaz em névoa rosa.' },
      fundo: { name: 'Jardim Espiritual', description: 'Névoa roxa com borboletas de luz.' },
      'cor-nome': { name: 'Rosa Etéreo', description: 'Nome em roxo e rosa espiritual.' },
      enfeite: { name: 'Borboleta Etérea', description: 'Uma borboleta de luz que bate as asas ao lado do nick.' },
    },
  },
  {
    id: 'corrente-veloz',
    name: 'Corrente Veloz',
    description: 'Velocidade e eletricidade azul, com faíscas amarelas de energia.',
    rarity: 'rara',
    palette: { base: '#050b1f', glow: '#2f7bff', accent: '#ffe14d', ink: '#0c2a6b' },
    rules: ['Azul elétrico com toques de amarelo.', 'Raios em zigue-zague e linhas de velocidade inclinadas.', 'Movimento rápido em giro; sem personagens.'],
    pieces: {
      decoracao: { name: 'Anel de Corrente', description: 'Um anel de energia gira rápido, soltando raios.' },
      moldura: { name: 'Circuito Veloz', description: 'Contorno azul com trilhas de circuito amarelas.' },
      fundo: { name: 'Pista Elétrica', description: 'Linhas de velocidade e raios sobre azul escuro.' },
      'cor-nome': { name: 'Azul Voltagem', description: 'Nome em azul elétrico que acende em amarelo.' },
      enfeite: { name: 'Raio Veloz', description: 'Um raio pequeno que pisca ao lado do nick.' },
    },
  },
  {
    id: 'veu-sombras',
    name: 'Véu das Sombras',
    description: 'Sombra, névoa e azul escuro: um manto que some e reaparece.',
    rarity: 'epica',
    palette: { base: '#070816', glow: '#4b4bd6', accent: '#8a7dff', ink: '#14163a' },
    rules: ['Azul-marinho e índigo; quase sem cor viva.', 'Fumaça, capuzes vazios e portais; os olhos são o único brilho.', 'Aparece e some em fade, sem piscar.'],
    pieces: {
      decoracao: { name: 'Fumaça das Sombras', description: 'Fumaça escura gira em volta do avatar e se desfaz.' },
      moldura: { name: 'Contorno Sombrio', description: 'Contorno índigo que escurece nas bordas.' },
      fundo: { name: 'Abismo', description: 'Um portal de sombra no meio da névoa.' },
      'cor-nome': { name: 'Sombra Azul', description: 'Nome em azul profundo e índigo.' },
      enfeite: { name: 'Capuz Sombrio', description: 'Um capuz vazio com olhos que brilham ao lado do nick.' },
    },
  },
  {
    id: 'lamina-vento',
    name: 'Lâmina do Vento',
    description: 'Vento e leveza, em branco e azul: rajadas e lâminas de ar.',
    rarity: 'rara',
    palette: { base: '#0a1626', glow: '#9fe6ff', accent: '#ffffff', ink: '#2a6f9e' },
    rules: ['Branco e azul-gelo, com muito espaço vazio.', 'Redemoinhos, rajadas e lâminas curvas; traços finos.', 'Movimento leve, como brisa.'],
    pieces: {
      decoracao: { name: 'Redemoinho', description: 'Rajadas de vento circulam o avatar.' },
      moldura: { name: 'Corte de Vento', description: 'Contorno branco e azul com cortes de ar.' },
      fundo: { name: 'Céu Aberto', description: 'Céu azul com nuvens e rajadas.' },
      'cor-nome': { name: 'Brisa Gelada', description: 'Nome em branco e azul-gelo.' },
      enfeite: { name: 'Rajada', description: 'Um redemoinho de vento ao lado do nick.' },
    },
  },
  {
    id: 'explosao-urbana',
    name: 'Explosão Urbana',
    description: 'Explosões, laranja e energia, com cara de arte de rua.',
    rarity: 'rara',
    palette: { base: '#1a0a04', glow: '#ff7a1a', accent: '#ffd23a', ink: '#4a1a08' },
    rules: ['Laranja e amarelo sobre fundo de tijolo escuro.', 'Estouros de quadrinho, respingos de tinta e onomatopeias originais.', 'Pulsa como explosão, sem flash branco.'],
    pieces: {
      decoracao: { name: 'Anel Explosivo', description: 'Estouros e respingos de tinta em volta do avatar.' },
      moldura: { name: 'Grafite', description: 'Contorno laranja com respingos de tinta.' },
      fundo: { name: 'Muro Grafitado', description: 'Um muro com um estouro de quadrinho: BUM!' },
      'cor-nome': { name: 'Laranja Pólvora', description: 'Nome em laranja e amarelo.' },
      enfeite: { name: 'Estouro', description: 'Uma estrela de explosão ao lado do nick.' },
    },
  },
  {
    id: 'mira-tatica',
    name: 'Mira Tática',
    description: 'Tático, moderno e tecnológico: retículas, radar e divisas.',
    rarity: 'rara',
    palette: { base: '#0d0f0a', glow: '#ffd84d', accent: '#c9d1d9', ink: '#2b2f24' },
    rules: ['Amarelo tático e cinza metálico sobre fundo grafite.', 'Retículas, grades, colchetes e divisas; linhas retas.', 'Varredura lenta de radar.'],
    pieces: {
      decoracao: { name: 'Retícula Tática', description: 'Uma retícula com colchetes que gira devagar em volta do avatar.' },
      moldura: { name: 'Moldura Tática', description: 'Contorno metálico com marcas amarelas.' },
      fundo: { name: 'Radar', description: 'Grade tática com um radar no centro.' },
      'cor-nome': { name: 'Ouro Tático', description: 'Nome em amarelo tático e prata.' },
      enfeite: { name: 'Divisa', description: 'Uma divisa dupla ao lado do nick.' },
    },
  },
  {
    id: 'impacto-rubro',
    name: 'Impacto Rubro',
    description: 'Velocidade, combate e impacto visual, em vermelho e rosa.',
    rarity: 'epica',
    palette: { base: '#14060c', glow: '#ff3d6e', accent: '#ff9bb5', ink: '#3c0b1d' },
    rules: ['Vermelho-rubi e rosa sobre fundo quase preto.', 'Setas, marcas de velocidade e ondas de impacto.', 'Avança em pulsos curtos.'],
    pieces: {
      decoracao: { name: 'Anel de Impacto', description: 'Ondas de impacto e setas de avanço em volta do avatar.' },
      moldura: { name: 'Marcas de Velocidade', description: 'Contorno rubro com marcas de velocidade.' },
      fundo: { name: 'Cidade em Alta Velocidade', description: 'Prédios borrados e linhas de velocidade vermelhas.' },
      'cor-nome': { name: 'Rubro Veloz', description: 'Nome em vermelho-rubi e rosa.' },
      enfeite: { name: 'Avanço', description: 'Setas de avanço ao lado do nick.' },
    },
  },
];

const PACK_ITEM_ID: Record<PackItemKind, string> = { decoracao: 'deco', moldura: 'moldura', fundo: 'fundo', 'cor-nome': 'nome', enfeite: 'enfeite' };

export const PACKS: CosmeticPack[] = PACK_SPECS.map(({ pieces, ...pack }) => ({
  ...pack,
  items: Object.fromEntries(PACK_SLOTS.map((kind) => [kind, `${pack.id}-${PACK_ITEM_ID[kind]}`])) as Record<PackItemKind, string>,
}));

for (const spec of PACK_SPECS) {
  for (const kind of PACK_SLOTS) {
    const piece = spec.pieces[kind];
    CATALOG.push({
      id: `${spec.id}-${PACK_ITEM_ID[kind]}`,
      kind,
      name: piece.name,
      description: piece.description,
      price: PACK_PRICES[spec.rarity][kind],
      rarity: spec.rarity,
      animated: PACK_ANIMATED[kind],
      reactsToVoice: kind === 'decoracao',
      variants: [{ id: 'original', name: spec.name, colors: [spec.palette.glow, spec.palette.accent] }],
      pack: spec.id,
    });
  }
}

const ASSET_FILES: Record<CollectionItemKind, string> = {
  decoracao: 'avatar-decoration.png', moldura: 'profile-frame.png', fundo: 'profile-banner.webp',
  'cor-nome': 'username-effect.png', 'efeito-nome': 'member-name-effect.webp',
};
// Reutiliza os preços dos tipos existentes. Todos continuam configuráveis na Administração Cosmic.
const PRICE_REFERENCE: Record<CollectionItemKind, string> = {
  decoracao: 'anel-aurora', moldura: 'moldura-neon', fundo: 'fundo-nebulosa',
  'cor-nome': 'nome-aurora', 'efeito-nome': 'nome-aurora',
};

CATALOG.push(...COLLECTIONS.flatMap((collection) => COLLECTION_SLOTS.map((kind): CosmeticItem => ({
  id: `${collection.id}-${kind}`, kind, collectionId: collection.id,
  name: `${collection.name} · ${KIND_NAMES[kind]}`,
  description: `${KIND_NAMES[kind]} da coleção ${collection.name}, com a arte da referência original.`,
  price: CATALOG.find((item) => item.id === PRICE_REFERENCE[kind])!.price,
  rarity: 'epica', animated: kind === 'efeito-nome', reactsToVoice: false,
  variants: [{ id: 'original', name: 'Original', colors: collection.colors },
    ...(kind === 'fundo' ? collection.banners.map((banner) => ({ ...banner, colors: collection.colors })) : [])],
  asset: `assets/cosmetics/${collection.id}/${ASSET_FILES[kind]}`,
  avatarScale: kind === 'decoracao' ? collection.avatarScale : undefined,
  frameAspect: kind === 'moldura' ? collection.frameAspect ?? undefined : undefined,
  nameplateAsset: kind === 'moldura' ? collection.nameplateAsset : undefined,
}))));


export const itemById = (id: string): CosmeticItem | undefined => CATALOG.find((item) => item.id === id);

export const cosmeticAsset = (item: CosmeticItem, variant?: string): string | undefined =>
  item.variants.find((entry) => entry.id === variant)?.asset ?? item.asset;
export const packById = (id: string): CosmeticPack | undefined => PACKS.find((pack) => pack.id === id);

/**
 * Preço de levar de uma vez os itens que faltam de um pacote (preços de cada um). Com dois ou mais, há o desconto
 * do pacote, arredondado para múltiplos de 5; um só sai pelo preço normal.
 */
export function packPrice(prices: readonly number[]): number {
  const sum = prices.reduce((total, price) => total + price, 0);
  return prices.length >= 2 ? Math.round((sum * (1 - PACK_DISCOUNT)) / 5) * 5 : sum;
}

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
