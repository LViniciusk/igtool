/* Keep only the foreground Instagram video playing, without pausing it
 * when the browser tab or Windows window loses focus.
 * Runs in the page's MAIN world at document_start.
 */
(() => {
    'use strict';

    const previousHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    const previousState = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    const realHasFocus = document.hasFocus.bind(document);
    const realHidden = () => previousHidden?.get?.call(document) ?? false;
    const nativePause = HTMLMediaElement.prototype.pause;
    const protectedVideos = new Set();
    const retries = new WeakMap();
    let lostWindowFocus = false;
    let currentVideo = null;
    const isBackground = () => lostWindowFocus || realHidden() || !realHasFocus();

    // Focus means the video in view, not whether Chrome or Windows has focus.
    // Geometry is still available when the document is in a background tab.
    function visibleArea(element) {
        if (!element?.isConnected || element.closest('[aria-hidden="true"], [inert]')) return 0;
        if (!element.getClientRects().length) return 0;
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') return 0;
        const r = element.getBoundingClientRect();
        if (r.width < 60 || r.height < 60) return 0;
        const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
        const area = w * h;
        // A sliver at the edge of the feed must not remain audible.
        return area / (r.width * r.height) >= 0.18 ? area : 0;
    }

    function valid(video) {
        return video?.isConnected && !video.ended && visibleArea(video) > 0;
    }

    function chooseActive(videos) {
        const candidates = videos.filter(valid);
        if (!candidates.length) return null;

        // A DM/post modal takes precedence over feed videos behind it.
        const dialogs = [...document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')]
            .filter(dialog => visibleArea(dialog) > 0);
        const modalVideos = candidates.filter(video => dialogs.some(dialog => dialog.contains(video)));
        const pool = modalVideos.length ? modalVideos : candidates;
        let best = null;
        let bestScore = -Infinity;
        for (const video of pool) {
            const r = video.getBoundingClientRect();
            const area = visibleArea(video);
            const centerX = (r.left + r.right) / 2;
            const centerY = (r.top + r.bottom) / 2;
            const distance = Math.hypot(
                (centerX - innerWidth / 2) / Math.max(1, innerWidth),
                (centerY - innerHeight / 2) / Math.max(1, innerHeight)
            );
            const score = area / Math.max(1, innerWidth * innerHeight) * 100 - distance * 20;
            if (score > bestScore) {
                best = video;
                bestScore = score;
            }
        }
        return best;
    }

    function reconcile() {
        const videos = [...document.querySelectorAll('video')];
        currentVideo = chooseActive(videos);
        for (const video of videos) {
            // Do not touch a video explicitly moved to Picture-in-Picture.
            if (video === currentVideo || video === document.pictureInPictureElement ||
                video._pipRestore || video.paused) continue;
            protectedVideos.delete(video); // Do not block our intentional pause.
            nativePause.call(video);
        }
        for (const video of protectedVideos) {
            if (video !== currentVideo || !valid(video)) protectedVideos.delete(video);
        }
        // Only protect the one already playing; never auto-start a paused video.
        if (currentVideo && !currentVideo.paused) protectedVideos.add(currentVideo);
    }

    function preserving() {
        return isBackground() && currentVideo && protectedVideos.has(currentVideo) && valid(currentVideo);
    }

    if (previousHidden?.get && previousState?.get) {
        Object.defineProperty(document, 'hidden', {
            configurable: true,
            get() { return preserving() ? false : realHidden(); }
        });
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get() { return preserving() ? 'visible' : previousState.get.call(document); }
        });
    }
    document.hasFocus = function () { return preserving() || realHasFocus(); };

    function preventFocusPause(event) {
        reconcile();
        if (preserving()) event.stopImmediatePropagation();
    }
    window.addEventListener('blur', event => {
        lostWindowFocus = true;
        preventFocusPause(event);
    }, true);
    window.addEventListener('visibilitychange', preventFocusPause, true);
    document.addEventListener('visibilitychange', preventFocusPause, true);

    // Keep just the active video playing when focus is elsewhere.
    HTMLMediaElement.prototype.pause = function (...args) {
        if (this instanceof HTMLVideoElement && this === currentVideo && !this.paused &&
            protectedVideos.has(this) && valid(this) && preserving()) return;
        return nativePause.apply(this, args);
    };

    window.addEventListener('focus', () => {
        lostWindowFocus = false;
        reconcile();
    }, true);
    document.addEventListener('play', event => {
        if (event.target instanceof HTMLVideoElement) reconcile();
    }, true);
    document.addEventListener('pause', event => {
        if (!isBackground() && event.target instanceof HTMLVideoElement) {
            protectedVideos.delete(event.target);
        }
    }, true);

    // React may move/reuse <video> elements without firing pause/visibility events.
    // Recheck on scrolling, route changes and a lightweight fallback timer.
    window.addEventListener('scroll', reconcile, { passive: true, capture: true });
    window.addEventListener('resize', reconcile, { passive: true });
    window.addEventListener('popstate', reconcile);
    window.addEventListener('hashchange', reconcile);
    setInterval(() => {
        reconcile();
        if (!isBackground() || !currentVideo || !protectedVideos.has(currentVideo)) return;
        // Fallback if Instagram paused the active background video without pause().
        if (currentVideo.paused && !currentVideo.ended) {
            const count = retries.get(currentVideo) || 0;
            if (count < 5) {
                retries.set(currentVideo, count + 1);
                currentVideo.play().catch(() => {});
            }
        } else {
            retries.delete(currentVideo);
        }
    }, 500);
})();
