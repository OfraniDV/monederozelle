'use strict';

jest.mock('../../helpers/sessionSummary', () => ({
  flushOnExit: jest.fn().mockResolvedValue(),
  recordChange: jest.fn(),
}));

jest.mock('../../helpers/telegram', () => ({
  safeReply: jest.fn().mockResolvedValue({}),
  sanitizeAllowedHtml: jest.fn((text) => text),
}));

jest.mock('../../middlewares/fondoAdvisor', () => ({
  runFondo: jest.fn().mockResolvedValue(null),
}));

const mockEnterAssistMenu = jest.fn();
jest.mock('../../helpers/assistMenu', () => ({
  enterAssistMenu: mockEnterAssistMenu,
}));

const saldoWizard = require('../../commands/saldo');
const { flushOnExit } = require('../../helpers/sessionSummary');
const { safeReply } = require('../../helpers/telegram');
const { enterAssistMenu: enterAssistMenuMock } = require('../../helpers/assistMenu');
const { registerCancelHooks } = require('../../helpers/wizardCancel');
const { runFondo } = require('../../middlewares/fondoAdvisor');

function ctxFactory() {
  const ctx = {
    from: { id: 1 },
    chat: { id: 2, type: 'private' },
    callbackQuery: { data: 'GLOBAL_CANCEL' },
    answerCbQuery: jest.fn().mockResolvedValue(),
    scene: {
      current: { id: 'SALDO_WIZ' },
      leave: jest.fn().mockImplementation(async () => {
        ctx.scene.current = null;
        await saldoWizard.handleSaldoLeave(ctx);
      }),
    },
    wizard: { state: { data: {} } },
  };
  return ctx;
}

describe('saldo wizard cancelación global', () => {
  const steps = saldoWizard.steps.slice(1); // omit paso 0 que solo prepara datos

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(steps.map((fn, idx) => [idx + 1, fn]))('paso %d termina con GLOBAL_CANCEL', async (_, stepFn) => {
    const ctx = ctxFactory();
    registerCancelHooks(ctx, { afterLeave: enterAssistMenuMock, notify: false });

    await stepFn(ctx);

    expect(ctx.answerCbQuery).toHaveBeenCalled();
    expect(flushOnExit).toHaveBeenCalledWith(ctx);
    expect(ctx.scene.leave).toHaveBeenCalled();
    expect(ctx.wizard.state).toEqual({});
    expect(safeReply).not.toHaveBeenCalled();
    expect(runFondo).toHaveBeenCalledWith(ctx);
    expect(enterAssistMenuMock).toHaveBeenCalledWith(ctx);
  });
});
