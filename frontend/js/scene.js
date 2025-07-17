// frontend/js/scene.js – Täydellinen Three.js renderöinti
// =============================================================================
//  Tämä tiedosto sisältää kaiken pelin visuaalisen renderöinnin ja 3D-maailman
//  logiikan, käyttäen Three.js-kirjastoa.
// =============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';


/* ========================================================================== */
/*  GLOBAALIT MUUTTUJAT                                                       */
/* ========================================================================== */

// --- Three.js:n Ydinobjektit ---
// Nämä ovat minkä tahansa Three.js-sovelluksen peruspilareita.
let scene, camera, renderer, controls, composer;

// --- Visuaaliset taustaelementit ---
// Nämä luovat staattisen, mutta tunnelmallisen avaruusmaiseman.
let backgroundStars, nebulaSprites = [];

// --- Renderöintisilmukan tilanhallinta ---
// Nämä liput ja apuvälineet ohjaavat animaation elinkaarta.
let ready = false;      // Onko scene alustettu ja valmis renderöitäväksi.
let animStarted = false;        // Onko animaatiolooppi käynnissä.
const clock = new THREE.Clock();        // Three.js:n kello ajastuksia ja animaatioita varten.
let animationFrameId = null;  // Viittaus `requestAnimationFrame`-silmukan ID:hen, jotta se voidaan pysäyttää.

// --- Datan käsittely ---
// Puskurijono palvelimelta saapuville päivityksille, jotka käsitellään animaatioloopissa.
const pendingDiffs = [];

// --- Hakurakenteet (Indeksit) suorituskyvyn parantamiseksi ---
// Näiden avulla vältetään jatkuva ja hidas scenen läpikäynti etsiessä tiettyjä objekteja.
const starsById = new Map();            // Nopea haku tähdille niiden ID:n perusteella.
const shipsById = new Map();            // Nopea haku aluksille niiden ID:n perusteella.
const starConnections = [];             // Taulukko kaikista starlane-viivoista päivitystä varten.
const starGlows = [];                   // Taulukko kaikkien tähtien hehkuista päivitystä varten.

// --- Spatiaalinen indeksi (avaruudellinen hakurakenne) ---
// Nopea haku, joka yhdistää tähden ID:n ja sitä kiertävien alusten joukon (Set).
// Kriittinen tehokkaalle taistelulogiikalle ja alusten paikantamiselle.
const shipsByStarClient = new Map();    // starId -> Set<shipMesh>

// --- Valinta ja Interaktio ---
// Nämä muuttujat pitävät kirjaa pelaajan hiiren käytöstä ja valinnoista.
let selectedStar = null;                // Tällä hetkellä valittuna oleva tähti-objekti.
let hoveredStar = null;                 // Tähti-objekti, jonka päällä hiiri on.
let selectedShips = [];                 // Taulukko, joka sisältää valitut alus-objektit.
let selectionIndicatorMesh = null;      // Visuaalinen indikaattori, joka näytetään valitun tähden ympärillä.
let isAreaSelecting = false;            // Lippu, joka kertoo, onko aluevalinta (raahaus) käynnissä.
let areaSelectionStartPoint = new THREE.Vector2(); // Aluevalinnan aloituspiste ruudulla.
let mouseDownPosition = null;           // Hiiren sijainti, kun nappi painettiin alas (klikkauksen ja raahauksen erottamiseen).
const CLICK_DRAG_THRESHOLD = 5;         // Pikselimäärä, jonka hiiren on liikuttava, jotta toiminto tulkitaan raahaukseksi.

// --- Visuaaliset Vakiot ---
// Keskittämällä nämä yhteen paikkaan, pelin ulkoasua on helppo muokata.
const PLAYER_COLOR = 0x9ed6f9;
const NEUTRAL_COLOR = 0xffffff;
const SELECTED_SHIP_COLOR = 0x00ff00;

const STAR_LANE_DEFAULT_OPACITY = 0.35;
const STAR_LANE_HOVER_OPACITY = 0.7;
const STAR_LANE_SELECTED_OPACITY = 1.0;

const STAR_GLOW_DEFAULT_OPACITY = 0.6;
const STAR_GLOW_HOVER_OPACITY = 0.9;
const STAR_GLOW_SELECTED_OPACITY = 1.0;
const STAR_GLOW_DEFAULT_SCALE = 6.0;
const STAR_GLOW_HOVER_SCALE_FACTOR = 1.25;
const STAR_GLOW_SELECTED_SCALE_FACTOR = 1.50;

// Three.js:n apuvälineet, joilla tarkistetaan, mitkä objektit ovat kameran kuvakulmassa (frustum culling).
const frustum = new THREE.Frustum();
const cameraMatrix = new THREE.Matrix4();

const INDICATOR_BASE_COLOR = 0x6495ED;  // Omistajuutta ilmaisevan spriten väri.
const INDICATOR_SPRITE_SCALE = 2.8;     // Omistajuutta ilmaisevan spriten koko.


// --- InstancedMesh-määritykset (Suorituskykyoptimointi) ---
// `InstancedMesh` on tehokas tapa renderöidä suuria määriä samanlaisia objekteja (kuten aluksia)
// yhdellä ainoalla renderöintikutsulla, mikä parantaa suorituskykyä dramaattisesti.

// Luo yksi `InstancedMesh` per alustyyppi.
const SHIP_INSTANCED_MESHES = {};
const MAX_SHIPS_PER_TYPE = 4000;    // Maksimimäärä aluksia per tyyppi, jonka järjestelmä voi käsitellä.

// Datan hallinta alusten instansseille.
const shipInstanceData = {
    Fighter: { count: 0, matrices: [], colors: [], ids: new Map() },
    Destroyer: { count: 0, matrices: [], colors: [], ids: new Map() },
    Cruiser: { count: 0, matrices: [], colors: [], ids: new Map() },
    'Slipstream Frigate': { count: 0, matrices: [], colors: [], ids: new Map() }
};

// Seuranta vapaille instanssipaikoille, jotta tuhoutuneiden alusten paikat voidaan käyttää uudelleen tehokkaasti.
const freeInstanceSlots = {
    Fighter: new Set(),
    Destroyer: new Set(),
    Cruiser: new Set(),
    'Slipstream Frigate': new Set()
};

// Telakan renkaiden instanssit (yksi per telakkataso).
const SHIPYARD_RING_INSTANCES = {
    level1: null,
    level2: null,
    level3: null,
    level4: null
};

const MAX_SHIPYARDS = 100; // Maksimimäärä per taso.

// Telakan renkaiden datan seuranta.
const shipyardRingData = {
    level1: { count: 0, rotations: [], speeds: [], starIds: [] },
    level2: { count: 0, rotations: [], speeds: [], starIds: [] },
    level3: { count: 0, rotations: [], speeds: [], starIds: [] },
    level4: { count: 0, rotations: [], speeds: [], starIds: [] }
};

// Puolustusrenkaiden (Planetary Defense) instanssit.
let DEFENSE_RING_INSTANCE = null;
const MAX_DEFENSE_RINGS = 500; // Riittävä maksimimäärä

// Puolustusrenkaiden datan seuranta.
const defenseRingData = {
    count: 0,
    starIds: new Array(MAX_DEFENSE_RINGS).fill(null), // Seuraa, mikä tähti omistaa minkäkin rengas-slotin
    ringIndicesByStar: new Map() // starId -> [ring_index1, ring_index2, ...]
};

// Combat ring instances - eli planeetan ympärille muodostuva ring TAISTELUN AIKANA
let COMBAT_RING_INSTANCE = null;
const MAX_COMBAT_RINGS = 50; // Voidaan nostaa!

// Taistelurenkaiden datan seuranta.
const combatRingData = {
    count: 0,
    starIds: [],
    opacities: [],
    rotations: []
};
const freeCombatRingSlots = new Set();


// --- Raycasting ja hiiren käsittely ---
// Nämä ovat Three.js:n työkaluja, joilla selvitetään, mitä 3D-objektia hiiri osoittaa.
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// --- Efektien hallinta ---
// Taulukot, jotka säilövät aktiiviset efektit, jotka tulee päivittää animaatioloopissa.
const explosions = [];
const slipstreamSparkles = [];

// --- Taisteluefektien hallinta (Suorituskykyoptimointi) ---
// Tämä järjestelmä hallitsee suorituskykykriittisiä taisteluefektejä (laserit)
// ja optimoi niiden renderöintiä suurissa taisteluissa.
const combatEffects = new Map();            // Säilöö aktiiviset taisteluefektit tähden ID:n mukaan.
const activeCombatStars = new Set();        // Tähdet, joissa on aktiivinen taistelu.
const starsToCheck = new Set();             // Tähdet, joiden taistelutilanne pitää tarkistaa seuraavaksi.
let lastCombatCheck = 0;                    // Viimeisimmän tarkistuksen aikaleima.
const COMBAT_CHECK_INTERVAL = 500;          // Taistelutarkistus ajetaan vain 2 kertaa sekunnissa.
let globalLaserPool = null;                 // Laser-efektien "allas" (object pool) tehokasta uudelleenkäyttöä varten.
const MAX_ACTIVE_COMBAT_EFFECTS = 100;      // Suorituskykyraja aktiivisille efekteille.


// --- Suorituskyvyn seuranta (FPS) ---
// Muuttujat F3-debug-paneelin tietojen laskemiseen.
let fpsStats = {
    frameCount: 0,
    lastTime: performance.now(),
    fps: 0,
    frameTime: 0,
    lastFrameTime: performance.now()
};
let frameSkipCounter = 0; 
let performanceMonitor = {
    lastCleanup: Date.now(),
    cleanupInterval: 5000, 
    shipCount: 0,
    effectCount: 0
};



/* ========================================================================== */
/* TEKSTUURIT JA MATERIAALIT                                                  */
/* ========================================================================== */
// Tämä osio sisältää apufunktioita, jotka luovat dynaamisesti erilaisia
// tekstuureja käyttämällä HTML5 Canvas API:a. Tämä lähestymistapa on tehokas,
// koska se vähentää riippuvuutta ulkoisista kuvatiedostoista ja mahdollistaa
// visuaalisten elementtien helpon muokkaamisen suoraan koodista.

/**
 * MITÄ: Luo pehmeän, säteittäisen hehkutekstuurin.
 * MIKSI: Käytetään tähtien ympärillä olevissa hehkuissa (glow sprites) luomaan
 * tunnelmallinen ja elävä vaikutelma.
 * @returns {THREE.CanvasTexture} Three.js:n ymmärtämä tekstuuriobjekti.
 */
function createGlowTexture() {
    // 1. Luo muistiin väliaikainen HTML5 <canvas>-elementti, joka toimii piirtoalustana.
    const canvas = document.createElement('canvas');
    // 2. Määritetään piirtoalustan koko. 128x128 on riittävän tarkka hehkuefektille.
    canvas.width = 128;
    canvas.height = 128;
    // 3. Haetaan canvasin 2D-piirtokonteksti, joka tarjoaa työkalut piirtämiseen.
    const context = canvas.getContext('2d');
    // 4. Luodaan säteittäinen liukuväri (radial gradient). Tämä on funktion ydin.
    // Parametrit: (x0, y0, r0, x1, y1, r1)
    // Se alkaa keskeltä (x0, y0) säteellä 0 (r0) ja päättyy samaan keskipisteeseen (x1, y1)
    // mutta ulottuu koko leveyden mitalle (r1 = canvas.width / 2).
    const gradient = context.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, canvas.width / 2
    );
    // 5. Määritellään liukuvärin väripisteet.
    // 'addColorStop(piste, väri)' - piste on 0.0 (keskusta) - 1.0 (reuna).
    // Tämä luo efektin, joka on kirkas keskeltä ja häipyy reunoja kohti.
    gradient.addColorStop(0, 'rgba(255,215,255,0.8)');  // Keskusta: kirkas, lähes valkoinen
    gradient.addColorStop(0.3, 'rgba(255,255,200,0.5)');    // Hieman ulompana: kellertävä, läpikuultavampi
    gradient.addColorStop(1, 'rgba(255,255,150,0)');    // Reuna: täysin läpinäkyvä
    // 6. Asetetaan piirtoväriksi juuri luomamme liukuväri.
    context.fillStyle = gradient;
    // 7. Piirretään suorakulmio, joka täyttää koko canvasin tällä liukuvärillä.
    context.fillRect(0, 0, canvas.width, canvas.height);
    // 8. Muunnetaan valmis canvas-piirros Three.js:n ymmärtämäksi tekstuuriksi ja palautetaan se.
    return new THREE.CanvasTexture(canvas);
}


/**
 * MITÄ: Luo pehmeän, valkoisen pistetekstuurin.
 * MIKSI: Käytetään pelin taustalla olevien tuhansien pienten tähtien renderöintiin.
 * Säteittäinen gradientti antaa tähdille pehmeät reunat, mikä näyttää paremmalta kuin terävä piste.
 * @returns {THREE.CanvasTexture} Three.js:n ymmärtämä tekstuuriobjekti.
 */
function createSoftStarTexture() {
    // 1. Luodaan piirtoalusta (canvas).
    const c = document.createElement('canvas');
    // 2. Asetetaan sen kooksi 64x64 pikseliä.
    c.width = c.height = 64;
    // 3. Haetaan 2D-piirtokonteksti.
    const ctx = c.getContext('2d');
    // 4. Luodaan säteittäinen liukuväri, joka alkaa ja päättyy canvasin keskelle (32, 32).
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    // 5. Määritellään värisiirtymät pehmeän reunan luomiseksi.
    g.addColorStop(0.00, 'rgba(255,255,255,1)');    // Keskusta: täysin peittävä valkoinen.
    g.addColorStop(0.50, 'rgba(255,255,255,0.6)');  // Puolivälissä: puoliksi läpinäkyvä valkoinen.
    g.addColorStop(1.00, 'rgba(255,255,255,0)');    // Reuna: täysin läpinäkyvä.
    // 6. Asetetaan liukuväri piirtoväriksi.
    ctx.fillStyle = g;
    // 7. Piirretään koko canvas täyteen tällä liukuvärillä.
    ctx.fillRect(0, 0, 64, 64);
    // 8. Luodaan canvas-elementistä Three.js-tekstuuri.
    const tex = new THREE.CanvasTexture(c);
    // 9. Määritetään oikea värimuoto (sRGB) varmistamaan, että värit näkyvät oikein.
    tex.encoding = THREE.sRGBEncoding;
    // 10. Palautetaan valmis tekstuuriobjekti.
    return tex;
}


/**
 * MITÄ: Luo suuren, monivärisen sumutekstuurin (nebula).
 * MIKSI: Käytetään suurten, läpinäkyvien avaruussumujen luomiseen, jotka lisäävät
 * syvyyttä ja visuaalista mielenkiintoa pelimaailman taustalle.
 * @param {number} [size=1024] - Tekstuurin leveys ja korkeus pikseleinä.
 * @returns {THREE.CanvasTexture} Three.js:n ymmärtämä tekstuuriobjekti.
 */
function createNebulaTexture(size = 1024) {
    // Toimii samalla periaatteella kuin aiemmat, mutta käyttää suurempaa kokoa
    // ja monimutkaisempaa, moniväristä liukuväriä.
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(
        size/2, size/2, 40,     // Sisempi ympyrä on pieni
        size/2, size/2, size/2      // Ulompi ympyrä on suuri
    );
    // Värisiirtymät luovat sinertävän, purppuraan ja punaiseen taittuvan sumuefektin.
    g.addColorStop(0.00, 'rgba(100, 80,255,0.85)');
    g.addColorStop(0.25, 'rgba( 40, 60,200,0.55)');
    g.addColorStop(0.55, 'rgba( 220, 30,120,0.25)');
    g.addColorStop(1.00, 'rgba(  0,  0,  0,0.00)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.needsUpdate = true;     // Varmistetaan, että tekstuuri päivittyy oikein.
    return tex;
}


/**
 * MITÄ: Luo yksinkertaisen, yksivärisen neliötekstuurin.
 * MIKSI: Apufunktio, jota käytetään luomaan indikaattoreita (esim. kaivosindikaattori)
 * ilman erillisiä kuvatiedostoja.
 * @param {THREE.Color|number|string} color - Tekstuurin väri.
 * @returns {THREE.CanvasTexture} Three.js:n ymmärtämä tekstuuriobjekti.
 */
function createSquareTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    // Muunnetaan Three.js:n väriarvo CSS-yhteensopivaksi merkkijonoksi.
    context.fillStyle = new THREE.Color(color).getStyle();
    // Piirretään täytetty suorakulmio, joka peittää koko canvasin.
    context.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(canvas);
}


/**
 * MITÄ: Luo yksinkertaisen, yksivärisen ympyrätekstuurin.
 * MIKSI: Apufunktio, jota käytetään luomaan indikaattoreita (esim. populaatioindikaattori).
 * @param {THREE.Color|number|string} color - Tekstuurin väri.
 * @returns {THREE.CanvasTexture} Three.js:n ymmärtämä tekstuuriobjekti.
 */
function createCircleTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    // Aloitetaan uusi piirtopolku.
    context.beginPath();
    // Piirretään ympyräkaari: keskipiste (16,16), säde 15, alkaa 0 radiaanista ja päättyy 2*PI radiaaniin (täysi ympyrä).
    context.arc(16, 16, 15, 0, 2 * Math.PI, false);
    context.fillStyle = new THREE.Color(color).getStyle();
    // Täytetään luotu polku (ympyrä) värillä.
    context.fill();
    return new THREE.CanvasTexture(canvas);
}


/**
 * MITÄ: Luo yksinkertaisen, yksivärisen kahdeksankulmiotekstuurin.
 * MIKSI: Apufunktio, jota käytetään luomaan indikaattoreita (esim. telakkaindikaattori).
 * @param {THREE.Color|number|string} color - Tekstuurin väri.
 * @returns {THREE.CanvasTexture} Three.js:n ymmärtämä tekstuuriobjekti.
 */
function createOctagonTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const numberOfSides = 8;
    const size = 32;    // Kahdeksankulmion säde
    const Xcenter = 32;
    const Ycenter = 32;
    // Aloitetaan piirtopolku.
    ctx.beginPath();
    // Siirrytään ensimmäiseen kärkipisteeseen ympyrän kehällä.
    ctx.moveTo(Xcenter + size * Math.cos(0), Ycenter + size * Math.sin(0));
    // Käydään silmukassa läpi loput kärkipisteet ja piirretään viiva jokaiseen.
    for (var i = 1; i <= numberOfSides; i += 1) {
        ctx.lineTo(Xcenter + size * Math.cos(i * 2 * Math.PI / numberOfSides), 
                   Ycenter + size * Math.sin(i * 2 * Math.PI / numberOfSides));
    }
    ctx.fillStyle = new THREE.Color(color).getStyle();
    // Täytetään luotu monikulmio värillä.
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
}


/**
 * MITÄ: Luo kirkkaan, hehkuvan kipinätekstuurin.
 * MIKSI: Käytetään räjähdysanimaatioiden partikkeliefekteissä luomaan visuaalisesti
 * näyttäviä ja dynaamisia räjähdyksiä.
 * @returns {THREE.CanvasTexture} Three.js:n ymmärtämä tekstuuriobjekti.
 */
function createSparkTexture() {
    // Toimii samalla periaatteella kuin softStarTexture, mutta käyttää eri värejä
    // luomaan tulisen, oranssiin vivahtavan kipinäefektin.
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');   // Kirkas valkoinen ydin
    g.addColorStop(0.3, 'rgba(255,200,80,1)');  // Oranssinkeltainen hehku
    g.addColorStop(1, 'rgba(255,200,80,0)');    // Häipyy läpinäkyväksi
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}


// --- Globaalit Tekstuurit ja Materiaalit ---
// Nämä luodaan kerran ja tallennetaan globaaleihin muuttujiin, jotta niitä voidaan
// uudelleenkäyttää tehokkaasti ilman, että niitä tarvitsee luoda joka kerta uudelleen.
const glowTexture = createGlowTexture();
const softStarTex = createSoftStarTexture();
const NEBULA_TEXTURE = createNebulaTexture(768);
const SPARK_TEX = createSparkTexture();

// Kipinämateriaali, käytetään räjähdyksissä.
const SPARK_MAT = new THREE.PointsMaterial({
    map: SPARK_TEX,
    size: 3,
    transparent: true,
    blending: THREE.AdditiveBlending,   // Luo kirkkaan, valoa lisäävän efektin.
    depthWrite: false       // Estää partikkeleita peittämästä toisiaan luonnottomasti.
});

// Starlane-materiaali, käytetään tähtien välisissä yhteyksissä.
const STARLANE_MAT = new THREE.LineBasicMaterial({
    color: 0x8888ff,
    transparent: true,
    opacity: STAR_LANE_DEFAULT_OPACITY,
    depthWrite: false
});

// Taulukko värisävyistä, joita käytetään tähtisumujen värjäämiseen.
const NEBULA_TINTS = [0x4477ff, 0x7755dd, 0x8844bb, 0xaa3377, 0x9944cc, 0x0094cc];


/**
 * Tehdasfunktio, joka luo joukon erivärisiä sumumateriaaleja.
 * @param {number} opacity - Materiaalien läpinäkyvyys.
 * @returns {THREE.SpriteMaterial[]} Taulukko materiaaleja.
 */
function buildNebulaMaterials(opacity) {
    // Käydään läpi kaikki värisävyt ja luodaan jokaiselle oma materiaali.
    return NEBULA_TINTS.map(col =>
        new THREE.SpriteMaterial({
            map: NEBULA_TEXTURE,
            color: col,
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        })
    );
}

// Valmiiksi luodut materiaalijoukot eri kokoisille sumuille.
const MAT_SMALL = buildNebulaMaterials(0.06);
const MAT_BIG = buildNebulaMaterials(0.18);

// Muuttujat indikaattorimateriaaleille, jotka alustetaan myöhemmin.
let mineIndicatorTexture, popIndicatorTexture, shipyardIndicatorTexture;
let mineSpriteMaterial, popSpriteMaterial, shipyardSpriteMaterial;


/**
 * Apufunktio `shipsByStarClient`-hakurakenteen sisällön debuggaamiseen konsoliin.
 */
// function debugShipsByStarClient() {
//     // console.log('[DEBUG] Ships by star:');
//    shipsByStarClient.forEach((ships, starId) => {
//        const star = starsById.get(starId);
//        const starName = star?.userData?.starData?.name || 'Unknown';
//         // console.log(`  ${starName}: ${ships.size} ships`);
//    });
// }



/* ========================================================================== */
/*  TAISTELUEFEKTIT PELAAJAN VIIHDYTTÄMISEKSI KUNNES RESULT TAISTELUSTA       */
/* ========================================================================== */

/**
 * MITÄ: Hallinnoi räjähdysefektien "allasta" (pool).
 * MIKSI: Tämä luokka toteuttaa "object pooling" -suunnittelumallin. Sen sijaan, että
 * loisimme ja tuhoaisimme jatkuvasti uusia, raskaita 3D-objekteja räjähdyksille
 * (mikä aiheuttaisi pätkimistä), tämä luokka luo alussa tietyn määrän
 * räjähdyksiä valmiiksi. Kun räjähdys tarvitaan, se "lainataan" altaasta,
 * ja kun se on valmis, se "palautetaan" sinne uudelleenkäyttöä varten.
 * Tämä on erittäin tehokasta ja parantaa suorituskykyä dramaattisesti.
 */
class ExplosionPool {
    /**
     * @param {THREE.Scene} scene - Viittaus pää-scenen, johon räjähdykset lisätään.
     * @param {number} [maxExplosions=50] - Kuinka monta räjähdystä altaaseen luodaan valmiiksi.
     */
    constructor(scene, maxExplosions = 50) {
        this.scene = scene;
        this.available = []; // Allas, joka säilöö vapaana olevat, uudelleenkäytettävät räjähdykset.
        this.active = [];    // Taulukko, joka säilöö tällä hetkellä näkyvissä ja animoitavat räjähdykset.

        // Luodaan YKSI materiaali, jota kaikki räjähdyspartikkelit jakavat. Tämä säästää muistia.
        this.sparkMaterial = new THREE.PointsMaterial({
            map: SPARK_TEX, // Käytä olemassa olevaa tekstuuria
            size: 3,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true // Tärkeä! Sallii partikkelien värjäämisen yksilöllisesti.
        });
        
        // --- Esialustusvaihe ---
        // Luodaan kaikki räjähdysobjektit valmiiksi muistiin.
        for (let i = 0; i < maxExplosions; i++) {
            const particleCount = 12; // Partikkelien määrä per räjähdys.
            const geometry = new THREE.BufferGeometry();
            
            // Luodaan tyhjät taulukot partikkelien sijainneille (positions) ja väreille (colors).
            // Nämä täytetään myöhemmin `spawn`-metodissa.
            const positions = new Float32Array(particleCount * 3);
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            
            // Colors
            const colors = new Float32Array(particleCount * 3);
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            
            // Luodaan varsinainen Three.js-objekti (`Points`) ja lisätään se sceneen.
            const points = new THREE.Points(geometry, this.sparkMaterial);
            points.visible = false; // Piilotetaan se oletuksena.
            this.scene.add(points);
            
            // Työnnetään valmis, mutta piilotettu räjähdys "vapaiden" altaaseen.
             this.available.push({
                points: points,                       // Viittaus Three.js-objektiin.
                velocities: new Array(particleCount), // Taulukko partikkelien nopeusvektoreille.
                life: 0,                              // Räjähdyksen nykyinen elinikä.
                ttl: 0.8,                             // Räjähdyksen maksimielinikä sekunteina.
                active: false                         // Onko tämä räjähdys tällä hetkellä käytössä.
            });
            
            // Alustetaan jokaiseen partikkeliin liittyvä nopeusvektori valmiiksi.
            for (let j = 0; j < particleCount; j++) {
                this.available[i].velocities[j] = new THREE.Vector3();
            }
        }
    }
    

        /**
     * MITÄ: Aktivoi yhden räjähdyksen altaasta.
     * MIKSI: Tämä on "lainaustoiminto". Se ottaa vapaan räjähdyksen, asettaa sen
     * parametrit (sijainti, nopeus, väri) ja siirtää sen aktiivisten listalle
     * animoitavaksi.
     * @param {THREE.Vector3} position - Sijainti, johon räjähdys luodaan.
     * @param {string} [type='small'] - Räjähdyksen tyyppi ('small', 'medium', 'spark').
     * @returns {object|null} Palauttaa aktivoidun räjähdysobjektin tai null, jos allas on tyhjä.
     */
    spawn(position, type = 'small') {
        // Otetaan viimeisin vapaa räjähdys altaasta.
        const explosion = this.available.pop();
        if (!explosion) return null; // Jos allas on tyhjä, ei tehdä mitään.
        
        // Haetaan viittaukset räjähdyksen osiin koodin selkeyttämiseksi.
        const { points, velocities } = explosion;
        const positions = points.geometry.attributes.position.array;
        const colors = points.geometry.attributes.color.array;
        const particleCount = velocities.length;
        
        // Asetetaan räjähdyksen ulkonäkö tyypin mukaan.
        let speed, color, size;
        switch(type) {
            case 'small':
                speed = 15;
                color = new THREE.Color(1, 0.8, 0.3); // Oranssi
                size = 2;
                break;
            case 'medium':
                speed = 25;
                color = new THREE.Color(1, 0.5, 0.2); // Punainen
                size = 3;
                break;
            case 'spark':
                speed = 10;
                color = new THREE.Color(1, 1, 0.8); // Valkoinen
                size = 1.5;
                break;
        }
        
        points.material.size = size;
        
        // Alustetaan jokainen partikkeli räjähdyksessä.
        for (let i = 0; i < particleCount; i++) {
            // Asetetaan kaikki partikkelit aluksi räjähdyksen keskipisteeseen (0,0,0).
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;
            
            // Annetaan kullekin partikkelille satunnainen suunta ja nopeus.
            velocities[i].set(
                (Math.random() - 0.5),
                (Math.random() - 0.5),
                (Math.random() - 0.5)
            ).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.5));
            
            // Annetaan kullekin partikkelille pieni satunnainen värivaihtelu.
            colors[i * 3] = color.r * (0.8 + Math.random() * 0.2);
            colors[i * 3 + 1] = color.g * (0.8 + Math.random() * 0.2);
            colors[i * 3 + 2] = color.b * (0.8 + Math.random() * 0.2);
        }
        
        // Ilmoitetaan Three.js:lle, että geometriaa on muutettu ja se pitää päivittää näytönohjaimelle.
        points.geometry.attributes.position.needsUpdate = true;
        points.geometry.attributes.color.needsUpdate = true;
        
        // Siirretään koko räjähdysobjekti haluttuun paikkaan maailmassa ja tehdään se näkyväksi.
        points.position.copy(position);
        points.visible = true;
        
        // Nollataan räjähdyksen elinkaari ja asetetaan sille hieman satunnaisuutta.
        explosion.life = 0;
        explosion.ttl = 0.6 + Math.random() * 0.2; // Vähän vaihtelua
        explosion.active = true;
        
        // Siirretään räjähdys vapaiden altaasta aktiivisten altaaseen.
        this.active.push(explosion);
        return explosion;
    }
    

    /**
     * MITÄ: Päivittää kaikkien aktiivisten räjähdysten tilan.
     * MIKSI: Tätä funktiota kutsutaan jokaisessa animaatioframessa. Se liikuttaa
     * partikkeleita, himmentää niitä ja lopulta palauttaa "kuolleet" räjähdykset
     * takaisin altaaseen.
     * @param {number} delta - Edellisestä framesta kulunut aika sekunteina.
     */
    update(delta) {
        // Pieni optimointi: päivitetään vain joka toisessa framessa.
        if (frameSkipCounter % 2 !== 0) return;

        // Käydään aktiivisten räjähdysten lista läpi lopusta alkuun.
        // Tämä on turvallinen tapa, jos poistamme elementtejä listasta kesken silmukan.
        for (let i = this.active.length - 1; i >= 0; i--) {
            const explosion = this.active[i];
            if (!explosion.active) continue;
            
            // Kasvatetaan räjähdyksen elinikää.
            explosion.life += delta;
            const progress = explosion.life / explosion.ttl;
            
            // Jos räjähdyksen elinikä on täynnä...
            if (progress >= 1) {
                // ...se "kuolee": piilotetaan, deaktivoidaan ja palautetaan vapaiden altaaseen.
                explosion.points.visible = false;
                explosion.active = false;
                this.available.push(explosion);
                this.active.splice(i, 1);   // Poistetaan aktiivisten listalta.
                continue;
            }
            
            // Himmennetään räjähdystä sen eliniän mukaan.
            explosion.points.material.opacity = 1 - progress;
            
            // Päivitetään jokaisen partikkelin sijainti sen nopeuden perusteella.
            const positions = explosion.points.geometry.attributes.position.array;
            const velocities = explosion.velocities;
            
            for (let j = 0; j < velocities.length; j++) {
                positions[j * 3] += velocities[j].x * delta;
                positions[j * 3 + 1] += velocities[j].y * delta;
                positions[j * 3 + 2] += velocities[j].z * delta;
                
                // Simuloitu painovoima vetää partikkeleita alaspäin.
                velocities[j].y -= 10 * delta;
            }
            
            // Ilmoitetaan Three.js:lle, että sijainnit ovat muuttuneet.
            explosion.points.geometry.attributes.position.needsUpdate = true;
        }
    }
    
    /**
     * MITÄ: Siivoaa kaikki luodut Three.js-objektit muistista.
     * MIKSI: Välttämätön funktio muistivuotojen estämiseksi. Kun peli lopetetaan
     * tai aloitetaan alusta, tämä vapauttaa näytönohjaimen muistin, jota
     * geometriat ja materiaalit käyttivät.
     */
    cleanup() {
        this.available.forEach(exp => {
            this.scene.remove(exp.points);
            exp.points.geometry.dispose();
        });
        this.active.forEach(exp => {
            this.scene.remove(exp.points);
            // Geometria on jo vapautettu, koska se on sama kuin available-listalla.
        });
        this.sparkMaterial.dispose();
    }
}



/**
 * MITÄ: Hallinnoi yksittäisen tähden ympärillä näkyviä taisteluefektejä.
 * MIKSI: Kapseloi kaiken yhden taistelun visuaaliseen esittämiseen liittyvän
 * logiikan (pyörivä rengas, räjähdysten luominen) yhteen, helposti hallittavaan olioon.
 * Tämä on yksinkertaistettu versio, joka keskittyy räjähdyksiin ja renkaaseen.
 */
class CombatEffectGroup {
    /**
     * @param {THREE.Object3D} star - Viittaus siihen tähti-objektiin, jonka ympärillä taistelu käydään.
     * @param {THREE.Scene} scene - Pää-scene, johon efektit lisätään.
     */
    constructor(star, scene) {
        this.star = star;
        this.scene = scene;
        this.active = true;         // Lippu, joka kertoo, onko tämä efektiryhmä aktiivinen.
        this.explosionTimer = 0;    // Ajastin, joka säätelee räjähdysten tiheyttä.
        this.instanceIndex = -1;    // Indeksi, joka kertoo, minkä paikan tämä efekti käyttää InstancedMesh-objektista.
        this.createEffects();       // Kutsutaan heti efektien luontia.
    }
    

    /**
     * MITÄ: Aktivoi ja asettaa taistelurenkaan tälle efektiryhmälle.
     * MIKSI: Tämä metodi käyttää object pooling -tekniikkaa tehokkuuden maksimoimiseksi.
     * Se etsii ensin vapaata paikkaa (`slot`) ja käyttää sen, tai jos vapaita ei ole,
     * ottaa käyttöön uuden.
     */
    createEffects() {
        // Varmistetaan, että globaali taistelurengas-instanssi on olemassa.
        if (!COMBAT_RING_INSTANCE) return;
        
        const data = combatRingData;

        // Tarkistetaan, onko vapaita, aiemmin käytettyjä paikkoja olemassa.
        if (freeCombatRingSlots.size > 0) {
            // Jos on, otetaan yksi vapaa paikka uudelleenkäyttöön.
            this.instanceIndex = freeCombatRingSlots.values().next().value;
            freeCombatRingSlots.delete(this.instanceIndex);
        } else {
            // Jos vapaita paikkoja ei ole, otetaan uusi paikka listan perältä.
            this.instanceIndex = data.count;
            data.count++;
        }
        
        // Luodaan väliaikainen "dummy"-objekti, jonka avulla asetetaan oikea sijainti ja rotaatio.
        const dummy = new THREE.Object3D();
        dummy.position.copy(this.star.position);
        dummy.rotation.x = Math.PI / 2; // Käännetään rengas "makaamaan" tasossa.
        dummy.updateMatrix(); // Lasketaan muunnosmatriisi.
        
        // Asetetaan juuri laskettu matriisi oikealle paikalle InstancedMesh-objektissa.
        COMBAT_RING_INSTANCE.setMatrixAt(this.instanceIndex, dummy.matrix);
        
        // Tallennetaan tämän instanssin metadata (sijainti, läpinäkyvyys, rotaatio).
        data.starIds[this.instanceIndex] = this.star.userData.starData._id;
        data.opacities[this.instanceIndex] = 0.1;   // Aloitetaan himmeänä.
        data.rotations[this.instanceIndex] = 0;
        
        // Ilmoitetaan Three.js:lle, että instanssien data on muuttunut ja se pitää päivittää.
        COMBAT_RING_INSTANCE.count = data.count;
        COMBAT_RING_INSTANCE.instanceMatrix.needsUpdate = true;
    }
    

