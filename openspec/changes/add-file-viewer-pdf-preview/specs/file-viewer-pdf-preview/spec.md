## Purpose

Let users inspect PDFs in project and task File Viewers with accessible page and zoom controls, bounded rendering, clear failure states, and predictable resource ownership.

## ADDED Requirements

### Requirement: Selected PDFs use the authorized document capability

The File Viewer SHALL request document bytes only for its visible selected PDF through the workspace's document-read capability. It SHALL preserve filename, MIME type, byte size, modification metadata when available, and the return-to-tree action. Other document types and unsupported hosts SHALL retain a metadata-only explanation. Diff Viewers and historical revisions are outside this capability.

#### Scenario: User selects a project PDF
- **WHEN** a supported project PDF is selected in the visible File Viewer
- **THEN** the viewer requests that project's authorized bytes and displays page 1 at fit width after loading

#### Scenario: User selects a task PDF
- **WHEN** a supported PDF is selected in a task File Viewer
- **THEN** the viewer requests the task workspace's bytes rather than the project checkout's bytes

#### Scenario: PDF is not visible or selected
- **WHEN** a directory contains PDFs that are not the visible selection
- **THEN** the viewer does not request their document bytes or start their renderers

### Requirement: Page navigation is explicit and keyboard accessible

The PDF viewer SHALL show one page at a time with Previous page, Next page, a labeled page-number input, and the total page count. It SHALL accept whole page numbers from 1 through the total, committed by Enter or blur. Invalid input SHALL leave the current page unchanged and show an accessible validation message. Navigation SHALL preserve control focus, disable endpoint actions, and never capture application-wide navigation shortcuts.

#### Scenario: User moves between pages
- **WHEN** a user activates Next or Previous within the available range
- **THEN** the viewer loads the requested page, removes the stale page while pending, preserves focus, and announces the new page and total when ready

#### Scenario: User reaches an endpoint
- **WHEN** the current page is the first or last page
- **THEN** Previous or Next respectively is disabled, and a one-page document disables both

#### Scenario: User enters an invalid page
- **WHEN** the page input is empty, fractional, nonnumeric, or outside the available range and is committed
- **THEN** the current page remains unchanged and the user receives a validation message while retaining a way to correct the input

### Requirement: Zoom is bounded and responsive

The PDF viewer SHALL provide Zoom in, Zoom out, an accessible percentage control, and Fit width. Percentage zoom SHALL accept whole percentages from 25% through 400%; buttons SHALL change zoom by 25 percentage points without leaving that range. Fit width SHALL recompute on pane resize within that range. Manual zoom SHALL survive resize until Fit width is selected. Toolbar controls SHALL wrap and remain reachable at a 320 CSS-pixel pane width and 200% application zoom.

#### Scenario: User changes percentage zoom
- **WHEN** the user changes zoom within the permitted range
- **THEN** the current page and accessible text are rescaled together without rereading document bytes or stealing keyboard focus

#### Scenario: User reaches a zoom bound
- **WHEN** zoom is 25% or 400%
- **THEN** the corresponding decrement or increment cannot move outside the range, and invalid manual values leave zoom unchanged with an accessible validation message

#### Scenario: Pane width changes
- **WHEN** the pane is resized in Fit width mode
- **THEN** the page refits within zoom limits and controls remain visible, with page scrolling available when even the minimum zoom cannot fit

### Requirement: PDF content has a non-canvas accessibility representation

The viewer SHALL provide selectable text and expose available tagged-document reading structure. Untagged documents SHALL expose extracted text with a reading-order limitation notice. Pages without extractable text SHALL provide a visible and announced missing-text notice rather than pretending that an image-only canvas is accessible text. Every control SHALL have an accessible name and visible focus. Return-to-tree SHALL remain usable in loading, ready, unavailable, and error states.

#### Scenario: Tagged PDF is rendered
- **WHEN** a tagged PDF page contains text and reading structure
- **THEN** assistive technology can reach that text and structure without duplicate canvas announcements, and selection tracks the rendered text at every supported zoom

#### Scenario: Untagged PDF is rendered
- **WHEN** text can be extracted but no reading structure is available
- **THEN** the viewer exposes the text and explains the reading-order limitation

#### Scenario: Scanned PDF has no text
- **WHEN** a rendered page has no extractable text
- **THEN** its image remains viewable and a visible and announced notice explains that text content is unavailable

#### Scenario: User navigates with the keyboard
- **WHEN** a keyboard user tabs through the preview at a constrained pane size
- **THEN** all enabled controls and the return-to-tree action are reachable in reading order without a focus trap or obscured focus

