// Ponte entre a interface (página isolada, sem acesso ao Node) e o processo principal do aplicativo.
// Só o que está listado aqui existe para a página; tudo passa por mensagens que o processo principal valida.
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, listener) {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('shareroomDesktop', {
  /** Endereços e versão, lidos uma vez ao abrir. */
  config: ipcRenderer.sendSync('desktop:config'),

  /** Telas e janelas que podem ser compartilhadas, com miniatura. */
  listSources: () => ipcRenderer.invoke('capture:sources'),
  /** Registra a fonte que a pessoa acabou de escolher; a captura seguinte só é liberada para ela. */
  chooseSource: (id) => ipcRenderer.invoke('capture:choose', String(id)),

  /** Conta ao aplicativo o que está acontecendo na sala (para a bandeja e para não deixar a tela dormir). */
  setState: (state) => ipcRenderer.send('room:state', state),
  /** Comandos vindos do menu da bandeja. */
  onCommand: (listener) => subscribe('desktop:command', listener),

  /** Convites abertos por um link cosmicnight://. `take` devolve o pendente (uma vez só). */
  links: {
    take: () => ipcRenderer.invoke('desktop:take-link'),
    onLink: (listener) => subscribe('desktop:link', listener),
  },

  update: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    restart: () => ipcRenderer.send('update:restart'),
    onStatus: (listener) => subscribe('update:status', listener),
  },
});
