const socket = io();

// Refs UI
const auth = document.getElementById("auth");
const game = document.getElementById("game");
const playerName = document.getElementById("playerName");
const roomCode = document.getElementById("roomCode");
const createRoom = document.getElementById("createRoom");
const joinRoom = document.getElementById("joinRoom");
const authMsg = document.getElementById("authMsg");

const roomInfo = document.getElementById("roomInfo");
const controlsHost = document.getElementById("controlsHost");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const nextBtn = document.getElementById("nextBtn");

const currentCardImg = document.getElementById("currentCardImg");
const currentCardCaption = document.getElementById("currentCardCaption");
const counters = document.getElementById("counters");
const boardEl = document.getElementById("board");
const loteriaBtn = document.getElementById("loteriaBtn");
const msg = document.getElementById("msg");

let myBoard = [];              // array de filenames (IDs)
let currentRoomId = null;
let mySocketId = null;
let isHost = false;

// cooldown para ¡Lotería!
const LOTERIA_COOLDOWN_MS = 2000;
let loteriaCooling = false;

socket.on("connect", () => { mySocketId = socket.id; });

// Helpers de UI
function prettyLabel(id){ return (id || "").replace(/\.png$/i, ""); }
function imgSrc(id){ return `img/${id}`; } // archivos están en /public/img

function setCurrentCard(id){
  if (!id){
    currentCardImg.src = "";
    currentCardImg.alt = "Carta actual";
    currentCardCaption.textContent = "Carta actual: —";
    return;
  }
  currentCardImg.src = imgSrc(id);
  currentCardImg.alt = prettyLabel(id);
  currentCardCaption.textContent = `Carta actual: ${prettyLabel(id)}`;
}

function renderBoard(){
  boardEl.innerHTML = "";
  myBoard.forEach((id) => {
    const div = document.createElement("div");
    div.className = "cell";
    div.dataset.cardId = id;

    const img = document.createElement("img");
    img.src = imgSrc(id);
    img.alt = prettyLabel(id);

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = prettyLabel(id);

    div.onclick = () => div.classList.toggle("marked");

    div.appendChild(img);
    div.appendChild(label);
    boardEl.appendChild(div);
  });
}

// Entrar al juego
function enterGame() {
  auth.classList.add("hidden");
  game.classList.remove("hidden");
  msg.textContent = "";
  renderHostControls();
}
function renderHostControls(){ controlsHost.classList.toggle("hidden", !isHost); }

// Acciones Auth
createRoom.onclick = () => {
  authMsg.textContent = "";
  socket.emit("room:create", { name: playerName.value || "Jugador" }, (res) => {
    if (!res.ok) { authMsg.textContent = res.error || "No se pudo crear la sala"; return; }
    currentRoomId = res.roomId; isHost = true; enterGame();
  });
};

joinRoom.onclick = () => {
  authMsg.textContent = "";
  const code = (roomCode.value || "").trim().toUpperCase();
  if (!code) { authMsg.textContent = "Ingresa un código de sala"; return; }
  socket.emit("room:join", { roomId: code, name: playerName.value || "Jugador" }, (res) => {
    if (!res.ok) { authMsg.textContent = res.error || "No se pudo entrar a la sala"; return; }
    currentRoomId = code; isHost = false; enterGame();
  });
};

// Controles host
startBtn.onclick  = () => socket.emit("game:start");
pauseBtn.onclick  = () => socket.emit("deck:pause");
resumeBtn.onclick = () => socket.emit("deck:resume");
nextBtn.onclick   = () => socket.emit("deck:next");

// ¡Lotería! con cooldown
loteriaBtn.onclick = () => {
  if (loteriaCooling) return;
  loteriaCooling = true; loteriaBtn.disabled = true;
  socket.emit("loteria:claim");
  setTimeout(() => { loteriaCooling = false; loteriaBtn.disabled = false; }, LOTERIA_COOLDOWN_MS);
};

// Eventos servidor
socket.on("player:board", ({ board }) => {
  myBoard = board;            // array de filenames
  renderBoard();
});

socket.on("room:state", (state) => {
  isHost = state.hostSocketId === mySocketId;
  renderHostControls();
  setCurrentCard(state.currentCard);
  counters.textContent = `Cantadas: ${state.calledCount} • Restantes: ${state.remaining}`;
  roomInfo.textContent = `Sala: ${state.roomId} • Jugadores: ${state.players.join(", ")} ${isHost ? "• (Eres host)" : ""}`;
});

socket.on("game:started", () => { msg.textContent = "¡La partida comenzó!"; });

socket.on("deck:card", ({ card, remaining, calledCount }) => {
  setCurrentCard(card);
  counters.textContent = `Cantadas: ${calledCount} • Restantes: ${remaining}`;
});

socket.on("deck:finished", () => { msg.textContent = "Ya no hay más cartas."; });
socket.on("deck:paused",   () => { msg.textContent = "Pausado por el host."; });
socket.on("deck:resumed",  () => { msg.textContent = "Reanudado por el host."; });

socket.on("loteria:denied", ({ reason }) => { msg.textContent = reason; });
socket.on("loteria:winner", ({ winner }) => { msg.textContent = `🎉 ¡Lotería! Ganó ${winner}`; });
