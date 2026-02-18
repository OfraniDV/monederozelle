const extracto = require('../../commands/extracto_assist');
const { showFilterMenu } = extracto;

function createCtx() {
  return {
    chat: { id: 1 },
    wizard: { state: { msgId: 1, filters: {} } },
    telegram: { editMessageText: jest.fn().mockResolvedValue(true) },
  };
}

test('filter menu lists five options with emojis', async () => {
  const ctx = createCtx();
  await showFilterMenu(ctx);
  const extra = ctx.telegram.editMessageText.mock.calls[0][4];
  const markup = extra.reply_markup.inline_keyboard;
  const options = markup.flat().filter((b) => b.callback_data?.startsWith('FIL_'));
  const labels = options.map((b) => b.text);
  expect(labels).toEqual([
    '📤 Agente',
    '💱 Moneda',
    '🏦 Banco',
    '💳 Tarjeta',
    '⏱ Periodo',
  ]);
});
