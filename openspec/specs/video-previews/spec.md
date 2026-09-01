# Video Previews Specification

## Purpose

Allow users to inspect browser-playable project videos inside OpenForge's review and file-browsing views without exposing arbitrary filesystem URLs or forcing them into another application.

## Requirements

### Requirement: Supported video formats are recognized consistently
The system SHALL recognize MP4, M4V, WebM, OGV, OGG, and MOV file extensions case-insensitively as video content and SHALL associate each recognized extension with an appropriate video MIME type.

#### Scenario: Supported extension is selected
- **WHEN** a user encounters a file whose extension is one of the supported video extensions
- **THEN** the system treats the file as video content instead of text or an unknown binary file

#### Scenario: Unsupported extension is selected
- **WHEN** a file does not have a supported video extension
- **THEN** the system preserves its existing text, image, document, binary, or large-file behavior

### Requirement: Every Diff Viewer displays video changes
The system SHALL display video changes in Task self-review, GitHub PR file review, and walkthrough Diff Viewers using the same Before and After structure used for image changes.

#### Scenario: Video is modified
- **WHEN** a changed video has both an old and a new revision
- **THEN** the Diff Viewer displays labeled Before and After video previews for the matching revisions

#### Scenario: Video is added or removed
- **WHEN** a changed video exists on only one side of the diff
- **THEN** the Diff Viewer displays only the available revision and does not show a broken player for the absent side

#### Scenario: Video is renamed without textual changes
- **WHEN** a supported video is renamed and both revisions are available
- **THEN** the Diff Viewer displays the video revisions instead of the generic content-unchanged rename message

#### Scenario: Rename crosses media types
- **WHEN** a rename changes between an image, video, or non-media filename
- **THEN** the system classifies and transports each revision from its own filename and renders each available side with the matching preview type

### Requirement: Review videos use native playback and fullscreen controls
The system SHALL render each available Before or After review revision in an embedded video element with native playback and fullscreen controls, without a separate application-owned full-window action.

#### Scenario: User plays a video revision
- **WHEN** the user interacts with an available review video
- **THEN** the native player identifies the revision through its surrounding filename and Before or After label, exposes playback controls, and does not start playback automatically

#### Scenario: Browser cannot decode a review video
- **WHEN** Chromium reports a playback error for an inline review video
- **THEN** the system keeps the filename and Before or After context visible and reports that the codec may be unsupported

#### Scenario: User enters native fullscreen
- **WHEN** the user activates the video element's native fullscreen control in the trusted main renderer
- **THEN** Electron grants that fullscreen request and the player enters fullscreen without opening a separate application-owned media viewer

#### Scenario: Untrusted content requests fullscreen
- **WHEN** a renderer or origin outside the trusted main renderer requests fullscreen
- **THEN** the renderer trust policy denies the request

### Requirement: Video preview loading is bounded and recoverable
The system SHALL avoid eagerly loading video bytes that are not needed for a visible or explicitly requested preview and SHALL provide an unavailable state when a video exceeds the configured inline-preview limit.

#### Scenario: Video preview becomes relevant
- **WHEN** a video diff section becomes visible or a user selects a video in the File Viewer
- **THEN** the system loads only the content needed for that preview and presents a loading state until it is ready

#### Scenario: Another video becomes relevant while a batch is pending
- **WHEN** a video requests content while text, image, or another video content batch is still in flight
- **THEN** the system reserves the pending file identities, fetches only newly requested revisions, and retains every non-stale response

#### Scenario: Video exceeds the preview limit
- **WHEN** a video exceeds the configured inline-preview limit
- **THEN** the system shows file metadata and a clear too-large-to-preview message without transferring the full video to the renderer

#### Scenario: Video content cannot be loaded
- **WHEN** loading a video revision fails or returns no content
- **THEN** the system shows a contextual error with a retry action and does not leave an indefinite loading indicator

### Requirement: File Viewer previews selected videos
The File Viewer SHALL render a selected supported video with native playback controls, filename, MIME type, size, and modification metadata when available.

#### Scenario: User selects a playable project video
- **WHEN** the user selects a supported video within the inline-preview limit
- **THEN** the File Viewer displays an in-pane video player with controls and does not autoplay it

#### Scenario: Browser cannot play the encoded video
- **WHEN** the selected file uses a recognized container but Electron cannot decode its codec
- **THEN** the File Viewer keeps the file metadata visible and reports that playback is unavailable

#### Scenario: User changes the selected file
- **WHEN** the user navigates away from a playing video
- **THEN** the previous video stops playing and the new file preview replaces it

### Requirement: Plugin file content identifies video payloads
The Plugin SDK file-content contract SHALL identify previewable videos with `type` equal to `video`, base64-encoded bytes in `content`, an appropriate `mimeType`, and the original byte `size`.

#### Scenario: Plugin reads a previewable video
- **WHEN** a plugin reads a supported video within the inline-preview limit through the project filesystem API
- **THEN** the returned file-content value uses the video contract and preserves its MIME type and byte size

#### Scenario: Older exhaustive plugin consumer upgrades
- **WHEN** a plugin consumer upgrades to the SDK version containing video file content
- **THEN** its documented migration path instructs it to handle the new `video` case or provide an explicit fallback

### Requirement: Video playback follows renderer trust policy
The system SHALL permit video playback only from renderer-approved HTTPS, data, blob, or application-owned sources and SHALL NOT grant direct arbitrary filesystem access to video elements.

#### Scenario: Approved video source is rendered
- **WHEN** a preview uses an approved video source
- **THEN** the renderer content security policy permits the media request

#### Scenario: Arbitrary local file URL is supplied
- **WHEN** video content references an unapproved `file:` URL
- **THEN** the renderer trust policy blocks the request
