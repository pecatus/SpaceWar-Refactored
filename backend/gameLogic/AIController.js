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
// Yksinkertainen apufunktio uniikkien tunnisteiden (UUID v4) luomiseen.
const uuid = () => randomUUID();

/**
 * LASKEE MITÄ: Kahden 3D-pisteen välinen euklidinen etäisyys.
 * KÄYTETÄÄN MIHIN: Yleinen apufunktio, jota AI käyttää jatkuvasti arvioidakseen etäisyyksiä
 * tähtien välillä, kun se päättää laajentumiskohteista tai puolustukseen lähetettävistä joukoista.
 *
 * @param {{x: number, y: number, z: number}} a - Ensimmäinen piste objekti.
 * @param {{x: number, y: number, z: number}} b - Toinen piste objekti.
 * @returns {number} Pisteiden välinen numeerinen etäisyys.
 */
function distance3D(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

/**
 * LASKEE MITÄ: Palauttaa alukselle numeerisen "taisteluvoiman" sen tyypin perusteella.
 * KÄYTETÄÄN MIHIN: Yksinkertainen heuristiikka, jonka avulla AI voi nopeasti arvioida
 * yksittäisten alusten ja laivastojen suhteellista voimaa ilman täyttä taistelusimulaatiota.
 *
 * @param {{type: string}} ship - Alusobjekti, jolla on `type`-ominaisuus.
 * @returns {number} Aluksen laskennallinen taisteluvoima (1-3).
 */
function shipPower(ship) {
  return ship.type === 'Fighter'   ? 1 :
         ship.type === 'Destroyer' ? 2 :
         ship.type === 'Cruiser'   ? 3 : 0;
}

/**
 * LASKEE MITÄ: Simuloi planeetan puolustuksen (Planetary Defense, PD) ensi-iskun
 * hyökkäävää laivastoa vastaan ja laskee jäljelle jääneiden alusten yhteenlasketun taisteluvoiman.
 * KÄYTETÄN MIHIN: Kriittinen riskianalyysifunktio AI:lle. Sen avulla AI voi arvioida,
 * kuinka suuri osa sen laivastosta tuhoutuisi heti hyökkäyksen alussa. Tulos auttaa
 * päättämään, onko hyökkäys kannattava vai pitääkö kerätä lisää joukkoja.
 *
 * @param {object} star - Puolustava tähti, jolla on `defenseLevel`-ominaisuus.
 * @param {Array<object>} hostileShips - Taulukko hyökkäävistä alusobjekteista.
 * @returns {number} Selviytyneen laivaston yhteenlaskettu `shipPower`-arvo.
 */
function starThreatScore(star, hostileShips) {
  const pdShots = star.defenseLevel * 3;
  const hostile = [...hostileShips].sort((a, b) => shipPower(b) - shipPower(a));
  for (let i = 0; i < pdShots && hostile.length; i++) hostile.shift();
  return hostile.reduce((sum, sh) => sum + shipPower(sh), 0);
}

/* ---------------------------------------------------------------------------
 *  1.  Static cost / weight tables
 * ------------------------------------------------------------------------ */
/**
 * MITÄ: Määrittää planetaaristen rakennusten ja päivitysten perushinnat ja rakennusajat.
 * MIKSI: Keskuspaikka, josta AI tarkistaa eri rakennusten kustannukset
 * päätöksentekoa varten (onko varaa, kannattaako aloittaa).
 */
const STRUCT_COST = {
  'Mine'            : { credits:  75, minerals:  25, time: 10 },
  'Defense Upgrade' : { credits: 100, minerals:  50, time: 15 },
  'Shipyard Lvl 1'  : { credits: 150, minerals: 100, time: 20 },
  'Shipyard Lvl 2'  : { credits: 250, minerals: 200, time: 40 },
  'Shipyard Lvl 3'  : { credits: 325, minerals: 260, time: 60 }
};

/**
 * MITÄ: Määrittää alusten rakennuskustannukset, -ajat ja vaaditun telakkatason.
 * FORMAATTI: [krediitit, mineraalit, rakennusaika sekunteina, vaadittu telakkataso]
 * MIKSI: AI käyttää tätä tarkistaakseen, voiko se rakentaa tiettyä alusta tietyllä telakalla
 * ja onko sillä varaa siihen.
 */
const SHIP_COST = {
  Fighter             : [ 50,  25, 10, 1 ],
  Destroyer           : [100,  50, 25, 2 ],
  Cruiser             : [150,  75, 45, 3 ],
  'Slipstream Frigate': [120, 180, 55, 4 ]
};

/**
 * MITÄ: Suhteelliset painoarvot eri rakennusvaihtoehdoille.
 * MIKSI: Nämä ovat AI:n päätöksenteon ytimessä. Kun AI laskee eri rakennusvaihtoehdoille
 * "pisteitä", se kertoo peruspisteet näillä painoarvoilla. Esimerkiksi
 * 'Infrastructure' on painotettu tärkeämmäksi (1.3) kuin 'Mine' (1.0).
 */
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

/**
 * MITÄ: Listat merkkijonoista, jotka tunnistavat "kalliit" kohteet.
 * MIKSI: AI käyttää näitä tunnistaakseen, mitkä rakennukset ja alukset vaativat
 * säästämistä. Tämä liittyy suoraan WAIT_THRESHOLD-vakioon.
 */
const EXPENSIVE_PLANETARY_TAGS = ['Shipyard', 'Infrastructure Lvl', 'Defense Upgrade'];
const EXPENSIVE_SHIP_TAGS      = ['Cruiser', 'Destroyer'];

/**
 * MITÄ: Prosentuaalinen kynnysarvo (60%).
 * MIKSI: Määrittää, milloin AI "sitoutuu" säästämään kalliimpaan kohteeseen. Jos AI:lla on
 * vähintään 60% kalliin päivityksen hinnasta kasassa, se ei kuluta rahojaan halvempiin
 * vaihtoehtoihin, vaan odottaa kunnes rahat ovat koossa.
 */
const WAIT_THRESHOLD           = 0.60;      

/* ---------------------------------------------------------------------------
 *  2.  Economy helpers
 * ------------------------------------------------------------------------ */
/**
 * MÄÄRITTÄÄ MITÄ: Palauttaa prosenttiosuudet, joihin tekoälyn tulot jaetaan
 * talouden (eco), teknologian (tech) ja sodankäynnin (war) "lompakoiden" kesken.
 * MIKSI: Tämä on AI:n dynaaminen talousstrategia. Pelin eri vaiheissa
 * (mitattuna kaivosten kokonaismäärällä) AI painottaa eri asioita.
 * Esimerkiksi alussa se panostaa sotaan ja talouteen, kun taas keskipelissä
 * teknologiaan (infra/telakat) ja loppupelissä taas raskaasti sodankäyntiin.
 *
 * @param {number} totalMines - AI:n omistamien kaivosten kokonaismäärä.
 * @returns {{eco: number, tech: number, war: number}} Objekti, joka sisältää jakosuhteet.
 */
function budgetShares(totalMines) {
  if (totalMines <  5) return { eco:0.40, tech:0.10, war:0.50 };
  if (totalMines < 15) return { eco:0.40, tech:0.10, war:0.50 };
  if (totalMines < 30) return { eco:0.50, tech:0.20, war:0.30 };
  if (totalMines < 45) return { eco:0.20, tech:0.45, war:0.35 };
  if (totalMines < 60) return { eco:0.10, tech:0.35, war:0.55 };
  return                    { eco:0.05, tech:0.25, war:0.70 };
}

/**
 * LASKEE MITÄ: Jakaa annetun tulo-objektin kolmeen erilliseen budjettilompakkoon
 * käyttäen `budgetShares`-funktion määrittämiä suhteita.
 * KÄYTETÄÄN MIHIN: Tämä on käytännön toteutus, joka muuttaa prosentit konkreettisiksi
 * krediitti- ja mineraalimääriksi kutakin lompakkoa varten.
 *
 * @param {{credits: number, minerals: number}} resIncome - Kierroksen aikana saadut tulot.
 * @param {number} totalMines - AI:n kaivosten kokonaismäärä, joka välitetään `budgetShares`-funktiolle.
 * @returns {{eco: object, tech: object, war: object}} Objekti, joka sisältää kolme lompakkoa.
 */
function splitBudget(resIncome, totalMines) {
  const s = budgetShares(totalMines);
  return {
    eco : { credits: resIncome.credits*s.eco,  minerals: resIncome.minerals*s.eco  },
    tech: { credits: resIncome.credits*s.tech, minerals: resIncome.minerals*s.tech },
    war : { credits: resIncome.credits*s.war,  minerals: resIncome.minerals*s.war  }
  };
}

/**
 * TARKISTAA MITÄ: Onko tietyssä lompakossa varaa tiettyyn kustannukseen.
 * KÄYTETÄÄN MIHIN: Yleinen apufunktio, jota AI käyttää jatkuvasti ennen ostopäätöstä.
 *
 * @param {{credits: number, minerals: number}} cost - Tarkistettava kustannus.
 * @param {{credits: number, minerals: number}} wallet - Lompakko, josta varat tarkistetaan.
 * @returns {boolean} Tosi, jos varat riittävät, muuten epätosi.
 */
function affordable(cost, wallet) {
  return wallet.credits >= cost.credits && wallet.minerals >= cost.minerals;
}

/**
 * TOTEUTTAA MITÄ: Vähentää kustannuksen sekä tietystä lompakosta että pelaajan globaalista
 * resurssimäärästä.
 * MIKSI: Varmistaa, että kun AI tekee ostoksen yhdestä lompakosta (esim. `war`),
 * vastaava summa poistuu myös pelaajan kokonaissaldosta, pitäen tilan synkassa.
 *
 * @param {object} cost - Vähennettävä kustannus { credits, minerals }.
 * @param {object} wallet - Lompakko, josta kustannus vähennetään { credits, minerals }.
 * @param {object} globalRes - Pelaajan globaali resurssiobjekti { credits, minerals }.
 */
function pay(cost, wallet, globalRes) {
  wallet.credits  -= cost.credits;
  wallet.minerals -= cost.minerals;
  globalRes.credits  -= cost.credits;
  globalRes.minerals -= cost.minerals;
}

/* ---------------------------------------------------------------------------
 *  3.  Early-game weighting lookup
 * ------------------------------------------------------------------------ */
/**
 * MITÄ: Määrittää ennalta asetetut strategiset painoarvot pelin alkuvaiheille.
 * MIKSI: Tämä on AI:n "avauspeli". Sen sijaan, että AI laskisi monimutkaisia
 * päätöksiä alussa, se noudattaa tätä yksinkertaista ohjeistusta. Esimerkiksi
 * kun kaivoksia on alle 5, se keskittyy 70% resursseistaan kaivoksiin ja
 * 30% Fightereiden rakentamiseen. Tämä takaa AI:lle aina vakaan ja
 * ennustettavan alun. Muutoin AI:n muut painoarvot johtavat kaivosten laiminlyöntiin
 * jolloin koko AI:n ekonomia hajoaa alkutekijöihinsä, kun se rakentaa aluksia koko 
 * rahalla ja yrittää pärjätä 10-15 fighterin turvin koko loppupelin ajan. 
 */
const EARLY_STEPS = [
  { mines:20, weights:{Mine:.40, Fighter:.50, Infrastructure:.10, Shipyard:0} },
  { mines:15, weights:{Mine:.50, Fighter:.50, Infrastructure:0,   Shipyard:0} },
  { mines:10, weights:{Mine:.60, Fighter:.40, Infrastructure:0,   Shipyard:0} },
  { mines: 5, weights:{Mine:.70, Fighter:.30, Infrastructure:0,   Shipyard:0} },
  { mines: 0, weights:{Mine:1.00, Fighter:0,   Infrastructure:0,  Shipyard:0} }
];

/**
 * HAKEE MITÄ: Palauttaa nykyiseen pelitilanteeseen (kaivosten määrä) sopivan
 * alkupelin strategiaobjektin `EARLY_STEPS`-taulukosta.
 * KÄYTETÄÄN MIHIN: Apufunktio, joka antaa AI:n päätöksentekofunktioille oikeat
 * painoarvot käytettäväksi pelin alussa. Kun kaivoksia on 25 tai enemmän,
 * funktio palauttaa `null`, ja AI siirtyy käyttämään monimutkaisempaa,
 * dynaamista päätöksentekoa.
 *
 * @param {number} totalMines - AI:n kaivosten kokonaismäärä.
 * @returns {object | null} Painoarvo-objekti tai null, jos alkupeli on ohi.
 */
function earlyWeights(totalMines) {
  if (totalMines >= 25) return null;
  for (const step of EARLY_STEPS)
    if (totalMines >= step.mines) return step.weights;
  return null;
}

/**
 * SIMULOI MITÄ: Laskee, mitkä alukset hyökkäävästä laivastosta selviytyisivät
 * planetaarisen puolustuksen (PD) ensi-iskusta.
 * KÄYTETÄÄN MIHIN: Erittäin tärkeä riskianalyysityökalu AI:lle. Ennen kuin AI
 * lähettää laivastonsa hyökkäykseen, se kutsuu tätä funktiota arvioidakseen
 * mahdollisia tappioita. Jos simulaatio näyttää, että tappiot ovat liian suuret
 * (esim. kaikki alukset tuhoutuvat), AI voi peruuttaa hyökkäyksen ja päättää
 * sen sijaan kerätä lisää joukkoja.
 *
 * @param {Array<object>} ships - Hyökkäävä laivasto. Jokainen alusobjekti tarvitsee `type`- ja `hp`-ominaisuudet.
 * @param {number} defenseLevel - Puolustavan planeetan PD-taso.
 * @returns {Array<object>} Uusi taulukko, joka sisältää ne alusobjektit, jotka selvisivät simulaatiosta.
 */
function simulatePDFirstStrike(ships, defenseLevel) {
    if (defenseLevel === 0) {
        return ships; // Ei puolustusta, ei tappioita.
    }

    const shots = defenseLevel * 3; // PD ampuu aina kolme laukausta "vuorossa"
    const PD_DAMAGE_PER_SHOT = 2; // Oletusvahinko per laukaus
    let totalDamagePool = shots * PD_DAMAGE_PER_SHOT;

    // Luodaan kopio laivastosta, jotta emme muokkaa alkuperäistä peli-statea.
    const fleetCopy = ships.map(ship => ({ 
        ...ship, 
        simHp: ship.hp || 1 // Varmistetaan, että hp on olemassa simulaatiota varten.
    }));

    // Kohdinnuslogiikka: PD ampuu heikoimpia ensin (Fighter -> Destroyer -> Cruiser)
    const targetPriority = ['Fighter', 'Destroyer', 'Cruiser'];
    
    for (const shipType of targetPriority) {
        // Käydään läpi kaikki tämän tyypin alukset ja jaetaan niille vahinkoa.
        for (const ship of fleetCopy) {
            if (ship.type === shipType && totalDamagePool > 0) {
                const damageNeeded = ship.simHp;
                
                // Jos vahinkoa on tarpeeksi tuhoamaan alus
                if (totalDamagePool >= damageNeeded) {
                    totalDamagePool -= damageNeeded;
                    ship.simHp = 0; // Merkitään tuhotuksi simulaatiossa.
                } else {
                    // Ei tarpeeksi vahinkoa koko aluksen tuhoamiseen,
                    // mutta kaikki jäljellä oleva vahinko kohdistetaan siihen.
                    ship.simHp -= totalDamagePool;
                    totalDamagePool = 0;
                }
            }
            if (totalDamagePool <= 0) break; // Kaikki PD:n laukaukset käytetty.
        }
        if (totalDamagePool <= 0) break;
    }

    // Palautetaan vain ne alukset, joiden simuloitu HP on edelleen yli nollan.
    return fleetCopy.filter(ship => ship.simHp > 0);
}

/* ---------------------------------------------------------------------------
 *  4.  AIController class
 * ------------------------------------------------------------------------ */
class AIController {
   /**
   * Luo ja alustaa uuden tekoäly-ohjaimen instanssin yhdelle pelaajalle.
   *
   * MITÄ TEKEE:
   * 1. Tallentaa viittaukset jaettuihin pelitila-taulukoihin (tähdet, alukset).
   * 2. Alustaa staattiset konfiguraatio- ja pelisääntöparametrit.
   * 3. Jakaa AI:n aloitusresurssit kolmeen erilliseen "lompakkoon" (eco, tech, war),
   * jotta se voi priorisoida eri osa-alueiden kehitystä itsenäisesti.
   * 4. Alustaa sisäiset tilamuuttujat, kuten vuorolaskurin ja strategiset tilat.
   *
   * @param {string} aiId - Tekoälypelaajan uniikki tunniste (yleensä MongoDB ObjectId).
   * @param {object} gameState - Viittaus GameManagerin live-pelitilaan. Sisältää { resources, stars, ships }.
   * @param {object} config - Pelin konfiguraatio-objekti. Sisältää { infraLimits, playerId, speeds, fleetTarget }.
   */
  constructor(aiId, gameState, config) {
    /* === 1. Viittaukset jaettuun pelitilaan === */
    // Nämä ovat suoria viittauksia GameManagerin state-objekteihin, eivät kopioita.
    // Tämä tarkoittaa, että kun GameManager päivittää esim. alusten listaa,
    // muutos näkyy automaattisesti myös tässä AI-instanssissa.
    this.aiId  = aiId;
    this.res   = gameState.resources;   // AI:n päätili (viittaus dokkarin kenttään)
    this.stars = gameState.stars;       // Taulukko kaikista pelin tähdistä
    this.ships = gameState.ships;       // Taulukko kaikista pelin aluksista

    /* === 2. Staattiset konfiguraatiot ja pelisäännöt === */
    // Nämä arvot eivät muutu pelin aikana.
    this.infra        = config.infraLimits;
    this.humanId      = config.playerId;    // Ihmispelaajan ID, käytetään kohteiden priorisointiin
    this.speeds       = config.speeds || {  
        fast: 60,
        slow: 6,
        fighterSlow: 12
    };
    this.FLEET_TARGET = config.fleetTarget || 8;    // Tyypillinen laivaston hyökkäyskoko

    /* === 3. Aloitusbudjetin alustus ja jako === */
    // a) Ota talteen nykyinen resurssitilanne, jotta voidaan laskea seuraavan kierroksen nettotulot.
    this.prevRes = { ...this.res };

    // b) Jaa aloituspääoma kolmeen strategiseen lompakkoon.
    const minesAtStart = this._countOwnedMines();      // montako kaivosta lähtötilassa
    const seed         = splitBudget(this.res, minesAtStart);
    this.eco  = { ...seed.eco  };      // Kaivosten rakentaminen rahoitetaan tästä.
    this.tech = { ...seed.tech };      // Infrastruktuuri- ja telakkapäivitykset rahoitetaan tästä.
    this.war  = { ...seed.war  };      // Alukset ja puolustusrakennelmat rahoitetaan tästä.

    /* === 4. Sisäinen kirjanpito === */
    this.turn = 0;  // Laskee, monennellako kierroksella AI on menossa.

    /* === 5. Strategisten tilojen alustus === */
    // Nämä muuttujat ohjaavat monimutkaisempia, monen vuoron yli kestäviä strategioita,
    // kuten laivaston keräämistä yhteen paikkaan ennen suurhyökkäystä.
    this.gatheringTarget = null;     // Tähti, johon joukkoja kerätään.
    this.gatheringFor = null;        // Lopullinen hyökkäyskohde, jota varten kerätään.
    this.gatheringStartTurn = null;  // Milloin kerääminen aloitettiin (timeoutia varten).
    this.GATHERING_TIMEOUT = 120;    // Maksimimäärä kierroksia, jotka AI jaksaa kerätä joukkoja.
  }

  /* -------------------------------------------------------------------- */
  /*  PUBLIC – one call per game tick                                     */
  /* -------------------------------------------------------------------- */
   /**
   * SUORITTAA MITÄ: Ajaa tekoälyn yhden täyden päätöksentekokierroksen (tick).
   * KÄYTETÄÄN MIHIN: Tämä on AIControllerin päämetodi, jota GameManager kutsuu säännöllisin
   * väliajoin. Se on AI:n "aivojen" pääsilmukka.
   *
   * TOIMINTALOGIIKKA:
   * 1. Päivittää talouden (jakaa kierroksen tulot strategisiin lompakoihin).
   * 2. Tarkistaa ja hallitsee erikoistilanteita (esim. kaikki tukikohdat menetetty, joukkojen kerääminen aikakatkaistu).
   * 3. Noudattaa yksinkertaistettuja "avauspelistrategioita" pelin alussa (Early Game Guards).
   * 4. Keskipelin ja loppupelin aikana kutsuu erillisiä alifunktioita rakentamisen, puolustamisen ja laajentumisen hallintaan.
   *
   * @param {number} turnNumber - Pelin nykyinen kierrosnumero (tick-laskuri), käytetään mm. timeoutien laskentaan.
   * @param {object} [income={...}] - Vapaaehtoinen tulot-objekti. Jos ei annettu, lasketaan automaattisesti.
   * @returns {Array<object>} Taulukko toiminto-objekteja, jotka GameManager suorittaa (esim. { action: 'MOVE_SHIP', ... }).
   */
  runTurn(turnNumber, income = { credits:0, minerals:0 }) {
      // Varmistus: Jos tuloja ei annettu, laske ne edellisen ja nykyisen saldon erotuksena.
      if (income.credits === 0 && income.minerals === 0) {
          income = {
              credits: Math.max(0, this.res.credits - this.prevRes.credits),
              minerals: Math.max(0, this.res.minerals - this.prevRes.minerals)
          };
      }
      
      // VAIHE 1: Päivitä talous ja kerää tilannetiedot.
      const totalMines = this._countOwnedMines();
      this._deposit(splitBudget(income, totalMines)); // Jaa juuri saadut tulot kolmeen lompakkoon.
      const totalShips = this.ships.filter(s => s.ownerId?.toString() === this.aiId).length;

      // VAIHE 2: Poikkeustilanteiden käsittely.
      const myStars = this.stars.filter(s => s.ownerId?.toString() === this.aiId);
      // TARKISTA, ONKO AI HÄVINNYT KAIKKI TUKIKOHTANSA.
      // Jos AI:lla ei ole enää yhtään tähteä, se ei voi toimia normaalisti.
      // Palautetaan erityinen NO_BASE-toiminto. GameManager voisi tulevaisuudessa
      // käyttää tätä laukaisemaan "viimeinen oljenkorsi" -logiikan, kuten kaikkien
      // jäljellä olevien alusten keräämisen ja pakotetun hyökkäyksen.
      if (!myStars.length) return [{ action:'NO_BASE' }];

      const acts = [];

      // Tarkista, onko laivaston kerääminen kestänyt liian kauan (timeout).
      // Tämä estää AI:n jumiutumisen yhteen strategiaan.
      if (this.gatheringTarget && this.gatheringStartTurn) {
          if (turnNumber - this.gatheringStartTurn > this.GATHERING_TIMEOUT) {
//               console.log(`[AI] Gathering timeout - proceeding with available forces`);
              this.gatheringTarget = null;
              this.gatheringFor = null;
              this.gatheringStartTurn = null;
          }
      }

      // VAIHE 3: Alkupelin strategiset "suojakaiteet" (Early Game Guards).
      // Nämä ohittavat monimutkaisen logiikan ja pakottavat AI:n noudattamaan
      // ennalta määrättyä, turvallista strategiaa pelin ensimmäisten minuuttien ajan.
      if (totalMines < 5) {
          // Tässä vaiheessa AI keskittyy vain kaivoksiin ja laajentumiseen.
          const mineBuild = this._buildMineOnly(myStars);
          if (mineBuild) acts.push(mineBuild);
          
          // MUTTA anna laajentua silti!
          acts.push(...this._expandWithGathering(myStars));
          
          // Lisätään playerId kaikkiin
          acts.forEach(act => { act.playerId = this.aiId; });
          // Päivitä tiedot ja poistu funktiosta, älä tee muuta tällä kierroksella.
          this.prevRes.credits = this.res.credits;
          this.prevRes.minerals = this.res.minerals;
          return acts;
      }
      
      if (totalMines < 10 && totalShips < 10) {
          // Tässä vaiheessa AI alkaa tasapainottaa taloutta ja armeijaa.
          const sBuild = this._buildOneStructure(myStars, totalMines, totalShips);
          if (sBuild) acts.push(sBuild);
          acts.push(...this._buildShips(myStars, totalMines, totalShips));
          acts.push(...this._expandWithGathering(myStars));  // Tärkeä!
          
          // Lisätään playerId kaikkiin
          acts.forEach(act => { act.playerId = this.aiId; });
          /// Päivitä tiedot ja poistu.
          this.prevRes.credits = this.res.credits;
          this.prevRes.minerals = this.res.minerals;
          return acts;
      }

      // VAIHE 4: Normaali keskipelin ja loppupelin päätöksenteko.
      // Kutsutaan erillisiä, monimutkaisempia funktioita tekemään päätökset.
      const sBuild = this._buildOneStructure(myStars, totalMines, totalShips);
      if (sBuild) acts.push(sBuild);

      
      acts.push(...this._buildShips(myStars, totalMines, totalShips));
      acts.push(...this._defend(myStars));
      acts.push(...this._expandWithGathering(myStars));

      // VAIHE 5: Kierroksen päättäminen.
      // Päivitä resurssitilanne seuraavaa kierrosta varten.
      this.prevRes.credits = this.res.credits;
      this.prevRes.minerals = this.res.minerals;

      // Lisää jokaiseen palautettavaan toimintoon AI:n oma tunniste.
      acts.forEach(act => { act.playerId = this.aiId; });

      return acts;
  }

  /* ==================================================================== */
  /*  PLANETARY BUILDING LOGIC                                            */
  /* ==================================================================== */
  /**
  * RAKENTAA MITÄ: Yrittää rakentaa yhden kaivoksen, jos se on mahdollista ja siihen on varaa.
  * KÄYTETÄÄN MIHIN: Tämä on yksinkertaistettu rakennusfunktio aivan pelin alkuun,
  * kun AI:n ainoa tavoite on lisätä mineraalituotantoa.
  *
  * @param {Array<object>} myStars - Lista AI:n omistamista tähdistä.
  * @returns {object|null} Palauttaa `QUEUE_PLANETARY`-toiminto-objektin, jos rakentaminen onnistuu, muuten null.
  */
  _buildMineOnly(myStars) {
      // Etsi mikä tahansa oma tähti, jossa on tilaa kaivokselle.
      const tgt = myStars.find(st => this._hasMineRoom(st));
      // Jos kohde löytyi ja ekolompakossa on varaa, tee osto.
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

  /**
  * PÄÄTTÄÄ MITÄ: Valitsee ja yrittää rakentaa yhden parhaaksi katsomansa planetaarisen rakennuksen
  * tai päivityksen kierroksen aikana.
  * KÄYTETÄÄN MIHIN: Tämä on AI:n keskeinen rakennuspäätöksiä tekevä funktio.
  *
  * TOIMINTALOGIIKKA:
  * 1. Kerää kaikki mahdolliset rakennusvaihtoehdot kaikilta planeetoilta (`_enumerateBuildOptions`).
  * 2. Pisteyttää ja järjestää vaihtoehdot parhausjärjestykseen.
  * 3. Valitsee parhaan vaihtoehdon, johon on varaa.
  * 4. Vertailee sitä parhaaseen "säästökohteeseen" ja päättää, kannattaako odottaa ja säästää.
  * 5. Jos päätös on rakentaa, palauttaa vastaavan toiminto-objektin.
  *
  * @param {Array<object>} myStars - Lista AI:n omistamista tähdistä.
  * @param {number} totalMines - Kaivosten kokonaismäärä, vaikuttaa pisteytykseen.
  * @returns {object|null} Toiminto-objekti tai null.
  */
  _buildOneStructure(myStars, totalMines) {
    // Turvaverkko alkupelille, vaikka runTurn-funktiossa on jo vastaava.
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

    // VAIHE 1: Kerää ja pisteytä kaikki mahdolliset rakennusvaihtoehdot kaikilta tähdiltä.
    const opts = [];
    myStars.forEach(st => this._enumerateBuildOptions(st, totalMines, opts));
    if (!opts.length) return null;  // Ei rakennusvaihtoehtoja missään.
    opts.sort((a,b) => b.score - a.score);

    // VAIHE 2: Valitse paras toiminto.
    let bestAffordable=null, bestSaving=null;
    // Etsi paras vaihtoehto, johon on varaa, sekä paras, johon kannattaisi säästää.
    for (const o of opts) {
      const wallet = this._walletFor(o.type);
      if (affordable(o.cost, wallet)) { 
        // Tämä on ensimmäinen (ja siis pisteiltään paras) vaihtoehto, johon on varaa.
        bestAffordable={o,wallet}; 
        break; // Ei tarvitse etsiä enempää, koska lista on jo järjestyksessä.
    }

      // Tarkista, onko tämä kallis kohde, johon kannattaisi säästää.
      const expensive = EXPENSIVE_PLANETARY_TAGS.some(t=>o.type.startsWith(t));
      if (expensive &&
          wallet.credits  >= WAIT_THRESHOLD*o.cost.credits &&
          wallet.minerals >= WAIT_THRESHOLD*o.cost.minerals &&
          !bestSaving) bestSaving=o;    // Tallennetaan ensimmäinen (ja pisteiltään paras) säästökohde.
    }
    if (!bestAffordable) return null;   // Ei ollut varaa mihinkään.
    // JOS paras säästökohde on strategisesti tärkeämpi (enemmän pisteitä)
    // kuin paras kohde, johon on nyt varaa, PÄÄTÄ SÄÄSTÄÄ (älä tee mitään).
    if (bestSaving && bestSaving.score > bestAffordable.o.score) return null; 

    // VAIHE 3: Toteuta päätös.
    pay(bestAffordable.o.cost, bestAffordable.wallet, this.res);
    return { action:'QUEUE_PLANETARY',
             starId:bestAffordable.o.star.id,
             build :{ type:bestAffordable.o.type, time:bestAffordable.o.cost.time } };
  }

  /**
  * KERÄÄ MITÄ: Käy läpi yhden tähden ja listaa kaikki mahdolliset rakennusvaihtoehdot sille.
  * KÄYTETÄÄN MIHIN: Apufunktio `_buildOneStructure`-metodille. Se purkaa "mitä voi rakentaa"
  * -logiikan omaan, selkeään paikkaansa.
  *
  * @param {object} star - Tarkasteltava tähti.
  * @param {number} totalMines - Kaivosten kokonaismäärä (vaikuttaa painoarvoihin).
  * @param {Array<object>} bucket - Taulukko, johon löydetyt rakennusvaihtoehdot lisätään.
  */
  _enumerateBuildOptions(star, totalMines, bucket) {
      const infraLvl = this._effectiveInfraLevel(star);
      const limits = this.infra[infraLvl] ?? this.infra[Math.max(...Object.keys(this.infra))];

      const eWeights = earlyWeights(totalMines) || {};

      // Apufunktio, joka lisää uuden vaihtoehdon listaan laskien samalla lopullisen pistemäärän.
      const push = (type, cost, mult = 1) => {
          const w = eWeights[type] ?? 1;
          bucket.push({
              star, type, cost,
              score: this._scoreBuild(star, type) * w * mult
          });
      };

      // --- Vaihtoehto 1: Infrastruktuurin päivitys ---
      if (star.infrastructureLevel < 5 && !this._infraQueued(star)) {
          const c = this._infraCost(star.infrastructureLevel);
          push(`Infrastructure Lvl ${c.nextLevel}`, c);
      }

      // --- Vaihtoehto 2: Telakan rakennus tai päivitys ---
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

      // --- Vaihtoehto 3: Kaivoksen rakennus ---
      if (this._hasMineRoom(star)) {
        push("Mine", STRUCT_COST.Mine, this._mineRoomScale(star));
      }

      // --- Vaihtoehto 4: Puolustuksen päivitys ---
      if (this._scoreBuild(star, "Defense Upgrade") > 0) {
          push("Defense Upgrade", STRUCT_COST["Defense Upgrade"]);
      }
  }

  /* ==================================================================== */
  /*  SHIPBUILDING                                                        */
  /* ==================================================================== */
  /**
 * PÄÄTTÄÄ MITÄ: Käy läpi kaikki AI:n omistamat telakat ja päättää, mitä aluksia
 * niillä rakennetaan tällä kierroksella.
 * KÄYTETÄÄN MIHIN: Tämä on AI:n laivastontuotannon päälogiikka. Se varmistaa, että
 * AI ylläpitää taloudellista tasapainoa (ei rakenna laivoja, jos kaivoksia on liian vähän)
 * ja rakentaa strategisesti oikeita aluksia oikeilla telakoilla.
 *
 * @param {Array<object>} myStars - Lista AI:n omistamista tähdistä.
 * @param {number} totalMines - AI:n kaivosten kokonaismäärä.
 * @param {number} totalShips - AI:n alusten kokonaismäärä.
 * @returns {Array<object>} Taulukko `QUEUE_SHIP`-toiminto-objekteja.
 */
  _buildShips(myStars, totalMines, totalShips) {
    // VAIHE 1: Taloudellinen turvaraja (quota).
    // Älä rakenna laivoja, jos kaivoksia on liian vähän suhteessa laivaston kokoon.
    // Tämä estää talouden romahtamisen.
    if (totalMines < this._requiredMines(totalShips)) return [];

    // VAIHE 2: Käy läpi kaikki telakat, korkein taso ensin.
    // Tämä varmistaa, että edistyneimmät alukset rakennetaan ensin, jos mahdollista.
    const yards = myStars
      .filter(st => st.shipyardLevel > 0)
      .sort((a, b) => b.shipyardLevel - a.shipyardLevel);

    const acts             = [];
    const AI_YARD_CAP      = 3;                 // AI ei yritä rakentaa pelaajan erikoisaluksia (esim. Lvl 4 Frigate).
    const EXPENSIVE_SHIPS  = new Set(EXPENSIVE_SHIP_TAGS);

    for (const st of yards) {
        // Jos telakan jono on täynnä, siirry seuraavaan telakkaan
      if ((st.shipQueue ?? []).length >= 2) continue;   
        // Hae rakennusprioriteetti tälle nimenomaiselle telakalle.
      const fleet = this._fleetAround(st);
      const prio  = this._shipPriorities(st, fleet);

      // Käy läpi priorisoidut alustyypit...
      for (const type of prio) {
        /* --- A) Hae aluksen data ja vaatimukset --- */
        const [cCred, cMin, buildTime, needLvl] = SHIP_COST[type];

        /* --- B) Älä rakenna liian edistyneitä aluksia --- */
        if (needLvl > AI_YARD_CAP) continue;            

        /* --- C) Varmista, että telakan taso riittää --- */
        if (st.shipyardLevel < needLvl) continue;

        /* --- D) Tarkista, onko varaa --- */
        const cost = { credits: cCred, minerals: cMin };
        if (!affordable(cost, this.war)) {

          // Jos ei ole varaa, mutta ollaan lähellä, päätä säästää.
          // `break` lopettaa tämän telakan käsittelyn tällä kierroksella
          // ja estää siirtymisen halvempiin, ei-toivottuihin aluksiin.
          const expensive = EXPENSIVE_SHIPS.has(type);
          if (
            expensive &&
            (this.war.credits  >= WAIT_THRESHOLD * cCred ||
            this.war.minerals >= WAIT_THRESHOLD * cMin)
          ) {
            /* Jatka säästämistä: älä pudottaudu Fightereihin saman vuoron aikana */
            break;
          }
          // Jos ei ollut varaa, kokeile seuraavaa, halvempaa alusta prioriteettilistalla.
          continue;
        }

        /* --- E) Kaikki kunnossa: Maksa ja lisää rakennusjonoon --- */
        pay(cost, this.war, this.res);

        acts.push({
          action : "QUEUE_SHIP",
          starId : st.id,
          build  : { type, time: buildTime }
        });

        // Rakenna vain YKSI alus per telakka per kierros.
        break;
      }
    }
    return acts;
  }

  /**
  * LASKEE MITÄ: Palauttaa vaaditun kaivosten minimimäärän suhteessa laivaston kokoon.
  * KÄYTETÄÄN MIHIN: Yksinkertainen taulukko, joka varmistaa, että AI:n talous kasvaa
  * samassa suhteessa sen armeijan kanssa, estäen talouden romahtamisen.
  * @param {number} totalShips - AI:n alusten kokonaismäärä.
  * @returns {number} Vaadittu kaivosten määrä.
  */
  _requiredMines(totalShips) {
    const tbl=[[0,0],[10,10],[15,15],[20,20],[25,25],[30,30],[35,35],[40,40],[45,45],[50,50]];
    let req=0; for(const [ships,mines] of tbl) if(totalShips>=ships) req=mines;
    return req;
  }

  /**
  * LASKEE MITÄ: Paikallisen laivaston koostumuksen tietyn tähden ympärillä.
  * KÄYTETÄÄN MIHIN: Antaa `_shipPriorities`-funktiolle tiedon siitä, millainen
  * laivasto tähdellä on jo, jotta se voi päättää, mitä aluksia kannattaa rakentaa seuraavaksi
  * tasapainon ylläpitämiseksi.
  * @param {object} star - Tähti, jonka laivastoa analysoidaan.
  * @returns {{fighters: number, destroyers: number, cruisers: number, total: number}}
  */
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

  /**
  * ANALYSOI MITÄ: Laskee kaikkien vihollispelaajien yhteenlasketun laivaston
  * prosentuaalisen jakauman (esim. 30% Fightereita, 50% Destroyereita, 20% Cruisereita).
  * KÄYTETÄÄN MIHIN: Antaa `_shipPriorities`-funktiolle elintärkeää tietoa "metasta",
  * eli siitä, millaista armeijaa vastaan AI:n tulisi varustautua.
  * @returns {{fighterRatio: number, destroyerRatio: number, cruiserRatio: number, total: number}}
  */
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
      // Jos vihollisaluksia ei ole, palautetaan tasainen oletusjakauma.
      return { fighterRatio: 0.33, destroyerRatio: 0.33, cruiserRatio: 0.34, total: 0 };
  }
  
  /**
  * PÄÄTTÄÄ MITÄ: Laskee ja palauttaa parhaan rakennusjärjestyksen aluksille yhdellä telakalla.
  * KÄYTETÄÄN MIHIN: Tämä on AI:n "kivi-paperi-sakset"-aivot. Se punnitsee kahta asiaa:
  * 1. Miten vastata parhaiten vihollisen laivastoon (rakentamalla vastayksiköitä)?
  * 2. Miten ylläpitää oman laivaston tasapainoa (ei liikaa vain yhtä alustyyppiä)?
  *
  * @param {object} star - Tähti, jolla rakentaminen tapahtuu.
  * @param {object} flt - `_fleetAround`-funktion palauttama paikallisen laivaston koostumus.
  * @returns {Array<string>} Lista alustyypeistä prioriteettijärjestyksessä.
  */
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
      
      // Erityissääntö: Jos vihollisilla on paljon planetaarista puolustusta, priorisoi Cruisereita.
      const enemiesWithPD = this.stars.filter(st => 
          st.ownerId?.toString() !== this.aiId && 
          st.defenseLevel > 0
      ).length;
      
      if (enemiesWithPD > 3) {
          counterWeights.Cruiser *= 1.3;
      }
      
      // Lasketaan lopulliset pisteet kullekin alustyypille.
      const priorities = [];
      const scores = {};
      
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

  /**
 * TOTEUTTAA MITÄ: AI:n puolustuslogiikan. Käy läpi kaikki omat tähdet, tunnistaa uhatut
 * järjestelmät ja kutsuu tarvittaessa apujoukkoja lähimmiltä planeetoilta.
 * KÄYTETÄÄN MIHIN: Tämä on AI:n reaktiivinen puolustusmekanismi. Se varmistaa, että AI ei
 * menetä planeettojaan passiivisesti, vaan yrittää aktiivisesti siirtää joukkoja sinne,
 * missä niitä eniten tarvitaan.
 *
 * @param {Array<object>} myStars - Lista AI:n omistamista tähdistä.
 * @returns {Array<object>} Taulukko `MOVE_SHIP`-toiminto-objekteja, jotka siirtävät aluksia puolustukseen.
 */
  _defend(myStars) {
      const acts=[];

      // Käy läpi jokaisen AI:n omistaman tähden.
      myStars.forEach(star=>{
        // VAIHE 1: Tunnista uhka. Onko tällä tähdellä vihollisaluksia?
        const hostileShips = this.ships.filter(s =>
          s.parentStarId?.toString() === star._id.toString() &&
          s.ownerId?.toString() !== this.aiId &&
          (s.state === 'orbiting' || s.state === 'conquering')
        );
        // Jos ei vihollisia, siirry seuraavaan tähteen.
        if(!hostileShips.length) return;

        // VAIHE 2: Laske voimatasapaino.
        // Kuinka vahvat omat joukot ovat tällä hetkellä paikalla?
        const friendlyShips = this.ships.filter(s =>
          s.parentStarId?.toString() === star._id.toString() &&
          s.ownerId?.toString() === this.aiId &&
          (s.state === 'orbiting' || s.state === 'conquering')
        );
        // Lasketaan, kuinka paljon taisteluvoimaa tarvitaan lisää (powerGap).
        let gap = starThreatScore(star, hostileShips) - 
                  friendlyShips.reduce((s,sh)=>s+shipPower(sh),0);
        // Jos omat joukot ovat jo riittävän vahvat, ei tarvita toimenpiteitä.
        if(gap<=0) return;

        // VAIHE 3: Etsi ja järjestä apujoukot.
        // Kerätään lista kaikista vapaista (orbitoivista) aluksista muilta tähdiltä.
        const candidates = this.ships.filter(sh =>
          sh.ownerId?.toString() === this.aiId &&
          sh.state === 'orbiting' &&
          sh.parentStarId?.toString() !== star._id.toString()
        // Järjestetään ehdokkaat etäisyyden mukaan, lähimmät ensin.
        ).sort((a,b) => {
          const starA = this._starById(a.parentStarId);
          const starB = this._starById(b.parentStarId);
          if (!starA || !starB) return 0;
          return distance3D(starA.position, star.position) -
                distance3D(starB.position, star.position);
        });
        // VAIHE 4: Lähetä apujoukkoja, kunnes voimavaje on täytetty.
        for(const sh of candidates){
          // Vähennä tarvittavien joukkojen määrää lähetetyn aluksen voimalla.
          gap -= shipPower(sh);
          // Luo siirtokäsky alukselle.
          acts.push({ 
            action: 'MOVE_SHIP',
            shipId: sh._id.toString(),
            fromStarId: sh.parentStarId.toString(),
            toStarId: star._id.toString()
          });
          // Kun tarpeeksi apujoukkoja on lähetetty, lopeta tältä tähdeltä.
          if(gap<=0) break;
        }
      });
      return acts;
  }

  /* ==================================================================== */
  /*  EXPANSION                                                           */
  /* ==================================================================== */
  
  /**
  * ARVIOI MITÄ: Päättää, onko hyökkäys tiettyyn tähteen niin riskialtis,
  * että joukot täytyy ensin kerätä yhteen ennen hyökkäystä (fleet gathering).
  * KÄYTETÄÄN MIHIN: Tämä on AI:n riskinhallintatyökalu. Se estää AI:ta
  * lähettämästä pieniä laivastoja varmaan kuolemaan vahvasti puolustettuja
  * kohteita vastaan.
  *
  * @param {object} targetStar - Potentiaalinen hyökkäyskohde.
  * @param {Array<object>} availableShips - Laivasto, jolla hyökkäystä harkitaan.
  * @returns {boolean} Tosi, jos joukkojen kerääminen on tarpeen.
  */
  _needsFleetGathering(targetStar, availableShips) {
      // Jos kohteella ei ole puolustusta, keräämistä ei tarvita.
      if (!targetStar.ownerId || targetStar.defenseLevel === 0) return false;
      
      // Simuloidaan, kuinka moni selviäisi PD:n ensi-iskusta.
      const survivors = simulatePDFirstStrike(availableShips, targetStar.defenseLevel);
      const survivorPower = survivors.reduce((sum, s) => sum + shipPower(s), 0);
      
      // Päätös perustuu kolmeen ehtoon:
      const MIN_CONQUEST_POWER = 5; // Minimivoima, jolla valloitus onnistuu.
      const casualties = availableShips.length - survivors.length;
      const casualtyRate = casualties / availableShips.length;
      
      return survivors.length === 0 ||              // 1. Kaikki kuolisivat.
            survivorPower < MIN_CONQUEST_POWER ||   // 2. Jäljelle ei jäisi tarpeeksi voimaa.
            casualtyRate > 0.6;                     // 3. Tappiot olisivat yli 60%.
  }

  /**
  * ETSII MITÄ: Parhaan turvallisen tähden laivaston keräämistä varten.
  * KÄYTETÄÄN MIHIN: Kun AI päättää kerätä joukkoja, tämä funktio valitsee
  * sille optimaalisen "kokoontumispaikan".
  *
  * @param {object} targetStar - Lopullinen hyökkäyskohde.
  * @param {Array<object>} myStars - Lista kaikista AI:n omistamista tähdistä.
  * @returns {object|null} Paras tähti kokoontumispaikaksi.
  */
  _findGatheringPoint(targetStar, myStars) {
      let bestStar = null;
      let bestScore = -Infinity;
      
      myStars.forEach(star => {
          if (star._id.equals(targetStar._id)) return;  // Ei kerätä joukkoja suoraan kohteeseen.
          
          const dist = distance3D(star.position, targetStar.position);
          
          // Pisteytys perustuu useaan tekijään: etäisyys, starlane-yhteys,
          // onko telakka (voi rakentaa lisää), ja turvallisuus.

          // Etäisyyspisteytys
          let score = 1000 / (dist + 100);
          
          // Bonus jos on starlane kohteeseen
          if ((star.connections || []).some(c => c.toString() === targetStar._id.toString())) {
              score *= 3;   
          }
          
          // Bonus jos on telakka
          if (star.shipyardLevel > 0) {
              score *= 1.5;
          }
          
          // Vähennä pisteitä, jos lähellä on vihollisia.
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
    
  /**
  * PÄÄTTÄÄ MITÄ: AI:n laajentumisstrategian pääfunktio. Päättää, mihin hyökätään,
  * millä joukoilla, ja käynnistääkö se laivastonkeräysoperaation.
  * KÄYTETÄÄN MIHIN: Tämä ohjaa AI:n hyökkäävää toimintaa kartalla.
  *
  * @param {Array<object>} myStars - Lista AI:n omistamista tähdistä.
  * @returns {Array<object>} Taulukko `MOVE_SHIP`-toiminto-objekteja.
  */
  _expandWithGathering(myStars) {
      const acts = [];
      const NONLANE_FACTOR = 1.35, STARLANE_BONUS = 8;
      
      // Jos laivaston kerääminen on jo käynnissä, siirrytään suoraan sen logiikkaan.
      if (this.gatheringTarget && this.gatheringFor) {
          return this._continueGathering();
      }
      
      // VAIHE 1: Analysoi tilanne. Kerää tiedot kaikista mahdollisista kohteista ja omista aluksista.
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
      
      // VAIHE 2: Etsi paras hyökkäyskohde pisteyttämällä kaikki vaihtoehdot.
      let bestTarget = null;
      let bestScore = -Infinity;
      let needsGathering = false;   // Tieto siitä, vaatiiko paras kohde keräytymistä
      
      potentialTargets.forEach(target => {
          // pisteytyslogiikka, joka ottaa huomioon etäisyyden, kohteen arvon, riskit
          // Tämä osa laskee scoren jokaiselle potentiaaliselle kohteelle.
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
          
          // Lähempänä olevat kohteet ovat parempia.
          let score = 1000 / (minDist + 50);
          
          // Bonukset
          if (!target.ownerId) score *= 2; // Neutraalit ovat helppoja saaliita.
          if (target.ownerId?.toString() === this.humanId) score *= 1.5; // Ihmispelaajan kimppuun käyminen on prioriteetti.
          
          // Arvioi riskit suhteessa puolustukseen.
          if (target.defenseLevel > 0) {
              const survivors = simulatePDFirstStrike(allAvailableShips, target.defenseLevel);
              const survivorPower = survivors.reduce((sum, s) => sum + shipPower(s), 0);
              
              if (survivorPower < 5) {
                  score *= 0.1; // Ei kannata hyökätä, jos tappiot ovat liian suuret.
              } else {
                  const localShips = shipsByLocation.get(nearestOwnStar._id.toString()) || [];
                  if (this._needsFleetGathering(target, localShips)) {
                      // Tämä kohde on mahdollinen, mutta vaatii joukkojen keräämisen.
                      needsGathering = true;
                      score *= 0.8; // Pieni sakko, koska vaatii enemmän aikaa
                  }
              }
          }
          
          if (score > bestScore) {
              bestScore = score;
              bestTarget = target;
          }
      });
      
      if (!bestTarget) return acts;
      
      // VAIHE 3: Tee päätös. Hyökätäänkö heti vai kerätäänkö joukkoja?
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
      
      // Jos keräytymistä ei tarvita, hyökätään suoraan lähimmästä tähdestä.
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

  /**
  * KÄYNNISTÄÄ MITÄ: Laivaston keräämisen. Antaa siirtokäskyt kaikille ylimääräisille
  * aluksille kohti ennalta määrättyä kokoontumispistettä.
  * @returns {Array<object>} Taulukko `MOVE_SHIP`-toiminto-objekteja.
  */
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
          
          // Jätä muutama alus puolustamaan kotirintamaa.
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

  /**
  * PÄÄTTÄÄ MITÄ: Jatkaako joukkojen keräämistä vai onko aika hyökätä.
  * KÄYTETÄÄN MIHIN: Tämä funktio ajetaan joka kierros, kun `gatheringTarget` on asetettu.
  * Se tarkistaa, onko kokoontumispisteessä tarpeeksi joukkoja hyökkäyksen aloittamiseksi.
  * @returns {Array<object>} Joko hyökkäyskäskyt tai uudet keräytymiskäskyt.
  */
  _continueGathering() {
      const acts = [];
      const gatheringStar = this.gatheringTarget;
      const targetStar = this.gatheringFor;
      
      // Turvatarkistus: jos kohde on jo vallattu tai oma, peruuta operaatio.
      if (gatheringStar.ownerId?.toString() !== this.aiId ||
          targetStar.ownerId?.toString() === this.aiId) {
          this.gatheringTarget = null;
          this.gatheringFor = null;
          return acts;
      }
      
      // Laske kerääntyneiden joukkojen voima.
      const gatheredShips = this.ships.filter(s => 
          s.parentStarId?.toString() === gatheringStar._id.toString() &&
          s.ownerId?.toString() === this.aiId && 
          s.state === 'orbiting'
      );
      
      // Tee uusi riskianalyysi kerääntyneillä joukoilla.
      const survivors = simulatePDFirstStrike(gatheredShips, targetStar.defenseLevel);
      const survivorPower = survivors.reduce((sum, s) => sum + shipPower(s), 0);
      
      // Jos voima riittää, hyökkää!
      if (survivorPower >= 8) { 
//           console.log(`[AI] Fleet gathered! Attacking ${targetStar.name} with ${gatheredShips.length} ships`);
          gatheredShips.forEach(ship => {
              acts.push({ 
                  action: 'MOVE_SHIP',
                  shipId: ship._id.toString(),
                  fromStarId: gatheringStar._id.toString(),
                  toStarId: targetStar._id.toString()
              });
          });
          
          // Nollaa keräytymistila hyökkäyksen jälkeen.
          this.gatheringTarget = null;
          this.gatheringFor = null;
          this.gatheringStartTurn = null;
      } else {
          // Ei vielä tarpeeksi voimaa, jatketaan keräämistä.
          return this._startGathering();
      }
      
      return acts;
  }

  /* ==================================================================== */
  /*  SCORING HELPERS (build decisions)                                   */
  /* ==================================================================== */

  /**
  * LASKEE MITÄ: Tähden "tehollisen" telakkatason, joka sisältää sekä valmiit
  * tasot että rakennusjonossa olevat päivitykset.
  * @param {object} star - Tarkasteltava tähti.
  * @returns {number} Tähden tuleva telakkataso.
  */
  _effectiveShipyardLevel(star) {
    return star.shipyardLevel + 
        (star.planetaryQueue || []).filter(it => 
            it.type.startsWith('Shipyard')
        ).length;
  }

  /**
  * LASKEE MITÄ: "Vähenevän tuoton" (diminishing returns) kertoimen uusien telakoiden
  * rakentamiselle.
  * MIKSI: Estää AI:ta rakentamasta liikaa telakoita. Mitä enemmän telakoita AI:lla
  * on, sitä pienemmän prioriteetin uuden telakan rakentaminen saa. Tämä kannustaa
  * päivittämään olemassa olevia telakoita uusien rakentamisen sijaan.
  * @returns {number} Kerroin välillä 0.05 - 1.0.
  */
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

  // --- Seuraavat ovat yksinkertaisia apufunktioita, jotka tekevät koodista luettavampaa ---
  _effectiveInfraLevel(star){
    return star.infrastructureLevel +
      (star.planetaryQueue||[]).filter(it=>it.type.startsWith('Infrastructure')).length;
  }
  _infraQueued(star){ return (star.planetaryQueue||[]).some(it=>it.type.startsWith('Infrastructure')); }
  _yardQueued (star){ return (star.planetaryQueue||[]).some(it=>it.type.startsWith('Shipyard')); }

  /**
  * VALITSEE MITÄ: Palauttaa oikean lompakon (`eco`, `tech`, `war`) tietylle rakennustyypille.
  * @param {string} type - Rakennuksen tai päivityksen tyyppi.
  * @returns {object} Viittaus oikeaan lompakko-objektiin.
  */
  _walletFor(type){
    if(type==='Mine') return this.eco;
    if(type==='Defense Upgrade'||type.startsWith('Infrastructure')||type.startsWith('Shipyard'))
      return this.tech;
    return this.war;
  }

  /**
  * LASKEE MITÄ: Infrastruktuurin päivityksen dynaamisen hinnan.
  * @param {number} lvl - Nykyinen infrastruktuurin taso.
  * @returns {object} Kustannusobjekti, joka sisältää hinnan ja ajan.
  */
  _infraCost(lvl){
    if(lvl===0) return {...STRUCT_COST['Shipyard Lvl 1'], nextLevel:1};
    const b=STRUCT_COST['Shipyard Lvl 1'];
    const f=1+0.30*lvl;
    return { nextLevel:lvl+1,
             credits :Math.round(b.credits *f),
             minerals:Math.round(b.minerals*f),
             time    :Math.round(b.time    *f) };
  }
  _shipyardCost(lvl){ return this._infraCost(lvl); }    // Telakka käyttää samaa kustannuskaavaa.

  /** TARKISTAA MITÄ: Onko tähdellä tilaa uusille kaivoksille. */
  _hasMineRoom(star){
    const lim=this.infra[star.infrastructureLevel].maxMines;
    return star.mines + this._queuedCount(star,'Mine') < lim;
  }

  /**
  * @summary Laskee kertoimen kaivoksen rakentamisen pisteytykselle.
  * @description Tämän funktion päätarkoitus on ohjata AI:ta keskittämään taloudellinen
  * kehitys muutamille "ydinplaneetoille" sen sijaan, että se rakentaisi yhden kaivoksen
  * sinne tänne. Tämä luo tehokkaampia ja paremmin puolustettavia talouskeskuksia ja
  * käynnistää "kaskadiefektin", jossa korkea kaivostuotanto oikeuttaa myöhemmät
  * infra- ja telakkapäivitykset samalle planeetalle.
  *
  * @param {object} star - Tarkasteltava tähti.
  * @returns {number} Kerroin (0-1), jolla kaivoksen peruspisteet kerrotaan.
  */
  _mineRoomScale(star) {
      const lim   = this.infra[star.infrastructureLevel].maxMines;
      const built = star.mines + this._queuedCount(star, 'Mine');
      const free  = lim - built;

      // VAIHE 1: Perustarkistus. Jos tilaa ei ole, pistemäärä on nolla.
      if (free <= 0) return 0;

      // VAIHE 2: Uuden kaivostoiminnan aloittaminen (tähdellä ei ole vielä yhtään kaivosta).
      if (built === 0) {
          // TÄMÄ ON KRIITTINEN KOHTA: Jos on olemassa jokin TOINEN oma planeetta,
          // jolla on jo kaivostoimintaa tai tilaa sille, ÄLÄ aloita uutta kaivostoimintaa täällä.
          // Tämä pakottaa AI:n keskittymään yhteen tai muutamaan paikkaan kerrallaan. 
          const myStars = this.stars.filter(
              s => s.ownerId?.toString() === this.aiId
          );
          // jos JOLLAIN muulla tähdellä on vielä kaivos-slotteja → paino 0
          const otherHasRoom = myStars.some(
              s => s !== star && this._hasMineRoom(s)
          );
          // "Kylvetään" ensimmäinen kaivos pienellä peruspisteellä vain, jos muita,
          // jo aloitettuja vaihtoehtoja ei ole.
          return otherHasRoom ? 0 : 0.25;  
      }

      // VAIHE 3: Toiminnan jatkaminen. Jos planeetalla on jo kaivoksia,
      // sen kehittämistä suositaan. Pisteet ovat suoraan verrannollisia jäljellä olevaan tilaan.
      return Math.min(1, free / 5 + 0.20); // 5 slot → 0.20, 4 slot → 0.40 …
  }

  /**
  * LASKEE MITÄ: Yksittäisen rakennusvaihtoehdon (esim. "rakenna kaivos")
  * strategisen "hyvyyspisteen" (score) tietylle tähdelle tässä hetkessä.
  * KÄYTETÄÄN MIHIN: Tämä on AI:n planetaarisen kehityksen ydinlogiikka.
  * `_buildOneStructure`-funktio kutsuu tätä kaikille mahdollisille vaihtoehdoille
  * ja valitsee sen, jolla on korkein pistemäärä.
  *
  * PISTEYTYSFILOSOFIA:
  * 1. Peruspisteet tulevat `WEIGHTS`-vakiosta, jotka määrittävät yleisen tärkeysjärjestyksen.
  * 2. Tilannekohtaiset kertoimet muokkaavat peruspisteitä (esim. bonusta solmukohdille).
  * 3. Absoluuttiset säännöt (esim. älä rakenna täyteen) palauttavat nollan ja karsivat vaihtoehdon pois.
  *
  * @param {object} star - Tarkasteltava tähti.
  * @param {string} type - Rakennuksen tyyppi, jota arvioidaan.
  * @returns {number} Laskettu pistemäärä. Mitä korkeampi, sitä parempi.
  */
  _scoreBuild(star, type) {
    // --- VAIHE 1: Alkutarkistukset ja muuttujien alustus ---
    const infraLvl = this._effectiveInfraLevel(star);
    const yardLvl = this._effectiveShipyardLevel(star);
    const lim = this.infra[infraLvl];
    
    // Efektiiviset määrät (lasketaan mukaan jonossa olevat työt).
    const e = {
        mines: star.mines + this._queuedCount(star, 'Mine'),
        defense: star.defenseLevel + this._queuedCount(star, 'Defense Upgrade'),
        yard: yardLvl
    };

    // Poistetaan vaihtoehto heti, jos se ylittäisi maksimirajat.
    if (type === 'Mine' && e.mines >= lim.maxMines) return 0;
    if (type === 'Defense Upgrade' && e.defense >= lim.maxDefense) return 0;
    if (type.startsWith('Shipyard') && e.yard >= lim.maxShipyard) return 0;

    let score = 0;

    // --- VAIHE 2: Pisteytys rakennustyypin mukaan ---

    // --- Kaivoksen pisteytys ---
    if (type === 'Mine') {
        const ratio = e.mines / Math.max(1, lim.maxMines);
        // Mitä vähemmän kaivoksia suhteessa maksimiin, sitä korkeammat pisteet.
        // Kerroin 1.5 antaa lisäpainoarvoa talouden käynnistämiselle.
        score = WEIGHTS.Mine * (1 - ratio) * 1.5;
        
    // --- Infrastruktuurin pisteytys ---
    } else if (type.startsWith('Infrastructure')) {
        // Älä koskaan päivitä infraa "tyhjällä" planeetalla, jolla ei ole mitään tuotantoa.
        const hasMine = star.mines + this._queuedCount(star, 'Mine') > 0;
        const hasYard = star.shipyardLevel > 0 || this._yardQueued(star);
        if (!hasMine && !hasYard) return 0;

        // Pisteet ovat kääntäen verrannollisia nykyiseen tasoon (alempi taso -> korkeammat pisteet).
        score = WEIGHTS.Infrastructure * (4 - star.infrastructureLevel);
        // Bonus: Infra-päivitys on arvokkaampi, jos se hyödyttää olemassa olevaa telakkaa tai kaivoksia.
        if (star.shipyardLevel > 0) score *= 1.8;
        if (hasMine) score *= 1.8;

        // VAIMENNUS (Penalty): Estää AI:ta päivittämästä infraa liian pitkälle, jos telakat ovat jäljessä.
        // Tämä tasapainottaa kehitystä.
        if (star.infrastructureLevel >= 2 && star.shipyardLevel < 2) {
            score *= 0.1;
        } else if (star.infrastructureLevel >= 3 && star.shipyardLevel < 3) {
            score *= 0.1;
        }
        
    // --- Telakan pisteytys ---
    } else if (type === 'Shipyard' || type.startsWith('Shipyard Lvl')) {
        // A) Uuden telakan rakentaminen
        if (star.shipyardLevel === 0 && !this._yardQueued(star)) {
            // Pisteet laskevat, mitä enemmän telakoita AI:lla jo on (diminishing returns).
            const dim = this._shipyardDiminish();
            score = WEIGHTS.Shipyard * dim;
            
        // B) Olemassa olevan päivitys
        } else {
            // Päivitys on aina hyvä asia, ei rangaistusta.
            score = WEIGHTS['Shipyard Upgrade'] * (3 - star.shipyardLevel);
            
            // Bonus: Erityisen suuri bonus päivitykselle tasolle 3, koska se avaa Cruiserit.
            if (star.shipyardLevel === 2) score *= 3;
        }
        
        // Bonus: Kannustaa rakentamaan telakan, jos infra on jo korkealla tasolla
        if (star.infrastructureLevel >= 3 && star.shipyardLevel < 2) {
            score *= 2.5;
        }
        
    // --- Puolustuksen pisteytys ---
    } else if (type === 'Defense Upgrade') {
        // Puolustetaan vain "arvokkaita" tähtiä (joilla on infraa tai telakka).
        const yardFuture = this._effectiveShipyardLevel(star);
        const worthDefending = yardFuture > 0 || star.infrastructureLevel >= 2;
        if (!worthDefending) return 0;

        // Laske, kuinka monta puolustustasoa puuttuu tavoitteesta.
        const wanted = this._wantedDefense(star, yardFuture);
        const queued = this._queuedCount(star, 'Defense Upgrade');
        const have = star.defenseLevel;
        const missing = Math.max(0, wanted - (have + queued));
        if (missing === 0) return 0;

        // Mitä enemmän puolustusta puuttuu, sitä korkeammat peruspisteet.
        let base = WEIGHTS['Defense Upgrade'] * missing;
        
        // Arvokerroin: Mitä kehittyneempi tähti, sitä tärkeämpää sen puolustaminen on.
        if (star.infrastructureLevel >= 4) base *= 4.0;
        else if (star.infrastructureLevel === 3) base *= 3.0;
        else if (yardFuture > 0) base *= 2.0;
        
        score = base;
    }

    // --- VAIHE 3: Yleiset, kaikille tyypeille yhteiset bonuskertoimet ---

    // Kannustaa kehittämään valloitettuja tähtiä kotiplaneetan sijaan.
    if (!star.isHomeworld) score *= 1.3;
    // Strategiset solmukohdat ovat arvokkaampia.
    if ((star.connections || []).length > 2) score *= 1.2;
    // Rangaistus kaikelle muulle paitsi telakan rakentamiselle, jos telakkaa ei ole.
    if (star.shipyardLevel === 0 && !type.startsWith('Shipyard')) score *= 0.1;

    return score;
}

  /** LASKEE MITÄ: "Ihanteellisen" puolustustason tähdelle sen arvon perusteella. */
  _wantedDefense(star, futureYard){
    const lvl=star.infrastructureLevel;
    if(lvl<2)  return futureYard>0 ? 1 : 0;
    if(lvl===2) return 2;
    if(lvl===3) return futureYard>0 ? 3 : 2;
    return futureYard>0 ? 6 : 4;
  }

  /** LASKEE MITÄ: Kuinka monta tiettyä tyyppiä olevaa kohdetta on jonossa. */
  _queuedCount(star,type){ return (star.planetaryQueue||[]).filter(it=>it.type===type).length; }

  /* ==================================================================== */
  /*  MISC UTILITIES                                                       */
  /* ==================================================================== */
  _ship(id){ return this.ships.find(s=>s.id===id); }
  _starById(id){ return this.stars.find(s=>s.id===id); }

  /** LASKEE MITÄ: AI:n omistamien kaivosten kokonaismäärän (valmiit + jonossa). 
   *  Käytetään mm. early weighteissä kun tavoitteena > 25 kaivosta ennen AI:n vapauttamista
  */
  _countOwnedMines(){
    return this.stars
      .filter(s=>s.ownerId?.toString()===this.aiId)
      .reduce((sum,st)=>sum+st.mines+this._queuedCount(st,'Mine'),0);
  }

  /** TOTEUTTAA MITÄ: Lisää jaetut tulot kolmeen erilliseen lompakkoon. */
  _deposit(split){
    this.eco.credits  += split.eco.credits;   this.eco.minerals  += split.eco.minerals;
    this.tech.credits += split.tech.credits;  this.tech.minerals += split.tech.minerals;
    this.war.credits  += split.war.credits;   this.war.minerals  += split.war.minerals;
  }
}

module.exports = AIController;
