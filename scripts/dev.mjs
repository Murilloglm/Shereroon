// Sobe tudo o que o desenvolvimento local precisa: LiveKit, API e frontend.
// Uso:  npm run dev            → tudo em localhost
//       npm run dev -- --lan   → também acessível pela rede local
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureLivekit, lanAddress, livekitArgs } from './livekit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lan = process.argv.includes('--lan');
const children = [];

function run(label, command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  const prefix = `[${label}] `;
  const forward = (stream) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) console.log(prefix + line);
    });
  forward(child.stdout);
  forward(child.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}encerrou (código ${code}).`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const livekit = await ensureLivekit();
const env = { ...process.env };
if (lan) {
  const address = lanAddress();
  if (address) {
    env.LIVEKIT_URL ??= `ws://${address}:7880`;
    env.ALLOWED_ORIGINS ??= `http://localhost:5173,http://${address}:5173`;
    console.log(`Rede local: abra http://${address}:5173 nos outros aparelhos (só para ASSISTIR — compartilhar exige HTTPS ou localhost).`);
  }
}

run('livekit', livekit, livekitArgs({ lan }));
run('api', process.execPath, ['--watch', 'src/node.ts'], { cwd: resolve(root, 'server'), env });
run('web', process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), ...(lan ? ['--host'] : [])], {
  cwd: resolve(root, 'web'),
  env,
});
