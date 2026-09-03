import type {
  TaskBrowserSurfaceRegion,
  TaskBrowserVisualFeedbackAppearance,
} from './taskBrowserSurfaceContract.js'

export interface TaskBrowserVisualFeedbackTheme {
  readonly annotationBorder: string
  readonly annotationBackground: string
  readonly hoverBackground: string
  readonly selectionBackground: string
  readonly accentBackground: string
  readonly accentForeground: string
  readonly foreground: string
  readonly hintBackground: string
  readonly hintShadow: string
  readonly panelBackground: string
  readonly panelShadow: string
  readonly fieldBorder: string
  readonly fieldBackground: string
}

export const TASK_BROWSER_VISUAL_FEEDBACK_THEME: Readonly<TaskBrowserVisualFeedbackTheme> = Object.freeze({
  annotationBorder: '#60a5fa',
  annotationBackground: 'rgba(59,130,246,.14)',
  hoverBackground: 'rgba(59,130,246,.12)',
  selectionBackground: 'rgba(59,130,246,.18)',
  accentBackground: '#2563eb',
  accentForeground: '#ffffff',
  foreground: '#ffffff',
  hintBackground: 'rgba(20,20,24,.92)',
  hintShadow: 'rgba(0,0,0,.3)',
  panelBackground: 'rgba(20,20,24,.96)',
  panelShadow: 'rgba(0,0,0,.35)',
  fieldBorder: 'rgba(255,255,255,.2)',
  fieldBackground: '#111827',
})

export const TASK_BROWSER_VISUAL_FEEDBACK_LIGHT_THEME: Readonly<TaskBrowserVisualFeedbackTheme> = Object.freeze({
  annotationBorder: '#2563eb',
  annotationBackground: 'rgba(37,99,235,.12)',
  hoverBackground: 'rgba(37,99,235,.1)',
  selectionBackground: 'rgba(37,99,235,.16)',
  accentBackground: '#2563eb',
  accentForeground: '#ffffff',
  foreground: '#1f2937',
  hintBackground: 'rgba(255,255,255,.96)',
  hintShadow: 'rgba(15,23,42,.2)',
  panelBackground: 'rgba(255,255,255,.98)',
  panelShadow: 'rgba(15,23,42,.2)',
  fieldBorder: 'rgba(31,41,55,.18)',
  fieldBackground: '#f7f7fa',
})

export const TASK_BROWSER_VISUAL_FEEDBACK_THEMES = Object.freeze({
  light: TASK_BROWSER_VISUAL_FEEDBACK_LIGHT_THEME,
  dark: TASK_BROWSER_VISUAL_FEEDBACK_THEME,
})


export interface TaskBrowserVisualFeedbackAnnotation {
  number: number
  comment: string
  x: number
  y: number
  width: number
  height: number
}

export interface TaskBrowserVisualFeedbackOverlayInput {
  savedAnnotations: readonly TaskBrowserVisualFeedbackAnnotation[]
  nextAnnotationNumber: number
  appearance?: TaskBrowserVisualFeedbackAppearance
}

export interface TaskBrowserVisualFeedbackOverlayResult {
  region: TaskBrowserSurfaceRegion
  comment: string
  annotation: TaskBrowserVisualFeedbackAnnotation
}

export type TaskBrowserPageScriptExecutor = (script: string, userGesture: boolean) => Promise<unknown>

export interface TaskBrowserVisualFeedbackAnnotationsScriptInput {
  savedAnnotations: readonly TaskBrowserVisualFeedbackAnnotation[]
  expectedUrl?: string
  appearance?: TaskBrowserVisualFeedbackAppearance
}

