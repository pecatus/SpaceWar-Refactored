// frontend/js/client.js - Täydellinen client-side logiikka
// =============================================================================
//  Tämä tiedosto on client-sovelluksen "aivot". Se hoitaa kaiken, mikä ei liity
//  suoraan 3D-renderöintiin:
//  - Yhteydenpito backend-palvelimeen (Socket.IO).
//  - Kaikkien käyttöliittymän elementtien (napit, paneelit) hallinta ja päivitys.
//  - Pelaajan syötteiden käsittely (klikkaukset, näppäimistö).
//  - Toimii siltana ja komentojen välittäjänä scene.js-moduulille.
// =============================================================================

// --- RIIPPUVUUDET (IMPORTS) ---
// Haetaan tarvittavat kirjastot ja funktiot muista moduuleista.

// Socket.IO-client-kirjasto, jolla luodaan reaaliaikainen yhteys serveriin.
import { io } from "https://cdn.socket.io/4.7.5/socket.io.esm.min.js";

// Tuodaan kaikki julkiset funktiot scene.js-moduulista.
// Nämä funktiot ovat rajapinta, jonka kautta tämä client.js-tiedosto
// voi antaa komentoja 3D-maailmalle (esim. "rakenna maailma", "valitse tähti").
import {
    initThreeIfNeeded,
    buildFromSnapshot,
    applyDiff,
    startAnimateLoop,
    stopAnimateLoop,
    selectStar,
    deselectStar,
    cleanupScene,
    getSceneDebugInfo,
    getSelectedShips,
    selectShipsByIds, 
    focusOnGroup
} from './scene.js';


/* ========================================================================== */
/* AUDIO STATE & NODES                                                       */
/* ========================================================================== */
// Globaalit muuttujat pelin äänijärjestelmän hallintaan (Tone.js).

let audioContextStarted = false;                // Lippu, joka kertoo, onko selaimen äänikonteksti jo käynnistetty.
let masterVolume;                               // Pää-äänenvoimakkuuden säädin.
let ambientHum, ambientFilter, ambientPanner;   // Taustahuminan (drone) luomiseen käytettävät äänisolmut.
let synthButtonClick;                           // Syntetisaattori nappien klikkausäänelle.
let synthButtonHoverEffect;                     // Syntetisaattori hiiren hover-äänelle.
let lastButtonClickTime = 0;                    // Aikaleima viimeisimmälle klikkaukselle (estää äänten "räminää").
let lastButtonHoverTime = 0;                    // Aikaleima viimeisimmälle hoverille.
const BUTTON_CLICK_COOLDOWN = 0.05;             // Minimiodotusaika (sekunteina) klikkausäänten välillä.
const BUTTON_HOVER_COOLDOWN = 0.03;             // Minimiodotusaika hover-äänten välillä.


/* ========================================================================== */
/* CONSTANTS & CONFIGURATION                                                 */
/* ========================================================================== */
// Pelin staattiset konfiguraatioarvot ja säännöt.
// Keskittämällä nämä yhteen paikkaan, pelin tasapainoa on helppo säätää.

/** Backend-palvelimen julkinen URL-osoite. */
const BACKEND_URL = "https://spacewar-refactored.onrender.com";

/** Oletusvärit tekoälypelaajille, jos pelaaja ei valitse niitä itse. */
const DEFAULT_AI_COLORS = [
    0xdc3545, // Red
    0x28a745, // Green  
    0xffc107, // Yellow
    0x6f42c1  // Purple
];


/**
 * @summary Alusten rakennuskustannukset ja -vaatimukset.
 * @description Kopio backendin vastaavasta taulukosta. Varmistaa, että UI voi
 * näyttää oikeat hinnat ilman jatkuvaa kyselyä serveriltä.
 * Formaatti: [krediitit, mineraalit, rakennusaika, vaadittu telakkataso]
 */
const SHIP_COST = {
    Fighter: [50, 25, 10, 1],
    Destroyer: [100, 50, 25, 2],
    Cruiser: [150, 75, 45, 3],
    'Slipstream Frigate': [120, 180, 55, 4]
};

/** Galactic Hubin ylläpitokustannus per 10 sekuntia. */
const UPKEEP_GALACTIC_HUB = 15;


/**
 * @summary Rakennusten ja populaation maksimimäärät kullakin infrastruktuuritasolla.
 * @description Kopio backendin säännöistä. UI käyttää tätä näyttääkseen pelaajalle
 * rajoitukset (esim. "Mines: 4 / 5").
 */
const INFRA_LIMITS = {
    1: { maxPop: 5,  maxMines: 5,  maxDefense: 1, maxShipyard: 1 },
    2: { maxPop: 10, maxMines: 10, maxDefense: 2, maxShipyard: 2 },
    3: { maxPop: 15, maxMines: 15, maxDefense: 4, maxShipyard: 3 },
    4: { maxPop: 20, maxMines: 20, maxDefense: 6, maxShipyard: 4 },
    5: { maxPop: 25, maxMines: 25, maxDefense: 8, maxShipyard: 4 }
};


/* ========================================================================== */
/* GLOBAL STATE                                                              */
/* ========================================================================== */
// Nämä muuttujat säilyttävät client-sovelluksen tilan koko pelisession ajan.

/**
 * @summary Koko pelin senhetkinen tila.
 * @description Tämä on clientin kopio backendin lähettämästä pelin tilasta. Se sisältää
 * kaiken datan tähdistä, aluksista ja pelaajista. Sitä päivitetään sekä
 * `initial_state`-viestillä että pienemmillä `game_diff`-päivityksillä.
 * @type {object | null}
 */
let gameState = null;

/**
 * @summary Pelaajan luomat alusten kontrolliryhmät.
 * @description Objekti, joka tallentaa pelaajan pikanäppäimillä (CTRL+[0-9])
 * luomat ryhmät. Avaimena on numero (0-9) ja arvona taulukko alusten ID:istä.
 * @type {Object.<string, Array<string>>}
 */
let controlGroups = {}; // 

// Muuttujat kontrolliryhmien tuplapainalluksen tunnistamiseen (kameran tarkennus).
let lastGroupKey = null; // 
let lastGroupKeyTime = 0; // 
const DOUBLE_PRESS_THRESHOLD = 350; // Aika millisekunteina.

/** Clientin oma pelaaja-ID, jonka se saa serveriltä pelin alussa. */
let myPlayerId = null;

/** Pelaajan resurssit (krediitit ja mineraalit). Pidetään erillään, jotta UI:n päivitys on nopeaa. */
let playerResources = { credits: 1000, minerals: 500 };

/** Lippu, joka kertoo, onko peli käynnissä. */
let gameInProgress = false;

/** Nykyisen pelisession uniikki ID. */
let currentGameId = null;

/** Tällä hetkellä valittuna oleva tähti. @type {object | null} */
let selectedStar = null;

/** Pelin nopeuskerroin (1x, 2x, 5x, 10x). */
let GAME_SPEED = 1;
window.GAME_SPEED = GAME_SPEED;     // Välitetään `scene.js`:lle globaalin `window`-objektin kautta.

/** Onko peli pausella. */
let isPaused = false;
window.isPaused = false;            // Välitetään myös `scene.js`:lle.

/**
 * @summary Kertoo käyttöliittymän nykyisen tilan.
 * @description Ohjaa, mitkä pääelementit (aloitusvalikko, pelinäkymä) ovat näkyvissä.
 * @type {'startScreen' | 'playing' | 'paused'}
 */
let uiState = 'startScreen'; // 'startScreen', 'playing', 'paused'


/* ========================================================================== */
/* DOM ELEMENTS                                                              */
/* ========================================================================== */
// Viittaukset kaikkiin tärkeisiin HTML-elementteihin. Nämä haetaan kerran
// sivun latautuessa, mikä on tehokkaampaa kuin niiden jatkuva hakeminen.

// Start screen elements
const startScreen = document.getElementById('startScreen');
const startGameButton = document.getElementById('startGameButton');
const resumeGameButton = document.getElementById('resumeGameButton');
const starCountSelect = document.getElementById('starCount');
const numAiPlayersSelect = document.getElementById('numAiPlayers');
const aiPlayerSettingsContainer = document.getElementById('aiPlayerSettingsContainer');

// Game UI elements
const uiContainer = document.getElementById('uiContainer');
const resourcePanel = document.getElementById('resourcePanel');
const creditsDisplay = document.getElementById('creditsDisplay');
const mineralsDisplay = document.getElementById('mineralsDisplay');

// Planet menu elements
const planetMenu = document.getElementById('planetMenu');
const planetMenuTitle = document.getElementById('planetMenuTitle');
const planetOwnerDisplay = document.getElementById('planetOwner');
const planetInfraLevelDisplay = document.getElementById('planetInfraLevel');
const planetDefenseDisplay = document.getElementById('planetDefense');
const planetPopulationDisplay = document.getElementById('planetPopulation');
const planetMinesDisplay = document.getElementById('planetMines');
const planetShipyardLevelDisplay = document.getElementById('planetShipyardLevel');

// Construction buttons
const upgradeInfrastructureButton = document.getElementById('upgradeInfrastructureButton');
const buildShipyardButton = document.getElementById('buildShipyardButton');
const upgradeShipyardButton = document.getElementById('upgradeShipyardButton');
const buildMineButton = document.getElementById('buildMineButton');
const buildDefenseButton = document.getElementById('buildDefenseButton');
const buildFighterButton = document.getElementById('buildFighterButton');
const buildDestroyerButton = document.getElementById('buildDestroyerButton');
const buildCruiserButton = document.getElementById('buildCruiserButton');
const buildSlipstreamFrigateButton = document.getElementById('buildSlipstreamFrigateButton');
const buildGalacticHubButton = document.getElementById('buildGalacticHubButton'); 

// Progress displays
const planetaryQueueInfo = document.getElementById('planetaryQueueInfo');
const shipQueueInfo = document.getElementById('shipQueueInfo');
const planetaryQueueTotalProgressFill = document.getElementById('planetaryQueueTotalProgressFill');
const planetaryQueueTotalProgressText = document.getElementById('planetaryQueueTotalProgressText');
const shipQueueTotalProgressFill = document.getElementById('shipQueueTotalProgressFill');
const shipQueueTotalProgressText = document.getElementById('shipQueueTotalProgressText');

// Progress interpolation state
/**
 * @summary Säilöö rakennusjonojen tilan pehmeää edistymispalkin animointia varten.
 * @description Koska serveri lähettää päivityksiä vain joka tick, tämä Map-rakenne
 * mahdollistaa edistymispalkkien sulavan, interpoloidun animaation päivitysten välillä.
 * @type {Map<string, {planetary: Array, ship: Array, lastUpdate: number}>}
 */
let constructionProgressData = new Map();   
let progressInterpolationInterval = null;   // Viittaus `setInterval`-ajastimeen.


/* ========================================================================== */
/*  SOCKET.IO CONNECTION                                                      */
/* ========================================================================== */

/**
 * @summary Luo ja alustaa Socket.IO-yhteyden backend-palvelimeen.
 * @description Tämä on clientin pääasiallinen kommunikaatiokanava. Se määrittelee
 * backendin osoitteen ja sallitut yhteystavat. `withCredentials: true` on tärkeä,
 * jotta sessiot ja evästeet toimivat oikein.
 */
const socket = io(BACKEND_URL, {
    transports: ["websocket", "polling"],
    withCredentials: true
});

/**
 * KUUNTELIJA: `connect`
 * TAPAHTUU KUN: Yhteys palvelimeen on onnistuneesti muodostettu.
 * TEKEE MITÄ: Tällä hetkellä vain kirjaa onnistuneen yhteyden konsoliin.
 */
socket.on("connect", () => {
});

/**
 * AJASTIN: HTTP Keep-alive ( *** EI TOIMI ODOTETUSTI - VAATII maksullisen render.com-instanssin ***)
 * TEORIA: Alla
 * TARKOITUS: Estää Render.comin ilmaisen palvelininstanssin nukahtamisen. 
 * TOIMINTA: Lähettää 14 minuutin välein yksinkertaisen HTTP-pyynnön serverille.
 * Tämä riittää simuloimaan "aktiivisuutta" ja pitämään palvelimen hereillä.
 */
const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000; // 14 minuuttia
setInterval(() => {
    // Lähetä pyyntö vain, jos peli on aktiivisesti käynnissä
    if (window.gameInProgress && !window.isPaused) {
        fetch(`${BACKEND_URL}/api/keep-alive`)
            .then(res => {
                if (res.ok) {
                }
            })
            .catch(err => {
                // Virheestä ei tarvitse välittää, se voi johtua esim. yhteyden katkeamisesta
                // console.log('Keep-alive ping failed, connection might be lost.');
            });
    }
}, KEEP_ALIVE_INTERVAL);

/**
 * KUUNTELIJA: `disconnect`
 * TAPAHTUU KUN: Yhteys palvelimeen katkeaa odottamatta.
 * TEKEE MITÄ: Ilmoittaa pelaajalle yhteyden katkeamisesta.
 */
socket.on("disconnect", () => {
//     console.log("❌ Disconnected from server");
    // Näytä UI että yhteys katkesi
    if (gameInProgress) {
        alert("Connection lost! The game has been paused. Refresh to reconnect.");
    }
});

/**
 * KUUNTELIJA: `reconnect`
 * TAPAHTUU KUN: Yhteys onnistutaan muodostamaan uudelleen katkoksen jälkeen.
 * TEKEE MITÄ: Yrittää liittyä automaattisesti takaisin samaan pelihuoneeseen.
 */
socket.on("reconnect", () => {
//     console.log("🔄 Reconnected to server");
    if (currentGameId) {
        socket.emit("join_game", { gameId: currentGameId });
    }
});

/**
 * KUUNTELIJA: `connect_error`
 * TAPAHTUU KUN: Yhteyden muodostamisessa tapahtuu virhe.
 */
socket.on("connect_error", (error) => {
//     console.error("❌ Socket connection error:", error);
});

/**
 * KUUNTELIJA: `initial_state`
 * TAPAHTUU KUN: Pelaaja luo uuden pelin tai liittyy olemassa olevaan.
 * TEKEE MITÄ: Vastaanottaa koko pelimaailman datan ("snapshot") ja välittää sen
 * `handleInitialState`-funktiolle, joka rakentaa pelin ja käyttöliittymän.
 */
socket.on('initial_state', (snap) => {
//     console.log("📥 Received initial_state:", snap);
    handleInitialState(snap);
});

/**
 * KUUNTELIJA: `game_diff`
 * TAPAHTUU KUN: Pelin tila muuttuu serverillä (yleisin viesti pelin aikana).
 * TEKEE MITÄ: Vastaanottaa taulukollisen pieniä muutoksia ("diffs") ja
 * välittää ne sekä 3D-maailman (`applyDiff`) että käyttöliittymän
 * (`updateUIFromDiff`) päivitettäväksi.
 */
socket.on("game_diff", (diff) => {
    applyDiff(diff);
    updateUIFromDiff(diff);
});

