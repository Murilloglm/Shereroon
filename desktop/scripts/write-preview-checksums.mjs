import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function writePreviewChecksums(releaseDir) {
  const installers = (await readdir(releaseDir)).filter(name => /^CosmicNight-Setup-\d+\.\d+\.\d+\.exe$/.test(name));
  if (installers.length !== 1) throw new Error('O preview deve conter exatamente um instalador.');
  const installer = installers[0];
  const report = JSON.parse(await readFile(resolve(releaseDir, 'signature-report.json'), 'utf8'));
  if (report.requireValid !== false) throw new Error('Use este canal somente para a auditoria de preview sem assinatura.');
  const installerHash = await sha256(resolve(releaseDir, installer));
  const record = report.files?.find(file => file.path === installer);
  if (record?.status !== 'NotSigned' || record.sha256 !== installerHash) {
    throw new Error('A auditoria do preview está ausente, não corresponde ao instalador ou não informa NotSigned.');
  }
  const installerLine = `${installerHash}  ${installer}\n`;
  const lines = [installerLine];
  // Canal de atualização: latest.yml (assinado no GitHub Actions) e o mapa de blocos do download diferencial.
  const exists = name => access(resolve(releaseDir, name)).then(() => true, () => false);
  if (await exists('latest.yml')) {
    if (!/^cosmicSignature: \S+$/m.test(await readFile(resolve(releaseDir, 'latest.yml'), 'utf8'))) {
      throw new Error('O latest.yml precisa estar assinado (update-signing.mjs assinar) antes dos hashes.');
    }
    for (const name of [`${installer}.blockmap`, 'latest.yml']) {
      if (await exists(name)) lines.push(`${await sha256(resolve(releaseDir, name))}  ${name}\n`);
    }
  }
  lines.push(`${await sha256(resolve(releaseDir, 'signature-report.json'))}  signature-report.json\n`);
  await writeFile(resolve(releaseDir, 'SHA256SUMS.txt'), lines.join(''), 'utf8');
  await writeFile(resolve(releaseDir, `${installer}.sha256`), installerLine, 'utf8');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writePreviewChecksums(resolve(process.argv[2] || fileURLToPath(new URL('../release-preview', import.meta.url))));
  console.log('SHA-256 do preview gerado. Este instalador continua sem assinatura digital.');
}
