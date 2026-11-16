// Configuração para electron-builder 26.18. Nunca contém chaves ou senhas.
function createSigningConfig(env = process.env) {
  const value = name => (env[name] || '').trim();
  const required = name => {
    const result = value(name);
    if (!result) throw new Error(`Assinatura oficial: defina ${name}. Consulte docs/windows-release.md.`);
    return result;
  };
  const provider = value('SHAREROOM_SIGNING_PROVIDER');
  const enabled = Boolean(provider) || value('SHAREROOM_REQUIRE_SIGNING') === '1';
  if (!enabled) return { enabled: false, options: { signExecutable: false } };
  if (value('SHAREROOM_TEST_BUILD') === '1') {
    throw new Error('Uma versão oficial assinada não pode usar SHAREROOM_TEST_BUILD=1.');
  }
  if (!['azure', 'signtool'].includes(provider)) {
    throw new Error('Defina SHAREROOM_SIGNING_PROVIDER=azure ou signtool; não há fallback sem assinatura.');
  }
  const publisherName = required('SHAREROOM_PUBLISHER_NAME');
  const options = {
    forceCodeSigning: true,
    signExecutable: true,
    signAndEditExecutable: true,
    // Inclui DLLs do Electron e módulos nativos, além dos EXEs e extraResources.
    signExts: ['.exe', '.dll', '.node'],
    verifyUpdateCodeSignature: true,
  };
  if (provider === 'azure') {
    if (value('WIN_CSC_LINK') || value('CSC_LINK') || value('SHAREROOM_SIGN_HOOK') ||
        value('SHAREROOM_CERTIFICATE_SHA1') || value('SHAREROOM_CERTIFICATE_SUBJECT')) {
      throw new Error('Configure apenas um provedor: Azure não pode ser combinado com credenciais signtool.');
    }
    const endpoint = required('SHAREROOM_AZURE_ENDPOINT');
    if (new URL(endpoint).protocol !== 'https:') throw new Error('O endpoint Azure deve usar HTTPS.');
    options.azureSignOptions = {
      publisherName,
      endpoint,
      codeSigningAccountName: required('SHAREROOM_AZURE_ACCOUNT'),
      certificateProfileName: required('SHAREROOM_AZURE_PROFILE'),
      fileDigest: 'SHA256',
      timestampDigest: 'SHA256',
      timestampRfc3161: 'http://timestamp.acs.microsoft.com',
    };
  } else {
    const certificateSha1 = value('SHAREROOM_CERTIFICATE_SHA1');
    const certificateSubjectName = value('SHAREROOM_CERTIFICATE_SUBJECT');
    const sign = value('SHAREROOM_SIGN_HOOK');
    const hasPfx = Boolean(value('WIN_CSC_LINK') || value('CSC_LINK'));
    const methods = [Boolean(certificateSha1 || certificateSubjectName), Boolean(sign), hasPfx];
    if (methods.filter(Boolean).length !== 1) {
      throw new Error('Signtool exige exatamente um método: certificado no Windows, SHAREROOM_SIGN_HOOK ou WIN_CSC_LINK/CSC_LINK.');
    }
    if (certificateSha1 && !/^[0-9a-f]{40}$/i.test(certificateSha1)) {
      throw new Error('SHAREROOM_CERTIFICATE_SHA1 deve ser o thumbprint de 40 caracteres hexadecimais.');
    }
    options.signtoolOptions = {
      publisherName,
      signingHashAlgorithms: ['sha256'],
      rfc3161TimeStampServer: value('SHAREROOM_TIMESTAMP_URL') || 'http://timestamp.digicert.com',
      ...(certificateSha1 ? { certificateSha1 } : {}),
      ...(certificateSubjectName ? { certificateSubjectName } : {}),
      ...(sign ? { sign } : {}),
    };
  }
  return { enabled: true, options };
}

module.exports = { createSigningConfig };
