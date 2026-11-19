# Pacotes cosméticos e o enfeite no nome do servidor

## Resumo

Um **pacote** reúne 5 itens comuns do catálogo, um de cada categoria, com o mesmo tema:

1. decoração de avatar;
2. moldura;
3. fundo de perfil;
4. cor do nome;
5. **enfeite no nome do servidor**, a categoria nova.

Cada item é comprado, presenteado e equipado sozinho, como qualquer outro. O pacote só agrupa as peças:

- mostra uma prévia conjunta;
- vende tudo o que falta de uma vez, com desconto;
- tem "usar pacote completo".

Assim dá para usar o pacote inteiro ou misturar peças de vários.

Como as peças são itens normais, nada muda para o banco, os presentes, os códigos promocionais, o painel administrativo (preço e disponibilidade por item) e o inventário.

## Os 11 pacotes

Todos os desenhos são **originais do Cosmic Night**, feitos com formas simples em SVG e gradientes CSS. Os pedidos citavam personagens e jogos de terceiros (filmes, mangás, Valorant, Deadlock). Os pacotes seguem o **tema** pedido (cores, clima, motivos) com nomes e desenhos próprios. Não usam personagens, rostos, logotipos, marcas nem as imagens de referência, que mostravam personagens e logotipos dessas obras. Os nomes de terceiros aparecem só na coluna "pedido", para rastrear a origem.

| Pedido | Pacote | Raridade | Preço do pacote (avulso) |
| --- | --- | --- | --- |
| Fúria da Noite | **Asa da Meia-Noite** | Lendária | 1.950 (2.600) |
| Fúria da Luz | **Asa da Aurora** | Lendária | 1.950 (2.600) |
| Gato elétrico (Eleceed) | **Gato Trovão** | Épica | 1.425 (1.900) |
| Rimuru | **Slime Celeste** | Épica | 1.425 (1.900) |
| Clove | **Névoa Etérea** | Épica | 1.425 (1.900) |
| Neon | **Corrente Veloz** | Rara | 975 (1.300) |
| Omen | **Véu das Sombras** | Épica | 1.425 (1.900) |
| Jett | **Lâmina do Vento** | Rara | 975 (1.300) |
| Raze | **Explosão Urbana** | Rara | 975 (1.300) |
| Tejo | **Mira Tática** | Rara | 975 (1.300) |
| Rush (Deadlock) | **Impacto Rubro** | Épica | 1.425 (1.900) |

### Itens

Ordem das colunas: decoração · moldura · fundo · cor do nome · enfeite.

| Pacote | Decoração | Moldura | Fundo | Cor do nome | Enfeite |
| --- | --- | --- | --- | --- | --- |
| Asa da Meia-Noite | Dragão da Meia-Noite | Escamas Noturnas | Lua sobre as Nuvens | Brilho Noturno | Asinhas da Meia-Noite |
| Asa da Aurora | Dragão da Aurora | Penas de Luz | Céu de Aurora | Luz Suave | Estrela da Aurora |
| Gato Trovão | Gato Elétrico | Faísca de Gato | Cochilo Elétrico | Nome Faísca | Gato Rabugento |
| Slime Celeste | Aura de Slime | Gotas Mágicas | Lago Arcano | Azul Gelatina | Slimezinho |
| Névoa Etérea | Borboletas Espirituais | Véu Etéreo | Jardim Espiritual | Rosa Etéreo | Borboleta Etérea |
| Corrente Veloz | Anel de Corrente | Circuito Veloz | Pista Elétrica | Azul Voltagem | Raio Veloz |
| Véu das Sombras | Fumaça das Sombras | Contorno Sombrio | Abismo | Sombra Azul | Capuz Sombrio |
| Lâmina do Vento | Redemoinho | Corte de Vento | Céu Aberto | Brisa Gelada | Rajada |
| Explosão Urbana | Anel Explosivo | Grafite | Muro Grafitado | Laranja Pólvora | Estouro |
| Mira Tática | Retícula Tática | Moldura Tática | Radar | Ouro Tático | Divisa |
| Impacto Rubro | Anel de Impacto | Marcas de Velocidade | Cidade em Alta Velocidade | Rubro Veloz | Avanço |

As descrições curtas, as paletas (base, brilho, destaque e contorno) e as **regras visuais** de cada tema estão em `PACK_SPECS` (`shared/cosmetics.ts`). A loja mostra as regras em "Regras visuais do tema". Elas dizem o que toda peça nova do pacote deve seguir, por exemplo: "escuro como base; o brilho roxo-azulado fica só nas bordas e nos olhos".

