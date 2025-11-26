import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.static("public"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

/**
 * Mazo con tus imágenes
 */
const cartasBase = [
  "Cero.png",
  "El alebrije.png",
  "El igual.png",
  "El mayor que.png",
  "El menor que.png",
  "El numero al cuadrado.png",
  "El numero al cubo.png",
  "El parentesis.png",
  "El pi.png",
  "El porcentaje.png",
  "I.png",
  "La division.png",
  "La jerarquia de operaciones.png",
  "La multiplicacion de signos distintos.png",
  "La multiplicacion de signos iguales.png",
  "La Multiplicacion.png",
  "La raiz cuadrada.png",
  "La raiz cubica.png",
  "La resta.png",
  "La suma.png",
  "Las fracciones.png",
  "Las Incognitas.png",
  "Las Raices.png",
  "Los decimales.png",
  "Los exponentes.png",
  "Los Impares.png",
  "Los Pares.png",
  "N.png",
  "Q.png",
  "R.png",
  "UNO.png",
  "Z.png"
];

const AUTO_MS = 3000;
const MAX_JUGADORES = 6;

// roomId -> {
//   hostId,
//   started,
//   fullDeck,     // mazo completo fijo
//   currentIndex, // índice de la carta actual (-1 = antes de empezar)
//   interval,
//   autoMode,
//   players: { socketId: { name, board } }
// }
const rooms = new Map();

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const makeRoomId = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () =>
    alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join("");
};

const makeBoard = () => shuffle([...cartasBase]).slice(0, 16);
const makeDeck  = () => shuffle([...cartasBase]);

function stopAuto(room) {
  if (room.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }
}

function getCalledCount(room) {
  if (!room.fullDeck || room.fullDeck.length === 0) return 0;
  return room.currentIndex >= 0 ? room.currentIndex + 1 : 0;
}

function getRemaining(room) {
  if (!room.fullDeck || room.fullDeck.length === 0) return 0;
  const called = getCalledCount(room);
  return room.fullDeck.length - called;
}

function getCurrentCard(room) {
  if (!room.fullDeck || room.fullDeck.length === 0) return null;
  if (room.currentIndex < 0) return null;
  return room.fullDeck[room.currentIndex] || null;
}

function getCalledList(room) {
  if (!room.fullDeck || room.fullDeck.length === 0) return [];
  const calledCount = getCalledCount(room);
  return room.fullDeck.slice(0, calledCount);
}

function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const calledCount = getCalledCount(room);
  const remaining = getRemaining(room);
  const currentCard = getCurrentCard(room);

  const data = {
    roomId,
    started: room.started,
    players: Object.values(room.players).map((p) => p.name),
    calledCount,
    remaining,
    hostSocketId: room.hostId,
    currentCard,
    autoMode: room.autoMode
  };

  io.to(roomId).emit("room:state", data);
}

function nextCard(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (!room.fullDeck || room.fullDeck.length === 0) {
    // no hay mazo cargado
    io.to(roomId).emit("deck:finished");
    stopAuto(room);
    broadcastRoomState(roomId);
    return;
  }

  // si ya estamos en la última carta
  if (room.currentIndex >= room.fullDeck.length - 1) {
    stopAuto(room);
    io.to(roomId).emit("deck:finished");
    broadcastRoomState(roomId);
    return;
  }

  room.currentIndex++;
  const card = room.fullDeck[room.currentIndex];

  const calledCount = getCalledCount(room);
  const remaining = getRemaining(room);

  io.to(roomId).emit("deck:card", {
    card,
    remaining,
    calledCount
  });

  if (room.currentIndex === room.fullDeck.length - 1) {
    stopAuto(room);
    io.to(roomId).emit("deck:finished");
  }

  broadcastRoomState(roomId);
}

function startAuto(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.interval) return;
  if (!room.autoMode) return;
  if (!room.started) return;

  room.interval = setInterval(() => nextCard(roomId), AUTO_MS);
}

function dealNewBoards(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const socketId of Object.keys(room.players)) {
    const board = makeBoard();
    room.players[socketId].board = board;
    io.to(socketId).emit("player:board", { board });
  }
}

function verifyLoteria(room, socketId) {
  const player = room.players[socketId];
  if (!player) return false;
  const { board } = player;
  const calledList = getCalledList(room);
  return board.every((id) => calledList.includes(id));
}

