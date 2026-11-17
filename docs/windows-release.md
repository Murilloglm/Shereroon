# ShareRoom: build Windows e releases oficiais

## Diagnóstico do instalador 0.1.0

O projeto usa **Electron 45.3.2 + electron-builder 26.18.0 + NSIS x64**. Não usa Tauri.
`npm run desktop:dist` compila a interface Vite, compila `ShareRoomAudio.exe` com o C# do .NET Framework
e empacota os dois com o runtime Electron. O helper entra por `extraResources`.

O instalador local analisado tem 122.151.881 bytes e SHA-256:

```text
1001be8dcf132fe632a6cb4caf2e70857bb9d07616f6c80039decf7424ecd9c3
```

`Get-AuthenticodeSignature` retornou **NotSigned** no instalador, `ShareRoom.exe`,
`ShareRoomAudio.exe`, `elevate.exe` e cinco DLLs. Apenas `d3dcompiler_47.dll` tinha assinatura Microsoft
válida e timestamp. São 10 arquivos analisados: **9 sem assinatura, 1 válido**.
O resultado completo está em [windows-signature-audit-0.1.0.json](windows-signature-audit-0.1.0.json).
Também extraímos os três EXEs do payload do instalador sem executá-lo: os hashes coincidem com
`win-unpacked`, e os três estão sem assinatura. O desinstalador embutido antigo não foi extraído/verificado.

A mensagem de política é compatível com SAC/App Control, mas não identifica qual política atuou.
O diagnóstico definitivo exige os eventos do PC afetado. Consulte
[opções, custos e diagnóstico dos logs](windows-signing-options.md).

## O que o build passa a exigir

- Preview: `npm run desktop:dist` continua disponível sem assinatura, mas agora exige destinos HTTPS públicos.
  Pode ser bloqueado; não é release oficial. O desenvolvimento local usa `npm run desktop` ou o comando `pack`.
- Oficial: `npm run desktop:dist:signed` exige provedor, identidade do editor e credencial; ao terminar
  o empacotamento, executa auditoria obrigatória e gera os hashes. Também exige URLs HTTPS de produção.
- `forceCodeSigning` impede fallback silencioso sem assinatura. DLLs e módulos `.node`, além dos EXEs,
  entram na assinatura. Os recursos e fuses são ajustados antes da assinatura final do Electron.
- O helper copiado, `elevate.exe`, o desinstalador NSIS e o instalador são assinados durante o empacotamento.
- O hook `preserve-uninstaller.cjs` guarda os bytes assinados do desinstalador em
  `release/signing-audit/ShareRoom-uninstaller.exe` antes de o NSIS apagar o temporário. Usa a API do
  packager da versão **26.18.0 fixada**; ao atualizar electron-builder, valide de novo a integração.
- A auditoria exige assinatura Windows `Valid`, timestamp e identidade esperada nos EXEs. Rejeita folha
  autogerada. DLLs válidas podem usar o editor do fornecedor. `Valid` no runner não comprova confiança
  pública: use certificado de CA reconhecida e teste também em Windows limpo, sem raízes adicionadas.
- Releases assinados mantêm `verifyUpdateCodeSignature: true` e o CN do certificado em `app-update.yml`.
  SHA-512 continua verificando os bytes da atualização. SHA-256 público é uma conferência adicional.

Não há certificado ou conta de assinatura fornecidos nesta pasta. Não foi criado certificado autogerado,
nem instalador apresentado como assinado, nem alteração no Defender ou nas políticas do Windows.

## Configuração no GitHub