### Preços

| Categoria | Rara | Épica | Lendária |
| --- | --- | --- | --- |
| Decoração | 400 | 600 | 900 |
| Moldura | 200 | 300 | 400 |
| Fundo | 250 | 350 | 450 |
| Cor do nome | 200 | 300 | 400 |
| Enfeite | 250 | 350 | 450 |

**Desconto do pacote.** Ao levar dois ou mais itens que faltam de uma vez, o desconto é de 25% (`PACK_DISCOUNT`), arredondado para múltiplos de 5. Um item só sai pelo preço normal, para a compra "pelo pacote" não virar desconto avulso.

Os preços seguem o painel administrativo (`shop_settings`): se a administração mudar o preço de uma peça, o pacote recalcula. Se uma peça sair da loja, o pacote fica indisponível.

## Como foi modelado

| Onde | O quê |
| --- | --- |
| `shared/cosmetics.ts` | `ItemKind` ganhou `'enfeite'`, e `SLOTS` ganhou o espaço. `CosmeticItem.pack` diz a que pacote o item pertence. `CosmeticPack` traz id, nome, descrição, raridade, `palette` e `rules`, e `items` aponta um item por categoria. `PACK_SPECS` gera os 55 itens no `CATALOG` (ids `<pacote>-deco`, `-moldura`, `-fundo`, `-nome`, `-enfeite`, todos com a variação `original`). Também ficam aqui `packById()`, `packPrice()` e `PACK_DISCOUNT`. |
| Banco | **Sem migração.** As peças entram em `user_items`, e o equipado vai para `user_equipped` (o `slot` é texto, e `'enfeite'` é só mais um valor). |
| `server/src/community/commerce.ts` | `packs(userId)` diz, por pacote, o que a conta tem, o que falta, o preço com desconto, o preço cheio e se está à venda. `purchasePack()` faz tudo numa transação. |
| `server/src/community/economy.ts` | `packs()`, `buyPack()` e `equipPack()`: este último equipa de uma vez o que a conta tem do pacote, cada peça no seu espaço. |
| Rotas | `GET /api/shop` devolve também `packs`. `POST /api/shop/buy-pack` recebe `{ packId, expectedPrice }`. `PUT /api/me/equipped/pack` recebe `{ packId }`. A compra de pacote tem o mesmo limite de compras e exige MFA de Cosmic Admin, como `/api/shop/buy`. |

**A transação de `purchasePack()`:**

1. trava a conta;
2. confere que todas as peças estão à venda e calcula o que falta;
3. se o preço mudou, pede nova confirmação (`preco_alterado`);
4. faz um débito só, com o detalhe "Pacote: Nome";
5. entrega as peças, com o valor pago dividido entre elas na proporção do preço.

Dois pedidos ao mesmo tempo cobram uma vez só. Sem saldo, nada é entregue.

### Desenhos

Os desenhos ficam em `web/src/components/cosmetics/packs.tsx`, no `PACK_ART` (um por pacote):

| Campo | O quê |
| --- | --- |
| `decoration` | SVG no quadro −50..50, em volta do avatar |
| `frame` | gradiente CSS cônico, recortado em anel no avatar e na borda do cartão de perfil |
| `background` + `backgroundArt` | CSS da faixa e um SVG por cima, como a lua, os raios ou o "BUM!" |
| `name` | gradiente do nome, escolhido para ser legível nos temas escuro e claro |
| `adornment` | SVG no quadro −10..10 |

`Decoration.tsx` usa o desenho do pacote quando o item tem `pack`, e os itens avulsos continuam com os desenhos de antes.

## Enfeite no nome do servidor

| | |
| --- | --- |
| **O que é** | Um ícone pequeno, do tamanho da letra (`1.15em`), logo depois do nick, alinhado ao texto (`.cn-adorn` em `index.css`). |
| **Onde aparece** | Lista de membros, chat, cartão de perfil (mini perfil), cartões de chamada, lista de quem está no canal de voz, inventário e loja. |
| **Componentes** | `Adornment` (um item), `NameAdornment` (o que uma conta equipou) e `CosmeticName`, que já desenhava a cor do nome e agora põe o enfeite como irmão do texto. Assim o nome continua cortando com reticências e o enfeite não entra no texto copiado (o nome acessível vai em `aria-label`). |
| **Estático e animado** | Cada enfeite pode ter partes animadas (classes `cn-anim-*`). Fica parado nas listas e no chat, onde aparecem muitos de uma vez. Anima só nos cartões de chamada (fora do modo compacto), no cartão de perfil e nas prévias. |
| **Acessibilidade e desempenho** | Configurações → Acessibilidade → **Enfeites no nome**: "Animados" (padrão), "Sempre parados" ou "Ocultos". Com animações reduzidas, nunca anima. A escolha é deste aparelho e vale só para o que a pessoa vê; os outros continuam vendo o enfeite dela. |

