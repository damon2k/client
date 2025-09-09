import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Video, VideoOff, Mic, MicOff, PhoneOff, Users, AlertCircle, 
  ScreenShare, Signal, Clapperboard 
} from 'lucide-react';
import DebugLogger from './DebugLogger';

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
  // Refs
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const userInfoTimeoutRef = useRef(null);
  const localVideoPipRef = useRef(null);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, pipX: 0, pipY: 0 });
  const statsIntervalRef = useRef(null);
  
  // State
  const [isDragging, setIsDragging] = useState(false);
  const [pipPosition, setPipPosition] = useState({ x: 0, y: 0 });
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
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [connectionStats, setConnectionStats] = useState(null);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);

  // Auto-hide error message after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Utility and Logging Functions
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

  // Draggable PiP Logic
  const handleDragStart = useCallback((clientX, clientY) => {
    setIsDragging(true);
    dragStartRef.current = { mouseX: clientX, mouseY: clientY, pipX: pipPosition.x, pipY: pipPosition.y };
  }, [pipPosition]);
  const handleDragMove = useCallback((clientX, clientY) => {
    if (!isDragging) return;
    const dx = clientX - dragStartRef.current.mouseX;
    const dy = clientY - dragStartRef.current.mouseY;
    setPipPosition({ x: dragStartRef.current.pipX + dx, y: dragStartRef.current.pipY + dy });
  }, [isDragging]);
  const handleDragEnd = useCallback(() => setIsDragging(false), []);
  const handleMouseDown = (e) => { e.preventDefault(); handleDragStart(e.clientX, e.clientY); };
  const handleMouseMove = useCallback((e) => handleDragMove(e.clientX, e.clientY), [handleDragMove]);
  const handleTouchStart = (e) => { const touch = e.touches[0]; handleDragStart(touch.clientX, touch.clientY); };
  const handleTouchMove = useCallback((e) => handleDragMove(e.touches[0].clientX, e.touches[0].clientY), [handleDragMove]);

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

  // Screen Sharing Logic
  const stopScreenShare = useCallback(async () => {
    if (!peerConnectionRef.current || !localStreamRef.current) return;
    addLog('Stopping screen share and reverting to camera.');
    const cameraTrack = localStreamRef.current.getVideoTracks()[0];
    const sender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(cameraTrack);
    
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (localVideoRef.current) localVideoRef.current.srcObject = new MediaStream(audioTrack ? [cameraTrack, audioTrack] : [cameraTrack]);
    
    setIsScreenSharing(false);
    socket.emit('screen-share-change', { roomId, isSharing: false });
  }, [addLog, roomId, socket]);

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      await stopScreenShare();
      return;
    }
    if (!navigator.mediaDevices.getDisplayMedia) {
      const msg = 'Screen sharing is not supported by your browser.';
      addLog(msg, 'error');
      setError(msg);
      return;
    }
    try {
      addLog('Starting screen share...');
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      const sender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(screenTrack);
      
      if (localVideoRef.current) localVideoRef.current.srcObject = new MediaStream([screenTrack]);
      setIsScreenSharing(true);
      socket.emit('screen-share-change', { roomId, isSharing: true });
      screenTrack.onended = stopScreenShare;
    } catch (err) {
      const errorMsg = `Screen sharing failed: ${err.message}`;
      addLog(errorMsg, 'error');
      setError('Could not start screen sharing.');
    }
  };

  // WebRTC Core Logic
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
    pc.onicecandidate = (event) => { if (event.candidate) socket.emit('ice-candidate', { roomId, candidate: event.candidate }); };
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
        case 'connected': setIsConnected(true); setError(null); addLog('WebRTC connection established!', 'success'); showUserInfoTemporarily(); break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          setIsConnected(false);
          setRemoteUserConnected(false);
          break;
        default: break;
      }
    };
    return pc;
  }, [roomId, socket, addLog, showUserInfoTemporarily]);
  
  // Initialize WebRTC and set up socket listeners
  useEffect(() => {
    if (!socket) return;
    
    const initialize = async () => {
      try {
        const stream = await initializeMediaStream();
        const pc = createPeerConnection();
        peerConnectionRef.current = pc;
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        socket.emit('join-room', roomId);
      } catch (err) { addLog(`WebRTC initialization failed: ${err.message}`, 'error'); }
    };
    const createOffer = async () => {
      if (!peerConnectionRef.current) return;
      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      socket.emit('offer', { roomId, offer });
    };
    const createAnswer = async (offer) => {
      if (!peerConnectionRef.current) return;
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);
      socket.emit('answer', { roomId, answer });
    };

    const handleUserJoined = (data) => { addLog(`User joined: ${data.userId}`); createOffer(); };
    const handleOffer = (data) => createAnswer(data.offer);
    const handleAnswer = (data) => peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(data.answer));
    const handleIceCandidate = (data) => peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(data.candidate));
    const handleUserLeft = (data) => {
      addLog(`User left: ${data.userId}`);
      setRemoteUserConnected(false);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
    const handleMediaStateChange = (data) => { setRemoteAudioEnabled(data.audio); setRemoteVideoEnabled(data.video); showUserInfoTemporarily(); };
    const handleRemoteScreenShare = (data) => setIsRemoteScreenSharing(data.isSharing);

    socket.on('user-joined', handleUserJoined);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('user-left', handleUserLeft);
    socket.on('media-state-change', handleMediaStateChange);
    socket.on('remote-screen-share-changed', handleRemoteScreenShare);
    
    initialize();

    return () => {
      socket.off('user-joined');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('user-left');
      socket.off('media-state-change');
      socket.off('remote-screen-share-changed');
    };
  }, [socket, roomId, addLog, initializeMediaStream, createPeerConnection, showUserInfoTemporarily]);
  
  // --- CORRECTED Media Controls ---
  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
        socket.emit('media-state-change', {
          roomId,
          audio: audioTrack.enabled,
          video: isVideoEnabled,
        });
      }
    }
  }, [roomId, isVideoEnabled, socket]);

  const toggleVideo = useCallback(() => {
    if (isScreenSharing) return;
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
        socket.emit('media-state-change', {
          roomId,
          audio: isAudioEnabled,
          video: videoTrack.enabled,
        });
      }
    }
  }, [isScreenSharing, roomId, isAudioEnabled, socket]);

  const endCall = useCallback(() => {
    addLog('Ending call and cleaning up...');
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (peerConnectionRef.current) peerConnectionRef.current.close();
    if (socket) socket.emit('leave-room', roomId);
    onLeaveRoom();
  }, [roomId, socket, onLeaveRoom, addLog]);

  // --- Stats Polling ---
  const getNetworkQuality = (rtt) => {
    if (rtt < 150) return 'Excellent';
    if (rtt < 300) return 'Good';
    if (rtt < 500) return 'Fair';
    return 'Poor';
  };

  useEffect(() => {
    if (isConnected && peerConnectionRef.current) {
      statsIntervalRef.current = setInterval(async () => {
        if (!peerConnectionRef.current) return;
        const statsReport = await peerConnectionRef.current.getStats();
        let newStats = {};
        statsReport.forEach(report => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') newStats.video = { width: report.frameWidth, height: report.frameHeight, fps: report.framesPerSecond };
          if (report.type === 'candidate-pair' && report.state === 'succeeded') newStats.network = { rtt: report.currentRoundTripTime * 1000, quality: getNetworkQuality(report.currentRoundTripTime * 1000) };
        });
        setConnectionStats(newStats);
      }, 2000);
    } else {
      clearInterval(statsIntervalRef.current);
    }
    return () => clearInterval(statsIntervalRef.current);
  }, [isConnected]);

  // --- Component Cleanup ---
  useEffect(() => {
    return () => {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop());
      if (peerConnectionRef.current) peerConnectionRef.current.close();
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, []);
  
  const getConnectionStatusColor = () => { /* ... unchanged ... */ };
  const getParticipantAvatar = (name) => name.charAt(0).toUpperCase();

  // --- Render JSX ---
  const mainVideoStream = isScreenSharing ? localStreamRef.current : (remoteVideoRef.current ? remoteVideoRef.current.srcObject : null);
  const pipVideoStream = isScreenSharing ? (remoteVideoRef.current ? remoteVideoRef.current.srcObject : null) : localStreamRef.current;
  const isPipMuted = !isScreenSharing;
  const pipUserLabel = isScreenSharing ? remoteUserName : 'You';
  const pipAudioMuted = isScreenSharing ? !remoteAudioEnabled : !isAudioEnabled;
  const pipVideoOff = isScreenSharing ? !remoteVideoEnabled : !isVideoEnabled;

  return (
    <div className="video-call">
        <div className="video-call-header">
            <div className="room-info">
                <div className="room-id">Room {roomId}</div>
                <div className="connection-state">
                    <div className={`connection-indicator ${connectionState}`} style={{ backgroundColor: getConnectionStatusColor() }} />
                    {connectionState}
                </div>
            </div>
            <div className="header-controls">
                {connectionStats && isConnected && (
                    <div className="call-stats-container">
                        {connectionStats.network && (
                            <div className="stat-item" title={`Round Trip Time: ${connectionStats.network.rtt.toFixed(0)}ms`}>
                                <Signal size={14} /> {connectionStats.network.quality}
                            </div>
                        )}
                        {connectionStats.video && (
                            <div className="stat-item" title={`Frames Per Second: ${connectionStats.video.fps || 0}`}>
                                <Clapperboard size={14} /> {connectionStats.video.width}x{connectionStats.video.height}
                            </div>
                        )}
                    </div>
                )}
                <button onClick={() => setShowDebugLogs(!showDebugLogs)} className="debug-toggle">
                    Debug {showDebugLogs ? 'ON' : 'OFF'}
                </button>
            </div>
        </div>

        {error && <div className="error-banner"><AlertCircle className="error-icon" />{error}</div>}

        <div className="video-content">
            <div className="main-video-area">
                <div className="remote-video-fullscreen">
                    <video ref={remoteVideoRef} srcObject={mainVideoStream} autoPlay playsInline className="video-element" style={{ display: remoteUserConnected ? 'block' : 'none' }} />
                    {!remoteUserConnected && (
                        <div className="waiting-state">
                            <div className="waiting-icon">
                              <Users size={40} />
                              </div>
                            <h3>Waiting for another user...</h3>
                            <p>Share room ID: <strong>{roomId}</strong></p>
                        </div>
                    )}
                    {remoteUserConnected && !remoteVideoEnabled && !isScreenSharing && !isRemoteScreenSharing && (
                        <div className="remote-video-off"><VideoOff className="video-off-icon" /><p>Camera is off</p></div>
                    )}
                </div>

                <div ref={localVideoPipRef} className={`local-video-pip ${isDragging ? 'dragging' : ''}`} style={{ transform: `translate(${pipPosition.x}px, ${pipPosition.y}px)` }} onMouseDown={handleMouseDown} onTouchStart={handleTouchStart}>
                    <video ref={localVideoRef} srcObject={pipVideoStream} autoPlay muted={isPipMuted} playsInline className="video-element" style={{ display: (isScreenSharing && remoteUserConnected) || !isScreenSharing ? 'block' : 'none' }} />
                    {pipAudioMuted && (<div className="local-mute-indicator"><MicOff size={16} /></div>)}
                    {pipVideoOff && (
                        <div className="local-video-off">
                            <VideoOff className="video-off-icon" />
                            <span>{pipUserLabel}</span>
                        </div>
                    )}
                </div>

                {remoteUserConnected && (
                    <div className={`user-info-overlay ${!showUserInfo ? 'hidden' : ''}`}>
                        <div className="user-info-avatar">{getParticipantAvatar(remoteUserName)}</div>
                        <div className="user-info-details">
                            <div className="user-name">{remoteUserName}</div>
                            <div className="user-status">
                                <div className={`connection-indicator ${connectionState}`} style={{ backgroundColor: getConnectionStatusColor() }} />
                                {isConnected ? 'Connected' : 'Connecting...'}
                                {!remoteAudioEnabled && ' • Muted'}
                                {!remoteVideoEnabled && ' • Camera off'}
                            </div>
                        </div>
                    </div>
                )}

                <div className="video-controls">
                    <div className="controls-container">
                        <button onClick={toggleAudio} className={`control-button ${!isAudioEnabled ? 'disabled' : ''}`} title={isAudioEnabled ? 'Mute' : 'Unmute'}>
                            {isAudioEnabled ? <Mic /> : <MicOff />}
                        </button>
                        <button onClick={toggleVideo} className={`control-button ${!isVideoEnabled ? 'disabled' : ''}`} disabled={isScreenSharing} title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}>
                            {isVideoEnabled ? <Video /> : <VideoOff />}
                        </button>
                        <button onClick={toggleScreenShare} className={`control-button ${isScreenSharing ? 'active' : ''}`} title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}>
                            <ScreenShare />
                        </button>
                        <button onClick={endCall} className="control-button end-call" title="End call">
                            <PhoneOff />
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <DebugLogger logs={logs} isVisible={showDebugLogs} onClose={() => setShowDebugLogs(false)} />
    </div>
  );
};

export default VideoCall;