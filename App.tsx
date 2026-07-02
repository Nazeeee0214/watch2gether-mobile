import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { RoomProvider, useRoom } from './src/components/providers/RoomContext';
import { JoinRoom } from './src/components/room/JoinRoom';
import { RoomDashboard } from './src/components/room/RoomDashboard';

function MainAppContent() {
  const { roomId } = useRoom();

  return (
    <View style={styles.container}>
      {roomId ? <RoomDashboard /> : <JoinRoom />}
      <StatusBar hidden={true} translucent={true} />
    </View>
  );
}

export default function App() {
  return (
    <RoomProvider>
      <MainAppContent />
    </RoomProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
});

