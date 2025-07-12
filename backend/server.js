// server.js – Express + Mongo + Socket.IO bootstrap
// =================================================================================
// TÄMÄ TIEDOSTO ON SOVELLUKSEN SYDÄN PALVELINPUOLELLA.
// Se on vastuussa seuraavista päätehtävistä:
// 1. Express-palvelimen luonti ja konfigurointi HTTP-pyyntöjen käsittelyyn.
// 2. Yhteyden muodostaminen MongoDB-tietokantaan Mongoose-kirjaston avulla.
// 3. Socket.IO-palvelimen alustus reaaliaikaista kaksisuuntaista viestintää varten.
// 4. Aktiivisten pelien hallinta GameManager-instanssien avulla.
// =================================================================================


// Ladataan ympäristömuuttujat .env-tiedostosta.
// MIKSI: Tämä mahdollistaa arkaluontoisten tietojen, kuten tietokannan
// yhteysosoitteen, pitämisen erillään koodista.
require("dotenv").config();


// --- RIIPPUVUUDET (IMPORTS) ---
// Ladataan kaikki tarvittavat Node.js-moduulit.
const express    = require("express");        // Web-sovelluskehys HTTP-palvelimen ja reitityksen luomiseen.
const session    = require('express-session');// (Ei tällä hetkellä aktiivisessa käytössä, mutta varattu sessioiden hallintaan).
const cors       = require("cors");           // Middleware, joka sallii selainten tehdä pyyntöjä eri alkuperästä (domainista).
const mongoose   = require("mongoose");       // ODM-kirjasto (Object Data Modeling) MongoDB:n kanssa työskentelyyn.
const http       = require("http");           // Node.js:n sisäänrakennettu moduuli HTTP-palvelimen luomiseen.
const { Server } = require("socket.io");      // Socket.IO-palvelinkirjasto WebSocket-pohjaiseen reaaliaikaviestintään.

// --- SOVELLUKSEN OMAT MODUULIT ---
const GameManager = require("./gameLogic/GameManager"); // Pelilogiikan pääluokka, joka hallinnoi yhden pelin tilaa.
const Game        = require("./models/Game");           // Mongoose-skeema, joka määrittelee pelin tietorakenteen tietokannassa.

// --- ALUSTUS ---
const app  = express();                       // Luodaan uusi Express-sovellusinstanssi.
const PORT = process.env.PORT || 3001;        // Määritetään portti, jossa palvelin kuuntelee. Käyttää .env-tiedoston porttia tai oletusta 3001.

// --- GLOBAALI TILANHALLINTA (PALVELIMEN MUISTISSA) ---

/**
 * @summary Aktiivisten pelien välimuisti.
 * @description MITÄ: Tämä Map-rakenne säilyttää käynnissä olevien pelien GameManager-instanssit.
 * Avaimena on pelin ID (`gameId`) ja arvona vastaava `GameManager`-olio.
 * MIKSI: Pitämällä aktiiviset pelit palvelimen muistissa vältetään jatkuvat, hitaat
 * tietokantahaut jokaista pelitapahtumaa kohden. Tämä on elintärkeää pelin suorituskyvylle.
 * @type {Map<string, GameManager>}
 */
const managers = new Map();


/**
 * @summary Ihmispelaajien socket-yhteyksien seuranta.
 * @description MITÄ: Tämä Map säilöö, mikä socket-yhteys kuuluu millekin ihmispelaajalle
 * kussakin pelissä. Avaimena on pelin ID (`gameId`) ja arvona pelaajan `socket.id`.
 * MIKSI: Mahdollistaa suorien viestien lähettämisen tietylle pelaajalle ja auttaa
 * tunnistamaan, kuka pelin "isäntä" (host) on.
 * @type {Map<string, string>}
 */
const humanPlayerSockets = new Map();


// --- MIDDLEWARE-MÄÄRITYKSET ---

// MITÄ: Ottaa käyttöön JSON-parserin.
// MIKSI: Tämä Expressin sisäänrakennettu middleware jäsentää saapuvien
// HTTP-pyyntöjen rungon (body) JSON-muodosta JavaScript-objektiksi,
// joka on helposti käsiteltävissä (esim. `req.body`).
app.use(express.json());


