// gameLogic/GameManager.js – authoritative game-state orchestrator for SpaceWar
// -----------------------------------------------------------------------------
//  ▸ Yksi GameManager-instanssi vastaa yhdestä Game-dokumentista (huoneesta).
//  ▸ createWorld() → luo kokonaan uuden pelin. init() → lataa olemassa olevan.
//  ▸ Sisäisesti hoitaa omat setInterval-tickit ja puskee diffit Socket.IO-huoneeseen.
// -----------------------------------------------------------------------------

const { v4: uuidv4 }    = require("uuid");
const EventEmitter       = require("events");
const mongoose           = require("mongoose");

const Star   = require("../models/Star");
const Ship   = require("../models/Ship");
const Player = require("../models/Player");
const Game   = require("../models/Game");

const AIController = require("./AIController");

/* ---------------------------- VAKIOT / TAULUT ----------------------------- */

const INFRA_LIMITS = {

  1: { maxPop: 5,  maxMines: 5,  maxDefense: 1, maxShipyard: 1 },
  2: { maxPop: 10, maxMines: 10, maxDefense: 2, maxShipyard: 2 },
  3: { maxPop: 15, maxMines: 15, maxDefense: 4, maxShipyard: 3 },
  4: { maxPop: 20, maxMines: 20, maxDefense: 6, maxShipyard: 4 },
  5: { maxPop: 25, maxMines: 25, maxDefense: 8, maxShipyard: 4 }
};
const SHIP_SPEEDS = { fast: 60, slow: 6, fighterSlow: 12, frigateSlow: 12 };
const TICK_MS     = 1000;           // 1 s

// Taisteluissa käytettävät vakiot
const COMBAT_CONSTANTS = {
  DEFENSE_HP_PER_LEVEL: 4,
  CRUISER_DMG_VS_DEFENSE: 4,
  DESTROYER_DMG_VS_DEFENSE: 0.5,
  FIGHTER_DMG_VS_DEFENSE: 0.25,
  COMBAT_CHECK_INTERVAL: 1  // Tikkien määrä taistelutarkistusten välillä
};

// Slipstream vakiot
const SLIPSTREAM_RADIUS = 37.5; // 25 * 1.5

/* ------------------------------------------------------------------------- */

class GameManager extends EventEmitter {
  /**
   *  @param {object}  opts
   *  @param {string?} opts.gameId – olemassa olevan pelin _id (voi olla null luontivaiheessa)
   *  @param {SocketIO.Server?} opts.io – Socket.IO-serveri
   */
  constructor({ gameId = null, io = null } = {}) {
    super();
    this.gameId = gameId;
    this.io     = io;

    /* In-memory snapshot (Mongo on master copy) */
    this.state = { resources: {}, stars: [], ships: [] };

    this.ai        = new Map();   // Map<playerId, AIController>

    this.gameDoc   = null;        // täyttyy init()/createWorld():ssa
    this._running = false;
    this.timeoutId = null;

    this._paused = false;         // Jos pause taikka ei
    this._speed = 1;              // oletusnopeus 1
    this._baseTickMs = 1000;
    this._turn = 0;
    this._ecoTick = 0;            // Talouden tickin alustus
    this._combatTick = 0;         // Taistelun tickin alustus

    this.abandonmentTimeout = null;  // Tähän tallennetaan hylkäämisajastin, jotta palvelin ei jää päälle

    this._pendingSaves = {
      stars: new Set(),
      ships: new Set()
    },
    
    this._diffBuffer = [];
    this._lastDiffSent = 0;
    this.DIFF_SEND_INTERVAL = 250;

    this.galacticHubs = new Set(); // Sisältää kaikkien pelaajien Hubien starId:t
  }
  

  // Onko pausella tahika ei
    isRunning() {
      return this._running && !this._paused;
  }

  // Nopeudensäädin
  setSpeed(speed) {
    if (this._speed === speed) return;
    this._speed = speed;
  }

  // nopeudensäädin -> tick
  getTickInterval() {
      return this._baseTickMs / this._speed;
  }

  /* ======================================================================= */
  /*  ----------  UUSI → PELIN LUONTI  ------------------------------------- */
  /* ======================================================================= */

