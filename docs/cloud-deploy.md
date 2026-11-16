# ShareRoom na nuvem, sem depender do PC

O caminho preparado usa **um serviço Render para a interface e a API**, mais um projeto **LiveKit Cloud**
para áudio, vídeo e transmissão. O computador do autor pode ficar desligado; cada participante usa seu
próprio dispositivo. O GitHub guarda o código e os instaladores, mas não executa esses serviços.

**Ainda não há um serviço público criado nesta preparação.** Para concluir é necessário acessar/criar
as contas Render e LiveKit Cloud, autorizar o repositório e fornecer credenciais reais. O login no GitHub
não fornece uma conta ou chave LiveKit. Não foram criadas contas nem contratados serviços nesta alteração.

## Quando puder conectar as contas

1. Entre no [LiveKit Cloud](https://cloud.livekit.io), crie um projeto e obtenha sua URL `wss://`, API Key
   e API Secret. Esses três valores vão somente para o backend no Render. Não use o servidor de
   desenvolvimento `ws://localhost:7880`, uma demonstração pública ou credenciais inventadas.
2. Abra [Deploy to Render — Murilloglm/Shereroon](https://render.com/deploy?repo=https://github.com/Murilloglm/Shereroon),
   conecte sua conta Render ao repositório e confira o Blueprint antes de criar o serviço.
3. Preencha `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` com os valores do projeto real.
   O Blueprint gera `APP_SECRET` e não cria banco de dados. Não altere essa chave a cada deploy:
   os convites dependem dela. O Render solicita os campos `sync: false` na criação inicial;
   credenciais acrescentadas depois devem ser cadastradas no Dashboard. [Blueprints](https://render.com/docs/blueprint-spec#prompting-for-secret-values).
4. Aguarde o build e anote a URL HTTPS efetivamente atribuída ao serviço. Ela será usada tanto para a
   interface quanto para a API. Não suponha que o nome do serviço escolhido será a URL final.
5. Abra essa URL e execute a validação abaixo antes de gerar outro instalador.

O Blueprint usa Node 24, compila `web/dist`, remove dependências de desenvolvimento e inicia o backend.
`SERVE_WEB=1`, `VITE_API_URL` vazio e caminhos relativos fazem a interface usar `/api` no mesmo endereço.
A API inclui a origem de `RENDER_EXTERNAL_URL` automaticamente; essa variável é fornecida pelo próprio
Render. Para um domínio personalizado ou outro site, cadastre a origem HTTPS adicional em
`ALLOWED_ORIGINS` no Dashboard. [Variáveis automáticas do Render](https://render.com/docs/environment-variables#render_external_url).

## Validar o serviço e distribuir o aplicativo

Abra `https://ENDERECO-REAL-DO-SERVICO/api/health`: a resposta esperada é `{"ok":true}`.
Isso comprova apenas que a API respondeu; não valida credenciais LiveKit nem a transmissão.

Abra em seguida `https://ENDERECO-REAL-DO-SERVICO/api/health/livekit`. Com `{"ok":true}`, o LiveKit
aceitou a chave e o segredo. Se vier erro, o campo `code` diz o que corrigir no Render (Environment):

| `code` | O que está errado |
| --- | --- |
| `sfu_chave_desconhecida` | `LIVEKIT_API_KEY` não existe no projeto de `LIVEKIT_URL` (valor errado, chave apagada ou de outro projeto). |
| `sfu_segredo_incorreto` | A chave existe, mas `LIVEKIT_API_SECRET` não é o segredo dela. |
| `sfu_autenticacao_recusada` | O LiveKit recusou sem dizer o motivo: gere um par novo. |
| `sfu_indisponivel` | O LiveKit não respondeu: confira `LIVEKIT_URL` e tente de novo. |

O segredo só aparece no LiveKit Cloud no momento em que a chave é criada. Para trocar: no projeto, em
**Settings → API keys**, crie uma chave nova, copie a *API Key* e o *API Secret* direto para o Render e
salve; o Render reimplanta sozinho. O mesmo diagnóstico aparece no log do deploy, na linha `LiveKit:`.

Crie uma sala, entre por outro dispositivo em outra rede e confira vídeo, microfone e áudio do
computador. Faça o teste com o PC do autor desligado e sem nenhum backend local em execução.

Depois de validar, use a URL real do Render nos dois campos do build Windows:

```text
SHAREROOM_API_URL=https://ENDERECO-REAL-DO-SERVICO
SHAREROOM_SITE_URL=https://ENDERECO-REAL-DO-SERVICO
```

No workflow de pré-versão, informe os mesmos valores nos campos de backend e site. Gere uma nova
tag `preview-...`; não substitua os bytes de uma versão já publicada. O instalador antigo com
`localhost:8787` não passa a usar a nuvem só porque o servidor foi criado.
Veja [o fluxo de releases Windows](windows-release.md) para a configuração de distribuição.
A hospedagem resolve a dependência do PC; o instalador de teste continua sem assinatura digital
e ainda pode ser bloqueado pelo Windows.

## Contas e grupos, se necessários

Sem `DATABASE_URL`, a produção oferece salas por link, mas não contas, grupos, histórico e bots.
Para habilitá-los, provisione PostgreSQL durável em um serviço escolhido e cadastre a URL de conexão
como segredo `DATABASE_URL` no Dashboard do Render. O servidor aplica as migrações ao iniciar.
Esse valor foi omitido do Blueprint para não exigir banco nem sobrescrever um segredo cadastrado depois.
O PGlite local é apenas para desenvolvimento e não é armazenamento de produção no Render.

## Limites dos planos gratuitos

O Render Free independe do PC, mas hiberna após 15 minutos sem tráfego e pode levar cerca de um minuto
para acordar. O sistema de arquivos é efêmero, há 750 horas gratuitas por workspace/mês e outras cotas;
bots não executam enquanto o processo estiver suspenso. O PostgreSQL Free do Render expira em 30 dias;
ele não é provisionado por este projeto. A própria Render recomenda planos pagos para produção contínua.
[Limites oficiais do Render](https://render.com/docs/free).

Na consulta de 15/11/2026, o LiveKit Cloud Build custa US$0/mês e inclui 5.000 minutos de participantes WebRTC,
100 conexões simultâneas e 50 GB de transferência para participantes. São cotas, não transmissão
ilimitada; 16 Mbps equivalem a cerca de 7,2 GB/h por espectador, antes de custos adicionais de protocolo.
Confirme o plano e o uso no painel antes de aumentar a audiência. [Preços oficiais do LiveKit](https://livekit.com/pricing).

Nenhum recurso com plano pago é provisionado pelo Blueprint. A criação das contas, o deploy real e o teste
de transmissão permanecem pendentes até você poder conectar os serviços.