io.on("connection", (socket) => {
  // Crear sala
  socket.on("room:create", ({ name }, cb) => {
    let roomId = makeRoomId();
    while (rooms.has(roomId)) roomId = makeRoomId();

    const board = makeBoard();
    rooms.set(roomId, {
      hostId: socket.id,
      started: false,
      fullDeck: [],
      currentIndex: -1,
      interval: null,
      autoMode: true, // modo inicial AUTOMÁTICO
      players: {
        [socket.id]: { name: name || "Jugador", board }
      }
    });

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name || "Jugador";

    socket.emit("player:board", { board });
    broadcastRoomState(roomId);
    cb?.({ ok: true, roomId });
  });

  // Unirse a sala
  socket.on("room:join", ({ roomId, name }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb?.({ ok: false, error: "Sala no existe" });
    if (room.started) return cb?.({ ok: false, error: "La partida ya comenzó" });
    if (Object.keys(room.players).length >= MAX_JUGADORES) {
      return cb?.({ ok: false, error: "Sala llena" });
    }

    const board = makeBoard();
    room.players[socket.id] = { name: name || "Jugador", board };

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name || "Jugador";

    socket.emit("player:board", { board });
    broadcastRoomState(roomId);
    cb?.({ ok: true, roomId });
  });

  // Iniciar partida (no cambia tableros, solo baraja/cantos)
  function startNewGame(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    stopAuto(room);
    room.started = true;
    room.fullDeck = makeDeck();
    room.currentIndex = -1;

    broadcastRoomState(roomId);
  }

  // Iniciar juego
  socket.on("game:start", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    startNewGame(roomId);
    io.to(roomId).emit("game:started");

    if (room.autoMode) {
      startAuto(roomId);
    }
  });

  // Reiniciar: NUEVOS tableros + nuevas cartas desde 0
  socket.on("game:reset", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    // nuevos tableros para todos
    dealNewBoards(roomId);

    // baraja desde cero
    startNewGame(roomId);
    io.to(roomId).emit("game:reset");

    if (room.autoMode) {
      startAuto(roomId);
    }
  });

  // Cambiar modo auto/manual
  socket.on("deck:setMode", ({ auto }) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    // Valida: solo puedes pasar de auto->manual si está pausado
    // (pero puedes pasar de manual->auto siempre).
    if (room.autoMode && auto === false) {
      // cambiar a manual
      // No hay flag de pausado en el server,
      // pero nos aseguramos de pausar el intervalo antes
      stopAuto(room);
      room.autoMode = false;
    } else if (!room.autoMode && auto === true) {
      // manual -> auto
      room.autoMode = true;
      if (room.started) {
        startAuto(roomId);
      }
    }

    broadcastRoomState(roomId);
  });

  // Pausar automático
  socket.on("deck:pause", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;
    if (!room.autoMode) return;

    stopAuto(room);
    io.to(roomId).emit("deck:paused");
  });

  // Reanudar automático
  socket.on("deck:resume", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;
    if (!room.autoMode) return;

    startAuto(roomId);
    io.to(roomId).emit("deck:resumed");
  });

  // Carta siguiente (modo manual)
  socket.on("deck:next", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;
    if (room.autoMode) return; // solo en modo manual
    if (!room.started) return;

    nextCard(roomId);
  });

  // Carta previa (modo manual)
  socket.on("deck:prev", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;
    if (room.autoMode) return; // solo en modo manual
    if (!room.started) return;
    if (!room.fullDeck || room.fullDeck.length === 0) return;

    if (room.currentIndex > 0) {
      room.currentIndex--;
      const card = room.fullDeck[room.currentIndex];
      const calledCount = getCalledCount(room);
      const remaining = getRemaining(room);

      io.to(roomId).emit("deck:card", {
        card,
        remaining,
        calledCount
      });
    } else if (room.currentIndex === 0) {
      // si regresamos "antes" de la primera carta
      room.currentIndex = -1;
      const calledCount = 0;
      const remaining = room.fullDeck.length;

      io.to(roomId).emit("deck:card", {
        card: null,
        remaining,
        calledCount
      });
    }

    broadcastRoomState(roomId);
  });

  // Lotería
  socket.on("loteria:claim", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;

    const valid = verifyLoteria(room, socket.id);
    if (valid) {
      stopAuto(room);
      io.to(roomId).emit("loteria:winner", {
        winner: room.players[socket.id].name
      });
    } else {
      io.to(socket.id).emit("loteria:denied", {
        reason: "Aún no ganas. No han pasado todas tus cartas."
      });
    }
  });

  // Desconexión
  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    delete room.players[socket.id];

    if (room.hostId === socket.id) {
      const ids = Object.keys(room.players);
      room.hostId = ids[0] || null;
    }

    if (Object.keys(room.players).length === 0) {
      stopAuto(room);
      rooms.delete(roomId);
    } else {
      broadcastRoomState(roomId);
    }
  });
});

server.listen(PORT, () => {
  console.log("Servidor escuchando en puerto", PORT);
});
