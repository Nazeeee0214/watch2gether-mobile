import React, { useRef, useState, useEffect } from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { WebView } from 'react-native-webview';
import { useRoom } from '../providers/RoomContext';
import { ResolveVideoSource, getYouTubeVideoId } from '../../lib/utils';

// Conditional import of RTCView to prevent crashes in Expo Go
let RTCView: any = null;
try {
  const webrtcModule = require('react-native-webrtc');
  RTCView = webrtcModule.RTCView;
} catch (e) {
  // Silent fallback
}

interface VideoPlayerProps {
  url: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ url }) => {
  const { socket, isHost, roomId, isScreenSharing, screenShareStream, hasWebRTCSupport } = useRoom();
  const webViewRef = useRef<WebView>(null);
  
  const [playerType, setPlayerType] = useState<'DIRECT' | 'YOUTUBE' | 'UNSUPPORTED'>('UNSUPPORTED');
  const [directSource, setDirectSource] = useState<string>('');
  const [youtubeId, setYoutubeId] = useState<string | null>(null);

  // Transient reference tracking the last incoming sync action to prevent event loops
  const lastSocketAction = useRef<{ action: string; currentTime: number; timestamp: number } | null>(null);

  useEffect(() => {
    const resolved = ResolveVideoSource(url);
    if (resolved.type === 'DIRECT') {
      setPlayerType('DIRECT');
      setDirectSource(resolved.finalUrl);
      setYoutubeId(null);
    } else {
      const ytId = getYouTubeVideoId(url);
      if (ytId) {
        setPlayerType('YOUTUBE');
        setYoutubeId(ytId);
        setDirectSource('');
      } else {
        setPlayerType('UNSUPPORTED');
        setYoutubeId(null);
        setDirectSource('');
      }
    }
  }, [url]);

  // --- 1. DIRECT PLAYER LOGIC (EXPO VIDEO) ---
  const player = useVideoPlayer(directSource, (p) => {
    p.loop = false;
  });

  // Host heartbeat synchronization broadcasts (DIRECT PLAYER)
  useEffect(() => {
    if (!isHost || !socket || !roomId || playerType !== 'DIRECT' || !player) return;

    const interval = setInterval(() => {
      if (player) {
        socket.emit('video:heartbeat', {
          currentTime: player.currentTime,
          clientTimestamp: Date.now()
        });
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isHost, socket, roomId, playerType, player]);

  // Handle local user actions and emit to room (DIRECT PLAYER)
  useEffect(() => {
    if (playerType !== 'DIRECT' || !player) return;

    player.timeUpdateEventInterval = 0.5;

    const playingSub = player.addListener('playingChange', (eventData: any) => {
      const isPlaying = typeof eventData === 'boolean' ? eventData : eventData?.isPlaying;
      const lastAction = lastSocketAction.current;
      
      if (lastAction && Date.now() - lastAction.timestamp < 800) {
        return; // Suppress echo from socket event
      }

      if (isHost && socket) {
        socket.emit('video:state_change', {
          action: isPlaying ? 'PLAY' : 'PAUSE',
          currentTime: player.currentTime
        });
      }
    });

    let lastTime = player.currentTime;
    const timeSub = player.addListener('timeUpdate', (eventData: any) => {
      const currentTime = typeof eventData === 'number' ? eventData : eventData?.currentTime;
      if (currentTime === undefined) return;

      const timeDiff = Math.abs(currentTime - lastTime);
      const lastAction = lastSocketAction.current;

      if (timeDiff > 2.0) {
        // Seek detected
        if (isHost && socket && (!lastAction || Date.now() - lastAction.timestamp > 800)) {
          console.log('[Direct Player] Local seek detected to:', currentTime);
          socket.emit('video:state_change', {
            action: 'SEEK',
            currentTime: currentTime
          });
        }
      }
      lastTime = currentTime;
    });

    return () => {
      playingSub.remove();
      timeSub.remove();
    };
  }, [player, isHost, socket, playerType]);

  // Handle socket sync events from Host (DIRECT PLAYER)
  useEffect(() => {
    if (playerType !== 'DIRECT' || !player || !socket) return;

    const handleStateChange = (data: { action: string; currentTime: number }) => {
      lastSocketAction.current = {
        action: data.action,
        currentTime: data.currentTime,
        timestamp: Date.now()
      };

      if (data.action === 'PLAY') {
        player.play();
        if (Math.abs(player.currentTime - data.currentTime) > 1.5) {
          player.currentTime = data.currentTime;
        }
      } else if (data.action === 'PAUSE') {
        player.pause();
        if (Math.abs(player.currentTime - data.currentTime) > 1.0) {
          player.currentTime = data.currentTime;
        }
      } else if (data.action === 'SEEK') {
        player.currentTime = data.currentTime;
      }
    };

    const handleHeartbeat = (data: { currentTime: number }) => {
      if (isHost) return;
      if (Math.abs(data.currentTime - player.currentTime) > 3.0) {
        lastSocketAction.current = {
          action: 'SEEK',
          currentTime: data.currentTime,
          timestamp: Date.now()
        };
        player.currentTime = data.currentTime;
      }
    };

    socket.on('video:state_change', handleStateChange);
    socket.on('video:heartbeat', handleHeartbeat);

    return () => {
      socket.off('video:state_change', handleStateChange);
      socket.off('video:heartbeat', handleHeartbeat);
    };
  }, [socket, player, isHost, playerType]);


  // --- 2. YOUTUBE PLAYER LOGIC (WEBVIEW BRIDGED) ---
  const getYoutubeHTML = (id: string) => `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; background-color: #000; overflow: hidden; }
        #player { width: 100%; height: 100%; }
      </style>
    </head>
    <body>
      <div id="player"></div>
      <script>
        var tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        var firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

        var player;
        var isSyncing = false;
        var isHost = ${isHost};

        function onYouTubeIframeAPIReady() {
          player = new YT.Player('player', {
            height: '100%',
            width: '100%',
            videoId: '${id}',
            playerVars: {
              'autoplay': 1,
              'controls': isHost ? 1 : 0, // Guests get zero playback control HUD
              'disablekb': 1,
              'fs': 0,
              'rel': 0,
              'modestbranding': 1
            },
            events: {
              'onReady': onPlayerReady,
              'onStateChange': onPlayerStateChange
            }
          });
        }

        function onPlayerReady(event) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'ready' }));
          
          if (isHost) {
            // Heartbeat timer inside webview
            setInterval(function() {
              if (player && typeof player.getCurrentTime === 'function') {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  event: 'heartbeat',
                  time: player.getCurrentTime()
                }));
              }
            }, 3000);
          }
        }

        function onPlayerStateChange(event) {
          if (isSyncing) return;
          var time = player.getCurrentTime();
          // event.data codes: 1 = PLAYING, 2 = PAUSED
          if (event.data === 1) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'play', time: time }));
          } else if (event.data === 2) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'pause', time: time }));
          }
        }

        window.addEventListener('message', function(e) {
          var data = JSON.parse(e.data);
          isSyncing = true;
          
          if (data.action === 'PLAY') {
            player.playVideo();
            if (Math.abs(player.getCurrentTime() - data.currentTime) > 2.0) {
              player.seekTo(data.currentTime, true);
            }
          } else if (data.action === 'PAUSE') {
            player.pauseVideo();
            if (Math.abs(player.getCurrentTime() - data.currentTime) > 1.0) {
              player.seekTo(data.currentTime, true);
            }
          } else if (data.action === 'SEEK') {
            player.seekTo(data.currentTime, true);
          }
          
          setTimeout(function() {
            isSyncing = false;
          }, 600);
        });
      </script>
    </body>
    </html>
  `;

  // Bridge events from inside WebView to Host WebSocket Server
  const handleWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (!isHost || !socket) return;

      const lastAction = lastSocketAction.current;
      if (lastAction && Date.now() - lastAction.timestamp < 800) {
        return; // Suppress loop echo
      }

      if (data.event === 'play') {
        socket.emit('video:state_change', { action: 'PLAY', currentTime: data.time });
      } else if (data.event === 'pause') {
        socket.emit('video:state_change', { action: 'PAUSE', currentTime: data.time });
      } else if (data.event === 'heartbeat') {
        socket.emit('video:heartbeat', { currentTime: data.time, clientTimestamp: Date.now() });
      }
    } catch (e) {
      console.error('[WebView Message parse error]', e);
    }
  };

  // Sync socket instructions from Host to Guest WebView
  useEffect(() => {
    if (playerType !== 'YOUTUBE' || !socket) return;

    const handleStateChange = (data: { action: string; currentTime: number }) => {
      lastSocketAction.current = {
        action: data.action,
        currentTime: data.currentTime,
        timestamp: Date.now()
      };

      webViewRef.current?.postMessage(JSON.stringify({
        action: data.action,
        currentTime: data.currentTime
      }));
    };

    const handleHeartbeat = (data: { currentTime: number }) => {
      if (isHost) return;
      webViewRef.current?.postMessage(JSON.stringify({
        action: 'SEEK',
        currentTime: data.currentTime
      }));
    };

    socket.on('video:state_change', handleStateChange);
    socket.on('video:heartbeat', handleHeartbeat);

    return () => {
      socket.off('video:state_change', handleStateChange);
      socket.off('video:heartbeat', handleHeartbeat);
    };
  }, [socket, isHost, playerType]);


  // --- 3. RENDER SCENARIO ROUTING ---

  // WebRTC Screenshare render
  if (isScreenSharing && screenShareStream) {
    if (hasWebRTCSupport && RTCView) {
      return (
        <View style={styles.container}>
          <RTCView
            streamURL={screenShareStream.toURL()}
            style={styles.videoPlayer}
            objectFit="contain"
          />
        </View>
      );
    } else {
      return (
        <View style={[styles.container, styles.fallbackContainer]}>
          <Text style={styles.fallbackTitle}>Screenshare Live Stream</Text>
          <Text style={styles.fallbackDesc}>
            WebRTC screenshare streaming is active! Note: Rendering streams on mobile requires a native development client build.
          </Text>
          <ActivityIndicator size="large" color="#a855f7" style={{ marginTop: 10 }} />
        </View>
      );
    }
  }

  // Regular URLs
  if (playerType === 'DIRECT' && directSource) {
    return (
      <View style={styles.container}>
        <VideoView
          style={styles.videoPlayer}
          player={player}
          allowsPictureInPicture
          nativeControls={isHost} // Guests can't interact with controls
        />
      </View>
    );
  }

  if (playerType === 'YOUTUBE' && youtubeId) {
    return (
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          source={{ html: getYoutubeHTML(youtubeId) }}
          style={styles.videoPlayer}
          onMessage={handleWebViewMessage}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          domStorageEnabled
          javaScriptEnabled
          originWhitelist={['*']}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.fallbackContainer]}>
      <Text style={styles.fallbackTitle}>No Supported Video Source</Text>
      <Text style={styles.fallbackDesc}>
        {isHost
          ? 'Enter a direct file link (.mp4, .m3u8) or a YouTube link below to stream.'
          : 'Waiting for the host to select a synchronized stream...'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000000',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
  },
  fallbackContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    borderStyle: 'dashed',
  },
  fallbackTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  fallbackDesc: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
