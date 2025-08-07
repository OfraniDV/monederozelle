const monitorAssist = require('../commands/monitor_assist');
const { showDayMenu, showMonthMenu } = monitorAssist;
const moment = require('moment');

function createCtx() {
  return {
    chat: { id: 1 },
    wizard: { state: { msgId: 1 } },
    telegram: { editMessageText: jest.fn().mockResolvedValue(true) },
    answerCbQuery: jest.fn().mockResolvedValue(),
  };
}

describe('showDayMenu', () => {
  test('bloquea días futuros', async () => {
    const ctx = createCtx();
    await showDayMenu(ctx);
    const extra = ctx.telegram.editMessageText.mock.calls[0][4];
    const markup = extra.reply_markup.inline_keyboard;
    const today = moment().date();
    const daysInMonth = moment().daysInMonth();
    if (today < daysInMonth) {
      const locked = markup.flat().filter((b) => b.callback_data === 'LOCKED');
      expect(locked.length).toBeGreaterThan(0);
    }
  });
});

describe('showMonthMenu', () => {
  test('bloquea meses futuros', async () => {
    const ctx = createCtx();
    await showMonthMenu(ctx);
    const extra = ctx.telegram.editMessageText.mock.calls[0][4];
    const markup = extra.reply_markup.inline_keyboard;
    const current = moment().month();
    if (current < 11) {
      const locked = markup.flat().filter((b) => b.callback_data === 'LOCKED');
      expect(locked.length).toBeGreaterThan(0);
    }
  });
});
