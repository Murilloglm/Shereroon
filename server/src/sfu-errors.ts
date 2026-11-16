import { ApiError } from './errors.ts';
import type { Sfu } from './sfu.ts';

/** Por que uma chamada ao LiveKit falhou. As três primeiras são recusas de credencial; a última, pane ou rede. */
export type SfuFailure = 'chave_desconhecida' | 'segredo_incorreto' | 'autenticacao_recusada' | 'indisponivel';

/**
 * O LiveKit responde 401 nos dois casos de credencial errada, mas com textos diferentes (medidos no
 * livekit-server 1.13 e no LiveKit Cloud): "invalid API key" quando não conhece a chave, e
 * "…signature is invalid" quando conhece a chave mas a assinatura não bate com o segredo dela.
 */
export function classifySfuError(error: unknown): SfuFailure {
  const upstream = (error ?? {}) as { status?: unknown; code?: unknown; message?: unknown };
  const refused =
    upstream.status === 401 || upstream.status === 403 || upstream.code === 'unauthenticated' || upstream.code === 'permission_denied';
  if (!refused) return 'indisponivel';
  const message = typeof upstream.message === 'string' ? upstream.message : '';
  if (/invalid api key/i.test(message)) return 'chave_desconhecida';
  if (/signature|cryptographic primitive/i.test(message)) return 'segredo_incorreto';
  return 'autenticacao_recusada';
}

const MESSAGES: Record<SfuFailure, string> = {
  chave_desconhecida:
    'O LiveKit não reconhece a API Key configurada no servidor. O administrador precisa conferir LIVEKIT_API_KEY e se ela é do mesmo projeto de LIVEKIT_URL.',
  segredo_incorreto:
    'O LiveKit reconhece a API Key, mas o segredo configurado não é o dela. O administrador precisa conferir LIVEKIT_API_SECRET.',
  autenticacao_recusada: 'O servidor de transmissão recusou a autenticação. O administrador precisa conferir a configuração do LiveKit.',
  indisponivel: 'O servidor de transmissão não respondeu. Tente de novo em instantes.',
};

/** Erro para a interface: código estável e mensagem em português, sem nada do que o LiveKit devolveu. */
export function sfuFailureError(failure: SfuFailure): ApiError {
  return new ApiError(502, `sfu_${failure}`, MESSAGES[failure]);
}

/** Linha para o log do servidor. Tokens que o LiveKit ecoa na mensagem de erro saem mascarados. */
export function describeSfuError(error: unknown): string {
  const upstream = (error ?? {}) as { status?: unknown; code?: unknown; message?: unknown };
  const message = String(upstream.message ?? error).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>').slice(0, 300);
  return `${classifySfuError(error)} (status ${upstream.status ?? '-'}, código ${upstream.code ?? '-'}): ${message}`;
}

/** Registra a falha e devolve o erro que vai para a interface. */
export function sfuError(error: unknown): ApiError {
  console.error('[sfu]', describeSfuError(error));
  return sfuFailureError(classifySfuError(error));
}

/** Uma chamada administrativa de leitura: null se o LiveKit aceitou as credenciais. */
export async function checkSfu(sfu: Sfu): Promise<SfuFailure | null> {
  try {
    await sfu.snapshot('shareroom-diagnostico');
    return null;
  } catch (error) {
    return classifySfuError(error);
  }
}
