/** Erro com código estável (para a interface) e mensagem em português (para a pessoa). */
export class ApiError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502 | 503;
  readonly code: string;

  constructor(status: ApiError['status'], code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
