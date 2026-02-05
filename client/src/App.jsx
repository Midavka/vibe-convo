import { useState, useRef, useEffect, useCallback } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io(import.meta.env.VITE_API_URL || 'https://vibeconvoserver.onrender.com', {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
});

// 👉 STUN + public TURN (replace with your own TURN for production)
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

function App() {
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoStopped, setIsVideoStopped] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [partnerId, setPartnerId] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [currentCamera, setCurrentCamera] = useState(null);

  const myVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);

  // ---------- CLEANUP ----------

  const cleanupConnection = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
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
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          target: partnerSocketId,
          candidate: event.candidate,
        });
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

  // ---------- MATCH ----------

  const findNextCallback = useCallback(() => {
    cleanupConnection();
    setPartnerId(null);
    socket.emit('join');
  }, []);

  // ---------- SOCKET ----------

  useEffect(() => {
    socket.on('partner_found', async (data) => {
      setPartnerId(data.partnerId);

      const pc = createPeerConnection(data.partnerId);

      // deterministic offer creator
      if (socket.id > data.partnerId) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit('offer', {
          target: data.partnerId,
          sdp: pc.localDescription,
        });
      }
    });

    socket.on('offer', async (data) => {
      setPartnerId(data.source);

      const pc = createPeerConnection(data.source);

      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('answer', {
        target: data.source,
        sdp: pc.localDescription,
      });
    });

    socket.on('answer', async (data) => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(data.sdp)
        );
      }
    });

    socket.on('ice-candidate', async (data) => {
      try {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(
            new RTCIceCandidate(data.candidate)
          );
        }
      } catch (err) {
        console.error('ICE error:', err);
      }
    });

    socket.on('partner_hangup', findNextCallback);

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
    try {
      await loadCameras();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: currentCamera ? { exact: currentCamera } : undefined },
        audio: true,
      });

      setIsStarted(true);
      localStreamRef.current = stream;

      if (myVideoRef.current) {
        myVideoRef.current.srcObject = stream;
      }

      socket.emit('join');
    } catch (err) {
      alert('Нужен доступ к камере!');
    }
  };

  // ---------- SWITCH CAMERA ----------

  const switchCamera = async () => {
    if (cameras.length < 2) return;

    const index = cameras.findIndex(c => c.deviceId === currentCamera);
    const next = cameras[(index + 1) % cameras.length];

    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: next.deviceId } },
      audio: true,
    });

    stopLocalStream();

    localStreamRef.current = newStream;
    setCurrentCamera(next.deviceId);

    myVideoRef.current.srcObject = newStream;

    // replace track without reconnect
    const sender = peerConnectionRef.current
      ?.getSenders()
      .find(s => s.track?.kind === 'video');

    if (sender) {
      sender.replaceTrack(newStream.getVideoTracks()[0]);
    }
  };

  // ---------- NEXT ----------

  const findNext = () => {
    socket.emit('hangup');
    findNextCallback();
  };

  // ---------- MEDIA ----------

  const toggleAudio = () => {
    if (!localStreamRef.current) return;

    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled;
    });

    setIsAudioMuted(prev => !prev);
  };

  const toggleVideo = () => {
    if (!localStreamRef.current) return;

    localStreamRef.current.getVideoTracks().forEach(track => {
      track.enabled = !track.enabled;
    });

    setIsVideoStopped(prev => !prev);
  };

  // auto mute when tab hidden
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(t => (t.enabled = false));
        setIsAudioMuted(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

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
          <video
            ref={myVideoRef}
            autoPlay
            playsInline
            muted
            style={{ display: isVideoStopped ? 'none' : 'block' }}
          />

          {isVideoStopped && <p style={{ fontSize: '1.5rem' }}>Камера выкл.</p>}

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
          <button className="btn start" onClick={startChat}>
            СТАРТ
          </button>
        ) : (
          <div className="active-controls">
            <button
              className={`media-btn ${isAudioMuted ? 'off' : ''}`}
              onClick={toggleAudio}
            >
              {isAudioMuted ? 'Вкл. звук' : 'Выкл. звук'}
            </button>

            <button
              className={`media-btn ${isVideoStopped ? 'off' : ''}`}
              onClick={toggleVideo}
            >
              {isVideoStopped ? 'Вкл. видео' : 'Выкл. видео'}
            </button>

            <button className="media-btn" onClick={switchCamera}>
              Сменить камеру
            </button>

            <button className="btn next" onClick={findNext}>
              СЛЕДУЮЩИЙ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
