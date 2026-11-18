# Administração Cosmic, promoções e presentes

A migração 7 é aditiva e roda automaticamente na inicialização. As tabelas de usuários, pontos, inventário, amizades e auditoria dos servidores continuam sendo usadas. Faça backup do PostgreSQL antes do deploy. Web e Windows consomem as mesmas rotas autenticadas; não existe credencial administrativa no frontend.

## Primeira conta oficial: Mg

O login `Mg` tem suporte a nomes de dois caracteres. O nome serve para localizar a conta; **a autorização fica vinculada ao ID interno em `global_permissions`**. Renomear o perfil ou criar um cargo com esse nome não concede privilégios. Não há promoção automática no cadastro ou no login.

Execute os comandos na raiz do projeto, no ambiente do backend com acesso ao banco correto. No Render, use um terminal com `DATABASE_URL` e `APP_SECRET` do serviço. Com PGlite, pare o servidor antes de abrir o mesmo diretório de dados pelo comando administrativo.

1. Localize a conta existente:

   ```powershell
   node server/scripts/bootstrap-admin.ts --lookup Mg
   ```

2. Configure `COSMIC_BOOTSTRAP_USER_ID` com o ID retornado e execute:

   ```powershell
   $env:COSMIC_BOOTSTRAP_USER_ID = 'ID_INTERNO_DA_CONTA'
   node server/scripts/bootstrap-admin.ts
   Remove-Item Env:COSMIC_BOOTSTRAP_USER_ID
   ```

   A senha atual é solicitada com entrada oculta e verificada com scrypt. Para execução sem terminal, injete `COSMIC_BOOTSTRAP_PASSWORD` pelo gerenciador de segredos, somente durante o comando. Não passe senha como argumento nem a coloque no histórico do shell.

   Em produção, o comando recusa migrações pendentes: a migração 7 deve ter sido aplicada pelo backend. A opção `--lookup` é sempre somente leitura e não aplica migrações. Em execução sem terminal, confirme também `COSMIC_BOOTSTRAP_CONFIRM_ID` com o mesmo ID. Para criar Mg em produção sem terminal, confirme explicitamente `COSMIC_BOOTSTRAP_CONFIRM_CREATE=Mg`.

3. Se a conta ainda não existir, use `node server/scripts/bootstrap-admin.ts --create-mg`. O comando cria **somente** Mg, pede uma senha e confirma seu ID. Se Mg já existir, a criação é recusada: use o ID dessa conta e a senha atual.
4. Faça login e abra **Configurações → Administração Cosmic**. Confirme a senha, adicione a chave TOTP no seu autenticador e informe os seis dígitos. Guarde os dez códigos de recuperação; eles são mostrados uma única vez.

O bootstrap só funciona enquanto não houver administradores globais. Tentativas posteriores são recusadas, mesmo que alguém configure novamente variáveis de inicialização. Novos administradores são concedidos pelo painel, por ID, com MFA, motivo, confirmação e auditoria. A conta principal não pode ser revogada pelo painel. As sessões do destinatário de uma alteração global são encerradas.

`APP_SECRET` também protege as chaves TOTP com AES-256-GCM. Preserve essa chave entre deploys e mantenha backup seguro dela. O banco guarda os códigos de recuperação somente como hashes. Não registre senhas, chaves TOTP, códigos de recuperação ou tokens em logs.

## MFA e recuperação

A confirmação do segundo fator vale **10 minutos por sessão**, é verificada no backend e não se transfere para outro login. Novas sessões preservam o cargo global e precisam confirmar MFA para operações sensíveis, salvo a dispensa explícita da conta principal descrita abaixo. Códigos TOTP já usados são recusados. Tentativas de MFA e de resgate têm limites por conta e IP no PostgreSQL, além do limitador em memória.

### Exceção exclusiva de Mg, solicitada pelo proprietário

A migração 8 acrescenta `global_permissions.mfa_exempt`, inicialmente **false para todas as contas**, e uma restrição que só permite ativá-la na conta principal já inicializada. A exceção não depende de nome de usuário ou nome de perfil e não é concedida a novos Cosmic Admins. Ela deve ser vinculada ao ID imutável de Mg no banco correto.

O operador executa `node server/scripts/owner-mfa.ts --exempt` com `DATABASE_URL`, `NODE_ENV=production` e estas variáveis temporárias injetadas pelo ambiente seguro:

- `COSMIC_OWNER_USER_ID`: ID da conta principal verificada.
- `COSMIC_OWNER_CONFIRM_ID`: o mesmo ID, conferido antes da operação.
- `COSMIC_OWNER_PASSWORD`: senha atual dessa conta, sem incluir na linha de comando ou no Git.
- `COSMIC_OWNER_REASON`: motivo autorizado, com pelo menos dez caracteres.

O procedimento exige a migração 8, valida a senha e confirma no banco que o ID é o da conta principal. Remove somente os fatores e códigos de recuperação dessa conta e registra `admin.mfa_dispensado` na auditoria. O login por senha e a validade normal das sessões continuam obrigatórios. Não são criadas provas artificiais de MFA em `sessions.admin_verified_until`; o backend consulta a política explícita da conta em cada autenticação.

