const mongoose = require('mongoose');

const diagnosticTestSchema = new mongoose.Schema(
  {
    centre: { type: mongoose.Schema.Types.ObjectId, ref: 'Centre', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    price: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

diagnosticTestSchema.index({ centre: 1, name: 1 });

module.exports = mongoose.model('DiagnosticTest', diagnosticTestSchema);