  /** Luo täysin uuden pelimaailman ja käynnistää sen. Palauttaa payloadin clientille. */
  async createWorld({
    humanName      = "Player",
    humanColor     = "#007bff",
    numAiPlayers   = 1,
    aiColors       = [],
    starCount      = 120,
    playerId       = null,
    lobbyHost      = "server",
    speed          = 1
  } = {}) {
    /* 1) Game-dokumentti */
    const gameDoc = await Game.create({
    status   : "playing",                 // tai "lobby" jos haluat
    settings : {
      starCount,
      aiCount   : numAiPlayers,
      mapSeed   : Math.floor(Math.random() * 1e9),
      speed,
      lobbyHost,
      playerId 
    }
  });          // status:'ongoing', createdAt auto
    this.gameId   = gameDoc._id;
    this.gameDoc  = gameDoc;

    /* 2) Pelaajat */
    const players = [];

    // Human
    players.push(new Player({
      gameId : this.gameId,
      name   : humanName,
      color  : humanColor,
      isAI   : false
    }));

    // AIt
    for (let i = 0; i < numAiPlayers; i++) {
      players.push(new Player({
        gameId : this.gameId,
        name   : `AI #${i + 1}`,
        color  : aiColors[i] || "#dc3545",
        isAI   : true
      }));
    }
    await Player.insertMany(players);

    /* 3) Tähdet (ensimmäiset pelaajille, loput neutraleiksi) */
    /* 3) Tähdet - KORJATTU VERSIO */
    const stars = [];
    
    // Lasketaan kartan koko samalla kaavalla kuin monoliitissa
    const spread = 220 + Math.pow(starCount, 0.85) * 8;
    
    // Apufunktio pyöreän kartan luomiseen
    const getRandomPosition = (spread) => {
        const t = Math.random() * 2 * Math.PI;
        const r = Math.sqrt(Math.random()) * spread;
        const x = Math.cos(t) * r;
        const z = Math.sin(t) * r;
        
        // Y-akseli (pystysuunta 3D:ssä, mutta tässä käytetään z:ta korkeudeksi)
        const THICKNESS = 0.55;
        const maxY = spread * THICKNESS * (r / spread);
        const y = (Math.random() * 2 - 1) * maxY;
        
        return { x, y, z };
    };
    
    // Homeworldien minimivälit
    const MIN_HOMEWORLD_DISTANCE_FACTOR = 0.4;
    const minHomeworldDist = spread * MIN_HOMEWORLD_DISTANCE_FACTOR;
    const homeworldPositions = [];

    for (let i = 0; i < starCount; i++) {
        let ownerId = null;
        let isHomeworld = false;
        
        if (i < players.length) {
            ownerId = players[i]._id;
            isHomeworld = true;
        }

        let position;
        let positionOk = false;
        let attempts = 0;
        
        // Yritetään sijoittaa tähti
        while (!positionOk && attempts < 100) {
            position = getRandomPosition(spread);
            
            if (isHomeworld) {
                // Tarkista etäisyys muihin homeworldeihin
                positionOk = true;
                for (const pos of homeworldPositions) {
                    const dist = Math.sqrt(
                        Math.pow(position.x - pos.x, 2) +
                        Math.pow(position.y - pos.y, 2) +
                        Math.pow(position.z - pos.z, 2)
                    );
                    if (dist < minHomeworldDist) {
                        positionOk = false;
                        break;
                    }
                }
                if (positionOk) {
                    homeworldPositions.push({ ...position });
                }
            } else {
                // Normaalit tähdet - tarkista että ei liian lähellä mitään tähteä
                positionOk = true;
                const minStarDist = 25; // Minimietäisyys tähtien välillä
                for (const existingStar of stars) {
                    const dist = Math.sqrt(
                        Math.pow(position.x - existingStar.position.x, 2) +
                        Math.pow(position.y - existingStar.position.y, 2) +
                        Math.pow(position.z - existingStar.position.z, 2)
                    );
                    if (dist < minStarDist) {
                        positionOk = false;
                        break;
                    }
                }
            }
            attempts++;
        }
        
        // Jos ei onnistunut, sijoita satunnaisesti
        if (!positionOk) {
            position = getRandomPosition(spread);
        }

        const starData = {
            gameId  : this.gameId,
            ownerId : ownerId,
            name    : `Star ${i + 1}`,
            isHomeworld,
            position: position, // Käytetään laskettua positiota
            infrastructureLevel : 1,
            mines         : isHomeworld ? 1 : 0,
            shipyardLevel : isHomeworld ? 1 : 0,
            population    : isHomeworld ? 5 : 1,
            planetaryQueue        : [],
            shipQueue             : [],
            planetaryQueueTotalTime: 0,
            shipQueueTotalTime    : 0,
            defenseLevel: isHomeworld ? 0 : 0,
            defenseHP: 0, 
        };

        stars.push(new Star(starData));
    }

    /* 4) Luo starlane-yhteydet - KORJATTU */
    const STAR_CONNECTION_MAX_DIST_BASE = 175;
    const STAR_CONNECTION_PROBABILITY = 0.25;
    
    // Skaalaa etäisyysraja ja todennäköisyys
    const scale = Math.sqrt(starCount / 125);
    const STAR_CONNECTION_MAX_DIST = STAR_CONNECTION_MAX_DIST_BASE * scale;
    const STAR_CONNECTION_PROB = STAR_CONNECTION_PROBABILITY / scale;

    for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
            const star1 = stars[i];
            const star2 = stars[j];
            
            const dist = Math.sqrt(
                Math.pow(star1.position.x - star2.position.x, 2) +
                Math.pow(star1.position.y - star2.position.y, 2) +
                Math.pow(star1.position.z - star2.position.z, 2)
            );
            
            // Tarkista myös että molemmilla on tilaa uusille yhteyksille
            const maxConnections = 4;
            if (dist < STAR_CONNECTION_MAX_DIST && 
                Math.random() < STAR_CONNECTION_PROB &&
                (!star1.connections || star1.connections.length < maxConnections) &&
                (!star2.connections || star2.connections.length < maxConnections)) {
                
                if (!star1.connections) star1.connections = [];
                if (!star2.connections) star2.connections = [];
                
                star1.connections.push(star2._id);
                star2.connections.push(star1._id);
            }
        }
    }

    await Star.insertMany(stars);

    /* 4) Päivitä Game-doc (optio, jos haluat tallentaa listat viitteinä myöhemmin) */
    // await Game.updateOne({ _id: this.gameId }, { $set: { /* ... */ } });

    /* 5) Lataa muistiin ja starttaa */
    await this.init();
    //Palautetaan koko alkutila, ei vain gameId:tä
    const initialState = await this.getSerializableState();

    return { success: true, initialState };
  }

  /* ======================================================================= */
  /*  ----------  EXISTING GAME → INIT  ------------------------------------ */
  /* ======================================================================= */

  /** Lataa olemassa olevan pelin muistiin */
  async init() {
    if (!this.gameId) throw new Error("init() requires gameId");

    this.gameDoc = await Game.findById(this.gameId).exec();
    if (!this.gameDoc) throw new Error(`Game ${this.gameId} not found`);

    // Ladataan uuden pelin tiedot tietokannasta
    this.state.stars = await Star.find({ gameId: this.gameId }).exec();
    this.state.ships = await Ship.find({ gameId: this.gameId }).exec();
    const players = await Player.find({ gameId: this.gameId }).exec();

    // --- UUSI, YKSINKERTAINEN JA LUOTETTAVA RESURSSIEN ALUSTUS ---
    // Tyhjennetään ensin vanhat resurssit varmuuden vuoksi.
    this.state.resources = {};

    // Käydään uuden pelin pelaajat läpi ja annetaan KAIKILLE aloitusraha.
    players.forEach(p => {
      this.state.resources[p._id] = {
        credits: 1000,
        minerals: 500
      };
    });
    console.log('--- Correctly initialized resources for new game ---', JSON.stringify(this.state.resources, null, 2));
 
    // Galactic Hubin alustus
    this.galacticHubs.clear(); // Varmuuden vuoksi tyhjennys
    this.state.stars.forEach(star => {
        if (star.hasGalacticHub) {
            this.galacticHubs.add(star._id.toString());
        }
    });

    // AI-instanssien luonti - Varmistetaan, että tämä koskee vain AI-pelaajia
    this.ai.clear();
    const humanPlayerId = this._humanId(players);
    const config = { infraLimits: INFRA_LIMITS, playerId: humanPlayerId, speeds: SHIP_SPEEDS };
    
    for (const p of players) {
      if (p.isAI) {
        const aiId = p._id.toString();
        const aiWallet = this.state.resources[aiId];
        
        if (aiWallet) {
          const view = { 
            resources: aiWallet, 
            stars: this.state.stars, 
            ships: this.state.ships 
          };
          const aiController = new AIController(aiId, view, config);
          // Alusta prevRes heti!
          aiController.prevRes = { ...aiWallet };
          this.ai.set(aiId, aiController);
        }
      }
    }
  }


  
  /* ======================================================================= */
  /*  ----------  SIMULAATIOLOOPPI  ---------------------------------------- */
  /* ======================================================================= */

    start() {
      if (this._running) return;
      this._paused = false;
      this._running = true; // LISÄYS: Merkitään looppi aktiiviseksi.
      console.log(`🎮 Game ${this.gameId} starting at ${this._speed}x speed.`);
      this._loop();
    }

    stop() {
      this._running = false; // KRIITTINEN LISÄYS! Estää kesken olevaa looppia ajastamasta uutta.
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      this._paused = false;
      console.log(`🛑 Game ${this.gameId} stopped.`);
    }
    
    async pause() {
      console.log(`⏸️ Pausing game ${this.gameId}.`);
      this._paused = true; // Tämä signaali estää KESKEN OLEVAA looppia ajastamasta uutta kierrosta
      
      // Tämä pysäyttää SEURAAVAKSI ajastetun kierroksen
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      await this._saveGameState();
    }
    
    resume() {
      if (!this._paused || !this._running) return;
      this._paused = false;
      console.log(`▶️ Game ${this.gameId} resumed.`);
      this._loop(); // Käynnistetään looppi uudelleen.
    }
    
    isPaused() {
        return this._paused;
    }

    // Tallenna pelin tila tietokantaan
    async _saveGameState() {
        if (!this.gameDoc) return;
        
        try {
            // Päivitä game dokumentti
            this.gameDoc.lastSavedAt = new Date();
            this.gameDoc.tick = this._turn || 0;
            await this.gameDoc.save();
            
         
            console.log(`💾 Game state saved for ${this.gameId}`);
        } catch (err) {
            console.error(`Failed to save game state:`, err);
        }
    }

  /**
   * Tarkistaa onko huoneessa pelaajia. Jos ei, pysäyttää pelin.
   */
  async _checkForPlayers() {
    if (!this.io || !this.gameId) return;
    
    // Hae kaikki socketit pelihuoneesta
    const sockets = await this.io.in(this.gameId.toString()).fetchSockets();
    
    if (sockets.length === 0) {
      console.log(`⚠️  No players in game ${this.gameId}. Stopping game.`);
      this.stop();
      
      // Ilmoita server.js:lle että peli pitää poistaa
      this.emit('abandoned', this.gameId.toString());
    }
  }

async _loop() {
    if (this._paused) return;
    
    this._turn = (this._turn ?? 0) + 1;

    // 1. Economy
    await this._advanceEconomy();

    // 2. Kerää muutokset
    const diff = [];
    await this._advanceConstruction(diff);
    
    // 4. AI
    const aiActions = [];
    this.ai.forEach((ai, aiId) => {
        const wallet = this.state.resources[aiId];
        if (!wallet) return;
        
        ai.stars = this.state.stars;
        ai.ships = this.state.ships;
        
        if (ai.prevRes) {
            const income = {
                credits: wallet.credits - ai.prevRes.credits,
                minerals: wallet.minerals - ai.prevRes.minerals
            };
            aiActions.push(...ai.runTurn(this._turn, income));
        }
        
        ai.prevRes = { ...wallet };
    });

    if (aiActions.length > 0) {
        await this._applyActions(aiActions);
        diff.push(...aiActions);
    }

    await this._advanceMovement(diff);
    
    await this._resolveCombat(diff);
    
    await this._advanceConquest(diff);

    // 5. Construction progress diffit
    this.state.stars.forEach(star => {
        if (star.planetaryQueue?.length > 0 || star.shipQueue?.length > 0) {
            diff.push({
                action: 'CONSTRUCTION_PROGRESS',
                starId: star._id,
                planetaryQueue: star.planetaryQueue,
                shipQueue: star.shipQueue
            });
        }
    });

    diff.unshift({
        action: 'TICK_INFO',
        tick: this._turn,
        speed: this._speed,
        timestamp: Date.now()
    });

    // 6. LÄHETÄ DIFFIT HETI!
    await this._flush(diff);
    
    // 7. Tallenna taustalla (EI await!)
    this._saveInBackground().catch(err => {
        console.error('[SAVE-ERROR] Background save failed:', err);
    });
    
    // 8. Ajasta seuraava tick
    if (this._running && !this._paused) {
        this.timeoutId = setTimeout(() => this._loop(), this.getTickInterval());
    }
}

