# Atualização automática do Cosmic Night (Windows)

## Como funciona

- O aplicativo instalado usa o `electron-updater` com o instalador NSIS e procura versões na página de releases do GitHub (`Murilloglm/Shereroon`).
- As pré-versões (tags `vX.Y.Z`; as primeiras usavam `preview-vX.Y.Z`) são marcadas como *prerelease*. As cópias instaladas a partir delas olham para as pré-versões; as cópias oficiais, assinadas com certificado, olham só para a release marcada como *Latest*.
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

## Versões: convenção do Cosmic Night

As versões continuam no formato SemVer (`X.Y.Z`), que é o que o instalador e o `electron-updater` entendem. A sequência é uma convenção própria de publicação: cada número de baixo vai de 0 a 9 e transporta para o de cima.

`0.3.0 → 0.3.1 → … → 0.3.9 → 0.4.0 → … → 0.4.9 → 0.5.0 → … → 0.9.9 → 1.0.0`

- A conta fica num lugar só: `desktop/scripts/versioning.mjs` (`nextVersion`, `compareVersions`, `nextReleaseVersion`, `checkPublishable`). As versões são comparadas número a número, nunca como texto ou decimal (`0.4.0 > 0.3.9`, `0.3.10 > 0.3.9`).
- A versão só sobe quando uma publicação começa, nunca a cada commit: `npm --prefix desktop run release:prepare` grava a próxima versão no `desktop/package.json` e no `package-lock.json`. Se a versão atual ainda não foi publicada, ela fica como está.
- Nenhuma versão publicada é reutilizada. O workflow confere as tags do GitHub (`vX.Y.Z` e as antigas `preview-vX.Y.Z`) e recusa versão já publicada ou menor que a última.
- A tag é sempre `v` + a versão do aplicativo. Instalador, `latest.yml`, release e atualização automática ficam na mesma versão.
- As cópias instaladas desde a 0.3.0 reconhecem as próximas versões: o `electron-updater` compara pelo SemVer, e cada passo da sequência é maior que o anterior (há teste para isso em `versioning.test.mjs`).

## Publicar uma versão com atualização

1. Rode `npm --prefix desktop run release:prepare` e faça o commit da versão nova.
2. Rode o workflow **Pré-versão Windows sem assinatura** com as novidades no campo *notes*. A tag `vX.Y.Z` sai da versão do aplicativo.
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
