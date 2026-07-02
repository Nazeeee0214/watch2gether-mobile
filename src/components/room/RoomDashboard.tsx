import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
  Share,
  Platform,
  StatusBar,
  Animated,
} from 'react-native';
import { useRoom } from '../providers/RoomContext';
import { VideoPlayer } from '../video/VideoPlayer';
import { ChatContainer } from '../chat/ChatContainer';
import { LogOut, Mic, MicOff, Users, MessageSquare, Plus, Trash2, Share2, Camera, Crown } from 'lucide-react-native';

export const RoomDashboard: React.FC = () => {
  const {
    roomState,
    isHost,
    isSharer,
    roomId,
    username,
    userId,
    leaveRoom,
    socket,
    isMicActive,
    toggleMic,
    isScreenSharing,
    startScreenShare,
    stopScreenShare,
    isCameraShare,
    messages,
    transferHost,
    requestHost,
  } = useRoom();

  const [inputUrl, setInputUrl] = useState('');
  const [activeTab, setActiveTab] = useState<'participants' | 'chat'>('participants');
  const [unreadCount, setUnreadCount] = useState(0);

  const prevMessagesLength = useRef(messages.length);

  // Pulsing animation for the LIVE banner
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isScreenSharing) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [isScreenSharing, pulseAnim]);

  useEffect(() => {
    if (activeTab === 'chat') {
      setUnreadCount(0);
    }
  }, [activeTab]);

  useEffect(() => {
    if (messages.length > prevMessagesLength.current) {
      const latestMessage = messages[messages.length - 1];
      prevMessagesLength.current = messages.length;

      // Only notify unread count if message is from someone else and we are not in the chat tab
      if (latestMessage && latestMessage.userId !== userId && activeTab !== 'chat') {
        setUnreadCount(prev => prev + 1);
      }
    } else {
      prevMessagesLength.current = messages.length;
    }
  }, [messages, activeTab, userId]);

  const handleLeave = () => {
    Alert.alert(
      'Leave Room',
      'Are you sure you want to exit this room session?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: leaveRoom }
      ]
    );
  };

  const handleLoadVideo = () => {
    if (!inputUrl.trim()) return;
    if (socket) {
      socket.emit('video:change_url', { url: inputUrl.trim() });
      setInputUrl('');
    }
  };

  const handleClearVideo = () => {
    if (socket) {
      socket.emit('video:change_url', { url: '' });
      setInputUrl('');
    }
  };

  const handleShareLink = async () => {
    try {
      const url = `https://watch2gether-z4f3.onrender.com/${roomId}`;
      await Share.share({
        message: `Join my Watch2Gether room session! Room: ${roomId}\nLink: ${url}`,
        url: url,
        title: 'Watch2Gether Invite'
      });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.roomTitle} numberOfLines={1}>Room: {roomId}</Text>
          <View style={styles.connectionStatus}>
            <View style={styles.onlineIndicator} />
            <Text style={styles.connectionText}>
              {username} {isHost ? '(Host)' : ''}
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity style={[styles.actionBtn, styles.shareBtn]} onPress={handleShareLink} activeOpacity={0.7}>
            <Share2 size={18} color="rgba(255, 255, 255, 0.6)" />
          </TouchableOpacity>

          {/* Screen share button — available to ALL users */}
          <TouchableOpacity
            style={[styles.actionBtn, isScreenSharing && isSharer ? styles.screenActiveBtn : styles.screenInactiveBtn]}
            onPress={isScreenSharing && isSharer ? stopScreenShare : startScreenShare}
            activeOpacity={0.7}
          >
            <Camera size={18} color={isScreenSharing && isSharer ? '#a855f7' : 'rgba(255, 255, 255, 0.6)'} />
          </TouchableOpacity>

          {/* Request Host button — only visible to non-hosts */}
          {!isHost && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.requestHostBtn]}
              onPress={() => Alert.alert(
                '👑 Request Host',
                'Send a request to the current host to become the host?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Send Request', onPress: requestHost }
                ]
              )}
              activeOpacity={0.7}
            >
              <Crown size={18} color="rgba(255, 200, 50, 0.7)" />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.actionBtn, isMicActive ? styles.micActiveBtn : styles.micInactiveBtn]}
            onPress={toggleMic}
            activeOpacity={0.7}
          >
            {isMicActive ? <Mic size={18} color="#22c55e" /> : <MicOff size={18} color="rgba(255, 255, 255, 0.6)" />}
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionBtn, styles.leaveBtn]} onPress={handleLeave} activeOpacity={0.7}>
            <LogOut size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Screen Share LIVE Banner */}
      {isScreenSharing && (
        <View style={[styles.liveBanner, isSharer ? styles.liveBannerHost : styles.liveBannerGuest]}>
          <Animated.View style={[styles.liveDot, { opacity: pulseAnim }, isSharer ? styles.liveDotHost : styles.liveDotGuest]} />
          <Text style={[styles.liveBannerText, isSharer ? styles.liveBannerTextHost : styles.liveBannerTextGuest]}>
            {isSharer ? '🔴  BROADCASTING LIVE' : '📺  LIVE STREAM ACTIVE'}
          </Text>
          {(isSharer || isHost) && (
            <TouchableOpacity onPress={stopScreenShare} style={styles.stopBtn}>
              <Text style={styles.stopBtnText}>Stop</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Video Stream Area */}
      <View style={styles.videoSection}>
        <VideoPlayer url={roomState.videoUrl} />
      </View>

      {/* Host Controls */}
      {isHost && (
        <View style={styles.hostControls}>
          <TextInput
            value={inputUrl}
            onChangeText={setInputUrl}
            placeholder="Paste direct mp4 link or YouTube URL"
            placeholderTextColor="rgba(255, 255, 255, 0.4)"
            style={styles.hostInput}
            autoCapitalize="none"
            keyboardType="url"
          />
          <View style={styles.hostButtons}>
            <TouchableOpacity style={styles.loadBtn} onPress={handleLoadVideo} activeOpacity={0.7}>
              <Plus size={16} color="#ffffff" />
              <Text style={styles.loadBtnText}>Load</Text>
            </TouchableOpacity>
            {roomState.videoUrl ? (
              <TouchableOpacity style={styles.clearBtn} onPress={handleClearVideo} activeOpacity={0.7}>
                <Trash2 size={16} color="#ef4444" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      )}

      {/* Tab Selectors */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'participants' && styles.activeTabButton]}
          onPress={() => setActiveTab('participants')}
        >
          <Users size={16} color={activeTab === 'participants' ? '#a855f7' : 'rgba(255,255,255,0.4)'} />
          <Text style={[styles.tabText, activeTab === 'participants' && styles.activeTabText]}>
            People ({roomState.users.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'chat' && styles.activeTabButton]}
          onPress={() => setActiveTab('chat')}
        >
          <View style={styles.tabWithBadge}>
            <MessageSquare size={16} color={activeTab === 'chat' ? '#a855f7' : 'rgba(255,255,255,0.4)'} />
            <Text style={[styles.tabText, activeTab === 'chat' && styles.activeTabText]}>
              Room Chat
            </Text>
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Content Area */}
      <View style={styles.contentArea}>
        {activeTab === 'participants' ? (
          <ScrollView contentContainerStyle={styles.usersList}>
            {roomState.users.map((user) => {
              const isUserHost = user.userId === roomState.hostId;
              const isUserSharing = user.userId === roomState.sharingUserId;
              const isMe = user.userId === userId;

              const handleParticipantPress = () => {
                if (!isHost || isMe || isUserHost) return; // Host can only reassign to others
                Alert.alert(
                  user.username,
                  'Participant options',
                  [
                    { text: '👑 Make Host', onPress: () => transferHost(user.userId) },
                    { text: 'Cancel', style: 'cancel' }
                  ]
                );
              };

              return (
                <TouchableOpacity
                  key={user.userId}
                  style={styles.userRow}
                  onPress={handleParticipantPress}
                  activeOpacity={isHost && !isMe && !isUserHost ? 0.7 : 1}
                >
                  <View style={styles.userLeft}>
                    <View style={[styles.statusDot, user.micActive ? styles.activeMicDot : styles.inactiveMicDot]} />
                    <Text style={styles.userName} numberOfLines={1}>
                      {user.username}{isMe ? ' (You)' : ''}
                    </Text>
                  </View>
                  <View style={styles.userBadges}>
                    {isUserSharing && (
                      <View style={styles.sharingBadge}>
                        <Text style={styles.sharingBadgeText}>📡 Live</Text>
                      </View>
                    )}
                    {isUserHost && (
                      <View style={styles.hostBadge}>
                        <Text style={styles.hostBadgeText}>👑 Host</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : (
          <ChatContainer />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#050505',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  liveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  liveBannerHost: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(239, 68, 68, 0.25)',
  },
  liveBannerGuest: {
    backgroundColor: 'rgba(168, 85, 247, 0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(168, 85, 247, 0.25)',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveDotHost: {
    backgroundColor: '#ef4444',
  },
  liveDotGuest: {
    backgroundColor: '#a855f7',
  },
  liveBannerText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  liveBannerTextHost: {
    color: '#ef4444',
  },
  liveBannerTextGuest: {
    color: '#a855f7',
  },
  stopBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  stopBtnText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerTitleContainer: {
    flex: 1,
    marginRight: 10,
  },
  roomTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  onlineIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  connectionText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  micActiveBtn: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  micInactiveBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  screenActiveBtn: {
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    borderColor: 'rgba(168, 85, 247, 0.2)',
  },
  screenInactiveBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  shareBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  leaveBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  videoSection: {
    padding: 12,
    backgroundColor: '#000000',
  },
  hostControls: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  hostInput: {
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#ffffff',
    fontSize: 13,
  },
  hostButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  loadBtn: {
    flex: 1,
    height: 36,
    backgroundColor: '#9333ea',
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  loadBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  clearBtn: {
    width: 44,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#0b0b0b',
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  activeTabButton: {
    borderBottomWidth: 2,
    borderBottomColor: '#a855f7',
  },
  tabText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 13,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#ffffff',
  },
  contentArea: {
    flex: 1,
    backgroundColor: '#080808',
  },
  usersList: {
    padding: 16,
    gap: 10,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderRadius: 12,
  },
  userLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  activeMicDot: {
    backgroundColor: '#22c55e',
  },
  inactiveMicDot: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  userName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  hostBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderColor: 'rgba(168, 85, 247, 0.3)',
    borderWidth: 1,
    borderRadius: 6,
  },
  hostBadgeText: {
    color: '#c084fc',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  requestHostBtn: {
    backgroundColor: 'rgba(255, 200, 50, 0.08)',
    borderColor: 'rgba(255, 200, 50, 0.25)',
  },
  userBadges: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  sharingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
    borderRadius: 6,
  },
  sharingBadgeText: {
    color: '#f87171',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  tabWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    backgroundColor: '#ef4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginLeft: 4,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: 'bold',
  },
});