/**
 * KUUNTELIJA: `joined`
 * TAPAHTUU KUN: Serveri vahvistaa, että client on onnistuneesti liittynyt pelihuoneeseen.
 * TEKEE MITÄ: Tarkistaa onnistumisen. Jos epäonnistui, näyttää virheilmoituksen.
 */
socket.on("joined", (response) => {
    if (response.success) {
//         console.log("✅ Successfully joined game");
    } else {
//         console.error("❌ Failed to join game:", response.error);
        alert("Failed to join game: " + response.error);
        showStartScreen();
    }
});


/* ========================================================================== */
/*  INITIALIZATION                                                            */
/* ========================================================================== */

/**
 * KUUNTELIJA: `DOMContentLoaded`
 * TAPAHTUU KUN: Koko HTML-dokumentti on ladattu ja jäsennetty selaimeen.
 * TEKEE MITÄ: Tämä on client-sovelluksen pääasiallinen käynnistyspiste. Se varmistaa,
 * että kaikki HTML-elementit ovat olemassa ennen kuin yritämme liittää niihin
 * toiminnallisuutta.
 */
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    setupEventListeners();
    setupAIPlayerSettings();
});

/**
 * ALUSTAA MITÄ: Valmistelee käyttöliittymän ja 3D-maailman.
 * KÄYTETÄÄN MIHIN: Tämä on ensimmäinen askel sovelluksen alustuksessa. Se kutsuu
 * `scene.js`:n alustusfunktiota, näyttää aloitusvalikon ja synkronoi nappien
 * data-attribuutit vastaamaan pelin sääntöjä.
 */
function initializeUI() {
    // Alustetaan Three.js-maailma, mutta ei käynnistetä vielä animaatiolooppia.
    initThreeIfNeeded();
    
    // Näytetään oletuksena aloitusvalikko.
    showStartScreen();
    
    // Varmistetaan, että nappien datassa olevat hinnat vastaavat `SHIP_COST`-vakiota.
    syncShipButtons();
    
    // Alustetaan työkaluvihjeiden (tooltips) näyttämislogiikka.
    setupTooltips();
}

/**
 * MÄÄRITTÄÄ MITÄ: Liittää kaikki tarvittavat tapahtumankuuntelijat HTML-elementteihin.
 * KÄYTETÄÄN MIHIN: Tämä funktio tekee käyttöliittymästä interaktiivisen. Se sitoo
 * funktioita (esim. `handleStartGame`, `handleBuildMine`) vastaaviin nappien
 * klikkauksiin ja näppäimistön painalluksiin.
 */
function setupEventListeners() {
    // --- Pelin elinkaaren napit ---
    startGameButton.addEventListener('click', () => {
        handleStartGame();
    });
    resumeGameButton.addEventListener('click', () => {
        handleResumeGame();
    });

    // --- Selainikkunan sulkemisen käsittely ---
    // Varmistetaan, että Socket.IO-yhteys katkaistaan siististi, kun pelaaja
    // sulkee välilehden tai selaimen. Tämä auttaa vapauttamaan resursseja serverillä.
    window.addEventListener('beforeunload', () => {
    if (window.socket && window.socket.connected) {
        window.socket.disconnect();
        }
    });
    // Varmista että socket katkaistaan kun pelaaja poistuu sivulta
    window.addEventListener('unload', () => {
    if (window.socket && window.socket.connected) {
        window.socket.disconnect();
        }
    });
    
    // --- Pelin asetuskuuntelijat ---
    numAiPlayersSelect.addEventListener('change', setupAIPlayerSettings);
    
    // --- Rakennusnappien kuuntelijat ---
    // Jokainen nappi kutsuu omaa käsittelijäfunktiotaan ja soittaa klikkausäänen.
    upgradeInfrastructureButton.addEventListener('click', () => {playButtonClickSound(); handleUpgradeInfrastructure()});
    buildShipyardButton.addEventListener('click', () => {playButtonClickSound();handleBuildShipyard()});
    upgradeShipyardButton.addEventListener('click', () => {playButtonClickSound();handleUpgradeShipyard()});
    buildMineButton.addEventListener('click', () => {playButtonClickSound();handleBuildMine()});
    buildDefenseButton.addEventListener('click', () => {playButtonClickSound();handleBuildDefense()});
    buildFighterButton.addEventListener('click', (e) => {playButtonClickSound();handleBuildShip(e.target.dataset.type)});
    buildDestroyerButton.addEventListener('click', (e) => {playButtonClickSound();handleBuildShip(e.target.dataset.type)});
    buildCruiserButton.addEventListener('click', (e) => {playButtonClickSound();handleBuildShip(e.target.dataset.type)});
    buildSlipstreamFrigateButton.addEventListener('click', (e) => {playButtonClickSound();handleBuildShip(e.target.dataset.type)});
    buildGalacticHubButton.addEventListener('click', () => {playButtonClickSound();handleBuildGalacticHub()}); 

    
    // --- `scene.js`:n lähettämien kustomoitujen tapahtumien kuuntelu ---
    // Tämä on tärkeä mekanismi, jolla 3D-maailma (scene.js) voi kommunikoida
    // takaisin tälle logiikkatiedostolle (client.js).
    window.addEventListener('starSelected', (event) => {
        playButtonClickSound();
        handleStarSelection(event.detail);      // `event.detail` sisältää valitun tähden datan.
    });
    
    window.addEventListener('starDeselected', () => {
        hidePlanetMenu();
    });
    
    // Ship selection events
    window.addEventListener('shipsSelected', (event) => {
        const selectedUnitsPanel = document.getElementById('selectedUnitsPanel');
        if (selectedUnitsPanel) {
            selectedUnitsPanel.textContent = `Selected Units: ${event.detail.count}`;
            selectedUnitsPanel.style.display = event.detail.count > 0 ? 'block' : 'none';
        }
    });
    
    // --- Pelaajan komentojen välitys serverille ---
    // Kun `scene.js` havaitsee pelaajan antavan komennon (esim. RMB-klikkaus),
    // se lähettää tämän eventin, joka välitetään tässä suoraan serverille.
    window.addEventListener('shipCommand', (event) => {
        const command = {
            ...event.detail,
            gameId: currentGameId  
    };
        socket.emit('player_command', command);
    });

    // Ship arrival events
    window.addEventListener('shipArrived', (event) => {
        const command = {
            ...event.detail,
            gameId: currentGameId  
    };
        socket.emit('player_command', command);
    });

    // --- Näppäimistön kuuntelijat ---
    document.addEventListener('keydown', (event) => {
        // --- ESC: Paussi / Päävalikko ---
        if (event.key === 'Escape') {
            // Jos olemme pelitilassa, siirry paussivalikkoon (eli päävalikkoon)
            if (uiState === 'playing') {
                pauseGame();        // Kerro serverille, että peli on paussilla
                window.isPaused = true;
                uiState = 'paused'; // Muuta clientin tilaa
                updateUIState();    // Päivitä UI näyttämään päävalikko
            }
            // Jos olemme jo valikossa (pausella), palataan peliin
            else if (uiState === 'paused') {
                handleResumeGame(); 
            }
        }
    
    
    // --- F4 DEBUG KÄSITTELY ---
    else if (event.key === 'F4') {
        event.preventDefault();
        
        // Tarkista että debug-funktio on saatavilla
        if (window.getSceneDebugInfo) {
            const debug = window.getSceneDebugInfo();
            const shipDetails = debug.shipsByStarDetails();
            
             console.log('=== SHIP TRACKING DEBUG ===');
             console.log(`Total ships: ${debug.totalShips}`);
             console.log(`Tracked ships: ${debug.trackedShips}`);
             console.log(`Untracked ships: ${debug.untrackedShips}`);
             console.log(`Tracking accuracy: ${debug.trackingAccuracy}%`);
             console.log('');
             console.log(`Stars with ships: ${debug.starsWithShips}`);
             console.log(`Combat effects active: ${debug.combatEffects}`);
             console.log(`Explosions active: ${debug.explosions}`);
             console.log(`Stars to check: ${debug.starsToCheck}`);
             console.log('');
            
            // Performance issues
            if (debug.performanceIssues) {
                const issues = debug.performanceIssues;
                if (issues.tooManyCombatEffects || issues.tooManyStarsToCheck || issues.poorTrackingAccuracy) {
                     console.log('⚠️  PERFORMANCE ISSUES DETECTED:');
                    if (issues.tooManyCombatEffects) {
                         console.log(`   - Too many combat effects (${debug.combatEffects} > 10)`);
                    }
                    if (issues.tooManyStarsToCheck) {
                         console.log(`   - Too many stars being checked (${debug.starsToCheck} > 30)`);
                    }
                    if (issues.poorTrackingAccuracy) {
                         console.log(`   - Poor tracking accuracy (${debug.trackingAccuracy}% < 95%)`);
                    }
                     console.log('');
                }
            }
            
            console.log('Ships by star (top 10):');
            shipDetails.details.slice(0, 10).forEach(star => {
                 console.log(`  ${star.starName}: ${star.shipCount} ships`);
            });
            
            if (shipDetails.details.length > 10) {
                 console.log(`  ... and ${shipDetails.details.length - 10} more stars`);
            }
            
             console.log('========================');
            
            // Jos on ongelmia, ehdota korjausta
            if (debug.untrackedShips > 0 || debug.starsToCheck > 30) {
                 console.log('💡 TIP: Press F5 to run cleanup');
            }
        } else {
             console.warn('Scene debug info not available yet');
        }
    }

    // F5 näppäin manuaaliseen siivoukseen:
    else if (event.key === 'F5') {
        event.preventDefault();
         console.log('🧹 Running manual cleanup...');
        
        if (window.performMemoryCleanup) {
            window.performMemoryCleanup();
        }
        
        if (window.cleanupCombatChecks) {
            window.cleanupCombatChecks();
        }
        
         console.log('✅ Cleanup complete!');
    }
    
    // --- F3 PERFORMANCE MONITOR ---
    else if (event.key === 'F3') {
        event.preventDefault();
        const monitor = document.getElementById('performanceMonitor');
        if (monitor) {
            monitor.style.display = monitor.style.display === 'none' ? 'block' : 'none';
        } else {
             console.warn('Performance monitor element not found - add it to your HTML');
        }
    }

    // --- SPACE - Välilyönti: Nopea pause ---
    else if (event.code === 'Space') {
        // Toimii vain, jos olemme aktiivisessa pelinäkymässä
        if (uiState === 'playing') {
            event.preventDefault(); // Estää sivun vierittymisen
            // Vaihda paussitilan ja normaalitilan välillä
            if (isPaused) {
                resumeGame();
                window.isPaused = false; 
            } else {
                pauseGame();
                window.isPaused = true; 
            }
        }
    }

    // --- Numeronäppäimet: Kontrolliryhmät / Control Groups ---
    const numKey = parseInt(event.key);
    if (!isNaN(numKey) && numKey >= 0 && numKey <= 9) {
        event.preventDefault();

        // CTRL + [0-9] = Luo/aseta ryhmä
        if (event.ctrlKey || event.metaKey) {
            const currentSelection = getSelectedShips();
            const selectedShipIds = currentSelection.map(ship => ship.userData.shipData._id);
            controlGroups[numKey] = selectedShipIds;
            updateGroupsPanel(); // Päivitä UI-napit
            return;
        }

        // Pelkkä [0-9] = Valitse / Tarkenna ryhmään
        const now = performance.now();
        const shipIds = controlGroups[numKey];

        if (shipIds && shipIds.length > 0) {
            if (lastGroupKey === numKey && now - lastGroupKeyTime < DOUBLE_PRESS_THRESHOLD) {
                // TUPLAPAINALLUS -> Valitse ja Tarkenna
                focusOnGroup(shipIds);
            } else {
                // YKSITTÄINEN KLIKKAUS -> Valitse
                selectShipsByIds(shipIds);
            }
        }
        lastGroupKey = numKey;
        lastGroupKeyTime = now;
        }
    });

    // --- Pelin nopeussäätimet ---
    document.querySelectorAll('#speedPanel button').forEach(btn => {
        btn.addEventListener('click', () => {
            
            const val = btn.dataset.speed;
            
            // Poista active kaikilta
            document.querySelectorAll('#speedPanel button').forEach(b => b.classList.remove('active'));
            
            if (val === 'pause') {
                if (isPaused) {
                    resumeGame();
                    // Palauta edellinen nopeus aktiiviseksi
                    document.querySelector(`#speedPanel button[data-speed="${GAME_SPEED}"]`)?.classList.add('active');
                } else {
                    pauseGame();
                    btn.classList.add('active');
                }
            } else {
                GAME_SPEED = Number(val);
                window.GAME_SPEED = GAME_SPEED;
                btn.classList.add('active');
                if (isPaused) {
                    resumeGame();
                }
                
                // Lähetä nopeus serverille
                if (currentGameId) {
                    socket.emit('set_game_speed', { 
                        gameId: currentGameId, 
                        speed: GAME_SPEED 
                    });
                }
            }
        });

    // --- Hiiren hover-äänet kaikille napeille ---
    document.querySelectorAll('button').forEach(button => {
        button.addEventListener('mouseenter', async () => {
            await initAudio(); // Yritä alustaa äänet HETI kun hiiri menee napin päälle
            playButtonHoverSound(); // Soita ääni
            });
        });
    });
}


/* ========================================================================== */
/* AUDIO FUNCTIONS                                                           */
/* ========================================================================== */

/**
 * @summary Alustaa ja luo kaikki pelissä käytettävät Tone.js-äänisolmut (syntetisaattorit ja efektit).
 * @description Tämä funktio on pelin "äänimoottorin" sydän. Se luo pää-äänenvoimakkuuden säätimen,
 * taustalla soivan ambient-dronen ja sen efektiketjun (filtteri, panneri) sekä erilliset
 * syntetisaattorit käyttöliittymän nappien klikkaus- ja hover-äänille.
 * @private
 */
function initializeAudioNodes() { 
    if (!audioContextStarted) return; 

    // Luo pää-äänenvoimakkuuden säädin (-10 dB) ja kytkee sen kaiuttimiin.
    masterVolume = new Tone.Volume(-10).toDestination(); 

    // --- Nappien ääniefektit ---
    // Lyhyt, terävä valkoisen kohinan pulssi klikkaukselle.
    synthButtonClick = new Tone.NoiseSynth({
        noise: { type: 'white' },
        volume: -15, 
        envelope: { attack: 0.001, decay: 0.015, sustain: 0, release: 0.05 } 
    }).connect(masterVolume);

    // Erittäin lyhyt ja hiljainen pinkin kohinan pulssi hover-efektille.
    synthButtonHoverEffect = new Tone.NoiseSynth({
        noise: { type: 'pink' }, 
        volume: -20, 
        envelope: { attack: 0.001, decay: 0.005, sustain: 0, release: 0.03 }
    }).connect(masterVolume);

    // --- Ambient-taustadronen luonti ---
    // Luo stereopannerin, joka liikuttaa ääntä hitaasti vasemman ja oikean kanavan välillä.
    ambientPanner = new Tone.Panner(0).connect(masterVolume);
    // Luo automaattisen filtterin, joka moduloi äänen taajuutta hitaasti, luoden elävän ja sykkivän efektin.
    ambientFilter = new Tone.AutoFilter({
        frequency: "8m",        // "8m" on Tone.js:n notaatio hitaalle, 8 mittaa kestävälle LFO-syklille.
        type: "sine", depth: 0.7, baseFrequency: 60, octaves: 3,
        filter: { type: "lowpass", rolloff: -12, Q: 1 }
    }).connect(ambientPanner).start();

    // Luo varsinaisen äänen: paksu, matala saha-aaltoskillaattori, joka luo ambientin taustahuminan.
    ambientHum = new Tone.FatOscillator({
        frequency: 50, type: "sawtooth", detune: 0.6, spread: 15, volume: -10, 
    }).connect(ambientFilter);
}

