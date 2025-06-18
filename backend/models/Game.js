// models/Game.js – authoritative game session document
// -----------------------------------------------------------------------------
//  The Game-document acts as the *root* for one match. All other collections
//  (Player, Star, Ship, etc.) reference its _id.  No heavyweight state is
//  embedded here – only light, high-level metadata so that the document stays
//  small and easy to query.
// -----------------------------------------------------------------------------

const mongoose = require('mongoose');

/*
 *  Immutable match settings written when the lobby starts a new game.
 *  Kept flat + _id:false so that updates to parent don’t spawn sub-IDs.
 */
const GameSettingsSchema = new mongoose.Schema({
  starCount : { type: Number, required: true },     // 75, 150, 250, 500 …
  aiCount   : { type: Number, required: true },     // 0-4
  mapSeed   : { type: Number, required: true },     // RNG seed → deterministic maps
  speed     : { type: Number, default: 1 },         // 1×, 2× … used for tick rate
  lobbyHost : { type: String, required: true }      // socket id / auth id of host
}, { _id: false });

/*
 *  Lightweight snapshots give a cheap way to implement game resumability
 *  without loading every Star/Ship document on lobby screen.
 *  Example: { tick: 1200, ts: Date, summary: { players: 2, stars: 150 } }
 */
const SnapshotSchema = new mongoose.Schema({
  tick    : Number,
  ts      : { type: Date, default: Date.now },
  summary : mongoose.Schema.Types.Mixed
}, { _id: false });

const gameSchema = new mongoose.Schema({
  status: {
    type   : String,
    enum   : ['lobby', 'playing', 'finished', 'aborted'],
    default: 'lobby'
  },

  createdAt: {
    type   : Date,
    default: Date.now,
    // 24-hour TTL cleans up orphaned matches & test runs automatically
    expires: '24h'
  },

  startedAt   : Date,                       // set when first tick executes
  finishedAt  : Date,                       // winner decided / aborted

  tick        : { type: Number, default: 0 },
  phase       : { type: String, default: 'initialStartScreen' }, // sync with client UI

  // --- relationships ----------------------------------------------------
  players : [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
  winner  : { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },

  // --- static lobby options --------------------------------------------
  settings : { type: GameSettingsSchema, required: true, default : () => ({}) },

  // --- lightweight history ---------------------------------------------
  snapshots      : [SnapshotSchema],
  lastSnapshotAt : { type: Date, default: Date.now },

  // --- housekeeping -----------------------------------------------------
  lastSavedAt    : { type: Date, default: Date.now }
});

/* Index for quick lobby listing */
gameSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Game', gameSchema);

