// server.js – Express + Mongo + Socket.IO bootstrap
// ---------------------------------------------------------------------------

require("dotenv").config();

const express    = require("express");
const session    = require('express-session');
const cors       = require("cors");
const mongoose   = require("mongoose");
const http       = require("http");
const { Server } = require("socket.io");

const GameManager = require("./gameLogic/GameManager");
const Game        = require("./models/Game");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

/* ---------------------- CORS ------------------------- */
const WHITELIST = [
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

app.use(cors({
  origin: (origin, cb) => {
    // Salli myös Postman / curl (= origin undefined)
    if (!origin || WHITELIST.includes(origin)) return cb(null, true);
    cb(new Error("CORS blocked for " + origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
  credentials: true
}));

/* ---------------------- MongoDB ---------------------- */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅  MongoDB connected"))
  .catch(err => { console.error("❌  Mongo error:", err.message); process.exit(1); });

/* ---------------------- Sessions --------------------- */

app.use(session({
  secret: process.env.SESSION_SECRET, // || 'dev-secret-change-this',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: false, // true jos käytät HTTPS:ää
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24h
  }
}));

/* ---------------------- Socket.IO -------------------- */
const httpSrv = http.createServer(app);

const io = new Server(httpSrv, {
  cors: {
    origin: WHITELIST,
    methods: ["GET", "POST"]
  }
});

/* Käytetään muistissa pientä manager-cachea: Map<gameId, GameManager> */
const managers = new Map();

/* ---- Socket-tapahtumat ------------------------------ */
io.on("connection", socket => {
  console.log("🔌  Client connected", socket.id);
  
  // --- UUSI, TOIMIVA DISCONNECT-KÄSITTELIJÄ ---
  socket.on("disconnecting", () => {
    console.log(`⚡️ Client disconnected: ${socket.id}. Attempting immediate game cleanup.`);

    // Etsitään peli, johon katkennut socket kuului, katsomalla sen huoneita.
    // .find() löytää ensimmäisen osuman, mikä riittää yksinpelissä.
    const gameRoomId = Array.from(socket.rooms).find(room => room !== socket.id && managers.has(room));

    if (gameRoomId) {
      console.log(`   - Disconnected socket was in game room: ${gameRoomId}. Stopping game immediately.`);
      
      const gm = managers.get(gameRoomId);
      if (gm) {
        // 1. Pysäytä pelilooppi VÄLITTÖMÄSTI
        // Tämä lopettaa [AI-INCOME]-viestien tulostumisen.
        gm.stop();

        // 2. Poista pelimanageri aktiivisten pelien joukosta, jotta uudet komennot eivät löydä sitä.
        managers.delete(gameRoomId);
        console.log(`   - GameManager for ${gameRoomId} stopped and removed from active memory.`);

        // 3. Merkitse peli päättyneeksi tietokantaan, jotta se ei jää sinne kummittelemaan.
        // Tämä ajetaan taustalla, eikä sen tarvitse blokata muuta toimintaa.
        Game.findByIdAndUpdate(gameRoomId, {
          status: 'aborted',
          finishedAt: new Date()
        })
        .exec() // Varmistaa, että palautetaan Promise
        .then(updatedGame => {
          if (updatedGame) {
            console.log(`   - Game ${gameRoomId} successfully marked as 'aborted' in the database.`);
          }
        })
        .catch(err => {
          console.error(`   - Error updating game status in DB for ${gameRoomId}:`, err);
        });
      }
    } else {
      console.log(`   - Disconnected socket was not in any active game room. No action needed.`);
    }
  });


  // --- PÄIVITETTY JOIN_GAME-KÄSITTELIJÄ ---
  socket.on("join_game", async ({ gameId }) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(gameId)) throw new Error("invalid gameId");

      let gm = managers.get(gameId);
      if (!gm) {
        // Tässä voitaisiin ladata peli DB:stä, mutta uuden pelin luonti hoitaa sen
        const gameDoc = await Game.findById(gameId);
        if (!gameDoc || gameDoc.status !== 'playing') {
          throw new Error("Game not found or has ended.");
        }
        gm = new GameManager({ gameId, io });
        await gm.init();
        managers.set(gameId, gm);
      }
      
      socket.join(gameId);
      
      // Jatka peliä, jos se oli paussilla
      if (gm.isPaused()) {
        console.log(`▶️ Resuming game ${gameId} after player rejoined.`);
        gm.resume();
      } else if (!gm.isRunning()) {
        gm.start();
      }
      
      const state = await gm.getSerializableState();
      io.to(socket.id).emit("initial_state", state);
      socket.emit("joined", { success: true });
      console.log(`👥  ${socket.id} joined game ${gameId}`);

    } catch (err) {
      console.error(`❌ Error during join_game:`, err.message);
      socket.emit("joined", { success: false, error: err.message });
    }
  });

  /* Player command handling */
  socket.on("player_command", async (command) => {
    try {
      console.log("🎮 Player command received:", command);
      
      // Find which game this socket belongs to
      const gameId = Array.from(socket.rooms).find(room => 
        room !== socket.id && managers.has(room)
      );
      
      if (!gameId) {
        console.error("❌ No active game found for socket", socket.id);
        return;
      }
      
      const gm = managers.get(gameId);
      if (!gm) {
        console.error("❌ Game manager not found for", gameId);
        return;
      }
      
      // Process the command
      await gm._applyActions([command]);
      
    } catch (err) {
      console.error("❌ Error processing player command:", err);
      socket.emit("command_error", { error: err.message });
    }
  });

  socket.on("set_game_speed", async ({ gameId, speed }) => {
      try {
          const gm = managers.get(gameId);
          if (gm) {
              console.log(`⚡ Setting game ${gameId} speed to ${speed}x`);
              gm.setSpeed(speed);
          }
      } catch (err) {
          console.error("❌ Error setting game speed:", err);
      }
  });

  socket.on("pause_game", async ({ gameId }) => {
      try {
          const gm = managers.get(gameId);
          if (gm && gm.isRunning()) {
              console.log(`⏸️ Pausing game ${gameId} by player request`);
              gm.pause();
          }
      } catch (err) {
          console.error("❌ Error pausing game:", err);
      }
  });

  socket.on("resume_game", async ({ gameId }) => {
      try {
          const gm = managers.get(gameId);
          if (gm && gm.isPaused()) {
              console.log(`▶️ Resuming game ${gameId} by player request`);
              gm.resume();
          }
      } catch (err) {
          console.error("❌ Error resuming game:", err);
      }
  });

});