/**
 * @summary Käynnistää selaimen äänikontekstin ja aloittaa äänien toiston.
 * @description Selaimet vaativat käyttäjän interaktion (esim. klikkaus) ennen kuin ääniä
 * voidaan toistaa. Tämä funktio kutsuu `Tone.start()`-metodia, joka hoitaa tämän.
 * Onnistuessaan se kutsuu `initializeAudioNodes()` ja käynnistää taustahuminan.
 * @returns {Promise<boolean>} Palauttaa `true`, jos alustus onnistui, muuten `false`.
 */
async function initAudio() { 
    if (audioContextStarted) return true;       // Estää uudelleenalustuksen.
    try {
        await Tone.start();
        audioContextStarted = true;
        initializeAudioNodes();
        if (ambientHum && ambientHum.state !== "started") {
            ambientHum.start();
        }
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * @summary Soittaa napin klikkausäänen.
 * @description Sisältää cooldown-logiikan, joka estää äänen soittamisen liian
 * nopeasti peräkkäin, mikä voisi aiheuttaa "räminää".
 */
function playButtonClickSound() { 
    if (!audioContextStarted || !synthButtonClick) return;
    const now = Tone.now();
    if (now - lastButtonClickTime < BUTTON_CLICK_COOLDOWN) return;
    try {
        // triggerAttackRelease soittaa erittäin lyhyen nuotin (tässä 64-osanuotin).
        synthButtonClick.triggerAttackRelease("64n", now); 
        lastButtonClickTime = now;
    } catch (e) {
    }
}

/**
 * @summary Soittaa hiiren hover-äänen.
 * @description Sisältää vastaavan cooldown-logiikan kuin klikkausääni.
 */
function playButtonHoverSound() { 
    if (!audioContextStarted || !synthButtonHoverEffect) return;
    const now = Tone.now();
    if (now - lastButtonHoverTime < BUTTON_HOVER_COOLDOWN) return;
    try {
        synthButtonHoverEffect.triggerAttackRelease("128n", now); 
        lastButtonHoverTime = now;
    } catch (e) {
    }
}


/* ========================================================================== */
/* UI HELPER FUNCTIONS                                                       */
/* ========================================================================== */

/**
 * @summary Alustaa työkaluvihjeiden (tooltips) toiminnallisuuden.
 * @description Tämä funktio lisää tapahtumankuuntelijat kaikkiin planeettavalikon nappeihin.
 * Kun hiiri viedään napin päälle, se lukee `data-tooltip-text`-attribuutissa olevan
 * tekstin ja näyttää sen kustomoidussa tooltip-elementissä.
 */
function setupTooltips() {
    const tooltipElement = document.getElementById('custom-tooltip');
    if (!tooltipElement) return;
    
    document.querySelectorAll('#planetMenu button').forEach(btn => {
        // Kun hiiri menee napin päälle, näytä tooltip.
        btn.addEventListener('mouseenter', (e) => {
            const tooltipText = btn.dataset.tooltipText;
            if (tooltipText) {
                tooltipElement.innerHTML = tooltipText;
                const rect = btn.getBoundingClientRect();       // Hae napin sijainti ruudulla.
                tooltipElement.style.left = `${rect.left}px`;
                tooltipElement.style.top = `${rect.bottom + 5}px`;  // Aseta napin alapuolelle.
                tooltipElement.style.display = 'block';
                tooltipElement.classList.add('visible');
            }
        });
        // Kun hiiri poistuu napin päältä, piilota tooltip.
        btn.addEventListener('mouseleave', () => {
            tooltipElement.classList.remove('visible');
        });
    });
}

/**
 * @summary Päivittää ruudun alalaidassa näkyvän laivaston kontrolliryhmäpaneelin.
 * @description Tämä funktio on vastuussa ryhmänappien dynaamisesta luomisesta.
 * Se suorittaa seuraavat toimet:
 * 1. Siivoaa tuhoutuneet alukset pois kaikista ryhmistä.
 * 2. Laskee kunkin ryhmän alusten määrän ja tyypit.
 * 3. Luo ja näyttää napit ruudulla.
 * 4. Piilottaa koko paneelin, jos yhtään ryhmää ei ole olemassa.
 */
function updateGroupsPanel() {
    const groupsButtonsContainer = document.getElementById('groupsButtonsContainer');
    const groupsPanel = document.getElementById('groupsPanel');
    if (!groupsButtonsContainer || !groupsPanel) return;

    groupsButtonsContainer.innerHTML = '';
    let hasVisibleGroups = false;

    // Varmistetaan, että pelin tila on ladattu.
    if (!gameState || !gameState.ships) {
        groupsPanel.style.display = 'none';
        return;
    }
    
    // Luodaan Set-rakenne kaikista elossa olevista aluksista tehokasta hakua varten.
    const liveShipIds = new Set(gameState.ships.map(s => s._id.toString()));

    // Käydään läpi kaikki kontrolliryhmät numerojärjestyksessä.
    Object.keys(controlGroups).sort((a, b) => a - b).forEach(key => {
        // Poistetaan ryhmästä alukset, joita ei enää ole olemassa.
        controlGroups[key] = controlGroups[key].filter(id => liveShipIds.has(id));
        
        const liveShipsInGroup = controlGroups[key];
        if (liveShipsInGroup.length === 0) {
            delete controlGroups[key];      // Poista tyhjä ryhmä.
            return;
        }

        hasVisibleGroups = true;
        // Lasketaan alustyypit näyttöä varten.
        const counts = { Fighter: 0, Destroyer: 0, Cruiser: 0, 'Slipstream Frigate': 0 };
        
        liveShipsInGroup.forEach(shipId => {
            const shipData = gameState.ships.find(s => s._id.toString() === shipId);
            if (shipData && counts.hasOwnProperty(shipData.type)) {
                counts[shipData.type]++;
            }
        });

        // Luodaan ja lisätään uusi nappi DOM:iin.
        const btn = document.createElement('button');
        btn.className = 'group-btn';
        btn.dataset.groupId = key;
        btn.innerHTML = `
            <div class="font-semibold text-sm">Group ${key}</div>
            <div class="text-xs">F:${counts.Fighter}, D:${counts.Destroyer}, C:${counts.Cruiser}</div>
            <div class="text-xs font-bold">Total: ${liveShipsInGroup.length}</div>
        `;

        // Lisätään tapahtumankuuntelija, joka valitsee ja tarkentaa ryhmään hiirellä klikatessa.
        btn.addEventListener('click', () => {
            const shipIds = controlGroups[key];
            if (shipIds && shipIds.length > 0) {
                focusOnGroup(shipIds); // Klikkaus tekee sekä valinnan että tarkennuksen
            }
        });
        groupsButtonsContainer.appendChild(btn);
    });

    // Näytä paneeli vain, jos on olemassa vähintään yksi ryhmä.
    groupsPanel.style.display = hasVisibleGroups ? 'flex' : 'none';
}


/* ========================================================================== */
/*  AI PLAYER SETTINGS                                                        */
/* ========================================================================== */

/**
 * @summary Luo ja päivittää dynaamisesti tekoälyvastustajien värivalitsimet aloitusvalikkoon.
 * @description Tämä funktio lukee "Number of AI Opponents" -valinnan arvon ja luo sen
 * perusteella oikean määrän HTML-elementtejä (label + input type="color").
 * Tämä mahdollistaa sen, että pelaaja voi kustomoida vastustajiensa värejä ennen pelin alkua.
 * Funktio kutsutaan aina, kun pelaaja muuttaa vastustajien määrää.
 */
function setupAIPlayerSettings() {
    // Haetaan valittu pelaajamäärä.
    const numPlayers = parseInt(numAiPlayersSelect.value);
    // Tyhjennetään ensin vanhat asetus-elementit, jotta vältetään duplikaatit.
    aiPlayerSettingsContainer.innerHTML = '';
    
    // Luodaan uudet elementit silmukassa.
    for (let i = 0; i < numPlayers; i++) {
        const configDiv = document.createElement('div');
        configDiv.className = 'ai-player-config';
        // Luodaan HTML-rakenne, joka sisältää tekstikentän ja värivalitsimen.
        // Oletusväri otetaan DEFAULT_AI_COLORS-taulukosta.
        configDiv.innerHTML = `
            <label>AI Player ${i + 1} Color:</label>
            <input type="color" class="ai-color-picker" data-ai-index="${i}" 
                   value="#${DEFAULT_AI_COLORS[i].toString(16).padStart(6, '0')}">
        `;
        aiPlayerSettingsContainer.appendChild(configDiv);
    }
}


/* ========================================================================== */
/*  GAME LIFECYCLE & STATE MANAGEMENT                                         */
/* ========================================================================== */

/**
 * @summary Nollaa kaikkien käyttöliittymän edistymispalkkien leveyden.
 * @description Apufunktio, jota kutsutaan, kun uusi peli aloitetaan tai
 * valittu tähti vaihtuu. Varmistaa, ettei vanhoja edistymistietoja jää näkyviin.
 */
function resetAllProgressBars() {
    // Nollaa kaikki planetary progress barit
    document.querySelectorAll('.button-progress-bar').forEach(bar => {
        bar.style.width = '0%';
    });
    
    // Nollaa ship progress barit
    ['Fighter', 'Destroyer', 'Cruiser', 'SlipstreamFrigate'].forEach(type => {
        const bar = document.getElementById(`progress-${type.replace(/ /g, '')}`);
        if (bar) bar.style.width = '0%';
    });
    
    // Nollaa total progress barit
    if (planetaryQueueTotalProgressFill) {
        planetaryQueueTotalProgressFill.style.width = '0%';
        planetaryQueueTotalProgressText.textContent = 'Idle';
    }
    
    if (shipQueueTotalProgressFill) {
        shipQueueTotalProgressFill.style.width = '0%';
        shipQueueTotalProgressText.textContent = 'Idle';
    }
}

/**
 * @summary Palauttaa koko client-sovelluksen alkutilaan.
 * @description Tämä on kriittinen funktio, joka suoritetaan aina ennen uuden pelin aloittamista.
 * Se kutsuu `scene.js`:n siivousfunktiota, nollaa kaikki globaalit tilamuuttujat
 * ja piilottaa pelin käyttöliittymäelementit.
 */
function resetClientState() {

    isPaused = false;
    window.isPaused = false;
    GAME_SPEED = 1;
    window.GAME_SPEED = 1;

    // Pysäytetään vanha interpolointiajastin
    if (progressInterpolationInterval) {
        clearInterval(progressInterpolationInterval);
        progressInterpolationInterval = null;
    }

    // 1. Kutsu `scene.js`:ää siivoamaan kaikki 3D-objektit.
    cleanupScene();

    // 2. Nollaa kaikki clientin loogiset tilamuuttujat.
    gameState = null;
    gameInProgress = false;
    currentGameId = null;
    myPlayerId = null;
    selectedStar = null;
    playerResources = { credits: 1000, minerals: 500 }; // Palauta alkuarvoihin

    // Tyhjennetään planetary menun construction progressbarit
    constructionProgressData.clear();
    resetAllProgressBars();  // Nollaa visuaaliset progress barit

    // 3. Piilota pelin UI-elementit.
    hidePlanetMenu();
    const selectedUnitsPanel = document.getElementById('selectedUnitsPanel');
    if (selectedUnitsPanel) selectedUnitsPanel.style.display = 'none';
}

/**
 * @summary Käsittelee uuden pelin aloituslogiikan.
 * @description Tämä funktio suoritetaan, kun pelaaja painaa "Start Game" -nappia.
 * Se nollaa ensin clientin tilan, kerää asetukset käyttöliittymästä, lähettää ne
 * backendille uuden pelin luomiseksi ja käsittelee vastauksena saadun pelin alkutilan.
 */
async function handleStartGame() {
    try {
        await initAudio();
        playButtonClickSound();
        // Alustetaan pelin tila ja UI.
        isPaused = false;
        window.isPaused = false;
        GAME_SPEED = 1;
        window.GAME_SPEED = 1;
        updatePauseUI(); // Päivitä pause UI pois
        
        // Reset speed buttons
        document.querySelectorAll('#speedPanel button').forEach(btn => btn.classList.remove('active'));
        document.querySelector('#speedPanel button[data-speed="1"]')?.classList.add('active');

        // Siivotaan aina vanha peli pois ennen uuden aloittamista.
        resetClientState();

        startGameButton.disabled = true;
        startGameButton.querySelector('span').textContent = 'Starting...';
        
        // Kerätään pelin asetukset aloitusvalikosta.
        const numAIPlayers = parseInt(numAiPlayersSelect.value);
        const colorPickers = document.querySelectorAll('.ai-color-picker');
        const aiColors = [];
        for (let i = 0; i < numAIPlayers; i++) {
            const colorHex = colorPickers[i] ? colorPickers[i].value : `#${DEFAULT_AI_COLORS[i].toString(16).padStart(6, '0')}`;
            aiColors.push(colorHex);
        }
        const gameConfig = {
            humanName: "Player",
            humanColor: "#68c5ff",
            numAiPlayers: numAIPlayers,
            aiColors: aiColors,
            starCount: parseInt(starCountSelect.value),
            lobbyHost: "client",
            speed: 1
        };
        
        // Tehdään HTTP-kutsu backendiin uuden pelin luomiseksi.
        const result = await createNewGame(gameConfig);
        
        if (!result.success || !result.initialState) {
            throw new Error(result.message || "Failed to create game or receive initial state");
        }
        
        // Kun peli on luotu, käsitellään serverin palauttama alkutila.
        // Tämä rakentaa 3D-maailman ja alustaa clientin datan.
        handleInitialState(result.initialState);
        
        // Liitytään WebSocket-huoneeseen, jotta aletaan vastaanottaa reaaliaikaisia päivityksiä.
        // kerro serverille, että se voi käynnistää pelin.
        socket.emit("join_game", { gameId: result.initialState.gameId });
        
    } catch (error) {
        alert("Failed to start game: " + error.message);
        // Varmistetaan, että nappeja voi taas käyttää, jos käynnistys epäonnistui
        startGameButton.disabled = false;
        startGameButton.querySelector('span').textContent = 'Start Game';
    }
}

/**
 * @summary Lähettää uuden pelin luontipyynnön backendille.
 * @param {object} payload - Pelin konfiguraatiotiedot.
 * @returns {Promise<object>} Palauttaa serverin vastauksen, joka sisältää pelin alkutilan.
 */
async function createNewGame(payload) {
    const response = await fetch(`${BACKEND_URL}/api/games/new`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
    }
    
    return response.json();
}

/**
 * @summary Käsittelee serveriltä saadun pelin alkutilan ("snapshot").
 * @description Tämä on keskeinen funktio, joka herättää pelin eloon clientillä.
 * Se tallentaa pelin tilan, oman pelaaja-ID:n, ja kutsuu `scene.js`:n
 * `buildFromSnapshot`-funktiota, joka rakentaa 3D-maailman. Lopuksi se
 * käynnistää animaatiosilmukan ja näyttää pelin käyttöliittymän.
 * @param {object} snap - Serveriltä saatu pelin alkutila.
 */
function handleInitialState(snap) {
    currentGameId = snap.gameId;
    gameState = snap;
    gameInProgress = true;
    
    // Set the player ID
    myPlayerId = snap.humanPlayerId;
    
    // Update resources if provided
    if (snap.resources && myPlayerId) {
        playerResources = snap.resources[myPlayerId] || playerResources;
    }
    
    // Tallennetaan pelaajadata globaaliin `window`-objektiin, jotta scene.js pääsee siihen käsiksi.
    window.gameData = {
        players: snap.players || [],
        humanPlayerId: myPlayerId
    };
    
    // Build the game world
    buildFromSnapshot(snap);
    
    // Start the animation loop
    startAnimateLoop();
    
    // Switch to game UI
    showGameUI();
    
}

/**
 * @summary Käsittelee "Resume Game" -napin painalluksen.
 */
function handleResumeGame() {
    playButtonClickSound();
    if (gameInProgress) {
        uiState = 'playing';
        updateUIState();
    }
}

/**
 * @summary Lähettää serverille komennon laittaa peli paussille.
 */
function pauseGame() {
    if (currentGameId) {
        socket.emit('pause_game', { gameId: currentGameId });
        isPaused = true;
        window.isPaused = true;
        updatePauseUI();
    }
}

/**
 * @summary Päivittää käyttöliittymän vastaamaan paussitilaa.
 */
function updatePauseUI() {
    // Lisätään/poistetaan CSS-luokka, jolla voidaan tyylitellä koko UI:ta pausella.
    if (isPaused) {
        document.body.classList.add('paused');
    } else {
        document.body.classList.remove('paused');
    }

    // Päivitetään nopeuspaneelin nappien korostus.
    document.querySelectorAll('#speedPanel button').forEach(btn => btn.classList.remove('active'));
    if (isPaused) {
        // Korosta pause-nappi
        document.querySelector('#speedPanel button[data-speed="pause"]')?.classList.add('active');
    } else {
        // Korosta nykyinen pelinopeusnappi
        document.querySelector(`#speedPanel button[data-speed="${GAME_SPEED}"]`)?.classList.add('active');
    }
    
    // Näytetään/piilotetaan suuri "PAUSED"-teksti ruudun ylälaidassa.
    let pauseIndicator = document.getElementById('pauseIndicator');
    if (!pauseIndicator) {
        pauseIndicator = document.createElement('div');
        pauseIndicator.id = 'pauseIndicator';
        pauseIndicator.textContent = 'PAUSED';
        pauseIndicator.style.cssText = `
            position: fixed;
            top: 20px; 
            left: 50%;
            transform: translateX(-50%); 
            font-size: 64px; 
            font-weight: bold;
            color: rgba(255, 255, 255, 0.6);
            pointer-events: none;
            z-index: 100;
            display: none;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        `;
        document.body.appendChild(pauseIndicator);
    }
    
    pauseIndicator.style.display = isPaused ? 'block' : 'none';
}

/**
 * @summary Lähettää serverille komennon jatkaa peliä.
 */
function resumeGame() {
    if (currentGameId) {
        socket.emit('resume_game', { gameId: currentGameId });
        isPaused = false;
        window.isPaused = false;
        updatePauseUI();
    }
}

/**
 * @summary Näyttää aloitusvalikon ja pausetaa pelin, jos se on käynnissä.
 */
function showStartScreen() {
    uiState = 'startScreen';
    updateUIState();
    // Jos peli on käynnissä, pauseta se
    if (gameInProgress && currentGameId) {
        socket.emit('pause_game', { gameId: currentGameId });
    }
}

/**
 * @summary Näyttää pelinäkymän ja käynnistää edistymispalkkien animaation.
 */
function showGameUI() {
    uiState = 'playing';
    updateUIState();
    startProgressInterpolation(); 
}

/**
 * @summary Pääfunktio, joka hallitsee näkymien (aloitusvalikko vs. pelinäkymä) vaihtoa.
 * @description Tämä funktio lukee `uiState`-muuttujaa ja piilottaa tai näyttää
 * tarvittavat pääelementit.
 */
function updateUIState() {
    switch (uiState) {
        case 'startScreen':
        case 'paused':
            startScreen.style.display = 'flex';
            uiContainer.style.display = 'none';
            
            startGameButton.disabled = false;

            if (gameInProgress && uiState === 'paused') {
                startGameButton.querySelector('span').textContent = 'Start New Game';
                resumeGameButton.style.display = 'block';
            } else {
                startGameButton.querySelector('span').textContent = 'Start Game';
                resumeGameButton.style.display = 'none';
            }
            break;
            
        case 'playing':
            startScreen.style.display = 'none';
            uiContainer.style.display = 'flex';
            break;
    }
}


/* ========================================================================== */
/*  STAR SELECTION & PLANET MENU                                             */
/* ========================================================================== */

/**
 * @summary Käsittelee tähden valintatapahtuman ja päivittää käyttöliittymän.
 * @description Tämä on keskitetty käsittelijä, joka suoritetaan aina, kun pelaaja
 * valitsee tai poistaa valinnan tähdeltä. Se vastaanottaa `scene.js`:n lähettämän
 * `starSelected`-tapahtuman. Sen päätehtävä on päivittää clientin sisäinen tila
 * (`selectedStar`) ja kutsua `showPlanetMenu`-funktiota näyttämään oikea valikko.
 *
 * @param {object|null} starData - Valitun tähden dataobjekti tai `null`, jos valinta poistetaan.
 */
function handleStarSelection(starData) {
    // Jos `starData` on `null`, se tarkoittaa, että pelaaja on poistanut valinnan
    // (esim. klikkaamalla tyhjää). Nollataan tila ja piilotetaan valikko.
    if (!starData) {
        selectedStar = null;
        hidePlanetMenu();
        resetAllProgressBars();
        return;
    }
    // Nollataan aina vanhat edistymispalkit ennen uuden valikon näyttämistä.
    resetAllProgressBars();
    // Tallennetaan valittu tähti globaaliin muuttujaan, jotta muut funktiot voivat käyttää sitä.
    selectedStar = starData; 
    // Kutsutaan funktiota, joka rakentaa ja näyttää planeettavalikon.
    showPlanetMenu(starData);
}


/**
 * @summary Rakentaa ja näyttää valitun tähden tietopaneelin (Planet Menu).
 * @description Tämä on pääfunktio planeettavalikon hallintaan. Se kutsutaan aina, kun
 * tähti valitaan. Funktio on vastuussa kaikkien tietojen päivittämisestä ja sen
 * päättämisestä, näytetäänkö pelaajalle toimintonapit (jos tähti on oma) vai
 * pelkät tiedot (jos tähti ei ole oma).
 *
 * @param {object} starData - Valitun tähden dataobjekti.
 */
function showPlanetMenu(starData) {
    // VAIHE 1: Päivitä aina näkyvät perustiedot.
    // Nämä näytetään riippumatta siitä, kuka tähden omistaa.
    planetMenuTitle.textContent = `Star ${starData.name}${starData.isHomeworld ? ' (Homeworld)' : ''}`;
    planetOwnerDisplay.textContent = `Owner: ${getOwnerName(starData.ownerId)}`;
    planetInfraLevelDisplay.textContent = `Infrastructure Level: ${starData.infrastructureLevel}`;
    planetDefenseDisplay.textContent = `Defense: ${starData.defenseLevel}`;
    planetPopulationDisplay.textContent = `Population: ${starData.population}`;
    planetMinesDisplay.textContent = `Mines: ${starData.mines}`;
    planetShipyardLevelDisplay.textContent = `Shipyard Level: ${starData.shipyardLevel}`;
    
    // VAIHE 2: Päivitä dynaamiset UI-elementit, kuten jonot ja valloituspalkki.
    updateQueueDisplays(starData);
    updateConquestProgressUI(starData);
    
    // VAIHE 3: Päätä, mitkä napit näytetään omistajuuden perusteella.
    // Tämä on keskeinen logiikan haara.
    if (isPlayerOwned(starData)) {
        // Jos tähti on pelaajan oma, kutsutaan funktiota, joka näyttää ja päivittää kaikki toimintonapit.
        showPlayerButtons(starData);
    } else {
        // Jos tähti ei ole oma, kutsutaan apufunktiota, joka piilottaa kaikki toimintonapit.
        hidePlayerButtons();
    }

    // VAIHE 4: Lopuksi, tee koko paneeli näkyväksi.
    planetMenu.style.display = 'block';
}


/**
 * @summary Piilottaa planeettavalikon ja siihen liittyvät UI-elementit.
 * @description Apufunktio, jota kutsutaan, kun pelaaja poistaa valinnan tähdeltä
 * (esim. klikkaamalla tyhjää) tai kun valitaan planeetta, joka ei ole oma.
 * Varmistaa, että kaikki paneeliin liittyvät osat, kuten valloituspalkki, piilotetaan.
 */
function hidePlanetMenu() {
    planetMenu.style.display = 'none';

    // Piilota myös valloitukseen liittyvät UI-elementit,
    // jotta ne eivät jää näkyviin valikon piilottamisen jälkeen.
    const conquestProgressContainer = document.getElementById('conquestProgressContainer');
    const conqueringStatusText = document.getElementById('conqueringStatusText');
    
    if (conquestProgressContainer) {
        conquestProgressContainer.style.display = 'none';
    }
    if (conqueringStatusText) {
        conqueringStatusText.style.display = 'none';
    }
}


/**
 * @summary Tarkistaa, onko annettu tähti pelaajan oma.
 * @description Yksinkertainen, mutta elintärkeä apufunktio, jota käytetään
 * jatkuvasti eri puolilla käyttöliittymää päättämään, tuleeko pelaajalle
 * näyttää toimintonappeja vai ei.
 *
 * @param {object} starData - Tarkasteltavan tähden dataobjekti.
 * @returns {boolean} Palauttaa `true`, jos tähti on pelaajan omistuksessa, muuten `false`.
 */
function isPlayerOwned(starData) {
    // Jos tähdellä ei ole omistajaa tai client ei tiedä omaa ID:tään, palautetaan false.
    if (!starData.ownerId || !myPlayerId) return false;
    
    // Muunnetaan molemmat ID:t merkkijonoiksi vertailun varmistamiseksi,
    // koska ne voivat olla joko merkkijonoja tai MongoDB:n ObjectId-objekteja.
    const ownerIdStr = typeof starData.ownerId === 'object' ? starData.ownerId.toString() : starData.ownerId;
    const myIdStr = typeof myPlayerId === 'object' ? myPlayerId.toString() : myPlayerId;
    
    // Palautetaan tosi vain, jos ID:t täsmäävät.
    return ownerIdStr === myIdStr;
}


/**
 * @summary Muuntaa pelaajan ID:n ihmisluettavaksi nimeksi.
 * @description Tämä on käyttöliittymän apufunktio, joka ottaa vastaan omistajan ID:n
 * ja palauttaa helppolukuisen nimen, kuten "Player", "Neutral" tai "AI #1".
 * Se hakee nimen `window.gameData`-objektista, joka alustetaan pelin alussa.
 *
 * @param {string|ObjectId|null} ownerId - Omistajan ID, joka voi olla null (neutraali).
 * @returns {string} Palauttaa omistajan nimen.
 */
function getOwnerName(ownerId) {
    // Jos ID:tä ei ole, kyseessä on neutraali tähti.
    if (!ownerId) return 'Neutral';
    // Jos ID on sama kuin omani, palautetaan yleinen "Player".
    if (ownerId === myPlayerId) return 'Player';
    
    // Etsitään pelaajadataa `window.gameData`-objektista, joka sisältää kaikkien pelaajien tiedot.
    const gameData = window.gameData;
    if (gameData && gameData.players) {
        const ownerPlayer = gameData.players.find(p => p._id === ownerId);
        if (ownerPlayer) {
            // Jos pelaaja löytyy, palautetaan sen nimi (esim. "AI #1").
            return ownerPlayer.name;
        }
    }
    // Jos pelaajaa ei jostain syystä löydy, palautetaan virheilmoitus debuggausta varten
    return `Unknown (${ownerId})`;
}


/**
 * @summary Näyttää pelaajan toimintonapit planeettavalikossa.
 * @description Tämä funktio on vastuussa siitä, että pelaajan omistaman tähden
 * valikossa näytetään oikeat rakennus- ja päivitysnapit. Se tekee karkean jaon
 * (esim. "näytä telakkanappi jos telakkaa ei ole") ja kutsuu sitten
 * `updateButtonStates`-funktiota, joka hoitaa yksityiskohtaisemman logiikan,
 * kuten resurssien tarkistuksen ja nappien disabloinnin.
 *
 * @param {object} starData - Valitun tähden dataobjekti.
 */
function showPlayerButtons(starData) {
    // Näytä/piilota telakkanapit sen perusteella, onko telakka jo olemassa.
    const hasShipyard = starData.shipyardLevel > 0;
    buildShipyardButton.style.display = !hasShipyard ? 'block' : 'none';
    upgradeShipyardButton.style.display = hasShipyard ? 'block' : 'none';
    
    // Näytetään perusrakennusnapit aina, koska niiden rajoitukset
    // tarkistetaan `updateButtonStates`-funktiossa.
    buildMineButton.style.display = 'block';
    buildDefenseButton.style.display = 'block';
    
    // Näytetään alusten rakennusnapit vain, jos telakan taso riittää.
    const shipButtons = [
        { button: buildFighterButton, requiredLevel: 1 },
        { button: buildDestroyerButton, requiredLevel: 2 },
        { button: buildCruiserButton, requiredLevel: 3 },
        { button: buildSlipstreamFrigateButton, requiredLevel: 4 }
    ];
    shipButtons.forEach(({ button, requiredLevel }) => {
        if (button) {
            button.style.display = starData.shipyardLevel >= requiredLevel ? 'block' : 'none';
        }
    });
    
    // Kutsutaan pääfunktiota, joka hoitaa kaikkien nappien yksityiskohtaisen
    // tilan (hinta, tooltip, disabled-tila) päivittämisen.
    updateButtonStates(starData);
}


/**
 * @summary Piilottaa kaikki pelaajan toimintonapit planeettavalikosta.
 * @description Tämä on yksinkertainen apufunktio, jota kutsutaan, kun pelaaja valitsee
 * tähden, jota hän ei omista, tai kun planeettavalikko suljetaan. Se käy läpi
 * ennalta määritellyn listan kaikista rakennus- ja päivitysnapeista ja asettaa niiden
 * display-tyylin arvoon 'none'.
 */
function hidePlayerButtons() {
    [upgradeInfrastructureButton, buildGalacticHubButton, buildShipyardButton, upgradeShipyardButton,
     buildMineButton, buildDefenseButton, buildFighterButton, buildDestroyerButton,
     buildCruiserButton, buildSlipstreamFrigateButton].forEach(button => {
        if (button) button.style.display = 'none';
    });
}


/**
 * @summary Päivittää kaikkien planeettavalikon nappien tilan (näkyvyys, disabled-tila, teksti, tooltip).
 * @description Tämä on yksi clientin monimutkaisimmista funktioista. Se on keskitetty paikka,
 * joka määrittää kaikkien toimintonappien ulkoasun ja toiminnallisuuden perustuen
 * valitun tähden tilaan, pelaajan resursseihin ja rakennusjonoihin.
 * @param {object} starData - Valitun tähden dataobjekti.
 */
function updateButtonStates(starData) {
    // Vartiolauseke (Guard Clause): Jos tähti ei ole pelaajan oma, piilotetaan kaikki
    // toimintonapit ja lopetetaan funktion suoritus välittömästi. Tämä on tärkein sääntö
    if (!isPlayerOwned(starData)) {
        hidePlayerButtons();
        return;
    }

    // Haetaan nykyisen infratason mukaiset rakennusrajat.
    const currentInfraLimits = INFRA_LIMITS[starData.infrastructureLevel] || INFRA_LIMITS[1];
    
    // Lasketaan kerralla, kuinka monta kutakin tyyppiä on jonossa. Tehokkaampaa kuin toistuvat tarkistukset.
    const planetaryQueue = starData.planetaryQueue || [];
    const queuedMines = planetaryQueue.filter(item => item.type === 'Mine').length;
    const queuedDefense = planetaryQueue.filter(item => item.type === 'Defense Upgrade').length;
    const queuedShipyard = planetaryQueue.filter(item => 
        item.type === 'Shipyard' || item.type.startsWith('Shipyard Lvl')).length;
    const queuedInfra = planetaryQueue.filter(item => 
        item.type.startsWith('Infrastructure')).length;
    
    // --- INFRASTRUCTURE JA GALACTIC HUB -logiikka ---
    // Tämä lohko päättää, näytetäänkö "Upgrade Infrastructure"- vai "Build Galactic Hub" -nappi.
    const hasInfraInQueue = queuedInfra > 0;
    const hasHubInQueue = planetaryQueue.some(item => item.type === 'Galactic Hub');

    // Tapaus 1: Infrastruktuuria voi vielä päivittää (taso < 5)
    if (starData.infrastructureLevel < 5) {
        upgradeInfrastructureButton.style.display = 'block';
        buildGalacticHubButton.style.display = 'none';

        const cost = getInfrastructureCost(starData.infrastructureLevel);
        const canAffordIt = canAfford(cost);
        const nextLvl = starData.infrastructureLevel + 1;

        // Nappi on pois käytöstä, jos ei ole varaa TAI jos infrakehitys JO jonossa.
        upgradeInfrastructureButton.disabled = !isPlayerOwned(starData) || !canAffordIt || hasInfraInQueue;
        
        // Asetetaan tooltip kertomaan, miksi nappi on mahdollisesti pois käytöstä.
        if (hasInfraInQueue) {
            upgradeInfrastructureButton.title = 'Infrastructure upgrade already in queue';
        } else if (!canAffordIt) {
            upgradeInfrastructureButton.title = `Insufficient resources (need ${cost.credits}C, ${cost.minerals}M)`;
        } else {
            upgradeInfrastructureButton.title = `Upgrade to Infrastructure Level ${nextLvl}`;
        }
        
        // Asetetaan napin teksti näyttämään hinta ja seuraava taso.
        upgradeInfrastructureButton.querySelector('span').textContent = `Upgrade Infra (${cost.credits}C, ${cost.minerals}M)`;
    } 

    // Tapaus 2: Infra on tasolla 5. Näytetään joko Hubin rakennusnappi tai ilmoitus valmiista Hubista.
    else {
        // A) Hub on jo valmis tai rakenteilla. Näytetään harmaa nappi
        if (starData.hasGalacticHub) {
            upgradeInfrastructureButton.style.display = 'block';
            buildGalacticHubButton.style.display = 'none';

            upgradeInfrastructureButton.disabled = true;
            upgradeInfrastructureButton.querySelector('span').textContent = 'GALACTIC HUB';
            upgradeInfrastructureButton.title = 'Galactic Hub already built on this star.';
        }
        // B) Hubia ei ole valmiina. Näytetään rakennusnappi.
        else {
            upgradeInfrastructureButton.style.display = 'none';
            buildGalacticHubButton.style.display = 'block';
            if (hasHubInQueue) {
                buildGalacticHubButton.disabled = true;
                buildGalacticHubButton.title = 'Galactic Hub is already in the construction queue.';
                // Näytetään teksti, vaikka on jonossa
                buildGalacticHubButton.querySelector('span').textContent = 'Building Hub...';
            } else {
                const cost = { credits: 1000, minerals: 1000 };
                const canAffordIt = canAfford(cost);
                buildGalacticHubButton.disabled = !canAffordIt;
                buildGalacticHubButton.title = canAffordIt ? 'Build a Galactic Hub' : `Insufficient resources (need ${cost.credits}C, ${cost.minerals}M)`;
                // --- hinta nappiin ---
                buildGalacticHubButton.querySelector('span').textContent = `Build Galactic Hub (${cost.credits}C, ${cost.minerals}M)`;
            }
        }
    }

    // --- SHIPYARD BUTTON -logiikka ---
    // Tämä logiikka hallitsee kahden eri napin ("Build" ja "Upgrade") näkyvyyttä ja tilaa.

    // Näytä "Build Shipyard"-nappi, jos sellaista ei ole ja se on näkyvissä.
    if (buildShipyardButton && buildShipyardButton.style.display !== 'none') {
        const cost = { credits: 150, minerals: 100, time: 20 }; // Perushinta
        const canAffordIt = canAfford(cost);
        const totalShipyards = starData.shipyardLevel + queuedShipyard;
        // Tarkistetaan, salliiko nykyinen infrastruktuuritaso uuden telakan rakentamisen.
        const canBuildMore = totalShipyards < currentInfraLimits.maxShipyard;

        // Nappi on pois käytöstä, jos ei ole varaa TAI jos infra-raja on täynnä.
        buildShipyardButton.disabled = !canAffordIt || !canBuildMore;
        
        // Asetetaan informatiivinen tooltip sen mukaan, miksi nappi on pois päältä.
        if (!canBuildMore) {
            buildShipyardButton.title = `Shipyard limit reached (${totalShipyards}/${currentInfraLimits.maxShipyard}) - Upgrade infrastructure first`;
        } else if (!canAffordIt) {
            buildShipyardButton.title = `Insufficient resources (need ${cost.credits}C, ${cost.minerals}M)`;
        } else {
            buildShipyardButton.title = 'Build a shipyard to construct ships';
        }

        // Päivitetään napin teksti näyttämään hinta.
        buildShipyardButton.querySelector('span').textContent = `Build Shipyard (${cost.credits}C, ${cost.minerals}M)`;
    }
    
    // Näytä "Upgrade Shipyard"-nappi, jos telakka on olemassa ja nappi on näkyvissä.
    if (upgradeShipyardButton && upgradeShipyardButton.style.display !== 'none') {
        // Haetaan dynaamisesti oikea hinta päivitykselle.
        const cost = getShipyardCost(starData.shipyardLevel);
        const canAffordIt = canAfford(cost);
        const nextLevel = starData.shipyardLevel + 1;
        const totalShipyards = starData.shipyardLevel + queuedShipyard;
        // Päivitys on mahdollista vain, jos seuraava taso ei ylitä infra-rajaa EIKÄ päivitys ole jo jonossa.
        const canUpgrade = nextLevel <= currentInfraLimits.maxShipyard && queuedShipyard === 0;
        
        // Nappi on pois käytöstä, jos ei ole varaa TAI jos maksimitasolla infraan nähden.
        upgradeShipyardButton.disabled = !canAffordIt || !canUpgrade;
        
        // Asetetaan tooltip eri tilanteiden mukaan.
        if (queuedShipyard > 0) {
            upgradeShipyardButton.title = 'Shipyard upgrade already in queue';
        } else if (nextLevel > currentInfraLimits.maxShipyard) {
            upgradeShipyardButton.title = `Requires higher infrastructure level (current max: ${currentInfraLimits.maxShipyard})`;
        } else if (!canAffordIt) {
            upgradeShipyardButton.title = `Insufficient resources (need ${cost.credits}C, ${cost.minerals}M)`;
        } else {
            upgradeShipyardButton.title = `Upgrade to Shipyard Level ${nextLevel}`;
        }
        
        // Päivitetään napin teksti näyttämään dynaaminen hinta ja tila.
        const span = upgradeShipyardButton.querySelector('span');
        if (queuedShipyard > 0) {
            span.textContent = 'Upgrading…';
        } else if (!canUpgrade && nextLevel > currentInfraLimits.maxShipyard) {
            span.textContent = `Shipyard at Max (Lvl ${starData.shipyardLevel})`;
        } else {
            span.textContent = `Upgrade Shipyard (${cost.credits}C, ${cost.minerals}M)`;
        }
    }
    
    // Mine button
    if (buildMineButton) {
        const cost = { credits: 75, minerals: 25 };
        const canAffordIt = canAfford(cost);
        // Lasketaan, kuinka monta kaivosta on yhteensä (valmiit + jonossa).
        const totalMines = starData.mines + queuedMines;
        // Tarkistetaan, onko tilaa uusille kaivoksille nykyisellä infratasolla.
        const canBuildMore = totalMines < currentInfraLimits.maxMines;
        
        // Nappi on pois päältä, jos ei ole varaa TAI jos limiitti on täynnä.
        buildMineButton.disabled = !canAffordIt || !canBuildMore;
        
        // Asetetaan informatiivinen tooltip eri tilanteiden mukaan.
        if (!canBuildMore) {
            buildMineButton.title = `Mine limit reached (${totalMines}/${currentInfraLimits.maxMines})`;
            if (queuedMines > 0) {
                buildMineButton.title += ` - ${queuedMines} in queue`;
            }
        } else if (!canAffordIt) {
            buildMineButton.title = 'Insufficient resources (need 75C, 25M)';
        } else {
            buildMineButton.title = `Build a mine (${totalMines}/${currentInfraLimits.maxMines})`;
            if (queuedMines > 0) {
                buildMineButton.title += ` - ${queuedMines} in queue`;
            }
        }
    }
    
    // --- Defense button ---
    // Logiikka on identtinen kaivosnapin kanssa, mutta käyttää puolustuksen arvoja.
    if (buildDefenseButton) {
        const cost = { credits: 100, minerals: 50 };
        const canAffordIt = canAfford(cost);
        // Lasketaan, kuinka monta PD:tä on yhteensä (valmiit + jonossa).
        const totalDefense = starData.defenseLevel + queuedDefense;
        // Tarkistetaan, onko tilaa uusille PD:lle nykyisellä infratasolla.
        const canBuildMore = totalDefense < currentInfraLimits.maxDefense;
        
        // Nappi on pois päältä, jos ei ole varaa TAI jos limiitti on täynnä.
        buildDefenseButton.disabled = !canAffordIt || !canBuildMore;
        
        // Asetetaan informatiivinen tooltip eri tilanteiden mukaan.
        if (!canBuildMore) {
            buildDefenseButton.title = `Defense limit reached (${totalDefense}/${currentInfraLimits.maxDefense})`;
            if (queuedDefense > 0) {
                buildDefenseButton.title += ` - ${queuedDefense} in queue`;
            }
        } else if (!canAffordIt) {
            buildDefenseButton.title = 'Insufficient resources (need 100C, 50M)';
        } else {
            buildDefenseButton.title = `Upgrade planetary defense (${totalDefense}/${currentInfraLimits.maxDefense})`;
            if (queuedDefense > 0) {
                buildDefenseButton.title += ` - ${queuedDefense} in queue`;
            }
        }
    }
    
    // --- Ship buttons ---
    // Tämä silmukka käy läpi kaikki alustyypit ja päivittää niiden rakennusnapit kerralla.
    Object.entries(SHIP_COST).forEach(([shipType, [credits, minerals, buildTime]]) => {
        // Muodostetaan napin ID dynaamisesti alustyypin nimestä.
        const button = document.getElementById(`build${shipType.replace(/ /g, '')}Button`);
        // Tarkistetaan, onko nappi näkyvissä (telakkataso riittää).
        if (button && button.style.display !== 'none') {
            const canAffordIt = canAfford({ credits, minerals });

            // Nappi on pois käytöstä vain, jos pelaajalla ei ole varaa.
            button.disabled = !canAffordIt;
            
            // Asetetaan informatiivinen tooltip.
            if (!canAffordIt) {
                button.title = `${shipType} - Insufficient resources (need ${credits}C, ${minerals}M)`;
            } else {
                button.title = `Build ${shipType} (${credits}C, ${minerals}M) - ${buildTime}s`;
            }
        }
    });
}


/**
 * @summary Päivittää rakennusjonojen lukumääränäytöt planeettavalikossa.
 * (numerona, kuinka monta asiaa jonossa yhteensä)
 * @description Tämä on yksinkertainen apufunktio, joka eriyttää käyttöliittymän
 * tekstikenttien päivityksen omaksi, selkeäksi toimenpiteekseen. Se lukee
 * tähden jonoista niiden pituuden ja päivittää sen näkyviin pelaajalle.
 *
 * @param {object} starData - Valitun tähden dataobjekti, joka sisältää jonot.
 */
function updateQueueDisplays(starData) {
    // Päivittää planetaarisen rakennusjonon lukumäärän yhteensä
    const planetaryQueue = starData.planetaryQueue || [];
    planetaryQueueInfo.textContent = `Queue: ${planetaryQueue.length}`;
    
    // Päivittää alusten rakennusjonon lukumäärän.
    const shipQueue = starData.shipQueue || [];
    shipQueueInfo.textContent = `Queue: ${shipQueue.length}`;
}


/**
 * @summary Päivittää planetary menun sisällä olevan valloituksen edistymispalkin.
 * @description Tämä funktio on vastuussa vain 2D-käyttöliittymän valloituspalkin
 * ja sen tekstien näyttämisestä, kun pelaaja on valinnut tähden, joka on
 * valloituksen alla. Itse planeetan ympärille muodostuvan 3D-renkaan piirtämisestä 
 * ja animoinnista huolehtii `scene.js`.
 *
 * @param {object} starData - Valitun tähden dataobjekti.
 */function updateConquestProgressUI(star) {
    // Etsitään tarvittavat HTML-elementit.
    const conquestProgressContainer = document.getElementById('conquestProgressContainer');
    const conquestProgressBarFill = document.getElementById('conquestProgressBarFill');
    const conquestProgressBarText = document.getElementById('conquestProgressBarText');
    const conqueringStatusText = document.getElementById('conqueringStatusText');
    
    if (!conquestProgressContainer || !conquestProgressBarFill || 
        !conquestProgressBarText || !conqueringStatusText) {
        return;
    }
    
    // Näytä palkki vain, jos tähti on valloituksen alla EIKÄ se ole pelaajan oma.
    if (star.isBeingConqueredBy && !isPlayerOwned(star)) {
        const progressPercent = Math.min(100, Math.floor(star.conquestProgress || 0));

        // Päivitetään palkin leveys ja tekstisisältö.
        conquestProgressBarFill.style.width = `${progressPercent}%`;
        conquestProgressBarText.textContent = `${progressPercent}%`;
        
        // Päivitetään tilateksti kertomaan, kuka valloittaa.
        const conquerorName = getOwnerName(star.isBeingConqueredBy);
        conqueringStatusText.textContent = `Being conquered by ${conquerorName}...`;
        
        // Asetetaan palkin väri vastaamaan valloittajan väriä.
        if (star.isBeingConqueredBy === myPlayerId) {
            conquestProgressBarFill.style.backgroundColor = '#3b82f6'; // Pelaaja on sininen.
        } else {
            // Haetaan AI-pelaajan väri.
            const gameData = window.gameData;
            if (gameData && gameData.players) {
                const conqueror = gameData.players.find(p => p._id === star.isBeingConqueredBy);
                if (conqueror && conqueror.color) {
                    const color = conqueror.color.startsWith('#') ? 
                        conqueror.color : `#${parseInt(conqueror.color).toString(16).padStart(6, '0')}`;
                    conquestProgressBarFill.style.backgroundColor = color;
                }
            }
        }
        
        // Tehdään elementit näkyviksi.
        conquestProgressContainer.style.display = 'block';
        conqueringStatusText.style.display = 'block';
    } else {
        // Jos valloitusta ei ole, piilotetaan kaikki ja nollataan arvot.
        conquestProgressContainer.style.display = 'none';
        conqueringStatusText.style.display = 'none';
        conquestProgressBarFill.style.width = '0%';
        conquestProgressBarText.textContent = '0%';
    }
}

/* ========================================================================== */
/*  PROGRESS BAR FUNCTIONS                                                     */
/* ========================================================================== */

/**
 * @summary Vastaanottaa ja tallentaa serveriltä tulleen rakennusjonon tilan.
 * @description Tämä funktio on linkki serverin ja clientin sulavan animaation välillä.
 * Kun serveri lähettää `CONSTRUCTION_PROGRESS`-diffin (joka tick, kun jokin on jonossa),
 * tämä funktio päivittää clientin paikallisen `constructionProgressData`-tietorakenteen.
 * Tämän jälkeen se käynnistää `startProgressInterpolation`-funktion, joka animoi
 * edistymispalkkeja sulavasti päivitysten välillä.
 *
 * @param {object} action - Serveriltä tullut diff-objekti, joka sisältää tähden ID:n ja jonojen tilan.
 */
function updateConstructionProgress(action) {
    // Tallenna serveriltä saatu tarkka data ja nykyhetken aikaleima.
    constructionProgressData.set(action.starId, {
        planetary: action.planetaryQueue || [],
        ship: action.shipQueue || [],
        lastUpdate: Date.now()
    });
    
    // Varmista, että interpolointianimaatio on käynnissä.
    startProgressInterpolation();
}


/**
 * @summary Päivittää yksittäisen planetaarisen rakennusnapin edistymispalkin.
 * @description Tämä funktio on vastuussa siitä, että oikean napin sisällä oleva
 * sininen edistymispalkki päivittyy vastaamaan jonossa ensimmäisenä olevan
 * työn edistymistä. Se päättelee työn tyypin perusteella, mitä nappia tulee päivittää.
 *
 * @param {Array<object>|null} queue - Tähden planetaarinen rakennusjono.
 * @private
 */
function updatePlanetaryConstructionProgressUI(queue) {
    // Jos jono on tyhjä, nollataan kaikkien nappien edistymispalkit.
    if (!queue || queue.length === 0) {
        document.querySelectorAll('.button-progress-bar').forEach(bar => {
            bar.style.width = '0%';
        });
        return;
    }
    
    // Otetaan käsittelyyn vain jonon ensimmäinen (aktiivinen) työ.
    const currentItem = queue[0];
    const progress = (currentItem.totalTime - currentItem.timeLeft) / currentItem.totalTime;
    const progressPercent = Math.floor(progress * 100);
    
    // Päätellään, mikä nappi vastaa nykyistä työtä sen tyypin perusteella.
    let progressBarId = '';
    if (currentItem.type.startsWith('Infrastructure')) {
        progressBarId = 'progress-Infrastructure';
    } else if (currentItem.type === 'Shipyard' || currentItem.type.startsWith('Shipyard Lvl')) {
        progressBarId = currentItem.type === 'Shipyard' ? 'progress-Shipyard' : 'progress-UpgradeShipyard';
    } else if (currentItem.type === 'Mine') {
        progressBarId = 'progress-Mine';
    } else if (currentItem.type === 'Defense Upgrade') {
        progressBarId = 'progress-Defense';
    }
    
    // Haetaan oikea edistymispalkki-elementti ja päivitetään sen leveys.
    const progressBar = document.getElementById(progressBarId);
    if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
    }
}


/**
 * @summary Päivittää yksittäisen aluksen rakennusnapin edistymispalkin.
 * @description Tämä funktio on vastuussa siitä, että oikean aluksen rakennusnapin
 * sisällä oleva edistymispalkki päivittyy vastaamaan jonossa ensimmäisenä olevan
 * aluksen edistymistä. Se päättelee dynaamisesti oikean palkin ID:n aluksen tyypin perusteella.
 *
 * @param {Array<object>|null} queue - Tähden alusten rakennusjono.
 * @private
 */
function updateShipConstructionProgressUI(queue) {
    // Jos jono on tyhjä, nollataan kaikkien alusten rakennusnappien palkit.
    if (!queue || queue.length === 0) {
        ['Fighter', 'Destroyer', 'Cruiser', 'SlipstreamFrigate'].forEach(type => {
            // Muodostetaan ID korvaamalla välilyönnit, esim. "SlipstreamFrigate" -> "progress-SlipstreamFrigate"
            const bar = document.getElementById(`progress-${type.replace(/ /g, '')}`);
            if (bar) bar.style.width = '0%';
        });
        return;
    }
    
    // Käsitellään vain jonon ensimmäistä (aktiivista) työtä.
    const currentItem = queue[0];
    const progress = (currentItem.totalTime - currentItem.timeLeft) / currentItem.totalTime;
    const progressPercent = Math.floor(progress * 100);
    
    // Muodostetaan oikean edistymispalkin ID rakenteilla olevan aluksen tyypin perusteella.
    const progressBarId = `progress-${currentItem.type.replace(/ /g, '')}`;
    const progressBar = document.getElementById(progressBarId);

    // Päivitetään löydetyn palkin leveys vastaamaan edistymistä.
    if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
    }
}