    /**
     * MITÄ: Päivittää efektiryhmän tilan joka framessa.
     * MIKSI: Tämä on animaation moottori. Se pyörittää rengasta ja laukaisee
     * räjähdyksiä perustuen taistelun intensiteettiin (alusten määrään).
     * @param {number} delta - Edellisestä framesta kulunut aika.
     * @param {Array<THREE.Object3D>} ships - Taistelussa mukana olevat alus-objektit.
     */
    update(delta, ships) {
        if (!this.active || this.instanceIndex === -1) return;
        
        // Päivitetään renkaan rotaatiota jatkuvasti.
        combatRingData.rotations[this.instanceIndex] += delta * 0.2;
        
        // --- Räjähdyslogiikka ---
        this.explosionTimer += delta;
        
        if (ships.length > 0) {
            // Mitä enemmän aluksia, sitä tiheämmin räjähtelee.
            const explosionRate = 0.2 - Math.min(0.15, ships.length * 0.02); // 0.05-0.2 sekuntia
            
            if (this.explosionTimer > explosionRate) {
                this.explosionTimer = 0;
                
                // Mitä enemmän aluksia, sitä useampi räjähdys kerralla.
                const explosionCount = Math.min(3, 1 + Math.floor(ships.length / 5));
                
                for (let i = 0; i < explosionCount; i++) {
                    this.spawnCombatExplosion(ships);
                }
            }
        }
    }
    

    /**
     * MITÄ: Luo yksittäisen räjähdyksen taistelualueelle.
     * MIKSI: Tekee taistelusta visuaalisesti mielenkiintoisemman. Sijoittaa räjähdykset
     * fiksusti joko alusten lähelle tai satunnaisesti planeetan ympärille.
     * @param {Array<THREE.Object3D>} ships - Taistelussa mukana olevat alukset.
     */
    spawnCombatExplosion(ships) {
        let position;
        
        // Todennäköisyys (70%) sille, että räjähdys tapahtuu lähellä jotakin alusta.
        if (Math.random() < 0.7 && ships.length > 0) {
            // Valitse satunnainen alus
            const ship = ships[Math.floor(Math.random() * ships.length)];
            // Lisätään pieni satunnainen siirtymä, jotta räjähdys ei ole täsmälleen aluksen sisällä.
            const offset = new THREE.Vector3(
                (Math.random() - 0.5) * 10,
                (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 10
            );
            position = ship.position.clone().add(offset);
        } else {
            // Muussa tapauksessa luodaan räjähdys satunnaiseen paikkaan planeetan kiertoradalle.
            const angle = Math.random() * Math.PI * 2;
            const radius = 20 + Math.random() * 15;
            const height = (Math.random() - 0.5) * 10;
            
            position = new THREE.Vector3(
                this.star.position.x + Math.cos(angle) * radius,
                this.star.position.y + height,
                this.star.position.z + Math.sin(angle) * radius
            );
        }
        
        // Käytetään globaalia `ExplosionPool`-allasta räjähdyksen luomiseen tehokkaasti.
        if (window.explosionPool) {
            // Vaihtele räjähdystyyppejä
            const types = ['small', 'small', 'medium', 'spark']; // Enemmän pieniä
            const type = types[Math.floor(Math.random() * types.length)];
            window.explosionPool.spawn(position, type);
        } else {
            // Varakoodi, jos poolia ei jostain syystä löytyisi.
            spawnExplosion(position, 8 + Math.floor(Math.random() * 6));
        }
    }
    

    /**
     * MITÄ: Siivoaa tämän efektiryhmän ja palauttaa sen resurssit takaisin altaaseen.
     * MIKSI: Välttämätön osa object pooling -mallia. Kun taistelu päättyy, tämä
     * metodi "vapauttaa" taistelurenkaan paikan, jotta jokin toinen taistelu voi
     * käyttää sen uudelleen.
     */
    cleanup() {
        this.active = false;
        
        if (this.instanceIndex !== -1 && COMBAT_RING_INSTANCE) {
            const data = combatRingData;
            
            // Tehokkain tapa piilottaa instanssi on skaalata sen matriisi nollaan.
            const dummy = new THREE.Object3D();
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            COMBAT_RING_INSTANCE.setMatrixAt(this.instanceIndex, dummy.matrix);
            
            // Nollataan metadata.
            data.starIds[this.instanceIndex] = null;
            data.opacities[this.instanceIndex] = 0;
            data.rotations[this.instanceIndex] = 0;
            
            // Tärkein vaihe: Palautetaan tämän instanssin indeksi takaisin vapaiden slottien joukkoon.
            freeCombatRingSlots.add(this.instanceIndex);

            COMBAT_RING_INSTANCE.instanceMatrix.needsUpdate = true;
        }
    }
}



/* ========================================================================== */
/*  INITTHREE - PÄÄFUNKTIO                                                    */
/* ========================================================================== */

/**
 * MITÄ: Alustaa kaikki Three.js-peruskomponentit ja rakentaa scenen rungon.
 * MIKSI: Tämä on sovelluksen visuaalisen puolen pääkäynnistysfunktio. Se luo
 * kaiken tarvittavan renderöintiä varten: scenen, kameran, renderöijän, kontrollit
 * ja valaistuksen. Se myös kutsuu muita apufunktioita, jotka luovat pelin
 * visuaaliset elementit. Funktio on suunniteltu suoritettavaksi vain kerran.
 * @param {HTMLElement} [mountTo=document.body] - Elementti, johon canvas liitetään.
 */
export function initThreeIfNeeded(mountTo = document.body) {
    // Vartiolauseke: Jos alustus on jo tehty, poistutaan heti. Estää uudelleenalustuksen.
    if (ready) return;
    ready = true;

    // --- Scenen alustus ---
    // Scene on virtuaalinen "maailma", joka sisältää kaikki 3D-objektit, valot ja kamerat.
    scene = new THREE.Scene();
    
    // --- Kameran alustus ---
    // PerspectiveCamera simuloi ihmissilmän perspektiiviä.
    // Parametrit: (FOV, kuvasuhde, lähellä oleva leikkaustaso, kaukana oleva leikkaustaso)
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
    // Asetetaan kameran alkusijainti koordinaatistossa.
    camera.position.set(0, 100, 220);

    // --- Renderöijän alustus ---
    // WebGLRenderer on komponentti, joka piirtää scenen selaimen canvas-elementtiin käyttäen WebGL-rajapintaa.
    renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('gameCanvas') || document.createElement('canvas'),
        antialias: true, // Pehmentää sahalaitaisia reunoja.
        powerPreference: "high-performance" // Pyytää selainta käyttämään tehokkaampaa näytönohjainta, jos mahdollista.
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    // Jos canvas-elementtiä ei löytynyt valmiina HTML:stä, luodaan se ja liitetään DOM:iin.
    if (!document.getElementById('gameCanvas')) {
        renderer.domElement.id = 'gameCanvas';
        renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:1;cursor:default;';
        mountTo.appendChild(renderer.domElement);
    }

    // --- Valaistuksen alustus ---
    // AmbientLight valaisee kaikkia objekteja tasaisesti joka suunnasta. Ei luo varjoja.
    const ambientLight = new THREE.AmbientLight(0x909090, 1);
    scene.add(ambientLight);
    // DirectionalLight simuloi kaukaista valonlähdettä, kuten aurinkoa. Luo varjoja ja korostuksia.
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
    directionalLight.position.set(70, 100, 60);
    scene.add(directionalLight);

    // --- Kontrollien alustus ---
    // OrbitControls mahdollistaa scenen kiertämisen, panoroinnin ja zoomauksen hiirellä.
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;      // Luo pehmeän, jatkuvan liikkeen pysäytyksen jälkeen. Vaatii controls.update() animaatioloopissa.
    controls.dampingFactor = 0.05;      // Damping-efektin voimakkuus.
    controls.screenSpacePanning = true; // Mahdollistaa panoroinnin (raahaus oikealla hiirellä).
    controls.maxDistance = 2000;        // Kuinka kauas kameralla voi zoomata.
    controls.minDistance = 10;          // Kuinka lähelle kameralla voi zoomata.

    // --- Jälkikäsittely (Post-processing) ---
    // Asetetaan EffectComposer, joka mahdollistaa erilaisten visuaalisten efektien
    // (kuten hehkun tai syväterävyyden) lisäämisen renderöityyn kuvaan.
    setupPostProcessing();

    // --- Taustaelementtien luonti ---
    createBackgroundStarfield();
    createNebulaSprites();
    
    // --- InstancedMesh-järjestelmien alustus ---
    // Kutsutaan funktioita, jotka luovat valmiiksi suorituskykyiset InstancedMesh-objektit
    // kaikille pelin toistuville elementeille (alukset, renkaat).
    initShipInstances(); 
    Object.values(SHIP_INSTANCED_MESHES).forEach(mesh => {
        mesh.frustumCulled = false;     // Optimointi: estetään Three.js:ää piilottamasta näitä automaattisesti.
        if (!scene.children.includes(mesh)) {
            scene.add(mesh);
        }
    });
    initShipyardRingInstances();
    initDefenseRingInstances();
    initCombatRingInstances();

    // --- Muiden visuaalisten elementtien alustus ---
    initIndicatorMaterials();       // Alustaa materiaalit pienille UI-indikaattoreille.

    // --- Tapahtumankuuntelijat 3D-maailmalle ---
    // Tämä kutsu liittää hiiren ja näppäimistön tapahtumankuuntelijat suoraan
    // renderöijän canvas-elementtiin. Tämä on välttämätöntä 3D-maailman
    // interaktioille (tähden valinta, kameran ohjaus), kun taas `client.js`:n
    // vastaava funktio hoitaa 2D-käyttöliittymän (napit, valikot).
     setupEventListeners();

    // Alustetaan valinnan indikaattori
     initializeSelectionIndicator(); // Luo visuaalisen renkaan, joka näytetään valitun tähden ympärillä.

    // Luodaan ja tallennetaan globaali räjähdysallas myöhempää käyttöä varten.
    window.explosionPool = new ExplosionPool(scene, 50);

    // Lisätään tapahtumankuuntelija, joka pitää renderöintialueen oikean kokoisena selainikkunan muuttuessa.
    window.addEventListener('resize', onWindowResize, false);
}


/**
 * MITÄ: Alustaa Three.js:n EffectComposerin ja perus-renderöintipassin.
 * MIKSI: Tämä luo puitteet, joiden päälle voidaan tulevaisuudessa lisätä monimutkaisempia
 * jälkikäsittelyefektejä (post-processing), kuten hehkua (bloom) tai syväterävyyttä.
 * Tällä hetkellä se vain varmistaa, että scene renderöidään composerin kautta.
 */
function setupPostProcessing() {
    // EffectComposer on työkalu, jolla hallitaan peräkkäin ajettavia renderöintipasseja ja efektejä.
    composer = new EffectComposer(renderer);
    
    // RenderPass on peruspassi, joka yksinkertaisesti renderöi annetun scenen käyttäen annettua kameraa.
    const starsPass = new RenderPass(scene, camera);
    starsPass.clear = true; // Varmistaa, että ruutu tyhjennetään ennen tämän passin piirtämistä.
    composer.addPass(starsPass);
}


/**
 * MITÄ: Päivittää sumujen (nebula) näkyvyyden ja suunnan.
 * MIKSI: Tämä on tärkeä suorituskykyoptimointi. Sen sijaan, että kaikki sadat
 * sumut olisivat aina näkyvissä, tämä funktio tarkistaa, mitkä niistä ovat
 * tällä hetkellä kameran näkökentässä (frustum), ja kääntää vain ne kohti kameraa.
 * Tämä "billboarding"-tekniikka säästää resursseja.
 */
function updateVisibleNebulas() {
    // 1. Päivitetään kameran matriisi, joka yhdistää sen projektion ja sijainnin maailmassa.
    cameraMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // 2. Asetetaan "frustum" (kameran pyramidinmuotoinen näkymäalue) tämän matriisin perusteella.
    frustum.setFromProjectionMatrix(cameraMatrix);
    
    // 3. Käydään läpi kaikki sumu-spritet.
    nebulaSprites.forEach(sp => {
        // 4. Tarkistetaan, leikkaako sumun sijainti kameran näkymäaluetta.
        if (frustum.intersectsObject(sp)) {
            // 5. Jos leikkaa, käännetään sumu osoittamaan suoraan kameraan.
            // Tämä luo illuusion 2D-kuvasta, joka on aina pelaajaa kohti.
            sp.quaternion.copy(camera.quaternion);
        }
    });
}


/**
 * MITÄ: "Tehdasfunktio", joka luo ja palauttaa oikean 3D-geometrian alustyypin perusteella.
 * MIKSI: Keskittää kaikkien alusten perusmuotojen luomisen yhteen paikkaan.
 * Tämä tekee uusien alustyyppien lisäämisestä tai vanhojen muokkaamisesta helppoa.
 * @param {string} type - Aluksen tyyppi (esim. 'Fighter', 'Destroyer').
 * @returns {THREE.BufferGeometry} Palauttaa valmiin Three.js-geometrian.
 */
function getShipGeometry(type) {
    let geometry;
    // Käytetään switch-lausetta valitsemaan oikea geometria tyypin perusteella.
    switch (type) {
        case 'Destroyer':
            // Luodaan sylinteri (säde ylhäällä, säde alhaalla, korkeus, sivujen määrä).
            geometry = new THREE.CylinderGeometry(0.7, 0.7, 4.5, 8);
            // Käännetään sylinteri 90 astetta X-akselin ympäri, jotta se on "makuullaan".
            geometry.rotateX(Math.PI / 2);
            break;
        case 'Cruiser':
            // Luodaan pallo (säde, leveyssegmentit, korkeussegmentit).
            geometry = new THREE.SphereGeometry(1.1, 18, 14);
            // Venytetään palloa eri akseleilla, jotta siitä tulee pitkulainen ja "orgaaninen".
            geometry.scale(2.5, 1.8, 3.8);
            break;
        case 'Slipstream Frigate':
            // Luodaan kartio (säde, korkeus, sivujen määrä).
            geometry = new THREE.ConeGeometry(1.2, 5, 4);
            // Käännetään kartio "makuulleen".
            geometry.rotateX(Math.PI / 2);
            // Skaalataan kartiota, jotta siitä tulee litteämpi ja pidempi.
            geometry.scale(1, 0.7, 1.2);
            break;
        default: // Oletuksena 'Fighter'
            // Luodaan kartio, joka toimii hävittäjän runkona.
            geometry = new THREE.ConeGeometry(1, 3, 4);
            // Käännetään kartio "makuulleen".
            geometry.rotateX(Math.PI / 2);
    }
    return geometry;
}


/**
 * MITÄ: Luo ja palauttaa aluksille sopivan perusmateriaalin.
 * MIKSI: Keskittää alusten visuaalisen ilmeen yhteen paikkaan.
 * @param {THREE.Color|number|string} baseColor - Aluksen perusväri.
 * @returns {THREE.MeshStandardMaterial} Three.js:n standardimateriaali.
 */
function getShipMaterial(baseColor) {
    // MeshStandardMaterial on fyysisesti perusteltu materiaali, joka reagoi valoihin realistisesti.
    return new THREE.MeshStandardMaterial({
        color: baseColor,           // Aluksen perusväri, joka näkyy kun siihen osuu valoa.
        // "Hohtoväri". Tämä on väri, jota materiaali säteilee ITSE, ilman ulkoista valoa.
        // Asettamalla sen samaksi kuin perusväri, alus näyttää hohtavan omaa väriään.
        emissive: baseColor,
        // Hohdon voimakkuus. Suurempi arvo tekee aluksesta kirkkaamman ja saa sen näyttämään
        // siltä, että se on sisältä valaistu tai sen moottorit hehkuvat voimakkaasti.
        emissiveIntensity: 0.3 
    });
}


/**
 * MITÄ: Alustaa suorituskykyiset InstancedMesh-objektit KAIKILLE alustyypeille.
 * MIKSI: Tämä on yksi tärkeimmistä suorituskykyoptimoinneista. Sen sijaan, että
 * loisimme tuhansia erillisiä Mesh-objekteja (yksi per alus), luomme vain yhden
 * InstancedMesh-objektin per alustyyppi. Tämä mahdollistaa kaikkien saman tyypin
 * alusten renderöinnin yhdellä ainoalla näytönohjaimen kutsulla.
 */
function initShipInstances() {
    // Käydään läpi kaikki pelin alustyypit.    
    ['Fighter', 'Destroyer', 'Cruiser', 'Slipstream Frigate'].forEach(type => {
        // Haetaan kyseiselle alustyypille oikea 3D-muoto (geometria).
        const geometry = getShipGeometry(type);
        // Luodaan YKSI jaettu perusmateriaali kaikille tämän tyypin instansseille.
        // Yksittäisten alusten värit määritellään myöhemmin `instanceColor`-attribuutilla.        
        const material = new THREE.MeshStandardMaterial({
            color: 0xffffff,    // Perusväri on valkoinen, jotta se voidaan värjätä tehokkaasti.
            emissive: 0x000000, // Oletuksena ei hohtoa (tämä voidaan ylikirjoittaa).
            emissiveIntensity: 0.3,
            metalness: 0.3,  // Kuinka metalliselta materiaali näyttää.
            roughness: 0.4   // Kuinka karhea tai kiiltävä pinta on.
        });
        
        // Luodaan varsinainen InstancedMesh-objekti.
        // Parametrit: (geometria, materiaali, maksimimäärä instansseja).
        const instancedMesh = new THREE.InstancedMesh(geometry, material, MAX_SHIPS_PER_TYPE);
        // Asetetaan aluksi näkyvien instanssien määrä nollaan.
        instancedMesh.count = 0;
        
        // Luodaan taulukko, joka säilöö jokaisen instanssin värin (R, G, B).
        const colors = new Float32Array(MAX_SHIPS_PER_TYPE * 3);
        // Alustetaan kaikki värit valkoiseksi.
        for (let i = 0; i < colors.length; i++) {
            colors[i] = 1.0;
        }
        
        // Liitetään väritaulukko mesh-objektiin erityisenä InstancedBufferAttribute-attribuuttina.
        // Tämä mahdollistaa jokaisen aluksen värjäämisen yksilöllisesti ja tehokkaasti.
        instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        
        // Lisätään valmis InstancedMesh-objekti sceneen.
        scene.add(instancedMesh);

        // Tallennetaan viittaus tähän mesh-objektiin globaaliin hakurakenteeseen,
        // jotta voimme helposti löytää ja päivittää sitä myöhemmin.
        SHIP_INSTANCED_MESHES[type] = instancedMesh;
    });
}


/**
 * MITÄ: Alustaa suorituskykyiset InstancedMesh-objektit telakoiden renkaille.
 * MIKSI: Kuten alustenkin kohdalla, tämä optimointi mahdollistaa lukuisten
 * telakkarenkaiden renderöinnin tehokkaasti. Jokaiselle telakkatasolle luodaan
 * oma InstancedMesh, jolla on uniikki kallistuskulma.
 */
function initShipyardRingInstances() {
    // Nollataan ensin datan seurantaobjektit varmuuden vuoksi.
    Object.keys(shipyardRingData).forEach(level => {
        shipyardRingData[level] = { 
            count: 0, 
            rotations: [], 
            speeds: [], 
            starIds: [] 
        };
    });
    
    // Määritellään renkaiden perusmitat.
    const tubeRadius = 0.25; // Renkaan putken paksuus.
    const baseRadius = 10;   // Renkaan säde keskipisteestä.
    
    // Määritellään ennalta kullekin telakkatasolle oma, uniikki kallistuskulma.
    // Luo gyroskooppimaisen pyörivän kokonaisuuden
    const ringTilts = [
        new THREE.Euler(THREE.MathUtils.degToRad(45), 0, 0),   // Lvl 1
        new THREE.Euler(0, THREE.MathUtils.degToRad(-45), 0),  // Lvl 2
        new THREE.Euler(0, 0, THREE.MathUtils.degToRad(-45)),  // Lvl 3
        new THREE.Euler(THREE.MathUtils.degToRad(90), 0, 0)   // Lvl 4
    ];
    
    // Luodaan yksi jaettu materiaali kaikille telakkarenkaille.
    const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        toneMapped: false   // Estää materiaalia reagoimasta jälkikäsittelyn tone mappingiin.
    });
    
    // Käydään läpi kaikki telakkatasot ja luodaan kullekin oma InstancedMesh.
    ['level1', 'level2', 'level3', 'level4'].forEach((level, index) => {
        // Luodaan Torus-geometria (donitsi).
        const geometry = new THREE.TorusGeometry(baseRadius, tubeRadius, 16, 64); 
        const instancedMesh = new THREE.InstancedMesh(geometry, material, MAX_SHIPYARDS);
        instancedMesh.count = 0;
        instancedMesh.frustumCulled = false;

        // --- Renderöintijärjestyksen säätö ---
        // Nämä asetukset varmistavat, että läpinäkyvät renkaat piirtyvät oikein
        // suhteessa muihin läpinäkyviin objekteihin, kuten tähtien hehkuihin.
        instancedMesh.material.depthTest  = false; // Älä hylkää pikseleitä syvyystestin takia.
        instancedMesh.material.depthWrite = false; // Älä kirjoita syvyyspuskuriin.
        instancedMesh.renderOrder = 6;             // Piirretään muiden objektien (oletus 0) päälle.

        // Tallennetaan tälle tasolle määritelty kallistuskulma suoraan mesh-objektin userDataan.
        const baseRotation = ringTilts[index];
        instancedMesh.userData.baseRotation = baseRotation;
        
        scene.add(instancedMesh);
        // Tallennetaan viittaus tähän mesh-objektiin globaaliin hakurakenteeseen.
        SHIPYARD_RING_INSTANCES[level] = instancedMesh;
    });
}


/**
 * MITÄ: Alustaa suorituskykyisen InstancedMesh-objektin puolustusrenkaille.
 * MIKSI: Tämä funktio luo yhden ainoan 3D-objektin, jota voidaan käyttää
 * renderöimään kaikki pelin planetaariset puolustusrenkaat kerralla.
 * Tämä parantaa suorituskykyä merkittävästi verrattuna satojen erillisten
 * rengasobjektien luomiseen.
 */
function initDefenseRingInstances() {
    // Luodaan perusgeometria: litteä rengas. Kokoa ja sijaintia muokataan myöhemmin matriiseilla.
    const geometry = new THREE.RingGeometry(1, 1.05, 64); // Yksikkökokoinen rengas, jota skaalataan
    // Luodaan materiaali, jota kaikki renkaat jakavat.
    const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,          // Perusväri on valkoinen, jotta se voidaan värjätä tehokkaasti `instanceColor`-attribuutilla.
        side: THREE.DoubleSide,     // Varmistaa, että rengas näkyy molemmilta puolilta.
        transparent: true,
        opacity: 0.85,
        depthWrite: false,        // Tärkeitä asetuksia läpinäkyville objekteille,
        depthTest: false          // estävät visuaalisia virheitä muiden objektien kanssa.
    });

    // Luodaan varsinainen InstancedMesh-objekti.
    DEFENSE_RING_INSTANCE = new THREE.InstancedMesh(geometry, material, MAX_DEFENSE_RINGS);
    DEFENSE_RING_INSTANCE.count = 0; // Aluksi yhtään rengasta ei ole näkyvissä.
    DEFENSE_RING_INSTANCE.frustumCulled = false; // Suorituskykyoptimointi: hoidamme näkyvyyden itse.
    DEFENSE_RING_INSTANCE.renderOrder = 5; // Asetetaan piirtojärjestys, jotta tämä piirtyy muiden efektien päälle oikein.
    
    // Luodaan ja liitetään väripuskuri, joka mahdollistaa jokaisen rengas-instanssin
    // yksilöllisen värjäämisen (esim. pelaajan tai AI:n värin mukaan).
    const colors = new Float32Array(MAX_DEFENSE_RINGS * 3);
    DEFENSE_RING_INSTANCE.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);

    scene.add(DEFENSE_RING_INSTANCE);
}


/**
 * MITÄ: Alustaa suorituskykyisen InstancedMesh-objektin taistelurenkaille.
 * MIKSI: Toimii samalla periaatteella kuin puolustusrenkaat. Tämä luo visuaalisen
 * indikaattorin käynnissä oleville taisteluille tehokkaasti.
 */
function initCombatRingInstances() {
    // Luodaan leveä, mutta vähäpolygoninen rengas taistelun merkiksi.
    const geometry = new THREE.RingGeometry(5, 15, 24);
    // Luodaan punainen, hohtava materiaali.
    const material = new THREE.MeshBasicMaterial({
        color: 0xff0000,  // Punainen
        transparent: true,
        opacity: 0.2,     // Staattinen 0.2 opacity
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending    // Luo kirkkaan efektin, kun renkaat menevät päällekkäin.
    });
    
    // Luodaan InstancedMesh-objekti.
    COMBAT_RING_INSTANCE = new THREE.InstancedMesh(geometry, material, MAX_COMBAT_RINGS);
    COMBAT_RING_INSTANCE.count = 0;
    COMBAT_RING_INSTANCE.frustumCulled = false;
    
    // Tässä ei tarvita erillistä väripuskuria (`instanceColor`), koska kaikki
    // taistelurenkaat ovat samanvärisiä (punaisia).
    
    scene.add(COMBAT_RING_INSTANCE);
}


/**
 * MITÄ: Luo ja alustaa materiaalit tähden päällä näkyville UI-indikaattoreille.
 * MIKSI: Keskittää kaikkien indikaattorien (kaivos, populaatio, telakka) luonnin
 * yhteen paikkaan. Se luo ensin tekstuurit (`create...Texture`) ja sitten niitä
 * käyttävät materiaalit, jotka tallennetaan globaaleihin muuttujiin.
 */
function initIndicatorMaterials() {
    // Luodaan proseduraalisesti tekstuurit kullekin indikaattorityypille.
    mineIndicatorTexture = createSquareTexture(new THREE.Color(INDICATOR_BASE_COLOR));
    popIndicatorTexture = createCircleTexture(new THREE.Color(INDICATOR_BASE_COLOR));
    shipyardIndicatorTexture = createOctagonTexture(new THREE.Color(INDICATOR_BASE_COLOR));

    // Luodaan SpriteMaterial-materiaalit, jotka käyttävät yllä luotuja tekstuureita.
    // SpriteMaterial varmistaa, että indikaattori on aina kääntyneenä kameraan päin.
    mineSpriteMaterial = new THREE.SpriteMaterial({
        map: mineIndicatorTexture,
        sizeAttenuation: true,  // Varmistaa, että spriten koko muuttuu etäisyyden mukaan.
        transparent: true,
        opacity: 0.9
    });
    
    popSpriteMaterial = new THREE.SpriteMaterial({
        map: popIndicatorTexture,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9
    });
    
    shipyardSpriteMaterial = new THREE.SpriteMaterial({
        map: shipyardIndicatorTexture,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9
    });
}


/**
 * MITÄ: Luo staattisen, mutta laajan tähtikentän pelimaailman taustaksi.
 * MIKSI: Tekee avaruudesta elävämmän ja antaa syvyysvaikutelman. Käyttämällä
 * `THREE.Points`-objektia tuhansien tähtien renderöinti on erittäin tehokasta.
 */
function createBackgroundStarfield() {
    // BufferGeometry on tehokas tapa säilöä suuria määriä geometriadataa, kuten pisteiden sijainteja.
    const starGeometry = new THREE.BufferGeometry();
    // PointsMaterial on optimoitu materiaali suurten pistemäärien renderöintiin.
    const starMaterial = new THREE.PointsMaterial({
        map: softStarTex,       // Käytetään aiemmin luotua pehmeäreunaista tekstuuria.
        color: 0xffffff,
        size: 1.0,
        sizeAttenuation: true,  // Pisteiden koko pienenee etäisyyden kasvaessa.
        transparent: true,
        depthWrite: false       // Estää visuaalisia virheitä muiden läpinäkyvien objektien kanssa.
    });

    // Luodaan taulukko, johon tallennetaan jokaisen tähden x, y, ja z -koordinaatit.
    const starVertices = [];
    for (let i = 0; i < 5000; i++) {
        // Arvotaan satunnainen sijainti suureen kuutioon pelimaailman ympärille.
        const x = THREE.MathUtils.randFloatSpread(4000);
        const y = THREE.MathUtils.randFloatSpread(4000);
        const z = THREE.MathUtils.randFloatSpread(4000);
        starVertices.push(x, y, z);
    }
    
    // Liitetään luotu sijaintidata geometriaan 'position'-attribuuttina.
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    // Luodaan lopullinen Points-objekti ja lisätään se sceneen.
    backgroundStars = new THREE.Points(starGeometry, starMaterial);
    scene.add(backgroundStars);
}


/**
 * MITÄ: Luo ja sijoittelee satunnaisesti suuria ja pieniä sumu-spritejä (nebula) pelimaailmaan.
 * MIKSI: Tämä funktio lisää pelin visuaaliseen ilmeeseen syvyyttä, väriä ja tunnelmaa.
 * Se luo illuusion laajasta ja monimuotoisesta galaksista.
 */
function createNebulaSprites() {
    // Määritellään alueen säde ja korkeus, jolle sumut sijoitetaan.
    const radius = 2000;
    const height = radius * 1.2;

    // Apufunktio, joka arpoo satunnaisen sijainnin lieriön muotoiselta alueelta.
    const rndPos = () => {
        // Arvotaan satunnainen kulma (0 - 360 astetta).
        const angle = Math.random() * Math.PI * 2;
        // Arvotaan satunnainen etäisyys keskipisteestä.
        // Neliöjuuren käyttö varmistaa, että pisteet jakautuvat tasaisesti koko ympyrän alueelle,
        // eivätkä kasaudu keskelle.
        const r = Math.sqrt(Math.random()) * radius;
        // Arvotaan satunnainen korkeus y-akselilla.
        const y = (Math.random() - 0.5) * height;

        // Palautetaan laskettu sijainti 3D-vektorina.
        return new THREE.Vector3(
            r * Math.cos(angle), // X-koordinaatti
            y,                   // Y-koordinaatti
            r * Math.sin(angle)  // Z-koordinaatti
        );
    };

    // --- Pienet, tiheämmät sumut ---
    // Luodaan 200 pientä sumua, jotka toimivat taustan "täytteenä".
    for (let i = 0; i < 200; i++) {
        // Valitaan satunnainen materiaali (ja väri) ennalta luodusta MAT_SMALL-taulukosta.
        // Kloonataan materiaali, jotta voimme muokata sen läpinäkyvyyttä vaikuttamatta muihin.
        const mat = MAT_SMALL[Math.floor(Math.random() * MAT_SMALL.length)].clone();
        mat.opacity *= 0.55;    // Tehdään siitä hieman läpikuultavampi.

        // Luodaan uusi Sprite-objekti, joka käyttää tätä materiaalia.
        const spr = new THREE.Sprite(mat);
        // Arvotaan spritelle satunnainen koko.
        const s = THREE.MathUtils.randFloat(150, 240);
        spr.scale.set(s, s, 1);
        // Sijoitetaan sprite satunnaiseen paikkaan.
        spr.position.copy(rndPos());
        scene.add(spr);
        nebulaSprites.push(spr);    // Lisätään se globaaliin taulukkoon myöhempää päivitystä varten.
    }

    // --- Isot, näyttävät sumut ---
    // Luodaan 40 suurta sumua, jotka toimivat pelimaailman pääasiallisina visuaalisina maamerkkeinä.
    for (let i = 0; i < 40; i++) {
        const mat = MAT_BIG[Math.floor(Math.random() * MAT_BIG.length)].clone();
        mat.opacity *= 0.45;
        const spr = new THREE.Sprite(mat);
        // Arvotaan huomattavasti suurempi koko kuin pienille sumuille.
        const s = THREE.MathUtils.randFloat(900, 1400);
        spr.scale.set(s, s, 1);
        spr.position.copy(rndPos());
        scene.add(spr);
        nebulaSprites.push(spr);
    }
}


/**
 * MITÄ: Luo ja alustaa visuaalisen indikaattorin, joka näytetään valitun tähden ympärillä.
 * MIKSI: Antaa pelaajalle selkeän ja tyylikkään visuaalisen palautteen siitä,
 * mikä tähti on tällä hetkellä aktiivinen. Indikaattori koostuu keskusrenkaasta
 * ja neljästä "väkäsestä" (brackets).
 */
