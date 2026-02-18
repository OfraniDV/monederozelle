'use strict';

const { Markup } = require('telegraf');
const { buildBackExitRow, editIfChanged } = require('../../helpers/ui');

test('buildBackExitRow incluye GLOBAL_CANCEL por defecto', () => {
  const row = buildBackExitRow();
  expect(Array.isArray(row)).toBe(true);
  expect(row[1].callback_data).toBe('GLOBAL_CANCEL');
});

test('editIfChanged evita editar cuando no hay cambios', async () => {
  const markup = { inline_keyboard: [[Markup.button.callback('Test', 'CALL')]] };
  const ctx = {
    chat: { id: 1 },
    wizard: {
      state: {
        msgId: 42,
        lastRender: { text: 'hola', reply_markup: markup },
      },
    },
    telegram: {
      editMessageText: jest.fn().mockResolvedValue(true),
    },
  };

  const changed = await editIfChanged(ctx, 'hola', { reply_markup: markup });
  expect(changed).toBe(false);
  expect(ctx.telegram.editMessageText).not.toHaveBeenCalled();
});
