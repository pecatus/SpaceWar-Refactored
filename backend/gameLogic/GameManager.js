// gameLogic/GameManager.js – authoritative game-state orchestrator for SpaceWar
// -----------------------------------------------------------------------------
//  ▸ Yksi GameManager-instanssi vastaa yhdestä Game-dokumentista (huoneesta).
//  ▸ createWorld() → luo kokonaan uuden pelin. init() → lataa olemassa olevan.
//  ▸ Sisäisesti hoitaa omat setInterval-tickit ja puskee diffit Socket.IO-huoneeseen.
// -----------------------------------------------------------------------------

/* ========================================================================== */
/* RIIPPUVUUDET JA MALLIT (IMPORTS & MODELS)                                 */
/* ========================================================================== */
// Tuodaan tarvittavat Node.js-moduulit ja tietokannan Mongoose-mallit,
// jotka määrittelevät pelin tietorakenteet (Game, Player, Star, Ship).

const { v4: uuidv4 }    = require("uuid");
const EventEmitter       = require("events");
const mongoose           = require("mongoose");

const Star   = require("../models/Star");
const Ship   = require("../models/Ship");
const Player = require("../models/Player");
const Game   = require("../models/Game");

const AIController = require("./AIController");

/* ========================================================================== */
/* PELIN VAKIOT JA SÄÄNNÖT (CONSTANTS & RULES)                               */
/* ========================================================================== */

/**
 * MITÄ: Pelin keskeiset säännöt ja tasapainotusarvot kootusti.
 * MIKSI: Keskittämällä nämä "taikanumerot" yhteen paikkaan tiedoston alkuun,
 * pelin tasapainoa (esim. alusten nopeuksia, rakennusrajoja) on helppo säätää
 * ja ylläpitää ilman, että tarvitsee muokata itse pelin ydinlogiikkaa.
 */

// Määrittää, kuinka monta rakennusta (kaivokset, puolustus) ja kuinka paljon
// populaatiota kullakin infrastruktuuritasolla voi olla.
const INFRA_LIMITS = {

  1: { maxPop: 5,  maxMines: 5,  maxDefense: 1, maxShipyard: 1 },
  2: { maxPop: 10, maxMines: 10, maxDefense: 2, maxShipyard: 2 },
  3: { maxPop: 15, maxMines: 15, maxDefense: 4, maxShipyard: 3 },
  4: { maxPop: 20, maxMines: 20, maxDefense: 6, maxShipyard: 4 },
  5: { maxPop: 25, maxMines: 25, maxDefense: 8, maxShipyard: 4 }
};

// Alusten liikkumisnopeudet eri tilanteissa. Yksikkö on "etäisyys per tick".
// Fast = Starlane-vauhti, Slow = Yleinen vauhti tyhjiössä, FighterSlow ja FrigateSlow = näiden alusten vauhti tyhjiössä
const SHIP_SPEEDS = { fast: 60, slow: 6, fighterSlow: 12, frigateSlow: 12 };

// Pelin perussyke millisekunteina. 1000ms = 1 tick per sekunti (1x nopeudella).
const TICK_MS     = 1000;           // 1 s

// Kokoelma taistelumekaniikkaan liittyviä arvoja.
const COMBAT_CONSTANTS = {
  DEFENSE_HP_PER_LEVEL: 4,          // PD:n hitpointit
  CRUISER_DMG_VS_DEFENSE: 4,        // Cruiserin vahinko PD:tä vastaan
  DESTROYER_DMG_VS_DEFENSE: 0.5,    // Destroyerin vahinko PD:tä vastaan
  FIGHTER_DMG_VS_DEFENSE: 0.25,     // Fighterin vahinko PD:tä vastaan
  COMBAT_CHECK_INTERVAL: 1          // Tikkien määrä taistelutarkistusten välillä
};

// Slipstream-efektin säde pelin yksiköissä.
const SLIPSTREAM_RADIUS = 37.5; // 25 * 1.5

/**
 * LASKEE MITÄ: Kahden 3D-pisteen välinen euklidinen etäisyys.
 * KÄYTETÄÄN MIHIN: Yleinen apufunktio, jota AI käyttää jatkuvasti arvioidakseen etäisyyksiä
 * tähtien välillä, kun se päättää laajentumiskohteista tai puolustukseen lähetettävistä joukoista.
 *
 * MITEN: Funktio soveltaa Pythagoraan lausetta kolmessa ulottuvuudessa:
 * 1. Laskee ensin pisteiden välisen erotuksen kullakin akselilla (dx, dy, dz).
 * 2. Syöttää nämä erotukset `Math.hypot()`-funktiolle.
 * 3. `Math.hypot(dx, dy, dz)` laskee tehokkaasti ja tarkasti neliöjuuren
 * annettujen lukujen neliöiden summasta (√dx² + dy² + dz²), mikä on
 * juuri etäisyyden kaava 3D-avaruudessa.
 *
 * @param {{x: number, y: number, z: number}} a - Ensimmäinen piste.
 * @param {{x: number, y: number, z: number}} b - Toinen piste.
 * @returns {number} Pisteiden välinen etäisyys.
 */
