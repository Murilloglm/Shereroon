import { describe, expect, it } from 'vitest';
import { ApiError } from './api.ts';

describe('erros do backend: tentar de novo ou desistir', () => {
  it('queda de rede, servidor acordando e LiveKit fora do ar valem nova tentativa', () => {
    expect(new ApiError('sem_conexao', 'x', 0).transient).toBe(true);
    expect(new ApiError('erro', 'x', 503).transient).toBe(true);
    expect(new ApiError('sfu_indisponivel', 'x', 502).transient).toBe(true);
  });

  it('credencial do LiveKit recusada não entra em laço de reconexão', () => {
    for (const code of ['sfu_autenticacao_recusada', 'sfu_chave_desconhecida', 'sfu_segredo_incorreto']) {
      expect(new ApiError(code, 'x', 502).transient).toBe(false);
    }
  });

  it('recusas definitivas continuam definitivas', () => {
    expect(new ApiError('expulso', 'x', 403).transient).toBe(false);
    expect(new ApiError('senha_incorreta', 'x', 401).transient).toBe(false);
  });
});
