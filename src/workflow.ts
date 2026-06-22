import { filterReceiptAttachments } from './attachments.js';
import type { AppConfig } from './config.js';
import type { GraphMailClient } from './clients/graph.js';
import type { MistralReceiptClient } from './clients/mistral.js';
import type { MondayClient } from './clients/monday.js';
import type { Logger } from './logger.js';
import {
  buildColumnValuesForReceipt,
  buildReviewUpdateBody,
  buildUpdateBody,
  toDateOnly,
} from './mondayPayload.js';
import type { AcceptedAttachment, ClassificationResult, EmailAttachment, EmailMessage, ReceiptGroup } from './types.js';

export class ReceiptWorkflow {
  constructor(
    private readonly config: AppConfig,
    private readonly graph: GraphMailClient,
    private readonly mistral: MistralReceiptClient,
    private readonly monday: MondayClient,
    private readonly logger: Logger,
  ) {}

  async runOnce(): Promise<void> {
    const inboxFolderId = await this.graph.resolveFolderId(this.config.microsoft.folders.inbox);
    const processedFolderId = await this.graph.resolveFolderId(this.config.microsoft.folders.processed);
    const reviewFolderId = await this.graph.resolveFolderId(this.config.microsoft.folders.review);
    const messages = await this.graph.listMessages(inboxFolderId, this.config.polling.maxMessagesPerPoll);

    this.logger.info('Mailbox poll returned messages', { count: messages.length });

    for (const message of messages) {
      await this.processMessage(message, { processedFolderId, reviewFolderId });
    }
  }

