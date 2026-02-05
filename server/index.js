const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", 
  }
});

let waitingUsers = [];
let userPairs = {}; // <-- Новое! Запоминаем, кто с кем в паре.

io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  socket.on('join', () => {
    if (waitingUsers.length > 0) {
      const partnerSocket = waitingUsers.pop();
      const partnerId = partnerSocket.id;

      userPairs[socket.id] = partnerId; // Записали в пару
      userPairs[partnerId] = socket.id; // Записали в пару

      io.to(socket.id).emit('partner_found', { partnerId: partnerId });
      io.to(partnerId).emit('partner_found', { partnerId: socket.id });
      console.log(`Пара создана: ${socket.id} и ${partnerId}`);
    } else {
      waitingUsers.push(socket);
    }
  });

  socket.on('offer', (payload) => io.to(payload.target).emit('offer', { sdp: payload.sdp, source: socket.id }));
  socket.on('answer', (payload) => io.to(payload.target).emit('answer', { sdp: payload.sdp, source: socket.id }));
  socket.on('ice-candidate', (payload) => io.to(payload.target).emit('ice-candidate', { candidate: payload.candidate, source: socket.id }));
  
  const cleanup = (socketId) => {
    const partnerId = userPairs[socketId];
    if (partnerId) {
      io.to(partnerId).emit('partner_hangup');
      delete userPairs[partnerId];
    }
    delete userPairs[socketId];
    waitingUsers = waitingUsers.filter(user => user.id !== socketId);
  }

  socket.on('hangup', () => cleanup(socket.id));
  socket.on('disconnect', () => {
    console.log('Пользователь ушел:', socket.id);
    cleanup(socket.id); // <-- Теперь disconnect работает как hangup!
  });
});

const PORT = 3001;
server.listen(PORT, () => console.log(`Сервер Vibe Convo запущен на порту ${PORT}`));
