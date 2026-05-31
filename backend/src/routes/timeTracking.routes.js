/**
 * timeTracking.routes.js
 *
 * Global endpoints:
 *   GET    /api/time/running
 *   POST   /api/time/start
 *   POST   /api/time/stop
 *   POST   /api/time/stop/:id
 *   POST   /api/time/manual
 *   GET    /api/time/mine
 *   PATCH  /api/time/:id
 *   DELETE /api/time/:id
 *   GET    /api/time/rate
 *   POST   /api/time/rate
 *   GET    /api/time/reports/by-user
 *   GET    /api/time/reports/by-case
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/timeTracking.controller');

const router = express.Router();
router.use(authenticate);

router.get('/running',       ctrl.getRunning);
router.post('/start',        ctrl.start);
router.post('/stop',         ctrl.stop);
router.post('/stop/:id',     ctrl.stop);
router.post('/manual',       ctrl.createManual);
router.get('/mine',          ctrl.listMine);

router.get('/rate',          ctrl.getMyRate);
router.post('/rate',         ctrl.setMyRate);

router.get('/reports/by-user', ctrl.reportByUser);
router.get('/reports/by-case', ctrl.reportByCase);

router.get('/gamification/stats',       ctrl.getMyGamification);
router.get('/gamification/leaderboard', ctrl.getLeaderboard);
router.post('/gamification/opt-in',     ctrl.setLeaderboardOptIn);
router.get('/gamification/quests',      ctrl.getQuests);
router.get('/gamification/percentile',  ctrl.getPercentile);

router.patch('/:id',  ctrl.update);
router.delete('/:id', ctrl.deleteEntry);

module.exports = router;
