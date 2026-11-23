import { useEffect, useState, type RefObject } from 'react';
import type { Track } from 'livekit-client';

export type FrameVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};

/** Liga a faixa ao elemento enquanto `enabled`. Soltar a faixa para a decodificação daquele elemento. */
export function useAttachedTrack(ref: RefObject<FrameVideo | null>, track: Track | null, enabled = true): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !track || !enabled) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [ref, track, enabled]);
}

export interface MeasuredVideo {
  height: number | null;
  /** Quadros realmente pintados por segundo no último segundo (medido, não pedido). */
  fps: number | null;
}

/**
 * Amostra os contadores do elemento uma vez por segundo. Uma tela congelada registra zero
 * mesmo sem callbacks de pintura; quadros descartados não contam como apresentados.
 */
export function useMeasuredVideo(ref: RefObject<FrameVideo | null>, track: Track | null, onFps?: (fps: number | null) => void): MeasuredVideo {
  const [measured, setMeasured] = useState<MeasuredVideo>({ height: null, fps: null });
  useEffect(() => {
    const element = ref.current;
    setMeasured({ height: null, fps: null });
    onFps?.(null);
    if (!element || !track || !element.getVideoPlaybackQuality) return;
    const presented = () => {
      const quality = element.getVideoPlaybackQuality();
      return quality.totalVideoFrames - quality.droppedVideoFrames;
    };
    let count = presented();
    let since = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const next = presented();
      const fps = !document.hidden && element.videoWidth && next >= count ? Math.round((next - count) * 1000 / (now - since)) : null;
      count = next;
      since = now;
      const height = element.videoHeight || null;
      setMeasured(previous => previous.height === height && previous.fps === fps ? previous : { height, fps });
      onFps?.(fps);
    }, 1000);
    return () => { clearInterval(timer); onFps?.(null); };
  }, [ref, track, onFps]);
  return measured;
}

/** Tela cheia de um elemento (ou do próprio vídeo, no iPhone). */
export function toggleFullscreen(element: HTMLElement | null, video: FrameVideo | null): void {
  if (!element) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else if (element.requestFullscreen) {
    element.requestFullscreen().catch(() => video?.webkitEnterFullscreen?.());
  } else {
    video?.webkitEnterFullscreen?.();
  }
}