export function buildTaskBrowserVisualFeedbackAnnotationsScript(
  input: TaskBrowserVisualFeedbackAnnotationsScriptInput,
): string {
  const expectedUrlGuard = input.expectedUrl === undefined
    ? ''
    : `const expectedUrl = ${JSON.stringify(input.expectedUrl)};
    if (location.href !== expectedUrl) return;`
  const pageUrlExpression = input.expectedUrl === undefined ? 'location.href' : 'expectedUrl'

  return `const visualFeedbackAppearance = ${JSON.stringify(input.appearance ?? 'dark')};
    const visualFeedbackThemes = ${JSON.stringify(TASK_BROWSER_VISUAL_FEEDBACK_THEMES)};
    const visualFeedbackTheme = visualFeedbackThemes[visualFeedbackAppearance];
    ${expectedUrlGuard}
    const savedAnnotations = ${JSON.stringify(input.savedAnnotations)};
    const annotationsId = '__openforge_visual_feedback_annotations__';
    let annotationsRoot = document.getElementById(annotationsId);
    if (!annotationsRoot) {
      annotationsRoot = document.createElement('div');
      annotationsRoot.id = annotationsId;
      annotationsRoot.setAttribute('aria-label', 'Saved visual feedback');
      annotationsRoot.style.cssText = 'position:absolute;inset:0;z-index:2147483646;pointer-events:none;overflow:visible;';
      document.documentElement.append(annotationsRoot);
    }
    const renderAnnotation = (annotationData) => {
      const annotation = document.createElement('div');
      annotation.setAttribute('role', 'note');
      annotation.setAttribute('aria-label', 'Feedback ' + annotationData.number + ': ' + annotationData.comment);
      annotation.style.cssText = 'position:absolute;left:' + annotationData.x + 'px;top:' + annotationData.y + 'px;width:' + annotationData.width + 'px;height:' + annotationData.height + 'px;border:2px solid ' + visualFeedbackTheme.annotationBorder + ';background:' + visualFeedbackTheme.annotationBackground + ';box-sizing:border-box;border-radius:4px;pointer-events:none;';
      const badge = document.createElement('span');
      badge.textContent = String(annotationData.number);
      badge.style.cssText = 'position:absolute;left:-9px;top:-9px;display:flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:' + visualFeedbackTheme.accentBackground + ';color:' + visualFeedbackTheme.accentForeground + ';font:600 11px system-ui,sans-serif;box-sizing:border-box;pointer-events:none;';
      annotation.append(badge);
      annotationsRoot.append(annotation);
    };
    const currentPageUrl = ${pageUrlExpression};
    const commentsId = '__openforge_visual_feedback_comments__';
    const commentsListId = '__openforge_visual_feedback_comment_list__';
    const previousCard = annotationsRoot.querySelector('#' + commentsId);
    const preserveDisclosure = annotationsRoot.dataset.pageUrl === String(currentPageUrl);
    const initiallyExpanded = !preserveDisclosure || previousCard?.dataset.expanded !== 'false';
    const commentsCleanupProperty = '__openforgeVisualFeedbackCommentsCleanup';
    const cleanupExistingComments = annotationsRoot[commentsCleanupProperty];
    if (typeof cleanupExistingComments === 'function') cleanupExistingComments();
    const renderCommentsCard = (expanded) => {
      if (savedAnnotations.length === 0) return;
      const card = document.createElement('section');
      card.id = commentsId;
      card.setAttribute('role', 'region');
      card.setAttribute('aria-label', 'Visual feedback comments');
      card.style.cssText = 'all:initial;position:fixed;right:12px;bottom:12px;display:flex;flex-direction:column;width:min(320px,calc(100vw - 24px));max-height:calc(100vh - 24px);border:1px solid ' + visualFeedbackTheme.fieldBorder + ';border-radius:12px;background:' + visualFeedbackTheme.panelBackground + ';box-shadow:0 8px 30px ' + visualFeedbackTheme.panelShadow + ';color:' + visualFeedbackTheme.foreground + ';font:13px/1.5 system-ui,sans-serif;pointer-events:auto;box-sizing:border-box;overflow:hidden;';
      const disclosure = document.createElement('button');
      disclosure.type = 'button';
      disclosure.setAttribute('aria-controls', commentsListId);
      disclosure.style.cssText = 'all:initial;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:44px;padding:0 14px;color:' + visualFeedbackTheme.foreground + ';font:600 13px/1.5 system-ui,sans-serif;cursor:pointer;box-sizing:border-box;';
      const count = document.createElement('span');
      count.textContent = savedAnnotations.length + (savedAnnotations.length === 1 ? ' annotation' : ' annotations');
      const disclosureAction = document.createElement('span');
      disclosureAction.style.cssText = 'all:initial;color:' + visualFeedbackTheme.foreground + ';font:500 12px/1 system-ui,sans-serif;';
      disclosure.append(count, disclosureAction);
      const list = document.createElement('ol');
      list.id = commentsListId;
      list.style.cssText = 'all:initial;display:flex;flex-direction:column;gap:8px;max-height:min(360px,calc(100vh - 80px));margin:0;padding:0 12px 12px;overflow-y:auto;box-sizing:border-box;';
      [...savedAnnotations].sort((left, right) => left.number - right.number).forEach(annotationData => {
        const item = document.createElement('li');
        item.style.cssText = 'all:initial;display:grid;grid-template-columns:24px minmax(0,1fr) 28px;gap:8px;align-items:start;margin:0;padding:10px;border:1px solid ' + visualFeedbackTheme.fieldBorder + ';border-radius:8px;background:' + visualFeedbackTheme.fieldBackground + ';color:' + visualFeedbackTheme.foreground + ';font:13px/1.5 system-ui,sans-serif;box-sizing:border-box;';
        const number = document.createElement('span');
        number.textContent = String(annotationData.number);
        number.style.cssText = 'all:initial;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;background:' + visualFeedbackTheme.accentBackground + ';color:' + visualFeedbackTheme.accentForeground + ';font:600 11px/1 system-ui,sans-serif;box-sizing:border-box;';
        const comment = document.createElement('span');
        comment.textContent = annotationData.comment;
        comment.style.cssText = 'all:initial;display:block;min-width:0;color:' + visualFeedbackTheme.foreground + ';font:13px/1.5 system-ui,sans-serif;overflow-wrap:anywhere;white-space:pre-wrap;';
        const deleteControl = document.createElement('button');
        deleteControl.type = 'button';
        deleteControl.textContent = '×';
        deleteControl.dataset.annotationNumber = String(annotationData.number);
        deleteControl.setAttribute('aria-label', 'Delete annotation ' + annotationData.number);
        deleteControl.style.cssText = 'all:initial;display:flex;align-items:center;justify-content:center;width:28px;height:28px;margin:-2px -2px 0 0;border-radius:6px;color:' + visualFeedbackTheme.foreground + ';font:600 18px/1 system-ui,sans-serif;cursor:pointer;box-sizing:border-box;';
        item.append(number, comment, deleteControl);
        list.append(item);
      });
      const setExpanded = (expanded) => {
        card.dataset.expanded = String(expanded);
        disclosure.setAttribute('aria-expanded', String(expanded));
        disclosure.setAttribute('aria-label', (expanded ? 'Collapse' : 'Expand') + ' visual feedback comments');
        disclosureAction.textContent = expanded ? 'Hide' : 'Show';
        list.hidden = !expanded;
        list.style.display = expanded ? 'flex' : 'none';
      };
      const toggleDisclosure = () => {
        setExpanded(disclosure.getAttribute('aria-expanded') !== 'true');
      };
      const setDisclosureFocus = (focused) => {
        disclosure.style.outline = focused ? '2px solid ' + visualFeedbackTheme.annotationBorder : 'none';
        disclosure.style.outlineOffset = focused ? '-2px' : '0';
      };
      const setDeleteFocus = (control, focused) => {
        control.style.outline = focused ? '2px solid ' + visualFeedbackTheme.annotationBorder : 'none';
        control.style.outlineOffset = focused ? '1px' : '0';
      };
      const shieldCommentsEvent = (event) => {
        const target = event.target;
        if (!(target instanceof Node) || !card.contains(target)) return;
        event.stopPropagation();
        const deleteControl = target instanceof Element
          ? target.closest('button[data-annotation-number]')
          : null;
        const activationKey = event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
        if ((event.type === 'focus' || event.type === 'focusin') && deleteControl) {
          setDeleteFocus(deleteControl, true);
        } else if ((event.type === 'blur' || event.type === 'focusout') && deleteControl) {
          setDeleteFocus(deleteControl, false);
        } else if (event.type === 'click' && deleteControl) {
          event.preventDefault();
        } else if (event.type === 'keydown' && deleteControl && activationKey) {
          event.preventDefault();
        } else if ((event.type === 'focus' || event.type === 'focusin') && disclosure.contains(target)) {
          setDisclosureFocus(true);
        } else if ((event.type === 'blur' || event.type === 'focusout') && disclosure.contains(target)) {
          setDisclosureFocus(false);
        } else if (event.type === 'click' && disclosure.contains(target)) {
          event.preventDefault();
          toggleDisclosure();
        } else if (event.type === 'keydown' && disclosure.contains(target) && activationKey) {
          event.preventDefault();
          toggleDisclosure();
        }
      };
      const commentsShieldTypes = [
        'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'paste', 'cut', 'copy',
        'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'contextmenu', 'wheel',
        'keydown', 'keypress', 'keyup', 'focus', 'blur', 'focusin', 'focusout',
      ];
      commentsShieldTypes.forEach(type => window.addEventListener(type, shieldCommentsEvent, true));
      annotationsRoot[commentsCleanupProperty] = () => {
        commentsShieldTypes.forEach(type => window.removeEventListener(type, shieldCommentsEvent, true));
        delete annotationsRoot[commentsCleanupProperty];
      };
      setExpanded(expanded);
      card.append(disclosure, list);
      annotationsRoot.append(card);
    };
    const setCommentsCardSelectionActive = (active) => {
      if (active) annotationsRoot.dataset.selectionActive = 'true';
      else delete annotationsRoot.dataset.selectionActive;
      const card = annotationsRoot.querySelector('#' + commentsId);
      if (!card) return;
      card.style.display = active ? 'none' : 'flex';
      card.style.pointerEvents = active ? 'none' : 'auto';
      if (active) card.setAttribute('aria-hidden', 'true');
      else card.removeAttribute('aria-hidden');
    };
    const rerenderCommentsCard = () => {
      const existingCard = annotationsRoot.querySelector('#' + commentsId);
      const expanded = existingCard?.dataset.expanded !== 'false';
      const cleanupComments = annotationsRoot[commentsCleanupProperty];
      if (typeof cleanupComments === 'function') cleanupComments();
      existingCard?.remove();
      renderCommentsCard(expanded);
      if (annotationsRoot.dataset.selectionActive === 'true') setCommentsCardSelectionActive(true);
    };
    annotationsRoot.replaceChildren();
    annotationsRoot.dataset.pageUrl = String(currentPageUrl);
    savedAnnotations.forEach(renderAnnotation);
    renderCommentsCard(initiallyExpanded);`
}

