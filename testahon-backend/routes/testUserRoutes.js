// routes/testUserRoutes.js
const express = require('express');
const { createTestUser } = require('../controllers/testUserController');
const recommendationController = require('../controllers/recommendationController');
const router = express.Router();

router.post('/createTestUser', createTestUser);
router.get('/ping', (req, res) => res.json({ ok: true, route: '/api/test-user/ping' }));

router.post('/getPreferenceProfile/:userId', recommendationController.recommendTrips);
router.get('/trip/:userId/owner', recommendationController.getTripOwner);
router.post('/trip/outputResult', recommendationController.outputResult)
module.exports = router;