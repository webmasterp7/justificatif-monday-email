# Graph Report - .  (2026-06-12)

## Corpus Check
- Corpus is ~30,192 words - fits in a single context window. You may not need a graph.

## Summary
- 528 nodes · 1144 edges · 24 communities (20 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Core Infrastructure|Core Infrastructure]]
- [[_COMMUNITY_Gmail Provider|Gmail Provider]]
- [[_COMMUNITY_IMAP Provider|IMAP Provider]]
- [[_COMMUNITY_Dependencies|Dependencies]]
- [[_COMMUNITY_Gmail AuthHelpers|Gmail Auth/Helpers]]
- [[_COMMUNITY_Outlook Auth|Outlook Auth]]
- [[_COMMUNITY_Credential Security|Credential Security]]
- [[_COMMUNITY_Provider Configuration|Provider Configuration]]
- [[_COMMUNITY_Deployment & Integration|Deployment & Integration]]
- [[_COMMUNITY_MCP Tools & Config|MCP Tools & Config]]
- [[_COMMUNITY_Configuration Files|Configuration Files]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Build Config|Build Config]]
- [[_COMMUNITY_HTTP Config|HTTP Config]]
- [[_COMMUNITY_Monday.com Integration|Monday.com Integration]]
- [[_COMMUNITY_Package Scripts|Package Scripts]]
- [[_COMMUNITY_IMAP Client|IMAP Client]]
- [[_COMMUNITY_MCP Commands|MCP Commands]]
- [[_COMMUNITY_Pi MCP Config|Pi MCP Config]]
- [[_COMMUNITY_Format Conversion|Format Conversion]]
- [[_COMMUNITY_Inline Images|Inline Images]]