// Uusi funktio taustallennukseen
async _saveInBackground() {
    const promises = [];
    
    // Kopioi listat ja käytä Map duplikaattien estämiseen
    const starsToSave = new Map();
    const shipsToSave = new Map();
    
    // Kerää uniikki tähdet
    this._pendingSaves.stars.forEach(star => {
        if (star && star._id) {
            starsToSave.set(star._id.toString(), star);
        }
    });
    
    // Kerää uniikki alukset
    this._pendingSaves.ships.forEach(ship => {
        if (ship && ship._id) {
            shipsToSave.set(ship._id.toString(), ship);
        }
    });
    
    const deletedShips = [...(this._pendingSaves.deletedShips || [])];
    
    // Tyhjennä alkuperäiset
    this._pendingSaves.stars.clear();
    this._pendingSaves.ships.clear();
    this._pendingSaves.deletedShips = [];
    
    // Tallenna tähdet - varmista että ei tallenneta samaa kahdesti
    starsToSave.forEach((star, starId) => {
        // Tarkista että tähti on vielä olemassa pelitilassa
        if (this.state.stars.some(s => s._id.toString() === starId)) {
            promises.push(
                star.save()
                    .then(() => {
                        // console.log(`[SAVE] Star ${starId} saved`);
                    })
                    .catch(e => {
                        if (e.message.includes("Can't save() the same doc")) {
                            // Tämä on OK - ignoroi
                        } else {
                            console.error(`[BG-SAVE] Star ${starId}:`, e.message);
                        }
                    })
            );
        }
    });
    
    // Tallenna alukset - varmista että alus on vielä olemassa
    shipsToSave.forEach((ship, shipId) => {
        // Tarkista että alus on vielä olemassa pelitilassa
        if (this.state.ships.some(s => s._id.toString() === shipId)) {
            promises.push(
                ship.save()
                    .then(() => {
                        // console.log(`[SAVE] Ship ${shipId} saved`);
                    })
                    .catch(e => {
                        if (e.message.includes("No document found")) {
                            // Alus on jo poistettu - ignoroi
                        } else if (e.message.includes("Can't save() the same doc")) {
                            // Rinnakkaistallennus - ignoroi
                        } else {
                            console.error(`[BG-SAVE] Ship ${shipId}:`, e.message);
                        }
                    })
            );
        }
    });
    
    // Poista alukset - varmista että ei poisteta samaa kahdesti
    const uniqueDeletes = [...new Set(deletedShips)];
    uniqueDeletes.forEach(shipId => {
        promises.push(
            Ship.findByIdAndDelete(shipId)
                .then(result => {
                    if (result) {
                        // console.log(`[DELETE] Ship ${shipId} deleted`);
                    }
                })
                .catch(e => {
                    if (e.message.includes("No document found")) {
                        // Jo poistettu - OK
                    } else {
                        console.error(`[BG-SAVE] Delete ship ${shipId}:`, e.message);
                    }
                })
        );
    });
    
    if (promises.length > 0) {
        // console.log(`[BG-SAVE] Saving ${promises.length} documents in background`);
        await Promise.allSettled(promises); // Käytä allSettled, ei all
    }
}

