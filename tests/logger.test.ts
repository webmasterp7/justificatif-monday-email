import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('emits debug, info, warn, and error logs in debug mode', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const logger = createLogger('test', 'debug');

    logger.debug('debug message', { messageId: 'message-1' });
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
      level: 'debug',
      service: 'test',
      message: 'debug message',
      messageId: 'message-1',
    });
    expect(JSON.parse(log.mock.calls[1]?.[0] as string)).toMatchObject({ level: 'info', message: 'info message' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toMatchObject({ level: 'warn', message: 'warn message' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(error.mock.calls[0]?.[0] as string)).toMatchObject({ level: 'error', message: 'error message' });
  });

  it('suppresses debug logs in prod mode while keeping info, warn, and error logs', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const logger = createLogger('test', 'prod');

    logger.debug('poll message');
    logger.info('success message');
    logger.warn('warning message');
    logger.error('error message');

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
      level: 'info',
      message: 'success message',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
