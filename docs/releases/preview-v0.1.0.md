**Versão de teste sem assinatura digital — ShareRoom 0.1.0 para Windows x64.**

[Baixar ShareRoom-Setup-0.1.0.exe](https://github.com/Murilloglm/Shereroon/releases/download/preview-v0.1.0/ShareRoom-Setup-0.1.0.exe)

O Windows 11 pode bloquear o instalador ou seus componentes. Este download não garante instalação
ou execução em computadores com Smart App Control, App Control for Business ou SmartScreen.

**Esta compilação usa o backend local `http://localhost:8787`. Ainda não conecta amigos pela internet.**
O backend precisa estar em execução na mesma máquina para testar as salas. Nenhum site público foi
configurado para os convites, e este preview não recebe atualização automática.

SHA-256 do instalador recompilado:

```text
f84c5de136ed0c3c4909ce9542af8bf3a7cf486310fa9a8070f866e8094b9958  ShareRoom-Setup-0.1.0.exe
```

[Arquivos SHA-256](https://github.com/Murilloglm/Shereroon/releases/download/preview-v0.1.0/SHA256SUMS.txt)
e [relatório de assinaturas](https://github.com/Murilloglm/Shereroon/releases/download/preview-v0.1.0/signature-report.json).
A auditoria registrou 9 arquivos sem assinatura e 1 DLL com assinatura Microsoft válida. O instalador
tem status `NotSigned`. O SHA-256 confere os bytes; não identifica o editor nem substitui Authenticode.

Em caso de bloqueio, consulte [o diagnóstico pelos logs do Windows](https://github.com/Murilloglm/Shereroon/blob/preview-v0.1.0/docs/windows-signing-options.md).
Mantenha as proteções de segurança habilitadas. Uma distribuição com assinatura confiável dependerá
de certificado público ou aprovação de um serviço gratuito elegível.
