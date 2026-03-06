import DOMPurify from 'dompurify'

/**
 * Sanitize HTML to prevent XSS attacks.
 * Strips all dangerous tags (script, iframe, etc.) and event handlers.
 * Allows safe structural/formatting HTML through.
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style'],
    FORBID_ATTR: ['style'],
  })
}
