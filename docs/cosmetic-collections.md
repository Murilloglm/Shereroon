# Cosmic Night 0.3.8 — coleções e efeitos de nome

Implementados **11 pacotes, com 55 cosméticos independentes**, na loja existente. Categoria **Loja → Coleções** e aba **Personalização → Efeitos de Nome**. Compra de coleção entrega somente os itens que faltam, em uma transação. Presentes de coleção seguem a mesma regra e têm replay idempotente. Os presentes avulsos e as transferências existentes continuam funcionando.

Os preços iniciais reutilizam Anel Aurora, Moldura Neon, Nebulosa e Nome Aurora. Efeitos de nome usam a referência de preço de Nome Aurora. Cada preço, disponibilidade e permissão de transferência continua editável em **Administração Cosmic → Loja e decorações**. Não há desconto ou preço definitivo novo para os pacotes: o total é calculado no backend com as configurações atuais.

## Artes utilizadas e extrações

Todas as 22 imagens de `enfeites/` foram examinadas antes das alterações. Foram utilizadas 12, sem modificar os originais. Os retângulos de recorte em pixels, hashes SHA-256, dimensões finais, máscaras e processamento ficam em `web/public/assets/cosmetics/<coleção>/metadata.json`. Não foi produzida arte substituta.

| Arquivo original em `enfeites/` | Elementos utilizados |
| --- | --- |
| `Conceito Cosmic Night_ Efeitos Cósmicos de Usuário.png` | As 11 faixas de efeitos, na biblioteca à direita, sem os nomes de exemplo. Todos os WebP são pixel a pixel idênticos a esses recortes. |
| `Grade de skins sci-fi neon em português-2.png` | Capas dos 11 pacotes, molduras horizontais de perfil, amostras de nome e emblemas; também avatares e banners de Omen, Jett, Raze, Tejo e Rush. |
| `Imagem do ChatGPT 18 de nov. de 2026, 22_41_58.png` | Decoração de avatar Fúria da Noite, com alpha original. |
| `Imagem do ChatGPT 18 de nov. de 2026, 22_42_03.png` | Decoração de avatar Fúria da Luz, com alpha original. |
| `Imagem do ChatGPT 18 de nov. de 2026, 22_42_08.png` | Decoração de avatar Madu Kaiden, com alpha original. |
| `Imagem do ChatGPT 18 de nov. de 2026, 22_42_13.png` | Decoração de avatar Rimuru, com alpha original. |
| `Pacote Fúria da Noite em Neon-1.png` | Banner de perfil Fúria da Noite. |
| `Pacote de Avatar Dragão Luminoso-3.png` | Banner de perfil Fúria da Luz. |
| `Pacote Neon do Gato Elétrico-5.png` | Banner de perfil Madu Kaiden. |
| `Pacote Cósmico de Slime Azul-7.png` | Banner de perfil Rimuru. |
| `Pacote de Cosméticos Neon Roxo da Clove-9.png` | Decoração de avatar e banner de Clove. |
| `Painel Neon_ Arsenal Elétrico Futurista-11.png` | Decoração de avatar e banner de Neon, sem orelhas, patas ou gato. |

Os arquivos `avatar-decoration.png`, `profile-frame.png`, `profile-banner.webp`, `username-effect.png`, `member-name-effect.webp`, `server-badge.png`, `cover.webp` e `metadata.json` existem em cada pasta. Os emblemas são recursos auxiliares, sem criar um sexto espaço de equipamento. A amostra `username-effect.png` documenta a referência; o nick real é texto com o gradiente da coleção, sem sobrepor as letras “Aa” da imagem.

As molduras horizontais da grade enquadram o nome no cartão de perfil, com `object-fit: contain`. As molduras quadradas alternativas nas folhas permanecem nos originais. Não há esticamento da arte para acompanhar a altura variável da bio. As máscaras das imagens compostas removem aberturas e áreas externas identificadas por posição; não há remoção global de pixels pretos. Os quatro avatares maiores foram reduzidos proporcionalmente para 512 px com Lanczos. PNG e WebP usam compressão sem perdas. Total das 77 imagens: **5.081.931 bytes**.