async _checkConquestStart(star, ships, diff) {
    if (star.isBeingConqueredBy || ships.length === 0) return;
    
    const attackerId = ships[0].ownerId?.toString();
    const starOwnerId = star.ownerId?.toString();
    
    if (attackerId !== starOwnerId) {
        //console.log(`[CONQUEST-START] Starting conquest of ${star.name}`);
        
        star.isBeingConqueredBy = attackerId;
        star.conquestProgress = 0;
        this._pendingSaves.stars.add(star);
        
        // Aseta alukset conquering-tilaan
        for (const ship of ships) {
            ship.state = 'conquering';
            this._pendingSaves.ships.add(ship);
        }
        
        // Lähetä diff heti
        diff.push({
            action: 'CONQUEST_STARTED',
            starId: star._id,
            conquerorId: attackerId,
            shipCount: ships.length
        });
    }
}

    /**
     * Luo starlane-yhteydet uuden Hubin ja kaikkien aiempien Hubien välille.
     * @param {Star} newHubStar - Tähti, johon uusi Hub juuri valmistui.
     */
    async _updateHubNetwork(newHubStar) {
        const newConnections = [];
        const newHubStarIdStr = newHubStar._id.toString();

        // Käydään läpi GLOBAALI lista kaikista Hubeista
        for (const existingHubIdStr of this.galacticHubs) {
            if (existingHubIdStr === newHubStarIdStr) continue;

            const existingHub = this._star(existingHubIdStr);
            if (!existingHub) continue;

            // Luo kaksisuuntainen yhteys
            newHubStar.connections.push(existingHub._id);
            existingHub.connections.push(newHubStar._id);

            newConnections.push({ from: newHubStarIdStr, to: existingHubIdStr });
            this._pendingSaves.stars.add(existingHub);
        }

        this._pendingSaves.stars.add(newHubStar);

        // Lähetä clientille VAIN uudet yhteydet
        if (newConnections.length > 0) {
            const diff = [{
                action: 'HUB_NETWORK_UPDATED',
                connections: newConnections
            }];
            this.io.to(this.gameId.toString()).emit("game_diff", diff);
        }
    }

 async _advanceConstruction(diff) {
  /* PLANETARY ------------------------------------------------ */
  // Pidä kirjaa muutetuista tähdistä
  const modifiedStars = new Set();
  for (const star of this.state.stars) {
      if (!star.planetaryQueue?.length) continue;

    // Vähennä ensimmäisen jonossa olevan aikaa
    const job = star.planetaryQueue[0];
    job.timeLeft -= 1;

    // Debug – näet tikit terminaalissa
    //console.log(`[TICK ${this._turn}] ${star.name.padEnd(10)} | `
    //  + `build=${job.type} | left=${job.timeLeft}`);

    // Valmis?
    if (job.timeLeft <= 0) {
      // 1. Pysyvä vaikutus planeettaan
      if (job.type === 'Mine')             star.mines          += 1;
      else if (job.type.startsWith('Shipyard')) star.shipyardLevel += 1;
      else if (job.type.startsWith('Infrastructure')) {
        const lvl = parseInt(job.type.match(/\d+/)[0], 10);
        star.infrastructureLevel = lvl;
      }
      else if (job.type === 'Defense Upgrade') {
        star.defenseLevel += 1;
        // Lisää tämä rivi:
        star.defenseHP = star.defenseLevel * COMBAT_CONSTANTS.DEFENSE_HP_PER_LEVEL;
        star.markModified('defenseHP');
      }
      else if (job.type === 'Galactic Hub') {
        star.hasGalacticHub = true;

        // Lisää uusi Hub globaaliin listaan
        this.galacticHubs.add(star._id.toString());

        // Kutsu verkonpäivitysfunktiota (nyt ilman playerId:tä)
        await this._updateHubNetwork(star);
        }

      // 2. Poista jonosta ja tallenna
      star.planetaryQueue.shift();
      star.markModified('planetaryQueue');

      // Nollaa total time jos queue tyhjeni
      if (star.planetaryQueue.length === 0) {
        star.planetaryQueueTotalTime = 0;
      }

      modifiedStars.add(star);

      diff.push({
          action : 'COMPLETE_PLANETARY',
          starId : star._id,
          type   : job.type,
          // Lisää päivitetty star data
          starData: {
              _id: star._id,
              mines: star.mines,
              defenseLevel: star.defenseLevel,
              shipyardLevel: star.shipyardLevel,
              infrastructureLevel: star.infrastructureLevel,
              hasGalacticHub: star.hasGalacticHub,
              planetaryQueue: star.planetaryQueue,
              shipQueue: star.shipQueue,
              planetaryQueueTotalTime: star.planetaryQueueTotalTime, // LISÄÄ TÄMÄ
              shipQueueTotalTime: star.shipQueueTotalTime // JA TÄMÄ
          }
      });
    }
  }

  /* SHIPS ---------------------------------------------------- */
  for (const star of this.state.stars) {
    if (!star.shipQueue?.length) continue;

      const job = star.shipQueue[0];
      job.timeLeft -= 1;

      if (job.timeLeft <= 0) {
        // Määritä HP typen mukaan
        const shipStats = {
            'Fighter': { hp: 1, maxHp: 1 },
            'Destroyer': { hp: 2, maxHp: 2 },
            'Cruiser': { hp: 3, maxHp: 3 },
            'Slipstream Frigate': { hp: 1, maxHp: 1 }
        };

        const stats = shipStats[job.type] || { hp: 1, maxHp: 1 };

        // Luo varsinainen Ship-doc
        const newShip = new Ship({
            gameId      : this.gameId,
            ownerId     : star.ownerId,
            type        : job.type,
            state       : 'orbiting',
            parentStarId: star._id,
            hp          : stats.hp,
            maxHp       : stats.maxHp
        });

        //console.log(`Created new ship: ID=${newShip._id}, type=${job.type}, owner=${star.ownerId}, hp=${stats.hp}/${stats.maxHp}`);

        this.state.ships.push(newShip);

        star.shipQueue.shift();
        star.markModified('shipQueue');
        // Nollaa total time jos queue tyhjeni
        if (star.shipQueue.length === 0) {
          star.shipQueueTotalTime = 0;
        }

        await newShip.save(); 
        modifiedStars.add(star);

        diff.push({
            action : 'SHIP_SPAWNED',
            starId : star._id,
            type   : job.type,
            ownerId: star.ownerId,
            shipId : newShip._id.toString(),
            // Lisää queue tiedot total queuen nollaamiseksi
            starData: {
              shipQueue: star.shipQueue,
              shipQueueTotalTime: star.shipQueueTotalTime
                }
        });
      }
    }
      // TALLENNA KAIKKI MUUTETUT TÄHDET VAIN KERRAN
      for (const star of modifiedStars) {
        this._pendingSaves.stars.add(star);
      }
      return modifiedStars;
  }

  
  /* ---------------- ECONOMY ---------------- */

 async _advanceEconomy() {
    /* 1) Kerää 10 yhden sekunnin tickiä yhteen sykliksi */
    const TICKS_PER_CYCLE = 10;
    this._ecoTick = (this._ecoTick ?? 0) + 1;

    if (this._ecoTick < TICKS_PER_CYCLE) return;

    /* ===== KAIKKI TALOUSLOGIIKKA TAPAHTUU TÄMÄN PORTIN SISÄLLÄ ===== */

    const updatesToSend = []; // Kerätään kaikki päivitykset tähän
    
    /* 2) Päivitä POP ja kerää muuttuneet tähdet */
    this.state.stars.forEach(star => {
        if (star.ownerId) {
            const cap = INFRA_LIMITS[star.infrastructureLevel].maxPop;
            if (star.population < cap) {
                star.population += 1;
                
                // LISÄÄ TÄMÄ: Kerätään tieto muuttuneesta tähdestä
                updatesToSend.push({
                    action: 'STAR_UPDATED',
                    starId: star._id,
                    updatedFields: {
                        population: star.population
                    }
                });
            }
        }
    });
    
    /* 3) Laske tulot & ylläpito */
    const SHIP_UPKEEP = { Fighter: 1, Destroyer: 2, Cruiser: 3, 'Slipstream Frigate': 4 };
    const PD_UPKEEP = 2;
    const SHIPYARD_UPKEEP = 3;
    const UPKEEP_GALACTIC_HUB = 15;


    Object.entries(this.state.resources).forEach(([pid, wallet]) => {
        const oldCredits = wallet.credits;
        const oldMinerals = wallet.minerals;

        // Selkeämpi tapa: kerätään kaikki luvut ensin omiin muuttujiinsa.
        let upkeep = 0;
        let currentIncome = { credits: 0, minerals: 0 };

        // Tehokkaampi: Käydään tähdet läpi vain KERRAN per pelaaja
        // ja lasketaan samalla kertaa sekä tulot että rakennusten ylläpito.
        this.state.stars
            .filter(st => st.ownerId?.toString() === pid)
            .forEach(st => {
                currentIncome.credits += st.population;
                currentIncome.minerals += st.mines;
                upkeep += (st.defenseLevel * PD_UPKEEP) + (st.shipyardLevel * SHIPYARD_UPKEEP);
                        // Jos Galactic Hubeja : 
                if (st.hasGalacticHub) {
                    upkeep += UPKEEP_GALACTIC_HUB;
                }
            });
        
        // Kerätään alusten ylläpito erikseen (koska ne ovat eri taulukossa).
        this.state.ships
            .filter(sh => sh.ownerId?.toString() === pid)
            .forEach(sh => {
                upkeep += SHIP_UPKEEP[sh.type] ?? 0;
            });

        // Yksi selkeä päivitys lompakkoon, kun kaikki laskelmat on tehty.
        wallet.credits += currentIncome.credits - upkeep;
        wallet.minerals += currentIncome.minerals;

        // Tallenna päivitys diffiin, jos muuttui
        if (wallet.credits !== oldCredits || wallet.minerals !== oldMinerals) {
            // Lisätään resurssipäivitys samaan lähetykseen
            updatesToSend.push({
                action: 'RESOURCE_UPDATE',
                playerId: pid,
                resources: { credits: wallet.credits, minerals: wallet.minerals }
            });
        }
    });

    /* 4) Nollaa syklin laskuri */
    this._ecoTick = 0;

    // Lähetä päivitykset clienteille
    if (updatesToSend.length > 0 && this.io) {
        this.io.to(this.gameId.toString()).emit("game_diff", updatesToSend);
    }
}

  /* ---------------- ACTIONS --------------- */
