// models/Ship.js – Alus-dokumentin Mongoose-skeema
// =============================================================================
// TÄMÄ TIEDOSTO MÄÄRITTELEE YKSITTÄISEN `Ship`-DOKUMENTIN RAKENTEEN MONGODB:SSÄ.
//
// ARKKITEHTUURINEN ROOLI:
// - **Dynaaminen peliobjekti:** Jokainen `Ship`-dokumentti edustaa yhtä alusta
//   pelimaailmassa. Tämä on yksi useimmin päivittyvistä kokoelmista.
// - **Kevyt rakenne:** Skeema on jaettu kahteen osaan:
//   1. Pysyvä "blueprint"-data (`gameId`, `ownerId`, `type`), joka ei muutu.
//   2. Jatkuvasti muuttuva "runtime state" (`hp`, `state`, sijaintitiedot),
//      jota GameManager päivittää jokaisella pelitickillä.
// - **Tehokas haku:** Indeksit on asetettu kentille, joita käytetään usein
//   hakukriteereinä (esim. `gameId` ja `parentStarId`), mikä nopeuttaa
//   GameManagerin toimintaa.
// =============================================================================

const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

/* ------------------------------------------------------------------
 * Ship - kevyt dokumentti, joka päivittyy usein.
 *  • Pysyvä osuus: gameId, ownerId, type, maxHp
 *  • Dynaaminen osuus: hp, state, parentStarId, targetStarId, pos
 *    (päivitetään GameManagerin tick-loopissa)
 * ---------------------------------------------------------------- */
const shipSchema = new Schema(
  {
    /* ────────────────────────────────────────────────────────────
     * SUHTEET (RELATIONS)
     * ────────────────────────────────────────────────────────── */
    // Viittaus peliin, johon alus kuuluu.
    gameId : {
      type    : Types.ObjectId,
      ref     : 'Game',
      required: true,
      index   : true                // nopea haku peliin
    },
    // Viittaus aluksen omistavaan pelaajaan.
    ownerId: {
      type    : Types.ObjectId,
      ref     : 'Player',
      required: true,
      index   : true
    },


    /* ────────────────────────────────────────────────────────────
     * "BLUEPRINT" - PYSYVÄT OMINAISUUDET
     * ────────────────────────────────────────────────────────── */
    // Aluksen tyyppi, joka määrittelee sen roolin ja kyvyt.
    type: {
      type   : String,
      enum   : ['Fighter', 'Destroyer', 'Cruiser', 'Slipstream Frigate'],
      required: true
    },
    // Aluksen maksimaalinen kestopistemäärä.
    maxHp: { type: Number, required: true, min: 1 },


    /* ────────────────────────────────────────────────────────────
     * "RUNTIME STATE" - PELIN AIKANA MUUTTUVA TILA
     * ────────────────────────────────────────────────────────── */
    // Aluksen nykyinen kestopistemäärä.
    hp:   { type: Number, required: true, min: 0 },

    // Aluksen senhetkinen tila, joka ohjaa sen toimintaa GameManagerissa.
    state: {
      type : String,
      enum : ['orbiting',           // Kiertää tähteä, vapaana liikkumaan.
              'moving',             // Matkalla tähdestä toiseen.
              'conquering',         // Osallistuu planeetan valloitukseen.
              'destroyed'],         // Tuhoutunut, odottaa poistoa tietokannasta.
      default: 'orbiting',
      index: true
    },

    // Tähti, jota alus tällä hetkellä kiertää. Null, jos alus on liikkeellä.
    parentStarId: {
      type: Types.ObjectId,
      ref : 'Star',
      default: null,
      index: true
    },
    // Tähti, johon alus on matkalla. Null, jos alus on paikallaan.
    targetStarId: {
      type: Types.ObjectId,
      ref : 'Star',
      default: null,
      index: true
    },
    // Aluksen nykyinen liikkumisnopeus. Arvo päivitetään, kun liike alkaa.
    speed: {
        type: Number,
        default: 6  // Oletusarvo vastaa hidasta nopeutta: SHIP_SPEEDS.slow
    },
    // Tähti, josta alus lähti viimeksi liikkeelle.
    departureStarId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Star',
        default: null
    },
    // Laskuri, joka seuraa, kuinka monta tickiä alus on ollut liikkeellä.
    movementTicks: {
        type: Number,
        default: 0
    },
    // Laskettu matka-aika tickeinä määränpäähän.
    ticksToArrive: {               
       type: Number,
       default: 1,
       min: 1
   },

    /**
     * MITÄ: Aluksen tarkka 3D-sijainti pelimaailmassa.
     * MIKSI: (Valinnainen) Tätä ei välttämättä käytetä pelilogiikassa, mutta
     * se voidaan päivittää GameManagerin toimesta. Tämä mahdollistaisi
     * esimerkiksi "spectator"-näkymän tai tarkan debug-datan keräämisen
     * alusten liikkeistä.
     */
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      z: { type: Number, default: 0 }
    }
  },
  { timestamps: true }             // Lisää `createdAt` ja `updatedAt` -aikaleimat.
);

/* --- INDEKSIT --- */
// MITÄ: Luo yhdistelmäindeksejä yleisimpiä hakukyselyitä varten.
// MIKSI: Nopeuttaa merkittävästi hakuja, joissa etsitään esimerkiksi kaikkia
// tiettyä tähteä (`parentStarId`) kiertäviä aluksia tietyssä pelissä (`gameId`).
shipSchema.index({ gameId: 1, parentStarId: 1 });
shipSchema.index({ gameId: 1, targetStarId: 1 });

/* --- SERIALISOINTI --- */
// MITÄ: Määrittelee, miten dokumentti muunnetaan JSON-muotoon.
// MIKSI: Siistii API-vastauksia poistamalla Mongoose-spesifiset kentät.
shipSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => { ret.id = ret._id; delete ret._id; }
});

module.exports = mongoose.model('Ship', shipSchema);
