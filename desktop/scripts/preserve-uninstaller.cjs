const { copyFile, mkdir } = require('node:fs/promises');
const path = require('node:path');

module.exports = async function preserveUninstaller({ packager, outDir, electronPlatformName }) {
  if (electronPlatformName !== 'win32') return;
  // signIf é usado também pelos targets NSIS depois de afterSign. Esta integração
  // é validada contra electron-builder 26.18.0, fixado no package-lock.json.
  const signIf = packager.signIf.bind(packager);
  packager.signIf = async file => {
    const signed = await signIf(file);
    if (path.basename(file).endsWith('__uninstaller.exe')) {
      if (!signed) throw new Error('O desinstalador NSIS não foi assinado.');
      const auditDir = path.join(outDir, 'signing-audit');
      await mkdir(auditDir, { recursive: true });
      await copyFile(file, path.join(auditDir, 'ShareRoom-uninstaller.exe'));
    }
    return signed;
  };
};
