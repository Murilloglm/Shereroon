/**
 * Cliente do backend de salas. Em desenvolvimento e na auto-hospedagem a API fica na
 * mesma origem (/api). No GitHub Pages, VITE_API_URL aponta para o backend externo.
 * Esse endereço é público por natureza; nenhum segredo entra no frontend.
 */
import { desktop } from './desktop.ts';
import { latency } from './latency.ts';

// No aplicativo de Windows o endereço vem da configuração do próprio aplicativo.
export const API_BASE = (desktop?.config.apiUrl ?? import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }

  /** Falhas que valem uma nova tentativa (rede caiu, servidor acordando, SFU fora do ar). */
  get transient(): boolean {
    // O LiveKit recusou as credenciais do servidor: insistir não resolve, só o administrador corrige.
    if (this.code.startsWith('sfu_') && this.code !== 'sfu_indisponivel') return false;
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504 || this.status === 429;
  }
}

export interface RoomInfo {
  id: string;
  name: string;
  capacity: number;
  hasPassword: boolean;
}

export interface JoinGrant {
  token: string;
  url: string;
  identity: string;
  proof: string;
  isHost: boolean;
  room: RoomInfo;
}

const call = <T>(path: string, body?: unknown, timeoutMs = 20_000): Promise<T> =>
  request<T>(body === undefined ? 'GET' : 'POST', path, { body, timeoutMs });

/** Chamada ao backend. `token` é a sessão da conta (grupos); as salas por link não usam. */
export async function request<T>(
  method: string,
  path: string,
  { body, token, timeoutMs = 20_000, keepalive = false }: { body?: unknown; token?: string | null; timeoutMs?: number; keepalive?: boolean } = {},
): Promise<T> {
  const controller = new AbortController();
  const started = performance.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      credentials: 'omit',
      keepalive,
    });
    let data: unknown = null;
    try { data = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      if (response.ok) throw new ApiError('servidor_iniciando', 'O servidor ainda não devolveu uma resposta válida. Se ele estava em repouso, aguarde alguns segundos e tente novamente.', 503);
    }
    const operation = path.includes('/voice') ? 'voice' : path.includes('/messages') ? 'message' : 'api';
    latency.record(operation, 'api', performance.now() - started, `${method} ${response.status}`);
    for (const entry of response.headers.get('server-timing')?.split(',') ?? []) {
      const match = /^\s*([a-z_]+);dur=([\d.]+)/.exec(entry);
      if (match) latency.record(operation, `server_${match[1]}`, Number(match[2]));
    }
    if (!response.ok) {
      const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiError(error?.code ?? 'erro', error?.message ?? `O servidor respondeu com erro ${response.status}.`, response.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      'sem_conexao',
      controller.signal.aborted
        ? 'O servidor demorou demais para responder. Se ele estava em repouso, tente de novo em alguns segundos.'
        : 'Não foi possível falar com o servidor. Confira sua internet e tente de novo.',
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  /** Hospedagens gratuitas "dormem"; a primeira chamada pode levar perto de um minuto. */
  health: (timeoutMs = 70_000) => call<{ ok: true }>('/api/health', undefined, timeoutMs),

  createRoom: (input: { name: string; password?: string; capacity: number }) =>
    call<{ invite: string; hostKey: string; room: RoomInfo }>('/api/rooms', input),

  roomInfo: (invite: string) => call<{ room: RoomInfo }>('/api/rooms/info', { invite }),

  join: (input: {
    invite: string;
    name: string;
    password?: string;
    hostKey?: string;
    session?: { identity: string; proof: string };
  }, token?: string | null) => request<JoinGrant>('POST', '/api/rooms/join', { body: input, token }),

  kick: (invite: string, hostKey: string, identity: string) =>
    call<{ ok: true }>('/api/rooms/kick', { invite, hostKey, identity }),

  lock: (invite: string, hostKey: string, locked: boolean) =>
    call<{ ok: true; locked: boolean }>('/api/rooms/lock', { invite, hostKey, locked }),

  close: (invite: string, hostKey: string) => call<{ ok: true }>('/api/rooms/close', { invite, hostKey }),
};
