// Canal de testes público: sem assinatura, sem updater e sem mudar o gate oficial.
if (process.env.SHAREROOM_REQUIRE_SIGNING === '1' || process.env.SHAREROOM_SIGNING_PROVIDER) {
  throw new Error('O preview sem assinatura não pode usar a configuração de assinatura oficial.');
}
if (process.env.SHAREROOM_TEST_BUILD === '1') {
  throw new Error('O preview público deve manter os fuses de segurança; remova SHAREROOM_TEST_BUILD=1.');
}
const base = require('./electron-builder.config.cjs');
module.exports = {
  ...base,
  directories: { ...base.directories, output: 'release-preview' },
  win: { ...base.win, signExecutable: false, forceCodeSigning: false },
  extraResources: base.extraResources.map(resource =>
    resource.to === 'helper/ShareRoomAudio.exe'
      ? { ...resource, from: process.env.SHAREROOM_PREVIEW_HELPER_PATH || resource.from }
      : resource),
  afterPack: undefined,
  publish: null,
};
