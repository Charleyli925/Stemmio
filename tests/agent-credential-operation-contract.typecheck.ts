import {
  interpretAgentCredentialOperation,
  type AgentCredentialClearRequest,
  type AgentCredentialOperationPort,
  type AgentCredentialOperationReceipt,
  type AgentCredentialOperationResult,
  type AgentCredentialOperationStatus,
} from "../app/application/agent-credential-operation-contract.js";

const productionShapedStub: AgentCredentialOperationResult =
  interpretAgentCredentialOperation({
    status: "saved",
    operationId: "credential-save-contract",
    recordId: "cred_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    remembered: true,
  }, {
    kind: "persist",
    expectedOperationId: "credential-save-contract",
  });

const failureUnion: readonly AgentCredentialOperationStatus[] = [
  "unreadable",
  "unavailable",
  "rejected",
  "unknown",
  "superseded",
  "missing",
  "saved",
];

void productionShapedStub;
void failureUnion;

const receipt: AgentCredentialOperationReceipt = {
  status: "unknown",
  operationId: "credential-contract-operation",
  code: "AGENT_CREDENTIAL_RESULT_UNKNOWN",
};

const workflowCredentialPort: AgentCredentialOperationPort & Readonly<{
  restore(): Promise<Readonly<Record<string, unknown>>>;
}> = {
  async persist(input) {
    return { status: "saved", operationId: input.operationId, recordId: "cred_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
  },
  async clear(input) {
    return { status: "missing", operationId: input.operationId };
  },
  async status(input) {
    return input.operationId
      ? { status: "unknown", operationId: input.operationId }
      : { status: "missing" };
  },
  async restore() {
    return { ok: true, restored: true };
  },
};

const desktopClear = async (input: AgentCredentialClearRequest): Promise<AgentCredentialOperationReceipt> => ({
  status: "missing",
  operationId: input.operationId,
});

void receipt;
void workflowCredentialPort;
void desktopClear;

// @ts-expect-error Clear always requires a payload carrying operation identity.
desktopClear();
// @ts-expect-error Clear cannot be issued without an operation ID.
desktopClear({ expectedRecordId: null });
// @ts-expect-error Workflow clear stubs share the same required operation identity.
workflowCredentialPort.clear({ expectedRecordId: null });

interpretAgentCredentialOperation({ status: "missing" }, {
  // @ts-expect-error The production interpreter accepts only known operation kinds.
  kind: "delete",
});