### Requirement: Loading and failures remain understandable and recoverable

The viewer SHALL distinguish reading bytes, parsing the PDF, and rendering a page with visible status and polite announcements. It SHALL NOT report successful rendering merely because metadata loaded or fabricate percentage progress. Read, parse, worker, timeout, and page errors SHALL retain metadata and a manual Retry. Unsupported hosts or formats, PDFs above 16 MiB or 2,000 pages, and password-required PDFs SHALL show specific unavailable explanations. It SHALL NOT ask for or store passwords or retry automatically.

#### Scenario: Document is still parsing
- **WHEN** PDF metadata and bytes are available but parsing is incomplete
- **THEN** the viewer reports document loading, not successful rendering, and disables controls that require a page count

#### Scenario: Read or rendering fails
- **WHEN** a file read, worker startup, parse, or page render fails
- **THEN** the viewer keeps filename and available metadata visible, explains the failure, and offers Retry and return-to-tree actions

#### Scenario: PDF exceeds a policy limit
- **WHEN** the document exceeds the byte limit or the reported page count exceeds 2,000
- **THEN** the viewer shows the applicable limit and does not attempt to render the document

#### Scenario: PDF requires a password
- **WHEN** parsing indicates that a password is required
- **THEN** the viewer shows a password-protected-document explanation, requests no password, and releases pending rendering resources

#### Scenario: User retries after a failure
- **WHEN** the user activates Retry
- **THEN** the viewer releases the failed preview and starts a fresh authorized read at page 1 and fit width

### Requirement: PDF processing cannot activate document-supplied actions

The viewer SHALL use locally packaged rendering resources and a real worker, without external resource downloads or a UI-thread parsing fallback. It SHALL NOT execute PDF scripts, XFA, interactive forms, link actions, embedded attachments, or document-supplied navigation and downloads. It SHALL NOT grant document content direct filesystem URLs or additional network authority. Renderer trust rules SHALL continue rejecting untrusted origins and unsafe script evaluation.

#### Scenario: PDF contains active or external content
- **WHEN** a PDF contains scripts, remote references, links, forms, or attachment actions
- **THEN** previewing it triggers no document-directed network request, script execution, navigation, external open, or download

#### Scenario: Packaged plugin runs offline
- **WHEN** the installed File Viewer renders a multilingual PDF without network access
- **THEN** its matching worker, fonts, and character resources load locally under the production renderer policy

#### Scenario: Worker cannot start
- **WHEN** the real rendering worker is unavailable or blocked
- **THEN** the viewer shows a recoverable error instead of silently parsing on the UI thread or weakening the trust policy

### Requirement: Rendering and ownership are bounded

Each active viewer SHALL retain at most one document and one active page render, without thumbnail or adjacent-page prefetch. It SHALL limit a page canvas to 16,777,216 physical pixels and 8,192 pixels per dimension and limit decoded embedded images to 16,777,216 pixels. It SHALL reduce backing resolution with a visible notice or fail the page rather than exceed those budgets. Document loading/parsing SHALL time out after 30 seconds and page rendering after 15 seconds. On selection/workspace change, reload, pane hide, deactivation, or destruction, it SHALL invalidate old work, release buffers and page resources, terminate its worker, and revoke any worker URL. Bytes SHALL NOT be persisted or logged.

#### Scenario: Rapid navigation supersedes a request
- **WHEN** the user changes file or workspace before an old read or render finishes
- **THEN** the old result cannot replace the new preview, its resources are released, and the new identity starts at page 1 and fit width

#### Scenario: Page or zoom changes while rendering
- **WHEN** the user requests another page or zoom before rendering finishes
- **THEN** superseded rendering is cancelled, only the latest page state is published, and the document is not reread

#### Scenario: Page dimensions exceed the canvas budget
- **WHEN** page dimensions, zoom, or device pixel ratio would exceed a canvas limit
- **THEN** rendering stays within the budget and shows a reduced-resolution notice or a page-specific resource error

#### Scenario: Processing exceeds its deadline
- **WHEN** document parsing or page rendering exceeds its respective deadline
- **THEN** processing stops, the owned worker is terminated, and the user sees a timeout with a manual Retry

#### Scenario: Preview becomes inactive
- **WHEN** the pane is hidden, the plugin is deactivated, or the preview is destroyed during any loading state
- **THEN** cleanup is idempotent, workers and worker URLs are released, canvas and text resources are cleared, and late completions do not restore the preview