function initializeSelectionIndicator() {
    // 1. Luodaan THREE.Group, joka toimii säiliönä kaikille indikaattorin osille.
    // Tämä mahdollistaa koko indikaattorin liikuttamisen ja piilottamisen yhtenä kokonaisuutena.
    selectionIndicatorMesh = new THREE.Group();
    selectionIndicatorMesh.visible = false; // Piilotetaan se oletuksena.
    selectionIndicatorMesh.renderOrder = 5; // Asetetaan piirtojärjestys, jotta se näkyy muiden objektien päällä oikein.

    // 2. Määritellään indikaattorin perusväri ja -säde.
    const indicatorColor = 0xffffff;
    const baseRadius = 1.5;

    // 3. Luodaan keskusrengas (Torus).
    const ringGeometry = new THREE.TorusGeometry(baseRadius, baseRadius * 0.03, 8, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: indicatorColor,
        transparent: true,
        opacity: 0.7,
        depthWrite: false, // Tärkeitä asetuksia läpinäkyville objekteille,
        depthTest: false   // estävät visuaalisia virheitä.
    });
    const mainRing = new THREE.Mesh(ringGeometry, ringMaterial);
    // Käännetään rengas 90 astetta, jotta se on "makuullaan" XZ-tasossa.
    mainRing.rotation.x = Math.PI / 2;
    selectionIndicatorMesh.add(mainRing);

    // 4. Luodaan neljä "väkästä" (brackets) renkaan ympärille.
    const bracketMaterial = new THREE.MeshBasicMaterial({
        color: indicatorColor,
        side: THREE.DoubleSide, // Varmistaa, että litteä taso näkyy molemmilta puolilta.
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false
    });

    // Määritellään väkästen sijainnit ja rotaatiot.
    const positions = [
        { x: baseRadius, z: 0, rotY: Math.PI / 2 },  // Oikea
        { x: -baseRadius, z: 0, rotY: -Math.PI / 2 }, // Vasen
        { x: 0, z: baseRadius, rotY: 0 },            // Ala
        { x: 0, z: -baseRadius, rotY: Math.PI }       // Ylä
    ];

    // Käydään sijainnit läpi ja luodaan jokaiselle oma väkänen.
    positions.forEach(pos => {
        // Luodaan litteä taso (PlaneGeometry) väkäsen muodoksi.
        const bracketPlaneGeom = new THREE.PlaneGeometry(baseRadius * 0.3 * 0.6, baseRadius * 0.15 * 2);
        const bracket = new THREE.Mesh(bracketPlaneGeom, bracketMaterial);
        
        // Asetetaan väkänen hieman kauemmas keskustasta kuin päärenkaan säde.
        const offsetFactor = 1.15;
        bracket.position.set(pos.x * offsetFactor, 0, pos.z * offsetFactor);

        // Käännetään väkänen pystyyn ja osoittamaan oikeaan suuntaan.
        bracket.rotation.x = Math.PI / 2;
        bracket.rotation.y = pos.rotY;

        // Lisätään valmis väkänen pääryhmään.
        selectionIndicatorMesh.add(bracket);
    });

    // Lisätään koko indikaattoriryhmä sceneen.
    scene.add(selectionIndicatorMesh);
}


/**
 * MITÄ: Liittää kaikki 3D-maailman interaktioihin vaadittavat tapahtumankuuntelijat.
 * MIKSI: Tämä funktio on silta pelaajan syötteiden (hiiren liikkeet, klikkaukset)
 * ja 3D-scenen välillä. Se liittää kuuntelijat suoraan renderöijän <canvas>-elementtiin,
 * mikä on välttämätöntä kameran ohjaukselle ja objektien valinnalle 3D-avaruudessa.
 */
function setupEventListeners() {
    // Haetaan viittaus canvas-elementtiin, johon renderöijä piirtää.
    const canvas = renderer.domElement;

    // Kuuntelee hiiren liikettä canvasin päällä. Välttämätön hoveredStar-tilan päivittämiseen.
    canvas.addEventListener('mousemove', onCanvasMouseMove, false);

    // Kuuntelee, kun hiiren nappi painetaan alas. Käytetään klikkauksen ja raahauksen erottamiseen.
    canvas.addEventListener('mousedown', onCanvasMouseDown, false);

    // Kuuntelee, kun hiiren nappi vapautetaan. Viimeistelee klikkaus- tai raahaustoiminnon.
    canvas.addEventListener('mouseup', onCanvasMouseUp, false);

    // Kuuntelee tuplaklikkausta. Käytetään kameran tarkentamiseen tähteen.
    canvas.addEventListener('dblclick', onCanvasDoubleClick, false);

    // Kuuntelee oikean hiiren napin klikkausta. Käytetään komentojen antamiseen (esim. alusten liikkuminen).
    canvas.addEventListener('contextmenu', onCanvasRightClick, false); 

    // Kuuntelee normaalia vasemman hiiren napin klikkausta. Käytetään tähtien valintaan.
    canvas.addEventListener('click', onCanvasClick, false);
}



/* ========================================================================== */
/* EVENT HANDLERS                                                             */
/* ========================================================================== */
// Nämä funktiot ovat tapahtumankäsittelijöitä (event handlers), jotka reagoivat
// pelaajan syötteisiin, kuten hiiren liikkeisiin ja klikkauksiin. Ne ovat
// linkki pelaajan toimien ja 3D-maailman tapahtumien välillä.


/**
 * MITÄ: Käsittelee hiiren liikkumisen canvas-elementin päällä.
 * MIKSI: Tämä funktio on vastuussa kahdesta asiasta:
 * 1. Aluevalintalaatikon piirtämisestä, kun SHIFT-nappi on pohjassa.
 * 2. Sen selvittämisestä, onko hiiri tähden päällä (hover-efekti).
 * @param {MouseEvent} event - Selaimen lähettämä hiiren liiketapahtuma.
 */
function onCanvasMouseMove(event) {
    // --- Aluevalinnan käsittely ---
    if (isAreaSelecting) {
        const selectionBox = document.getElementById('selectionBox');
        if (selectionBox) {
            // Lasketaan laatikon uusi sijainti ja koko hiiren nykyisen ja aloituspisteen perusteella.
            const x = Math.min(event.clientX, areaSelectionStartPoint.x);
            const y = Math.min(event.clientY, areaSelectionStartPoint.y);
            const width = Math.abs(event.clientX - areaSelectionStartPoint.x);
            const height = Math.abs(event.clientY - areaSelectionStartPoint.y);
            
            // Päivitetään 2D-valintalaatikon CSS-tyylejä reaaliajassa.
            selectionBox.style.left = `${x}px`;
            selectionBox.style.top = `${y}px`;
            selectionBox.style.width = `${width}px`;
            selectionBox.style.height = `${height}px`;
        }
        return; // Lopetetaan suoritus tähän, jotta ei tarkisteta hover-tilaa samalla.
    }
    
    // --- Hover-logiikka tähdille ---
    // Muunnetaan hiiren sijainti (pikseleinä) Three.js:n normalisoituihin koordinaatteihin (-1 to +1).
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Päivitetään raycaster osoittamaan kamerasta hiiren suuntaan.
    raycaster.setFromCamera(mouse, camera);
    // Haetaan kaikki tähtien mesh-objektit tehokasta tarkistusta varten.
    const starMeshes = Array.from(starsById.values());
    // Ammutaan "säde" ja katsotaan, mitkä tähdet se leikkaa.
    const intersects = raycaster.intersectObjects(starMeshes, false);

    let currentlyHovered = null;
    // Jos säde osui johonkin...
    if (intersects.length > 0) {
        // ...otetaan käsittelyyn lähin osuttu objekti.
        const firstIntersected = intersects[0].object;
        currentlyHovered = firstIntersected.userData.starData;
    }
    // Päivitetään globaali `hoveredStar`-muuttuja.
    hoveredStar = currentlyHovered;
}


/**
 * MITÄ: Käsittelee hiiren vasemman napin painalluksen.
 * MIKSI: Tämä funktio aloittaa joko kameran ohjauksen (oletus) tai
 * aluevalinnan (jos SHIFT on pohjassa).
 * @param {MouseEvent} event - Selaimen lähettämä hiiren painallustapahtuma.
 */
function onCanvasMouseDown(event) {
    if (event.button !== 0) return; // Reagoidaan vain vasempaan hiiren nappiin.
    
    // Tallennetaan hiiren sijainti, jotta `onCanvasMouseUp` voi erottaa klikkauksen ja raahauksen.
    mouseDownPosition = new THREE.Vector2(event.clientX, event.clientY);
    
    // Jos SHIFT-näppäin on pohjassa, aloitetaan aluevalinta.
    if (event.shiftKey) {
        isAreaSelecting = true;
        controls.enabled = false;   // Poistetaan kameran ohjaus väliaikaisesti käytöstä.
        areaSelectionStartPoint.set(event.clientX, event.clientY);
        
        // Alustetaan ja näytetään 2D-valintalaatikko.
        const selectionBox = document.getElementById('selectionBox');
        if (selectionBox) {
            selectionBox.style.left = `${event.clientX}px`;
            selectionBox.style.top = `${event.clientY}px`;
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
            selectionBox.style.display = 'block';
        }
    }
}


/**
 * MITÄ: Käsittelee hiiren vasemman napin vapautuksen.
 * MIKSI: Tämä funktio päättää, oliko pelaajan toimenpide klikkaus vai raahaus,
 * ja suorittaa vastaavan toiminnon (esim. objektin valinta tai aluevalinnan päättäminen).
 * @param {MouseEvent} event - Selaimen lähettämä hiiren vapautustapahtuma.
 */
function onCanvasMouseUp(event) {
    if (event.button !== 0) return; // Vain LMB.
    
    const mouseUpPosition = new THREE.Vector2(event.clientX, event.clientY);
    let isDrag = false;
    // Jos hiiri on liikkunut riittävästi (yli kynnysarvon) alas- ja ylöspainalluksen välillä...
    if (mouseDownPosition) {
        isDrag = mouseDownPosition.distanceTo(mouseUpPosition) > CLICK_DRAG_THRESHOLD;
    }
    mouseDownPosition = null;   // Nollataan tilan seuranta.
    
    // --- Aluevalinnan päättäminen ---
    if (isAreaSelecting) {
        isAreaSelecting = false;
        controls.enabled = true;    // Palautetaan kameran ohjaus.
        
        const selectionBox = document.getElementById('selectionBox');
        if (selectionBox) {
            selectionBox.style.display = 'none';
        }
        
        // Kutsutaan funktiota, joka valitsee kaikki alukset piirretyn laatikon sisältä.
        const endPoint = new THREE.Vector2(event.clientX, event.clientY);
        selectShipsInArea(areaSelectionStartPoint, endPoint, event.shiftKey);
        return;
    }
    
    // Jos kyseessä oli raahaus (kameran liikuttaminen), ei tehdä mitään muuta.
    if (isDrag) {
        controls.enabled = true;
        return;
    }
    
    // --- NORMAALI KLIKKAUS (ei raahaus) ---
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    
    // Tarkistetaan ensin osumat tähtiin.
    const starMeshes = Array.from(starsById.values());
    const starIntersects = raycaster.intersectObjects(starMeshes, false);
    
    if (starIntersects.length > 0) {
        const clicked = starIntersects[0].object;
        const starData = clicked.userData.starData;
        if (starData) {
            selectStar(starData);   // Valitaan osuttu tähti.
        }
        return;
    }
    
    // Jos tähtiin ei osuttu, tarkistetaan osumat aluksiin.
    let closestShip = null;
    let closestDistance = Infinity;
    
    /// Käydään läpi kaikkien alustyyppien InstancedMesh-objektit.
    Object.entries(SHIP_INSTANCED_MESHES).forEach(([type, instancedMesh]) => {
        const intersects = raycaster.intersectObject(instancedMesh, false);
        
        if (intersects.length > 0) {
            const instanceId = intersects[0].instanceId;     // Haetaan osutun instanssin ID.
            
             // Etsitään, mikä virtuaalinen alus vastaa tätä instanssia.
            shipsById.forEach(virtualShip => {
                if (virtualShip.userData.shipType === type && 
                    virtualShip.userData.instanceIndex === instanceId) {
                    const dist = intersects[0].distance;
                    if (dist < closestDistance) {
                        closestDistance = dist;
                        closestShip = virtualShip;
                    }
                }
            });
        }
    });
    
    if (closestShip) {
        handleShipClick(closestShip, event.shiftKey);   // Käsitellään aluksen klikkaus.
    } else {
        // Jos ei osuttu mihinkään, poistetaan kaikki valinnat (jos SHIFT ei ole pohjassa).
        if (!event.shiftKey) {
            deselectAllShips();
            deselectStar();
            updateSelectedUnitsDisplay();
        }
    }
}


/**
 * MITÄ: Käsittelee oikean hiiren napin painalluksen.
 * MIKSI: Tämä on pelaajan pääasiallinen tapa antaa komentoja. Jos aluksia on valittuna
 * ja pelaaja oikeaklikkaa tähteä, tämä funktio laukaisee liikkumiskomennon.
 * @param {MouseEvent} event - Selaimen lähettämä contextmenu-tapahtuma.
 */
function onCanvasRightClick(event) {
    event.preventDefault(); // Estää selaimen oletusvalikon aukeamisen.

    if (window.isPaused) return;
    if (selectedShips.length === 0) return;

    // Varmistetaan, että KAIKKI valitut alukset ovat kiertoradalla ('orbiting').
    // Tämä estää jo liikkeellä olevien alusten komentamisen uudelleen.
    const allShipsAreOrbiting = selectedShips.every(virtualShip => {
        // Haetaan aluksen tila sen userData-objektista.
        const shipData = virtualShip.userData.shipData;
        return shipData && shipData.state === 'orbiting';
    });
    // Jos yksikin alus on jo liikkeellä, perutaan koko komento.
    if (!allShipsAreOrbiting) {
        // Tähän voisi lisätä pienen "error"-äänen tai visuaalisen palautteen.
        return; 
    }

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const starMeshes = Array.from(starsById.values());
    const intersects = raycaster.intersectObjects(starMeshes, false);
    
    // Jos osuttiin tähteen, lähetetään liikkumiskomento.
    if (intersects.length > 0) {
        const targetStar = intersects[0].object.userData.starData;
        if (targetStar) {
            orderSelectedShipsToStar(targetStar);
        }
    }
}


/**
 * MITÄ: Käsittelee klikkausta joko tähteen tai alukseen.
 * MIKSI: Tämä on todennäköisesti vanhempi, periytynyt funktio. Sen logiikka on
 * suurilta osin integroitu `onCanvasMouseUp`-funktioon, joka on nyt pääasiallinen
 * klikkausten käsittelijä. Tämä on säilytetty mahdollisesti yhteensopivuussyistä
 * tai se voidaan siistiä pois tulevaisuudessa.
 * @param {MouseEvent} event - Selaimen lähettämä tapahtuma.
 */
function handleShipOrStarClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    
    // Kerää kaikki meshit mukaan lukien click targetit
    const clickableObjects = [];
    
    // Lisää star meshit
    starsById.forEach(starMesh => clickableObjects.push(starMesh));
    
    // Lisää ship meshit JA niiden click targetit
    shipsById.forEach(shipMesh => {
        clickableObjects.push(shipMesh);
        if (shipMesh.userData.clickTarget) {
            clickableObjects.push(shipMesh.userData.clickTarget);
        }
    });
    
    const intersects = raycaster.intersectObjects(clickableObjects, false);
    
    if (intersects.length > 0) {
        const clicked = intersects[0].object;
        
        // Tarkista onko click target
        let actualShipMesh = clicked;
        if (clicked.userData.isClickTarget) {
            // Etsi varsinainen ship mesh
            actualShipMesh = Array.from(shipsById.values()).find(
                mesh => mesh.userData.clickTarget === clicked
            );
        }
        
        // Käsittele ship click
        if (actualShipMesh && shipsById.has(actualShipMesh.userData.entityId)) {
            handleShipClick(actualShipMesh, event.shiftKey);
        } 
        // Käsittele star click
        else if (starsById.has(clicked.userData?.entityId)) {
            const starData = clicked.userData.starData;
            if (starData) {
                selectStar(starData);
            }
        }
    } else {
        // Tyhjä klikkaus
        if (!event.shiftKey) {
            deselectAllShips();
            deselectStar();
        }
    }
}


/**
 * MITÄ: Käsittelee yksinkertaista klikkausta canvasilla.
 * MIKSI: Tämä on todennäköisesti vanhempi funktio. Sen toiminnallisuus (tähden valinta
 * tai valinnan poisto) sisältyy jo monimutkaisempaan `onCanvasMouseUp`-funktioon.
 * @param {MouseEvent} event - Selaimen lähettämä click-tapahtuma.
 */
function onCanvasClick(event) {
    if (event.detail === 2) return; // Ohitetaan, jos kyseessä on tuplaklikkaus.
    
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const starMeshes = Array.from(starsById.values());
    const intersects = raycaster.intersectObjects(starMeshes, false);

    if (intersects.length > 0) {
        const clickedObject = intersects[0].object;
        const starData = clickedObject.userData.starData;
        if (starData) {
            selectStar(starData);
        }
    } else {
        deselectStar();
    }
}


/**
 * MITÄ: Käsittelee tuplaklikkausta canvasilla.
 * MIKSI: Tarjoaa pelaajalle nopean tavan keskittää kamera valittuun tähteen.
 * @param {MouseEvent} event - Selaimen lähettämä dblclick-tapahtuma.
 */
function onCanvasDoubleClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const starMeshes = Array.from(starsById.values());
    const intersects = raycaster.intersectObjects(starMeshes, false);

    if (intersects.length > 0) {
        const clickedObject = intersects[0].object;
        const starData = clickedObject.userData.starData;
        if (starData) {
            focusOnStar(starData);  // Kutsutaan kameran tarkennusfunktiota.
        }
    }
}


/**
 * MITÄ: Käsittelee selainikkunan koon muuttumista.
 * MIKSI: Varmistaa, että 3D-näkymä ja kamera pysyvät oikeassa kuvasuhteessa
 * ja renderöinti ei vääristy, kun pelaaja muuttaa ikkunan kokoa.
 */
function onWindowResize() {
    // Päivitetään kameran kuvasuhde vastaamaan uutta ikkunan kokoa.
    camera.aspect = window.innerWidth / window.innerHeight;
    // Ilmoitetaan kameralle, että sen projektimatriisi täytyy laskea uudelleen.
    camera.updateProjectionMatrix();
    // Päivitetään renderöijän ja jälkikäsittelyn koko.
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
}



/* ========================================================================== */
/*  SELECTION & FOCUS                                                         */
/* ========================================================================== */
// Nämä funktiot hallinnoivat sitä, miten pelaaja valitsee objekteja 3D-maailmasta
// ja miten kamera reagoi näihin valintoihin.

/**
 * MITÄ: Suorittaa kaikki toimenpiteet, kun tähti valitaan.
 * MIKSI: Tämä on keskitetty funktio, joka varmistaa, että kun tähti valitaan,
 * sekä pelin sisäinen tila (`selectedStar`) että visuaalinen palaute (indikaattori)
 * päivittyvät oikein. Lisäksi se lähettää tapahtuman `client.js`:lle, jotta
 * 2D-käyttöliittymä (planeettavalikko) voidaan näyttää.
 * @param {object} starData - Valitun tähden dataobjekti.
 */
function selectStar(starData) {
    // 1. Haetaan vastaava 3D-mesh-objekti tehokkaasta `starsById`-hakemistosta.
    const starMesh = starsById.get(starData._id);
    
    // 2. Vartiolauseke: Jos meshiä ei jostain syystä löydy, keskeytetään toiminto.
    if (!starMesh) {
        return;
    }

    // 3. Päivitetään globaali tila kertomaan, mikä tähti on nyt valittuna.
    selectedStar = starData;

    // 4. Päivitetään visuaalisen valintaindikaattorin tila.
    if (selectionIndicatorMesh) {
        // 4.1. Siirretään indikaattori valitun tähden sijaintiin.
        selectionIndicatorMesh.position.copy(starMesh.position);

        // 4.2. Skaalataan indikaattorin koko suhteessa tähden kokoon, jotta se näyttää aina hyvältä.
        const starVisualRadius = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
        const desiredIndicatorScale = starVisualRadius + 4.0;
        selectionIndicatorMesh.scale.setScalar(desiredIndicatorScale);

        // 4.3. Tehdään indikaattori näkyväksi.
        selectionIndicatorMesh.visible = true;

        // 4.4. Varmistetaan, että indikaattorin osien väri on oikea (valkoinen).
        selectionIndicatorMesh.children.forEach(child => {
            if (child.material) {
                child.material.color.setHex(0xffffff);
            }
        });
    }
    // 5. Lähetetään kustomoitu 'starSelected'-tapahtuma.
    // `client.js` kuuntelee tätä ja tietää näyttää planeettavalikon.
    // `event.detail` sisältää valitun tähden datan, jota UI tarvitsee.
    window.dispatchEvent(new CustomEvent('starSelected', { detail: starData }));
}
    


/**
 * MITÄ: Pääkäsittelijä aluksen klikkaukselle.
 * MIKSI: Tämä funktio päättää, mitä tapahtuu, kun pelaaja klikkaa alusta.
 * Se tarkistaa omistajuuden ja sen, onko SHIFT-näppäin pohjassa (lisäävä valinta),
 * ja joko lisää aluksen valintaan tai poistaa sen siitä.
 * @param {THREE.Object3D} virtualShip - Klikattu virtuaalinen alusobjekti.
 * @param {boolean} [additive=false] - Onko SHIFT-näppäin pohjassa (lisätäänkö valintaan).
 */
function handleShipClick(virtualShip, additive = false) {
    // Haetaan aluksen omistajan ID sen `userData`-objektista.
    const shipOwnerId = virtualShip.userData.owner;
    // Varmistetaan oma pelaaja-ID turvallisesti.
    const humanIdStr = typeof window.gameData?.humanPlayerId === 'object' ? 
                      window.gameData.humanPlayerId.toString() : 
                      window.gameData.humanPlayerId;
    
    // Vartiolauseke: Reagoidaan vain omien alusten klikkauksiin
    const isPlayerShip = shipOwnerId === humanIdStr;
    if (!isPlayerShip) return;
    
    // Jos valinta EI ole lisäävä (SHIFT ei pohjassa), poistetaan ensin kaikki vanhat valinnat.
    if (!additive) {
        deselectAllShips();
    }
    
    // Tarkistetaan, onko klikattu alus jo valittuna.
    const isCurrentlySelected = selectedShips.includes(virtualShip);
    if (isCurrentlySelected) {
        // Jos on, poistetaan se valinnasta.
        deselectShip(virtualShip);
    } else {
        // Jos ei, lisätään se valintaan.
        selectShip(virtualShip);
    }
    // Lopuksi päivitetään käyttöliittymä näyttämään valittujen yksiköiden uusi määrä.
    updateSelectedUnitsDisplay();
}


/**
 * MITÄ: Poistaa yksittäisen aluksen valinnan ja palauttaa sen visuaalisen tilan.
 * MIKSI: Tämä funktio hoitaa kaiken, mitä tarvitaan yhden aluksen valinnan poistamiseksi:
 * se päivittää aluksen sisäisen tilan (`isSelected`) ja, mikä tärkeintä, palauttaa
 * sen värin takaisin omistajan väriksi `InstancedMesh`-objektissa.
 * @param {THREE.Object3D} virtualShip - Alus, jonka valinta poistetaan.
 */
function deselectShip(virtualShip) {
    // Vartiolauseke: Jos alusta ei ole olemassa tai se ei ollut valittuna, ei tehdä mitään.
    if (!virtualShip || !virtualShip.userData.isSelected) return;

    // Asetetaan aluksen oma tila "ei valituksi".
    virtualShip.userData.isSelected = false;

    // Haetaan aluksen omistajan väri `getPlayerColor`-apufunktion avulla.
    const ownerId = virtualShip.userData.owner || virtualShip.userData.shipData?.ownerId;
    const ownerColorHex = getPlayerColor(ownerId);
    const ownerColor = new THREE.Color(ownerColorHex);

    // Haetaan oikea InstancedMesh ja instanssin indeksi tämän aluksen päivittämistä varten.
    const type = virtualShip.userData.shipType;
    const instancedMesh = SHIP_INSTANCED_MESHES[type];
    const instanceIndex = virtualShip.userData.instanceIndex;

    // Jos kaikki tiedot löytyvät, asetetaan instanssin väri takaisin omistajan väriksi.
    if (instancedMesh && instanceIndex !== undefined) {
        instancedMesh.setColorAt(instanceIndex, ownerColor);
        // Tärkeä! Ilmoitetaan Three.js:lle, että `instanceColor`-puskuria on muutettu
        // ja se täytyy päivittää näytönohjaimelle seuraavassa renderöintikehyksessä.
        if (instancedMesh.instanceColor) {
            instancedMesh.instanceColor.needsUpdate = true;
        }
    }
}


/**
 * MITÄ: Poistaa kaikkien tällä hetkellä valittujen alusten valinnan.
 * MIKSI: Tämä on tärkeä apufunktio, jota kutsutaan esimerkiksi silloin, kun
 * pelaaja klikkaa tyhjää tai aloittaa uuden valinnan ilman SHIFT-näppäintä.
 * Se varmistaa, että vanhat valinnat siivotaan pois asianmukaisesti.
 */
function deselectAllShips() {
    // Käy läpi kaikki `selectedShips`-taulukossa olevat alukset ja kutsu
    // `deselectShip`-funktiota jokaiselle, palauttaen niiden värin.
    selectedShips.forEach(virtualShip => {
        deselectShip(virtualShip);
    });

    // Tyhjennetään koko valittujen alusten lista kerralla, kun kaikki on käsitelty.
    selectedShips = [];

    // Päivitetään UI näyttämään, että valittuja yksiköitä on nyt nolla.
    updateSelectedUnitsDisplay();
}


/**
 * MITÄ: Valitsee kaikki pelaajan alukset, jotka osuvat 2D-valintalaatikon sisään.
 * MIKSI: Tämä on keskeinen toiminto laivueiden tehokkaalle hallinnalle. Se muuntaa
 * 3D-sijainnit 2D-ruutukoordinaateiksi ja vertaa niitä pelaajan piirtämään laatikkoon.
 * @param {THREE.Vector2} startVec - Valintalaatikon aloituspiste (hiiren painallus).
 * @param {THREE.Vector2} endVec - Valintalaatikon lopetuspiste (hiiren vapautus).
 * @param {boolean} [additive=false] - Onko SHIFT-näppäin pohjassa (lisätäänkö valintaan).
 */
function selectShipsInArea(startVec, endVec, additive = false) {
    // Jos valinta EI ole lisäävä, poistetaan ensin kaikki vanhat valinnat.
    if (!additive) deselectAllShips();
    
    // Määritellään valintalaatikon rajat ruudun koordinaatistossa.
    const startX = Math.min(startVec.x, endVec.x);
    const startY = Math.min(startVec.y, endVec.y);
    const endX = Math.max(startVec.x, endVec.x);
    const endY = Math.max(startVec.y, endVec.y);
    
    // Käydään läpi kaikki olemassa olevat alukset.
    shipsById.forEach(virtualShip => {
        const shipData = virtualShip.userData.shipData;
        
        // Vartiolauseke: Valitaan vain pelaajan omia aluksia.
        if (shipData.ownerId !== window.gameData?.humanPlayerId) return;
        
        // --- 3D -> 2D -muunnos ---
        // 1. Kloonataan aluksen 3D-maailman sijainti.
        // 2. Projisoidaan se kameran läpi, jolloin saadaan normalisoidut laitekoordinaatit (-1 to +1).
        const screenPos = virtualShip.position.clone().project(camera);
        // 3. Muunnetaan normalisoidut koordinaatit näytön pikselikoordinaateiksi.
        const sx = (screenPos.x + 1) / 2 * window.innerWidth;
        const sy = (-screenPos.y + 1) / 2 * window.innerHeight;

        // Tarkistetaan, onko aluksen 2D-sijainti valintalaatikon sisällä.
        if (sx >= startX && sx <= endX && sy >= startY && sy <= endY) {
            // Jos alus on laatikossa eikä sitä ole vielä valittu, valitaan se.
            if (!selectedShips.includes(virtualShip)) {
                selectShip(virtualShip);
            }
        }
    });
    // Päivitetään lopuksi UI näyttämään uusi valittujen alusten määrä.
    updateSelectedUnitsDisplay();
}


/**
 * MITÄ: Päivittää 2D-käyttöliittymän näyttämään valittujen yksiköiden määrän.
 * MIKSI: Tämä funktio lähettää kustomoidun tapahtuman, jota `client.js` voi kuunnella.
 * Tämä on hyvä esimerkki vastuun jakamisesta: `scene.js` hoitaa 3D-valinnat ja
 * ilmoittaa tuloksesta, ja `client.js` hoitaa 2D-UI:n päivittämisen.
 */
function updateSelectedUnitsDisplay() {
    // Lähetetään 'shipsSelected'-tapahtuma, joka sisältää valittujen alusten määrän ja listan.
    window.dispatchEvent(new CustomEvent('shipsSelected', { 
        detail: { count: selectedShips.length, ships: selectedShips } 
    }));
}


/**
 * MITÄ: Lähettää liikkumiskomennon kaikille valituille aluksille.
 * MIKSI: Keskittää komentojen lähettämisen. Se käy läpi kaikki valitut alukset
 * ja luo jokaiselle `MOVE_SHIP`-komennon, joka sitten lähetetään `client.js`:lle
 * välitettäväksi eteenpäin palvelimelle.
 * @param {object} targetStar - Tähti-dataobjekti, johon alukset komennetaan.
 */
function orderSelectedShipsToStar(targetStar) {
    if (selectedShips.length === 0) return;
    
    selectedShips.forEach(virtualShip => {
        const shipData = virtualShip.userData.shipData;
        
        if (!shipData || !shipData._id) {
            return;
        }

        // Luodaan komento-objekti, joka sisältää kaikki tarvittavat tiedot.
        const command = {
            action: 'MOVE_SHIP',
            shipId: shipData._id,
            toStarId: targetStar._id,
            fromStarId: shipData.parentStarId
        };
        // Lähetetään 'shipCommand'-tapahtuma, jota `client.js` kuuntelee.
        window.dispatchEvent(new CustomEvent('shipCommand', { detail: command }));
    });
}


/**
 * MITÄ: Suorittaa kaikki toimenpiteet, kun yksittäinen alus valitaan.
 * MIKSI: Tämä on keskitetty funktio, joka hoitaa sekä pelin loogisen tilan
 * (lisää aluksen valittujen listaan) että visuaalisen tilan (muuttaa aluksen
 * värin vihreäksi) päivittämisen. Se sisältää myös turvatarkistukset,
 * jotka estävät vihollisen alusten valitsemisen tai saman aluksen
 * valitsemisen useaan kertaan.
 *
 * @param {THREE.Object3D} virtualShip - Klikattu virtuaalinen alusobjekti, joka sisältää userData-kentässä tarvittavat tiedot.
 */
function selectShip(virtualShip) {
    // Vartiolauseke 1: Jos alus on jo valittuna, ei tehdä mitään.
    // Tämä estää saman aluksen lisäämisen `selectedShips`-taulukkoon useita kertoja.
    if (selectedShips.includes(virtualShip)) return;
    
    // Haetaan aluksen omistajan ID ja pelaajan oma ID vertailua varten.
    const shipOwnerId = virtualShip.userData.owner;
    const humanIdStr = typeof window.gameData?.humanPlayerId === 'object' ? 
                      window.gameData.humanPlayerId.toString() : 
                      window.gameData.humanPlayerId;
    
    // Vartiolauseke 2: Varmistetaan, että valittu alus on pelaajan oma.
    const isPlayerShip = shipOwnerId === humanIdStr;
    if (!isPlayerShip) {
        return; // Poistutaan funktiosta, jos alus ei kuulu pelaajalle.
    }
    // Lisätään alus valittujen alusten globaaliin listaan.
    selectedShips.push(virtualShip);
    // Asetetaan `isSelected`-lippu todeksi suoraan aluksen omaan dataan.
    // Tämä helpottaa tilan tarkistamista muissa funktioissa.
    virtualShip.userData.isSelected = true;
    
    // --- Visuaalinen päivitys InstancedMeshin kautta ---
    // Tämä on tehokas tapa muuttaa yksittäisen aluksen ulkonäköä.

    // Haetaan oikea alustyyppi ja sitä vastaava InstancedMesh-objekti.
    const type = virtualShip.userData.shipType;
    const instancedMesh = SHIP_INSTANCED_MESHES[type];
    // Haetaan tämän nimenomaisen aluksen indeksi InstancedMesh-puskurissa.
    const instanceIndex = virtualShip.userData.instanceIndex;

    // Varmistetaan, että kaikki tarvittava on olemassa ennen värin muuttamista.
    if (instancedMesh && instanceIndex !== undefined) {
        // Asetetaan tämän yhden instanssin väriksi vihreä (SELECTED_SHIP_COLOR).
        instancedMesh.setColorAt(instanceIndex, new THREE.Color(SELECTED_SHIP_COLOR));

        // TÄRKEÄÄ: Ilmoitetaan Three.js:lle, että väripuskuria on muutettu.
        // Ilman tätä lippua muutos ei päivity näytönohjaimelle eikä näy ruudulla.
        if (instancedMesh.instanceColor) {
            instancedMesh.instanceColor.needsUpdate = true;
        }
    }
}


/**
 * MITÄ: Poistaa tähden valinnan ja piilottaa sen visuaaliset indikaattorit.
 * MIKSI: Tämä on keskitetty funktio, joka nollaa kaiken valintaan liittyvän tilan.
 * Se ei ainoastaan piilota 3D-maailmassa näkyvää valintarengasta, vaan myös
 * lähettää yleisen 'starDeselected'-tapahtuman, jota muut sovelluksen osat
 * (kuten `client.js`) voivat kuunnella ja reagoida siihen (esim. piilottamalla
 * planeettavalikon).
 */
function deselectStar() {
    // Nollataan globaali muuttuja, joka pitää kirjaa valitusta tähdestä.
    selectedStar = null;

    // Piilotetaan 3D-maailmassa näkyvä valintarengas.
    if (selectionIndicatorMesh) {
        selectionIndicatorMesh.visible = false;
    }
    // Lähetetään kustomoitu 'starDeselected'-tapahtuma koko sovellukselle.
    // `client.js` kuuntelee tätä ja tietää piilottaa 2D-käyttöliittymän
    // planeettavalikon. Tämä on puhdas tapa erottaa 3D-logiikka ja UI-logiikka.
    window.dispatchEvent(new CustomEvent('starDeselected'));
}


/**
 * MITÄ: Tarkentaa kameran pehmeällä animaatiolla valittuun tähteen.
 * MIKSI: Tarjoaa pelaajalle sulavan ja visuaalisesti miellyttävän tavan siirtyä
 * nopeasti eri puolille galaksia. Käyttää TWEEN.js-kirjastoa animaation luomiseen.
 * @param {object} starData - Tähti-dataobjekti, johon kamera tarkennetaan.
 */
