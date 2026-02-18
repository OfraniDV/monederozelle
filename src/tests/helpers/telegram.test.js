'use strict';

const { safeReply } = require('../../helpers/telegram');

test('safeReply degrada HTML cuando Telegram rechaza entidades', async () => {
  const reply = jest
    .fn()
    .mockRejectedValueOnce({ response: { description: "can't parse entities: Unsupported" } })
    .mockResolvedValueOnce({ message_id: 1 });
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  const ctx = { reply };

  const result = await safeReply(ctx, '<b>hola</b><foo>', { parse_mode: 'HTML' });

  expect(result).toEqual({ message_id: 1 });
  expect(reply).toHaveBeenCalledTimes(2);
  expect(reply.mock.calls[0][0]).toBe('<b>hola</b><foo>');
  expect(reply.mock.calls[0][1]).toEqual({ parse_mode: 'HTML' });
  const [fallbackText, fallbackExtra] = reply.mock.calls[1];
  expect(fallbackText).toBe('hola');
  expect(fallbackExtra).toEqual({});
  expect(warnSpy).toHaveBeenCalled();

  warnSpy.mockRestore();
});
