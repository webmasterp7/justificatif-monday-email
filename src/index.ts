import { GraphMailClient } from './clients/graph.js';
import { MistralReceiptClient } from './clients/mistral.js';
import { MondayClient } from './clients/monday.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { PollingRunner, ReceiptWorkflow } from './workflow.js';

const startupLogger = createLogger();

try {
  const config = loadConfig();
  const logger = createLogger('receipt-monday-email', config.logging.level);
  const graph = new GraphMailClient(config.microsoft);
  const mistral = new MistralReceiptClient(config.mistral);
  const monday = new MondayClient({
    ...config.monday,
    uploadRetryAttempts: config.workflow.uploadRetryAttempts,
    uploadRetryDelayMs: config.workflow.uploadRetryDelayMs,
  });
  const workflow = new ReceiptWorkflow(config, graph, mistral, monday, logger);
  const runner = new PollingRunner(workflow, config.polling.intervalMinutes * 60_000, logger);

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, stopping polling loop');
    runner.stop();
  });
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, stopping polling loop');
    runner.stop();
  });

  logger.info('Receipt-to-Monday service starting', {
    pollIntervalMinutes: config.polling.intervalMinutes,
    mailboxUserId: config.microsoft.mailboxUserId,
    mondayBoardId: config.monday.boardId,
  });
  runner.start();
} catch (error) {
  startupLogger.error('Receipt-to-Monday service failed to start', {
    errorReason: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