function focusOnStar(starData) {
    // Vartiolausekkeet: Varmistetaan, että kaikki tarvittava on olemassa.
    if (!starData || !window.TWEEN) return;

    // Hae mesh starsById mapista
    const starMesh = starsById.get(starData._id);
    if (!starMesh) return;

    // Haetaan nykyiset ja tavoitellut sijainnit.
    const targetPosition = starMesh.position.clone();
    const currentCamPos = camera.position.clone();
    const currentTarget = controls.target.clone();

    // Lasketaan kameran etäisyys ja kulma kohteesta, jotta ne säilyvät animaation aikana.
    const offset = currentCamPos.sub(currentTarget);
    const newCamPos = targetPosition.clone().add(offset);

    // Animaation kesto millisekunteina.
    const tweenDuration = 750;

    // Animaatio 1: Liikutetaan kameran kohdepistettä (controls.target) pehmeästi uuteen sijaintiin.
    new TWEEN.Tween(controls.target)
        .to(targetPosition, tweenDuration)
        .easing(TWEEN.Easing.Quadratic.Out) // Pehmeä hidastus lopussa.
        .start();

    // Animaatio 2: Liikutetaan samanaikaisesti kameran omaa sijaintia.
    new TWEEN.Tween(camera.position)
        .to(newCamPos, tweenDuration)
        .easing(TWEEN.Easing.Quadratic.Out)
        .start();
}


/**
 * MITÄ: Asettaa kameran välittömästi katsomaan pelaajan kotiplaneettaa.
 * MIKSI: Käytetään pelin alussa varmistamaan, että pelaaja näkee heti oman
 * aloitusjärjestelmänsä ilman animaatiota.
 * @param {THREE.Mesh} starMesh - Kotiplaneetan 3D-mesh-objekti.
 */
function focusOnPlayerHomeworld(starMesh) {
    const targetPosition = starMesh.position.clone();
    // Käytetään samaa etäisyyttä ja kulmaa kuin kameran alkuasetuksissa.
    const offset = new THREE.Vector3(0, 100, 220); 
    
    // Asetetaan sekä kameran kohde että sijainti välittömästi.
    controls.target.copy(targetPosition);
    camera.position.copy(targetPosition).add(offset);
    // Päivitetään kontrollit, jotta muutokset tulevat voimaan.
    controls.update();
}

/**
 * Palauttaa tällä hetkellä valittuna olevien alusten listan.
 * Client.js tarvitsee tätä tietääkseen, mitä aluksia lisätä ryhmään.
 */
export function getSelectedShips() {
    return selectedShips;
}

/**
 * Valitsee alukset annettujen ID-numeroiden perusteella.
 * Poistaa ensin vanhat valinnat.
 */
export function selectShipsByIds(shipIds = []) {
    deselectAllShips();
    shipIds.forEach(id => {
        const virtualShip = shipsById.get(id);
        if (virtualShip) {
            selectShip(virtualShip);
        }
    });
    updateSelectedUnitsDisplay();
}

/**
 * Animoi kameran annettuun laivastoon (ID-listaan).
 * Valitsee laivaston ja keskittää kameran sen ensimmäiseen alukseen.
 */
export function focusOnGroup(shipIds = []) {
    if (!shipIds || shipIds.length === 0 || !window.TWEEN) return;

    // 1. Valitse ryhmän alukset visuaalisesti
    selectShipsByIds(shipIds);

    // 2. Etsi ensimmäisen aluksen mesh kameran kohteeksi
    const firstShipMesh = shipsById.get(shipIds[0]);
    if (!firstShipMesh) return;

    // 3. Suorita tuttu kamera-ajo
    const targetPosition = firstShipMesh.position.clone();
    const currentCamPos = camera.position.clone();
    const currentTarget = controls.target.clone();
    const offset = currentCamPos.sub(currentTarget);
    const newCamPos = targetPosition.clone().add(offset);
    const tweenDuration = 750;

    new TWEEN.Tween(controls.target)
        .to(targetPosition, tweenDuration)
        .easing(TWEEN.Easing.Quadratic.Out)
        .start();

    new TWEEN.Tween(camera.position)
        .to(newCamPos, tweenDuration)
        .easing(TWEEN.Easing.Quadratic.Out)
        .start();
}



/* ========================================================================== */
/*  VISUAL UPDATES                                                            */
/* ========================================================================== */
/**
 * MITÄ: Päivittää kaikkien tähtien ja niiden välisten yhteyksien (starlanes) visuaalisen tilan kerralla.
 * MIKSI: Tämä funktio on keskitetty paikka, joka vastaa tähtikartan visuaalisesta palautteesta pelaajalle.
 * Sitä kutsutaan jokaisessa renderöintikehyksessä (frame), ja se varmistaa, että tähdet ja yhteydet
 * korostuvat oikein, kun pelaaja liikuttaa hiirtä niiden päällä (hover) tai valitsee ne.
 *
 * TOIMINTALOGIIKKA (Reset-Then-Apply -malli):
 * 1. NOLLAUS: Ensin kaikki tähdet ja starlanet palautetaan visuaalisesti niiden perustilaan (oletusväri, -läpinäkyvyys ja -koko).
 * Tämä on luotettava tapa varmistaa, ettei edellisen framen korostuksia jää "roikkumaan".
 * 2. HOVER-TILA: Seuraavaksi tarkistetaan, onko hiiri jonkin tähden päällä, ja korostetaan se sekä sen yhteydet.
 * 3. VALINTA-TILA: Viimeiseksi tarkistetaan, onko jokin tähti valittuna, ja annetaan sille voimakkain korostus.
 * Koska tämä tehdään viimeisenä, valinta ylikirjoittaa aina hover-tilan, jos ne osuvat samaan kohteeseen,
 * mikä on haluttu lopputulos.
 */
function updateAllStarVisuals() {
    // ===================================================================
    // VAIHE 1: Nollaa ensin kaikkien tähtien JA starlanejen korostukset
    // ===================================================================
    
    // Käydään läpi kaikki `starsById`-hakemistossa olevat tähdet.
    starsById.forEach(starMesh => {
        // Varmistetaan, että tähdellä on hehku-sprite (glowSprite), jota muokata.
        if (starMesh.userData.glowSprite) {
            const starData = starMesh.userData.starData;
            // Lasketaan hehkun peruskoko, ottaen huomioon, onko kyseessä suurempi kotiplaneetta.
            const baseGlowSize = starMesh.geometry.parameters.radius * STAR_GLOW_DEFAULT_SCALE * (starData.isHomeworld ? 1.6 : 1.0);
            // Palautetaan hehkun läpinäkyvyys ja koko oletusarvoihin.
            starMesh.userData.glowSprite.material.opacity = STAR_GLOW_DEFAULT_OPACITY;
            starMesh.userData.glowSprite.scale.set(baseGlowSize, baseGlowSize, 1);
        }
    });

    // Palautetaan kaikkien starlane-yhteyksien läpinäkyvyys oletustasolle.
    starConnections.forEach(line => {
        line.material.opacity = STAR_LANE_DEFAULT_OPACITY;
    });

    // ===================================================================
    // VAIHE 2: Aseta korostukset hover- ja valintatilan mukaan
    // ===================================================================

    // Jos hiiri on jonkin tähden päällä (`hoveredStar` on asetettu)...
    if (hoveredStar) {
        // Haetaan tähteä vastaava 3D-objekti.
        const hoveredMesh = starsById.get(hoveredStar._id);
        if (hoveredMesh) {
            // Tärkeä ehto: Korostetaan tähteä hover-efektillä VAIN, jos se EI OLE
            // tällä hetkellä valittuna. Tämä antaa valinnalle visuaalisen etusijan.
            if (hoveredStar !== selectedStar) {
                if (hoveredMesh.userData.glowSprite) {
                    // Kasvatetaan hehkun läpinäkyvyyttä, jotta se erottuu.
                    hoveredMesh.userData.glowSprite.material.opacity = STAR_GLOW_HOVER_OPACITY;
                }
                // Käydään läpi kaikki starlane-yhteydet ja korostetaan ne, jotka liittyvät tähän tähteen.
                starConnections.forEach(line => {
                    if (line.userData.star1Id === hoveredStar._id || line.userData.star2Id === hoveredStar._id) {
                        line.material.opacity = STAR_LANE_HOVER_OPACITY;
                    }
                });
            }
        }
    }

    // Jos jokin tähti on valittuna (`selectedStar` on asetettu)...
    // Tämä ylikirjoittaa aiemmin asetetun hover-korostuksen, jos kohde on sama.
    if (selectedStar) {
        const selectedMesh = starsById.get(selectedStar._id);
        if (selectedMesh) {
            // Asetetaan valitun tähden hehku maksimikirkkauteen.
            if (selectedMesh.userData.glowSprite) {
                selectedMesh.userData.glowSprite.material.opacity = STAR_GLOW_SELECTED_OPACITY;
            }
            // Asetetaan myös kaikki valittuun tähteen liittyvät starlanet maksimikirkkauteen.
            starConnections.forEach(line => {
                if (line.userData.star1Id === selectedStar._id || line.userData.star2Id === selectedStar._id) {
                    line.material.opacity = STAR_LANE_SELECTED_OPACITY;
                }
            });
        }
    }
}




/* ========================================================================== */
/*  EXPLOSIONS                                                                */
/* ========================================================================== */

/**
 * MITÄ: Luo ja näyttää räjähdysefektin annetussa 3D-sijainnissa.
 * MIKSI: Tämä funktio luo visuaalisen tehosteen, kuten aluksen tuhoutumisen, luomalla
 * joukon partikkeleita (kipinöitä), jotka lentävät satunnaisiin suuntiin
 * räjähdyksen keskipisteestä.
 *
 * @param {THREE.Vector3} pos - Sijainti 3D-maailmassa, johon räjähdys luodaan.
 * @param {number} [n=18] - Räjähdyksen sisältämien partikkelien (kipinöiden) määrä.
 */
function spawnExplosion(pos, n = 18) {
    // Alustetaan taulukot partikkelien sijainneille ja nopeusvektoreille.
    const positions = new Float32Array(n * 3);   // Jokaista partikkelia varten tarvitaan 3 arvoa (x, y, z).
    const velocities = [];
    
    // Luodaan jokaiselle partikkelille oma satunnainen nopeusvektori.
    for (let i = 0; i < n; i++) {
        // 1. Luo satunnainen suuntavektori.
        // 2. `normalize()` tekee vektorista yksikön mittaisen (pituus = 1), säilyttäen suunnan.
        // 3. `multiplyScalar()` skaalaa nopeuden haluttuun voimakkuuteen.
        const v = new THREE.Vector3(
            (Math.random() - 0.5),
            (Math.random() - 0.5),
            (Math.random() - 0.5)
        ).normalize().multiplyScalar(20);
        
        velocities.push(v); // Tallennetaan nopeus animaatiota varten.
        // Asetetaan kaikkien partikkelien alkusijainti efektin sisäiseen nollapisteeseen.
        // Koko efekti siirretään kerralla oikeaan paikkaan myöhemmin.
        positions.set([0, 0, 0], i * 3);
    }

    // Luodaan Three.js-geometria ja liitetään siihen partikkelien sijaintidata
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Luodaan partikkeliobjekti (`Points`) käyttäen jaettua `SPARK_MAT`-materiaalia.
    // `.clone()` on tärkeä, jotta voimme muokata tämän räjähdyksen läpinäkyvyyttä
    // vaikuttamatta muihin samanaikaisiin räjähdyksiin.
    const points = new THREE.Points(geom, SPARK_MAT.clone());
    // Siirretään koko partikkelijärjestelmä annettuun sijaintiin.
    points.position.copy(pos);
    // Lisätään efekti näkyviin sceneen.
    scene.add(points);

    // Lisätään räjähdys globaaliin `explosions`-taulukkoon, jotta `updateExplosions`-funktio
    // osaa animoida sitä. `ttl` (time-to-live) määrittää efektin eliniän sekunteina.
    explosions.push({ points, velocities, life: 0, ttl: 0.8 });
}


/**
 * MITÄ: Luo slipstream-efektiin liittyvän visuaalisen säihkeen.
 * MIKSI: Tämä partikkeliefekti eroaa räjähdyksestä: sen sijaan, että se leviäisi
 * pallomaisesti, se luo suunnatun "suihkun" tunteen, joka kuvaa aluksen
 * nopeaa liikehdintää.
 *
 * @param {THREE.Vector3} position - Sijainti 3D-maailmassa, johon säihke luodaan.
 */