## Prévia antes de comprar ou equipar

Cada cartão de pacote na loja mostra um **perfil de prévia** (`ProfilePreview`) com as 5 peças juntas: fundo, moldura no avatar e na borda do cartão, decoração, cor do nome e enfeite. O botão de olho em cada peça mostra **só aquela peça combinada com o que a pessoa já usa**, para ver a mistura antes de comprar. Os blocos de itens avulsos e o inventário continuam com a prévia por item, que agora também desenha o enfeite e o fundo dos pacotes.

## Desempenho

- Só SVG e CSS: nenhuma imagem baixada, nenhum filtro (blur ou sombra) e nenhum `<animate>`. Um teste (`web/test/cosmetic-packs.test.ts`) confere isso em todas as peças.
- As animações usam só `transform` e `opacity`, que a placa de vídeo compõe sem refazer o layout.
- Nas listas de membros e no chat, decorações e enfeites ficam sempre parados.
- O que cada pessoa equipou continua vindo em lote (`/api/cosmetics?ids=`), só de quem aparece na tela.

## Arquivos alterados

- `shared/cosmetics.ts`: categoria `enfeite`, pacotes, preços e desconto.
- `server/src/community/commerce.ts`: `packs()` e `purchasePack()`.
- `server/src/community/economy.ts`: `packs()`, `buyPack()` e `equipPack()`.
- `server/src/community/routes.ts`: `GET /api/shop` com `packs`, `POST /api/shop/buy-pack`, `PUT /api/me/equipped/pack` e MFA da compra de pacote.
- `web/src/components/cosmetics/packs.tsx` (novo): os desenhos dos 11 pacotes.
- `web/src/components/cosmetics/ProfilePreview.tsx` (novo): a prévia de perfil.
- `web/src/components/cosmetics/Decoration.tsx`:
  - desenhos de pacote na decoração, na moldura, no fundo e na cor do nome;
  - `Adornment`, `NameAdornment`, `ProfileFrame` e `BackgroundArt`;
  - `CosmeticName` com o enfeite.
- `web/src/components/settings/PersonalizationSettings.tsx`: os cartões de pacote na loja, a seção "Pacotes" no inventário e a prévia do enfeite.
- `web/src/components/settings/SettingsScreen.tsx`: a opção "Enfeites no nome" em Acessibilidade.
- `web/src/lib/appearance.ts`: a preferência `adornments`.
- `web/src/lib/cosmetics.ts`: os pacotes na loja, `buyPack()` e `equipPack()`.
- `web/src/components/groups/GroupsPage.tsx`: o enfeite na lista do canal de voz. Na lista de membros ele já vem pelo `CosmeticName`.
- `web/src/components/room/CallGrid.tsx`: o enfeite nos cartões de chamada.
- `web/src/components/social/UserInteractions.tsx`: a moldura do pacote na borda do cartão de perfil, o desenho do fundo e o nome com cor e enfeite.
- `web/src/index.css`:
  - as classes `.cn-adorn`;
  - as animações `cn-anim-flap`, `-sway`, `-pulse` e `-rise`.
- Testes:
  - `server/test/cosmetic-packs.test.ts` (novo);
  - `web/test/cosmetic-packs.test.ts` (novo);
  - `e2e/pacotes.test.mjs` (novo).

## Como lançar um pacote novo

1. Em `shared/cosmetics.ts`, acrescente um item em `PACK_SPECS` com id, nome, descrição, raridade, paleta, regras visuais e o nome e a descrição das 5 peças. Os itens e os preços saem sozinhos.
2. Em `web/src/components/cosmetics/packs.tsx`, acrescente um `PackArt` com o mesmo id. Use só formas SVG, gradientes CSS e as classes `cn-anim-*`.
3. Rode os testes: o do servidor confere as 5 categorias e os ids únicos, e o da web confere que existe desenho para todo pacote e que ele é leve.

A loja, o inventário, as prévias e o enfeite no nome não precisam mudar.

**Extensões futuras.** Já suportados sem mudar o modelo:

- variações de cor por peça (`variants`);
- pacotes por tempo limitado (desativando as peças em `shop_settings`);
- presentear peças de pacote (os presentes funcionam por item).

Presentear o pacote inteiro precisaria de uma rota própria.
