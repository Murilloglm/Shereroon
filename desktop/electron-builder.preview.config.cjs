// Canal de testes público: sem certificado de assinatura de código e sem mudar o gate oficial. Com o
// repositório definido (GITHUB_REPOSITORY no Actions), recebe atualização automática pelas pré-versões do
// GitHub; cada instalador novo só é aceito com SHA-512 e assinatura Ed25519 (ver src/update-trust.mjs).
if (process.env.SHAREROOM_REQUIRE_SIGNING === '1' || process.env.SHAREROOM_SIGNING_PROVIDER) {
  throw new Error('O preview sem assinatura não pode usar a configuração de assinatura oficial.');
}
if (process.env.SHAREROOM_TEST_BUILD === '1') {
  throw new Error('O preview público deve manter os fuses de segurança; remova SHAREROOM_TEST_BUILD=1.');
}
const base = require('./electron-builder.config.cjs');
const [owner, repo] = (process.env.SHAREROOM_REPO || process.env.GITHUB_REPOSITORY || '').split('/');
module.exports = {
  ...base,
  directories: { ...base.directories, output: 'release-preview' },
  win: { ...base.win, signExecutable: false, forceCodeSigning: false },
  extraResources: [
    ...base.extraResources.map(resource =>
      resource.to === 'helper/ShareRoomAudio.exe'
        ? { ...resource, from: process.env.SHAREROOM_PREVIEW_HELPER_PATH || resource.from }
        : resource),
    // As pré-versões são marcadas como prerelease no GitHub: o updater precisa olhar para elas.
    { from: 'build/update-channel-preview.json', to: 'update-channel.json' },
  ],
  afterPack: undefined,
  publish: owner && repo ? [{ provider: 'github', owner, repo }] : null,
};
