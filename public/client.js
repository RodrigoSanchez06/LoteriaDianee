const socket = io();

// UI refs
const auth = document.getElementById("auth");
const game = document.getElementById("game");

const playerName = document.getElementById("playerName");
const roomCode = document.getElementById("roomCode");
const joinRoom = document.getElementById("joinRoom");
const createRoom = document.getElementById("createRoom");
const authMsg = document.getElementById("authMsg");

const controlsHost = document.getElementById("controlsHost");
const playPauseBtn = document.getElementById("playPauseBtn");
const resetBtn = document.getElementById("resetBtn");
const modeBtn = document.getElementById("modeBtn");

const manualControls = document.getElementById("manualControls");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const boardEl = document.getElementById("board");
const currentCardWrapper = document.getElementById("currentCardWrapper");
const currentCardImg = document.getElementById("currentCardImg");
const counters = document.getElementById("counters");

const loteriaBtn = document.getElementById("loteriaBtn");
const msg = document.getElementById("msg");
const roomInfo = document.getElementById("roomInfo");

let myBoard = [];
let mySocketId = null;
let isHost = false;
let autoMode = true;   // modo inicial: automático
let gameStarted = false;
let isPaused = false;  // solo aplica en automático

const LOTERIA_COOLDOWN = 5000;
let loteriaCooling = false;

// Helpers
function imgSrc(id) {
  return `img/${id}`;
}

function setCurrentCard(id) {
  if (!id) {
    currentCardWrapper.classList.add("hidden");
    return;
  }
  currentCardWrapper.classList.remove("hidden");
  currentCardImg.src = imgSrc(id);
}

function renderBoard() {
  boardEl.innerHTML = "";
  const fifteen = myBoard.slice(0, 15); // 5×3

  fifteen.forEach((id) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.id = id;

    cell.onclick = () => cell.classList.toggle("marked");

    const img = document.createElement("img");
    img.src = imgSrc(id);

    cell.appendChild(img);
    boardEl.appendChild(cell);
  });
}

function updateHostUI() {
  controlsHost.classList.toggle("hidden", !isHost);

  // Botón principal (Iniciar / Pausar / Reanudar)
  if (!gameStarted) {
    playPauseBtn.textContent = "Iniciar juego";
    playPauseBtn.disabled = false;
  } else if (autoMode) {
    playPauseBtn.textContent = isPaused ? "Reanudar" : "Pausar";
    playPauseBtn.disabled = false;
  } else {
    // Modo manual → no se usa el botón principal
    playPauseBtn.textContent = "Iniciar juego";
    playPauseBtn.disabled = true;
  }

  // Mostrar Reiniciar cuando:
  // - el juego está iniciado
  // - está pausado (auto) o en modo manual
  const showReset = gameStarted && (isPaused || !autoMode);
  resetBtn.classList.toggle("hidden", !showReset);

  // Texto del modo actual
  modeBtn.textContent = autoMode ? "Modo: Automático" : "Modo: Manual";

  // Solo se puede cambiar modo cuando:
  // - hay host
  // - el juego ya empezó
  // - y si está en automático, debe estar PAUSADO para pasar a manual
  const canChangeMode =
    isHost &&
    gameStarted &&
    (isPaused || !autoMode); // si ya es manual, puede volver a auto

  modeBtn.disabled = false;


  // Controles manuales únicamente cuando:
  // - el host
  // - el juego ya empezó
  // - modo es manual
  const showManualControls = isHost && gameStarted && !autoMode;
  manualControls.classList.toggle("hidden", !showManualControls);
}

function enterGame() {
  auth.classList.add("hidden");
  game.classList.remove("hidden");
  msg.textContent = "";
  updateHostUI();
}

// Auth
createRoom.onclick = () => {
  authMsg.textContent = "";
  socket.emit(
    "room:create",
    { name: playerName.value || "Jugador" },
    (res) => {
      if (!res.ok) {
        authMsg.textContent = res.error || "No se pudo crear la sala";
        return;
      }
      isHost = true;
      enterGame();
    }
  );
};

