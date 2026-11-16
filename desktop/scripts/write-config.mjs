// Grava em src/config.json os endereços públicos que o aplicativo instalado vai usar. São endereços, não
// segredos: o mesmo backend e o mesmo site que qualquer navegador acessa.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/config.json');
const config = {
  apiUrl: (process.env.SHAREROOM_API_URL ?? '').trim(),
  siteUrl: (process.env.SHAREROOM_SITE_URL ?? '').trim(),
};
writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
console.log(
  config.apiUrl
    ? `Backend do aplicativo: ${config.apiUrl}\nSite para os convites: ${config.siteUrl || '(nenhum: o convite será só o código)'}`
    : 'SHAREROOM_API_URL não definido: este aplicativo vai procurar o backend em http://localhost:8787 (uso local).',
);
