import type { EmailAttachment } from './types.js';

export interface AttachmentFilterConfig {
  acceptedMimeTypes: string[];
  acceptedExtensions: string[];
}

export interface AttachmentFilterResult {
  accepted: EmailAttachment[];
  unsupported: EmailAttachment[];
}

export function filterReceiptAttachments(
  attachments: EmailAttachment[],
  config: AttachmentFilterConfig,
): AttachmentFilterResult {
  const nonInline = attachments.filter((attachment) => !attachment.isInline);

  return {
    accepted: nonInline.filter((attachment) => isAcceptedAttachment(attachment, config)),
    unsupported: nonInline.filter((attachment) => !isAcceptedAttachment(attachment, config)),
  };
}

export function isAcceptedAttachment(attachment: EmailAttachment, config: AttachmentFilterConfig): boolean {
  const contentType = attachment.contentType?.toLowerCase();
  if (contentType && config.acceptedMimeTypes.includes(contentType)) {
    return true;
  }

  const name = attachment.name.toLowerCase();
  return config.acceptedExtensions.some((extension) => name.endsWith(extension));
}
