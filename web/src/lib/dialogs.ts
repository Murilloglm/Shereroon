/**
 * Diálogos do aplicativo (confirmar, excluir, aviso, erro e entrada de texto), no lugar das janelas nativas
 * do navegador. Cada chamada devolve uma Promise com a resposta para quem chamou. Os pedidos entram numa
 * fila e aparecem um de cada vez; quem desenha é o <DialogHost /> montado na raiz do app.
 */
import type { ReactNode } from 'react';
import { Store } from './store.ts';

export type DialogKind = 'confirmar' | 'excluir' | 'aviso' | 'erro' | 'sucesso' | 'entrada';

interface Base {
  title: string;
  message?: ReactNode;
}

export interface ConfirmOptions extends Base {
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'perigo' pinta o botão de vermelho (ação que tira algo de alguém, mas não é uma exclusão). */
  tone?: 'normal' | 'perigo';
  /** Executada dentro do diálogo, com indicador de carregamento. Se falhar, o erro aparece no diálogo. */
  action?: () => unknown;
}

export interface RemoveOptions extends Base {
  /** Nome do que será excluído, mostrado em destaque. */
  item: string;
  /** Não tem volta: pede para digitar o nome antes de liberar o botão. */
  irreversible?: boolean;
  confirmLabel?: string;
  action?: () => unknown;
}

export interface AlertOptions extends Base {
  kind?: 'aviso' | 'erro' | 'sucesso';
  /** Detalhes técnicos, escondidos até a pessoa pedir. */
  details?: string;
  buttonLabel?: string;
}

export interface PromptOptions extends Base {
  label: string;
  defaultValue?: string;
  placeholder?: string;
  maxLength?: number;
  /** Vazio não é aceito. */
  required?: boolean;
  /** Devolve a mensagem de erro, ou null quando o valor serve. */
  validate?: (value: string) => string | null;
  confirmLabel?: string;
  /** 'perigo' pinta o botão de vermelho (banir, por exemplo). */
  tone?: 'normal' | 'perigo';
  action?: (value: string) => unknown;
}

interface Opened {
  id: number;
  /** O que tinha o foco quando o diálogo foi pedido: o foco volta para ele ao fechar. */
  opener: HTMLElement | null;
}

export type DialogRequest = Opened &
  (
    | { kind: 'confirmar'; options: ConfirmOptions; resolve: (value: boolean) => void }
    | { kind: 'excluir'; options: RemoveOptions; resolve: (value: boolean) => void }
    | { kind: 'aviso' | 'erro' | 'sucesso'; options: AlertOptions; resolve: (value: undefined) => void }
    | { kind: 'entrada'; options: PromptOptions; resolve: (value: string | null) => void }
  );

export const dialogQueue = new Store<{ queue: DialogRequest[] }>({ queue: [] });

let nextId = 1;

function enqueue(request: Omit<DialogRequest, 'id' | 'opener'>): void {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  const opener = typeof HTMLElement !== 'undefined' && active instanceof HTMLElement ? active : null;
  dialogQueue.set((state) => ({ queue: [...state.queue, { ...request, id: nextId++, opener } as DialogRequest] }));
}

/** Tira o diálogo da fila e entrega a resposta a quem chamou (uma vez só). */
export function settle(id: number, value: unknown): void {
  const request = dialogQueue.get().queue.find((item) => item.id === id);
  if (!request) return;
  dialogQueue.set((state) => ({ queue: state.queue.filter((item) => item.id !== id) }));
  (request.resolve as (value: unknown) => void)(value);
}

export const dialogs = {
  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => enqueue({ kind: 'confirmar', options, resolve }));
  },
  /** Exclusão: ícone de alerta, nome do item e botão vermelho "Excluir". */
  remove(options: RemoveOptions): Promise<boolean> {
    return new Promise((resolve) => enqueue({ kind: 'excluir', options, resolve }));
  },
  alert(options: AlertOptions): Promise<void> {
    const kind = options.kind ?? 'aviso';
    return new Promise((resolve) => enqueue({ kind, options, resolve: () => resolve() }));
  },
  error(message: string, details?: string, title = 'Algo deu errado'): Promise<void> {
    return dialogs.alert({ kind: 'erro', title, message, details });
  },
  /** Entrada de texto. Resolve com o texto (já sem espaços nas pontas) ou null se cancelar. */
  prompt(options: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => enqueue({ kind: 'entrada', options, resolve }));
  },
};

/** Validação do campo de texto: obrigatório, tamanho e a regra de quem chamou. */
export function validatePrompt(options: PromptOptions, raw: string): string | null {
  const value = raw.trim();
  if (options.required && value.length === 0) return 'Preencha este campo.';
  if (options.maxLength !== undefined && value.length > options.maxLength) return `Use no máximo ${options.maxLength} caracteres.`;
  return options.validate?.(value) ?? null;
}

/** Exclusão irreversível: o nome digitado precisa bater (sem diferenciar maiúsculas nem espaços nas pontas). */
export function typedNameMatches(item: string, typed: string): boolean {
  return typed.trim().toLocaleLowerCase('pt-BR') === item.trim().toLocaleLowerCase('pt-BR');
}

/** Texto de um erro qualquer para mostrar no diálogo. */
export function errorMessage(error: unknown, fallback = 'Não foi possível concluir a ação.'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}
