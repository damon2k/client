import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Users, AlertCircle } from 'lucide-react';
import DebugLogger from './DebugLogger';

// WebRTC Configuration (remains the same)
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:16.16.71.145:3478' },
    {
      urls: 'turn:16.16.71.145:3478',
      username: 'testuser',
      credential: 'a4216be4368cfd6d3c87e060a4b08fd0fa1718762ca42675f107647b7c224488'
    },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

const VideoCall = ({ roomId, onLeaveRoom, socket }) => {
  // Refs for video elements and WebRTC
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const userInfoTimeoutRef = useRef(null);
  
  // --- Draggable PiP State and Refs ---
  const localVideoPipRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pipPosition, setPipPosition] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, pipX: 0, pipY: 0 });
  
  // ... (Other state management remains the same)
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState('connecting');
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const [remoteUserConnected, setRemoteUserConnected] = useState(false);
  const [showUserInfo, setShowUserInfo] = useState(false);
  const [remoteAudioEnabled, setRemoteAudioEnabled] = useState(true);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(true);
  const [remoteUserName, setRemoteUserName] = useState('Guest User');

  // --- Draggable PiP Event Handlers ---
  const handleDragStart = useCallback((clientX, clientY) => {
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      pipX: pipPosition.x,
      pipY: pipPosition.y,
    };
  }, [pipPosition]);

  const handleDragMove = useCallback((clientX, clientY) => {
    if (!isDragging) return;
    const dx = clientX - dragStartRef.current.mouseX;
    const dy = clientY - dragStartRef.current.mouseY;
    setPipPosition({
      x: dragStartRef.current.pipX + dx,
      y: dragStartRef.current.pipY + dy
    });
  }, [isDragging]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Mouse event handlers
  const handleMouseDown = (e) => {
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);
  };
  const handleMouseMove = useCallback((e) => handleDragMove(e.clientX, e.clientY), [handleDragMove]);

  // Touch event handlers
  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    handleDragStart(touch.clientX, touch.clientY);
  };
  const handleTouchMove = useCallback((e) => handleDragMove(e.touches[0].clientX, e.touches[0].clientY), [handleDragMove]);

  // Effect for global event listeners
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleDragEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging, handleMouseMove, handleDragEnd, handleTouchMove]);


  // ... (The rest of your component's logic remains exactly the same)
  // addLog, showUserInfoTemporarily, initializeMediaStream, createPeerConnection,
  // createOffer, createAnswer, initializeWebRTC, useEffect for sockets,
  // toggleAudio, toggleVideo, endCall, useEffect for unmount, etc.
  
  // (Paste all your existing functions here from addLog down to getParticipantAvatar)
  // ...
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${message}`);
    setLogs(prev => [...prev.slice(-20), { message, timestamp, type }]);
  }, []);
  const showUserInfoTemporarily = useCallback(() => {
    setShowUserInfo(true);
    if (userInfoTimeoutRef.current) clearTimeout(userInfoTimeoutRef.current);
    userInfoTimeoutRef.current = setTimeout(() => setShowUserInfo(false), 4000);
  }, []);
  const initializeMediaStream = useCallback(async () => {
    try {
      addLog('Requesting media permissions...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 44100 }
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      addLog('Local media stream initialized successfully');
      return stream;
    } catch (err) {
      const errorMsg = `Media access error: ${err.message}`;
      addLog(errorMsg, 'error');
      setError(`Cannot access camera/microphone: ${err.message}`);
      throw err;
    }
  }, [addLog]);
  const createPeerConnection = useCallback(() => {
    addLog('Creating peer connection...');
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidateStr = event.candidate.candidate;
        if (candidateStr.includes('typ relay')) addLog('✅ TURN relay candidate generated!', 'success');
        else if (candidateStr.includes('typ srflx')) addLog('STUN server reflexive candidate generated');
        else if (candidateStr.includes('typ host')) addLog('Host candidate generated');
        socket.emit('ice-candidate', { roomId, candidate: event.candidate });
      } else {
        addLog('ICE candidate gathering completed');
      }
    };
    pc.ontrack = (event) => {
      addLog('Received remote stream');
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        setRemoteUserConnected(true);
        showUserInfoTemporarily();
      }
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      addLog(`Connection state changed: ${state}`);
      setConnectionState(state);
      switch (state) {
        case 'connected': setIsConnected(true); setError(null); addLog('WebRTC connection established successfully!', 'success'); showUserInfoTemporarily(); break;
        case 'disconnected': setIsConnected(false); setRemoteUserConnected(false); addLog('WebRTC connection disconnected'); break;
        case 'failed': setIsConnected(false); setRemoteUserConnected(false); addLog('WebRTC connection failed', 'error'); setError('Connection failed. Please try again.'); break;
        case 'closed': setIsConnected(false); setRemoteUserConnected(false); addLog('WebRTC connection closed'); break;
        default: break;
      }
    };
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      addLog(`ICE connection state: ${state}`);
      if (state === 'failed') { addLog('ICE connection failed, attempting restart...', 'error'); pc.restartIce(); }
      else if (state === 'connected') addLog('✅ ICE connection established!', 'success');
    };
    return pc;
  }, [roomId, socket, addLog, showUserInfoTemporarily]);
  const createOffer = useCallback(async () => {
    if (!peerConnectionRef.current) { addLog('Cannot create offer: peer connection not initialized', 'error'); return; }
    try {
      addLog('Creating WebRTC offer...');
      const offer = await peerConnectionRef.current.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
      await peerConnectionRef.current.setLocalDescription(offer);
      addLog('Local description set, sending offer to remote peer');
      socket.emit('offer', { roomId, offer });
      addLog('Offer sent successfully');
    } catch (err) {
      const errorMsg = `Error creating offer: ${err.message}`;
      addLog(errorMsg, 'error');
      setError('Failed to create offer');
    }
  }, [roomId, socket, addLog]);
  const createAnswer = useCallback(async (offer) => {
    if (!peerConnectionRef.current) { addLog('Cannot create answer: peer connection not initialized', 'error'); return; }
    try {
      addLog('Received offer, creating answer...');
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      addLog('Remote description set from offer');
      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);
      addLog('Local description set, sending answer to remote peer');
      socket.emit('answer', { roomId, answer });
      addLog('Answer sent successfully');
    } catch (err) {
      const errorMsg = `Error creating answer: ${err.message}`;
      addLog(errorMsg, 'error');
      setError('Failed to create answer');
    }
  }, [roomId, socket, addLog]);
  const initializeWebRTC = useCallback(async () => {
    try {
      addLog('Starting WebRTC initialization...');
      const stream = await initializeMediaStream();
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;
      stream.getTracks().forEach(track => {
        addLog(`Adding ${track.kind} track to peer connection`);
        pc.addTrack(track, stream);
      });
      addLog('WebRTC initialized successfully, joining room...');
      socket.emit('join-room', roomId);
    } catch (err) {
      const errorMsg = `WebRTC initialization failed: ${err.message}`;
      addLog(errorMsg, 'error');
      setError('Failed to initialize video call. Please check your camera and microphone permissions.');
    }
  }, [roomId, socket, initializeMediaStream, createPeerConnection, addLog]);
  useEffect(() => {
    if (!socket) { addLog('Socket not available', 'error'); return; }
    addLog(`Setting up socket listeners for room: ${roomId}`);
    const handleUserJoined = (data) => {
      addLog(`User joined room: ${data.userId}`);
      if (data.userId !== socket.id) {
        setTimeout(() => { addLog('Initiating call as the caller...'); createOffer(); }, 1000);
      }
    };
    const handleOffer = (data) => { addLog(`Received offer from user: ${data.userId}`); createAnswer(data.offer); };
    const handleAnswer = async (data) => {
      addLog(`Received answer from user: ${data.userId}`);
      try {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          addLog('Remote description set from answer');
        }
      } catch (err) { addLog(`Error setting remote description: ${err.message}`, 'error'); }
    };
    const handleIceCandidate = async (data) => {
      addLog(`Received ICE candidate from user: ${data.userId}`);
      try {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          addLog('ICE candidate added successfully');
        }
      } catch (err) { addLog(`Error adding ICE candidate: ${err.message}`, 'error'); }
    };
    const handleUserLeft = (data) => {
      addLog(`User left room: ${data.userId}`);
      setIsConnected(false);
      setRemoteUserConnected(false);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
    const handleMediaStateChange = (data) => {
      addLog(`Remote user media state changed: audio=${data.audio}, video=${data.video}`);
      setRemoteAudioEnabled(data.audio);
      setRemoteVideoEnabled(data.video);
      showUserInfoTemporarily();
    };
    socket.on('user-joined', handleUserJoined);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('user-left', handleUserLeft);
    socket.on('media-state-change', handleMediaStateChange);
    initializeWebRTC();
    return () => {
      addLog('Cleaning up socket listeners...');
      socket.off('user-joined', handleUserJoined);
      socket.off('offer', handleOffer);
      socket.off('answer', handleAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('user-left', handleUserLeft);
      socket.off('media-state-change', handleMediaStateChange);
    };
  }, [socket, roomId, createOffer, createAnswer, initializeWebRTC, addLog, showUserInfoTemporarily]);
  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
        addLog(`Audio ${audioTrack.enabled ? 'enabled' : 'disabled'}`);
        socket.emit('media-state-change', { roomId, audio: audioTrack.enabled, video: isVideoEnabled });
      }
    }
  }, [addLog, socket, roomId, isVideoEnabled]);
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
        addLog(`Video ${videoTrack.enabled ? 'enabled' : 'disabled'}`);
        socket.emit('media-state-change', { roomId, audio: isAudioEnabled, video: videoTrack.enabled });
      }
    }
  }, [addLog, socket, roomId, isAudioEnabled]);
  const endCall = useCallback(() => {
    addLog('Ending call and cleaning up...');
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        addLog(`Stopped ${track.kind} track`);
      });
    }
    if (peerConnectionRef.current) { peerConnectionRef.current.close(); addLog('Peer connection closed'); }
    if (userInfoTimeoutRef.current) clearTimeout(userInfoTimeoutRef.current);
    if (socket) { socket.emit('leave-room', roomId); addLog('Left room via socket'); }
    onLeaveRoom();
  }, [roomId, socket, onLeaveRoom, addLog]);
  useEffect(() => {
    return () => {
      addLog('Component unmounting, cleaning up resources...');
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop());
      if (peerConnectionRef.current) peerConnectionRef.current.close();
      if (userInfoTimeoutRef.current) clearTimeout(userInfoTimeoutRef.current);
    };
  }, [addLog]);
  const getConnectionStatusColor = () => {
    switch (connectionState) {
      case 'connected': return '#10b981';
      case 'connecting': return '#f59e0b';
      case 'failed': return '#ef4444';
      default: return '#6b7280';
    }
  };
  const getParticipantAvatar = (name) => name.charAt(0).toUpperCase();

  return (
    <div className="video-call">
      {/* Header */}
      <div className="video-call-header">
        <div className="room-info">
          <div className="room-id">Room {roomId}</div>
          <div className="connection-state">
            <div 
              className={`connection-indicator ${connectionState}`}
              style={{ backgroundColor: getConnectionStatusColor() }}
            />
            {connectionState}
          </div>
        </div>
        
        <div className="header-controls">
          <button
            onClick={() => setShowDebugLogs(!showDebugLogs)}
            className="debug-toggle"
          >
            Debug {showDebugLogs ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
      
      {/* Error Display */}
      {error && (
        <div className="error-banner">
          <AlertCircle className="error-icon" />
          {error}
        </div>
      )}
      
      {/* Video Content - Full Screen */}
      <div className="video-content">
        <div className="main-video-area">
          {/* Remote Video - Full Screen */}
          <div className="remote-video-fullscreen">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="video-element"
              style={{ display: remoteUserConnected && remoteVideoEnabled ? 'block' : 'none' }}
            />
            
            {!remoteUserConnected && (
              <div className="waiting-state">
                <Users className="waiting-icon" />
                <h3>Waiting for another user...</h3>
                <p>Share room ID: <strong>{roomId}</strong></p>
              </div>
            )}
            
            {remoteUserConnected && !remoteVideoEnabled && (
              <div className="remote-video-off">
                <VideoOff className="video-off-icon" />
                <p>Camera is off</p>
              </div>
            )}
          </div>
          
          {/* Local Video - Draggable PiP Style */}
          <div 
            ref={localVideoPipRef}
            className={`local-video-pip ${isDragging ? 'dragging' : ''}`}
            style={{
              transform: `translate(${pipPosition.x}px, ${pipPosition.y}px)`,
            }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
          >
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="video-element"
              style={{ display: isVideoEnabled ? 'block' : 'none' }}
            />
            
            {!isAudioEnabled && (
              <div className="local-mute-indicator">
                <MicOff size={16} />
              </div>
            )}
            
            {!isVideoEnabled && (
              <div className="local-video-off">
                <VideoOff className="video-off-icon" />
                <span>You</span>
              </div>
            )}
          </div>
          
          {remoteUserConnected && (
            <div className={`user-info-overlay ${!showUserInfo ? 'hidden' : ''}`}>
              <div className="user-info-avatar">
                {getParticipantAvatar(remoteUserName)}
              </div>
              <div className="user-info-details">
                <div className="user-name">{remoteUserName}</div>
                <div className="user-status">
                  <div 
                    className={`connection-indicator ${connectionState}`}
                    style={{ backgroundColor: getConnectionStatusColor() }}
                  />
                  {isConnected ? 'Connected' : 'Connecting...'}
                  {!remoteAudioEnabled && ' • Muted'}
                  {!remoteVideoEnabled && ' • Camera off'}
                </div>
              </div>
            </div>
          )}
          
          <div className="video-controls">
            <div className="controls-container">
              <button
                onClick={toggleAudio}
                className={`control-button ${!isAudioEnabled ? 'disabled' : ''}`}
                title={isAudioEnabled ? 'Mute' : 'Unmute'}
              >
                {isAudioEnabled ? <Mic /> : <MicOff />}
              </button>
              
              <button
                onClick={toggleVideo}
                className={`control-button ${!isVideoEnabled ? 'disabled' : ''}`}
                title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
              >
                {isVideoEnabled ? <Video /> : <VideoOff />}
              </button>
              
              <button
                onClick={endCall}
                className="control-button end-call"
                title="End call"
              >
                <PhoneOff />
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <DebugLogger 
        logs={logs} 
        isVisible={showDebugLogs} 
        onClose={() => setShowDebugLogs(false)}
      />
    </div>
  );
};

export default VideoCall;