function distance3D(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

/* ------------------------------------------------------------------------- */

class GameManager extends EventEmitter {
  /**
   * Luo uuden GameManager-instanssin, joka hallinnoi YHTÄ pelisessiota.
   * Käsittelee pelin elinkaaren, tilan päivitykset ja kommunikaation clientien kanssa.
   *
   * @param {object} opts - Asetusobjekti.
   * @param {string|null} [opts.gameId=null] - Olemassa olevan pelin ID tietokannassa. Jos null, oletetaan uuden pelin luontia.
   * @param {object|null} [opts.io=null] - Socket.IO-serveri-instanssi viestintää varten.
   */
  constructor({ gameId = null, io = null } = {}) {
    super();    // Kutsutaan EventEmitterin constructoria, mahdollistaa eventtien (esim. 'abandoned') käytön.
    this.gameId = gameId;
    this.io     = io;

    // Pelin tila pidetään palvelimen muistissa nopeiden operaatioiden vuoksi.
    // MongoDB on "master copy", jonne muutokset tallennetaan.
    this.state = { resources: {}, stars: [], ships: [] };

    // Säilöö AIController-instanssit pelaaja-ID:llä avainnettuna. Map<playerId, AIController>
    this.ai        = new Map();   
    // Viittaus pelin päädokumenttiin tietokannassa. Asetetaan init()/createWorld() -metodeissa.
    this.gameDoc   = null;        

    // Pelisilmukan tilan hallintamuuttujat.
    this._running = false;          // Onko pelilooppi aktiivinen?
    this.timeoutId = null;          // Viittaus setTimeout-ajastimeen, jotta se voidaan pysäyttää.
    this._paused = false;           // Onko peli pausella?

    // Pelin nopeutta ja ajoitusta säätelevät muuttujat.
    this._speed = 1;                // Nykyinen nopeuskerroin (1x, 2x, jne.). Oletusnopeus 1
    this._baseTickMs = 1000;        // Yhden tickin peruskesto millisekunteina (1x nopeudella).

    // Sisäiset laskurit pelin eri sykleille.
    this._turn = 0;                 // Koko pelin kierroslaskuri.
    this._ecoTick = 0;              // Talouslaskuri, joka laukaisee resurssien päivityksen 10 tickin välein.
    this._combatTick = 0;           // Taistelulaskuri.

    this.abandonmentTimeout = null;  // Tähän tallennetaan hylkäämisajastin, jotta palvelin ei jää päälle

    // OPTIMOINTI: Kerää muutetut tietokantadokumentit yhteen, jotta samaa dokumenttia
    // ei yritetä tallentaa montaa kertaa yhden tickin aikana.
    this._pendingSaves = {
      stars: new Set(),
      ships: new Set()
    },
    
    // OPTIMOINTI: Puskuroi clientille lähetettävät päivitykset ja lähettää ne könttänä
    // tietyn intervallin välein, mikä vähentää verkkoliikennettä.
    this._diffBuffer = [];
    this._lastDiffSent = 0;
    this.DIFF_SEND_INTERVAL = 250;      // Lähetä päivitykset max 4 kertaa sekunnissa.

    // Globaali lista kaikista Galactic Hubeista nopeaa hakua varten.
    this.galacticHubs = new Set(); 
  }
  

   /**
   * Kertoo, onko pelin logiikkasilmukka tällä hetkellä aktiivisesti käynnissä.
   * @returns {boolean} Tosi, jos peli on käynnissä eikä pausella.
   */
    isRunning() {
      return this._running && !this._paused;
  }

  /**
  * Asettaa pelin nopeuskertoimen.
  * @param {number} speed - Uusi nopeuskerroin (esim. 1, 2, 5, 10).
  */
  setSpeed(speed) {
    if (this._speed === speed) return;
    this._speed = speed;
  }

  /**
  * Laskee ja palauttaa yhden pelitikin todellisen keston millisekunteina
  * perustuen pelin nopeuskertoimeen.
  * @returns {number} Tickin kesto ms.
  */
  getTickInterval() {
      return this._baseTickMs / this._speed;
  }

  /* ======================================================================= */
  /*  ----------  PELIN LUONTI  -------------------------------------------- */
  /* ======================================================================= */

  /**
 * @summary Luo, alustaa ja tallentaa täysin uuden pelimaailman tietokantaan.
 * @description Tämä on GameManagerin päämetodi uuden pelin luomiseksi. Se suorittaa kaikki
 * tarvittavat vaiheet: luo pelisessiorungon, alustaa pelaajat, generoi proseduraalisesti
 * tähtikartan ja niiden väliset yhteydet, ja lopuksi lataa kaiken valmiiksi pelattavaksi.
 *
 * @param {object} config - Pelin asetukset clientiltä.
 * @param {string} [config.humanName="Player"] - Ihmispelaajan nimi.
 * @param {string} [config.humanColor="#007bff"] - Ihmispelaajan väri.
 * @param {number} [config.numAiPlayers=1] - Tekoälyvastustajien määrä.
 * @param {Array<string>} [config.aiColors=[]] - Tekoälyjen värit.
 * @param {number} [config.starCount=120] - Tähtien määrä kartalla.
 * @param {string|null} [config.playerId=null] - Pelaajan session ID.
 * @param {string} [config.lobbyHost="server"] - Kuka isännöi peliä.
 * @param {number} [config.speed=1] - Pelin alustusnopeus.
 * @returns {Promise<{success: boolean, initialState: object}>} Palauttaa objektin, joka sisältää koko pelin alkutilan lähetettäväksi clientille.
 */
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
    // --- VAIHE 1: Luo pelisessio (Game-dokumentti) ---
    // Luodaan tietokantaan `Game`-dokumentti, joka toimii tämän pelisession "isäntänä".
    // Kaikki muut dokumentit (pelaajat, tähdet, alukset) viittaavat tähän ID:hen.
    const gameDoc = await Game.create({
    status   : "playing",                 
    settings : {
      starCount,
      aiCount   : numAiPlayers,
      mapSeed   : Math.floor(Math.random() * 1e9),  // Satunnainen siemen toistettavia karttoja varten
      speed,
      lobbyHost,
      playerId 
    }
  });          
    this.gameId   = gameDoc._id;
    this.gameDoc  = gameDoc;

    // --- VAIHE 2: Luo pelaajat (ihminen ja tekoälyt) ---
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
    // Tallennetaan kaikki pelaajat kerralla tietokantaan tehokkuuden vuoksi.
    await Player.insertMany(players);

    // --- VAIHE 3: Generoi tähtikartta ---
    const stars = [];
    
    // Lasketaan galaksin koko tähtien määrän perusteella. Kaava varmistaa, että kartta kasvaa järkevästi.
    const spread = 220 + Math.pow(starCount, 0.85) * 8;
    
    // Tämä apufunktio arpoo pisteen litteän sylinterin sisältä, mikä luo kauniimman "galaksi"-muodon kuin pelkkä kuutio.
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
    
    // Varmistetaan, että pelaajien kotiplaneetat eivät ole liian lähellä toisiaan reilun alun takaamiseksi.
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
        
        // Yritetään löytää sopiva sijainti, joka ei ole liian lähellä muita.
        // Luovutetaan 100 yrityksen jälkeen, jottei jumiuduta ikuiseen silmukkaan.
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

        // Luodaan uusi Star-dokumentti generoiduilla arvoilla.
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

    // --- VAIHE 4: Luo tähtienväliset yhteydet (starlanet) ---
    // Käydään kaikki tähtiparit läpi ja luodaan niiden välille satunnaisesti starlane-yhteyksiä.
    // Todennäköisyyspohjainen lähestymistapa luo orgaanisemman ja vaihtelevamman verkon.
    const STAR_CONNECTION_MAX_DIST_BASE = 175;      // Ei läpi galaksin kulkevia pikateitä graafisen selkeyden vuoksi
    const STAR_CONNECTION_PROBABILITY = 0.25;       // Ei myöskään starlanea aivan jokaiselle planeetalle
    
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

    // --- VAIHE 5: Alusta peli ja palauta alkutila ---
    // Kun kaikki on luotu tietokantaan, ladataan ne GameManagerin aktiiviseen muistiin.
    await this.init();
    // Kootaan täydellinen "snapshot" juuri luodusta pelitilasta.
    const initialState = await this.getSerializableState();
    // Palautetaan tila server.js:lle, joka lähettää sen clientille.
    return { success: true, initialState };
  }

  /* ======================================================================= */
  /*  ----------  EXISTING GAME → INIT  ------------------------------------ */
  /* ======================================================================= */

/**
 * @summary Alustaa GameManagerin lataamalla olemassa olevan pelin tilan tietokannasta.
 * @description Tämä metodi on `createWorld`-metodin vastinpari. Se ottaa olemassa olevan
 * pelin ID:n, hakee kaikki peliin liittyvät dokumentit (Game, Players, Stars, Ships)
 * MongoDB:stä ja rakentaa niiden perusteella pelin muistissa olevan tilan (`this.state`).
 * Lisäksi se luo tekoälypelaajille omat AIController-instanssit.
 */
  async init() {
    // Turvatarkistus: init-metodia ei voi kutsua ilman peli-ID:tä.
    if (!this.gameId) throw new Error("init() requires gameId");

    // --- VAIHE 1: Hae pelin päädokumentti ja kaikki sen osat tietokannasta ---
    this.gameDoc = await Game.findById(this.gameId).exec();
    if (!this.gameDoc) throw new Error(`Game ${this.gameId} not found`);

    // Ladataan kaikki peliin liittyvät tähdet, alukset ja pelaajat kerralla muistiin.
    this.state.stars = await Star.find({ gameId: this.gameId }).exec();
    this.state.ships = await Ship.find({ gameId: this.gameId }).exec();
    const players = await Player.find({ gameId: this.gameId }).exec();

    // --- VAIHE 2: Alusta resurssit muistiin pelaajien perusteella ---
    // Nollataan resurssitila ja rakennetaan se uudelleen ladattujen pelaajien pohjalta.
    // Tämä varmistaa, että jokaisella pelaajalla on resurssilompakko.
    this.state.resources = {};

    // Huom: Tässä annetaan oletusresurssit. Todellisessa pelin latauksessa
    // nämä tulisi ladata pelaajan omasta dokumentista, jos ne on sinne tallennettu.
    players.forEach(p => {
      this.state.resources[p._id] = {
        credits: 1000,
        minerals: 500
      };
    });
//     console.log('--- Correctly initialized resources for new game ---', JSON.stringify(this.state.resources, null, 2));
 
    // --- VAIHE 3: Alusta apurakenteet nopeaa hakua varten ---
    // Alustetaan Galactic Hub -seuranta: Käydään tähdet läpi ja lisätään olemassa olevat Hubit listaan.
    this.galacticHubs.clear(); // Varmuuden vuoksi tyhjennys
    this.state.stars.forEach(star => {
        if (star.hasGalacticHub) {
            this.galacticHubs.add(star._id.toString());
        }
    });

    // --- VAIHE 4: Luo ja alusta AI-ohjain-instanssit ---
    // Tyhjennetään vanhat ja luodaan uudet ohjaimet jokaiselle AI-pelaajalle.
    this.ai.clear();
    const humanPlayerId = this._humanId(players);
    const config = { infraLimits: INFRA_LIMITS, playerId: humanPlayerId, speeds: SHIP_SPEEDS };
    
    for (const p of players) {
      if (p.isAI) {
        const aiId = p._id.toString();
        const aiWallet = this.state.resources[aiId];
        
        if (aiWallet) {
          // Luodaan AI:lle "näkymä" pelin tilaan, joka annetaan sille constructorissa.
          const view = { 
            resources: aiWallet, 
            stars: this.state.stars, 
            ships: this.state.ships 
          };
          const aiController = new AIController(aiId, view, config);
          // TÄRKEÄ: Alustetaan `prevRes`, jotta AI ei luule ensimmäisellä vuorollaan
          // koko aloituspääomaansa juuri saaduiksi tuloiksi.
          aiController.prevRes = { ...aiWallet };
          this.ai.set(aiId, aiController);
        }
      }
    }
  }


  
/* ======================================================================= */
/* ----------  SIMULAATIOLOOPPI (LIFECYCLE & HELPERS) -------------------- */
/* ======================================================================= */

    /**
    * @summary Käynnistää pelin pääsilmukan.
    * @description Asettaa pelin tilaan "käynnissä" ja kutsuu `_loop`-metodia ensimmäisen kerran,
    * mikä aloittaa säännöllisten pelitikkien ketjun.
    */
    start() {
      if (this._running) return;
      this._paused = false;
      this._running = true; // LISÄYS: Merkitään looppi aktiiviseksi.
//       console.log(`🎮 Game ${this.gameId} starting at ${this._speed}x speed.`);
      this._loop();
    }

    /**
    * @summary Pysäyttää pelisilmukan pysyvästi ja siivoaa ajastimen.
    * @description Käytetään, kun peli päättyy tai hylätään. Asettaa `_running`-lipun
    * epätodeksi, mikä estää `_loop`-metodia ajastamasta itseään uudelleen.
    */
    stop() {
      this._running = false; 
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);   // Tyhjennetään seuraavaksi ajastettu tick.
        this.timeoutId = null;
      }
      this._paused = false;
//       console.log(`🛑 Game ${this.gameId} stopped.`);
    }
    
    /**
    * @summary Keskeyttää pelisilmukan väliaikaisesti.
    * @description Asettaa `_paused`-lipun todeksi ja tallentaa pelin nykyisen tilan
    * tietokantaan. Silmukka voidaan käynnistää uudelleen `resume()`-metodilla.
    */
    async pause() {
//       console.log(`⏸️ Pausing game ${this.gameId}.`);
      this._paused = true; // Tämä signaali estää KESKEN OLEVAA looppia ajastamasta uutta kierrosta
      
      // Tämä pysäyttää SEURAAVAKSI ajastetun kierroksen
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      await this._saveGameState();
    }
    
    /**
    * @summary Jatkaa pausella ollutta pelisilmukkaa.
    */
    resume() {
      if (!this._paused || !this._running) return;
      this._paused = false;
//       console.log(`▶️ Game ${this.gameId} resumed.`);
      this._loop(); // Käynnistetään looppi uudelleen.
    }
    
    /**
    * Kertoo, onko peli tällä hetkellä pausella.
    * @returns {boolean}
    */
    isPaused() {
        return this._paused;
    }

    /**
    * @summary Tallentaa pelin yleistason tilan (tick, viimeisin tallennus) tietokantaan.
    * @description Tätä metodia ei käytetä raskaiden pelidokumenttien (kuten tähtien tai alusten)
    * tallentamiseen, vaan ainoastaan pää-`Game`-dokumentin metadatan päivittämiseen.
    * @private
    */
    async _saveGameState() {
        if (!this.gameDoc) return;
        
        try {
            // Päivitä game dokumentti
            this.gameDoc.lastSavedAt = new Date();
            this.gameDoc.tick = this._turn || 0;
            await this.gameDoc.save();
//             console.log(`💾 Game state saved for ${this.gameId}`);
        } catch (err) {
//             console.error(`Failed to save game state:`, err);
        }
    }

   /**
   * @summary Tarkistaa, onko pelihuoneessa enää pelaajia.
   * @description Tämä on tärkeä resurssienhallintafunktio. Jos viimeinenkin pelaaja
   * poistuu, tämä metodi kutsuu `stop()`-funktiota ja lähettää 'abandoned'-tapahtuman,
   * jotta server.js voi siivota tämän GameManager-instanssin muistista. Estää
   * "zombie-pelien" pyörimisen palvelimella.
   * @private 
   */
  async _checkForPlayers() {
    if (!this.io || !this.gameId) return;
    // Hae kaikki socketit pelihuoneesta
    const sockets = await this.io.in(this.gameId.toString()).fetchSockets();
    if (sockets.length === 0) {
//       console.log(`⚠️  No players in game ${this.gameId}. Stopping game.`);
      this.stop();
      // Ilmoita server.js:lle, että tämä peli-instanssi voidaan siivota pois.
      this.emit('abandoned', this.gameId.toString());
    }
  }

   /**
   * @summary Pelin pääsilmukka, "sydän", joka ajaa simulaatiota eteenpäin yhden tickin kerrallaan.
   * @description Tämä yksityinen metodi on GameManagerin tärkein osa. Se suorittaa kaikki yhden pelikierroksen
   * vaatimat toiminnot tietyssä järjestyksessä (talous, rakentaminen, tekoäly, liike, jne.).
   * Kierroksen lopuksi se kerää kaikki tapahtuneet muutokset `diff`-taulukkoon, lähettää ne clienteille
   * ja ajastaa itsensä uudelleen `setTimeout`-funktiolla. Tämä "rekursiivinen" setTimeout-malli
   * varmistaa, että Node.js:n event loop ei tukkeudu.
   * @private
   */