/**
 * @summary Päivittää koko rakennusjonon yhteisen edistymispalkin ja ETA-tekstin.
 * @description Tämä funktio laskee koko jonon (sekä planetaarisen että alusjonon)
 * kokonaiskeston ja jäljellä olevan ajan. Se päivittää UI-elementit näyttämään
 * prosentuaalisen edistymisen ja arvioidun valmistumisajan (ETA) sekunteina.
 *
 * @param {Array<object>} planetaryQueue - Tähden planetaarinen rakennusjono.
 * @param {Array<object>} shipQueue - Tähden alusten rakennusjono.
 * @private
 */
function updateQueueTotalBars(planetaryQueue, shipQueue) {
    // Käsittele planetaarinen jono.
    if (planetaryQueueTotalProgressFill && planetaryQueue?.length > 0) {
        // Lasketaan kaikkien jonossa olevien töiden alkuperäinen kokonaisaika.
        const totalTime = planetaryQueue.reduce((sum, item) => sum + item.totalTime, 0);
        // Lasketaan kaikkien jonossa olevien töiden jäljellä oleva aika.
        const totalLeft = planetaryQueue.reduce((sum, item) => sum + item.timeLeft, 0);
        const progress = ((totalTime - totalLeft) / totalTime) * 100;
        
        planetaryQueueTotalProgressFill.style.width = `${progress}%`;
        planetaryQueueTotalProgressText.textContent = `ETA: ${Math.ceil(totalLeft)}s`;
    }
    
    // Käsittele alusten rakennusjono samalla logiikalla.
    if (shipQueueTotalProgressFill && shipQueue?.length > 0) {
        // Lasketaan kaikkien jonossa olevien töiden alkuperäinen kokonaisaika.
        const totalTime = shipQueue.reduce((sum, item) => sum + item.totalTime, 0);
        // Lasketaan kaikkien jonossa olevien töiden jäljellä oleva aika.
        const totalLeft = shipQueue.reduce((sum, item) => sum + item.timeLeft, 0);
        const progress = ((totalTime - totalLeft) / totalTime) * 100;
        
        shipQueueTotalProgressFill.style.width = `${progress}%`;
        shipQueueTotalProgressText.textContent = `ETA: ${Math.ceil(totalLeft)}s`;
    }
}


