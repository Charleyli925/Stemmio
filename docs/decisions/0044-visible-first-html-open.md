# ADR 0044: HTML opening commits at display readiness

- Status: Accepted
- Date: 2026-08-27
- Scope: foreground opening and tab navigation; current-draft Canvas handoff is ADR 0077

## Decision

Opening HTML has three readiness levels:

1. **Display ready**: trusted source bytes and their exact Project, Document,
   OpenTarget and SHA-256 tuple have been synchronously published. The active
   tab begins its normal Canvas presentation from that authoritative tuple.
2. **Edit ready**: workspace identity, recovery state and the final Edit Canvas
   are verified. Editing, comments and persistence remain locked until this
   level.
3. **Context ready**: versions, comments, run state, rules, catalog and other
   secondary projections have hydrated.

The user-facing navigation transaction commits and releases its admission slot
at display ready. Edit and context readiness continue behind their existing
generation, identity, drain and close fences. A later readiness failure marks
the visible tab and offers recovery; it does not erase already trusted display
bytes or report that the user failed to open the page.

For a registered project, `ProjectFileRepository` resolves the Registry member,
recovers the active Working Copy locator and reads the source exactly once. The
Bridge returns one immutable open envelope containing:

```text
Project + Document + OpenTarget + exact source path + HTML + SHA-256 + mtime
```

Desktop validates the envelope and path identity and publishes it without a
second `/workspace` call or another filesystem read. Renderer hydration still
reads `/workspace`, but when that response matches the opening envelope it does
not call `/source` or hash the same HTML again. Any mismatch fails closed and
keeps the displayed document read-only.

The outgoing clean Canvas may reuse an already verified authority only when its
generation and rendered SHA-256 exactly match `DocumentSession`. Dirty,
unverified, failed or mismatched Canvas state still performs the full fence.

Edit runtime resource preparation must not produce a blank workspace. While the
disposable runtime candidate is being prepared, the current Edit Canvas remains
visible and its static fallback stays inside `HtmlCanvasEditor`; that fallback
has no SourceIndex, edit, comment, save or serialization authority.

## Non-goals

- This decision does not retain multiple mounted editable iframes.
- It does not cache HTML, SourceIndex or review analysis across document tabs.
- It does not relax write CAS, source-path safety, Registry identity, recovery,
  Candidate validation, promotion or close/quit gates.
- Review first-paint caching and post-accept document restoration remain
  separate from the current-draft Canvas handoff in ADR 0077.

## Required proof

- Registered opening performs one Repository source read and no redundant
  renderer `/source` read when the envelope matches `/workspace`.
- The next navigation can be admitted while the previous document is still
  hydrating after display ready.
- Background hydration or Canvas failure preserves the displayed tab, marks it
  as an error and keeps editing closed.
- A clean, exact verified Canvas does not execute a second render fence.
- During Edit runtime preparation the HTML remains visible and the
  in-editor static fallback cannot execute authored scripts.
