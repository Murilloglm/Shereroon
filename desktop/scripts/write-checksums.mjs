import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function writeChecksums(releaseDir) {
  const names = await readdir(releaseDir);
  const installers = names.filter(name => /^ShareRoom-Setup-\d+\.\d+\.\d+(?:-[\da-z.-]+)?\.exe$/i.test(name));
  if (installers.length !== 1) throw new Error('Esperado exatamente um instalador ShareRoom na pasta de release.');
  const installer = installers[0];
  const assets = [installer, `${installer}.blockmap`, 'latest.yml', 'signature-report.json'];
  const lines = [];
  for (const name of assets) {
    const file = resolve(releaseDir, name);
    if (!(await stat(file)).isFile()) throw new Error(`Asset ausente ou inválido: ${name}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    lines.push(`${hash.digest('hex')}  ${name}\n`);
  }
  // Gera apenas após assinar: qualquer mudança posterior invalida os hashes.
  await writeFile(resolve(releaseDir, 'SHA256SUMS.txt'), lines.join(''), 'utf8');
  await writeFile(resolve(releaseDir, `${installer}.sha256`), lines[0], 'utf8');
  return assets;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const releaseDir = resolve(process.argv[2] || fileURLToPath(new URL('../release', import.meta.url)));
  const assets = await writeChecksums(releaseDir);
  console.log(`SHA-256 gerado para ${assets.length} assets finais em ${releaseDir}.`);
}
