import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.static("public")); // sirve el cliente si lo pones en /public

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// === Datos base ===
const cartasBase = [
  "🐓 El Gallo", "😈 El Diablo", "👩‍🦰 La Dama", "🎩 El Catrín",
  "☂️ El Paraguas", "🧜‍♀️ La Sirena", "🪜 La Escalera", "🍾 La Botella",
  "🛢️ El Barril", "🌳 El Árbol", "🍈 El Melón", "🦸‍♂️ El Valiente",
  "🎩 El Gorrito", "💀 La Muerte", "🍐 La Pera", "🏳️ La Bandera"
];
// Puedes luego extender a 54 sin cambiar la lógica

const AUTO_MS = 3000;
const MAX_JUGADORES = 6;

// roomId -> { hostId, started, deck, called, interval, players: {socketId:{name, board}} }
const rooms = new Map();

// === Utils ===
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const makeRoomId = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
};

const makeBoard = () => shuffle([...cartasBase]).slice(0, 16);
const makeDeck = () => shuffle([...cartasBase]);

function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = {
    roomId,
    started: room.started,
    players: Object.values(room.players).map(p => p.name),
    calledCount: room.called.length,
    remaining: room.deck.length,
    hostSocketId: room.hostId,
    currentCard: room.called[room.called.length - 1] || null
  };
  io.to(roomId).emit("room:state", data);
}

function stopAuto(room) {
  if (room.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }
}

function nextCard(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.deck.length === 0) {
    if (room) stopAuto(room);
    io.to(roomId).emit("deck:finished");
    broadcastRoomState(roomId);
    return;
  }
  const card = room.deck.pop();
  room.called.push(card);
  io.to(roomId).emit("deck:card", { card, remaining: room.deck.length, calledCount: room.called.length });
  if (room.deck.length === 0) {
    stopAuto(room);
    io.to(roomId).emit("deck:finished");
  }
  broadcastRoomState(roomId);
}

function startAuto(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.interval) return;
  room.interval = setInterval(() => nextCard(roomId), AUTO_MS);
}

function verifyLoteria(room, socketId) {
  const player = room.players[socketId];
  if (!player) return false;
  const { board } = player;
  // Reglas: tabla COMPLETA y TODAS cantadas
  return board.every(c => room.called.includes(c));
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
      deck: [],
      called: [],
      interval: null,
      players: { [socket.id]: { name: name || "Jugador", board } }
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

  // Iniciar juego (solo host)
  socket.on("game:start", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;

    room.started = true;
    room.deck = makeDeck();
    room.called = [];
    stopAuto(room);
    io.to(roomId).emit("game:started");
    broadcastRoomState(roomId);
    startAuto(roomId);
  });

  // Control host: Pausar/Reanudar/Avanzar
  socket.on("deck:pause", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id) return;
    stopAuto(room);
    io.to(socket.data.roomId).emit("deck:paused");
  });

  socket.on("deck:resume", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;
    startAuto(roomId);
    io.to(roomId).emit("deck:resumed");
  });

  socket.on("deck:next", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;
    nextCard(roomId);
  });

  // Reclamar Lotería (con verificación en servidor)
  socket.on("loteria:claim", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;
    const valid = verifyLoteria(room, socket.id);
    if (valid) {
      stopAuto(room);
      io.to(roomId).emit("loteria:winner", { winner: room.players[socket.id].name });
      // (opcional) room.started = false; // para permitir nueva partida sin recrear sala
    } else {
      // Mensaje genérico (no revelamos qué falta, como pediste)
      io.to(socket.id).emit("loteria:denied", { reason: "Aún no ganas. No han pasado todas tus cartas." });
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    delete room.players[socket.id];

    // reasignar host si era el host
    if (room.hostId === socket.id) {
      const ids = Object.keys(room.players);
      room.hostId = ids[0] || null;
    }

    // si ya no hay jugadores, cerrar sala
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
