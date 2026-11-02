/* Keep Instagram videos playing when another tab or window gains focus.
 * Runs in the page's MAIN world at document_start, before Instagram's handlers.
 */
(() => {
    'use strict';

    const previousHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    const previousState = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    const realHasFocus = document.hasFocus.bind(document);
    const realHidden = () => previousHidden?.get?.call(document) ?? false;
    let lostWindowFocus = false;
    const isBackground = () => lostWindowFocus || realHidden() || !realHasFocus();
    const protectedVideos = new Set();
    const retries = new WeakMap();

    function valid(video) {
        if (!video.isConnected || video.ended) return false;
        const r = video.getBoundingClientRect();
        return r.width > 60 && r.height > 60 &&
            r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    }

    function remember() {
        document.querySelectorAll('video').forEach(video => {
            if (!video.paused && valid(video)) protectedVideos.add(video);
        });
        for (const video of protectedVideos) {
            if (!valid(video) || (!isBackground() && video.paused)) protectedVideos.delete(video);
        }
    }

    function preserving() {
        return isBackground() && [...protectedVideos].some(video => valid(video));
    }

    // Expose the page as visible only while protecting a video that was
    // already playing. Never change visibility for ordinary navigation.
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
        remember();
        if (preserving()) event.stopImmediatePropagation();
    }
    window.addEventListener('blur', event => {
        // A blur event may arrive before hasFocus() updates on some browsers.
        lostWindowFocus = true;
        preventFocusPause(event);
    }, true);
    window.addEventListener('visibilitychange', preventFocusPause, true);
    document.addEventListener('visibilitychange', preventFocusPause, true);

    // Some Instagram paths call pause() directly without a visibility event.
    // Ignore those calls for the active background video, but preserve normal
    // pause/seek/navigation behavior whenever the tab is focused.
    const nativePause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (...args) {
        if (this instanceof HTMLVideoElement && !this.paused &&
            protectedVideos.has(this) && valid(this) && preserving()) return;
        return nativePause.apply(this, args);
    };

    window.addEventListener('focus', () => {
        lostWindowFocus = false;
        protectedVideos.clear();
    }, true);
    document.addEventListener('play', event => {
        if (event.target instanceof HTMLVideoElement && !isBackground()) remember();
    }, true);
    document.addEventListener('pause', event => {
        if (!isBackground() && event.target instanceof HTMLVideoElement) {
            protectedVideos.delete(event.target);
        }
    }, true);
    // Fallback for pauses not initiated through HTMLMediaElement.pause().
    setInterval(() => {
        if (!isBackground()) return;
        for (const video of protectedVideos) {
            if (!valid(video)) {
                protectedVideos.delete(video);
            } else if (video.paused && !video.ended) {
                const count = retries.get(video) || 0;
                if (count < 5) {
                    retries.set(video, count + 1);
                    video.play().catch(() => {});
                }
            } else {
                retries.delete(video);
            }
        }
    }, 1500);
})();
