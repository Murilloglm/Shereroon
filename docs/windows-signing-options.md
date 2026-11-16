# ShareRoom: assinatura, distribuição e diagnóstico no Windows 11

Consulta das fontes: **15/11/2026**. Valores em dólares americanos, sem conversão cambial, impostos, frete ou cobrança de CI. Confirme elegibilidade e preço final com o fornecedor antes de contratar.

## O que a assinatura resolve

Authenticode identifica o editor validado e permite detectar alterações posteriores no executável. A assinatura deve encadear até uma raiz de confiança reconhecida no Windows dos destinatários. Um certificado autogerado serve para desenvolvimento ou ambientes com confiança administrada; não cria confiança pública nos computadores dos amigos. SHA-256 permite comparar arquivos, mas não identifica sozinho o editor. [Microsoft: opções de assinatura](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

Há três decisões diferentes:

- **Smart App Control (SAC):** combina avaliação de segurança na nuvem com validação de assinatura. Se a avaliação for inconclusiva, código sem assinatura válida pode ser bloqueado. Uma assinatura não autoriza software considerado malicioso. [Microsoft: funcionamento do SAC](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions).
- **Microsoft Defender SmartScreen:** usa reputação. Mesmo com certificado público válido pode haver aviso nas primeiras versões. A Microsoft informa que EV também passa pela construção de reputação; não compre EV esperando eliminar imediatamente o aviso. [Microsoft: opções de assinatura](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).
- **App Control for Business (antigo WDAC):** aplica políticas do dispositivo/organização. Uma assinatura publicamente confiável pode continuar fora das regras permitidas. O administrador precisa avaliar o editor e os arquivos em relação à política vigente. Os logs identificam a política responsável. [Microsoft: diagnóstico de App Control](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/operations/appcontrol-debugging-and-troubleshooting).

## Opções e custos

| Caminho | Preço observado | Implicação para o ShareRoom |
|---|---|---|
| **GitHub Releases + certificado público IV/OV** | Exemplo SSL.com: **US$129/ano** para IV (pessoa física) ou OV (organização), antes do armazenamento da chave | Mantém o instalador NSIS atual. IV usa a identidade pessoal; OV exige a organização validada. Confirmar documentos e atendimento ao Brasil. [IV](https://www.ssl.com/products/software-integrity/code-signing/iv/), [OV](https://www.ssl.com/products/software-integrity/code-signing/ov/). |
| **Armazenamento da chave: token ou serviço remoto** | Nas páginas IV/OV, token anunciado como adicional de **US$379**. eSigner anuncia Tier 1 a **US$15/mês**, com 240 assinaturas na seleção exibida | São custos adicionais ao certificado. A página tem seletores mensal/anual; confirmar periodicidade da franquia, valor contratado, integração automática e frete ao Brasil no checkout. Há valores de token diferentes entre páginas do próprio fornecedor. [OV](https://www.ssl.com/products/software-integrity/code-signing/ov/), [eSigner](https://www.ssl.com/products/software-integrity/signing-service/). |
| **Certificado EV** | Exemplo SSL.com: **US$349/ano**, mais armazenamento/serviço | Validação ampliada. Não há necessidade de EV para um aplicativo comum de compartilhamento de tela em modo usuário; não garante ausência de avisos de reputação. [Fornecedor](https://www.ssl.com/products/software-integrity/code-signing/ev/). |
| **Azure Artifact Signing**, antigo Trusted Signing | Basic **US$9,99/mês**, 5.000 assinaturas/mês; Premium **US$99,99/mês**, 100.000; excedente **US$0,005/assinatura** | Serviço gerenciado com integração ao build. Usar perfil **Public Trust**. Private Trust e Test não dão confiança pública. [Tabela oficial de preços](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-change-sku). |
| **Microsoft Store com MSIX** | Assinatura do pacote pela Store **gratuita**; cadastro individual gratuito no fluxo atual | Alternativa a estudar, com empacotamento MSIX, certificação e teste do helper/captura/atualizações. Não transforma o NSIS atual em instalador assinado. [Assinatura na Store](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options), [cadastro individual](https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-individual-developer). |
| **Microsoft Store com EXE/MSI** | Ainda depende do certificado/serviço do editor | Nesse caminho, o editor assina o instalador e os arquivos PE; a Store não substitui essa etapa. [Requisitos por canal](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path). |
| **SignPath Foundation para código aberto** | Gratuito para projetos aprovados | Exige elegibilidade, licença aberta e revisão do projeto/processo. Não basta o app ser gratuito ou o repositório estar no GitHub. A identidade de assinatura é da fundação. [Programa](https://signpath.org/), [condições](https://signpath.org/terms). |

**Limitação do Azure no Brasil:** o quickstart atual aceita Public Trust para organizações nos EUA, Canadá, União Europeia, Reino Unido, Austrália, Nova Zelândia, Japão, Coreia do Sul, Singapura, Suíça, Noruega e Israel; para indivíduos, somente EUA/Canadá. **Brasil não aparece nessa lista.** A existência da região de hospedagem `Brazil South` não significa que uma pessoa ou empresa brasileira possa passar pela validação Public Trust. A página comparativa do Windows ainda mostra uma lista mais curta; use o quickstart específico do serviço e confirme o onboarding antes de pagar. Não use uma identidade/endereço que não corresponda ao editor real. [Elegibilidade e regiões oficiais](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart).

Certificados de assinatura pública atuais usam chave protegida em token/HSM ou serviço remoto; não presuma que a CA entregará um PFX exportável para colocar no GitHub. Escolha o provedor e a integração considerando essa restrição. [Requisitos de armazenamento SSL.com](https://www.ssl.com/products/software-integrity/code-signing/). O serviço Azure também exige assinatura Azure paga, sem suporte a planos free/trial/sponsored. [FAQ do Azure](https://learn.microsoft.com/en-us/azure/artifact-signing/faq).

Para manter downloads diretos no Brasil, uma opção prática é cotar **IV com assinatura remota** se o editor for pessoa física, ou **OV com assinatura remota** se for empresa. A alternativa sem compra de certificado para distribuição pela Store é avaliar MSIX. São decisões de contratação/canal; nenhuma delas já foi contratada ou publicada por este projeto.

## Diagnosticar o computador que bloqueou

A mensagem relatada é compatível com App Control, mas não prova, sozinha, qual política bloqueou. Colete os dados **no computador afetado**, no horário do erro, sem alterar proteções.

1. Anote o horário, caminho completo e hash do arquivo. No PowerShell:

   ```powershell
   $installer = 'C:\Users\SEU-USUARIO\Downloads\ShareRoom-Setup-0.1.0.exe'
   Get-FileHash -Algorithm SHA256 -LiteralPath $installer
   Get-AuthenticodeSignature -LiteralPath $installer |
     Format-List Status, StatusMessage, SignerCertificate, TimeStamperCertificate
   ```

2. Abra o **Visualizador de Eventos → Logs de Aplicativos e Serviços → Microsoft → Windows → CodeIntegrity → Operational**. Procure os eventos próximos ao bloqueio:

   | Evento | Interpretação |
   |---|---|
   | **3077** | Bloqueio aplicado por política em enforcement. |
   | **3076** | Auditoria: o arquivo seria bloqueado se a política fosse aplicada. |
   | **3089** | Informações da assinatura; `TotalSignatureCount = 0` indica arquivo sem assinatura. |
   | **3033** | Pode apontar assinatura revogada ou outro requisito de integridade; interpretar junto com o 3077 quando houver. |
   | **3099** | Carregamento de política; ajuda a identificar políticas ativas. |

   Compare o **Correlation ActivityID** na aba **Detalhes → XML** do 3077 com os 3089 correspondentes. Registre caminho do arquivo, processo que tentou carregá-lo, `PolicyID`, níveis de assinatura e erro de validação. Uma DLL, helper ou desinstalador pode ser a origem, mesmo quando o instalador principal está assinado. [Referência oficial dos eventos](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/operations/event-id-explanations).

3. Para consultar os eventos recentes sem mudar configuração:

   ```powershell
   Get-WinEvent -FilterHashtable @{
     LogName = 'Microsoft-Windows-CodeIntegrity/Operational'
     Id = 3033,3076,3077,3089,3099
     StartTime = (Get-Date).AddHours(-2)
   } | Select-Object TimeCreated, Id, ActivityId, Message | Format-List
   ```

   Se faltarem permissões de leitura, o administrador do computador pode executar a consulta. Exporte também os eventos originais em `.evtx` pelo Visualizador, preservando os detalhes XML para análise.

4. Em Windows 11 22H2 ou superior, liste as políticas disponíveis com o comando de **consulta**:

   ```powershell
   CiTool.exe -lp -json
   ```

   Relacione `PolicyID` e nome ao evento. Para SAC, os nomes documentados são `VerifiedAndReputableDesktop` (enforcement) e `VerifiedAndReputableDesktopEvaluation` (avaliação); confira se a política está aplicada. Também é possível **consultar** o estado em Segurança do Windows → Controle de aplicativos e navegador → Smart App Control. [CiTool](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/operations/citool-commands), [identificação do estado do SAC](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/test-your-app-with-smart-app-control).

5. Confira **Microsoft → Windows → AppLocker → MSI and Script** quando houver MSI/scripts/COM. Eventos **8028** são auditoria, **8029** enforcement e **8038** informações de assinatura correlatas. O fato de esse log se chamar AppLocker não significa, sozinho, que o bloqueio veio de uma política AppLocker: App Control também o utiliza. [Referência oficial](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/operations/event-id-explanations).

O SAC padrão em **avaliação** pode não produzir eventos de auditoria CodeIntegrity. Ausência de 3076 não prova que todos os binários seriam aceitos em enforcement. Faça o teste de aceitação em uma máquina/VM de Windows 11 com SAC já habilitado, instalando, iniciando o app, usando a captura de áudio e desinstalando. Todos esses caminhos podem carregar binários diferentes. [Microsoft: teste da assinatura e ressalva de avaliação](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/test-your-app-with-smart-app-control).

Se o evento apontar uma política corporativa, encaminhe os logs, hash, certificado/editor e versão ao administrador para a aprovação prevista pela organização. Se houver uma detecção equivocada de malware/reputação, use a análise oficial da Microsoft: [envio de arquivo para análise](https://www.microsoft.com/en-us/wdsi/filesubmission). Esse procedimento não promete liberação nem substitui assinatura.

Este diagnóstico não requer desativar Defender, SmartScreen, SAC ou políticas, adicionar exclusões, remover a marca de origem de Internet, instalar raízes autogeradas nos computadores dos amigos nem executar o arquivo por outro caminho para evitar o bloqueio.
