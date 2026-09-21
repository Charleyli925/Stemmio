# ADR 0039: Provider-neutral Agent runtime boundary

- Status: Accepted
- Date: 2026-08-25

> 2026-08-26 amendment: Discussion was removed from the current product. The
> Discussion items below remain historical baseline only; provider capability,
> ticket, coordinator, Bridge and package surfaces are now execution-only.

## Context

ADR 0032 authorized one trusted-local Qoder ACP path without authorizing
Candidate adoption, a generic local-process escape hatch, or an OS-sandbox
claim. Its first implementation put Qoder installation discovery, package and
version rules, login/model preflight, error classification, ACP runtime launch
and Bridge coordination in the same service. That preserved the security
boundary, but made a second provider likely to duplicate dispatch and made the
Bridge itself the owner of provider-specific installation facts.

The refactor must preserve the shipped external contract before host/policy or
coordinator work proceeds. In particular, `qoder-acp`, the HTTP payloads, UI
projection, trusted-local consent, Request `agentDelivery`, Candidate-only
completion, cancellation order and preload boundary cannot change.

## Decision

Introduce two internal contracts and two fail-closed registries under
`scripts/agent/`:

- an Agent provider owns installation discovery and identity, package/version
  acceptance, use-time preflight, public model parsing, raw failure
  classification, safe copy, execution-policy loading and construction of one
  runtime launch descriptor;
- an Agent runtime owns execution of that already-verified descriptor and the
  provider-neutral ACP event envelope;
- `provider-registry.mjs` is the only provider dispatch point. The legacy
  driver `qoder-acp` maps there to `providerId: qoder` and `runtimeId: acp`;
- `runtime-registry.mjs` is the only runtime dispatch point. Unknown providers,
  runtimes and legacy drivers fail closed before a ticket is consumed or a
  process is started.

The Bridge coordinator owns the bounded purpose-bound one-use ticket store and
both session lifecycles. Each ticket binds `providerId`, `runtimeId`,
`securityProfile`, purpose, an opaque
installation, `installationDigest` and frozen capabilities as well as preflight
evidence. Redemption rechecks the installation and digest. None of those new
fields crosses the existing HTTP/session projection; renderer callers still
see `driver: qoder-acp` and the established safe fields only.

The Qoder provider retains the exact ADR 0032 installation and trust rules. The
ACP runtime owns the protocol state machine, detached process-group supervisor
and immutable standard event adapter. Qoder calls the provider-neutral runtime
and restricted execution host directly. Restricted execution hosts and
filesystem policy live in `bridge/agent/policies/` and `bridge/agent/hosts/`.
PR3 converges Run/Discussion coordination in `AgentRuntimeCoordinator`; the old
Service classes remain stateless compatibility façades.

The immediately following PR2 completed that planned extraction without
changing this decision: `bridge/agent/policies/` owns the one branded
execution policy family, and `bridge/agent/hosts/` owns the
permission-separated Host Ports. No provider-specific error or host adapter is
maintained around that shared contract.
The shared Host/Policy sources contain no provider or transport identifier.
They constrain requests mediated by the ACP Client Host; they do not constrain
native filesystem or command operations inside an Agent process.

## Compatibility and security

`qoder-acp` remains the current Qoder execution descriptor for the existing
renderer, Request records and Bridge routes. New provider/runtime identifiers
are Bridge-internal metadata, not a new renderer choice or persisted authority.
The registry cannot grant filesystem or task authority: provider policy still
derives from the runtime-sealed Request, the ACP host remains allowlisted, and
only the official finalizer plus Repository validation may publish a pending
review Candidate. Adoption remains explicit.

Provider installation objects may contain privileged local facts needed for
spawn, but they remain inside the Bridge ticket. Availability, preflight,
session status and Electron preload expose no executable, command, spawn or
path capability. Raw stderr remains live-process-only classification input and
never enters a public response.

The canonical provider/ticket/launch descriptor freezes one of
`client-mediated | agent-native`. Qoder is fixed to `client-mediated`.
`agent-native` reserves a future contract shape only; no such provider is
registered. It requires an independent sandbox conformance/security gate, and
a ticket/launch profile mismatch fails closed.

## Golden compatibility baseline

`tests/agent-provider-contract.test.mjs` owns registry dispatch, internal ticket
binding, unknown-component failure and unchanged legacy projections using a
synthetic provider with no user path or secret. The broader pre-refactor golden
is intentionally kept at its behavioral owners:

- `agent-bridge-service` and `agent-bridge-workspace`: disk availability,
  preflight/start, Qoder error classes, Candidate-only completion, unchanged
  Working Copy/Version and stop-before-durable-cancel;
- `run-workflow`: durable `agentDelivery: qoder-acp`, preflight-before-Request,
  Execution projection, no clipboard side effect and explicit adoption;
- `desktop-preload-ipc`: no Agent executable, spawn, command or path capability;
- `qoder-acp-spike-client`: the existing restricted host, completion and
  process-cleanup boundary.

The shared runtime contract supplements that golden baseline with neutral policy
and host assertions, a source-literal ownership gate, removed-purpose denial,
execution single-output/fixed-finalizer/completion proof, and
cancel-before-late-mutation coverage.

These tests use synthetic fixtures only. A real installed Qoder account remains
optional developer evidence and is not a deterministic gate.

## Consequences

The Bridge no longer contains Qoder search paths, npm/package identity, minimum
version, login/model probes or raw error normalization. A future provider can
implement the same provider contract and register one runtime without adding a
second dispatch branch to the Bridge. That future registration remains a
separate product/security decision; this ADR authorizes only the existing Qoder
mapping and produces zero external behavior change.
