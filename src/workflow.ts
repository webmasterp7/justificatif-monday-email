import { filterReceiptAttachments } from './attachments.js';
import type { AppConfig } from './config.js';
import type { GraphMailClient } from './clients/graph.js';
import type { MistralReceiptClient } from './clients/mistral.js';
import type { MondayClient } from './clients/monday.js';
import type { Logger } from './logger.js';
import { applyInvoiceTypeEvidence } from './invoiceTypeEvidence.js';
import {
  buildAttentionUpdateBody,
  buildColumnValuesForReceipt,
  buildReviewUpdateBody,
  buildUpdateBody,
  toDateOnly,
  withEmailAutomationNote,
} from './mondayPayload.js';
import { retryTransientTimeout } from './transientRetry.js';
import type { AcceptedAttachment, EmailAttachment, EmailMessage, ReceiptGroup } from './types.js';
import {
  buildAttentionOnlyGroupsForBodyOnly,
  buildFallbackAttentionGroups,
  buildPreparedReceiptGroups,
  buildUnsupportedOnlyAttentionGroups,
  deriveGroupingAttentionReasons,
  filterUnsupportedReasons,
  type PreparedGroup,
} from './workflowPreparation.js';

const FINAL_UPDATE_RETRY_COUNT = 3;

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

    this.logger.debug('Mailbox poll returned messages', { count: messages.length });

    for (const message of messages) {
      await this.processMessage(message, { processedFolderId, reviewFolderId });
    }
  }

  async processMessage(
    message: EmailMessage,
    folders: { processedFolderId: string; reviewFolderId: string },
  ): Promise<void> {
    this.logger.debug('Processing email message', messageLogContext(message));

    try {
      const attachments = await this.graph.listAttachments(message.id);
      const filterResult = filterReceiptAttachments(attachments, this.config.workflow);

      const unsupportedReasons = filterUnsupportedReasons(filterResult.unsupported);
      const acceptedAttachments = filterResult.accepted;

      if (!message.hasAttachments || attachments.length === 0) {
        const preparedGroups = buildAttentionOnlyGroupsForBodyOnly(message.subject || message.id);
        await this.processPreparedGroups(message, preparedGroups, [], folders.processedFolderId, unsupportedReasons);
        return;
      }

      if (acceptedAttachments.length === 0) {
        const preparedGroups = buildUnsupportedOnlyAttentionGroups(message.subject || message.id, unsupportedReasons);
        await this.processPreparedGroups(message, preparedGroups, [], folders.processedFolderId, unsupportedReasons);
        return;
      }

      const accepted = await Promise.all(
        acceptedAttachments.map((attachment) => this.graph.getAcceptedAttachment(message.id, attachment.id)),
      );

      const ocrDocuments = await Promise.all(
        accepted.map((attachment) =>
          retryTransientTimeout({
            step: `Mistral OCR (${attachment.name})`,
            maxAttempts: this.config.workflow.uploadRetryAttempts,
            baseDelayMs: this.config.workflow.uploadRetryDelayMs,
            logger: this.logger,
            operation: () => this.mistral.ocrAttachment(attachment),
          }),
        ),
      );

      const classification = await retryTransientTimeout({
        step: 'Mistral classification',
        maxAttempts: this.config.workflow.uploadRetryAttempts,
        baseDelayMs: this.config.workflow.uploadRetryDelayMs,
        logger: this.logger,
        operation: () =>
          this.mistral.classifyReceipts({
            email: message,
            attachments: accepted,
            ocrDocuments,
            confidenceThreshold: this.config.workflow.autoCreateConfidenceThreshold,
          }),
      });

      if (classification.decision === 'review') {
        await this.routeToReview(
          message,
          attachments,
          classification.reviewReason ?? 'Classifier requested review',
          folders.reviewFolderId,
        );
        return;
      }

      const invoiceTypeEvidence = applyInvoiceTypeEvidence({
        email: message,
        ocrDocuments,
        groups: classification.receiptGroups,
      });

      if (invoiceTypeEvidence.reviewReason) {
        await this.routeToReview(message, attachments, invoiceTypeEvidence.reviewReason, folders.reviewFolderId);
        return;
      }

      const evidenceAdjustedClassification = {
        ...classification,
        receiptGroups: invoiceTypeEvidence.groups,
      };
      const groupingReasons = deriveGroupingAttentionReasons(evidenceAdjustedClassification, accepted, this.config.workflow.autoCreateConfidenceThreshold);
      const preparedGroups = buildPreparedReceiptGroups(evidenceAdjustedClassification, this.config.workflow.autoCreateConfidenceThreshold, {
        acceptedAttachments: accepted,
        unsupportedReasons,
        groupingReasons,
      });

      if (preparedGroups.length === 0) {
        const fallbackGroups = buildFallbackAttentionGroups(message.subject || message.id, unsupportedReasons);
        await this.processPreparedGroups(message, fallbackGroups, [], folders.processedFolderId, unsupportedReasons);
        return;
      }

      await this.processPreparedGroups(message, preparedGroups, accepted, folders.processedFolderId, unsupportedReasons);
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

  private async processPreparedGroups(
    message: EmailMessage,
    preparedGroups: PreparedGroup[],
    acceptedAttachments: AcceptedAttachment[],
    processedFolderId: string,
    reviewReasons: string[],
  ): Promise<void> {
    const createdItems = await this.createReceiptItems(message, preparedGroups, acceptedAttachments);

    const movedMessage = await this.graph.moveMessage(message.id, processedFolderId);

    const finalUpdateItemIds = await this.createFinalUpdatesForCreatedItems(
      message,
      movedMessage,
      createdItems,
      reviewReasons,
    );

    await this.promoteConfirmedItems(createdItems, finalUpdateItemIds, reviewReasons);

    this.logger.info('Email processed successfully', {
      ...messageLogContext(message),
      routeDecision: 'processed',
      receiptGroupCount: createdItems.length,
      mondayItemIds: createdItems.map((created) => created.itemId),
    });

    if (preparedGroups.some((group) => group.statut === 'Attention')) {
      this.logger.warn('Email processed with Attention items', {
        ...messageLogContext(message),
        routeDecision: 'processed',
        attentionGroups: preparedGroups.filter((group) => group.statut === 'Attention').length,
        attentionReasons: preparedGroups.flatMap((group) => group.attentionReasons),
      });
    }

    // In case this was called for mixed supported/unsupported items, include those reasons in logs.
    if (reviewReasons.length) {
      this.logger.info('Additional processing reasons', {
        ...messageLogContext(message),
        routeDecision: 'processed',
        reasons: reviewReasons,
      });
    }
  }

  private async createReceiptItems(
    message: EmailMessage,
    preparedGroups: PreparedGroup[],
    attachments: AcceptedAttachment[],
  ): Promise<CreatedItem[]> {
    const created: CreatedItem[] = [];

    for (const prepared of preparedGroups) {
      const item = await this.monday.createItem({
        itemName: prepared.group.itemName,
        columnValues: buildColumnValuesForReceipt(message, prepared.group, {
          statut: 'Attention',
          attentionReasons: prepared.attentionReasons,
        }),
      });

      const groupAttachments = attachments.filter((attachment) => prepared.group.attachmentIds.includes(attachment.id));

      if (groupAttachments.length > 0) {
        try {
          await this.uploadAttachmentsWithRetries(item.id, groupAttachments);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const updateReason = `Échec du chargement des fichiers après création de l’item: ${reason}`;
          await this.createUpdateWithRetry(
            item.id,
            buildReviewUpdateBody({
              email: message,
              reason: updateReason,
              attachmentNames: groupAttachments.map((attachment) => attachment.name),
            }),
          );
          throw new Error(updateReason, { cause: error });
        }
      }

      created.push({
        itemId: item.id,
        group: prepared.group,
        statut: prepared.statut,
        attentionReasons: prepared.attentionReasons,
      });
    }

    return created;
  }

  private async uploadAttachmentsWithRetries(itemId: string, attachments: AcceptedAttachment[]): Promise<void> {
    for (const attachment of attachments) {
      await this.monday.uploadFile({
        itemId,
        fileName: attachment.name,
        contentType: attachment.contentType,
        bytes: Buffer.from(attachment.contentBytes, 'base64'),
      });
    }
  }

  private async createFinalUpdatesForCreatedItems(
    originalEmail: EmailMessage,
    movedEmail: EmailMessage,
    createdItems: CreatedItem[],
    reviewReasons: string[],
  ): Promise<Set<string>> {
    const successfulUpdateItemIds = new Set<string>();

    for (const created of createdItems) {
      const updateBody = buildUpdateBody({
        email: movedEmail,
        group: created.group,
        emailThread: originalEmail.bodyText,
        movedMessageLink: movedEmail.webLink,
      });

      const summaryUpdateCreated = await this.createUpdateWithRetry(created.itemId, updateBody);
      if (!summaryUpdateCreated) {
        continue;
      }

      const attentionReasons = [...reviewReasons, ...created.attentionReasons].filter(Boolean);
      if (attentionReasons.length > 0) {
        const attentionUpdateCreated = await this.createUpdateWithRetry(
          created.itemId,
          buildAttentionUpdateBody(attentionReasons),
        );
        if (!attentionUpdateCreated) {
          continue;
        }
      }

      successfulUpdateItemIds.add(created.itemId);
    }

    return successfulUpdateItemIds;
  }

  private async promoteConfirmedItems(
    createdItems: CreatedItem[],
    finalUpdateItemIds: Set<string>,
    reviewReasons: string[],
  ): Promise<void> {
    for (const created of createdItems) {
      if (
        created.statut !== 'Nouveau' ||
        created.attentionReasons.length > 0 ||
        reviewReasons.length > 0 ||
        !finalUpdateItemIds.has(created.itemId)
      ) {
        continue;
      }

      try {
        await this.monday.updateItemStatus({ itemId: created.itemId, statut: 'Nouveau' });
      } catch (error) {
        this.logger.error('Unable to promote monday item status to Nouveau', {
          itemId: created.itemId,
          errorReason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async createUpdateWithRetry(itemId: string, body: string): Promise<boolean> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= FINAL_UPDATE_RETRY_COUNT; attempt += 1) {
      try {
        await this.monday.createUpdate({ itemId, body });
        return true;
      } catch (error) {
        lastError = error;
        if (attempt >= FINAL_UPDATE_RETRY_COUNT) {
          break;
        }

        this.logger.warn('Failed to create monday update; retrying', {
          itemId,
          retryAttempt: attempt,
          maxAttempts: FINAL_UPDATE_RETRY_COUNT,
          errorReason: error instanceof Error ? error.message : String(error),
        });
        await delay(this.config.workflow.uploadRetryDelayMs * attempt);
      }
    }

    this.logger.error('Unable to create monday update after retries', {
      itemId,
      maxAttempts: FINAL_UPDATE_RETRY_COUNT,
      errorReason: lastError instanceof Error ? lastError.message : String(lastError),
    });

    return false;
  }

  private async routeToReview(
    message: EmailMessage,
    attachments: EmailAttachment[],
    reason: string,
    reviewFolderId: string,
    attentionReasons: string[] = [],
  ): Promise<void> {
    const item = await this.monday.createItem({
      itemName: message.subject || message.id,
      columnValues: {
        dateReception: toDateOnly(message.receivedDateTime),
        notesParticulieres: withEmailAutomationNote([reason, ...attentionReasons]),
        soumisPar: message.sender.name || message.sender.email,
        typeDeFacture: 'Factures',
        statut: 'Attention',
        etatDeFacture: 'Facture Reçue',
      },
    });

    let movedMessage = message;
    try {
      movedMessage = await this.graph.moveMessage(message.id, reviewFolderId);
    } catch {
      this.logger.warn('Could not move message to review folder before update creation', {
        ...messageLogContext(message),
        routeDecision: 'review',
        mondayItemIds: [item.id],
      });
    }

    await this.createUpdateWithRetry(
      item.id,
      buildReviewUpdateBody({
        email: movedMessage,
        reason,
        attachmentNames: attachments.map((attachment) => attachment.name),
        emailThread: message.bodyText,
        attentionReasons,
        movedMessageLink: movedMessage.webLink,
      }),
    );

    this.logger.warn('Email routed to review', {
      ...messageLogContext(message),
      routeDecision: 'review',
      errorReason: reason,
      mondayItemIds: [item.id],
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

interface CreatedItem {
  itemId: string;
  group: ReceiptGroup;
  statut: 'Nouveau' | 'Attention';
  attentionReasons: string[];
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