/**
 * @summary Käynnistää ajastimen, joka animoi edistymispalkkeja sulavasti.
 * @description Tämä funktio varmistaa, että edistymispalkkien animaatio on käynnissä.
 * Se luo `setInterval`-ajastimen, joka suorittaa `interpolateProgress`-funktion
 * 10 kertaa sekunnissa. Tämä luo illuusion jatkuvasta edistymisestä, vaikka
 * tarkat tiedot serveriltä saapuvatkin harvemmin. Funktio on rakennettu niin,
 * että se ei luo useita ajastimia päällekkäin.
 * @private
 */
function startProgressInterpolation() {
    // Jos ajastin on jo käynnissä, älä tee mitään.
    if (progressInterpolationInterval) return;
    
    // Luo uusi ajastin, joka kutsuu `interpolateProgress`-funktiota.
    progressInterpolationInterval = setInterval(() => {
        // Käy läpi kaikki tähdet, joilla on aktiivista rakennustoimintaa.
        constructionProgressData.forEach((data, starId) => {
            // Animoi palkkeja vain, jos kyseinen tähti on tällä hetkellä valittuna.
            // Tämä on tehokasta, koska se ei päivitä näkymättömissä olevia UI-elementtejä.
            if (selectedStar && selectedStar._id === starId) {
                interpolateProgress(data);
            }
        });
    }, 100); // 100ms = 10 päivitystä sekunnissa.
}


