const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

let transmitterId = null;
let observerCount = 0;

io.on('connection', (socket) => {
  console.log('Un usuario se ha conectado:', socket.id);

  socket.emit('stateUpdate', {
    hasTransmitter: transmitterId !== null,
    observerCount: observerCount
  });

  socket.on('joinAsTransmitter', (callback) => {
    if (transmitterId !== null) {
      callback({ success: false, message: 'Ya hay un transmisor activo en esta sala.' });
      return;
    }
    transmitterId = socket.id;
    socket.join('transmitter');
    callback({ success: true });
    
    io.emit('stateUpdate', {
      hasTransmitter: transmitterId !== null,
      observerCount: observerCount
    });
  });

  socket.on('joinAsObserver', (callback) => {
    socket.role = 'observer';
    observerCount++;
    socket.join('observers');
    callback({ success: true, hasTransmitter: transmitterId !== null });
    
    io.emit('stateUpdate', {
      hasTransmitter: transmitterId !== null,
      observerCount: observerCount
    });
    
    if (transmitterId !== null) {
      socket.to('transmitter').emit('newObserverReady');
    }
  });

  // WebRTC Signaling
  socket.on('offer', (data) => {
    socket.to('observers').emit('offer', data);
  });

  socket.on('answer', (data) => {
    socket.to('transmitter').emit('answer', data);
  });

  socket.on('candidate', (data) => {
    socket.broadcast.emit('candidate', data);
  });

  // Blur Control
  socket.on('updateBlur', (blurValue) => {
    if (socket.id === transmitterId) {
      socket.to('observers').emit('blurUpdate', blurValue);
    }
  });

  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
    if (socket.id === transmitterId) {
      transmitterId = null;
      io.emit('transmitterDisconnected');
    } else if (socket.role === 'observer') {
      if (observerCount > 0) observerCount--;
    }
    
    io.emit('stateUpdate', {
      hasTransmitter: transmitterId !== null,
      observerCount: observerCount
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n======================================`);
  console.log(`🎉 Servidor de Producción iniciado en el puerto ${PORT}!`);
  console.log(`======================================\n`);
});
