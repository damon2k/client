import React, { useState } from 'react';
import { Video, Users, AlertCircle } from 'lucide-react';

const RoomJoin = ({ onJoinRoom, isConnecting, error }) => {
  const [roomId, setRoomId] = useState('');
  const [inputError, setInputError] = useState('');
  
  const handleSubmit = () => {
    if (!roomId.trim()) {
      setInputError('Please enter a room ID');
      return;
    }
    setInputError('');
    onJoinRoom(roomId.trim());
  };
  
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };
  
  return (
    <div className="room-join">
      <div className="room-join-container">
        <div className="room-join-header">
          <div className="logo">
            <Video className="logo-icon" />
          </div>
          <h1 className="title">MeetNow Video Call</h1>
          <p className="subtitle">Enter a room ID to start or join a call</p>
        </div>
        
        <div className="room-join-form">
          <div className="input-group">
            <label className="input-label">Room ID</label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="e.g., meeting-123"
              className="room-input"
              disabled={isConnecting}
            />
            {inputError && (
              <div className="error-message">
                <AlertCircle className="error-icon" />
                {inputError}
              </div>
            )}
            {error && (
              <div className="error-message">
                <AlertCircle className="error-icon" />
                {error}
              </div>
            )}
          </div>
          
          <button
            onClick={handleSubmit}
            disabled={isConnecting}
            className="join-button"
          >
            {isConnecting ? (
              <>
                <div className="spinner"></div>
                Connecting...
              </>
            ) : (
              <>
                <Users className="button-icon" />
                Join Room
              </>
            )}
          </button>
        </div>
        
        <div className="room-join-footer">
          <p>Share the same room ID with another person to connect</p>
        </div>
      </div>
    </div>
  );
};

export default RoomJoin;