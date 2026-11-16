# ShareRoom

Compartilhamento de tela em tempo real para assistir com amigos: salas privadas por link, sem cadastro e
sem instalar nada para quem assiste. Funciona no computador e dá para assistir pelo celular.

**Downloads oficiais para Windows:** [GitHub Releases](https://github.com/Murilloglm/Shereroon/releases).
O canal está configurado; o primeiro instalador oficial aguarda certificado de assinatura confiável e
backend/site públicos. Veja [como gerar e publicar uma release](docs/windows-release.md).

- **Frontend:** React + TypeScript + Vite + Tailwind (`web/`)
- **Backend de salas:** Node.js + Hono (`server/`) — emite os tokens temporários; não guarda nada
- **Transmissão:** WebRTC com SFU [LiveKit](https://livekit.io) (sinalização, vários espectadores, TURN)
- **Áudio por aplicativo (Windows):** app auxiliar nativo em C# (`helper/`), opcional

## Rodar no seu computador

Precisa de **Node.js 22.18 ou mais novo** e do Chrome ou Edge.

```bash
npm install
npm run dev
```

Abra <http://localhost:5173>. O `npm run dev` sobe três coisas: o LiveKit local (baixado automaticamente
para `tools/` na primeira vez), a API em `:8787` e o site em `:5173`. Para testar com duas pessoas na mesma
máquina, abra o link de convite numa janela anônima.

Para assistir pelo celular na mesma rede Wi‑Fi: `npm run dev -- --lan` e abra o endereço que aparecer no
terminal. Pelo celular dá para **assistir**; compartilhar a tela exige HTTPS ou `localhost` (regra do
navegador) e, em celulares, os navegadores não oferecem captura de tela.

## O que o site faz

| Recurso | Estado |
|---|---|
| Salas privadas por link, senha opcional, lotação máxima | Pronto e testado |
| Nome de usuário, lista de participantes, dono da sala | Pronto e testado |
| Expulsar participante e trancar a sala (só o dono) | Pronto e testado |
| Compartilhar monitor, janela ou aba, com áudio | Pronto e testado |
| Várias pessoas compartilhando na mesma sala | Pronto e testado |
| Microfone (liga/desliga, escolha do aparelho, volume) | Pronto e testado |
| Resolução 480p/720p/900p/1080p e 30/60/90/120 FPS, trocáveis ao vivo | Pronto e testado |
| Modo automático e modo manual com aviso "pedido × real" | Pronto e testado |
| Estatísticas reais (bitrate, FPS, perda, latência, codificador) | Pronto e testado |
| Tela cheia, modo cinema, janela flutuante | Pronto e testado |
| Reconexão automática (a captura continua viva e é republicada) | Pronto e testado |
| Mixer de áudio por aplicativo com perfis salvos | Pronto e testado (Windows) |
| Supressão de ruído por IA, no microfone e por aplicativo | Pronto e testado |
| Aplicativo para Windows (seletor próprio, áudio embutido, bandeja) | Pronto e testado; instalador gerado, não publicado |
| Grupos com canais de texto e de voz, contas, convites e tempo real | Pronto e testado |
| Cargos, permissões por canal, hierarquia e registro de auditoria | Pronto e testado |
| Layout de celular | Pronto e testado |

Nada é gravado nem armazenado: o vídeo passa pelo SFU e segue para quem está na sala. A captura só começa
depois que você escolhe a fonte no seletor do próprio navegador.

## Qualidade: o que foi medido de verdade

1080p a 120 FPS é uma meta, não uma garantia. Os números abaixo foram **medidos neste projeto**, no Chrome
157, Windows 11, Ryzen 9 7900, RTX 5060 Ti e monitor de 300 Hz, passando pelo LiveKit local:

| Fonte compartilhada | Captura real pedindo 120 FPS |
|---|---|
| **Aba do navegador** | **120 FPS** |
| Janela do próprio Chrome | 120 FPS |
| **Janela de outro programa (um jogo, por exemplo)** | **60 FPS** |
| **Tela inteira (monitor)** | **60 FPS** |

- **Um jogo compartilhado por janela ou por tela inteira vai a no máximo 60 FPS**, no Chrome e também no
  aplicativo de Windows (medido nos dois, com a janela de origem desenhando a 300 quadros por segundo).
  O limite vem do Windows 11 atual: a captura do sistema entrega 60 quadros por segundo a quem não pede
  mais, e o motor do Chrome não pede. 90 e 120 FPS só acontecem compartilhando uma aba do navegador.
- Em 1080p a 120 FPS (aba) o envio real foi de 1920×1004 a 120 FPS, com o codificador H.264 da placa de
  vídeo, chegando aos 16 Mbps do alvo em cerca de 18 segundos.
- O site avisa quando a captura fica presa em 60 e diz o motivo, em vez de mostrar 120.
- VP9 e AV1 também sustentaram 1080p a 120 FPS aqui, por software (mais uso de CPU).
- O site mostra sempre os valores medidos. Se o real ficar abaixo do pedido, ele diz o motivo com os números
  (captura, codificador, conexão ou banda ainda subindo).

Duas decisões que vieram dessas medições e estão no código:

- O navegador é impedido de reduzir a resolução por conta própria. Deixado à vontade, ele derrubava 1080p
  para cerca de 734p logo no início e não voltava. Quem reduz resolução ou FPS quando falta recurso é o modo
  automático, de forma visível.
- O navegador oferece ao SFU o perfil de H.264 que ele codifica pela placa de vídeo. Sem isso o Chrome caía
  no codificador por software, que não sustenta 1080p a 120 FPS.

Em outro computador os resultados podem ser diferentes; por isso o site mede em vez de prometer.

## Áudio por aplicativo (Windows 10/11)

O navegador sozinho só oferece o som da aba, da janela ou do sistema inteiro. Para escolher **app por app**
(só o VALORANT, depois ligar o Discord no meio da partida etc.), existe o app auxiliar **ShareRoom Áudio**,
que usa o recurso do Windows chamado *WASAPI Process Loopback*.

```bash
npm run build:helper        # gera helper/bin/ShareRoomAudio.exe (62 KB)
helper\bin\ShareRoomAudio.exe
```

Compila com o compilador de C# que já vem no Windows; não precisa instalar Visual Studio. Ele fica na
bandeja do sistema. No site: **Áudio do Sistema ▾ → Mixer por aplicativo**.

- Liga, desliga e muda o volume de cada app **com a transmissão no ar, sem reiniciar**.
- O volume vale só para a transmissão; o que você escuta no PC não muda.
- Perfis salvos (por exemplo "Jogar com call"); um app que fecha e abre de novo volta sozinho.
- A linha **Sistema** captura todos os sons do PC, menos o navegador da sala.

Segurança do auxiliar:

- Escuta só em `127.0.0.1`; outras máquinas da rede não o alcançam.
- Na primeira vez que um site tenta usá-lo, **ele pergunta numa janela do Windows** se você autoriza.
- Só captura os apps que você marcar, e para tudo quando o site desconecta.
- O navegador que está com a sala aberta nunca é capturado (seria eco). Para transmitir o som de um
  navegador, abra o ShareRoom em outro navegador.

Limitações conhecidas:

- O Windows captura a **árvore de processos**: marcar a Steam inclui os jogos abertos por ela. Pai e filho
  marcados juntos não duplicam o som.
- Com o site publicado em HTTPS, o Chrome pergunta uma vez se o site pode acessar apps/dispositivos da rede
  local. É preciso permitir. Isso foi verificado simulando uma origem pública; não num site publicado.
- O auxiliar compilado localmente não é assinado. A distribuição oficial deve assiná-lo junto com o app;
  sem assinatura confiável, o Windows 11 pode bloquear sua execução. Veja [assinatura e releases](docs/windows-release.md).

Para testar a captura neste PC: `helper\bin\ShareRoomAudio.exe --selftest` (dois tons bem baixos tocam por
uns 20 segundos e o programa confere o isolamento).

## Supressão de ruído por IA

Cada fonte pode ter o seu próprio filtro de ruído: o **microfone** e cada **aplicativo do mixer**. O filtro
é o modelo RNNoise (rede neural) compilado para WebAssembly, rodando num AudioWorklet **neste computador**.
Nenhum áudio é enviado a serviço externo para ser processado. Cada fonte é filtrada sozinha, antes de entrar
na mixagem.

Onde fica: o botão com o ícone de onda em cada linha do mixer, na linha do microfone e em
**Configurações → Microfone**. O painel tem liga/desliga, intensidade (Leve, Equilibrado, Forte), medição ao
vivo (redução, ruído removido, voz detectada, uso de CPU), comparação e o interruptor geral.

- **Nada vem ligado.** O filtro só entra com um clique seu, fonte por fonte.
- **Jogos, música e vídeo:** o painel avisa que o filtro foi feito para voz (pode abafar passos, tiros e
  instrumentos, e a saída fica em mono) e só libera depois de você confirmar. Nessas fontes a escolha não
  fica guardada ligada: a cada visita é preciso ligar de novo.
- **Discord e outros apps de chamada:** o painel avisa que eles costumam já filtrar a voz (Krisp). O site
  não consegue ver essa opção do Discord; a intensidade sugerida ali é Leve.
- **Microfone:** enquanto a IA estiver ligada, a supressão comum do navegador fica em pausa, para a voz não
  ser filtrada duas vezes.
- **Comparar:** "Transmitir o original agora" troca na hora o que a sala ouve (sem estalo, mesmo atraso), e
  "Gravar 4 s" deixa você ouvir o mesmo trecho com e sem filtro. A gravação fica só na memória da aba.
- **Interruptor geral:** desliga toda a supressão de uma vez.
- Trocar intensidade, ligar e desligar não reinicia a transmissão.
- Se o modelo não carregar, entra uma supressão convencional (no microfone, a do próprio navegador), e o
  painel diz qual está em uso.

Medido nos testes deste projeto, com uma voz em português e ruídos por cima. Redução do ruído nas pausas:

| Ruído | Leve | Equilibrado | Forte |
|---|---|---|---|
| Chiado | −11,7 dB | −22,5 dB | −32,3 dB |
| Ventilador | −11,8 dB | −22,9 dB | −37,7 dB |
| Ambiente | −11,6 dB | −22,2 dB | −33,7 dB |
| Teclado mecânico | −9,0 dB | −10,6 dB | −10,4 dB |

- **Voz:** o nível muda no máximo 0,4 dB e no máximo 0,7% dos trechos de fala perdem volume.
- **Atraso:** 20 ms a mais na fonte filtrada (959 amostras a 48 kHz).
- **CPU:** 0,11 ms para cada 10 ms de áudio (1,1% de um núcleo) no teste de unidade; no Chrome, o painel
  mediu 0,4% de um núcleo por filtro.
- **De ponta a ponta** (Chrome → LiveKit → Chrome): com voz e ventilador entrando como microfone, quem
  assiste mediu o ruído das pausas cair de −46 dB para −81 dB, com a voz de −27,5 dB para −28 dB. No mixer,
  o aplicativo com ruído caiu mais de 12 dB no modo Forte e cerca de 12 dB no Leve, e o aplicativo vizinho
  não mudou.

Limites, para não prometer o que não foi medido:

- A saída do filtro é **mono**. Para voz não faz diferença; para jogo e música, faz.
- Cliques de teclado caem só uns 10 dB, e um tom contínuo (bipe, apito) não é removido.
- A supressão convencional de reserva é bem mais fraca: −6,7 dB no mesmo teste do ventilador.
- A voz dos testes é sintetizada (voz do Windows) e os ruídos são gerados. Não houve teste com microfone
  e pessoa de verdade.
- No máximo 6 aplicativos filtrados ao mesmo tempo.

**RNNoise ou DeepFilterNet?** Ficou o RNNoise: 112 KB, quadros de 10 ms e custo baixo o bastante para rodar
dentro do próprio AudioWorklet. O DeepFilterNet promete voz mais limpa em ruído difícil, mas o modelo tem
vários megabytes, o atraso é maior e, para não travar o áudio, precisaria rodar num Worker ligado ao worklet
por memória compartilhada. Isso exige cabeçalhos de isolamento que o GitHub Pages não deixa configurar. Ele
não foi implementado nem medido aqui; faz mais sentido no aplicativo de desktop, como código nativo.

## Grupos, canais e cargos

Além das salas por link (que continuam sem cadastro), o ShareRoom tem **grupos permanentes**, no estilo de
servidores: entre em **Grupos** na página inicial.

- **Contas**: nome de usuário e senha. A senha é guardada só como resultado do scrypt, com sal por conta; a
  sessão é um código aleatório e no banco fica só o SHA‑256 dele. Tentativas de entrar são limitadas por
  endereço e por conta. Não há recuperação de senha por e‑mail.
- **Grupos**: nome, descrição e ícone; públicos (aparecem na busca) ou privados; entrada por convite com
  validade e limite de usos; participar de vários; passar o grupo para outra pessoa; excluir.
- **Canais**: texto, voz e categorias; criar, renomear, reorganizar, excluir; canais privados.
- **Mensagens em tempo real**: enviar, editar e apagar as próprias, fixar, `@everyone`, links; presença
  online; histórico em páginas.
- **Canais de voz**: clicar entra; microfone, volume de cada pessoa, quem está falando, várias telas ao
  mesmo tempo, com tudo o que as salas já têm (qualidade, mixer por aplicativo, supressão de ruído). A voz
  continua conectada enquanto você conversa nos canais de texto.
- **Cargos**: quantos quiser (até 250 por grupo), com cor e posição; modelos de Administrador, Moderador,
  VIP e Membro; duplicar; arrastar para reordenar; vários cargos por membro; `@everyone` configurável.
- **Permissões por canal**: Permitir, Negar ou Herdar, por cargo ou por membro, com herança da categoria.
- **Permissões efetivas**: o painel mostra o que cada membro pode fazer no grupo e em cada canal.
- **Registro de auditoria**: quem mudou cargos, permissões, canais e membros, com o antes e o depois.

**Quem decide é sempre o backend.** A interface só esconde o que você não pode usar; as regras estão em
`server/src/community/core.ts` e `shared/permissions.ts`, e foram testadas chamando a API direto:

- ninguém liga nem desliga, em cargo ou em regra de canal, uma permissão que não tem;
- ninguém entrega um cargo com permissões que não tem, nem a si mesmo;
- só se mexe em cargos abaixo do seu cargo mais alto, e só se pune quem está abaixo; ninguém age sobre o
  dono;
- canal que a pessoa não pode ver "não existe" para ela: não aparece, não responde e não envia eventos.

Onde cada permissão é aplicada:

| Aplicada pelo servidor | Aplicada só pelo aplicativo | Ainda sem efeito |
|---|---|---|
| Administração, texto, conectar, falar, transmitir, compartilhar áudio, silenciar, impedir de falar, mover, encerrar transmissão | Assistir transmissões; alta qualidade (acima de 720p30) | Anexar arquivos, ativar vídeo (câmera), prioridade de fala |

"Aplicada pelo servidor" na voz quer dizer que o token do LiveKit já sai limitado ao que a pessoa pode
publicar, e muda na hora se o cargo, a regra do canal ou um castigo mudarem. As duas da coluna do meio o
servidor de transmissão não consegue impor, então quem respeita é o aplicativo de quem assiste ou transmite.

**Banco de dados.** PostgreSQL. No uso local não é preciso instalar nada: sem `DATABASE_URL`, o servidor usa
o PGlite (o próprio PostgreSQL rodando dentro do Node) e guarda os dados em `server/.data`. Em produção,
defina `DATABASE_URL` com um PostgreSQL de verdade (Neon, Supabase, Render); as tabelas são criadas na
primeira subida. Sem banco, o servidor sobe do mesmo jeito e só as salas por link funcionam. O site continua
no GitHub Pages; o tempo real dos grupos usa WebSocket no mesmo backend (`/api/gateway`).

Limites, para não prometer o que não existe:

- Não há mensagens diretas, anexos, reações, busca, marcação de não lidas nem câmera.
- O tempo real vive na memória de uma instância do backend. Com mais de uma instância seria preciso um
  barramento comum (não foi feito).
- Excluir a conta e recuperar senha não existem.

## Aplicativo para Windows

O mesmo ShareRoom, instalado. A interface é a do site (o mesmo código), servida de dentro do aplicativo. O
que ele acrescenta é o que um navegador não deixa um site fazer:

| No aplicativo | No site |
|---|---|
| Seletor próprio de janelas e telas, com miniaturas | Seletor do navegador |
| Som do computador sem eco e mixer por aplicativo já embutidos | Precisa abrir o ShareRoom Áudio à parte e autorizar o site |
| Ícone na bandeja: microfone, parar a transmissão, sair da sala | Não tem |
| Fechar a janela numa sala não derruba a transmissão (fica na bandeja) | Fechar a aba encerra tudo |
| Medições e ajuste automático no ritmo normal com a janela coberta pelo jogo | O navegador desacelera abas em segundo plano |
| A tela não entra em descanso enquanto você transmite | Não tem |
| Atualização automática | Sempre a versão publicada |

O que **não** muda: janelas e telas continuam em no máximo 60 FPS (medido igual ao Chrome), e no aplicativo
não existe "aba do navegador", que é a única fonte de 120 FPS.

```bash
npm run build && npm run build:helper
npm install --prefix desktop
npm run desktop          # abre o aplicativo usando o backend local (npm run dev em outro terminal)
npm run desktop:dist     # preview local sem assinatura; pode ser bloqueado pelo Windows
```

O aplicativo precisa saber onde estão o backend e o site. São endereços públicos, definidos ao gerar o
instalador: `SHAREROOM_API_URL` (o mesmo `VITE_API_URL` do site) e `SHAREROOM_SITE_URL` (o endereço do site,
usado nos links de convite, que assim abrem em qualquer navegador). Sem eles, o aplicativo procura o backend
em `http://localhost:8787`. O backend aceita o aplicativo sem configuração extra.

**Publicar e atualizar.** Primeiro configure um certificado público/serviço de assinatura e as variáveis
descritas em [Windows: build e releases oficiais](docs/windows-release.md). Depois envie uma nova tag
`vX.Y.Z`. O workflow `desktop-release.yml` exige assinatura, verifica os executáveis e DLLs, gera SHA-256
e só então publica o Release. Também publica `latest.yml` e o blockmap das atualizações. O aplicativo
oficial confere a assinatura do editor e o SHA-512 da atualização antes de instalar. A execução manual
do workflow guarda artefatos assinados, sem publicar. Builds locais sem assinatura não recebem canal de atualização.

**Segurança do aplicativo.** A página roda isolada, sem acesso ao Node nem ao sistema, e só enxerga uma
ponte pequena (listar fontes, registrar a fonte escolhida, estado da sala, atualização). A janela não navega
para fora da interface, links externos abrem no navegador padrão e só as permissões necessárias são aceitas.
A captura só é liberada para a fonte que você acabou de escolher no seletor, uma vez. O componente de áudio
escuta em `127.0.0.1`, numa porta sorteada, e só aceita o próprio aplicativo. O executável final não pode
ser usado como Node comum nem aberto para depuração.

**Tauri ou Electron?** Ficou o Electron. O Tauri 2 usaria o WebView2 (o motor do Edge, que tem WebRTC e
captura de tela) e o instalador teria cerca de 10 MB em vez de 116 MB. Mas ele exige Rust e as ferramentas
de compilação da Microsoft, que não estão neste computador, então não foi possível compilá-lo nem medir
nada nele. O Electron traz o mesmo motor em que tudo aqui foi medido, deixa o aplicativo ter o próprio
seletor de fontes e foi testado de ponta a ponta. O preço é o tamanho: 116 MB de instalador, 360 MB
instalado.

Limites conhecidos:

- O instalador antigo `0.1.0` está sem assinatura. Não foi convertido em uma versão confiável por estas
  alterações: a próxima distribuição oficial exige certificado/serviço público e uma nova compilação.
  SmartScreen ainda pode mostrar avisos de reputação, e políticas corporativas têm regras próprias.
- Passar de 60 FPS em jogos exigiria um módulo nativo de captura próprio. Não foi feito.

## Publicar para os amigos (com HTTPS)

O GitHub Pages hospeda só o site (arquivos estáticos). Salas, transmissão e TURN ficam em serviços externos:

| Parte | Onde | Custo |
|---|---|---|
| Site (frontend) | GitHub Pages, publicado pelo GitHub Actions | Grátis |
| Backend de salas | [Render](https://render.com) (arquivo `render.yaml`) ou outro host de Node | Plano grátis |
| SFU, sinalização e TURN | [LiveKit Cloud](https://cloud.livekit.io) | Plano grátis com limites |

**1. LiveKit Cloud.** Crie um projeto e anote três valores: a URL (`wss://…livekit.cloud`), a *API Key* e
o *API Secret*.

**2. Envie o projeto para o GitHub.** Crie um repositório vazio em <https://github.com/new> e, nesta pasta:

```bash
git init -b main
git add .
git commit -m "ShareRoom"
git remote add origin https://github.com/SEU-USUARIO/NOME-DO-REPOSITORIO.git
git push -u origin main
```

O `.gitignore` já deixa de fora `node_modules`, `dist`, `.env`, os binários baixados e a pasta `imagens/`.

**3. Backend no Render.** *New → Blueprint* → escolha o repositório. Ele lê o `render.yaml` e pede:

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: os valores do passo 1
- `ALLOWED_ORIGINS`: `https://SEU-USUARIO.github.io` (só a origem, sem o nome do repositório)

Anote o endereço que o Render der (algo como `https://shareroom-api-xxxx.onrender.com`).

**4. GitHub Pages.** No repositório:

- **Settings → Pages → Build and deployment → Source: GitHub Actions**
- **Settings → Secrets and variables → Actions → Variables → New repository variable**:
  `VITE_API_URL` = o endereço do Render

Depois vá em **Actions → Publicar site no GitHub Pages → Run workflow** (ou faça um novo `git push`). O site
fica em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.

A partir daí, toda atualização é `git add .`, `git commit -m "…"` e `git push`.

**5. Confira a transmissão, não só o site.** O site abrir não prova que a transmissão funciona. Depois de
publicar:

1. Abra o site e crie uma sala. Se aparecer "Sem resposta do backend", confira `VITE_API_URL` e
   `ALLOWED_ORIGINS`.
2. Abra o convite em outro aparelho (de preferência em outra rede, como o 4G do celular).
3. Compartilhe uma janela e veja se a imagem e o som chegam do outro lado.
4. Veja no cartão de estatísticas se o FPS e o bitrate reais batem com o que você pediu.

O que saber sobre os serviços gratuitos:

- O Render gratuito "dorme" depois de um tempo sem uso; a primeira visita seguinte pode esperar perto de um
  minuto (o site mostra "Acordando o servidor"). Os links de convite **não se perdem** com isso: o convite é
  um código assinado e o backend não guarda nada.
- Uma transmissão a 16 Mbps consome cerca de 7 GB por hora **por espectador**. Confira os limites do plano
  gratuito do LiveKit Cloud; para uso pesado, um LiveKit próprio numa VPS evita a cota.

### Variáveis de ambiente

| Onde | Variável | Para quê |
|---|---|---|
| Backend | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Falar com o LiveKit. **Segredos: só no backend.** |
| Backend | `APP_SECRET` | Assina os convites. Se mudar, os links antigos param de valer. |
| Backend | `ALLOWED_ORIGINS` | Sites autorizados a chamar a API |
| Backend | `TRUST_PROXY=1` | Quando há um proxy na frente (Render, por exemplo) |
| Frontend (build) | `VITE_API_URL` | Endereço público do backend. Não é segredo. |
| Frontend (build) | `VITE_HELPER_DOWNLOAD_URL` | Opcional: link para baixar o app auxiliar |

Veja `.env.example` para o uso local. Nenhuma chave privada entra no frontend.

## Segurança

- **Acesso:** sem o link ninguém entra. O convite é assinado (HMAC‑SHA256); adulterar qualquer byte o
  invalida. Com senha, o backend limita tentativas por IP.
- **Tokens temporários:** o token de entrada vale 10 minutos; o LiveKit renova enquanto você está na sala.
- **Criptografia:** HTTPS/WSS na sinalização e DTLS‑SRTP na mídia (padrão do WebRTC). O SFU encaminha o
  vídeo, então ele o vê; não é criptografia de ponta a ponta.
- **Expulsão:** tira a pessoa e bloqueia a sessão dela. Sem contas, alguém determinado pode voltar com uma
  sessão nova se ainda tiver o link; para isso existe **Trancar a sala**.
- Bloqueio e expulsões valem enquanto a sala está em uso (e por 10 minutos depois que esvazia).

## Testes

```bash
npm run typecheck    # tipos do servidor e do site
npm test             # 187 testes de unidade (91 do servidor, 96 do site)
npm run build        # versão de produção em web/dist
npm run e2e          # ponta a ponta: abre o Chrome de verdade (janelas aparecem na tela)
```

Os testes de ponta a ponta usam o Chrome instalado, o LiveKit local e, para o mixer, o app auxiliar
(`npm run build:helper` antes). Eles capturam uma aba de teste de verdade e medem, no navegador do
convidado, os quadros de vídeo e as frequências do áudio recebido. Cobrem: sala com senha, vídeo e áudio
chegando, troca de qualidade ao vivo, expulsão, sala trancada, duas transmissões, microfone, celular,
reconexão após o SFU cair, o cenário "só o jogo → jogo + voz → só a voz" do mixer, e a supressão de ruído
(voz com ventilador entrando como microfone, e um aplicativo com ruído filtrado sozinho no mixer), e o
aplicativo de Windows (seletor, captura de janela, som do computador, bandeja, travas de navegação). Os
testes do aplicativo rodam também contra a versão empacotada, com
`SHAREROOM_APP_EXE=desktop\release\win-unpacked\ShareRoom.exe` e um pacote gerado com `SHAREROOM_TEST_BUILD=1`.

`E2E_HEADLESS=1` roda sem janelas, mas pula os testes de som (o Chrome sem janela não produz áudio).

## O que não foi verificado

- **O site publicado.** O workflow do GitHub Pages e o `render.yaml` estão escritos, e os comandos de
  instalação e início do backend foram testados numa cópia limpa, mas nada foi enviado ao GitHub, ao Render
  ou ao LiveKit Cloud (precisam das suas contas). Siga o passo 5 acima depois de publicar.
- **Instalar e atualizar o aplicativo.** O instalador foi gerado e o aplicativo empacotado foi testado, mas
  o instalador não foi executado neste PC, e a atualização automática nunca rodou de verdade (precisa de
  uma versão publicada no GitHub). O workflow de publicação também nunca rodou.
- **Jogos acima de 60 FPS.** Não é possível hoje por janela ou tela inteira, nem no site nem no aplicativo.
- **Outras máquinas e redes.** Todas as medições são deste PC e em rede local. Internet real tem perda e
  limite de upload.
- **Firefox e Safari.** Tudo foi testado no Chrome 157. O Edge usa o mesmo motor.
- **Assistir num celular de verdade.** O layout de celular foi testado simulando a tela no Chrome.
- **VALORANT em uma partida inteira.** O Windows aceitou capturar o VALORANT e o Discord reais
  separadamente (com o anti‑cheat rodando), mas o teste foi uma leitura de 2 segundos do nível de áudio, não
  uma sessão de jogo transmitida.

## Estrutura

```
web/        site (React)            web/public/worklets/  fila de áudio do mixer e filtro de ruído
server/     backend de salas        helper/               app auxiliar de áudio (C#)
e2e/        testes de ponta a ponta scripts/              sobe o ambiente local
desktop/    aplicativo de Windows (Electron)
shared/     permissões dos grupos (usadas pelo backend e pela interface)
.github/workflows/deploy.yml        publicação no GitHub Pages
render.yaml                         backend no Render
```
