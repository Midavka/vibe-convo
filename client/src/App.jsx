import React, { useState, useRef, useEffect, useCallback } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:3001');

const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function App() {
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoStopped, setIsVideoStopped] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [partnerId, setPartnerId] = useState(null);
  const myVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);

  const createPeerConnection = useCallback((partnerSocketId) => {
    if (peerConnectionRef.current) peerConnectionRef.current.close();
    const pc = new RTCPeerConnection(configuration);
    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { target: partnerSocketId, candidate: event.candidate });
      }
    };
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }
    peerConnectionRef.current = pc;
    return pc;
  }, []);
  
  const findNextCallback = useCallback(() => {
    if (peerConnectionRef.current) peerConnectionRef.current.close();
    peerConnectionRef.current = null;
    setPartnerId(null);
    if(remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    socket.emit('join');
  }, []);

  useEffect(() => {
    socket.on('partner_found', async (data) => {
      setPartnerId(data.partnerId);
      const pc = createPeerConnection(data.partnerId);
      if (socket.id > data.partnerId) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { target: data.partnerId, sdp: pc.localDescription });
      }
    });
    socket.on('offer', async (data) => {
      setPartnerId(data.source);
      const pc = createPeerConnection(data.source);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { target: data.source, sdp: pc.localDescription });
    });
    socket.on('answer', async (data) => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
    });
    socket.on('ice-candidate', async (data) => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });
    socket.on('partner_hangup', () => findNextCallback());
    return () => {
      socket.off('partner_found');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('partner_hangup');
    };
  }, [createPeerConnection, findNextCallback]);

  const startChat = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setIsStarted(true);
      localStreamRef.current = stream;
      if (myVideoRef.current) myVideoRef.current.srcObject = stream;
      socket.emit('join');
    } catch (err) {
      alert("Нужен доступ к камере, чтобы начать!");
    }
  };

  const findNext = () => {
    socket.emit('hangup');
    findNextCallback();
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsAudioMuted(prev => !prev);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoStopped(prev => !prev);
    }
  };

  return (
    <div className="container">
      <h1>Vibe Convo 🔮</h1>
      <div className="video-grid">
        <div className="video-box remote-video">
          <video ref={remoteVideoRef} autoPlay playsInline />
          <div className="status-text">
            {!isStarted && <p>Нажмите "Старт"</p>}
            {isStarted && !partnerId && <p>Поиск...</p>}
            {isStarted && partnerId && <span>Собеседник</span>}
          </div>
        </div>
        <div className="video-box local-video">
          <video ref={myVideoRef} autoPlay playsInline muted style={{ display: isVideoStopped ? 'none' : 'block' }} />
          {isVideoStopped && <p style={{fontSize: '1.5rem'}}>Камера выкл.</p>}
          
          {/* --- ИЗМЕНЕНИЕ ЗДЕСЬ --- */}
          {isStarted && (
            <span className="audio-status-badge">
              {isAudioMuted ? '🔇 Звук выкл.' : '🎤 Звук вкл.'}
            </span>
          )}
          
          <span>Вы</span>
        </div>
      </div>
      <div className="controls">
        {!isStarted ? (
          <button className="btn start" onClick={startChat}>СТАРТ</button>
        ) : (
          <div className="active-controls">
            <button className={`media-btn ${isAudioMuted ? 'off' : ''}`} onClick={toggleAudio}>
              {isAudioMuted ? 'Вкл. звук' : 'Выкл. звук'}
            </button>
            <button className={`media-btn ${isVideoStopped ? 'off' : ''}`} onClick={toggleVideo}>
              {isVideoStopped ? 'Вкл. видео' : 'Выкл. видео'}
            </button>
            <button className="btn next" onClick={findNext}>СЛЕДУЮЩИЙ</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
