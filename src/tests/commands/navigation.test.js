const extracto = require('../../commands/extracto_assist');
const { handleAction } = extracto;

function baseCtx() {
  return {
    chat: { id: 1 },
    wizard: { state: { msgId: 1, filters: {}, tarjetasAll: [] } },
    telegram: { editMessageText: jest.fn().mockResolvedValue(true) },
    answerCbQuery: jest.fn().mockResolvedValue(),
  };
}

test('BACK_TO_FILTER goes to previous filter', async () => {
  const ctx = baseCtx();
  ctx.wizard.state.route = 'BANCOS';
  ctx.callbackQuery = { data: 'BACK_TO_FILTER' };
  await handleAction(ctx);
  expect(ctx.wizard.state.route).toBe('MONEDAS');
});

test('GO_HOME returns to filter menu', async () => {
  const ctx = baseCtx();
  ctx.wizard.state.route = 'BANCOS';
  ctx.callbackQuery = { data: 'GO_HOME' };
  await handleAction(ctx);
  expect(ctx.wizard.state.route).toBe('FILTER');
});
