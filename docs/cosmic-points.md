# Cosmic Points, loja e decorações

## O que são

Os Cosmic Points são uma moeda interna e gratuita, usada só para itens cosméticos. Eles não envolvem dinheiro real nem apostas e não viram valores. As regras ficam no servidor (`server/src/community/economy.ts`); a interface só mostra.

## Como se ganha

As regras ficam em `POINTS`, em `shared/cosmetics.ts`.

| Ação | Pontos | Limite |
| --- | --- | --- |
| Primeira vez no dia | 5 | 1 por dia |
| Primeira mensagem do dia num grupo (comandos de bot não contam) | 10 | 1 por dia |
| Chamada com pelo menos mais uma pessoa, usando o aplicativo | 3 a cada 5 min | 90 por dia |
| Tudo somado | | 150 por dia |

**Contra farm**
- A chamada só conta com outra pessoa no canal e se a conta usou o aplicativo nos últimos 10 minutos. O próprio aplicativo informa o uso (teclado, mouse ou toque), no máximo uma vez por minuto.
- Ficar parado, ou sozinho no canal, não rende pontos.
- Cada ganho tem uma chave única (`points_ledger.ref`). A mesma recompensa não conta duas vezes, nem com dois pedidos ao mesmo tempo.
- Os limites diários viram à meia-noite de Brasília.

## Gastos

- **Loja.** Comprar desconta o preço e entrega o item na mesma transação. O saldo nunca fica negativo (há uma restrição no banco), e o mesmo item não é comprado duas vezes.
- **Bots.** O bot **Destaques Cósmicos** cobra de quem usou o comando. A chave é a própria mensagem do comando, então nunca cobra duas vezes. A administração do grupo escolhe o custo de cada ação (0 = grátis). O bot só publica mensagens decoradas (destaque e efeitos): não dá cargos, permissões nem acesso a dados. Só mensagens de bot carregam o estilo de destaque, então pessoas não conseguem forjá-lo.

## Itens

O catálogo fica em `shared/cosmetics.ts`: decorações de avatar, molduras, fundos de perfil, cores de nome e enfeites no nome do servidor, com raridade e variações de cor. Há também **pacotes** temáticos com uma peça de cada categoria, comprados juntos com 25% de desconto ou peça por peça; veja [pacotes-cosmeticos.md](pacotes-cosmeticos.md). Para lançar um item avulso:

1. Acrescente-o ao `CATALOG`, com id, tipo, nome, descrição, preço, raridade e variações.
2. Se for uma decoração com desenho novo, acrescente o desenho em `drawing()`, em `web/src/components/cosmetics/Decoration.tsx`. São SVGs originais num quadro de −50 a 50, com o avatar no centro.

A loja e o inventário são genéricos e não precisam mudar.

**Desempenho.** As animações usam só `transform` e `opacity`. Elas rodam apenas onde o avatar é grande (cartões da chamada, cartão de perfil, prévias) e ficam paradas nas listas e no chat. Com "reduzir animações" não animam em lugar nenhum.

## Banco (migração 6)

- `users.points`: saldo, com `CHECK (points >= 0)`.
- `points_ledger`: cada ganho e gasto, com `ref` único por conta e o dia de Brasília.
- `user_items`: itens adquiridos.
- `user_equipped`: o que está equipado em cada espaço.

## Rota de desenvolvimento

`POST /api/dev/points` dá pontos à própria conta e existe só para os testes de ponta a ponta. Ela só é montada com `COSMIC_DEV_POINTS=1` **e** fora de produção (`NODE_ENV !== 'production'`). Um teste do servidor confere que ela não existe por padrão.
