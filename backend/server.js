// server.js – Express + Mongo + Socket.IO bootstrap
// ---------------------------------------------------------------------------

require("dotenv").config();

const express    = require("express");
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
  socket.emit('hello', 'world');
  
  /* Client pyytää liittymään peliin */
  socket.on("join_game", async ({ gameId }) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(gameId)) throw new Error("invalid gameId");

      /* Saa tai luo manager */
      let gm = managers.get(gameId);
      if (!gm) {
        gm = new GameManager({ gameId, io });
        await gm.init();
        gm.start();
        managers.set(gameId, gm);
      }

      socket.join(gameId);
      // Lähetä heti perään initial-state _huoneen sijasta suoraan tälle socke­tille_
      const state = await gm.getSerializableState();   // jos sync, jätä await pois
      io.to(socket.id).emit("initial_state", state);   // <- varmistaa että osuu perille
      socket.emit("joined", { success: true });

      console.log(`👥  ${socket.id} joined, state bytes:`, JSON.stringify(state).length);
    } catch (err) {
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

  socket.on("disconnect", () => {
    console.log("⚡️  Client disconnected", socket.id);
    /* Voisit tarkistaa, jääkö huone tyhjäksi ja pysäyttää gm:n */
  });
});

/* ---------------------- REST API --------------------- */

/** Luo uusi peli */
app.post("/api/games/new", async (req, res) => {
  try {
    /* Tarkista: vain yksi aktiivinen kerrallaan */
    const existing = await Game.findOne({ status: "ongoing" }).exec();
    if (existing) {
      return res.status(400).json({ success:false, message:"Aktiivinen peli on jo käynnissä." });
    }

    /* Luo ja käynnistä */
    const gm   = new GameManager({ io });
    const out  = await gm.createWorld(req.body);   // → { success, gameId }
    gm.start();
    managers.set(out.gameId.toString(), gm);

    res.status(201).json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, error: err.message });
  }
});

/* ---------------------------------------------------- */
httpSrv.listen(PORT, () => console.log(`🚀  Server running on :${PORT}`));
