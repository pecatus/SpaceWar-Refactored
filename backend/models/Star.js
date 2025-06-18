const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

/* ──────────────────────────────────────────────────────────────────────────
 *  Ali-skeema: generic jonoelementti
 *  • type         – ’Mine’, ’Shipyard Lvl 2’, ’Fighter’ …
 *  • timeLeft     – sekunteina (tick-loop vähentää)
 *  • totalTime    – koko rakennusaika (UI-progresseille)
 *  • targetLevel  – (optional) uusi level, kun kyseessä on upgrade
 *  • id           – client-side uuid (helpottaa frontin diffiä)
 * ──────────────────────────────────────────────────────────────────────── */
const queueItemSchema = new Schema(
  {
    type      : { type: String, required: true },
    timeLeft  : { type: Number, required: true, min: 0 },
    totalTime : { type: Number, required: true, min: 1 },
    id        : { type: String, required: true },
    targetLevel: Number                       // esimerkiksi Shipyard Lvl 3
  },
  { _id: false }                              // ei erillistä Mongo-_id:tä
);

/* ──────────────────────────────────────────────────────────────────────────
 *  Star – pysyvä rakenne + “hidas” tilanmuutos
 *  (orbitingShips yms. kysellään Ship-kokoelmasta)
 * ──────────────────────────────────────────────────────────────────────── */
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
      default : null,
      index   : true
    },

    /* Yleistiedot ------------------------------------------------------- */
    name        : { type: String, required: true },
    isHomeworld : { type: Boolean, default: false },

    /* 3D-koordinaatit – helpottaa tehtäväjonoja / path-findingia -------- */
    position: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
      z: { type: Number, required: true }
    },

    /* Talous & infra ---------------------------------------------------- */
    infrastructureLevel: { type: Number, default: 1, min: 1, max: 6 },
    population        : { type: Number, default: 1, min: 0 },
    mines             : { type: Number, default: 0, min: 0 },

    /* Sotilaallinen infra ---------------------------------------------- */
    shipyardLevel : { type: Number, default: 0, min: 0, max: 4 },
    defenseLevel  : { type: Number, default: 0, min: 0 },
    defenseHP     : { type: Number, default: 0, min: 0 },

    /* Verkko – tähtilinjat --------------------------------------------- */
    connections: [{
      type: Types.ObjectId,         // viittaus _toiseen_ tähteen
      ref : 'Star'
    }],

    /* Valloitus / piiritys --------------------------------------------- */
    isBeingConqueredBy: {
      type: Types.ObjectId,
      ref : 'Player',
      default: null,
      index: true
    },
    conquestProgress: { type: Number, default: 0, min: 0, max: 100 },

    /* Rakennus- ja laivajonot ------------------------------------------ */
    planetaryQueue: [queueItemSchema],
    shipQueue     : [queueItemSchema],

    /* Kokonais-ETA kentät UI-progresseille (päivittää GameManager) ----- */
    planetaryQueueTotalTime: { type: Number, default: 0, min: 0 },
    shipQueueTotalTime     : { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }                        // createdAt, updatedAt
);

/* Yleiset haut – peli + omistaja, peli + tähti-id yhdistelmä jne. */
starSchema.index({ gameId: 1, ownerId: 1 });
starSchema.index({ gameId: 1, 'connections': 1 });

/* JSON-serialisointi: id → _id-kentästä, ei __v:tä */
starSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => { ret.id = ret._id; delete ret._id; }
});

module.exports = mongoose.model('Star', starSchema);
