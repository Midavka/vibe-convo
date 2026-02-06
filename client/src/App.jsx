import { useState, useRef, useEffect, useCallback } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io(import.meta.env.VITE_API_URL || 'https://vibeconvoserver.onrender.com', {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
});

const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

function App() {
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoStopped, setIsVideoStopped] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [partnerId, setPartnerId] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [currentCamera, setCurrentCamera] = useState(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [volume, setVolume] = useState(100);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [sessionTime, setSessionTime] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState('Поиск...');
  const [partnerAudioLevel, setPartnerAudioLevel] = useState(0);
  const [reactions, setReactions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [searchDots, setSearchDots] = useState('');

  const myVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const audioAnalyserRef = useRef(null);
  const animationFrameRef = useRef(null);

  // ---------- CONNECTION ----------
  const cleanupConnection = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setPartnerId(null);
    setConnectionStatus('Поиск...');
    stopAudioAnalyzer();
  };

  const stopLocalStream = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
  };

  // ---------- PEER ----------
  const createPeerConnection = useCallback((partnerSocketId) => {
    cleanupConnection();
    const pc = new RTCPeerConnection(configuration);
    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
        remoteVideoRef.current.volume = volume / 100;
        startAudioAnalyzer(event.streams[0]);
      }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) socket.emit('ice-candidate', { target: partnerSocketId, candidate: event.candidate });
    };
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    peerConnectionRef.current = pc;
    setConnectionStatus('Подключен');
    return pc;
  }, [volume]);

  const findNextCallback = useCallback(() => {
    cleanupConnection();
    socket.emit('join');
  }, []);

  // ---------- SOCKET ----------
  useEffect(() => {
    socket.on('partner_found', async (data) => {
      setPartnerId(data.partnerId);
      const pc = createPeerConnection(data.partnerId);
      if (socket.id > data.partnerId) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { target: data.partnerId, sdp: pc.localDescription });
      }
      addNotification('Партнёр найден!');
    });

    socket.on('offer', async (data) => {
      setPartnerId(data.source);
      const pc = createPeerConnection(data.source);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { target: data.source, sdp: pc.localDescription });
      addNotification('Партнёр найден!');
    });

    socket.on('answer', async (data) => {
      if (peerConnectionRef.current) await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
    });

    socket.on('ice-candidate', async (data) => {
      if (peerConnectionRef.current) await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
    });

    socket.on('partner_hangup', () => {
      addNotification('Партнёр отключился');
      findNextCallback();
    });

    socket.on('chat_message', (msg) => {
      setChatMessages(prev => [...prev, msg]);
    });

    return () => {
      socket.removeAllListeners();
      cleanupConnection();
      stopLocalStream();
    };
  }, [createPeerConnection, findNextCallback]);

  // ---------- CAMERAS ----------
  const loadCameras = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    setCameras(videoDevices);
    if (videoDevices[0]) setCurrentCamera(videoDevices[0].deviceId);
  };

  // ---------- START ----------
  const startChat = async () => {
    if (!ageConfirmed) return;
    try {
      await loadCameras();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: currentCamera ? { exact: currentCamera } : undefined }, audio: true });
      setIsStarted(true);
      localStreamRef.current = stream;
      myVideoRef.current.srcObject = stream;
      socket.emit('join');
      setSessionTime(0);
    } catch {
      alert('Нужен доступ к камере!');
    }
  };

  // ---------- CAMERA ----------
  const switchCamera = async () => {
    if (cameras.length < 2) return;
    const index = cameras.findIndex(c => c.deviceId === currentCamera);
    const next = cameras[(index + 1) % cameras.length];
    const newStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: next.deviceId } }, audio: true });
    stopLocalStream();
    localStreamRef.current = newStream;
    setCurrentCamera(next.deviceId);
    myVideoRef.current.srcObject = newStream;
    const sender = peerConnectionRef.current?.getSenders().find(s => s.track?.kind === 'video');
    if (sender) sender.replaceTrack(newStream.getVideoTracks()[0]);
  };

  const findNext = () => { socket.emit('hangup'); findNextCallback(); };

  // ---------- MEDIA ----------
  const toggleAudio = () => { if (!localStreamRef.current) return; localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !t.enabled); setIsAudioMuted(prev => !prev); };
  const toggleVideo = () => { if (!localStreamRef.current) return; localStreamRef.current.getVideoTracks().forEach(t => t.enabled = !t.enabled); setIsVideoStopped(prev => !prev); };
  const handleVolume = (e) => { setVolume(e.target.value); if (remoteVideoRef.current) remoteVideoRef.current.volume = e.target.value / 100; };

  // ---------- CHAT ----------
  const sendMessage = () => {
    if (!chatInput.trim()) return;
    socket.emit('chat_message', { text: chatInput, from: 'Вы' });
    setChatMessages(prev => [...prev, { text: chatInput, from: 'Вы' }]);
    setChatInput('');
  };

  // ---------- SESSION TIMER ----------
  useEffect(() => {
    let interval;
    if (isStarted && partnerId) interval = setInterval(() => setSessionTime(prev => prev + 1), 1000);
    else setSessionTime(0);
    return () => clearInterval(interval);
  }, [isStarted, partnerId]);

  // ---------- AUDIO LEVEL ----------
  const startAudioAnalyzer = (stream) => {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    audioAnalyserRef.current = analyser;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const update = () => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setPartnerAudioLevel(Math.min(100, Math.floor(avg)));
      animationFrameRef.current = requestAnimationFrame(update);
    };
    update();
  };
  const stopAudioAnalyzer = () => { if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); audioAnalyserRef.current = null; setPartnerAudioLevel(0); };

  // ---------- REACTIONS & NOTIFICATIONS ----------
  const addNotification = (text) => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, text }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 4000);
  };
  const sendReaction = (emoji) => { if (!partnerId) return; socket.emit('chat_message', { text: emoji, from: 'Вы' }); setReactions(prev => [...prev, emoji]); };

  // ---------- SEARCH DOTS ----------
  useEffect(() => {
    if (!partnerId && isStarted) {
      const interval = setInterval(() => setSearchDots(prev => prev.length < 3 ? prev + '.' : ''), 500);
      return () => clearInterval(interval);
    }
  }, [partnerId, isStarted]);

  // ---------- AGE MODAL ----------
  if (!ageConfirmed) {
    return (
      <div className="age-modal">
        <div className="age-box">
          <h2>Подтвердите возраст</h2>
          <p>Вам уже есть 18 лет?</p>
          <button onClick={() => setAgeConfirmed(true)}>Да, мне 18+</button>
        </div>
      </div>
    );
  }

  // ---------- RENDER ----------
  return (
    <div className="container">
      <h1 className="title">Vibe Convo 🔮</h1>

      <div className="status-area">
        {partnerId ? <span>Подключен</span> : <span>Поиск{searchDots}</span>}
        <span> | Время: {Math.floor(sessionTime / 60)}:{String(sessionTime % 60).padStart(2,'0')}</span>
      </div>

      <div className="video-grid">
        <div className="video-box remote-video">
          <video ref={remoteVideoRef} autoPlay playsInline />
          <div className="overlay">VibeConvo.com</div>
          <div className="audio-level"><div style={{ width: `${partnerAudioLevel}%` }} /></div>
        </div>

        <div className="video-box local-video">
          <video ref={myVideoRef} autoPlay playsInline muted style={{ display: isVideoStopped ? 'none' : 'block' }} />
          {isVideoStopped && <p style={{ fontSize: '1.5rem' }}>Камера выкл.</p>}
          <span className={`audio-status-badge ${isAudioMuted ? 'off' : ''}`}>{isAudioMuted ? '🔇 Звук выкл.' : '🎤 Звук вкл.'}</span>
          <span>Вы</span>
        </div>
      </div>

      <div className="controls">
        {!isStarted ? (
          <button className="btn start" onClick={startChat}>СТАРТ</button>
        ) : (
          <div className="active-controls">
            <button className={`media-btn ${isAudioMuted ? 'off' : ''}`} onClick={toggleAudio}>{isAudioMuted ? 'Вкл. звук' : 'Выкл. звук'}</button>
            <button className={`media-btn ${isVideoStopped ? 'off' : ''}`} onClick={toggleVideo}>{isVideoStopped ? 'Вкл. видео' : 'Выкл. видео'}</button>
            <button className="media-btn" onClick={switchCamera}>Сменить камеру</button>
            <label>Громкость собеседника:</label>
            <input type="range" min="0" max="100" value={volume} onChange={handleVolume} />
            <button className="btn next" onClick={findNext}>СЛЕДУЮЩИЙ</button>
          </div>
        )}
      </div>

      {/* REACTIONS */}
      <div className="reactions">{['😂','👍','❤️','😮','😢'].map(e => <button key={e} onClick={() => sendReaction(e)}>{e}</button>)}</div>

      {/* CHAT */}
      <div className="chat-box">
        <div className="chat-messages">{chatMessages.map((m,i) => <p key={i}><strong>{m.from}:</strong> {m.text}</p>)}</div>
        <div className="chat-input">
          <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Напишите сообщение..." />
          <button onClick={sendMessage}>Отправить</button>
        </div>
      </div>

      {/* NOTIFICATIONS */}
      <div className="notifications">{notifications.map(n => <div key={n.id} className="notification">{n.text}</div>)}</div>
    </div>
  );
}

export default App;