/* ---------------------- CORS (Cross-Origin Resource Sharing) ------------------------- */
// MITÄ: Määritellään, mitkä ulkoiset osoitteet saavat tehdä pyyntöjä tähän palvelimeen.
// MIKSI: Selaimet estävät oletuksena HTTP-pyynnöt eri domaineihin turvallisuussyistä.
// CORS-määritys kertoo selaimelle, että luotamme listattuihin osoitteisiin ja sallimme
// niiden kommunikoida palvelimemme kanssa.
const WHITELIST = [
  "http://127.0.0.1:5500",    // Paikallinen kehitysympäristö (Live Server)
  "http://localhost:5500",    // Toinen yleinen paikallinen osoite
  "https://lassesimonen.fi",   // Tuotantoympäristön domain
  "https://www.lassesimonen.fi"
];

app.use(cors({
  origin: WHITELIST,          // Sallitaan pyynnöt vain WHITELIST-taulukossa olevista osoitteista.
  methods: ["GET", "POST", "OPTIONS"],  // Sallitaan vain tietyt HTTP-metodit.
  credentials: true           // Sallitaan evästeiden ja sessiotietojen lähettäminen pyyntöjen mukana.
}));


/* ---------------------- MongoDB-YHTEYS ---------------------- */
// MITÄ: Yritetään yhdistää MongoDB-tietokantaan käyttäen .env-tiedostosta löytyvää URIa.
// MIKSI: Tietokantayhteys on välttämätön pelien tilan pysyvään tallentamiseen ja
// lataamiseen. `.then()` ja `.catch()` hoitavat yhteyden onnistumisen ja epäonnistumisen.
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅  MongoDB connected"))   // Tulostetaan onnistumisviesti konsoliin.
  // Jos yhteys epäonnistuu, tulostetaan virhe ja sammutetaan koko prosessi.
  // Tämä estää sovelluksen ajamisen epävakaassa tilassa ilman tietokantaa.
  .catch(err => { console.error("❌  Mongo error:", err.message); process.exit(1); });



/* ---------------------- Sessions --------------------- */
// MITÄ: Otetaan käyttöön express-session -middleware.
// MIKSI: Tämä middleware luo ja hallinnoi yksilöllisiä sessioita jokaiselle selaimeen
// yhdistävälle käyttäjälle. Tässä sovelluksessa `req.sessionID`:tä käytetään
// luotettavana ja uniikkina tunnisteena ihmispelaajalle, kun uusi peli luodaan.
// Se varmistaa, että sama pelaaja voi jatkaa peliään ja että vanhat pelit
// voidaan siivota pois, kun sama pelaaja aloittaa uuden.
app.use(session({
  // Salainen avain, jota käytetään allekirjoittamaan sessio-ID-eväste.
  // Tulee AINA olla .env-tiedostossa tuotannossa turvallisuussyistä.
  secret: process.env.SESSION_SECRET, 
  // `resave: false` estää session tallentamisen uudelleen, jos sitä ei ole muutettu.
  // Tämä on suorituskykyoptimointi.
  resave: false,
  // `saveUninitialized: true` tallentaa uuden, mutta muuttamattoman session heti.
  // Tämä on välttämätöntä, jotta `req.sessionID` on olemassa heti ensimmäisestä pyynnöstä alkaen.
  saveUninitialized: true,
  cookie: { 
    secure: false, // Aseta `true` tuotannossa, jos käytät HTTPS:ää.
    httpOnly: true, // Estää client-puolen JavaScriptiä lukemasta evästettä.
    maxAge: 24 * 60 * 60 * 1000 // Evästeen elinikä: 24 tuntia.
  }
}));


