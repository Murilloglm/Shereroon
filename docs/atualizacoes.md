# Atualização automática do Cosmic Night (Windows)

## Como funciona

- O aplicativo instalado usa o `electron-updater` com o instalador NSIS e procura versões na página de releases do GitHub (`Murilloglm/Shereroon`).
- As pré-versões (`preview-*`) são marcadas como *prerelease*. As cópias instaladas a partir delas olham para as pré-versões; as cópias oficiais, assinadas com certificado, olham só para a release marcada como *Latest*.
- Nada é baixado nem instalado sem a pessoa pedir. Ela vê a versão nova e as novidades e escolhe entre **Baixar atualização** e depois **Reiniciar e atualizar** ou **Instalar depois** (instala quando o aplicativo fecha).
- Durante uma chamada ou uma transmissão, reiniciar pede confirmação num diálogo do próprio app.
- **Procurar atualizações automaticamente** vem ligado: o app procura ao abrir e a cada 6 horas. A pessoa pode desligar, e a escolha fica em `atualizacoes.json`, na pasta de dados.
- A instalação é silenciosa e por usuário, sem pedir administrador. Usa a mesma pasta e o mesmo registro da instalação atual, então não cria uma segunda cópia. A pasta de dados (`%APPDATA%\ShareRoom`) não é tocada, e a conta, as preferências e as salas recentes continuam lá.

## Verificações antes de instalar

1. **SHA-512.** O arquivo baixado tem de bater com o SHA-512 do `latest.yml`. O `electron-updater` confere isso no download, e o app confere de novo logo antes de rodar o instalador.
2. **Assinatura Ed25519.** O `latest.yml` traz o campo `cosmicSignature`, que assina `(versão, nome do instalador, SHA-512)`. A assinatura é feita no GitHub Actions com a chave privada do secret `COSMIC_UPDATE_SIGNING_KEY`. A chave pública vai embutida no aplicativo, em `desktop/update-keys.json`.
3. **Certificado (só nas versões oficiais).** Nas versões assinadas com certificado, o `electron-updater` também confere no Windows se o autor do novo instalador (`publisherName`) é o mesmo.

Se uma das verificações falhar, o arquivo é apagado, a pessoa vê o motivo e nada é instalado. Uma cópia sem chave pública não instala atualização nenhuma.

## Chave de assinatura das atualizações

- A chave privada foi gerada nesta máquina e está em `%USERPROFILE%\.cosmicnight\chave-atualizacao.pem`, fora do repositório e com acesso só do seu usuário do Windows.
- **Faça um backup seguro dela**, por exemplo num gerenciador de senhas. Se a chave se perder, as cópias instaladas deixam de aceitar atualizações e todo mundo vai precisar de uma reinstalação manual.
- Para cadastrar a chave no GitHub, rode a partir da raiz do repositório:

  ```
  gh secret set COSMIC_UPDATE_SIGNING_KEY < "%USERPROFILE%\.cosmicnight\chave-atualizacao.pem"
  ```

  Também dá para cadastrar em Settings → Secrets and variables → Actions.
- Para trocar a chave:
  1. Rode `node desktop/scripts/update-signing.mjs gerar <novo-arquivo>`. Isso adiciona a nova chave pública sem remover a antiga.
  2. Publique uma versão ainda assinada com a chave antiga, para que as cópias instaladas passem a conhecer a nova chave.
  3. Troque o secret pela chave nova.
  4. Numa versão seguinte, remova a chave pública antiga.
- Os workflows falham se o secret estiver ausente ou se ele não corresponder a nenhuma chave pública de `update-keys.json`. Assim, uma release que nenhum aplicativo aceitaria nunca chega a ser publicada.

## Publicar uma versão com atualização

1. Suba a versão em `desktop/package.json` (formato X.Y.Z, sempre maior que a anterior; o app recusa versões mais antigas).
2. Rode o workflow **Pré-versão Windows sem assinatura** com a tag `preview-vX.Y.Z` e as novidades no campo *notes*.
3. O workflow:
   - compila o instalador;
   - assina o `latest.yml`;
   - calcula os SHA-256;
   - publica o instalador, o `.blockmap`, o `latest.yml`, o `SHA256SUMS.txt` e o relatório de assinaturas.

## Sobre o certificado de assinatura de código

As pré-versões não têm certificado. O Windows (SmartScreen e Smart App Control) pode alertar ou bloquear o instalador, e o SHA-256 não prova quem é o editor. A assinatura Ed25519 protege a atualização automática, mas não muda o que o Windows mostra para quem baixa pela primeira vez. Para isso é preciso um certificado de assinatura de código (Azure Trusted Signing, OV ou EV) e o workflow `desktop-release.yml`. As opções estão em `docs/windows-signing-options.md`.

## Testes

- `npm --prefix desktop test` cobre a verificação, a recusa, a troca de arquivo, a reutilização de assinatura, a falta de conexão, a instalação ao fechar e a assinatura do `latest.yml`.
- `npm --prefix desktop run test:update` é o teste real. Ele:
  - compila e instala duas versões de uma cópia de teste (outro nome e outra pasta);
  - confere o aviso de falta de conexão, a recusa de uma versão assinada com outra chave e a atualização 0.0.1 → 0.0.2 com reabertura automática;
  - confere que continua uma instalação só, que os dados são preservados e que nada pede administrador;
  - desinstala tudo no final.
- `e2e/atualizacoes.test.mjs` cobre a tela Configurações → Atualizações.