async _loop() {
    // Jos peli on pausella, älä tee mitään.
    if (this._paused) return;
    
    // Kasvata kierroslaskuria.
    this._turn = (this._turn ?? 0) + 1;

    // --- VAIHE 1: Talous ---
    // Päivitetään resurssit (tulot ja ylläpito). Tämä tapahtuu omassa syklissään (esim. joka 10. tick).
    await this._advanceEconomy();

    // Alustetaan `diff`-taulukko, johon kerätään kaikki tämän tickin aikana tapahtuneet muutokset.
    const diff = [];

    // --- VAIHE 2: Rakentaminen ---
    // Päivitetään rakennusjonojen tilaa ja käsitellään valmistuneet työt.
    await this._advanceConstruction(diff);
    
    // --- VAIHE 3: Tekoälyn päätöksenteko ---
    const aiActions = [];
    // Käydään läpi kaikki AI-pelaajat ja ajetaan niiden päätöksentekologiikka.
    this.ai.forEach((ai, aiId) => {
        const wallet = this.state.resources[aiId];
        if (!wallet) return;
        
        // Varmistetaan, että AI:lla on ajantasainen tieto pelin tilasta.
        ai.stars = this.state.stars;
        ai.ships = this.state.ships;
        
        // Välitetään AI:lle tiedot sen tuloista tällä kierroksella.
        if (ai.prevRes) {
            const income = {
                credits: wallet.credits - ai.prevRes.credits,
                minerals: wallet.minerals - ai.prevRes.minerals
            };
            aiActions.push(...ai.runTurn(this._turn, income));
        }
        
        ai.prevRes = { ...wallet };
    });

    // Suoritetaan AI:n palauttamat toiminnot (esim. rakennus- tai siirtokäskyt).
    if (aiActions.length > 0) {
        await this._applyActions(aiActions);
        diff.push(...aiActions);
    }

    // --- VAIHE 4: Pelimekaniikan päivitykset ---
    await this._advanceMovement(diff);      // Päivitetään liikkuvien alusten sijainnit.
    await this._resolveCombat(diff);        // Ratkaistaan mahdolliset taistelut.
    await this._advanceConquest(diff);      // Päivitetään planeettojen valloitusten tilanne.

    // --- VAIHE 5: Datan kerääminen lähetystä varten ---
    // Kerätään kaikilta tähdiltä rakennusjonojen tilat, jotta clientin UI pysyy ajan tasalla.
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

    // Lisätään puskurin alkuun yleinen `TICK_INFO`, joka auttaa clientia synkronoimaan nopeutta ja animaatioita.
    diff.unshift({
        action: 'TICK_INFO',
        tick: this._turn,
        speed: this._speed,
        timestamp: Date.now()
    });

    // --- VAIHE 6: Päivitysten lähetys ja tallennus ---
    // Lähetetään kaikki kerätyt `diff`-tapahtumat kerralla kaikille pelin clienteille.
    await this._flush(diff);
    
    // Käynnistetään tietokantatallennus taustalla. Tässä EI käytetä await-komentoa,
    // jotta pelisilmukka ei joudu odottamaan hidasta I/O-operaatiota.
    this._saveInBackground().catch(err => {
//         console.error('[SAVE-ERROR] Background save failed:', err);
    });
    
    // --- VAIHE 7: Seuraavan kierroksen ajastaminen ---
    // Jos peli on edelleen käynnissä (`_running` on tosi) eikä pausella,
    // ajastetaan tämä sama `_loop`-funktio suoritettavaksi uudelleen lasketun intervallin päästä.
    if (this._running && !this._paused) {
        this.timeoutId = setTimeout(() => this._loop(), this.getTickInterval());
    }
}

  /**
   * @summary Suorittaa tietokantatallennukset asynkronisesti taustalla.
   * @description Tämä on kriittinen suorituskykyoptimointi. Sen sijaan, että pelin
   * pääsilmukka (`_loop`) odottaisi hitaita tietokantaoperaatioita, tämä funktio
   * käynnistetään ilman `await`-komentoa. Se kerää kaikki yhden tickin aikana
   * muuttuneet dokumentit (`_pendingSaves`-Setistä), poistaa duplikaatit ja
   * suorittaa tallennus- ja poisto-operaatiot itsenäisesti.
   * @private
   */