async _applyActions(actions) {
  for (const act of actions) {
    /* --------- PLANETARY --------- */
    if (act.action === "QUEUE_PLANETARY") {
      // Tarkistetaan, onko komennolla hintaa ja lähettäjää (eli onko se ihmispelaajan komento)
      if (act.cost && act.playerId) {
        //console.log('--- DEBUG: Checking wallet state before payment ---');
        //console.log('Entire resource state:', JSON.stringify(this.state.resources, null, 2));
        //console.log('Checking for player ID:', act.playerId);
        //console.log('Wallet found:', this.state.resources[act.playerId]);
        //console.log('----------------------------------------------------');
        const playerWallet = this.state.resources[act.playerId];
        // Varmistetaan serverillä, että pelaajalla on varmasti varaa
        if (playerWallet && playerWallet.credits >= act.cost.credits && playerWallet.minerals >= act.cost.minerals) {
          playerWallet.credits -= act.cost.credits;
          playerWallet.minerals -= act.cost.minerals;
          //console.log(`[SERVER-PAYMENT] Player ${act.playerId.slice(-4)} paid ${act.cost.credits}C for ${act.build.type}`);
        } else {
          // Jos ei ollutkaan varaa, perutaan toimenpide
          //console.warn(`[SERVER-PAYMENT-CANCEL] Player ${act.playerId.slice(-4)} could not afford ${act.build.type}.`);
          continue; // Hypätään tämän actionin yli
        }
      }

      const st = this._star(act.starId);
      if (st) {
        st.planetaryQueue = st.planetaryQueue || [];
        st.shipQueue      = st.shipQueue      || [];

        st.planetaryQueue.push({
          id:        uuidv4(),
          type:      act.build.type,
          timeLeft:  act.build.time,
          totalTime: act.build.time
        });
        this._pendingSaves.stars.add(st);
      }
      continue;
    }

    /* ------------ SHIPS ---------- */
    if (act.action === "QUEUE_SHIP") {
      // Käytetään TÄSMÄLLEEN SAMAA LOGIIKKAA kuin planeetoille
      if (act.cost && act.playerId) {
        //console.log('--- DEBUG: Checking wallet state before payment ---');
        //console.log('Entire resource state:', JSON.stringify(this.state.resources, null, 2));
        //console.log('Checking for player ID:', act.playerId);
        //console.log('Wallet found:', this.state.resources[act.playerId]);
        //console.log('----------------------------------------------------');
        const playerWallet = this.state.resources[act.playerId];
        if (playerWallet && playerWallet.credits >= act.cost.credits && playerWallet.minerals >= act.cost.minerals) {
          playerWallet.credits -= act.cost.credits;
          playerWallet.minerals -= act.cost.minerals;
          //console.log(`[SERVER-PAYMENT] Player ${act.playerId.slice(-4)} paid ${act.cost.credits}C for ${act.build.type}`);
        //} else {
          //console.warn(`[SERVER-PAYMENT-CANCEL] Player ${act.playerId.slice(-4)} could not afford ${act.build.type}.`);
          //continue; // Hypätään yli, jos ei varaa
        }
      }

      const st = this._star(act.starId);
      if (st) {
        st.shipQueue      = st.shipQueue      || [];
        st.planetaryQueue = st.planetaryQueue || [];

        st.shipQueue.push({
          id:        uuidv4(),
          type:      act.build.type,
          timeLeft:  act.build.time,
          totalTime: act.build.time
        });
        this._pendingSaves.stars.add(st);
      }
      continue;
    }

    /* --------- MOVEMENT ---------- */
    if (act.action === "MOVE_SHIP") {
        //console.log(`Processing MOVE_SHIP: ${act.shipId} -> ${act.toStarId}`);
        
        const sh = this._ship(act.shipId);
        if (!sh) {
            console.warn(`Ship ${act.shipId} not found`);
            continue;
        }
        
        const toStar = this._star(act.toStarId);
        if (!toStar) {
            console.warn(`Target star ${act.toStarId} not found`);
            continue;
        }
        
        // Tarkista mistä lähtee - voi olla parentStarId TAI nykyinen sijainti jos orbiting
        let fromStarId = act.fromStarId || sh.parentStarId;
        
        // Jos alus on jo liikkeessä, käytä targetStaria lähtöpisteenä
        if (sh.state === 'moving' && sh.targetStarId) {
            fromStarId = sh.targetStarId;
        }
        
        // Jos ei vieläkään lähtötähteä, etsi missä alus on
        if (!fromStarId) {
            // Etsi tähti jonka kiertoradalla alus on
            const orbitingStar = this.state.stars.find(star => 
                star.orbitingShips?.some(s => s._id.toString() === sh._id.toString())
            );
            if (orbitingStar) {
                fromStarId = orbitingStar._id;
            }
        }
        
        const fromStar = fromStarId ? this._star(fromStarId) : null;
        
        // Älä liiku jos samaan tähteen
        if (fromStar && fromStar._id.equals(toStar._id)) {
            console.warn(`Ship ${sh._id} ordered to same star – ignoring`);
            continue;
        }
        
        // Laske nopeus
        let speed = SHIP_SPEEDS.slow; // Oletusnopeus
        if (fromStar && fromStar.connections.some(c => c.toString() === act.toStarId)) {
            speed = SHIP_SPEEDS.fast; // Starlane on aina nopein
        } else if (sh.type === 'Slipstream Frigate') {
            speed = SHIP_SPEEDS.frigateSlow; // Frigatti saa oman erikoisnopeutensa
        } else if (sh.type === 'Fighter') {
            speed = SHIP_SPEEDS.fighterSlow; // Hävittäjä on myös nopeampi
        }
        
        // Päivitä aluksen tila
        sh.state = "moving";
        sh.targetStarId = act.toStarId;
        sh.parentStarId = null;
        sh.speed = speed;
        sh.departureStarId = fromStarId;
        sh.movementTicks = 0;
        
        // Laske matka-aika
        if (fromStar) {
            const dist = Math.hypot(
                fromStar.position.x - toStar.position.x,
                fromStar.position.y - toStar.position.y,
                fromStar.position.z - toStar.position.z
            );
            sh.ticksToArrive = Math.max(1, Math.ceil(dist / speed));
        } else {
            sh.ticksToArrive = 10; // Default jos ei lähtötähteä
        }
        
        sh.markModified('state');
        sh.markModified('targetStarId');
        sh.markModified('parentStarId');
        sh.markModified('speed');
        sh.markModified('departureStarId');
        sh.markModified('movementTicks');
        sh.markModified('ticksToArrive');

        this._pendingSaves.ships.add(sh);
        
        // Lähetä diff
        const diff = {
            action: 'SHIP_MOVING',
            shipId: act.shipId,
            fromStarId: fromStarId,
            toStarId: act.toStarId,
            state: 'moving',
            speed: speed
        };
        
        this.io.to(this.gameId.toString()).emit("game_diff", [diff]);
        continue;
    }

    /* --------- SHIP ARRIVAL ---------- */
    if (act.action === "SHIP_ARRIVED") {
        // Tämä on visuaalinen notifikaatio - tarkista vain että data on synkassa
        const sh = this._ship(act.shipId);
        if (sh && sh.state !== 'orbiting') {
            console.warn(`[SYNC-ERROR] Ship ${act.shipId} not in orbiting state after arrival!`);
        }
        
        //console.log(`[VISUAL-ONLY] SHIP_ARRIVED notification for ship ${act.shipId}`);
        continue;
    }
  }
}

// Lisää _interpolatePosition apufunktio aluksen sijainnin laskemiseksi slipstream -frigatille
_interpolatePosition(from, to, t) {
    const progress = Math.max(0, Math.min(1, t)); // Varmista että t on välillä 0-1
    return {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
        z: from.z + (to.z - from.z) * progress
    };
}

// Korvaa koko _advanceMovement funktio tällä
async _advanceMovement(diff) {
    // =========================================================================
    // VAIHE 1: POSITIOIDEN LASKEMINEN (kuten ennenkin)
    // =========================================================================
    const shipPositions = new Map(); // shipId -> {x, y, z}
    
    this.state.ships.forEach(ship => {
        let currentPos;
        if (ship.state === 'moving' && ship.departureStarId && ship.targetStarId) {
            const fromStar = this._star(ship.departureStarId);
            const toStar = this._star(ship.targetStarId);
            if (fromStar && toStar) {
                const progress = (ship.movementTicks || 0) / (ship.ticksToArrive || 1);
                currentPos = this._interpolatePosition(fromStar.position, toStar.position, progress);
            }
        } else if (ship.parentStarId) {
            const parentStar = this._star(ship.parentStarId);
            if (parentStar) {
                currentPos = parentStar.position;
            }
        }
        if (currentPos) {
            shipPositions.set(ship._id.toString(), currentPos);
        }
    });

    // =========================================================================
    // VAIHE 2: BONUSTICKIEN MÄÄRITTÄMINEN (UUSI, LUOTETTAVAMPI LOGIIKKA)
    // =========================================================================
    const shipsToGetBonus = new Set(); // Kerätään bonuksen saavat alukset tähän
    const slipstreamFrigates = this.state.ships.filter(s => s.type === 'Slipstream Frigate');
    const movingShips = this.state.ships.filter(s => s.state === 'moving');

    for (const ship of movingShips) {
        // Vain ei-starlane-alukset voivat saada bonuksen
        if (ship.speed === SHIP_SPEEDS.fast) continue;
        
        // Alus ei voi nopeuttaa itseään
        if (ship.type === 'Slipstream Frigate') continue;

        const friendlyFrigates = slipstreamFrigates.filter(f => f.ownerId?.toString() === ship.ownerId?.toString());
        const shipPos = shipPositions.get(ship._id.toString());

        if (shipPos && friendlyFrigates.length > 0) {
            for (const frigate of friendlyFrigates) {
                const frigatePos = shipPositions.get(frigate._id.toString());
                if (frigatePos) {
                    const distance = Math.hypot(
                        frigatePos.x - shipPos.x,
                        frigatePos.y - shipPos.y,
                        frigatePos.z - shipPos.z
                    );

                    if (distance <= SLIPSTREAM_RADIUS) {
                        shipsToGetBonus.add(ship._id.toString());
                        
                        // Lähetä diff clientille efektin näyttämistä varten
                        diff.push({
                            action: 'SHIP_IN_SLIPSTREAM',
                            shipId: ship._id.toString(),
                            frigateId: frigate._id.toString(),
                            movementTicks: (ship.movementTicks || 0) + 2, // Ennakoidaan molemmat tikit
                            ticksToArrive: ship.ticksToArrive,
                            progress: ((ship.movementTicks || 0) + 2) / (ship.ticksToArrive || 1),
                            position: shipPos 
                        });
                        
                        break; // Yksi aura riittää
                    }
                }
            }
        }
    }

    // =========================================================================
    // VAIHE 3: LIIKKEEN SUORITTAMINEN JA SAAPUMISET
    // =========================================================================
    const arrivalsThisTick = new Map();

    for (const ship of movingShips) {
        // Annetaan normaali perusliike
        ship.movementTicks = (ship.movementTicks || 0) + 1;

        // Annetaan bonusliike, jos alus ansaitsi sen vaiheessa 2
        if (shipsToGetBonus.has(ship._id.toString())) {
            ship.movementTicks += 1;
        }

        // Tarkista saapuminen
        const ticksToArrive = ship.ticksToArrive ?? 1;
        if (ship.movementTicks >= ticksToArrive) {
            const targetStar = this._star(ship.targetStarId);
            if (targetStar) {
                const starId = targetStar._id.toString();
                if (!arrivalsThisTick.has(starId)) {
                    arrivalsThisTick.set(starId, []);
                }
                arrivalsThisTick.get(starId).push({ ship, targetStar });
            }
        }
    }
    
    // =========================================================================
    // VAIHE 4: KÄSITTELE SAAPUMISET (kuten ennenkin)
    // =========================================================================
    for (const [starId, arrivals] of arrivalsThisTick) {
        const targetStar = arrivals[0].targetStar;
        const arrivalDiffs = [];
        
        for (const arrival of arrivals) {
            const ship = arrival.ship;
            
            if (targetStar.isBeingConqueredBy?.toString() === ship.ownerId?.toString()) {
                ship.state = 'conquering';
            } else {
                ship.state = 'orbiting';
            }
            
            ship.parentStarId = ship.targetStarId;
            ship.targetStarId = null;
            ship.movementTicks = 0;
            ship.departureStarId = null;
            ship.ticksToArrive = null;
            
            this._pendingSaves.ships.add(ship);
            
            arrivalDiffs.push({
                action: 'SHIP_ARRIVED',
                shipId: ship._id.toString(),
                atStarId: targetStar._id.toString(),
                shipType: ship.type,
                ownerId: ship.ownerId
            });
        }
        
        diff.push(...arrivalDiffs);
        
        const combatDiff = [];
        const shipsAtTarget = this.state.ships.filter(s =>
            s.parentStarId?.toString() === targetStar._id.toString() &&
            (s.state === 'orbiting' || s.state === 'conquering')
        );
        
        await this._resolveCombatAtStar(targetStar, combatDiff, shipsAtTarget);
        
        diff.push(...combatDiff);
    }
}

