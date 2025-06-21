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
const SHIP_SPEEDS = { fast: 60, slow: 6, fighterSlow: 12 };
const TICK_MS     = 1000;           // 1 s

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
    this._ecoTick = 0;

    this.abandonmentTimeout = null;  // Tähän tallennetaan hylkäämisajastin, jotta palvelin ei jää päälle
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
    const stars = [];

    for (let i = 0; i < starCount; i++) {
        let ownerId = null;
        let isHomeworld = false;
        
        // Ensimmäiset tähdet menee pelaajille (yksi per pelaaja)
        if (i < players.length) {
            ownerId = players[i]._id;
            isHomeworld = true;
        }
        // Kaikki muut ovat neutraleja

        const starData = {
          gameId  : this.gameId,
          ownerId : ownerId,                        // null → neutral
          name    : `Star ${i + 1}`,
          isHomeworld,
          position: { x: Math.random()*1000, y: Math.random()*1000, z: 0 },
          infrastructureLevel : 1,

          /* --- start-bonukset vain homeworldille --- */
          mines         : isHomeworld ? 1 : 0,
          shipyardLevel : isHomeworld ? 1 : 0,
          population    : isHomeworld ? 5 : 1,       // homeworld 5, muut 1
          planetaryQueue        : [],
          shipQueue             : [],
          planetaryQueueTotalTime: 0,
          shipQueueTotalTime    : 0
        };

        stars.push(new Star(starData));
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
 

    // AI-instanssien luonti - Varmistetaan, että tämä koskee vain AI-pelaajia
    this.ai.clear(); // Tyhjennetään vanhat AI:t varmuuden vuoksi
    const humanPlayerId = this._humanId(players);
    const config = { infraLimits: INFRA_LIMITS, playerId: humanPlayerId, speeds: SHIP_SPEEDS };
    
    players.forEach(p => {
      if (p.isAI) { // Luodaan controller VAIN jos p.isAI on totta
        const aiId = p._id.toString();
        const aiWallet = this.state.resources[aiId];
        
        if (aiWallet) {
          const view = { 
            resources: aiWallet, 
            stars: this.state.stars, 
            ships: this.state.ships 
          };
          this.ai.set(aiId, new AIController(aiId, view, config));
        }
      }
    });
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
            
            // Tallenna tähtien tilat
            await Promise.all(this.state.stars.map(star => star.save()));
            
            // Tallenna alusten tilat
            await Promise.all(this.state.ships.map(ship => ship.save()));
            
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
    // Turvatarkistus: Vaikka ajastuslogiikan pitäisi estää tämä,
    // varmistetaan, ettei jo pausetettu looppi suorita mitään.
    if (this._paused) return;

    // Tarkista onko pelaajia joka 10. tick
    if (this._turn % 10 === 0) {
      await this._checkForPlayers();
      if (!this._running) return; // Jos peli pysäytettiin, lopeta
    }

    // --- KAIKKI VANHA _tick-LOGIIKKASI ON TÄSSÄ ENNALLAAN ---
    this._turn = (this._turn ?? 0) + 1;

    await this._advanceEconomy();

    const diff = [];
    await this._advanceConstruction(diff);
    await this._advanceConquest(diff);
    
    const aiActions = [];
    this.ai.forEach((ai, aiId) => {
        const wallet = this.state.resources[aiId];
        if (!wallet || !ai.prevRes) return; // Jos lompakkoa ei ole, skipataan

        const income = {
            credits: wallet.credits - ai.prevRes.credits,
            minerals: wallet.minerals - ai.prevRes.minerals
        };

        console.log(`[AI-INCOME] turn=${this._turn}  ${aiId.slice(-4)}  +${income.credits}/${income.minerals}`);
        aiActions.push(...ai.runTurn(this._turn, income));
    });

    if (aiActions.length > 0) {
        await this._applyActions(aiActions);
        diff.push(...aiActions);
    }

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

    await this._flush(diff);
    // --- VANHA _tick-LOGIIKKA PÄÄTTYY TÄHÄN ---


    // --- UUSI, KORJATTU AJASTUSLOGIIKKA ---
    // Kun kaikki tämän kierroksen työt on tehty, ajastetaan SEURAAVA kierros.
    // Tämä tapahtuu vain, jos peli on merkitty käynnissä olevaksi EIKÄ se ole paussilla.
    if (this._running && !this._paused) {
      this.timeoutId = setTimeout(() => this._loop(), this.getTickInterval());
    }
  }

 async _advanceConstruction(diff) {
  /* PLANETARY ------------------------------------------------ */
  this.state.stars.forEach(star => {
    if (!star.planetaryQueue?.length) return;

    // Vähennä ensimmäisen jonossa olevan aikaa
    const job = star.planetaryQueue[0];
    job.timeLeft -= 1;

    // Debug – näet tikit terminaalissa
    console.log(`[TICK ${this._turn}] ${star.name.padEnd(10)} | `
      + `build=${job.type} | left=${job.timeLeft}`);

    // Valmis?
    if (job.timeLeft <= 0) {
      // 1. Pysyvä vaikutus planeettaan
      if (job.type === 'Mine')             star.mines          += 1;
      else if (job.type === 'Defense Upgrade') star.defenseLevel  += 1;
      else if (job.type.startsWith('Shipyard')) star.shipyardLevel += 1;
      else if (job.type.startsWith('Infrastructure')) {
        const lvl = parseInt(job.type.match(/\d+/)[0], 10);
        star.infrastructureLevel = lvl;
      }

      // 2. Poista jonosta ja tallenna
      star.planetaryQueue.shift();
      star.markModified('planetaryQueue');
      // Nollaa total time jos queue tyhjeni
      if (star.planetaryQueue.length === 0) {
        star.planetaryQueueTotalTime = 0;
      }

      // LISÄÄ TÄMÄ - Nollaa total time jos queue tyhjeni
      if (star.planetaryQueue.length === 0) {
        star.planetaryQueueTotalTime = 0;
      }

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
              planetaryQueue: star.planetaryQueue,
              shipQueue: star.shipQueue,
              planetaryQueueTotalTime: star.planetaryQueueTotalTime, // LISÄÄ TÄMÄ
              shipQueueTotalTime: star.shipQueueTotalTime // JA TÄMÄ
          }
      });
    }
  });

  /* SHIPS ---------------------------------------------------- */
  this.state.stars.forEach(star => {
      if (!star.shipQueue?.length) return;

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

        console.log(`Created new ship: ID=${newShip._id}, type=${job.type}, owner=${star.ownerId}, hp=${stats.hp}/${stats.maxHp}`);

        this.state.ships.push(newShip);

        star.shipQueue.shift();
        star.markModified('shipQueue');
        // Nollaa total time jos queue tyhjeni
        if (star.shipQueue.length === 0) {
          star.shipQueueTotalTime = 0;
        }

        // LISÄÄ TÄMÄ - Nollaa total time jos queue tyhjeni
        if (star.shipQueue.length === 0) {
          star.shipQueueTotalTime = 0;
        }

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
  });
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
    const resourceUpdates = [];

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
        console.log('--- DEBUG: Checking wallet state before payment ---');
        console.log('Entire resource state:', JSON.stringify(this.state.resources, null, 2));
        console.log('Checking for player ID:', act.playerId);
        console.log('Wallet found:', this.state.resources[act.playerId]);
        console.log('----------------------------------------------------');
        const playerWallet = this.state.resources[act.playerId];
        // Varmistetaan serverillä, että pelaajalla on varmasti varaa
        if (playerWallet && playerWallet.credits >= act.cost.credits && playerWallet.minerals >= act.cost.minerals) {
          playerWallet.credits -= act.cost.credits;
          playerWallet.minerals -= act.cost.minerals;
          console.log(`[SERVER-PAYMENT] Player ${act.playerId.slice(-4)} paid ${act.cost.credits}C for ${act.build.type}`);
        } else {
          // Jos ei ollutkaan varaa, perutaan toimenpide
          console.warn(`[SERVER-PAYMENT-CANCEL] Player ${act.playerId.slice(-4)} could not afford ${act.build.type}.`);
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
        await st.save();
      }
      continue;
    }

    /* ------------ SHIPS ---------- */
    if (act.action === "QUEUE_SHIP") {
      // Käytetään TÄSMÄLLEEN SAMAA LOGIIKKAA kuin planeetoille
      if (act.cost && act.playerId) {
        console.log('--- DEBUG: Checking wallet state before payment ---');
        console.log('Entire resource state:', JSON.stringify(this.state.resources, null, 2));
        console.log('Checking for player ID:', act.playerId);
        console.log('Wallet found:', this.state.resources[act.playerId]);
        console.log('----------------------------------------------------');
        const playerWallet = this.state.resources[act.playerId];
        if (playerWallet && playerWallet.credits >= act.cost.credits && playerWallet.minerals >= act.cost.minerals) {
          playerWallet.credits -= act.cost.credits;
          playerWallet.minerals -= act.cost.minerals;
          console.log(`[SERVER-PAYMENT] Player ${act.playerId.slice(-4)} paid ${act.cost.credits}C for ${act.build.type}`);
        } else {
          console.warn(`[SERVER-PAYMENT-CANCEL] Player ${act.playerId.slice(-4)} could not afford ${act.build.type}.`);
          continue; // Hypätään yli, jos ei varaa
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
        await st.save();
      }
      continue;
    }

    /* --------- MOVEMENT ---------- */
    if (act.action === "MOVE_SHIP") {
        console.log(`Processing MOVE_SHIP: ${act.shipId} -> ${act.toStarId}`);
        
        const sh = this._ship(act.shipId);
        const fromStar = this._star(act.fromStarId || sh.parentStarId);
        const toStar = this._star(act.toStarId);
        
        if (!sh || !toStar) continue;
        
        // Tarkista onko starlane
        let speed = SHIP_SPEEDS.slow;
        if (fromStar && fromStar.connections.some(c => c.toString() === act.toStarId)) {
            speed = SHIP_SPEEDS.fast;
        } else if (sh.type === 'Fighter') {
            speed = SHIP_SPEEDS.fighterSlow;
        }
        
        sh.state = "moving";
        sh.targetStarId = act.toStarId;
        sh.parentStarId = act.fromStarId || sh.parentStarId;
        sh.speed = speed; // Tallenna nopeus
        
        await sh.save();
        
        // Lähetä diff takaisin clientille nopeuden kanssa
        const diff = {
            action: 'SHIP_MOVING',
            shipId: act.shipId,
            fromStarId: sh.parentStarId,
            toStarId: act.toStarId,
            state: 'moving',
            speed: speed // Lisää nopeus
        };
        
        this.io.to(this.gameId.toString()).emit("game_diff", [diff]);
        continue;
    }
    /* --------- SHIP ARRIVAL ---------- */
    if (act.action === "SHIP_ARRIVED") {
        console.log(`Processing SHIP_ARRIVED: ${act.shipId} at ${act.atStarId}`);
        
        const sh = this._ship(act.shipId);
        if (!sh) continue;
        
        sh.state = "orbiting";
        sh.parentStarId = act.atStarId;
        sh.targetStarId = null;
        await sh.save();
        
        // Tarkista voiko aloittaa valloituksen
        const star = this._star(act.atStarId);
        if (star && star.ownerId?.toString() !== sh.ownerId?.toString()) {
            // Etsi KAIKKI omat alukset tähdellä
            const myShipsAtStar = this.state.ships.filter(s => 
                s.parentStarId?.toString() === act.atStarId &&
                s.ownerId?.toString() === sh.ownerId?.toString() &&
                (s.state === 'orbiting' || s.state === 'conquering')
            );
            
            // Etsi viholliset
            const enemyShips = this.state.ships.filter(s => 
                s.parentStarId?.toString() === act.atStarId &&
                s.ownerId?.toString() !== sh.ownerId?.toString() &&
                (s.state === 'orbiting' || s.state === 'conquering')
            );
            
            if (enemyShips.length === 0 && !star.isBeingConqueredBy) {
                // Aloita valloitus - KAIKKI omat alukset
                console.log(`Starting conquest of ${star.name} with ${myShipsAtStar.length} ships`);
                
                // Aseta KAIKKI omat alukset conquering-tilaan
                for (const myShip of myShipsAtStar) {
                    myShip.state = 'conquering';
                    await myShip.save();
                }
                
                star.isBeingConqueredBy = sh.ownerId;
                star.conquestProgress = 0;
                await star.save();
                
                const diffAction = {
                    action: 'CONQUEST_STARTED',
                    starId: star._id,
                    conquerorId: sh.ownerId,
                    shipCount: myShipsAtStar.length
                };
                
                this.io.to(this.gameId.toString()).emit("game_diff", [diffAction]);
            } else if (enemyShips.length === 0 && star.isBeingConqueredBy?.toString() === sh.ownerId?.toString()) {
                // Liity jo käynnissä olevaan valloitukseen
                console.log(`Ship joining ongoing conquest of ${star.name}`);
                sh.state = 'conquering';
                await sh.save();
            }
        }
        
        continue;
    }
  }
}

