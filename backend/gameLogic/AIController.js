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
  }

  /* -------------------------------------------------------------------- */
  /*  PUBLIC – one call per game tick                                     */
  /* -------------------------------------------------------------------- */
  runTurn(turnNumber, income = { credits:0, minerals:0 }) {
    /* 1) päivitä kukkarot */
    const totalMines = this._countOwnedMines();
    this._deposit(splitBudget(income, totalMines));

    /* 2) jos tukikohtaa ei ole → pass */
    const myStars = this.stars.filter(s => s.ownerId?.toString() === this.aiId);
    if (!myStars.length) return [{ action:'NO_BASE' }];

    const totalShips = this.ships.filter(s => s.ownerId?.toString() === this.aiId).length;

    /* 3) päätökset */
    const acts = [];

    const sBuild = this._buildOneStructure(myStars, totalMines, totalShips);
    if (sBuild) acts.push(sBuild);

    acts.push(...this._buildShips(myStars, totalMines, totalShips));
    acts.push(...this._defend(myStars));
    acts.push(...this._expand(myStars));

    this.prevRes.credits = this.res.credits;
    this.prevRes.minerals = this.res.minerals;

    // Lisätään jokaiseen actioniin lähettäjän ID
    acts.forEach(act => {
        act.playerId = this.aiId;
    });

    return acts;
  }

  /* ==================================================================== */
  /*  PLANETARY BUILDING LOGIC                                            */
  /* ==================================================================== */
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
    /* ——— 1. Rajat & varmistukset ——— */
    const infraLvl = this._effectiveInfraLevel(star);           // valmis + jonossa
    const limits   = this.infra[infraLvl]                       // varovainen fallback
                  ?? this.infra[Math.max(...Object.keys(this.infra))];

    const eWeights = earlyWeights(totalMines) || {};
    const push = (type, cost, mult = 1) => {
      const w = eWeights[type] ?? eWeights.Infrastructure ?? 1;
      bucket.push({
        star, type, cost,
        score: this._scoreBuild(star, type) * w * mult
      });
    };

    /* ——— 2. Infrastructure (max 5) ——— */
    if (star.infrastructureLevel < 5 && !this._infraQueued(star)) {
      const c = this._infraCost(star.infrastructureLevel);
      push(`Infrastructure Lvl ${c.nextLevel}`, c);
    }

    /* ——— 3. Shipyard ——— */
    const AI_YARD_CAP = 3;                       // AI hard-cap
    const yardQueued  = this._yardQueued(star);

    if (star.shipyardLevel === 0 && !yardQueued) {
      // uusi telakka
      push("Shipyard", STRUCT_COST["Shipyard Lvl 1"]);

    } else if (
      star.shipyardLevel < Math.min(limits.maxShipyard, AI_YARD_CAP) &&
      !yardQueued
    ) {
      // päivitys (mutta AI maks. lvl 3)
      const c = this._shipyardCost(star.shipyardLevel);
      push(`Shipyard Lvl ${c.nextLevel}`, c);
    }

    /* ——— 4. Mine ——— */
    if (this._hasMineRoom(star)) {
      push("Mine", STRUCT_COST.Mine, this._mineRoomScale(star));
    }

    /* ——— 5. Planetary Defense ——— */
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

  _shipPriorities(star, flt) {
    const target = { Fighter:.3, Destroyer:.5, Cruiser:.2 };

    const enemies=[...new Set(this.ships.map(s=>s.ownerId?.toString()))]
        .filter(o=>o!==this.aiId);

    let eD=0,eTot=0,anyPD=false;
    enemies.forEach(eid=>{
      const ss=this.ships.filter(s=>s.ownerId?.toString()===eid);
      eD  +=ss.filter(s=>s.type==='Destroyer').length;
      eTot+=ss.length;
      if(!anyPD) anyPD=this.stars.some(st=>st.ownerId?.toString()===eid&&st.defenseLevel>0);
    });
    const manyD=eTot && eD/eTot>.10;

    const p=[];
    if(star.shipyardLevel>=3&&(manyD||anyPD)) p.push('Cruiser');
    if(star.shipyardLevel>=3&&(flt.total===0||flt.cruisers/flt.total<target.Cruiser)&&!p.includes('Cruiser')) p.push('Cruiser');
    if(star.shipyardLevel>=2&&(flt.total===0||flt.destroyers/flt.total<target.Destroyer)) p.push('Destroyer');
    if(flt.total===0||flt.fighters/flt.total<target.Fighter) p.push('Fighter');
    if(!p.includes('Destroyer')&&star.shipyardLevel>=2) p.push('Destroyer');
    if(!p.includes('Fighter')) p.push('Fighter');
    return p;
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
  _expand(myStars){
      const acts=[];
      const NONLANE_FACTOR=1.35, STARLANE_BONUS=8;

      myStars.forEach(star=>{
        // MUUTOS: Käytä suoraan ships-taulukkoa
        const readyShips = this.ships.filter(s => 
          s.parentStarId?.toString() === star._id.toString() &&
          s.ownerId?.toString() === this.aiId && 
          s.state === 'orbiting'
        );
        
        // console.log(`[AI] ${readyShips.length} ships ready at ${star.name}`);
        
        if(readyShips.length < 1) return; // Debug: 1 alus riittää

        let target=null,best=-Infinity;
        this.stars.filter(s=>s.ownerId?.toString()!==this.aiId && !s.isBeingConqueredBy)
          .forEach(tg=>{
            // Korjaa myös connections-vertailu
            const lane = (star.connections || []).some(c => c.toString() === tg._id.toString());
            const dist = distance3D(star.position, tg.position);
            let sc = 1000/(dist*(lane?1:NONLANE_FACTOR)+25);
            if(lane) sc += STARLANE_BONUS;
            sc += !tg.ownerId ? 10 : (tg.ownerId?.toString()===this.humanId ? 3 : 5);
            
 
            
            if(sc > best) { best=sc; target=tg; }
          });
          
        if(!target) {
          console.log(`[AI] No target found from ${star.name}`);
          return;
        }

        const firstStrike = target.defenseLevel * 3;
        const fighters = readyShips.filter(s => s.type === 'Fighter').length;
        if(fighters && firstStrike >= readyShips.length) {
          console.log(`[AI] Skipping attack - PD would destroy all ships`);
          return;
        }

        // MUUTOS: Käytä readyShips suoraan
        readyShips.slice(0, Math.min(this.FLEET_TARGET, readyShips.length))
          .forEach(ship => {
            acts.push({ 
              action: 'MOVE_SHIP',
              shipId: ship._id.toString(),
              fromStarId: star._id.toString(),
              toStarId: target._id.toString()
            });
          });
      });
      return acts;
  }

  /* ==================================================================== */
  /*  SCORING HELPERS (build decisions)                                   */
  /* ==================================================================== */
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
  _mineRoomScale(star){
    const lim=this.infra[star.infrastructureLevel].maxMines;
    const built=star.mines + this._queuedCount(star,'Mine');
    const free =lim-built;
    if(built===0||free<=0) return 0;
    return Math.min(1, free/5 + 0.20);
  }

  /* ---- missing earlier → now back ---- */
  _scoreBuild(star, type){
    const infraLvl=this._effectiveInfraLevel(star);
    const lim=this.infra[infraLvl];
    const e={
      mines   : star.mines + this._queuedCount(star,'Mine'),
      defense : star.defenseLevel + this._queuedCount(star,'Defense Upgrade'),
      yard    : star.shipyardLevel +
                this._queuedCount(star,'Shipyard Lvl')
    };

    if(type==='Mine'            && e.mines   >= lim.maxMines   ) return 0;
    if(type==='Defense Upgrade' && e.defense >= lim.maxDefense ) return 0;
    if(type.startsWith('Shipyard') && e.yard >= lim.maxShipyard) return 0;

    let score=0;

    if(type==='Mine'){
      score=WEIGHTS.Mine * (1 - e.mines/lim.maxMines) * 1.5;

    }else if(type.startsWith('Infrastructure')){
      const hasMine=e.mines>0, hasYard=e.yard>0;
      if(!hasMine&&!hasYard) return 0;
      score=WEIGHTS.Infrastructure*(4-star.infrastructureLevel);
      if(hasYard) score*=1.8;
      if(hasMine) score*=1.8;
      if(star.infrastructureLevel>=2 && star.shipyardLevel<2) score*=0.1;
      else if(star.infrastructureLevel>=3 && star.shipyardLevel<3) score*=0.1;

    }else if(type==='Shipyard'||type.startsWith('Shipyard Lvl')){
      score = type==='Shipyard'
            ? WEIGHTS.Shipyard
            : WEIGHTS['Shipyard Upgrade']*(3-star.shipyardLevel);
      if(star.infrastructureLevel>=3 && star.shipyardLevel<2) score*=2.5;

    }else if(type==='Defense Upgrade'){
      const wanted=this._wantedDefense(star, e.yard);
      const missing=Math.max(0, wanted - e.defense);
      if(!missing) return 0;
      score=WEIGHTS['Defense Upgrade']*missing;
      if(star.infrastructureLevel>=4) score*=4;
      else if(star.infrastructureLevel===3) score*=3;
      else if(e.yard>0) score*=2;
    }

    if(!star.isHomeworld) score*=1.3;
    if((star.connections||[]).length>2) score*=1.2;
    if(star.shipyardLevel===0 && !type.startsWith('Shipyard')) score*=0.1;
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
