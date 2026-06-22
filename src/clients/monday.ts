import { MONDAY_COLUMNS } from '../config.js';
import { buildMondayColumnValues } from '../mondayPayload.js';
import type { MondayFileUploadRequest, MondayItemRequest, MondayUpdateRequest } from '../types.js';

export interface MondayClientConfig {
  apiToken: string;
  apiVersion: string;
  boardId: string;
  groupId?: string;
  uploadRetryAttempts?: number;
  uploadRetryDelayMs?: number;
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface CreateItemResponse {
  create_item: { id: string; name: string };
}

interface CreateUpdateResponse {
  create_update: { id: string };
}

interface AddFileResponse {
  add_file_to_column: { id: string };
}

export class MondayClient {
  constructor(private readonly config: MondayClientConfig) {}

  async createItem(request: MondayItemRequest): Promise<{ id: string; name: string }> {
    const query = `
      mutation CreateReceiptItem($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON!) {
        create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) {
          id
          name
        }
      }
    `;

    const variables = {
      boardId: this.config.boardId,
      groupId: this.config.groupId,
      itemName: request.itemName,
      columnValues: JSON.stringify(buildMondayColumnValues(request.columnValues)),
    };

    const response = await this.graphql<CreateItemResponse>(query, variables);
    return response.create_item;
  }

  async createUpdate(request: MondayUpdateRequest): Promise<{ id: string }> {
    const query = `
      mutation CreateReceiptUpdate($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) {
          id
        }
      }
    `;

    const response = await this.graphql<CreateUpdateResponse>(query, {
      itemId: request.itemId,
      body: request.body,
    });

    return response.create_update;
  }

  async uploadFile(request: MondayFileUploadRequest): Promise<{ id: string }> {
    const attempts = this.config.uploadRetryAttempts ?? 3;
    const delayMs = this.config.uploadRetryDelayMs ?? 1000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.uploadFileOnce(request);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await delay(delayMs * attempt);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async uploadFileOnce(request: MondayFileUploadRequest): Promise<{ id: string }> {
    const query = `
      mutation AddReceiptFile($file: File!) {
        add_file_to_column(item_id: ${request.itemId}, column_id: "${MONDAY_COLUMNS.facture}", file: $file) {
          id
        }
      }
    `;

    const form = new FormData();
    const fileBytes = request.bytes.buffer.slice(
      request.bytes.byteOffset,
      request.bytes.byteOffset + request.bytes.byteLength,
    ) as ArrayBuffer;

    form.append('query', query);
    form.append('variables[file]', new Blob([fileBytes], { type: request.contentType ?? 'application/octet-stream' }), request.fileName);

    const response = await fetch('https://api.monday.com/v2/file', {
      method: 'POST',
      headers: {
        Authorization: this.config.apiToken,
        'API-version': this.config.apiVersion,
      },
      body: form,
    });

    const json = (await response.json()) as GraphQlResponse<AddFileResponse>;

    if (!response.ok || json.errors?.length || !json.data) {
      throw new Error(`monday.com file upload failed: ${response.status} ${formatErrors(json)}`);
    }

    return json.data.add_file_to_column;
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        Authorization: this.config.apiToken,
        'API-version': this.config.apiVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    const json = (await response.json()) as GraphQlResponse<T>;

    if (!response.ok || json.errors?.length || !json.data) {
      throw new Error(`monday.com GraphQL request failed: ${response.status} ${formatErrors(json)}`);
    }

    return json.data;
  }
}

function formatErrors(response: GraphQlResponse<unknown>): string {
  if (!response.errors?.length) {
    return 'No GraphQL data returned';
  }

  return response.errors.map((error) => error.message).join('; ');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
