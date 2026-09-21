import {
  AgentRuntimeCoordinator,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "./agent/agent-runtime-coordinator.mjs";
import { AgentProviderError as AgentBridgeError } from "./agent/providers/agent-provider-contract.mjs";

export { parsePublicModels, resolveQoderAcpCommand } from "./agent/providers/qoder-provider.mjs";
export { AgentBridgeError, TRUSTED_LOCAL_AGENT_POLICY_VERSION };

// Routing façade. It owns no runtime facts and requires callers to provide the
// canonical selection explicitly for every Agent operation.
export class AgentBridgeService {
  #coordinator;

  constructor(options = {}) {
    if (typeof options.resolveTask !== "function") {
      throw new TypeError("AgentBridgeService requires a task authority resolver.");
    }
    this.#coordinator = options.coordinator || new AgentRuntimeCoordinator(options);
  }

  get runtimeCoordinator() { return this.#coordinator; }

  async providers() {
    const listed = typeof this.#coordinator.publicProviderCatalog === "function"
      ? await this.#coordinator.publicProviderCatalog({ environment: process.env })
      : this.#coordinator.providerCatalog();
    return Object.freeze({
      ok: true,
      providers: listed,
      trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    });
  }

  install(providerId) {
    const catalog = this.#coordinator.agentCatalog;
    if (!catalog || typeof catalog.install !== "function") {
      throw new AgentBridgeError(
        "AGENT_INSTALL_UNSUPPORTED",
        "This Agent cannot be installed from Stemmio.",
        { status: 409 },
      );
    }
    return catalog.install(providerId);
  }

  cancelInstall(providerId) {
    const catalog = this.#coordinator.agentCatalog;
    if (!catalog || typeof catalog.cancelInstall !== "function") {
      throw new AgentBridgeError(
        "AGENT_INSTALL_UNSUPPORTED",
        "This Agent cannot be installed from Stemmio.",
        { status: 409 },
      );
    }
    return catalog.cancelInstall(providerId);
  }

  login(providerId) {
    const listed = this.#coordinator.providerCatalog().find((item) => item.providerId === providerId);
    if (!listed || listed.capabilities?.login !== true) {
      throw new AgentBridgeError(
        "AGENT_LOGIN_UNSUPPORTED",
        "This Agent cannot start an official login.",
        { status: 409 },
      );
    }
    const catalog = this.#coordinator.agentCatalog;
    if (!catalog || typeof catalog.login !== "function") {
      throw new AgentBridgeError(
        "AGENT_LOGIN_UNSUPPORTED",
        "This Agent cannot start an official login.",
        { status: 409 },
      );
    }
    return catalog.login(providerId);
  }

  waitLogin(providerId) {
    const catalog = this.#coordinator.agentCatalog;
    if (!catalog || typeof catalog.waitLogin !== "function") {
      throw new AgentBridgeError(
        "AGENT_LOGIN_UNSUPPORTED",
        "This Agent cannot start an official login.",
        { status: 409 },
      );
    }
    return catalog.waitLogin(providerId);
  }

  cancelLogin(providerId) {
    const catalog = this.#coordinator.agentCatalog;
    if (!catalog || typeof catalog.cancelLogin !== "function") {
      throw new AgentBridgeError(
        "AGENT_LOGIN_UNSUPPORTED",
        "This Agent cannot start an official login.",
        { status: 409 },
      );
    }
    return catalog.cancelLogin(providerId);
  }

  loginUrl(providerId) {
    const catalog = this.#coordinator.agentCatalog;
    if (!catalog || typeof catalog.loginUrl !== "function") return null;
    return catalog.loginUrl(providerId);
  }

  accessOperation(providerId) {
    const catalog = this.#coordinator.agentCatalog;
    if (!catalog || typeof catalog.accessOperation !== "function") return null;
    return catalog.accessOperation(providerId);
  }

  logout(providerId) {
    const catalog = this.#coordinator.agentCatalog;
    if (!catalog || typeof catalog.logout !== "function") {
      throw new AgentBridgeError(
        "AGENT_LOGOUT_UNSUPPORTED",
        "This Agent cannot sign out from the official account.",
        { status: 409 },
      );
    }
    return catalog.logout(providerId);
  }

  assertSelection(selection, purpose) {
    return this.#coordinator.assertSelection(selection, purpose);
  }

  availability(input = {}) {
    return this.#coordinator.availability(input);
  }

  diagnose(input = {}) {
    return this.#coordinator.diagnose(input);
  }

  preflight(input) { return this.#coordinator.preflight(input); }

  redeemCommandTicket(preflightId, options) {
    return this.#coordinator.redeemCommandTicket(preflightId, options);
  }

  submit(input) { return this.#coordinator.submit(input); }

  status(input) { return this.#coordinator.executionStatus(input); }

  setSessionCredential(providerId, apiKey, extras) {
    return this.#coordinator.setSessionCredential(providerId, apiKey, extras);
  }

  updateAgentConfiguration(providerId, candidate) {
    return this.#coordinator.updateAgentConfiguration(providerId, candidate);
  }

  cancelAgentConfiguration(providerId, generation) {
    return this.#coordinator.cancelAgentConfiguration(providerId, generation);
  }

  clearSessionCredential(providerId) {
    return this.#coordinator.clearSessionCredential(providerId);
  }

  interrupted(input, options = {}) {
    return this.#coordinator.interrupted(input, options);
  }

  cancel(input) { return this.#coordinator.cancelExecution(input); }

  cancelDurable(input) { return this.#coordinator.cancelDurableExecution(input); }

  dispose() { return this.#coordinator.shutdown(); }
}
