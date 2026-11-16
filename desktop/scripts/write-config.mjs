// Grava em src/config.json os endereços públicos que o aplicativo instalado vai usar. São endereços, não
// segredos: o mesmo backend e o mesmo site que qualquer navegador acessa.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionConfig } from '../src/connection-config.mjs';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/config.json');
const config = connectionConfig({
  apiUrl: (process.env.SHAREROOM_API_URL ?? '').trim(),
  siteUrl: (process.env.SHAREROOM_SITE_URL ?? '').trim(),
}, { local: process.argv.includes('--local') });
writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
console.log(
  `Modo ${config.connectionMode}: ${config.apiUrl}\nSite para os convites: ${config.siteUrl || '(nenhum: uso local)'}`,
);