async _advanceConquest(diff) {
    for (const star of this.state.stars) {
      // Skip jos ei valloitusta käynnissä
      if (!star.isBeingConqueredBy) continue;
        
        const conquerorId = star.isBeingConqueredBy.toString();
        const defenderId = star.ownerId?.toString();
        
        // Laske valloittavat alukset
        const conqueringShips = this.state.ships.filter(s => 
            s.parentStarId?.toString() === star._id.toString() &&
            s.ownerId?.toString() === conquerorId &&
            s.state === 'conquering'
        );

        if (conqueringShips.length === 0) {
          star.isBeingConqueredBy = null;
          star.conquestProgress   = 0;
          star.markModified('isBeingConqueredBy');
          star.markModified('conquestProgress');

          diff.push({
            action : 'CONQUEST_HALTED',
            starId : star._id,
            reason : 'no_conquerors'
          });
          continue;          // siirry käsittelemään seuraavaa tähteä
        }
        
        // Tarkista onko puolustajia
        const defendingShips = this.state.ships.filter(s => 
            s.parentStarId?.toString() === star._id.toString() &&
            s.ownerId?.toString() !== conquerorId &&
            (s.state === 'orbiting' || s.state === 'conquering')
        );
        
        // Jos puolustajia, keskeytä valloitus
        if (defendingShips.length > 0) {  
            //console.log(`Conquest of ${star.name} halted - defenders present`);
            star.isBeingConqueredBy = null;
            star.conquestProgress = 0;
            star.markModified('isBeingConqueredBy');
            star.markModified('conquestProgress');
            
            // Palauta alukset orbitoimaan
            for (const s of conqueringShips) {
            s.state = 'orbiting';
            s.markModified('state');
            this._pendingSaves.ships.add(s);
            }
            
            diff.push({
                action: 'CONQUEST_HALTED',
                starId: star._id,
                reason: 'hostiles_present'
            });
        continue;
        }
        
        // Laske valloitusnopeus
        if (conqueringShips.length > 0) {
            // Shipyard hidastaa valloitusta (monoliitista)
            const yardLevel = Math.min(star.shipyardLevel || 0, 5);
            const slowdownRatio = 1 / Math.pow(2, yardLevel);
            
            // Cruiserit valloittavat 3x nopeammin
            const conquestRate = conqueringShips.reduce((sum, s) => 
                sum + (s.type === 'Cruiser' ? 3 : 1), 0
            ) * slowdownRatio * this._speed;;
            
            star.conquestProgress += conquestRate; // <-- TÄMÄ ON OIKEIN
            star.markModified('conquestProgress');
            
            // Valloitus valmis?
            if (star.conquestProgress >= 100) {
                const oldOwner = star.ownerId;
                const oldMines = star.mines;
                
                // Vaihda omistaja
                star.ownerId = star.isBeingConqueredBy;
                star.population = 1;
                star.shipyardLevel = star.shipyardLevel; // Säilyy
                
                // Kaivostuho (50% satunnaisesti)
                if (oldMines > 0) {
                    const maxDestroy = Math.ceil(oldMines * 0.5);
                    const destroyed = oldMines === 1 ? 1 : 
                        Math.max(1, Math.floor(Math.random() * maxDestroy) + 1);
                    star.mines = Math.max(0, oldMines - destroyed);
                    //console.log(`${destroyed} mines destroyed during conquest`);
                }
                
                // Nollaa jonotkin
                star.planetaryQueue = [];
                star.shipQueue = [];
                star.planetaryQueueTotalTime = 0;
                star.shipQueueTotalTime = 0;
                
                // Nollaa valloitus
                star.conquestProgress = 0;
                star.isBeingConqueredBy = null;
                
                // Merkitse muutokset
                star.markModified('ownerId');
                star.markModified('population');
                star.markModified('mines');
                star.markModified('planetaryQueue');
                star.markModified('shipQueue');
                
                // Palauta alukset orbitoimaan
                conqueringShips.forEach(s => {
                    s.state = 'orbiting';
                    s.markModified('state');
                });
                
                diff.push({
                    action: 'CONQUEST_COMPLETE',
                    starId: star._id,
                    newOwnerId: star.ownerId,
                    oldOwnerId: oldOwner,
                    starData: {
                        _id: star._id,
                        ownerId: star.ownerId,
                        population: star.population,
                        mines: star.mines,
                        conquestProgress: 0,
                        isBeingConqueredBy: null
                    }
                });
                
                //console.log(`Star ${star.name} conquered by ${conquerorId}`);
            } else {
                // Valloitus jatkuu
                diff.push({
                    action: 'CONQUEST_PROGRESS',
                    starId: star._id,
                    progress: star.conquestProgress,
                    conquerorId: conquerorId
                });
            }
        } else {
            // Ei valloittajia enää, keskeytä
            star.isBeingConqueredBy = null;
            star.conquestProgress = 0;
            star.markModified('isBeingConqueredBy');
            star.markModified('conquestProgress');
            
            diff.push({
                action: 'CONQUEST_HALTED',
                starId: star._id,
                reason: 'no_conquerors'
            });
        }
        this._pendingSaves.stars.add(star);
    };
  }

  /* ========================================================================== */
  /*  COMBAT SYSTEM                                                             */
  /* ========================================================================== */
async _resolveCombat(diff) {
    // Rakenna kartta yhdellä läpikäynnillä O(N)
    const shipsByStarId = new Map();
    
    for (const ship of this.state.ships) {
        if (!['orbiting', 'conquering'].includes(ship.state)) continue;
        
        const starId = ship.parentStarId?.toString();
        if (!starId) continue;
        
        if (!shipsByStarId.has(starId)) {
            shipsByStarId.set(starId, []);
        }
        shipsByStarId.get(starId).push(ship);
    }
    
    // Käy läpi vain tähdet joissa on aluksia
    for (const [starId, shipsAtStar] of shipsByStarId) {
        const star = this._star(starId);
        if (!star) continue;
        
        // Tarkista tarvitaanko taistelua
        const factions = new Set(shipsAtStar.map(s => s.ownerId?.toString()));
        
        const needsCombat = factions.size > 1 || 
            (factions.size === 1 && star.defenseHP > 0 && 
             Array.from(factions)[0] !== star.ownerId?.toString());
        
        if (needsCombat || factions.size === 1) {
            // Kutsu kolmella parametrilla!
            await this._resolveCombatAtStar(star, diff, shipsAtStar);
        }
    }
}

