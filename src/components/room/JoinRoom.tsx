import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
} from 'react-native';
import { useRoom } from '../providers/RoomContext';
import { Settings, Video, Users } from 'lucide-react-native';

export const JoinRoom: React.FC = () => {
  const { joinRoom } = useRoom();

  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isCreator, setIsCreator] = useState(false);
  
  // Advanced Settings
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [socketUrl, setSocketUrl] = useState('');

  const handleProceed = () => {
    if (!username.trim()) {
      alert('Please enter a username');
      return;
    }
    
    let targetRoomId = roomId.trim();
    if (isCreator) {
      // If creating and no ID entered, generate a simple random ID
      if (!targetRoomId) {
        targetRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      }
    } else {
      if (!targetRoomId) {
        alert('Please enter a Room ID to join');
        return;
      }
    }

    joinRoom(
      targetRoomId,
      username.trim(),
      isCreator,
      socketUrl.trim() || undefined
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          {/* Logo Area */}
          <View style={styles.logoContainer}>
            <View style={styles.logoIcon}>
              <Video size={32} color="#ffffff" />
            </View>
            <Text style={styles.title}>Watch2Gether</Text>
            <Text style={styles.subtitle}>Stream, sync, and chat together</Text>
          </View>

          {/* Selector Tabs */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tabButton, !isCreator && styles.activeTabButton]}
              onPress={() => setIsCreator(false)}
            >
              <Users size={16} color={!isCreator ? '#ffffff' : 'rgba(255,255,255,0.4)'} />
              <Text style={[styles.tabText, !isCreator && styles.activeTabText]}>Join Room</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.tabButton, isCreator && styles.activeTabButton]}
              onPress={() => setIsCreator(true)}
            >
              <Video size={16} color={isCreator ? '#ffffff' : 'rgba(255,255,255,0.4)'} />
              <Text style={[styles.tabText, isCreator && styles.activeTabText]}>Create Room</Text>
            </TouchableOpacity>
          </View>

          {/* Input Fields */}
          <View style={styles.form}>
            <Text style={styles.label}>Your Name</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="e.g. Alice"
              placeholderTextColor="rgba(255, 255, 255, 0.3)"
              style={styles.input}
              maxLength={20}
            />

            <Text style={styles.label}>
              {isCreator ? 'Room ID (Optional - Auto-generated if blank)' : 'Room ID'}
            </Text>
            <TextInput
              value={roomId}
              onChangeText={setRoomId}
              placeholder={isCreator ? "e.g. MOVIE-NIGHT" : "e.g. A3B89X"}
              placeholderTextColor="rgba(255, 255, 255, 0.3)"
              style={styles.input}
              autoCapitalize="characters"
              maxLength={30}
            />

            {/* Advanced Toggle */}
            <TouchableOpacity
              style={styles.advancedHeader}
              onPress={() => setShowAdvanced(!showAdvanced)}
              activeOpacity={0.7}
            >
              <Settings size={14} color="#a855f7" />
              <Text style={styles.advancedText}>Advanced Settings</Text>
            </TouchableOpacity>

            {showAdvanced && (
              <View style={styles.advancedForm}>
                <Text style={styles.label}>Custom Socket Server URL</Text>
                <TextInput
                  value={socketUrl}
                  onChangeText={setSocketUrl}
                  placeholder="e.g. http://192.168.1.50:3001"
                  placeholderTextColor="rgba(255, 255, 255, 0.3)"
                  style={styles.input}
                  autoCapitalize="none"
                  keyboardType="url"
                />
                <Text style={styles.infoText}>
                  Leave blank to use the environment configuration default.
                </Text>
              </View>
            )}

            <TouchableOpacity style={styles.submitButton} onPress={handleProceed} activeOpacity={0.8}>
              <Text style={styles.submitButtonText}>
                {isCreator ? 'Create & Start Room' : 'Join Room Session'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 40,
  },
  card: {
    backgroundColor: '#0d0d0d',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 24,
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoIcon: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: '#9333ea',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#9333ea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 4,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  activeTabButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  tabText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 13,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#ffffff',
  },
  form: {
    gap: 6,
  },
  label: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  input: {
    height: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    color: '#ffffff',
    fontSize: 15,
  },
  advancedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 4,
  },
  advancedText: {
    color: '#a855f7',
    fontSize: 13,
    fontWeight: '600',
  },
  advancedForm: {
    marginTop: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    gap: 4,
  },
  infoText: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontSize: 11,
    marginTop: 4,
  },
  submitButton: {
    height: 52,
    backgroundColor: '#9333ea',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    shadowColor: '#9333ea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
