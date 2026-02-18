'use strict';

const { runFondo } = require('../middlewares/fondoAdvisor');

module.exports = async (ctx) => {
  await runFondo(ctx);
};