/**
 * @summary Laskee ja päivittää edistymispalkkien visuaalisen tilan sulavasti.
 * @description Tämä on client-puolen "animaatiotemppu". Koska tarkka data serveriltä
 * saapuu vain ajoittain (esim. kerran sekunnissa), tämä funktio laskee (`interpoloi`)
 * edistymispalkkien todennäköisen tilan päivitysten VÄLILLÄ. Se luo illuusion
 * täysin sulavasta ja reaaliaikaisesta edistymisestä.
 *
 * @param {object} data - `constructionProgressData`-objekti, joka sisältää jonojen tilan ja viimeisimmän päivityksen aikaleiman.
 * @private
 */
function interpolateProgress(data) {
    const now = Date.now();
    // Jos peli on pausella, aika ei kulu.
    const currentSpeed = isPaused ? 0 : GAME_SPEED;
    // Lasketaan, kuinka paljon aikaa on kulunut (sekunteina) viimeisestä virallisesta päivityksestä.
    const elapsed = (now - data.lastUpdate) / 1000 * currentSpeed;

    // --- Käsittele planetaarinen jono ---
    if (data.planetary && data.planetary.length > 0) {
        const item = data.planetary[0];
        // Lasketaan arvioitu jäljellä oleva aika: serverin ilmoittama aika - kulunut aika.
        const interpolatedTimeLeft = Math.max(0, item.timeLeft - elapsed);
        const progress = (item.totalTime - interpolatedTimeLeft) / item.totalTime;
        const progressPercent = Math.min(100, Math.floor(progress * 100));
        
        // Päivitetään oikean napin edistymispalkki.
        updateButtonProgressBar(item.type, progressPercent);
        
        // Päivitetään myös koko jonon yhteinen edistymispalkki ja ETA-laskuri.
        if (planetaryQueueTotalProgressFill) {
            const totalTime = data.planetary.reduce((sum, it) => sum + it.totalTime, 0);
            const totalLeft = data.planetary.reduce((sum, it, idx) => {
                // Käytetään arvioitua aikaa ensimmäiselle jonossa olevalle ja tarkkaa aikaa muille.
                if (idx === 0) return sum + interpolatedTimeLeft;
                return sum + it.timeLeft;
            }, 0);
            const totalProgress = ((totalTime - totalLeft) / totalTime) * 100;
            planetaryQueueTotalProgressFill.style.width = `${Math.min(100, totalProgress)}%`;
            planetaryQueueTotalProgressText.textContent = `ETA: ${Math.ceil(totalLeft)}s`;
        }
        } else {
            // Jos jono on tyhjä, nollataan kaikki planetaariset palkit.
            document.querySelectorAll('.button-progress-bar').forEach(bar => {
                if (!bar.id.includes('Fighter') && !bar.id.includes('Destroyer') && 
                    !bar.id.includes('Cruiser') && !bar.id.includes('Slipstream')) {
                    bar.style.width = '0%';
                }
            });
            // Nollaa total bar
            if (planetaryQueueTotalProgressFill) {
                planetaryQueueTotalProgressFill.style.width = '0%';
                planetaryQueueTotalProgressText.textContent = 'Idle';
                planetaryQueueTotalProgressText.setAttribute('idle', 'true');
            }
        }
    
    // --- Käsittele alusten rakennusjono samalla logiikalla ---
    if (data.ship && data.ship.length > 0) {
        const item = data.ship[0];
        const interpolatedTimeLeft = Math.max(0, item.timeLeft - elapsed);
        const progress = (item.totalTime - interpolatedTimeLeft) / item.totalTime;
        const progressPercent = Math.min(100, Math.floor(progress * 100));
        
        // Päivitä ship button progress bar
        const progressBarId = `progress-${item.type.replace(/ /g, '')}`;
        const progressBar = document.getElementById(progressBarId);
        if (progressBar) {
            progressBar.style.width = `${progressPercent}%`;
        }
        
        // Päivitä total ship queue bar
        if (shipQueueTotalProgressFill) {
            const totalTime = data.ship.reduce((sum, it) => sum + it.totalTime, 0);
            const totalLeft = data.ship.reduce((sum, it, idx) => {
                if (idx === 0) return sum + interpolatedTimeLeft;
                return sum + it.timeLeft;
            }, 0);
            const totalProgress = ((totalTime - totalLeft) / totalTime) * 100;
            shipQueueTotalProgressFill.style.width = `${Math.min(100, totalProgress)}%`;
            shipQueueTotalProgressText.textContent = `ETA: ${Math.ceil(totalLeft)}s`;
        }
      } else {
          // Jos jono on tyhjä, nollataan kaikki alusten palkit.
          ['Fighter', 'Destroyer', 'Cruiser', 'SlipstreamFrigate'].forEach(type => {
              const bar = document.getElementById(`progress-${type.replace(/ /g, '')}`);
              if (bar) bar.style.width = '0%';
          });
          // Nollaa total bar
          if (shipQueueTotalProgressFill) {
              shipQueueTotalProgressFill.style.width = '0%';
              shipQueueTotalProgressText.textContent = 'Idle';
              shipQueueTotalProgressText.setAttribute('idle', 'true');
          }
      }
}


