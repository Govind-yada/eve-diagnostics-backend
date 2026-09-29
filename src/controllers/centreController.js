const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const cache = require('../utils/cache');
const Centre = require('../models/Centre');
const DiagnosticTest = require('../models/DiagnosticTest');

const CENTRE_CACHE_PREFIX = 'centres:';
const invalidateCentreCache = () => cache.delPrefix(CENTRE_CACHE_PREFIX);

// Sends a cached/loaded body and tells the client whether Redis served it.
function sendCached(res, { data, hit }) {
  res.set('X-Cache', hit ? 'HIT' : 'MISS');
  res.status(200).json(data);
}

const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

// POST /api/centres  (admin)
const createCentre = asyncHandler(async (req, res) => {
  const centre = await Centre.create(pick(req.body, ['name', 'location']));
  await invalidateCentreCache();
  res.status(201).json({ success: true, data: { centre } });
});

// GET /api/centres?page=1&limit=10&city=Pune   (cached)
const listCentres = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
  const filter = { isActive: true };
  let cityKey = '';
  if (req.query.city) {
    // Escape regex metacharacters so user input is matched literally (no regex injection / ReDoS).
    const city = String(req.query.city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter['location.city'] = new RegExp(`^${city}$`, 'i');
    cityKey = city.toLowerCase();
  }

  const result = await cache.cached(`${CENTRE_CACHE_PREFIX}list:${page}:${limit}:${cityKey}`, undefined, async () => {
    const [centres, total] = await Promise.all([
      Centre.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Centre.countDocuments(filter),
    ]);
    return {
      success: true,
      data: { centres },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  });
  sendCached(res, result);
});

// GET /api/centres/:id   (cached)
const getCentre = asyncHandler(async (req, res) => {
  const result = await cache.cached(`${CENTRE_CACHE_PREFIX}one:${req.params.id}`, undefined, async () => {
    const centre = await Centre.findById(req.params.id).lean();
    if (!centre) throw new ApiError(404, 'Centre not found');
    const tests = await DiagnosticTest.find({ centre: centre._id, isActive: true }).lean();
    return { success: true, data: { centre, tests } };
  });
  sendCached(res, result);
});

// PATCH /api/centres/:id  (admin) — whitelisted fields only
const updateCentre = asyncHandler(async (req, res) => {
  const update = pick(req.body, ['name', 'location', 'isActive']);
  const centre = await Centre.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
  if (!centre) throw new ApiError(404, 'Centre not found');
  await invalidateCentreCache();
  res.status(200).json({ success: true, data: { centre } });
});

// DELETE /api/centres/:id  (admin) — soft delete; existing bookings keep their references
const deleteCentre = asyncHandler(async (req, res) => {
  const centre = await Centre.findByIdAndUpdate(req.params.id, { $set: { isActive: false } }, { new: true });
  if (!centre) throw new ApiError(404, 'Centre not found');
  await DiagnosticTest.updateMany({ centre: centre._id }, { $set: { isActive: false } });
  await invalidateCentreCache();
  res.status(200).json({ success: true, message: 'Centre deactivated' });
});

// POST /api/centres/:centreId/tests  (admin)
const addTestToCentre = asyncHandler(async (req, res) => {
  const { centreId } = req.params;
  const centre = await Centre.findById(centreId);
  if (!centre) throw new ApiError(404, 'Centre not found');

  const test = await DiagnosticTest.create({ ...pick(req.body, ['name', 'description', 'price']), centre: centreId });
  await invalidateCentreCache();
  res.status(201).json({ success: true, data: { test } });
});

// GET /api/centres/:centreId/tests   (cached)
const listTestsForCentre = asyncHandler(async (req, res) => {
  const { centreId } = req.params;
  const result = await cache.cached(`${CENTRE_CACHE_PREFIX}tests:${centreId}`, undefined, async () => {
    const centre = await Centre.findById(centreId);
    if (!centre) throw new ApiError(404, 'Centre not found');
    const tests = await DiagnosticTest.find({ centre: centreId, isActive: true }).lean();
    return { success: true, data: { tests } };
  });
  sendCached(res, result);
});

// PATCH /api/centres/:centreId/tests/:testId  (admin)
// Price changes never touch existing bookings — they store an amount snapshot.
const updateTest = asyncHandler(async (req, res) => {
  const update = pick(req.body, ['name', 'description', 'price', 'isActive']);
  const test = await DiagnosticTest.findOneAndUpdate(
    { _id: req.params.testId, centre: req.params.centreId },
    { $set: update },
    { new: true, runValidators: true }
  );
  if (!test) throw new ApiError(404, 'Test not found for this centre');
  await invalidateCentreCache();
  res.status(200).json({ success: true, data: { test } });
});

// DELETE /api/centres/:centreId/tests/:testId  (admin) — soft delete
const deleteTest = asyncHandler(async (req, res) => {
  const test = await DiagnosticTest.findOneAndUpdate(
    { _id: req.params.testId, centre: req.params.centreId },
    { $set: { isActive: false } },
    { new: true }
  );
  if (!test) throw new ApiError(404, 'Test not found for this centre');
  await invalidateCentreCache();
  res.status(200).json({ success: true, message: 'Test deactivated' });
});

module.exports = {
  createCentre, listCentres, getCentre, updateCentre, deleteCentre,
  addTestToCentre, listTestsForCentre, updateTest, deleteTest,
};