## God Nodes (most connected - your core abstractions)
1. `AccountRecord` - 69 edges
2. `AccountStore` - 27 edges
3. `OutlookProvider` - 24 edges
4. `GmailProvider` - 22 edges
5. `ImapProvider` - 21 edges
6. `FolderInfo` - 19 edges
7. `EmailFull` - 15 edges
8. `SendInput` - 15 edges
9. `compilerOptions` - 15 edges
10. `compilerOptions` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Justificatif Monday Email` --depends_on--> `On-Email Handler`  [EXTRACTED]
  DOKPLOY.md → src/on-email.ts
- `Justificatif Monday Email` --depends_on--> `Webhook Delivery`  [EXTRACTED]
  DOKPLOY.md → hypermail-mcp/src/watcher/webhook.ts
- `Hypermail MCP` --references--> `Dokploy Deployment`  [EXTRACTED]
  hypermail-mcp/README.md → DOKPLOY.md
- `Hypermail MCP` --depends_on--> `MCP Server`  [EXTRACTED]
  hypermail-mcp/README.md → hypermail-mcp/src/server.ts
- `Hypermail MCP` --depends_on--> `Tool Registration`  [EXTRACTED]
  hypermail-mcp/README.md → hypermail-mcp/src/tools/index.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Provider Abstraction Layer** — email_provider_interface, outlook_provider, imap_provider, gmail_provider, provider_registry [EXTRACTED 0.95]
- **Email Watch Pipeline** — email_watch_system, watcher_manager, webhook_delivery, on_email_handler, monday_com_integration [INFERRED 0.85]
- **Credential Security Stack** — account_store, crypto_module, device_code_auth [EXTRACTED 0.90]
- **MCP Tool Suite** — tool_registration, browse_tools, compose_tools, account_tools, folder_tools, organize_tools [EXTRACTED 0.95]
- **Read/Write Ops Pattern** — gmail_read_ops, gmail_write_ops, imap_read_ops, imap_write_ops [INFERRED 0.85]

## Communities (24 total, 4 thin omitted)

### Community 0 - "Core Infrastructure"
Cohesion: 0.06
Nodes (67): buildRegistry(), BuildRegistryOptions, Registry, ProviderId, main(), parseArgs(), ParsedArgs, printHelp() (+59 more)

### Community 1 - "Gmail Provider"
Cohesion: 0.07
Nodes (13): GmailProvider, ImapProvider, clampLimit(), mapFolder(), OutlookProvider, AttachmentContent, CompleteAddAccountResult, FolderInfo (+5 more)

### Community 2 - "IMAP Provider"
Cohesion: 0.10
Nodes (40): extractTokens(), ImapClientFactory, ImapTokens, isImapTokens(), BodyNode, clampLimit(), decodeId(), encodeId() (+32 more)

### Community 3 - "Dependencies"
Cohesion: 0.04
Nodes (48): bin, hypermail-mcp, bugs, url, dependencies, @azure/msal-node, google-auth-library, googleapis (+40 more)

### Community 4 - "Gmail Auth/Helpers"
Cohesion: 0.11
Nodes (37): beginDeviceCode(), base64urlEncode(), buildRawMessage(), clampLimit(), findHeader(), GmailMessage, GmailMessageListEntry, GmailMessagePart (+29 more)

### Community 5 - "Outlook Auth"
Cohesion: 0.10
Nodes (21): acquireAccessToken(), awaitDeviceCodeReady(), beginDeviceCode(), buildPca(), DEFAULT_SCOPES, DeviceCodeBegin, isSerializedTokens(), makeConfig() (+13 more)

### Community 6 - "Credential Security"
Cohesion: 0.13
Nodes (19): Account Store, Crypto Module, Device Code Auth, EmailProvider Interface, acquireAccessToken(), awaitDeviceCodeReady(), buildOAuth2Client(), DEFAULT_SCOPES (+11 more)

### Community 7 - "Provider Configuration"
Cohesion: 0.13
Nodes (13): GmailProviderOptions, OutlookProviderOptions, AccountStore, OpenOptions, StoreFile, decrypt(), encrypt(), parseEnvKey() (+5 more)

### Community 8 - "Deployment & Integration"
Cohesion: 0.13
Nodes (14): Docker Deployment, Dokploy Deployment, Email Watch System, ParsedPayload, Justificatif Monday Email, Monday.com Integration, On-Email Handler, Persistent Storage (+6 more)

### Community 9 - "MCP Tools & Config"
Cohesion: 0.11
Nodes (20): Account Tools, Browse Tools, CLI Entry Point, Compose Tools, Folder Tools, HTML to Markdown, HTTP Transport, Hypermail Config JSON (+12 more)

### Community 10 - "Configuration Files"
Cohesion: 0.11
Nodes (17): dataDir, enabled, host, port, http, clientId, tenantId, providers (+9 more)

### Community 11 - "TypeScript Config"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+9 more)

### Community 12 - "Build Config"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+8 more)

### Community 13 - "HTTP Config"
Cohesion: 0.14
Nodes (13): dataDir, http, enabled, host, port, clientId, tenantId, providers (+5 more)

### Community 14 - "Monday.com Integration"
Cohesion: 0.21
Nodes (12): ColumnMapping, createItem(), EmailAddress, EmailFull, fetchBoardColumns(), getColumnMappings(), main(), MondayBoard (+4 more)

### Community 15 - "Package Scripts"
Cohesion: 0.17
Nodes (11): devDependencies, tsup, typescript, name, private, scripts, build, dev (+3 more)

### Community 17 - "MCP Commands"
Cohesion: 0.40
Nodes (4): MS_CLIENT_ID, MS_TENANT_ID, hypermail, node

## Knowledge Gaps
- **159 isolated node(s):** `enabled`, `pollIntervalSeconds`, `path`, `node`, `MS_CLIENT_ID` (+154 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AccountRecord` connect `Gmail Provider` to `Core Infrastructure`, `IMAP Provider`, `Gmail Auth/Helpers`, `Outlook Auth`, `Credential Security`, `Provider Configuration`, `Deployment & Integration`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Why does `Hypermail MCP` connect `Credential Security` to `Deployment & Integration`, `MCP Tools & Config`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `AccountStore` connect `Provider Configuration` to `Core Infrastructure`, `IMAP Provider`, `Gmail Auth/Helpers`, `Outlook Auth`, `Credential Security`, `Deployment & Integration`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **What connects `enabled`, `pollIntervalSeconds`, `path` to the rest of the system?**
  _160 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Core Infrastructure` be split into smaller, more focused modules?**
  _Cohesion score 0.058519793459552494 - nodes in this community are weakly interconnected._
- **Should `Gmail Provider` be split into smaller, more focused modules?**
  _Cohesion score 0.06927551560021153 - nodes in this community are weakly interconnected._
- **Should `IMAP Provider` be split into smaller, more focused modules?**
  _Cohesion score 0.1003921568627451 - nodes in this community are weakly interconnected._