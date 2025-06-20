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
      if (!mongoose.Types.ObjectId.isValid(gameId)) {
        throw new Error("Invalid gameId provided to join_game.");
      }

      const gm = managers.get(gameId);

      // Jos jostain syystä pelimanageria ei löydy, lähetä virhe.
      // (Tämän ei pitäisi enää tapahtua uudessa logiikassa).
      if (!gm) {
        throw new Error("Game manager not found. Cannot join.");
      }
      
      // 1. Liitä socket pelihuoneeseen, jotta se vastaanottaa tulevat päivitykset.
      socket.join(gameId);
      console.log(`👥  Socket ${socket.id} successfully joined room ${gameId}`);

      // 2. TÄSSÄ ON SE KRIITTINEN "VARMISTUS":
      // Käynnistä pelin serveri-side-looppi, JOS se ei ole jo käynnissä.
      if (!gm.isRunning() && !gm.isPaused()) {
        console.log(`🚀 Starting game ${gameId} tick loop as player has joined.`);
        gm.start();
      }

      // 3. Vahvista clientille, että liittyminen huoneeseen onnistui.
      // HUOM: Emme enää lähetä `initial_state`-dataa tästä, koska client sai sen jo
      // aiemmin HTTP-vastauksessa.
      socket.emit("joined", { success: true });

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
      const gameId = command.gameId; 
      
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

    /* Luo ja käynnistä uusi peli  */
    console.log(`✨ Creating new game for player ${req.sessionID.slice(-6)}.`);
    const gm = new GameManager({ io });
    const gameConfig = { /* ... */ };

    // createWorld palauttaa nyt { success: true, initialState: { ... } }
    const result = await gm.createWorld(gameConfig);
    const newGameId = result.initialState.gameId; // Otetaan gameId talteen initialStatesta

    // Peli ei käynnisty vielä, vaan vasta kun pelaaja liittyy
    managers.set(newGameId.toString(), gm);

    // LÄHETETÄÄN KOKO ALKUTILA VASTAUKSENA
    res.status(201).json(result);
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