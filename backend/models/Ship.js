const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

/* ------------------------------------------------------------------
 * Ship – kevyt dokumentti, joka päivittyy usein.
 *  • Pysyvä osuus: gameId, ownerId, type, maxHp
 *  • Dynaaminen osuus: hp, state, parentStarId, targetStarId, pos
 *    (päivitetään GameManagerin tick-loopissa)
 * ---------------------------------------------------------------- */
const shipSchema = new Schema(
  {
    /* ────────────────────────────────────────────────────────────
     *  RELATIONS
     * ────────────────────────────────────────────────────────── */
    gameId : {
      type    : Types.ObjectId,
      ref     : 'Game',
      required: true,
      index   : true                // nopea haku peliin
    },
    ownerId: {
      type    : Types.ObjectId,
      ref     : 'Player',
      required: true,
      index   : true
    },

    /* ────────────────────────────────────────────────────────────
     *  BLUEPRINT
     * ────────────────────────────────────────────────────────── */
    type: {
      type   : String,
      enum   : ['Fighter', 'Destroyer', 'Cruiser', 'Slipstream Frigate'],
      required: true
    },
    maxHp: { type: Number, required: true, min: 1 },

    /* ────────────────────────────────────────────────────────────
     *  RUNTIME STATE
     * ────────────────────────────────────────────────────────── */
    hp:   { type: Number, required: true, min: 0 },

    state: {
      type : String,
      enum : ['orbiting', 'moving', 'conquering', 'destroyed'],
      default: 'orbiting',
      index: true
    },

    parentStarId: {                // missä kiertoradalla (orbiting) tai mistä lähdettiin (moving)
      type: Types.ObjectId,
      ref : 'Star',
      default: null,
      index: true
    },
    targetStarId: {                // määränpää (moving / conquering)
      type: Types.ObjectId,
      ref : 'Star',
      default: null,
      index: true
    },

    speed: {
        type: Number,
        default: 6  // SHIP_SPEEDS.slow
    },
    
    departureStarId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Star',
        default: null
    },
    
    movementTicks: {
        type: Number,
        default: 0
    },

    ticksToArrive: {               // montako tikkiä on vielä matkaa
       type: Number,
       default: 1,
       min: 1
   },

    /* Opt. pelimoottori voi päivitellä 3D-koordinaatit
       → debug-telemetriaa tai spektator-klienttiä varten. */
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      z: { type: Number, default: 0 }
    }
  },
  { timestamps: true }             // createdAt & updatedAt
);

/* Uniikki indeksi ei ole tarpeen, mutta seuraavat hakut
   ovat yleisiä → yhdistelmä­indeksi: peli + tähti */
shipSchema.index({ gameId: 1, parentStarId: 1 });
shipSchema.index({ gameId: 1, targetStarId: 1 });

/* Serialisoinnissa pidetään virtualit (ei tarvetta tässä) ja siivotaan _id → id  */
shipSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => { ret.id = ret._id; delete ret._id; }
});

module.exports = mongoose.model('Ship', shipSchema);
