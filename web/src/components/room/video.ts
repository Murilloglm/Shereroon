import { useEffect, useState, type RefObject } from 'react';
import type { Track } from 'livekit-client';

export type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, meta: { width?: number; height?: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
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
 * Mede o que o elemento de vídeo de fato mostra: altura do quadro e quadros pintados por segundo, contados
 * pelo `requestVideoFrameCallback` (limitado pela taxa do monitor de quem assiste).
 */
export function useMeasuredVideo(ref: RefObject<FrameVideo | null>, active: boolean, onFps?: (fps: number | null) => void): MeasuredVideo {
  const [measured, setMeasured] = useState<MeasuredVideo>({ height: null, fps: null });
  useEffect(() => {
    const element = ref.current;
    if (!element || !active || !element.requestVideoFrameCallback) {
      setMeasured({ height: null, fps: null });
      onFps?.(null);
      return;
    }
    let alive = true;
    let handle = 0;
    let frames = 0;
    let since = performance.now();
    const onFrame = (now: number) => {
      if (!alive) return;
      frames += 1;
      if (now - since >= 1000) {
        const fps = (frames * 1000) / (now - since);
        setMeasured({ height: element.videoHeight || null, fps });
        onFps?.(fps);
        frames = 0;
        since = now;
      }
      handle = element.requestVideoFrameCallback!(onFrame);
    };
    handle = element.requestVideoFrameCallback(onFrame);
    return () => {
      alive = false;
      element.cancelVideoFrameCallback?.(handle);
      onFps?.(null);
    };
  }, [ref, active, onFps]);
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