async _saveInBackground() {
    const promises = [];
    
    // VAIHE 1: Kerää ja suodata tallennettavat ja poistettavat kohteet.
    // Käytetään Map-rakennetta, jotta vältetään saman dokumentin tallentaminen
    // useampaan kertaan, jos sitä on muutettu monta kertaa yhden tickin aikana.
    const starsToSave = new Map();
    const shipsToSave = new Map();
    
    // Kerää uniikit tähdet _pendingSaves-Setistä.
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
    
    // Kerää poistettavien alusten ID:t
    const deletedShips = [...(this._pendingSaves.deletedShips || [])];
    
    // Tyhjennetään heti alkuperäiset Setit, jotta seuraavan tickin
    // muutokset voivat alkaa kerääntyä turvallisesti.
    this._pendingSaves.stars.clear();
    this._pendingSaves.ships.clear();
    this._pendingSaves.deletedShips = [];
    
    // VAIHE 2: Rakenna lupaus-taulukko (Promise array) tietokantaoperaatioille.

    // Tallenna tähdet - varmista että ei tallenneta samaa kahdesti
    starsToSave.forEach((star, starId) => {
        // Varmistetaan, että tähteä ei ole poistettu pelin tilasta ennen tallennusta.
        if (this.state.stars.some(s => s._id.toString() === starId)) {
            promises.push(
                star.save()
                    .then(() => {
//                         // console.log(`[SAVE] Star ${starId} saved`);
                    })
                    // Ignoroidaan yleiset rinnakkaistallennusvirheet.
                    .catch(e => {
                        if (e.message.includes("Can't save() the same doc")) {
                        } else {
//                             console.error(`[BG-SAVE] Star ${starId}:`, e.message);
                        }
                    })
            );
        }
    });
    
    // Tallenna alukset - varmista että alus on vielä olemassa
    shipsToSave.forEach((ship, shipId) => {
        // Varmistetaan, että alusta ei ole poistettu pelin tilasta ennen tallennusta.
        if (this.state.ships.some(s => s._id.toString() === shipId)) {
            promises.push(
                ship.save()
                    .then(() => {
//                         // console.log(`[SAVE] Ship ${shipId} saved`);
                    })
                    // Ignoroidaan virheet, jos alus on jo poistettu tai tallennus menee päällekkäin.
                    .catch(e => {
                        if (e.message.includes("No document found")) {
                            // Alus on jo poistettu - ignoroi
                        } else if (e.message.includes("Can't save() the same doc")) {
                            // Rinnakkaistallennus - ignoroi
                        } else {
//                             console.error(`[BG-SAVE] Ship ${shipId}:`, e.message);
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
//                         // console.log(`[DELETE] Ship ${shipId} deleted`);
                    }
                })
                // Ignoroidaan virheet, jos alus on jo poistettu.
                .catch(e => {
                    if (e.message.includes("No document found")) {
                        // Jo poistettu - OK
                    } else {
//                         console.error(`[BG-SAVE] Delete ship ${shipId}:`, e.message);
                    }
                })
        );
    });
    
    // VAIHE 3: Suorita kaikki tietokantaoperaatiot rinnakkain.
    if (promises.length > 0) {
//         // console.log(`[BG-SAVE] Saving ${promises.length} documents in background`);
        await Promise.allSettled(promises); 
    }
}


  /**
   * @summary Tarkistaa, voiko tähdellä aloittaa valloituksen, ja tekee niin tarvittaessa.
   * @description Tätä funktiota kutsutaan taistelunratkaisun jälkeen tai kun aluksia saapuu
   * tähteen. Se varmistaa, että kaikki tähdellä olevat alukset kuuluvat samalle hyökkäävälle
   * osapuolelle ennen kuin valloitusprosessi käynnistetään.
   * @param {Star} star - Tarkasteltava tähti.
   * @param {Array<Ship>} ships - Taulukko tähdellä olevista aluksista.
   * @param {Array<object>} diff - Diff-taulukko, johon `CONQUEST_STARTED`-tapahtuma lisätään.
   * @private
   */
async _checkConquestStart(star, ships, diff) {
    // Älä tee mitään, jos valloitus on jo käynnissä tai tähdellä ei ole aluksia.
    if (star.isBeingConqueredBy || ships.length === 0) return;
    
    // Oletetaan, että kaikki tähdellä olevat alukset kuuluvat samalle hyökkääjälle,
    // koska tämä funktio kutsutaan taistelun jälkeen, jossa olisi pitänyt jäädä vain yksi osapuoli.
    const attackerId = ships[0].ownerId?.toString();
    const starOwnerId = star.ownerId?.toString();
    
    // Jos hyökkääjä ei jo omista tähteä, aloitetaan valloitus.
    if (attackerId !== starOwnerId) {
//         //console.log(`[CONQUEST-START] Starting conquest of ${star.name}`);
        star.isBeingConqueredBy = attackerId;
        star.conquestProgress = 0;
        this._pendingSaves.stars.add(star);
        
        // Asetetaan kaikki hyökkääjän alukset `conquering`-tilaan.
        for (const ship of ships) {
            ship.state = 'conquering';
            this._pendingSaves.ships.add(ship);
        }
        
        // Lähetetään clientille tieto valloituksen alkamisesta,
        // jotta se voi näyttää visuaalisen efektin.
        diff.push({
            action: 'CONQUEST_STARTED',
            starId: star._id,
            conquerorId: attackerId,
            shipCount: ships.length
        });
    }
}


  /**
   * @summary Luo starlane-yhteydet uuden Hubin ja enintään kahden lähimmän Hubin välille.
   * @description Tämä funktio suoritetaan aina, kun uusi Galactic Hub valmistuu. Se luo
   * dynaamisesti uusia starlaneja, jotka nopeuttavat liikkumista imperiumin eri osien välillä.
   * Pelin tasapainon vuoksi yhteys luodaan vain kahteen lähimpään olemassa olevaan Hubiin.
   * @param {Star} newHubStar - Tähti, johon uusi Hub juuri valmistui.
   * @private
   */
    async _updateHubNetwork(newHubStar) {
        const newHubStarIdStr = newHubStar._id.toString();

        // VAIHE 1: Etsi kaikki muut olemassa olevat Hubit.
        // Käydään läpi globaali `this.galacticHubs`-lista tehokkaan haun varmistamiseksi.
        const existingHubs = [];
        for (const hubId of this.galacticHubs) {
            if (hubId !== newHubStarIdStr) {
                const star = this._star(hubId);
                if (star) existingHubs.push(star);
            }
        }

        // Jos muita Hubeja ei ole, mitään ei tarvitse yhdistää.
        if (existingHubs.length === 0) {
            return;
        }

        // VAIHE 2: Laske etäisyydet uuteen Hubiin ja järjestä lähimmästä kaukaisimpaan.
        const hubsWithDistance = existingHubs.map(star => ({
            star: star,
            distance: distance3D(star.position, newHubStar.position)
        }));
        hubsWithDistance.sort((a, b) => a.distance - b.distance);

        // VAIHE 3: Valitse enintään kaksi (2) lähintä Hubia kohteiksi.
        const closestHubs = hubsWithDistance.slice(0, 2);

        const newConnections = [];

        // VAIHE 4: Luo kaksisuuntaiset yhteydet ja merkitse tähdet tallennettaviksi.
        for (const { star: existingHub } of closestHubs) {
            const existingHubIdStr = existingHub._id.toString();

            // Luo kaksisuuntainen yhteys
            newHubStar.connections.push(existingHub._id);
            existingHub.connections.push(newHubStar._id);

            newConnections.push({ from: newHubStarIdStr, to: existingHubIdStr });
            this._pendingSaves.stars.add(existingHub);
        }
        this._pendingSaves.stars.add(newHubStar);

        // VAIHE 5: Lähetä clientille tieto VAIN uusista yhteyksistä, jotta se voi piirtää ne.
        if (newConnections.length > 0) {
            const diff = [{
                action: 'HUB_NETWORK_UPDATED',
                connections: newConnections
            }];
            this.io.to(this.gameId.toString()).emit("game_diff", diff);
        }
    }

    /* ---------------- CONSTRUCTION ---------------- */
   /**
   * @summary Päivittää kaikkien rakennus- ja alustuotantojonojen tilaa yhdellä tickillä.
   * @description Tämä metodi on vastuussa kaikesta pelin rakentamisesta. Se käy läpi
   * jokaisen tähden ja sen kaksi jonoa (planetaarinen ja alukset), vähentää rakennusaikaa
   * ja käsittelee valmistuneet työt. Valmistuneet työt päivittävät tähden ominaisuuksia
   * tai luovat uusia aluksia tietokantaan ja pelin tilaan.
   *
   * @param {Array<object>} diff - Diff-taulukko, johon lisätään tiedot valmistuneista töistä clientille lähetettäväksi.
   * @returns {Promise<Set<Star>>} Palauttaa `Set`-rakenteen, joka sisältää kaikki tähdet, joita on muokattu.
   * @private
   */
 async _advanceConstruction(diff) {
    // Pidämme kirjaa muokatuista tähdistä, jotta voimme tallentaa ne tehokkaasti kerralla.
    const modifiedStars = new Set();

    // --- OSA 1: Käsittele planetaariset rakennusjonot ---
    for (const star of this.state.stars) {
        // Jos tähdellä ei ole mitään planetaarisessa jonossa, siirry seuraavaan.
        if (!star.planetaryQueue?.length) continue;

        // Käsitellään aina vain jonon ensimmäistä työtä.
        const job = star.planetaryQueue[0];
        job.timeLeft -= 1;

    // Debug – näet tikit terminaalissa
//     //console.log(`[TICK ${this._turn}] ${star.name.padEnd(10)} | `
    //  + `build=${job.type} | left=${job.timeLeft}`);

    // Onko työ valmis?
    if (job.timeLeft <= 0) {
      // A) Päivitä tähden pysyvät ominaisuudet työn tyypin mukaan.
      if (job.type === 'Mine')             star.mines          += 1;
      else if (job.type.startsWith('Shipyard')) star.shipyardLevel += 1;
      else if (job.type.startsWith('Infrastructure')) {
        const lvl = parseInt(job.type.match(/\d+/)[0], 10);
        star.infrastructureLevel = lvl;
      }
      else if (job.type === 'Defense Upgrade') {
        star.defenseLevel += 1;
        star.defenseHP = star.defenseLevel * COMBAT_CONSTANTS.DEFENSE_HP_PER_LEVEL;
        star.markModified('defenseHP');     // Kerrotaan Mongoose-kirjastolle, että tätä kenttää on muokattu.
      }
      else if (job.type === 'Galactic Hub') {
        star.hasGalacticHub = true;
        // Lisää uusi Hub globaaliin listaan
        this.galacticHubs.add(star._id.toString());
        // Kutsutaan erikoisfunktiota Hub-verkon päivittämiseksi.
        await this._updateHubNetwork(star);
        }

      // B) Poista valmis työ jonosta.
      star.planetaryQueue.shift();
      star.markModified('planetaryQueue');

      // Nollaa jonon kokonaisaika, jos se tyhjeni.
      if (star.planetaryQueue.length === 0) {
        star.planetaryQueueTotalTime = 0;
      }

      modifiedStars.add(star);

      // C) Lisää tapahtuma diff-puskuriin clientille lähetettäväksi.
      diff.push({
          action : 'COMPLETE_PLANETARY',
          starId : star._id,
          type   : job.type,
          // Lähetetään koko päivitetty tähtidata, jotta clientin UI pysyy täysin synkassa.
          starData: {
              _id: star._id,
              mines: star.mines,
              defenseLevel: star.defenseLevel,
              shipyardLevel: star.shipyardLevel,
              infrastructureLevel: star.infrastructureLevel,
              hasGalacticHub: star.hasGalacticHub,
              planetaryQueue: star.planetaryQueue,
              shipQueue: star.shipQueue,
              planetaryQueueTotalTime: star.planetaryQueueTotalTime, 
              shipQueueTotalTime: star.shipQueueTotalTime 
          }
      });
    }
  }

    // --- OSA 2: Käsittele alusten rakennusjonot ---
  for (const star of this.state.stars) {
    if (!star.shipQueue?.length) continue;

      const job = star.shipQueue[0];
      job.timeLeft -= 1;

      if (job.timeLeft <= 0) {
        // A) Määritä uuden aluksen ominaisuudet (HP) sen tyypin perusteella.
        const shipStats = {
            'Fighter': { hp: 1, maxHp: 1 },
            'Destroyer': { hp: 2, maxHp: 2 },
            'Cruiser': { hp: 3, maxHp: 3 },
            'Slipstream Frigate': { hp: 1, maxHp: 1 }
        };

        const stats = shipStats[job.type] || { hp: 1, maxHp: 1 };

        // B) Luo uusi Ship-dokumentti tietokantaan.
        const newShip = new Ship({
            gameId      : this.gameId,
            ownerId     : star.ownerId,
            type        : job.type,
            state       : 'orbiting',
            parentStarId: star._id,
            hp          : stats.hp,
            maxHp       : stats.maxHp
        });

//         //console.log(`Created new ship: ID=${newShip._id}, type=${job.type}, owner=${star.ownerId}, hp=${stats.hp}/${stats.maxHp}`);

        // Lisää uusi alus sekä pelin muistissa olevaan tilaan että tallennusjonoon.
        this.state.ships.push(newShip);
        await newShip.save();

        // C) Poista valmis työ jonosta.
        star.shipQueue.shift();
        star.markModified('shipQueue');
        if (star.shipQueue.length === 0) {
          star.shipQueueTotalTime = 0;
        }
        modifiedStars.add(star);

        // D) Lisää tapahtuma diff-puskuriin.
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

      // --- LOPUKSI: Merkitse kaikki muokatut tähdet tallennettavaksi taustalla. ---
      for (const star of modifiedStars) {
        this._pendingSaves.stars.add(star);
      }
      return modifiedStars;
  }

  
  /* ---------------- ECONOMY ---------------- */

    /**
   * @summary Ajaa yhden talouskierroksen: laskee tulot, ylläpidon ja populaation kasvun.
   * @description Tätä metodia ei kutsuta joka pelitickillä, vaan hitaammassa, 10 tickin syklissä.
   * Tämä luo peliin strategisemman talousrytmin. Funktio päivittää kaikkien pelaajien
   * resurssit, kasvattaa planeettojen populaatiota ja lähettää päivitetyt tiedot clienteille.
   * @private
   */
 async _advanceEconomy() {
    // VAIHE 1: Aja talouslogiikka vain joka 10. tick.
    // Tämä luo peliin rauhallisemman talousrytmin ja on tehokkaampaa kuin jatkuva laskenta.
    const TICKS_PER_CYCLE = 10;
    this._ecoTick = (this._ecoTick ?? 0) + 1;
    if (this._ecoTick < TICKS_PER_CYCLE) return;

    /* ===== KAIKKI TALOUSLOGIIKKA TAPAHTUU TÄMÄN PORTIN SISÄLLÄ ===== */

    const updatesToSend = []; // Kerätään kaikki tämän kierroksen päivitykset tähän.
    
    // VAIHE 2: Kasvata populaatiota kaikilla omistetuilla planeetoilla, jotka eivät ole täynnä.
    this.state.stars.forEach(star => {
        if (star.ownerId) {
            const cap = INFRA_LIMITS[star.infrastructureLevel].maxPop;
            if (star.population < cap) {
                star.population += 1;
                
                // Kerätään tieto muuttuneesta tähdestä lähetettäväksi clientille.
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
    
    // VAIHE 3: Laske tulot ja ylläpito jokaiselle pelaajalle.
    const SHIP_UPKEEP = { Fighter: 1, Destroyer: 2, Cruiser: 3, 'Slipstream Frigate': 4 };
    const PD_UPKEEP = 2;
    const SHIPYARD_UPKEEP = 3;
    const UPKEEP_GALACTIC_HUB = 15;

    // Käydään läpi kaikki pelaajat ja heidän resurssilompakkonsa.
    Object.entries(this.state.resources).forEach(([pid, wallet]) => {
        // Otetaan talteen vanhat arvot, jotta voidaan tarkistaa, tapahtuiko muutosta.
        const oldCredits = wallet.credits;
        const oldMinerals = wallet.minerals;

        let upkeep = 0;
        let currentIncome = { credits: 0, minerals: 0 };

        // Käydään pelaajan tähdet läpi ja lasketaan tulot (populaatio, kaivokset)
        // sekä rakennusten ylläpito tehokkaasti samalla silmukalla.
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
        
        // Kerätään alusten ylläpito erikseen.
        this.state.ships
            .filter(sh => sh.ownerId?.toString() === pid)
            .forEach(sh => {
                upkeep += SHIP_UPKEEP[sh.type] ?? 0;
            });

        // Päivitetään pelaajan lompakko nettotuloksella (tulot - ylläpito).
        wallet.credits += currentIncome.credits - upkeep;
        wallet.minerals += currentIncome.minerals;

        // Jos resurssit muuttuivat, luodaan päivitysviesti clientille.
        if (wallet.credits !== oldCredits || wallet.minerals !== oldMinerals) {
            updatesToSend.push({
                action: 'RESOURCE_UPDATE',
                playerId: pid,
                resources: { credits: wallet.credits, minerals: wallet.minerals },
            });
        }
    });

    // VAIHE 4: Nollaa talouslaskuri ja lähetä kaikki kerätyt päivitykset.
    this._ecoTick = 0;

    // Lähetetään kaikki tämän talouskierroksen aikana kerätyt diffit kerralla.
    if (updatesToSend.length > 0 && this.io) {
        this.io.to(this.gameId.toString()).emit("game_diff", updatesToSend);
    }
}


  /* ---------------- ACTIONS --------------- */

    /**
   * @summary Käsittelee ja toteuttaa taulukollisen saapuneita toiminto-objekteja.
   * @description Tämä on keskitetty metodi, joka ottaa vastaan kaikki pelin tilanmuutospyynnöt
   * (esim. rakennuskäskyt, liikkumiskomennot) sekä pelaajalta että tekoälyltä.
   * Se toimii auktoriteettina, joka validoi ja suorittaa nämä toiminnot.
   *
   * @param {Array<object>} actions - Taulukko toiminto-objekteja, esim. `{ action: 'MOVE_SHIP', ... }`.
   * @private
   */
async _applyActions(actions) {
    // Käydään läpi kaikki toiminnot yksi kerrallaan.
  for (const act of actions) {

    // --- KÄSITTELY: PLANETAARINEN RAKENNUSJONO ---
    if (act.action === "QUEUE_PLANETARY") {
        // TÄRKEÄ TURVATOIMI: Jos komento tulee ihmispelaajalta (sisältää hinnan),
        // suoritetaan serverillä aina lopullinen resurssitarkistus.
        // Tämä estää client-puolen huijausyritykset.
      if (act.cost && act.playerId) {
        const playerWallet = this.state.resources[act.playerId];
        // Varmistetaan serverillä, että pelaajalla on varmasti varaa
        if (playerWallet && playerWallet.credits >= act.cost.credits && playerWallet.minerals >= act.cost.minerals) {
          playerWallet.credits -= act.cost.credits;
          playerWallet.minerals -= act.cost.minerals;
        } else {
            // Jos pelaajalla ei ollutkaan varaa, toimenpide perutaan hiljaisesti.
          continue; // Hypätään tämän actionin yli
        }
      }

      const st = this._star(act.starId);
      if (st) {
        // Varmistetaan, että jonot ovat olemassa ennen lisäämistä.
        st.planetaryQueue = st.planetaryQueue || [];
        st.shipQueue      = st.shipQueue      || [];

        st.planetaryQueue.push({
          id:        uuidv4(),
          type:      act.build.type,
          timeLeft:  act.build.time,
          totalTime: act.build.time
        });
        this._pendingSaves.stars.add(st);       // Merkitään tähti tallennettavaksi.
      }
      continue;     // Siirry seuraavaan toimintoon.
    }

    // --- KÄSITTELY: ALUSTEN RAKENNUSJONO ---
    if (act.action === "QUEUE_SHIP") {
        // Käytetään täsmälleen samaa resurssien tarkistus- ja veloituslogiikkaa kuin planetaarisissa rakennuksissa.
      if (act.cost && act.playerId) {
        const playerWallet = this.state.resources[act.playerId];
        if (playerWallet && playerWallet.credits >= act.cost.credits && playerWallet.minerals >= act.cost.minerals) {
          playerWallet.credits -= act.cost.credits;
          playerWallet.minerals -= act.cost.minerals;
        } else {
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
        this._pendingSaves.stars.add(st);
      }
      continue;
    }

      // --- KÄSITTELY: ALUSTEN LIIKKUMINEN ---
    if (act.action === "MOVE_SHIP") {
        
        const sh = this._ship(act.shipId);
        if (!sh) {
            continue;       // Jos alusta ei löydy, perutaan.
        }
        
        const toStar = this._star(act.toStarId);
        if (!toStar) {
            continue;       // Jos kohdetta ei löydy, perutaan.
        }

        // Hyväksy liikkumiskomento VAIN, jos alus on kiertoradalla.
        if (sh.state !== 'orbiting') {
            // Jos alus on jo liikkeellä ('moving') tai tekemässä muuta,
            // ohita tämä komento hiljaisuudessa.
            continue; // Siirry käsittelemään seuraavaa actionia.
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
        
        // Estetään liikkuminen samaan tähteen, jossa alus jo on.
        if (fromStar && fromStar._id.equals(toStar._id)) {
//             console.warn(`Ship ${sh._id} ordered to same star – ignoring`);
            continue;
        }
        
        // Lasketaan nopeus perustuen starlane-yhteyksiin ja alustyyppiin.
        let speed = SHIP_SPEEDS.slow; // Oletusnopeus
        if (fromStar && fromStar.connections.some(c => c.toString() === act.toStarId)) {
            speed = SHIP_SPEEDS.fast; // Starlane on aina nopein
        } else if (sh.type === 'Slipstream Frigate') {
            speed = SHIP_SPEEDS.frigateSlow; // Frigatti saa oman erikoisnopeutensa
        } else if (sh.type === 'Fighter') {
            speed = SHIP_SPEEDS.fighterSlow; // Hävittäjä on myös nopeampi
        }
        
        // Päivitetään aluksen tila tietokannassa: se on nyt liikkeellä.
        sh.state = "moving";
        sh.targetStarId = act.toStarId;
        sh.parentStarId = null;
        sh.speed = speed;
        sh.departureStarId = fromStarId;
        sh.movementTicks = 0;
        
        // Lasketaan matka-aika tickeinä.
        if (fromStar) {
            const dist = Math.hypot(
                fromStar.position.x - toStar.position.x,
                fromStar.position.y - toStar.position.y,
                fromStar.position.z - toStar.position.z
            );
            sh.ticksToArrive = Math.max(1, Math.ceil(dist / speed));
        } else {
            sh.ticksToArrive = 10; // Oletusaika, jos lähtöpistettä ei jostain syystä tunneta.
        }
        
        // Kerrotaan Mongoose-kirjastolle kaikki kentät, joita on muokattu.
        sh.markModified('state');
        sh.markModified('targetStarId');
        sh.markModified('parentStarId');
        sh.markModified('speed');
        sh.markModified('departureStarId');
        sh.markModified('movementTicks');
        sh.markModified('ticksToArrive');

        this._pendingSaves.ships.add(sh);
        
        // Lähetetään clientille tieto liikkeen alkamisesta.
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

      // --- KÄSITTELY: ALUSTEN SAAPUMINEN (visuaalinen notifikaatio) ---
    if (act.action === "SHIP_ARRIVED") {
        // Tämä on clientin lähettämä visuaalinen vahvistus. Serveri vain varmistaa,
        // että sen oma tila on jo synkassa. Jos ei ole, voidaan kirjata varoitus.
        const sh = this._ship(act.shipId);
        if (sh && sh.state !== 'orbiting') {
        }
        continue;
    }
  }
}

  /**
   * @summary Laskee pisteen, joka on kahden 3D-pisteen välisellä janalla.
   * @description Tämä on lineaarisen interpolaation apufunktio. Sitä käytetään
   * selvittämään liikkuvan aluksen tarkka 3D-sijainti missä tahansa ajan hetkessä
   * sen matkan aikana.
   *
   * @param {{x: number, y: number, z: number}} from - Lähtöpisteen koordinaatit.
   * @param {{x: number, y: number, z: number}} to - Määränpään koordinaatit.
   * @param {number} t - Edistyminen matkalla (luku välillä 0.0 - 1.0).
   * 0.0 on lähtöpiste, 1.0 on määränpää.
   *
   * @returns {{x: number, y: number, z: number}} Palauttaa uuden pisteen
   * koordinaatit, jotka ovat `t` prosenttia matkasta `from`-pisteestä `to`-pisteeseen.
   * @private
   */
_interpolatePosition(from, to, t) {
    // Varmistetaan, että edistyminen `t` on aina välillä 0-1, estäen virhearvot.
    const progress = Math.max(0, Math.min(1, t)); 
    // Lasketaan uusi sijainti lineaarisesti interpoloimalla.
    return {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
        z: from.z + (to.z - from.z) * progress
    };
}


  /**
   * @summary Päivittää kaikkien liikkuvien alusten sijainnin, käsittelee saapumiset ja erikoismekaniikat.
   * @description Tämä on yksi pelisilmukan keskeisimmistä funktioista. Se suoritetaan joka tick ja se on
   * vastuussa koko pelin kinematiikasta. Funktio on jaettu selkeisiin vaiheisiin, jotta vältetään
   * kilpa-ajotilanteita (race conditions), erityisesti slipstream-bonuksen kanssa.
   *
   * @param {Array<object>} diff - Diff-taulukko, johon lisätään tiedot tapahtumista (esim. alus saapui, alus sai slipstream-bonuksen).
   * @private
   */
async _advanceMovement(diff) {
    // =========================================================================
    // VAIHE 1: POSITIOIDEN LASKEMINEN (Snapshot-vaihe)
    // =========================================================================
    // Ennen kuin mitään liikutetaan, lasketaan ja tallennetaan KAIKKIEN alusten
    // nykyinen sijainti muistiin. Tämä on kriittistä, koska slipstream-bonuksen
    // tulee perustua alusten sijaintiin tickin alussa, ei sen aikana.
    const shipPositions = new Map(); // shipId -> {x, y, z}
    
    this.state.ships.forEach(ship => {
        let currentPos;
        if (ship.state === 'moving' && ship.departureStarId && ship.targetStarId) {
            const fromStar = this._star(ship.departureStarId);
            const toStar = this._star(ship.targetStarId);
            if (fromStar && toStar) {
                // Käytetään apufunktiota sijainnin laskemiseen matkan edistymisen perusteella.
                const progress = (ship.movementTicks || 0) / (ship.ticksToArrive || 1);
                currentPos = this._interpolatePosition(fromStar.position, toStar.position, progress);
            }
        } else if (ship.parentStarId) {
            // Jos alus on kiertoradalla, sen sijainti on sama kuin tähden sijainti.
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
    // VAIHE 2: SLIPSTREAM-BONUSTEN MÄÄRITTÄMINEN
    // =========================================================================
    // Käydään läpi kaikki liikkuvat alukset ja päätetään, mitkä niistä saavat
    // slipstream-bonuksen tällä kierroksella perustuen Vaiheessa 1 laskettuihin sijainteihin.
    const shipsToGetBonus = new Set(); // Kerätään bonuksen saavat alukset tähän
    const slipstreamFrigates = this.state.ships.filter(s => s.type === 'Slipstream Frigate');
    const movingShips = this.state.ships.filter(s => s.state === 'moving');

    for (const ship of movingShips) {
        // Bonus ei koske aluksia, jotka ovat jo nopealla starlane-reitillä.
        if (ship.speed === SHIP_SPEEDS.fast) continue;
        // Frigatti ei voi nopeuttaa itseään.
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
                        
                        // Lähetetään clientille tieto efektin näyttämistä varten.
                        diff.push({
                            action: 'SHIP_IN_SLIPSTREAM',
                            shipId: ship._id.toString(),
                            frigateId: frigate._id.toString(),
                            movementTicks: (ship.movementTicks || 0) + 2, // Ennakoidaan molemmat tikit
                            ticksToArrive: ship.ticksToArrive,
                            progress: ((ship.movementTicks || 0) + 2) / (ship.ticksToArrive || 1),
                            position: shipPos 
                        });
                        
                        break; // Yksi aura riittää, ei tarvitse tarkistaa muita frigatteja.
                    }
                }
            }
        }
    }

    // =========================================================================
    // VAIHE 3: LIIKKEEN SUORITTAMINEN JA SAAPUMISTEN TARKISTUS
    // =========================================================================
    // Nyt kun bonukset on päätetty, liikutetaan kaikkia aluksia ja tarkistetaan saapumiset.
    const arrivalsThisTick = new Map();     // Kerätään saapuvat alukset tähden mukaan.

    for (const ship of movingShips) {
        // Jokainen alus liikkuu vähintään yhden tickin.
        ship.movementTicks = (ship.movementTicks || 0) + 1;

        // Jos alus ansaitsi bonuksen, se liikkuu toisen tickin.
        if (shipsToGetBonus.has(ship._id.toString())) {
            ship.movementTicks += 1;
        }

        // Onko alus perillä?
        const ticksToArrive = ship.ticksToArrive ?? 1;
        if (ship.movementTicks >= ticksToArrive) {
            const targetStar = this._star(ship.targetStarId);
            if (targetStar) {
                // Lisätään alus saapuneiden listalle.
                const starId = targetStar._id.toString();
                if (!arrivalsThisTick.has(starId)) {
                    arrivalsThisTick.set(starId, []);
                }
                arrivalsThisTick.get(starId).push({ ship, targetStar });
            }
        }
    }
    
    // =========================================================================
    // VAIHE 4: KÄSITTELE SAAPUMISET
    // =========================================================================
    // Käydään läpi kaikki saapuneiden alusten ryhmät ja päivitetään niiden tila.
    for (const [starId, arrivals] of arrivalsThisTick) {
        const targetStar = arrivals[0].targetStar;
        const arrivalDiffs = [];
        
        for (const arrival of arrivals) {
            const ship = arrival.ship;

            // Päivitetään aluksen tila: jos se saapuu valloitettavaan tähteen, se liittyy valloitukseen.
            if (targetStar.isBeingConqueredBy?.toString() === ship.ownerId?.toString()) {
                ship.state = 'conquering';
            } else {
                ship.state = 'orbiting';
            }

            // Nollataan liikkumistiedot ja asetetaan uusi sijainti.
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
        
        // KRIITTINEN: Kun aluksia saapuu, on mahdollista, että uusi taistelu alkaa.
        // Kutsutaan taistelunratkaisua heti.
        const combatDiff = [];
        const shipsAtTarget = this.state.ships.filter(s =>
            s.parentStarId?.toString() === targetStar._id.toString() &&
            (s.state === 'orbiting' || s.state === 'conquering')
        );
        
        await this._resolveCombatAtStar(targetStar, combatDiff, shipsAtTarget);
        
        diff.push(...combatDiff);
    }
}

  /**
   * @summary Päivittää kaikkien käynnissä olevien valloitusten tilan.
   * @description Tämä funktio suoritetaan joka pelitickillä. Se käy läpi kaikki tähdet,
   * ja jos tähti on valloituksen alla, se laskee valloituksen edistymisen perustuen
   * paikalla olevien alusten määrään ja tyyppiin. Se myös käsittelee valloituksen
   * onnistumisen tai keskeytymisen.
   *
   * @param {Array<object>} diff - Diff-taulukko, johon lisätään valloitukseen liittyvät tapahtumat.
   * @private
   */
async _advanceConquest(diff) {
    for (const star of this.state.stars) {
      // Jos tähti ei ole valloituksen alla, siirry seuraavaan.
      if (!star.isBeingConqueredBy) continue;
        
        const conquerorId = star.isBeingConqueredBy.toString();
        const defenderId = star.ownerId?.toString();
        
        // VAIHE 1: Laske valloittavat joukot.
        const conqueringShips = this.state.ships.filter(s => 
            s.parentStarId?.toString() === star._id.toString() &&
            s.ownerId?.toString() === conquerorId &&
            s.state === 'conquering'
        );

        // JOS valloittajia ei enää ole (esim. ne on tuhottu), keskeytä valloitus.
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
        
        // VAIHE 2: Tarkista, onko puolustajia ilmestynyt paikalle.
        const defendingShips = this.state.ships.filter(s => 
            s.parentStarId?.toString() === star._id.toString() &&
            s.ownerId?.toString() !== conquerorId &&
            (s.state === 'orbiting' || s.state === 'conquering')
        );
        
        // JOS puolustajia on, valloitus keskeytyy ja taistelu alkaa seuraavalla kierroksella.
        if (defendingShips.length > 0) {  
            star.isBeingConqueredBy = null;
            star.conquestProgress = 0;
            star.markModified('isBeingConqueredBy');
            star.markModified('conquestProgress');
            
            // Palautetaan valloittamassa olleet alukset takaisin 'orbiting'-tilaan.
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
        
        // VAIHE 3: Laske valloituksen edistyminen tällä tickillä.
        if (conqueringShips.length > 0) {
            // Tähden telakka hidastaa valloitusta: jokainen taso puolittaa nopeuden.
            const yardLevel = Math.min(star.shipyardLevel || 0, 5);
            const slowdownRatio = 1 / Math.pow(2, yardLevel);
            
            // Cruiserit ovat 3x tehokkaampia valloittajia kuin muut alukset.
            const conquestRate = conqueringShips.reduce((sum, s) => 
                sum + (s.type === 'Cruiser' ? 3 : 1), 0
            ) * slowdownRatio * this._speed;;
            
            star.conquestProgress += conquestRate; 
            star.markModified('conquestProgress');
            
            // VAIHE 4: Tarkista, onko valloitus valmis.
            if (star.conquestProgress >= 100) {
                // -- VALLOITUS ONNISTUI --
                const oldOwner = star.ownerId;
                const oldMines = star.mines;
                
                // Vaihda omistaja ja nollaa perustiedot.
                star.ownerId = star.isBeingConqueredBy;
                star.population = 1;
                star.shipyardLevel = star.shipyardLevel; 
                
                // Telakka säilyy, mutta osa kaivoksista tuhoutuu.
                if (oldMines > 0) {
                    const maxDestroy = Math.ceil(oldMines * 0.5);
                    const destroyed = oldMines === 1 ? 1 : 
                        Math.max(1, Math.floor(Math.random() * maxDestroy) + 1);
                    star.mines = Math.max(0, oldMines - destroyed);
                }
                
                // Nollaa rakennusjonot.
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
                
                // Palautetaan alukset kiertoradalle.
                conqueringShips.forEach(s => {
                    s.state = 'orbiting';
                    s.markModified('state');
                });
                
                // Lähetä tieto clientille.
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
            } else {
                // Valloitus jatkuu, lähetä päivitys edistymisestä.
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

  /**
 * @summary Käy läpi kaikki tähdet ja käynnistää taistelunratkaisun niillä, joilla on konflikti.
 * @description Tämä on taistelujärjestelmän päämetodi, joka suoritetaan joka pelitickillä.
 * Se on optimoitu niin, että se ei käy läpi jokaista tähteä turhaan.
 *
 * TOIMINTALOGIIKKA:
 * 1.  Kerää KAIKKI pelin kiertoradalla olevat alukset tehokkaasti yhteen `Map`-rakenteeseen,
 * joka on ryhmitelty tähden ID:n mukaan (O(N) -operaatio, jossa N on alusten määrä).
 * 2.  Käy läpi VAIN ne tähdet, joilla on aluksia.
 * 3.  Tarkistaa jokaisella tähdellä, onko paikalla useampi kuin yksi osapuoli (faktio)
 * TAI onko yksinäinen hyökkääjä ja puolustava planetaarinen puolustus (PD).
 * 4.  Jos taistelutilanne havaitaan, kutsuu varsinaista `_resolveCombatAtStar`-metodia
 * suorittamaan yksityiskohtaisen taistelulaskennan.
 *
 * @param {Array<object>} diff - Diff-taulukko, johon taistelun tulokset lisätään.
 * @private
 */
async _resolveCombat(diff) {
    // VAIHE 1: Ryhmittele kaikki kiertoradalla olevat alukset tähdittäin.
    // Tämä on paljon tehokkaampaa kuin käydä läpi kaikki tähdet ja suodattaa alukset jokaiselle erikseen.
    const shipsByStarId = new Map();
    
    for (const ship of this.state.ships) {
        // Otetaan huomioon vain paikallaan olevat alukset.
        if (!['orbiting', 'conquering'].includes(ship.state)) continue;
        
        const starId = ship.parentStarId?.toString();
        if (!starId) continue;
        
        // Lisätään alus tähden listalle.
        if (!shipsByStarId.has(starId)) {
            shipsByStarId.set(starId, []);
        }
        shipsByStarId.get(starId).push(ship);
    }
    
    // VAIHE 2: Käy läpi vain ne tähdet, joilla on toimintaa.
    for (const [starId, shipsAtStar] of shipsByStarId) {
        const star = this._star(starId);
        if (!star) continue;
        
        // VAIHE 3: Tunnista, tarvitaanko taistelua.
        // Luodaan Set-rakenne kaikista uniikeista omistajista tähdellä.
        const factions = new Set(shipsAtStar.map(s => s.ownerId?.toString()));
        
        // Taistelua tarvitaan, JOS...
        const needsCombat = 
            // ...tähdellä on useampi kuin yksi osapuoli.
            factions.size > 1 || 
            // ...TAI tähdellä on vain yksi osapuoli, mutta se ei omista tähteä, jolla on puolustusta.
            (factions.size === 1 && star.defenseHP > 0 && 
             Array.from(factions)[0] !== star.ownerId?.toString());
        
        if (needsCombat) {
            // Jos taistelua tarvitaan, kutsutaan varsinaista taistelunratkaisufunktiota.
            await this._resolveCombatAtStar(star, diff, shipsAtStar);
        } else if (factions.size === 1) {
            // Jos taistelua ei tarvita, mutta paikalla on vain yksi hyökkääjä,
            // tarkistetaan, voidaanko aloittaa planeetan valloitus.
            await this._checkConquestStart(star, shipsAtStar, diff);
        }
    }
}


  /**
   * @summary Ratkaisee yhden kokonaisen taistelukierroksen yhdellä tähdellä.
   * @description Tämä on pelin ydin taistelulogiikka. Se on suunniteltu deterministiseksi ja
   * reiluksi niin, että kaikki alukset "ampuvat" samanaikaisesti. Tämä toteutetaan
   * kaksivaiheisella prosessilla: ensin lasketaan kaikki vahinko ja vasta sitten jaetaan se,
   * jotta alukset, jotka tuhoutuvat, ehtivät silti ampua takaisin samalla kierroksella.
   *
   * @param {Star} star - Tähti, jolla taistelu käydään.
   * @param {Array<object>} diff - Diff-taulukko, johon lisätään taistelun tulokset.
   * @param {Array<Ship>} shipsAtStar - Taulukko kaikista tähdellä olevista aluksista.
   * @private
   */
async _resolveCombatAtStar(star, diff, shipsAtStar = null) {
    // Varmistus: jos aluksia ei annettu, haetaan ne.
    if (!shipsAtStar) {
        shipsAtStar = this.state.ships.filter(s =>
            s.parentStarId?.toString() === star._id.toString() &&
            (s.state === 'orbiting' || s.state === 'conquering')
        );
    }

    // --- ALKUTILAN VALMISTELU ---
    // Ryhmitellään alukset omistajan mukaan.
    const factionShips = {};
    shipsAtStar.forEach(ship => {
        const faction = ship.ownerId?.toString();
        if (!faction) return;
        if (!factionShips[faction]) factionShips[faction] = [];
        factionShips[faction].push(ship);
    });

    const factions = Object.keys(factionShips);

    // Jos taistelua ei tarvita (vain yksi osapuoli eikä puolustusta), siirry valloituksen tarkistukseen.
    const needsCombat = factions.length > 1 || (factions.length === 1 && star.defenseHP > 0 && factions[0] !== star.ownerId?.toString());
    if (!needsCombat) {
        await this._checkConquestStart(star, shipsAtStar, diff);
        return;
    }
    
    // Jos taistelu alkaa, keskeytetään mahdollinen käynnissä oleva valloitus.
    if (star.isBeingConqueredBy) {
        star.isBeingConqueredBy = null;
        star.conquestProgress = 0;
        this._pendingSaves.stars.add(star);
        diff.push({ action: 'CONQUEST_HALTED', starId: star._id, reason: 'combat' });
    }

    // ==========================================================
    // VAIHE 1: VAHINGON LASKEMINEN (DAMAGE CALCULATION PHASE)
    // ==========================================================
    // Tässä vaiheessa emme muuta alusten HP:ta. Sen sijaan keräämme kaiken
    // jaettavan vahingon `damageMap`-puskuriin.
    const damageMap = new Map(); // Avain: shipId, Arvo: totalDamage
    let pdDamage = 0; // Vahinko, jonka planetaarinen puolustus ottaa.

    // Apufunktio vahingon lisäämiseksi puskuriin
    const addDamage = (targetShip, amount) => {
        const currentDamage = damageMap.get(targetShip._id.toString()) || 0;
        damageMap.set(targetShip._id.toString(), currentDamage + amount);
    };

    // 1.1. Planetaarisen puolustuksen (PD) hyökkäys.
    if (star.defenseHP > 0 && star.ownerId) {
        const shots = star.defenseLevel * 3;
        const enemyShips = shipsAtStar.filter(s => s.ownerId?.toString() !== star.ownerId?.toString());
        for (let i = 0; i < shots && enemyShips.length > 0; i++) {
            const target = this._pickTarget(enemyShips); // pickTarget valitsee heikoimman aluksen
            if (target) {
                const damage = target.type === 'Cruiser' ? 0.5 : 2; // Cruiserit kestävät paremmin PD-tulta.
                addDamage(target, damage);
            }
        }
    }

    // 1.2. Alusten hyökkäykset
    for (const attackerFaction of factions) {
        const attackers = factionShips[attackerFaction];
        const potentialTargets = shipsAtStar.filter(s => s.ownerId?.toString() !== attackerFaction);

        for (const attacker of attackers) {
            // A) Jos vihollisen tähdellä on puolustusta, alukset ampuvat sitä.
            if (star.defenseHP > 0 && star.ownerId?.toString() !== attackerFaction) {
                switch (attacker.type) {
                    case 'Cruiser':   pdDamage += COMBAT_CONSTANTS.CRUISER_DMG_VS_DEFENSE; break;
                    case 'Destroyer': pdDamage += COMBAT_CONSTANTS.DESTROYER_DMG_VS_DEFENSE; break;
                    case 'Fighter':   pdDamage += COMBAT_CONSTANTS.FIGHTER_DMG_VS_DEFENSE; break;
                }
            // B) Muuten alukset ampuvat toisia aluksia "kivi-paperi-sakset" -säännöillä.
            } else if (potentialTargets.length > 0) {
                let target = null;
                switch (attacker.type) {
                    case 'Cruiser': 
                        // Cruiserit priorisoivat Destroyereitä 
                        target = this._pickTarget(potentialTargets, s => s.type === 'Destroyer') || this._pickTarget(potentialTargets);
                        if (target) addDamage(target, target.type === 'Fighter' ? 0.5 : 3);
                        break;
                    case 'Destroyer':
                        // Destroyer ampuu kahdesti ja priorisoi kohteekseen fighterit (tuhoaa kaksi fighteria / vuoro)
                        for (let i = 0; i < 2; i++) {
                            target = this._pickTarget(potentialTargets, s => s.type === 'Fighter') || this._pickTarget(potentialTargets);
                            if (target) addDamage(target, 1);
                        }
                        break;
                    case 'Fighter':
                        // Fighterit tekevät suurempaa vahinkoa Cruiseriin
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
    // Nyt kun kaikki vahinko on laskettu, jaetaan se kohteisiin.

    // 2.1. Jaa vahinko aluksille
    const destroyedShipIds = new Set();
    for (const [shipId, totalDamage] of damageMap.entries()) {
        const ship = this._ship(shipId);
        if (ship) {
            ship.hp -= totalDamage;
            if (ship.hp <= 0) {
                destroyedShipIds.add(shipId);       // Merkitään tuhottavaksi.
            } else {
                this._pendingSaves.ships.add(ship); // Merkitään vahingoittunut alus tallennettavaksi.
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
    
    // Lopuksi, tarkistetaan, voiko taistelun jälkeen aloittaa valloituksen.
    const remainingShips = this.state.ships.filter(s => s.parentStarId?.toString() === star._id.toString());
    await this._checkConquestStart(star, remainingShips, diff);
}


  /**
   * @summary Tarkistaa, voiko tähdellä aloittaa valloituksen, ja tekee niin tarvittaessa.
   * @description Tätä funktiota kutsutaan taistelunratkaisun jälkeen tai kun aluksia saapuu
   * tähteen. Se varmistaa, että kaikki tähdellä olevat alukset kuuluvat samalle hyökkäävälle
   * osapuolelle ennen kuin valloitusprosessi käynnistetään.
   *
   * @param {Star} star - Tarkasteltava tähti.
   * @param {Array<Ship>} shipsAtStar - Taulukko tähdellä olevista aluksista.
   * @param {Array<object>} diff - Diff-taulukko, johon `CONQUEST_STARTED`-tapahtuma lisätään.
   * @private
   */
async _checkConquestStart(star, shipsAtStar, diff) {
    // VAIHE 1: Turvatarkistukset. Älä tee mitään, jos valloitus on jo käynnissä tai tähdellä ei ole aluksia.
    if (star.isBeingConqueredBy || shipsAtStar.length === 0) {
        return;
    }

    // VAIHE 2: Varmista, että kaikki paikalla olevat alukset kuuluvat samalle omistajalle.
    // Tämä on tärkeä varmistus, joka estää valloituksen aloittamisen, jos paikalla
    // on jostain syystä vielä useamman osapuolen aluksia.
    const firstShipOwnerId = shipsAtStar[0].ownerId?.toString();
    const allSameOwner = shipsAtStar.every(s => s.ownerId?.toString() === firstShipOwnerId);

    if (!allSameOwner) {
        // Jos on useita eri omistajien aluksia, älä aloita valloitusta
        // (tämä tilanne pitäisi johtaa taisteluun, mutta tämä on turvakeino)
        return;
    }

    const attackerId = firstShipOwnerId;
    const starOwnerId = star.ownerId?.toString();

    // VAIHE 3: Aloita valloitus, jos hyökkääjä ei jo omista tähteä.
    if (attackerId !== starOwnerId) {
        // Asetetaan tähden tila "valloituksen alla".
        star.isBeingConqueredBy = attackerId;
        star.conquestProgress = 0;
        this._pendingSaves.stars.add(star);
        
        // Asetetaan kaikki hyökkääjän alukset `conquering`-tilaan, jotta ne osallistuvat prosessiin.
        for (const ship of shipsAtStar) {
            if(ship.ownerId?.toString() === attackerId) {
                ship.state = 'conquering';
                this._pendingSaves.ships.add(ship);
            }
        }
        
        // Lisätään `CONQUEST_STARTED`-tapahtuma diff-puskuriin. Client käyttää tätä
        // näyttääkseen visuaalisen valloitusrenkaan tähden ympärillä.
        diff.push({
            action: 'CONQUEST_STARTED',
            starId: star._id,
            conquerorId: attackerId,
            shipCount: shipsAtStar.filter(s => s.ownerId?.toString() === attackerId).length
        });
    }
}

  // ---------------- Apufunktiot Combatiin ------------------

    /**
   * @summary Valitsee parhaan kohteen annettujen alusten listasta.
   * @description Tämä on taistelujärjestelmän kohdennuslogiikan ydin. Oletuksena se
   * valitsee aina aluksen, jolla on vähiten kestopisteitä (HP), jotta tuli keskitetään
   * tehokkaasti yhteen kohteeseen.
   * @param {Array<Ship>} ships - Taulukko potentiaalisista kohdealuksista.
   * @param {function} [predicate=()=>true] - Vapaaehtoinen suodatinfunktio, jolla voidaan
   * rajata kohteita (esim. `s => s.type === 'Fighter'`).
   * @returns {Ship|null} Palauttaa parhaan kohdealuksen tai null, jos sopivaa kohdetta ei löydy.
   * @private
   */
  _pickTarget(ships, predicate = () => true) {
    // Varmistetaan ensin, että käsitellään vain "elossa olevia" aluksia, jotka ovat pelin tilassa.
    const valid = ships.filter(s => this.state.ships.some(liveShip => liveShip._id.equals(s._id)) && predicate(s));
    // Järjestetään ehdokkaat HP:n mukaan nousevaan järjestykseen ja valitaan ensimmäinen.
    return valid.sort((a, b) => a.hp - b.hp)[0] || null;
  }


   /**
   * @summary Tekee vahinkoa alukselle ja tuhoaa sen tarvittaessa.
   * @description Keskusfunktio, joka vähentää aluksen HP:ta ja kutsuu `_destroyShip`-metodia,
   * jos HP laskee nollaan tai alle.
   * @param {Ship} ship - Kohdealus.
   * @param {number} damage - Tehtävän vahingon määrä.
   * @param {Array<object>} diff - Diff-puskuri, johon tuhoutumistapahtuma lisätään.
   * @returns {Promise<boolean>} Palauttaa `true`, jos alus tuhoutui, muuten `false`.
   * @private
   */ 
  async _applyDamage(ship, damage, diff) {
      ship.hp -= damage;
      if (ship.hp <= 0) {
        await this._destroyShip(ship._id, diff);
        return true;        // Alus tuhoutui.
      }
      this._pendingSaves.ships.add(ship);  // Merkitään vahingoittunut alus tallennettavaksi.
      return false;          // Alus selvisi.
  }


    /**
   * @summary Yrittää tehdä vahinkoa planeetan puolustukseen (Planetary Defense).
   * @description Käsittelee tilanteen, jossa alus ampuu tähden puolustusta.
   * Laskee ja vähentää vahingon PD:n kestopisteistä ja päivittää puolustustason,
   * jos kestopisteet laskevat tarpeeksi alas.
   * @param {Star} star - Puolustava tähti.
   * @param {Ship} attacker - Hyökkäävä alus.
   * @param {Array<object>} diff - Diff-puskuri.
   * @returns {boolean} Palauttaa `true`, jos PD otti vahinkoa.
   * @private
   */
  _tryDamagePD(star, attacker, diff) {
    // Ei voi vahingoittaa omaa puolustusta tai tuhottua puolustusta.
    if (star.defenseHP <= 0 || attacker.ownerId?.toString() === star.ownerId?.toString()) {
      return false;
    }
    // Lasketaan vahinko hyökkääjän tyypin mukaan.
    let damage = 0;
    switch (attacker.type) {
      case 'Cruiser':   damage = COMBAT_CONSTANTS.CRUISER_DMG_VS_DEFENSE; break;
      case 'Destroyer': damage = COMBAT_CONSTANTS.DESTROYER_DMG_VS_DEFENSE; break;
      case 'Fighter':   damage = COMBAT_CONSTANTS.FIGHTER_DMG_VS_DEFENSE; break;
    }
    if (damage > 0) {
        star.defenseHP = Math.max(0, star.defenseHP - damage);
        // Lasketaan, laskiko puolustuksen "taso" vahingon seurauksena.
        const newLevel = Math.ceil(star.defenseHP / COMBAT_CONSTANTS.DEFENSE_HP_PER_LEVEL);
        if (newLevel < star.defenseLevel) {
            star.defenseLevel = newLevel;
            this._pendingSaves.stars.add(star);  
            
            // Lähetetään clientille tieto tason laskusta, jotta visuaaliset renkaat päivittyvät.
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


  /**
   * @summary Suorittaa yhden taisteluvaiheen yhdelle alustyypille.
   * @description Tämä apufunktio käsittelee kaikkien tietyn tyyppisten (esim. kaikki Cruiserit)
   * alusten hyökkäykset yhdellä kierroksella. Se noudattaa "kivi-paperi-sakset" -logiikkaa
   * ja priorisoi kohteita sen mukaisesti.
   *
   * @param {object} factionShips - Objekti, joka sisältää alukset ryhmiteltynä omistajan mukaan.
   * @param {string} shipType - Käsiteltävä alustyyppi ('Fighter', 'Destroyer', 'Cruiser').
   * @param {Star} star - Tähti, jolla taistelu käydään.
   * @param {Array<object>} diff - Diff-puskuri.
   * @private
   */
  async _combatPhase(factionShips, shipType, star, diff) {
      const factions = Object.keys(factionShips);
      for (const attackerFaction of factions) {
        // Suodatetaan vain tämän kierroksen hyökkääjät ja varmistetaan, että ne ovat yhä elossa.
        const attackers = factionShips[attackerFaction].filter(s => 
          s.type === shipType && this.state.ships.some(ls => ls._id.equals(s._id))
        );
        
        for (const attacker of attackers) {
          // Jos tähdellä on puolustusta, alukset ampuvat aina sitä ensin.
          if (star.defenseHP > 0 && star.ownerId?.toString() !== attacker.ownerId?.toString()) {
            this._tryDamagePD(star, attacker, diff);
            // HUOM: Vaikka alus ampuu PD:tä, se saa silti ampua myös toista alusta samalla kierroksella.
          }
          
          // Kerätään kaikki mahdolliset viholliskohteet.
          const potentialTargets = [];
          for (const defenderFaction of factions) {
            if (attackerFaction === defenderFaction) continue;
            potentialTargets.push(...factionShips[defenderFaction]);
          }
          
          if (potentialTargets.length === 0) continue;

          // Suoritetaan varsinainen alus-vs-alus -vahingonlasku.
          if (shipType === 'Cruiser') {
              const target = this._pickTarget(potentialTargets, s => s.type === 'Destroyer') || 
                            this._pickTarget(potentialTargets);
              if(target) await this._applyDamage(target, target.type === 'Fighter' ? 0.5 : 3, diff);
          } else if (shipType === 'Destroyer') {        // Ampuu kahdesti.
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


    /**
   * @summary Ratkaisee yksinkertaistetun lähitaistelun usean osapuolen välillä.
   * @description Tämä on "fallback"-mekanismi tilanteisiin, joissa on enemmän kuin kaksi
   * osapuolta. Tällöin monimutkainen "kivi-paperi-sakset" -logiikka ohitetaan ja
   * sen sijaan jokainen osapuoli tekee pienen määrän vahinkoa jokaiseen muuhun
   * osapuoleen. Tämä pitää taistelun käynnissä, mutta yksinkertaistaa sitä.
   * 
   * TODO: tuunataan tätä arvaamattomammaksi myöhemmin
   *
   * @param {object} factionShips - Alukset ryhmiteltynä omistajan mukaan.
   * @param {Array<object>} diff - Diff-puskuri.
   * @private
   */
  async _resolveMelee(factionShips, diff) {
      const factions = Object.keys(factionShips);
      for (let i = 0; i < factions.length; i++) {
          for (let j = i + 1; j < factions.length; j++) {
              const faction1 = factions[i];
              const faction2 = factions[j];
              // Varmistetaan, että käsitellään vain elossa olevia aluksia.
              const ships1 = factionShips[faction1].filter(s => this.state.ships.some(ls => ls._id.equals(s._id)));
              const ships2 = factionShips[faction2].filter(s => this.state.ships.some(ls => ls._id.equals(s._id)));
              if (ships1.length > 0 && ships2.length > 0) {
                  // Kumpikin osapuoli tekee yhden vahinkopisteen toisen ensimmäiseen alukseen.
                  await this._applyDamage(ships1[0], 1, diff);
                  await this._applyDamage(ships2[0], 1, diff);
              }
          }
      }
  }
  

    /**
   * @summary Ratkaisee erityistilanteen, jossa hyökkääjä kohtaa vain planetaarisen puolustuksen (PD).
   * @description Kutsutaan, kun tähdellä on vain yhden osapuolen aluksia, mutta ne eivät omista
   * tähteä, ja tähdellä on toimiva PD. Tämä on kaksivaiheinen taistelu: ensin PD ampuu
   * hyökkääjiä, ja sitten eloonjääneet hyökkääjät ampuvat PD:tä.
   *
   * @param {Star} star - Puolustava tähti.
   * @param {Array<Ship>} attackers - Hyökkäävät alukset.
   * @param {Array<object>} diff - Diff-puskuri.
   * @private
   */
async _resolvePDOnlyBattle(star, attackers, diff) {
    // VAIHE 1: Puolustus ampuu ensin.
    if (star.defenseHP > 0 && star.defenseLevel > 0) {
        const shots = star.defenseLevel * 3;
        const validTargets = [...attackers]; // Luodaan muokattava kopio hyökkääjistä.
        
        for (let i = 0; i < shots && validTargets.length > 0; i++) {
            const target = this._pickTarget(validTargets);
            if (target) {
                // Tässäkin Cruiserit kestävät hieman paremmin.
                const damage = target.type === 'Cruiser' ? 1 : 2;
                if (await this._applyDamage(target, damage, diff)) {
                    // Jos alus tuhoutuu, poistetaan se heti ehdokkaiden listalta.
                    const idx = validTargets.findIndex(s => s._id.equals(target._id));
                    if (idx > -1) validTargets.splice(idx, 1);
                }
            }
        }
    }
    
    // VAIHE 2: Eloonjääneet hyökkääjät ampuvat takaisin PD:tä.
    for (const ship of attackers) {
        // Varmistetaan, että alus on yhä elossa PD:n tulituksen jälkeen.
        if (this.state.ships.some(s => s._id.equals(ship._id))) {
            this._tryDamagePD(star, ship, diff);
        }
    }
}


  /**
   * @summary Poistaa aluksen pelistä pysyvästi.
   * @description Tämä funktio hoitaa kaikki aluksen tuhoamiseen liittyvät toimenpiteet:
   * poistaa sen pelin aktiivisesta tilasta (`this.state.ships`), lisää sen ID:n
   * poistojonoon taustaprosessia varten ja lähettää välittömästi `SHIP_DESTROYED`-viestin
   * clientille, jotta visuaalinen räjähdysefekti voidaan näyttää ilman viivettä.
   *
   * @param {string|ObjectId} shipId - Tuhottavan aluksen ID.
   * @param {Array<object>} diff - Diff-puskuri.
   * @private
   */
async _destroyShip(shipId, diff) {
    const shipIndex = this.state.ships.findIndex(s => s._id.toString() === shipId.toString());
    if (shipIndex === -1) {
        // Alus on jo poistettu, ei tehdä mitään.
        return;
    }

    // Poistetaan alus aktiivisesta pelitilasta.
    const [ship] = this.state.ships.splice(shipIndex, 1);
    
    // Lisätään aluksen ID taustalla ajettavaan poistojonoon.
    if (!this._pendingSaves.deletedShips) {
        this._pendingSaves.deletedShips = [];
    }
    const shipIdStr = shipId.toString();
    if (!this._pendingSaves.deletedShips.includes(shipIdStr)) {
        this._pendingSaves.deletedShips.push(shipIdStr);
    }

    // Luodaan ja lähetetään tuhoamisviesti clientille VÄLITTÖMÄSTI.
    const destroyDiff = [{
        action: 'SHIP_DESTROYED',
        shipId: shipIdStr, 
        ownerId: ship.ownerId,
        type: ship.type,
        position: ship.position     // Lähetetään viimeisin tunnettu sijainti räjähdystä varten.
    }];
    
    if (this.io) {
        this.io.to(this.gameId.toString()).emit("game_diff", destroyDiff);
    }

    // Lisätään viesti myös normaaliin diff-puskuriin varmuuden vuoksi.
    diff.push(...destroyDiff);
}

  /* ---------------- FLUSH + BROADCAST ----- */

    /**
   * @summary Puskuroi ja lähettää pelitilan päivitykset (diffs) clienteille.
   * @description Tämä on verkkoliikenteen optimointifunktio. Sen sijaan, että serveri
   * lähettäisi pienen viestin jokaisesta yksittäisestä tapahtumasta, tämä metodi
   * kerää kaikki yhden tickin aikana tapahtuneet muutokset puskuriin (`_diffBuffer`)
   * ja lähettää ne yhtenä isona pakettina ennalta määrätyn intervallin
   * (`DIFF_SEND_INTERVAL`) välein.
   * @param {Array<object>} diff - Taulukko tällä kierroksella kerätyistä muutoksista.
   * @private
   */
    async _flush(diff) {
        if (!this.io || !diff.length) return;
        
        // Lisää tämän tickin muutokset yleiseen puskuriin.
        this._diffBuffer.push(...diff);
        
        // Lähetä puskurin sisältö vain, jos edellisestä lähetyksestä on kulunut tarpeeksi aikaa.
        const now = Date.now();
        if (now - this._lastDiffSent >= this.DIFF_SEND_INTERVAL) {
            if (this._diffBuffer.length > 0) {
                this.io.to(this.gameId.toString()).emit("game_diff", this._diffBuffer);
                // Tyhjennä puskuri lähetyksen jälkeen.
                this._diffBuffer = [];
                this._lastDiffSent = now;
            }
        }
    }

  

  /* ---------------- HELPERS --------------- */

  /** Hakee ihmispelaajan ID:n pelaajalistasta. */
  _humanId(players) { return (players || []).find(p => !p.isAI)?._id?.toString() ?? ""; }
  /** Hakee tähden muistista ID:n perusteella. */
  _star(id) { return this.state.stars.find(s => s._id.toString() === id.toString()); }
  /** Hakee aluksen muistista ID:n perusteella. */
  _ship(id) { return this.state.ships.find(s => s._id.toString() === id.toString()); }


  /**
   * @summary Kokoaa ja palauttaa koko pelin senhetkisen tilan serialisoitavassa muodossa.
   * @description Tämä metodi on elintärkeä uuden pelin alustuksessa. Se kerää kaiken
   * tarvittavan datan (tähdet, alukset, pelaajat, resurssit) ja muuntaa sen puhtaaksi
   * JSON-yhteensopivaksi objektiksi, joka voidaan turvallisesti lähettää clientille
   * pelin alussa (`initial_state`).
   * @returns {Promise<object>} Koko pelimaailman sisältävä snapshot-objekti.
   */
  async getSerializableState() {
    // Muunna Mongoose-dokumentit puhtaiksi JavaScript-objekteiksi.
    const stars = this.state.stars.map(s => s.toObject({ depopulate: true }));
    const ships = this.state.ships.map(s => s.toObject({ depopulate: true }));
    
    // Hae erikseen pelaajien tiedot (nimet, värit), jotta client osaa näyttää ne oikein.
    const players = await Player.find({ gameId: this.gameId }).exec();
    const playersData = players.map(p => ({
      _id: p._id.toString(),
      name: p.name,
      color: p.color,
      isAI: p.isAI
    }));
    
    // Etsi ja liitä mukaan ihmispelaajan ID, jotta client tietää, kuka se on.
    const humanPlayer = players.find(p => !p.isAI);
    const humanPlayerId = humanPlayer ? humanPlayer._id.toString() : null;
    
    // Kokoa kaikki data yhteen, kattavaan "initialState"-objektiin.
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