  async processMessage(
    message: EmailMessage,
    folders: { processedFolderId: string; reviewFolderId: string },
  ): Promise<void> {
    this.logger.info('Processing email message', messageLogContext(message));

    try {
      const attachments = await this.graph.listAttachments(message.id);
      const filterResult = filterReceiptAttachments(attachments, this.config.workflow);

      if (!message.hasAttachments || attachments.length === 0) {
        await this.routeToReview(message, attachments, 'Email has no attachments', folders.reviewFolderId);
        return;
      }

      if (filterResult.unsupported.length > 0) {
        await this.routeToReview(
          message,
          attachments,
          `Unsupported attachment format(s): ${filterResult.unsupported.map((attachment) => attachment.name).join(', ')}`,
          folders.reviewFolderId,
        );
        return;
      }

      if (filterResult.accepted.length === 0) {
        await this.routeToReview(message, attachments, 'Email has no supported receipt attachments', folders.reviewFolderId);
        return;
      }

      const acceptedAttachments = await Promise.all(
        filterResult.accepted.map((attachment) => this.graph.getAcceptedAttachment(message.id, attachment.id)),
      );
      const ocrDocuments = await Promise.all(
        acceptedAttachments.map((attachment) => this.mistral.ocrAttachment(attachment)),
      );
      const classification = await this.mistral.classifyReceipts({
        email: message,
        attachments: acceptedAttachments,
        ocrDocuments,
        confidenceThreshold: this.config.workflow.autoCreateConfidenceThreshold,
      });
      const reviewReason = getReviewReason(
        classification,
        acceptedAttachments,
        this.config.workflow.autoCreateConfidenceThreshold,
      );

      if (reviewReason) {
        await this.routeToReview(message, attachments, reviewReason, folders.reviewFolderId);
        return;
      }

      const createdSuccessfully = await this.createReceiptItems(
        message,
        classification.receiptGroups,
        acceptedAttachments,
        folders.reviewFolderId,
      );

      if (!createdSuccessfully) {
        return;
      }

      await this.graph.moveMessage(message.id, folders.processedFolderId);
      this.logger.info('Email processed successfully', {
        ...messageLogContext(message),
        routeDecision: 'processed',
        receiptGroupCount: classification.receiptGroups.length,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('Processing failed; routing email to review', {
        ...messageLogContext(message),
        routeDecision: 'review',
        errorReason: reason,
      });

      const attachments = await this.safeListAttachments(message.id);
      await this.routeToReview(message, attachments, reason, folders.reviewFolderId);
    }
  }

  private async createReceiptItems(
    message: EmailMessage,
    groups: ReceiptGroup[],
    attachments: AcceptedAttachment[],
    reviewFolderId: string,
  ): Promise<boolean> {
    const mondayItemIds: string[] = [];

    for (const group of groups) {
      const groupAttachments = attachments.filter((attachment) => group.attachmentIds.includes(attachment.id));
      const item = await this.monday.createItem({
        itemName: group.itemName,
        columnValues: buildColumnValuesForReceipt(message, group),
      });
      mondayItemIds.push(item.id);

      try {
        for (const attachment of groupAttachments) {
          await this.monday.uploadFile({
            itemId: item.id,
            fileName: attachment.name,
            contentType: attachment.contentType,
            bytes: Buffer.from(attachment.contentBytes, 'base64'),
          });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.monday.createUpdate({
          itemId: item.id,
          body: buildReviewUpdateBody({
            email: message,
            reason: `File upload failed after retries: ${reason}`,
            attachmentNames: groupAttachments.map((attachment) => attachment.name),
          }),
        });
        await this.routeToReview(message, attachments, `File upload failed after item creation: ${reason}`, reviewFolderId);
        return false;
      }

      const update = await this.monday.createUpdate({
        itemId: item.id,
        body: buildUpdateBody({
          email: message,
          group,
          attachmentNames: groupAttachments.map((attachment) => attachment.name),
        }),
      });

      this.logger.info('monday.com receipt item created', {
        ...messageLogContext(message),
        mondayItemIds: [item.id],
        mondayUpdateIds: [update.id],
        columnValuesPrepared: Object.keys(buildColumnValuesForReceipt(message, group)),
      });
    }

    this.logger.info('All receipt groups created', { ...messageLogContext(message), mondayItemIds });
    return true;
  }

  private async routeToReview(
    message: EmailMessage,
    attachments: EmailAttachment[],
    reason: string,
    reviewFolderId: string,
  ): Promise<void> {
    const item = await this.monday.createItem({
      itemName: `[REVUE] ${message.subject || message.id}`,
      columnValues: {
        dateReception: toDateOnly(message.receivedDateTime),
        notesParticulieres: `Revue requise: ${reason}\n\n${message.bodyText ?? ''}`.slice(0, 2000),
        soumisPar: message.sender.name || message.sender.email,
        typeDeFacture: 'Factures',
      },
    });

    const update = await this.monday.createUpdate({
      itemId: item.id,
      body: buildReviewUpdateBody({
        email: message,
        reason,
        attachmentNames: attachments.map((attachment) => attachment.name),
      }),
    });

    await this.graph.moveMessage(message.id, reviewFolderId);
    this.logger.warn('Email routed to review', {
      ...messageLogContext(message),
      routeDecision: 'review',
      errorReason: reason,
      mondayItemIds: [item.id],
      mondayUpdateIds: [update.id],
    });
  }

  private async safeListAttachments(messageId: string): Promise<EmailAttachment[]> {
    try {
      return await this.graph.listAttachments(messageId);
    } catch {
      return [];
    }
  }
}

export class PollingRunner {
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly workflow: ReceiptWorkflow,
    private readonly intervalMs: number,
    private readonly logger: Logger,
  ) {}

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Skipping poll because previous poll is still running');
      return;
    }

    this.running = true;
    try {
      await this.workflow.runOnce();
    } catch (error) {
      this.logger.error('Mailbox poll failed', {
        errorReason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running = false;
    }
  }
}

function getReviewReason(
  classification: ClassificationResult,
  attachments: AcceptedAttachment[],
  threshold: number,
): string | null {
  if (classification.decision === 'review') {
    return classification.reviewReason ?? 'Classifier requested review';
  }

  if (classification.confidence < threshold) {
    return `Overall classifier confidence ${classification.confidence} is below threshold ${threshold}`;
  }

  if (classification.receiptGroups.length === 0) {
    return 'Classifier did not return any receipt groups';
  }

  const attachmentIds = new Set(attachments.map((attachment) => attachment.id));
  const assignedIds = classification.receiptGroups.flatMap((group) => group.attachmentIds);
  const assignedSet = new Set(assignedIds);

  for (const group of classification.receiptGroups) {
    if (group.confidence < threshold) {
      return `Receipt group confidence ${group.confidence} is below threshold ${threshold}`;
    }

    for (const attachmentId of group.attachmentIds) {
      if (!attachmentIds.has(attachmentId)) {
        return `Classifier referenced unknown attachment ${attachmentId}`;
      }
    }
  }

  if (assignedIds.length !== assignedSet.size) {
    return 'Classifier assigned an attachment to more than one group';
  }

  if (assignedSet.size !== attachmentIds.size) {
    return 'Classifier did not assign every accepted attachment to a receipt group';
  }

  return null;
}

function messageLogContext(message: EmailMessage): {
  messageId: string;
  subject: string;
  sender: string;
} {
  return {
    messageId: message.id,
    subject: message.subject,
    sender: message.sender.name || message.sender.email,
  };
}
