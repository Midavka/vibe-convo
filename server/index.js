const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// 🔥 Твой Vercel URL
const FRONTEND_URL = process.env.FRONTEND_URL || "https://vibe-convo.vercel.app";

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// ⚠️ Лучше хранить id, а не socket объекты
let waitingUsers = [];
let userPairs = {};

io.on('connection', (socket) => {

  console.log('✅ Пользователь подключился:', socket.id);

  socket.on('join', () => {

    if (waitingUsers.length > 0) {

      const partnerId = waitingUsers.pop();

      userPairs[socket.id] = partnerId;
      userPairs[partnerId] = socket.id;

      io.to(socket.id).emit('partner_found', { partnerId });
      io.to(partnerId).emit('partner_found', { partnerId: socket.id });

      console.log(`🔥 Пара создана: ${socket.id} ↔ ${partnerId}`);

    } else {
      waitingUsers.push(socket.id);
    }
  });

  socket.on('offer', payload => {
    io.to(payload.target).emit('offer', {
      sdp: payload.sdp,
      source: socket.id
    });
  });

  socket.on('answer', payload => {
    io.to(payload.target).emit('answer', {
      sdp: payload.sdp,
      source: socket.id
    });
  });

  socket.on('ice-candidate', payload => {
    io.to(payload.target).emit('ice-candidate', {
      candidate: payload.candidate,
      source: socket.id
    });
  });

  const cleanup = (socketId) => {

    const partnerId = userPairs[socketId];

    if (partnerId) {
      io.to(partnerId).emit('partner_hangup');
      delete userPairs[partnerId];
    }

    delete userPairs[socketId];

    waitingUsers = waitingUsers.filter(id => id !== socketId);
  };

  socket.on('hangup', () => cleanup(socket.id));

  socket.on('disconnect', () => {
    console.log('❌ Пользователь отключился:', socket.id);
    cleanup(socket.id);
  });
});


// 🔥 Health check для Render
app.get('/', (req, res) => {
  res.send('Vibe Convo server is running 🚀');
});


// 🔥 КРИТИЧНО для Render
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
