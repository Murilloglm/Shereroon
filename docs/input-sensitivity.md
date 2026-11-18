# Sensibilidade de entrada do Cosmic Night

Implementada em Configurações → Voz e vídeo → Sensibilidade de Entrada, inclusive sem chamada ativa.

## Comportamento

- Isolamento de voz: RNNoise local, sem supressão ou ganho automático simultâneos do WebRTC. Mantém o cancelamento de eco quando escolhido pelo usuário.
- Estúdio: desativa supressão, cancelamento de eco, ganho automático e gate; mantém o ganho de envio escolhido. O gate em bypass não acrescenta atraso nem altera amostras.
- Personalizado: sensibilidade automática/manual, limiar de −80 a −10 dBFS RMS, IA/convencional/desligada, VAD, confiança, histerese, hold, release, ataque e pre-roll.
- As preferências ficam no armazenamento local do aparelho. Instalações existentes mantêm o processamento anterior até o usuário escolher um perfil ou ativar a sensibilidade.
- O medidor distingue entrada original da captura e sinal processado. O limiar atua após ganho e supressão.
- O mute continua independente do gate. A faixa publicada no LiveKit continua sendo a mesma ao mudar configurações e ao mutar/desmutar.
- Com sensibilidade ativa, o ganho automático do navegador é desativado para evitar que ele desloque o nível usado pelo limiar.
- O RNNoise fornece probabilidade de voz ao gate por MessageChannel entre AudioWorklets. Sem IA, o VAD usa uma estimativa acústica de energia, sem identificação semântica do locutor.

## Teste local

O botão solicita acesso ao microfone, mede o sinal e grava aproximadamente três segundos em memória. Não reproduz áudio enquanto captura. Encerra a captura antes de permitir ouvir original/processado; a reprodução usa volume reduzido e exige confirmação de uso de fones. Encerrar, fechar configurações e erros liberam faixas, nós e portas.

Durante uma chamada, é preciso desligar o microfone de envio para gravar o teste. Isso evita transmitir a comparação ou abrir duas capturas do mesmo aparelho. O medidor continua disponível com o microfone da chamada ligado.

## Validação realizada

- TypeScript e build de produção.
- Suíte completa: 260 testes de servidor e 186 testes de frontend.
- `e2e/input-sensitivity.test.mjs`: quatro cenários com Chrome e LiveKit local reais, usando WAV de fala sintetizada como fonte de microfone. Perfis, RNNoise carregado, restrições WebRTC, teste local, reprodução, persistência após reload, liberação de faixas, mute e reconexão em canal de voz. Chamada privada com segundo navegador e medição de áudio decodificado recebido.
- `e2e/call-presence.test.mjs`: regressão das chamadas com quatro contas, estados, transmissão, reconexão e sons de presença.
- `web/test/input-gate.test.ts`: pré-abertura, pausas, histerese, release, reset após mute, bypass sem alteração de amostras e sinais abaixo/acima do limiar.

### Medições determinísticas das amostras de teste

Fala em português sintetizada, normalizada para três intensidades, misturada com um fundo grave sintético e processada por RNNoise equilibrado + gate automático. Comparação alinhada pelo atraso do gate, contra o sinal já filtrado, não contra uma gravação humana de referência:

| Fala de entrada | Janelas com corte adicional pelo gate | Erro RMS normalizado adicional |
|---|---:|---:|
| −50 dBFS | 0,00% | 0,494% |
| −30 dBFS | 0,00% | 0,088% |
| −12 dBFS | 0,12% | 0,020% |

Uma janela é classificada como corte adicional quando o sinal filtrado supera −65 dBFS e o sinal após o gate cai abaixo de 20% da amplitude RMS correspondente. Isso é uma métrica de regressão, não uma garantia perceptual de todas as sílabas.

Na amostra de ventilador gerado e na de teclado mecânico gerado, o gate ficou aberto em 0% dos quadros. Na fala usada como aproximação de uma TV ao fundo, abriu em 77,9%: esse caso mostra uma limitação real, não deve ser apresentado como voz de fundo perfeitamente removida.

O pre-roll padrão acrescenta 40 ms. Com o RNNoise equilibrado (~20 ms existentes), o atraso algorítmico é aproximadamente 60 ms; com o modo Voz prioritária do supressor (~60 ms), aproximadamente 100 ms. Dispositivo, navegador, codec e rede acrescentam outros atrasos.

Não foi feita validação física com pessoas falando, teclado, ventilador ou TV reais nesta sessão, nem avaliação auditiva humana de distorção. As métricas e testes de mídia não demonstram identificação perfeita de uma voz principal ou separação de falantes simultâneos.

## Arquivos desta implementação

- Interface: `web/src/components/settings/InputSensitivity.tsx`, `SettingsScreen.tsx` e `web/src/components/room/CallSettings.tsx`.
- Preferências e teste: `web/src/lib/input-settings.ts`, `mic-test.ts` e `input-settings.test.ts`.
- Pipeline: `web/src/lib/mic.ts`, `session.ts`, `noise-control.ts` e `denoise.ts`.
- AudioWorklets: `web/public/worklets/input-gate.js`, `input-processor.js`, `denoiser.js` e `denoise-processor.js`.
- Validação: `web/test/input-gate.test.ts` e `e2e/input-sensitivity.test.mjs`.

Sem migração de banco ou publicação nesta alteração.