async _resolveCombatAtStar(star, diff, shipsAtStar = null) {
    if (!shipsAtStar) {
        shipsAtStar = this.state.ships.filter(s =>
            s.parentStarId?.toString() === star._id.toString() &&
            (s.state === 'orbiting' || s.state === 'conquering')
        );
    }

    const factionShips = {};
    shipsAtStar.forEach(ship => {
        const faction = ship.ownerId?.toString();
        if (!faction) return;
        if (!factionShips[faction]) factionShips[faction] = [];
        factionShips[faction].push(ship);
    });

    const factions = Object.keys(factionShips);
    const needsCombat = factions.length > 1 || (factions.length === 1 && star.defenseHP > 0 && factions[0] !== star.ownerId?.toString());

    if (!needsCombat) {
        // Jos taistelua ei tarvita, tarkista silti valloituksen aloitus
        await this._checkConquestStart(star, shipsAtStar, diff);
        return;
    }
    
    // Jos taistelu alkaa, keskeytä valloitus
    if (star.isBeingConqueredBy) {
        star.isBeingConqueredBy = null;
        star.conquestProgress = 0;
        this._pendingSaves.stars.add(star);
        diff.push({ action: 'CONQUEST_HALTED', starId: star._id, reason: 'combat' });
    }

    // ==========================================================
    // VAIHE 1: VAHINGON LASKEMINEN (DAMAGE CALCULATION PHASE)
    // ==========================================================
    const damageMap = new Map(); // shipId -> totalDamage
    let pdDamage = 0; // Vahinko, jonka PD ottaa

    // Apufunktio vahingon lisäämiseksi puskuriin
    const addDamage = (targetShip, amount) => {
        const currentDamage = damageMap.get(targetShip._id.toString()) || 0;
        damageMap.set(targetShip._id.toString(), currentDamage + amount);
    };

    // 1.1. PD:n hyökkäys
    if (star.defenseHP > 0 && star.ownerId) {
        const shots = star.defenseLevel * 3;
        const enemyShips = shipsAtStar.filter(s => s.ownerId?.toString() !== star.ownerId?.toString());
        for (let i = 0; i < shots && enemyShips.length > 0; i++) {
            const target = this._pickTarget(enemyShips); // pickTarget valitsee heikoimman
            if (target) {
                const damage = target.type === 'Cruiser' ? 0.5 : 2; // Käytetään tasapainotettua arvoa
                addDamage(target, damage);
            }
        }
    }

    // 1.2. Alusten hyökkäykset
    for (const attackerFaction of factions) {
        const attackers = factionShips[attackerFaction];
        const potentialTargets = shipsAtStar.filter(s => s.ownerId?.toString() !== attackerFaction);

        for (const attacker of attackers) {
            // A) Hyökkääkö alus PD:tä vai toista alusta?
            if (star.defenseHP > 0 && star.ownerId?.toString() !== attackerFaction) {
                // Alus ampuu PD:tä
                switch (attacker.type) {
                    case 'Cruiser':   pdDamage += COMBAT_CONSTANTS.CRUISER_DMG_VS_DEFENSE; break;
                    case 'Destroyer': pdDamage += COMBAT_CONSTANTS.DESTROYER_DMG_VS_DEFENSE; break;
                    case 'Fighter':   pdDamage += COMBAT_CONSTANTS.FIGHTER_DMG_VS_DEFENSE; break;
                }
            } else if (potentialTargets.length > 0) {
                // B) Alus ampuu toista alusta
                let target = null;
                switch (attacker.type) {
                    case 'Cruiser':
                        target = this._pickTarget(potentialTargets, s => s.type === 'Destroyer') || this._pickTarget(potentialTargets);
                        if (target) addDamage(target, target.type === 'Fighter' ? 1 : 3);
                        break;
                    case 'Destroyer':
                        // Destroyer ampuu kahdesti
                        for (let i = 0; i < 2; i++) {
                            target = this._pickTarget(potentialTargets, s => s.type === 'Fighter') || this._pickTarget(potentialTargets);
                            if (target) addDamage(target, 1);
                        }
                        break;
                    case 'Fighter':
                        target = this._pickTarget(potentialTargets);
                        if (target) addDamage(target, target.type === 'Cruiser' ? 1.35 : 1);
                        break;
                }
            }
        }
    }

    // ==========================================================
    // VAIHE 2: VAHINGON JAKAMINEN (DAMAGE RESOLUTION PHASE)
    // ==========================================================

    // 2.1. Jaa vahinko aluksille
    const destroyedShipIds = new Set();
    for (const [shipId, totalDamage] of damageMap.entries()) {
        const ship = this._ship(shipId);
        if (ship) {
            ship.hp -= totalDamage;
            if (ship.hp <= 0) {
                destroyedShipIds.add(shipId);
            } else {
                this._pendingSaves.ships.add(ship);
            }
        }
    }

    // 2.2. Jaa vahinko PD:lle
    if (pdDamage > 0) {
        star.defenseHP = Math.max(0, star.defenseHP - pdDamage);
        const newLevel = Math.ceil(star.defenseHP / COMBAT_CONSTANTS.DEFENSE_HP_PER_LEVEL);
        if (newLevel < star.defenseLevel) {
            star.defenseLevel = newLevel;
            diff.push({ action: 'DEFENSE_DAMAGED', starId: star._id, newLevel: newLevel });
        }
        this._pendingSaves.stars.add(star);
    }

    // 2.3. Poista tuhoutuneet alukset pelistä
    for (const shipId of destroyedShipIds) {
        await this._destroyShip(shipId, diff);
    }
    
    // Lopuksi, tarkista jos taistelun jälkeen voi aloittaa valloituksen
    const remainingShips = this.state.ships.filter(s => s.parentStarId?.toString() === star._id.toString());
    await this._checkConquestStart(star, remainingShips, diff);
}

/**
 * Tarkistaa, voidaanko tähdellä aloittaa valloitus, ja tekee niin tarvittaessa.
 * Tämä kutsutaan, kun tähdellä ei ole aktiivista taistelua.
 */