joinRoom.onclick = () => {
  authMsg.textContent = "";
  const code = (roomCode.value || "").trim().toUpperCase();
  if (!code) {
    authMsg.textContent = "Ingresa un código";
    return;
  }
  socket.emit(
    "room:join",
    { roomId: code, name: playerName.value || "Jugador" },
    (res) => {
      if (!res.ok) {
        authMsg.textContent = res.error || "No se pudo entrar a la sala";
        return;
      }
      isHost = false;
      enterGame();
    }
  );
};

// Host controls

// Botón principal
playPauseBtn.onclick = () => {
  if (!gameStarted) {
    socket.emit("game:start");
  } else if (autoMode) {
    if (isPaused) {
      socket.emit("deck:resume");
    } else {
      socket.emit("deck:pause");
    }
  }
};

// Reiniciar
resetBtn.onclick = () => {
  socket.emit("game:reset");
};

modeBtn.onclick = () => {
  // Si estamos en automático, solo permitir cambiar si está PAUSADO
  if (autoMode && !isPaused) {
    msg.textContent = "Pausa el juego antes de cambiar al modo manual.";
    return;
  }

  socket.emit("deck:setMode", { auto: !autoMode });
};


// Manual prev/next
nextBtn.onclick = () => socket.emit("deck:next");
prevBtn.onclick = () => socket.emit("deck:prev");

// Lotería (con cooldown)
loteriaBtn.onclick = () => {
  if (loteriaCooling) return;
  loteriaCooling = true;
  loteriaBtn.disabled = true;

  socket.emit("loteria:claim");

  setTimeout(() => {
    loteriaCooling = false;
    loteriaBtn.disabled = false;
  }, LOTERIA_COOLDOWN);
};

// Socket events
socket.on("connect", () => {
  mySocketId = socket.id;
});

socket.on("player:board", ({ board }) => {
  myBoard = board;
  renderBoard();
});

socket.on("room:state", (state) => {
  const prevAuto = autoMode;

  isHost = state.hostSocketId === mySocketId;
  autoMode = state.autoMode ?? true;
  gameStarted = state.started;

  // si pasamos de manual -> automático, asumimos que ahora está corriendo
  if (autoMode && !prevAuto) {
    isPaused = false;
  }

  roomInfo.textContent =
    `Sala: ${state.roomId} • Jugadores: ${state.players.join(", ")} ${
      isHost ? "• (Host)" : ""
    }`;

  setCurrentCard(state.currentCard);

  counters.textContent =
    `Cantadas: ${state.calledCount} • Restantes: ${state.remaining}`;

  updateHostUI();
});

socket.on("deck:card", ({ card, remaining, calledCount }) => {
  setCurrentCard(card);
  counters.textContent =
    `Cantadas: ${calledCount} • Restantes: ${remaining}`;
});

socket.on("game:started", () => {
  gameStarted = true;
  isPaused = false;
  msg.textContent = "¡La partida comenzó!";
  updateHostUI();
});

socket.on("game:reset", () => {
  gameStarted = true;
  isPaused = false;
  setCurrentCard(null);
  msg.textContent = "Partida reiniciada. Nuevos tableros.";
  updateHostUI();
});

socket.on("deck:paused", () => {
  isPaused = true;
  updateHostUI();
});

socket.on("deck:resumed", () => {
  isPaused = false;
  updateHostUI();
});

socket.on("deck:finished", () => {
  msg.textContent = "Ya no hay más cartas.";
  isPaused = true;
  updateHostUI();
});

socket.on("loteria:denied", ({ reason }) => {
  msg.textContent = reason;
});

socket.on("loteria:winner", ({ winner }) => {
  msg.textContent = `🎉 ¡Lotería! Ganó ${winner}`;
});
