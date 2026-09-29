const mongoose = require('mongoose');

const BOOKING_STATUS = Object.freeze({
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

// Terminal states cannot transition to anything else.
const TERMINAL_STATES = [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CANCELLED];

const bookingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    test: { type: mongoose.Schema.Types.ObjectId, ref: 'DiagnosticTest', required: true },
    centre: { type: mongoose.Schema.Types.ObjectId, ref: 'Centre', required: true },
    appointmentDate: { type: Date, required: true },
    // Snapshot of the test price at booking time, so later price changes at the
    // centre don't retroactively change what a user already booked at.
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.PENDING,
      index: true,
    },
  },
  { timestamps: true }
);

bookingSchema.statics.STATUS = BOOKING_STATUS;
bookingSchema.statics.TERMINAL_STATES = TERMINAL_STATES;

module.exports = mongoose.model('Booking', bookingSchema);
