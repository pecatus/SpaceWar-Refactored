// frontend/js/client.js
import { io } from "https://cdn.socket.io/4.7.5/socket.io.esm.min.js";
import {
  initThreeIfNeeded,
  buildFromSnapshot,
  applyDiff,
  animate            
} from './scene.js';

/* ------------------------------------------------------------------ */
/*  Konstit                                                            */
/* ------------------------------------------------------------------ */
const BACKEND_URL = "http://localhost:3001";

/* DOM-viittaukset */
const startBtn  = document.getElementById("startGameButton");
const startView = document.getElementById("startScreen");
const uiRoot    = document.getElementById("uiContainer");

let gameState   = null;
let myPlayerId  = null;

/* ------------------------------------------------------------------ */
/*  Socket.IO                                                          */
/* ------------------------------------------------------------------ */
const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  withCredentials: true           // vastaa serverin CORS-asetusta
});

socket.on("connect", () => {
  console.log("✅  Socket connected", socket.id);
});

/* Kun backend ampuu alkutilan */
socket.on('initial_state', snap => {
  console.log("📥 initial_state", snap);
  initThreeIfNeeded();          // luo kamera / renderer jos ei jo ole
  buildFromSnapshot(snap);      // tähdet + laivat
  animate();                    // käynnistä silmukka (vain kerran)
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('uiContainer').style.display = 'flex';
  
});

socket.on("game_diff", (diff) => {
  console.log("📦 diff", diff);
  applyDiff(diff);
});

/* ------------------------------------------------------------------ */
/*  REST-apu                                                           */
/* ------------------------------------------------------------------ */
async function createNewGame(payload) {
  const res = await fetch(`${BACKEND_URL}/api/games/new`, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify(payload)
  });

  // heitetään selkeä virhe jos ei 2xx
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();   // backend aina JSON → suoraan objektiksi
}


/* ------------------------------------------------------------------ */
/*  START-NAPPI                                                        */
/* ------------------------------------------------------------------ */
startBtn.addEventListener("click", async () => {
  try {
    startBtn.disabled = true;

    /* 1) Uusi peli backendissä */
    const result = await createNewGame({
      humanName    : "Player",
      numAiPlayers : 1,
      aiColors     : ["#dc3545"],
      starCount    : 150
    });

    if (!result.success) throw new Error(result.message);

    const { gameId, playerId, initial_state } = result;
    myPlayerId = playerId;

    /* 2) Käsittele heti REST-vastauksen alkutila */
    if (initial_state) handleInitialState(initial_state);

    /* 3) Liity Socket.IO-huoneeseen */
    socket.emit("join_game", { gameId });
    console.log(`✅  Joined room ${gameId}`);

  } catch (err) {
    console.error("❌  start game failed", err);
    alert(err.message);
    startBtn.disabled = false;
  }
});