export function buildTaskBrowserVisualFeedbackClearScript(): string {
  return `(() => {
    const annotations = document.getElementById('__openforge_visual_feedback_annotations__');
    if (!annotations) return;
    const cleanupComments = annotations.__openforgeVisualFeedbackCommentsCleanup;
    if (typeof cleanupComments === 'function') cleanupComments();
    annotations.remove();
  })()`
}

export function buildTaskBrowserVisualFeedbackActionWaitScript(): string {
  return `(() => {
    const cleanupProperty = '__openforgeVisualFeedbackActionWaitCleanup';
    const existingCleanup = window[cleanupProperty];
    if (typeof existingCleanup === 'function') existingCleanup();
    const annotations = document.getElementById('__openforge_visual_feedback_annotations__');
    if (!annotations) return null;
    const deleteControls = new Set(annotations.querySelectorAll('button[data-openforge-visual-feedback-action="delete-annotation"][data-annotation-number]'));
    return new Promise(resolve => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('click', receiveAction, true);
        window.removeEventListener('keydown', receiveAction, true);
        if (window[cleanupProperty] === cleanup) delete window[cleanupProperty];
        resolve(value);
      };
      const cleanup = () => finish(null);
      const receiveAction = (event) => {
        if (!event.isTrusted) return;
        const control = event.target instanceof Element
          ? event.target.closest('button[data-annotation-number]')
          : null;
        if (!control || !deleteControls.has(control)) return;
        const activationKey = event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
        if (event.type === 'keydown' && !activationKey) return;
        event.preventDefault();
        event.stopPropagation();
        const annotationNumber = Number(control.dataset.annotationNumber);
        if (!Number.isSafeInteger(annotationNumber) || annotationNumber <= 0) return;
        finish({ type: 'delete-annotation', annotationNumber });
      };
      window[cleanupProperty] = cleanup;
      window.addEventListener('click', receiveAction, true);
      window.addEventListener('keydown', receiveAction, true);
    });
  })()`
}