async _advanceConquest(diff) {
    this.state.stars.forEach(star => {
        // Skip jos ei valloitusta käynnissä
        if (!star.isBeingConqueredBy) return;
        
        const conquerorId = star.isBeingConqueredBy.toString();
        const defenderId = star.ownerId?.toString();
        
        // Laske valloittavat alukset
        const conqueringShips = this.state.ships.filter(s => 
            s.parentStarId?.toString() === star._id.toString() &&
            s.ownerId?.toString() === conquerorId &&
            s.state === 'conquering'
        );
        
        // Tarkista onko puolustajia
        const defendingShips = this.state.ships.filter(s => 
            s.parentStarId?.toString() === star._id.toString() &&
            s.ownerId?.toString() === defenderId &&
            (s.state === 'orbiting' || s.state === 'conquering')
        );
        
        // Jos puolustajia, keskeytä valloitus
        if (defendingShips.length > 0 && conquerorId !== defenderId) {
            console.log(`Conquest of ${star.name} halted - defenders present`);
            star.isBeingConqueredBy = null;
            star.conquestProgress = 0;
            star.markModified('isBeingConqueredBy');
            star.markModified('conquestProgress');
            
            // Palauta alukset orbitoimaan
            conqueringShips.forEach(s => {
                s.state = 'orbiting';
                s.markModified('state');
            });
            
            diff.push({
                action: 'CONQUEST_HALTED',
                starId: star._id,
                reason: 'defenders_present'
            });
            return;
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
                    console.log(`${destroyed} mines destroyed during conquest`);
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
                
                console.log(`Star ${star.name} conquered by ${conquerorId}`);
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
    });
}

  /* ---------------- FLUSH + BROADCAST ----- */
  async _flush(diff) {
    if (!this.io || !diff.length) return;
    console.log(`[SEND] diff`, diff);        // debug
    this.io.to(this.gameId.toString()).emit("game_diff", diff);
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
      /**
     * Poistaa aluksen pelistä ja lisää poistotapahtuman diff-taulukkoon.
     * @param {string} shipId - Tuhottavan aluksen ID.
     * @param {Array} diff - Viitattava diff-taulukko, johon tapahtuma lisätään.
     */
    async _destroyShip(shipId, diff) {
        const shipIndex = this.state.ships.findIndex(s => s._id.toString() === shipId.toString());
        if (shipIndex === -1) return; // Alus on jo poistettu

        const [ship] = this.state.ships.splice(shipIndex, 1);
        
        // Poista myös tietokannasta
        await Ship.findByIdAndDelete(shipId);

        // Lisää tapahtuma clientille lähetettävään diffiin
        diff.push({
            action: 'SHIP_DESTROYED',
            shipId: shipId,
            ownerId: ship.ownerId,
            position: ship.position // Sijainti räjähdysefektiä varten
        });

        console.log(`[COMBAT] Ship ${shipId} destroyed.`);
    }
}

module.exports = GameManager;
