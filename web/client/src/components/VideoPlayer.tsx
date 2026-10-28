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