function spawnSlipstreamSparkle(position) {
    const n = 5 + Math.floor(Math.random() * 5); // Satunnainen määrä partikkeleita (5-9).
    const positions = new Float32Array(n * 3);
    const velocities = [];

    for (let i = 0; i < n; i++) {
        // Nopeusvektorin luonti on avainasemassa:
        // Z-akselilla on suuri kerroin (3), mikä antaa partikkeleille voimakkaan liikkeen eteenpäin.
        // X- ja Y-akselien pienet kertoimet luovat pientä hajontaa, tehden suihkusta elävämmän.
        const v = new THREE.Vector3(
            (Math.random() - 0.5) * 0.2, // Pieni sivuttaisliike
            (Math.random() - 0.5) * 0.2, // Pieni pystyliike
            (Math.random() - 0.5) * 3   // Vahva liike eteenpäin
        ).normalize().multiplyScalar(15 + Math.random() * 10);  // Satunnainen nopeus

        velocities.push(v);
        positions.set([0, 0, 0], i * 3);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    // Luodaan oma materiaali kloonaamalla perusmateriaali ja muokkaamalla sitä.
    // Tämä erottaa slipstream-efektin visuaalisesti räjähdyksistä.
    const sparkleMat = SPARK_MAT.clone();
    sparkleMat.color.setHex(0xadd8e6); // Vaaleansininen väri
    sparkleMat.size = 1.5;             // Pienemmät partikkelit

    const points = new THREE.Points(geom, sparkleMat);
    points.position.copy(position);
    
    scene.add(points);
    // Lisätään efekti omaan animaatiolistaansa.
    slipstreamSparkles.push({ points, velocities, life: 0, ttl: 0.5 });
}


/**
 * MITÄ: Animoi kaikkia aktiivisia slipstream-säihkeitä.
 * MIKSI: Tätä funktiota kutsutaan renderöintisilmukassa joka framessa. Se päivittää
 * partikkelien sijaintia, himmentää niitä ja lopulta poistaa ne, kun niiden
 * elinikä on täynnä.
 *
 * @param {number} delta - Aika (sekunteina), joka on kulunut edellisestä framesta. Välttämätön sulavalle animaatiolle.
 */
// slipstream-säihkeiden update
function updateSlipstreamSparkles(delta) {
    // Käydään taulukko läpi lopusta alkuun. Tämä on turvallinen tapa poistaa
    // alkioita taulukosta kesken silmukan ilman, että indeksointi sekoaa.
    for (let i = slipstreamSparkles.length - 1; i >= 0; i--) {
        const sparkle = slipstreamSparkles[i];

        // Kasvatetaan efektin elinikää ja lasketaan sen edistyminen (0.0 -> 1.0).
        sparkle.life += delta;
        const progress = sparkle.life / sparkle.ttl;

        // Himmennetään efektiä sen eliniän mukaan.
        sparkle.points.material.opacity = 1 - progress;

        // Päivitetään jokaisen yksittäisen partikkelin sijainti sen nopeusvektorin ja kuluneen ajan mukaan.
        const posAttr = sparkle.points.geometry.attributes.position;
        for (let j = 0; j < sparkle.velocities.length; j++) {
            const v = sparkle.velocities[j];
            posAttr.array[j * 3] += v.x * delta;
            posAttr.array[j * 3 + 1] += v.y * delta;
            posAttr.array[j * 3 + 2] += v.z * delta;
        }
        // Ilmoitetaan Three.js:lle, että geometrian data on muuttunut ja se pitää lähettää näytönohjaimelle.
        posAttr.needsUpdate = true;

        // Jos efektin elinikä on täynnä, siivotaan se pois.
        if (sparkle.life >= sparkle.ttl) {
            // Poistetaan objekti scenestä.
            scene.remove(sparkle.points);
            // Vapautetaan näytönohjaimen muisti, jota geometria ja materiaali käyttivät.
            // Tämä on erittäin tärkeää muistivuotojen estämiseksi.
            sparkle.points.geometry.dispose();
            sparkle.points.material.dispose();
            // Poistetaan efekti animaatiolistalta.
            slipstreamSparkles.splice(i, 1);
        }
    }
}


/**
 * MITÄ: Animoi kaikkia aktiivisia räjähdyksiä.
 * MIKSI: Toimii täsmälleen samalla periaatteella kuin `updateSlipstreamSparkles`,
 * mutta operoi `explosions`-taulukolla. Päivittää partikkelien sijainnit,
 * himmentää ne ja siivoaa vanhentuneet efektit pois.
 *
 * @param {number} delta - Aika (sekunteina), joka on kulunut edellisestä framesta.
 */
function updateExplosions(delta) {
    // Käytetään taaksepäin suuntautuvaa for-silmukkaa. Tämä on luotettava tapa
    // käsitellä taulukkoa, josta poistetaan alkioita kesken iteroinnin.
    // Jos poistamme alkion indeksistä `i`, se ei vaikuta seuraavaan
    // kierrokseen, joka käsittelee indeksin `i-1`.
    for (let i = explosions.length - 1; i >= 0; i--) {
        const ex = explosions[i];
        
        ex.life += delta;
        const f = ex.life / ex.ttl; // f = edistyminen (fraction)
        ex.points.material.opacity = 1 - f;
        
        const posAttr = ex.points.geometry.attributes.position;
        for (let j = 0; j < ex.velocities.length; j++) {
            const v = ex.velocities[j];
            posAttr.array[j * 3]     += v.x * delta;
            posAttr.array[j * 3 + 1] += v.y * delta;
            posAttr.array[j * 3 + 2] += v.z * delta;
        }
        posAttr.needsUpdate = true;
        
        // Jos räjähdyksen elinikä on täynnä, siivotaan se pois.
        if (ex.life >= ex.ttl) {
            // Poistetaan 3D-objekti scenestä.
            scene.remove(ex.points);

            // TÄRKEÄÄ: Vapautetaan näytönohjaimen muisti, jota geometria ja
            // materiaali käyttivät. Tämä estää muistivuodot pitkissä pelisessioissa.
            ex.points.geometry.dispose();
            ex.points.material.dispose();
            
            // Poistetaan räjähdys animaatiotaulukosta.
            explosions.splice(i, 1);
        }
    }
}



/* ========================================================================== */
/*  SNAPSHOT & DIFF HANDLING                                                  */
/* ========================================================================== */


/**
 * MITÄ: Rakentaa koko pelin 3D-maailman palvelimelta saadun alkutilan ("snapshot") perusteella.
 * MIKSI: Tämä on pelin käynnistyksen tärkein visuaalinen funktio. Kun uusi peli alkaa,
 * palvelin lähettää yhden suuren datapaketin, joka sisältää tiedot kaikista tähdistä,
 * aluksista ja pelaajista. Tämä funktio purkaa sen datan ja luo siitä
 * kaikki näkyvät 3D-objektit. Se on myös suunniteltu toimimaan luotettavasti,
 * vaikka pelaaja aloittaisi uuden pelin heti edellisen perään.
 *
 * @param {object} snap - Palvelimelta saatu pelin alkutilaobjekti.
 */
export function buildFromSnapshot(snap) {
    // Vartiolauseke: Varmistetaan, että Three.js:n peruspalikat (scene, kamera, renderöijä)
    // on alustettu, ennen kuin yritämme lisätä niihin mitään.
    if (!ready) {
        initThreeIfNeeded();
    }


    // --- JÄRJESTELMIEN UUDELLEENALUSTUS ---
    // Nämä tarkistukset varmistavat, että kaikki pelin visuaaliset järjestelmät
    // (erityisesti suorituskykyiset InstancedMesh-objektit) ovat olemassa ja
    // lisättynä sceneen. Tämä on tärkeää, jos `cleanupScene`-funktio on ajettu
    // edellisen pelin jälkeen, jolloin nämä objektit on voitu poistaa muistista.

    // ALUKSET: Varmista, että jokaisen alustyypin InstancedMesh on scenessä.
    Object.entries(SHIP_INSTANCED_MESHES).forEach(([type, mesh]) => {
        if (!scene.children.includes(mesh)) {
            scene.add(mesh);
        }
    });

    // PUOLUSTUSRENKAAT: Jos puolustusrengasjärjestelmä on nollattu, luo se uudelleen.
    if (!DEFENSE_RING_INSTANCE) {
        initDefenseRingInstances();
    }
    // Varmista, että se on lisätty sceneen.
    if (DEFENSE_RING_INSTANCE && !scene.children.includes(DEFENSE_RING_INSTANCE)) {
        scene.add(DEFENSE_RING_INSTANCE);
    }

    // TELAKAN RENKAAT: Jos telakkarengasjärjestelmä on nollattu, luo se uudelleen.
    if (Object.values(SHIPYARD_RING_INSTANCES).some(m => m === null)) {
        initShipyardRingInstances();               // :contentReference[oaicite:0]{index=0}
    }
    // Varmista, että jokaisen tason rengasjärjestelmä on lisätty sceneen.
    Object.entries(SHIPYARD_RING_INSTANCES).forEach(([level, mesh]) => {
        if (mesh && !scene.children.includes(mesh)) scene.add(mesh);
    });

    // TAISTELURENKAAT: Jos taistelurengasjärjestelmä on nollattu, luo se uudelleen.
    if (!COMBAT_RING_INSTANCE) {
        initCombatRingInstances();
    }
    // Varmista että combat ring instance on scenessä
    if (COMBAT_RING_INSTANCE && !scene.children.includes(COMBAT_RING_INSTANCE)) {
        scene.add(COMBAT_RING_INSTANCE);
    }

    // TAUSTA (NEBULAT): Jos taustasumut on siivottu pois, luo ne uudelleen.
    if (nebulaSprites.length === 0) {
        createNebulaSprites();
    }

    // Tärkeä siivous: Tyhjennetään alusten sijaintia seuraava hakurakenne.
    // Tämä estää vanhan pelin datan sekoittumisen uuteen.
    shipsByStarClient.clear();

    // Jos snapshot sisältää tähtidataa, luodaan tähdet ja niiden väliset yhteydet.
    if (snap.stars) {
        spawnStars(snap.stars);
        createStarlanes(snap.stars);
    }
    
    // Jos snapshot sisältää alusdataa, luodaan alukset.
    if (snap.ships) {
        spawnShips(snap.ships);

        // Debug-tarkistus: Lasketaan ja voidaan tulostaa konsoliin, kuinka monta
        // alusta onnistuttiin lisäämään seurantarakenteeseen. Varmistaa, että
        // pelin logiikka ja visuaalinen puoli ovat synkronissa alusta alkaen.
        let trackedCount = 0;
        shipsByStarClient.forEach((ships, starId) => {
            trackedCount += ships.size;
        });
    }
}



/**
 * MITÄ: Luo ja sijoittaa kaikki pelin tähdet 3D-maailmaan palvelimelta saadun datan perusteella.
 * MIKSI: Tämä on yksi pelin alustuksen pääfunktioista. Se ottaa vastaan listan tähtien
 * ominaisuuksista (kuten sijainti, omistaja, onko kotiplaneetta) ja luo niistä
 * visuaaliset 3D-objektit. Funktio on optimoitu luomalla yksi jaettu geometria
 * kaikille tähdille, mikä säästää merkittävästi resursseja.
 *
 * @param {Array<object>} starList - Taulukko tähtien dataobjekteja palvelimelta.
 */
function spawnStars(starList) {
    // Luodaan YKSI pallogeometria, jota KAIKKI tähdet tulevat jakamaan.
    // Tämä on paljon tehokkaampaa kuin uuden geometrian luominen jokaiselle tähdelle.
    const starGeometry = new THREE.SphereGeometry(5, 16, 16);
    
    // Käydään läpi jokainen tähtidata palvelimen lähettämästä listasta.
    starList.forEach(starData => {
        // Vartiolauseke: Jos tähti on jo luotu ja lisätty `starsById`-hakemistoon,
        // ohitetaan se. Tämä estää tuplaobjektien luomisen.
        if (starsById.has(starData._id)) return;
        
        // --- Tähden värin määritys omistajan perusteella ---
        let starColor = NEUTRAL_COLOR;  // Oletuksena tähti on neutraali (valkoinen).
        if (starData.ownerId) {
            const gameData = window.gameData;   // Globaali objekti, joka sisältää pelaajien tiedot.
            if (gameData && gameData.players) {
                // Etsitään omistajaa vastaava pelaaja pelaajalistasta.
                const ownerPlayer = gameData.players.find(p => p._id === starData.ownerId);
                if (ownerPlayer) {
                    // Muunnetaan pelaajan väri (joka voi olla merkkijono, esim. "#ff0000")
                    // heksadesimaaliluvuksi, jota Three.js ymmärtää.
                    if (typeof ownerPlayer.color === 'string') {
                        starColor = parseInt(ownerPlayer.color.replace('#', ''), 16);
                    } else {
                        starColor = ownerPlayer.color;
                    }
                } else {
                    starColor = NEUTRAL_COLOR;
                }
            } else {
                // Varajärjestelmä, jos `gameData` ei ole saatavilla: käytetään oletusvärejä.
                starColor = starData.ownerId === window.gameData?.humanPlayerId ? PLAYER_COLOR : 0xdc3545;
            }
        }
        
        // --- Tähden ja sen hehkun luonti ---
        // Luodaan tähdelle materiaali. `emissive`-ominaisuus saa tähden näyttämään siltä,
        // että se säteilee omaa valoaan. Neutraalit tähdet hohtavat hieman kirkkaammin.
        const material = new THREE.MeshStandardMaterial({
            color: starColor,
            emissive: starColor,
            emissiveIntensity: starData.ownerId === null ? 0.45 : 0.3
        });
        
        const starMesh = new THREE.Mesh(starGeometry, material);
        starMesh.position.set(starData.position.x, starData.position.y, starData.position.z);
        
        // Luodaan tähden ympärille pehmeä hehku `Sprite`-objektilla.
        // Sprite on 2D-kuva, joka kääntyy aina kameraa kohti.
        const glowMaterial = new THREE.SpriteMaterial({
            map: glowTexture,           // Käytetään esiladattua hehkutekstuuria
            color: starColor,
            transparent: true,
            opacity: STAR_GLOW_DEFAULT_OPACITY,
            blending: THREE.AdditiveBlending, // Saa päällekkäiset hehkut näyttämään kirkkaammilta.
            depthWrite: false                 // Estää renderöintivirheitä muiden läpinäkyvien objektien kanssa.
        });
        
        const glowSprite = new THREE.Sprite(glowMaterial);
        const glowSize = starGeometry.parameters.radius * STAR_GLOW_DEFAULT_SCALE;
        glowSprite.scale.set(glowSize, glowSize, 1);
        glowSprite.position.copy(starMesh.position);
        
        // --- Kotiplaneettojen erikoiskäsittely ---
        // Kotiplaneetat tehdään visuaalisesti erottuviksi suurentamalla niitä ja niiden hehkua.
        if (starData.isHomeworld) {
            starMesh.scale.set(1.5, 1.5, 1.5);
            glowSprite.scale.set(glowSize * 1.6, glowSize * 1.6, 1);
            starMesh.material.emissiveIntensity = 0.7;
        }
        
        // --- Viittausten tallennus tehokasta hakua varten ---
        starMesh.userData = {
            starData: starData,       // Tallennetaan alkuperäinen data suoraan 3D-objektiin.
            glowSprite: glowSprite    // Tallennetaan viittaus hehkuun, jotta sitä voidaan helposti hallita.
        };
        
        scene.add(starMesh);
        scene.add(glowSprite);
        // Tallenetaan mesh `Map`-rakenteeseen ID:llä avainnettuna. Tämä mahdollistaa
        // erittäin nopean haun myöhemmin (esim. kun pelaaja klikkaa tähteä).
        starsById.set(starData._id, starMesh);
        starGlows.push(glowSprite);
        
        // Kutsutaan funktiota, joka lisää tähden päälle mahdolliset lisäindikaattorit
        // (kaivokset, populaatio jne.).
        updateStarIndicators(starData, starMesh);
        
        // Jos luotu tähti on pelaajan kotiplaneetta, keskitetään kamera siihen pienen viiveen jälkeen.
        // `setTimeout` varmistaa, että muut alustustoiminnot ehtivät suoriutua ensin.
        if (starData.isHomeworld && starData.ownerId === window.gameData?.humanPlayerId) {
            setTimeout(() => {
                focusOnPlayerHomeworld(starMesh);
            }, 100);
        }
    });
}


/**
 * MITÄ: Piirtää tähtien väliset yhteydet (starlanet) 3D-maailmaan.
 * MIKSI: Tämä funktio luo visuaalisen verkon, joka näyttää pelaajalle, mitkä
 * tähdet ovat yhteydessä toisiinsa. Se sisältää tärkeän optimoinnin, joka
 * estää saman yhteyden piirtämisen kahdesti.
 *
 * @param {Array<object>} starList - Taulukko tähtien dataobjekteja, jotka sisältävät tiedon niiden yhteyksistä.
 */
function createStarlanes(starList) {
    // Luodaan Set-rakenne, joka pitää kirjaa jo piirretyistä yhteyksistä.
    // Set on tehokas tapa tarkistaa duplikaatteja, ja se estää meitä
    // piirtämästä samaa viivaa "A-B" ja "B-A" päällekkäin.
    const drawn = new Set();

    // Käydään läpi kaikki tähdet.
    starList.forEach(star => {
        // Jos tähdellä ei ole yhteyksiä, siirrytään seuraavaan.
        if (!star.connections) return;

        // Käydään läpi kaikki tämän tähden yhteydet.
        star.connections.forEach(connId => {
            // Varmistetaan, että sekä lähtö- että kohdetähden 3D-objektit on jo luotu
            // ja haetaan ne tehokkaasti `starsById`-hakemistosta.
            const fromMesh = starsById.get(star._id);
            const toMesh   = starsById.get(connId);
            if (!fromMesh || !toMesh) return;

            // --- Duplikaattien suodatus ---
            // Luodaan uniikki, kanoninen avain yhteydelle lajittelemalla tähtien ID:t.
            // Tällä tavoin avain yhteydelle A->B on täsmälleen sama kuin yhteydelle B->A.
            const key = [star._id, connId].sort().join('-');

            // Jos tämä avain on jo `drawn`-setissä, viiva on jo piirretty. Ohitetaan se.
            if (drawn.has(key)) return;
            // Muuten lisätään avain settiin, jotta emme piirrä sitä uudelleen.
            drawn.add(key);

            // --- Viivan luonti ---
            // Luodaan geometria, joka koostuu vain kahdesta pisteestä: lähtö- ja päätepisteestä.
            const geom = new THREE.BufferGeometry().setFromPoints([
                fromMesh.position,
                toMesh.position
            ]);

            // Luodaan viiva-objekti geometriasta ja jaetusta materiaalista.
            // Materiaali kloonataan, jotta voimme muuttaa yksittäisten viivojen
            // läpinäkyvyyttä myöhemmin ilman, että se vaikuttaa muihin.
            const line = new THREE.Line(geom, STARLANE_MAT.clone());

            // Tallennetaan yhteysviivaan tieto siitä, mitkä tähdet se yhdistää.
            // Tämä on hyödyllistä myöhemmin, kun korostamme yhteyksiä.
            line.userData.star1Id = star._id;
            line.userData.star2Id = connId;

            // Asetetaan renderöintijärjestys. Korkeampi arvo renderöidään myöhemmin.
            // Tämä auttaa varmistamaan, että viivat piirtyvät siististi tähtien taakse
            // eivätkä niiden päälle.
            line.renderOrder = 2;

            // Lisätään valmis viiva sceneen ja globaaliin yhteyksien listaan.
            scene.add(line);
            starConnections.push(line);
        });
    });
}


/**
 * MITÄ: Luo ja sijoittaa kaikki pelin alukset 3D-maailmaan, hyödyntäen tehokasta
 * "instanced rendering" -tekniikkaa.
 * MIKSI: Sen sijaan, että loisimme tuhansia erillisiä 3D-objekteja (yksi per alus),
 * tämä funktio käyttää `THREE.InstancedMesh`-objekteja. Tämä mahdollistaa kaikkien
 * saman tyyppisten alusten renderöinnin yhdellä ainoalla näytönohjaimen kutsulla,
 * mikä parantaa dramaattisesti pelin suorituskykyä suurissa laivastoissa.
 *
 * @param {Array<object>} shipList - Taulukko alusten dataobjekteja palvelimelta.
 */
function spawnShips(shipList) {
    // Debug-tarkistus: Varmistetaan, että alustyypeille on olemassa tarvittavat
    // InstancedMesh-pääobjektit.
    Object.entries(SHIP_INSTANCED_MESHES).forEach(([type, mesh]) => {
        if (!mesh) {
        }
    });

    // --- Vaihe 1: Ryhmittele alukset tyypin mukaan ---
    // Järjestellään saapuva alusdata tyypeittäin (esim. kaikki Fighterit yhteen,
    // kaikki Cruiserit toiseen). Tämä tekee käsittelystä tehokkaampaa, koska
    // voimme päivittää kunkin InstancedMesh-objektin kerralla.
    const shipsByType = {};
    shipList.forEach(shipData => {
        if (shipsById.has(shipData._id)) return;    // Estä duplikaatit
        
        const type = shipData.type || 'Fighter';
        if (!shipsByType[type]) shipsByType[type] = [];
        shipsByType[type].push(shipData);
    });
    
    // --- Vaihe 2: Käsittele kukin alustyyppi omana eränään ---
    Object.entries(shipsByType).forEach(([type, ships]) => {
        const instancedMesh = SHIP_INSTANCED_MESHES[type];
        if (!instancedMesh) {
            return;
        }
        
        const data = shipInstanceData[type];
        // Luodaan YKSI kevyt "dummy"-apuobjekti, jota käytetään jokaisen aluksen
        // sijainnin ja rotaation laskemiseen ennen sen matriisin kopioimista
        // isoon InstancedMesh-puskuriin.
        const dummy = new THREE.Object3D();
        
        // Käydään läpi kaikki tämän tyypin alukset.
        ships.forEach(shipData => {
            // Määritetään aluksen väri omistajan mukaan.
            let shipColor = new THREE.Color(NEUTRAL_COLOR);
            if (shipData.ownerId && window.gameData) {
                // Luotettava tapa verrata ID:tä, jotka voivat olla merkkijonoja tai objekteja.
                const ownerIdStr = typeof shipData.ownerId === 'object' ? 
                                  shipData.ownerId.toString() : shipData.ownerId;
                const humanIdStr = typeof window.gameData.humanPlayerId === 'object' ? 
                                  window.gameData.humanPlayerId.toString() : 
                                  window.gameData.humanPlayerId;
                
                // Pelaajan alukset saavat oman värinsä.
                if (ownerIdStr === humanIdStr) {
                    // Käytä pelaajan oikeaa väriä gameDatasta
                    const humanPlayer = window.gameData.players.find(p => {
                        const pIdStr = typeof p._id === 'object' ? p._id.toString() : p._id;
                        return pIdStr === humanIdStr;
                    });
                    
                    if (humanPlayer && humanPlayer.color) {
                        shipColor.setHex(parseInt(humanPlayer.color.replace('#', ''), 16));
                    } else {
                        shipColor.setHex(PLAYER_COLOR); // Varaväri
                    }
                // AI-pelaajien alukset saavat oman värinsä.
                } else {
                    const ownerPlayer = window.gameData.players.find(p => {
                        const pIdStr = typeof p._id === 'object' ? p._id.toString() : p._id;
                        return pIdStr === ownerIdStr;
                    });
                    
                    if (ownerPlayer && ownerPlayer.color) {
                        shipColor.setHex(parseInt(ownerPlayer.color.replace('#', ''), 16));
                    }
                }
            }
            
            // Asetetaan aluksen sijainti satunnaisesti sen emo-tähden kiertoradalle.
            const offsetRadius = 15 + Math.random() * 6;
            const randomAngle = Math.random() * Math.PI * 2;
            
            if (shipData.parentStarId) {
                const parentStar = starsById.get(shipData.parentStarId);
                if (parentStar) {
                    dummy.position.copy(parentStar.position);
                    dummy.position.x += offsetRadius * Math.cos(randomAngle);
                    dummy.position.z += offsetRadius * Math.sin(randomAngle);
                    dummy.position.y += (Math.random() - 0.5) * 2;
                    dummy.lookAt(parentStar.position);  // Alus katsoo kohti tähteä.
                }
            } else if (shipData.position) {
                dummy.position.set(shipData.position.x, shipData.position.y, shipData.position.z);
            }
            
            // Nollataan skaalaus ja päivitetään dummy-objektin muunnosmatriisi.
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            
            // --- Instanssipaikkojen hallinta (Object Pooling) ---
            // Etsitään vapaa paikka InstancedMesh-puskurista. Jos tuhoutuneilta
            // aluksilta on vapautunut paikkoja, käytetään niitä uudelleen.
            let instanceIndex;
            if (freeInstanceSlots[type].size > 0) {
                instanceIndex = freeInstanceSlots[type].values().next().value;
                freeInstanceSlots[type].delete(instanceIndex);
            } else {
                // Jos vapaita paikkoja ei ole, otetaan seuraava uusi paikka.
                instanceIndex = data.count;
            }
            
            // Päivitetään InstancedMesh-data: asetetaan juuri laskettu matriisi
            // ja väri oikealle paikalle puskurissa.
            instancedMesh.setMatrixAt(instanceIndex, dummy.matrix);
            instancedMesh.setColorAt(instanceIndex, shipColor);
            
           
            // --- "Virtuaalisen aluksen" luonti ---
            // Emme tallenna raskaita THREE.Mesh-objekteja, vaan kevyitä JavaScript-objekteja,
            // jotka sisältävät kaiken tarvittavan tiedon aluksen tilasta ja animaatiosta.
            const virtualShip = {
                position: dummy.position.clone(),
                rotation: dummy.rotation.clone(),
                scale: dummy.scale.clone(),
                matrix: dummy.matrix.clone(),
                userData: {
                    entityId: shipData._id,
                    type: 'ship',
                    owner: shipData.ownerId,
                    shipType: type,
                    instanceIndex: instanceIndex,
                    shipData: {
                        _id: shipData._id,
                        type: shipData.type,
                        ownerId: shipData.ownerId,
                        parentStarId: shipData.parentStarId,
                        state: shipData.state || 'orbiting',
                        targetStarId: shipData.targetStarId || null,
                        position: shipData.position
                    },
                    orbitAngle: randomAngle,
                    orbitRadius: offsetRadius,
                    orbitSpeed: 0.15 + Math.random() * 0.15,
                    isSelected: false
                },
                // Simuloitu lookAt-metodi, jotta virtuaalista alusta voidaan
                // käsitellä kuten normaalia 3D-objektia animaatiossa.
                lookAt: function(target) {
                    dummy.position.copy(this.position);
                    dummy.lookAt(target);
                    dummy.updateMatrix();
                    const inst = SHIP_INSTANCED_MESHES[this.userData.shipType];
                    if (inst) {
                        inst.setMatrixAt(this.userData.instanceIndex, dummy.matrix);
                        inst.instanceMatrix.needsUpdate = true;
                    }
                }
            };
            
            // Tallenetaan virtuaalinen alus ID:llä avainnettuun hakemistoon.
            shipsById.set(shipData._id, virtualShip);
            
            // Erikoiskäsittely: Slipstream Frigate saa visuaalisen tehostekuplan.
            if (shipData.type === 'Slipstream Frigate') {
                const SLIPSTREAM_RADIUS_VISUAL = 37.5; // Sama kuin serverillä
                const bubbleGeometry = new THREE.SphereGeometry(SLIPSTREAM_RADIUS_VISUAL, 32, 16);
                const bubbleMaterial = new THREE.MeshBasicMaterial({
                    color: 0xaaddff,
                    transparent: true,
                    opacity: 0.05,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                });
                const bubbleMesh = new THREE.Mesh(bubbleGeometry, bubbleMaterial);
                bubbleMesh.renderOrder = -1; // Piirrä kaiken takana
                
                // Aseta kuplan sijainti ja lisää se sceneen
                bubbleMesh.position.copy(virtualShip.position);
                scene.add(bubbleMesh);

                // Tallenna viittaus kuplaan virtuaaliseen alukseen
                virtualShip.userData.specialEffectMesh = bubbleMesh;
            }

            // Lisätään alus sen emätähden seurantalistaan.
            if (shipData.parentStarId) {
                const starId = shipData.parentStarId;
                if (!shipsByStarClient.has(starId)) {
                    shipsByStarClient.set(starId, new Set());
                }
                shipsByStarClient.get(starId).add(virtualShip);
            }
            
            data.count++;
        });
        
        // --- Viimeistely ---
        // KRIITTINEN: Kerrotaan Three.js:lle, että puskureita on muutettu ja ne
        // täytyy päivittää näytönohjaimelle. Ilman näitä muutokset eivät näy.
        instancedMesh.count = data.count;
        instancedMesh.instanceMatrix.needsUpdate = true;
        instancedMesh.instanceColor.needsUpdate = true; 
        
    });
}


/**
 * MITÄ: Päivittää tähden ympärillä näkyvät puolustusrenkaat vastaamaan pelin dataa.
 * MIKSI: Tämä funktio synkronoi visuaalisen esityksen pelin logiikan kanssa. Se käyttää
 * "deklaratiivista" lähestymistapaa: sen sijaan, että se yrittäisi monimutkaisesti
 * lisätä tai poistaa yksittäisiä renkaita, se toimii aina samalla tavalla:
 * 1. Poistaa kaikki vanhat renkaat tältä tähdeltä.
 * 2. Luo kaikki vaaditut uudet renkaat alusta alkaen.
 * Tämä tekee koodista yksinkertaisemman ja vähemmän alttiin virheille.
 *
 * @param {object} starData - Tähden dataobjekti, joka sisältää `defenseLevel`-tiedon.
 * @param {THREE.Mesh} starMesh - Tähden 3D-mesh-objekti, jota käytetään sijainnin ja koon laskemiseen.
 */
function updateDefenseRings(starData, starMesh) {
    // --- Vaihe 1: Poista tämän tähden VANHAT renkaat instanssijärjestelmästä ---
    // Tarkistetaan ensin, onko tällä tähdellä ylipäätään renkaita (`ringIndicesByStar`-kartasta).
    if (defenseRingData.ringIndicesByStar.has(starData._id)) {
        const indices = defenseRingData.ringIndicesByStar.get(starData._id);

        // Luodaan "nollamatriisi" skaalaamalla dummy-objekti näkymättömiin.
        // Tämä on tehokas tapa piilottaa instanssi ilman, että puskurien kokoa
        // tarvitsee muuttaa jatkuvasti.
        const dummy = new THREE.Object3D();
        dummy.scale.set(0, 0, 0); // Piilota skaalaamalla nollaan
        dummy.updateMatrix();

        // Käydään läpi kaikki tähän tähteen aiemmin liitetyt instanssi-indeksit.
        indices.forEach(index => {
            // Asetetaan instanssin matriisi nollaskaalatuksi, mikä piilottaa sen.
            DEFENSE_RING_INSTANCE.setMatrixAt(index, dummy.matrix);
            // Vapautetaan paikka (slotti) merkitsemällä se `null`-arvolla.
            // Nyt jokin toinen tähti voi käyttää tätä paikkaa omille renkailleen
            defenseRingData.starIds[index] = null; // Vapauta slotti
        });
        // Ilmoitetaan Three.js:lle, että instanssimatriisia on muutettu.
        DEFENSE_RING_INSTANCE.instanceMatrix.needsUpdate = true;
    }
    // Nollataan tähden oma rengaslista, valmiina uusille renkaille.
    defenseRingData.ringIndicesByStar.set(starData._id, []); 

    // --- Vaihe 2: Luo uudet renkaat datan perusteella ---
    // Luodaan renkaita vain, jos tähdellä on omistaja ja vähintään yksi puolustustaso.
    if (starData.ownerId && starData.defenseLevel > 0) {
        const starRadius = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
        const ownerColor = getIndicatorColor(starData.ownerId);

        // Sekoitetaan (lerp) omistajan väriä valkoiseen, jotta renkaista tulee hieman haaleampia.
        const ringColor = new THREE.Color(ownerColor).lerp(new THREE.Color(0xffffff), 0.30);
        
        const dummy = new THREE.Object3D();
        const newIndices = [];  // Kerätään tähän uudet indeksit tätä tähteä varten.

        // Luodaan silmukassa oikea määrä renkaita `defenseLevel`-arvon mukaan.
        for (let i = 0; i < starData.defenseLevel; i++) {
            // Etsitään ensimmäinen vapaa paikka (`null`) instanssipuskurista.
            // Tämä on "object pooling" -tekniikan ydin.
            let freeIndex = defenseRingData.starIds.indexOf(null);
            if (freeIndex === -1) {
                // Jos vapaita paikkoja ei ole, lopetetaan renkaiden luonti kesken.
                break;
            }

            // Lasketaan jokaiselle renkaalle hieman suurempi säde, jotta ne asettuvat sisäkkäin.
            const ringRadius = starRadius + 3 + i * 1.5;
            
            // Asetetaan dummy-objektin sijainti, rotaatio ja koko vastaamaan haluttua rengasta.
            dummy.position.copy(starMesh.position);
            dummy.rotation.x = Math.PI / 2; // Käännetään rengas "makaamaan" tasossa.
            dummy.scale.set(ringRadius, ringRadius, 1);
            dummy.updateMatrix();

            // Asetetaan laskettu matriisi ja väri vapaaseen instanssipaikkaan.
            DEFENSE_RING_INSTANCE.setMatrixAt(freeIndex, dummy.matrix);
            DEFENSE_RING_INSTANCE.setColorAt(freeIndex, ringColor);

            // "Varataan" paikka tälle tähdelle ja tallennetaan käytetty indeksi.
            defenseRingData.starIds[freeIndex] = starData._id;
            newIndices.push(freeIndex);
        }

        // Päivitetään lopuksi tähden oma indeksilista.
        defenseRingData.ringIndicesByStar.set(starData._id, newIndices);
        
        // --- Vaihe 3: Päivitä InstancedMeshin lopullinen tila ---
        // Tehokkuussyistä `count`-arvo päivitetään vain kerran kaikkien muutosten jälkeen.
        // Etsitään suurin käytössä oleva indeksi koko järjestelmässä.
        let maxIndex = -1;
        for (let i = 0; i < defenseRingData.starIds.length; i++) {
            if (defenseRingData.starIds[i] !== null) {
                maxIndex = i;
            }
        }
        // Asetetaan näkyvien instanssien määrä juuri tarpeeksi suureksi.
        DEFENSE_RING_INSTANCE.count = maxIndex + 1;

        // Merkitään molemmat puskurit päivitettäviksi.
        DEFENSE_RING_INSTANCE.instanceMatrix.needsUpdate = true;
        DEFENSE_RING_INSTANCE.instanceColor.needsUpdate = true;
    }
}


/**
 * MITÄ: Päivittää kaikki tähden päällä näkyvät pienet UI-indikaattorit (kaivokset, populaatio, telakka).
 * MIKSI: Tämä toimii korkean tason "lähettäjänä" (dispatcher), joka koordinoi kaikkien
 * indikaattoreiden päivitystä. Se noudattaa robustia "poista vanhat, luo uudet" -mallia,
 * mikä takaa, että visuaalinen tila vastaa aina tarkasti pelin dataa.
 *
 * @param {object} starData - Tähden senhetkinen dataobjekti palvelimelta.
 * @param {THREE.Mesh} starMesh - Tähden 3D-mesh-objekti.
 */
function updateStarIndicators(starData, starMesh) {
    // VAIHE 1: Poista ensin kaikki vanhat indikaattorit tältä tähdeltä.
    // Tämä varmistaa, ettei vanhoja visuaalisia elementtejä jää roikkumaan,
    // kun tähden tila (esim. kaivosten määrä) muuttuu.
    // Toinen parametri `true` kertoo `removeOldIndicators`-funktiolle,
    // että puolustusrenkaita (defense rings) EI SAA poistaa, koska niitä
    // hallinnoi oma erillinen `updateDefenseRings`-funktionsa.
    removeOldIndicators(starData, true)
    
    // VAIHE 2: Luo uudet indikaattorit.
    // Indikaattoreita luodaan vain, jos tähdellä on omistaja. Neutraaleilla
    // tähdillä ei ole rakennuksia.
    if (starData.ownerId) {
        // Delegoi kunkin indikaattorityypin luonti omalle, erikoistuneelle funktiolleen.
        // Tämä pitää koodin selkeänä ja modulaarisena.
        updateMineIndicators(starData, starMesh);
        updatePopulationIndicators(starData, starMesh);
        updateShipyardIndicator(starData, starMesh);
    }
}


/**
 * MITÄ: Siivoaa YHDELTÄ tähdeltä kaikki vanhat visuaaliset indikaattorit.
 * MIKSI: Tämä on kriittinen apufunktio, jota kutsutaan aina ennen uusien indikaattoreiden
 * piirtämistä. Se varmistaa, että tähden tila päivittyy oikein ilman, että vanhoja
 * graafisia elementtejä jää kummittelemaan. Funktio on monipuolinen, sillä sille
 * voidaan antaa lippuja, jotka estävät tiettyjen indikaattoriryhmien poistamisen.
 *
 * @param {object} starData - Tähti-objekti, jonka indikaattorit poistetaan.
 * @param {boolean} [preserveDefenseRings=false] - Jos tosi, puolustusrenkaita EI poisteta.
 * @param {boolean} [preserveShipyardRings=false] - Jos tosi, telakan renkaita EI poisteta.
 */
function removeOldIndicators(starData, preserveDefenseRings = false, preserveShipyardRings = false) {

    // --- Yksinkertaiset Sprite-indikaattorit (Kaivokset ja Populaatio) ---
    // Nämä poistetaan kokonaan scenestä ja niiden resurssit vapautetaan.
    if (starData.mineIndicatorMeshes) {
        starData.mineIndicatorMeshes.forEach(m => {
            scene.remove(m);        // Poista 3D-maailmasta.
            // Vapauta näytönohjaimen muisti. Tärkeää muistivuotojen estämiseksi.
            if (m.material) m.material.dispose(); 
            if (m.geometry) m.geometry.dispose(); 
        });
        starData.mineIndicatorMeshes = [];  // Tyhjennä viittauslista.
    }
    
    // Population indicators  
    if (starData.populationIndicatorMeshes) {
        starData.populationIndicatorMeshes.forEach(p => {
            scene.remove(p);
            if (p.material) p.material.dispose(); 
            if (p.geometry) p.geometry.dispose(); 
        });
        starData.populationIndicatorMeshes = [];
    }
    
    // --- Instanssoidut Puolustusrenkaat (Planetary Defense) ---
    // Nämä poistetaan vain, jos `preserveDefenseRings` on epätosi.
    // Renkaita ei poisteta kokonaan, vaan niiden "paikat" vapautetaan uudelleenkäyttöön.
    if (!preserveDefenseRings && starData.defenseRingInstances) {
        starData.defenseRingInstances.forEach(ringRef => {
            const data = defenseRingData[ringRef.level];
            const instancedMesh = DEFENSE_RING_INSTANCES[ringRef.level];
            
            // Piilota instanssi tehokkaasti skaalaamalla se nollaan.
            const dummy = new THREE.Object3D();
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(ringRef.index, dummy.matrix);
            
            // Vapauta paikka merkitsemällä se tyhjäksi (`null`).
            data.starIds[ringRef.index] = null;
            
            // Jos poistettu instanssi oli viimeinen, pienennetään näkyvien instanssien määrää.
            if (ringRef.index === data.count - 1) {
                data.count--;
                instancedMesh.count = data.count;
            }
            
            instancedMesh.instanceMatrix.needsUpdate = true;
        });
        starData.defenseRingInstances = [];
    }

    // --- Yksittäinen Telakka-indikaattori (Sprite) ---
    if (starData.shipyardIndicatorSprite) {
        scene.remove(starData.shipyardIndicatorSprite);
        if (starData.shipyardIndicatorSprite.material) {
            starData.shipyardIndicatorSprite.material.dispose();
        }
        starData.shipyardIndicatorSprite = null;
    }

    // --- Instanssoidut Telakan Renkaat ---
    // Toimii samalla periaatteella kuin puolustusrenkaat.
    if (!preserveShipyardRings && starData.shipyardRingInstances) {
        starData.shipyardRingInstances.forEach(ringRef => {
            const data = shipyardRingData[ringRef.level];
            const instancedMesh = SHIPYARD_RING_INSTANCES[ringRef.level];
            
            if (!data || !instancedMesh) return;
            
            // Piilota instanssi.
            const dummy = new THREE.Object3D();
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(ringRef.index, dummy.matrix);
            
            // Nollaa paikkaan liittyvä metadata.
            data.rotations[ringRef.index] = null;
            data.speeds[ringRef.index] = null;
            data.starIds[ringRef.index] = null;  
            
            instancedMesh.instanceMatrix.needsUpdate = true;
        });
        starData.shipyardRingInstances = [];
    }
    
    // Tämä näyttää olevan vanhempi, ei-instanssoitu tapa käsitellä telakan renkaita.
    // Funktio siivoaa myös nämä varmuuden vuoksi, jos niitä löytyy.
    if (starData.shipyardRings) {
        starData.shipyardRings.forEach(r => {
            scene.remove(r);
            r.geometry.dispose();
            r.material.dispose();
        });
        starData.shipyardRings = [];
    }
}


/**
 * MITÄ: Luo ja päivittää tähden yläpuolella näkyvät kaivosindikaattorit.
 * MIKSI: Antaa pelaajalle nopean visuaalisen kuvan siitä, kuinka monta kaivosta
 * tähdellä on. Funktio asettelee indikaattorit (neliöt) siistiin ruudukkoon
 * tähden oikealle puolelle.
 *
 * @param {object} starData - Tähden dataobjekti.
 * @param {THREE.Mesh} starMesh - Tähden 3D-mesh-objekti.
 */
function updateMineIndicators(starData, starMesh) {
    // Siivoa ensin vanhat indikaattorit pois muistivuotojen ja visuaalisten
    // bugien välttämiseksi.
    if (starData.mineIndicatorMeshes && starData.mineIndicatorMeshes.length > 0) {
        // Jos on, käydään ne läpi ja poistetaan ne kunnolla.
        starData.mineIndicatorMeshes.forEach(m => {
            scene.remove(m); // Poista objekti 3D-maailmasta.
            if (m.material) m.material.dispose(); // Vapauta materiaalin käyttämä muisti.
            if (m.geometry) m.geometry.dispose(); // Vapauta geometrian käyttämä muisti.
        });
    }
    
    // Nollataan viittauslista.
    starData.mineIndicatorMeshes = [];
    
    // Jos kaivoksia ei ole, ei piirretä mitään.
    if (!starData.mines || starData.mines === 0) return;

    // Lasketaan indikaattoreiden asettelua varten tarvittavat mitat.
    const starRadiusScaled = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
    const itemsPerRow = 4; // Kuinka monta indikaattoria mahtuu yhdelle riville.
    const spacing = INDICATOR_SPRITE_SCALE * 0.9; // Indikaattoreiden väli.
    
    // Asetetaan indikaattorit tähden yläpuolelle.
    const yOffset = starRadiusScaled + INDICATOR_SPRITE_SCALE * 1.2;
    // Asetetaan indikaattoriryhmä tähden oikealle puolelle.
    const xBaseOffset = starRadiusScaled * 0.6 + INDICATOR_SPRITE_SCALE * 0.4;
    // Haetaan omistajan väri ja vaalennetaan sitä hieman (lerp) luettavuuden parantamiseksi.
    let indicatorColor = getIndicatorColor(starData.ownerId);
    
    // Luodaan silmukassa jokaiselle kaivokselle oma indikaattori.
    for (let i = 0; i < starData.mines; i++) {
        const sprite = new THREE.Sprite(mineSpriteMaterial.clone());
        sprite.material.color.copy(indicatorColor).lerp(new THREE.Color(0xffffff), 0.5);
        sprite.scale.set(INDICATOR_SPRITE_SCALE, INDICATOR_SPRITE_SCALE, 1);
        
        // Lasketaan indikaattorin rivi ja sarake ruudukossa.
        const row = Math.floor(i / itemsPerRow);
        const col = i % itemsPerRow;
        
        // Asetetaan spriten lopullinen sijainti. Z-akselin laskenta keskittää
        // koko ruudukon pystysuunnassa tähden keskipisteeseen nähden.
        sprite.position.set(
            starMesh.position.x + xBaseOffset + (col * spacing),
            starMesh.position.y + yOffset,
            starMesh.position.z + (row * spacing * 0.9) - 
            ((Math.floor(starData.mines / itemsPerRow) * spacing * 0.9) / 2)
        );
        
        scene.add(sprite);
        starData.mineIndicatorMeshes.push(sprite);
    }
}


/**
 * MITÄ: Luo ja päivittää tähden yläpuolella näkyvät väestöindikaattorit.
 * MIKSI: Antaa pelaajalle nopean visuaalisen kuvan tähden populaation määrästä.
 * Funktio toimii täsmälleen samalla logiikalla kuin `updateMineIndicators`,
 * mutta käyttää eri ikonia (ympyrä) ja asettelee ne tähden vasemmalle puolelle.
 *
 * @param {object} starData - Tähden dataobjekti.
 * @param {THREE.Mesh} starMesh - Tähden 3D-mesh-objekti.
 */
function updatePopulationIndicators(starData, starMesh) {
    // Siivoa vanhat indikaattorit pois. Tämä on tärkeää, jotta vanhat spritet
    // eivät jää näkyviin, kun populaation määrä muuttuu.
    if (starData.populationIndicatorMeshes && starData.populationIndicatorMeshes.length > 0) {
        starData.populationIndicatorMeshes.forEach(p => {
            scene.remove(p);
            if (p.material) p.material.dispose();
        });
    }
    
    starData.populationIndicatorMeshes = [];
    
    if (!starData.population || starData.population === 0) return;
    
    // Asettelulogiikka on identtinen kaivosindikaattoreiden kanssa..
    const starRadiusScaled = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
    const itemsPerRow = 4;
    const spacing = INDICATOR_SPRITE_SCALE * 0.9;
    
    // Poista defenseLevel vaikutus
    const yOffset = starRadiusScaled + INDICATOR_SPRITE_SCALE * 1.2;
    
    // ...ainoana erona on, että xBaseOffset on negatiivinen, mikä sijoittaa
    // indikaattorit tähden vasemmalle puolelle.
    const xBaseOffset = -(starRadiusScaled * 0.6 + INDICATOR_SPRITE_SCALE * 0.4);
    
    let indicatorColor = getIndicatorColor(starData.ownerId);
    
    for (let i = 0; i < starData.population; i++) {
        const sprite = new THREE.Sprite(popSpriteMaterial.clone());
        // Käytetään väestölle tarkoitettua `popSpriteMaterial`-materiaalia.
        sprite.material.color.copy(indicatorColor).lerp(new THREE.Color(0xffffff), 0.5);
        sprite.scale.set(INDICATOR_SPRITE_SCALE, INDICATOR_SPRITE_SCALE, 1);
        
        const row = Math.floor(i / itemsPerRow);
        const col = i % itemsPerRow;
        
        // Sijainti lasketaan muuten samoin, mutta xBaseOffset on negatiivinen.
        sprite.position.set(
            starMesh.position.x + xBaseOffset - (col * spacing),
            starMesh.position.y + yOffset,
            starMesh.position.z + (row * spacing * 0.9) - 
            ((Math.floor(starData.population / itemsPerRow) * spacing * 0.9) / 2)
        );
        
        scene.add(sprite);
        starData.populationIndicatorMeshes.push(sprite);
    }
}


/**
 * MITÄ: Päivittää täysin tähden telakan visuaaliset indikaattorit, mukaan lukien
 * sekä yksinkertaisen ikonin että monitasoisen, pyörivän rengasjärjestelmän.
 * MIKSI: Tämä on keskitetty funktio, joka hallitsee yhtä pelin näyttävimmistä
 * visuaalisista tehosteista. Se on rakennettu tehokkaasti käyttäen InstancedMesh-
 * tekniikkaa ja sisältää optimointeja, jotka estävät turhan työn tekemisen,
 * jos visuaalinen tila on jo ajan tasalla.
 *
 * @param {object} starData - Tähden dataobjekti, joka sisältää `shipyardLevel`-tiedon.
 * @param {THREE.Mesh} starMesh - Tähden 3D-mesh-objekti.
 */
function updateShipyardIndicator(starData, starMesh) {
    // Vartiolauseke: Jos tähdellä ei ole telakkaa, ei tehdä mitään.
    if (!starData.shipyardLevel || starData.shipyardLevel === 0) return;
    
    // --- OSA 1: Optimointi ja ennenaikainen poistuminen ---
    // Tarkistetaan, onko päivitys ylipäätään tarpeen. Tämä säästää paljon resursseja,
    // jos funktiota kutsutaan turhaan.
    if (starData.shipyardRingInstances && starData.shipyardRingInstances.length > 0) {
        // Jos renkaiden visuaalinen määrä ei vastaa datan mukaista tasoa, päivitys tarvitaan.
        if (starData.shipyardRingInstances.length !== starData.shipyardLevel) {
            // Jatketaan suoraan siivousvaiheeseen.
        } else {
            // Jos renkaiden määrä täsmää, tehdään syvempi tarkistus: ovatko kaikki
            // tallennetut rengas-instanssit edelleen validisti tämän tähden omistuksessa
            // globaalissa seurantajärjestelmässä.
            let allValid = true;
            for (const ringRef of starData.shipyardRingInstances) {
                const data = shipyardRingData[ringRef.level];
                if (!data || data.starIds[ringRef.index] !== starData._id) {
                    allValid = false;
                    break;
                }
            }
            // Jos kaikki on kunnossa, mitään ei tarvitse tehdä. Poistutaan funktiosta.
            if (allValid) {
                return;
            }
        }
    }

    // --- OSA 2: Vanhojen renkaiden siivous ---
    // Tämä suoritetaan vain, jos telakan taso on muuttunut.
    if (starData.shipyardRingInstances && starData.shipyardRingInstances.length > 0) {
        // Tarkista onko level muuttunut
        if (starData.shipyardRingInstances.length !== starData.shipyardLevel) {
            // Poistetaan KAIKKI vanhat renkaat tältä tähdeltä vapauttamalla niiden
            // paikat (slotit) instanssijärjestelmästä.
            starData.shipyardRingInstances.forEach(ringRef => {
                const data = shipyardRingData[ringRef.level];
                const instancedMesh = SHIPYARD_RING_INSTANCES[ringRef.level];
                
                if (!data || !instancedMesh) return;
                
                // Piilotetaan instanssi tehokkaasti skaalaamalla se nollaan.
                const dummy = new THREE.Object3D();
                dummy.scale.set(0, 0, 0);
                dummy.updateMatrix();
                instancedMesh.setMatrixAt(ringRef.index, dummy.matrix);
                
                // Nollataan paikkaan liittyvä animaatiodata ja omistajuus.
                // Tämä vapauttaa paikan muiden tähtien käyttöön.
                data.rotations[ringRef.index] = null;
                data.speeds[ringRef.index] = null;
                data.starIds[ringRef.index] = null;
                
                instancedMesh.instanceMatrix.needsUpdate = true;
            });
            // Tyhjennetään tähden oma viittauslista.
            starData.shipyardRingInstances = [];
        } else {
            // Taso ei ole muuttunut, ja aiempi tarkistus totesi, että päivitystä
            // ei tarvita. Poistutaan.
            return;
        }
    }
    
    // --- OSA 3: Telakan pääindikaattorin (sprite) päivitys ---
    // Lasketaan spritelle oikea sijainti tähden ja mahdollisten puolustusrenkaiden yläpuolelle.
    const starRadius = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
    const yOffset = starRadius + INDICATOR_SPRITE_SCALE * 1.5 +
                   (starData.defenseLevel ? starData.defenseLevel * 1.5 + 1.0 : 0);
    
    // Siivotaan aina vanha sprite-ikoni pois ennen uuden luomista.
    if (starData.shipyardIndicatorSprite) {
        scene.remove(starData.shipyardIndicatorSprite);
        if (starData.shipyardIndicatorSprite.material) {
            starData.shipyardIndicatorSprite.material.dispose();
        }
    }
    
    const sprite = new THREE.Sprite(shipyardSpriteMaterial.clone());
    let baseColor = getIndicatorColor(starData.ownerId);
    sprite.material.color.copy(baseColor).lerp(new THREE.Color(0xffffff), 0.3);
    sprite.scale.setScalar(INDICATOR_SPRITE_SCALE * 1.8);   // Tehdään siitä hieman isompi.
    sprite.position.set(
        starMesh.position.x,
        starMesh.position.y + yOffset,
        starMesh.position.z - starRadius * 0.8 - INDICATOR_SPRITE_SCALE * 1.8
    );
    
    scene.add(sprite);
    starData.shipyardIndicatorSprite = sprite;      // Tallennetaan viittaus.
    
    // --- OSA 4: Uusien, pyörivien renkaiden luonti ---
    starData.shipyardRingInstances = [];
    const baseRingRadius = starRadius + INDICATOR_SPRITE_SCALE * 3;
    const dummy = new THREE.Object3D();
    
    // Luodaan silmukassa yksi rengas kutakin telakkatasoa kohden, maksimissaan neljä.
    for (let lvl = 1; lvl <= starData.shipyardLevel && lvl <= 4; lvl++) {
        const levelKey = `level${lvl}`;
        const instancedMesh = SHIPYARD_RING_INSTANCES[levelKey];
        const data = shipyardRingData[levelKey];
        
        // TARKISTA että instanced mesh on olemassa
        if (!instancedMesh) {
            continue;
        }
        
        // Etsitään vapaa paikka instanssipuskurista (object pooling).
        let instanceIndex = -1;

        // Yritetään ensin käyttää uudelleen vanhaa, tälle tähdelle kuulunutta paikkaa.
        for (let i = 0; i < data.count; i++) {
            if (!data.starIds[i] || data.starIds[i] === starData._id) {
                instanceIndex = i;
                break;
            }
        }

        // Jos ei löytynyt, otetaan uusi paikka listan perältä.
        if (instanceIndex === -1) {
            if (data.count < MAX_SHIPYARDS) {
                instanceIndex = data.count;
            } else {
                continue;   // Puskuri täynnä, ei voida luoda enempää.
            }
        }
        
        // Asetetaan renkaan sijainti, skaala ja peruskallistus.
        dummy.position.copy(starMesh.position);
        const scaleRatio = baseRingRadius / 10;
        dummy.scale.set(scaleRatio, scaleRatio, scaleRatio);
        
        // Jokaisella tasolla on oma ennalta määritelty kallistuskulmansa.
        if (instancedMesh.userData.baseRotation) {
            dummy.rotation.copy(instancedMesh.userData.baseRotation);
        }
        dummy.updateMatrix();
        
        // Tallennetaan matriisi instanssipuskuriin.
        instancedMesh.setMatrixAt(instanceIndex, dummy.matrix);
        
        // Tallenetaan animaatiota varten tarvittava metadata: pyörimisnopeus ja -suunta.
        // `updateShipyardRings` käyttää tätä dataa animaatioloopissa.
        const speed = 0.35;
        const speedMultipliers = {
            level1: { x: 0, y: speed, z: 0 },
            level2: { x: speed, y: 0, z: 0 },
            level3: { x: 0, y: speed, z: 0 },
            level4: { x: 0, y: -speed, z: 0 }
        };
        
        data.rotations[instanceIndex] = { x: 0, y: 0, z: 0 };
        data.speeds[instanceIndex] = speedMultipliers[levelKey];
        data.starIds[instanceIndex] = starData._id; // Varataan paikka tälle tähdelle.
        
        // Tallennetaan viittaus luotuun instanssiin tähden omaan dataan.
        starData.shipyardRingInstances.push({ level: levelKey, index: instanceIndex });
        
        // Kasvatetaan näkyvien instanssien määrää tarvittaessa.
        if (instanceIndex >= data.count) {
            data.count = instanceIndex + 1;
        }
        instancedMesh.count = Math.max(instancedMesh.count, data.count);
        instancedMesh.instanceMatrix.needsUpdate = true;
    }
}


/**
 * MITÄ: Palauttaa pelaajan väriä vastaavan THREE.Color-olion.
 * MIKSI: Tämä on pieni apufunktio, joka toimii siltana pelilogiikan
 * (joka käsittelee värejä numeroina) ja Three.js:n renderöintimoottorin
 * (joka vaatii THREE.Color-olioita) välillä. Se tekee muusta koodista
 * siistimpää, kun värinmuunnos on keskitetty yhteen paikkaan.
 *
 * @param {string|ObjectId} ownerId - Pelaajan ID, jonka väri halutaan hakea.
 * @returns {THREE.Color} Annetun pelaajan väri Three.js:n ymmärtämässä muodossa.
 */
function getIndicatorColor(ownerId) {
    // 1. Kutsu ensin `getPlayerColor`-funktiota, joka palauttaa omistajan
    //    värin numeerisena heksadesimaaliarvona (esim. 0xffffff).
    const hexColor = getPlayerColor(ownerId);
    // 2. Luo ja palauta uusi THREE.Color-olio tästä numeroarvosta.
    return new THREE.Color(hexColor);
}



/**
 * MITÄ: Animoi kaikkien aktiivisten telakan renkaiden pyörimistä.
 * MIKSI: Tätä funktiota kutsutaan renderöintisilmukassa joka framessa. Se luo
 * näyttävän gyroskooppimaisen efektin päivittämällä jokaisen renkaan rotaatiota
 * sen oman, ennalta määritellyn akselin ympäri. Funktio on erittäin tehokas,
 * koska se muokkaa suoraan InstancedMesh-puskurien dataa.
 *
 * @param {number} delta - Aika (sekunteina), joka on kulunut edellisestä framesta.
 */
function updateShipyardRings(delta) {
    // Luodaan YKSI kevyt "dummy"-apuobjekti, jota kierrätetään silmukassa.
    // Tämä on paljon tehokkaampaa kuin uusien objektien luominen joka kierroksella.
    const dummy = new THREE.Object3D();
    
    // Käydään läpi jokainen telakan taso (level1, level2, jne.), koska
    // jokaisella tasolla on oma, erillinen InstancedMesh-objekti.
    ['level1', 'level2', 'level3', 'level4'].forEach(level => {
        const instancedMesh = SHIPYARD_RING_INSTANCES[level];
        const data = shipyardRingData[level];
        
        // Optimointi: Jos tällä tasolla ei ole yhtään aktiivista rengasta, siirrytään seuraavaan.
        if (data.count === 0) return;
        
        // Käydään läpi kaikki tämän tason aktiiviset rengas-instanssit.
        for (let i = 0; i < data.count; i++) {
            
            // Varmistetaan, että tälle instanssipaikalle on olemassa animaatiodata.
            if (!data.rotations[i]) continue; 

            // --- Rotaation päivitys hajota-ja-kokoa -menetelmällä ---
            // 1. Lue instanssin nykyinen muunnosmatriisi dummy-objektiin.
            instancedMesh.getMatrixAt(i, dummy.matrix);
            // 2. "Pura" matriisi takaisin osiin: sijainti, rotaatio (kvaterniona) ja skaala.
            //    Tämä on välttämätöntä, jotta voimme helposti muokata pelkkää rotaatiota.
            dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
            
            // 3. Päivitä rotaatiokulmia kuluneen ajan (delta) ja ennalta määritellyn nopeuden mukaan.
            const rotation = data.rotations[i];
            const speed = data.speeds[i];
            rotation.x += speed.x * delta;
            rotation.y += speed.y * delta;
            rotation.z += speed.z * delta;
            
            // 4. Rakenna uusi rotaatio:
            //    a) Nollaa ensin dummy-objektin rotaatio tason peruskallistukseen (baseRotation).
            dummy.rotation.copy(instancedMesh.userData.baseRotation);
            //    b) Lisää peruskallistuksen päälle juuri laskettu animaatiorotaatio.
            dummy.rotateX(rotation.x);
            dummy.rotateY(rotation.y);
            dummy.rotateZ(rotation.z);
            
            // 5. "Kokoa" dummy-objektin uudet osat (sijainti, rotaatio, skaala) takaisin yhdeksi matriisiksi.
            dummy.updateMatrix();
            // 6. Kirjoita päivitetty matriisi takaisin InstancedMesh-puskuriin oikealle paikalle.
            instancedMesh.setMatrixAt(i, dummy.matrix);
        }
        // TÄRKEÄÄ: Kun kaikki tämän tason instanssit on päivitetty, asetetaan `needsUpdate`-lippu.
        // Tämä on yksi ainoa komento, joka kertoo Three.js:lle, että koko tämän tason
        // rengasdata on muuttunut ja se täytyy lähettää näytönohjaimelle.
        instancedMesh.instanceMatrix.needsUpdate = true;
    });
}


/**
 * MITÄ: Animoi kaikkia aktiivisia taistelurenkaita renderöintisilmukassa.
 * MIKSI: Tämä funktio on vastuussa siitä, että pelaajan näkemät punaiset
 * taistelun indikaattorirenkaat pyörivät ja pysyvät oikeiden tähtien ympärillä.
 * Se toimii hyvin samankaltaisesti kuin `updateShipyardRings`, käyttäen
 * tehokasta InstancedMesh-järjestelmää.
 *
 * @param {number} delta - Aika (sekunteina) edellisestä framesta. Vaikka se
 * vastaanotetaan, tätä ei suoraan käytetä tässä funktiossa, sillä rotaatiokulma
 * päivitetään erikseen `CombatEffectGroup`-luokassa.
 */
function updateCombatRings(delta) {
    // Optimointi: Jos taistelurengasjärjestelmää ei ole tai yhtään
    // rengasta ei ole aktiivisena, poistutaan heti.
    if (!COMBAT_RING_INSTANCE || combatRingData.count === 0) return;
    
    // Luodaan yksi kevyt "dummy"-apuobjekti, jota käytetään matriisien laskentaan.
    const dummy = new THREE.Object3D();
    
    // Käydään läpi kaikki mahdolliset taistelurenkaan paikat (slotit).
    for (let i = 0; i < combatRingData.count; i++) {
        // Jos paikka ei ole käytössä, siirrytään seuraavaan.
        if (combatRingData.starIds[i] === null) continue;
        
        // Haetaan tähti, jonka ympärillä taistelu käydään.
        const starMesh = starsById.get(combatRingData.starIds[i]);
        if (!starMesh) continue;
        
        // Päivitetään dummy-objektin sijainti ja rotaatio vastaamaan renkaan tilaa.
        dummy.position.copy(starMesh.position);    // Rengas on aina tähden keskipisteessä.
        dummy.rotation.x = Math.PI / 2;             // Käännetään rengas "makaamaan" tasossa.

        // Haetaan ja asetetaan renkaan nykyinen pyörimiskulma.
        // Itse kulman arvoa kasvatetaan `CombatEffectGroup.update`-metodissa.
        dummy.rotation.z = combatRingData.rotations[i];

        // Lasketaan lopullinen muunnosmatriisi.
        dummy.updateMatrix();
        
        // Kirjoitetaan päivitetty matriisi InstancedMesh-puskuriin oikealle paikalle.
        COMBAT_RING_INSTANCE.setMatrixAt(i, dummy.matrix);
    }
    
    // Kun kaikkien aktiivisten renkaiden matriisit on päivitetty, ilmoitetaan
    // Three.js:lle, että koko puskuri täytyy lähettää näytönohjaimelle.
    COMBAT_RING_INSTANCE.instanceMatrix.needsUpdate = true;
}



/* ========================================================================== */
/*  APPLY DIFF                                                                */
/* ========================================================================== */
/**
 * MITÄ: Käsittelee ja soveltaa palvelimelta saapuvat reaaliaikaiset pelitilan muutokset ("diffs") 3D-maailmaan.
 * MIKSI: Tämä on scene.js-tiedoston KESKEISIN funktio, joka pitää visuaalisen maailman synkronissa
 * palvelimen kanssa. Sen sijaan, että koko pelitila lähetettäisiin uudelleen joka tick, palvelin
 * lähettää vain pieniä, atomisia muutoksia (esim. "alus tuhoutui", "rakennus valmistui").
 * Tämä funktio toimii "reitittimenä", joka lukee kunkin muutoksen `action`-tyypin ja kutsuu
 * oikeaa apufunktiota päivittämään juuri sen tietyn asian 3D-scenessä.
 *
 * @param {Array<object>} diffArr - Taulukko muutosobjekteja palvelimelta.
 */
export function applyDiff(diffArr = []) {
    
    // Käydään läpi kaikki palvelimen lähettämät muutosobjektit ("actionit") yksitellen.
    diffArr.forEach(act => {
        // `switch` on tehokas tapa reitittää toiminta oikealle käsittelijälle action-tyypin perusteella.
        switch (act.action) {

            // --- RAKENTAMISEEN JA TÄHTIIN LIITTYVÄT PÄIVITYKSET ---

            case 'COMPLETE_PLANETARY': {    // Jokin planetaarinen rakennus (kaivos, telakka, jne.) on valmistunut.
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;

                const star = starMesh.userData.starData;
                
                // Päivitetään clientin paikallinen tähtidata vastaamaan palvelimen lähettämää viimeisintä tietoa.
                if (act.starData) {
                    Object.assign(star, act.starData);
                }

                // Jos valmistunut rakennus oli puolustuspäivitys, kutsutaan sen omaa, erikoistunutta päivitysfunktiota.
                if (act.type === 'Defense Upgrade') {
                    updateDefenseRings(star, starMesh);
                }

                // Kaikissa muissa rakennustapauksissa kutsutaan yleistä indikaattorien päivitysfunktiota.
                const otherIndicatorTypes = ['Mine', 'Shipyard', 'Infrastructure'];
                if (otherIndicatorTypes.some(type => act.type.startsWith(type))) {
                    updateStarIndicators(star, starMesh);
                }
                break;
            }

            case 'STAR_UPDATED': {       // Tähden yleinen tila (esim. populaatio) on muuttunut.
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                const star = starMesh.userData.starData;
                const oldShipyardLevel = star.shipyardLevel;
                
                // Kopioidaan kaikki muuttuneet kentät paikalliseen tähtidataan.
                Object.assign(star, act.updatedFields);
                
                // Optimointi: Päivitetään vain ne indikaattorit, jotka liittyvät muuttuneeseen dataan.
                if (act.updatedFields.population !== undefined) {
                    updatePopulationIndicators(star, starMesh);
                }
                if (act.updatedFields.shipyardLevel !== undefined && 
                    act.updatedFields.shipyardLevel !== oldShipyardLevel) {
                    updateShipyardIndicator(star, starMesh);
                    
                }
                if (act.updatedFields.mines !== undefined) {
                    updateStarIndicators(star, starMesh);
                }
                break;
            }

            case 'DEFENSE_DAMAGED': {       // Tähden puolustus on ottanut osumaa.
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                const star = starMesh.userData.starData;
                star.defenseLevel = act.newLevel; // Päivitetään datamalli.
                updateDefenseRings(star, starMesh); // Kutsutaan visuaalista päivitystä.

                break;
            }
            

            // --- ALUKSIIN LIITTYVÄT PÄIVITYKSET ---

            case 'SHIP_SPAWNED': {      // Uusi alus on valmistunut ja ilmestynyt peliin.
                const parentStarMesh = starsById.get(act.starId);
                if (!parentStarMesh) break;
                
                // Kootaan uuden aluksen data ja kutsutaan `spawnShips`-funktiota sen luomiseksi.
                const newShipData = {
                    _id: act.shipId,
                    type: act.type,
                    ownerId: act.ownerId,
                    parentStarId: act.starId,
                    state: 'orbiting'
                };
                spawnShips([newShipData]);
                
                // Lisätään juuri luotu alus emätähden sijainninseurantaan (`shipsByStarClient`).
                const shipMesh = shipsById.get(act.shipId);
                if (shipMesh) {
                    const starId = act.starId;
                    if (!shipsByStarClient.has(starId)) {
                        shipsByStarClient.set(starId, new Set());
                    }
                    shipsByStarClient.get(starId).add(shipMesh);
                }
                
                // Merkitään tähti tarkistettavaksi mahdollista taistelua varten,
                // sillä uusi alus voi muuttaa voimatasapainoa.
                markStarForCombatCheck(act.starId);
                
                break;
            }
            
            // Nämä kaksi tapausta käsitellään yhdessä, koska ne molemmat käynnistävät
            // aluksen liikkumisen client-puolella. `MOVE_SHIP` on pelaajan komento,
            // ja `SHIP_MOVING` on palvelimen virallinen vahvistus sille.
            case 'MOVE_SHIP':
            case 'SHIP_MOVING': {       // Alus on saanut liikkumiskäskyn.
                // Haetaan virtuaalinen alus-objekti tehokkaasta hakemistosta.
                const mesh = shipsById.get(act.shipId);
                if (!mesh) break;   // Jos alusta ei löydy, keskeytetään.

                // Oikopolku aluksen pelidataan.
                const sd = mesh.userData.shipData;

                // --- SIJAINNINSEURANNAN PÄIVITYS ---
                // Poistetaan alus lähtötähden seurantajoukosta (`Set`). Tämä on tärkeää,
                // jotta clientin taistelulogiikka tietää, ettei alus ole enää
                // fyysisesti läsnä kyseisessä tähtijärjestelmässä.
                const departureStarId = sd.parentStarId || act.fromStarId;
                if (departureStarId && shipsByStarClient.has(departureStarId)) {
                    shipsByStarClient.get(departureStarId).delete(mesh);
                }

                // --- ALUKSEN TILAN PÄIVITYS ---
                // Päivitetään virtuaalisen aluksen datamalli vastaamaan uutta tilaa.
                
                // Tallennetaan lähtötähden ID erikseen, koska `parentStarId` nollataan seuraavaksi.
                sd.departureStarId = sd.parentStarId || act.fromStarId;

                sd.state = 'moving';    // Tärkein muutos: animaatiolooppi tietää nyt liikuttaa tätä alusta.
                sd.targetStarId = act.toStarId; // Asetetaan määränpää.
                sd.parentStarId = null;     // Alus ei ole enää minkään tähden kiertoradalla.
                sd.speed = act.speed;   // Tallennetaan palvelimen laskema matkanopeus.

                // --- SAAPUMISEN ENNAKOINTI ---
                // Lasketaan ja tallennetaan alukselle satunnainen kiertorata sen
                // TULEVASSA määränpäässä. Kun alus saapuu perille, se voi siirtyä
                // suoraan tähän ennalta laskettuun, luonnollisen näköiseen paikkaan.
                sd.plannedOrbitRadius = 15 + Math.random() * 6;
                sd.plannedOrbitAngle = Math.random() * Math.PI * 2;

                // --- VISUAALISEN LÄHDÖN PEHMENTÄMINEN ---
                // Tämä lohko korjaa mahdollisen visuaalisen häiriön, jossa alus
                // saattaisi "hypätä" tähden keskipisteeseen yhden framen ajaksi
                // ennen matkan alkamista.
                mesh.userData.validDeparture = false;   // Nollataan lippu.

                // Jos alus oli kiertoradalla, asetetaan sen 3D-sijainti välittömästi
                // täsmälleen sen nykyiseen paikkaan kiertoradalla.
                const depStar = starsById.get(sd.departureStarId);
                if (depStar && mesh.userData.orbitRadius) {
                    // Alus on kiertoradalla, käytä nykyistä orbitointipositiota
                    const currentAngle = mesh.userData.orbitAngle || 0;
                    const currentRadius = mesh.userData.orbitRadius || 15;
                    
                    mesh.position.set(
                        depStar.position.x + currentRadius * Math.cos(currentAngle),
                        depStar.position.y + Math.sin(currentAngle * 0.5) * 2,
                        depStar.position.z + currentRadius * Math.sin(currentAngle)
                    );
                    
                    // Asetetaan lippu merkiksi siitä, että lähtöpositio on nyt asetettu oikein.
                    mesh.userData.validDeparture = true;
                    
                    if (mesh.userData.clickTarget) {
                        mesh.userData.clickTarget.position.copy(mesh.position);
                    }
                }
                // Merkitään lähtötähti tarkistettavaksi, sillä laivaston poistuminen
                // on voinut muuttaa voimatasapainoa ja päättää siellä käynnissä olleen taistelun.
                markStarForCombatCheck(sd.departureStarId);
                break;
            }

            case 'SHIP_ARRIVED': {      // Palvelin vahvistaa, että alus on saapunut määränpäähänsä.
                // --- PALAUTUMISLOGIIKKA (ROBUSTNESS) ---
                // Tämä lohko on turvatoimi, joka käsittelee tilanteen, jossa client on
                // syystä tai toisesta (esim. lyhyt yhteyskatkos) epäsynkassa eikä
                // ole tietoinen saapuvasta aluksesta.
                if (!shipsById.has(act.shipId)) {
                    
                    // Kootaan minimaalinen data aluksen luomiseksi lennosta.
                    const recoveryShipData = {
                        _id: act.shipId,
                        type: act.shipType || 'Fighter', // Oletusarvo, jos tyyppi puuttuu.
                        ownerId: act.ownerId,
                        parentStarId: act.atStarId,
                        state: 'orbiting'
                    };
                    
                    // Kutsutaan spawn-funktiota luomaan puuttuva alus.
                    spawnShips([recoveryShipData]);
                    
                    // Pieni viive varmistaa, että spawn-funktio ehtii suoriutua,
                    // ennen kuin yritämme päivittää sijainninseurantaa.
                    setTimeout(() => {
                        const shipMesh = shipsById.get(act.shipId);
                        if (shipMesh) {
                            // Päivitetään sijainninseuranta (`shipsByStarClient`) manuaalisesti.
                            if (!shipsByStarClient.has(act.atStarId)) {
                                shipsByStarClient.set(act.atStarId, new Set());
                            }
                            shipsByStarClient.get(act.atStarId).add(shipMesh);
                        }
                    }, 10);
                    
                    break; // Lopetetaan tämän actionin käsittely, koska alus on nyt luotu.
                }
                
                // --- PÄÄLOGIIKKA (ALUS ON OLEMASSA) ---
                const shipMesh = shipsById.get(act.shipId);
                if (!shipMesh) {
                    break;
                }

                 // Päivitetään virtuaalisen aluksen datamalli vastaamaan uutta tilaa.
                const sd = shipMesh.userData.shipData;
                sd.state = 'orbiting';          // Alus on nyt kiertoradalla.
                sd.parentStarId = act.atStarId; // Asetetaan uusi "emotähti".
                sd.targetStarId = null;         // Nollataan liikkumiskohde.
                sd.predictedArrival = false;    // Nollataan clientin ennustuslippu.
                
                // Haetaan kohdetähden 3D-objekti.
                const starMesh = starsById.get(act.atStarId);
                if (!starMesh) {
                    break;
                }
                
                // Tämä on kriittinen vaihe, joka varmistaa, että aluksen visuaalinen
                // sijainti vastaa tarkasti palvelimen määrittämää lopputilaa.
                // Se "pakottaa" aluksen kiertoradalle, ohittaen mahdolliset
                // clientin omat animaatioennusteet.
                const orbitRadius = shipMesh.userData.orbitRadius || (15 + Math.random() * 6);
                const orbitAngle = shipMesh.userData.orbitAngle || (Math.random() * Math.PI * 2);
                
                shipMesh.position.set(
                    starMesh.position.x + orbitRadius * Math.cos(orbitAngle),
                    starMesh.position.y + Math.sin(orbitAngle * 0.5) * 2,
                    starMesh.position.z + orbitRadius * Math.sin(orbitAngle)
                );
                
                /// Päivitetään myös mahdollinen näkymätön klikkauskohde.
                if (shipMesh.userData.clickTarget) {
                    shipMesh.userData.clickTarget.position.copy(shipMesh.position);
                }
                
                // Käännetään alus katsomaan kohti tähteä.
                shipMesh.lookAt(starMesh.position);

                // Asetetaan lippu, jota muut järjestelmät voivat käyttää tietääkseen,
                // että alus on juuri saapunut eikä ole ollut kiertoradalla pitkään.
                shipMesh.userData.justArrived = true;

                // Varmistetaan, että alus on lisätty uuden tähden seurantajoukkoon.
                const atStarId = act.atStarId;
                if (!shipsByStarClient.has(atStarId)) {
                    shipsByStarClient.set(atStarId, new Set());
                }
                shipsByStarClient.get(atStarId).add(shipMesh);

                // Merkitään saapumistähti tarkistettavaksi, sillä aluksen saapuminen
                // on voinut käynnistää uuden taistelun tai muuttaa voimatasapainoa.
                markStarForCombatCheck(act.atStarId);
                
                break;
            }

            case 'SHIP_IN_SLIPSTREAM': {        // Alus on saanut väliaikaisen nopeusbonuksen toiselta alukselta
                // Haetaan alus-objekti ID:n perusteella.
                const virtualShip = shipsById.get(act.shipId);
                if (!virtualShip) break;

                // --- OSA 1: Päivitetään aluksen looginen tila ---
                // Emme muuta suoraan aluksen nopeutta, vaan päivitämme sen matkan
                // edistymisen. Palvelin kertoo, kuinka monta "tickiä" matkaa on
                // nyt edetty, mikä käytännössä siirtää alusta eteenpäin matkallaan.
                // Animaatiolooppi (`updateOrbitingShips`) käyttää näitä arvoja
                // aluksen visuaalisen sijainnin laskemiseen.
                const shipData = virtualShip.userData.shipData;
                if (shipData) {
                    shipData.movementTicks = act.movementTicks;
                    shipData.ticksToArrive = act.ticksToArrive;
                }

                // --- OSA 2: Asetetaan lippu ja ajastin animaatiota varten ---
                // Asetetaan `inSlipstream`-lippu, jota animaatiolooppi lukee.
                // Kun lippu on päällä, animaatio voi esimerkiksi kasvattaa aluksen
                // visuaalista nopeutta tai näyttää tehosteita.
                virtualShip.userData.inSlipstream = true;
                // `slipstreamTimer` varmistaa, että efekti on väliaikainen. Animaatiolooppi
                // vähentää tätä ajastinta joka framessa, ja kun se on nolla,
                // `inSlipstream`-lippu poistetaan.
                virtualShip.userData.slipstreamTimer = 0.5; // Efekti pysyy päällä 0.5 sekuntia.

                // --- OSA 3: Välitön visuaalinen palaute ---
                // Luodaan heti visuaalinen säihke-efekti aluksen kohdalle, jotta
                // pelaaja näkee välittömästi, että jotain tapahtui.
                if (virtualShip.position) { // Varmistetaan, että aluksella on sijainti.
                    spawnSlipstreamSparkle(virtualShip.position);
                }
                
                break;
            }

            case 'COMBAT_STARTED': {    // Palvelin ilmoittaa, että tähdellä on alkanut taistelu.
                // Haetaan tähti, jossa taistelu alkoi.
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                // --- Taisteluefektien alustus ---
                // Luo uusi `CombatEffectGroup`-hallintaolio, joka vastaa kaikista
                // tämän yhden taistelun visuaalisista tehosteista (esim. punainen rengas, räjähdykset).
                const effect = new CombatEffectGroup(starMesh, scene);
                // Tallennetaan luotu efekti-olio globaaliin `combatEffects`-hakemistoon
                // tähden ID:llä avainnettuna. Animaatiolooppi löytää ja päivittää
                // tämän efektin joka framessa niin kauan kuin taistelu on käynnissä.
                combatEffects.set(act.starId, effect);

                break;
            }

            // Nämä kaksi tapausta käsitellään yhdessä, koska ne molemmat lopettavat
            // aktiivisen konfliktitilan tähdellä ja vaativat visuaalisten tehosteiden siivoamista.
            case 'COMBAT_ENDED':
            case 'CONQUEST_HALTED': {
                // --- Taisteluefektien siivous ---
                // Haetaan tähän tähteen mahdollisesti liittyvä taisteluefektien hallintaolio.
                const effect = combatEffects.get(act.starId);
                if (effect) {
                    // Kutsutaan efektin omaa siivousmetodia, joka vapauttaa sen käyttämät resurssit
                    // (kuten paikan instanssijärjestelmässä).
                    effect.cleanup();
                    // Poistetaan efekti aktiivisten efektien listalta, jotta sitä ei enää päivitetä.
                    combatEffects.delete(act.starId);
                    // Poistetaan tähti jatkuvan taistelutarkkailun alaisuudesta (suorituskykyoptimointi).
                    starsToCheck.delete(act.starId);
                }
                // --- Valloitusrenkaan siivous (vain jos valloitus keskeytyi) ---
                if (act.action === 'CONQUEST_HALTED') {
                    const starMesh = starsById.get(act.starId);
                    // Tarkistetaan, onko tähdellä visuaalista valloitusrengasta.
                    if (starMesh && starMesh.userData.conquestRing) {
                        const ring = starMesh.userData.conquestRing;
                        
                        // Jos renkaalla on erillinen hehkuefekti, poistetaan ja siivotaan se ensin.
                        if (ring.userData.glowRing) {
                            scene.remove(ring.userData.glowRing);
                            ring.userData.glowRing.geometry.dispose();
                            ring.userData.glowRing.material.dispose();
                        }
                        
                        // Poistetaan ja siivotaan itse päärengas perusteellisesti muistivuotojen estämiseksi.
                        scene.remove(ring);
                        ring.geometry.dispose();
                        ring.material.dispose();
                        // Poistetaan viittaus renkaaseen tähden datasta.
                        delete starMesh.userData.conquestRing;
                        starMesh.userData.conquestRing = null;
                    }
                }
                break;
            }
                        
            case 'SHIP_DESTROYED': {    // Palvelin vahvistaa, että alus on tuhoutunut.
                // Haetaan tuhoutunut alus clientin sisäisestä seurannasta.
                const virtualShip = shipsById.get(act.shipId);
                if (!virtualShip) break;
                
                // --- Vaihe 1: Sijainninseurannan siivous ---
                // Poistetaan alus sen emotähden seurantajoukosta, jotta taistelulogiikka
                // ei enää ota sitä huomioon.
                const parentStarId = virtualShip.userData.shipData?.parentStarId;
                if (parentStarId && shipsByStarClient.has(parentStarId)) {
                    shipsByStarClient.get(parentStarId).delete(virtualShip);
                }
                
                // --- Vaihe 2: Visuaalinen palaute pelaajalle ---
                // Luodaan räjähdysefekti aluksen viimeisimpään tunnettuun sijaintiin.
                spawnExplosion(virtualShip.position);
                
                // --- Vaihe 3: Käyttöliittymän päivitys (valinnat) ---
                // Tarkistetaan, oliko tuhoutunut alus osa pelaajan nykyistä valintaa.
                const selectedIndex = selectedShips.indexOf(virtualShip);
                if (selectedIndex > -1) {
                    // Jos oli, poistetaan se valittujen listalta ja päivitetään UI-näyttö.
                    selectedShips.splice(selectedIndex, 1);
                    updateSelectedUnitsDisplay();
                }
                
                // --- Vaihe 4: Instanssin deaktivointi ja kierrätys (Object Pooling) ---
                // Tämä on tehokas tapa "poistaa" alus InstancedMesh-järjestelmästä.
                const type = virtualShip.userData.shipType;
                const instanceIndex = virtualShip.userData.instanceIndex;
                const instancedMesh = SHIP_INSTANCED_MESHES[type];
                
                if (instancedMesh && instanceIndex !== undefined) {
                    // A) Piilota instanssi asettamalla sen skaala nollaan. Tämä on paljon
                    // nopeampaa kuin puskurin koon muuttaminen lennosta.
                    const dummy = new THREE.Object3D();
                    dummy.position.copy(virtualShip.position);
                    dummy.scale.set(0, 0, 0);
                    dummy.updateMatrix();
                    
                    instancedMesh.setMatrixAt(instanceIndex, dummy.matrix);
                    instancedMesh.instanceMatrix.needsUpdate = true;
                    
                    // B) Vapauta instanssin paikka ("slotti") uudelleenkäyttöön.
                    // Lisätään vapautunut indeksi `freeInstanceSlots`-listalle.
                    // Seuraavan kerran kun `spawnShips` luo tämän tyyppisen aluksen,
                    // se käyttää tätä paikkaa ensisijaisesti.
                    freeInstanceSlots[type].add(instanceIndex);
                }
                
                // --- Vaihe 5: Erikoistehosteiden siivous ---
                // Jos aluksella oli jokin erikoistehoste (kuten Slipstream Frigaten kupla),
                // poistetaan se ja vapautetaan sen resurssit kunnolla muistivuotojen estämiseksi.
                if (virtualShip.userData.specialEffectMesh) {
                    const bubble = virtualShip.userData.specialEffectMesh;
                    scene.remove(bubble);
                    bubble.geometry.dispose();
                    bubble.material.dispose();
                }

                // --- Vaihe 6: Lopullinen siivous ja tilan tarkistus ---
                // Poistetaan alus lopullisesti clientin pääseurantajärjestelmästä.
                shipsById.delete(act.shipId);
                
                // Merkitään tähti, jossa tuho tapahtui, tarkistettavaksi,
                // koska taistelun voimasuhteet ovat muuttuneet.
                const starId = virtualShip.userData.shipData?.parentStarId;
                markStarForCombatCheck(starId);
                
                break;
            }

            case 'CONQUEST_STARTED': {  // Palvelin ilmoittaa, että tähden valloitus on alkanut.
                // Haetaan tähti, jossa valloitus alkoi.
                const starMesh = starsById.get(act.starId);
                // Vartiolauseke: Jos tähteä ei löydy tai sillä on jo valloitusrengas,
                // ei tehdä mitään. Tämä estää tuplarenkaiden luomisen.
                if (!starMesh || starMesh.userData.conquestRing) break;
                
                // --- Visuaalisen valloitusrenkaan luonti ---
                // 1. Haetaan valloittajan väri.
                const conquerorColor = getPlayerColor(act.conquerorId);
                // 2. Kutsutaan apufunktiota, joka luo ja palauttaa visuaalisen rengasobjektin.
                const ring = createConquestRing(starMesh, conquerorColor);
                // 3. Tallennetaan viittaus luotuun renkaaseen suoraan tähden userData-olioon.
                //    Tämä tekee renkaan löytämisestä ja päivittämisestä helppoa myöhemmin
                //    (esim. CONQUEST_PROGRESS-tapahtumassa).
                starMesh.userData.conquestRing = ring;
                
                break;
            }

            case 'CONQUEST_PROGRESS': {     // Palvelin lähettää päivityksen käynnissä olevan valloituksen edistymisestä.
                // Haetaan tähti ja varmistetaan, että sillä on aktiivinen valloitusrengas päivitettäväksi.
                const starMesh = starsById.get(act.starId);
                if (!starMesh || !starMesh.userData.conquestRing) break;
                
                const ring = starMesh.userData.conquestRing;
                // Muunnetaan palvelimen lähettämä prosenttiarvo (0-100)
                // shaderin ymmärtämäksi arvoksi (0.0-1.0).
                const progress = act.progress / 100;
                
                // --- Shader-päivitys ---
                // Tämä on tehokas tapa animoida rengasta. Geometriaa ei muuteta,
                // vaan ainoastaan kerrotaan näytönohjaimelle (shaderille),
                // kuinka suuri osa renkaasta tulee piirtää näkyviin.
                if (ring.material.uniforms) {
                    // Päivitetään "progress"-nimisen uniform-muuttujan arvo suoraan
                    // renkaan materiaalissa. Fragment shader käyttää tätä arvoa
                    // päättäessään, mitkä pikselit piirretään.
                    ring.material.uniforms.progress.value = progress;
                }
                break;
            }

            case 'CONQUEST_COMPLETE': {     // Palvelin vahvistaa, että tähden valloitus on onnistunut.
                // Haetaan valloitettu tähti.
                const starMesh = starsById.get(act.starId);
                if (!starMesh) break;
                
                // --- Vaihe 1: Valloituksen visuaalisten tehosteiden siivous ---
                // Tarkistetaan, onko tähdellä aktiivista valloitusrengasta.
                if (starMesh.userData.conquestRing) {
                    const ring = starMesh.userData.conquestRing;
                    
                    // Jos renkaaseen liittyy erillinen hehkuefekti, poistetaan se ensin.
                    if (ring.userData.glowRing) {
                        scene.remove(ring.userData.glowRing);
                        ring.userData.glowRing.geometry.dispose();
                        ring.userData.glowRing.material.dispose();
                    }
                    
                    // Poistetaan ja siivotaan itse päärengas perusteellisesti.
                    scene.remove(ring);
                    ring.geometry.dispose();
                    ring.material.dispose();
                    // Poistetaan viittaus renkaaseen tähden datasta, jotta se on täysin siivottu.
                    delete starMesh.userData.conquestRing;
                    starMesh.userData.conquestRing = null;
                }
                
                // --- Vaihe 2: Tähden värin päivitys vastaamaan uutta omistajaa ---
                const newColor = getPlayerColor(act.newOwnerId);
                // Päivitetään sekä tähden perusväri että sen hohtoväri (emissive).
                starMesh.material.color.setHex(newColor);
                starMesh.material.emissive.setHex(newColor);
                
                // Päivitetään myös tähden ympärillä olevan isomman hehkun (glow sprite) väri.
                if (starMesh.userData.glowSprite) {
                    starMesh.userData.glowSprite.material.color.setHex(newColor);
                }
                
                // --- Vaihe 3: Loogisen tilan ja indikaattoreiden päivitys ---
                // Päivitetään clientin sisäinen datamalli vastaamaan uutta omistajaa.
                starMesh.userData.starData.ownerId = act.newOwnerId;

                // Kutsutaan yleistä indikaattorien päivitysfunktiota. Tämä poistaa
                // automaattisesti vanhan omistajan indikaattorit ja luo uudet
                // (tai ei luo mitään, jos uusi omistaja on pelaaja, jolla ei ole rakennuksia).
                updateStarIndicators(starMesh.userData.starData, starMesh);
                
                break;
            }


            case 'HUB_NETWORK_UPDATED': {       // Palvelin ilmoittaa, että uusia starlane-yhteyksiä on luotu Galactic Hubien välille.
                // Varmistetaan, että päivitys sisältää yhteyksiä.
                if (!act.connections || act.connections.length === 0) break;

                // Käytetään normaalia starlane-materiaalia, jotta clientin
                // olemassa oleva logiikka tunnistaa reitin automaattisesti nopeaksi.
                // Käydään läpi kaikki uudet yhteydet, jotka palvelin lähetti.
                act.connections.forEach(conn => {
                    // Haetaan yhteyspisteiden (tähtien) 3D-objektit.
                    const fromMesh = starsById.get(conn.from);
                    const toMesh = starsById.get(conn.to);

                    // Varmistetaan, että molemmat tähdet löytyvät clientiltä ennen piirtämistä.
                    if (!fromMesh || !toMesh) {
                        return; // Käsittelee forEach-loopin seuraavan alkion.
                    }

                    // --- Uuden starlane-viivan luonti ---
                    // 1. Luo geometria, joka koostuu vain kahdesta pisteestä.
                    const geom = new THREE.BufferGeometry().setFromPoints([
                        fromMesh.position,
                        toMesh.position
                    ]);

                    // 2. Käytetään samaa materiaalia kuin normaaleilla starlaneilla.
                    //    Tämä on hyvä suunnittelupäätös, koska pelin olemassa oleva
                    //    logiikka tunnistaa reitin automaattisesti nopeaksi ilman lisäkoodia.
                    const line = new THREE.Line(geom, STARLANE_MAT.clone());
                    
                    // 3. Lisätään viivaan metadataa myöhempää käyttöä varten.
                    //    `isHubLane`-lippu voi olla hyödyllinen, jos näille yhteyksille
                    //    halutaan tulevaisuudessa lisätä erikoisefektejä.
                    line.userData = {
                        star1Id: conn.from,
                        star2Id: conn.to,
                        isHubLane: true
                    };
                    line.renderOrder = 2; // Varmistaa, että viiva piirtyy tähtien taakse.

                    // 4. Lisätään valmis viiva sceneen ja globaaliin seurantalistaan,
                    //    jotta sen ominaisuuksia (kuten läpinäkyvyyttä) voidaan päivittää myöhemmin.
                    scene.add(line);
                    starConnections.push(line); 
                });
                break;
            }
        }
    });
}

/* ========================================================================== */
/*  RENDER LOOP                                                               */
/* ========================================================================== */

/**
 * MITÄ: Käynnistää pelin pääasiallisen renderöinti- ja animaatiosilmukan.
 * MIKSI: Tämä on "sydän", joka saa 3D-maailman elämään. Se aloittaa `requestAnimationFrame`-
 * pohjaisen silmukan, joka päivittää ja piirtää scenen uudelleen jokaisella framella.
 * Funktio on suunniteltu niin, että se voidaan kutsua turvallisesti, eikä se käynnistä
 * useita silmukoita päällekkäin.
 */
export function startAnimateLoop() {
    // Vartiolauseke: Jos animaatiosilmukka on jo käynnissä, poistutaan heti.
    // Tämä estää useiden, päällekkäisten silmukoiden ajamisen, mikä aiheuttaisi
    // vakavia suorituskykyongelmia.
    if (animStarted) return; 
    // Asetetaan lippu merkiksi siitä, että silmukka on nyt aktiivinen.
    animStarted = true;
    // Käynnistetään Three.js:n kello, jota käytetään sulavien,
    // ruudunpäivitysnopeudesta riippumattomien animaatioiden ajoittamiseen.
    clock.start();


    /**
     * MITÄ: Sisäinen funktio, joka suorittaa yhden animaatio- ja renderöintikierroksen.
     * MIKSI: Tämä on sovelluksen "syke", joka ajetaan uudelleen ja uudelleen
     * `requestAnimationFrame`-kutsun avulla. Jokaisella kierroksella se:
     * 1. Päivittää kaikkien liikkuvien ja animoitujen objektien tilan.
     * 2. Piirtää päivitetyn näkymän ruudulle.
     * 3. Sisältää logiikan pelin pausetukselle ja suorituskyvyn optimoinnille.
     */
    function loop() {
        // --- OSA 1: Suorituskyvyn optimointi (Frame Skipping) ---
        // Jos edellisen framen renderöinti kesti yli 20ms (eli ruudunpäivitysnopeus
        // on alle 50 FPS), alamme dynaamisesti jättää frameja väliin.
        if (fpsStats.frameTime > 20) { // Yli 20ms = alle 50fps
            frameSkipCounter++;
            // Jätetään joka toinen frame päivittämättä ja renderöimättä.
            // Tämä antaa heikommille koneille "hengähdystauon" ja pitää
            // pelin sulavampana, vaikkakin matalammalla FPS:llä.
            if (frameSkipCounter % 2 !== 0) {
                requestAnimationFrame(loop); // Pyydetään seuraavaa framea, mutta ei tehdä muuta.
                return; 
            }
        }
        // --- OSA 2: Silmukan ylläpito ja ajastus ---
        // Varmistetaan, että silmukka pysähtyy, jos peli on lopetettu.
        if (!animStarted) return; // Pysäytetään looppi, jos lippu on false
        
        // Pyydetään selainta kutsumaan tätä `loop`-funktiota uudelleen heti,
        // kun se on valmis piirtämään seuraavan kuvan. Tämä luo jatkuvan silmukan.
        animationFrameId = requestAnimationFrame(loop);

        // --- OSA 3: Suorituskyvyn mittaus (FPS ja Frame Time) ---
        // Lasketaan, kuinka kauan edellisen framen piirtäminen kesti ja mikä on
        // nykyinen ruudunpäivitysnopeus. Tätä dataa käytetään yllä olevassa
        // frame skipping -logiikassa sekä debug-paneelissa.
        const currentTime = performance.now();
        // Frame time (ms per frame)
        fpsStats.frameTime = currentTime - fpsStats.lastFrameTime;
        fpsStats.lastFrameTime = currentTime;
        
        // FPS (frames per second)
        fpsStats.frameCount++;
        if (currentTime >= fpsStats.lastTime + 1000) {  // Päivitä FPS-lukema kerran sekunnissa.
            fpsStats.fps = Math.round((fpsStats.frameCount * 1000) / (currentTime - fpsStats.lastTime));
            fpsStats.frameCount = 0;
            fpsStats.lastTime = currentTime;
        }

        // --- OSA 4: Pausetetun pelin käsittely ---
        // Jos peli on pausella, suoritetaan vain minimaaliset visuaaliset päivitykset
        // ja ohitetaan kaikki pelilogiikkaan liittyvä animaatio.
        if (window.isPaused) {
            if (controls) controls.update();    // Tarvitaan kameran pehmeään pysähtymiseen.
            
            // Pyöritetään valintaindikaattoria hitaasti, jotta UI ei tunnu täysin jähmettyneeltä.
            if (selectionIndicatorMesh && selectionIndicatorMesh.visible) {
                selectionIndicatorMesh.rotation.y += 0.01; // Kiinteä pyörimisnopeus pausella
            }
            // Pidetään hover-efektit toiminnassa.
            updateAllStarVisuals();

            // Renderöi vain staattinen kuva
            if (composer) {
                composer.render();
            } else if (renderer && scene && camera) {
                renderer.render(scene, camera);
            }
            return; // Lopeta tämän framen käsittely tähän
        }

        // --- OSA 5: Ajan ja pelinopeuden laskenta ---
        const rawDelta = clock.getDelta(); // Todellinen aika edellisestä framesta sekunteina.
        const speed    = window.GAME_SPEED || 1; // Haetaan pelin nopeuskerroin.
        let delta      = rawDelta * speed; // Lasketaan "peliaika", joka on saattanut kulua.

        if (window.isPaused) delta = 0;
        if (window.TWEEN) window.TWEEN.update();    // Päivitetään TWEEN-animaatiokirjasto.
        
        // --- OSA 6: Animaatioiden päivitysvaihe ---
        // Kutsutaan kaikkia eri järjestelmien päivitysfunktioita ja annetaan
        // niille `delta`-arvo, jotta animaatiot ovat sulavia ja pelinopeudesta riippuvaisia.
        updateCombatRings(delta)
        // Update explosions
        updateExplosions(delta);
        updateSlipstreamSparkles(delta);
        // Update explosion pool
        if (window.explosionPool) {
            window.explosionPool.update(delta);
        }
        // Update orbitoivat alukset
        updateOrbitingShips(delta);
        // Update shipyard -ringsit
        updateShipyardRings(delta)
        // Update conquest rings
        updateConquestRings(delta);
        if (controls) controls.update();
        if (selectionIndicatorMesh && selectionIndicatorMesh.visible) {
            selectionIndicatorMesh.rotation.y += 0.5 * delta;
        }
        updateAllStarVisuals();
        updateVisibleNebulas()
        
        // --- OSA 7: Renderöintivaihe (Piirto) ---
        // Kun kaikkien objektien tila on päivitetty, piirretään lopputulos ruudulle.
        if (composer) {
            composer.render();  // Käytetään EffectComposeria, jos se on käytössä.
        } else if (renderer && scene && camera) {
            renderer.render(scene, camera); // Muuten käytetään perusrenderöijää.
        }
    }
    // Ensimmäinen kutsu, joka "käynnistää moottorin" ja aloittaa silmukan.
    loop();
}


/**
 * MITÄ: Pysäyttää renderöintisilmukan kokonaan.
 * MIKSI: Tätä funktiota kutsutaan, kun peli päättyy tai kun koko scene
 * siivotaan uutta peliä varten. Se varmistaa, että animaatiot eivät jää
 * pyörimään taustalle, mikä vapauttaa resursseja ja estää virheitä.
 */
export function stopAnimateLoop() {
    // Jos meillä on tallessa `requestAnimationFrame`-silmukan ID...
    if (animationFrameId) {
        // ...pyydetään selainta peruuttamaan seuraavan framen piirtopyyntö.
        // Tämä on virallinen ja ainoa tapa pysäyttää silmukka.
        cancelAnimationFrame(animationFrameId);
    }
    // Asetetaan lippu, joka kertoo muille osille, ettei animaatio ole enää käynnissä.
    // Tämä toimii myös varajärjestelmänä, joka pysäyttää loop-funktion,
    // jos se jostain syystä yrittäisi vielä suorittua.
    animStarted = false;
    // Pysäytetään Three.js:n kello.
    clock.stop();
}


/**
 * MITÄ: Tarkistaa, onko tarkkailtavissa tähdissä käynnissä taistelutilanne,
 * ja päivittää visuaaliset taisteluefektit sen mukaisesti.
 * MIKSI: Tämä funktio on client-puolen vastine palvelimen taistelulogiikalle.
 * Se ei itse päätä taistelun lopputulosta, vaan ainoastaan luo tai poistaa
 * visuaalisia tehosteita (punaiset renkaat, räjähdykset) sen perusteella,
 * onko tähdellä vihamielisiä osapuolia. Funktio on optimoitu suorituskykyiseksi.
 *
 * @param {number} delta - Animaatioloopin delta-aika, välitetään efektien päivitykseen.
 */
function checkForCombatSituations(delta) {
    // --- OPTIMOINTI 1: Ajoituksen rajoitus (Throttling) ---
    // Funktiota kutsutaan joka framessa, mutta sen sisältö ajetaan vain
    // muutaman kerran sekunnissa. Tämä säästää merkittävästi resursseja.
    const now = performance.now();
    if (now - lastCombatCheck < COMBAT_CHECK_INTERVAL) return;   // aja 4× sekunnissa
    lastCombatCheck = now;

    // (Suorituskyvyn mittausta varten)
    const startTime = performance.now();
    let starsChecked = 0;
    let totalShipsProcessed = 0;
    // --- MITTAUS PÄÄTTYY ---

    // --- OPTIMOINTI 2: Vain muutettujen tähtien tarkistus ---
    // Funktio ei käy läpi kaikkia pelin tähtiä, vaan ainoastaan ne, jotka on
    // lisätty `starsToCheck`-listalle. Tähti lisätään listalle, kun sen
    // tila muuttuu (esim. alus saapuu tai tuhoutuu).
    for (const starId of starsToCheck) {
        const starMesh = starsById.get(starId);
        if (!starMesh) {
            starsToCheck.delete(starId);    // Siivoa vanhentunut tieto pois.
            continue;
        }

        // --- OPTIMOINTI 3: Tehokas alusten haku ---
        // Haetaan kaikki tähdellä olevat alukset valmiiksi populoidusta
        // `shipsByStarClient`-hakemistosta. Tämä on O(1)-operaatio eli erittäin nopea.
        const shipsAtStarSet = shipsByStarClient.get(starId);

        // Jos tähdellä ei ole aluksia, ei voi olla taistelua
        if (!shipsAtStarSet || shipsAtStarSet.size === 0) {
            // Jos täällä OLI taistelu, lopetetaan sen efektit.
            if (combatEffects.has(starId)) {
                const effect = combatEffects.get(starId);
                effect.cleanup();   // Vapauttaa efektin resurssit.
                combatEffects.delete(starId);
            }
            starsToCheck.delete(starId); // Tilanne ratkaistu, poista tarkkailusta.
            continue;
        }

        // --- FAKTIOIDEN ANALYSOINTI ---
        // Kerätään, kuinka monen eri omistajan (faktion) aluksia tähdellä on.
        const factions = new Set();
        const shipArray = Array.from(shipsAtStarSet);
        for (const shipMesh of shipsAtStarSet) {
            if (shipMesh.userData.owner) {
                factions.add(shipMesh.userData.owner);
            }
        }

        const starOwnerId = starMesh.userData.starData.ownerId;
        const starHasDefense = starMesh.userData.starData.defenseLevel > 0;

        // --- TAISTELUN EHTOJEN MÄÄRITYS ---
        // Päätellään, tarvitaanko visuaalista taistelua. Ehtoja on kolme:
        const needsCombat = 
            // 1. Tähdellä on useamman kuin yhden faktion aluksia.
            factions.size > 1 || 
            // 2. Tähdellä on vain yhden faktion aluksia, mutta ne EIVÄT OLE tähden omistajan.
            (factions.size === 1 && starOwnerId && !factions.has(starOwnerId)) ||
            // 3. (Varalta) Tähdellä on puolustusta, ja siellä on aluksia, jotka eivät ole omistajan.
            (shipsAtStarSet.size > 0 && starHasDefense && starOwnerId && !factions.has(starOwnerId));

        if (needsCombat) {
            // Jos taistelua tarvitaan, mutta efektejä ei ole vielä luotu...
            if (!combatEffects.has(starId)) {
                // Suorituskykysuoja: Jos aktiivisia efektejä on liikaa, poistetaan vanhin.
                if (combatEffects.size >= MAX_ACTIVE_COMBAT_EFFECTS) {
                    const firstKey = combatEffects.keys().next().value;
                    const oldEffect = combatEffects.get(firstKey);
                    if (oldEffect) {
                        oldEffect.cleanup();
                        combatEffects.delete(firstKey);
                    }
                }
                // ...luodaan uusi efektiryhmä ja tallennetaan se seurantaan.
                const effect = new CombatEffectGroup(starMesh, scene);
                combatEffects.set(starId, effect);
            }
        } else {
            // Jos taistelua EI tarvita, mutta efektit ovat päällä, siivotaan ne pois.
            if (combatEffects.has(starId)) {
                const effect = combatEffects.get(starId);
                effect.cleanup();
                combatEffects.delete(starId);
                // Poista myös tarkistuslistalta
                starsToCheck.delete(starId);    // Tilanne ratkaistu.
            }
        }
    }
    
    // --- AKTIIVISTEN EFEKTIEN PÄIVITYS ---
    // Käydään läpi kaikki tällä hetkellä aktiiviset taisteluefektit.
    combatEffects.forEach((effect, starId) => {
        // Frame skip -optimointi: Päivitetään efektit vain joka toisessa framessa.
        if (frameSkipCounter % 2 === 0) { // Frame skip
            const ships = Array.from(shipsByStarClient.get(starId) || []);
            // Kutsutaan efektiryhmän omaa päivitysmetodia, joka hoitaa animaatiot (räjähdykset, renkaan pyöritys).
            effect.update(delta, ships);
        }
    });

    // --- LOPPUUN MITTAUSRAPORTTI ---
    const endTime = performance.now();
    const duration = endTime - startTime;
}


/**
 * MITÄ: Lisää tähden ID:n tarkkailulistalle (`starsToCheck`).
 * MIKSI: Tämä on tärkeä apufunktio suorituskyvyn optimoimiseksi. Sen sijaan,
 * että `checkForCombatSituations` kävisi läpi kaikki pelin sadat tähdet joka
 * kerta, se tarkistaa vain ne tähdet, jotka on merkitty tällä funktiolla.
 * Funktiota kutsutaan aina, kun tähdellä tapahtuu jotain, mikä saattaa
 * muuttaa taistelutilannetta (esim. alus saapuu tai tuhoutuu).
 *
 * @param {string|ObjectId} starId - Sen tähden ID, joka vaatii taistelutilanteen tarkistuksen.
 */
function markStarForCombatCheck(starId) {
    // Varmistetaan, että ID on olemassa, ennen kuin se lisätään listalle.
    if (starId) {
        // `Set.add()` on tehokas ja hoitaa duplikaatit automaattisesti;
        // saman ID:n lisääminen useaan kertaan ei tee mitään.
        starsToCheck.add(starId);
    }
}


/**
 * MITÄ: Pakottaa taistelutarkistuksen suoritettavaksi heti seuraavassa animaatioframessa.
 * MIKSI: `checkForCombatSituations`-funktio on optimoitu ajettavaksi vain
 * muutaman kerran sekunnissa. Joissain tilanteissa, kuten aluksen ennustetun
 * saapumisen yhteydessä, haluamme kuitenkin välittömästi tarkistaa, alkaako
 * taistelu. Tämä apufunktio tekee sen nollaamalla tarkistuksen ajastimen.
 */
function triggerCombatCheck() {
    // Asettamalla `lastCombatCheck`-aikaleiman nollaan varmistetaan, että
    // `checkForCombatSituations`-funktion ehto `now - lastCombatCheck < COMBAT_CHECK_INTERVAL`
    // on aina epätosi seuraavalla kierroksella, mikä pakottaa sen ajamaan
    // koko logiikkansa välittömästi.
    lastCombatCheck = 0;
}



/**
 * MITÄ: Päivittää kaikkien alusten sijainnin ja asennon joka framessa.
 * MIKSI: Tämä on yksi pelin suorituskykykriittisimmistä funktioista. Se on vastuussa
 * sekä paikallaan kiertoradalla ("orbiting") että liikkeellä olevien ("moving")
 * alusten sulavasta animoinnista. Funktio on pitkälle optimoitu:
 * 1. Se käsittelee suuria alusmääriä tehokkaasti keräämällä kaikki päivitykset
 * ensin eriin (`updatesByType`) ja lähettämällä ne kerralla InstancedMesh-objekteille.
 * 2. Se sisältää "itsekorjaavan" mekanismin, joka varmistaa, että alusten
 * sijainninseuranta pysyy synkronissa.
 * 3. Se tekee "client-side prediction" -ennustuksen alusten saapumisesta,
 * mikä tekee pelistä reagoivamman tuntuisen.
 *
 * @param {number} delta - Animaatioloopilta saatu aika edellisestä framesta.
 */
function updateOrbitingShips(delta) {
    if (window.isPaused) return; // Pysäytetään kaikki, jos peli on pausella.
    
    // Rajoitetaan delta-aikaa "kuoleman spiraalin" estämiseksi. Jos peli lagaa pahasti,
    // delta voi kasvaa valtavaksi. Tämä estää aluksia hyppäämästä valtavia matkoja kerralla.
    const SIM_DELTA = Math.min(delta, 0.12); // Max ~7 framea kerralla
    frameSkipCounter++;

    // --- OSA 1: ITSEKORJAAVA SIJAINNINSEURANTA ---
    // Ajetaan tämä tarkistus harvakseltaan (noin kerran sekunnissa) varmuuden vuoksi.
    if (frameSkipCounter % 60 === 0) {
        let fixed = 0;
        // Käydään kaikki alukset läpi ja varmistetaan, että jokainen kiertoradalla
        // oleva alus on varmasti lisättynä oikean tähden seurantajoukkoon.
        shipsById.forEach(virtualShip => {
            const shipData = virtualShip.userData.shipData;
            if (!shipData || !shipData.parentStarId) return;
            
            const isOrbiting = shipData.state === 'orbiting' || shipData.predictedArrival;
            const starId = shipData.predictedArrival ? shipData.targetStarId : shipData.parentStarId;
            
            if (isOrbiting && starId) {
                // Varmista että alus on tracking rakenteessa
                if (!shipsByStarClient.has(starId)) {
                    shipsByStarClient.set(starId, new Set());
                }
                
                const starShips = shipsByStarClient.get(starId);
                if (!starShips.has(virtualShip)) {
                    starShips.add(virtualShip); // Lisätään puuttuva alus takaisin.
                    fixed++;
                }
            }
        });
    }
    
    // --- OSA 2: TAISTELUTILANTEIDEN TARKISTUS ---
    // Kutsutaan funktiota, joka tarkistaa ja päivittää visuaaliset taisteluefektit.
    checkForCombatSituations(delta);
    
    // --- OSA 3: ERÄPÄIVITYSTEN VALMISTELU ---
    // Luodaan objekti, johon kerätään kaikki tämän framen aikana tapahtuvat
    // alusten sijainti- ja rotaatiomuutokset tyypin mukaan.
    const updatesByType = {
        Fighter: [],
        Destroyer: [],
        Cruiser: [],
        'Slipstream Frigate': []
    };
    
    // --- OSA 4: KAIKKIEN ALUSTEN KÄSITTELY ---
    shipsById.forEach(virtualShip => {
        const shipData = virtualShip.userData.shipData;
        if (!shipData) return;
        
        // Päivitä slipstream-ajastin ja poista lippu tarvittaessa
        if (virtualShip.userData.slipstreamTimer > 0) {
            virtualShip.userData.slipstreamTimer -= SIM_DELTA;
            if (virtualShip.userData.slipstreamTimer <= 0) {
                virtualShip.userData.inSlipstream = false;
            }
        }

        const type = virtualShip.userData.shipType || 'Fighter';
        
        // --- HAARA 1: KIERTORADALLA OLEVAT ALUKSET ---
        const isOrbitVisually = shipData.state === 'orbiting' || shipData.predictedArrival;
        const centerStarId = shipData.predictedArrival ? shipData.targetStarId : shipData.parentStarId;

        if (isOrbitVisually && centerStarId) {
            const centerStar = starsById.get(centerStarId);
            if (!centerStar) return;
            
            // Päivitetään aluksen kulmaa kiertoradalla.
            virtualShip.userData.orbitAngle += virtualShip.userData.orbitSpeed * SIM_DELTA;
            // Lasketaan uusi 3D-sijainti trigonometrian avulla.
            // Y-akselin pieni siniaalto luo pehmeän "aaltoilevan" pystyliikkeen.
            virtualShip.position.x = centerStar.position.x +
                virtualShip.userData.orbitRadius * Math.cos(virtualShip.userData.orbitAngle);
            virtualShip.position.z = centerStar.position.z +
                virtualShip.userData.orbitRadius * Math.sin(virtualShip.userData.orbitAngle);
            virtualShip.position.y = centerStar.position.y +
                Math.sin(virtualShip.userData.orbitAngle * 0.5) * 2;

            // Lisätään laskettu päivitys eräkäsittelylistalle.
            updatesByType[type].push({
                index: virtualShip.userData.instanceIndex,
                position: virtualShip.position.clone(),
                lookAt: centerStar.position
            });
            // Pidetään mahdolliset erikoisefektit aluksen mukana.
            if (virtualShip.userData.specialEffectMesh) {
                virtualShip.userData.specialEffectMesh.position.copy(virtualShip.position);
            }
        }

        // --- HAARA 2: LIIKKEELLÄ OLEVAT ALUKSET ---
        else if (shipData.state === 'moving' && shipData.targetStarId) {
            
            // Vaihe 1: Hae kohteet ja määritä perusmuuttujat.
            const targetStar = starsById.get(shipData.targetStarId);
            if (!targetStar) return;

            // Vaihe 2: Määrittele tarvittavat muuttujat ENNEN käyttöä
            const targetPosition = targetStar.position;
            const direction = targetPosition.clone().sub(virtualShip.position).normalize();
            const distanceToTarget = virtualShip.position.distanceTo(targetPosition);

            // Vaihe 2: Laske aluksen liikkumisnopeus reitin tyypin mukaan.
            let speed;
            const SHIP_SPEED_FAST = 60;
            const SHIP_SPEED_SLOW = 6;
            const FIGHTER_SPEED_SLOW = 12;
            const FRIGATE_SPEED_SLOW = 12;

            const fromStar = starsById.get(shipData.departureStarId);
            
            // TARKISTUS 1: Onko reitti alkuperäinen starlane?
            const isOriginalLane = fromStar && fromStar.userData.starData.connections?.includes(shipData.targetStarId);

            // TARKISTUS 2: Onko reitti dynaaminen Galactic Hub -starlane?
            // Käydään läpi kaikki piirretyt yhteydet ja katsotaan, löytyykö vastaavuus.
            const isHubLane = starConnections.some(line =>
                (line.userData.star1Id === shipData.departureStarId && line.userData.star2Id === shipData.targetStarId) ||
                (line.userData.star1Id === shipData.targetStarId && line.userData.star2Id === shipData.departureStarId)
            );

            // JOS reitti on joko alkuperäinen TAI Hub-lane, käytä suurinta nopeutta.
            if (isOriginalLane || isHubLane) {
                speed = SHIP_SPEED_FAST;
            } 
            // MUUTEN käytä normaalia hitaampaa nopeutta tyypin mukaan.
            else if (shipData.type === 'Slipstream Frigate') {
                speed = FRIGATE_SPEED_SLOW;
            } else if (shipData.type === 'Fighter') {
                speed = FIGHTER_SPEED_SLOW;
            } else {
                speed = SHIP_SPEED_SLOW;
            }

            // Vaihe 4: Tuplaa visuaalinen nopeus, jos alus on slipstream-efektin alainen
            if (virtualShip.userData.inSlipstream) {
                // Asetetaan hitaiden alusten nopeudeksi SUORAAN frigatin nopeus.
                // Tämä takaa, että ne liikkuvat täsmälleen samaa vauhtia.
                speed = 20;
            }

            // Vaihe 5: Laske tämän framen liike ja suorita se
            const orbitR = shipData.plannedOrbitRadius ?? 18;
            const rawStep = speed * SIM_DELTA;
            let step; // Määritellään step-muuttuja

            // JOS alus on slipstreamissä, se liikkuu täyttä vauhtia ilman jarrua.
            if (virtualShip.userData.inSlipstream) {
                step = rawStep;
            } 
            // MUUTEN käytetään normaalia, pehmeää jarrutusta kiertoradalle saavuttaessa.
            else {
                const maxStep = Math.max(0, distanceToTarget - orbitR * 0.9);
                step = Math.min(rawStep, maxStep);
            }
            
            if (distanceToTarget > orbitR) {    // Jos alus on vielä matkalla.
                // Normaali liike avaruudessa
                virtualShip.position.add(direction.multiplyScalar(step));
                
                // Päivitä myös kuplan sijainti, jos se on olemassa
                if (virtualShip.userData.specialEffectMesh) {
                    virtualShip.userData.specialEffectMesh.position.copy(virtualShip.position);
                }
                
                // Lisää päivitys eräkäsittelyyn 
                updatesByType[type].push({
                    index: virtualShip.userData.instanceIndex,
                    position: virtualShip.position.clone(),
                    lookAt: targetPosition
                });
            }
            else {  // --- CLIENT-SIDE SAAPUMISENNUSTUS ---
                // Kun alus on tarpeeksi lähellä, client "ennustaa" sen saapumisen
                // odottamatta palvelimen virallista vahvistusta.
                if (!shipData.predictedArrival) {
                    shipData.predictedArrival = true;
                    // Napsautetaan alus ennalta laskettuun kiertoratapaikkaan.
                    const ang = shipData.plannedOrbitAngle ?? Math.random() * Math.PI * 2;
                    const rad = shipData.plannedOrbitRadius ?? orbitR;

                    virtualShip.userData.orbitAngle = ang;
                    virtualShip.userData.orbitRadius = rad;

                    virtualShip.position.set(
                        targetPosition.x + rad * Math.cos(ang),
                        targetPosition.y + Math.sin(ang * 0.5) * 2,
                        targetPosition.z + rad * Math.sin(ang)
                    );
                    
                    // Päivitetään seurantatiedot ja merkitään tähti taistelutarkistukseen.
                    if (!shipsByStarClient.has(targetStar.userData.starData._id)) {
                        shipsByStarClient.set(targetStar.userData.starData._id, new Set());
                    }
                    shipsByStarClient.get(targetStar.userData.starData._id).add(virtualShip);
                    
                    markStarForCombatCheck(shipData.targetStarId);
                    triggerCombatCheck();   // Pakotetaan tarkistus heti.
                    
                    updatesByType[type].push({
                        index: virtualShip.userData.instanceIndex,
                        position: virtualShip.position.clone(),
                        lookAt: targetPosition
                    });
                }
            }
        }
    });
    
    // --- OSA 5: ERÄPÄIVITYSTEN SUORITTAMINEN ---
    // Kun kaikkien alusten uudet sijainnit on laskettu, ne päivitetään kerralla
    // InstancedMesh-puskureihin.
    Object.entries(updatesByType).forEach(([type, updates]) => {
        if (updates.length === 0) return;
        const instancedMesh = SHIP_INSTANCED_MESHES[type];
        if (!instancedMesh) return;
        
        const dummy = new THREE.Object3D();
        updates.forEach(update => {
            if (update.index === undefined || update.index < 0) {
                return;
            }
            
            dummy.position.copy(update.position);
            dummy.lookAt(update.lookAt);
            dummy.scale.set(1, 1, 1); // Varmista että scale on 1
            dummy.updateMatrix();
            
            try {
                instancedMesh.setMatrixAt(update.index, dummy.matrix);
            } catch (e) {
            }
        });
        // Yksi ainoa kutsu, joka lähettää kaikki tämän tyypin muutokset näytönohjaimelle.
        instancedMesh.instanceMatrix.needsUpdate = true;
    });
}



/**
 * MITÄ: Animoi kaikkia aktiivisia valloitusrenkaita.
 * MIKSI: Tätä funktiota kutsutaan renderöintisilmukassa joka framessa. Se vastaa
 * valloituksen alla olevien tähtien ympärillä näkyvien renkaiden jatkuvasta
 * animaatiosta, kuten pyörimisestä ja pulssiefektistä, tehden niistä
 * elävän ja informatiivisen näköisiä.
 *
 * @param {number} delta - Aika (sekunteina) edellisestä framesta, käytetään sulavaan animaatioon.
 */
function updateConquestRings(delta) {
    // Käydään läpi kaikki pelin tähdet.
    starsById.forEach(starMesh => {
        // Tarkistetaan, onko tällä tähdellä aktiivinen valloitusrengas.
        if (starMesh.userData.conquestRing) {
            const ring = starMesh.userData.conquestRing;
            
            // --- Animaatio 1: Hidas pyöriminen ---
            // Kasvatetaan renkaan rotaatiota Z-akselin ympäri joka frame.
            // `delta`-arvon käyttö varmistaa, että pyörimisnopeus on tasainen
            // ruudunpäivitysnopeudesta riippumatta.
            ring.rotation.z += delta * 0.1;
            
            // --- Animaatio 2: "Sykkivä" läpinäkyvyys ---
            // Luodaan pehmeä pulssiefekti siniaallon avulla. `Date.now()` antaa
            // jatkuvasti kasvavan arvon, ja `Math.sin` muuntaa sen sulavaksi
            // aaltoliikkeeksi -1 ja 1 välillä.
            const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.002);
            ring.material.opacity = pulse;
            
            // --- Animaatio 3: Mahdollisen hehkurenkaan vastakkaissuuntainen pyöriminen ---
            // Jos päärenkaaseen on liitetty erillinen hehkurengas...
            if (ring.userData.glowRing) {
                // ...pyöritetään sitä hitaammin ja vastakkaiseen suuntaan,
                // mikä luo näyttävän visuaalisen kontrastin.
                ring.userData.glowRing.rotation.z -= delta * 0.05; 
            }
        }
    });
}

