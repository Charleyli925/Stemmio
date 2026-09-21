export type AgentCredentialOperationStatus =
  | "unreadable"
  | "unavailable"
  | "rejected"
  | "unknown"
  | "superseded"
  | "missing"
  | "saved";

export type AgentCredentialOperationKind = "startup" | "persist" | "clear";

export type AgentCredentialOperationReceipt = Readonly<{
  status: AgentCredentialOperationStatus;
  providerId?: string;
  vendorId?: string | null;
  operationId?: string;
  recordId?: string | null;
  code?: string;
  reason?: string;
  remembered?: boolean;
  reconnectRequired?: boolean;
  unreadable?: boolean;
  available?: boolean;
  ok?: boolean;
}>;

export type AgentCredentialPersistRequest = Readonly<{
  operationId: string;
  apiKey: string;
  vendorId?: string | null;
  baseUrl?: string | null;
  modelId?: string | null;
}>;

export type AgentCredentialClearRequest = Readonly<{
  operationId: string;
  expectedRecordId?: string | null;
}>;

export type AgentCredentialStatusRequest = Readonly<{
  operationId?: string;
}>;

export type AgentCredentialOperationPort = Readonly<{
  persist(input: AgentCredentialPersistRequest): Promise<AgentCredentialOperationReceipt>;
  clear(input: AgentCredentialClearRequest): Promise<AgentCredentialOperationReceipt>;
  status(input: AgentCredentialStatusRequest): Promise<AgentCredentialOperationReceipt>;
}>;

export type AgentCredentialOperationResult = Readonly<{
  status: AgentCredentialOperationStatus;
  operationId: string | null;
  recordId: string | null;
  code: string | null;
  reason: string | null;
  terminal: boolean;
}>;

export type AgentCredentialOperationInput = unknown;

export function isAgentCredentialRecordId(value: unknown): value is string;

export function interpretAgentCredentialOperation(
  input: AgentCredentialOperationInput,
  options?: Readonly<{
    kind?: AgentCredentialOperationKind;
    expectedOperationId?: string | null;
  }>,
): AgentCredentialOperationResult;
