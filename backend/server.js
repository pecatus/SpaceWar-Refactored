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
/* Käytetään muistissa pientä manager-cachea: Map<gameId, GameManager> */
const managers = new Map();
/* Tallennetaan human player socketit: Map<gameId, socketId> */
const humanPlayerSockets = new Map();


app.use(express.json());

/* ---------------------- CORS ------------------------- */
const WHITELIST = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://lassesimonen.fi"
];

app.use(cors({
  origin: WHITELIST, // Anna taulukko suoraan
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


/* ---- Socket-tapahtumat ------------------------------ */
io.on("connection", socket => {
  console.log("🔌  Client connected", socket.id);
  
  // Tallenna pelaajan peli-ID muistiin join_game yhteydessä
  socket.on("join_game", async ({ gameId }) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(gameId)) {
        throw new Error("Invalid gameId provided to join_game.");
      }

      const gm = managers.get(gameId);
      if (!gm) {
        throw new Error("Game manager not found. Cannot join.");
      }
      
      // Tallenna human player socket
      humanPlayerSockets.set(gameId, socket.id);
      
      socket.join(gameId);
      console.log(`👥  Socket ${socket.id} successfully joined room ${gameId}`);

      if (!gm.isRunning() && !gm.isPaused()) {
        console.log(`🚀 Starting game ${gameId} tick loop as player has joined.`);
        gm.start();
      }

      socket.emit("joined", { success: true });

    } catch (err) {
      console.error(`❌ Error during join_game:`, err.message);
      socket.emit("joined", { success: false, error: err.message });
    }
  });

  // PARANNETTU disconnect-käsittelijä
  socket.on("disconnecting", async () => {
    console.log(`⚡️ Client disconnected: ${socket.id}`);

    // Etsi kaikki pelit joissa tämä socket on mukana
    for (const [gameId, humanSocketId] of humanPlayerSockets.entries()) {
      // Tarkista onko tämä human player
      if (humanSocketId === socket.id) {
        console.log(`   - Human player disconnected from game ${gameId}. Stopping game.`);
        
        const gm = managers.get(gameId);
        if (gm) {
          // Pysäytä peli välittömästi
          gm.stop();
          managers.delete(gameId);
          humanPlayerSockets.delete(gameId);
          
          // Poista kaikki socketit huoneesta
          const socketsInRoom = await io.in(gameId).fetchSockets();
          for (const s of socketsInRoom) {
            s.leave(gameId);
          }
          
          console.log(`   - Game ${gameId} stopped and all sockets removed from room.`);

          // Merkitse peli päättyneeksi
          Game.findByIdAndUpdate(gameId, {
            status: 'aborted',
            finishedAt: new Date()
          })
          .exec()
          .then(updatedGame => {
            if (updatedGame) {
              console.log(`   - Game ${gameId} marked as 'aborted' in database.`);
            }
          })
          .catch(err => {
            console.error(`   - Error updating game status:`, err);
          });
        }
      }
    }
  });


  /* Player command handling */
  socket.on("player_command", async (command) => {
    try {
      //console.log("🎮 Player command received:", command);
      
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

  // Kuuntele clientin ping-viestejä ja vastaa pongilla
  socket.on('client_ping', () => {
      // Voit halutessasi lähettää vastauksen, mutta pelkkä pyynnön
      // vastaanottaminen riittää pitämään yhteyden aktiivisena.
      // logDev(`Received ping from ${socket.id}`);
      socket.emit('server_pong');
  });

});

/* ---------------------- REST API --------------------- */
/** Luo uusi peli */
app.post("/api/games/new", async (req, res) => {
  try {
    const playerId = req.sessionID; // Uniikki selain-istunnon tunniste

    // --- PARANNETTU SIIVOUSLOGIIKKA ---
    // Etsi KAIKKI tähän sessioon liittyvät vanhat pelit (sekä playing että lobby)
    const existingGames = await Game.find({ 
      status: { $in: ["playing", "lobby"] },
      "settings.playerId": playerId
    }).exec();

    if (existingGames.length > 0) {
      console.log(`🔄 Found ${existingGames.length} old game(s) for player ${playerId.slice(-6)}. Cleaning up...`);
      
      // Käytä for-of looppia async/await kanssa
      for (const game of existingGames) {
        const oldGameId = game._id.toString();
        
        // Pysäytä ja poista GameManager
        const oldGm = managers.get(oldGameId);
        if (oldGm) {
          console.log(`   - Stopping game ${oldGameId}`);
          oldGm.stop(); // Pysäyttää setInterval-loopin
          oldGm.removeAllListeners(); // Poista kaikki event listenerit
          managers.delete(oldGameId);
        }
        
        // Poista human player socket mapping
        humanPlayerSockets.delete(oldGameId);
        
        // Poista kaikki socketit vanhasta huoneesta
        try {
          const socketsInOldRoom = await io.in(oldGameId).fetchSockets();
          for (const s of socketsInOldRoom) {
            s.leave(oldGameId);
          }
          console.log(`   - Removed ${socketsInOldRoom.length} sockets from room ${oldGameId}`);
        } catch (err) {
          console.error(`   - Error removing sockets from room:`, err);
        }
        
        // Merkitse peli päättyneeksi
        game.status = 'aborted';
        game.finishedAt = new Date();
        await game.save();
        console.log(`   - Game ${oldGameId} marked as aborted`);
      }
    }
    // --- SIIVOUS PÄÄTTYY ---

    /* Luo uusi peli */
    console.log(`✨ Creating new game for player ${playerId.slice(-6)}.`);
    
    // Pelin asetukset (voit muokata näitä tai ottaa req.body:stä)
    const gameConfig = {
      humanName: req.body.playerName || "Player",
      humanColor: req.body.playerColor || "#007bff",
      numAiPlayers: req.body.numAiPlayers|| 1,
      aiColors: req.body.aiColors || ["#dc3545", "#28a745", "#ffc107", "#17a2b8"],
      starCount: req.body.starCount || 120,
      playerId: playerId,
      lobbyHost: "server",
      speed: req.body.speed || 1
    };

    // Luo GameManager ja maailma
    const gm = new GameManager({ io });
    const result = await gm.createWorld(gameConfig);
    const newGameId = result.initialState.gameId;

    // Kuuntele jos peli hylätään (ei pelaajia)
    gm.on('abandoned', async (abandonedGameId) => {
      console.log(`🗑️  Game ${abandonedGameId} abandoned - cleaning up`);
      
      // Poista managereista ja socket-mappauksesta
      managers.delete(abandonedGameId);
      humanPlayerSockets.delete(abandonedGameId);
      
      // Varmista että kaikki socketit poistetaan huoneesta
      try {
        const remainingSockets = await io.in(abandonedGameId).fetchSockets();
        for (const s of remainingSockets) {
          s.leave(abandonedGameId);
        }
      } catch (err) {
        console.error('Error removing sockets on abandonment:', err);
      }
      
      // Merkitse peli päättyneeksi tietokannassa
      Game.findByIdAndUpdate(abandonedGameId, {
        status: 'abandoned',
        finishedAt: new Date()
      }).exec().catch(err => {
        console.error('Error marking game as abandoned:', err);
      });
    });

    // Tallenna GameManager aktiivisten pelien listaan
    managers.set(newGameId.toString(), gm);
    
    console.log(`✅ New game ${newGameId} created successfully`);

    // Palauta pelin alkutila clientille
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