/* ========================================================================== */
/*  Planeetan valloituksen visuaalisten indikaattorien apufunktiot            */
/* ========================================================================== */


/**
 * MITÄ: Hakee pelaajan ID:tä vastaavan värin numeerisessa heksadesimaalimuodossa.
 * MIKSI: Tämä on keskitetty apufunktio, joka muuntaa pelaajatunnisteen sen visuaaliseksi väriksi.
 * Se on rakennettu vankaksi: se osaa käsitellä eri muodoissa olevia ID-tunnisteita (string vs. object)
 * ja värejä (string vs. number), ja sillä on oletusarvot siltä varalta, että pelaajadataa
 * ei jostain syystä löytyisi.
 *
 * @param {string|ObjectId|null} playerId - Sen pelaajan ID, jonka väri halutaan. Voi olla null neutraaleille.
 * @returns {number} Pelaajan väri heksadesimaalilukuna (esim. 0xffffff).
 */
function getPlayerColor(playerId) {
    // Jos ID:tä ei ole, kyseessä on neutraali objekti, jolle palautetaan oletusväri.
    if (!playerId) return NEUTRAL_COLOR;
    
    // --- Päälogiikka: Etsi väri globaalista pelin datasta ---
    const gameData = window.gameData;
    if (gameData && gameData.players) {
         // Etsitään pelaajaa, jonka ID vastaa annettua ID:tä.
        const player = gameData.players.find(p => {
            // Varmistetaan luotettava vertailu muuntamalla molemmat ID:t merkkijonoiksi.
            // Tämä on tarpeen, koska ID:t voivat tulla eri lähteistä eri muodoissa.
            const pIdStr = typeof p._id === 'object' ? p._id.toString() : p._id;
            const searchIdStr = typeof playerId === 'object' ? playerId.toString() : playerId;
            return pIdStr === searchIdStr;
        });
        
        // Jos pelaaja löytyi ja hänellä on väri määriteltynä...
        if (player && player.color) {
            // ...varmistetaan, että väri on oikeassa numeerisessa muodossa.
            // Jos väri on merkkijono (esim. "#ff0000"), se muunnetaan numeroksi.
            if (typeof player.color === 'string') {
                return parseInt(player.color.replace('#', ''), 16);
            }
            // Jos väri on jo numero, palautetaan se sellaisenaan.
            return player.color;
        }
    }
    
    // --- Varajärjestelmä (Fallback) ---
    // Tämä suoritetaan, jos `gameData` tai pelaajaa ei löytynyt.
    // Varmistaa, että peli ei kaadu ja palauttaa oletusvärin.
    const humanIdStr = typeof gameData?.humanPlayerId === 'object' ? 
                      gameData.humanPlayerId.toString() : 
                      gameData.humanPlayerId;
    const playerIdStr = typeof playerId === 'object' ? playerId.toString() : playerId;
    
    // Palauta oletusväri ihmispelaajalle.
    if (playerIdStr === humanIdStr) {
        return PLAYER_COLOR;
    }
    // Palauta oletusväri tekoälylle.
    return 0xdc3545; 
}