/* ---------------------- REST API --------------------- */

/** Luo uusi peli */
app.post("/api/games/new", async (req, res) => {
  try {
    const playerId = req.sessionID; // Uniikki selain-istunnon tunniste

    // --- TÄMÄ ON KRIITTINEN SIIVOUSLOGIIKKA ---
    // Etsi KAIKKI tähän sessioon liittyvät vanhat, mahdollisesti käynnissä olevat pelit.
    const existingGames = await Game.find({ 
      status: "playing",
      "settings.playerId": playerId
    }).exec();

    if (existingGames.length > 0) {
      console.log(`🔄 Found ${existingGames.length} old game(s) for player ${playerId.slice(-6)}. Cleaning up...`);
      existingGames.forEach(game => {
        const oldGameId = game._id.toString();
        const oldGm = managers.get(oldGameId);
        if (oldGm) {
          console.log(`   - Stopping and deleting active manager for game ${oldGameId}`);
          oldGm.stop(); // Pysäyttää setInterval-loopin
          managers.delete(oldGameId);
        }
        game.status = 'aborted';
        game.finishedAt = new Date();
        game.save(); // Tallenna muutos tietokantaan
      });
    }
    // --- SIIVOUS PÄÄTTYY ---

    /* Luo ja käynnistä uusi peli (tämä osa on kuten ennenkin) */
    console.log(`✨ Creating new game for player ${playerId.slice(-6)}.`);
    const gm = new GameManager({ io });
    const gameConfig = {
      ...req.body,
      playerId: playerId // Tallenna session ID uuteen peliin
    };
    const out = await gm.createWorld(gameConfig);
    gm.start();
    managers.set(out.gameId.toString(), gm);

    res.status(201).json(out);
  } catch (err) {
    console.error("❌ Error in /api/games/new:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


/* ---- Cleanup scheduled job ---- */
setInterval(async () => {
  try {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h vanha
    
    // Poista vanhat "lobby" tilassa olevat pelit
    const deletedLobby = await Game.deleteMany({
      status: 'lobby',
      createdAt: { $lt: cutoffTime }
    });
    
    // Merkitse vanhat aktiiviset pelit päättyneiksi
    const aborted = await Game.updateMany(
      {
        status: 'playing',
        lastSavedAt: { $lt: cutoffTime }
      },
      {
        $set: { 
          status: 'aborted',
          finishedAt: new Date()
        }
      }
    );
    
    if (deletedLobby.deletedCount > 0 || aborted.modifiedCount > 0) {
      console.log(`🧹 Cleaned up: ${deletedLobby.deletedCount} lobby games deleted, ${aborted.modifiedCount} games aborted`);
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}, 10 * 60 * 1000); // 10 min



/* ---------------------------------------------------- */
httpSrv.listen(PORT, () => console.log(`🚀  Server running on :${PORT}`));