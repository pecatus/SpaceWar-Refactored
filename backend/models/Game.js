// models/Game.js - Pelisession päädokumentin Mongoose-skeema
// =============================================================================
// TÄMÄ TIEDOSTO MÄÄRITTELEE `Game`-DOKUMENTIN RAKENTEEN MONGODB:SSÄ.
//
// ARKKITEHTUURINEN ROOLI:
// - **Juuriobjekti:** Jokainen `Game`-dokumentti edustaa yhtä yksittäistä pelisessiota
//   tai "huonetta". Se on kaiken keskipiste.
// - **Viittausten keskus:** Kaikki muut pelin osat - Player, Star, Ship - sisältävät
//   viittauksen (`gameId`) tähän dokumenttiin. Tämä sitoo kaiken datan yhteen.
// - **Kevyt metadata:** Skeema on tarkoituksella pidetty kevyenä. Se sisältää vain
//   pelin yleistason metatiedot (tila, asetukset, aikaleimat). Raskas, usein
//   muuttuva data (kuten tähtien tai alusten tarkat tilat) pidetään omissa
//   kokoelmissaan, mikä tekee tästä dokumentista nopean hakea ja käsitellä.
// =============================================================================

const mongoose = require('mongoose');

/**
 * @summary Aliskeema pelin muuttumattomille asetuksille.
 * @description MITÄ: Tämä määrittelee ne asetukset, jotka valitaan pelin alussa
 * (esim. tähtien määrä, tekoälyjen lukumäärä) ja jotka eivät muutu pelin aikana.
 * MIKSI: Upottamalla nämä omana aliskeemanaan, koodi pysyy selkeämpänä.
 * `{ _id: false }` -asetus on tärkeä; se estää Mongoosea luomasta turhia,
 * omia `_id`-kenttiä tälle asetuskokoelmalle, pitäen tietorakenteen siistinä.
 */
const GameSettingsSchema = new mongoose.Schema({
  starCount : { type: Number, required: true },     // Kartan tähtien kokonaismäärä.
  aiCount   : { type: Number, required: true },     // Tekoälyvastustajien määrä.
  mapSeed   : { type: Number, required: true },     // Satunnaislukugeneraattorin siemenluku, mahdollistaa saman kartan luomisen uudelleen.
  speed     : { type: Number, default: 1 },         // Pelin nopeuskerroin (esim. 1x, 2x).
  lobbyHost : { type: String, required: true },     // Pelin luoneen clientin tunniste.
  playerId  : { type: String, default: null }       // Pelaajan session ID, jolla tunnistetaan ihmispelaaja.
}, { _id: false });


/**
 * @summary Aliskeema kevyille pelin tilannekuville (snapshots).
 * @description MITÄ: Määrittelee rakenteen pelin tilan tallentamiselle tiettynä
 * ajan hetkenä.
 * MIKSI: (Tulevaisuuden laajennus) Tämä mahdollistaisi esimerkiksi pelin jatkamisen
 * myöhemmin näyttämällä aulassa listan vanhoista peleistä ilman, että koko
 * raskasta pelitilaa (kaikkia tähtiä ja aluksia) tarvitsee ladata.
 */
const SnapshotSchema = new mongoose.Schema({
  tick    : Number,                              // Pelin kierrosnumero (tick), jolloin tilannekuva otettiin.
  ts      : { type: Date, default: Date.now },   // Aikaleima.
  summary : mongoose.Schema.Types.Mixed          // Vapaamuotoinen objekti, joka voisi sisältää yhteenvedon, esim. { pelaajia: 2, tähtiä: 150 }.
}, { _id: false });


/**
 * @summary Pelisession pääskeema.
 */
const gameSchema = new mongoose.Schema({
  // --- Pelin elinkaaren tila ---
  status: {
    type   : String,
    enum   : ['lobby', 'playing', 'finished', 'aborted'],   // Sallitut tilat.
    default: 'lobby'                                        // Uusi peli on oletuksena 'lobby'-tilassa.
  },

  // --- Aikaleimat ja automaattinen siivous ---
  createdAt: {
    type   : Date,
    default: Date.now,
    // Määrittelee MongoDB:n TTL (Time-To-Live) -indeksin. Tämä komento poistaa
    // automaattisesti kaikki dokumentit, jotka ovat yli 24 tuntia vanhoja.
    // Erittäin tehokas tapa siivota vanhat, hylätyt pelit tietokannasta.
    expires: '24h'
  },

  startedAt   : Date,                       // Aikaleima, kun pelin ensimmäinen tick suoritettiin.
  finishedAt  : Date,                       // Aikaleima, kun peli päättyi (voittoon tai keskeytykseen).

  // --- Pelin sisäinen tila ---
  tick        : { type: Number, default: 0 },     // Nykyinen pelin kierrosnumero.
  phase       : { type: String, default: 'initialStartScreen' }, // Käytetään clientin UI-tilan synkronointiin.

  // --- Suhteet muihin dokumentteihin (Relationships) ---
  // Viittaukset tämän pelin Player-dokumentteihin.
  players : [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
  // Viittaus voittaneeseen Player-dokumenttiin.
  winner  : { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },

  // --- Staattiset asetukset ---
  // Upotetaan aiemmin määritelty GameSettingsSchema tähän.
  settings : { type: GameSettingsSchema, required: true, default : () => ({}) },

  // --- Kevyt historiadatankeruu (tulevaa käyttöä varten) ---
  snapshots      : [SnapshotSchema],
  lastSnapshotAt : { type: Date, default: Date.now },

  // --- Ylläpitoa varten ---
  // Viimeisin tallennusaika. Käytetään ajastetussa siivouksessa tunnistamaan
  // "jumiin jääneet" pelit, joita ei ole päivitetty pitkään aikaan.
  lastSavedAt    : { type: Date, default: Date.now }
});


/* --- INDEKSIT (INDEXES) --- */
// MITÄ: Luo yhdistelmäindeksin `status`- ja `createdAt`-kentille.
// MIKSI: Nopeuttaa merkittävästi kyselyjä, joissa haetaan esimerkiksi kaikkia
// aktiivisia (`status: 'playing'`) pelejä aikajärjestyksessä.
gameSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Game', gameSchema);

