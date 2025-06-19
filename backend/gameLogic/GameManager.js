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
  0: { maxPop: 5,  maxMines: 5,  maxDefense: 1, maxShipyard: 1 },
  1: { maxPop: 10, maxMines: 10, maxDefense: 2, maxShipyard: 2 },
  2: { maxPop: 15, maxMines: 15, maxDefense: 4, maxShipyard: 3 },
  3: { maxPop: 20, maxMines: 20, maxDefense: 6, maxShipyard: 4 },
  4: { maxPop: 25, maxMines: 25, maxDefense: 8, maxShipyard: 4 },
  5: { maxPop: 30, maxMines: 30, maxDefense:10, maxShipyard: 4 }
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
    this.interval  = null;        // setInterval-kahva
    this.gameDoc   = null;        // täyttyy init()/createWorld():ssa
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
      lobbyHost
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

    /* 3) Tähdet (satunnais­generaattori – vain demoa varten) */
    const stars = [];
    const playerCycle = [...players.map(p => p._id), null]; // viimeinen = neutral

    for (let i = 0; i < starCount; i++) {
        const ownerSlot   = playerCycle[i % playerCycle.length];  // 0..N..null
        const isHomeworld = ownerSlot && i < players.length;      // eka kierros = kotitähti

        /* Kotiplaneettoihin heti telakka + kaivos */
        const starData = {
          gameId  : this.gameId,
          ownerId : ownerSlot,                      // null → neutral
          name    : `Star ${i + 1}`,
          isHomeworld,
          position: { x: Math.random()*1000, y: Math.random()*1000, z: 0 },
          infrastructureLevel : 1,

          /* --- start-bonukset vain homeworldille --- */
          mines         : isHomeworld ? 1 : 0,
          shipyardLevel : isHomeworld ? 1 : 0,
          population    : isHomeworld ? 5 : 0      // valinnainen: 3 pop heti
        };

        stars.push(new Star(starData));
        }
    await Star.insertMany(stars);

    /* 4) Päivitä Game-doc (optio, jos haluat tallentaa listat viitteinä myöhemmin) */
    // await Game.updateOne({ _id: this.gameId }, { $set: { /* ... */ } });

    /* 5) Lataa muistiin ja starttaa */
    await this.init();
    this.start();

    return { success: true, gameId: this.gameId };
  }

  /* ======================================================================= */
  /*  ----------  EXISTING GAME → INIT  ------------------------------------ */
  /* ======================================================================= */

  /** Lataa olemassa olevan pelin muistiin */
  async init() {
    if (!this.gameId) throw new Error("init() requires gameId");

    this.gameDoc = await Game.findById(this.gameId).exec();
    if (!this.gameDoc) throw new Error(`Game ${this.gameId} not found`);

    /* Nopea populointi */
    this.state.stars = await Star.find({ gameId: this.gameId }).exec();
    this.state.ships = await Ship.find({ gameId: this.gameId }).exec();
    const players    = await Player.find({ gameId: this.gameId }).exec();

    /* Resource-pankki (tässä versiossa staattiset aloitusarvot) */
    players.forEach(p => {
      this.state.resources[p._id] = {
        credits  : p.resources?.credits  ?? 1000,
        minerals : p.resources?.minerals ?? 500
      };
    });

    /* AI-instanssit */
    const config = { infraLimits: INFRA_LIMITS, playerId: this._humanId(players), speeds: SHIP_SPEEDS };
    players.forEach(p => {
      if (p.isAI) {
        const view = { resources: this.state.resources[p._id], stars: this.state.stars, ships: this.state.ships };
        this.ai.set(p._id.toString(), new AIController(p._id.toString(), view, config));
      }
    });
  }

  /* ======================================================================= */
  /*  ----------  SIMULAATIOLOOPPI  ---------------------------------------- */
  /* ======================================================================= */

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this._tick(), TICK_MS);
  }
  stop() {
    clearInterval(this.interval);
    this.interval = null;
  }

  async _tick() {
    this._turn = (this._turn ?? 0) + 1;      // debug-laskuri

    this._advanceEconomy();

    const diff = [];
    this._advanceConstruction(diff);         // <──  ⇦  UUSI

    /* ---- 1) Lasketaan kunkin AI:n tulot tästä 1 s tikistä -------------- */
    const aiActions = [];
    this.ai.forEach((ai, aiId) => {
      const wallet = this.state.resources[aiId];
      const income = {
        credits  : wallet.credits  - ai.prevRes.credits,
        minerals : wallet.minerals - ai.prevRes.minerals
      };

      /*  -- DEBUG: näytä paljonko tuli rahaa tähän tikkiin -- */
      console.log(`[AI-INCOME] turn=${this._turn ?? 0}  ${aiId.slice(-4)}  +${income.credits}/${income.minerals}`);

      aiActions.push(...ai.runTurn(this._turn ?? 0, income));
    });

    await this._applyActions(aiActions);
    diff.push(...aiActions);                 // diffin jatkoksi

    await this._flush(diff);
  }


  /* -------------------------------------------------- */
