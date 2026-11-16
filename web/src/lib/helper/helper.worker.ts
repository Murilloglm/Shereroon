/// <reference lib="webworker" />
// Mantém a conexão com o app auxiliar fora da thread principal. Assim o áudio dos aplicativos continua
// fluindo mesmo quando a aba do ShareRoom está em segundo plano (você jogando em tela cheia, por exemplo):
// os blocos de áudio vão direto deste Worker para o AudioWorklet, sem depender da página.

type Command =
  | { type: 'port'; port: MessagePort }
  | { type: 'connect'; url: string }
  | { type: 'send'; text: string }
  | { type: 'close' };

let socket: WebSocket | null = null;
let audioPort: MessagePort | null = null;

function open(url: string): void {
  socket?.close();
  let connection: WebSocket;
  try {
    connection = new WebSocket(url);
  } catch {
    postMessage({ type: 'close', code: 1006, reason: 'bloqueado' });
    return;
  }
  connection.binaryType = 'arraybuffer';
  socket = connection;

  connection.onopen = () => {
    if (socket === connection) postMessage({ type: 'open' });
  };
  connection.onclose = (event) => {
    if (socket !== connection) return;
    socket = null;
    postMessage({ type: 'close', code: event.code, reason: event.reason });
  };
  connection.onmessage = (event) => {
    if (socket !== connection) return;
    if (typeof event.data === 'string') {
      postMessage({ type: 'text', text: event.data });
    } else if (audioPort) {
      // Transfere o bloco (sem copiar) para a thread de áudio.
      audioPort.postMessage(event.data, [event.data as ArrayBuffer]);
    }
  };
}

self.onmessage = (event: MessageEvent<Command>) => {
  const command = event.data;
  if (command.type === 'port') {
    audioPort = command.port;
  } else if (command.type === 'connect') {
    open(command.url);
  } else if (command.type === 'send') {
    if (socket?.readyState === WebSocket.OPEN) socket.send(command.text);
  } else if (command.type === 'close') {
    const current = socket;
    socket = null;
    current?.close();
  }
};
