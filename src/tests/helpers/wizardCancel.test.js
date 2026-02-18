'use strict';

jest.mock('../../helpers/sessionSummary', () => ({
  flushOnExit: jest.fn().mockResolvedValue(),
}));

jest.mock('../../helpers/telegram', () => ({
  safeReply: jest.fn().mockResolvedValue({}),
  sanitizeAllowedHtml: jest.fn((text) => `sanitized:${text}`),
}));

const { flushOnExit } = require('../../helpers/sessionSummary');
const { safeReply, sanitizeAllowedHtml } = require('../../helpers/telegram');
const {
  handleGlobalCancel,
  registerCancelHooks,
} = require('../../helpers/wizardCancel');

function baseCtx() {
  const ctx = {
    from: { id: 99 },
    chat: { id: 42, type: 'private' },
    callbackQuery: { data: 'GLOBAL_CANCEL' },
    answerCbQuery: jest.fn().mockResolvedValue(),
    scene: {
      current: { id: 'TEST_SCENE' },
      leave: jest.fn().mockImplementation(async () => {
        ctx.scene.current = null;
      }),
    },
    wizard: { state: { foo: 'bar' } },
  };
  return ctx;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('callback GLOBAL_CANCEL con escena activa limpia estado y responde', async () => {
  const beforeLeave = jest.fn();
  const afterLeave = jest.fn();
  const ctx = baseCtx();
  registerCancelHooks(ctx, { beforeLeave, afterLeave });

  await expect(handleGlobalCancel(ctx)).resolves.toBe(true);

  expect(ctx.answerCbQuery).toHaveBeenCalledTimes(1);
  expect(beforeLeave).toHaveBeenCalledWith(ctx);
  expect(flushOnExit).toHaveBeenCalledWith(ctx);
  expect(ctx.scene.leave).toHaveBeenCalledTimes(1);
  expect(ctx.wizard.state).toEqual({});
  expect(afterLeave).toHaveBeenCalledWith(ctx);
  expect(safeReply).toHaveBeenCalledTimes(1);
  const transform = safeReply.mock.calls[0][3].transformText;
  expect(typeof transform).toBe('function');
  expect(transform('❌ Operación cancelada.')).toBe('sanitized:❌ Operación cancelada.');
  expect(sanitizeAllowedHtml).toHaveBeenCalledWith('❌ Operación cancelada.');
});

test('callback EXIT usa la misma cancelación global', async () => {
  const ctx = baseCtx();
  ctx.callbackQuery = { data: 'EXIT' };

  await expect(handleGlobalCancel(ctx)).resolves.toBe(true);

  expect(ctx.answerCbQuery).toHaveBeenCalledTimes(1);
  expect(flushOnExit).toHaveBeenCalledWith(ctx);
  expect(ctx.scene.leave).toHaveBeenCalledTimes(1);
  expect(ctx.wizard.state).toEqual({});
});

test('comando /cancel sin escena activa responde de forma idempotente', async () => {
  const ctx = {
    from: { id: 10 },
    chat: { id: 11, type: 'group' },
    message: { text: '/cancel' },
    wizard: { state: { baz: 'qux' } },
    scene: { current: null, leave: jest.fn() },
  };

  await expect(handleGlobalCancel(ctx)).resolves.toBe(true);
  expect(flushOnExit).not.toHaveBeenCalled();
  expect(ctx.scene.leave).not.toHaveBeenCalled();
  expect(ctx.wizard.state).toEqual({});
  expect(safeReply).toHaveBeenCalledTimes(1);

  await expect(handleGlobalCancel(ctx)).resolves.toBe(true);
  expect(flushOnExit).not.toHaveBeenCalled();
  expect(safeReply).toHaveBeenCalledTimes(2);
});

test('idempotencia con callbacks consecutivos ejecuta flush solo una vez', async () => {
  const ctx = baseCtx();

  await handleGlobalCancel(ctx);
  await handleGlobalCancel(ctx);

  expect(flushOnExit).toHaveBeenCalledTimes(1);
  expect(ctx.scene.leave).toHaveBeenCalledTimes(1);
  expect(ctx.answerCbQuery).toHaveBeenCalledTimes(2);
  expect(safeReply).toHaveBeenCalledTimes(2);
});

test('notify false evita enviar mensaje de confirmación', async () => {
  const ctx = baseCtx();
  registerCancelHooks(ctx, { notify: false });

  await handleGlobalCancel(ctx);

  expect(safeReply).not.toHaveBeenCalled();
});
