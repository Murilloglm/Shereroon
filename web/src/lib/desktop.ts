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

export type UpdateState =
  | 'indisponivel'
  | 'ocioso'
  | 'verificando'
  | 'atualizado'
  | 'disponivel'
  | 'baixando'
  | 'conferindo'
  | 'pronta'
  | 'instalando'
  | 'recusada'
  | 'erro';

export interface UpdateStatus {
  state: UpdateState;
  /** Versões antigas do aplicativo não mandam os campos abaixo de `message`. */
  version?: string | null;
  percent?: number | null;
  message?: string | null;
  supported?: boolean;
  /** Por que esta cópia não se atualiza sozinha. */
  reason?: string | null;
  currentVersion?: string;
  autoCheck?: boolean;
  releaseName?: string | null;
  releaseDate?: string | null;
  /** Novidades em texto simples. */
  notes?: string;
  size?: number | null;
  transferred?: number | null;
  total?: number | null;
  bytesPerSecond?: number | null;
  installOnQuit?: boolean;
  lastCheck?: number | null;
  messageKind?: 'info' | 'erro' | 'offline' | null;
}

export interface RestartResult {
  ok: boolean;
  /** Em chamada ou transmitindo: a interface pergunta antes. */
  needsConfirm?: 'chamada' | 'transmissao';
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

export interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
  focused: boolean;
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
  /** Janela sem a barra do Windows (não existe em versões antigas do aplicativo, que têm a moldura padrão). */
  window?: {
    state(): Promise<WindowState | null>;
    minimize(): Promise<WindowState | null>;
    toggleMaximize(): Promise<WindowState | null>;
    close(): Promise<WindowState | null>;
    onState(listener: (state: WindowState) => void): () => void;
  };
  /** Convites abertos por link cosmicnight:// (não existe em versões antigas do aplicativo). */
  links?: {
    take(): Promise<{ kind: 'convite'; code: string } | null>;
    onLink(listener: () => void): () => void;
  };
  update: {
    status(): Promise<UpdateStatus | null>;
    check(): Promise<UpdateStatus>;
    /** Versões antigas do aplicativo: restart sem resposta e sem os métodos opcionais. */
    restart(confirmed?: boolean): Promise<RestartResult> | void;
    download?(): Promise<UpdateStatus>;
    later?(): Promise<UpdateStatus>;
    setAutoCheck?(on: boolean): Promise<UpdateStatus>;
    dismiss?(): Promise<UpdateStatus>;
    onStatus(listener: (status: UpdateStatus) => void): () => void;
  };
}

declare global {
  interface Window {
    shareroomDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' && window.shareroomDesktop?.config ? window.shareroomDesktop : null;
