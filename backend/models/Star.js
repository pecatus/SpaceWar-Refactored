// models/Star.js – Tähti-dokumentin Mongoose-skeema
// =============================================================================
// TÄMÄ TIEDOSTO MÄÄRITTELEE YKSITTÄISEN `Star`-DOKUMENTIN RAKENTEEN MONGODB:SSÄ.
//
// ARKKITEHTUURINEN ROOLI:
// - **Pelin perusyksikkö:** Tähdet ovat pelimaailman kiinteitä pisteitä, joita
//   pelaajat valloittavat ja kehittävät. Tämä on yksi pelin keskeisimmistä
//   ja useimmin päivitettävistä dokumenteista.
// - **Tilan säilytyspaikka:** Dokumentti sisältää kaiken tähteen liittyvän
//   pysyvän ja hitaasti muuttuvan datan, kuten sen sijainnin, omistajan,
//   infrastruktuurin tason ja rakennusjonot.
// - **Ei dynaamisia objekteja:** Tähden kiertoradalla olevia aluksia ei tallenneta
//   suoraan tähän dokumenttiin. Sen sijaan Ship-kokoelma viittaa tähän
//   tähteen `parentStarId`-kentän kautta.
// =============================================================================

const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

/**
 * @summary Aliskeema geneeriselle rakennusjonon elementille.
 * @description MITÄ: Tämä määrittelee tietorakenteen yhdelle työlle, joka voi olla
 * joko planetaarisessa tai alusten rakennusjonossa.
 * MIKSI: Luomalla erillisen, uudelleenkäytettävän aliskeeman, vältetään koodin
 * toistoa ja pidetään pääskeema (`starSchema`) siistimpänä. `{ _id: false }`
 * estää Mongoosea luomasta turhia ID:itä jokaiselle jonon alkiolle.
 */
const queueItemSchema = new Schema(
  {
    type      : { type: String, required: true },         // Työn tyyppi, esim. 'Mine', 'Shipyard Lvl 2', 'Fighter'.
    timeLeft  : { type: Number, required: true, min: 0 }, // Jäljellä oleva rakennusaika sekunteina. GameManager vähentää tätä.
    totalTime : { type: Number, required: true, min: 1 }, // Työn alkuperäinen kokonaisaika. Käytetään UI:n edistymispalkissa.
    id        : { type: String, required: true },         // Client-puolen generoima UUID. Helpottaa front-endin päivityksiä.
    targetLevel: Number                                   // Valinnainen; päivityksen kohdetaso, esim. 3, kun päivitetään telakkaa tasolle 3.
  },
  { _id: false }
);

/* ──────────────────────────────────────────────────────────────────────────
 *  Star - pysyvä rakenne + “hidas” tilanmuutos
 *  (orbitingShips yms. kysellään Ship-kokoelmasta)
 * ──────────────────────────────────────────────────────────────────────── */
/**
 * @summary Tähden pääskeema.
 */
const starSchema = new Schema(
  {
    /* Pääviittaukset ---------------------------------------------------- */
    gameId : {
      type    : Types.ObjectId,
      ref     : 'Game',
      required: true,
      index   : true
    },
    ownerId: {
      type    : Types.ObjectId,
      ref     : 'Player',
      default : null,         // `null` tarkoittaa, että tähti on neutraali.
      index   : true
    },


    /* ---------------- Yleistiedot ---------------- */
    name        : { type: String, required: true },
    isHomeworld : { type: Boolean, default: false },    // Onko tämä pelaajan aloitusplaneetta?


    /* ---------------- 3D-sijainti ---------------- */
    // Tähden absoluuttinen sijainti pelimaailmassa. Ei muutu pelin aikana.
    position: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
      z: { type: Number, required: true }
    },


    /* ---------------- Talous & infrastruktuuri ---------------- */
    infrastructureLevel: { type: Number, default: 1, min: 1, max: 6 },    // Määrittää rakennuslimiitit (max kaivokset, jne.).
    population        : { type: Number, default: 1, min: 0 },             // Tuottaa krediittejä.
    mines             : { type: Number, default: 0, min: 0 },             // Tuottaa mineraaleja.


    /* ---------------- Sotilaallinen infrastruktuuri ---------------- */
    shipyardLevel : { type: Number, default: 0, min: 0, max: 4 },         // Määrittää, mitä aluksia voi rakentaa.
    defenseLevel  : { type: Number, default: 0, min: 0 },                 // Planetaarisen puolustuksen (PD) taso.
    defenseHP     : { type: Number, default: 0, min: 0 },                 // Planetaarisen puolustuksen kestopisteet.


    /* ---------------- Verkko (Starlanet) ---------------- */
    // Taulukko, joka sisältää viittaukset toisiin Star-dokumentteihin,
    // joiden kanssa tällä tähdellä on suora starlane-yhteys.
    connections: [{
      type: Types.ObjectId,         // viittaus _toiseen_ tähteen
      ref : 'Star'
    }],


    /* ---------------- Valloitus / Piiritys ---------------- */
    // Jos tähti on valloituksen alla, tämä kenttä sisältää valloittajan Player-ID:n.
    isBeingConqueredBy: {
      type: Types.ObjectId,
      ref : 'Player',
      default: null,
      index: true
    },
    // Valloituksen edistyminen prosentteina (0-100)
    conquestProgress: { type: Number, default: 0, min: 0, max: 100 },


    /* ---------------- Rakennus- ja laivajonot ---------------- */
    // Taulukot, jotka käyttävät aiemmin määriteltyä `queueItemSchema`-rakennetta.
    planetaryQueue: [queueItemSchema],
    shipQueue     : [queueItemSchema],


    /* ---------------- UI-apukentät ---------------- */
    // Denormalisoitu data, jonka GameManager päivittää. Kertoo koko jonon
    // jäljellä olevan kokonaisajan, jotta UI voi näyttää sen helposti.
    planetaryQueueTotalTime: { type: Number, default: 0, min: 0 },
    shipQueueTotalTime     : { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }                        // Lisää `createdAt` ja `updatedAt` -aikaleimat.
);


/* ---------------- Indeksit ---------------- */
// Nopeuttaa hakuja, joissa etsitään tietyn pelaajan tähtiä tai
// tähtiä, joilla on tiettyjä yhteyksiä.
starSchema.index({ gameId: 1, ownerId: 1 });
starSchema.index({ gameId: 1, 'connections': 1 });


/* ---------------- Serialisointi ---------------- */
// Siistii JSON-muotoon muunnetun dokumentin.
starSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => { ret.id = ret._id; delete ret._id; }
});

module.exports = mongoose.model('Star', starSchema);