O canal escolhido é **GitHub Releases**, em um repositório **público** chamado `Shereroon`.
Tanto o código quanto os instaladores ficarão visíveis publicamente; os amigos poderão baixar sem convite.
O projeto já foi enviado para [Murilloglm/Shereroon](https://github.com/Murilloglm/Shereroon), com o remoto
`origin` configurado e o workflow `.github/workflows/desktop-release.yml` ativo.
O canal de downloads é [GitHub Releases](https://github.com/Murilloglm/Shereroon/releases).
A [página de download](https://murilloglm.github.io/Shereroon/) usa esse canal, com botão direto para o EXE
e link SHA-256. O código está em `download-site/` e o deploy em `download-page.yml`. Essa página não
hospeda salas e não deve ser usada como `SHAREROOM_SITE_URL`; para convites, use o serviço do aplicativo.
Releases imutáveis estão habilitados e o token padrão do Actions usa permissões de leitura; o job de
publicação solicita a escrita necessária. A distribuição gratuita atual usa **pré-versões sem assinatura**,
com tags `vX.Y.Z` (as primeiras usavam `preview-vX.Y.Z`); elas não são versões oficiais assinadas e podem ser bloqueadas pelo Windows.
O workflow separado de GitHub Pages está desabilitado no repositório enquanto a hospedagem do app não
estiver configurada; o código dele foi preservado para uma implantação futura.
Para o canal de versões assinadas, configure Settings, variables e secrets no GitHub conforme as tabelas abaixo.
Não armazene chaves ou senhas no Git, no frontend ou nos artefatos.

### Distribuição gratuita imediata: pré-versões no GitHub Releases

O usuário escolheu este canal sem criar conta na Store ou contratar assinatura. O workflow manual
`.github/workflows/desktop-preview.yml` gera e publica uma **prerelease** com EXE, relatório de assinaturas,
`SHA256SUMS.txt` e `.exe.sha256`. A tag é `vX.Y.Z`, tirada da versão do aplicativo (veja a convenção em `docs/atualizacoes.md`); como é criada pelo
`GITHUB_TOKEN`, não aciona o workflow oficial `v*`. Não sobrescreve releases existentes, recusa versão já publicada
e não marca o preview como `latest` estável. O build mantém os fuses de segurança, sem habilitar ganchos de teste,
e recebe o canal de atualização automática das pré-versões.

`npm run desktop:dist:preview` gera `desktop/release-preview/ShareRoom-Setup-0.1.0.exe` depois de validar
`SHAREROOM_API_URL` e `SHAREROOM_SITE_URL` públicos. O relatório
`signature-report.json` registra `NotSigned`; os hashes só são gerados se ele corresponder aos bytes finais.
SHA-256 verifica os bytes e **não substitui a assinatura do editor**. A auditoria informa as assinaturas
ausentes; ela não aprova a instalação no Windows. Não desative proteções para executar o preview.

A primeira pré-versão já publicada, [preview-v0.1.0](https://github.com/Murilloglm/Shereroon/releases/tag/preview-v0.1.0),
usa `http://localhost:8787` e serve para teste local. Ela é imutável. As próximas compilações de distribuição
recusam `localhost`, endereços privados e ausência de servidor; não voltam silenciosamente ao PC do autor.
O workflow usa os inputs HTTPS ou as variables `VITE_API_URL`/`SHAREROOM_SITE_URL` do repositório. Para
implantar a API e o site na nuvem, siga [cloud-deploy.md](cloud-deploy.md). Esse serviço ainda não está ativo.
O pacote antigo `0.1.0` auditado no início foi preservado em outra pasta; o asset da pré-versão foi recompilado
e tem seu próprio SHA-256 na página do Release.

Em **Settings → Secrets and variables → Actions → Variables**, configure:

| Variável | Valor |
|---|---|
| `VITE_API_URL` | URL HTTPS do backend disponível para os amigos |
| `SHAREROOM_SITE_URL` | URL HTTPS do site; padrão: GitHub Pages do repositório |
| `SHAREROOM_SIGNING_PROVIDER` | `signtool` ou `azure` |
| `SHAREROOM_PUBLISHER_NAME` | **CN exato do certificado real**, que pode ser o nome pessoal/empresa; não invente `ShareRoom` se o certificado tem outro nome |
| `WINDOWS_SIGNING_RUNNER` | Opcional, label de runner Windows provisionado; padrão `windows-latest` |

### Certificado em token/HSM ou assinatura remota de outra CA

Escolha `signtool`. Há três métodos mutuamente exclusivos:

1. **Certificado no Windows:** defina `SHAREROOM_CERTIFICATE_SHA1` com o thumbprint de 40 caracteres
   e/ou `SHAREROOM_CERTIFICATE_SUBJECT` para selecionar o certificado com sua chave acessível pelo
   middleware do token/HSM. O thumbprint SHA-1 é só um identificador; a assinatura usa SHA-256.
   Token USB normalmente requer runner próprio. Não funciona apenas colocando o thumbprint de seu PC
   num runner GitHub hospedado. Proteja o runner e o acesso ao dispositivo/chave.
2. **Serviço remoto de CA:** implemente e versione um hook compatível com
   [CustomWindowsSign do electron-builder 26](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/).
   Configure `SHAREROOM_SIGN_HOOK=./scripts/assinatura-do-provedor.cjs` (relativo à pasta `desktop`).
   O hook recebe `configuration.path`, deve assinar esse arquivo **no lugar**, com SHA-256 e timestamp RFC 3161,
   e lançar erro se o provedor falhar. Integre o SDK/CLI e seus secrets na etapa de assinatura do workflow.
   O projeto fornece o ponto de integração; o adaptador específico depende do fornecedor contratado.
3. **PFX existente e apropriado:** somente se o certificado/chave puder ser usado legal e tecnicamente
   dessa forma, configure os secrets `WIN_CSC_LINK` (PFX em base64 ou referência aceita pelo builder)
   e `WIN_CSC_KEY_PASSWORD`. Isso não torna um PFX autogerado confiável. Certificados públicos novos
   normalmente exigem chave não exportável em hardware/serviço; não presuma que esse método estará disponível.

Opcional local: `SHAREROOM_TIMESTAMP_URL` muda o servidor RFC 3161 do signtool, cujo padrão é
`http://timestamp.digicert.com`. O serviço retorna token assinado criptograficamente. Adapte o workflow
se o fornecedor exigir outro servidor ou credenciais. O hook remoto controla seu próprio timestamp.

### Azure Artifact Signing (antigo Trusted Signing)

Antes de contratar, confirme [a elegibilidade do editor](windows-signing-options.md): Brasil ainda não
consta na lista Public Trust consultada. O suporte no projeto não altera essa restrição.

Escolha `azure` e configure as variables:

```text
SHAREROOM_AZURE_ENDPOINT=https://ENDPOINT-DA-REGIAO.codesigning.azure.net
SHAREROOM_AZURE_ACCOUNT=NOME-DA-CONTA-DE-ASSINATURA
SHAREROOM_AZURE_PROFILE=NOME-DO-PERFIL-PUBLIC-TRUST
```

Crie a identidade/app registration no Azure e atribua a função **Trusted Signing Certificate Profile Signer**
no perfil correto. Configure os secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.
Use identidade validada e perfil **Public Trust**; Private Trust/Test não substituem isso. O builder 26.18
usa `Invoke-TrustedSigning` com autenticação por variáveis do ambiente. O cliente/tenant/secret são passados
apenas à etapa de assinatura e não entram no pacote.

## Compilar e verificar localmente

Os exemplos usam PowerShell; o build não usa mais `-ExecutionPolicy Bypass`. Não altere a política de
execução para resolver um bloqueio do aplicativo.
Se o ambiente corporativo bloquear scripts de build, use um runner Windows autorizado/provisionado.
No Windows, `npm.cmd` evita a escolha acidental do wrapper `npm.ps1`.

```powershell
npm.cmd ci
npm.cmd --prefix desktop ci
$env:SHAREROOM_REPO = 'SEU-USUARIO/SEU-REPOSITORIO'
$env:SHAREROOM_API_URL = 'https://SEU-BACKEND'
$env:SHAREROOM_SITE_URL = 'https://SEU-SITE'
$env:SHAREROOM_SIGNING_PROVIDER = 'signtool'
$env:SHAREROOM_PUBLISHER_NAME = 'CN EXATO DO EDITOR VALIDADO'
$env:SHAREROOM_CERTIFICATE_SHA1 = 'THUMBPRINT-REAL-DE-40-CARACTERES-SEM-ESPACOS'
npm.cmd run desktop:dist:signed
# O comando já executa auditoria e hashes. Para repetir a auditoria manualmente:
./desktop/scripts/audit-signatures.ps1 -RequireValid `
  -ExpectedPublisher $env:SHAREROOM_PUBLISHER_NAME `
  -ReportPath desktop/release/signature-report.json
# Para recalcular os hashes depois de uma auditoria aprovada:
npm.cmd --prefix desktop run checksums
```

`-RequireValid` rejeita ausência de assinatura, timestamp, helper, DLLs válidas, evidência do desinstalador
ou divergência do editor. A pasta deve conter exatamente um instalador; faça builds de versões distintas
em pastas de trabalho limpas para não misturar instaladores antigos. Não distribua `win-unpacked` nem
o EXE da pasta `signing-audit` como alternativa ao instalador.

## Publicação e teste final

1. No repositório já criado, configure as variables/secrets e faça uma execução manual do workflow.
   Ela gera artefatos assinados e **não publica** Release.
2. Teste o instalador em Windows 11 limpo com SAC habilitado: instalação, abertura, áudio/captura,
   atualização a partir de uma versão oficial anterior e desinstalação. Consulte os logs se houver bloqueio.
   Esse teste com certificado real ainda está pendente.
3. Depois de validar, use **uma nova versão**, por exemplo `v0.1.1`, em vez de substituir o `0.1.0` antigo:

   ```powershell
   git tag v0.1.1
   git push origin v0.1.1
   ```

4. O push da tag estável `vX.Y.Z` aciona build com permissões de leitura e os testes. A versão do desktop
   vem da tag. A assinatura real ocorre antes de calcular os hashes e gerar os metadados finais do updater.
5. Depois da auditoria, outro job recebe apenas os assets verificados, reconfere SHA-256, cria um **draft**,
   envia todos os arquivos e só então torna o Release público. Esse job tem `contents: write`.
   Release já existente para a mesma tag é recusado; não há sobrescrita de instaladores.

Assets oficiais: `ShareRoom-Setup-VERSAO.exe`, `.exe.blockmap`, `latest.yml`, `SHA256SUMS.txt`,
`.exe.sha256` e `signature-report.json`. Compartilhe a URL HTTPS **do seu repositório oficial**:

```text
https://github.com/Murilloglm/Shereroon/releases/latest
```

Para conferir o download: `Get-FileHash -Algorithm SHA256 -LiteralPath .\ShareRoom-Setup-0.1.1.exe`
e compare com `SHA256SUMS.txt` da mesma versão. Verifique também `Get-AuthenticodeSignature`.
Hashes publicados ao lado do download não substituem Authenticode.

O site legado em `sites/shareroom-download` ainda contém o instalador de teste `0.1.0` sem assinatura.
Não foi republicado. Use Releases como fonte oficial; a configuração de backend HTTPS é também necessária
para conectar amigos pela internet, independentemente da assinatura.

## Validação realizada nesta correção

- Typecheck de servidor e interface aprovado.
- Testes: 120 do servidor, 96 da interface e 5 do fluxo Windows aprovados. Duas fixtures de bots foram
  isoladas para corrigir falhas preexistentes que impediam a suíte exigida pelo workflow.
- YAML, sintaxe PowerShell do workflow e configuração assinada contra o schema electron-builder aprovados.
- Empacotamento `--dir` de preview concluído em `desktop/release/validation`, sem sobrescrever o instalador antigo.
- Tentativa de `dist:signed` sem provedor/credenciais recusada antes do empacotamento, como esperado.
- Auditoria normal registrou os arquivos antigos; a auditoria `-RequireValid` os rejeitou.
- SHA-256 do instalador antigo conferido novamente após as alterações e permaneceu igual.

O código-fonte e o workflow foram enviados ao GitHub. Não foi realizada assinatura de produção,
execução do build oficial de Windows no GitHub ou instalação com certificado confiável em outro PC.
Essas validações dependem das URLs de produção e da identidade/certificado contratados.
