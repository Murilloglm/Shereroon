// SÓ para o teste real de atualização (scripts/update-real.mjs). Gera uma cópia com outro nome, outro
// identificador e outra pasta de dados, que nunca toca no Cosmic Night instalado de verdade; procura versões
// num servidor local (127.0.0.1) e, por causa do arquivo update-test.json, baixa e instala sozinha para o teste
// poder acompanhar sem cliques. Mantém os fuses de segurança e a mesma conferência de assinatura.
const url = process.env.SHAREROOM_UPDATE_TEST_URL || '';
const version = process.env.SHAREROOM_UPDATE_TEST_VERSION || '';
const flag = process.env.SHAREROOM_UPDATE_TEST_FLAG || '';
if (!/^http:\/\/127\.0\.0\.1:\d{2,5}\/$/.test(url)) throw new Error('SHAREROOM_UPDATE_TEST_URL deve ser http://127.0.0.1:PORTA/.');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('SHAREROOM_UPDATE_TEST_VERSION deve ser X.Y.Z.');
if (!flag || !process.env.SHAREROOM_UPDATE_KEYS) throw new Error('Defina SHAREROOM_UPDATE_TEST_FLAG e SHAREROOM_UPDATE_KEYS (chave de teste).');
if (process.env.SHAREROOM_REQUIRE_SIGNING === '1' || process.env.SHAREROOM_SIGNING_PROVIDER) throw new Error('A cópia de teste não usa assinatura oficial.');

const base = require('./electron-builder.config.cjs');
const NAME = 'CosmicNightUpdateTest';
module.exports = {
  ...base,
  appId: 'app.shareroom.updatetest',
  productName: NAME,
  extraMetadata: { name: 'cosmicnight-update-test', productName: NAME, version },
  directories: { ...base.directories, output: `release-update-test/${version}` },
  win: { ...base.win, executableName: NAME, signExecutable: false, forceCodeSigning: false },
  extraResources: [...base.extraResources, { from: flag, to: 'update-test.json' }],
  // Não registra o protocolo cosmicnight:// (é do aplicativo de verdade) nem cria atalhos.
  protocols: undefined,
  afterPack: undefined,
  nsis: {
    ...base.nsis,
    createDesktopShortcut: false,
    createStartMenuShortcut: false,
    shortcutName: NAME,
    artifactName: `${NAME}-Setup-\${version}.\${ext}`,
  },
  publish: [{ provider: 'generic', url }],
};