/*  Rakennusten & laivojen valmistuminen              */
/* -------------------------------------------------- */
_advanceConstruction(diff) {
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
      star.markModified('planetaryQueue');  // varmistaa Mongoose-savennuksen

      diff.push({
        action : 'COMPLETE_PLANETARY',
        starId : star._id,
        type   : job.type
      });
    }
  });

  /* SHIPS ---------------------------------------------------- */
  this.state.stars.forEach(star => {
    if (!star.shipQueue?.length) return;

    const job = star.shipQueue[0];
    job.timeLeft -= 1;

    if (job.timeLeft <= 0) {
      // Luo varsinainen Ship-doc
      this.state.ships.push(new Ship({
        gameId      : this.gameId,
        ownerId     : star.ownerId,
        type        : job.type,
        state       : 'orbiting',
        parentStarId: star._id
      }));

      star.shipQueue.shift();
      star.markModified('shipQueue');

      diff.push({
        action : 'SHIP_SPAWNED',
        starId : star._id,
        type   : job.type
      });
    }
  });
}

  
  /* ---------------- ECONOMY ---------------- */
    _advanceEconomy () {
    /* 1) kerää 10 yhden sekunnin tickiä yhteen sykliksi  -------- */
    const TICKS_PER_CYCLE = 10;        // 10 s
    this._ecoTick = (this._ecoTick ?? 0) + 1;
    if (this._ecoTick < TICKS_PER_CYCLE) return;

    /* 2) päivitä POP – max-rajan puitteissa ---------------------- */
    this.state.stars.forEach(star => {
        const cap = INFRA_LIMITS[star.infrastructureLevel].maxPop;
        if (star.population < cap) star.population += 1;     // +1 / 10 s
    });

    /* 3) IN/OUT – tulot & ylläpito kerralla ---------------------- */
    const SHIP_UPKEEP     = { Fighter:1, Destroyer:2, Cruiser:3,
                                'Slipstream Frigate':4 };
    const PD_UPKEEP       = 2;   // /defense-lvl
    const SHIPYARD_UPKEEP = 3;   // /shipyard-lvl

    Object.entries(this.state.resources).forEach(([pid, wallet]) => {

        /* a) tulot planeetoista */
        this.state.stars
            .filter(st => st.ownerId?.toString() === pid)
            .forEach(st => {
            wallet.credits  += st.population;   // 1 cred / pop
            wallet.minerals += st.mines;        // 1 min  / mine
            });

        /* b) ylläpito: PD + telakka */
        let upkeep = 0;
        this.state.stars
            .filter(st => st.ownerId?.toString() === pid)
            .forEach(st => {
            upkeep += st.defenseLevel * PD_UPKEEP +
                        st.shipyardLevel * SHIPYARD_UPKEEP;
            });

        /* c) ylläpito: laivasto */
        this.state.ships
            .filter(sh => sh.ownerId?.toString() === pid)
            .forEach(sh => {
            upkeep += SHIP_UPKEEP[sh.type] ?? 0;
            });

        wallet.credits -= upkeep;          // maksa kulut
    });

    /* 4) nollaa syklin laskuri ------------------------------- */
    this._ecoTick = 0;
    }

  /* ---------------- ACTIONS --------------- */
async _applyActions(actions) {
  for (const act of actions) {

    /* --------- PLANETARY --------- */
    if (act.action === "QUEUE_PLANETARY") {
      const st = this._star(act.starId);

     st.planetaryQueue.push({
       id        : uuidv4(),          // skeeman pakollinen
       type      : act.build.type,
       timeLeft  : act.build.time,
       totalTime : act.build.time     // skeeman pakollinen
     });

      await st.save();
      continue;
    }

    /* ------------ SHIPS ---------- */
    if (act.action === "QUEUE_SHIP") {
      const st = this._star(act.starId);

     st.shipQueue.push({
       id        : uuidv4(),          // skeeman pakollinen
       type      : act.build.type,
       timeLeft  : act.build.time,
       totalTime : act.build.time     // skeeman pakollinen
     });

      await st.save();
      continue;
    }

    /* --------- MOVEMENT ---------- */
    if (act.action === "MOVE_SHIP") {
      const sh = this._ship(act.shipId);

      // Ship-skeeman kentät ovat jo optionaleja → ei validation-riskiä
      sh.state        = "moving";
      sh.targetStarId = act.toStarId;
      sh.parentStarId = act.fromStarId ?? sh.parentStarId;

      await sh.save();
      continue;
    }
  }
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
  getSerializableState () {
    const stars = this.state.stars.map(s => s.toObject({ depopulate: true }));
    const ships = this.state.ships.map(s => s.toObject({ depopulate: true }));
    return {
      stars,
      ships,
      resources: this.state.resources
    };
  }
}

module.exports = GameManager;