/**
 * MITÄ: "Tehdasfunktio", joka luo ja palauttaa yhden visuaalisen valloitusrenkaan.
 * MIKSI: Tämä funktio on vastuussa valloitusprosessin visuaalisesta esittämisestä.
 * Se ei käytä perinteistä animaatiota, vaan luo `ShaderMaterial`-materiaalin,
 * joka mahdollistaa animaation suorittamisen suoraan näytönohjaimella. Tämä
 * on erittäin tehokas tapa luoda "täyttyvä" edistymispalkki-efekti.
 *
 * @param {THREE.Mesh} starMesh - Tähti, jonka ympärille rengas luodaan.
 * @param {number} [color=0xffa500] - Renkaan väri heksadesimaalilukuna.
 * @returns {THREE.Mesh} Palauttaa valmiin, sceneen lisätyn rengasobjektin.
 */
function createConquestRing(starMesh, color = 0xffa500) {
    // Lasketaan renkaan mitat tähden koon perusteella.
    const starRadius = starMesh.geometry.parameters.radius * (starMesh.scale.x || 1);
    const ringInnerRadius = starRadius + 8;
    const ringOuterRadius = starRadius + 12;
    
    // Luodaan renkaan perusmuoto (`RingGeometry`).
    // Segmenttien määrää (32) on pienennetty suorituskyvyn parantamiseksi.
    const geometry = new THREE.RingGeometry(
        ringInnerRadius, 
        ringOuterRadius, 
        32,  // Vähennetty 64 -> 32
        1
    );
    
    // --- Shader-materiaalin luonti (funktion ydin) ---
    // `ShaderMaterial` antaa meille suoran pääsyn näytönohjaimeen GLSL-koodilla.
    const material = new THREE.ShaderMaterial({
        // `uniforms` ovat muuttujia, joita voimme lähettää JavaScriptistä shaderille.
        uniforms: {
            color: { value: new THREE.Color(color) }, // Renkaan väri.
            progress: { value: 0.0 }, // Edistyminen (0.0 - 1.0), jota animoidaan.
            opacity: { value: 0.85 }  // Renkaan läpinäkyvyys.
        },

        // --- Shader-materiaalin luonti ---
        // Tämä materiaali käyttää kustomoitua GLSL-koodia "täyttyvän" renkaan efektin luomiseen.

        // Vertex Shader on vakio: se laskee vain kärkipisteiden sijainnin ruudulla
        // ja välittää UV-koordinaatit eteenpäin Fragment Shaderille.
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,

        // --- Fragment Shaderin logiikka ---
        // 1. Uniform-muuttujat (color, progress, opacity) ovat arvoja, jotka välitetään JS-koodista shaderille.
        // 2. Varying `vUv` kertoo, missä kohtaa (0.0-1.0) renkaan muotoa nykyinen pikseli sijaitsee.
        // 3. `atan(vUv.y - 0.5, vUv.x - 0.5)` laskee pikselin kulman suhteessa renkaan keskipisteeseen.
        // 4. Kulma normalisoidaan, jotta se on välillä 0.0 - 1.0, edustaen pikselin sijaintia renkaan kehällä.
        // 5. YDINLOGIIKKA: `if (normalizedAngle > progress) { discard; }`
        //    Tämä hylkää (jättää piirtämättä) kaikki pikselit, joiden kulma on suurempi kuin valloituksen
        //    senhetkinen edistyminen. Tämä luo "piirakka"-efektin, joka täyttyy progress-arvon kasvaessa.
        fragmentShader: `
            uniform vec3 color;
            uniform float progress;
            uniform float opacity;
            varying vec2 vUv;
            
            void main() {
                float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
                float normalizedAngle = (angle + 3.14159) / (2.0 * 3.14159);
                if (normalizedAngle > progress) {
                    discard;
                }
                gl_FragColor = vec4(color, opacity);
            }
        `,
        // Muita asetuksia läpinäkyvien objektien oikeaan renderöintiin.
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        depthTest: false
    });
    
    // Luodaan lopullinen 3D-objekti geometriasta ja shader-materiaalista.
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / 2; // Käännetään rengas "makuulleen".
    ring.position.copy(starMesh.position); // Keskitetään rengas tähden päälle.
    ring.renderOrder = 15; // Korkea renderOrder varmistaa, että se piirtyy muiden päällä.
    
    scene.add(ring);
    return ring;
}



