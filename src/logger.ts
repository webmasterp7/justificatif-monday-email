export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LoggingProfile = 'debug' | 'prod';

export interface LogContext {
  messageId?: string;
  subject?: string;
  sender?: string;
  routeDecision?: string;
  receiptGroupCount?: number;
  columnValuesPrepared?: string[];
  retryAttempt?: number;
  mondayItemIds?: string[];
  mondayUpdateIds?: string[];
  errorReason?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export function createLogger(service = 'receipt-monday-email', profile: LoggingProfile = 'debug'): Logger {
  return {
    debug: (message, context) => {
      if (profile === 'debug') {
        writeLog('debug', service, message, context);
      }
    },
    info: (message, context) => writeLog('info', service, message, context),
    warn: (message, context) => writeLog('warn', service, message, context),
    error: (message, context) => writeLog('error', service, message, context),
  };
}

function writeLog(level: LogLevel, service: string, message: string, context: LogContext = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    ...context,
  };

  const line = JSON.stringify(entry);

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}
