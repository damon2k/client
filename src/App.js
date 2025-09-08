import React, { useState } from 'react';
import io from 'socket.io-client';
import RoomJoin from './components/RoomJoin';
import VideoCall from './components/VideoCall';
import './App.css';

const App = () => {
  const [currentRoom, setCurrentRoom] = useState(null);
  const [socket, setSocket] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  
  // Join room handler
  const handleJoinRoom = async (roomId) => {
    setIsConnecting(true);
    setConnectionError(null);
    
    try {
      // Connect to Socket.io server
      const socketConnection = io('https://backend-production-10d7.up.railway.app', {
        transports: ['websocket', 'polling'],
        timeout: 20000,
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000
      });
      
      // Wait for connection
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);
        
        socketConnection.on('connect', () => {
          clearTimeout(timeout);
          resolve();
        });
        
        socketConnection.on('connect_error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
      
      setSocket(socketConnection);
      setCurrentRoom(roomId);
      
    } catch (err) {
      console.error('Failed to connect to server:', err);
      setConnectionError(`Failed to connect to server: ${err.message}`);
    } finally {
      setIsConnecting(false);
    }
  };
  
  // Leave room handler
  const handleLeaveRoom = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
    setCurrentRoom(null);
    setConnectionError(null);
  };
  
  return (
    <div className="App">
      {!currentRoom ? (
        <RoomJoin 
          onJoinRoom={handleJoinRoom} 
          isConnecting={isConnecting}
          error={connectionError}
        />
      ) : (
        <VideoCall 
          roomId={currentRoom}
          onLeaveRoom={handleLeaveRoom}
          socket={socket}
        />
      )}
    </div>
  );
};

export default App;