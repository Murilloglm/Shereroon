// "Iniciar o Cosmic Night com o Windows": a preferência fica num arquivo da pasta de dados do aplicativo e é
// aplicada na lista de programas que iniciam com o Windows do PRÓPRIO usuário (sem pedir administrador). Nunca
// é ligada sozinha: começa desligada e só muda quando a pessoa mexe no interruptor.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const HIDDEN_FLAG = '--minimizado';
const FILE = 'inicializacao.json';

/** Lê a preferência guardada (ou a padrão: desligada). */
export function readAutostart(userData) {
  try {
    const raw = JSON.parse(readFileSync(join(userData, FILE), 'utf8'));
    return { enabled: raw?.enabled === true, minimized: raw?.minimized === true };
  } catch {
    return { enabled: false, minimized: false };
  }
}

/** Valida o que a interface pediu (só booleanos) e devolve a nova preferência. */
export function cleanAutostart(input, current) {
  const next = { ...current };
  if (input && typeof input === 'object') {
    if (typeof input.enabled === 'boolean') next.enabled = input.enabled;
    if (typeof input.minimized === 'boolean') next.minimized = input.minimized;
  }
  return next;
}

export function writeAutostart(userData, state) {
  writeFileSync(join(userData, FILE), `${JSON.stringify({ enabled: state.enabled, minimized: state.minimized })}\n`);
}

/** Opções para app.setLoginItemSettings: o próprio executável, com a marca de "abrir escondido" se pedido. */
export function loginItemFor(state, execPath) {
  return { openAtLogin: state.enabled, path: execPath, args: state.minimized ? [HIDDEN_FLAG] : [] };
}
