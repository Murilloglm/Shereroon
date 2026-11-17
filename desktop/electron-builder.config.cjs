// Empacotamento do aplicativo de Windows (instalador NSIS) e publicação na página de versões do GitHub.
// No GitHub Actions, GITHUB_REPOSITORY diz de qual repositório as atualizações vêm. Compilando fora de lá,
// sem SHAREROOM_REPO, o instalador é gerado sem atualização automática.
const [owner, repo] = (process.env.SHAREROOM_REPO || process.env.GITHUB_REPOSITORY || '').split('/');
const { createSigningConfig } = require('./scripts/windows-signing.cjs');
const signing = createSigningConfig();
if (process.env.SHAREROOM_REQUIRE_SIGNING === '1' && (!owner || !repo)) {
  throw new Error('A versão oficial exige SHAREROOM_REPO=proprietario/repositorio (ou GITHUB_REPOSITORY).');
}

module.exports = {
  appId: 'app.shareroom.desktop',
  productName: 'Cosmic Night',
  copyright: 'Cosmic Night',
  directories: { output: 'release', buildResources: 'build' },
  files: ['src/**/*', 'package.json'],
  asar: true,
  extraResources: [
    { from: '../web/dist', to: 'web' },
    { from: '../helper/bin/ShareRoomAudio.exe', to: 'helper/ShareRoomAudio.exe' },
    { from: 'build/icon.png', to: 'icon.png' },
  ],
  win: {
    // Nome do arquivo executável sem espaço: scripts de auditoria e atalhos dependem dele.
    executableName: 'CosmicNight',
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.png',
    ...signing.options,
  },
  // O NSIS remove o EXE temporário do desinstalador. Guarda os mesmos bytes assinados
  // para que a auditoria possa verificá-los antes da publicação (não é um asset público).
  afterPack: signing.enabled ? require('./scripts/preserve-uninstaller.cjs') : undefined,
  // Links cosmicnight://convite/... abrem o aplicativo instalado (registro por usuário, sem administrador).
  protocols: [{ name: 'Cosmic Night', schemes: ['cosmicnight'] }],
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Cosmic Night',
    artifactName: 'CosmicNight-Setup-${version}.${ext}',
  },
  // O executável final não aceita ser usado como Node comum nem abrir portas de depuração, e só carrega o
  // código do pacote conferido. SHAREROOM_TEST_BUILD=1 gera uma cópia sem essas travas, só para os testes
  // automatizados conseguirem dirigir o aplicativo empacotado.
  electronFuses:
    process.env.SHAREROOM_TEST_BUILD === '1'
      ? undefined
      : {
          runAsNode: false,
          enableCookieEncryption: true,
          enableNodeOptionsEnvironmentVariable: false,
          enableNodeCliInspectArguments: false,
          enableEmbeddedAsarIntegrityValidation: true,
          onlyLoadAppFromAsar: true,
          grantFileProtocolExtraPrivileges: false,
        },
  // O workflow faz build com --publish never, verifica assinaturas/hashes e só então
  // publica o draft. Builds locais sem assinatura não recebem canal de atualização.
  publish: signing.enabled && owner && repo ? [{ provider: 'github', owner, repo, releaseType: 'draft' }] : null,
};
