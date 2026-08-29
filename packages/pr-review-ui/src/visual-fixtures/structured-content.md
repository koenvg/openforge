# Release checklist

> Keep the rollout reversible until production checks pass.

## Steps

1. Prepare the release branch.
   - Update the changelog.
   - Confirm dependency versions.
2. Deploy to the staging environment.
3. Promote the verified build.

## Verification

- [x] Unit tests pass
- [ ] Smoke test the packaged application
- [ ] Confirm rollback instructions

| Check | Owner | Status |
| :--- | :---: | ---: |
| API contract | Platform | Ready |
| Desktop smoke test | Client | Pending |

```ts
const release = {
  channel: 'stable',
  verified: true,
}
```

---

The release owner records the final result in `CHANGELOG.md`.