export function buildTaskBrowserVisualFeedbackActionCancelScript(): string {
  return `(() => {
    const cleanup = window.__openforgeVisualFeedbackActionWaitCleanup;
    if (typeof cleanup === 'function') cleanup();
  })()`
}

export function buildTaskBrowserVisualFeedbackDismissScript(): string {
  return `(() => {
    const overlay = document.getElementById('__openforge_visual_feedback_selector__');
    if (!overlay) return;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    overlay.remove();
  })()`
}

function visualFeedbackOverlayScript(input: TaskBrowserVisualFeedbackOverlayInput): string {
  return `(() => new Promise((resolve) => {
    const overlayId = '__openforge_visual_feedback_selector__';
    ${buildTaskBrowserVisualFeedbackDismissScript()};
    ${buildTaskBrowserVisualFeedbackAnnotationsScript({
      savedAnnotations: input.savedAnnotations,
      appearance: input.appearance,
    })}
    const nextAnnotationNumber = ${input.nextAnnotationNumber};
    setCommentsCardSelectionActive(true);

    const root = document.createElement('div');
    root.id = overlayId;
    root.setAttribute('aria-label', 'Select a region for feedback');
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:13px system-ui,sans-serif;color:' + visualFeedbackTheme.foreground + ';';

    const hint = document.createElement('div');
    hint.textContent = 'Highlight an area to comment · Esc to cancel';
    hint.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:8px 12px;border-radius:8px;background:' + visualFeedbackTheme.hintBackground + ';color:' + visualFeedbackTheme.foreground + ';pointer-events:none;box-shadow:0 4px 16px ' + visualFeedbackTheme.hintShadow + ';';

    const hover = document.createElement('div');
    hover.style.cssText = 'position:fixed;display:none;border:2px solid ' + visualFeedbackTheme.annotationBorder + ';background:' + visualFeedbackTheme.hoverBackground + ';pointer-events:none;box-sizing:border-box;border-radius:4px;';
    const selection = document.createElement('div');
    selection.style.cssText = 'position:fixed;display:none;border:2px solid ' + visualFeedbackTheme.annotationBorder + ';background:' + visualFeedbackTheme.selectionBackground + ';pointer-events:none;box-sizing:border-box;border-radius:4px;';

    const interaction = document.createElement('div');
    interaction.style.cssText = 'position:fixed;inset:0;cursor:crosshair;pointer-events:auto;background:transparent;';
    root.append(hint, hover, selection, interaction);
    document.documentElement.append(root);
    // Live-page handlers cancel keystrokes and steal focus from the overlay, so overlay events stop here.
    const hidePageEventHandling = (event) => event.stopPropagation();
    ['beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'paste', 'cut', 'copy',
      'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'contextmenu', 'submit']
      .forEach(type => root.addEventListener(type, hidePageEventHandling));

    let start = null;
    let pointerId = null;
    let suggestedRect = null;
    const clamp = (value, max) => Math.min(max, Math.max(0, value));
    const setRect = (element, rect) => {
      element.style.display = 'block';
      element.style.left = rect.x + 'px';
      element.style.top = rect.y + 'px';
      element.style.width = rect.width + 'px';
      element.style.height = rect.height + 'px';
    };
    const normalized = (rect) => ({
      x: rect.x / window.innerWidth,
      y: rect.y / window.innerHeight,
      width: rect.width / window.innerWidth,
      height: rect.height / window.innerHeight,
    });
    const suggestedAt = (x, y) => {
      interaction.style.pointerEvents = 'none';
      const candidate = document.elementsFromPoint(x, y).find(element => {
        if (!(element instanceof HTMLElement) || root.contains(element)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width >= 12 && rect.height >= 12 && rect.width <= window.innerWidth && rect.height <= window.innerHeight;
      });
      interaction.style.pointerEvents = 'auto';
      if (!candidate) return null;
      const rect = candidate.getBoundingClientRect();
      return {
        x: clamp(rect.left, window.innerWidth),
        y: clamp(rect.top, window.innerHeight),
        width: Math.min(rect.width, window.innerWidth - clamp(rect.left, window.innerWidth)),
        height: Math.min(rect.height, window.innerHeight - clamp(rect.top, window.innerHeight)),
      };
    };
    const isInsideOverlay = (node) => node instanceof Node && root.contains(node);
    const hidePageKeyHandling = (event) => { if (isInsideOverlay(event.target)) event.stopPropagation(); };
    const hidePageFocusHandling = (event) => {
      const movingIntoOverlay = (event.type === 'blur' || event.type === 'focusout') && isInsideOverlay(event.relatedTarget);
      if (isInsideOverlay(event.target) || movingIntoOverlay) event.stopPropagation();
    };
    const cleanup = () => {
      pageShields.forEach(([type, handler]) => window.removeEventListener(type, handler, true));
      setCommentsCardSelectionActive(false);
      root.remove();
    };
    const finish = (value) => {
      cleanup();
      resolve(value);
    };
    const cancelDrag = () => {
      start = null;
      pointerId = null;
      selection.style.display = 'none';
    };
    let onComposerKeyDown = null;
    const onKeyDown = (event) => {
      if (isInsideOverlay(event.target)) {
        event.stopPropagation();
        if (onComposerKeyDown !== null) {
          onComposerKeyDown(event);
          return;
        }
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    };
    // Key and focus shields run at window capture, ahead of page handlers bound to the document.
    const pageShields = [
      ['keydown', onKeyDown],
      ['keypress', hidePageKeyHandling],
      ['keyup', hidePageKeyHandling],
      ['focus', hidePageFocusHandling],
      ['blur', hidePageFocusHandling],
      ['focusin', hidePageFocusHandling],
      ['focusout', hidePageFocusHandling],
    ];
    const openComposer = (rect) => {
      interaction.style.pointerEvents = 'none';
      hover.style.display = 'none';
      setRect(selection, rect);

      const composer = document.createElement('form');
      composer.setAttribute('aria-label', 'Visual feedback comment');
      const left = Math.min(Math.max(12, rect.x + rect.width + 8), Math.max(12, window.innerWidth - 300));
      const top = Math.min(Math.max(12, rect.y + rect.height + 8), Math.max(12, window.innerHeight - 142));
      composer.style.cssText = 'position:fixed;left:' + left + 'px;top:' + top + 'px;width:280px;padding:10px;border-radius:10px;background:' + visualFeedbackTheme.panelBackground + ';box-shadow:0 8px 30px ' + visualFeedbackTheme.panelShadow + ';pointer-events:auto;box-sizing:border-box;';
      const label = document.createElement('label');
      label.textContent = 'Feedback comment';
      label.style.cssText = 'display:block;margin-bottom:6px;font-weight:600;';
      const textarea = document.createElement('textarea');
      textarea.setAttribute('aria-label', 'Feedback comment');
      textarea.placeholder = 'Describe what should change…';
      textarea.rows = 3;
      textarea.style.cssText = 'display:block;width:100%;resize:none;box-sizing:border-box;border:1px solid ' + visualFeedbackTheme.fieldBorder + ';border-radius:7px;padding:8px;background:' + visualFeedbackTheme.fieldBackground + ';color:' + visualFeedbackTheme.foreground + ';font:13px system-ui,sans-serif;outline:none;';
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;margin-top:8px;';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.style.cssText = 'border:0;border-radius:6px;padding:6px 10px;background:transparent;color:' + visualFeedbackTheme.foreground + ';cursor:pointer;';
      const save = document.createElement('button');
      save.type = 'submit';
      save.textContent = 'Save';
      save.disabled = true;
      save.style.cssText = 'border:0;border-radius:6px;padding:6px 10px;background:' + visualFeedbackTheme.accentBackground + ';color:' + visualFeedbackTheme.accentForeground + ';cursor:pointer;';
      actions.append(cancel, save);
      composer.append(label, textarea, actions);
      root.append(composer);
      const dismiss = () => {
        onComposerKeyDown = null;
        composer.remove();
        selection.style.display = 'none';
        interaction.style.pointerEvents = 'auto';
      };
      cancel.addEventListener('click', dismiss);
      textarea.addEventListener('input', () => { save.disabled = textarea.value.trim().length === 0; });
      const saveFeedback = () => {
        const comment = textarea.value.trim();
        if (!comment) return;
        const normalizedRegion = normalized(rect);
        const annotationData = {
          number: nextAnnotationNumber,
          comment,
          x: window.scrollX + rect.x,
          y: window.scrollY + rect.y,
          width: rect.width,
          height: rect.height,
        };
        savedAnnotations.push(annotationData);
        renderAnnotation(annotationData);
        rerenderCommentsCard();
        finish({ region: normalizedRegion, comment, annotation: annotationData });
      };
      onComposerKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          dismiss();
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          saveFeedback();
        }
      };
      composer.addEventListener('submit', (event) => {
        event.preventDefault();
        saveFeedback();
      });
      textarea.focus();
    };

    pageShields.forEach(([type, handler]) => window.addEventListener(type, handler, true));
    interaction.addEventListener('pointermove', (event) => {
      if (start && event.pointerId === pointerId) {
        const x = clamp(event.clientX, window.innerWidth);
        const y = clamp(event.clientY, window.innerHeight);
        setRect(selection, {
          x: Math.min(start.x, x),
          y: Math.min(start.y, y),
          width: Math.abs(x - start.x),
          height: Math.abs(y - start.y),
        });
        return;
      }
      suggestedRect = suggestedAt(event.clientX, event.clientY);
      if (suggestedRect) setRect(hover, suggestedRect);
      else hover.style.display = 'none';
    });
    interaction.addEventListener('pointerleave', () => { if (!start) hover.style.display = 'none'; });
    interaction.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.pointerType === 'touch') return;
      event.preventDefault();
      start = { x: event.clientX, y: event.clientY };
      pointerId = event.pointerId;
      interaction.setPointerCapture(event.pointerId);
      hover.style.display = 'none';
      setRect(selection, { x: start.x, y: start.y, width: 0, height: 0 });
    });
    interaction.addEventListener('pointerup', (event) => {
      if (!start || event.pointerId !== pointerId) return;
      const endX = clamp(event.clientX, window.innerWidth);
      const endY = clamp(event.clientY, window.innerHeight);
      let rect = {
        x: Math.min(start.x, endX),
        y: Math.min(start.y, endY),
        width: Math.abs(endX - start.x),
        height: Math.abs(endY - start.y),
      };
      if (rect.width < 6 && rect.height < 6) {
        rect = suggestedRect || suggestedAt(endX, endY) || {
          x: clamp(endX - 12, window.innerWidth - 24),
          y: clamp(endY - 12, window.innerHeight - 24),
          width: 24,
          height: 24,
        };
      }
      cancelDrag();
      openComposer(rect);
    });
  }))()`
}

