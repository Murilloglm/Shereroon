// Versões do Cosmic Night para Windows. Convenção própria de publicação, dentro do SemVer (X.Y.Z):
// cada número de baixo vai de 0 a 9 e transporta para o de cima — 0.3.0 → 0.3.1 → … → 0.3.9 → 0.4.0 → … →
// 0.9.9 → 1.0.0. A versão só sobe quando uma publicação começa (nunca a cada commit), e nenhuma versão já
// publicada é reutilizada. As tags são vX.Y.Z (as pré-versões antigas usavam preview-vX.Y.Z).
//
// Uso:
//   node scripts/versioning.mjs proxima          mostra a próxima versão a publicar
//   node scripts/versioning.mjs preparar         grava a próxima versão no package.json (e no package-lock)
//   node scripts/versioning.mjs conferir X.Y.Z   falha se X.Y.Z já foi publicada ou não é maior que a última
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** [major, minor, patch] de uma versão X.Y.Z (sem "v", sem sufixo). Lança se for inválida. */
export function parseVersion(text) {
  const match = VERSION.exec(String(text ?? '').trim());
  if (!match) throw new Error(`Versão inválida: "${text}". Use o formato X.Y.Z, por exemplo 0.3.1.`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Compara número a número: 1 se a > b, -1 se a < b, 0 se iguais. */
export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

/** A versão seguinte na convenção: o último número sobe de 0 a 9; no 9, zera e o anterior sobe. */
export function nextVersion(current) {
  const parts = parseVersion(current);
  if (parts[1] > 9 || parts[2] > 9) throw new Error(`A versão ${current} está fora da convenção do Cosmic Night (cada número de baixo vai de 0 a 9).`);
  for (let i = 2; i >= 0; i--) {
    if (i === 0 || parts[i] < 9) {
      parts[i] += 1;
      break;
    }
    parts[i] = 0;
  }
  return parts.join('.');
}

/** Versão de uma tag publicada: v0.3.1, preview-v0.3.0 ou refs/tags/…; null se a tag não for de versão. */
export function versionFromTag(tag) {
  const match = /^(?:refs\/tags\/)?(?:preview-)?v(\d+\.\d+\.\d+)$/.exec(String(tag ?? '').trim());
  if (!match) return null;
  try {
    parseVersion(match[1]);
    return match[1];
  } catch {
    return null;
  }
}

const highest = (versions) => versions.reduce((best, version) => (best === null || compareVersions(version, best) > 0 ? version : best), null);
const publishedVersions = (tags) => [...new Set(tags.map(versionFromTag).filter(Boolean))];

/**
 * Próxima versão a publicar. Se o package.json já está numa versão maior que todas as publicadas (subiu e a
 * publicação ainda não aconteceu), fica nela; senão, a seguinte à maior entre a atual e a última publicada.
 */
export function nextReleaseVersion(current, tags) {
  const published = publishedVersions(tags);
  const last = highest(published);
  if ((last === null || compareVersions(current, last) > 0) && !published.includes(current)) return current;
  return nextVersion(last !== null && compareVersions(last, current) > 0 ? last : current);
}

/** Pode publicar esta versão? Nunca uma já publicada nem uma menor que a última. */
export function checkPublishable(version, tags) {
  try {
    parseVersion(version);
    nextVersion(version);
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  const published = publishedVersions(tags);
  if (published.includes(version)) return { ok: false, reason: `A versão ${version} já foi publicada. Rode "npm --prefix desktop run release:prepare" para subir para a próxima.` };
  const last = highest(published);
  if (last !== null && compareVersions(version, last) <= 0) return { ok: false, reason: `A versão ${version} precisa ser maior que a última publicada (${last}).` };
  return { ok: true, tag: `v${version}` };
}

/** Tags publicadas: as do GitHub (origin) e as locais. */
export function publishedTags(cwd) {
  const tags = new Set();
  const run = (args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return '';
    }
  };
  for (const line of run(['ls-remote', '--tags', 'origin']).split('\n')) {
    const ref = line.split('\t')[1]?.replace(/\^\{\}$/, '');
    if (ref) tags.add(ref.replace(/^refs\/tags\//, ''));
  }
  for (const tag of run(['tag', '-l']).split('\n')) if (tag.trim()) tags.add(tag.trim());
  return [...tags];
}

function writeVersion(desktopDir, version) {
  const pkgFile = resolve(desktopDir, 'package.json');
  const pkg = readFileSync(pkgFile, 'utf8');
  writeFileSync(pkgFile, pkg.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
  const lockFile = resolve(desktopDir, 'package-lock.json');
  try {
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    lock.version = version;
    if (lock.packages?.['']) lock.packages[''].version = version;
    writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  } catch {
    // sem package-lock: só o package.json
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const current = JSON.parse(readFileSync(resolve(desktopDir, 'package.json'), 'utf8')).version;
  const [command, argument] = process.argv.slice(2);
  const tags = publishedTags(desktopDir);
  if (command === 'proxima') {
    console.log(nextReleaseVersion(current, tags));
  } else if (command === 'preparar') {
    const next = nextReleaseVersion(current, tags);
    if (next !== current) writeVersion(desktopDir, next);
    console.log(next === current ? `A versão ${current} ainda não foi publicada: fica nela.` : `Versão: ${current} → ${next}`);
  } else if (command === 'conferir') {
    const result = checkPublishable(argument ?? current, tags);
    if (!result.ok) {
      console.error(result.reason);
      process.exit(1);
    }
    console.log(result.tag);
  } else {
    console.error('Use: proxima | preparar | conferir [X.Y.Z]');
    process.exit(2);
  }
}
