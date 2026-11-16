/**
 * Faz o navegador oferecer ao SFU as variantes de H.264 que ele codifica por HARDWARE.
 *
 * Medido no Chrome 157 (Windows, placa NVIDIA): o H.264 "Constrained Baseline" (profile-level-id
 * 42e0…) é codificado pelo OpenH264, por software; Baseline (4200…), Main (4d…) e High (64…) usam
 * o codificador da placa de vídeo. O SFU, deixado à vontade, escolhe justamente o 42e0… — e por
 * software não há como sustentar 1080p a 120 fps. Tirando o 42e0… da oferta quando existe uma
 * variante High ou Main, o SFU passa a escolher uma delas e o Chrome usa a GPU.
 *
 * O Chrome só lista High/Main entre os codecs de envio quando tem codificador por hardware para
 * eles; sem isso a lista fica como está e nada muda.
 */

export interface CodecLike {
  mimeType: string;
  sdpFmtpLine?: string;
}

const isH264 = (codec: CodecLike) => codec.mimeType.toLowerCase() === 'video/h264';
const profileOf = (codec: CodecLike) => /profile-level-id=([0-9a-f]{4})/i.exec(codec.sdpFmtpLine ?? '')?.[1]?.toLowerCase() ?? '';

/** High e Main: perfis que o Chrome só oferece para envio quando há codificador por hardware. */
function isHardwareProfile(codec: CodecLike): boolean {
  const profile = profileOf(codec);
  return profile.startsWith('64') || profile.startsWith('4d');
}

function isConstrainedBaseline(codec: CodecLike): boolean {
  return profileOf(codec).startsWith('42e0');
}

/**
 * Devolve a lista de codecs com o H.264 reorganizado (High, depois Main, depois o resto), sem o
 * Constrained Baseline quando há alternativa por hardware. Os outros codecs ficam onde estavam.
 * Devolve null quando não há nada a mudar.
 */
export function preferHardwareH264<T extends CodecLike>(codecs: readonly T[]): T[] | null {
  const h264 = codecs.filter(isH264);
  if (!h264.some(isHardwareProfile)) return null;

  const rank = (codec: T) => (profileOf(codec).startsWith('64') ? 0 : profileOf(codec).startsWith('4d') ? 1 : 2);
  const kept = h264.filter((codec) => !isConstrainedBaseline(codec)).sort((a, b) => rank(a) - rank(b));

  // Recoloca o bloco de H.264 na posição em que o primeiro H.264 aparecia.
  const out: T[] = [];
  let placed = false;
  for (const codec of codecs) {
    if (!isH264(codec)) {
      out.push(codec);
    } else if (!placed) {
      out.push(...kept);
      placed = true;
    }
  }
  return out;
}

let installed = false;

/** Aplica a preferência a toda faixa de vídeo que for enviada. Chame uma vez, ao abrir o app. */
export function installHardwareH264Preference(): void {
  if (installed || typeof RTCPeerConnection === 'undefined' || typeof RTCRtpSender === 'undefined') return;
  if (typeof RTCRtpTransceiver === 'undefined' || !('setCodecPreferences' in RTCRtpTransceiver.prototype)) return;
  installed = true;

  const original = RTCPeerConnection.prototype.addTransceiver;
  RTCPeerConnection.prototype.addTransceiver = function (
    this: RTCPeerConnection,
    trackOrKind: MediaStreamTrack | string,
    init?: RTCRtpTransceiverInit,
  ): RTCRtpTransceiver {
    const transceiver = original.call(this, trackOrKind, init);
    try {
      const kind = typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind;
      const sends = init?.direction === undefined || init.direction === 'sendonly' || init.direction === 'sendrecv';
      if (kind === 'video' && sends) {
        const preferred = preferHardwareH264(RTCRtpSender.getCapabilities('video')?.codecs ?? []);
        if (preferred) transceiver.setCodecPreferences(preferred);
      }
    } catch (error) {
      // Navegador recusou a lista: segue com a negociação padrão.
      console.warn('Preferência de H.264 por hardware não aplicada', error);
    }
    return transceiver;
  };
}
