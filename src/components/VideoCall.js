import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Users, AlertCircle, Settings, Wifi } from 'lucide-react';
import DebugLogger from './DebugLogger';

// WebRTC Configuration with STUN and TURN servers
const ICE_SERVERS = {
  iceServers: [
    // Your TURN server from the screenshot
    {
      urls: 'stun:16.16.71.145:3478'
    },
    {
      urls: 'turn:16.16.71.145:3478',
      username: 'testuser',
      credential: 'a4216be4368cfd6d3c87e060a4b08fd0fa1718762ca42675f107647b7c224488'
    },
    // Backup STUN servers
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
  const statsInterval = useRef(null);
  
  // State management
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState('connecting');
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const [remoteUserConnected, setRemoteUserConnected] = useState(false);
  
  // Network and quality stats
  const [networkStats, setNetworkStats] = useState({
    bandwidth: 0,
    packetLoss: 0,
    latency: 0,
    videoResolution: '',
    frameRate: 0,
    networkStrength: 4 // 0-4 bars
  });
  
  // Remote user states
  const [remoteAudioEnabled, setRemoteAudioEnabled] = useState(true);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(true);
  
  // Participants (for future expansion)
  const [participants] = useState([
    { id: 'local', name: 'You (Host)', status: 'Connected', isLocal: true }
  ]);
  
  // Debug logging function
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${message}`);
    setLogs(prev => [...prev.slice(-20), { message, timestamp, type }]);
  }, []);
  
  // Network strength calculation based on stats
  const calculateNetworkStrength = useCallback((stats) => {
    const { bandwidth, packetLoss, latency } = stats;
    let strength = 4;
    
    // Reduce strength based on packet loss
    if (packetLoss > 5) strength = Math.min(strength, 2);
    else if (packetLoss > 2) strength = Math.min(strength, 3);
    
    // Reduce strength based on latency
    if (latency > 300) strength = Math.min(strength, 1);
    else if (latency > 150) strength = Math.min(strength, 2);
    else if (latency > 100) strength = Math.min(strength, 3);
    
    // Reduce strength based on bandwidth
    if (bandwidth < 100) strength = Math.min(strength, 1);
    else if (bandwidth < 500) strength = Math.min(strength, 2);
    else if (bandwidth < 1000) strength = Math.min(strength, 3);
    
    return Math.max(strength, 1); // Minimum 1 bar
  }, []);
  
  // Get WebRTC stats
  const getWebRTCStats = useCallback(async () => {
    if (!peerConnectionRef.current || connectionState !== 'connected') return;
    
    try {
      const stats = await peerConnectionRef.current.getStats();
      let bandwidth = 0, packetLoss = 0, latency = 0;
      let videoResolution = '', frameRate = 0;
      
      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
          bandwidth = Math.round((report.bytesReceived * 8) / 1000); // Convert to kbps
          frameRate = report.framesPerSecond || 0;
          if (report.frameWidth && report.frameHeight) {
            videoResolution = `${report.frameWidth}x${report.frameHeight}`;
          }
        }
        
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          latency = report.currentRoundTripTime ? Math.round(report.currentRoundTripTime * 1000) : 0;
        }
        
        if (report.type === 'transport') {
          packetLoss = report.packetsLost ? (report.packetsLost / report.packetsSent) * 100 : 0;
        }
      });
      
      const newStats = {
        bandwidth,
        packetLoss: Math.round(packetLoss * 100) / 100,
        latency,
        videoResolution,
        frameRate: Math.round(frameRate),
        networkStrength: calculateNetworkStrength({ bandwidth, packetLoss, latency })
      };
      
      setNetworkStats(newStats);
    } catch (error) {
      addLog(`Error getting WebRTC stats: ${error.message}`, 'error');
    }
  }, [connectionState, addLog, calculateNetworkStrength]);
  
  // Start stats monitoring
  useEffect(() => {
    if (isConnected && remoteUserConnected) {
      statsInterval.current = setInterval(getWebRTCStats, 2000);
      addLog('Started WebRTC stats monitoring');
    } else {
      if (statsInterval.current) {
        clearInterval(statsInterval.current);
        statsInterval.current = null;
      }
    }
    
    return () => {
      if (statsInterval.current) {
        clearInterval(statsInterval.current);
      }
    };
  }, [isConnected, remoteUserConnected, getWebRTCStats, addLog]);
  
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
    addLog('Creating peer connection with TURN server...');
    addLog(`Using TURN server: turn:16.16.71.145:3478`);
    const pc = new RTCPeerConnection(ICE_SERVERS);
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidateStr = event.candidate.candidate;
        if (candidateStr.includes('typ relay')) {
          addLog('✅ TURN relay candidate generated!', 'success');
        } else if (candidateStr.includes('typ srflx')) {
          addLog('STUN server reflexive candidate generated');
        } else if (candidateStr.includes('typ host')) {
          addLog('Host candidate generated');
        }
        
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
      } else if (state === 'connected') {
        addLog('✅ ICE connection established!', 'success');
      }
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
      addLog('Starting WebRTC initialization with TURN server...');
      
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
  
  // Setup socket event listeners
  useEffect(() => {
    if (!socket) {
      addLog('Socket not available', 'error');
      return;
    }
    
    addLog(`Setting up socket listeners for room: ${roomId}`);
    
    const handleUserJoined = (data) => {
      addLog(`User joined room: ${data.userId}`);
      if (data.userId !== socket.id) {
        setTimeout(() => {
          addLog('Initiating call as the caller...');
          createOffer();
        }, 1000);
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
    
    const handleMediaStateChange = (data) => {
      addLog(`Remote user media state changed: audio=${data.audio}, video=${data.video}`);
      setRemoteAudioEnabled(data.audio);
      setRemoteVideoEnabled(data.video);
    };
    
    // Register socket listeners
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
  }, [socket, roomId, createOffer, createAnswer, initializeWebRTC, addLog]);
  
  // Toggle audio
  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
        addLog(`Audio ${audioTrack.enabled ? 'enabled' : 'disabled'}`);
        
        // Notify remote user of audio state change
        socket.emit('media-state-change', {
          roomId,
          audio: audioTrack.enabled,
          video: isVideoEnabled
        });
      }
    }
  }, [addLog, socket, roomId, isVideoEnabled]);
  
  // Toggle video
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
        addLog(`Video ${videoTrack.enabled ? 'enabled' : 'disabled'}`);
        
        // Notify remote user of video state change
        socket.emit('media-state-change', {
          roomId,
          audio: isAudioEnabled,
          video: videoTrack.enabled
        });
      }
    }
  }, [addLog, socket, roomId, isAudioEnabled]);
  
  // End call
  const endCall = useCallback(() => {
    addLog('Ending call and cleaning up...');
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        addLog(`Stopped ${track.kind} track`);
      });
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      addLog('Peer connection closed');
    }
    
    if (statsInterval.current) {
      clearInterval(statsInterval.current);
    }
    
    if (socket) {
      socket.emit('leave-room', roomId);
      addLog('Left room via socket');
    }
    
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
      if (statsInterval.current) {
        clearInterval(statsInterval.current);
      }
    };
  }, [addLog]);
  
  // Connection status indicator
  const getConnectionStatusColor = () => {
    switch (connectionState) {
      case 'connected': return '#10b981';
      case 'connecting': return '#f59e0b';
      case 'failed': return '#ef4444';
      default: return '#6b7280';
    }
  };
  
  // Network bars component
  const NetworkBars = ({ strength }) => (
    <div className="network-bars">
      {[1, 2, 3, 4].map(bar => (
        <div
          key={bar}
          className={`network-bar ${bar <= strength ? 'active' : ''}`}
        />
      ))}
    </div>
  );
  
  // Get participant avatar (first letter of name)
  const getParticipantAvatar = (name) => {
    return name.charAt(0).toUpperCase();
  };
  
  // Get quality metric color
  const getQualityColor = (value, thresholds) => {
    if (value >= thresholds.good) return 'good';
    if (value <= thresholds.poor) return 'poor';
    return '';
  };
  
  return (
    <div className="video-call facetime-style">
      {/* Optional Navigation Sidebar */}
      <div className="nav-sidebar">
        {/* Navigation items can go here */}
      </div>
      
      {/* Main Content */}
      <div className="main-content">
        {/* Header */}
        <div className="video-call-header">
          <div className="room-info">
            <div 
              className={`connection-indicator ${connectionState}`}
              style={{ backgroundColor: getConnectionStatusColor() }}
            />
            <span className="room-id">Room: {roomId}</span>
            <span className="connection-state">({connectionState})</span>
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
        
        {/* Video Content */}
        <div className="video-content">
          {/* Main Video Area */}
          <div className="main-video-area">
            <div className="remote-video-fullscreen">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="video-element"
              />
              
              {/* Waiting state */}
              {!remoteUserConnected && (
                <div className="waiting-state">
                  <Users className="waiting-icon" />
                  <h3>Waiting for another user to join...</h3>
                  <p>Share the room ID: <strong>{roomId}</strong></p>
                </div>
              )}
              
              {/* Remote video off state */}
              {remoteUserConnected && !remoteVideoEnabled && (
                <div className="remote-video-off">
                  <VideoOff className="video-off-icon" />
                  <p>Camera is off</p>
                </div>
              )}
            </div>
            
            {/* Controls */}
            <div className="video-controls facetime-controls">
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
          
          {/* Right Sidebar */}
          <div className="right-sidebar">
            {/* Sidebar Header */}
            <div className="sidebar-header">
              <div className="sidebar-title">Meeting Room</div>
              <div className="sidebar-subtitle">Room ID: {roomId}</div>
            </div>
            
            {/* Local Video Preview */}
            <div className="local-video-section">
              <div className="local-video-label">Your Camera</div>
              <div className="local-video-preview">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="video-element"
                />
                
                {/* Local mute indicator */}
                {!isAudioEnabled && (
                  <div className="local-mute-indicator">
                    <MicOff size={16} />
                  </div>
                )}
                
                {/* Video off overlay */}
                {!isVideoEnabled && (
                  <div className="local-video-off">
                    <VideoOff className="video-off-icon" />
                    <span>You</span>
                  </div>
                )}
              </div>
            </div>
            
            {/* Connection Info */}
            {isConnected && remoteUserConnected && (
              <div className="connection-info">
                <div className="quality-metrics">
                  <div className="quality-metric">
                    <span className="quality-metric-label">Resolution:</span>
                    <span className="quality-metric-value">
                      {networkStats.videoResolution || 'N/A'}
                    </span>
                  </div>
                  
                  <div className="quality-metric">
                    <span className="quality-metric-label">Frame Rate:</span>
                    <span className="quality-metric-value">
                      {networkStats.frameRate > 0 ? `${networkStats.frameRate} fps` : 'N/A'}
                    </span>
                  </div>
                  
                  <div className="quality-metric">
                    <span className="quality-metric-label">Bandwidth:</span>
                    <span className={`quality-metric-value ${getQualityColor(networkStats.bandwidth, { good: 1000, poor: 500 })}`}>
                      {networkStats.bandwidth} kbps
                    </span>
                  </div>
                  
                  <div className="quality-metric">
                    <span className="quality-metric-label">Latency:</span>
                    <span className={`quality-metric-value ${getQualityColor(150 - networkStats.latency, { good: 100, poor: 50 })}`}>
                      {networkStats.latency > 0 ? `${networkStats.latency}ms` : 'N/A'}
                    </span>
                  </div>
                  
                  <div className="quality-metric">
                    <span className="quality-metric-label">Network:</span>
                    <div className="network-indicator">
                      <NetworkBars strength={networkStats.networkStrength} />
                      <span className="quality-metric-value">
                        {networkStats.networkStrength}/4 bars
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Participants Section */}
            <div className="participants-section">
              <div className="participants-list">
                {participants.map(participant => (
                  <div key={participant.id} className="participant-item">
                    <div className="participant-avatar">
                      {getParticipantAvatar(participant.name)}
                    </div>
                    <div className="participant-info">
                      <div className="participant-name">{participant.name}</div>
                      <div className="participant-status">{participant.status}</div>
                    </div>
                    <div className="participant-controls">
                      {participant.isLocal && (
                        <>
                          <button 
                            className={`participant-control-btn ${!isAudioEnabled ? 'muted' : ''}`}
                            title={isAudioEnabled ? 'Muted' : 'Unmuted'}
                          >
                            {isAudioEnabled ? <Mic size={16} /> : <MicOff size={16} />}
                          </button>
                          <button 
                            className={`participant-control-btn ${!isVideoEnabled ? 'muted' : ''}`}
                            title={isVideoEnabled ? 'Camera On' : 'Camera Off'}
                          >
                            {isVideoEnabled ? <Video size={16} /> : <VideoOff size={16} />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                
                {/* Remote participant */}
                {remoteUserConnected && (
                  <div className="participant-item">
                    <div className="participant-avatar">
                      G
                    </div>
                    <div className="participant-info">
                      <div className="participant-name">Guest</div>
                      <div className="participant-status">Connected</div>
                    </div>
                    <div className="participant-controls">
                      <button 
                        className={`participant-control-btn ${!remoteAudioEnabled ? 'muted' : ''}`}
                        title={remoteAudioEnabled ? 'Audio On' : 'Audio Off'}
                      >
                        {remoteAudioEnabled ? <Mic size={16} /> : <MicOff size={16} />}
                      </button>
                      <button 
                        className={`participant-control-btn ${!remoteVideoEnabled ? 'muted' : ''}`}
                        title={remoteVideoEnabled ? 'Camera On' : 'Camera Off'}
                      >
                        {remoteVideoEnabled ? <Video size={16} /> : <VideoOff size={16} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Debug Logger */}
      <DebugLogger logs={logs} isVisible={showDebugLogs} />
    </div>
  );
};

export default VideoCall;