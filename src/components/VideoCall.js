import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Users, AlertCircle } from 'lucide-react';
import DebugLogger from './DebugLogger';

// WebRTC Configuration with STUN servers
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.stunprotocol.org:3478' }
  ]
};


const VideoCall = ({ roomId, onLeaveRoom, socket }) => {
  // Refs for video elements and WebRTC
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  
  // State management
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState('connecting');
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const [remoteUserConnected, setRemoteUserConnected] = useState(false);
  
  // Debug logging function
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${message}`);
    setLogs(prev => [...prev.slice(-20), { message, timestamp, type }]);
  }, []);
  
  // Initialize media stream
  const initializeMediaStream = useCallback(async () => {
    try {
      addLog('Requesting media permissions...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          facingMode: 'user'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        }
      });
      
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      addLog('Local media stream initialized successfully');
      return stream;
    } catch (err) {
      const errorMsg = `Media access error: ${err.message}`;
      addLog(errorMsg, 'error');
      setError(`Cannot access camera/microphone: ${err.message}`);
      throw err;
    }
  }, [addLog]);
  
  // Create peer connection
  const createPeerConnection = useCallback(() => {
    addLog('Creating peer connection with ICE servers...');
    const pc = new RTCPeerConnection(ICE_SERVERS);
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addLog('Sending ICE candidate');
        socket.emit('ice-candidate', {
          roomId,
          candidate: event.candidate
        });
      } else {
        addLog('ICE candidate gathering completed');
      }
    };
    
    // Handle remote stream
    pc.ontrack = (event) => {
      addLog('Received remote stream');
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        setRemoteUserConnected(true);
      }
    };
    
    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      addLog(`Connection state changed: ${state}`);
      setConnectionState(state);
      
      switch (state) {
        case 'connected':
          setIsConnected(true);
          setError(null);
          addLog('WebRTC connection established successfully!', 'success');
          break;
        case 'disconnected':
          setIsConnected(false);
          setRemoteUserConnected(false);
          addLog('WebRTC connection disconnected');
          break;
        case 'failed':
          setIsConnected(false);
          setRemoteUserConnected(false);
          addLog('WebRTC connection failed', 'error');
          setError('Connection failed. Please try again.');
          break;
        case 'closed':
          setIsConnected(false);
          setRemoteUserConnected(false);
          addLog('WebRTC connection closed');
          break;
        default:
          break;
      }
    };
    
    // Handle ICE connection state changes
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      addLog(`ICE connection state: ${state}`);
      
      if (state === 'failed') {
        addLog('ICE connection failed, attempting restart...', 'error');
        pc.restartIce();
      }
    };
    
    // Handle ICE gathering state changes
    pc.onicegatheringstatechange = () => {
      addLog(`ICE gathering state: ${pc.iceGatheringState}`);
    };
    
    return pc;
  }, [roomId, socket, addLog]);
  
  // Handle offer creation and sending
  const createOffer = useCallback(async () => {
    if (!peerConnectionRef.current) {
      addLog('Cannot create offer: peer connection not initialized', 'error');
      return;
    }
    
    try {
      addLog('Creating WebRTC offer...');
      const offer = await peerConnectionRef.current.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true
      });
      
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
  
  // Handle answer creation and sending
  const createAnswer = useCallback(async (offer) => {
    if (!peerConnectionRef.current) {
      addLog('Cannot create answer: peer connection not initialized', 'error');
      return;
    }
    
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
  
  // Initialize WebRTC connection
  const initializeWebRTC = useCallback(async () => {
    try {
      addLog('Starting WebRTC initialization...');
      
      // Get media stream first
      const stream = await initializeMediaStream();
      
      // Create peer connection
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;
      
      // Add local stream tracks to peer connection
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
  
  // Setup socket event listeners
  useEffect(() => {
    if (!socket) {
      addLog('Socket not available', 'error');
      return;
    }
    
    addLog(`Setting up socket listeners for room: ${roomId}`);
    
    // Socket event handlers
    const handleUserJoined = (data) => {
      addLog(`User joined room: ${data.userId}`);
      // If we're not the user who just joined, create an offer
      if (data.userId !== socket.id) {
        setTimeout(() => {
          addLog('Initiating call as the caller...');
          createOffer();
        }, 1000); // Small delay to ensure both peers are ready
      }
    };
    
    const handleOffer = (data) => {
      addLog(`Received offer from user: ${data.userId}`);
      createAnswer(data.offer);
    };
    
    const handleAnswer = async (data) => {
      addLog(`Received answer from user: ${data.userId}`);
      try {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          addLog('Remote description set from answer');
        }
      } catch (err) {
        addLog(`Error setting remote description: ${err.message}`, 'error');
      }
    };
    
    const handleIceCandidate = async (data) => {
      addLog(`Received ICE candidate from user: ${data.userId}`);
      try {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          addLog('ICE candidate added successfully');
        }
      } catch (err) {
        addLog(`Error adding ICE candidate: ${err.message}`, 'error');
      }
    };
    
    const handleUserLeft = (data) => {
      addLog(`User left room: ${data.userId}`);
      setIsConnected(false);
      setRemoteUserConnected(false);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    };
    
    const handleRoomError = (data) => {
      const errorMsg = `Room error: ${data.message}`;
      addLog(errorMsg, 'error');
      setError(data.message);
    };
    
    const handleSocketError = (error) => {
      const errorMsg = `Socket error: ${error.message}`;
      addLog(errorMsg, 'error');
      setError('Connection error occurred');
    };
    
    const handleConnect = () => {
      addLog('Socket connected successfully');
    };
    
    const handleDisconnect = (reason) => {
      addLog(`Socket disconnected: ${reason}`, 'error');
      setError('Lost connection to server');
    };
    
    // Register socket listeners
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('error', handleSocketError);
    socket.on('user-joined', handleUserJoined);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('user-left', handleUserLeft);
    socket.on('room-error', handleRoomError);
    
    // Initialize WebRTC
    initializeWebRTC();
    
    // Cleanup function
    return () => {
      addLog('Cleaning up socket listeners...');
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('error', handleSocketError);
      socket.off('user-joined', handleUserJoined);
      socket.off('offer', handleOffer);
      socket.off('answer', handleAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('user-left', handleUserLeft);
      socket.off('room-error', handleRoomError);
    };
  }, [socket, roomId, createOffer, createAnswer, initializeWebRTC, addLog]);
  
  // Toggle audio
  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
        addLog(`Audio ${audioTrack.enabled ? 'enabled' : 'disabled'}`);
      }
    }
  }, [addLog]);
  
  // Toggle video
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
        addLog(`Video ${videoTrack.enabled ? 'enabled' : 'disabled'}`);
      }
    }
  }, [addLog]);
  
  // End call
  const endCall = useCallback(() => {
    addLog('Ending call and cleaning up...');
    
    // Stop local media tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        addLog(`Stopped ${track.kind} track`);
      });
    }
    
    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      addLog('Peer connection closed');
    }
    
    // Leave room via socket
    if (socket) {
      socket.emit('leave-room', roomId);
      addLog('Left room via socket');
    }
    
    // Reset state and leave room
    onLeaveRoom();
  }, [roomId, socket, onLeaveRoom, addLog]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      addLog('Component unmounting, cleaning up resources...');
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, [addLog]);
  
  // Connection status indicator
  const getConnectionStatusColor = () => {
    switch (connectionState) {
      case 'connected': return '#10b981'; // green
      case 'connecting': return '#f59e0b'; // yellow
      case 'failed': return '#ef4444'; // red
      default: return '#6b7280'; // gray
    }
  };
  
  return (
    <div className="video-call">
      {/* Header */}
      <div className="video-call-header">
        <div className="room-info">
          <div 
            className="connection-indicator"
            style={{ backgroundColor: getConnectionStatusColor() }}
          ></div>
          <span className="room-id">Room: {roomId}</span>
          <span className="connection-state">({connectionState})</span>
        </div>
        <button
          onClick={() => setShowDebugLogs(!showDebugLogs)}
          className="debug-toggle"
        >
          Debug {showDebugLogs ? 'ON' : 'OFF'}
        </button>
      </div>
      
      {/* Error Display */}
      {error && (
        <div className="error-banner">
          <AlertCircle className="error-icon" />
          {error}
        </div>
      )}
      
      {/* Video Grid */}
      <div className="video-grid">
        {/* Local Video */}
        <div className="video-container local-video">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="video-element"
          />
          <div className="video-label">
            You {!isVideoEnabled && '(Video Off)'}
          </div>
          {!isVideoEnabled && (
            <div className="video-placeholder">
              <VideoOff className="placeholder-icon" />
            </div>
          )}
        </div>
        
        {/* Remote Video */}
        <div className="video-container remote-video">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="video-element"
          />
          <div className="video-label">
            {remoteUserConnected ? 'Remote User' : 'Waiting for user...'}
          </div>
          {!remoteUserConnected && (
            <div className="video-placeholder">
              <Users className="placeholder-icon" />
              <p className="placeholder-text">Waiting for another user to join...</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Controls */}
      <div className="video-controls">
        <div className="controls-container">
          {/* Audio Toggle */}
          <button
            onClick={toggleAudio}
            className={`control-button ${!isAudioEnabled ? 'disabled' : ''}`}
            title={isAudioEnabled ? 'Mute' : 'Unmute'}
          >
            {isAudioEnabled ? <Mic /> : <MicOff />}
          </button>
          
          {/* Video Toggle */}
          <button
            onClick={toggleVideo}
            className={`control-button ${!isVideoEnabled ? 'disabled' : ''}`}
            title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            {isVideoEnabled ? <Video /> : <VideoOff />}
          </button>
          
          {/* End Call */}
          <button
            onClick={endCall}
            className="control-button end-call"
            title="End call"
          >
            <PhoneOff />
          </button>
        </div>
      </div>
      
      {/* Debug Logger */}
      <DebugLogger logs={logs} isVisible={showDebugLogs} />
    </div>
  );
};

export default VideoCall;