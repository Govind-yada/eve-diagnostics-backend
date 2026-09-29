const mongoose = require('mongoose');

const centreSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    location: {
      address: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

centreSchema.index({ name: 1, 'location.city': 1 });

module.exports = mongoose.model('Centre', centreSchema);
