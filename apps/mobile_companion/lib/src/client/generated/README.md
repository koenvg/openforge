# Generated companion client boundary

Generated Dart models and ordinary HTTP API code from the versioned Companion
OpenAPI document belong in this directory. Generated files must not be edited by
hand.

The generated adapter will implement `CompanionClient` from the parent
directory. Application code must depend on that single abstraction rather than
importing generated types or SSE transport code directly.

The gateway contract and generation step are intentionally deferred: this
bootstrap does not implement pairing, networking, domain reads, or mutations.