/**
 * @summary Päivittää tietyn rakennusnapin sisällä olevan edistymispalkin leveyden.
 * @description Tämä on matalan tason apufunktio, jota `interpolateProgress` kutsuu.
 * Se ottaa vastaan rakennustyypin ja prosenttiarvon, päättelee niiden perusteella
 * oikean HTML-elementin ID:n ja asettaa sen CSS-leveyden.
 *
 * @param {string} type - Rakenteilla olevan kohteen tyyppi (esim. "Mine", "Infrastructure Lvl 2").
 * @param {number} percent - Edistyminen prosentteina (0-100).
 * @private
 */
function updateButtonProgressBar(type, percent) {
    let progressBarId = '';
    
    // Määritetään oikea progress bar -elementin ID rakennustyypin perusteella.
    if (type.startsWith('Infrastructure')) {
        progressBarId = 'progress-Infrastructure';
    } else if (type === 'Shipyard') {
        progressBarId = 'progress-Shipyard';
    } else if (type.startsWith('Shipyard Lvl')) {
        progressBarId = 'progress-UpgradeShipyard';
    } else if (type === 'Mine') {
        progressBarId = 'progress-Mine';
    } else if (type === 'Defense Upgrade') {
        progressBarId = 'progress-Defense';
    } else if (type === 'Galactic Hub') {
        progressBarId = 'progress-GalacticHub';
    }
    
    const progressBar = document.getElementById(progressBarId);
    if (progressBar) {
        // Asetetaan palkin leveys vastaamaan edistymistä.
        progressBar.style.width = `${percent}%`;
        
        // Optimointi: Varmistetaan, että kun palkki nollataan (percent === 0),
        // sen animaatio on nopea, jotta se ei näytä "liukuvan" pois hitaasti.
        if (percent === 0) {
            progressBar.style.transition = 'width 0.1s linear';
        }
    }
}

/* ========================================================================== */
/*  CONSTRUCTION COMMANDS                                                      */
/* ========================================================================== */
// Nämä funktiot ovat tapahtumankäsittelijöitä (event handlers), jotka suoritetaan,
// kun pelaaja klikkaa jotakin rakennusnappia planeettavalikossa.

/**
 * @summary Käsittelee "Upgrade Infrastructure" -napin painalluksen.
 * @description Tämä funktio laskee dynaamisesti seuraavan infratason päivityksen hinnan,
 * tarkistaa onko pelaajalla varaa siihen, ja jos on, kutsuu `sendConstructionCommand`-funktiota
 * lähettämään komennon serverille.
 */
function handleUpgradeInfrastructure() {
    // Vartiolausekkeet: Älä tee mitään, jos tähteä ei ole valittu tai peli on pausella.
    if (!selectedStar || isPaused) return;
    
    // Lasketaan päivityksen hinta.
    const cost = getInfrastructureCost(selectedStar.infrastructureLevel);
    // Tarkistetaan resurssit.
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    // Lähetetään komento.
    const buildType = `Infrastructure Lvl ${selectedStar.infrastructureLevel + 1}`;
    sendConstructionCommand(selectedStar._id, buildType, cost);
}


/**
 * @summary Käsittelee "Build Galactic Hub" -napin painalluksen.
 * @description Toimii kuten muutkin rakennuskäskyt, mutta käyttää kiinteitä,
 * korkeita kustannuksia.
 */
function handleBuildGalacticHub() {
    if (!selectedStar || isPaused) return;
    
    // Hubilla on kiinteä, korkea hinta.
    const cost = { credits: 1000, minerals: 1000, time: 180 };
    if (!canAfford(cost)) {
        alert("Insufficient resources for Galactic Hub!");
        return;
    }
    sendConstructionCommand(selectedStar._id, 'Galactic Hub', cost);
}


/**
 * @summary Käsittelee "Build Shipyard" -napin painalluksen.
 * @description Käsittelee nimenomaan ensimmäisen telakkatason (Lvl 1) rakentamisen.
 */
function handleBuildShipyard() {
    if (!selectedStar || isPaused) return; 
    // Ensimmäisellä telakalla on aina kiinteä hinta.
    const cost = { credits: 150, minerals: 100, time: 20 };
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    sendConstructionCommand(selectedStar._id, 'Shipyard', cost);
}


/**
 * @summary Käsittelee "Upgrade Shipyard" -napin painalluksen.
 * @description Toimii kuten `handleUpgradeInfrastructure`, mutta laskee dynaamisen
 * hinnan telakan päivitykselle.
 */
function handleUpgradeShipyard() {
    if (!selectedStar || isPaused) return; 
    const cost = getShipyardCost(selectedStar.shipyardLevel);
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    const buildType = `Shipyard Lvl ${selectedStar.shipyardLevel + 1}`;
    sendConstructionCommand(selectedStar._id, buildType, cost);
}


/**
 * @summary Käsittelee "Build Mine" -napin painalluksen.
 */
function handleBuildMine() {
    if (!selectedStar || isPaused) return; 
    const cost = { credits: 75, minerals: 25, time: 10 };
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    sendConstructionCommand(selectedStar._id, 'Mine', cost);
}


/**
 * @summary Käsittelee "Upgrade Defense" -napin painalluksen.
 */
function handleBuildDefense() {
    if (!selectedStar || isPaused) return; 
    const cost = { credits: 100, minerals: 50, time: 15 };
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    sendConstructionCommand(selectedStar._id, 'Defense Upgrade', cost);
}


/**
 * @summary Yleinen käsittelijä kaikkien alusten rakennusnapeille.
 * @description Tämä funktio on tehokas, koska se ottaa vastaan alustyypin parametrina,
 * hakee sen hinnan `SHIP_COST`-vakiosta ja lähettää komennon. Tämä poistaa
 * tarpeen kirjoittaa erillinen `handle`-funktio jokaiselle alustyypille.
 *
 * @param {string} shipType - Rakennettavan aluksen tyyppi (esim. "Fighter", "Cruiser").
 */
function handleBuildShip(shipType) {
    if (!selectedStar || !shipType || isPaused) return;
    const shipCost = SHIP_COST[shipType];
    if (!shipCost) return;
    const cost = { credits: shipCost[0], minerals: shipCost[1] };
    if (!canAfford(cost)) {
        alert("Insufficient resources!");
        return;
    }
    // Alusten rakennuskomennot käyttävät omaa lähetysfunktiotaan selkeyden vuoksi.
    sendShipConstructionCommand(selectedStar._id, shipType, cost);
}


/**
 * @summary Pelaajan rakennuskomentojen käsittely.
 * @description Tämä tiedosto sisältää funktion rakennuskomennon lähettämiseen palvelimelle
 * sekä käyttöliittymän optimistiseen päivittämiseen.
 * MITÄ: Lähettää planeetalle sijoittuvan rakennuskomennon palvelimelle ja suorittaa
 * samalla "optimistisen päivityksen" pelaajan käyttöliittymään.
 *
 * MIKSI: Tämä parantaa välittömästi pelin tuntumaa ja reagointikykyä. Pelaaja näkee
 * heti toimintonsa vaikutuksen (resurssit vähenevät, rakennus ilmestyy jonoon),
 * eikä hänen tarvitse odottaa verkkoyhteyden yli tulevaa vahvistusta palvelimelta.
 *
 * @param {string} starId - Tähden ID, johon rakennus kohdistuu.
 * @param {string} buildingType - Rakennettavan kohteen tyyppi (esim. 'PLANETARY_DEFENSE').
 * @param {object} cost - Objekti, joka sisältää rakentamisen kustannukset (`credits`, `minerals`, `time`).
 */
function sendConstructionCommand(starId, buildingType, cost) {
    // 1. Resurssien paikallinen vähennys välitöntä palautetta varten.
    playerResources.credits -= cost.credits;
    playerResources.minerals -= cost.minerals;
    updateResourceDisplay();
    
    // 2. Komennon lähetys palvelimelle, joka hoitaa varsinaisen pelilogiikan.
    const command = {
        action: 'QUEUE_PLANETARY',
        playerId: myPlayerId,
        gameId: currentGameId,
        starId: starId,
        build: {
            type: buildingType,
            time: cost.time || 20 // Oletusaika, jos puuttuu
        },
        cost: cost
    };
    
    socket.emit('player_command', command);

    // 3. Optimistinen käyttöliittymän päivitys: Lisätään rakennus paikalliseen jonoon
    // ja päivitetään näkymä, jos pelaaja tarkastelee kyseistä tähteä.
    if (selectedStar && selectedStar._id === starId) {
        // 3.1. Varmistetaan, että jono-taulukko on olemassa
        if (!selectedStar.planetaryQueue) {
            selectedStar.planetaryQueue = [];
        }
        // 3.2. Lisätään uusi rakennuskohde paikalliseen jonoon
        selectedStar.planetaryQueue.push({
            type: buildingType,
            timeLeft: cost.time,
            totalTime: cost.time
        });
        // Päivitetään planeettavalikko näyttämään välittömästi uusi jono.
        showPlanetMenu(selectedStar);
    }
}


/**
 * @summary alusten rakennuskomentojen käsittely
 * @description Tämä tiedosto sisältää funktion rakennuskomennon lähettämiseen palvelimelle
 * sekä käyttöliittymän optimistiseen päivittämiseen.
 * MITÄ: Lähettää aluksen rakennuskomennon palvelimelle ja suorittaa samalla
 * "optimistisen päivityksen" pelaajan käyttöliittymään.
 *
 * MIKSI: Tämä antaa pelaajalle välittömän palautteen ja tekee pelistä reagoivamman.
 * Pelaaja näkee heti, että resurssit on käytetty ja alus on lisätty tuotantojonoon,
 * ilman verkkoyhteyden aiheuttamaa viivettä.
 *
 * @param {string} starId - Tähden ID, jossa alus rakennetaan.
 * @param {string} shipType - Rakennettavan aluksen tyyppi (esim. 'Fighter', 'Cruiser').
 * @param {object} cost - Objekti, joka sisältää rakentamisen kustannukset (`credits`, `minerals`).
 */
function sendShipConstructionCommand(starId, shipType, cost) {
    // 1. Resurssien paikallinen vähennys välitöntä palautetta varten.
    playerResources.credits -= cost.credits;
    playerResources.minerals -= cost.minerals;
    updateResourceDisplay();
    
    // 2. Komennon lähetys palvelimelle, joka hoitaa varsinaisen pelilogiikan.
    const command = {
        action: 'QUEUE_SHIP',
        playerId: myPlayerId,
        gameId: currentGameId,
        starId: starId,
        build: {
            type: shipType,
            time: SHIP_COST[shipType][2] // Rakennusaika haetaan SHIP_COST -vakiosta.
        },
        cost: cost
    };
    
    socket.emit('player_command', command);

    // 3. Optimistinen UI-päivitys: Lisätään alus paikalliseen jonoon
    // ja päivitetään näkymä, jos pelaaja tarkastelee kyseistä tähteä.
    if (selectedStar && selectedStar._id === starId) {
        if (!selectedStar.shipQueue) {
            selectedStar.shipQueue = [];
        }

        selectedStar.shipQueue.push({
            type: shipType,
            timeLeft: SHIP_COST[shipType][2],
            totalTime: SHIP_COST[shipType][2]
        });

        // Päivitetään planeettavalikko näyttämään välittömästi uusi jono.
        showPlanetMenu(selectedStar);
    }
}

/* ========================================================================== */
/*  RESOURCE MANAGEMENT                                                        */
/* ========================================================================== */


/**
 * MITÄ: Laskee pelaajan nettoresurssitulot ja päivittää ne käyttöliittymän yläpalkkiin.
 * MIKSI: Antaa pelaajalle jatkuvasti ajantasaista tietoa hänen taloudellisesta
 * tilanteestaan, mikä on keskeistä strategisten päätösten tekemisessä. Funktio
 * päivittää myös rakennusnappien tilan vastaamaan nykyisiä resursseja.
 */
function updateResourceDisplay() {
    // Laske tulot ja kulut
    let creditIncome = 0;
    let mineralIncome = 0;
    let creditUpkeep = 0;
    
    // Tulot ja kulut omistetuista tähdistä
    if (gameState && gameState.stars) {
        gameState.stars
            .filter(star => star.ownerId === myPlayerId)
            .forEach(star => {
                creditIncome += star.population || 0;
                mineralIncome += star.mines || 0;
                
                // Rakennusten ylläpitokulut
                creditUpkeep += (star.defenseLevel || 0) * 2;  // PD upkeep
                creditUpkeep += (star.shipyardLevel || 0) * 3; // Shipyard upkeep
                if (star.hasGalacticHub) {
                    creditUpkeep += UPKEEP_GALACTIC_HUB;
                }
            });
    }
    
    // Alusten ylläpitokulut
    const SHIP_UPKEEP = { Fighter: 1, Destroyer: 2, Cruiser: 3, 'Slipstream Frigate': 4 };
    if (gameState && gameState.ships) {
        gameState.ships
            .filter(ship => ship.ownerId === myPlayerId)
            .forEach(ship => {
                creditUpkeep += SHIP_UPKEEP[ship.type] || 0;
            });
    }
    
    const netCredits = creditIncome - creditUpkeep;
    
    // Päivitä käyttöliittymän elementit näyttämään lasketut arvot.
    if (creditsDisplay) {
        const netColor = netCredits >= 0 ? '#10b981' : '#ef4444'; // vihreä (+) tai punainen (-)
        creditsDisplay.innerHTML = `
            Credits: ${Math.floor(playerResources.credits)}
            <span style="color: ${netColor}; font-size: 0.85em;">
                (${netCredits >= 0 ? '+' : ''}${netCredits}/10s)
            </span>
        `;
    }
    
    if (mineralsDisplay) {
        mineralsDisplay.innerHTML = `
            Minerals: ${Math.floor(playerResources.minerals)}
            <span style="color: #10b981; font-size: 0.85em;">
                (+${mineralIncome}/10s)
            </span>
        `;
    }
    
    // Päivitä rakennusnappien tila (esim. harmaaksi, jos ei ole varaa)
    if (selectedStar && planetMenu.style.display === 'block') {
        updateButtonStates(selectedStar);
    }
}



