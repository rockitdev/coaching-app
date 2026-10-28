import { useEffect, useRef } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.min.css';
import type VjsPlayer from 'video.js/dist/types/player';

interface Props {
  playerRef: React.MutableRefObject<VjsPlayer | null>;
  onReady?: (player: VjsPlayer) => void;
}

export default function VideoPlayer({ playerRef, onReady }: Props) {
  const videoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // If player already exists, don't reinitialize
    if (playerRef.current) return;

    const videoEl = document.createElement('video-js');
    videoEl.classList.add('vjs-default-skin', 'vjs-big-play-centered');
    videoRef.current?.appendChild(videoEl);

    const player = videojs(videoEl as HTMLVideoElement, {
      controls: true,
      autoplay: false,
      // 'metadata' only buffers enough to show duration/dimensions -- important
      // for large game files (1-2 GB). 'auto' would start downloading immediately.
      preload: 'metadata',
      fluid: true,
      // iOS Safari requires playsinline so the video plays inside the custom
      // player UI instead of going full-screen in the system player. Without
      // this the <video> element appears unloaded/stalled on iPad/iPhone.
      playsinline: true,
      playbackRates: [0.25, 0.5, 0.75, 1, 1.5, 2],
      controlBar: {
        playbackRateMenuButton: true,
      },
      html5: {
        // overrideNative: false (default) -- use the browser's native <video>
        // for MP4 files. Do NOT set nativeVideoTracks/nativeAudioTracks/
        // nativeTextTracks to false here: those flags are only valid when
        // overrideNative is true (VHS/MSE mode). With them false and
        // overrideNative false, video.js can activate VHS for plain MP4s,
        // breaking HTTP Range requests and seeking on non-fragmented files.
        vhs: {
          overrideNative: false,
        },
      },
    });

    playerRef.current = player as unknown as VjsPlayer;

    player.ready(() => {
      // -----------------------------------------------------------------------
      // WebKit black-frame compositing fix
      //
      // Symptom: on iOS Safari / iPad the video plays (currentTime advances,
      // duration is known, pause button is active) but the frame is completely
      // black with no visible picture.
      //
      // Root cause: WebKit composites decoded video frames on a separate GPU
      // plane. When the <video> element lives inside a position:fixed ancestor
      // (or multiple overflow:hidden ancestors), WebKit can fail to merge that
      // plane into the visible stacking context — yielding a black rectangle
      // while audio continues normally.
      //
      // Fix 1 (CSS — see ReviewAndTagMode.css .vjs-tech rule): translate3d(0,0,0)
      // in CSS is the primary fix, applied before the element is visible so the
      // GPU layer is set up correctly from the start.
      //
      // Fix 2 (JS, here): after video.js initialises and the tech <video>
      // element exists, force the same GPU layer programmatically AND set the
      // legacy webkit-playsinline attribute (required on Safari < 14 where the
      // modern `playsinline` attribute alone is not sufficient).
      // -----------------------------------------------------------------------
      const techEl = (player.el() as HTMLElement).querySelector('video');
      if (techEl) {
        // Legacy inline-playback attribute (Safari < 14)
        techEl.setAttribute('webkit-playsinline', '');
        // Force the video element into its own GPU compositing layer.
        // translateZ(0) / translate3d(0,0,0) is the canonical iOS Safari fix
        // for the black-frame bug. The will-change hint tells WebKit to
        // pre-allocate the GPU layer before decoding starts.
        (techEl as HTMLElement).style.webkitTransform = 'translateZ(0)';
        (techEl as HTMLElement).style.transform     = 'translateZ(0)';
        (techEl as HTMLElement).style.willChange    = 'transform';
      }

      onReady?.(player as unknown as VjsPlayer);
    });

    return () => {
      // Dispose only when component truly unmounts
      if (playerRef.current && !playerRef.current.isDisposed()) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div data-vjs-player style={{ width: '100%' }}>
      <div ref={videoRef} />
    </div>
  );
}