/* ---------------------- Socket.IO-ALUSTUS -------------------- */
// MITÄ: Luodaan natiivi Node.js http-palvelin ja liitetään Socket.IO siihen.
// MIKSI: Socket.IO vaatii toimiakseen HTTP-palvelimen, johon se voi "kiinnittyä".
// Vaikka Express luo oman HTTP-palvelimensa sisäisesti, Socket.IO:n eksplisiittinen
// liittäminen antaa paremman kontrollin ja on vakiintunut käytäntö.
const httpSrv = http.createServer(app);
// Luodaan uusi Socket.IO-palvelininstanssi ja liitetään se HTTP-palvelimeen.
const io = new Server(httpSrv, {
  // Socket.IO tarvitsee oman CORS-määrityksensä, koska se tekee aluksi
  // HTTP-pyyntöjä (polling) ennen mahdolliseen WebSocket-yhteyteen siirtymistä.
  cors: {
    origin: WHITELIST,     // Sallitut alkuperät, sama kuin Expressillä.
    methods: ["GET", "POST"]
  }
});


/* ---- Socket-tapahtumat ------------------------------ */
// MITÄ: Tämä lohko määrittelee, miten palvelin reagoi saapuviin reaaliaikaisiin
// viesteihin client-selaimilta. "connection"-tapahtuma on pääsisäänkäynti,
// ja sen sisällä määritellään kuuntelijat kaikille muille pelin aikana
// lähetettäville viesteille (esim. "join_game", "player_command").
io.on("connection", socket => {
  // Jokainen uusi selainyhteys saa uniikin socket.id:n.
  console.log("🔌  Client connected", socket.id);
  

  /**
   * KUUNTELIJA: 'join_game'
   * MITÄ: Liittää clientin socketin tiettyyn pelihuoneeseen (`gameId`).
   * MIKSI: Tämä on kriittinen vaihe, jossa client "astuu sisään" peliin.
   * 1.  Varmistaa, että peli on olemassa ja aktiivinen (`managers.get(gameId)`).
   * 2.  Tallentaa ihmispelaajan socket-yhteyden (`humanPlayerSockets`), jotta tiedetään,
   * kuka pelin "isäntä" on ja kenen yhteyden katkeaminen päättää pelin.
   * 3.  Liittää socketin Socket.IO-huoneeseen, mikä mahdollistaa tehokkaan
   * viestinvälityksen vain tämän pelin pelaajille.
   * 4.  Käynnistää pelisilmukan (`gm.start()`), jos se ei ole jo käynnissä.
   */
  socket.on("join_game", async ({ gameId }) => {
    try {
      // Validoi, että annettu gameId on kelvollinen MongoDB ObjectId.
      if (!mongoose.Types.ObjectId.isValid(gameId)) {
        throw new Error("Invalid gameId provided to join_game.");
      }

      // Varmista, että pelille on olemassa aktiivinen GameManager muistissa.
      const gm = managers.get(gameId);
      if (!gm) {
        throw new Error("Game manager not found. Cannot join.");
      }

      // Tallenna tämän ihmispelaajan socket-yhteys.
      humanPlayerSockets.set(gameId, socket.id);

      // Liitä socket huoneeseen.
      socket.join(gameId);
      console.log(`👥  Socket ${socket.id} successfully joined room ${gameId}`);

      // Jos pelisilmukka ei ole käynnissä, käynnistä se nyt kun pelaaja on liittynyt.
      if (!gm.isRunning() && !gm.isPaused()) {
        console.log(`🚀 Starting game ${gameId} tick loop as player has joined.`);
        gm.start();
      }
      // Lähetä onnistumisvahvistus takaisin clientille.
      socket.emit("joined", { success: true });

    } catch (err) {
      console.error(`❌ Error during join_game:`, err.message);
      socket.emit("joined", { success: false, error: err.message });
    }
  });


  /**
   * KUUNTELIJA: 'disconnecting'
   * MITÄ: Suorittaa siivoustoimenpiteet, kun ihmispelaajan yhteys katkeaa.
   * MIKSI: Tämä on elintärkeää palvelimen resurssienhallinnalle. Jos ihmispelaaja
   * poistuu, peli ei voi jatkua. Tämä logiikka pysäyttää GameManager-instanssin,
   * poistaa sen muistista (`managers.delete`), siivoaa socket-viittaukset ja
   * merkitsee pelin tietokannassa keskeytetyksi (`aborted`). Tämä estää
   * "zombie-pelien" jäämisen pyörimään palvelimelle. `disconnecting`-event on
   * parempi kuin `disconnect`, koska se antaa pääsyn huoneisiin, joissa socket oli,
   * ennen kuin se automaattisesti poistetaan niistä.
   */
  socket.on("disconnecting", async () => {
    console.log(`⚡️ Client disconnected: ${socket.id}`);

    // Etsi, oliko poistuva socket ihmispelaajan socket jossakin pelissä.
    for (const [gameId, humanSocketId] of humanPlayerSockets.entries()) {
      // Tarkista onko tämä human player
      if (humanSocketId === socket.id) {
        console.log(`   - Human player disconnected from game ${gameId}. Stopping game.`);
        
        const gm = managers.get(gameId);
        if (gm) {
          // Pysäytä pelisilmukka ja poista peli aktiivisten pelien listalta.
          gm.stop();
          managers.delete(gameId);
          humanPlayerSockets.delete(gameId);
          
          // Poista kaikki socketit huoneesta
          const socketsInRoom = await io.in(gameId).fetchSockets();
          for (const s of socketsInRoom) {
            s.leave(gameId);
          }
          console.log(`   - Game ${gameId} stopped and all sockets removed from room.`);

          // Merkitse peli päättyneeksi tietokannassa.
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


  /**
   * KUUNTELIJA: 'player_command'
   * MITÄ: Vastaanottaa ja käsittelee kaikki pelaajan pelin aikana tekemät komennot.
   * MIKSI: Tämä on keskitetty reitti, jonka kautta client vaikuttaa pelin tilaan.
   * Se etsii oikean GameManager-instanssin ja välittää komennon sille
   * `_applyActions`-metodin kautta, joka toimii auktoriteettina ja suorittaa
   * varsinaisen pelilogiikan (esim. resurssien vähennys, jonoon lisääminen).
   */
  socket.on("player_command", async (command) => {
    try {
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
      
      // Välitä komento GameManagerille suoritettavaksi.
      await gm._applyActions([command]);
      
    } catch (err) {
      console.error("❌ Error processing player command:", err);
      socket.emit("command_error", { error: err.message });
    }
  });


    /**
   * KUUNTELIJA: 'set_game_speed', 'pause_game', 'resume_game'
   * MITÄ: Käsittelee pelin metatason kontrolleja, kuten nopeutta ja pausetusta.
   * MIKSI: Antaa pelaajalle kontrollin pelin kulkuun. Nämä komennot eivät muuta
   * pelin tilaa suoraan, vaan kutsuvat GameManagerin metodeja (`setSpeed`, `pause`,
   * `resume`), jotka hallinnoivat pelisilmukan ajoitusta.
   */
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

  /**
   * ----- EI TOIMI ODOTETUSTI: RENDER.com vaatii maksullisen instanssin,
   * jotta palvelin pysyy pystyssä yli 15 minuuttia. Tämä EI korjannut tilannetta
   * REAALIAIKAINEN ENDPOINT: '/api/keep-alive'
   * MITÄ: Yksinkertainen HTTP-reitti, joka vastaa "olen elossa" -viestillä.
   * MIKSI: Ilmaiset Render.com-instanssit "nukahtavat" 15 minuutin käyttämättömyyden
   * jälkeen. Vaikka Socket.IO-yhteys on auki, Render ei välttämättä tulkitse sitä
   * HTTP-aktiivisuudeksi. Client lähettää säännöllisesti pyynnön tähän reittiin
   * estääkseen palvelimen nukahtamisen kesken pelin.
   */
  app.use(cors({
    origin: WHITELIST,
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true
  }));

  // Keep-alive-reitti estämään Renderin nukahtamisen
  app.get('/api/keep-alive', (req, res) => {
    res.status(200).send({ status: 'alive' });
  });

});


/* ---------------------- REST API --------------------- */

/**
 * ENDPOINT: POST /api/games/new
 * MITÄ: Luo täysin uuden pelisession ja palauttaa sen alkutilan.
 * MIKSI: Tämä on ainoa reitti, jonka kautta pelaaja voi aloittaa uuden pelin.
 * Se on vastuussa koko prosessista alusta loppuun.
 *
 * TÄRKEÄ LOGIIKKA:
 * 1.  VANHOJEN PELIEN SIIVOUS: Ennen uuden pelin luontia, endpoint etsii ja
 * tuhoaa kaikki saman pelaajan (saman session ID:n) aiemmat, mahdollisesti
 * kesken jääneet pelit. Tämä on kriittistä resurssien vapauttamiseksi:
 * se pysäyttää vanhat pelisilmukat, poistaa GameManagerit muistista ja
 * merkitsee vanhat pelit tietokantaan hylätyiksi.
 * 2.  UUDEN PELIN LUONTI: Luo uuden GameManager-instanssin ja kutsuu sen
 * `createWorld`-metodia, joka generoi proseduraalisesti koko pelimaailman
 * (pelaajat, tähdet, yhteydet).
 * 3.  RESURSSIEN HALLINTA: Tallentaa juuri luodun GameManager-instanssin
 * palvelimen muistissa olevaan `managers`-välimuistiin, jotta pelitapahtumia
 * voidaan käsitellä nopeasti ilman jatkuvia tietokantahakuja.
 * 4.  VASTAUS CLIENTILLE: Palauttaa HTTP 201 -vastauksena koko pelin alkutilan
 * (initialState), jonka client käyttää 3D-maailman rakentamiseen.
 */
app.post("/api/games/new", async (req, res) => {
  try {
    // Käytetään express-sessionin luomaa uniikkia ID:tä pelaajan tunnistamiseen.
    const playerId = req.sessionID; 

    // --- VAIHE 1: Siivoa vanhat, kesken jääneet pelit ---
    // Etsi kaikki tämän session ID:n omistamat pelit, jotka ovat vielä "playing" tai "lobby" -tilassa.
    const existingGames = await Game.find({ 
      status: { $in: ["playing", "lobby"] },
      "settings.playerId": playerId
    }).exec();

    if (existingGames.length > 0) {
      console.log(`🔄 Found ${existingGames.length} old game(s) for player ${playerId.slice(-6)}. Cleaning up...`);
      
      // Käydään läpi ja tuhotaan kaikki vanhat pelit.
      for (const game of existingGames) {
        const oldGameId = game._id.toString();
        
        // Pysäytä ja poista muistissa oleva GameManager, jos sellainen on.
        const oldGm = managers.get(oldGameId);
        if (oldGm) {
          console.log(`   - Stopping game ${oldGameId}`);
          oldGm.stop();                           // Pysäyttää pelisilmukan.
          oldGm.removeAllListeners();             // Poistaa event listenerit (esim. 'abandoned').
          managers.delete(oldGameId);
        }
        
        // Poista pelaajan socket-viittaus
        humanPlayerSockets.delete(oldGameId);
        
        // Varmista, että kaikki socketit poistetaan vanhasta pelihuoneesta.
        try {
          const socketsInOldRoom = await io.in(oldGameId).fetchSockets();
          for (const s of socketsInOldRoom) {
            s.leave(oldGameId);
          }
          console.log(`   - Removed ${socketsInOldRoom.length} sockets from room ${oldGameId}`);
        } catch (err) {
          console.error(`   - Error removing sockets from room:`, err);
        }
        
        // Merkitse peli tietokannassa keskeytetyksi.
        game.status = 'aborted';
        game.finishedAt = new Date();
        await game.save();
        console.log(`   - Game ${oldGameId} marked as aborted`);
      }
    }
    // --- SIIVOUS PÄÄTTYY ---

    // --- VAIHE 2: Luo uusi peli ---
    console.log(`✨ Creating new game for player ${playerId.slice(-6)}.`);
    
    // Kerätään pelin asetukset clientin lähettämästä pyynnöstä (req.body).
    const gameConfig = {
      humanName: req.body.playerName || "Player",
      humanColor: req.body.playerColor || "#007bff",
      numAiPlayers: req.body.numAiPlayers|| 1,
      aiColors: req.body.aiColors || ["#dc3545", "#28a745", "#ffc107", "#17a2b8"],
      starCount: req.body.starCount || 120,
      playerId: playerId,                   // Tärkeä: liitetään session ID peliin.
      lobbyHost: "server",
      speed: req.body.speed || 1
    };

    // Luo uusi GameManager ja sen sisällä koko pelimaailma.
    const gm = new GameManager({ io });
    const result = await gm.createWorld(gameConfig);
    const newGameId = result.initialState.gameId;

    // Asetetaan kuuntelija 'abandoned'-tapahtumalle. Tämä laukeaa, jos peli
    // luodaan, mutta kukaan ei liity siihen tietyn ajan kuluessa.
    gm.on('abandoned', async (abandonedGameId) => {
      console.log(`🗑️  Game ${abandonedGameId} abandoned - cleaning up`);
      
      // Suoritetaan siivouslogiikka.
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

    // Tallennetaan uusi, aktiivinen GameManager muistiin nopeaa käyttöä varten.
    managers.set(newGameId.toString(), gm);
    
    console.log(`✅ New game ${newGameId} created successfully`);

    // Palautetaan koko pelin alkutila clientille, joka rakentaa sen perusteella näkymän.
    res.status(201).json(result);
    
  } catch (err) {
    console.error("❌ Error in /api/games/new:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


/* ---- Cleanup scheduled job ---- */

/**
 * AJASTETTU TEHTÄVÄ: Siivoaa tietokannasta vanhat ja hylätyt pelit ja kaiken niihin liittyvän datan.
 * MITÄ: Tämä `setInterval`-funktio suoritetaan automaattisesti 10 minuutin välein.
 * Se etsii kaikki yli 24 tuntia vanhat pelit ja poistaa ne sekä kaikki niihin
 * viittaavat Player-, Star- ja Ship-dokumentit.
 * MIKSI: Tämä on keskitetty ja luotettava tapa pitää tietokanta siistinä ja
 * estää "orpojen" dokumenttien kertyminen. Se takaa datan eheyden paremmin
 * kuin yksittäiset TTL-indeksit.
 */
setInterval(async () => {
  try {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h vanha
    
    // 1. Etsi kaikki pelit, jotka ovat yli 24h vanhoja.
    // Haetaan vain ID:t, koska emme tarvitse muuta dataa, mikä tekee kyselystä tehokkaamman.
    const oldGames = await Game.find({
        createdAt: { $lt: cutoffTime }
    }).select('_id').lean();

    if (oldGames.length > 0) {
        const gameIdsToDelete = oldGames.map(g => g._id);
        console.log(`🧹 Found ${gameIdsToDelete.length} old game(s) to clean up.`);

        // 2. Rakenna lupaukset kaikkien peliin liittyvien dokumenttien poistamiseksi.
        const playerPromise = Player.deleteMany({ gameId: { $in: gameIdsToDelete } });
        const starPromise = Star.deleteMany({ gameId: { $in: gameIdsToDelete } });
        const shipPromise = Ship.deleteMany({ gameId: { $in: gameIdsToDelete } });

        // 3. Poista itse Game-dokumentit.
        const gamePromise = Game.deleteMany({ _id: { $in: gameIdsToDelete } });

        // Aja kaikki poistot rinnakkain ja odota niiden valmistumista.
        const [playerResult, starResult, shipResult, gameResult] = await Promise.all([
            playerPromise,
            starPromise,
            shipPromise,
            gamePromise
        ]);

        console.log(`   - Deleted: ${gameResult.deletedCount} games, ${playerResult.deletedCount} players, ${starResult.deletedCount} stars, ${shipResult.deletedCount} ships.`);
    }

  } catch (err) {
    console.error('Cleanup error:', err);
  }
}, 10 * 60 * 1000); // Suoritetaan 10 minuutin välein.



/* ---------------------------------------------------- */
/**
 * KÄYNNISTYS: Käynnistää HTTP-palvelimen kuuntelemaan pyyntöjä.
 * MITÄ: Tämä on tiedoston viimeinen ja yksi tärkeimmistä komennoista. Se sitoo
 * luodun http-palvelimen (johon myös Socket.IO on liitetty) määriteltyyn
 * porttiin ja alkaa hyväksyä saapuvia yhteyksiä.
 * MIKSI: Ilman tätä kutsua palvelin ei koskaan käynnistyisi eikä olisi
 * saavutettavissa internetistä tai paikallisverkosta.
 */
httpSrv.listen(PORT, () => console.log(`🚀  Server running on :${PORT}`));