/**
 * MITÄ: Päivittää käyttöliittymässä näkyvän suorituskykymonitorin tiedot.
 * MIKSI: Tarjoaa kehityksen ja testauksen aikana tärkeää tietoa pelin
 * suorituskyvystä (FPS, objektien määrä, muistinkäyttö), auttaen
 * optimointikohtien tunnistamisessa.
 */
function updatePerformanceMonitor() {
    const fpsCounter = document.getElementById('fpsCounter');
    const shipCounter = document.getElementById('shipCounter');
    const effectCounter = document.getElementById('effectCounter');
    const memoryCounter = document.getElementById('memoryCounter');
    
    // Hakee tiedot scene.js:n tarjoamasta debug-oliosta
    if (window.getSceneDebugInfo) {
        const debug = window.getSceneDebugInfo();
        
        if (fpsCounter) {
            fpsCounter.textContent = debug.fps || 0;
            
            // Värikoodaa FPS-lukeman suorituskyvyn mukaan
            if (debug.fps >= 50) {
                fpsCounter.style.color = '#00ff00'; // Vihreä
            } else if (debug.fps >= 30) {
                fpsCounter.style.color = '#ffff00'; // Keltainen  
            } else {
                fpsCounter.style.color = '#ff0000'; // Punainen
            }
        }
        
        if (shipCounter) shipCounter.textContent = debug.totalShips;
        if (effectCounter) effectCounter.textContent = debug.combatEffects + debug.explosions;
    }

    // Hakee selaimen tarjoaman tiedon käytetystä muistista
    if (memoryCounter && performance.memory) {
        const mb = Math.round(performance.memory.usedJSHeapSize / 1048576);
        memoryCounter.textContent = mb;
    }
}


// Ajastin, joka päivittää suorituskykymonitorin neljä kertaa sekunnissa.
setInterval(updatePerformanceMonitor, 250);


/**
 * MITÄ: Yksinkertainen tarkistusfunktio, joka kertoo, onko pelaajalla varaa johonkin.
 * MIKSI: Keskittää resurssien riittävyyden tarkistuslogiikan yhteen paikkaan,
 * mikä tekee koodista siistimmän ja helpommin ylläpidettävän.
 * @param {object} cost - Kustannusobjekti, jossa on `credits`- ja `minerals`-kentät.
 * @returns {boolean} Tosi, jos pelaajalla on varaa, muuten epätosi.
 */
function canAfford(cost) {
    return playerResources.credits >= cost.credits && 
           playerResources.minerals >= cost.minerals;
}


/**
 * MITÄ: Käsittelee palvelimelta saapuvan `diff`-paketin, joka sisältää listan
 * pelitilan muutoksista, ja päivittää käyttöliittymän vastaavasti.
 * MIKSI: Tämä on keskeinen funktio clientin ja serverin synkronoinnissa.
 * Käsittelemällä pieniä muutospaketteja (`diff`) koko pelitilan sijaan
 * säästetään kaistanleveyttä ja tehdään päivityksistä tehokkaampia.
 * @param {Array<object>} diff - Taulukko toiminto-objekteja, jotka kuvaavat pelitilan muutoksia.
 */
function updateUIFromDiff(diff) {
    // Käy läpi kaikki palvelimen lähettämät muutokset
    diff.forEach(action => {
        switch (action.action) {

            // Synkronoi pelinopeus palvelimen kanssa
            case 'TICK_INFO':
                if (action.speed !== window.SERVER_SPEED) {
                    window.SERVER_SPEED = action.speed;
                }
                break;

            // Päivittää rakennusjonon etenemistä
            case 'CONSTRUCTION_PROGRESS':
                if (selectedStar && selectedStar._id === action.starId) {
                    updateConstructionProgress(action);
                }
                break;

            // Käsittelee planeetalle sijoittuvan rakennuksen valmistumisen
            case 'COMPLETE_PLANETARY':
                // Päivitä globaali pelitila (`gameState`) uusilla tähtitiedoilla
                if (gameState && action.starData) {
                    const starIndex = gameState.stars.findIndex(s => s._id === action.starId);
                    if (starIndex !== -1) {
                        Object.assign(gameState.stars[starIndex], action.starData);
                    }
                }
                // Päivitä paikallinen ennustetieto rakentamisesta
                const progressData = constructionProgressData.get(action.starId);
                if (progressData) {
                    progressData.planetary = action.starData?.planetaryQueue || [];
                    progressData.lastUpdate = Date.now();
                }
                
                // Jos valittu tähti oli se, jossa rakennus valmistui, päivitä sen tiedot ja UI
                if (selectedStar && selectedStar._id === action.starId && action.starData) {
                    // Päivitä selectedStar objekti
                    Object.assign(selectedStar, action.starData);
                    // Päivitä UI
                    showPlanetMenu(selectedStar);
                }
                
                // Nollaa valmistuneen rakennuksen progress bar
                updateButtonProgressBar(action.type, 0);
                
                // Päivitä koko jonon yhteiskestoa näyttävät palkit
                if (selectedStar && selectedStar._id === action.starId) {
                    updateQueueTotalBars(action.starData.planetaryQueue, action.starData.shipQueue);
                }
                break;
                
            case 'SHIP_SPAWNED':
                // Tämä tulee serveriltä kun alus valmistuu.
                // Lisää uusi alus clientin paikalliseen pelitilaan, jotta muut
                // UI-funktiot (kuten ylläpidon laskeva updateResourceDisplay) näkevät sen.
                if (gameState && gameState.ships) {
                    const newShipData = {
                        _id: action.shipId,
                        type: action.type,
                        ownerId: action.ownerId,
                        parentStarId: action.starId, // Tieto siitä, missä alus on
                        state: 'orbiting'
                    };
                    gameState.ships.push(newShipData);
                }

                // Päivitä tähden tila (uusi alusjono) sekä globaalisti että paikallisesti
                if (gameState && action.starData) {
                    const starIndex = gameState.stars.findIndex(s => s._id === action.starId);
                    if (starIndex !== -1) {
                        Object.assign(gameState.stars[starIndex], action.starData);
                    }
                }
                const shipProgressData = constructionProgressData.get(action.starId);
                if (shipProgressData && action.starData) {
                    shipProgressData.ship = action.starData.shipQueue || [];
                    shipProgressData.lastUpdate = Date.now();
                }
                
                // Jos valittu tähti oli se, jossa alus valmistui, päivitä sen UI
                if (selectedStar && selectedStar._id === action.starId) {
                    if (action.starData) {
                        selectedStar.shipQueue = action.starData.shipQueue;
                        selectedStar.shipQueueTotalTime = action.starData.shipQueueTotalTime;
                    }
                    // Nollaa kaikkien alustyyppien progress barit
                    ['Fighter', 'Destroyer', 'Cruiser', 'SlipstreamFrigate'].forEach(type => {
                        const bar = document.getElementById(`progress-${type.replace(/ /g, '')}`);
                        if (bar) bar.style.width = '0%';
                    });
                    // Päivitä koko jonon yhteiskestoa näyttävät palkit
                    updateQueueTotalBars(selectedStar.planetaryQueue, selectedStar.shipQueue);
                }
                break; 

            case 'SHIP_ARRIVED': {
                // Päivitä saapuneen aluksen tila paikallisessa `gameState`:ssa
                const ship = gameState?.ships?.find(s => s._id === action.shipId);
                if (ship) {
                    ship.state        = 'orbiting';
                    ship.parentStarId = action.atStarId;
                    ship.targetStarId = null;
                }
                break;
            }

            case 'DEFENSE_DAMAGED':
                // Päivitä puolustustaso, jos valitun tähden PD tähti otti osumaa
                if (selectedStar && selectedStar._id === action.starId) {
                    selectedStar.defenseLevel = action.newLevel;
                    showPlanetMenu(selectedStar);
                }
            break;

            case 'SHIP_DESTROYED':
                // Poista tuhoutunut alus paikallisesta `gameState`:sta
                if (gameState && gameState.ships) {
                    const initialCount = gameState.ships.length;
                    gameState.ships = gameState.ships.filter(ship => 
                        ship._id.toString() !== action.shipId.toString()
                    );
                    const finalCount = gameState.ships.length;
                    if (initialCount > finalCount) {
                    }
                }
                updateGroupsPanel(); // Päivitä ryhmäpaneeli, koska aluksia on voinut tuhoutua
                updateResourceDisplay(); // Päivitä ylläpitokulut
                break;
                
            case 'STAR_UPDATED':
                // Käsittelee yleisen tähden tilan päivityksen (esim. populaation kasvu)
                if (gameState && gameState.stars) {
                    // Etsi oikea tähti paikallisesta tilasta
                    const starToUpdate = gameState.stars.find(s => s._id.toString() === action.starId.toString());
                    if (starToUpdate) {
                        // Päivitä kentät (tässä tapauksessa populaatio)
                        Object.assign(starToUpdate, action.updatedFields);
                        // JOS PÄIVITETTY TÄHTI ON VALITTUNA, PÄIVITÄ MYÖS PLANET MENU
                        if (selectedStar && selectedStar._id.toString() === action.starId.toString()) {
                            // Kopioi päivitetyt tiedot myös `selectedStar`-olioon
                            Object.assign(selectedStar, action.updatedFields);
                            // Kutsu menun päivitysfunktiota
                            showPlanetMenu(selectedStar);
                        }
                    }
                }
                break;
                            
            case 'RESOURCE_UPDATE':
                // Käsittelee palvelimelta tulevan täyden resurssipäivityksen
                if (action.playerId === myPlayerId) {
                    const oldCredits = playerResources.credits;
                    const oldMinerals = playerResources.minerals;
                    playerResources = action.resources;
//                     console.log(`💰 Resources updated: Credits ${oldCredits} -> ${playerResources.credits}, Minerals ${oldMinerals} -> ${playerResources.minerals}`);
                    updateResourceDisplay();
                }
                break;

            // Nämä toiminnot ovat puhtaasti visuaalisia ja ne käsitellään
            // muualla (scene.js), joten UI-logiikkaa ei tarvita tässä.
            case 'SHIP_IN_SLIPSTREAM':
                break;

            case 'CONQUEST_STARTED':
                break;
                
            case 'CONQUEST_PROGRESS':
                // Päivitä valloituksen etenemispalkki, jos tähti on valittuna
                if (selectedStar && selectedStar._id === action.starId) {
                    selectedStar.conquestProgress = action.progress;
                    selectedStar.isBeingConqueredBy = action.conquerorId;
                    // Päivitä UI jos tarvetta
                    updateConquestProgressUI(selectedStar);
                }
                break;
                
            case 'CONQUEST_COMPLETE':
                // Päivitä tähden tiedot valloituksen valmistuttua
                if (selectedStar && selectedStar._id === action.starId) {
                    Object.assign(selectedStar, action.starData);
                    showPlanetMenu(selectedStar);
                }
                break;
                
            case 'CONQUEST_HALTED':
                // Nollaa valloituspalkki, jos valloitus keskeytyy
                if (selectedStar && selectedStar._id === action.starId) {
                    selectedStar.conquestProgress = 0;
                    selectedStar.isBeingConqueredBy = null;
                    updateConquestProgressUI(selectedStar);
                }
                break;
        }
    });
}

/* ========================================================================== */
/*  UTILITY FUNCTIONS                                                         */
/* ========================================================================== */

/**
 * MITÄ: Laskee seuraavan tason infrastruktuurin päivityksen kustannukset.
 * MIKSI: Keskittää infrastruktuurin päivityskustannusten laskentalogiikan yhteen
 * paikkaan. Tämä tekee kaavasta (joka on sama kuin telakalla) helposti
 * muokattavan ja ylläpidettävän.
 * @param {number} currentLevel - Infrastruktuurin nykyinen taso.
 * @returns {object} Objekti, joka sisältää seuraavan tason, hinnan ja rakennusajan.
 */
function getInfrastructureCost(currentLevel) {
    // Käytetään progressiivista kustannusmallia, jossa hinta nousee tason mukaan (+30%).
    const baseCost = { credits: 150, minerals: 100, time: 30 };
    const factor = 1 + 0.3 * currentLevel;
    return {
        nextLevel: currentLevel + 1,
        credits: Math.round(baseCost.credits * factor),
        minerals: Math.round(baseCost.minerals * factor),
        time: Math.round(baseCost.time * factor)
    };
}


/**
 * MITÄ: Laskee seuraavan tason telakan rakennus- tai päivityskustannukset.
 * MIKSI: Keskittää telakan kustannuslogiikan. Funktio käsittelee erikseen
 * ensimmäisen tason rakentamisen ja sen jälkeiset päivitykset, joissa
 * kustannukset skaalautuvat.
 * @param {number} currentLevel - Telakan nykyinen taso (0, jos ei ole).
 * @returns {object} Objekti, joka sisältää seuraavan tason, hinnan ja rakennusajan.
 */
function getShipyardCost(currentLevel) {
    // Ensimmäisen tason rakentamisella on kiinteä hinta.
    if (currentLevel === 0) {
        return { nextLevel: 1, credits: 150, minerals: 100, time: 20 };
    }
    // Myöhemmät päivitykset noudattavat progressiivista kaavaa.
    const baseCost = { credits: 250, minerals: 200, time: 40 };
    const factor = 1 + 0.3 * (currentLevel - 1);
    return {
        nextLevel: currentLevel + 1,
        credits: Math.round(baseCost.credits * factor),
        minerals: Math.round(baseCost.minerals * factor),
        time: Math.round(baseCost.time * factor)
    };
}


/**
 * MITÄ: Päivittää kaikkien alusten rakennusnappien tekstit ja data-attribuutit.
 * MIKSI: Varmistaa, että käyttöliittymä näyttää aina ajantasaiset hinnat ja
 * rakennusajat, jotka haetaan keskitetysti `SHIP_COST`-vakiosta. Tämä on
 * hyödyllinen pelin alussa tai jos kustannukset muuttuvat dynaamisesti.
 */
function syncShipButtons() {
    Object.entries(SHIP_COST).forEach(([shipType, [credits, minerals, time, minLevel]]) => {
        const button = document.getElementById(`build${shipType.replace(/ /g, '')}Button`);
        if (button) {
            // Päivitä napin teksti näyttämään hinnan.
            const span = button.querySelector('span');
            if (span) {
                span.textContent = `Build ${shipType} (${credits}C, ${minerals}M)`;
            }
            // Tallenna kustannustiedot suoraan nappiin myöhempää käyttöä varten.
            button.dataset.costCredits = credits;
            button.dataset.costMinerals = minerals;
            button.dataset.buildTime = time;
        }
    });
}



/* ========================================================================== */
/*  EXPORTS & FINAL SETUP                                                     */
/* ========================================================================== */

// Käynnistä ajastin, joka päivittää resurssinäytön sekunnin välein.
setInterval(updateResourceDisplay, 1000);

// Vie keskeiset muuttujat ja tilat muiden moduulien käyttöön.
export {
    playerResources,
    gameState,
    myPlayerId,
    currentGameId
};