/**
 * MITÄ: Siivoaa koko 3D-scenen perusteellisesti kaikista peliin liittyvistä objekteista.
 * MIKSI: Tämä on elintärkeä funktio, joka ajetaan aina ennen uuden pelin aloittamista.
 * Se varmistaa, että edellisen pelin mitkään 3D-objektit, materiaalit, geometriat tai
 * datarakenteet eivät jää muistiin. Oikein suoritettu siivous estää muistivuodot,
 * parantaa suorituskykyä ja takaa, että uusi peli alkaa aina puhtaalta pöydältä.
 */
export function cleanupScene() {
    // Pysäytetään animaatiosilmukka välittömästi, jotta se ei yritä päivittää
    // objekteja, joita olemme aikeissa poistaa.
    stopAnimateLoop();
    
    animStarted = false;
    if (clock) clock.stop();

    // Puhdistetaan alusten InstancedMesh-objektit.
    Object.values(SHIP_INSTANCED_MESHES).forEach(mesh => {
        scene.remove(mesh); // Poista pääobjekti scenestä.
        mesh.geometry.dispose();    // Vapauta geometrian käyttämä näytönohjaimen muisti.
        mesh.material.dispose();    // Vapauta materiaalin käyttämä muisti.
        // Nollataan puskurit ja laskurit.
        if (mesh.instanceMatrix) mesh.instanceMatrix.array.fill(0);
        if (mesh.instanceColor) mesh.instanceColor.array.fill(0);
        mesh.count = 0;
    });
    
    // Nollataan alusten dataseuranta.
    Object.keys(shipInstanceData).forEach(type => {
        shipInstanceData[type] = { 
            count: 0, 
            matrices: [], 
            colors: [], 
            ids: new Map() 
        };
    });
    
    // Tyhjennetään kierrätystä varten varatut vapaat paikat.
    Object.keys(freeInstanceSlots).forEach(type => {
        freeInstanceSlots[type].clear();
    });
    
    // Siivotaan aluksiin mahdollisesti liitetyt erikoisefektit (esim. Slipstream-kupla).
    shipsById.forEach(virtualShip => {
        if (virtualShip.userData.specialEffectMesh) {
            const bubble = virtualShip.userData.specialEffectMesh;
            scene.remove(bubble);
            // Vapauta geometria ja materiaali muistista
            if (bubble.geometry) bubble.geometry.dispose();
            if (bubble.material) bubble.material.dispose();
        }
    });

    // --- Alusten seurantatietojen nollaus ---
    // Tyhjennetään clientin sisäiset tietorakenteet, jotka pitivät kirjaa
    // aluksista ja niiden sijainneista.
    shipsById.clear();
    shipsByStarClient.clear();
    
    // --- Puolustusrengas-järjestelmän siivous ---
    // Tarkistetaan, onko puolustusrenkaiden pääobjekti (InstancedMesh) olemassa.
    if (DEFENSE_RING_INSTANCE) {
        scene.remove(DEFENSE_RING_INSTANCE);    // Poista koko järjestelmä scenestä.
        DEFENSE_RING_INSTANCE.geometry.dispose();    // Vapauta jaettu geometria näytönohjaimen muistista.
        DEFENSE_RING_INSTANCE.material.dispose();   // Vapauta jaettu materiaali.
        DEFENSE_RING_INSTANCE = null; // Asetetaan nulliksi, jotta se luodaan uudelleen seuraavassa pelissä.
    }

    // Nollataan puolustusrenkaiden dataseuranta.
    defenseRingData.count = 0; // Tämä ei ole enää käytössä, mutta nollataan varmuuden vuoksi
    defenseRingData.starIds.fill(null); // Tehokas tapa nollata koko taulukko
    defenseRingData.ringIndicesByStar.clear(); // Tyhjennä Map-rakenne

    // --- Tähtien ja niiden liitännäisobjektien siivous ---
    // Käydään läpi kaikki olemassa olleet tähdet yksitellen.
    starsById.forEach((starMesh) => {
        scene.remove(starMesh); // Poistetaan itse tähden 3D-objekti.
        
        // Siivotaan tähteen liittyvä hehku-sprite.
        if (starMesh.userData.glowSprite) {
            scene.remove(starMesh.userData.glowSprite);
            starMesh.userData.glowSprite.material.dispose();
        }
        // Luodaan paikallinen apufunktio, joka siivoaa listan objekteja.
        // Tämä vähentää koodin toistoa ja tekee siivouksesta selkeämpää.
        const disposeList = list => {
            list.forEach(obj => {
                scene.remove(obj);
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            });
        };
        // Oikopolut tähden dataan. `?? {}` on turvakeino, joka estää virheet,
        // jos `starData` olisi jostain syystä `null`.
        const sd = starMesh.userData;
        const sds = sd.starData ?? {};

        // Kutsutaan apufunktiota siivoamaan kaikki tähteen liittyvät indikaattorilistat.
        disposeList(sds.defenseRings ?? sd.defenseRings ?? []);
        disposeList(sds.mineIndicatorMeshes ?? sd.mineIndicatorMeshes ?? []);
        disposeList(sds.populationIndicatorMeshes ?? sd.populationIndicatorMeshes ?? []);
        // Siivotaan yksittäiset sprite- ja rengasobjektit, jotka eivät ole listoissa.
        if (sds.shipyardIndicatorSprite ?? sd.shipyardIndicatorSprite) {
            const spr = sds.shipyardIndicatorSprite ?? sd.shipyardIndicatorSprite;
            scene.remove(spr);
            spr.material.dispose();
        }
        disposeList(sds.shipyardRings ?? sd.shipyardRings ?? []);

        // Siivotaan valloitusrengas ja sen mahdollinen hehkuefekti.
        if (sd.conquestRing || sds.conquestRing) {
            const ring = sd.conquestRing || sds.conquestRing;
            if (ring.userData && ring.userData.glowRing) {
                scene.remove(ring.userData.glowRing);
                ring.userData.glowRing.geometry.dispose();
                ring.userData.glowRing.material.dispose();
            }
            scene.remove(ring);
            ring.geometry.dispose();
            ring.material.dispose();
            sd.conquestRing = null; // Nollataan viittaukset.
            sds.conquestRing = null;
        }
        // Viimeisenä vapautetaan itse tähden geometria ja materiaali. Koska geometria
        // on jaettu kaikkien tähtien kesken, tämä vapauttaa sen tehokkaasti muistista.
        starMesh.geometry.dispose();
        starMesh.material.dispose();
    });
    // Tyhjennetään lopuksi koko tähtien seurantakartta.
    starsById.clear();

    // --- Yhteyksien ja tehosteiden siivous ---
    // Käydään läpi kaikki starlane-yhteydet ja vapautetaan niiden resurssit.
    starConnections.forEach(line => {
        scene.remove(line);
        line.geometry.dispose();    // Vapauttaa geometrian muistin.
        line.material.dispose();    // Vapauttaa materiaalin muistin.
    });
    starConnections.length = 0; // Tyhjennetään seurantataulukko.
    
    // Siivotaan tähtien hehkut (glow sprites).
    starGlows.forEach(glow => {
        scene.remove(glow);
        if (glow.material) glow.material.dispose();
    });
    starGlows.length = 0;

    // Siivotaan vanhan järjestelmän mukaiset, manuaalisesti luodut räjähdykset.
    explosions.forEach(ex => {
        scene.remove(ex.points);
        ex.points.geometry.dispose();
    });
    explosions.length = 0;
    
    // Siivotaan uudempi, tehokkaampi räjähdysallas (Explosion Pool).
    if (window.explosionPool) {
        window.explosionPool.cleanup(); // Kutsutaan altaan omaa siivousmetodia.
        window.explosionPool = null;    // Poistetaan globaali viittaus.
    }

    // Siivotaan aktiiviset taisteluefektit ja nollataan niiden seurantatiedot.
    combatEffects.forEach(effect => effect.cleanup());
    combatEffects.clear();
    starsToCheck.clear();
    
    // Siivotaan taistelurenkaiden pääobjekti (InstancedMesh).
    if (COMBAT_RING_INSTANCE) {
        scene.remove(COMBAT_RING_INSTANCE);
        COMBAT_RING_INSTANCE.geometry.dispose();
        COMBAT_RING_INSTANCE.material.dispose();
        COMBAT_RING_INSTANCE = null;    // Asetetaan nulliksi, jotta se luodaan uudelleen initissä.
    }
    // Nollataan taistelurenkaiden seurantadata.
    combatRingData.count = 0;
    combatRingData.starIds = [];
    combatRingData.opacities = [];
    combatRingData.rotations = [];
    freeCombatRingSlots.clear();

    // --- Globaalin tilan ja animaatioiden nollaus ---
    // Pysäytetään ja poistetaan kaikki TWEEN-kirjaston mahdollisesti ajamat animaatiot (esim. kameran liike).
    if (window.TWEEN) {
        window.TWEEN.removeAll();
    }

    // Nollataan pelaajan valintoihin ja hiiren käyttöön liittyvät tilamuuttujat.
    selectedStar = null;
    hoveredStar = null;
    selectedShips.length = 0;
    if (selectionIndicatorMesh) {
        selectionIndicatorMesh.visible = false;
    }

    // --- Telakan instanssoitujen renkaiden siivous ---
    // Käydään läpi jokaisen telakkatason oma InstancedMesh-objekti.
    Object.values(SHIPYARD_RING_INSTANCES).forEach(mesh => {
        if (mesh) {
            scene.remove(mesh);
            mesh.geometry.dispose();    // Vapauta jaettu geometria.
            mesh.material.dispose();    // Vapauta jaettu materiaali.
            mesh.count = 0; // Nollaa näkyvien instanssien määrä.
            
            // Nollataan varmuuden vuoksi KAIKKI instanssipaikat asettamalla
            // niiden matriisi nollaskaalatuksi. Tämä takaa, ettei mitään
            // visuaalisia jäänteitä jää kummittelemaan.
            const dummy = new THREE.Object3D();
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            for (let i = 0; i < MAX_SHIPYARDS; i++) {
                mesh.setMatrixAt(i, dummy.matrix);
            }
            mesh.instanceMatrix.needsUpdate = true;
        }
    });

    // Nollataan myös telakan renkaiden JavaScript-puolen seurantadata.
    Object.keys(shipyardRingData).forEach(level => {
        shipyardRingData[level] = { 
            count: 0, 
            rotations: [], 
            speeds: [], 
            starIds: [] 
        };
    });

    // --- Taustaelementtien (sumut) siivous ---
    nebulaSprites.forEach(sprite => {
        scene.remove(sprite);
        if (sprite.material) sprite.material.dispose();
    });
    nebulaSprites.length = 0;


    // --- Lopullinen varmuussiivous (Catch-all) ---
    // Tämä on tärkeä turvaverkko. Se käy läpi KAIKKI sceneen mahdollisesti vielä
    // jääneet objektit ja poistaa ne, jotka on voitu unohtaa aiemmissa siivouksissa.
    const objectsToRemove = [];
    scene.traverse((child) => {
        // Kerätään listalle kaikki spritet, renkaat ja viivat, jotka ovat yleisimpiä
        // dynaamisesti luotuja objektityyppejä tässä pelissä.
        if (child instanceof THREE.Sprite || 
            child.geometry instanceof THREE.RingGeometry || 
            child instanceof THREE.Line) {
            objectsToRemove.push(child);
        }
    });
    // Käydään kerätty lista läpi ja suoritetaan perusteellinen siivous jokaiselle objektille.
    objectsToRemove.forEach(obj => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            // Vapautetaan myös materiaaliin mahdollisesti liittyvä tekstuuri.
            if (obj.material.map) obj.material.map.dispose();
            obj.material.dispose();
        }
    });

    // --- Vihje roskienkeruulle ---
    // Tämä on vapaaehtoinen, edistyneiden kehittäjien työkalu. Jos selain on
    // käynnistetty tietyillä lipuilla, tämä komento voi ehdottaa selaimen
    // JavaScript-moottorille, että nyt olisi hyvä hetki suorittaa
    // muistin roskienkeruu. Se ei takaa mitään, mutta voi auttaa.
    if (window.gc) {
        window.gc();
    }

}



/**
 * MITÄ: Suorittaa manuaalisen tai säännöllisin väliajoin ajettavan "siivouksen"
 * pelin aikana.
 * MIKSI: Toisin kuin `cleanupScene`, joka nollaa kaiken pelien välissä, tämä funktio
 * on suunniteltu korjaamaan mahdollisia epäjohdonmukaisuuksia ja poistamaan
 * vanhentuneita viittauksia kesken pelin. Se toimii eräänlaisena "talonmiehenä",
 * joka varmistaa, että pitkät pelisessiot eivät johda datarakenteiden
 * saastumiseen ja bugeihin.
 */
function performMemoryCleanup() {
    
    let cleaned = 0;    // Laskuri siivottujen kohteiden määrälle (debuggausta varten).
    
    // --- 1. Siivoa poistetut alukset sijainninseurannasta (`shipsByStarClient`) ---
    // Käydään läpi jokainen tähti, jolla on merkitty olevan aluksia.
    shipsByStarClient.forEach((ships, starId) => {
        // Luodaan uusi, tyhjä `Set` vain olemassa oleville aluksille.
        const validShips = new Set();

        // Käydään läpi kaikki tähdelle merkityt alukset.
        ships.forEach(shipMesh => {
            // TARKISTUS: Onko alus edelleen olemassa pääseurantakartassa (`shipsById`)?
            if (shipsById.has(shipMesh.userData.entityId)) {
                // Jos on, se on validi ja lisätään uuteen `Set`-rakenteeseen.
                validShips.add(shipMesh);
            } else {
                // Jos ei, se on "haamuviittaus" tuhoutuneeseen alukseen.
                cleaned++;
            }
        });
          // Korvataan vanha, mahdollisesti epäpuhdas `Set` uudella ja siivotulla.
        if (validShips.size === 0) {
            // Jos tähdellä ei ole enää yhtään validia alusta, poistetaan koko merkintä.
            shipsByStarClient.delete(starId);
        } else {
            shipsByStarClient.set(starId, validShips);
        }
    });
    
    // --- 2. Siivoa vanhat taisteluefektit (`combatEffects`) ---
    // Käydään läpi kaikki aktiiviset taisteluefektit.
    combatEffects.forEach((effect, starId) => {
        // Tarkistetaan, onko efektiin liittyvä tähti edelleen olemassa.
        const star = starsById.get(starId);
        if (!star) {
            // Jos tähteä ei ole, efekti on "orpo". Se täytyy siivota.
            effect.cleanup();    // Kutsutaan efektin omaa siivousfunktiota.
            combatEffects.delete(starId);   // Poistetaan se aktiivisten efektien kartasta.
            cleaned++;
        }
    });
    
    // --- 3. Siivoa turhat taistelutarkistuspyynnöt (`starsToCheck`) ---
    // Tämä varmistaa, ettei järjestelmä yritä turhaan tarkistaa tähtiä,
    // joita ei enää ole olemassa.
    const validStarsToCheck = new Set();
    starsToCheck.forEach(starId => {
        if (starsById.has(starId)) {
            validStarsToCheck.add(starId);  // Lisää vain validit ID:t.
        } else {
            cleaned++;
        }
    });

    // Nollataan ja rakennetaan tarkistuslista uudelleen vain valideista ID:istä.
    starsToCheck.clear();
    validStarsToCheck.forEach(id => starsToCheck.add(id));
}


/**
 * MITÄ: Korjaa ja siivoaa `shipsByStarClient`-seurantarakenteen epäjohdonmukaisuuksista.
 * MIKSI: Tämä on erikoistunut "talonmies"-funktio, joka varmistaa, että client-puolen
 * tietämys siitä, mitkä alukset ovat milläkin tähdellä, on täysin oikein. Se korjaa
 * kaksi mahdollista virhettä:
 * 1. "False Negatives": Tilanteen, jossa alus on tähdellä, mutta puuttuu seurantadatasta.
 * 2. "False Positives": Tilanteen, jossa seurantadata väittää aluksen olevan tähdellä,
 * vaikka se on jo siirtynyt pois tai tuhoutunut.
 * Lopuksi se pakottaa taistelutarkistuksen, jotta visuaaliset efektit päivittyvät
 * vastaamaan korjattua dataa.
 */
function cleanupCombatChecks() {
    // Laskurit debuggausta varten: kuinka monta virhettä korjattiin.
    let fixed = 0;
    let removed = 0;
    
    // --- VAIHE 1: Varmista, että kaikki kiertoradalla olevat alukset ovat seurannassa ---
    // Käydään läpi kaikki pelissä olemassa olevat alukset.
    shipsById.forEach(shipMesh => {
        const shipData = shipMesh.userData.shipData;
        if (!shipData) return;
        
        // Jos aluksen pitäisi olla paikallaan tähden ympärillä..
        if ((shipData.state === 'orbiting' || shipData.state === 'conquering') && shipData.parentStarId) {
            const starId = shipData.parentStarId;
            // ...varmistetaan, että tähdelle on olemassa seurantajoukko (Set).
            if (!shipsByStarClient.has(starId)) {
                shipsByStarClient.set(starId, new Set());
            }
            // ...ja tarkistetaan, että tämä alus on siinä mukana.
            const starShips = shipsByStarClient.get(starId);
            if (!starShips.has(shipMesh)) {
                // Jos ei ole, lisätään se takaisin. Tämä korjaa "false negative" -virheen.
                starShips.add(shipMesh);
                fixed++;
            }
        }
    });
    
    // --- VAIHE 2: Poista kaikki virheelliset ja vanhentuneet merkinnät seurannasta ---
    // Käydään läpi seurantadata tähti tähdeltä.
    shipsByStarClient.forEach((ships, starId) => {
        const validShips = new Set();
        // Käydään läpi kaikki tälle tähdelle merkityt alukset.
        ships.forEach(shipMesh => {
            // Tarkistetaan kaksi asiaa:
            // 1. Onko alus ylipäätään enää olemassa?
            if (shipsById.has(shipMesh.userData.entityId)) {
                const shipData = shipMesh.userData.shipData;
                // 2. Jos on, onko sen `parentStarId` todella tämä tähti?
                if (shipData && shipData.parentStarId?.toString() === starId) {
                    // Jos molemmat ehdot täyttyvät, alus on validi.
                    validShips.add(shipMesh);
                } else {
                    // Muuten se on virheellinen merkintä (esim. alus on jo siirtynyt).
                    removed++;
                }
            } else {
                // Alusta ei ole enää olemassa (tuhoutunut).
                removed++;
            }
        });
        // Korvataan vanha, mahdollisesti virheellinen lista uudella, täysin puhtaalla listalla.
        if (validShips.size === 0) {
            shipsByStarClient.delete(starId);
        } else {
            shipsByStarClient.set(starId, validShips);
        }
    });
    
    // --- VAIHE 3: Pakota taistelutilanteen uudelleentarkistus ---
    // Kun datarakenteet on korjattu, ajetaan taistelutarkistus välittömästi,
    // jotta visuaaliset tehosteet päivittyvät vastaamaan uutta, oikeaa tilannetta.
    triggerCombatCheck();
}



/* ========================================================================== */
/*  DEBUG- JA TESTAUSFUNKTIOITA                                               */
/* ========================================================================== */

/**
 * DEBUG-APUFUNKTIO: Tulostaa konsoliin yksityiskohtaisen raportin siitä,
 * mikä tähti käyttää kutakin telakan renkaiden instanssipaikkaa ("slottia").
 * Hyödyllinen "object pooling" -järjestelmän vianmäärityksessä.
 */
window.debugShipyardAllocation = function() {
     console.group('🏭 Shipyard Allocation Debug');
    
    ['level1', 'level2', 'level3', 'level4'].forEach(level => {
        const data = shipyardRingData[level];
         console.group(`${level}:`);
         console.log('Count:', data.count);
         console.log('Allocations:');
        
        for (let i = 0; i < Math.max(5, data.count); i++) {
            const starId = data.starIds[i];
            if (starId) {
                const star = starsById.get(starId);
                const starName = star?.userData?.starData?.name || 'Unknown';
                 console.log(`  [${i}]: ${starName} (${starId})`);
            } else {
                 console.log(`  [${i}]: <empty>`);
            }
        }
         console.groupEnd();
    });
    
     console.groupEnd();
};



/**
 * DEBUG-APUFUNKTIO: Tulostaa konsoliin kattavan yhteenvedon alusten tilasta.
 * Tarkistaa InstancedMesh-objektien, virtuaalisten alusten ja dataseurannan
 * tilan sekä suorittaa visuaalisen testin luomalla yhden punaisen testialuksen.
 */
window.debugShips = function() {
     console.group('🚢 Ship Debug Info');
    
    // 1. Tarkista InstancedMeshit
    Object.entries(SHIP_INSTANCED_MESHES).forEach(([type, mesh]) => {
         console.group(`${type} InstancedMesh:`);
          console.log('Count:', mesh.count);
          console.log('Visible:', mesh.visible);
          console.log('In scene:', scene.children.includes(mesh));
          console.log('Position:', mesh.position);
          console.log('Material visible:', mesh.material.visible);
          console.log('Material opacity:', mesh.material.opacity);
        
        // Tarkista ensimmäinen matriisi
        if (mesh.instanceMatrix && mesh.count > 0) {
            const mat = new THREE.Matrix4();
            mesh.getMatrixAt(0, mat);
            const pos = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            mat.decompose(pos, quat, scale);
              console.log('First instance position:', pos);
              console.log('First instance scale:', scale);
        }
        
        // Tarkista ensimmäinen väri
        if (mesh.instanceColor && mesh.count > 0) {
            const color = new THREE.Color();
            mesh.getColorAt(0, color);
            console.log('First instance color:', color);
        }
        
         console.groupEnd();
    });
    
     //2. Tarkista virtuaaliset alukset
      console.log('Virtual ships total:', shipsById.size);
    
    // 3. Tarkista instanceData
    Object.entries(shipInstanceData).forEach(([type, data]) => {
          console.log(`${type} instance data:`, {
            count: data.count,
            matrices: data.matrices.length,
            colors: data.colors.length,
            ids: data.ids.size
        });
    });

    // 4. Testaa luomalla yksi alus manuaalisesti
    console.group('Manual ship test:');
    const testMesh = SHIP_INSTANCED_MESHES['Fighter'];
    if (testMesh) {
        const dummy = new THREE.Object3D();
        dummy.position.set(0, 20, 0); // Kameran edessä
        dummy.scale.set(5, 5, 5); // Iso että näkyy varmasti
        dummy.updateMatrix();
        
        const testIndex = testMesh.count;
        testMesh.setMatrixAt(testIndex, dummy.matrix);
        testMesh.setColorAt(testIndex, new THREE.Color(0xff0000)); // Punainen
        testMesh.count = testIndex + 1;
        testMesh.instanceMatrix.needsUpdate = true;
        testMesh.instanceColor.needsUpdate = true;
        
          console.log('Created test ship at index:', testIndex);
          console.log('New count:', testMesh.count);
    }
     console.groupEnd();
    
     console.groupEnd();
};


/**
 * DEBUG-APUFUNKTIO: Tulostaa konsoliin yksityiskohtaisen raportin
 * telakan renkaiden InstancedMesh-järjestelmän ja dataseurannan tilasta.
 */
window.debugShipyardRings = function() {
     console.group('💍 Shipyard Rings Debug');
    
    Object.entries(SHIPYARD_RING_INSTANCES).forEach(([level, mesh]) => {
         console.group(`${level}:`);
         console.log('Count:', mesh.count);
         console.log('Visible:', mesh.visible);
         console.log('In scene:', scene.children.includes(mesh));
         console.log('Material:', mesh.material);
         console.log('Material visible:', mesh.material.visible);
         console.log('Material opacity:', mesh.material.opacity);
         console.log('Render order:', mesh.renderOrder);
        
        if (mesh.count > 0) {
            // Tarkista ensimmäinen instanssi
            const mat = new THREE.Matrix4();
            mesh.getMatrixAt(0, mat);
            const pos = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            mat.decompose(pos, quat, scale);
             console.log('First instance position:', pos);
             console.log('First instance scale:', scale);
        }
         console.groupEnd();
    });
    
     console.log('\nShipyard ring data:');
    Object.entries(shipyardRingData).forEach(([level, data]) => {
         console.log(`${level}: count=${data.count}`);
    });
    
     console.groupEnd();
};



/**
 * TESTIFUNKTIO: Luo manuaalisesti yhden ison, punaisen testirenkaan
 * näyttämällä yhden instanssin `level1`-telakkarenkaasta. Hyödyllinen
 * "smoke test", jolla voi nopeasti varmistaa, että renderöinti toimii.
 */
window.testShipyardRing = function() {
     console.log('🧪 Creating test ring...');
    
    const mesh = SHIPYARD_RING_INSTANCES.level1;
    if (!mesh) {
         console.error('No level1 mesh found!');
        return;
    }
    
    const dummy = new THREE.Object3D();
    dummy.position.set(0, 20, 0); // Kameran edessä
    dummy.scale.set(5, 5, 5); // Iso
    dummy.updateMatrix();
    
    const testIndex = mesh.count;
    mesh.setMatrixAt(testIndex, dummy.matrix);
    mesh.setColorAt(testIndex, new THREE.Color(0xff0000)); // Punainen
    mesh.count = testIndex + 1;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    
     console.log('✅ Created test ring at index:', testIndex);
     console.log('New count:', mesh.count);
     console.log('Mesh visible:', mesh.visible);
    
    // Force render
    if (renderer) renderer.render(scene, camera);
};


/**
 * MITÄ: Kerää laajan joukon suorituskyky- ja tilatietoja yhdeksi objektiksi.
 * MIKSI: Tämä on pääasiallinen tiedonlähde pelin sisäiselle F3-suorituskykymonitorille.
 * Se ei tulosta mitään konsoliin, vaan palauttaa objektin, jota muut
 * sovelluksen osat voivat käyttää.
 *
 * @returns {object} Objekti, joka sisältää FPS-tiedot, objektien määrät,
 * renderöintitiedot ja yhteenvedon mahdollisista suorituskykyongelmista.
 */
export function getSceneDebugInfo() {
    let totalTracked = 0;
    shipsByStarClient.forEach(ships => {
        totalTracked += ships.size;
    });
    
    let untrackedShips = 0;
    shipsById.forEach(virtualShip => {
        const shipData = virtualShip.userData.shipData;
        if (shipData && shipData.state === 'orbiting' && shipData.parentStarId) {
            let found = false;
            shipsByStarClient.forEach(ships => {
                if (ships.has(virtualShip)) found = true;
            });
            if (!found) untrackedShips++;
        }
    });
    
    // Kerää tiedot instanssoinnista.
    const instancingInfo = {};
    Object.entries(SHIP_INSTANCED_MESHES).forEach(([type, mesh]) => {
        instancingInfo[type] = {
            activeInstances: shipInstanceData[type].count,
            maxInstances: MAX_SHIPS_PER_TYPE,
            meshCount: mesh.count,
            visible: mesh.visible
        };
    });
    
    // Laske vanhan järjestelmän mukaiset, ei-instanssoidut alus-meshit.
    let actualMeshCount = 0;
    scene.traverse((child) => {
        if (child.type === 'Mesh' && !child.isInstancedMesh && 
            child.userData.type === 'ship') {
            actualMeshCount++;
        }
    });
    
    return {
        fps: fpsStats.fps,
        frameTime: fpsStats.frameTime ? fpsStats.frameTime.toFixed(1) : '0',
        totalShips: shipsById.size,
        actualMeshes: actualMeshCount,
        instancing: instancingInfo,
        renderer: {
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            geometries: renderer.info.memory.geometries
        },
        starsWithShips: shipsByStarClient.size,
        trackedShips: totalTracked,
        untrackedShips: untrackedShips,
        trackingAccuracy: shipsById.size > 0 ? ((totalTracked / shipsById.size) * 100).toFixed(1) : '100',
        combatEffects: combatEffects.size,
        explosions: explosions.length + (window.explosionPool?.active?.length || 0),
        starsToCheck: starsToCheck.size,
        performanceIssues: {
            tooManyCombatEffects: combatEffects.size > 10,
            tooManyStarsToCheck: starsToCheck.size > 30,
            poorTrackingAccuracy: totalTracked < shipsById.size * 0.95,
            nonInstancedShips: actualMeshCount > 0
        }
    };
}


// --- Globaalit debug-funktiot ---
// Asetetaan valitut apufunktiot globaalin `window`-objektin ominaisuuksiksi.
// Tämä tekee niistä suoraan kutsuttavia selaimen kehittäjäkonsolista,
// mikä on erittäin hyödyllistä pelin vianmäärityksessä ja testauksessa.
// Esimerkiksi kehittäjä voi nyt kirjoittaa konsoliin `performMemoryCleanup()` ja
// suorittaa siivouksen manuaalisesti.
window.getSceneDebugInfo = getSceneDebugInfo;
window.performMemoryCleanup = performMemoryCleanup;
window.cleanupCombatChecks = cleanupCombatChecks;




/**
 * MITÄ: Määräajoin ajettava "automaattinen siivooja".
 * MIKSI: Tämä `setInterval` käynnistää 10 sekunnin välein tarkistuksen, joka
 * monitoroi client-puolen datan eheyttä ja suorituskykyä. Jos se havaitsee
 * merkittäviä epäjohdonmukaisuuksia (esim. alusten seuranta on epäsynkassa) tai
 * liikaa raskaita efektejä, se kutsuu automaattisesti korjausfunktiota.
 * Tämä on tärkeä itsesäätelymekanismi pelin vakauden ylläpitämiseksi.
 */
setInterval(() => {
    // Tarkistetaan alusten sijainninseurannan (`tracking`) tarkkuus.
    let totalTracked = 0;
    shipsByStarClient.forEach(ships => {
        totalTracked += ships.size;
    });
    
    const accuracy = shipsById.size > 0 ? (totalTracked / shipsById.size) : 1;
    
    // Jos alle 90% aluksista on oikein seurannassa, ajetaan korjaus.
    if (accuracy < 0.9) {
        cleanupCombatChecks();
    }
    
    // Jos aktiivisia taisteluefektejä tai tarkistuspyyntöjä on liikaa,
    // ajetaan siivous, joka voi poistaa orvoiksi jääneitä pyyntöjä ja efektejä.
    if (combatEffects.size > 10 || starsToCheck.size > 50) {
        cleanupCombatChecks();
    }
}, 10000); // 10 sekuntia



/* ========================================================================== */
/* MODUULIN VIENNIT (EXPORTS)                                                */
/* ========================================================================== */
// Tämä lohko määrittelee, mitkä tämän tiedoston funktiot ja muuttujat ovat
// muiden JavaScript-tiedostojen (kuten client.js) käytettävissä `import`-
// komennolla. Tämä on moduulin julkinen "rajapinta" (API).

export {
    selectStar,
    deselectStar,
    focusOnStar,
    spawnExplosion,
    selectedStar,
    hoveredStar,
 };