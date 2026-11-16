// Abre o aplicativo em modo de desenvolvimento, usando web/dist e helper/bin deste repositório.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronDir = resolve(desktop, 'node_modules/electron');
const binary = resolve(electronDir, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

if (!existsSync(resolve(desktop, '../web/dist/index.html'))) {
  console.error('Falta a interface compilada. Rode "npm run build" na raiz do projeto.');
  process.exit(1);
}
if (!existsSync(electronDir)) {
  console.error('Faltam as dependências do aplicativo. Rode "npm install" dentro da pasta desktop.');
  process.exit(1);
}
// Algumas versões do npm não rodam o script que baixa o Electron; aqui ele é baixado na primeira vez.
if (!existsSync(binary)) {
  console.log('Baixando o Electron (só na primeira vez)…');
  spawnSync(process.execPath, [resolve(electronDir, 'install.js')], { stdio: 'inherit' });
}

// Terminais abertos por extensões do VS Code definem ELECTRON_RUN_AS_NODE, que faria o Electron rodar como
// Node puro em vez de abrir o aplicativo.
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
const child = spawn(binary, [desktop, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