O painel web identifica a dispensa do proprietário. Clientes Windows 0.3.3 continuam compatíveis: o endpoint de estado já informa o acesso autorizado, sem solicitar o código. Os demais administradores continuam usando TOTP por sessão. Nenhuma rota HTTP aceita conceder essa exceção, nem mesmo pelo painel global.

Para voltar a exigir MFA, o operador usa o mesmo procedimento com `--require`; a conta deverá cadastrar novamente o autenticador. A recuperação emergencial da senha não muda automaticamente essa política. A exceção não amplia o acesso a mensagens privadas de terceiros e mantém os logs e as confirmações das operações administrativas.

Com a senha e um código de recuperação, use **Perdi o autenticador** no painel: o código invalida o autenticador anterior e todos os códigos antigos, encerra todas as sessões e exige novo cadastro de MFA no próximo login.

Se também perdeu a senha ou os códigos, o operador responsável pelo banco pode executar `node server/scripts/recover-admin.ts`, fora da aplicação. Injete estas variáveis somente no processo de recuperação:

- `COSMIC_RECOVERY_USER_ID`: ID da conta principal já registrada.
- `COSMIC_RECOVERY_CONFIRM_ID`: o mesmo ID, conferido por um operador autorizado.
- `COSMIC_RECOVERY_NEW_PASSWORD`: nova senha, de 12 a 128 caracteres, pelo gerenciador de segredos.
- `COSMIC_RECOVERY_REASON`: motivo documentado com pelo menos dez caracteres.

O comando recusa contas que não sejam a principal, troca a senha por um hash scrypt, invalida todas as sessões e o MFA anterior e registra a recuperação. Reinicie o serviço para encerrar conexões em tempo real ainda abertas. Cadastre novamente o autenticador. Remova as variáveis temporárias ao terminar. O acesso ao terminal e ao banco é o limite de segurança deste procedimento; nunca publique uma rota equivalente.

## Permissões e auditoria

Cosmic Admin é uma permissão global separada dos cargos locais. Sua hierarquia é superior ao dono do servidor. O painel pesquisa servidores públicos e privados; entrar exige confirmação e motivo. A entrada cria um membro visível com `joined_via = cosmic_admin`, selo oficial e registros na auditoria local e global. Entradas com convite ou pela lista pública também recebem identificação oficial. Ações administrativas nos servidores também alimentam o log global; excluir um servidor preserva seu registro global.

Donos e administradores locais não podem punir, expulsar, banir, alterar os cargos locais ou retirar o privilégio global de um Cosmic Admin. Nenhuma permissão global amplia o acesso às conversas privadas entre outras contas. O painel não oferece endpoint para ler mensagens privadas.

O painel contém visão geral, usuários, servidores, permissões globais, códigos, pontos, loja, presentes, auditoria e configurações para pausar presentes ou promoções. Alterações exigem motivo e confirmação. Preços, disponibilidade e transferência dos desenhos já existentes podem ser alterados no painel; desenhos novos continuam sendo adicionados pelo catálogo compartilhado e pelo renderizador SVG existente.

## Pontos, códigos e presentes

- `unlimited_cosmetics` permite adquirir cosméticos sem débito e faz a interface mostrar **∞ Cosmic Points**. O saldo numérico real é preservado. Cada compra administrativa gera lançamento de valor zero e auditoria; itens de teste recebem `admin_grant` e não podem ser transferidos. Presentes administrativos seguem a mesma regra, sem gerar saldo para o destinatário.
- Ajustes de pontos usam ID interno, quantidade positiva ou negativa, motivo, confirmação e chave de operação. Não permitem saldo negativo, estouro de inteiro nem repetir um ajuste com a mesma chave.
- Códigos aceitam letras, números, ponto, hífen e sublinhado, sem distinção de maiúsculas. Os limites total e por conta, validade, estado ativo e revogação são verificados dentro da transação, com bloqueio do código e da conta. Cada pedido tem chave idempotente. Há suporte a pontos e itens cosméticos. Recompensas promocionais e ajustes administrativos não consomem os limites das missões diárias.
- Revogar é uma exclusão lógica: impede novos resgates, preserva o histórico e impede reutilizar o mesmo nome de código. Não retira recompensas já recebidas.
- Presentes exigem amizade aceita e ausência de bloqueios. A transação bloqueia as duas contas em ordem, verifica propriedade e preço confirmado, debita e entrega juntos, com chave idempotente. Itens do catálogo são únicos por conta. Transferências dependem da política do item, removem o item e o equipamento da origem e permitem uma nova compra posterior.
- O histórico persistente de presentes funciona como caixa de notificações para quem estava offline. Eventos em tempo real avisam quem está conectado.

## Validação

```powershell
npm.cmd run typecheck
npm.cmd run test -w server
npm.cmd run test -w web
npm.cmd run build
$env:E2E_HEADLESS = '1'
$env:E2E_API_PORT = '8797'
node --test e2e/platform.test.mjs
```

Os testes de backend usam PGlite com SQL PostgreSQL e as rotas HTTP reais. O teste visual usa banco isolado, conta administrativa de teste, navegador instalado e o build compartilhado com Windows. Não altera o banco local nem as contas reais.
