import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import { writeChecksums } from './write-checksums.mjs';
import { publicHttpsUrl } from '../src/connection-config.mjs';
const require = createRequire(import.meta.url);
process.env.SHAREROOM_REQUIRE_SIGNING = '1';
// Valida antes de executar o empacotador ou alterar a saída existente.
require('../electron-builder.config.cjs');
for (const name of ['SHAREROOM_API_URL', 'SHAREROOM_SITE_URL']) {
  publicHttpsUrl(process.env[name], name);
}
// Exige evidência desta compilação, mesmo ao reutilizar a pasta de saída local.
await rm(fileURLToPath(new URL('../release/signing-audit/ShareRoom-uninstaller.exe', import.meta.url)), { force: true });
const result = spawnSync(process.execPath, [
  require.resolve('electron-builder/cli.js'), '--win', 'nsis',
  '--config', 'electron-builder.config.cjs', '--publish', 'never',
], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  const releaseDir = fileURLToPath(new URL('../release', import.meta.url));
  const audit = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./audit-signatures.ps1', import.meta.url)),
    '-ReleaseDir', releaseDir, '-RequireValid', '-ExpectedPublisher', process.env.SHAREROOM_PUBLISHER_NAME,
    '-ReportPath', fileURLToPath(new URL('../release/signature-report.json', import.meta.url)),
  ], { stdio: 'inherit', env: process.env });
  if (audit.error) throw audit.error;
  if (audit.status !== 0) {
    process.exitCode = audit.status ?? 1;
  } else {
    // O aplicativo só instala atualizações com a assinatura Ed25519 do projeto, além do certificado.
    const signUpdate = spawnSync(process.execPath, [fileURLToPath(new URL('./update-signing.mjs', import.meta.url)), 'assinar', releaseDir], { stdio: 'inherit', env: process.env });
    if (signUpdate.error) throw signUpdate.error;
    if (signUpdate.status !== 0) {
      process.exitCode = signUpdate.status ?? 1;
      throw new Error('Não foi possível assinar o latest.yml (defina COSMIC_UPDATE_SIGNING_KEY).');
    }
    await writeChecksums(releaseDir);
    console.log('Instalador assinado, auditoria aprovada e SHA-256 gerado. Nenhum arquivo foi publicado.');
  }
}
