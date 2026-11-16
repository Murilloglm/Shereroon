// Baixa (uma vez) e roda o servidor LiveKit local em modo de desenvolvimento.
// Uso:  npm run livekit            → só nesta máquina (127.0.0.1)
//       npm run livekit -- --lan   → acessível na rede local (para testar no celular)
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const LIVEKIT_VERSION = '1.13.11';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolsDir = join(root, 'tools', 'livekit');

function assetName() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  if (process.platform === 'win32') return `livekit_${LIVEKIT_VERSION}_windows_${arch}.zip`;
  if (process.platform === 'darwin') return `livekit_${LIVEKIT_VERSION}_darwin_${arch}.tar.gz`;
  return `livekit_${LIVEKIT_VERSION}_linux_${arch}.tar.gz`;
}

export function livekitBinaryPath() {
  return join(toolsDir, process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server');
}

export async function ensureLivekit() {
  const binary = livekitBinaryPath();
  if (existsSync(binary)) return binary;

  mkdirSync(toolsDir, { recursive: true });
  const asset = assetName();
  const url = `https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/${asset}`;
  const archive = join(toolsDir, asset);
  console.log(`Baixando LiveKit ${LIVEKIT_VERSION}…\n  ${url}`);

  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download falhou: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));

  // O tar que vem no Windows 10+ (bsdtar) também extrai .zip.
  const extract = spawnSync('tar', ['-xf', archive, '-C', toolsDir], { stdio: 'inherit' });
  rmSync(archive, { force: true });
  if (extract.status !== 0 || !existsSync(binary)) {
    throw new Error('Não consegui extrair o LiveKit. Baixe manualmente em https://github.com/livekit/livekit/releases');
  }
  console.log(`LiveKit instalado em ${binary}`);
  return binary;
}

export function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.')) return item.address;
    }
  }
  return null;
}

/** Argumentos do modo --dev: chave "devkey", segredo "secret", porta 7880. */
export function livekitArgs({ lan = false } = {}) {
  const args = ['--dev'];
  if (lan) {
    const address = lanAddress();
    args.push('--bind', '0.0.0.0');
    if (address) args.push('--node-ip', address);
  }
  return args;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const lan = process.argv.includes('--lan');
  const binary = await ensureLivekit();
  if (lan) console.log(`Modo rede local. Use LIVEKIT_URL=ws://${lanAddress() ?? 'SEU-IP'}:7880 no .env`);
  const child = spawn(binary, livekitArgs({ lan }), { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => child.kill());
}
