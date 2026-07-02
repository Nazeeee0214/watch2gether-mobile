import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { Alert, PermissionsAndroid, Platform, Linking } from 'react-native';
import { io, Socket } from 'socket.io-client';

// Resilient conditional import for react-native-webrtc to avoid crashes in Expo Go
let hasWebRTC = false;
let RTCPeerConnection: any = null;
let RTCSessionDescription: any = null;
let RTCIceCandidate: any = null;
let mediaDevices: any = null;
let MediaStream: any = null;

try {
  const webrtcModule = require('react-native-webrtc');
  RTCPeerConnection = webrtcModule.RTCPeerConnection;
  RTCSessionDescription = webrtcModule.RTCSessionDescription;
  RTCIceCandidate = webrtcModule.RTCIceCandidate;
  mediaDevices = webrtcModule.mediaDevices;
  MediaStream = webrtcModule.MediaStream;
  hasWebRTC = !!RTCPeerConnection;
} catch (e) {
  console.log('[WebRTC Check] Native WebRTC not available. Mocks active for Expo Go.');
}

// Resilient conditional import for react-native-incall-manager
// Required on Android to route audio to speaker instead of earpiece
let InCallManager: any = null;
try {
  InCallManager = require('react-native-incall-manager').default;
} catch (e) {
  console.log('[InCallManager] Not available. Audio routing will use OS defaults.');
}

const openAppSettings = () => {
  Linking.openSettings().catch(() => {
    Alert.alert('Cannot open settings', 'Please open device Settings manually and grant the required permission.');
  });
};

const requestMicrophonePermission = async (): Promise<boolean> => {
  if (Platform.OS === 'android') {
    // First check current status without showing dialog
    const currentStatus = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    );
    if (currentStatus) return true;

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone Permission',
        message: 'Watch2Gether needs access to your microphone so you can voice chat in the room.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'Allow',
      }
    );

    if (result === PermissionsAndroid.RESULTS.GRANTED) return true;

    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      Alert.alert(
        'Microphone Permission Blocked',
        'Microphone access was permanently denied. Please enable it in your device Settings to use voice chat.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: openAppSettings }
        ]
      );
    }
    return false;
  }
  return true;
};

const requestCameraPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'android') {
    const currentStatus = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.CAMERA
    );
    if (currentStatus) return true;

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: 'Camera Permission',
        message: 'Watch2Gether needs access to your camera so you can stream your video.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'Allow',
      }
    );

    if (result === PermissionsAndroid.RESULTS.GRANTED) return true;

    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      Alert.alert(
        'Camera Permission Blocked',
        'Camera access was permanently denied. Please enable it in your device Settings to share your camera feed.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: openAppSettings }
        ]
      );
    }
    return false;
  }
  return true;
};


const optimizeSenders = async (pc: any) => {
  try {
    if (!pc || typeof pc.getSenders !== 'function') return;
    const senders = pc.getSenders();
    for (const sender of senders) {
      if (!sender || !sender.track) continue;
      const parameters = typeof sender.getParameters === 'function' ? sender.getParameters() : null;
      if (!parameters) continue;
      if (!parameters.encodings) {
        parameters.encodings = [{}];
      }
      let changed = false;
      if (sender.track.kind === 'video') {
        parameters.encodings[0].maxBitrate = 1200000; // 1.2 Mbps
        parameters.encodings[0].maxFramerate = 30;
        changed = true;
        console.log('[WebRTC] Video sender optimized: 1.2 Mbps max, 30fps max');
      } else if (sender.track.kind === 'audio') {
        parameters.encodings[0].maxBitrate = 48000; // 48 kbps (perfect for voice)
        changed = true;
        console.log('[WebRTC] Audio sender optimized: 48 kbps max');
      }
      if (changed && typeof sender.setParameters === 'function') {
        await sender.setParameters(parameters).catch((e: any) => console.warn('[WebRTC] Error calling setParameters:', e));
      }
    }
  } catch (e) {
    console.warn('[WebRTC] Failed to optimize senders:', e);
  }
};