async _checkConquestStart(star, shipsAtStar, diff) {
    // Älä tee mitään, jos valloitus on jo käynnissä tai ei ole aluksia
    if (star.isBeingConqueredBy || shipsAtStar.length === 0) {
        return;
    }

    // Varmista, että kaikki paikalla olevat alukset kuuluvat samalle omistajalle
    const firstShipOwnerId = shipsAtStar[0].ownerId?.toString();
    const allSameOwner = shipsAtStar.every(s => s.ownerId?.toString() === firstShipOwnerId);

    if (!allSameOwner) {
        // Jos on useita eri omistajien aluksia, älä aloita valloitusta
        // (tämä tilanne pitäisi johtaa taisteluun, mutta tämä on turvakeino)
        return;
    }

    const attackerId = firstShipOwnerId;
    const starOwnerId = star.ownerId?.toString();

    // Aloita valloitus, jos hyökkääjä ei omista tähteä
    if (attackerId !== starOwnerId) {
        console.log(`[CONQUEST-START] Starting conquest of ${star.name} by ${attackerId}`);
        
        star.isBeingConqueredBy = attackerId;
        star.conquestProgress = 0;
        this._pendingSaves.stars.add(star);
        
        // Aseta KAIKKI paikalla olevat alukset 'conquering'-tilaan
        for (const ship of shipsAtStar) {
            if(ship.ownerId?.toString() === attackerId) {
                ship.state = 'conquering';
                this._pendingSaves.ships.add(ship);
            }
        }
        
        // Lisää CONQUEST_STARTED-tapahtuma diff-puskuriin
        diff.push({
            action: 'CONQUEST_STARTED',
            starId: star._id,
            conquerorId: attackerId,
            shipCount: shipsAtStar.filter(s => s.ownerId?.toString() === attackerId).length
        });
    }
}

  // Apufunktiot Combatiin
  _pickTarget(ships, predicate = () => true) {
    const valid = ships.filter(s => this.state.ships.some(liveShip => liveShip._id.equals(s._id)) && predicate(s));
    return valid.sort((a, b) => a.hp - b.hp)[0] || null;
  }

  async _applyDamage(ship, damage, diff) {
      ship.hp -= damage;
      if (ship.hp <= 0) {
        await this._destroyShip(ship._id, diff);
        return true;
      }
      this._pendingSaves.ships.add(ship);  // LISÄÄ TÄMÄ
      return false;
  }

  _tryDamagePD(star, attacker, diff) {
    if (star.defenseHP <= 0 || attacker.ownerId?.toString() === star.ownerId?.toString()) {
      return false;
    }
    let damage = 0;
    switch (attacker.type) {
      case 'Cruiser':   damage = COMBAT_CONSTANTS.CRUISER_DMG_VS_DEFENSE; break;
      case 'Destroyer': damage = COMBAT_CONSTANTS.DESTROYER_DMG_VS_DEFENSE; break;
      case 'Fighter':   damage = COMBAT_CONSTANTS.FIGHTER_DMG_VS_DEFENSE; break;
    }
    if (damage > 0) {
        star.defenseHP = Math.max(0, star.defenseHP - damage);
        const newLevel = Math.ceil(star.defenseHP / COMBAT_CONSTANTS.DEFENSE_HP_PER_LEVEL);
        if (newLevel < star.defenseLevel) {
            star.defenseLevel = newLevel;
            this._pendingSaves.stars.add(star);  // LISÄÄ TÄMÄ
            
            // Lähetä defense damage heti
            const damageDiff = [{ action: 'DEFENSE_DAMAGED', starId: star._id, newLevel: newLevel }];
            if (this.io) {
                this.io.to(this.gameId.toString()).emit("game_diff", damageDiff);
            }
            diff.push(...damageDiff);
        }
        return true;
    }
    return false;
}

  async _combatPhase(factionShips, shipType, star, diff) {
      const factions = Object.keys(factionShips);
      for (const attackerFaction of factions) {
        const attackers = factionShips[attackerFaction].filter(s => 
          s.type === shipType && this.state.ships.some(ls => ls._id.equals(s._id))
        );
        
        for (const attacker of attackers) {
          // AINA yritä vahingoittaa PD:tä ENSIN, jos se kuuluu viholliselle
          if (star.defenseHP > 0 && star.ownerId?.toString() !== attacker.ownerId?.toString()) {
            this._tryDamagePD(star, attacker, diff);
            // ÄLÄ SKIPPAA - anna aluksen ampua myös vihollisaluksia!
          }
          
          // Sitten ammu vihollisaluksia normaalisti
          const potentialTargets = [];
          for (const defenderFaction of factions) {
            if (attackerFaction === defenderFaction) continue;
            potentialTargets.push(...factionShips[defenderFaction]);
          }
          
          if (potentialTargets.length === 0) continue;

          // Normaali alus vs alus taistelu...
          if (shipType === 'Cruiser') {
              const target = this._pickTarget(potentialTargets, s => s.type === 'Destroyer') || 
                            this._pickTarget(potentialTargets);
              if(target) await this._applyDamage(target, target.type === 'Fighter' ? 1 : 3, diff);
          } else if (shipType === 'Destroyer') {
              for(let i = 0; i < 2; i++) {
                  const target = this._pickTarget(potentialTargets, s => s.type === 'Fighter') || 
                                this._pickTarget(potentialTargets);
                  if(target) await this._applyDamage(target, 1, diff);
              }
          } else if (shipType === 'Fighter') {
              const target = this._pickTarget(potentialTargets);
              if(target) {
                const damage = target.type === 'Cruiser' ? 1.35 : 1;
                await this._applyDamage(target, damage, diff);
              }
          }
        }
      }
  }

  async _resolveMelee(factionShips, diff) {
      const factions = Object.keys(factionShips);
      for (let i = 0; i < factions.length; i++) {
          for (let j = i + 1; j < factions.length; j++) {
              const faction1 = factions[i];
              const faction2 = factions[j];
              const ships1 = factionShips[faction1].filter(s => this.state.ships.some(ls => ls._id.equals(s._id)));
              const ships2 = factionShips[faction2].filter(s => this.state.ships.some(ls => ls._id.equals(s._id)));
              if (ships1.length > 0 && ships2.length > 0) {
                  await this._applyDamage(ships1[0], 1, diff);
                  await this._applyDamage(ships2[0], 1, diff);
              }
          }
      }
  }
  
async _resolvePDOnlyBattle(star, attackers, diff) {
    // LISÄÄ: PD ampuu ensin takaisin!
    if (star.defenseHP > 0 && star.defenseLevel > 0) {
        const shots = star.defenseLevel * 3;
        const validTargets = [...attackers]; // Kopioi lista
        
        for (let i = 0; i < shots && validTargets.length > 0; i++) {
            const target = this._pickTarget(validTargets);
            if (target) {
                const damage = target.type === 'Cruiser' ? 1 : 2;
                if (await this._applyDamage(target, damage, diff)) {
                    // Poista tuhottu alus listasta
                    const idx = validTargets.findIndex(s => s._id.equals(target._id));
                    if (idx > -1) validTargets.splice(idx, 1);
                }
            }
        }
    }
    
    // Sen jälkeen hyökkääjät ampuvat PD:tä
    for (const ship of attackers) {
        // Tarkista että alus on vielä elossa
        if (this.state.ships.some(s => s._id.equals(ship._id))) {
            this._tryDamagePD(star, ship, diff);
        }
    }
}

  // Jos laiva tuhoutuu, poistetaan
async _destroyShip(shipId, diff) {
    const shipIndex = this.state.ships.findIndex(s => s._id.toString() === shipId.toString());
    if (shipIndex === -1) {
        console.warn(`[DESTROY] Ship ${shipId} not found in state`);
        return;
    }

    const [ship] = this.state.ships.splice(shipIndex, 1);
    
    // Varmista että poistolista on alustettu
    if (!this._pendingSaves.deletedShips) {
        this._pendingSaves.deletedShips = [];
    }
    
    // Lisää vain kerran
    const shipIdStr = shipId.toString();
    if (!this._pendingSaves.deletedShips.includes(shipIdStr)) {
        this._pendingSaves.deletedShips.push(shipIdStr);
    }

    // Lähetä diff HETI clientille
    const destroyDiff = [{
        action: 'SHIP_DESTROYED',
        shipId: shipIdStr, // Käytä string muotoa
        ownerId: ship.ownerId,
        type: ship.type,
        position: ship.position
    }];
    
    if (this.io) {
        this.io.to(this.gameId.toString()).emit("game_diff", destroyDiff);
    }
    
    diff.push(...destroyDiff);
}

  /* ---------------- FLUSH + BROADCAST ----- */
    async _flush(diff) {
        if (!this.io || !diff.length) return;
        
        // Puskuroi diffit
        this._diffBuffer.push(...diff);
        
        // Lähetä vain jos tarpeeksi aikaa kulunut
        const now = Date.now();
        if (now - this._lastDiffSent >= this.DIFF_SEND_INTERVAL) {
            if (this._diffBuffer.length > 0) {
                //console.log(`[SEND-BATCH] ${this._diffBuffer.length} diffs`);
                this.io.to(this.gameId.toString()).emit("game_diff", this._diffBuffer);
                this._diffBuffer = [];
                this._lastDiffSent = now;
            }
        }
    }

  

  /* ---------------- HELPERS --------------- */
  _humanId(players) { return (players || []).find(p => !p.isAI)?._id?.toString() ?? ""; }
  _star(id) { return this.state.stars.find(s => s._id.toString() === id.toString()); }
  _ship(id) { return this.state.ships.find(s => s._id.toString() === id.toString()); }

  /** Palauttaa serialisoitavan snapshotin koko pelitilasta. */
  async getSerializableState() {
    const stars = this.state.stars.map(s => s.toObject({ depopulate: true }));
    const ships = this.state.ships.map(s => s.toObject({ depopulate: true }));
    
    // Hae pelaajatiedot, jotta client voi määrittää värit
    const players = await Player.find({ gameId: this.gameId }).exec();
    const playersData = players.map(p => ({
      _id: p._id.toString(),
      name: p.name,
      color: p.color,
      isAI: p.isAI
    }));
    
    // Etsi human player ID
    const humanPlayer = players.find(p => !p.isAI);
    const humanPlayerId = humanPlayer ? humanPlayer._id.toString() : null;
    
    return {
      gameId: this.gameId ? this.gameId.toString() : null,
      stars,
      ships,
      resources: this.state.resources,
      players: playersData,
      humanPlayerId: humanPlayerId,
      currentTick: this._turn, // Debug: näe mikä tick menossa
      ecoTick: this._ecoTick   // Debug: näe economy tick
    };
  }
    
}

module.exports = GameManager;