## Estado dos pacotes e tratamento artístico

| Pacote | Estado |
| --- | --- |
| Fúria da Noite | Cinco itens implementados; avatar com transparência original e banner dedicado. |
| Fúria da Luz | Cinco itens implementados; avatar com transparência original e banner dedicado. |
| Madu Kaiden | Cinco itens implementados; único pacote com gato elétrico. |
| Rimuru Tempest | Cinco itens implementados; avatar com transparência original e banner dedicado. |
| Clove | Cinco itens implementados; máscara espacial de avatar e banner dedicado. |
| Neon | Cinco itens implementados; máscara espacial de avatar e banner dedicado. |
| Omen | Cinco itens implementados; avatar, moldura, capa e banner limitados à resolução da grade. |
| Jett | Cinco itens implementados; avatar, moldura, capa e banner limitados à resolução da grade. |
| Raze | Cinco itens implementados; avatar, moldura, capa e banner limitados à resolução da grade. |
| Tejo | Cinco itens implementados; avatar, moldura, capa e banner limitados à resolução da grade. |
| Rush | Cinco itens implementados; avatar, moldura, capa e banner limitados à resolução da grade. |

Nenhum arquivo fornecido ficou inacessível. Todos os pacotes funcionam com as artes disponíveis. Para maior definição dos últimos cinco pacotes, ainda são necessários originais separados em alta resolução, principalmente `avatar-decoration.png`, `profile-frame.png`, `profile-banner.webp` e `cover.webp` de `omen/`, `jett/`, `raze/`, `tejo/` e `rush/`. Esses arquivos de alta resolução não estavam entre os fornecidos; as versões extraídas da grade não são apresentadas como tal. Clove e Neon podem receber refinamento artístico manual das bordas do avatar a partir de versões com alpha original. As molduras horizontais dos demais pacotes também ganhariam definição com exportações individuais. Isso não bloqueia compra, equipamento, sincronização ou uso atual.

## Persistência, sincronização e desempenho

O novo espaço `efeito-nome` usa `user_items` e `user_equipped`, cujo campo `slot` já é texto sem restrição enumerada. **Nenhuma migração nova é necessária**. As migrações existentes não foram alteradas por esta implementação. Contas, saldos, inventários e equipamentos anteriores são preservados.

Equipar e desequipar notificam as contas relacionadas em todos os servidores e as outras sessões da própria conta. O cliente mantém a imagem anterior enquanto busca a nova, descarta respostas antigas e atualiza os usuários observados após reconexão. Não há dependência de cargo, e administradores equipam normalmente. As novas compras administrativas preservam a política de MFA já existente.

Na lista, há uma imagem absoluta por linha, sem participação no layout, sem eventos de ponteiro e recortada nos limites da linha. Avatar, nome, cargos e status ficam acima. As linhas medidas mantiveram **48 px** nas janelas de 1440, 1100, 900 e 390 px. A lista de participantes que substitui a lateral durante chamadas também usa os efeitos, mantendo os controles e menus de voz. A animação altera apenas opacidade. `prefers-reduced-motion`, acessibilidade e o interruptor persistido na aba Efeitos de Nome desativam o movimento.

Uma medição local de rolagem com 200 linhas compara a mesma estrutura com e sem efeitos. Os tempos estão no relatório de validação; não são uma promessa de desempenho em outros computadores ou em produção.

## Verificação executada