interface User {
  userId: string;
  username: string;
  socketId: string;
  micActive?: boolean;
}

export interface ChatMessage {
  userId: string;
  username: string;
  text: string;
  timestamp: number;
}

interface RoomState {
  users: User[];
  hostId: string | null;
  videoUrl: string;
  isScreenSharing: boolean;
  sharingUserId: string | null;
}

interface RoomContextType {
  socket: Socket | null;
  roomState: RoomState;
  userId: string;
  username: string;
  roomId: string | null;
  joinRoom: (roomId: string, username: string, isCreator?: boolean, customSocketUrl?: string) => void;
  leaveRoom: () => void;
  isHost: boolean;
  isSharer: boolean;
  isScreenSharing: boolean;
  screenShareStream: any | null;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  isCameraShare: boolean;
  messages: ChatMessage[];
  sendChatMessage: (text: string) => void;
  isMicActive: boolean;
  toggleMic: () => Promise<void>;
  hasWebRTCSupport: boolean;
  transferHost: (targetUserId: string) => void;
  requestHost: () => void;
  pendingHostRequest: { fromUserId: string; fromUsername: string } | null;
  dismissHostRequest: () => void;
}

const RoomContext = createContext<RoomContextType | undefined>(undefined);

export const RoomProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomState, setRoomState] = useState<RoomState>({
    users: [], hostId: null, videoUrl: '', isScreenSharing: false, sharingUserId: null
  });
  const [userId] = useState(() => Math.random().toString(36).substring(2, 15));
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomInfo, setRoomInfo] = useState<{ id: string; name: string; creator: boolean; socketUrl?: string } | null>(null);

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareStream, setScreenShareStream] = useState<any | null>(null);
  const [isCameraShare, setIsCameraShare] = useState(false);
  const [pendingHostRequest, setPendingHostRequest] = useState<{ fromUserId: string; fromUsername: string } | null>(null);

  const peerConnections = useRef<{ [socketId: string]: any }>({});
  const pendingCandidates = useRef<{ [socketId: string]: any[] }>({});

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isMicActive, setIsMicActive] = useState(false);
  const micStream = useRef<any | null>(null);
  const outgoingMicConnections = useRef<{ [socketId: string]: any }>({});
  const incomingMicConnections = useRef<{ [socketId: string]: any }>({});
  const outgoingMicPendingCandidates = useRef<{ [socketId: string]: any[] }>({});
  const incomingMicPendingCandidates = useRef<{ [socketId: string]: any[] }>({});

  const socketRef = useRef<Socket | null>(null);
  const isHost = roomState.hostId === userId;
  const isSharer = roomState.sharingUserId === userId;

  useEffect(() => {
    if (!roomInfo) return;

    const baseSocketUrl = roomInfo.socketUrl || process.env.EXPO_PUBLIC_SOCKET_SERVER_URL || 'https://watch2gether-z4f3.onrender.com';
    console.log(`[Socket] Connecting to server: ${baseSocketUrl}`);
    
    const newSocket = io(baseSocketUrl, {
      transports: ['websocket'],
      forceNew: true
    });

    newSocket.on('connect', () => {
      console.log('[Socket] Connected with ID:', newSocket.id);
      setSocket(newSocket);
      socketRef.current = newSocket;

      newSocket.emit('room:join', {
        roomId: roomInfo.id,
        userId,
        username: roomInfo.name,
        isCreator: roomInfo.creator
      });
    });

    newSocket.on('connect_error', (err) => {
      console.error('[Socket] Connection Error:', err.message);
      Alert.alert('Connection Error', `Failed to connect to the socket server: ${baseSocketUrl}`);
    });

    newSocket.on('room:state', (state: RoomState) => {
      setRoomState(state);
    });

    newSocket.on('chat:message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    });

    newSocket.on('error', (err: { message: string }) => {
      Alert.alert('Server Error', err.message);
    });

    // Host transfer: host receives a request from a participant
    newSocket.on('room:host_requested', (data: { fromUserId: string; fromUsername: string }) => {
      setPendingHostRequest(data);
      Alert.alert(
        '🎤 Host Request',
        `${data.fromUsername} is requesting to become the host.`,
        [
          { text: 'Deny', style: 'cancel', onPress: () => setPendingHostRequest(null) },
          {
            text: 'Approve',
            onPress: () => {
              socketRef.current?.emit('room:transfer_host', { newHostUserId: data.fromUserId });
              setPendingHostRequest(null);
            }
          }
        ]
      );
    });

    // WebRTC Screenshare Relay signaling (Guests rendering screen share)
    newSocket.on('webrtc:signal', async (data: { senderSocketId: string; signal: any }) => {
      if (!hasWebRTC) return;
      const { senderSocketId, signal } = data;

      if (signal.type === 'offer') {
        try {
          console.log('[WebRTC] Mobile guest received offer from host:', senderSocketId);
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
          });

          peerConnections.current[senderSocketId] = pc;

          pc.onicecandidate = (event: any) => {
            if (event.candidate && socketRef.current) {
              socketRef.current.emit('webrtc:signal', {
                targetSocketId: senderSocketId,
                signal: { candidate: event.candidate }
              });
            }
          };

          pc.ontrack = (event: any) => {
            console.log('[WebRTC] Mobile guest received remote stream track:', event.track.kind);
            if (event.streams && event.streams[0]) {
              setScreenShareStream(event.streams[0]);
            } else {
              console.log('[WebRTC] event.streams is empty/missing. Creating new MediaStream from track.');
              const newStream = new MediaStream();
              newStream.addTrack(event.track);
              setScreenShareStream(newStream);
            }
          };

          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          newSocket.emit('webrtc:signal', {
            targetSocketId: senderSocketId,
            signal: answer
          });

          // Process queued ICE candidates
          const candidates = pendingCandidates.current[senderSocketId] || [];
          for (const c of candidates) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
          }
          pendingCandidates.current[senderSocketId] = [];
        } catch (e) {
          console.error('[WebRTC] Error handling offer:', e);
        }
      } else if (signal.type === 'answer') {
        const pc = peerConnections.current[senderSocketId];
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            const candidates = pendingCandidates.current[senderSocketId] || [];
            for (const c of candidates) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
            }
            pendingCandidates.current[senderSocketId] = [];
          } catch (e) {
            console.error('[WebRTC] Error handling answer:', e);
          }
        }
      } else if (signal.candidate) {
        const pc = peerConnections.current[senderSocketId];
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (e) {
            console.error('[WebRTC] Error adding ICE candidate:', e);
          }
        } else {
          if (!pendingCandidates.current[senderSocketId]) {
            pendingCandidates.current[senderSocketId] = [];
          }
          pendingCandidates.current[senderSocketId].push(signal.candidate);
        }
      }
    });

    // Voice open mic WebRTC signaling
    newSocket.on('mic:signal', async (data: { senderSocketId: string; signal: any }) => {
      if (!hasWebRTC) return;
      const { senderSocketId, signal } = data;
      // Fall back to senderSocketId if web client doesn't include micOwnerSocketId
      const micOwnerSocketId: string = signal.micOwnerSocketId ?? senderSocketId;

      // Identify whether this signal is for our outgoing connection or our incoming connection
      const isMyMicStream = micOwnerSocketId === newSocket.id;

      const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ];

      if (signal.type === 'offer') {
        try {
          console.log('[WebRTC Mic] Offer received from sender:', senderSocketId);

          // ── Teardown any stale connection for this sender (e.g. mic toggled off/on) ──
          if (incomingMicConnections.current[micOwnerSocketId]) {
            try { incomingMicConnections.current[micOwnerSocketId].close(); } catch (e) {}
            delete incomingMicConnections.current[micOwnerSocketId];
            delete incomingMicPendingCandidates.current[micOwnerSocketId];
          }

          const pc = new RTCPeerConnection({ iceServers });
          incomingMicConnections.current[micOwnerSocketId] = pc;

          // Helper: returns false if this PC was superseded by a newer offer (race condition guard)
          const isCurrent = () => incomingMicConnections.current[micOwnerSocketId] === pc;

          pc.onicecandidate = (e: any) => {
            if (e.candidate && socketRef.current && isCurrent()) {
              socketRef.current.emit('mic:signal', {
                targetSocketId: senderSocketId,
                signal: { 
                  candidate: e.candidate,
                  micOwnerSocketId 
                }
              });
            }
          };

          pc.ontrack = (e: any) => {
            console.log('[WebRTC Mic] Received remote audio track from sender:', micOwnerSocketId);
          };

          pc.onconnectionstatechange = () => {
            console.log(`[WebRTC Mic] Incoming connection state with ${micOwnerSocketId}: ${pc.connectionState}`);
          };

          // ── Strip extra fields — only pass {type, sdp} to RTCSessionDescription ──
          await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));

          // ── Abort if this PC was replaced while we were awaiting ──
          if (!isCurrent()) {
            console.log('[WebRTC Mic] Offer superseded by newer one during setRemoteDescription, aborting.');
            return;
          }

          // ── Guard: only create answer when PC is in the correct state ──
          if (pc.signalingState !== 'have-remote-offer') {
            console.warn('[WebRTC Mic] Unexpected signalingState after setRemoteDescription:', pc.signalingState, '— aborting answer.');
            return;
          }

          const answer = await pc.createAnswer();

          // ── Abort again if superseded between createAnswer and setLocalDescription ──
          if (!isCurrent() || pc.signalingState === 'closed') {
            console.log('[WebRTC Mic] PC closed or superseded before setLocalDescription, aborting.');
            return;
          }

          await pc.setLocalDescription(answer);

          if (socketRef.current) {
            newSocket.emit('mic:signal', { 
              targetSocketId: senderSocketId, 
              signal: { type: answer.type, sdp: answer.sdp, micOwnerSocketId } 
            });
          }

          const candidates = incomingMicPendingCandidates.current[micOwnerSocketId] || [];
          for (const c of candidates) {
            if (!isCurrent()) break; // Stop if superseded mid-loop
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
          }
          if (isCurrent()) {
            incomingMicPendingCandidates.current[micOwnerSocketId] = [];
          }
        } catch (err) {
          console.error('[WebRTC Mic] Error handling offer:', err);
        }
      } else if (signal.type === 'answer') {
        // Answers are always for our outgoing streams
        const pc = outgoingMicConnections.current[senderSocketId];
        if (pc) {
          try {
            console.log('[WebRTC Mic] Answer received from listener:', senderSocketId);
            // Strip extra fields before passing to RTCSessionDescription
            await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
            const candidates = outgoingMicPendingCandidates.current[senderSocketId] || [];
            for (const c of candidates) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
            }
            outgoingMicPendingCandidates.current[senderSocketId] = [];
          } catch (e) {
            console.error('[WebRTC Mic] Error handling answer:', e);
          }
        }
      } else if (signal.candidate) {
        // Find which connection this candidate belongs to
        if (isMyMicStream) {
          // Candidate belongs to our outgoing stream to senderSocketId
          const pc = outgoingMicConnections.current[senderSocketId];
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(console.error);
          } else {
            if (!outgoingMicPendingCandidates.current[senderSocketId]) {
              outgoingMicPendingCandidates.current[senderSocketId] = [];
            }
            outgoingMicPendingCandidates.current[senderSocketId].push(signal.candidate);
          }
        } else {
          // Candidate belongs to our incoming stream from micOwnerSocketId
          const pc = incomingMicConnections.current[micOwnerSocketId];
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(console.error);
          } else {
            if (!incomingMicPendingCandidates.current[micOwnerSocketId]) {
              incomingMicPendingCandidates.current[micOwnerSocketId] = [];
            }
            incomingMicPendingCandidates.current[micOwnerSocketId].push(signal.candidate);
          }
        }
      }
    });

    return () => {
      console.log('[Socket] Disconnecting socket...');
      newSocket.close();
      socketRef.current = null;
      setSocket(null);
    };
  }, [roomInfo]);

  // Synchronize screen sharing changes for guest
  useEffect(() => {
    if (isSharer) return;

    if (roomState.isScreenSharing && !isScreenSharing) {
      setIsScreenSharing(true);
    } else if (!roomState.isScreenSharing && isScreenSharing) {
      setIsScreenSharing(false);
      setScreenShareStream(null);
      Object.keys(peerConnections.current).forEach(socketId => {
        try {
          peerConnections.current[socketId].close();
        } catch (e) {}
      });
      peerConnections.current = {};
      pendingCandidates.current = {};
    }
  }, [roomState.isScreenSharing, isSharer, isScreenSharing]);

  const createPeerConnection = async (targetSocketId: string, stream: any) => {
    if (!hasWebRTC) return;
    try {
      console.log('[WebRTC] Creating peer connection for guest socket:', targetSocketId);
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        // Pre-gather ICE candidates before signaling to speed up connection times
        // @ts-ignore
        iceCandidatePoolSize: 2
      });

      peerConnections.current[targetSocketId] = pc;

      stream.getTracks().forEach((track: any) => {
        console.log('[WebRTC] Adding local track to connection:', track.kind);
        pc.addTrack(track, stream);
      });

      pc.onicecandidate = (event: any) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('webrtc:signal', {
            targetSocketId,
            signal: { candidate: event.candidate }
          });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Limit video tracks bandwidth and framerate dynamically
      await optimizeSenders(pc);

      if (socketRef.current) {
        socketRef.current.emit('webrtc:signal', {
          targetSocketId,
          signal: offer
        });
      }
    } catch (e) {
      console.error('[WebRTC] Error creating peer connection:', e);
    }
  };

  const startScreenShare = async () => {
    try {
      const canScreenShare =
        typeof mediaDevices !== 'undefined' && !!mediaDevices.getDisplayMedia;

      if (!hasWebRTC || !canScreenShare) {
        Alert.alert(
          'Feature Unavailable',
          'Live broadcasting requires native WebRTC modules and is not supported in Expo Go.'
        );
        return;
      }

      Alert.alert(
        'Share Live Video',
        'Choose what to broadcast to room participants:',
        [
          {
            text: '📱 Share Phone Screen',
            onPress: () => initiateSharing('screen')
          },
          {
            text: '🤳 Front Camera (Selfie)',
            onPress: () => initiateSharing('front')
          },
          {
            text: '📷 Back Camera',
            onPress: () => initiateSharing('back')
          },
          {
            text: 'Cancel',
            style: 'cancel'
          }
        ]
      );
    } catch (e) {
      console.error(e);
    }
  };

  const initiateSharing = async (mode: 'screen' | 'front' | 'back') => {
    try {
      // Clean up any existing stream before starting a new one
      if (screenShareStream) {
        try {
          screenShareStream.getTracks().forEach((track: any) => track.stop());
        } catch (e) {
          console.warn('[WebRTC] Error stopping previous tracks:', e);
        }
        setScreenShareStream(null);
      }

      let stream: any;

      if (mode === 'screen') {
        console.log('[WebRTC] Requesting screen capture via MediaProjection...');
        // getDisplayMedia triggers the Android system screen capture consent dialog.
        // The ScreenCaptureService foreground service (injected via withScreenShare plugin)
        // keeps the MediaProjection session alive when the user switches apps.
        stream = await mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
          // @ts-ignore – Android-specific screenshare configuration for react-native-webrtc
          android: {
            createConfigForDefaultDisplay: true,
            resolutionScale: 0.5
          }
        });
        setIsCameraShare(false);
      } else {
        const hasMicPermission = await requestMicrophonePermission();
        const hasCamPermission = await requestCameraPermission();
        if (!hasMicPermission || !hasCamPermission) {
          return; // permission helpers already show alerts/settings redirect
        }

        console.log(`[WebRTC] Requesting ${mode} camera stream...`);
        stream = await mediaDevices.getUserMedia({
          video: {
            facingMode: mode === 'front' ? 'user' : 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 }
          },
          audio: true
        });
        setIsCameraShare(true);
      }

      setScreenShareStream(stream);
      setIsScreenSharing(true);

      if (socketRef.current) {
        socketRef.current.emit('video:toggle_screenshare', { active: true });

        const currentGuests = roomState.users.filter(u => u.userId !== userId);
        for (const guest of currentGuests) {
          await createPeerConnection(guest.socketId, stream);
        }
      }

      // Auto-stop when the track ends (user presses stop in system UI or track is lost)
      if (stream.getVideoTracks()[0]) {
        stream.getVideoTracks()[0].onended = () => {
          stopScreenShare();
        };
      }
    } catch (err: any) {
      console.error('[WebRTC] Error starting share:', err);
      if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
        Alert.alert('Camera Busy', 'Your camera is in use by another app. Close it and try again.');
      } else if (err?.name === 'NotAllowedError') {
        Alert.alert('Permission Denied', 'Screen capture permission was denied. Please try again.');
      } else {
        Alert.alert('Sharing Error', 'Failed to start sharing. Please check permissions and try again.');
      }
    }
  };

  const stopScreenShare = () => {
    // Only the current sharer or the host can stop a share
    if (!isSharer && !isHost) return;
    setIsScreenSharing(false);
    setIsCameraShare(false);
    if (screenShareStream) {
      screenShareStream.getTracks().forEach((track: any) => track.stop());
      setScreenShareStream(null);
    }
    Object.keys(peerConnections.current).forEach(socketId => {
      try {
        peerConnections.current[socketId].close();
      } catch (e) {}
    });
    peerConnections.current = {};
    pendingCandidates.current = {};
    if (socketRef.current) {
      socketRef.current.emit('video:toggle_screenshare', { active: false });
    }
  };

  // Synchronize screen share WebRTC connections for the active sharer
  useEffect(() => {
    if (!isSharer || !isScreenSharing || !screenShareStream || !socket) return;

    const currentGuests = roomState.users.filter(u => u.userId !== userId);
    const activeGuestSocketIds = new Set(currentGuests.map(u => u.socketId));

    // Cleanup disconnected guests
    Object.keys(peerConnections.current).forEach((socketId) => {
      if (!activeGuestSocketIds.has(socketId)) {
        console.log(`[WebRTC Cleanup] Guest ${socketId} left room. Tearing down Peer Connection.`);
        try {
          peerConnections.current[socketId].close();
        } catch (err) {
          console.error(`[WebRTC Cleanup] Error closing peer connection for ${socketId}:`, err);
        }
        delete peerConnections.current[socketId];
        delete pendingCandidates.current[socketId];
      }
    });

    // Establish connections for new guests
    for (const guest of currentGuests) {
      if (!peerConnections.current[guest.socketId]) {
        console.log('[WebRTC] New user joined mid-stream, connecting:', guest.socketId);
        createPeerConnection(guest.socketId, screenShareStream);
      }
    }
  }, [roomState.users, isSharer, isScreenSharing, screenShareStream, socket]);

  const joinRoom = (newRoomId: string, name: string, isCreator?: boolean, customSocketUrl?: string) => {
    setUsername(name);
    setRoomId(newRoomId);
    setMessages([]);
    setRoomState({ users: [], hostId: null, videoUrl: '', isScreenSharing: false, sharingUserId: null });
    setRoomInfo({ id: newRoomId, name, creator: !!isCreator, socketUrl: customSocketUrl });
  };

  const leaveRoom = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    setRoomId(null);
    setRoomInfo(null);
    setSocket(null);
    setMessages([]);
    setRoomState({ users: [], hostId: null, videoUrl: '', isScreenSharing: false, sharingUserId: null });
    setIsScreenSharing(false);
    setScreenShareStream(null);

    // Clean up connections
    Object.values(peerConnections.current).forEach((pc: any) => {
      try { pc.close(); } catch(e) {}
    });
    peerConnections.current = {};
    pendingCandidates.current = {};

    // Clean up mic connections
    Object.values(outgoingMicConnections.current).forEach((pc: any) => {
      try { pc.close(); } catch(e) {}
    });
    outgoingMicConnections.current = {};
    outgoingMicPendingCandidates.current = {};

    Object.values(incomingMicConnections.current).forEach((pc: any) => {
      try { pc.close(); } catch(e) {}
    });
    incomingMicConnections.current = {};
    incomingMicPendingCandidates.current = {};

    if (micStream.current) {
      micStream.current.getTracks().forEach((t: any) => t.stop());
      micStream.current = null;
    }
    setIsMicActive(false);
    // Clean up audio session on leave
    try { InCallManager?.stop(); } catch (e) {}
  };

  const startOutgoingAudio = async (targetSocketId: string) => {
    if (!hasWebRTC || !micStream.current) return;
    try {
      console.log('[WebRTC Mic] Initiating outgoing audio connection to:', targetSocketId);
      const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ];

      const pc = new RTCPeerConnection({
        iceServers,
        // @ts-ignore
        iceCandidatePoolSize: 2
      });
      outgoingMicConnections.current[targetSocketId] = pc;

      micStream.current.getTracks().forEach((track: any) => {
        pc.addTrack(track, micStream.current);
      });

      pc.onicecandidate = (event: any) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('mic:signal', {
            targetSocketId,
            signal: { 
              candidate: event.candidate,
              micOwnerSocketId: socketRef.current.id 
            }
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC Mic] Outgoing connection state to ${targetSocketId}: ${pc.connectionState}`);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Limit audio track bandwidth dynamically to save bandwidth while keeping clarity
      await optimizeSenders(pc);

      if (socketRef.current) {
        socketRef.current.emit('mic:signal', {
          targetSocketId,
          signal: { type: offer.type, sdp: offer.sdp, micOwnerSocketId: socketRef.current.id }
        });
      }
    } catch (e) {
      console.error('[WebRTC Mic] Error creating outgoing connection:', e);
    }
  };

  // Synchronize Voice Chat Peer Connections dynamically
  useEffect(() => {
    if (!socket || !hasWebRTC) return;

    // 1. Synchronize INCOMING connections (we are listening to others)
    const activeMicGuests = roomState.users.filter(u => u.userId !== userId && u.micActive);
    const activeMicSocketIds = new Set(activeMicGuests.map(g => g.socketId));

    // Cleanup disconnected or muted incoming streams
    Object.keys(incomingMicConnections.current).forEach((socketId) => {
      if (!activeMicSocketIds.has(socketId)) {
        console.log(`[WebRTC Mic Cleanup] User ${socketId} muted or left. Closing incoming connection.`);
        try {
          incomingMicConnections.current[socketId].close();
        } catch (e) {}
        delete incomingMicConnections.current[socketId];
        delete incomingMicPendingCandidates.current[socketId];
      }
    });

    // 2. Synchronize OUTGOING connections (we are broadcasting our voice)
    if (isMicActive && micStream.current) {
      const otherUsers = roomState.users.filter(u => u.userId !== userId);
      
      // Establish connections to new users in the room
      otherUsers.forEach((user) => {
        if (!outgoingMicConnections.current[user.socketId]) {
          startOutgoingAudio(user.socketId);
        }
      });

      // Cleanup outgoing connections to users who left
      const currentRoomSocketIds = new Set(otherUsers.map(u => u.socketId));
      Object.keys(outgoingMicConnections.current).forEach((socketId) => {
        if (!currentRoomSocketIds.has(socketId)) {
          console.log(`[WebRTC Mic Cleanup] Guest ${socketId} left room. Tearing down outgoing connection.`);
          try {
            outgoingMicConnections.current[socketId].close();
          } catch (e) {}
          delete outgoingMicConnections.current[socketId];
          delete outgoingMicPendingCandidates.current[socketId];
        }
      });
    } else {
      // If our mic is disabled, make sure all outgoing connections are closed
      Object.keys(outgoingMicConnections.current).forEach((socketId) => {
        console.log(`[WebRTC Mic Cleanup] Mic disabled. Closing outgoing connection to ${socketId}.`);
        try {
          outgoingMicConnections.current[socketId].close();
        } catch (e) {}
      });
      outgoingMicConnections.current = {};
      outgoingMicPendingCandidates.current = {};
    }
  }, [roomState.users, isMicActive, socket]);

  const sendChatMessage = (text: string) => {
    if (!socketRef.current || !username || !text.trim()) return;
    socketRef.current.emit('chat:message', { username, text: text.trim() });
  };

  // ── Host Management ─────────────────────────────────────────────────────────

  const transferHost = (targetUserId: string) => {
    if (!isHost || !socketRef.current) return;
    socketRef.current.emit('room:transfer_host', { newHostUserId: targetUserId });
  };

  const requestHost = () => {
    if (isHost || !socketRef.current) return;
    socketRef.current.emit('room:request_host', { fromUsername: username });
  };

  const dismissHostRequest = () => setPendingHostRequest(null);

  const toggleMic = async () => {
    if (!hasWebRTC) {
      Alert.alert(
        'Feature Unavailable',
        'Open Mic (Voice Chat) requires native WebRTC modules. It is disabled while running under Expo Go.'
      );
      return;
    }

    if (isMicActive) {
      if (micStream.current) {
        micStream.current.getTracks().forEach((t: any) => t.stop());
      }
      micStream.current = null;
      setIsMicActive(false);
      socketRef.current?.emit('mic:toggle', { active: false });
      // Stop audio session manager so audio routing returns to normal
      try { InCallManager?.stop(); } catch (e) {}
    } else {
      const hasMicPermission = await requestMicrophonePermission();
      if (!hasMicPermission) {
        Alert.alert('Permission Denied', 'Microphone permission is required for voice chat.');
        return;
      }

      try {
        console.log('[WebRTC Mic] Requesting microphone stream...');
        const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
        micStream.current = stream;
        setIsMicActive(true);
        socketRef.current?.emit('mic:toggle', { active: true });
        // Start audio session — routes incoming WebRTC audio to speaker (not earpiece)
        try {
          InCallManager?.start({ media: 'audio' });
          InCallManager?.setSpeakerphoneOn(true);
        } catch (e) {
          console.warn('[InCallManager] Could not start audio session:', e);
        }
      } catch (err) {
        console.error('[Mic] Failed to start voice chat:', err);
        Alert.alert('Microphone Error', 'Failed to access microphone. Please check permissions.');
      }
    }
  };

  return (
    <RoomContext.Provider value={{
      socket,
      roomState,
      userId,
      username,
      roomId,
      joinRoom,
      leaveRoom,
      isHost,
      isSharer,
      isScreenSharing,
      screenShareStream,
      startScreenShare,
      stopScreenShare,
      isCameraShare,
      messages,
      sendChatMessage,
      isMicActive,
      toggleMic,
      hasWebRTCSupport: hasWebRTC,
      transferHost,
      requestHost,
      pendingHostRequest,
      dismissHostRequest,
    }}>
      {children}
    </RoomContext.Provider>
  );
};

export const useRoom = () => {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error('useRoom must be used within a RoomProvider');
  }
  return context;
};
