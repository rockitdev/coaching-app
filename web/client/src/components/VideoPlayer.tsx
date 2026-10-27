import { useEffect, useRef } from 'react';
import videojs from 'video.js';
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
      preload: 'auto',
      fluid: true,
      playbackRates: [0.25, 0.5, 0.75, 1, 1.5, 2],
      controlBar: {
        playbackRateMenuButton: true,
      },
      html5: {
        vhs: {
          overrideNative: false,
        },
        nativeVideoTracks: false,
        nativeAudioTracks: false,
        nativeTextTracks: false,
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
