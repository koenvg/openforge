# Service compatibility

The rich preview keeps table spacing, borders, alignment, and inline Markdown readable.

## Availability matrix

| Service | Development | Staging | Production |
| :--- | :---: | :---: | ---: |
| Search API | **Ready** | **Ready** | `v2.4.0` |
| Background jobs | Ready | Degraded | `v2.3.8` |
| Audit export | Planned | Not available | Not available |

## Configuration reference

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `availability` | string | `open` | Includes confirmed and unknown availability while excluding waitlisted results. |
| `page_size` | integer | `25` | Limits each response to a predictable number of records. |
| `include_archived` | boolean | `false` | Includes archived records when explicitly enabled. |

## Rollout owners

| Area | Primary owner | Backup owner | Review channel |
| --- | --- | --- | --- |
| API contract | Platform | Developer Experience | `#api-review` |
| Desktop behavior | Client | Quality Engineering | `#desktop-review` |
