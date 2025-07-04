// AIController.js – server-side AI brain (Node.js)
// -----------------------------------------------------------------------------
//  ✔ Pure logic – no direct mutations, no Three.js, no window-globals
//  ✔ Returns plain-JSON *action objects* for GameManager to execute
//  ✔ Uses only primitive / serialisable fields
// -----------------------------------------------------------------------------

/* ---------------------------------------------------------------------------
 *  0.  Imports & tiny utilities
 * ------------------------------------------------------------------------ */
const { randomUUID } = require('crypto');
const uuid = () => randomUUID();

/** Euclidean distance between two 3-D points expressed as {x,y,z}. */
function distance3D(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

/** Simple combat-power heuristic. */
function shipPower(ship) {
  return ship.type === 'Fighter'   ? 1 :
         ship.type === 'Destroyer' ? 2 :
         ship.type === 'Cruiser'   ? 3 : 0;
}

/** Remaining hostile power after PD first-strike. */
function starThreatScore(star, hostileShips) {
  const pdShots = star.defenseLevel * 3;
  const hostile = [...hostileShips].sort((a, b) => shipPower(b) - shipPower(a));
  for (let i = 0; i < pdShots && hostile.length; i++) hostile.shift();
  return hostile.reduce((sum, sh) => sum + shipPower(sh), 0);
}

/* ---------------------------------------------------------------------------
 *  1.  Static cost / weight tables
 * ------------------------------------------------------------------------ */
const STRUCT_COST = {
  'Mine'            : { credits:  75, minerals:  25, time: 10 },
  'Defense Upgrade' : { credits: 100, minerals:  50, time: 15 },
  'Shipyard Lvl 1'  : { credits: 150, minerals: 100, time: 20 },
  'Shipyard Lvl 2'  : { credits: 250, minerals: 200, time: 40 },
  'Shipyard Lvl 3'  : { credits: 325, minerals: 260, time: 60 }
};

// [credits, minerals, buildTime, minShipyardLvl]
const SHIP_COST = {
  Fighter             : [ 50,  25, 10, 1 ],
  Destroyer           : [100,  50, 25, 2 ],
  Cruiser             : [150,  75, 45, 3 ],
  'Slipstream Frigate': [120, 180, 55, 4 ]
};

const WEIGHTS = {
  'Mine'             : 1,
  'Defense Upgrade'  : 2,
  'Shipyard'         : 1,
  'Shipyard Upgrade' : 1.2,
  'Infrastructure'   : 1.3,
  Fighter            : 0.45,
  Destroyer          : 0.75,
  Cruiser            : 1.5
};

const EXPENSIVE_PLANETARY_TAGS = ['Shipyard', 'Infrastructure Lvl', 'Defense Upgrade'];
const EXPENSIVE_SHIP_TAGS      = ['Cruiser', 'Destroyer'];
const WAIT_THRESHOLD           = 0.60;      // 60 % → start saving

/* ---------------------------------------------------------------------------
 *  2.  Economy helpers
 * ------------------------------------------------------------------------ */
function budgetShares(totalMines) {
  if (totalMines <  5) return { eco:0.40, tech:0.10, war:0.50 };
  if (totalMines < 15) return { eco:0.40, tech:0.10, war:0.50 };
  if (totalMines < 30) return { eco:0.50, tech:0.20, war:0.30 };
  if (totalMines < 45) return { eco:0.20, tech:0.45, war:0.35 };
  if (totalMines < 60) return { eco:0.10, tech:0.35, war:0.55 };
  return                    { eco:0.05, tech:0.25, war:0.70 };
}

function splitBudget(resIncome, totalMines) {
  const s = budgetShares(totalMines);
  return {
    eco : { credits: resIncome.credits*s.eco,  minerals: resIncome.minerals*s.eco  },
    tech: { credits: resIncome.credits*s.tech, minerals: resIncome.minerals*s.tech },
    war : { credits: resIncome.credits*s.war,  minerals: resIncome.minerals*s.war  }
  };
}

function affordable(cost, wallet) {
  return wallet.credits >= cost.credits && wallet.minerals >= cost.minerals;
}

function pay(cost, wallet, globalRes) {
  wallet.credits  -= cost.credits;
  wallet.minerals -= cost.minerals;
  globalRes.credits  -= cost.credits;
  globalRes.minerals -= cost.minerals;
}

/* ---------------------------------------------------------------------------
 *  3.  Early-game weighting lookup
 * ------------------------------------------------------------------------ */
const EARLY_STEPS = [
  { mines:20, weights:{Mine:.40, Fighter:.50, Infrastructure:.10, Shipyard:0} },
  { mines:15, weights:{Mine:.50, Fighter:.50, Infrastructure:0,   Shipyard:0} },
  { mines:10, weights:{Mine:.60, Fighter:.40, Infrastructure:0,   Shipyard:0} },
  { mines: 5, weights:{Mine:.70, Fighter:.30, Infrastructure:0,   Shipyard:0} },
  { mines: 0, weights:{Mine:1.00, Fighter:0,   Infrastructure:0,  Shipyard:0} }
];

function earlyWeights(totalMines) {
  if (totalMines >= 25) return null;
  for (const step of EARLY_STEPS)
    if (totalMines >= step.mines) return step.weights;
  return null;
}

/**
 * Simuloi planetaarisen puolustuksen (PD) ensi-iskun ja palauttaa selviytyneet alukset.
 * @param {Array<Object>} ships - Hyökkäävä laivasto. Jokaisella aluksella on { type, hp }.
 * @param {number} defenseLevel - Puolustavan planeetan PD-taso.
 * @returns {Array<Object>} - Laivasto, joka selvisi ensi-iskusta.
 */
function simulatePDFirstStrike(ships, defenseLevel) {
    if (defenseLevel === 0) {
        return ships; // Ei puolustusta, kaikki selviävät.
    }

    const shots = defenseLevel * 3;
    const PD_DAMAGE_PER_SHOT = 2; // Oletusvahinko per laukaus
    let totalDamagePool = shots * PD_DAMAGE_PER_SHOT;

    // Luodaan kopio laivastosta, jotta emme muokkaa alkuperäistä.
    // Lisätään väliaikainen hp-kenttä simulaatiota varten.
    const fleetCopy = ships.map(ship => ({ 
        ...ship, 
        simHp: ship.hp || 1 // Varmistetaan, että hp on olemassa
    }));

    // Kohdinnuslogiikka: PD ampuu heikoimpia ensin (Fighter -> Destroyer -> Cruiser)
    const targetPriority = ['Fighter', 'Destroyer', 'Cruiser'];
    
    for (const shipType of targetPriority) {
        // Käydään läpi kaikki tämän tyypin alukset
        for (const ship of fleetCopy) {
            if (ship.type === shipType && totalDamagePool > 0) {
                const damageNeeded = ship.simHp;
                
                // Jos vahinkoa on tarpeeksi tuhoamaan alus
                if (totalDamagePool >= damageNeeded) {
                    totalDamagePool -= damageNeeded;
                    ship.simHp = 0; // Merkitään tuhotuksi
                } else {
                    // Ei tarpeeksi vahinkoa koko aluksen tuhoamiseen,
                    // mutta kaikki jäljellä oleva vahinko kohdistetaan siihen.
                    ship.simHp -= totalDamagePool;
                    totalDamagePool = 0;
                }
            }
            if (totalDamagePool <= 0) break; // Vahinko loppui kesken
        }
        if (totalDamagePool <= 0) break;
    }

    // Palautetaan ne alukset, joiden simuloitu HP on > 0.
    return fleetCopy.filter(ship => ship.simHp > 0);
}

/* ---------------------------------------------------------------------------
 *  4.  AIController class
 * ------------------------------------------------------------------------ */
class AIController {
  /**
   * @param {string}  aiId       – Mongo/Socket id
   * @param {object} gameState   – { resources, stars, ships } (live refs)
   * @param {object} config      – { infraLimits, playerId, speeds, fleetTarget }
   */
  constructor(aiId, gameState, config) {
    /* ---------- 1. referenssit pelitilaan ---------- */
    this.aiId  = aiId;
    this.res   = gameState.resources;   // oma päätili (viittaus dokkarin kenttään)
    this.stars = gameState.stars;       // live-array
    this.ships = gameState.ships;       // live-array

    /* ---------- 2. konfiguraatiot ---------- */
    this.infra        = config.infraLimits;
    this.humanId      = config.playerId;    // ihmispelaajan id
    this.speeds       = config.speeds || {  
        fast: 60,
        slow: 6,
        fighterSlow: 12
    };
    this.FLEET_TARGET = config.fleetTarget || 8;

    /* ---------- 3. ***JAETAAN ALOITUSPÄÄOMA*** ---------- */
    // a) ota talteen “edellinen saldo” delta-laskua varten
    this.prevRes = { ...this.res };

    // b) pilko alkukassa kolmeen lompakkoon
    const minesAtStart = this._countOwnedMines();      // montako kaivosta lähtötilassa
    const seed         = splitBudget(this.res, minesAtStart);
    this.eco  = { ...seed.eco  };      // kaivokset & pop rakennetaan tästä
    this.tech = { ...seed.tech };      // infra + telakat
    this.war  = { ...seed.war  };      // laivat & puolustus

    /* ---------- 4. bookkeeping ---------- */
    this.turn = 0;

    /* ---------- 5. Strateginen tila ---------- */
    this.gatheringTarget = null;     // Tähti johon kerätään joukkoja
    this.gatheringFor = null;        // Kohdetähti hyökkäystä varten
    this.gatheringStartTurn = null;  // Milloin aloitettiin kerääminen
    this.GATHERING_TIMEOUT = 120;     // Max vuoroa keräämiseen
  }

  /* -------------------------------------------------------------------- */
  /*  PUBLIC – one call per game tick                                     */
  /* -------------------------------------------------------------------- */
  runTurn(turnNumber, income = { credits:0, minerals:0 }) {
      // Jos income on nolla (oletusarvo), laske delta itse
      if (income.credits === 0 && income.minerals === 0) {
          income = {
              credits: Math.max(0, this.res.credits - this.prevRes.credits),
              minerals: Math.max(0, this.res.minerals - this.prevRes.minerals)
          };
      }
      
      /* 1) päivitä kukkarot */
      const totalMines = this._countOwnedMines();
      this._deposit(splitBudget(income, totalMines));
      const totalShips = this.ships.filter(s => s.ownerId?.toString() === this.aiId).length;

      /* 2) jos tukikohtaa ei ole → pass */
      const myStars = this.stars.filter(s => s.ownerId?.toString() === this.aiId);
      if (!myStars.length) return [{ action:'NO_BASE' }];

      const acts = [];

      // Tarkista gathering timeout
      if (this.gatheringTarget && this.gatheringStartTurn) {
          if (turnNumber - this.gatheringStartTurn > this.GATHERING_TIMEOUT) {
//               console.log(`[AI] Gathering timeout - proceeding with available forces`);
              this.gatheringTarget = null;
              this.gatheringFor = null;
              this.gatheringStartTurn = null;
          }
      }

      // EARLY GAME GUARDS
      if (totalMines < 5) {
          // Rakenna VAIN kaivoksia
          const mineBuild = this._buildMineOnly(myStars);
          if (mineBuild) acts.push(mineBuild);
          
          // MUTTA anna laajentua silti!
          acts.push(...this._expandWithGathering(myStars));
          
          // Lisätään playerId kaikkiin
          acts.forEach(act => { act.playerId = this.aiId; });
          // Päivitä prevRes AINA ennen paluuta
          this.prevRes.credits = this.res.credits;
          this.prevRes.minerals = this.res.minerals;
          return acts;
      }
      
      if (totalMines < 10 && totalShips < 10) {
          // Rakenna kaivoksia ja laivoja, mutta anna myös laajentua
          const sBuild = this._buildOneStructure(myStars, totalMines, totalShips);
          if (sBuild) acts.push(sBuild);
          acts.push(...this._buildShips(myStars, totalMines, totalShips));
          acts.push(...this._expandWithGathering(myStars));  // Tärkeä!
          
          // Lisätään playerId kaikkiin
          acts.forEach(act => { act.playerId = this.aiId; });
          // Päivitä prevRes AINA ennen paluuta
          this.prevRes.credits = this.res.credits;
          this.prevRes.minerals = this.res.minerals;
          return acts;
      }

      /* 3) Normaali logiikka (after early game) */
      const sBuild = this._buildOneStructure(myStars, totalMines, totalShips);
      if (sBuild) acts.push(sBuild);

      
      acts.push(...this._buildShips(myStars, totalMines, totalShips));
      acts.push(...this._defend(myStars));
      acts.push(...this._expandWithGathering(myStars));

      // Päivitä prevRes vasta lopussa
      this.prevRes.credits = this.res.credits;
      this.prevRes.minerals = this.res.minerals;

      // Lisätään jokaiseen actioniin lähettäjän ID
      acts.forEach(act => { act.playerId = this.aiId; });

      return acts;
  }

  /* ==================================================================== */
  /*  PLANETARY BUILDING LOGIC                                            */
  /* ==================================================================== */
  _buildMineOnly(myStars) {
      const tgt = myStars.find(st => this._hasMineRoom(st));
      if (tgt && affordable(STRUCT_COST.Mine, this.eco)) {
          pay(STRUCT_COST.Mine, this.eco, this.res);
          return { 
              action:'QUEUE_PLANETARY',
              starId:tgt.id,
              build:{ type:'Mine', time:STRUCT_COST.Mine.time },
              playerId: this.aiId
          };
      }
      return null;
  }

  _buildOneStructure(myStars, totalMines) {
    /* Early-rule: ennen 5 kaivosta rakennetaan vain lisää kaivoksia */
    if (totalMines < 5) {
      const tgt = myStars.find(st => this._hasMineRoom(st));
      if (tgt && affordable(STRUCT_COST.Mine, this.eco)) {
        pay(STRUCT_COST.Mine, this.eco, this.res);
        return { action:'QUEUE_PLANETARY',
                 starId:tgt.id,
                 build:{ type:'Mine', time:STRUCT_COST.Mine.time } };
      }
      return null;
    }

    /* Kerää & pisteytä vaihtoehdot */
    const opts = [];
    myStars.forEach(st => this._enumerateBuildOptions(st, totalMines, opts));
    if (!opts.length) return null;
    opts.sort((a,b) => b.score - a.score);

    /* Valitse parhaan strategian mukainen vaihtoehto */
    let bestAffordable=null, bestSaving=null;
    for (const o of opts) {
      const wallet = this._walletFor(o.type);
      if (affordable(o.cost, wallet)) { bestAffordable={o,wallet}; break; }

      const expensive = EXPENSIVE_PLANETARY_TAGS.some(t=>o.type.startsWith(t));
      if (expensive &&
          wallet.credits  >= WAIT_THRESHOLD*o.cost.credits &&
          wallet.minerals >= WAIT_THRESHOLD*o.cost.minerals &&
          !bestSaving) bestSaving=o;
    }
    if (!bestAffordable) return null;
    if (bestSaving && bestSaving.score > bestAffordable.o.score) return null; // säästetään

    pay(bestAffordable.o.cost, bestAffordable.wallet, this.res);
    return { action:'QUEUE_PLANETARY',
             starId:bestAffordable.o.star.id,
             build :{ type:bestAffordable.o.type, time:bestAffordable.o.cost.time } };
  }

  /**
   * Kerää kaikki mahdolliset rakennus-optiot yhdelle tähdelle
   * ja pushaa ne `bucket`-taulukkoon muodossa
   *   { star, type, cost, score }
   */
  _enumerateBuildOptions(star, totalMines, bucket) {
      const infraLvl = this._effectiveInfraLevel(star);
      const limits = this.infra[infraLvl] ?? this.infra[Math.max(...Object.keys(this.infra))];

      const eWeights = earlyWeights(totalMines) || {};
      
      const push = (type, cost, mult = 1) => {
          const w = eWeights[type] ?? 1;
          bucket.push({
              star, type, cost,
              score: this._scoreBuild(star, type) * w * mult
          });
      };

      // Infrastructure
      if (star.infrastructureLevel < 5 && !this._infraQueued(star)) {
          const c = this._infraCost(star.infrastructureLevel);
          push(`Infrastructure Lvl ${c.nextLevel}`, c);
      }

      // Shipyard
      const AI_YARD_CAP = 3;
      const yardQueued = this._yardQueued(star);

      if (star.shipyardLevel === 0 && !yardQueued) {
          push("Shipyard", STRUCT_COST["Shipyard Lvl 1"]);
      } else if (
          star.shipyardLevel > 0 &&
          star.shipyardLevel < Math.min(limits.maxShipyard, AI_YARD_CAP) &&
          !yardQueued
      ) {
          const c = this._shipyardCost(star.shipyardLevel);
          push(`Shipyard Lvl ${c.nextLevel}`, c);
      }

      // Mine - mineRoomScale hoituu scoreBuildissa
      if (this._hasMineRoom(star)) {
        push("Mine", STRUCT_COST.Mine, this._mineRoomScale(star));
      }

      // Defense
      if (this._scoreBuild(star, "Defense Upgrade") > 0) {
          push("Defense Upgrade", STRUCT_COST["Defense Upgrade"]);
      }
  }

  /* ==================================================================== */
  /*  SHIPBUILDING                                                        */
  /* ==================================================================== */
  _buildShips(myStars, totalMines, totalShips) {
    /* 0) quota-tarkistus – kaivoksia oltava tarpeeksi ennen sotakoneistoa */
    if (totalMines < this._requiredMines(totalShips)) return [];

    /* 1) kaikki telakat, paras level ensin */
    const yards = myStars
      .filter(st => st.shipyardLevel > 0)
      .sort((a, b) => b.shipyardLevel - a.shipyardLevel);

    const acts             = [];
    const AI_YARD_CAP      = 3;                 // AI:n “hard-cap” shipyard-tasolle
    const EXPENSIVE_SHIPS  = new Set(EXPENSIVE_SHIP_TAGS);

    for (const st of yards) {
      if ((st.shipQueue ?? []).length >= 2) continue;   // jonossa jo tarpeeksi

      const fleet = this._fleetAround(st);
      const prio  = this._shipPriorities(st, fleet);

      for (const type of prio) {
        /* --- A) datat tauluista --- */
        const [cCred, cMin, buildTime, needLvl] = SHIP_COST[type];

        /* --- B) AI ei rakenna > lvl-3 aluksia --- */
        if (needLvl > AI_YARD_CAP) continue;            // pelaajan erikois-alus tms.

        /* --- C) telakan taso riittääkö? --- */
        if (st.shipyardLevel < needLvl) continue;

        /* --- D) rahatilanne --- */
        const cost = { credits: cCred, minerals: cMin };
        if (!affordable(cost, this.war)) {

          /* kalliista laivasta voidaan säästää */
          const expensive = EXPENSIVE_SHIPS.has(type);
          if (
            expensive &&
            (this.war.credits  >= WAIT_THRESHOLD * cCred ||
            this.war.minerals >= WAIT_THRESHOLD * cMin)
          ) {
            /* Jatka säästämistä: älä pudottaudu Fightereihin saman vuoron aikana */
            break;
          }
          /* Ei varaa → kokeile seuraavaa prio-tyyppiä */
          continue;
        }

        /* --- E) maksa & puskuroi diff-action --- */
        pay(cost, this.war, this.res);

        acts.push({
          action : "QUEUE_SHIP",
          starId : st.id,
          build  : { type, time: buildTime }
        });

        /* Yksi alus / telakka / tick – siirry seuraavaan telakkaan */
        break;
      }
    }
    return acts;
  }

  _requiredMines(totalShips) {
    const tbl=[[0,0],[10,10],[15,15],[20,20],[25,25],[30,30],[35,35],[40,40],[45,45],[50,50]];
    let req=0; for(const [ships,mines] of tbl) if(totalShips>=ships) req=mines;
    return req;
  }

  _fleetAround(star) {
      const ships = this.ships.filter(s => 
        s.parentStarId?.toString() === star._id.toString() &&
        s.ownerId?.toString() === this.aiId &&
        (s.state === 'orbiting' || s.state === 'conquering')
      );

      return {
        fighters  : ships.filter(s=>s.type==='Fighter').length,
        destroyers: ships.filter(s=>s.type==='Destroyer').length,
        cruisers  : ships.filter(s=>s.type==='Cruiser').length,
        total     : ships.length
      };
  }

  //apufunktio globaalien vihollisalusten analysointiin
  _analyzeGlobalShipDistribution() {
      const distribution = {
          Fighter: 0,
          Destroyer: 0,
          Cruiser: 0,
          total: 0
      };
      
      // Laske KAIKKI viholliset (ei vain oman AI:n)
      this.ships.forEach(ship => {
          if (ship.ownerId?.toString() !== this.aiId) {
              distribution[ship.type]++;
              distribution.total++;
          }
      });
      
      // Palauta prosentteina
      if (distribution.total > 0) {
          return {
              fighterRatio: distribution.Fighter / distribution.total,
              destroyerRatio: distribution.Destroyer / distribution.total,
              cruiserRatio: distribution.Cruiser / distribution.total,
              total: distribution.total
          };
      }
      
      return { fighterRatio: 0.33, destroyerRatio: 0.33, cruiserRatio: 0.34, total: 0 };
  }
  
  _shipPriorities(star, flt) {
      // Perustavoitteet omalle fleetille (tasapainoinen)
      const baseTarget = { Fighter: 0.3, Destroyer: 0.4, Cruiser: 0.3 };
      
      // Analysoi vihollisten globaali jakauma
      const enemyDist = this._analyzeGlobalShipDistribution();
      
      // Laske vasta-painotukset (rock-paper-scissors)
      const counterWeights = {
          Fighter: 1.0,
          Destroyer: 1.0,
          Cruiser: 1.0
      };
      
      // Jos vihollisilla paljon Fightereita -> rakenna Destroyereita
      if (enemyDist.fighterRatio > 0.4) {
          counterWeights.Destroyer *= 1.5 + (enemyDist.fighterRatio - 0.4) * 2;
          counterWeights.Fighter *= 0.7;
      }
      
      // Jos vihollisilla paljon Destroyereita -> rakenna Cruisereita
      if (enemyDist.destroyerRatio > 0.4) {
          counterWeights.Cruiser *= 1.5 + (enemyDist.destroyerRatio - 0.4) * 2;
          counterWeights.Destroyer *= 0.7;
      }
      
      // Jos vihollisilla paljon Cruisereita -> rakenna Fightereita
      if (enemyDist.cruiserRatio > 0.4) {
          counterWeights.Fighter *= 1.5 + (enemyDist.cruiserRatio - 0.4) * 2;
          counterWeights.Cruiser *= 0.7;
      }
      
      // Erityistapaus: Jos PALJON PD:tä kentällä -> priorisoi Cruisereita
      const enemiesWithPD = this.stars.filter(st => 
          st.ownerId?.toString() !== this.aiId && 
          st.defenseLevel > 0
      ).length;
      
      if (enemiesWithPD > 3) {
          counterWeights.Cruiser *= 1.3;
      }
      
      // Laske lopulliset prioriteetit
      const priorities = [];
      const scores = {};
      
      // Pisteytä jokainen alustyyppi
      if (star.shipyardLevel >= 1) {
          const fighterDeficit = baseTarget.Fighter - (flt.fighters / Math.max(1, flt.total));
          scores.Fighter = (0.5 + fighterDeficit) * counterWeights.Fighter;
      }
      
      if (star.shipyardLevel >= 2) {
          const destroyerDeficit = baseTarget.Destroyer - (flt.destroyers / Math.max(1, flt.total));
          scores.Destroyer = (0.5 + destroyerDeficit) * counterWeights.Destroyer;
      }
      
      if (star.shipyardLevel >= 3) {
          const cruiserDeficit = baseTarget.Cruiser - (flt.cruisers / Math.max(1, flt.total));
          scores.Cruiser = (0.5 + cruiserDeficit) * counterWeights.Cruiser;
          
          // Lisäbonus jos ei ole yhtään Cruisereita
          if (flt.cruisers === 0 && flt.total > 5) {
              scores.Cruiser *= 1.5;
          }
      }
      
      // Järjestä prioriteetin mukaan
      const sortedTypes = Object.entries(scores)
          .sort(([,a], [,b]) => b - a)
          .map(([type]) => type);
      
      // Palauta lista prioriteettijärjestyksessä
      priorities.push(...sortedTypes);
      
      // Jos lista on tyhjä, fallback
      if (priorities.length === 0 && star.shipyardLevel >= 1) {
          priorities.push('Fighter');
      }
      
      // Debug loki (poista tuotannosta)
      //if (Math.random() < 0.05) { // 5% ajasta
//       //    console.log(`[AI-SHIPS] Enemy distribution: F:${(enemyDist.fighterRatio*100).toFixed(0)}% D:${(enemyDist.destroyerRatio*100).toFixed(0)}% C:${(enemyDist.cruiserRatio*100).toFixed(0)}%`);
//       //    console.log(`[AI-SHIPS] Counter weights: F:${counterWeights.Fighter.toFixed(2)} D:${counterWeights.Destroyer.toFixed(2)} C:${counterWeights.Cruiser.toFixed(2)}`);
//       //    console.log(`[AI-SHIPS] Building priority: ${priorities.join(' > ')}`);
      //}
      
      return priorities;
  }


  /* ==================================================================== */
  /*  DEFENSIVE REDEPLOYMENT                                              */
  /* ==================================================================== */
  _defend(myStars) {
      const acts=[];

      myStars.forEach(star=>{
        // Käytä suoraan ships-taulukkoa
        const hostileShips = this.ships.filter(s =>
          s.parentStarId?.toString() === star._id.toString() &&
          s.ownerId?.toString() !== this.aiId &&
          (s.state === 'orbiting' || s.state === 'conquering')
        );
        
        if(!hostileShips.length) return;

        const friendlyShips = this.ships.filter(s =>
          s.parentStarId?.toString() === star._id.toString() &&
          s.ownerId?.toString() === this.aiId &&
          (s.state === 'orbiting' || s.state === 'conquering')
        );

        let gap = starThreatScore(star, hostileShips) - 
                  friendlyShips.reduce((s,sh)=>s+shipPower(sh),0);

        if(gap<=0) return;

        // Etsi lähimmät omat alukset
        const candidates = this.ships.filter(sh =>
          sh.ownerId?.toString() === this.aiId &&
          sh.state === 'orbiting' &&
          sh.parentStarId?.toString() !== star._id.toString()
        ).sort((a,b) => {
          const starA = this._starById(a.parentStarId);
          const starB = this._starById(b.parentStarId);
          if (!starA || !starB) return 0;
          return distance3D(starA.position, star.position) -
                distance3D(starB.position, star.position);
        });

        for(const sh of candidates){
          gap -= shipPower(sh);
          acts.push({ 
            action: 'MOVE_SHIP',
            shipId: sh._id.toString(),
            fromStarId: sh.parentStarId.toString(),
            toStarId: star._id.toString()
          });
          if(gap<=0) break;
        }
      });
      return acts;
  }

  /* ==================================================================== */
  /*  EXPANSION                                                           */
  /* ==================================================================== */
  // Analysoi tarvitaanko joukkojen keräämistä
  _needsFleetGathering(targetStar, availableShips) {
      if (!targetStar.ownerId || targetStar.defenseLevel === 0) return false;
      
      // Simuloi hyökkäys
      const survivors = simulatePDFirstStrike(availableShips, targetStar.defenseLevel);
      const survivorPower = survivors.reduce((sum, s) => sum + shipPower(s), 0);
      
      // Tarvitaan gathering jos:
      // 1. Kaikki kuolisivat TAI
      // 2. Ei jää tarpeeksi voimaa valloittamaan TAI
      // 3. Yli 60% kuolisi
      const MIN_CONQUEST_POWER = 5; // Korotettu
      const casualties = availableShips.length - survivors.length;
      const casualtyRate = casualties / availableShips.length;
      
      return survivors.length === 0 || 
            survivorPower < MIN_CONQUEST_POWER ||
            casualtyRate > 0.6;
  }

  // Etsi paras kokoamispaikka
  _findGatheringPoint(targetStar, myStars) {
      let bestStar = null;
      let bestScore = -Infinity;
      
      myStars.forEach(star => {
          // Älä kerää suoraan kohteeseen
          if (star._id.equals(targetStar._id)) return;
          
          const dist = distance3D(star.position, targetStar.position);
          
          // Pisteet perustuen:
          // - Etäisyys kohteesta (lähemmät parempia)
          // - Onko starlane kohteeseen
          // - Onko telakka (voi rakentaa lisää samalla)
          // - Turvallisuus (ei vihollisilta uhattuna)
          
          let score = 1000 / (dist + 100);
          
          // Bonus jos on starlane kohteeseen
          if ((star.connections || []).some(c => c.toString() === targetStar._id.toString())) {
              score *= 3;
          }
          
          // Bonus jos on telakka
          if (star.shipyardLevel > 0) {
              score *= 1.5;
          }
          
          // Vähennys jos lähellä vihollisia
          const nearbyEnemies = this.stars.filter(s => 
              s.ownerId?.toString() !== this.aiId &&
              distance3D(s.position, star.position) < 150
          ).length;
          score /= (1 + nearbyEnemies * 0.5);
          
          if (score > bestScore) {
              bestScore = score;
              bestStar = star;
          }
      });
      
      return bestStar;
  }
    
  _expandWithGathering(myStars) {
      const acts = [];
      const NONLANE_FACTOR = 1.35, STARLANE_BONUS = 8;
      
      // Jos gathering on käynnissä, jatka sitä
      if (this.gatheringTarget && this.gatheringFor) {
          return this._continueGathering();
      }
      
      // Analysoi potentiaaliset kohteet
      const potentialTargets = this.stars.filter(s => 
          s.ownerId?.toString() !== this.aiId && 
          !s.isBeingConqueredBy
      );
      
      // Kerää kaikki käytettävissä olevat alukset
      const allAvailableShips = [];
      const shipsByLocation = new Map();
      
      myStars.forEach(star => {
          const ships = this.ships.filter(s => 
              s.parentStarId?.toString() === star._id.toString() &&
              s.ownerId?.toString() === this.aiId && 
              s.state === 'orbiting'
          );
          
          if (ships.length > 0) {
              shipsByLocation.set(star._id.toString(), ships);
              allAvailableShips.push(...ships);
          }
      });
      
      // Jos ei tarpeeksi aluksia mihinkään, odota
      if (allAvailableShips.length < 3) return acts;
      
      // Etsi paras kohde ottaen huomioon kaikki käytettävissä olevat alukset
      let bestTarget = null;
      let bestScore = -Infinity;
      let needsGathering = false;
      
      potentialTargets.forEach(target => {
          // Laske etäisyys lähimmästä omasta tähdestä jossa on aluksia
          let minDist = Infinity;
          let nearestOwnStar = null;
          
          shipsByLocation.forEach((ships, starId) => {
              const star = this._starById(starId);
              if (star) {
                  const dist = distance3D(star.position, target.position);
                  if (dist < minDist) {
                      minDist = dist;
                      nearestOwnStar = star;
                  }
              }
          });
          
          if (!nearestOwnStar) return;
          
          // Perus pisteytys
          let score = 1000 / (minDist + 50);
          
          // Bonukset
          if (!target.ownerId) score *= 2; // Neutraali
          if (target.ownerId?.toString() === this.humanId) score *= 1.5; // Ihmispelaaja
          
          // Tarkista voitaisiinko valloittaa KAIKILLA aluksilla
          if (target.defenseLevel > 0) {
              const survivors = simulatePDFirstStrike(allAvailableShips, target.defenseLevel);
              const survivorPower = survivors.reduce((sum, s) => sum + shipPower(s), 0);
              
              if (survivorPower < 5) {
                  score *= 0.1; // Liian kova pähkinä
              } else {
                  // Tarkista tarvitaanko gathering
                  const localShips = shipsByLocation.get(nearestOwnStar._id.toString()) || [];
                  if (this._needsFleetGathering(target, localShips)) {
                      needsGathering = true;
                      score *= 0.8; // Pieni vähennys koska vaatii gathering
                  }
              }
          }
          
          if (score > bestScore) {
              bestScore = score;
              bestTarget = target;
          }
      });
      
      if (!bestTarget) return acts;
      
      // Jos paras kohde vaatii gatheringin
      if (needsGathering && bestTarget.defenseLevel > 0) {
          const gatherPoint = this._findGatheringPoint(bestTarget, myStars);
          if (gatherPoint) {
//               console.log(`[AI] Starting fleet gathering at ${gatherPoint.name} for attack on ${bestTarget.name}`);
              this.gatheringTarget = gatherPoint;
              this.gatheringFor = bestTarget;
              this.gatheringStartTurn = this._turn;
              
              return this._startGathering();
          }
      }
      
      // Muuten hyökkää normaalisti lähimmästä tähdestä
      const nearestStarWithShips = Array.from(shipsByLocation.keys())
          .map(id => this._starById(id))
          .filter(s => s)
          .sort((a, b) => 
              distance3D(a.position, bestTarget.position) - 
              distance3D(b.position, bestTarget.position)
          )[0];
      
      if (nearestStarWithShips) {
          const ships = shipsByLocation.get(nearestStarWithShips._id.toString());
          const shipsToSend = Math.min(this.FLEET_TARGET, ships.length);
          
          ships.slice(0, shipsToSend).forEach(ship => {
              acts.push({ 
                  action: 'MOVE_SHIP',
                  shipId: ship._id.toString(),
                  fromStarId: nearestStarWithShips._id.toString(),
                  toStarId: bestTarget._id.toString()
              });
          });
      }
      
      return acts;
  }

  // Aloita gathering
  _startGathering() {
      const acts = [];
      const gatheringStar = this.gatheringTarget;
      
      // Lähetä aluksia gathering-pisteeseen
      this.stars.forEach(star => {
          if (star.ownerId?.toString() !== this.aiId) return;
          if (star._id.equals(gatheringStar._id)) return; // Ei siirretä samaan tähteen
          
          const ships = this.ships.filter(s => 
              s.parentStarId?.toString() === star._id.toString() &&
              s.ownerId?.toString() === this.aiId && 
              s.state === 'orbiting'
          );
          
          // Jätä muutama alus puolustamaan
          const shipsToKeep = star.shipyardLevel > 0 ? 2 : 1;
          const shipsToSend = ships.slice(0, Math.max(0, ships.length - shipsToKeep));
          
          shipsToSend.forEach(ship => {
              acts.push({ 
                  action: 'MOVE_SHIP',
                  shipId: ship._id.toString(),
                  fromStarId: star._id.toString(),
                  toStarId: gatheringStar._id.toString()
              });
          });
      });
      
      return acts;
  }

  // Jatka gatheringia tai hyökkää
  _continueGathering() {
      const acts = [];
      const gatheringStar = this.gatheringTarget;
      const targetStar = this.gatheringFor;
      
      // Tarkista onko gathering-piste tai kohde vallattu
      if (gatheringStar.ownerId?.toString() !== this.aiId ||
          targetStar.ownerId?.toString() === this.aiId) {
          this.gatheringTarget = null;
          this.gatheringFor = null;
          return acts;
      }
      
      // Laske gathering-pisteessä olevat alukset
      const gatheredShips = this.ships.filter(s => 
          s.parentStarId?.toString() === gatheringStar._id.toString() &&
          s.ownerId?.toString() === this.aiId && 
          s.state === 'orbiting'
      );
      
      // Tarkista onko tarpeeksi aluksia
      const survivors = simulatePDFirstStrike(gatheredShips, targetStar.defenseLevel);
      const survivorPower = survivors.reduce((sum, s) => sum + shipPower(s), 0);
      
      if (survivorPower >= 8) { // Riittävä ylivoima
//           console.log(`[AI] Fleet gathered! Attacking ${targetStar.name} with ${gatheredShips.length} ships`);
          
          // Hyökkää!
          gatheredShips.forEach(ship => {
              acts.push({ 
                  action: 'MOVE_SHIP',
                  shipId: ship._id.toString(),
                  fromStarId: gatheringStar._id.toString(),
                  toStarId: targetStar._id.toString()
              });
          });
          
          // Nollaa gathering
          this.gatheringTarget = null;
          this.gatheringFor = null;
          this.gatheringStartTurn = null;
      } else {
          // Jatka odottamista ja lähetä lisää aluksia
          return this._startGathering();
      }
      
      return acts;
  }

  /* ==================================================================== */
  /*  SCORING HELPERS (build decisions)                                   */
  /* ==================================================================== */
  _effectiveShipyardLevel(star) {
    return star.shipyardLevel + 
        (star.planetaryQueue || []).filter(it => 
            it.type.startsWith('Shipyard')
        ).length;
  }

  _shipyardDiminish() {
      const builtYards = this.stars.filter(s => 
          s.ownerId?.toString() === this.aiId && 
          s.shipyardLevel > 0
      ).length;
      
      if (builtYards <= 1) return 1.0;
      else if (builtYards === 2) return 0.5;
      else if (builtYards === 3) return 0.2;
      return 0.05;
  }

  _effectiveInfraLevel(star){
    return star.infrastructureLevel +
      (star.planetaryQueue||[]).filter(it=>it.type.startsWith('Infrastructure')).length;
  }
  _infraQueued(star){ return (star.planetaryQueue||[]).some(it=>it.type.startsWith('Infrastructure')); }
  _yardQueued (star){ return (star.planetaryQueue||[]).some(it=>it.type.startsWith('Shipyard')); }

  _walletFor(type){
    if(type==='Mine') return this.eco;
    if(type==='Defense Upgrade'||type.startsWith('Infrastructure')||type.startsWith('Shipyard'))
      return this.tech;
    return this.war;
  }

  _infraCost(lvl){
    if(lvl===0) return {...STRUCT_COST['Shipyard Lvl 1'], nextLevel:1};
    const b=STRUCT_COST['Shipyard Lvl 1'];
    const f=1+0.30*lvl;
    return { nextLevel:lvl+1,
             credits :Math.round(b.credits *f),
             minerals:Math.round(b.minerals*f),
             time    :Math.round(b.time    *f) };
  }
  _shipyardCost(lvl){ return this._infraCost(lvl); }

  _hasMineRoom(star){
    const lim=this.infra[star.infrastructureLevel].maxMines;
    return star.mines + this._queuedCount(star,'Mine') < lim;
  }
  _mineRoomScale(star) {
      const lim   = this.infra[star.infrastructureLevel].maxMines;
      const built = star.mines + this._queuedCount(star, 'Mine');
      const free  = lim - built;

      // 1. ei enää slotteja → älä pisteytä
      if (free <= 0) return 0;

      // 2. nollasta aloittaminen
      if (built === 0) {
          // hae omat tähdet (tai anna listana parametrina jos haluat välttää filter-kutsun)
          const myStars = this.stars.filter(
              s => s.ownerId?.toString() === this.aiId
          );

          // jos JOLLAIN muulla tähdellä on vielä kaivos-slotteja → paino 0
          const otherHasRoom = myStars.some(
              s => s !== star && this._hasMineRoom(s)
          );
          return otherHasRoom ? 0 : 0.25;  // “kylvä” ensimmäinen kaivos
      }

      // 3. tähti on jo aloitettu → laske asteikko
      return Math.min(1, free / 5 + 0.20); // 5 slot → 0.20, 4 slot → 0.40 …
  }

  /* ---- missing earlier → now back ---- */
_scoreBuild(star, type) {
    const infraLvl = this._effectiveInfraLevel(star);
    const yardLvl = this._effectiveShipyardLevel(star);
    const lim = this.infra[infraLvl];
    
    // Efektiiviset määrät (valmis + jonossa)
    const e = {
        mines: star.mines + this._queuedCount(star, 'Mine'),
        defense: star.defenseLevel + this._queuedCount(star, 'Defense Upgrade'),
        yard: yardLvl
    };

    // Perustarkistukset
    if (type === 'Mine' && e.mines >= lim.maxMines) return 0;
    if (type === 'Defense Upgrade' && e.defense >= lim.maxDefense) return 0;
    if (type.startsWith('Shipyard') && e.yard >= lim.maxShipyard) return 0;

    let score = 0;

    if (type === 'Mine') {
        const ratio = e.mines / Math.max(1, lim.maxMines);
        score = WEIGHTS.Mine * (1 - ratio) * 1.5;
        
    } else if (type.startsWith('Infrastructure')) {
        // Älä kehitä tyhjää planeettaa
        const hasMine = star.mines + this._queuedCount(star, 'Mine') > 0;
        const hasYard = star.shipyardLevel > 0 || this._yardQueued(star);
        if (!hasMine && !hasYard) return 0;

        score = WEIGHTS.Infrastructure * (4 - star.infrastructureLevel);
        if (star.shipyardLevel > 0) score *= 1.8;
        if (hasMine) score *= 1.8;

        // VAIMENNUS: jos infra on edellä telakkaa
        if (star.infrastructureLevel >= 2 && star.shipyardLevel < 2) {
            score *= 0.1;
        } else if (star.infrastructureLevel >= 3 && star.shipyardLevel < 3) {
            score *= 0.1;
        }
        
    } else if (type === 'Shipyard' || type.startsWith('Shipyard Lvl')) {
        // A) Uusi telakka
        if (star.shipyardLevel === 0 && !this._yardQueued(star)) {
            const dim = this._shipyardDiminish();
            score = WEIGHTS.Shipyard * dim;
            
        // B) Telakan päivitys - EI diminishing returns!
        } else {
            score = WEIGHTS['Shipyard Upgrade'] * (3 - star.shipyardLevel);
            
            // Extra boost lvl 2->3 (avataan Cruiserit)
            if (star.shipyardLevel === 2) score *= 3;
        }
        
        // Lisäbonus: korkea infra + matala telakka
        if (star.infrastructureLevel >= 3 && star.shipyardLevel < 2) {
            score *= 2.5;
        }
        
    } else if (type === 'Defense Upgrade') {
        const yardFuture = this._effectiveShipyardLevel(star);
        const worthDefending = yardFuture > 0 || star.infrastructureLevel >= 2;
        if (!worthDefending) return 0;

        const wanted = this._wantedDefense(star, yardFuture);
        const queued = this._queuedCount(star, 'Defense Upgrade');
        const have = star.defenseLevel;
        const missing = Math.max(0, wanted - (have + queued));
        if (missing === 0) return 0;

        let base = WEIGHTS['Defense Upgrade'] * missing;
        
        // Arvokertoimet
        if (star.infrastructureLevel >= 4) base *= 4.0;
        else if (star.infrastructureLevel === 3) base *= 3.0;
        else if (yardFuture > 0) base *= 2.0;
        
        score = base;
    }

    // Yleiset bonukset
    if (!star.isHomeworld) score *= 1.3;
    if ((star.connections || []).length > 2) score *= 1.2;
    if (star.shipyardLevel === 0 && !type.startsWith('Shipyard')) score *= 0.1;

    return score;
}

  _wantedDefense(star, futureYard){
    const lvl=star.infrastructureLevel;
    if(lvl<2)  return futureYard>0 ? 1 : 0;
    if(lvl===2) return 2;
    if(lvl===3) return futureYard>0 ? 3 : 2;
    return futureYard>0 ? 6 : 4;
  }

  _queuedCount(star,type){ return (star.planetaryQueue||[]).filter(it=>it.type===type).length; }

  /* ==================================================================== */
  /*  MISC UTILITIES                                                       */
  /* ==================================================================== */
  _ship(id){ return this.ships.find(s=>s.id===id); }
  _starById(id){ return this.stars.find(s=>s.id===id); }

  _countOwnedMines(){
    return this.stars
      .filter(s=>s.ownerId?.toString()===this.aiId)
      .reduce((sum,st)=>sum+st.mines+this._queuedCount(st,'Mine'),0);
  }

  _deposit(split){
    this.eco.credits  += split.eco.credits;   this.eco.minerals  += split.eco.minerals;
    this.tech.credits += split.tech.credits;  this.tech.minerals += split.tech.minerals;
    this.war.credits  += split.war.credits;   this.war.minerals  += split.war.minerals;
  }
}

module.exports = AIController;