type PageAnnotationResult = Omit<TaskBrowserVisualFeedbackAnnotation, 'comment'>

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isFiniteRectangle(value: unknown): value is TaskBrowserSurfaceRegion {
  if (typeof value !== 'object' || value === null) return false
  const rectangle = value as Record<string, unknown>
  return [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(isFiniteNumber)
}

function isPageAnnotation(value: unknown): value is PageAnnotationResult {
  if (!isFiniteRectangle(value)) return false
  return isFiniteNumber((value as unknown as Record<string, unknown>).number)
}

function parseOverlayResult(value: unknown): TaskBrowserVisualFeedbackOverlayResult | null {
  if (value === null) return null
  const region = typeof value === 'object' && value !== null && 'region' in value ? value.region : null
  const comment = typeof value === 'object' && value !== null && 'comment' in value ? value.comment : null
  const annotation = typeof value === 'object' && value !== null && 'annotation' in value ? value.annotation : null
  if (
    !isFiniteRectangle(region)
    || region.x < 0
    || region.y < 0
    || region.width <= 0
    || region.height <= 0
    || region.x + region.width > 1.001
    || region.y + region.height > 1.001
    || typeof comment !== 'string'
    || comment.trim().length === 0
    || !isPageAnnotation(annotation)
  ) {
    throw new Error('Live page returned invalid visual feedback')
  }

  const normalizedComment = comment.trim()
  return {
    region: { x: region.x, y: region.y, width: region.width, height: region.height },
    comment: normalizedComment,
    annotation: {
      number: annotation.number,
      comment: normalizedComment,
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
    },
  }
}

export async function runTaskBrowserVisualFeedbackOverlay(
  executeJavaScript: TaskBrowserPageScriptExecutor,
  input: TaskBrowserVisualFeedbackOverlayInput,
): Promise<TaskBrowserVisualFeedbackOverlayResult | null> {
  const value = await executeJavaScript(visualFeedbackOverlayScript(input), true)
  return parseOverlayResult(value)
}