- `python scripts/extract-cosmetics.py`: extração reproduzível, preservando os originais.
- `python scripts/verify-cosmetics.py`: 77 imagens válidas, alpha real nos avatares e molduras, hashes de 12 originais e igualdade de pixels dos 11 efeitos.
- `npm.cmd run typecheck`: servidor e frontend aprovados.
- `npm.cmd run build`: build Vite aprovado; permanece o aviso de chunk grande do projeto.
- `npm.cmd test`: **299 testes de servidor e 217 de frontend aprovados**.
- `npm.cmd --prefix desktop test`: **39 testes aprovados**.
- `node --test e2e/cosmetic-collections.test.mjs`: **11 testes aprovados**, incluindo compra de pacote e item, presentes, mistura de coleções, 11 efeitos em administrador, outra conta, apelido, cargo, offline, dois servidores, tamanhos de janela, movimento reduzido, resposta atrasada, 200 linhas, chamada real LiveKit e reinício do backend com banco em disco. O teste de voz usa microfone sintético do Chrome; a conexão e as duas contas são reais.
- Regressões de `personalizacao.test.mjs`, `platform.test.mjs` e `social.test.mjs`: **19 testes aprovados**, preservando os cosméticos e fluxos anteriores.
- **77 imagens carregadas no Chrome e 77 no Electron**, usando o protocolo do desktop e as restrições CSP reais. O desktop recebeu o MIME `image/webp`.
- Revisão visual das referências, recortes, loja, prévia Fúria da Noite, perfil com cinco coleções diferentes, lista de membros, usuários offline e inventário no Electron.

Evidências: `e2e/.artifacts/cosmetic-collections/validation.json`, `asset-validation.json`, PNGs de interface e os 11 recortes `member-<coleção>.png`. Manifesto de arquivos e resumo de entrega: [releases/0.3.8-cosmetics.json](releases/0.3.8-cosmetics.json).

## Preparação da versão

`desktop/scripts/versioning.mjs` consultou as tags e preparou a próxima versão disponível, **0.3.8**, sem reutilizar versões publicadas. A implementação parte da pasta de trabalho existente, mantendo as alterações locais anteriores. O instalador de revisão usa o canal preview existente e foi construído com `--publish never`.

O backend desta implementação precisa acompanhar a distribuição do novo cliente: os endpoints de coleções e o catálogo de 55 itens foram validados localmente. Nenhum backend de produção, site, tag, release, workflow ou instalador foi publicado ou instalado automaticamente.

O instalador final para revisão está em `desktop/release-preview/prepared-0.3.8-final/CosmicNight-Setup-0.3.8.exe`. A cópia anterior em `prepared-0.3.8/` foi preservada e foi substituída por esta revisão final, que também inclui os efeitos na lateral de voz. A revisão final usa o canal preview sem Authenticode, conforme a configuração existente; tamanho e SHA-256 estão no manifesto de entrega.

## Publica??o autorizada

Ap?s autoriza??o do usu?rio, o commit `6147e41b3e7e8f325a90d6b3ba22c9faa49f6e12` foi enviado ? `main`. O [workflow de pr?-vers?o](https://github.com/Murilloglm/Shereroon/actions/runs/44493294030) terminou com sucesso e publicou a [0.3.8](https://github.com/Murilloglm/Shereroon/releases/tag/v0.3.8) com seis assets. O instalador publicado tem **128.638.309 bytes** e SHA-256 `eff32ea5e4423409b8c08424dcab67f9d50e3bed04bbb92d75d7d8a11dfa86bb`. Todos os hashes foram conferidos ap?s baixar os arquivos p?blicos, e a assinatura Ed25519 foi validada com a chave p?blica do aplicativo. Authenticode continua `NotSigned`, conforme o canal de teste existente.

O backend observado ainda estava na **0.3.7**, commit `f5e84bc014ac049167035ef17212cdf72cb8eeab`. A publica??o do instalador n?o comprova o deploy do Render. A integra??o Render n?o est? conectada nesta sess?o e o host de navegador/controle nativo est? indispon?vel ap?s recupera??o. A implanta??o do backend exige conex?o ao Render ou deploy do commit da 0.3.8 no painel; n?o h? credencial ou deploy hook nos arquivos de ambiente autorizados. Nenhuma configura??o de produ??o ou dado do banco foi alterado diretamente. Evid?ncias da publica??o: [0.3.8-publication.json](releases/0.3.8-publication.json).
