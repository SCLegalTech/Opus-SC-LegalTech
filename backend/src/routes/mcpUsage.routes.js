// MCP usage routes — visibilidad de uso del servidor MCP local.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/mcpUsage.controller');

const myRouter = express.Router();
myRouter.use(authenticate);
myRouter.get('/usage',                     ctrl.myUsage);

module.exports = { myRouter };
