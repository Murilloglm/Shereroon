/**
 * Ponte com o aplicativo de Windows. No navegador, `desktop` é null e o site funciona como sempre.
 * Dentro do aplicativo, é por aqui que a interface usa o que o navegador não oferece: seletor próprio de
 * telas e janelas, componente de áudio embutido, bandeja do sistema e atualização.
 */

export interface DesktopSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** Miniatura atual da fonte (data URL), ou null se o sistema não entregou. */
  thumbnail: string | null;
  icon: string | null;
}

export type DesktopCommand = 'toggle-mic' | 'stop-share' | 'leave';

export interface UpdateStatus {
  state: 'indisponivel' | 'verificando' | 'atualizado' | 'baixando' | 'pronta' | 'erro';
  version: string | null;
  percent: number | null;
  message: string | null;
}

export interface DesktopRoomState {
  inRoom: boolean;
  sharing: boolean;
  micOn: boolean;
  roomName: string | null;
}

export interface AutostartState {
  enabled: boolean;
  minimized: boolean;
  /** Só no aplicativo instalado para Windows. */
  supported: boolean;
}

export interface DesktopBridge {
  config: {
    apiUrl: string;
    /** Endereço do site público, usado para montar links de convite que abrem em qualquer navegador. */
    siteUrl: string;
    /** Porta local do componente de áudio que o aplicativo iniciou, ou null se ele não existe nesta cópia. */
    helperPort: number | null;
    version: string;
    packaged: boolean;
  };
  listSources(): Promise<DesktopSource[]>;
  chooseSource(id: string): Promise<boolean>;
  setState(state: DesktopRoomState): void;
  onCommand(listener: (command: DesktopCommand) => void): () => void;
  /** Iniciar com o Windows (não existe em versões antigas do aplicativo). */
  autostart?: {
    get(): Promise<AutostartState | null>;
    set(state: { enabled: boolean; minimized: boolean }): Promise<AutostartState | null>;
  };
  /** Convites abertos por link cosmicnight:// (não existe em versões antigas do aplicativo). */
  links?: {
    take(): Promise<{ kind: 'convite'; code: string } | null>;
    onLink(listener: () => void): () => void;
  };
  update: {
    status(): Promise<UpdateStatus | null>;
    check(): Promise<UpdateStatus>;
    restart(): void;
    onStatus(listener: (status: UpdateStatus) => void): () => void;
  };
}

declare global {
  interface Window {
    shareroomDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' && window.shareroomDesktop?.config ? window.shareroomDesktop : null;
