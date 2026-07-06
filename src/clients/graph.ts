import { ClientSecretCredential } from '@azure/identity';
import type { AcceptedAttachment, EmailAttachment, EmailMessage } from '../types.js';

interface GraphMessageResponse {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  webLink?: string;
  hasAttachments?: boolean;
  body?: { content?: string; contentType?: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  sender?: { emailAddress?: { name?: string; address?: string } };
}

interface GraphAttachmentResponse {
  '@odata.type'?: string;
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
}

interface GraphCollection<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

export interface GraphMailConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailboxUserId: string;
}

export class GraphMailClient {
  private readonly credential: ClientSecretCredential;
  private readonly mailboxUserId: string;

  constructor(config: GraphMailConfig) {
    this.credential = new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret);
    this.mailboxUserId = config.mailboxUserId;
  }

  async getAccessToken(): Promise<string> {
    const token = await this.credential.getToken('https://graph.microsoft.com/.default');

    if (!token?.token) {
      throw new Error('Microsoft Graph token acquisition returned no token');
    }

    return token.token;
  }

  async resolveFolderId(folderNameOrId: string): Promise<string> {
    if (isLikelyFolderId(folderNameOrId) || isWellKnownFolderName(folderNameOrId)) {
      return folderNameOrId;
    }

    const folders = await this.graphGet<GraphCollection<{ id: string; displayName?: string }>>(
      `/users/${encodeURIComponent(this.mailboxUserId)}/mailFolders?$top=100&$select=id,displayName`,
    );

    const folder = folders.value.find(
      (candidate) => candidate.displayName?.toLowerCase() === folderNameOrId.toLowerCase(),
    );

    if (!folder) {
      throw new Error(`Microsoft Graph mail folder not found: ${folderNameOrId}`);
    }

    return folder.id;
  }

  async listMessages(folderId: string, top: number): Promise<EmailMessage[]> {
    const params = new URLSearchParams({
      '$top': String(top),
      '$orderby': 'receivedDateTime asc',
      '$select': 'id,subject,receivedDateTime,webLink,from,sender,body,hasAttachments',
    });

    const response = await this.graphGet<GraphCollection<GraphMessageResponse>>(
      `/users/${encodeURIComponent(this.mailboxUserId)}/mailFolders/${encodeURIComponent(folderId)}/messages?${params.toString()}`,
    );

    return response.value.map(toEmailMessage);
  }

  async listAttachments(messageId: string): Promise<EmailAttachment[]> {
    const response = await this.graphGet<GraphCollection<GraphAttachmentResponse>>(
      `/users/${encodeURIComponent(this.mailboxUserId)}/messages/${encodeURIComponent(messageId)}/attachments`,
    );

    return response.value.map(toEmailAttachment);
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<EmailAttachment> {
    const attachment = await this.graphGet<GraphAttachmentResponse>(
      `/users/${encodeURIComponent(this.mailboxUserId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );

    return toEmailAttachment(attachment);
  }

  async getAcceptedAttachment(messageId: string, attachmentId: string): Promise<AcceptedAttachment> {
    const attachment = await this.getAttachment(messageId, attachmentId);

    if (!attachment.contentBytes) {
      throw new Error(`Attachment ${attachment.name} did not include contentBytes`);
    }

    return { ...attachment, contentBytes: attachment.contentBytes };
  }

  async moveMessage(messageId: string, destinationId: string): Promise<EmailMessage> {
    const moved = await this.graphPost<GraphMessageResponse>(
      `/users/${encodeURIComponent(this.mailboxUserId)}/messages/${encodeURIComponent(messageId)}/move`,
      { destinationId },
    );

    return toEmailMessage(moved);
  }

  private async graphGet<T>(pathOrUrl: string): Promise<T> {
    return this.graphFetch<T>('GET', pathOrUrl);
  }

  private async graphPost<T>(path: string, body: unknown): Promise<T> {
    return this.graphFetch<T>('POST', path, body);
  }

  private async graphFetch<T>(method: string, pathOrUrl: string, body?: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Microsoft Graph ${method} ${url} failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<T>;
  }
}

export function toEmailMessage(message: GraphMessageResponse): EmailMessage {
  const sender = message.from?.emailAddress ?? message.sender?.emailAddress ?? {};
  const webLink = message.webLink?.trim();

  if (!webLink) {
    throw new Error(`Microsoft Graph message ${message.id} did not include webLink`);
  }

  return {
    id: message.id,
    subject: message.subject ?? '',
    receivedDateTime: message.receivedDateTime ?? new Date().toISOString(),
    webLink,
    hasAttachments: message.hasAttachments ?? false,
    bodyText: stripHtml(message.body?.content ?? ''),
    sender: {
      name: sender.name,
      email: sender.address ?? '',
    },
  };
}

function toEmailAttachment(attachment: GraphAttachmentResponse): EmailAttachment {
  return {
    id: attachment.id,
    name: attachment.name ?? attachment.id,
    contentType: attachment.contentType,
    size: attachment.size ?? 0,
    isInline: attachment.isInline ?? false,
    contentBytes: attachment.contentBytes,
  };
}

function stripHtml(content: string): string {
  return content
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isWellKnownFolderName(value: string): boolean {
  return ['inbox', 'archive', 'deleteditems', 'drafts', 'sentitems', 'junkemail'].includes(value.toLowerCase());
}

function isLikelyFolderId(value: string): boolean {
  return value.length > 40 || value.includes('=');
}
