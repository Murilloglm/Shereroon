# Supressão de ruído: o que mudou e por quê

## O problema relatado

Um amigo, num lugar barulhento, tinha a voz cortada pela supressão de ruído. A medição com voz real (`web/test/fixtures/voz.wav`) confirmou: com o ruído no nível da voz ou acima dele, a rede neural (RNNoise) confunde parte da fala com ruído e a apaga. Um trecho conta como "cortado" quando sai mais de 10 dB abaixo do original.

| Voz em relação ao ruído | Equilibrado (antes) | Forte (antes) |
| --- | --- | --- |
| 0 dB (mesmo nível) | 3–4% cortados | 6–7% cortados |
| −5 dB (ruído mais alto) | 10–11% cortados, voz −4 dB | 19–22% cortados, voz −5 dB |

O filtro misturava uma parte fixa do som original: nada no Forte e −24 dB no Equilibrado. Quando a rede errava, nada segurava a voz.

## A correção: proteção da voz

`web/public/worklets/denoiser.js`, classes `VoicePresence` e `Denoiser`:

1. **Presença de voz.** Usa a probabilidade de voz que o próprio RNNoise calcula, comparada com uma linha de base que acompanha o ruído nas pausas. Com barulho forte essa probabilidade cai muito mesmo com fala. Ela é suavizada, abre rápido, segura 80–120 ms depois da última sílaba e solta em ~70–100 ms. O começo e o fim das palavras não ficam de fora.
2. **Mistura conforme a voz.** Enquanto há fala, uma parte maior do original é mantida, então a voz nunca cai mais que o limite do modo. Nas pausas, o ruído cai o máximo do modo.
3. **Antecipação no modo "Voz prioritária".** Com ruído muito forte, a rede leva 50–70 ms para perceber que a fala começou. Segurando o áudio 40 ms a mais, a proteção já está ligada quando a primeira sílaba sai.

| Modo | Ruído nas pausas | Voz, no pior caso | Atraso |
| --- | --- | --- | --- |
| Desligado | sem filtro | original | 0 |
| Leve | até −12 dB | −3 dB | 20 ms |
| Equilibrado | até −24 dB | −6 dB | 20 ms |
| Forte | tudo o que a rede considera ruído | −9 dB | 20 ms |
| Voz prioritária | até −30 dB | −1,5 dB | 60 ms |

Resultado com o ruído mais alto que a voz (−5 dB):

| Ruído | Equilibrado | Forte | Voz prioritária |
| --- | --- | --- | --- |
| Ventilador | 10,2% → 3,6% cortados | 22,4% → 5,9% | 0,7% |
| Vozes ao fundo | 11,1% → 4,1% | 18,8% → 6,6% | 0,9% |
| Chiado | → 0,2% | → 0,7% | 0% |

Com ruído moderado, todos os modos continuam com a mesma redução de antes: ~12, ~23 e 30–38 dB nas pausas, sem cortes. Os testes ficam em `web/test/denoiser.test.ts`, no bloco "ambiente barulhento". Um deles compara o mesmo filtro com e sem a proteção, para provar que é ela que evita os cortes.

**Limite honesto.** Vozes de outras pessoas e TV ao fundo não somem por completo. Sons de voz sobrepostos são os mais difíceis de separar, e o filtro prefere manter a fala de quem usa o microfone a arriscar cortá-la.

## Outros pontos investigados

- **Gate de ruído.** Não há gate por nível no microfone: a "porta" do `MicPipeline` só abre e fecha ao mutar e desmutar, com rampa. O único lugar que podia cortar a voz era o filtro, e foi corrigido.
- **Processamento duplicado.** Com a supressão por IA ligada no microfone, a supressão comum do navegador é desligada (`noiseSuppression: false`), para a voz não ser filtrada duas vezes.
- **Ganho automático (AGC).** Continua ligado por padrão. Ele nivela a voz antes do filtro, e o filtro trata o ruído que sobe nas pausas. Dá para desligar em Configurações → Voz e vídeo.
- **Cancelamento de eco.** Ligado por padrão, necessário para quem usa caixas de som.
- **Ganho do microfone.** O volume de envio (0–100%) fica depois do filtro e não muda o que o filtro vê.
- **Limiares de detecção de fala.** O anel de quem fala acendia sempre que o nível passava de −36 dBFS. Com um ventilador alto e sem filtro, ficava aceso o tempo todo. Agora, se o próprio ruído de fundo (o menor nível dos últimos ~2 s) já passa desse limiar, os limiares sobem para ficar acima dele: +6 dB para acender e +3 dB para apagar. Acender continua instantâneo (`web/src/lib/speaking.ts`).
- **Latência.** 20 ms para montar o bloco de 10 ms e esperar o RNNoise; 60 ms no modo "Voz prioritária".
- **Comparação.** "Transmitir o original agora" troca na hora, sem estalo e com o mesmo atraso. "Gravar 5 s" grava o mesmo trecho nas duas versões para ouvir.
- **Medidores.** No painel da supressão: entrada, redução, ruído removido, voz detectada, voz protegida e CPU medida.

## Modelos considerados

| Modelo | Qualidade | Custo | Situação |
| --- | --- | --- | --- |
| **RNNoise** (em uso) | Bom com ruído constante (ventilador, chiado) e razoável com ruído variável | ~1% de um núcleo, 85 KB, 10 ms de quadro | Usado em todos os modos, agora com a proteção da voz |
| **DeepFilterNet 2/3** | Melhor com ruído variável (teclado, vozes, rua) e menos som "robótico" | Modelo de 2–8 MB, 5–15% de um núcleo a 48 kHz em WebAssembly, ~40 ms de antecipação própria | Candidato a motor opcional, carregado só quando escolhido; não entrou agora pelo custo de CPU durante jogos |
| **NSNet2** (ONNX) | Bom com ruído de escritório | ~4 MB, precisa de ONNX Runtime Web (~10 MB) | Não compensa sobre o DeepFilterNet |
| Supressão do navegador (WebRTC NS) | Leve, só ruído constante | Quase zero | Fica como opção sem IA, e como reserva quando o modelo não carrega |
| Krisp e equivalentes | Muito bons | Proprietários, licença paga | Fora de questão sem contrato |

O motor de IA continua carregado sob demanda: só baixa e só roda quando a supressão é ligada numa fonte.
